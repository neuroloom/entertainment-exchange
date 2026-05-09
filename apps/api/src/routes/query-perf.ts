// Query performance routes — slow query analysis
import type { FastifyInstance } from 'fastify';
import { queryPerf } from '../services/query-perf.service.js';

export async function queryPerfRoutes(app: FastifyInstance) {
  app.get('/system/queries/slow', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: queryPerf.getSlowQueries(ctx.tenantId) });
  });

  app.get('/system/queries/table-stats', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: queryPerf.getTableStats(ctx.tenantId) });
  });

  app.get('/system/queries/trend', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: queryPerf.getTrend(ctx.tenantId, parseInt(query.hours ?? '24', 10)) });
  });
}
