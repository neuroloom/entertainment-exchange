// Cache admin routes — inspect and invalidate response cache
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { responseCache } from '../services/response-cache.service.js';

export async function cacheAdminRoutes(app: FastifyInstance) {
  app.get('/cache/stats', async (_req, reply) => {
    reply.send({ data: responseCache.stats() });
  });

  app.post('/cache/invalidate', {
    schema: {
      body: {
        type: 'object',
        properties: {
          prefix: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ prefix: z.string().optional() }).parse(req.body);
    const count = responseCache.invalidate(body.prefix ?? '');
    reply.send({ data: { invalidated: count } });
  });
}
