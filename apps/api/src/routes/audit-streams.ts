// Audit streaming routes — configure and manage audit event streams
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { auditStreamer } from '../services/audit-streamer.service.js';

export async function auditStreamRoutes(app: FastifyInstance) {
  const CreateAuditStreamSchema = z.object({
    url: z.string().url(),
    filterDomains: z.array(z.string()).optional(),
    filterActions: z.array(z.string()).optional(),
    batchSize: z.number().int().min(1).max(1000).optional(),
    flushIntervalMs: z.number().int().min(1000).optional(),
  });

  app.post('/audit/streams', {
    schema: {
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          filterDomains: { type: 'array', items: { type: 'string' } },
          filterActions: { type: 'array', items: { type: 'string' } },
          batchSize: { type: 'integer', minimum: 1, maximum: 1000 },
          flushIntervalMs: { type: 'integer', minimum: 1000 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const s = auditStreamer.create(ctx.tenantId, CreateAuditStreamSchema.parse(req.body));
    reply.status(201).send({ data: s });
  });

  app.get('/audit/streams', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: auditStreamer.list(ctx.tenantId) });
  });

  app.get('/audit/streams/:id', async (req, reply) => {
    const ctx = req.ctx;
    const s = auditStreamer.get(params(req).id, ctx.tenantId);
    if (!s) throw AppError.notFound('Audit stream');
    reply.send({ data: s });
  });

  app.post('/audit/streams/:id/flush', async (req, reply) => {
    const ctx = req.ctx;
    const count = await auditStreamer.flushAll(ctx.tenantId);
    reply.send({ data: { flushed: count } });
  });

  app.delete('/audit/streams/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = auditStreamer.delete(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Audit stream');
    reply.send({ data: { deleted: true } });
  });
}
