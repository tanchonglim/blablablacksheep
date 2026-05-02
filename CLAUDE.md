# BlaBlaBlackSheep — Mock Enterprise System

A self-contained Node.js server that mocks an enterprise API, stores request history in SQLite, and runs configurable batch export jobs.

## Commands

```bash
npm start          # production
npm run dev        # auto-restart on file changes (node --watch)
```

Server starts on `http://localhost:3000`. Admin UI at `http://localhost:3000/admin`.

## Architecture

```
src/
  index.js                  # Entry point — loads spec, registers routes, starts scheduler
  db/index.js               # SQLite init + schema migrations
  mock-api/
    router.js               # Registers dynamic Fastify routes from OpenAPI spec
    behavior-engine.js      # Scenario selection, token substitution, regex randomization
    request-store.js        # Persists logged mock requests to DB (when enabled per operation)
  scheduler/
    job-manager.js          # Loads scripts/, wires up node-cron
    runner.js               # Executes a script, injects query/writeFile helpers
  admin/
    routes.js               # Admin REST API + page routes
    views/                  # EJS templates (layout, endpoints, requests, jobs, files)
config/
  openapi/                  # One or more .yaml/.yml spec files (merged at startup)
    openapi.yaml            # Default spec — source of truth for endpoints and default responses
  overrides.json            # Runtime overrides written by the admin UI (hot-reloaded)
scripts/                    # User-written batch job scripts (JS)
output/                     # Generated files from batch jobs
data/requests.db            # SQLite database
```

## How the mock API works

1. All `.yaml`/`.yml` files in `config/openapi/` are parsed and merged at startup with `@readme/openapi-parser`. If any file is invalid, the server refuses to start.
2. Every HTTP path/method in the spec gets a Fastify route registered automatically.
3. On each request, `config/overrides.json` is read from disk (hot-reload — no restart needed).
4. The **behavior engine** resolves the response:
   - **Default mode**: returns the first response code defined in the spec.
   - **Pinned mode**: always returns a specific status code (set via admin UI).
5. **Token substitution & regex randomization** on the response body (in this order): each string value expands **`{{regex('pattern')}}`** (preferred in JSON; **`{{regex("pattern")}}`** when quoting allows) first (RandExp), then named tokens (`{{uuid}}`, `{{timestamp}}`, `{{date}}`, `{{random_int}}`, plus `{{request.body.*}}`, `params`, `query`, `headers`); then fields listed under `x-mock.responses[status].randomize` (merged with `randomize_overrides`) are replaced again with `RandExp` — map keys win over inline/text for those fields.
6. If `store_on_success: true` for the operation, the request is written to the `requests` table for **any** response status (2xx and errors), so the Logs UI shows failures too.

## OpenAPI spec format

Standard OpenAPI 3.0.3 plus an `x-mock` extension block per operation:

```yaml
/api/orders:
  post:
    x-mock:
      store_on_success: true
      delay:
        min_ms: 30
        max_ms: 120
      responses:
        "200":
          randomize:
            orderId: "[A-Z]{2}[0-9]{6}"         # regex — top-level field
            "shipping.trackingId": "[0-9]{12}"   # dot notation — nested field
    responses:
      "200":
        content:
          application/json:
            # Singular example (one body per status code)
            example:
              orderId: "{{uuid}}"          # or "{{regex('[A-Z]{2}[0-9]{6}')}}" for inline regex (single-quoted pattern)
              status: "accepted"
              shipping:
                trackingId: "000000000000"
            # — OR — named examples (multiple bodies per status code; selectable in admin UI)
            examples:
              standard:
                summary: Standard delivery
                value:
                  orderId: "{{uuid}}"
                  status: "accepted"
                  delivery: standard
              express:
                summary: Express delivery
                value:
                  orderId: "{{uuid}}"
                  status: "accepted"
                  delivery: express
      "400":
        content:
          application/json:
            example:
              error: "Invalid payload"
```

