// Metered billing routes — usage-based cost estimation and rate lookup
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { meteredBilling } from '../services/metered-billing.service.js';
import { usageMeter } from '../services/usage-meter.service.js';

export async function meteredBillingRoutes(app: FastifyInstance) {
  const EstimateSchema = z.object({
    periodStart: z.string(),
    periodEnd: z.string(),
    usage: z.record(z.string(), z.number()),
    currency: z.string().optional(),
  });
  app.get('/billing/metered/rates', async (_req, reply) => {
    reply.send({ data: meteredBilling.getRates() });
  });

  app.post('/billing/metered/estimate', {
    schema: {
      body: {
        type: 'object',
        required: ['periodStart', 'periodEnd', 'usage'],
        properties: {
          periodStart: { type: 'string' },
          periodEnd: { type: 'string' },
          usage: { type: 'object' },
          currency: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = EstimateSchema.parse(req.body);
    const bill = meteredBilling.estimate({ tenantId: ctx.tenantId, ...body });
    reply.status(201).send({ data: bill });
  });

  app.post('/billing/metered/estimate-from-usage', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const summary = usageMeter.getSummary(ctx.tenantId, query.month);

    const usage = {
      api_calls: summary.totalCalls,
      bookings: 0,  // Would come from booking stats in production
      agents: 0,
      listings: 0,
    };

    const now = new Date();
    const bill = meteredBilling.estimate({
      tenantId: ctx.tenantId,
      periodStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      periodEnd: now.toISOString(),
      usage,
    });
    reply.send({ data: bill });
  });

  app.get('/billing/metered/bills', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: meteredBilling.listBills(ctx.tenantId) });
  });

  app.get('/billing/metered/bills/:id', async (req, reply) => {
    const ctx = req.ctx;
    const bill = meteredBilling.getBill(params(req).id, ctx.tenantId);
    if (!bill) throw AppError.notFound('Bill');
    reply.send({ data: bill });
  });
}
