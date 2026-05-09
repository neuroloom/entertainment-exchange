// Data archival routes — retention policy management and archival execution
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { archivalService } from '../services/archival.service.js';
import type { Booking } from './booking.js';

const ArchivalPolicySchema = z.object({
  bookingRetentionDays: z.number().int().min(1).optional(),
  auditRetentionDays: z.number().int().min(1).optional(),
  autoArchiveEnabled: z.boolean().optional(),
});
import { bookings } from './booking.js';
import { sharedAudit } from '../services/audit-helpers.js';

// Shared audit store access — same instance used across routes


export async function archivalRoutes(app: FastifyInstance) {
  app.get('/archival/policy', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: archivalService.getPolicy(ctx.tenantId) });
  });

  app.put('/archival/policy', {
    schema: {
      body: {
        type: 'object',
        properties: {
          bookingRetentionDays: { type: 'integer', minimum: 1 },
          auditRetentionDays: { type: 'integer', minimum: 1 },
          autoArchiveEnabled: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const policy = archivalService.setPolicy(ctx.tenantId, ArchivalPolicySchema.parse(req.body));
    reply.send({ data: policy });
  });

  app.post('/archival/run', async (req, reply) => {
    const ctx = req.ctx;
    const report = archivalService.runArchival(ctx.tenantId, {
      bookings: {
        all: (tid: string) => bookings.all(tid) as unknown as Record<string, unknown>[],
        set: (item: Record<string, unknown>) => { bookings.set(item as unknown as Booking); },
      },
      auditEvents: { all: (tid: string) => sharedAudit.all(tid) as unknown as Record<string, unknown>[] },
    });
    reply.send({ data: report });
  });

  app.get('/archival/reports', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: archivalService.getReports(ctx.tenantId) });
  });

  app.get('/archival/reports/latest', async (req, reply) => {
    const ctx = req.ctx;
    const report = archivalService.getLastReport(ctx.tenantId);
    reply.send({ data: report ?? { message: 'No archival run yet' } });
  });
}
