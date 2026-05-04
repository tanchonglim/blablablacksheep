'use strict';

const { v4: uuidv4 } = require('uuid');
const RandExp = require('randexp');

// Retrieve a value from an object using dot-notation path (e.g. "shipping.address.city").
// Returns undefined if any intermediate key is missing.
function getNestedValue(obj, path) {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function unescapeRegexPlaceholderInner(inner) {
  return inner.replace(/\\(.)/g, (_, ch) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    return ch;
  });
}

// Inline regex randomization: {{regex('pattern')}} (preferred inside JSON) or {{regex("pattern")}}.
// Single-quoted form avoids breaking JSON.parse when the placeholder sits in a JSON "string" value.
// Runs before named tokens so brace-heavy patterns are not mistaken for {{uuid}} / {{request.*}}.
function expandRegexPlaceholdersInString(str) {
  if (typeof str !== 'string') return str;
  const replaceQuoted = (s, quote) => {
    const re = quote === '"'
      ? /\{\{regex\(\s*"((?:[^"\\]|\\.)*)"\s*\)\}\}/g
      : /\{\{regex\(\s*'((?:[^'\\]|\\.)*)'\s*\)\}\}/g;
    return s.replace(re, (full, inner) => {
      const pattern = unescapeRegexPlaceholderInner(inner);
      try {
        return new RandExp(pattern).gen();
      } catch {
        return full;
      }
    });
  };
  let out = replaceQuoted(str, "'");
  out = replaceQuoted(out, '"');
  return out;
}

// Token substitution in response bodies.
// Order per string: (1) {{regex('…')}} / {{regex("…")}}, (2) built-in tokens, (3) {{request.*}} .
// requestContext (optional): { body, params, query, headers }
// Supported dynamic tokens (in addition to built-ins):
//   {{request.body.field}}        — value from request body (dot notation for nested)
//   {{request.params.paramName}}  — URL path parameter
//   {{request.query.paramName}}   — query string parameter
//   {{request.headers.headerName}} — request header (lowercase name)
function substituteTokens(value, requestContext) {
  if (typeof value === 'string') {
    return expandRegexPlaceholdersInString(value)
      .replace(/\{\{uuid\}\}/g, () => uuidv4())
      .replace(/\{\{timestamp\}\}/g, () => new Date().toISOString())
      .replace(/\{\{random_int\}\}/g, () => String(Math.floor(Math.random() * 100000)))
      .replace(/\{\{date\}\}/g, () => new Date().toISOString().slice(0, 10))
      .replace(/\{\{request\.(body|params|query|headers)\.([^}]+)\}\}/g, (_match, source, path) => {
        if (!requestContext) return '';
        const val = getNestedValue(requestContext[source], path);
        return val == null ? '' : String(val);
      });
  }
  if (Array.isArray(value)) return value.map(v => substituteTokens(v, requestContext));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) result[k] = substituteTokens(v, requestContext);
    return result;
  }
  return value;
}

// Set a value at a dot-notation path within an object (mutates obj in place).
// Silently does nothing if an intermediate key is missing or not an object.
function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === null || typeof current[part] !== 'object') return;
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

// Apply regex-based randomization to fields of a body object.
// randomizeMap: { fieldName: regexString }
// fieldName may use dot notation to target nested fields (e.g. "data.orderId").
// Returns a new object; non-matching keys are left unchanged.
function applyRandomize(body, randomizeMap) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (!randomizeMap || Object.keys(randomizeMap).length === 0) return body;

  const result = JSON.parse(JSON.stringify(body));
  for (const [field, pattern] of Object.entries(randomizeMap)) {
    if (pattern && typeof pattern === 'string') {
      try {
        const generated = new RandExp(pattern).gen();
        if (field.includes('.')) {
          setNestedValue(result, field, generated);
        } else {
          result[field] = generated;
        }
      } catch {
        // Invalid regex — leave field unchanged
      }
    }
  }
  return result;
}

