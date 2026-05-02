'use strict';

const { resolveResponse } = require('./behavior-engine');
const { storeRequest } = require('./request-store');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

async function registerMockRoutes(fastify, { getSpec, getOverrides }) {
  fastify.addHook('onRequest', async (req) => {
    req.receivedAt = Date.now();
  });

  // Re-register routes dynamically; called once at startup
  const spec = getSpec();
  const paths = spec.paths || {};

  for (const [urlPath, pathItem] of Object.entries(paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const specEndpoint = {
        method,
        path: urlPath,
        ...operation,
        responses: operation.responses || {},
      };

      // Convert OpenAPI path params {param} → Fastify :param
      const fastifyPath = urlPath.replace(/\{(\w+)\}/g, ':$1');

      fastify[method](fastifyPath, async (req, reply) => {
        const overrides = getOverrides();
        const requestContext = {
          body: req.body,
          params: req.params,
          query: req.query,
          headers: req.headers,
        };
        const result = resolveResponse(specEndpoint, overrides, requestContext);

        if (result.delayMs > 0) {
          await new Promise(r => setTimeout(r, result.delayMs));
        }

        fastify.log.info({ headers: req.headers }, `${method.toUpperCase()} ${req.url}`);

        const latencyMs = req.receivedAt != null ? Date.now() - req.receivedAt : 0;

        if (result.storeInDb) {
          try {
            storeRequest({
              endpoint: `${method.toUpperCase()} ${urlPath}`,
              method: method.toUpperCase(),
              path: req.url,
              requestHeaders: req.headers,
              requestBody: req.body,
              responseStatus: result.status,
              responseBody: result.body,
              scenarioType: result.scenarioType,
              latencyMs,
            });
          } catch (err) {
            fastify.log.error({ err }, 'Failed to store request');
          }
        }

        reply.status(result.status).send(result.body);
      });
    }
  }
}

module.exports = { registerMockRoutes };
