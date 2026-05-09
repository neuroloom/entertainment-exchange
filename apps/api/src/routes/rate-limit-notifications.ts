import type { FastifyInstance } from 'fastify';
import { params } from '../plugins/requestContext.js';
import { rateLimitNotifier } from '../services/rate-limit-notifier.service.js';

export async function rateLimitNotifyRoutes(app: FastifyInstance) {
  app.get('/rate-limits/notifications', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: { notifications: rateLimitNotifier.list(ctx.tenantId, query.unacknowledged === 'true'), stats: rateLimitNotifier.stats(ctx.tenantId) } });
  });
  app.post('/rate-limits/notifications/:id/acknowledge', async (req, reply) => {
    const ctx = req.ctx;
    rateLimitNotifier.acknowledge(params(req).id, ctx.tenantId);
    reply.send({ data: { acknowledged: true } });
  });
}
