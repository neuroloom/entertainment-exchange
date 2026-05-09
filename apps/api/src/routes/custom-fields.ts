// Custom field routes — define, list, delete custom fields
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { customFields } from '../services/custom-fields.service.js';

const DefineFieldSchema = z.object({
  entityType: z.enum(['business', 'booking', 'listing', 'agent']),
  name: z.string().min(1),
  key: z.string().min(1).regex(/^[a-z][a-zA-Z0-9]*$/),
  fieldType: z.enum(['text', 'number', 'boolean', 'date', 'select', 'url']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  order: z.number().int().default(0),
});

const ValidateFieldSchema = z.object({
  entityType: z.string(),
  data: z.record(z.unknown()),
});

export async function customFieldRoutes(app: FastifyInstance) {
  app.post('/custom-fields', {
    schema: {
      body: {
        type: 'object',
        required: ['entityType', 'name', 'key', 'fieldType'],
        properties: {
          entityType: { type: 'string', enum: ['business', 'booking', 'listing', 'agent'] },
          name: { type: 'string', minLength: 1 },
          key: { type: 'string', minLength: 1, pattern: '^[a-z][a-zA-Z0-9]*$' },
          fieldType: { type: 'string', enum: ['text', 'number', 'boolean', 'date', 'select', 'url'] },
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' } },
          defaultValue: { type: 'string' },
          order: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = DefineFieldSchema.parse(req.body);
    const def = customFields.define({ tenantId: ctx.tenantId, ...body });
    reply.status(201).send({ data: def });
  });

  app.get('/custom-fields', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: customFields.getDefinitions(ctx.tenantId, query.entityType) });
  });

  app.delete('/custom-fields/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = customFields.deleteDefinition(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Custom field');
    reply.send({ data: { deleted: true } });
  });

  app.post('/custom-fields/validate', {
    schema: {
      body: {
        type: 'object',
        required: ['entityType', 'data'],
        properties: {
          entityType: { type: 'string' },
          data: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = ValidateFieldSchema.parse(req.body);
    const result = customFields.validateAndApply(body.entityType, ctx.tenantId, body.data);
    reply.send({ data: result });
  });
}
