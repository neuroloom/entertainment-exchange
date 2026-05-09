// Webhook batch routes — batched event delivery management
import type { FastifyInstance } from 'fastify';
import { webhookBatcher } from '../services/webhook-batcher.service.js';

export async function webhookBatchRoutes(app: FastifyInstance) {
  app.get('/webhooks/batch/pending', async (_req, reply) => {
    reply.send({ data: { pending: webhookBatcher.getPending() } });
  });

  app.post('/webhooks/batch/flush', async (_req, reply) => {
    const flushed = webhookBatcher.flushAll();
    reply.send({
      data: {
        flushed: flushed.length,
        totalEvents: flushed.reduce((s, b) => s + b.batchSize, 0),
      },
    });
  });
}
