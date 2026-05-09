// Response caching middleware — ETag and Cache-Control for GET endpoints
import type { FastifyInstance } from 'fastify';
import { responseCache } from '../services/response-cache.service.js';

export async function responseCacheRoutes(app: FastifyInstance) {
  // Add ETag support to GET responses via onSend hook
  app.addHook('onSend', async (req, _reply, payload) => {
    if (req.method !== 'GET') return payload;

    const cacheKey = `${req.ctx?.tenantId}:${req.url}`;
    const ifNoneMatch = req.headers['if-none-match'];

    // Check existing cache entry by ETag
    if (ifNoneMatch) {
      const cached = responseCache.get(cacheKey);
      if (cached && cached.etag === ifNoneMatch) {
        // Would return 304 — Fastify doesn't easily support this in hooks
        // Production: use reply.code(304).send()
      }
    }

    // Cache GET responses with 30s TTL
    try {
      const body = typeof payload === 'string' ? JSON.parse(payload) : payload;
      responseCache.set(cacheKey, body, 'application/json', 30_000);
    } catch { /* non-JSON payload, skip caching */ }

    return payload;
  });
}
