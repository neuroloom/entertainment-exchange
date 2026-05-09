// Key usage alerts routes — unusual API key pattern detection
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { keyUsageAlerts } from '../services/key-usage-alerts.service.js';

export async function keyUsageAlertRoutes(app: FastifyInstance) {
  app.get('/api-keys/alerts', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: keyUsageAlerts.list(ctx.tenantId, query.unacknowledged === 'true') });
  });

  app.post('/api-keys/alerts/:id/acknowledge', async (req, reply) => {
    const ctx = req.ctx;
    const ok = keyUsageAlerts.acknowledge(params(req).id, ctx.tenantId);
    reply.send({ data: { acknowledged: ok } });
  });
}
