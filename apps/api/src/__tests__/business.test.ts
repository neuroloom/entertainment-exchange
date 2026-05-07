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
    const names = body.data.map((b: any) => b.name);
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
