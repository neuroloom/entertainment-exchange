// Recurring booking routes — schedule repeating events with RRULE-like patterns
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { bookings } from './booking.js';
import { MemoryStore } from '../services/repo.js';
import { calculateQuote } from '@entex/orchestration';
import type { EventType } from '@entex/orchestration';

export interface RecurrenceSeries {
  id: string;
  tenantId: string;
  businessId: string;
  pattern: RecurrencePattern;
  templateBooking: Record<string, unknown>;
  occurrenceIds: string[];
  createdAt: string;
}

export interface RecurrencePattern {
  frequency: 'weekly' | 'biweekly' | 'monthly';
  interval: number;       // every N weeks/months
  daysOfWeek?: number[];  // 0=Sun..6=Sat for weekly
  daysOfMonth?: number[]; // 1-31 for monthly
  count?: number;         // max occurrences
  until?: string;         // end date (ISO)
}

const CreateRecurringSchema = z.object({
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  interval: z.number().int().min(1).default(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  daysOfMonth: z.array(z.number().int().min(1).max(31)).optional(),
  count: z.number().int().min(1).max(52).optional(),
  until: z.string().optional(),
  template: z.object({
    eventType: z.string().min(1),
    eventName: z.string().optional(),
    startTime: z.string().min(1),
    endTime: z.string().min(1),
    clientId: z.string().optional(),
    artistId: z.string().optional(),
    venueId: z.string().optional(),
    quotedAmountCents: z.number().int().optional(),
    durationHours: z.number().optional(),
    guestCount: z.number().int().optional(),
    addOns: z.array(z.string()).optional(),
    travelMiles: z.number().optional(),
    source: z.string().optional(),
    eventDate: z.string().optional(),
  }),
});

function expandDates(pattern: RecurrencePattern, startDateStr: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDateStr);
  const maxDate = pattern.until ? new Date(pattern.until) : new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
  const maxCount = pattern.count ?? 52;

  if (pattern.frequency === 'weekly' || pattern.frequency === 'biweekly') {
    const intervalWeeks = pattern.frequency === 'biweekly' ? pattern.interval * 2 : pattern.interval;
    const targetDays = pattern.daysOfWeek ?? [start.getDay()];

    let cursor = new Date(start);
    cursor.setDate(cursor.getDate() - 1); // Start day before to catch start week

    while (dates.length < maxCount && cursor <= maxDate) {
      cursor.setDate(cursor.getDate() + 1);
      if (targetDays.includes(cursor.getDay()) && cursor >= start) {
        const weekDiff = Math.floor((cursor.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weekDiff % intervalWeeks === 0) {
          dates.push(cursor.toISOString().slice(0, 10));
        }
      }
      // Safety: max 366 iterations
      if (cursor.getTime() - start.getTime() > 400 * 24 * 60 * 60 * 1000) break;
    }
  } else {
    // Monthly
    const targetDays = pattern.daysOfMonth ?? [start.getDate()];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

    while (dates.length < maxCount && cursor <= maxDate) {
      for (const day of targetDays) {
        const d = new Date(cursor.getFullYear(), cursor.getMonth(), day);
        if (d >= start && d <= maxDate && dates.length < maxCount && day <= new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) {
          const monthsSince = (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth();
          if (monthsSince % pattern.interval === 0) {
            const isoDate = d.toISOString().slice(0, 10);
            if (!dates.includes(isoDate)) dates.push(isoDate);
          }
        }
      }
      cursor.setMonth(cursor.getMonth() + 1);
      if (cursor.getTime() - start.getTime() > 400 * 24 * 60 * 60 * 1000) break;
    }
  }

  return dates;
}

export const recurrenceSeries = new MemoryStore<RecurrenceSeries>('recurrence_series');

export async function recurringRoutes(app: FastifyInstance) {
  app.post('/bookings/recurring', {
    schema: {
      body: {
        type: 'object',
        required: ['frequency', 'template'],
        properties: {
          frequency: { type: 'string', enum: ['weekly', 'biweekly', 'monthly'] },
          interval: { type: 'integer', minimum: 1 },
          daysOfWeek: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
          daysOfMonth: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 31 } },
          count: { type: 'integer', minimum: 1, maximum: 52 },
          until: { type: 'string' },
          template: {
            type: 'object',
            required: ['eventType', 'startTime', 'endTime'],
            properties: {
              eventType: { type: 'string', minLength: 1 },
              eventName: { type: 'string' },
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
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:create')) throw AppError.forbidden('Missing booking:create permission');

    const body = CreateRecurringSchema.parse(req.body);
    const tmpl = body.template;

    // First event date comes from the template if it has eventDate, or tomorrow
    const startDate = tmpl.eventDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const pattern: RecurrencePattern = {
      frequency: body.frequency,
      interval: body.interval,
      daysOfWeek: body.daysOfWeek,
      daysOfMonth: body.daysOfMonth,
      count: body.count,
      until: body.until,
    };

    const dates = expandDates(pattern, startDate);
    if (dates.length === 0) {
      throw AppError.invalid('Recurrence pattern produced zero dates within the specified range');
    }

    const seriesId = uuid();
    const occurrenceIds: string[] = [];

    for (const date of dates) {
      const bookingId = uuid();

      let quote: ReturnType<typeof calculateQuote> | null = null;
      if (tmpl.eventType && tmpl.durationHours !== undefined && tmpl.guestCount !== undefined) {
        quote = calculateQuote({
          eventType: tmpl.eventType as EventType, durationHours: tmpl.durationHours,
          guestCount: tmpl.guestCount, addOns: tmpl.addOns ?? [], travelMiles: tmpl.travelMiles ?? 0,
        });
      }

      const booking = {
        id: bookingId, tenantId: ctx.tenantId, businessId: ctx.businessId,
        clientId: tmpl.clientId ?? null, artistId: tmpl.artistId ?? null, venueId: tmpl.venueId ?? null,
        status: 'inquiry', eventType: tmpl.eventType, eventName: tmpl.eventName ?? null,
        eventDate: date, startTime: tmpl.startTime, endTime: tmpl.endTime,
        quotedAmountCents: tmpl.quotedAmountCents ?? quote?.totalCents ?? null,
        totalAmountCents: null, depositAmountCents: null,
        source: tmpl.source ?? null, metadata: { recurrenceSeriesId: seriesId, recurrenceIndex: occurrenceIds.length },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      bookings.set(booking);
      occurrenceIds.push(bookingId);
    }

    const series: RecurrenceSeries = {
      id: seriesId, tenantId: ctx.tenantId, businessId: ctx.businessId ?? '',
      pattern, templateBooking: tmpl as Record<string, unknown>,
      occurrenceIds, createdAt: new Date().toISOString(),
    };
    recurrenceSeries.set(series);

    reply.status(201).send({
      data: {
        seriesId,
        pattern,
        occurrenceCount: occurrenceIds.length,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        occurrences: occurrenceIds,
      },
    });
  });

  // GET /bookings/recurring/:seriesId — get a series with all its bookings
  app.get('/bookings/recurring/:seriesId', async (req, reply) => {
    const ctx = req.ctx;
    const series = recurrenceSeries.get(params(req).seriesId);
    if (!series || series.tenantId !== ctx.tenantId) throw AppError.notFound('Recurrence series');

    const occurrences = series.occurrenceIds
      .map(id => bookings.get(id))
      .filter(Boolean);

    reply.send({
      data: {
        series: { id: series.id, pattern: series.pattern, createdAt: series.createdAt },
        occurrences,
      },
    });
  });
}
