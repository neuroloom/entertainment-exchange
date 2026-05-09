// Audit archive routes — cold storage management for old audit data
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { auditArchive } from '../services/audit-archive.service.js';
import { sharedAudit } from '../services/audit-helpers.js';

export async function auditArchiveRoutes(app: FastifyInstance) {
  app.post('/audit/archive', {
    schema: {
      body: {
        type: 'object',
        required: ['periodStart', 'periodEnd'],
        properties: {
          periodStart: { type: 'string' },
          periodEnd: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ periodStart: z.string(), periodEnd: z.string() }).parse(req.body);

    const events = sharedAudit.all(ctx.tenantId).filter((e) => {
      const d = new Date(e.createdAt);
      return d >= new Date(body.periodStart) && d <= new Date(body.periodEnd);
    });

    const bundle = auditArchive.archive(ctx.tenantId, body.periodStart, body.periodEnd, events.length);
    reply.status(201).send({ data: bundle });
  });

  app.get('/audit/archive', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: { bundles: auditArchive.listBundles(ctx.tenantId), stats: auditArchive.getStorageStats(ctx.tenantId) } });
  });

  app.delete('/audit/archive/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = auditArchive.deleteBundle(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Archive bundle');
    reply.send({ data: { deleted: true } });
  });
}
