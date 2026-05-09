// Cache warmer routes — pre-populate caches
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cacheWarmer } from '../services/cache-warmer.service.js';

const CacheWarmRuleSchema = z.object({
  path: z.string().min(1),
  ttlMs: z.number().int().min(1000).optional(),
  priority: z.number().int().min(1).max(10).optional(),
});

export async function cacheWarmerRoutes(app: FastifyInstance) {
  app.post('/cache/warm-rules', {
    schema: {
      body: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
          ttlMs: { type: 'integer', minimum: 1000 },
          priority: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CacheWarmRuleSchema.parse(req.body);
    const rule = cacheWarmer.addRule(ctx.tenantId, body.path, body.ttlMs ?? 30_000, body.priority ?? 1);
    reply.status(201).send({ data: rule });
  });

  app.get('/cache/warm-rules', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: { rules: cacheWarmer.listRules(ctx.tenantId), due: cacheWarmer.getDueWarms(ctx.tenantId) } });
  });

  app.get('/cache/warm-recommendations', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: cacheWarmer.getRecommendedRules(ctx.tenantId) });
  });

  app.delete('/cache/warm-rules/:path', async (req, reply) => {
    const ctx = req.ctx;
    cacheWarmer.removeRule(ctx.tenantId, decodeURIComponent(params(req).path));
    reply.send({ data: { deleted: true } });
  });

  app.post('/cache/warm', async (req, reply) => {
    const ctx = req.ctx;
    const due = cacheWarmer.getDueWarms(ctx.tenantId);
    for (const r of due) cacheWarmer.recordWarm(ctx.tenantId, r.path);
    reply.send({ data: { warmed: due.length, paths: due.map(r => r.path) } });
  });
}
