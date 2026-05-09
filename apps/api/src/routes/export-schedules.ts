// Export schedule routes — scheduled data export configuration
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';

const CreateExportScheduleSchema = z.object({
  domain: z.enum(['businesses', 'bookings', 'agents', 'listings', 'ledger_journals']),
  format: z.enum(['csv', 'json']),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  recipients: z.array(z.string()).min(1),
});

interface ExportSchedule {
  id: string;
  tenantId: string;
  domain: string;
  format: 'csv' | 'json';
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  enabled: boolean;
  lastRunAt?: string;
  createdAt: string;
}

const schedules: ExportSchedule[] = [];

export async function exportScheduleRoutes(app: FastifyInstance) {
  app.post('/export/schedules', {
    schema: {
      body: {
        type: 'object',
        required: ['domain', 'format', 'frequency', 'recipients'],
        properties: {
          domain: { type: 'string', enum: ['businesses', 'bookings', 'agents', 'listings', 'ledger_journals'] },
          format: { type: 'string', enum: ['csv', 'json'] },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
          recipients: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CreateExportScheduleSchema.parse(req.body);
    const s: ExportSchedule = {
      id: uuid(), tenantId: ctx.tenantId, ...body,
      enabled: true, createdAt: new Date().toISOString(),
    };
    schedules.push(s);
    reply.status(201).send({ data: s });
  });

  app.get('/export/schedules', async (req, reply) => {
    const ctx = req.ctx;
    const all = schedules.filter(s => s.tenantId === ctx.tenantId);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.delete('/export/schedules/:id', async (req, reply) => {
    const ctx = req.ctx;
    const idx = schedules.findIndex(s => s.id === params(req).id && s.tenantId === ctx.tenantId);
    if (idx === -1) throw AppError.notFound('Export schedule');
    schedules.splice(idx, 1);
    reply.send({ data: { deleted: true } });
  });
}
