'use strict';

const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const OpenAPIParser = require('@readme/openapi-parser');

const { getDb } = require('./db');
const { registerMockRoutes } = require('./mock-api/router');
const { registerAdminRoutes } = require('./admin/routes');
const { startScheduler } = require('./scheduler/job-manager');

const OPENAPI_PATH = path.join(__dirname, '../config/openapi.yaml');
const OVERRIDES_PATH = path.join(__dirname, '../config/overrides.json');
const OUTPUT_DIR = path.join(__dirname, '../output');
const VIEWS_DIR = path.join(__dirname, 'admin/views');

// Ensure directories exist
for (const dir of [path.dirname(OVERRIDES_PATH), OUTPUT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(OVERRIDES_PATH)) fs.writeFileSync(OVERRIDES_PATH, '{}');

// Spec is loaded once at startup via @readme/openapi-parser (validates + dereferences $refs)
let cachedSpec = null;
function getSpec() {
  return cachedSpec;
}

// Overrides are hot-reloaded on every request
function getOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  // Parse, validate and dereference the OpenAPI spec at startup.
  // If the spec is invalid the server will refuse to start with a clear error.
  cachedSpec = await OpenAPIParser.dereference(OPENAPI_PATH);

  const fastify = Fastify({ logger: { level: 'info' } });

  // Form body parsing (for admin UI form submissions)
  await fastify.register(require('@fastify/formbody'));

  await fastify.register(require('@fastify/view'), {
    engine: { ejs: require('ejs') },
    root: VIEWS_DIR,
    layout: 'layout.ejs',
    propertyName: 'view',
    options: { rmWhitespace: false },
  });


  // Content-type parsing for mock API
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    try { done(null, body ? JSON.parse(body) : {}); }
    catch (err) { done(null, {}); }
  });

  // Register admin routes first (more specific paths)
  await registerAdminRoutes(fastify, { getSpec });

  // Register dynamic mock API routes from OpenAPI spec
  await registerMockRoutes(fastify, { getSpec, getOverrides });

  // Initialise DB
  getDb();

  // Start scheduler
  startScheduler(fastify.log);

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';

  await fastify.listen({ port, host });
  console.log(`\nBlaBlaBlackSheep running on http://localhost:${port}`);
  console.log(`Admin UI: http://localhost:${port}/admin\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
