// Stripe payment routes — expose Stripe payment processing endpoints
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { stripeService } from '../services/stripe.service.js';
import { writeAudit } from '../services/audit-helpers.js';

const CreateIntentSchema = z.object({
  amountCents: z.number().int().min(1),
  currency: z.string().length(3).default('usd'),
  bookingId: z.string().uuid().optional(),
  metadata: z.record(z.string()).optional(),
});

const CreateCheckoutSchema = z.object({
  amountCents: z.number().int().min(1),
  currency: z.string().length(3).default('usd'),
  bookingId: z.string().uuid().optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  description: z.string().min(1),
});

export async function stripeRoutes(app: FastifyInstance) {
  app.post('/payments/create-intent', {
    schema: {
      body: {
        type: 'object',
        required: ['amountCents'],
        properties: {
          amountCents: { type: 'integer', minimum: 1 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          bookingId: { type: 'string', format: 'uuid' },
          metadata: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = CreateIntentSchema.parse(req.body);
    const result = await stripeService.createPaymentIntent({
      amountCents: body.amountCents,
      currency: body.currency,
      bookingId: body.bookingId,
      tenantId: ctx.tenantId,
      metadata: body.metadata,
    });

    if ('error' in result) throw AppError.invalid(result.error);
    writeAudit(ctx, 'payment.intent_created', 'payment', result.id, undefined, { amountCents: result.amountCents, currency: result.currency });
    reply.status(201).send({ data: result });
  });

  app.post('/payments/checkout-session', {
    schema: {
      body: {
        type: 'object',
        required: ['amountCents', 'successUrl', 'cancelUrl', 'description'],
        properties: {
          amountCents: { type: 'integer', minimum: 1 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          bookingId: { type: 'string', format: 'uuid' },
          successUrl: { type: 'string', format: 'uri' },
          cancelUrl: { type: 'string', format: 'uri' },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = CreateCheckoutSchema.parse(req.body);
    const result = await stripeService.createCheckoutSession({
      amountCents: body.amountCents,
      currency: body.currency,
      bookingId: body.bookingId,
      tenantId: ctx.tenantId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      description: body.description,
    });

    if ('error' in result) throw AppError.invalid(result.error);
    writeAudit(ctx, 'payment.checkout_session', 'payment', result.id);
    reply.status(201).send({ data: result });
  });

  app.get('/payments/:id', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const { id } = params(req);
    const result = await stripeService.retrievePaymentIntent(id);
    if ('error' in result) throw AppError.notFound('Payment intent');
    reply.send({ data: result });
  });

  app.post('/stripe/webhook', async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) throw AppError.invalid('Missing stripe-signature header');

    const payload = JSON.stringify(req.body);
    const valid = stripeService.verifyWebhookSignature(payload, signature);
    if (!valid) throw AppError.invalid('Invalid webhook signature');

    // In production, process the event (payment_intent.succeeded, etc.)
    // and trigger downstream actions (confirm booking, send notifications)
    const event = z.object({ type: z.string(), id: z.string().optional() }).passthrough().parse(req.body);
    const eventType = event.type;
    req.log?.info({ eventType, eventId: event.id }, 'Stripe webhook received');

    reply.send({ received: true });
  });
}
