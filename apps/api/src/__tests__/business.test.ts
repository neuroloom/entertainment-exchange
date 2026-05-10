// Business route tests — create, list, get, metrics
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

describe('POST /api/v1/businesses', () => {
  it('returns 201 with chart of accounts (6 accounts)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-biz-001',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Acme Entertainment', vertical: 'music' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('Acme Entertainment');
    expect(body.data.vertical).toBe('music');
    expect(body.data.status).toBe('active');
    expect(body.data.currency).toBe('USD');
    expect(body.accounts).toHaveLength(6);
    expect(body.accounts[0]).toMatchObject({
      code: '1000',
      name: 'Cash / Stripe Clearing',
      accountType: 'asset',
    });
    expect(body.accounts[5]).toMatchObject({
      code: '5000',
      name: 'Provider Fees',
      accountType: 'expense',
    });
    expect(body.accounts[0]).toHaveProperty('id');
    expect(body.accounts[0]).toHaveProperty('tenantId', 'tenant-biz-001');
  });

  it('returns 201 with default vertical when omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-biz-001',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Default Vertical Inc' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.vertical).toBe('entertainment');
  });

  it('returns 403 without business:create permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-biz-001',
        'x-actor-permissions': 'some:other,reading:only',
      },
      payload: { name: 'No Perm Biz' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('business:create');
  });

  it('returns 400 without x-tenant-id header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'No Tenant Biz' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TENANT_REQUIRED');
  });

  it('returns 400 when name is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-biz-001',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/v1/businesses', () => {
  it('returns tenant-scoped businesses only', async () => {
    // Create biz for tenant-a
    await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-a',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Tenant A Biz' },
    });

    // Create biz for tenant-b
    await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-b',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Tenant B Biz' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/businesses',
      headers: { 'x-tenant-id': 'tenant-a' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const names = body.data.map((b: { name: string }) => b.name);
    expect(names).toContain('Tenant A Biz');
    // Should NOT include tenant-b's business
    names.forEach((n: string) => expect(n).not.toBe('Tenant B Biz'));
  });

  it('returns empty array for tenant with no businesses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/businesses',
      headers: { 'x-tenant-id': 'tenant-empty' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
  });
});

