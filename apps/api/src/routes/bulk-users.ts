// Bulk user routes — batch user operations
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { bulkUsers } from '../services/bulk-users.service.js';

export async function bulkUserRoutes(app: FastifyInstance) {
  app.post('/users/bulk', {
    schema: {
      body: {
        type: 'object',
        required: ['operations'],
        properties: {
          operations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['action', 'email'],
              properties: {
                action: { type: 'string', enum: ['create', 'update', 'delete', 'invite'] },
                email: { type: 'string', format: 'email' },
                name: { type: 'string' },
                roles: { type: 'array', items: { type: 'string' } },
                metadata: { type: 'object' },
              },
            },
            minItems: 1,
            maxItems: 500,
          },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ operations: z.array(z.object({ action: z.enum(['create', 'update', 'delete', 'invite']), email: z.string().email(), name: z.string().optional() })) }).parse(req.body);

    // Validate
    const validation = bulkUsers.validate(body.operations);
    if (!validation.valid) throw AppError.invalid(validation.errors.join('; '));

    const result = bulkUsers.execute(ctx.tenantId, body.operations, ctx.actor.id);
    reply.status(207).send({ data: result });
  });

  app.get('/users/bulk/history', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: bulkUsers.history(ctx.tenantId) });
  });
}
