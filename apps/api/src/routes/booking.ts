// Booking routes — CRUD + confirm/cancel, client, artist, venue references
// Task 006: POST /bookings, GET /bookings, GET /bookings/:id, PATCH /bookings/:id/status
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { assertBookingTransition, calculateQuote, BookingStateError } from '@entertainment-exchange/orchestration';
import type { BookingState } from '@entertainment-exchange/orchestration';
import { MemoryStore, AuditStore } from '../services/repo.js';

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
  status: z.enum(['inquiry', 'tentative', 'confirmed', 'contracted', 'completed', 'cancelled']),
  reason: z.string().optional(),
});

const bookings = new MemoryStore('bookings');
const auditEvents = new AuditStore();

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function bookingRoutes(app: FastifyInstance) {
  app.post('/bookings', async (req, reply) => {
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
    const all = bookings.all(ctx.tenantId);
    reply.send({ data: all });
  });

  app.get('/bookings/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const b = bookings.get((req.params as any).id);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');
    reply.send({ data: b });
  });

  app.patch('/bookings/:id/status', async (req, reply) => {
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
}
