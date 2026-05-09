// Business routes — create business, default chart of accounts
// Task 005: POST /businesses → business_entities + ledger_accounts + audit_events
// Sprint 3a: PUT /businesses/:id, DELETE /businesses/:id, paginated GET /businesses
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { MemoryStore } from '../services/repo.js';
import { getOrCreateAccounts, journalStore } from './ledger.js';
import { webhookService } from '../services/webhook.service.js';
import { bookings } from './booking.js';
import { RevenueForecaster } from '@entex/orchestration';
import { writeAudit, sharedAudit } from '../services/audit-helpers.js';

export interface Business {
  id: string;
  tenantId: string;
  name: string;
  vertical: string;
  legalName: string | null;
  status: string;
  currency: string;
  timezone: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

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
export const businesses = new MemoryStore<Business>('businesses');

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
    const ctx = req.ctx;
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

    // Webhook: fire-and-forget
    void webhookService.emit('business.created', {
      tenantId: ctx.tenantId, resourceId: businessId,
      payload: { id: businessId, name: body.name, vertical: body.vertical },
    });

    reply.status(201).send({ data: business, accounts });
  });

  app.get('/businesses', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const p = paginate(req.query);
    const all = businesses.all(ctx.tenantId);
    const sliced = all.slice(p.offset, p.offset + p.limit);

    reply.send(paginatedResponse(sliced, all.length, p));
  });

  app.get('/businesses/:id', async (req, reply) => {
    const ctx = req.ctx;
    const b = businesses.get(params(req).id);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Business');
    reply.send({ data: b });
  });

  app.get('/businesses/:id/metrics', async (req, reply) => {
    const ctx = req.ctx;
    const businessId = params(req).id;
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
        const journal = journalStore.journals.find((j) => j.id === entry.journalId);
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

  // GET /businesses/:id/forecast — revenue forecast for the next 6 months
  app.get('/businesses/:id/forecast', async (req, reply) => {
    const ctx = req.ctx;
    const businessId = params(req).id;
    const b = businesses.get(businessId);
    if (!b || b.tenantId !== ctx.tenantId) throw AppError.notFound('Business');

    const query = req.query as Record<string, string>;
    const months = Math.min(24, Math.max(1, parseInt(query.months ?? '6', 10) || 6));

    const forecaster = new RevenueForecaster();

    // Gather confirmed + pipeline bookings for this business
    const tenantBookings = bookings.all(ctx.tenantId).filter(bk => bk.businessId === businessId);
    const confirmed = tenantBookings.filter(bk => bk.status === 'confirmed' || bk.status === 'contracted');
    const pipeline = tenantBookings.filter(bk => bk.status !== 'confirmed' && bk.status !== 'contracted' &&
      bk.status !== 'completed' && bk.status !== 'cancelled');

    // Gather journal credit entries for this business
    const accts = getOrCreateAccounts(businessId, ctx.tenantId);
    const accountIds = new Set(accts.map(a => a.id));
    const creditEntries = journalStore.entries.filter(
      e => accountIds.has(e.accountId) && e.direction === 'credit',
    );

    const input = {
      confirmedBookings: confirmed.map(bk => ({ amountCents: bk.quotedAmountCents ?? 0, eventDate: bk.eventDate })),
      pipelineBookings: pipeline.map(bk => ({ amountCents: bk.quotedAmountCents ?? 0, status: bk.status, eventDate: bk.eventDate })),
      journalEntries: creditEntries.map(e => ({ amountCents: e.amountCents, direction: e.direction as 'debit' | 'credit', createdAt: e.createdAt ?? '' })),
    };

    const result = forecaster.forecastBlended(input, months);
    reply.send({ data: result });
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
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('business:manage')) throw AppError.forbidden('Missing business:manage permission');

    const b = businesses.get(params(req).id);
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
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('business:manage')) throw AppError.forbidden('Missing business:manage permission');

    const b = businesses.get(params(req).id);
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
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('audit:view')) throw AppError.forbidden('Missing audit:view permission');

    const query = req.query as Record<string, string>;
    let events = sharedAudit.all(ctx.tenantId);
    if (query.resourceType) events = events.filter((e) => e.resourceType === query.resourceType);
    if (query.action) events = events.filter((e) => e.action === query.action);
    if (query.businessId) events = events.filter((e) => e.businessId === query.businessId);

    const p = paginate(req.query);
    const sliced = events.slice(p.offset, p.offset + p.limit);

    reply.send(paginatedResponse(sliced, events.length, p));
  });
}
