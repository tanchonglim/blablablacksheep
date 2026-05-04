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

async function registerAdminRoutes(fastify, { getSpec, getSpecFiles }) {
  // ── Endpoints page ──────────────────────────────────────────────────────
  fastify.get('/api/admin/endpoints', async (req, reply) => {
    const specFiles = getSpecFiles();
    const overrides = readOverrides();

    let globalIdx = 0;
    const groups = [];

    for (const { file, spec: fileSpec } of specFiles) {
      const tagMap = new Map(); // tag -> endpoint[], preserves insertion order
      const paths = fileSpec.paths || {};

      for (const [urlPath, pathItem] of Object.entries(paths)) {
        for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
          const operation = pathItem[method];
          if (!operation) continue;
          const specEndpoint = { method, path: urlPath, ...operation, responses: operation.responses || {} };
          const cfg = buildEffectiveConfig(specEndpoint, overrides);
          const endpoint = { method: method.toUpperCase(), urlPath, operation, cfg, globalIdx: globalIdx++ };

          // Use first tag for grouping; fall back to '(untagged)'
          const tag = operation.tags?.[0] || '(untagged)';
          if (!tagMap.has(tag)) tagMap.set(tag, []);
          tagMap.get(tag).push(endpoint);
        }
      }

      // Sort tags alphabetically, keeping '(untagged)' last
      const tagGroups = [...tagMap.entries()]
        .sort(([a], [b]) => {
          if (a === '(untagged)') return 1;
          if (b === '(untagged)') return -1;
          return a.localeCompare(b);
        })
        .map(([tag, endpoints]) => ({ tag, endpoints }));

      const totalEndpoints = tagGroups.reduce((sum, tg) => sum + tg.endpoints.length, 0);
      groups.push({ file, tagGroups, totalEndpoints });
    }

    return reply.send({ groups, overrides });
  });

  // Save scenario mode + pinned status
  fastify.post('/api/admin/endpoints/mode', async (req, reply) => {
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
  fastify.post('/api/admin/endpoints/randomize', async (req, reply) => {
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
  fastify.post('/api/admin/endpoints/randomize/reset', async (req, reply) => {
    const { key, status } = req.body;
    const overrides = readOverrides();
    if (overrides[key]?.randomize_overrides) {
      delete overrides[key].randomize_overrides[status];
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // Save body override for a specific status (or specific named example within that status)
  fastify.post('/api/admin/endpoints/body', async (req, reply) => {
    const { key, status, body, example_name } = req.body;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return reply.status(400).send({ error: 'Invalid JSON body' });
    }
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    if (example_name) {
      if (!overrides[key].example_body_overrides) overrides[key].example_body_overrides = {};
      if (!overrides[key].example_body_overrides[status]) overrides[key].example_body_overrides[status] = {};
      overrides[key].example_body_overrides[status][example_name] = parsed;
    } else {
      if (!overrides[key].body_overrides) overrides[key].body_overrides = {};
      overrides[key].body_overrides[status] = parsed;
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // Reset body override for a specific status (or specific named example) to OpenAPI default
  fastify.post('/api/admin/endpoints/body/reset', async (req, reply) => {
    const { key, status, example_name } = req.body;
    const overrides = readOverrides();
    if (example_name) {
      if (overrides[key]?.example_body_overrides?.[status]) {
        delete overrides[key].example_body_overrides[status][example_name];
      }
    } else if (overrides[key]?.body_overrides) {
      delete overrides[key].body_overrides[status];
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // Pin which named example to serve for a specific status
  fastify.post('/api/admin/endpoints/example', async (req, reply) => {
    const { key, status, example_name } = req.body;
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    if (!overrides[key].example_overrides) overrides[key].example_overrides = {};
    overrides[key].example_overrides[status] = example_name;
    writeOverrides(overrides);
    return { ok: true };
  });

  // Reset example override (revert to first named example)
  fastify.post('/api/admin/endpoints/example/reset', async (req, reply) => {
    const { key, status } = req.body;
    const overrides = readOverrides();
    if (overrides[key]?.example_overrides) {
      delete overrides[key].example_overrides[status];
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // Save store_on_success override
  fastify.post('/api/admin/endpoints/store', async (req, reply) => {
    const { key, store_on_success } = req.body;
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    overrides[key].store_on_success = store_on_success !== 'false' && store_on_success !== false;
    writeOverrides(overrides);
    return { ok: true };
  });

  // Reset all overrides for an endpoint
  fastify.post('/api/admin/endpoints/reset', async (req, reply) => {
    const { key } = req.body;
    const overrides = readOverrides();
    delete overrides[key];
    writeOverrides(overrides);
    return { ok: true };
  });

  // Save delay override (fixed delay: delay_ms → min_ms === max_ms)
  fastify.post('/api/admin/endpoints/delay', async (req, reply) => {
    const { key, delay_enabled, delay_ms, min_ms, max_ms } = req.body;
    const overrides = readOverrides();
    if (!overrides[key]) overrides[key] = {};
    overrides[key].delay_enabled = delay_enabled !== 'false' && delay_enabled !== false;
    if (delay_ms !== undefined && delay_ms !== null && delay_ms !== '') {
      const ms = Math.max(0, Number(delay_ms));
      overrides[key].delay = { min_ms: ms, max_ms: ms };
    } else if (min_ms !== undefined) {
      overrides[key].delay = {
        min_ms: Number(min_ms),
        max_ms: max_ms !== undefined ? Number(max_ms) : Number(min_ms),
      };
    }
    writeOverrides(overrides);
    return { ok: true };
  });

  // ── Requests page ────────────────────────────────────────────────────────
  fastify.get('/api/admin/requests', async (req, reply) => {
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

    return reply.send({ rows, total, page: Number(page), limit, endpoint, status, endpoints });
  });

  // Delete all requests
  fastify.post('/api/admin/requests/clear', async (req, reply) => {
    getDb().prepare('DELETE FROM requests').run();
    return { ok: true };
  });

  // ── Jobs page ────────────────────────────────────────────────────────────
  fastify.get('/api/admin/jobs', async (req, reply) => {
    const db = getDb();
    const scripts = loadScripts();
    const runs = db.prepare('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 100').all();
    return reply.send({ scripts, runs });
  });

  // Manual trigger (returns JSON; UI reloads after)
  fastify.post('/api/admin/jobs/trigger', async (req, reply) => {
    const { file } = req.body;
    const scripts = loadScripts();
    const script = scripts.find(s => s.file === file);
    if (!script) return reply.status(404).send({ error: 'Script not found' });
    const result = await runScript(script.path, 'manual');
    return { ok: result.success, logs: result.logs, error: result.error || null, runId: result.runId };
  });

  // Delete all jobs history
  fastify.post('/api/admin/jobs/clear', async (req, reply) => {
    getDb().prepare('DELETE FROM job_runs').run();
    return { ok: true };
  });

  // ── Output files page ────────────────────────────────────────────────────
  fastify.get('/api/admin/files', async (req, reply) => {
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
    return reply.send({ files });
  });

  // Download output file
  fastify.get('/api/admin/files/download/:filename', async (req, reply) => {
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
