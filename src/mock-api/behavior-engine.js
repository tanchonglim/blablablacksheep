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

// Apply regex-based randomization to top-level fields of a body object.
// randomizeMap: { fieldName: regexString }
// Returns a new object; non-matching keys are left unchanged.
function applyRandomize(body, randomizeMap) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (!randomizeMap || Object.keys(randomizeMap).length === 0) return body;

  const result = { ...body };
  for (const [field, pattern] of Object.entries(randomizeMap)) {
    if (pattern && typeof pattern === 'string') {
      try {
        result[field] = new RandExp(pattern).gen();
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
    //   examples: { default: { value: { ... } } } (named examples — OpenAPI 3.0.x / 3.1.x)
    const contentEntry = respDef.content ? Object.values(respDef.content)[0] : null;
    let defaultBody = contentEntry?.example ?? null;
    if (defaultBody === null && contentEntry?.examples) {
      const firstExample = Object.values(contentEntry.examples)[0];
      defaultBody = firstExample?.value ?? null;
    }

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
