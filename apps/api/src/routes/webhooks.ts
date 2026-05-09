// Webhook routes — subscribe to platform events, receive callbacks on business events
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { webhookService } from '../services/webhook.service.js';

const SubscribeSchema = z.object({
  url: z.string().url().min(1),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
});

const UpdateSubSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  secret: z.string().optional(),
  active: z.boolean().optional(),
});

export async function webhookRoutes(app: FastifyInstance) {
  // POST /webhooks/subscriptions — create a new webhook subscription
  app.post('/webhooks/subscriptions', {
    schema: {
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' }, minItems: 1 },
          secret: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = SubscribeSchema.parse(req.body);
    const sub = webhookService.subscribe({
      tenantId: ctx.tenantId, url: body.url, events: body.events, active: true,
      secret: body.secret,
    });
    reply.status(201).send({ data: sub });
  });

  // GET /webhooks/subscriptions — list all subscriptions for tenant
  app.get('/webhooks/subscriptions', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const subs = webhookService.getSubscriptions(ctx.tenantId);
    const p = paginate(req.query);
    const sliced = subs.slice(p.offset, p.offset + p.limit);
    reply.send(paginatedResponse(sliced, subs.length, p));
  });

  // GET /webhooks/subscriptions/:id — get subscription details
  app.get('/webhooks/subscriptions/:id', async (req, reply) => {
    const ctx = req.ctx;
    const sub = webhookService.findSubscription(params(req).id, ctx.tenantId);
    if (!sub) throw AppError.notFound('Webhook subscription');
    reply.send({ data: sub });
  });

  // PATCH /webhooks/subscriptions/:id — update subscription
  app.patch('/webhooks/subscriptions/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' }, minItems: 1 },
          secret: { type: 'string' },
          active: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const sub = webhookService.findSubscription(params(req).id, ctx.tenantId);
    if (!sub) throw AppError.notFound('Webhook subscription');

    const body = UpdateSubSchema.parse(req.body);
    if (body.url !== undefined) sub.url = body.url;
    if (body.events !== undefined) sub.events = body.events;
    if (body.secret !== undefined) sub.secret = body.secret;
    if (body.active !== undefined) sub.active = body.active;
    sub.updatedAt = new Date().toISOString();

    reply.send({ data: sub });
  });

  // DELETE /webhooks/subscriptions/:id — unsubscribe
  app.delete('/webhooks/subscriptions/:id', async (req, reply) => {
    const ctx = req.ctx;
    const removed = webhookService.unsubscribe(params(req).id, ctx.tenantId);
    if (!removed) throw AppError.notFound('Webhook subscription');
    reply.send({ data: { deleted: true } });
  });

  // GET /webhooks/deliveries — delivery history
  app.get('/webhooks/deliveries', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    let deliveries = webhookService.getDeliveries(query.subscriptionId);

    // Filter by tenant via subscription lookup
    const subs = webhookService.getSubscriptions(ctx.tenantId);
    const subIds = new Set(subs.map(s => s.id));
    deliveries = deliveries.filter(d => subIds.has(d.subscriptionId));

    const p = paginate(req.query);
    const sliced = deliveries.slice(p.offset, p.offset + p.limit);
    reply.send(paginatedResponse(sliced, deliveries.length, p));
  });

  // GET /webhooks/deliveries/:id — single delivery detail
  app.get('/webhooks/deliveries/:id', async (req, reply) => {
    const ctx = req.ctx;
    const d = webhookService.getDelivery(params(req).id);
    if (!d) throw AppError.notFound('Webhook delivery');

    const sub = webhookService.findSubscription(d.subscriptionId, ctx.tenantId);
    if (!sub) throw AppError.notFound('Webhook delivery');

    reply.send({ data: d });
  });

  // POST /webhooks/deliveries/:id/retry — retry a failed delivery
  app.post('/webhooks/deliveries/:id/retry', async (req, reply) => {
    const ctx = req.ctx;
    const d = webhookService.getDelivery(params(req).id);
    if (!d) throw AppError.notFound('Webhook delivery');
    const sub = webhookService.findSubscription(d.subscriptionId, ctx.tenantId);
    if (!sub) throw AppError.notFound('Webhook delivery');

    const ok = webhookService.retryDelivery(d.id);
    if (!ok) throw AppError.invalid('Delivery cannot be retried (must be in failed state)');
    reply.send({ data: { retried: true } });
  });

  // GET /webhooks/stats — webhook stats for tenant
  app.get('/webhooks/stats', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: webhookService.stats(ctx.tenantId) });
  });
}
