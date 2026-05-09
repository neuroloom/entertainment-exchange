// Custom alert routes — threshold-based alerting configuration
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { customAlerts } from '../services/custom-alerts.service.js';

const CreateAlertRuleSchema = z.object({
  name: z.string().min(1),
  metric: z.string().min(1),
  condition: z.enum(['gt', 'lt', 'change_pct']),
  threshold: z.number(),
  windowMinutes: z.number().int().min(1),
  channels: z.array(z.enum(['in_app', 'email', 'slack'])).min(1),
  cooldownMinutes: z.number().int().min(1).optional(),
});

const UpdateAlertRuleSchema = z.object({
  name: z.string().optional(),
  threshold: z.number().optional(),
  enabled: z.boolean().optional(),
  cooldownMinutes: z.number().int().optional(),
  channels: z.array(z.enum(['in_app', 'email', 'slack'])).optional(),
});

export async function customAlertRoutes(app: FastifyInstance) {
  app.post('/alerts/rules', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'metric', 'condition', 'threshold', 'windowMinutes', 'channels'],
        properties: {
          name: { type: 'string', minLength: 1 },
          metric: { type: 'string', minLength: 1 },
          condition: { type: 'string', enum: ['gt', 'lt', 'change_pct'] },
          threshold: { type: 'number' },
          windowMinutes: { type: 'integer', minimum: 1 },
          channels: { type: 'array', items: { type: 'string', enum: ['in_app', 'email', 'slack'] }, minItems: 1 },
          cooldownMinutes: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CreateAlertRuleSchema.parse(req.body);
    const rule = customAlerts.createRule(ctx.tenantId, { ...body, enabled: true, cooldownMinutes: body.cooldownMinutes ?? 60 });
    reply.status(201).send({ data: rule });
  });

  app.get('/alerts/rules', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: customAlerts.listRules(ctx.tenantId) });
  });

  app.patch('/alerts/rules/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          threshold: { type: 'number' },
          enabled: { type: 'boolean' },
          cooldownMinutes: { type: 'integer' },
          channels: { type: 'array', items: { type: 'string', enum: ['in_app', 'email', 'slack'] } },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const r = customAlerts.updateRule(params(req).id, ctx.tenantId, UpdateAlertRuleSchema.parse(req.body));
    if (!r) throw AppError.notFound('Alert rule');
    reply.send({ data: r });
  });

  app.delete('/alerts/rules/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = customAlerts.deleteRule(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Alert rule');
    reply.send({ data: { deleted: true } });
  });

  app.get('/alerts/events', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: customAlerts.listEvents(ctx.tenantId, query.unacknowledged === 'true') });
  });

  app.post('/alerts/events/:id/acknowledge', async (req, reply) => {
    const ctx = req.ctx;
    const ok = customAlerts.acknowledge(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Alert event');
    reply.send({ data: { acknowledged: true } });
  });
}
