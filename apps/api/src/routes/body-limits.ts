// Body limit routes — configurable request size limits
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bodyLimits } from '../services/body-limit.service.js';

export async function bodyLimitRoutes(app: FastifyInstance) {
  const CreateBodyLimitSchema = z.object({
    endpoint: z.string().min(1),
    maxBytes: z.number().int().min(1024),
  });

  app.post('/body-limits', {
    schema: {
      body: {
        type: 'object',
        required: ['endpoint', 'maxBytes'],
        properties: {
          endpoint: { type: 'string', minLength: 1 },
          maxBytes: { type: 'integer', minimum: 1024 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CreateBodyLimitSchema.parse(req.body);
    const rule = bodyLimits.setRule(ctx.tenantId, body.endpoint, body.maxBytes);
    reply.status(201).send({ data: rule });
  });

  app.get('/body-limits', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: bodyLimits.listRules(ctx.tenantId) });
  });

  app.delete('/body-limits/:endpoint', async (req, reply) => {
    const ctx = req.ctx;
    const decoded = decodeURIComponent(params(req).endpoint);
    const ok = bodyLimits.deleteRule(ctx.tenantId, decoded);
    reply.send({ data: { deleted: ok } });
  });

  app.get('/body-limits/check', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const result = bodyLimits.checkContentLength(ctx.tenantId, query.endpoint ?? '/', query.contentLength);
    reply.send({ data: result });
  });
}
