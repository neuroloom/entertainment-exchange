// Business routes — create business, default chart of accounts
// Task 005: POST /businesses → business_entities + ledger_accounts + audit_events
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { MemoryStore, AuditStore } from '../services/repo.js';

const CreateBusinessSchema = z.object({
  name: z.string().min(1),
  vertical: z.string().default('entertainment'),
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

export async function businessRoutes(app: FastifyInstance) {
  app.post('/businesses', async (req, reply) => {
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
    const all = businesses.all(ctx.tenantId);
    reply.send({ data: all });
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
}
