// Scheduled report routes — create, manage, and generate reports
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { scheduledReports } from '../services/scheduled-reports.service.js';

export async function reportRoutes(app: FastifyInstance) {
  const CreateReportSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['revenue_summary', 'booking_digest', 'agent_performance', 'marketplace_activity']),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    recipients: z.array(z.string()).min(1),
    format: z.enum(['json', 'csv', 'html']).optional(),
  });

  app.post('/reports/schedules', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type', 'frequency', 'recipients'],
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['revenue_summary', 'booking_digest', 'agent_performance', 'marketplace_activity'] },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
          dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
          dayOfMonth: { type: 'integer', minimum: 1, maximum: 28 },
          recipients: { type: 'array', items: { type: 'string' }, minItems: 1 },
          format: { type: 'string', enum: ['json', 'csv', 'html'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CreateReportSchema.parse(req.body);
    const s = scheduledReports.create({ tenantId: ctx.tenantId, ...body });
    reply.status(201).send({ data: s });
  });

  app.get('/reports/schedules', async (req, reply) => {
    const ctx = req.ctx;
    const all = scheduledReports.list(ctx.tenantId);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/reports/schedules/:id', async (req, reply) => {
    const ctx = req.ctx;
    const s = scheduledReports.get(params(req).id, ctx.tenantId);
    if (!s) throw AppError.notFound('Report schedule');
    reply.send({ data: s });
  });

  app.patch('/reports/schedules/:id', async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({
      name: z.string().min(1).optional(),
      frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
      recipients: z.array(z.string()).min(1).optional(),
      format: z.enum(['json', 'csv', 'html']).optional(),
      enabled: z.boolean().optional(),
    }).parse(req.body);
    const s = scheduledReports.update(params(req).id, ctx.tenantId, body);
    if (!s) throw AppError.notFound('Report schedule');
    reply.send({ data: s });
  });

  app.delete('/reports/schedules/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = scheduledReports.delete(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Report schedule');
    reply.send({ data: { deleted: true } });
  });

  app.post('/reports/schedules/:id/generate', async (req, reply) => {
    const ctx = req.ctx;
    const r = scheduledReports.generateReport(params(req).id, ctx.tenantId);
    if (!r) throw AppError.notFound('Report schedule');
    reply.send({ data: r });
  });

  app.get('/reports/generated', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: scheduledReports.listReports(ctx.tenantId) });
  });
}
