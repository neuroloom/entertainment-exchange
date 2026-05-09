// Ledger routes — journal posting, double-entry ledger, revenue events
// Task 010-015: POST /ledger/journal, GET /ledger/accounts, GET /ledger/journals, revenue
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import {
  idempotencyStore,
  getRecipeForEvent,
  RevenueSchedule,
} from '@entertainment-exchange/orchestration';
import { AuditStore, JournalStore } from '../services/repo.js';

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
export const journalStore = new JournalStore();
const revenueEvents: any[] = [];
const auditEvents = new AuditStore();

const revenueSchedule = new RevenueSchedule();

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

  app.get('/accounts/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.query as any)?.businessId;
    if (!businessId) throw AppError.invalid('businessId query parameter required');

    seedDefaultAccounts(businessId, ctx.tenantId);
    const accts = accounts.get(businessId) ?? [];
    const account = accts.find((a: any) => a.id === (req.params as any).id);
    if (!account) throw AppError.notFound('Account');
    reply.send({ data: account });
  });

  app.post('/journal', {
    schema: {
      body: {
        type: 'object',
        required: ['businessId', 'entries'],
        properties: {
          businessId: { type: 'string', format: 'uuid' },
          memo: { type: 'string' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              required: ['accountId', 'direction', 'amountCents'],
              properties: {
                accountId: { type: 'string', format: 'uuid' },
                direction: { type: 'string', enum: ['debit', 'credit'] },
                amountCents: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('payment:create')) throw AppError.forbidden('Missing payment:create permission');

    // -- Idempotency check --
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      const cached = idempotencyStore.checkIdempotent(idempotencyKey);
      if (cached) {
        reply.status(200).send({ data: { journal: cached.journal, entries: cached.entries } });
        return;
      }
    }

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
    const journalEntries = body.entries.map(e => ({
      id: uuid(), tenantId: ctx.tenantId, journalId,
      accountId: e.accountId, direction: e.direction, amountCents: e.amountCents,
    }));
    journalStore.addJournal(journal, journalEntries);

    // -- Store idempotency result --
    if (idempotencyKey) {
      idempotencyStore.markProcessed(idempotencyKey, journalId, journal, journalEntries);
    }

    writeAudit(ctx, 'ledger.journal', 'journal', journalId, body.businessId, { memo: body.memo, entryCount: journalEntries.length });
    reply.status(201).send({ data: { journal, entries: journalEntries } });
  });

  app.get('/journals', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.query as any)?.businessId;
    const all = journalStore.listJournals(ctx.tenantId, businessId);
    const limit = parseInt((req.query as any)?.limit, 10) || 0;
    const offset = parseInt((req.query as any)?.offset, 10) || 0;
    if (limit > 0) {
      const page = all.slice(offset, offset + limit);
      reply.send({ data: page, total: all.length, limit, offset });
    } else {
      reply.send({ data: all });
    }
  });

  app.get('/journals/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const j = journalStore.getJournal((req.params as any).id);
    if (!j || j.tenantId !== ctx.tenantId) throw AppError.notFound('Journal');
    const journalEntries = journalStore.getEntries(j.id);
    reply.send({ data: { journal: j, entries: journalEntries } });
  });

  app.get('/entries', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const journalId = (req.query as any)?.journalId;

    let filtered: any[];
    if (journalId) {
      // Validate the journal exists and belongs to this tenant
      const j = journalStore.getJournal(journalId);
      if (!j || j.tenantId !== ctx.tenantId) throw AppError.notFound('Journal');
      filtered = journalStore.getEntries(journalId);
    } else {
      // List all entries for this tenant
      const allJournals = journalStore.listJournals(ctx.tenantId);
      const tenantJournalIds = new Set(allJournals.map(j => j.id));
      filtered = journalStore.entries.filter(e => tenantJournalIds.has(e.journalId));
    }

    const limit = parseInt((req.query as any)?.limit, 10) || 0;
    const offset = parseInt((req.query as any)?.offset, 10) || 0;
    if (limit > 0) {
      const page = filtered.slice(offset, offset + limit);
      reply.send({ data: page, total: filtered.length, limit, offset });
    } else {
      reply.send({ data: filtered });
    }
  });

  app.get('/revenue', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.query as any)?.businessId;
    const filtered = revenueEvents.filter(e => e.tenantId === ctx.tenantId && (!businessId || e.businessId === businessId));
    reply.send({ data: filtered });
  });

  app.get('/revenue/schedule', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.query as any)?.businessId;
    if (!businessId) throw AppError.invalid('businessId query parameter required');

    const recognizable = revenueSchedule.getRecognizableRevenue(businessId);
    reply.send({ data: recognizable });
  });

  app.post('/revenue/recognize', {
    schema: {
      body: {
        type: 'object',
        required: ['bookingId'],
        properties: {
          bookingId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('payment:create')) throw AppError.forbidden('Missing payment:create permission');

    const body = z.object({
      bookingId: z.string().uuid(),
    }).parse(req.body);

    const scheduled = revenueSchedule.recognizeRevenue(body.bookingId);

    // Post the RECOGNIZE_RECIPE as a journal entry
    const { entries: recipeEntries } = getRecipeForEvent('recognize')(scheduled.amount);
    const journalId = uuid();
    const journal = {
      id: journalId, tenantId: ctx.tenantId, businessId: scheduled.businessId,
      memo: `Revenue recognition for booking ${body.bookingId}`,
      referenceType: 'booking', referenceId: body.bookingId,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const journalEntries = recipeEntries.map(e => ({
      id: uuid(), tenantId: ctx.tenantId, journalId,
      accountId: accountIdByCode(scheduled.businessId, ctx.tenantId, e.accountCode),
      direction: e.direction, amountCents: e.amount,
    }));
    journalStore.addJournal(journal, journalEntries);

    writeAudit(ctx, 'ledger.recognize', 'journal', journalId, scheduled.businessId, {
      bookingId: body.bookingId, amountCents: scheduled.amount,
    });

    reply.status(201).send({ data: { journal, entries: journalEntries, recognition: scheduled } });
  });

  app.post('/revenue', {
    schema: {
      body: {
        type: 'object',
        required: ['businessId', 'eventType', 'amountCents'],
        properties: {
          businessId: { type: 'string', format: 'uuid' },
          eventType: { type: 'string', minLength: 1 },
          amountCents: { type: 'integer', minimum: 0 },
          referenceType: { type: 'string' },
          referenceId: { type: 'string', format: 'uuid' },
          recognitionDate: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
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

    // -- Wire the revenue recipe into a journal entry --
    const recipe = getRecipeForEvent(body.eventType);
    const { entries: recipeEntries } = recipe(body.amountCents);

    seedDefaultAccounts(body.businessId, ctx.tenantId);

    const journalId = uuid();
    const journal = {
      id: journalId, tenantId: ctx.tenantId, businessId: body.businessId,
      memo: `Revenue event: ${body.eventType}`,
      referenceType: body.referenceType ?? 'revenue_event',
      referenceId: body.referenceId ?? event.id,
      occurredAt: body.recognitionDate ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const journalEntries = recipeEntries.map(e => ({
      id: uuid(), tenantId: ctx.tenantId, journalId,
      accountId: accountIdByCode(body.businessId, ctx.tenantId, e.accountCode),
      direction: e.direction, amountCents: e.amount,
    }));
    journalStore.addJournal(journal, journalEntries);

    // If a future recognitionDate is provided and the event type is 'deposit',
    // schedule it for later recognition.
    if (body.eventType.toLowerCase() === 'deposit' && body.recognitionDate && body.referenceId) {
      revenueSchedule.scheduleRecognition(
        body.referenceId,          // bookingId
        body.businessId,
        body.amountCents,
        body.recognitionDate,
      );
    }

    writeAudit(ctx, 'revenue.create', 'revenue_event', event.id, body.businessId, {
      eventType: body.eventType,
      journalId,
      recipeEntries: recipeEntries.length,
    });

    reply.status(201).send({
      data: {
        event,
        journal,
        entries: journalEntries,
      },
    });
  });
}

/** Resolve an accountId by businessId + accountCode. Creates the accounts if needed. */
function accountIdByCode(businessId: string, tenantId: string, code: string): string {
  seedDefaultAccounts(businessId, tenantId);
  const accts = accounts.get(businessId) ?? [];
  const found = accts.find((a: any) => a.code === code);
  if (!found) {
    throw AppError.invalid(`Account code not found: ${code}. Ensure default accounts are seeded.`);
  }
  return found.id as string;
}
