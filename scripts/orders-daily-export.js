'use strict';

module.exports = {
  name: 'Daily Orders Export',
  description: 'Exports all orders received in the last 24 hours to a CSV file.',
  cron: null, // Set e.g. '0 0 * * *' to run at midnight daily; null = manual only

  async run(query, { writeFile, log }) {
    const rows = query(`
      SELECT id, created_at, path, response_status, request_body, response_body
      FROM requests
      WHERE endpoint = 'POST /api/orders'
        AND scenario_type = 'success'
        AND created_at > datetime('now', '-1 day')
      ORDER BY created_at ASC
    `);

    log(`Found ${rows.length} order(s) in the last 24 hours`);

    const header = 'id,created_at,path,response_status,orderId,request_body';
    const csvLines = rows.map(row => {
      let orderId = '';
      try {
        const resp = JSON.parse(row.response_body || '{}');
        orderId = resp.orderId || '';
      } catch {}

      const reqBody = (row.request_body || '').replace(/"/g, '""');
      return `${row.id},"${row.created_at}","${row.path}",${row.response_status},"${orderId}","${reqBody}"`;
    });

    const today = new Date().toISOString().slice(0, 10);
    const content = [header, ...csvLines].join('\n');
    const filename = `orders-${today}.csv`;

    writeFile(filename, content);
    log(`Export complete: ${filename} (${rows.length} rows)`);
  },
};