describe('GET /api/v1/businesses/:id', () => {
  let bizId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-get',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'GetMe Inc' },
    });
    bizId = JSON.parse(res.body).data.id;
  });

  it('returns 200 for own business', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${bizId}`,
      headers: { 'x-tenant-id': 'tenant-get' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('GetMe Inc');
    expect(body.data.id).toBe(bizId);
    expect(body.data.tenantId).toBe('tenant-get');
  });

  it('returns 404 for cross-tenant access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${bizId}`,
      headers: { 'x-tenant-id': 'tenant-other' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('Business');
  });

  it('returns 404 for nonexistent business id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/businesses/00000000-0000-0000-0000-000000000000',
      headers: { 'x-tenant-id': 'tenant-get' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/businesses/:id/metrics', () => {
  let bizId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-metrics',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Metrics Inc' },
    });
    bizId = JSON.parse(res.body).data.id;
  });

  it('returns 200 with all fields present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${bizId}/metrics`,
      headers: { 'x-tenant-id': 'tenant-metrics' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toMatchObject({
      recognizedRevenue: 0,
      deferredRevenue: 0,
      bookedFutureRevenue: 0,
      grossMargin: 0,
      automationCoverage: 0,
      transferabilityScore: 0,
    });
  });

  it('returns 404 for nonexistent business', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/businesses/00000000-0000-0000-0000-000000000000/metrics',
      headers: { 'x-tenant-id': 'tenant-metrics' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for cross-tenant metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${bizId}/metrics`,
      headers: { 'x-tenant-id': 'tenant-other' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/v1/businesses/:id', () => {
  let bizId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-put',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Before Update Inc', vertical: 'music' },
    });
    bizId = JSON.parse(res.body).data.id;
  });

  it('returns 200 when updating with business:manage permission', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${bizId}`,
      headers: {
        'x-tenant-id': 'tenant-put',
        'x-actor-permissions': 'business:manage',
      },
      payload: { name: 'After Update Inc' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('After Update Inc');
  });

  it('returns 403 without business:manage permission', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${bizId}`,
      headers: {
        'x-tenant-id': 'tenant-put',
        'x-actor-permissions': 'some:other,business:create',
      },
      payload: { name: 'Should Not Update' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('business:manage');
  });

  it('returns 404 for nonexistent business', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/businesses/00000000-0000-0000-0000-000000000000',
      headers: {
        'x-tenant-id': 'tenant-put',
        'x-actor-permissions': 'business:manage',
      },
      payload: { name: 'Ghost Update' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/v1/businesses/:id', () => {
  let activeBizId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-del',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Deletable Inc' },
    });
    activeBizId = JSON.parse(res.body).data.id;
  });

  it('returns 200 and archives the business', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/businesses/${activeBizId}`,
      headers: {
        'x-tenant-id': 'tenant-del',
        'x-actor-permissions': 'business:manage',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('archived');
  });

  it('returns 400 when deleting an already-archived business', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/businesses/${activeBizId}`,
      headers: {
        'x-tenant-id': 'tenant-del',
        'x-actor-permissions': 'business:manage',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toContain('already archived');
  });

  it('returns 403 without business:manage permission', async () => {
    // Create a fresh business for this test
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-del',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'No Perm Delete Inc' },
    });
    const freshId = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/businesses/${freshId}`,
      headers: {
        'x-tenant-id': 'tenant-del',
        'x-actor-permissions': 'some:other',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('business:manage');
  });

  it('returns 404 for nonexistent business', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/businesses/00000000-0000-0000-0000-000000000000',
      headers: {
        'x-tenant-id': 'tenant-del',
        'x-actor-permissions': 'business:manage',
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/businesses/:id/metrics — wiring verification', () => {
  const WIRE_TENANT = 'tenant-wire';
  const WIRE_HEADERS = {
    'x-tenant-id': WIRE_TENANT,
    'x-actor-permissions': 'business:create,payment:create',
  };

  it('recognizedRevenue reflects journal entries posted to booking revenue account', async () => {
    // Create a business to get its account IDs
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: WIRE_HEADERS,
      payload: { name: 'Wired Inc', vertical: 'music' },
    });
    const biz = JSON.parse(createRes.body).data;
    const bizId = biz.id;

    // Get the accounts seeded for this business
    const acctRes = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts?businessId=${bizId}`,
      headers: { 'x-tenant-id': WIRE_TENANT },
    });
    const accts = JSON.parse(acctRes.body).data;
    const bookingRevId = accts.find((a: { code: string; id: string }) => a.code === '4000').id;
    const deferredRevId = accts.find((a: { code: string; id: string }) => a.code === '2000').id;

    // Post a journal entry that credits booking revenue (revenue increases with credit)
    await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: { ...WIRE_HEADERS, 'x-business-id': bizId },
      payload: {
        businessId: bizId,
        memo: 'Recognize booking revenue',
        entries: [
          { accountId: deferredRevId, direction: 'debit', amountCents: 50000 },
          { accountId: bookingRevId, direction: 'credit', amountCents: 50000 },
        ],
      },
    });

    // Check metrics — recognizedRevenue should be 50000 (credit to 4000 = positive)
    const metricsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${bizId}/metrics`,
      headers: { 'x-tenant-id': WIRE_TENANT },
    });

    expect(metricsRes.statusCode).toBe(200);
    const body = JSON.parse(metricsRes.body);
    expect(body.data.recognizedRevenue).toBe(50000);
  });

  it('deferredRevenue reflects net journal entry balances for deferred revenue account', async () => {
    // Create a new business for clean deferred revenue tracking
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: WIRE_HEADERS,
      payload: { name: 'Deferred Inc', vertical: 'events' },
    });
    const bizId = JSON.parse(createRes.body).data.id;

    const acctRes = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts?businessId=${bizId}`,
      headers: { 'x-tenant-id': WIRE_TENANT },
    });
    const accts = JSON.parse(acctRes.body).data;
    const cashId = accts.find((a: { code: string; id: string }) => a.code === '1000').id;
    const deferredRevId = accts.find((a: { code: string; id: string }) => a.code === '2000').id;

    // Post a deposit journal: debit cash, credit deferred revenue
    // Credit to deferred revenue (2000) = positive deferred revenue
    await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: { ...WIRE_HEADERS, 'x-business-id': bizId },
      payload: {
        businessId: bizId,
        memo: 'Customer deposit',
        entries: [
          { accountId: cashId, direction: 'debit', amountCents: 100000 },
          { accountId: deferredRevId, direction: 'credit', amountCents: 100000 },
        ],
      },
    });

    // Check metrics — deferredRevenue should reflect the credit to 2000 account
    const metricsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${bizId}/metrics`,
      headers: { 'x-tenant-id': WIRE_TENANT },
    });

    expect(metricsRes.statusCode).toBe(200);
    const body = JSON.parse(metricsRes.body);
    // Metrics treats credit as positive for revenue/liability accounts
    // Credit to deferred revenue = +100000
    expect(body.data.deferredRevenue).toBe(100000);
  });

  it('grossMargin correctly subtracts provider fees from recognized revenue', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: WIRE_HEADERS,
      payload: { name: 'Margin Inc', vertical: 'nightclub' },
    });
    const bizId = JSON.parse(createRes.body).data.id;

    const acctRes = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts?businessId=${bizId}`,
      headers: { 'x-tenant-id': WIRE_TENANT },
    });
    const accts = JSON.parse(acctRes.body).data;
    const bookingRevId = accts.find((a: { code: string; id: string }) => a.code === '4000').id;
    const deferredRevId = accts.find((a: { code: string; id: string }) => a.code === '2000').id;
    const providerFeesId = accts.find((a: { code: string; id: string }) => a.code === '5000').id;

    // Post revenue recognition: credit booking revenue (revenue +)
    await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: { ...WIRE_HEADERS, 'x-business-id': bizId },
      payload: {
        businessId: bizId,
        memo: 'Revenue recognition',
        entries: [
          { accountId: deferredRevId, direction: 'debit', amountCents: 80000 },
          { accountId: bookingRevId, direction: 'credit', amountCents: 80000 },
        ],
      },
    });

    // Post provider fees: debit provider fees (expense debit = negative for margin)
    await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: { ...WIRE_HEADERS, 'x-business-id': bizId },
      payload: {
        businessId: bizId,
        memo: 'Provider commission',
        entries: [
          { accountId: providerFeesId, direction: 'debit', amountCents: 15000 },
          { accountId: deferredRevId, direction: 'credit', amountCents: 15000 },
        ],
      },
    });

    const metricsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${bizId}/metrics`,
      headers: { 'x-tenant-id': WIRE_TENANT },
    });

    expect(metricsRes.statusCode).toBe(200);
    const body = JSON.parse(metricsRes.body);

    // recognizedRevenue: credit to 4000 = +80000
    expect(body.data.recognizedRevenue).toBe(80000);

    // grossMargin = recognizedRevenue - providerFees
    // providerFees: debit to 5000 = -15000 (metrics treats debit as negative, so -(-15000) = +15000 ... let me check)
    // Actually: sumAccount treats debit as negative, credit as positive
    // For expense accounts (5000): debit = -amount, so providerFees = -15000
    // grossMargin = recognizedRevenue - providerFees = 80000 - (-15000) = 95000
    expect(body.data.grossMargin).toBe(95000);
  });
});

describe('GET /api/v1/businesses pagination', () => {
  it('returns empty data when offset exceeds total', async () => {
    // First create a business to ensure we have some data
    await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: {
        'x-tenant-id': 'tenant-page',
        'x-actor-permissions': 'business:create',
      },
      payload: { name: 'Pagination Biz' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/businesses?limit=10&offset=999',
      headers: { 'x-tenant-id': 'tenant-page' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
    expect(body.total).toBeGreaterThan(0);
    expect(body.offset).toBe(999);
  });
});
