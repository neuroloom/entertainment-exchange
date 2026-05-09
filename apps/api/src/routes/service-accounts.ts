import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { serviceAccounts } from '../services/service-accounts.service.js';

const CreateServiceAccountSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  permissions: z.array(z.string()).min(1),
  apiKeyId: z.string(),
});

export async function serviceAccountRoutes(app: FastifyInstance) {
  app.post('/service-accounts', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'description', 'permissions', 'apiKeyId'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          permissions: { type: 'array', items: { type: 'string' }, minItems: 1 },
          apiKeyId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CreateServiceAccountSchema.parse(req.body);
    const sa = serviceAccounts.create(ctx.tenantId, body.name, body.description, body.permissions, body.apiKeyId, ctx.actor.id);
    reply.status(201).send({ data: sa });
  });

  app.get('/service-accounts', async (req, reply) => {
    const ctx = req.ctx;
    const all = serviceAccounts.list(ctx.tenantId);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.post('/service-accounts/:id/disable', async (req, reply) => {
    const ctx = req.ctx;
    const ok = serviceAccounts.disable(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Service account');
    reply.send({ data: { disabled: true } });
  });

  app.post('/service-accounts/:id/enable', async (req, reply) => {
    const ctx = req.ctx;
    const ok = serviceAccounts.enable(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Service account');
    reply.send({ data: { enabled: true } });
  });

  app.delete('/service-accounts/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = serviceAccounts.delete(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Service account');
    reply.send({ data: { deleted: true } });
  });
}
