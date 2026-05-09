// Business routes — create business, default chart of accounts
// Task 005: POST /businesses → business_entities + ledger_accounts + audit_events
// Sprint 3a: PUT /businesses/:id, DELETE /businesses/:id, paginated GET /businesses
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import type { PaginatedResponse } from '@entertainment-exchange/shared';
import { MemoryStore, AuditStore } from '../services/repo.js';
import { getOrCreateAccounts, journalStore } from './ledger.js';

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
const auditEvents = new AuditStore();

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

/** Lookup helper for booking reversal — returns code→accountId map for a business.
 *  Imported by booking.ts when creating reversal journal entries.
 *  Uses the ledger's single source of truth for chart of accounts. */
export function getBusinessAccountMap(businessId: string, tenantId = ''): Map<string, string> {
  const map = new Map<string, string>();
  const accounts = getOrCreateAccounts(businessId, tenantId);
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

    // Default chart of accounts — single source of truth from ledger
    const accounts = getOrCreateAccounts(businessId, ctx.tenantId);

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
    const businessId = (req.params as any).id;
    const b = businesses.get(businessId);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Business');

    // Resolve account IDs from the single source of truth (ledger chart of accounts)
    const accts = getOrCreateAccounts(businessId, ctx.tenantId);
    const codeToId = new Map<string, string>();
    for (const a of accts) codeToId.set(a.code, a.id);

    const bookingRevId = codeToId.get('4000') ?? '';
    const deferredRevId = codeToId.get('2000') ?? '';
    const providerFeesId = codeToId.get('5000') ?? '';

    // Sum journal entries for this business by account ID
    const sumAccount = (accountId: string): number => {
      if (!accountId) return 0;
      let total = 0;
      for (const entry of journalStore.entries) {
        if (entry.accountId !== accountId) continue;
        // Verify the parent journal belongs to this business
        const journal = journalStore.journals.find((j: any) => j.id === entry.journalId);
        if (!journal || journal.businessId !== businessId) continue;
        total += (entry.direction === 'credit' ? entry.amountCents : -entry.amountCents);
      }
      return total;
    };

    const recognizedRevenue = sumAccount(bookingRevId);
    const providerFees = sumAccount(providerFeesId);
    const deferredRevenue = sumAccount(deferredRevId);

    reply.send({
      data: {
        recognizedRevenue,
        deferredRevenue,
        bookedFutureRevenue: 0,   // Requires cross-domain wiring to booking pipeline
        grossMargin: recognizedRevenue - providerFees,
        automationCoverage: 0,     // Requires cross-domain wiring to agent executor stats
        transferabilityScore: 0,   // Requires cross-domain wiring to rights passport service
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

  // Audit events endpoint — compliance retrieval for audit:view permission
  app.get('/audit', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('audit:view')) throw AppError.forbidden('Missing audit:view permission');

    const query = req.query as Record<string, string>;
    let events = auditEvents.all(ctx.tenantId);
    if (query.resourceType) events = events.filter((e: any) => e.resourceType === query.resourceType);
    if (query.action) events = events.filter((e: any) => e.action === query.action);
    if (query.businessId) events = events.filter((e: any) => e.businessId === query.businessId);

    const limit = parseInt(query.limit, 10) || 50;
    const offset = parseInt(query.offset, 10) || 0;
    const total = events.length;
    const data = events.slice(offset, offset + limit);

    reply.send({ data, total, limit, offset });
  });
}
