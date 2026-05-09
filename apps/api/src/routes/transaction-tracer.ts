// Transaction tracer routes — cross-domain correlation
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { transactionTracer } from '../services/transaction-tracer.service.js';

export async function transactionTracerRoutes(app: FastifyInstance) {
  app.get('/tracing/traces', async (_req, reply) => {
    reply.send({ data: { stats: transactionTracer.getStats(), recent: transactionTracer.listRecent(20) } });
  });

  app.get('/tracing/traces/:traceId', async (req, reply) => {
    const trace = transactionTracer.getTrace(params(req).traceId);
    reply.send({ data: trace });
  });
}
