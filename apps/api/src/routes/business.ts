// Business routes — create business, default chart of accounts
// Task 005: POST /businesses → business_entities + ledger_accounts + audit_events
// Sprint 3a: PUT /businesses/:id, DELETE /businesses/:id, paginated GET /businesses
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import type { PaginatedResponse } from '@entertainment-exchange/shared';
import { MemoryStore, AuditStore } from '../services/repo.js';

const CreateBusinessSchema = z.object({
  name: z.string().min(1),
  vertical: z.string().default('entertainment'),
  legalName: z.string().optional(),
});

const UpdateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  vertical: z.string().optional(),
  legalName: z.string().optional(),
});

// In-memory stores with optional PG write-through
const businesses = new MemoryStore('businesses');
const ledgerAccounts = new Map<string, any[]>();
const auditEvents = new AuditStore();

const DEFAULT_CHART_OF_ACCOUNTS = [
  { code: '1000', name: 'Cash / Stripe Clearing', type: 'asset' },
  { code: '2000', name: 'Deferred Revenue', type: 'liability' },
  { code: '2100', name: 'Artist/Vendor Payable', type: 'liability' },
  { code: '4000', name: 'Booking Revenue', type: 'revenue' },
  { code: '4100', name: 'Commission Revenue', type: 'revenue' },
  { code: '5000', name: 'Provider Fees', type: 'expense' },
];

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

/** Lookup helper for booking reversal — returns code→accountId map for a business.
 *  Imported by booking.ts when creating reversal journal entries. */
export function getBusinessAccountMap(businessId: string): Map<string, string> {
  const map = new Map<string, string>();
  const accounts = ledgerAccounts.get(businessId) ?? [];
  for (const a of accounts) {
    map.set(a.code, a.id);
  }
  return map;
}

export async function businessRoutes(app: FastifyInstance) {
  app.post('/businesses', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          vertical: { type: 'string' },
          legalName: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('business:create')) throw AppError.forbidden('Missing business:create permission');

    const body = CreateBusinessSchema.parse(req.body);
    const businessId = uuid();

    const business = {
      id: businessId, tenantId: ctx.tenantId, name: body.name,
      vertical: body.vertical, legalName: body.legalName ?? null,
      status: 'active', currency: 'USD', timezone: 'America/New_York',
      metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    businesses.set(business);

    // Default chart of accounts
    const accounts = DEFAULT_CHART_OF_ACCOUNTS.map(a => ({
      id: uuid(), tenantId: ctx.tenantId, businessId, code: a.code, name: a.name, accountType: a.type, currency: 'USD',
    }));
    ledgerAccounts.set(businessId, accounts);

    // Audit
    writeAudit(ctx, 'business.create', 'business', businessId, businessId);

    reply.status(201).send({ data: business, accounts });
  });

  app.get('/businesses', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const query = req.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const all = businesses.all(ctx.tenantId);
    const total = all.length;
    const data = all.slice(offset, offset + limit);

    const response: PaginatedResponse<typeof data[number]> = { data, total, limit, offset };
    reply.send(response);
  });

  app.get('/businesses/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const b = businesses.get((req.params as any).id);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Business');
    reply.send({ data: b });
  });

  app.get('/businesses/:id/metrics', async (req, reply) => {
    const ctx = (req as any).ctx;
    const b = businesses.get((req.params as any).id);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Business');
    reply.send({
      data: {
        recognizedRevenue: 0, deferredRevenue: 0, bookedFutureRevenue: 0,
        grossMargin: 0, automationCoverage: 0, transferabilityScore: 0,
      },
    });
  });

  app.put('/businesses/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          vertical: { type: 'string' },
          legalName: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('business:manage')) throw AppError.forbidden('Missing business:manage permission');

    const b = businesses.get((req.params as any).id);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Business');

    const body = UpdateBusinessSchema.parse(req.body);

    if (body.name !== undefined) b.name = body.name;
    if (body.vertical !== undefined) b.vertical = body.vertical;
    if (body.legalName !== undefined) b.legalName = body.legalName;
    b.updatedAt = new Date().toISOString();
    businesses.set(b);

    writeAudit(ctx, 'business.update', 'business', b.id, b.id, { changes: body });
    reply.send({ data: b });
  });

  app.delete('/businesses/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('business:manage')) throw AppError.forbidden('Missing business:manage permission');

    const b = businesses.get((req.params as any).id);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Business');
    if (b.status === 'archived') throw AppError.invalid('Business already archived');

    b.status = 'archived';
    b.updatedAt = new Date().toISOString();
    businesses.set(b);

    writeAudit(ctx, 'business.archive', 'business', b.id, b.id);
    reply.send({ data: b });
  });
}
