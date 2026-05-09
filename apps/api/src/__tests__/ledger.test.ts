// Ledger route tests — journal posting, accounts, revenue events
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const TENANT = 'tenant-ledger';
const BUSINESS_ID = 'bd111111-1111-1111-1111-111111111111';
const ACCT_ASSET = 'ac000000-0000-0000-0000-000000000001';
const ACCT_REVENUE = 'ac000000-0000-0000-0000-000000000002';

const HEADERS = {
  'x-tenant-id': TENANT,
  'x-actor-permissions': 'payment:create',
};

describe('POST /api/v1/ledger/journal', () => {
  it('returns 201 on a balanced journal entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        memo: 'Monthly booking revenue recognition',
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 50000 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: 50000 },
        ],
        referenceType: 'booking',
        referenceId: '00000000-0000-0000-0000-000000000010',
        occurredAt: '2026-05-01T00:00:00.000Z',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.journal).toMatchObject({
      businessId: BUSINESS_ID,
      memo: 'Monthly booking revenue recognition',
      tenantId: TENANT,
    });
    expect(body.data.journal).toHaveProperty('id');
    expect(body.data.journal).toHaveProperty('createdAt');
    expect(body.data.entries).toHaveLength(2);
    expect(body.data.entries[0].direction).toBe('debit');
    expect(body.data.entries[0].amountCents).toBe(50000);
    expect(body.data.entries[1].direction).toBe('credit');
    expect(body.data.entries[1].amountCents).toBe(50000);
  });

  it('returns 400 on unbalanced entry (debits != credits)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 50000 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: 49999 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toBe('Debits must equal credits');
  });

  it('returns 400 on less than 2 entries (min 2 required)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 10000 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 with 0 entries', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        entries: [],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 on negative amountCents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: -100 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: -100 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 403 without payment:create permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'some:other',
      },
      payload: {
        businessId: BUSINESS_ID,
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 10000 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: 10000 },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 without x-tenant-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: {
        'x-actor-permissions': 'payment:create',
      },
      payload: {
        businessId: BUSINESS_ID,
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 10000 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: 10000 },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TENANT_REQUIRED');
  });

  it('accepts memo-less journal entry (optional memo)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 7500 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: 7500 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.journal.memo).toBeNull();
  });
});

