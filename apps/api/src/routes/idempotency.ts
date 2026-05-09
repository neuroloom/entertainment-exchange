// Idempotency routes — key-based deduplication for safe retries
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idempotency } from '../services/idempotency.service.js';

export async function idempotencyRoutes(app: FastifyInstance) {
  app.post('/idempotency/check', {
    schema: {
      body: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ key: z.string().min(1) }).parse(req.body);
    const rec = idempotency.check(body.key, ctx.tenantId);
    if (rec) {
      return reply.status(rec.response.statusCode).send(rec.response.body);
    }
    reply.send({ data: { available: true } });
  });

  app.post('/idempotency/store', {
    schema: {
      body: {
        type: 'object',
        required: ['key', 'statusCode', 'body'],
        properties: {
          key: { type: 'string', minLength: 1 },
          statusCode: { type: 'integer' },
          body: { type: 'object' },
          ttlMs: { type: 'integer', minimum: 1000 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({
      key: z.string().min(1),
      statusCode: z.number().int(),
      body: z.record(z.unknown()),
      ttlMs: z.number().int().min(1000).optional(),
    }).parse(req.body);
    idempotency.store(body.key, ctx.tenantId, body.statusCode, body.body, body.ttlMs);
    reply.send({ data: { stored: true } });
  });
}
