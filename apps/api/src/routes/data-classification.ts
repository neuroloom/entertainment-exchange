// Data classification routes — sensitivity tagging and compliance labeling
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dataClassification } from '../services/data-classification.service.js';

export async function dataClassificationRoutes(app: FastifyInstance) {
  const TagSchema = z.object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    level: z.enum(['public', 'internal', 'confidential', 'restricted', 'pii', 'phi']),
    regulations: z.array(z.string()).optional(),
    dataCategories: z.array(z.string()).optional(),
    retentionRequired: z.boolean().optional(),
    encrypted: z.boolean().optional(),
  });

  app.post('/classification/tag', {
    schema: {
      body: {
        type: 'object',
        required: ['entityType', 'entityId', 'level'],
        properties: {
          entityType: { type: 'string', minLength: 1 },
          entityId: { type: 'string', minLength: 1 },
          level: { type: 'string', enum: ['public', 'internal', 'confidential', 'restricted', 'pii', 'phi'] },
          regulations: { type: 'array', items: { type: 'string' } },
          dataCategories: { type: 'array', items: { type: 'string' } },
          retentionRequired: { type: 'boolean' },
          encrypted: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = TagSchema.parse(req.body);
    const tag = dataClassification.tag({
      entityType: body.entityType, entityId: body.entityId, tenantId: ctx.tenantId,
      level: body.level, regulations: body.regulations ?? [],
      dataCategories: body.dataCategories ?? [],
      retentionRequired: body.retentionRequired ?? false,
      encrypted: body.encrypted ?? (body.level === 'restricted' || body.level === 'pii'),
      taggedBy: ctx.actor.id,
    });
    reply.status(201).send({ data: tag });
  });

  app.get('/classification/:entityType/:entityId', async (req, reply) => {
    const ctx = req.ctx;
    const p = params(req);
    const tag = dataClassification.getClassification(p.entityType, p.entityId, ctx.tenantId);
    reply.send({ data: tag ?? { message: 'Not classified' } });
  });

  app.get('/classification/summary', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: dataClassification.getSummary(ctx.tenantId) });
  });
}
