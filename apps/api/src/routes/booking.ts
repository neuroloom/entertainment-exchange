// Booking routes — CRUD + confirm/cancel, client, artist, venue references
// Task 006: POST /bookings, GET /bookings, GET /bookings/:id, PATCH /bookings/:id/status
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';

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
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const PatchBookingStatusSchema = z.object({
  status: z.enum(['inquiry', 'tentative', 'confirmed', 'contracted', 'completed', 'cancelled']),
  reason: z.string().optional(),
});

const bookings = new Map<string, any>();
const auditEvents: any[] = [];

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

    const booking = {
      id: bookingId, tenantId: ctx.tenantId, businessId: ctx.businessId,
      clientId: body.clientId ?? null, artistId: body.artistId ?? null, venueId: body.venueId ?? null,
      status: 'inquiry', eventType: body.eventType, eventName: body.eventName ?? null,
      eventDate: body.eventDate, startTime: body.startTime, endTime: body.endTime,
      quotedAmountCents: body.quotedAmountCents ?? null, totalAmountCents: null, depositAmountCents: null,
      source: body.source ?? null, metadata: body.metadata ?? {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    bookings.set(bookingId, booking);
    writeAudit(ctx, 'booking.create', 'booking', bookingId, ctx.businessId);
    reply.status(201).send({ data: booking });
  });

  app.get('/bookings', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const all = [...bookings.values()].filter(b => b.tenantId === ctx.tenantId);
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
    booking.status = body.status;
    booking.updatedAt = new Date().toISOString();
    bookings.set(booking.id, booking);

    writeAudit(ctx, 'booking.status', 'booking', booking.id, booking.businessId, { status: body.status, reason: body.reason });
    reply.send({ data: booking });
  });
}
