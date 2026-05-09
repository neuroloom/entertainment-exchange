// Integration sync routes — sync status tracking
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { integrationSync } from '../services/integration-sync.service.js';

export async function integrationSyncRoutes(app: FastifyInstance) {
  app.get('/integrations/:id/sync', async (req, reply) => {
    const ctx = req.ctx;
    const latest = integrationSync.getLatest(params(req).id, ctx.tenantId);
    reply.send({ data: latest ?? { message: 'No sync history' } });
  });

  app.get('/integrations/sync/history', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: integrationSync.getHistory(ctx.tenantId) });
  });

  app.get('/integrations/sync/summary', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: integrationSync.getSummary(ctx.tenantId) });
  });
}
