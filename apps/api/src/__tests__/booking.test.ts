// Booking route tests — create, list, get, status transitions
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

const TENANT = 'tenant-booking';
const BASE_HEADERS = {
  'x-tenant-id': TENANT,
  'x-actor-permissions': 'booking:create,booking:confirm',
};

function validPayload() {
  return {
    eventType: 'nightclub',
    eventName: 'DJ Set Friday',
    eventDate: '2026-06-15',
    startTime: '22:00',
    endTime: '04:00',
    clientId: '00000000-0000-0000-0000-000000000001',
    venueId: '00000000-0000-0000-0000-000000000002',
    quotedAmountCents: 150000,
    source: 'website',
  };
}

describe('POST /api/v1/bookings', () => {
  it('returns 201 with valid booking payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.eventType).toBe('nightclub');
    expect(body.data.eventName).toBe('DJ Set Friday');
    expect(body.data.status).toBe('inquiry');
    expect(body.data.tenantId).toBe(TENANT);
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('createdAt');
  });

  it('returns 400 on missing eventType (Zod validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: {
        // eventType omitted
        eventName: 'Missing Type',
        eventDate: '2026-06-15',
        startTime: '22:00',
        endTime: '04:00',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('eventType');
  });

  it('returns 400 on missing eventDate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: {
        eventType: 'nightclub',
        startTime: '22:00',
        endTime: '04:00',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 403 without booking:create permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'some:other',
      },
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 without x-tenant-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: {
        'x-actor-permissions': 'booking:create',
      },
      payload: validPayload(),
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('TENANT_REQUIRED');
  });

  it('defaults quotedAmountCents to null when omitted', async () => {
    const p = validPayload();
    delete p.quotedAmountCents;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: p,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.quotedAmountCents).toBeNull();
  });
});

describe('PATCH /api/v1/bookings/:id/status — status transitions', () => {
  let bookingId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });
    bookingId = JSON.parse(res.body).data.id;
  });

  it('inquiry → tentative returns 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'tentative' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('tentative');
  });

  it('tentative → confirmed returns 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'confirmed' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('confirmed');
  });

  it('confirmed → contracted returns 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'contracted' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('contracted');
  });

  it('contracted → completed returns 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'completed' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('completed');
  });

  it('inquiry → completed is rejected (not allowed by state machine)', async () => {
    // Create a fresh booking for this test
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });
    const id = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${id}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'completed' },
    });

    // State machine: inquiry can only transition to tentative or cancelled
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_TRANSITION');
  });

  it('completed → cancelled is rejected (completed is terminal)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'cancelled' },
    });

    // completed is a terminal state — no transitions allowed
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_TRANSITION');
  });

  it('returns 403 without booking:confirm permission', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'booking:create',
      },
      payload: { status: 'confirmed' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for nonexistent booking', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/bookings/00000000-0000-0000-0000-000000000000/status',
      headers: BASE_HEADERS,
      payload: { status: 'confirmed' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/bookings', () => {
  it('returns tenant-scoped bookings', async () => {
    // Create a booking in a different tenant
    await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: {
        'x-tenant-id': 'tenant-booking-other',
        'x-actor-permissions': 'booking:create',
      },
      payload: { ...validPayload(), eventName: 'Other Tenant Event' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const names = body.data.map((b: any) => b.eventName);
    // Should not include the other tenant's booking
    names.forEach((n: string) => expect(n).not.toBe('Other Tenant Event'));
  });

  it('returns empty array for tenant with no bookings', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings',
      headers: { 'x-tenant-id': 'tenant-no-bookings' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toEqual([]);
  });
});

describe('GET /api/v1/bookings/:id', () => {
  let bookingId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: { ...validPayload(), eventName: 'GetBooking Test' },
    });
    bookingId = JSON.parse(res.body).data.id;
  });

  it('returns 200 for own booking', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/bookings/${bookingId}`,
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.eventName).toBe('GetBooking Test');
    expect(body.data.id).toBe(bookingId);
  });

  it('returns 404 for cross-tenant access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/bookings/${bookingId}`,
      headers: { 'x-tenant-id': 'tenant-other' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for nonexistent booking', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bookings/00000000-0000-0000-0000-000000000000',
      headers: { 'x-tenant-id': TENANT },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
