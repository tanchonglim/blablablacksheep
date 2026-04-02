'use strict';

const { v4: uuidv4 } = require('uuid');
const RandExp = require('randexp');

// Token substitution in response bodies
function substituteTokens(value) {
  if (typeof value === 'string') {
    return value
      .replace(/\{\{uuid\}\}/g, () => uuidv4())
      .replace(/\{\{timestamp\}\}/g, () => new Date().toISOString())
      .replace(/\{\{random_int\}\}/g, () => String(Math.floor(Math.random() * 100000)))
      .replace(/\{\{date\}\}/g, () => new Date().toISOString().slice(0, 10));
  }
  if (Array.isArray(value)) return value.map(substituteTokens);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) result[k] = substituteTokens(v);
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
    // Resolve default body from OpenAPI example
    const contentEntry = respDef.content ? Object.values(respDef.content)[0] : null;
    const defaultBody = contentEntry?.example ?? null;

    // Override body from admin UI
    const bodyOverride = override.body_overrides?.[status];
    const body = bodyOverride !== undefined ? bodyOverride : defaultBody;

    // Randomize config: spec level merged with override (override wins per-field)
    const specRandomize = xMock.responses?.[status]?.randomize ?? {};
    const overrideRandomize = override.randomize_overrides?.[status] ?? {};
    const randomize = { ...specRandomize, ...overrideRandomize };

    return {
      status: parseInt(status, 10),
      statusStr: status,
      body,
      description: respDef.description || '',
      randomize,
      hasSpecRandomize: Object.keys(specRandomize).length > 0,
      hasOverrideRandomize: Object.keys(overrideRandomize).length > 0,
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
    storeOnSuccess: xMock.store_on_success ?? false,
    delay,
    mode: override.mode || 'default',
    pinnedStatus: override.pinned_status || null,
    scenarios,
  };
}

// Select a scenario and resolve its response
function resolveResponse(specEndpoint, overrides) {
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

  // Token substitution then regex randomization
  let body = substituteTokens(scenario.body);
  body = applyRandomize(body, scenario.randomize);

  const isSuccess = scenario.status >= 200 && scenario.status < 300;

  return {
    status: scenario.status,
    body,
    delayMs,
    storeInDb: isSuccess && cfg.storeOnSuccess,
    scenarioType: isSuccess ? 'success' : 'error',
  };
}

module.exports = { resolveResponse, buildEffectiveConfig, applyRandomize };
