// Integration health routes — third-party integration management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { integrationHealth } from '../services/integration-health.service.js';

const RegisterIntegrationSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['slack', 'stripe', 'google_oauth', 'github_oauth', 'smtp', 'custom_webhook']),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateIntegrationSchema = z.object({
  status: z.enum(['connected', 'disconnected', 'error']),
  errorMessage: z.string().optional(),
});

export async function integrationRoutes(app: FastifyInstance) {
  app.post('/integrations', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['slack', 'stripe', 'google_oauth', 'github_oauth', 'smtp', 'custom_webhook'] },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = RegisterIntegrationSchema.parse(req.body);
    const i = integrationHealth.register(ctx.tenantId, body.name, body.type, body.metadata);
    reply.status(201).send({ data: i });
  });

  app.get('/integrations', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: { integrations: integrationHealth.list(ctx.tenantId), summary: integrationHealth.getSummary(ctx.tenantId) } });
  });

  app.get('/integrations/:id', async (req, reply) => {
    const ctx = req.ctx;
    const i = integrationHealth.get(params(req).id, ctx.tenantId);
    if (!i) throw AppError.notFound('Integration');
    reply.send({ data: i });
  });

  app.patch('/integrations/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['connected', 'disconnected', 'error'] },
          errorMessage: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = UpdateIntegrationSchema.parse(req.body);
    const i = integrationHealth.updateStatus(params(req).id, ctx.tenantId, body.status, body.errorMessage);
    if (!i) throw AppError.notFound('Integration');
    reply.send({ data: i });
  });

  app.delete('/integrations/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = integrationHealth.delete(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Integration');
    reply.send({ data: { deleted: true } });
  });
}
