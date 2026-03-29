'use strict';

module.exports = {
  name: 'API Summary Report',
  description: 'Generates a plain-text summary of all stored API requests grouped by endpoint and status.',
  cron: '*/5 * * * *', // Every 5 minutes

  async run(query, { writeFile, log }) {
    // To write to a custom absolute path instead, use writeFileTo:
    // const { writeFileTo } = arguments[1];
    // writeFileTo('/tmp/my-reports/summary.txt', content);
    const stats = query(`
      SELECT endpoint, response_status, COUNT(*) as count
      FROM requests
      GROUP BY endpoint, response_status
      ORDER BY endpoint, response_status
    `);

    const total = query(`SELECT COUNT(*) as count FROM requests`)[0]?.count || 0;
    const oldest = query(`SELECT MIN(created_at) as ts FROM requests`)[0]?.ts || 'N/A';
    const newest = query(`SELECT MAX(created_at) as ts FROM requests`)[0]?.ts || 'N/A';

    const lines = [
      '='.repeat(60),
      'API MOCK SYSTEM — REQUEST SUMMARY',
      `Generated: ${new Date().toISOString()}`,
      '='.repeat(60),
      `Total requests: ${total}`,
      `Date range: ${oldest} → ${newest}`,
      '',
      'BY ENDPOINT + STATUS:',
      '-'.repeat(60),
    ];

    let lastEndpoint = null;
    for (const row of stats) {
      if (row.endpoint !== lastEndpoint) {
        if (lastEndpoint !== null) lines.push('');
        lines.push(`  ${row.endpoint}`);
        lastEndpoint = row.endpoint;
      }
      lines.push(`    HTTP ${row.response_status}: ${row.count} request(s)`);
    }

    lines.push('', '='.repeat(60));

    const content = lines.join('\n');
    writeFile('summary-report.txt', content);
    log(`Summary: ${total} total requests across ${stats.length} endpoint/status combinations`);
  },
};