// Build the effective config for an endpoint by merging spec + overrides
function buildEffectiveConfig(specEndpoint, overrides) {
  const key = `${specEndpoint.method.toUpperCase()} ${specEndpoint.path}`;
  const override = overrides[key] || {};
  const xMock = specEndpoint['x-mock'] || {};

  // Build scenarios list from OpenAPI responses (order preserved = spec order)
  const scenarios = Object.entries(specEndpoint.responses || {}).map(([status, respDef]) => {
    // Resolve default body from OpenAPI example.
    // Supports both formats:
    //   example: { ... }                          (singular — OpenAPI 3.0.x)
    //   examples: { name: { value: { ... } } }    (named examples — OpenAPI 3.0.x / 3.1.x)
    const contentEntry = respDef.content ? Object.values(respDef.content)[0] : null;

    // Collect all named examples for this status code
    const examples = contentEntry?.examples
      ? Object.entries(contentEntry.examples).map(([name, ex]) => ({
          name,
          value: ex?.value ?? null,
          summary: ex?.summary || name,
        }))
      : [];

    // Determine which named example is active (via override, else first)
    const exampleOverrideName = override.example_overrides?.[status] || null;
    const selectedExampleName = exampleOverrideName && examples.some(e => e.name === exampleOverrideName)
      ? exampleOverrideName
      : (examples.length > 0 ? examples[0].name : null);

    // Resolve default body: singular example > selected named example
    let defaultBody = contentEntry?.example ?? null;
    if (defaultBody === null && examples.length > 0) {
      const selectedEx = examples.find(e => e.name === selectedExampleName) || examples[0];
      defaultBody = selectedEx.value;
    }

    // Override body from admin UI (takes priority over everything)
    // For named examples, check per-example override first; fall back to status-level override
    let bodyOverride;
    if (examples.length > 0 && selectedExampleName) {
      bodyOverride = override.example_body_overrides?.[status]?.[selectedExampleName];
    }
    if (bodyOverride === undefined) {
      bodyOverride = override.body_overrides?.[status];
    }
    const body = bodyOverride !== undefined ? bodyOverride : defaultBody;

    // Randomize config: spec level merged with override (override wins per-field)
    const specRandomize = xMock.responses?.[status]?.randomize ?? {};
    const overrideRandomize = override.randomize_overrides?.[status] ?? {};
    const randomize = { ...specRandomize, ...overrideRandomize };

    return {
      status: parseInt(status, 10),
      statusStr: status,
      body,
      defaultBody,
      description: respDef.description || '',
      randomize,
      hasSpecRandomize: Object.keys(specRandomize).length > 0,
      hasOverrideRandomize: Object.keys(overrideRandomize).length > 0,
      examples,
      selectedExample: selectedExampleName,
      hasExampleOverride: !!exampleOverrideName,
    };
  });

  const delay = Object.assign(
    { min_ms: 0, max_ms: 0 },
    xMock.delay || {},
    override.delay_enabled === false ? { min_ms: 0, max_ms: 0 } : {},
    override.delay || {}
  );

  return {
    key,
    storeOnSuccess: override.store_on_success ?? xMock.store_on_success ?? true,
    delay,
    mode: override.mode || 'default',
    pinnedStatus: override.pinned_status || null,
    scenarios,
  };
}

// Select a scenario and resolve its response
// requestContext (optional): { body, params, query, headers } — forwarded to token substitution
function resolveResponse(specEndpoint, overrides, requestContext) {
  const cfg = buildEffectiveConfig(specEndpoint, overrides);

  let scenario;
  if (cfg.mode === 'pinned' && cfg.pinnedStatus) {
    scenario = cfg.scenarios.find(s => s.statusStr === cfg.pinnedStatus) || cfg.scenarios[0];
  } else {
    // Default: always return the first response code defined in the spec
    scenario = cfg.scenarios[0];
  }

  // Apply delay
  const delayMs = cfg.delay.max_ms > 0
    ? cfg.delay.min_ms + Math.floor(Math.random() * (cfg.delay.max_ms - cfg.delay.min_ms + 1))
    : 0;

  // Inline {{regex('…')}} / {{regex("…")}} + named tokens, then field-map randomization (map overwrites listed keys)
  let body = substituteTokens(scenario.body, requestContext);
  body = applyRandomize(body, scenario.randomize);

  const isSuccess = scenario.status >= 200 && scenario.status < 300;

  return {
    status: scenario.status,
    body,
    delayMs,
    storeInDb: cfg.storeOnSuccess,
    scenarioType: isSuccess ? 'success' : 'error',
  };
}

module.exports = { resolveResponse, buildEffectiveConfig, applyRandomize };
