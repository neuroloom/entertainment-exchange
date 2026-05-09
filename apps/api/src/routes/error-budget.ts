// Error budget routes — SRE error budget monitoring
import type { FastifyInstance } from 'fastify';
import { errorBudget } from '../services/error-budget.service.js';

export async function errorBudgetRoutes(app: FastifyInstance) {
  app.get('/sre/error-budget', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: errorBudget.getBudget(ctx.tenantId, parseFloat(query.slo ?? '99.9')) });
  });

  app.get('/sre/error-budget/history', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: errorBudget.getHistory(ctx.tenantId, parseInt(query.months ?? '6', 10)) });
  });
}
