// Endpoint popularity routes — usage ranking and adoption trends
import type { FastifyInstance } from 'fastify';
import { endpointPopularity } from '../services/endpoint-popularity.service.js';

export async function endpointPopularityRoutes(app: FastifyInstance) {
  app.get('/analytics/endpoints/rankings', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: endpointPopularity.getRankings(ctx.tenantId, parseInt(query.hours ?? '24', 10)) });
  });

  app.get('/analytics/endpoints/adoption', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: endpointPopularity.getAdoptionTrend(ctx.tenantId, parseInt(query.days ?? '30', 10)) });
  });
}
