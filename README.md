# BlaBlaBlackSheep

A self-contained Node.js mock enterprise API server with an admin UI, request history, and configurable batch export jobs.

## Features

- **Dynamic API mocking** — define endpoints in an OpenAPI 3.0 spec; routes are registered automatically at startup
- **Runtime overrides** — switch active response codes, edit response bodies, configure delays, and tune dynamic response fields without restarting
- **Request history** — when `store_on_success` is enabled, requests are stored in SQLite (any status) and browsable in the admin UI
- **Batch jobs** — drop a `.js` script in `scripts/` and run it manually or on a cron schedule
- **Token substitution & regex randomization** — inline `{{regex('pattern')}}` (or double quotes around the pattern when valid), then named tokens (`{{uuid}}`, times, request echoes), then field-level patterns (`x-mock.responses[status].randomize` / `randomize_overrides`) for keys listed there

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
| Endpoints | `/admin/endpoints` | Switch active response code, edit response body, adjust delay (tokens + regex are configured in the spec / overrides) |
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
    request-store.js        # Persists logged mock requests to DB (when enabled per operation)
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
              orderId: "{{uuid}}"          # token — fixed-purpose placeholder
              # or: orderId: "{{regex('[A-Z]{2}[0-9]{6}')}}"  # inline regex (single quotes inside JSON string)
              status: "accepted"
      "503":
        content:
          application/json:
            example:
              error: "Upstream system unavailable"
```

The **first response code** in the spec is the default. Order matters.

### Token substitution & regex randomization

On each request the mock updates string values in the response body in this order:

1. **`{{regex('pattern')}}`** inside that string — generates random text matching the regex. **Use single quotes around the pattern** whenever this value lives inside JSON (including the admin payload editor): `"field": "{{regex('[0-9]{4}')}}"` stays valid JSON; `"field": "{{regex("[0-9]{4}")}}"` does not. You can use `{{regex("pattern")}}` in YAML or other contexts where inner double quotes do not break parsing. Processed first so braces inside the pattern are not treated as tokens; escape with `\'` / `\"` inside the pattern only when you need quote characters there.
2. **Named tokens** — see table below (`{{uuid}}`, `{{request.*}}`, …).
3. **Field map** — each key under `x-mock.responses[status].randomize` (merged with `randomize_overrides`) replaces that field’s value again (top-level or dot paths for nested fields). **If a field name appears here, this step wins** over whatever was produced in steps 1–2 for that field.

**When to use tokens vs inline regex vs the field map**

| Need | Use |
|---|---|
| A UUID, clock time, date, or simple random integer | `{{uuid}}`, `{{timestamp}}`, `{{date}}`, `{{random_int}}` — clearer than hand-written regex |
| Echo part of the incoming request | `{{request.body.*}}`, `params`, `query`, `headers` |
| Random text matching a **custom** pattern in **one** string, possibly mixed with static text (e.g. `REF-{{regex('[0-9]{8}')}}`) | `{{regex('…')}}` in that string (JSON-safe) |
| Same pattern for a nested path (`shipping.trackingId`) or keep examples **free of** inline placeholder noise | `randomize` / `randomize_overrides` map |

**Tokens** (after inline `{{regex(...)}}` runs):

| Token | Output |
|---|---|
| `{{uuid}}` | Random UUID v4 |
| `{{timestamp}}` | Current ISO 8601 datetime |
| `{{date}}` | Current date (`YYYY-MM-DD`) |
| `{{random_int}}` | Random integer |
| `{{request.body.field}}` | Value from the request body (dot notation for nested: `{{request.body.shipping.city}}`) |
| `{{request.params.name}}` | URL path parameter (e.g. `{orderId}` → `{{request.params.orderId}}`) |
| `{{request.query.name}}` | Query string parameter |
| `{{request.headers.name}}` | Request header (lowercase name, e.g. `{{request.headers.x-api-key}}`) |

See **Configuring the Mock API** above for a `randomize:` map example next to the `200` response.

**Example** — echo back fields from the request body:

```yaml
/api/orders:
  post:
    responses:
      "200":
        content:
          application/json:
            example:
              orderId: "{{uuid}}"
              status: "accepted"
              submittedBy: "{{request.body.customerId}}"   # echoes request body field
              ref: "{{request.body.metadata.reference}}"  # nested field
```

**Example** — echo a URL path parameter in the response:

```yaml
/api/orders/{orderId}:
  get:
    responses:
      "200":
        content:
          application/json:
            example:
              orderId: "{{request.params.orderId}}"
              status: "shipped"
```

### Runtime overrides

Use the admin UI to change active behavior without restarting. Changes are written to `config/overrides.json` and take effect immediately.

Override precedence (higher wins): `randomize_overrides` > `x-mock.responses[status].randomize`. Both apply **after** inline `{{regex(...)}}` and named tokens for each field they list.

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
