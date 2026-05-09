// Commission split routes — calculate and manage payout splits for bookings
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { bookings } from './booking.js';
import { computeSplits, type SplitParty } from '../services/commission-splits.service.js';

const ComputeSplitSchema = z.object({
  totalCents: z.number().int().min(1),
  template: z.enum(['artist80_venue20', 'artist60_venue30_agent10', 'artist70_venue20_platform10', 'custom']).default('artist80_venue20'),
  parties: z.array(z.object({
    partyType: z.enum(['artist', 'venue', 'agent', 'platform']),
    partyId: z.string().optional(),
    name: z.string(),
    percentageBps: z.number().int().min(0).max(10000),
    fixedFeeCents: z.number().int().min(0),
  })).optional(),
});

const templateMap: Record<string, SplitParty[]> = {
  artist80_venue20: [
    { partyType: 'artist', name: 'Artist', percentageBps: 8000, fixedFeeCents: 0 },
    { partyType: 'venue', name: 'Venue', percentageBps: 2000, fixedFeeCents: 0 },
  ],
  artist60_venue30_agent10: [
    { partyType: 'artist', name: 'Artist', percentageBps: 6000, fixedFeeCents: 0 },
    { partyType: 'venue', name: 'Venue', percentageBps: 3000, fixedFeeCents: 0 },
    { partyType: 'agent', name: 'Agent', percentageBps: 1000, fixedFeeCents: 0 },
  ],
  artist70_venue20_platform10: [
    { partyType: 'artist', name: 'Artist', percentageBps: 7000, fixedFeeCents: 0 },
    { partyType: 'venue', name: 'Venue', percentageBps: 2000, fixedFeeCents: 0 },
    { partyType: 'platform', name: 'Platform', percentageBps: 1000, fixedFeeCents: 0 },
  ],
};

export async function splitRoutes(app: FastifyInstance) {
  // POST /splits/compute — compute split for a given amount
  app.post('/splits/compute', {
    schema: {
      body: {
        type: 'object',
        required: ['totalCents'],
        properties: {
          totalCents: { type: 'integer', minimum: 1 },
          template: { type: 'string', enum: ['artist80_venue20', 'artist60_venue30_agent10', 'artist70_venue20_platform10', 'custom'] },
          parties: {
            type: 'array',
            items: {
              type: 'object',
              required: ['partyType', 'name', 'percentageBps', 'fixedFeeCents'],
              properties: {
                partyType: { type: 'string', enum: ['artist', 'venue', 'agent', 'platform'] },
                partyId: { type: 'string' },
                name: { type: 'string' },
                percentageBps: { type: 'integer', minimum: 0, maximum: 10000 },
                fixedFeeCents: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = ComputeSplitSchema.parse(req.body);
    const parties = body.template === 'custom'
      ? body.parties!
      : templateMap[body.template];

    if (!parties || parties.length === 0) {
      throw AppError.invalid('At least one party is required');
    }

    const result = computeSplits(body.totalCents, parties);
    reply.send({ data: result });
  });

  // GET /splits/bookings/:id — compute split for a specific booking
  app.get('/splits/bookings/:id', async (req, reply) => {
    const ctx = req.ctx;
    const booking = bookings.get(params(req).id);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    const totalCents = booking.totalAmountCents ?? booking.quotedAmountCents ?? 0;
    if (totalCents <= 0) {
      throw AppError.invalid('Booking has no amount set');
    }

    const parties = templateMap.artist60_venue30_agent10;
    const result = computeSplits(totalCents, parties);

    reply.send({
      data: {
        bookingId: booking.id,
        eventName: booking.eventName,
        totalCents,
        split: result,
      },
    });
  });

  // GET /splits/templates — list available templates
  app.get('/splits/templates', async (_req, reply) => {
    reply.send({
      data: {
        artist80_venue20: { description: 'Artist 80% / Venue 20%', parties: templateMap.artist80_venue20 },
        artist60_venue30_agent10: { description: 'Artist 60% / Venue 30% / Agent 10%', parties: templateMap.artist60_venue30_agent10 },
        artist70_venue20_platform10: { description: 'Artist 70% / Venue 20% / Platform 10%', parties: templateMap.artist70_venue20_platform10 },
        custom: { description: 'Custom split with your own parties and percentages' },
      },
    });
  });
}
