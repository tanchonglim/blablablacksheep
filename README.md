# BlaBlaBlackSheep

A self-contained Node.js mock enterprise API server with an admin UI, request history, and configurable batch export jobs.

## Features

- **Dynamic API mocking** — define endpoints in an OpenAPI 3.0 spec; routes are registered automatically at startup
- **Runtime overrides** — switch active response codes, edit response bodies, configure delays, and set regex randomization without restarting
- **Request history** — successful requests are stored in SQLite and browsable in the admin UI
- **Batch jobs** — drop a `.js` script in `scripts/` and run it manually or on a cron schedule
- **Token substitution** — use `{{uuid}}`, `{{timestamp}}`, `{{date}}`, `{{random_int}}` in response bodies
- **Regex randomization** — generate random field values matching a regex pattern on every request

## Quick Start

```bash
npm install
npm run dev     # auto-restart on file changes
# or
npm start       # production
```

Server starts on `http://localhost:3000`. Admin UI at `http://localhost:3000/admin`.

## Admin UI

| Page | URL | What you can do |
|---|---|---|
| Endpoints | `/admin/endpoints` | Switch active response code, edit response body, configure regex randomization, adjust delay |
| Requests | `/admin/requests` | Browse stored requests, filter by endpoint or status, clear all |
| Jobs | `/admin/jobs` | See all scripts and their cron schedule, trigger manually, view logs |
| Output Files | `/admin/files` | List and download generated files |

## Project Structure

```
src/
  index.js                  # Entry point — loads spec, registers routes, starts scheduler
  db/index.js               # SQLite init + schema migrations
  mock-api/
    router.js               # Registers dynamic Fastify routes from OpenAPI spec
    behavior-engine.js      # Scenario selection, token substitution, regex randomization
    request-store.js        # Persists successful requests to DB
  scheduler/
    job-manager.js          # Loads scripts/, wires up node-cron
    runner.js               # Executes a script, injects query/writeFile helpers
  admin/
    routes.js               # Admin REST API + page routes
    views/                  # EJS templates (layout, endpoints, requests, jobs, files)
config/
  openapi.yaml              # API definitions — source of truth for endpoints and default responses
  overrides.json            # Runtime overrides written by the admin UI (hot-reloaded)
scripts/                    # User-written batch job scripts (JS)
output/                     # Generated files from batch jobs
data/requests.db            # SQLite database
```

## Configuring the Mock API

Edit `config/openapi.yaml` to add or modify endpoints. The server must be restarted after spec changes.

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
            orderId: "[A-Z]{2}[0-9]{6}"   # regex — new value per request
    responses:
      "200":
        content:
          application/json:
            example:
              orderId: "{{uuid}}"          # token — substituted per request
              status: "accepted"
      "503":
        content:
          application/json:
            example:
              error: "Upstream system unavailable"
```

The **first response code** in the spec is the default. Order matters.

### Available tokens

| Token | Output |
|---|---|
| `{{uuid}}` | Random UUID v4 |
| `{{timestamp}}` | Current ISO 8601 datetime |
| `{{date}}` | Current date (`YYYY-MM-DD`) |
| `{{random_int}}` | Random integer |

### Runtime overrides

Use the admin UI to change active behavior without restarting. Changes are written to `config/overrides.json` and take effect immediately.

Override precedence (higher wins): `randomize_overrides` > `x-mock.responses[status].randomize`.

## Writing Batch Scripts

Drop a `.js` file in `scripts/`. It is loaded at startup and hot-reloaded on each manual trigger.

```javascript
module.exports = {
  name: 'Daily Orders Export',
  description: 'Exports orders from the last 24 hours to CSV',
  cron: '0 * * * *',   // cron expression, or null for manual-only

  async run(query, { writeFile, log }) {
    const rows = query(
      `SELECT * FROM requests WHERE endpoint = ? AND created_at > datetime('now', '-1 day')`,
      ['POST /api/orders']
    );

    writeFile('export.csv', rows.map(r => r.id).join('\n'));
    log(`Exported ${rows.length} rows`);
  }
};
```

Output files appear on `/admin/files` and are downloadable from there.

## Default Endpoints

The included spec (`config/openapi.yaml`) defines:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/orders` | Submit a new order |
| `GET` | `/api/orders/{orderId}` | Retrieve an order by ID |
| `POST` | `/api/customers` | Register a new customer |
| `GET` | `/api/health` | System health check |

## Dependencies

| Package | Purpose |
|---|---|
| `fastify` ^5 | HTTP server |
| `@readme/openapi-parser` | Parse + validate OpenAPI spec at startup |
| `better-sqlite3` | Synchronous SQLite access |
| `node-cron` | Cron scheduling for batch jobs |
| `randexp` | Generate random strings from regex patterns |
| `ejs` + `@fastify/view` | Server-rendered admin UI templates |
| `uuid` | UUID generation for `{{uuid}}` token |

## License

[MIT](LICENSE)
