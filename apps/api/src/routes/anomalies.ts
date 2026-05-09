// Anomaly alert routes — view and acknowledge security alerts
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { anomalyAlerts } from '../services/anomaly-alerts.service.js';

export async function anomalyRoutes(app: FastifyInstance) {
  app.get('/anomalies', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const all = anomalyAlerts.list(ctx.tenantId, {
      unacknowledged: query.unacknowledged === 'true',
      severity: query.severity,
    });
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/anomalies/stats', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: anomalyAlerts.stats(ctx.tenantId) });
  });

  app.post('/anomalies/:id/acknowledge', async (req, reply) => {
    const ctx = req.ctx;
    const ok = anomalyAlerts.acknowledge(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Alert');
    reply.send({ data: { acknowledged: true } });
  });
}
