// Usage routes — API metering and quota visibility
import type { FastifyInstance } from 'fastify';
import { usageMeter } from '../services/usage-meter.service.js';

export async function usageRoutes(app: FastifyInstance) {
  app.get('/usage', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: usageMeter.getSummary(ctx.tenantId, query.month) });
  });

  app.get('/usage/top', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: usageMeter.getTopEndpoints(ctx.tenantId) });
  });

  app.get('/usage/recent', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: usageMeter.getRecent(ctx.tenantId) });
  });

  app.get('/usage/all-tenants', async (req, reply) => {
    const query = req.query as Record<string, string>;
    reply.send({ data: usageMeter.getAllTenantSummaries(query.month) });
  });
}
