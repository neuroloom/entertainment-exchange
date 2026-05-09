// Rate limit configuration routes — per-tenant rate limit management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantRateLimits } from '../services/tenant-rate-limit.service.js';

export async function rateLimitConfigRoutes(app: FastifyInstance) {
  app.get('/rate-limits', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: tenantRateLimits.get(ctx.tenantId) });
  });

  app.get('/rate-limits/plans', async (_req, reply) => {
    reply.send({ data: tenantRateLimits.getPlanDefaults() });
  });

  app.put('/rate-limits', {
    schema: {
      body: {
        type: 'object',
        properties: {
          requestsPerMinute: { type: 'integer', minimum: 1 },
          requestsPerHour: { type: 'integer', minimum: 1 },
          burstMultiplier: { type: 'number', minimum: 1 },
          exemptEndpoints: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({
      requestsPerMinute: z.number().int().min(1).optional(),
      requestsPerHour: z.number().int().min(1).optional(),
      burstMultiplier: z.number().min(1).optional(),
      exemptEndpoints: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    }).parse(req.body);
    const config = tenantRateLimits.setOverride(ctx.tenantId, body);
    reply.send({ data: config });
  });

  app.delete('/rate-limits', async (req, reply) => {
    const ctx = req.ctx;
    tenantRateLimits.clearOverride(ctx.tenantId);
    reply.send({ data: { reset: true, defaults: tenantRateLimits.get(ctx.tenantId) } });
  });

  app.put('/rate-limits/plan', {
    schema: {
      body: {
        type: 'object',
        required: ['plan'],
        properties: {
          plan: { type: 'string', enum: ['starter', 'pro', 'enterprise'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ plan: z.enum(['starter', 'pro', 'enterprise']) }).parse(req.body);
    tenantRateLimits.setPlan(ctx.tenantId, body.plan);
    reply.send({ data: tenantRateLimits.get(ctx.tenantId) });
  });
}
