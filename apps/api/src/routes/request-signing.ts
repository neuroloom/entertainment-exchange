// Request signing routes — HMAC key management and verification
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { requestSigning } from '../services/request-signing.service.js';

export async function requestSigningRoutes(app: FastifyInstance) {
  app.post('/security/signing-keys', {
    schema: {
      body: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string', minLength: 32 } },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ key: z.string().min(32) }).parse(req.body);
    const sk = requestSigning.registerKey(ctx.tenantId, body.key);
    reply.status(201).send({ data: { id: sk.id, algorithm: sk.algorithm, createdAt: sk.createdAt } });
  });

  app.get('/security/signing-keys', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: requestSigning.listKeys(ctx.tenantId).map(k => ({ id: k.id, algorithm: k.algorithm, createdAt: k.createdAt })) });
  });

  app.delete('/security/signing-keys/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = requestSigning.deleteKey(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Key');
    reply.send({ data: { deleted: true } });
  });

  app.post('/security/sign', {
    schema: {
      body: {
        type: 'object',
        required: ['payload'],
        properties: { payload: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ payload: z.string().min(1) }).parse(req.body);
    const sig = await requestSigning.sign(ctx.tenantId, body.payload);
    if (!sig) throw AppError.invalid('No signing key configured');
    reply.send({ data: sig });
  });

  app.post('/security/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['signature', 'payload'],
        properties: {
          signature: { type: 'string' },
          payload: { type: 'string' },
          maxAgeSeconds: { type: 'integer' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({
      signature: z.string(),
      payload: z.string(),
      maxAgeSeconds: z.number().int().optional(),
    }).parse(req.body);
    const valid = await requestSigning.verify(ctx.tenantId, body.signature, body.payload, body.maxAgeSeconds ?? 300);
    reply.send({ data: { valid } });
  });
}
