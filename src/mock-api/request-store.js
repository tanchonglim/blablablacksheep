'use strict';

const { getDb } = require('../db');

function storeRequest({ endpoint, method, path, requestHeaders, requestBody, responseStatus, responseBody, scenarioType }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO requests (endpoint, method, path, request_headers, request_body, response_status, response_body, scenario_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    endpoint,
    method,
    path,
    JSON.stringify(requestHeaders || {}),
    typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody || null),
    responseStatus,
    typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody || null),
    scenarioType
  );
}

module.exports = { storeRequest };
