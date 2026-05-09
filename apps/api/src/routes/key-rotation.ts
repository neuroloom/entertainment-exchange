// Key rotation routes — automated key lifecycle management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { keyRotation } from '../services/key-rotation.service.js';

const RotationPolicySchema = z.object({
  rotationDays: z.number().int().min(1).max(365),
  gracePeriodDays: z.number().int().min(1).max(30),
  autoRotate: z.boolean().optional(),
});

export async function keyRotationRoutes(app: FastifyInstance) {
  app.post('/api-keys/:id/rotation-policy', {
    schema: {
      body: {
        type: 'object',
        required: ['rotationDays', 'gracePeriodDays'],
        properties: {
          rotationDays: { type: 'integer', minimum: 1, maximum: 365 },
          gracePeriodDays: { type: 'integer', minimum: 1, maximum: 30 },
          autoRotate: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = RotationPolicySchema.parse(req.body);
    const policy = keyRotation.setPolicy(ctx.tenantId, params(req).id, body.rotationDays, body.gracePeriodDays, body.autoRotate ?? false);
    reply.send({ data: policy });
  });

  app.get('/api-keys/:id/rotation-policy', async (req, reply) => {
    const ctx = req.ctx;
    const policy = keyRotation.getPolicy(ctx.tenantId, params(req).id);
    if (!policy) throw AppError.notFound('Rotation policy');
    reply.send({ data: policy });
  });

  app.get('/api-keys/rotation-policies', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: keyRotation.listPolicies(ctx.tenantId) });
  });

  app.get('/api-keys/rotation-history', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: keyRotation.getHistory(ctx.tenantId, query.keyId) });
  });

  app.get('/api-keys/rotations-due', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: keyRotation.getDueRotations(ctx.tenantId) });
  });
}
