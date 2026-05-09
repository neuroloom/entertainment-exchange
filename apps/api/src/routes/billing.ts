// Billing routes — invoice generation and management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { billingService } from '../services/billing.service.js';

const GenerateInvoiceSchema = z.object({
  plan: z.enum(['starter', 'pro', 'enterprise']),
  periodStart: z.string(),
  periodEnd: z.string(),
  bookingCount: z.number().int().min(0),
  agentCount: z.number().int().min(0),
  listingCount: z.number().int().min(0),
  currency: z.string().optional(),
});

export async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/plans', async (_req, reply) => {
    reply.send({ data: billingService.listPlans() });
  });

  app.post('/billing/invoices', {
    schema: {
      body: {
        type: 'object',
        required: ['plan', 'periodStart', 'periodEnd', 'bookingCount', 'agentCount', 'listingCount'],
        properties: {
          plan: { type: 'string', enum: ['starter', 'pro', 'enterprise'] },
          periodStart: { type: 'string' },
          periodEnd: { type: 'string' },
          bookingCount: { type: 'integer', minimum: 0 },
          agentCount: { type: 'integer', minimum: 0 },
          listingCount: { type: 'integer', minimum: 0 },
          currency: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = GenerateInvoiceSchema.parse(req.body);
    const inv = billingService.generateInvoice({
      tenantId: ctx.tenantId, plan: body.plan,
      periodStart: body.periodStart, periodEnd: body.periodEnd,
      bookingCount: body.bookingCount, agentCount: body.agentCount,
      listingCount: body.listingCount, currency: body.currency,
    });
    reply.status(201).send({ data: inv });
  });

  app.get('/billing/invoices', async (req, reply) => {
    const ctx = req.ctx;
    const all = billingService.listInvoices(ctx.tenantId);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/billing/invoices/:id', async (req, reply) => {
    const ctx = req.ctx;
    const inv = billingService.getInvoice(params(req).id, ctx.tenantId);
    if (!inv) throw AppError.notFound('Invoice');
    reply.send({ data: inv });
  });

  app.post('/billing/invoices/:id/issue', async (req, reply) => {
    const ctx = req.ctx;
    const inv = billingService.issueInvoice(params(req).id, ctx.tenantId);
    if (!inv) throw AppError.notFound('Invoice');
    reply.send({ data: inv });
  });

  app.post('/billing/invoices/:id/pay', async (req, reply) => {
    const ctx = req.ctx;
    const inv = billingService.markPaid(params(req).id, ctx.tenantId);
    if (!inv) throw AppError.notFound('Invoice');
    reply.send({ data: inv });
  });
}
