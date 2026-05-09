// Audit report routes — generate structured reports from audit event data
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateAuditReport } from '../services/audit-report.service.js';
import { sharedAudit } from '../services/audit-helpers.js';

const AuditReportSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  domains: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
});

export async function auditReportRoutes(app: FastifyInstance) {
  app.post('/audit/report', {
    schema: {
      body: {
        type: 'object',
        properties: {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          domains: { type: 'array', items: { type: 'string' } },
          actions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = AuditReportSchema.parse(req.body);

    const events = sharedAudit.all(ctx.tenantId).map((e) => ({
      action: e.action,
      resourceType: e.resourceType,
      actorId: e.actorId,
      createdAt: e.createdAt,
    }));

    const report = generateAuditReport(events, {
      tenantId: ctx.tenantId,
      startDate: body.startDate,
      endDate: body.endDate,
      domains: body.domains,
      actions: body.actions,
    });

    reply.send({ data: report });
  });
}
