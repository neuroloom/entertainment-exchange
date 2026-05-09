// Latency histogram routes — response time distribution
import type { FastifyInstance } from 'fastify';
import { latencyHistogram } from '../services/latency-histogram.service.js';

export async function latencyHistogramRoutes(app: FastifyInstance) {
  app.get('/analytics/latency/distribution', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: latencyHistogram.getDistribution(ctx.tenantId) });
  });

  app.get('/analytics/latency/percentiles', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: latencyHistogram.getPercentiles(ctx.tenantId) });
  });

  app.get('/analytics/latency/slowest', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: latencyHistogram.getSlowest(ctx.tenantId) });
  });
}