The **first response code** in the spec is the default. Order matters.

When using **named examples**, the first example is served by default. Select a different example in the admin UI (Endpoints page) — the selection is saved to `overrides.json`.

## overrides.json format

Written and read by the admin UI. Do not edit manually while the server is running — changes are overwritten by the UI.

```json
{
  "POST /api/orders": {
    "mode": "pinned",
    "pinned_status": "503",
    "delay_enabled": true,
    "delay": { "min_ms": 500, "max_ms": 1000 },
    "body_overrides": {
      "200": { "orderId": "FIXED-001", "status": "accepted" }
    },
    "randomize_overrides": {
      "200": { "orderId": "[A-Z]{3}[0-9]{5}" }
    },
    "example_overrides": {
      "200": "express"
    }
  }
}
```

Override precedence (higher wins): `randomize_overrides` > `x-mock.responses[status].randomize`. Same for body and delay. Field-map randomization runs after inline `{{regex(...)}}` and named tokens for keys listed in the map.

`example_overrides` pins which named example is served for a status code. Ignored when `body_overrides` is set for the same status (manual edit wins).

## Database schema

**`requests`** — one row per stored API call
```
id, endpoint, method, path, request_headers, request_body,
response_status, response_body, scenario_type, latency_ms, created_at
```

`scenario_type` is `success` (2xx) or `error` (non-2xx). `latency_ms` is round-trip handling time in milliseconds (includes configured mock delay).

**`job_runs`** — one row per batch job execution
```
id, script_name, triggered_by, status, output_files, logs, error,
started_at, finished_at
```

`triggered_by` is `"manual"` or `"cron"`. `status` is `"running"`, `"success"`, or `"error"`.

## Writing batch scripts

Drop a `.js` file in `scripts/`. It is loaded at startup and hot-reloaded on each manual trigger. Required export shape:

```javascript
module.exports = {
  name: 'My Export',            // display name in admin UI
  description: 'What it does', // optional
  cron: '0 * * * *',           // cron expression, or null for manual-only

  async run(query, { writeFile, writeFileTo, outputDir, log }) {
    // query(sql, [params]) — returns array of rows (better-sqlite3 .all())
    const rows = query(
      `SELECT * FROM requests WHERE endpoint = ? AND created_at > datetime('now', '-1 day')`,
      ['POST /api/orders']
    );

    // writeFile(filename, content) — writes to output/ directory
    writeFile('export.csv', rows.map(r => r.id).join('\n'));

    // writeFileTo(absolutePath, content) — writes to any path on the filesystem
    writeFileTo('/tmp/reports/export.csv', content);

    log(`Exported ${rows.length} rows`);
  }
};
```

Output files appear on `/admin/files` and are downloadable from there.

## Admin UI pages

| Page | URL | What you can do |
|---|---|---|
| Endpoints | `/admin/endpoints` | Switch active response code, edit response body, configure regex randomization, adjust delay |
| Requests | `/admin/requests` | Browse stored requests, filter by endpoint or status, clear all |
| Jobs | `/admin/jobs` | See all scripts and their cron schedule, trigger manually, view logs |
| Output Files | `/admin/files` | List and download generated files |

## Key dependencies

| Package | Purpose |
|---|---|
| `fastify` ^5 | HTTP server |
| `@readme/openapi-parser` | Parse + validate OpenAPI spec at startup |
| `better-sqlite3` | Synchronous SQLite access |
| `node-cron` | Cron scheduling for batch jobs |
| `randexp` | Generate random strings from regex patterns |
| `ejs` + `@fastify/view` | Server-rendered admin UI templates |
| `uuid` | UUID generation for `{{uuid}}` token |

## Modifying the spec vs. overrides

- **Add/remove endpoints or change default responses** → edit `config/openapi.yaml`, restart the server.
- **Change active response, body, randomization, or delay at runtime** → use the admin UI (writes to `overrides.json`, takes effect immediately).
