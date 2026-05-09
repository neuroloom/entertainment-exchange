// CSV import routes — bulk create businesses and bookings from CSV
import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { getOrCreateAccounts } from './ledger.js';

interface ImportResult {
  total: number;
  created: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw AppError.invalid('CSV must have a header row and at least one data row');

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

export async function importRoutes(app: FastifyInstance) {
  // POST /import/businesses — bulk import businesses from CSV
  app.post('/import/businesses', {
    schema: {
      body: {
        type: 'object',
        required: ['csv'],
        properties: {
          csv: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('business:create')) throw AppError.forbidden('Missing business:create permission');

    const body = z.object({ csv: z.string().min(1) }).parse(req.body);
    const result: ImportResult = { total: 0, created: 0, failed: 0, errors: [] };

    try {
      const rows = parseCsv(body.csv);
      result.total = rows.length;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          if (!r.name) { result.errors.push({ row: i + 1, error: 'Missing "name" field' }); result.failed++; continue; }

          const businessId = uuid();
          const business = {
            id: businessId, tenantId: ctx.tenantId, name: r.name,
            vertical: r.vertical ?? 'entertainment', legalName: r.legalName ?? null,
            status: 'active', currency: r.currency ?? 'USD',
            timezone: r.timezone ?? 'America/New_York', metadata: {},
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          businesses.set(business);
          getOrCreateAccounts(businessId, ctx.tenantId);
          result.created++;
        } catch (err) {
          result.errors.push({ row: i + 1, error: (err instanceof Error ? err.message : 'Unknown error') });
          result.failed++;
        }
      }
    } catch (err) {
      throw AppError.invalid(`CSV parse error: ${(err instanceof Error ? err.message : 'Unknown error')}`);
    }

    reply.send({ data: result });
  });

  // POST /import/bookings — bulk import bookings from CSV
  app.post('/import/bookings', {
    schema: {
      body: {
        type: 'object',
        required: ['csv', 'businessId'],
        properties: {
          csv: { type: 'string', minLength: 1 },
          businessId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('booking:create')) throw AppError.forbidden('Missing booking:create permission');

    const body = z.object({ csv: z.string().min(1), businessId: z.string().min(1) }).parse(req.body);
    const result: ImportResult = { total: 0, created: 0, failed: 0, errors: [] };

    try {
      const rows = parseCsv(body.csv);
      result.total = rows.length;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          if (!r.eventType || !r.eventDate || !r.startTime || !r.endTime) {
            result.errors.push({ row: i + 1, error: 'Missing required fields (eventType, eventDate, startTime, endTime)' });
            result.failed++; continue;
          }

          const booking = {
            id: uuid(), tenantId: ctx.tenantId, businessId: body.businessId,
            clientId: r.clientId ?? null, artistId: r.artistId ?? null, venueId: r.venueId ?? null,
            status: 'inquiry', eventType: r.eventType,
            eventName: r.eventName ?? null,
            eventDate: r.eventDate, startTime: r.startTime, endTime: r.endTime,
            quotedAmountCents: r.quotedAmountCents ? parseInt(r.quotedAmountCents, 10) : null,
            totalAmountCents: null, depositAmountCents: null,
            source: 'csv_import', metadata: {},
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          bookings.set(booking);
          result.created++;
        } catch (err) {
          result.errors.push({ row: i + 1, error: (err instanceof Error ? err.message : 'Unknown error') });
          result.failed++;
        }
      }
    } catch (err) {
      throw AppError.invalid(`CSV parse error: ${(err instanceof Error ? err.message : 'Unknown error')}`);
    }

    reply.send({ data: result });
  });
}
