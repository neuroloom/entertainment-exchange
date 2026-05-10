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

function validPayload(overrides: Record<string, unknown> = {}) {
  const base = {
    eventType: 'nightclub' as string,
    eventName: 'DJ Set Friday' as string,
    eventDate: '2026-06-15' as string,
    startTime: '22:00' as string,
    endTime: '04:00' as string,
    clientId: '00000000-0000-0000-0000-000000000001' as string,
    venueId: '00000000-0000-0000-0000-000000000002' as string,
    quotedAmountCents: 150000 as number | undefined,
    source: 'website' as string,
  };
  return { ...base, ...overrides };
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
    const p = validPayload({ quotedAmountCents: undefined });
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
    const names = body.data.map((b: { eventName: string }) => b.eventName);
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

describe('POST /api/v1/bookings/:id/cancel', () => {
  it('returns 200 cancelling an inquiry booking', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: BASE_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('cancelled');
  });

  it('returns 400 cancelling an already-cancelled booking', async () => {
    // Create and cancel a booking
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: BASE_HEADERS,
    });

    // Try to cancel again
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: BASE_HEADERS,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toContain('Cannot cancel a booking');
  });

  it('returns 400 cancelling a completed (terminal) booking', async () => {
    // Create a booking and transition to completed
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    // Move to completed
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'tentative' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'confirmed' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'contracted' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: BASE_HEADERS,
      payload: { status: 'completed' },
    });

    // Try to cancel a completed booking
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: BASE_HEADERS,
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toContain('Cannot cancel a booking');
  });

  it('returns 403 without booking:confirm permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings/00000000-0000-0000-0000-000000000000/cancel',
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'booking:create',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('booking:confirm');
  });
});

describe('POST /api/v1/bookings/:id/cancel — reversal journal', () => {
  const BIZ_ID = 'bd222222-2222-2222-2222-222222222222';
  const REV_TENANT = 'tenant-rev';
  const REV_HEADERS = {
    'x-tenant-id': REV_TENANT,
    'x-business-id': BIZ_ID,
    'x-actor-permissions': 'booking:create,booking:confirm',
  };

  it('creates reversal journal when cancelling a confirmed booking', async () => {
    // Create a booking with businessId and quotedAmountCents
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: REV_HEADERS,
      payload: validPayload({ quotedAmountCents: 150000 }),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    // Transition to confirmed
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: REV_HEADERS,
      payload: { status: 'tentative' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: REV_HEADERS,
      payload: { status: 'confirmed' },
    });

    // Cancel the confirmed booking
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: REV_HEADERS,
    });

    expect(cancelRes.statusCode).toBe(200);
    const body = JSON.parse(cancelRes.body);
    expect(body.data.status).toBe('cancelled');

    // Verify the reversal journal was created
    const { journals } = await import('../routes/booking.js');
    const allJournals = journals.listJournals(REV_TENANT, BIZ_ID);
    const reversal = allJournals.find((j: { referenceId: string | null; memo: string | null }) =>
      j.referenceId === bookingId && j.memo?.includes('reversal'),
    );
    expect(reversal).toBeDefined();
    expect(reversal!.memo).toContain('Cancel booking');
    expect(reversal!.memo).toContain('reversal');

    // Verify journal entries: debit to deferred revenue (2000), credit to booking revenue (4000)
    const entries = journals.getEntries(reversal!.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].direction).toBe('debit');
    expect(entries[0].amountCents).toBe(150000);
    expect(entries[1].direction).toBe('credit');
    expect(entries[1].amountCents).toBe(150000);
  });

  it('creates reversal journal when cancelling a contracted booking', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: REV_HEADERS,
      payload: validPayload({ quotedAmountCents: 200000 }),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    // Transition through to contracted
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: REV_HEADERS,
      payload: { status: 'tentative' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: REV_HEADERS,
      payload: { status: 'confirmed' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: REV_HEADERS,
      payload: { status: 'contracted' },
    });

    // Cancel the contracted booking
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: REV_HEADERS,
    });

    expect(cancelRes.statusCode).toBe(200);
    expect(JSON.parse(cancelRes.body).data.status).toBe('cancelled');

    // Verify reversal journal entries with correct amounts
    const { journals } = await import('../routes/booking.js');
    const allJournals = journals.listJournals(REV_TENANT, BIZ_ID);
    const reversal = allJournals.find((j: { referenceId: string | null; memo: string | null }) =>
      j.referenceId === bookingId && j.memo?.includes('reversal'),
    );
    expect(reversal).toBeDefined();

    const entries = journals.getEntries(reversal!.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].amountCents).toBe(200000);
    expect(entries[1].amountCents).toBe(200000);
  });

  it('does NOT create reversal journal when cancelling an inquiry booking', async () => {
    // Create a fresh booking (inquiry status)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: REV_HEADERS,
      payload: validPayload({ quotedAmountCents: 100000 }),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    // Count existing reversal journals for this tenant/business
    const { journals } = await import('../routes/booking.js');
    const beforeCount = journals.listJournals(REV_TENANT, BIZ_ID).length;

    // Cancel the inquiry booking (no reversal should be created)
    await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: REV_HEADERS,
    });

    const afterCount = journals.listJournals(REV_TENANT, BIZ_ID).length;
    // No new journals should have been added for this booking cancellation
    expect(afterCount).toBe(beforeCount);
  });

  it('does NOT create reversal when quotedAmountCents is null', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: REV_HEADERS,
      payload: validPayload({ quotedAmountCents: undefined }),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    // Transition to confirmed (no amount set)
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: REV_HEADERS,
      payload: { status: 'tentative' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: REV_HEADERS,
      payload: { status: 'confirmed' },
    });

    const { journals } = await import('../routes/booking.js');
    const beforeCount = journals.listJournals(REV_TENANT, BIZ_ID).length;

    await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingId}/cancel`,
      headers: REV_HEADERS,
    });

    const afterCount = journals.listJournals(REV_TENANT, BIZ_ID).length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('PUT /api/v1/bookings/:id', () => {
  it('returns 200 with valid booking:manage permission', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/bookings/${bookingId}`,
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'booking:manage',
      },
      payload: { eventName: 'Updated Event Name' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.eventName).toBe('Updated Event Name');
  });

  it('returns 403 without booking:manage permission', async () => {
    // Create a booking
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: BASE_HEADERS,
      payload: validPayload(),
    });
    const bookingId = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/bookings/${bookingId}`,
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'some:other',
      },
      payload: { eventName: 'Should Not Update' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('booking:manage');
  });

  it('returns 404 for nonexistent booking', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/bookings/00000000-0000-0000-0000-000000000000',
      headers: {
        'x-tenant-id': TENANT,
        'x-actor-permissions': 'booking:manage',
      },
      payload: { eventName: 'Ghost Update' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
