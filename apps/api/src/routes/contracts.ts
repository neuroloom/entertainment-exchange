// Contract routes — template listing and generation from bookings/deals
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { contractTemplates } from '../services/contract-templates.service.js';

const GenerateContractSchema = z.object({
  templateId: z.string(),
  bookingId: z.string().optional(),
  dealId: z.string().optional(),
  vars: z.record(z.string()),
});

export async function contractRoutes(app: FastifyInstance) {
  // Initialize built-in templates for the tenant on first access
  app.addHook('onRequest', async (req) => {
    const ctx = req.ctx;
    if (ctx?.tenantId) contractTemplates.init(ctx.tenantId);
  });

  app.get('/contracts/templates', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: contractTemplates.list(ctx.tenantId) });
  });

  app.get('/contracts/templates/:id', async (req, reply) => {
    const ctx = req.ctx;
    const t = contractTemplates.get(params(req).id, ctx.tenantId);
    if (!t) throw AppError.notFound('Template');
    reply.send({ data: t });
  });

  app.post('/contracts/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['templateId', 'vars'],
        properties: {
          templateId: { type: 'string' },
          bookingId: { type: 'string' },
          dealId: { type: 'string' },
          vars: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = GenerateContractSchema.parse(req.body);

    try {
      const doc = contractTemplates.generate({
        templateId: body.templateId, tenantId: ctx.tenantId,
        bookingId: body.bookingId, dealId: body.dealId, vars: body.vars,
      });
      reply.status(201).send({ data: { id: doc.id, templateId: doc.templateId, content: doc.content, vars: doc.vars, createdAt: doc.createdAt } });
    } catch (err) {
      throw AppError.invalid(err instanceof Error ? err.message : 'Generation failed');
    }
  });

  app.get('/contracts/generated', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: contractTemplates.listGenerated(ctx.tenantId) });
  });

  app.get('/contracts/generated/:id', async (req, reply) => {
    const ctx = req.ctx;
    const doc = contractTemplates.getGenerated(params(req).id, ctx.tenantId);
    if (!doc) throw AppError.notFound('Contract');
    reply.send({ data: doc });
  });
}
