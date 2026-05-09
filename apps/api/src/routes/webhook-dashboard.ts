// Webhook dashboard — delivery analytics and management
import type { FastifyInstance } from 'fastify';
import { webhookService } from '../services/webhook.service.js';

export async function webhookDashboardRoutes(app: FastifyInstance) {
  app.get('/webhooks/dashboard', async (req, reply) => {
    const ctx = req.ctx;
    const subs = webhookService.getSubscriptions(ctx.tenantId);
    const stats = webhookService.stats(ctx.tenantId);

    const byEvent: Record<string, number> = {};
    for (const s of subs) {
      for (const e of s.events) byEvent[e] = (byEvent[e] ?? 0) + 1;
    }

    reply.send({
      data: {
        subscriptions: { total: subs.length, active: subs.filter(s => s.active).length },
        deliveries: stats,
        eventCoverage: byEvent,
      },
    });
  });

  app.get('/webhooks/deliveries/failed', async (req, reply) => {
    const ctx = req.ctx;
    const subs = webhookService.getSubscriptions(ctx.tenantId);
    const subIds = new Set(subs.map(s => s.id));

    const allDeliveries = webhookService.getDeliveries();
    const failed = allDeliveries.filter(d => subIds.has(d.subscriptionId) && d.status === 'failed');

    reply.send({ data: failed, meta: { count: failed.length } });
  });
}
