// Feature flags routes — per-tenant toggle management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { featureFlags } from '../services/feature-flags.service.js';

const UpdateFlagSchema = z.object({
  enabled: z.boolean().optional(),
  rolloutPct: z.number().int().min(0).max(100).optional(),
});

export async function featureFlagRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    const ctx = req.ctx;
    if (ctx?.tenantId) featureFlags.init(ctx.tenantId);
  });

  app.get('/feature-flags', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: featureFlags.list(ctx.tenantId) });
  });

  app.get('/feature-flags/:key', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const flag = featureFlags.get(ctx.tenantId, params(req).key);
    reply.send({
      data: {
        ...flag,
        active: flag ? featureFlags.isEnabled(ctx.tenantId, flag.key, query.userId) : false,
      },
    });
  });

  app.patch('/feature-flags/:key', {
    schema: {
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          rolloutPct: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const flag = featureFlags.update(ctx.tenantId, params(req).key, UpdateFlagSchema.parse(req.body));
    if (!flag) throw AppError.notFound('Feature flag');
    reply.send({ data: flag });
  });
}
