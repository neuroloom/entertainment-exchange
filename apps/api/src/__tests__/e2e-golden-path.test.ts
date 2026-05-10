// E2E Golden Path Test — full business lifecycle across all domains
// register -> business -> booking -> status transitions -> journal -> revenue recognition
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';

describe('E2E Golden Path', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let tenantId: string;
  let userId: string;
  let businessId: string;
  let bookingId: string;
  let cashAccountId: string;
  let deferredAccountId: string;
  let revenueAccountId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-e2e-secret-at-least-32-chars-long-!!';
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Helper that builds auth headers scoped to a specific tenant/user/permission set.
   */
  function headers(perms: string) {
    return {
      'x-tenant-id': tenantId,
      'x-actor-id': userId,
      'x-actor-type': 'human',
      'x-actor-permissions': perms,
    };
  }

  it('full lifecycle: register -> business -> booking -> journal -> revenue', async () => {
    // ── 1. Register a new user ──────────────────────────────────────────────
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'e2e@test.com',
        password: 'e2e-test-password-secure',
        firstName: 'E2E',
        lastName: 'GoldenPath',
        tenantName: 'E2E Productions',
      },
    });
    expect(registerRes.statusCode).toBe(201);
    const reg = JSON.parse(registerRes.body);
    expect(reg.data.user.email).toBe('e2e@test.com');
    expect(reg.data.user).toHaveProperty('id');
    expect(reg.data.tenant).toHaveProperty('id');
    expect(reg.data.membership.role).toBe('tenant_admin');
    userId = reg.data.user.id;
    tenantId = reg.data.tenant.id;

    // ── 2. Create a business ───────────────────────────────────────────────
    const bizRes = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: headers('business:create,business:manage'),
      payload: {
        name: 'E2E Entertainment',
        vertical: 'music',
        legalName: 'E2E Entertainment LLC',
      },
    });
    expect(bizRes.statusCode).toBe(201);
    const biz = JSON.parse(bizRes.body);
    expect(biz.data.name).toBe('E2E Entertainment');
    expect(biz.data.vertical).toBe('music');
    expect(biz.data.status).toBe('active');
    businessId = biz.data.id;
    // Business creation returns accounts at the top level alongside data
    expect(biz.accounts).toHaveLength(6);

    // ── 3. Fetch chart of accounts from the ledger endpoint ────────────────
    // The ledger route maintains its own account store, so we fetch from it
    // to get account IDs that will work with journal/revenue routes.
    const acctsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/accounts?businessId=${businessId}`,
      headers: headers(''),
    });
    expect(acctsRes.statusCode).toBe(200);
    const accounts = JSON.parse(acctsRes.body).data;
    expect(accounts).toHaveLength(6);
    cashAccountId = accounts.find((a: { code: string; id: string }) => a.code === '1000').id;
    deferredAccountId = accounts.find((a: { code: string; id: string }) => a.code === '2000').id;
    revenueAccountId = accounts.find((a: { code: string; id: string }) => a.code === '4000').id;
    expect(cashAccountId).toBeDefined();
    expect(deferredAccountId).toBeDefined();
    expect(revenueAccountId).toBeDefined();

    // ── 4. Create a booking ────────────────────────────────────────────────
    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: headers('booking:create'),
      payload: {
        eventType: 'concert',
        eventName: 'E2E Summer Fest',
        eventDate: '2026-07-15',
        startTime: '19:00',
        endTime: '22:00',
        quotedAmountCents: 500000,
        source: 'website',
      },
    });
    expect(bookingRes.statusCode).toBe(201);
    const booking = JSON.parse(bookingRes.body).data;
    expect(booking.status).toBe('inquiry');
    expect(booking.eventName).toBe('E2E Summer Fest');
    bookingId = booking.id;

    // ── 5. Status transition: inquiry -> tentative ─────────────────────────
    // State machine requires this intermediate step before confirmed
    const tentativeRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: headers('booking:confirm'),
      payload: { status: 'tentative' },
    });
    expect(tentativeRes.statusCode).toBe(200);
    expect(JSON.parse(tentativeRes.body).data.status).toBe('tentative');

    // ── 6. Status transition: tentative -> confirmed ───────────────────────
    const confirmRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${bookingId}/status`,
      headers: headers('booking:confirm'),
      payload: { status: 'confirmed' },
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(JSON.parse(confirmRes.body).data.status).toBe('confirmed');

    // ── 7. Post deposit journal (Stripe webhook simulation) ────────────────
    // Debit Cash 1000, Credit Deferred Revenue 2000
    const journalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/journal',
      headers: headers('payment:create'),
      payload: {
        businessId,
        memo: 'E2E booking deposit — Stripe webhook',
        entries: [
          { accountId: cashAccountId, direction: 'debit', amountCents: 500000 },
          { accountId: deferredAccountId, direction: 'credit', amountCents: 500000 },
        ],
        referenceType: 'booking',
        referenceId: bookingId,
      },
    });
    expect(journalRes.statusCode).toBe(201);
    const journalData = JSON.parse(journalRes.body).data;
    expect(journalData.journal.memo).toBe('E2E booking deposit — Stripe webhook');
    expect(journalData.journal.businessId).toBe(businessId);
    expect(journalData.entries).toHaveLength(2);

    // ── 8. Recognize revenue (event completion triggers recognition) ───────
    // Debit Deferred Revenue 2000, Credit Booking Revenue 4000
    const revenueRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ledger/revenue',
      headers: headers('payment:create'),
      payload: {
        businessId,
        eventType: 'recognize',
        amountCents: 500000,
        referenceType: 'booking',
        referenceId: bookingId,
      },
    });
    expect(revenueRes.statusCode).toBe(201);
    const revData = JSON.parse(revenueRes.body).data;
    expect(revData.event.eventType).toBe('recognize');
    expect(revData.event.amountCents).toBe(500000);
    expect(revData.journal).toHaveProperty('id');
    expect(Array.isArray(revData.entries)).toBe(true);

    // ── 9. Verify journals are reachable ───────────────────────────────────
    const journalsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/ledger/journals?businessId=${businessId}`,
      headers: headers(''),
    });
    expect(journalsRes.statusCode).toBe(200);
    const journals = JSON.parse(journalsRes.body).data;
    // We posted at least 2 journals (manual deposit + revenue recognition)
    expect(journals.length).toBeGreaterThanOrEqual(2);
    // The deposit journal should be findable
    const memos = journals.map((j: { memo: string }) => j.memo);
    expect(memos).toContain('E2E booking deposit — Stripe webhook');

    // ── 10. Verify booking is confirmed ────────────────────────────────────
    const bookingGetRes = await app.inject({
      method: 'GET',
      url: `/api/v1/bookings/${bookingId}`,
      headers: headers(''),
    });
    expect(bookingGetRes.statusCode).toBe(200);
    expect(JSON.parse(bookingGetRes.body).data.status).toBe('confirmed');
    expect(JSON.parse(bookingGetRes.body).data.eventName).toBe('E2E Summer Fest');
  });
});
