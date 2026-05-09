// Tenant quarantine routes — security isolation management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { tenantQuarantine } from '../services/tenant-quarantine.service.js';

const QuarantineSchema = z.object({
  tenantId: z.string(),
  reason: z.string().min(1),
  suspend: z.boolean().optional(),
});

export async function quarantineRoutes(app: FastifyInstance) {
  app.get('/admin/quarantine', async (_req, reply) => {
    reply.send({ data: tenantQuarantine.listAll() });
  });

  app.post('/admin/quarantine', {
    schema: {
      body: {
        type: 'object',
        required: ['tenantId', 'reason'],
        properties: {
          tenantId: { type: 'string' },
          reason: { type: 'string', minLength: 1 },
          suspend: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = QuarantineSchema.parse(req.body);
    const r = body.suspend
      ? tenantQuarantine.suspend(body.tenantId, body.reason, ctx.actor.id)
      : tenantQuarantine.quarantine(body.tenantId, body.reason, ctx.actor.id);
    reply.status(201).send({ data: r });
  });

  app.post('/admin/quarantine/:tenantId/lift', async (req, reply) => {
    const ctx = req.ctx;
    const r = tenantQuarantine.lift(params(req).tenantId, ctx.actor.id);
    if (!r) throw AppError.notFound('Quarantined tenant');
    reply.send({ data: r });
  });

  app.get('/admin/quarantine/:tenantId/status', async (req, reply) => {
    reply.send({ data: tenantQuarantine.getStatus(params(req).tenantId) });
  });
}
