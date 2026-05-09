// Error categorizer routes — error pattern analysis
import type { FastifyInstance } from 'fastify';
import { errorCategorizer } from '../services/error-categorizer.service.js';

export async function errorCategoryRoutes(app: FastifyInstance) {
  app.get('/analytics/errors/categories', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: errorCategorizer.getCategories(ctx.tenantId, parseInt(query.hours ?? '24', 10)) });
  });

  app.get('/analytics/errors/top', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: errorCategorizer.getTopErrors(ctx.tenantId) });
  });
}
