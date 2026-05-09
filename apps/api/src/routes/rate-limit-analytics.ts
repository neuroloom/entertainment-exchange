// Rate limit analytics routes — trend analysis and hotspot detection
import type { FastifyInstance } from 'fastify';
import { rateLimitAnalytics } from '../services/rate-limit-analytics.service.js';

export async function rateLimitAnalyticsRoutes(app: FastifyInstance) {
  app.get('/rate-limits/analytics/trend', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: rateLimitAnalytics.getTrend(ctx.tenantId, parseInt(query.hours ?? '24', 10)) });
  });

  app.get('/rate-limits/analytics/top-ips', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: rateLimitAnalytics.getTopIps(ctx.tenantId) });
  });

  app.get('/rate-limits/analytics/top-endpoints', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: rateLimitAnalytics.getTopEndpoints(ctx.tenantId) });
  });
}
