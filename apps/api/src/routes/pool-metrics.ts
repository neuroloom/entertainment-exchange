// Connection pool metrics routes — DB health and utilization
import type { FastifyInstance } from 'fastify';
import { poolMetrics } from '../services/connection-pool-metrics.service.js';

export async function poolMetricsRoutes(app: FastifyInstance) {
  app.get('/system/pool', async (req, reply) => {
    const query = req.query as Record<string, string>;
    reply.send({
      data: {
        latest: poolMetrics.getLatest(),
        utilization: poolMetrics.getUtilization(parseInt(query.minutes ?? '15', 10)),
        warning: poolMetrics.shouldWarn(),
      },
    });
  });

  app.get('/system/pool/history', async (req, reply) => {
    const query = req.query as Record<string, string>;
    reply.send({ data: poolMetrics.getHistory(parseInt(query.minutes ?? '60', 10)) });
  });
}
