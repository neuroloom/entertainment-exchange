// Ledger routes — journal posting, double-entry ledger, revenue events
// Task 010-015: POST /ledger/journal, GET /ledger/accounts, GET /ledger/journals, revenue
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';

const PostJournalSchema = z.object({
  businessId: z.string().uuid(),
  memo: z.string().optional(),
  entries: z.array(z.object({
    accountId: z.string().uuid(),
    direction: z.enum(['debit', 'credit']),
    amountCents: z.number().int().positive(),
  })).min(2),
  referenceType: z.string().optional(),
  referenceId: z.string().uuid().optional(),
  occurredAt: z.string().optional(),
});

const accounts = new Map<string, any[]>();
const journals: any[] = [];
const entries: any[] = [];
const revenueEvents: any[] = [];
const auditEvents: any[] = [];

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

function seedDefaultAccounts(businessId: string, tenantId: string) {
  if (accounts.has(businessId)) return;
  accounts.set(businessId, [
    { code: '1000', name: 'Cash / Stripe Clearing', type: 'asset' },
    { code: '2000', name: 'Deferred Revenue', type: 'liability' },
    { code: '2100', name: 'Artist/Vendor Payable', type: 'liability' },
    { code: '4000', name: 'Booking Revenue', type: 'revenue' },
    { code: '4100', name: 'Commission Revenue', type: 'revenue' },
    { code: '5000', name: 'Provider Fees', type: 'expense' },
  ].map(a => ({
    id: uuid(), tenantId, businessId, code: a.code, name: a.name, accountType: a.type, currency: 'USD',
  })));
}

export async function ledgerRoutes(app: FastifyInstance) {
  app.get('/accounts', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.query as any)?.businessId;
    if (!businessId) throw AppError.invalid('businessId query parameter required');

    seedDefaultAccounts(businessId, ctx.tenantId);
    reply.send({ data: accounts.get(businessId) ?? [] });
  });

  app.post('/journal', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('payment:create')) throw AppError.forbidden('Missing payment:create permission');

    const body = PostJournalSchema.parse(req.body);

    // Validate debits = credits
    const debits = body.entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amountCents, 0);
    const credits = body.entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amountCents, 0);
    if (debits !== credits) throw AppError.invalid('Debits must equal credits');

    const journalId = uuid();
    const journal = {
      id: journalId, tenantId: ctx.tenantId, businessId: body.businessId,
      memo: body.memo ?? null, referenceType: body.referenceType ?? null, referenceId: body.referenceId ?? null,
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    journals.push(journal);

    const journalEntries = body.entries.map(e => ({
      id: uuid(), tenantId: ctx.tenantId, journalId,
      accountId: e.accountId, direction: e.direction, amountCents: e.amountCents,
    }));
    entries.push(...journalEntries);

    writeAudit(ctx, 'ledger.journal', 'journal', journalId, body.businessId, { memo: body.memo, entryCount: journalEntries.length });
    reply.status(201).send({ data: { journal, entries: journalEntries } });
  });

  app.get('/journals', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.query as any)?.businessId;
    const filtered = journals.filter(j => j.tenantId === ctx.tenantId && (!businessId || j.businessId === businessId));
    reply.send({ data: filtered });
  });

  app.get('/journals/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const j = journals.find(j => j.id === (req.params as any).id);
    if (!j || j.tenantId !== ctx.tenantId) throw AppError.notFound('Journal');
    const journalEntries = entries.filter(e => e.journalId === j.id);
    reply.send({ data: { journal: j, entries: journalEntries } });
  });

  app.get('/revenue', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.query as any)?.businessId;
    const filtered = revenueEvents.filter(e => e.tenantId === ctx.tenantId && (!businessId || e.businessId === businessId));
    reply.send({ data: filtered });
  });

  app.post('/revenue', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('payment:create')) throw AppError.forbidden('Missing payment:create permission');

    const body = z.object({
      businessId: z.string().uuid(),
      eventType: z.string().min(1),
      amountCents: z.number().int().min(0),
      recognitionDate: z.string().optional(),
      referenceType: z.string().optional(),
      referenceId: z.string().uuid().optional(),
    }).parse(req.body);

    const event = {
      id: uuid(), tenantId: ctx.tenantId, businessId: body.businessId,
      eventType: body.eventType, amountCents: body.amountCents, currency: 'USD',
      recognitionDate: body.recognitionDate ?? null,
      referenceType: body.referenceType ?? null, referenceId: body.referenceId ?? null,
      metadata: {}, createdAt: new Date().toISOString(),
    };
    revenueEvents.push(event);
    writeAudit(ctx, 'revenue.create', 'revenue_event', event.id, body.businessId);
    reply.status(201).send({ data: event });
  });
}
