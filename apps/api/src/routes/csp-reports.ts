import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cspReport } from '../services/csp-report.service.js';

const CspReportSchema = z.object({
  'csp-report': z.record(z.unknown()).optional(),
}).catchall(z.unknown());

export async function cspReportRoutes(app: FastifyInstance) {
  app.post('/csp-report', {
    schema: { body: { type: 'object', properties: { 'csp-report': { type: 'object' } } } },
  }, async (req, reply) => {
    const body = CspReportSchema.parse(req.body);
    const report = body['csp-report'] ?? {};
    cspReport.record(req.ctx?.tenantId ?? '', report);
    reply.status(204).send();
  });
  app.get('/csp-report', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: { violations: cspReport.list(ctx.tenantId), summary: cspReport.getSummary(ctx.tenantId) } });
  });
}
