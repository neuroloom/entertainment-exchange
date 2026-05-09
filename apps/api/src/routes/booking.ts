// Booking routes — CRUD + confirm/cancel, client, artist, venue references
// Task 006: POST /bookings, GET /bookings, GET /bookings/:id, PATCH /bookings/:id/status
// Sprint 3a: POST /bookings/:id/cancel, paginated GET /bookings
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { assertBookingTransition, calculateQuote, BookingStateError, isTerminalState } from '@entex/orchestration';
import type { BookingState, EventType } from '@entex/orchestration';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { MemoryStore, JournalStore } from '../services/repo.js';
import { getBusinessAccountMap } from './ledger.js';
import { webhookService } from '../services/webhook.service.js';
import { detectConflicts } from '../services/conflict-detector.service.js';
import { generateIcalFeed } from '../services/ical.service.js';
import { notificationService } from '../services/notification.service.js';
import { realtime } from '../services/realtime.service.js';
import { slackService } from '../services/slack.service.js';

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

const UpdateBookingSchema = z.object({
  eventType: z.string().min(1).optional(),
  eventName: z.string().optional(),
  eventDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  clientId: z.string().uuid().optional(),
  artistId: z.string().uuid().optional(),
  venueId: z.string().uuid().optional(),
  quotedAmountCents: z.number().int().min(0).optional(),
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export interface Booking {
  id: string;
  tenantId: string;
  businessId: string | undefined;
  clientId: string | null;
  artistId: string | null;
  venueId: string | null;
  status: string;
  eventType: string;
  eventName: string | null;
  eventDate: string;
  startTime: string;
  endTime: string;
  quotedAmountCents: number | null;
  totalAmountCents: number | null;
  depositAmountCents: number | null;
  source: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const bookings = new MemoryStore<Booking>('bookings');

export const journals = new JournalStore();

import { writeAudit } from '../services/audit-helpers.js';

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
    const ctx = req.ctx;
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
        eventType: body.eventType as EventType,
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
    // Conflict detection for artist/venue double-booking
    const conflictResult = detectConflicts(
      { eventDate: booking.eventDate, startTime: booking.startTime, endTime: booking.endTime },
      bookings.all(ctx.tenantId),
      booking.artistId,
      booking.venueId,
    );

    bookings.set(booking);
    writeAudit(ctx, 'booking.create', 'booking', bookingId, ctx.businessId);

    void webhookService.emit('booking.created', {
      tenantId: ctx.tenantId, businessId: ctx.businessId, resourceId: bookingId,
      payload: { id: bookingId, eventType: body.eventType, eventDate: body.eventDate, status: 'draft', quote: quote ?? null },
    });
    reply.status(201).send({
      data: { ...booking, quote: quote ?? undefined },
      warnings: conflictResult.hasConflict ? { conflicts: conflictResult.conflicts } : undefined,
    });
  });

  // POST /bookings/batch — create multiple bookings with partial success
  app.post('/bookings/batch', {
    schema: {
      body: {
        type: 'object',
        required: ['bookings'],
        properties: {
          bookings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['eventType', 'eventDate', 'startTime', 'endTime'],
              properties: {
                eventType: { type: 'string', minLength: 1 },
                eventName: { type: 'string' },
                eventDate: { type: 'string', minLength: 1 },
                startTime: { type: 'string', minLength: 1 },
                endTime: { type: 'string', minLength: 1 },
                clientId: { type: 'string' },
                artistId: { type: 'string' },
                venueId: { type: 'string' },
                quotedAmountCents: { type: 'integer' },
                durationHours: { type: 'number' },
                guestCount: { type: 'integer' },
                addOns: { type: 'array', items: { type: 'string' } },
                travelMiles: { type: 'number' },
                source: { type: 'string' },
                metadata: { type: 'object' },
              },
            },
            minItems: 1,
            maxItems: 100,
          },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:create')) throw AppError.forbidden('Missing booking:create permission');

    const body = z.object({ bookings: z.array(z.record(z.unknown())) }).parse(req.body);
    const results: Array<{ status: 'created' | 'failed'; id?: string; error?: string }> = [];

    for (const item of body.bookings) {
      try {
        const parsed = CreateBookingSchema.parse(item);
        const bookingId = uuid();

        let quote: ReturnType<typeof calculateQuote> | null = null;
        if (parsed.eventType && parsed.durationHours !== undefined && parsed.guestCount !== undefined) {
          quote = calculateQuote({
            eventType: parsed.eventType as EventType, durationHours: parsed.durationHours,
            guestCount: parsed.guestCount, addOns: parsed.addOns ?? [], travelMiles: parsed.travelMiles ?? 0,
          });
        }

        const booking = {
          id: bookingId, tenantId: ctx.tenantId, businessId: ctx.businessId,
          clientId: parsed.clientId ?? null, artistId: parsed.artistId ?? null, venueId: parsed.venueId ?? null,
          status: 'inquiry', eventType: parsed.eventType, eventName: parsed.eventName ?? null,
          eventDate: parsed.eventDate, startTime: parsed.startTime, endTime: parsed.endTime,
          quotedAmountCents: parsed.quotedAmountCents ?? quote?.totalCents ?? null,
          totalAmountCents: null, depositAmountCents: null, source: parsed.source ?? null,
          metadata: parsed.metadata ?? {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        bookings.set(booking);

        writeAudit(ctx, 'booking.create', 'booking', bookingId, ctx.businessId);
        void webhookService.emit('booking.created', {
          tenantId: ctx.tenantId, businessId: ctx.businessId, resourceId: bookingId,
          payload: { id: bookingId, eventType: parsed.eventType, eventDate: parsed.eventDate, status: 'inquiry', quote: quote ?? null },
        });

        results.push({ status: 'created', id: bookingId });
      } catch (err) {
        results.push({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    reply.status(207).send({
      data: results,
      meta: { total: body.bookings.length, created, failed: body.bookings.length - created },
    });
  });

  app.get('/bookings', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const p = paginate(req.query);
    const all = bookings.all(ctx.tenantId);
    const sliced = all.slice(p.offset, p.offset + p.limit);

    reply.send(paginatedResponse(sliced, all.length, p));
  });

  app.get('/bookings/:id', async (req, reply) => {
    const ctx = req.ctx;
    const b = bookings.get(params(req).id);
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
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:manage')) throw AppError.forbidden('Missing booking:manage permission');

    const booking = bookings.get(params(req).id);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    if (isTerminalState(booking.status as BookingState)) {
      throw AppError.invalid(`Cannot update a booking in terminal "${booking.status}" state`);
    }

    const body = UpdateBookingSchema.parse(req.body);

    if (body.eventType !== undefined) booking.eventType = body.eventType;
    if (body.eventName !== undefined) booking.eventName = body.eventName ?? null;
    if (body.eventDate !== undefined) booking.eventDate = body.eventDate;
    if (body.startTime !== undefined) booking.startTime = body.startTime;
    if (body.endTime !== undefined) booking.endTime = body.endTime;
    if (body.clientId !== undefined) booking.clientId = body.clientId ?? null;
    if (body.artistId !== undefined) booking.artistId = body.artistId ?? null;
    if (body.venueId !== undefined) booking.venueId = body.venueId ?? null;
    if (body.quotedAmountCents !== undefined) booking.quotedAmountCents = body.quotedAmountCents;
    if (body.source !== undefined) booking.source = body.source ?? null;
    if (body.metadata !== undefined) booking.metadata = body.metadata;

    booking.updatedAt = new Date().toISOString();
    bookings.set(booking);

    const changed = (Object.keys(body) as Array<keyof typeof body>).filter(k => body[k] !== undefined);
    writeAudit(ctx, 'booking.update', 'booking', booking.id, booking.businessId, { changed });
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
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:confirm')) throw AppError.forbidden('Missing booking:confirm permission');

    const booking = bookings.get(params(req).id);
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

    if (body.status === 'confirmed') {
      void webhookService.emit('booking.confirmed', {
        tenantId: ctx.tenantId, businessId: booking.businessId, resourceId: booking.id,
        payload: { id: booking.id, eventType: booking.eventType, eventDate: booking.eventDate, status: body.status },
      });
      if (booking.clientId) {
        void notificationService.send({
          tenantId: ctx.tenantId, userId: booking.clientId, type: 'booking_confirmed',
          channels: ['in_app'], vars: { eventName: booking.eventName ?? booking.eventType, eventDate: booking.eventDate, status: 'confirmed' },
        });
      }
      realtime.publish(ctx.tenantId, 'booking.confirmed', { id: booking.id, status: 'confirmed', eventDate: booking.eventDate });
      void slackService.notify(ctx.tenantId, 'booking.confirmed', {
        id: booking.id, eventName: booking.eventName ?? booking.eventType,
        eventDate: booking.eventDate, status: 'confirmed',
        quotedAmountCents: booking.quotedAmountCents ?? 0,
      });
    }

    reply.send({ data: booking });
  });

  app.post('/bookings/:id/cancel', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:confirm')) throw AppError.forbidden('Missing booking:confirm permission');

    const booking = bookings.get(params(req).id);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    if (isTerminalState(booking.status as BookingState)) {
      throw AppError.invalid(`Cannot cancel a booking in "${booking.status}" state`);
    }

    const previousStatus = booking.status;

    // Create a reversal journal entry if the booking had been confirmed
    if (previousStatus === 'confirmed' || previousStatus === 'contracted') {
      const acctMap = getBusinessAccountMap(booking.businessId ?? '');
      const deferredRevId = acctMap.get('2000');
      const bookingRevId = acctMap.get('4000');

      if (deferredRevId && bookingRevId && booking.quotedAmountCents) {
        const journalId = uuid();
        journals.addJournal(
          {
            id: journalId,
            tenantId: ctx.tenantId,
            businessId: booking.businessId ?? '',
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

    void webhookService.emit('booking.cancelled', {
      tenantId: ctx.tenantId, businessId: booking.businessId, resourceId: booking.id,
      payload: { id: booking.id, eventType: booking.eventType, eventDate: booking.eventDate, previousStatus },
    });
    if (booking.clientId) {
      void notificationService.send({
        tenantId: ctx.tenantId, userId: booking.clientId, type: 'booking_cancelled',
        channels: ['in_app'], vars: { eventName: booking.eventName ?? booking.eventType, eventDate: booking.eventDate },
      });
    }
    realtime.publish(ctx.tenantId, 'booking.cancelled', { id: booking.id, eventDate: booking.eventDate });
    void slackService.notify(ctx.tenantId, 'booking.cancelled', {
      id: booking.id, eventName: booking.eventName ?? booking.eventType,
      eventDate: booking.eventDate,
    });

    reply.send({ data: booking });
  });

  // GET /bookings/calendar.ics — iCal feed for calendar subscription
  app.get('/bookings/calendar.ics', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    let items = bookings.all(ctx.tenantId);

    // Filter by artist or venue
    if (query.artistId) items = items.filter(b => b.artistId === query.artistId);
    if (query.venueId) items = items.filter(b => b.venueId === query.venueId);
    if (query.businessId) items = items.filter(b => b.businessId === query.businessId);

    // Exclude cancelled
    items = items.filter(b => b.status !== 'cancelled');

    const cal = generateIcalFeed(items);
    reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'inline; filename="bookings.ics"')
      .send(cal);
  });
}
