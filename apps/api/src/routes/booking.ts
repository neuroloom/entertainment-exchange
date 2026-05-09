// Booking routes — CRUD + confirm/cancel, client, artist, venue references
// Task 006: POST /bookings, GET /bookings, GET /bookings/:id, PATCH /bookings/:id/status
// Sprint 3a: POST /bookings/:id/cancel, paginated GET /bookings
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { assertBookingTransition, calculateQuote, BookingStateError, isTerminalState } from '@entertainment-exchange/orchestration';
import type { BookingState } from '@entertainment-exchange/orchestration';
import type { PaginatedResponse } from '@entertainment-exchange/shared';
import { MemoryStore, AuditStore, JournalStore } from '../services/repo.js';
import { getBusinessAccountMap } from './business.js';

const CreateBookingSchema = z.object({
  eventType: z.string().min(1),
  eventName: z.string().optional(),
  eventDate: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  clientId: z.string().uuid().optional(),
  artistId: z.string().uuid().optional(),
  venueId: z.string().uuid().optional(),
  quotedAmountCents: z.number().int().min(0).optional(),
  durationHours: z.number().min(0).optional(),
  guestCount: z.number().int().min(0).optional(),
  addOns: z.array(z.string()).optional(),
  travelMiles: z.number().min(0).optional(),
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const PatchBookingStatusSchema = z.object({
  status: z.enum(['inquiry', 'tentative', 'confirmed', 'contracted', 'completed', 'cancelled', 'refunded']),
  reason: z.string().optional(),
});

const bookings = new MemoryStore('bookings');
const auditEvents = new AuditStore();
const journals = new JournalStore();

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function bookingRoutes(app: FastifyInstance) {
  app.post('/bookings', {
    schema: {
      body: {
        type: 'object',
        required: ['eventType', 'eventDate', 'startTime', 'endTime'],
        properties: {
          eventType: { type: 'string', minLength: 1 },
          eventName: { type: 'string' },
          eventDate: { type: 'string', minLength: 1 },
          startTime: { type: 'string', minLength: 1 },
          endTime: { type: 'string', minLength: 1 },
          clientId: { type: 'string', format: 'uuid' },
          artistId: { type: 'string', format: 'uuid' },
          venueId: { type: 'string', format: 'uuid' },
          quotedAmountCents: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:create')) throw AppError.forbidden('Missing booking:create permission');

    const body = CreateBookingSchema.parse(req.body);
    const bookingId = uuid();

    // Compute a quote when relevant parameters are provided
    let quote: ReturnType<typeof calculateQuote> | null = null;
    if (
      body.eventType &&
      body.durationHours !== undefined &&
      body.guestCount !== undefined
    ) {
      quote = calculateQuote({
        eventType: body.eventType as any,
        durationHours: body.durationHours,
        guestCount: body.guestCount,
        addOns: body.addOns ?? [],
        travelMiles: body.travelMiles ?? 0,
      });
    }

    const booking = {
      id: bookingId, tenantId: ctx.tenantId, businessId: ctx.businessId,
      clientId: body.clientId ?? null, artistId: body.artistId ?? null, venueId: body.venueId ?? null,
      status: 'inquiry', eventType: body.eventType, eventName: body.eventName ?? null,
      eventDate: body.eventDate, startTime: body.startTime, endTime: body.endTime,
      quotedAmountCents: body.quotedAmountCents ?? quote?.totalCents ?? null,
      totalAmountCents: null, depositAmountCents: null,
      source: body.source ?? null, metadata: body.metadata ?? {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    bookings.set(booking);
    writeAudit(ctx, 'booking.create', 'booking', bookingId, ctx.businessId);
    reply.status(201).send({ data: { ...booking, quote: quote ?? undefined } });
  });

  app.get('/bookings', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const query = req.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const all = bookings.all(ctx.tenantId);
    const total = all.length;
    const data = all.slice(offset, offset + limit);

    const response: PaginatedResponse<typeof data[number]> = { data, total, limit, offset };
    reply.send(response);
  });

  app.get('/bookings/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const b = bookings.get((req.params as any).id);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');
    reply.send({ data: b });
  });

  app.put('/bookings/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          eventType: { type: 'string', minLength: 1 },
          eventName: { type: 'string' },
          eventDate: { type: 'string', minLength: 1 },
          startTime: { type: 'string', minLength: 1 },
          endTime: { type: 'string', minLength: 1 },
          clientId: { type: 'string', format: 'uuid' },
          artistId: { type: 'string', format: 'uuid' },
          venueId: { type: 'string', format: 'uuid' },
          quotedAmountCents: { type: 'integer', minimum: 0 },
          source: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:create')) throw AppError.forbidden('Missing booking:create permission');

    const booking = bookings.get((req.params as any).id);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    if (isTerminalState(booking.status as BookingState)) {
      throw AppError.invalid(`Cannot update a booking in terminal "${booking.status}" state`);
    }

    const body = req.body as Record<string, unknown>;

    if ('eventType' in body && body.eventType !== undefined) booking.eventType = body.eventType;
    if ('eventName' in body) booking.eventName = body.eventName ?? null;
    if ('eventDate' in body && body.eventDate !== undefined) booking.eventDate = body.eventDate;
    if ('startTime' in body && body.startTime !== undefined) booking.startTime = body.startTime;
    if ('endTime' in body && body.endTime !== undefined) booking.endTime = body.endTime;
    if ('clientId' in body) booking.clientId = body.clientId ?? null;
    if ('artistId' in body) booking.artistId = body.artistId ?? null;
    if ('venueId' in body) booking.venueId = body.venueId ?? null;
    if ('quotedAmountCents' in body && body.quotedAmountCents !== undefined) booking.quotedAmountCents = body.quotedAmountCents;
    if ('source' in body) booking.source = body.source ?? null;
    if ('metadata' in body && body.metadata !== undefined) booking.metadata = body.metadata;

    booking.updatedAt = new Date().toISOString();
    bookings.set(booking);

    writeAudit(ctx, 'booking.update', 'booking', booking.id, booking.businessId, { changed: Object.keys(body) });
    reply.send({ data: booking });
  });

  app.patch('/bookings/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['inquiry', 'tentative', 'confirmed', 'contracted', 'completed', 'cancelled', 'refunded'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:confirm')) throw AppError.forbidden('Missing booking:confirm permission');

    const booking = bookings.get((req.params as any).id);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    const body = PatchBookingStatusSchema.parse(req.body);

    // Validate the state transition — map orchestration errors to API errors
    try {
      assertBookingTransition(booking.status as BookingState, body.status as BookingState, body.reason);
    } catch (err) {
      if (err instanceof BookingStateError) {
        throw new AppError(err.code, err.message, err.status, err.details);
      }
      throw err;
    }

    booking.status = body.status;
    booking.updatedAt = new Date().toISOString();
    bookings.set(booking);

    writeAudit(ctx, 'booking.status', 'booking', booking.id, booking.businessId, { status: body.status, reason: body.reason });
    reply.send({ data: booking });
  });

  app.post('/bookings/:id/cancel', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:confirm')) throw AppError.forbidden('Missing booking:confirm permission');

    const booking = bookings.get((req.params as any).id);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    if (isTerminalState(booking.status as BookingState)) {
      throw AppError.invalid(`Cannot cancel a booking in "${booking.status}" state`);
    }

    const previousStatus = booking.status;

    // Create a reversal journal entry if the booking had been confirmed
    if (previousStatus === 'confirmed' || previousStatus === 'contracted') {
      const acctMap = getBusinessAccountMap(booking.businessId);
      const deferredRevId = acctMap.get('2000');
      const bookingRevId = acctMap.get('4000');

      if (deferredRevId && bookingRevId && booking.quotedAmountCents) {
        const journalId = uuid();
        journals.addJournal(
          {
            id: journalId,
            tenantId: ctx.tenantId,
            businessId: booking.businessId,
            memo: `Cancel booking ${booking.id} — reversal`,
            referenceType: 'booking',
            referenceId: booking.id,
            occurredAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          [
            { id: uuid(), tenantId: ctx.tenantId, journalId, accountId: deferredRevId, direction: 'debit', amountCents: booking.quotedAmountCents },
            { id: uuid(), tenantId: ctx.tenantId, journalId, accountId: bookingRevId, direction: 'credit', amountCents: booking.quotedAmountCents },
          ],
        );
      }
    }

    booking.status = 'cancelled';
    booking.updatedAt = new Date().toISOString();
    bookings.set(booking);

    writeAudit(ctx, 'booking.cancel', 'booking', booking.id, booking.businessId, { previousStatus });
    reply.send({ data: booking });
  });
}
