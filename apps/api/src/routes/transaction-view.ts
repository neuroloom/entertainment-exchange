// Transaction view routes — cross-domain transaction lifecycle
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { transactionView } from '../services/transaction-view.service.js';

export async function transactionViewRoutes(app: FastifyInstance) {
  app.get('/transactions', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: { transactions: transactionView.list(ctx.tenantId), stats: transactionView.getStats(ctx.tenantId) } });
  });

  app.get('/transactions/:id', async (req, reply) => {
    const ctx = req.ctx;
    const tx = transactionView.get(params(req).id, ctx.tenantId);
    if (!tx) throw AppError.notFound('Transaction');
    reply.send({ data: tx });
  });
}
