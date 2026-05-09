// Payment link routes — generate and track payment links for bookings and deals
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { paymentLinks } from '../services/payment-links.service.js';

export async function paymentLinkRoutes(app: FastifyInstance) {
  app.post('/payment-links', {
    schema: {
      body: {
        type: 'object',
        required: ['amountCents', 'description'],
        properties: {
          bookingId: { type: 'string' },
          dealId: { type: 'string' },
          amountCents: { type: 'integer', minimum: 1 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          description: { type: 'string', minLength: 1 },
          expiresInHours: { type: 'integer', minimum: 1, maximum: 720 },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = z.object({
      bookingId: z.string().optional(),
      dealId: z.string().optional(),
      amountCents: z.number().int().min(1),
      currency: z.string().length(3).optional(),
      description: z.string().min(1),
      expiresInHours: z.number().int().min(1).max(720).optional(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(req.body);
    const link = paymentLinks.create({
      tenantId: ctx.tenantId, ...body,
    });
    reply.status(201).send({ data: link });
  });

  app.get('/payment-links', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    let all = paymentLinks.listByTenant(ctx.tenantId);
    if (query.bookingId) all = all.filter(l => l.bookingId === query.bookingId);
    if (query.status) all = all.filter(l => l.status === query.status);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/payment-links/:id', async (req, reply) => {
    const ctx = req.ctx;
    const l = paymentLinks.get(params(req).id, ctx.tenantId);
    if (!l) throw AppError.notFound('Payment link');
    reply.send({ data: l });
  });

  app.post('/payment-links/:id/pay', {
    schema: {
      body: {
        type: 'object',
        properties: { amountCents: { type: 'integer', minimum: 0 } },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ amountCents: z.number().int().min(0).optional() }).optional().parse(req.body);
    const l = paymentLinks.markPaid(params(req).id, ctx.tenantId, body?.amountCents);
    if (!l) throw AppError.notFound('Payment link');
    if (l.status !== 'paid') throw AppError.invalid('Payment link is no longer payable');
    reply.send({ data: l });
  });

  app.post('/payment-links/:id/cancel', async (req, reply) => {
    const ctx = req.ctx;
    const ok = paymentLinks.cancelLink(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Payment link');
    reply.send({ data: { cancelled: true } });
  });

  app.get('/payment-links/stats', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: paymentLinks.stats(ctx.tenantId) });
  });
}