describe('GET /api/v1/ledger/accounts', () => {
  it('returns default chart of accounts (6 accounts)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts?businessId=${BUSINESS_ID}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(6);
    expect(body.data[0]).toMatchObject({ code: '1000', name: 'Cash / Stripe Clearing', accountType: 'asset' });
    expect(body.data[1]).toMatchObject({ code: '2000', name: 'Deferred Revenue', accountType: 'liability' });
    expect(body.data[2]).toMatchObject({ code: '2100', name: 'Artist/Vendor Payable', accountType: 'liability' });
    expect(body.data[3]).toMatchObject({ code: '4000', name: 'Booking Revenue', accountType: 'revenue' });
    expect(body.data[4]).toMatchObject({ code: '4100', name: 'Commission Revenue', accountType: 'revenue' });
    expect(body.data[5]).toMatchObject({ code: '5000', name: 'Provider Fees', accountType: 'expense' });
    // Each account has required fields
    body.data.forEach((a: any) => {
      expect(a).toHaveProperty('id');
      expect(a).toHaveProperty('tenantId', TENANT);
      expect(a).toHaveProperty('businessId', BUSINESS_ID);
      expect(a).toHaveProperty('currency', 'USD');
    });
  });

  it('returns 6 seeded accounts for any businessId (seedDefaultAccounts always runs)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ledger/accounts?businessId=00000000-0000-0000-0000-000000000000',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // seedDefaultAccounts creates 6 accounts for any businessId
    expect(body.data).toHaveLength(6);
    expect(body.data[0]).toMatchObject({ code: '1000', name: 'Cash / Stripe Clearing', accountType: 'asset' });
  });

  it('returns 400 without businessId query param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ledger/accounts',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 400 without x-tenant-id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts?businessId=${BUSINESS_ID}`,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TENANT_REQUIRED');
  });
});

describe('GET /api/v1/ledger/journals', () => {
  beforeAll(async () => {
    // Post a balanced journal so we have data
    await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        memo: 'List test journal',
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 11100 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: 11100 },
        ],
      },
    });
  });

  it('returns journals for the tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ledger/journals',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const memos = body.data.map((j: any) => j.memo);
    expect(memos).toContain('List test journal');
  });

  it('filters by businessId query param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/journals?businessId=${BUSINESS_ID}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach((j: any) => {
      expect(j.businessId).toBe(BUSINESS_ID);
    });
  });

  it('returns empty for non-matching businessId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ledger/journals?businessId=00000000-0000-0000-0000-000000000000',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
  });
});

describe('GET /api/v1/ledger/journals/:id', () => {
  let journalId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        memo: 'Get-by-id journal',
        entries: [
          { accountId: ACCT_ASSET, direction: 'debit', amountCents: 22200 },
          { accountId: ACCT_REVENUE, direction: 'credit', amountCents: 22200 },
        ],
      },
    });
    journalId = JSON.parse(res.body).data.journal.id;
  });

  it('returns 200 with journal and entries', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/journals/${journalId}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.journal.memo).toBe('Get-by-id journal');
    expect(body.data.entries).toHaveLength(2);
  });

  it('returns 404 for nonexistent journal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ledger/journals/00000000-0000-0000-0000-000000000000',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/ledger/revenue', () => {
  it('returns 201 on valid revenue event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        eventType: 'deposit',
        amountCents: 15000,
        recognitionDate: '2026-05-01T00:00:00.000Z',
        referenceType: 'booking',
        referenceId: '00000000-0000-0000-0000-000000000010',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    // Response wraps event+journal+entries: { data: { event, journal, entries } }
    expect(body.data.event).toMatchObject({
      businessId: BUSINESS_ID,
      eventType: 'deposit',
      amountCents: 15000,
      currency: 'USD',
      tenantId: TENANT,
    });
    expect(body.data.event).toHaveProperty('id');
    expect(body.data.event).toHaveProperty('createdAt');
    expect(body.data.journal).toHaveProperty('id');
    expect(Array.isArray(body.data.entries)).toBe(true);
  });

  it('returns 201 with minimal fields (only required)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        eventType: 'commission',
        amountCents: 5000,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.event.eventType).toBe('commission');
    expect(body.data.event.amountCents).toBe(5000);
    expect(body.data.journal).toHaveProperty('id');
  });

  it('returns 400 on missing eventType', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        amountCents: 15000,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 on negative amountCents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        eventType: 'refund',
        amountCents: -5000,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 403 without payment:create permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'some:other',
      },
      payload: {
        businessId: BUSINESS_ID,
        eventType: 'ticket_sale',
        amountCents: 5000,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 without x-tenant-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: {
        'x-actor-permissions': 'payment:create',
      },
      payload: {
        businessId: BUSINESS_ID,
        eventType: 'ticket_sale',
        amountCents: 5000,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TENANT_REQUIRED');
  });
});

describe('GET /api/v1/ledger/revenue', () => {
  beforeAll(async () => {
    // Post a revenue event so we have data
    await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        eventType: 'deposit',
        amountCents: 9999,
      },
    });
  });

  it('returns revenue events for the tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ledger/revenue',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const types = body.data.map((e: any) => e.eventType);
    expect(types).toContain('deposit');
  });

  it('filters by businessId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/revenue?businessId=${BUSINESS_ID}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    body.data.forEach((e: any) => {
      expect(e.businessId).toBe(BUSINESS_ID);
    });
  });
});

describe('GET /api/v1/ledger/accounts/:id', () => {
  it('returns 400 when businessId query param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts/${ACCT_ASSET}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toContain('businessId');
  });

  it('returns 404 for nonexistent account ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts/00000000-0000-0000-0000-000000000000?businessId=${BUSINESS_ID}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/ledger/journal edge case: nonexistent account', () => {
  it('accepts journal with nonexistent account IDs (no account validation)', async () => {
    // The journal route does not validate that accountIds reference existing accounts.
    // This is a known design choice — validation could be added in the future.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: HEADERS,
      payload: {
        businessId: BUSINESS_ID,
        memo: 'Journal with made-up account IDs',
        entries: [
          { accountId: '00000000-0000-0000-0000-000000000099', direction: 'debit', amountCents: 3000 },
          { accountId: '00000000-0000-0000-0000-000000000098', direction: 'credit', amountCents: 3000 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
  });
});

describe('GET /api/v1/ledger/revenue/schedule', () => {
  it('returns 400 without businessId query param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ledger/revenue/schedule',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns empty schedule for a business with no scheduled deposits', async () => {
    const emptyBizId = 'bd000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/revenue/schedule?businessId=${emptyBizId}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
  });
});

describe('POST /api/v1/ledger/revenue/recognize', () => {
  const RECOGNIZE_TENANT = 'tenant-recognize';
  const RECOGNIZE_BIZ = 'bd999999-9999-9999-9999-999999999999';
  const RECOGNIZE_HEADERS = {
    'x-tenant-id': RECOGNIZE_TENANT,
    'x-actor-permissions': 'payment:create',
  };
  const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  it('returns 201 with recognition journal when a scheduled deposit exists', async () => {
    // Step 1: Create a deposit revenue event with a future recognitionDate
    const depositRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: RECOGNIZE_HEADERS,
      payload: {
        businessId: RECOGNIZE_BIZ,
        eventType: 'deposit',
        amountCents: 75000,
        recognitionDate: FUTURE_DATE,
        referenceType: 'booking',
        referenceId: '00000000-0000-0000-0000-000000000777',
      },
    });
    expect(depositRes.statusCode).toBe(201);

    // Step 2: Recognize the revenue for that bookingId
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue/recognize',
      headers: RECOGNIZE_HEADERS,
      payload: { bookingId: '00000000-0000-0000-0000-000000000777' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    // Should return journal with recognition details
    expect(body.data.journal).toHaveProperty('id');
    expect(body.data.journal.memo).toContain('Revenue recognition');
    expect(body.data.journal.memo).toContain('00000000-0000-0000-0000-000000000777');
    expect(body.data.journal.referenceType).toBe('booking');
    expect(body.data.journal.businessId).toBe(RECOGNIZE_BIZ);

    // Should return entries (the recognition recipe generates debit/credit pair)
    expect(Array.isArray(body.data.entries)).toBe(true);
    expect(body.data.entries.length).toBeGreaterThanOrEqual(2);

    // Recognition result should show the recognized amount
    expect(body.data.recognition).toHaveProperty('amount');
    expect(body.data.recognition.amount).toBe(75000);
    expect(body.data.recognition.businessId).toBe(RECOGNIZE_BIZ);
  });

  it('returns 400 on invalid bookingId format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue/recognize',
      headers: RECOGNIZE_HEADERS,
      payload: { bookingId: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 403 without payment:create permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue/recognize',
      headers: {
        'x-tenant-id': RECOGNIZE_TENANT,
        'x-actor-permissions': 'some:other',
      },
      payload: { bookingId: '00000000-0000-0000-0000-000000000777' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 without x-tenant-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue/recognize',
      headers: {
        'x-actor-permissions': 'payment:create',
      },
      payload: { bookingId: '00000000-0000-0000-0000-000000000777' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TENANT_REQUIRED');
  });

  it('recognizes deferred revenue by posting credit to booking revenue account', async () => {
    // Create a new deposit with a different bookingId
    const bookingRef = '00000000-0000-0000-0000-000000000888';
    await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: RECOGNIZE_HEADERS,
      payload: {
        businessId: RECOGNIZE_BIZ,
        eventType: 'deposit',
        amountCents: 120000,
        recognitionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        referenceType: 'booking',
        referenceId: bookingRef,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue/recognize',
      headers: RECOGNIZE_HEADERS,
      payload: { bookingId: bookingRef },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    // Recognition amount should match the deposit
    expect(body.data.recognition.amount).toBe(120000);

    // The recognition journal should debit deferred revenue (liability down)
    // and credit booking revenue (revenue up)
    const entries = body.data.entries;
    expect(entries).toHaveLength(2);

    const debits = entries.filter((e: any) => e.direction === 'debit');
    const credits = entries.filter((e: any) => e.direction === 'credit');
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);
    expect(debits[0].amountCents).toBe(120000);
    expect(credits[0].amountCents).toBe(120000);
  });
});
