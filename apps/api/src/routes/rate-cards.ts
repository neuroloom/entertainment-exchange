// Rate card routes — reusable pricing templates for common booking types
// Enables fast quoting with predefined rates instead of computing from scratch each time
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { MemoryStore } from '../services/repo.js';

export interface RateCard {
  id: string;
  tenantId: string;
  businessId: string;
  name: string;
  eventType: string;
  baseRateCents: number;
  hourlyRateCents: number;
  perGuestRateCents: number;
  addOnRates: Record<string, number>;
  travelRatePerMile: number;
  minimumCents: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const CreateRateCardSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().min(1),
  eventType: z.string().min(1),
  baseRateCents: z.number().int().min(0),
  hourlyRateCents: z.number().int().min(0).default(0),
  perGuestRateCents: z.number().int().min(0).default(0),
  addOnRates: z.record(z.number()).default({}),
  travelRatePerMile: z.number().min(0).default(0),
  minimumCents: z.number().int().min(0).default(0),
  metadata: z.record(z.unknown()).default({}),
});

const UpdateRateCardSchema = z.object({
  name: z.string().min(1).optional(),
  baseRateCents: z.number().int().min(0).optional(),
  hourlyRateCents: z.number().int().min(0).optional(),
  perGuestRateCents: z.number().int().min(0).optional(),
  addOnRates: z.record(z.number()).optional(),
  travelRatePerMile: z.number().min(0).optional(),
  minimumCents: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const rateCards = new MemoryStore<RateCard>('rate_cards');

function calculateTotal(rc: RateCard, hours: number, guests: number, addOns: string[], travelMiles: number): number {
  let total = rc.baseRateCents + rc.hourlyRateCents * hours + rc.perGuestRateCents * guests;
  for (const addon of addOns) {
    total += rc.addOnRates[addon] ?? 0;
  }
  total += rc.travelRatePerMile * travelMiles;
  return Math.max(rc.minimumCents, total);
}

export async function rateCardRoutes(app: FastifyInstance) {
  app.post('/rate-cards', {
    schema: {
      body: {
        type: 'object',
        required: ['businessId', 'name', 'eventType', 'baseRateCents'],
        properties: {
          businessId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1 },
          eventType: { type: 'string', minLength: 1 },
          baseRateCents: { type: 'integer', minimum: 0 },
          hourlyRateCents: { type: 'integer', minimum: 0 },
          perGuestRateCents: { type: 'integer', minimum: 0 },
          addOnRates: { type: 'object', additionalProperties: { type: 'number' } },
          travelRatePerMile: { type: 'number', minimum: 0 },
          minimumCents: { type: 'integer', minimum: 0 },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = CreateRateCardSchema.parse(req.body);
    const now = new Date().toISOString();
    const rc: RateCard = {
      id: uuid(), tenantId: ctx.tenantId, ...body, createdAt: now, updatedAt: now,
    };
    rateCards.set(rc);
    reply.status(201).send({ data: rc });
  });

  app.get('/rate-cards', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    let all = rateCards.all(ctx.tenantId);
    if (query.businessId) all = all.filter(rc => rc.businessId === query.businessId);
    if (query.eventType) all = all.filter(rc => rc.eventType === query.eventType);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/rate-cards/:id', async (req, reply) => {
    const ctx = req.ctx;
    const rc = rateCards.get(params(req).id);
    if (!rc || rc.tenantId !== ctx.tenantId) throw AppError.notFound('Rate card');
    reply.send({ data: rc });
  });

  app.patch('/rate-cards/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          baseRateCents: { type: 'integer', minimum: 0 },
          hourlyRateCents: { type: 'integer', minimum: 0 },
          perGuestRateCents: { type: 'integer', minimum: 0 },
          addOnRates: { type: 'object', additionalProperties: { type: 'number' } },
          travelRatePerMile: { type: 'number', minimum: 0 },
          minimumCents: { type: 'integer', minimum: 0 },
          metadata: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const rc = rateCards.get(params(req).id);
    if (!rc || rc.tenantId !== ctx.tenantId) throw AppError.notFound('Rate card');

    const body = UpdateRateCardSchema.parse(req.body);
    Object.assign(rc, body, { updatedAt: new Date().toISOString() });
    rateCards.set(rc);
    reply.send({ data: rc });
  });

  app.delete('/rate-cards/:id', async (req, reply) => {
    const ctx = req.ctx;
    const rc = rateCards.get(params(req).id);
    if (!rc || rc.tenantId !== ctx.tenantId) throw AppError.notFound('Rate card');
    rateCards.delete(rc.id);
    reply.send({ data: { deleted: true } });
  });

  // POST /rate-cards/:id/quote — get a quick quote from a rate card
  app.post('/rate-cards/:id/quote', {
    schema: {
      body: {
        type: 'object',
        required: ['hours', 'guests'],
        properties: {
          hours: { type: 'number', minimum: 0 },
          guests: { type: 'integer', minimum: 0 },
          addOns: { type: 'array', items: { type: 'string' } },
          travelMiles: { type: 'number', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const rc = rateCards.get(params(req).id);
    if (!rc || rc.tenantId !== ctx.tenantId) throw AppError.notFound('Rate card');

    const body = z.object({ hours: z.number().min(0), guests: z.number().int().min(1), addOns: z.array(z.string()).optional(), travelMiles: z.number().min(0).optional() }).parse(req.body);
    const total = calculateTotal(rc, body.hours, body.guests, body.addOns ?? [], body.travelMiles ?? 0);

    reply.send({
      data: {
        rateCardId: rc.id,
        rateCardName: rc.name,
        inputs: { hours: body.hours, guests: body.guests, addOns: body.addOns ?? [], travelMiles: body.travelMiles ?? 0 },
        breakdown: {
          base: rc.baseRateCents,
          hourly: rc.hourlyRateCents * body.hours,
          perGuest: rc.perGuestRateCents * body.guests,
          addOns: (body.addOns ?? []).reduce((s, a) => s + (rc.addOnRates[a] ?? 0), 0),
          travel: rc.travelRatePerMile * (body.travelMiles ?? 0),
        },
        totalCents: total,
      },
    });
  });
}
