'use strict';

const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { loadScripts } = require('../scheduler/job-manager');
const { runScript } = require('../scheduler/runner');
const { buildEffectiveConfig } = require('../mock-api/behavior-engine');

const OVERRIDES_PATH = path.join(__dirname, '../../config/overrides.json');
const OUTPUT_DIR = path.join(__dirname, '../../output');

function readOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeOverrides(data) {
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function registerAdminRoutes(fastify, { getSpec }) {
  // ── Endpoints page ──────────────────────────────────────────────────────
  fastify.get('/admin/endpoints', async (req, reply) => {
    const spec = getSpec();
    const overrides = readOverrides();
    const paths = spec.paths || {};

    const endpoints = [];
    for (const [urlPath, pathItem] of Object.entries(paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = pathItem[method];
        if (!operation) continue;
        const specEndpoint = { method, path: urlPath, ...operation, responses: operation.responses || {} };
        const cfg = buildEffectiveConfig(specEndpoint, overrides);
        endpoints.push({ method: method.toUpperCase(), urlPath, operation, cfg });
      }
    }

    return reply.view('endpoints.ejs', { endpoints, overrides });
  });

  // Save scenario mode + pinned status
  fastify.post('/admin/endpoints/mode', async (req, reply) => {
    const { key, mode, pinned_status } = req.body;
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    overrides[key].mode = mode;
    if (mode === 'pinned' && pinned_status) {
      overrides[key].pinned_status = pinned_status;
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // Save randomize overrides for a specific status
  fastify.post('/admin/endpoints/randomize', async (req, reply) => {
    const { key, status, patterns } = req.body;
    // patterns is a JSON string of { fieldName: regexStr }
    let parsed;
    try {
      parsed = typeof patterns === 'string' ? JSON.parse(patterns) : patterns;
    } catch {
      return reply.status(400).send({ error: 'Invalid patterns JSON' });
    }
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    if (!overrides[key].randomize_overrides) overrides[key].randomize_overrides = {};
    overrides[key].randomize_overrides[status] = parsed;
    writeOverrides(overrides);
    return { ok: true };
  });

  // Reset randomize overrides for a specific status
  fastify.post('/admin/endpoints/randomize/reset', async (req, reply) => {
    const { key, status } = req.body;
    const overrides = readOverrides();
    if (overrides[key]?.randomize_overrides) {
      delete overrides[key].randomize_overrides[status];
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // Save body override for a specific status
  fastify.post('/admin/endpoints/body', async (req, reply) => {
    const { key, status, body } = req.body;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return reply.status(400).send({ error: 'Invalid JSON body' });
    }
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    if (!overrides[key].body_overrides) overrides[key].body_overrides = {};
    overrides[key].body_overrides[status] = parsed;
    writeOverrides(overrides);
    return { ok: true };
  });

  // Reset body override for a specific status to OpenAPI default
  fastify.post('/admin/endpoints/body/reset', async (req, reply) => {
    const { key, status } = req.body;
    const overrides = readOverrides();
    if (overrides[key]?.body_overrides) {
      delete overrides[key].body_overrides[status];
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // Reset all overrides for an endpoint
  fastify.post('/admin/endpoints/reset', async (req, reply) => {
    const { key } = req.body;
    const overrides = readOverrides();
    delete overrides[key];
    writeOverrides(overrides);
    return { ok: true };
  });

  // Save delay override
  fastify.post('/admin/endpoints/delay', async (req, reply) => {
    const { key, delay_enabled, min_ms, max_ms } = req.body;
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    overrides[key].delay_enabled = delay_enabled !== 'false' && delay_enabled !== false;
    if (min_ms !== undefined) overrides[key].delay = { min_ms: Number(min_ms), max_ms: Number(max_ms) };
    writeOverrides(overrides);
    return { ok: true };
  });

  // ── Requests page ────────────────────────────────────────────────────────
  fastify.get('/admin/requests', async (req, reply) => {
    const db = getDb();
    const { endpoint, status, page = 1 } = req.query;
    const limit = 50;
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];
    if (endpoint) { where += ' AND endpoint = ?'; params.push(endpoint); }
    if (status) { where += ' AND response_status = ?'; params.push(status); }

    const rows = db.prepare(`SELECT * FROM requests WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM requests WHERE ${where}`).get(...params).count;
    const endpoints = db.prepare('SELECT DISTINCT endpoint FROM requests ORDER BY endpoint').all().map(r => r.endpoint);

    return reply.view('requests.ejs', { rows, total, page: Number(page), limit, endpoint, status, endpoints });
  });

  // Delete all requests
  fastify.post('/admin/requests/clear', async (req, reply) => {
    getDb().prepare('DELETE FROM requests').run();
    return { ok: true };
  });

  // ── Jobs page ────────────────────────────────────────────────────────────
  fastify.get('/admin/jobs', async (req, reply) => {
    const db = getDb();
    const scripts = loadScripts();
    const runs = db.prepare('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 100').all();
    return reply.view('jobs.ejs', { scripts, runs });
  });

  // Manual trigger (returns JSON; UI reloads after)
  fastify.post('/admin/jobs/trigger', async (req, reply) => {
    const { file } = req.body;
    const scripts = loadScripts();
    const script = scripts.find(s => s.file === file);
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    const result = await runScript(script.path, 'manual');
    return { ok: result.success, logs: result.logs, error: result.error || null, runId: result.runId };
  });

  // ── Output files page ────────────────────────────────────────────────────
  fastify.get('/admin/files', async (req, reply) => {
    let files = [];
    if (fs.existsSync(OUTPUT_DIR)) {
      files = fs.readdirSync(OUTPUT_DIR)
        .filter(f => !f.startsWith('.'))
        .map(f => {
          const stat = fs.statSync(path.join(OUTPUT_DIR, f));
          return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
    }
    return reply.view('files.ejs', { files });
  });

  // Download output file
  fastify.get('/admin/files/download/:filename', async (req, reply) => {
    // Prevent path traversal
    const filename = path.basename(req.params.filename);
    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) return reply.status(404).send('Not found');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(fs.createReadStream(filePath));
  });

  // ── Redirect root to admin ───────────────────────────────────────────────
  fastify.get('/', async (req, reply) => reply.redirect('/admin/endpoints'));
  fastify.get('/admin', async (req, reply) => reply.redirect('/admin/endpoints'));
}

module.exports = { registerAdminRoutes };
