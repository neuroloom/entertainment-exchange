// Event check-in routes — attendance tracking with check-in codes and status
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { bookings } from './booking.js';
import { MemoryStore } from '../services/repo.js';

export interface CheckInRecord {
  id: string;
  tenantId: string;
  bookingId: string;
  checkInCode: string;
  status: 'pending' | 'checked_in' | 'no_show' | 'cancelled';
  guestCount?: number;
  checkedInAt?: string;
  checkedInBy?: string;
  notes?: string;
  createdAt: string;
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

const checkIns = new MemoryStore<CheckInRecord>('check_ins');

const CheckInSchema = z.object({
  guestCount: z.number().int().min(0).optional(),
  checkedInBy: z.string().optional(),
});

export async function checkInRoutes(app: FastifyInstance) {
  // POST /bookings/:id/check-in — generate a check-in code for a booking
  app.post('/bookings/:id/check-in', async (req, reply) => {
    const ctx = req.ctx;
    const bookingId = params(req).id;
    const booking = bookings.get(bookingId);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    // Ensure not already checked in
    const existing = checkIns.find(c => c.bookingId === bookingId && c.status === 'checked_in');
    if (existing) throw AppError.invalid('Booking already checked in');

    const code = generateCode();
    const record: CheckInRecord = {
      id: uuid(), tenantId: ctx.tenantId, bookingId, checkInCode: code,
      status: 'pending', createdAt: new Date().toISOString(),
    };
    checkIns.set(record);
    reply.status(201).send({ data: { id: record.id, bookingId, checkInCode: code, status: 'pending' } });
  });

  // POST /bookings/:id/arrive — confirm check-in
  app.post('/bookings/:id/arrive', {
    schema: {
      body: {
        type: 'object',
        properties: {
          guestCount: { type: 'integer', minimum: 0 },
          checkedInBy: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const bookingId = params(req).id;
    const booking = bookings.get(bookingId);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    const body = CheckInSchema.parse(req.body ?? {});
    const now = new Date().toISOString();

    // Find existing pending record or create one
    let record = checkIns.find(c => c.bookingId === bookingId && c.status === 'pending');
    if (!record) {
      record = {
        id: uuid(), tenantId: ctx.tenantId, bookingId, checkInCode: generateCode(),
        status: 'pending', createdAt: now,
      };
    }

    record.status = 'checked_in';
    record.guestCount = body.guestCount;
    record.checkedInAt = now;
    record.checkedInBy = body.checkedInBy;
    checkIns.set(record);

    reply.send({
      data: {
        id: record.id, bookingId, status: 'checked_in',
        guestCount: record.guestCount, checkedInAt: now,
      },
    });
  });

  // POST /bookings/:id/no-show — mark as no-show
  app.post('/bookings/:id/no-show', async (req, reply) => {
    const ctx = req.ctx;
    const bookingId = params(req).id;
    const booking = bookings.get(bookingId);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    const now = new Date().toISOString();
    let record = checkIns.find(c => c.bookingId === bookingId);
    if (!record) {
      record = {
        id: uuid(), tenantId: ctx.tenantId, bookingId, checkInCode: generateCode(),
        status: 'no_show', createdAt: now,
      };
    }
    record.status = 'no_show';
    checkIns.set(record);

    reply.send({ data: { id: record.id, bookingId, status: 'no_show' } });
  });

  // GET /bookings/:id/check-in — get check-in status
  app.get('/bookings/:id/check-in', async (req, reply) => {
    const ctx = req.ctx;
    const bookingId = params(req).id;
    const booking = bookings.get(bookingId);
    if (!booking || booking.tenantId !== ctx.tenantId) throw AppError.notFound('Booking');

    const record = checkIns.find(c => c.bookingId === bookingId);
    reply.send({ data: record ?? { bookingId, status: 'not_created' } });
  });

  // GET /check-ins — list all check-ins for the tenant
  app.get('/check-ins', async (req, reply) => {
    const ctx = req.ctx;
    const all = checkIns.all(ctx.tenantId);
    const p = paginate(req.query);
    const sliced = all.slice(p.offset, p.offset + p.limit);
    reply.send(paginatedResponse(sliced, all.length, p));
  });
}
