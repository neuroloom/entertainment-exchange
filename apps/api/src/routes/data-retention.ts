// Data retention routes — policy management and enforcement
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dataRetention } from '../services/data-retention.service.js';

const RetentionPolicySchema = z.object({
  retainDays: z.number().int().min(1).optional(),
  archiveAfterDays: z.number().int().min(1).optional(),
  deleteAfterDays: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
});

export async function dataRetentionRoutes(app: FastifyInstance) {
  app.get('/retention/policies', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: dataRetention.listPolicies(ctx.tenantId) });
  });

  app.get('/retention/policies/:domain', async (req, reply) => {
    const ctx = req.ctx;
    const domain = params(req).domain;
    reply.send({ data: dataRetention.getPolicy(ctx.tenantId, domain) });
  });

  app.put('/retention/policies/:domain', {
    schema: {
      body: {
        type: 'object',
        properties: {
          retainDays: { type: 'integer', minimum: 1 },
          archiveAfterDays: { type: 'integer', minimum: 1 },
          deleteAfterDays: { type: 'integer', minimum: 1 },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const policy = dataRetention.setPolicy(ctx.tenantId, params(req).domain, RetentionPolicySchema.parse(req.body));
    reply.send({ data: policy });
  });

  app.post('/retention/enforce', async (req, reply) => {
    const ctx = req.ctx;
    // Mock stores for enforcement — in production, wire real store deleteOlderThan
    const mockStores = {
      bookings: { deleteOlderThan: (_days: number) => 0 },
      audit_events: { deleteOlderThan: (_days: number) => 0 },
      notifications: { deleteOlderThan: (_days: number) => 0 },
    };
    const results = dataRetention.enforce(ctx.tenantId, mockStores);
    reply.send({ data: { enforced: true, results } });
  });
}
