// Audit sanitizer routes — PII scrubbing for audit exports
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditSanitizer } from '../services/audit-sanitizer.service.js';
import { sharedAudit } from '../services/audit-helpers.js';
import { serializeRows, getExportContentType } from '../services/export.service.js';



export async function auditSanitizerRoutes(app: FastifyInstance) {
  app.get('/audit/sanitize/rules', async (_req, reply) => {
    reply.send({ data: auditSanitizer.getRules() });
  });

  app.post('/audit/sanitize', {
    schema: {
      body: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ data: z.array(z.record(z.unknown())).optional() }).parse(req.body);
    const records = body.data ?? sharedAudit.all(req.ctx?.tenantId) as unknown as Record<string, unknown>[];
    const result = auditSanitizer.sanitizeBatch(records);
    reply.send({ data: result });
  });

  app.get('/audit/sanitize/export', async (req, reply) => {
    const ctx = req.ctx;
    const records = sharedAudit.all(ctx.tenantId) as unknown as Record<string, unknown>[];
    const { sanitized } = auditSanitizer.sanitizeBatch(records);
    const content = serializeRows(sanitized, 'csv');
    reply
      .header('Content-Type', getExportContentType('csv'))
      .header('Content-Disposition', 'attachment; filename="audit-sanitized.csv"')
      .send(content);
  });
}
