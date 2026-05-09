// Webhook replay routes — replay past events
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { webhookReplay } from '../services/webhook-replay.service.js';
import { webhookService } from '../services/webhook.service.js';

const ReplayWebhookSchema = z.object({
  subscriptionId: z.string(),
  event: z.string(),
  payload: z.record(z.unknown()),
  originalDeliveryId: z.string().optional(),
});

export async function webhookReplayRoutes(app: FastifyInstance) {
  app.post('/webhooks/replay', {
    schema: {
      body: {
        type: 'object',
        required: ['subscriptionId', 'event', 'payload'],
        properties: {
          subscriptionId: { type: 'string' },
          event: { type: 'string' },
          payload: { type: 'object' },
          originalDeliveryId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = ReplayWebhookSchema.parse(req.body);

    // Verify subscription belongs to tenant
    const sub = webhookService.findSubscription(body.subscriptionId, ctx.tenantId);
    if (!sub) throw AppError.notFound('Subscription');

    const r = webhookReplay.replay(body.subscriptionId, body.originalDeliveryId ?? 'manual', body.event, body.payload);
    reply.status(201).send({ data: r });
  });

  app.get('/webhooks/replays', async (req, reply) => {
    const query = req.query as Record<string, string>;
    reply.send({ data: webhookReplay.listReplays(query.subscriptionId) });
  });
}
