// E2E Golden Path Seed — exercises every domain in the EntEx
// Run: npx tsx src/seed.ts  (or NODE_ENV=test npx tsx src/seed.ts)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'seed-e2e-jwt-secret-at-least-32-chars-long!';
import { buildServer } from './server.js';

function headers(tenantId: string, perms: string[], actorId = 'seed-user', actorType = 'human') {
  const base: Record<string, string> = {
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-type': actorType,
    'x-actor-permissions': perms.join(','),
    'content-type': 'application/json',
  };
  return (extra?: Record<string, string | undefined>): Record<string, string> => {
    if (!extra) return base;
    const merged = { ...base };
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) merged[k] = v;
    }
    return merged;
  };
}

async function main() {
  const app = await buildServer();

  const log = (label: string, ok: boolean, extra = '') =>
    console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);

  const pass = { pass: 0, fail: 0 };
  const expect = (label: string, ok: boolean, extra = '') => { log(label, ok, extra); ok ? pass.pass++ : pass.fail++; };

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  EntEx — E2E  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ── 1. IDENTITY — Register + Login ──────────────────────────────────
  console.log('── 1. Identity ──');

  const reg = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: 'demo@entertainment.exchange', password: 'demodemo123', firstName: 'Demo', lastName: 'User', tenantName: 'Golden Path Agency' },
  });
  const regBody = reg.json();
  const tenantId: string = regBody.data?.tenant?.id;
  const userId: string = regBody.data?.user?.id;
  expect('Register tenant + owner', reg.statusCode === 201 && !!tenantId, tenantId?.slice(0, 8));

  const login = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email: 'demo@entertainment.exchange', password: 'demodemo123' },
  });
  expect('Login', login.statusCode === 200 && login.json().data?.tenantId === tenantId);

  const fullPerms = ['business:create', 'business:manage', 'booking:create', 'booking:confirm',
    'payment:create', 'payout:release', 'agent:run', 'agent:approve',
    'listing:publish', 'deal:close', 'rights:issue', 'audit:view'];
  const h = headers(tenantId, fullPerms, userId);

  // ── 2. BUSINESS — Create + Chart of Accounts ──────────────────────
  console.log('\n── 2. Business ──');

  const biz = await app.inject({
    method: 'POST', url: '/api/v1/businesses', headers: h(),
    payload: { name: 'Golden Path Entertainment', vertical: 'entertainment', legalName: 'Golden Path Entertainment LLC' },
  });
  const bizBody = biz.json();
  const businessId: string = bizBody.data?.id;
  const accounts = bizBody.accounts;
  expect('Create business', biz.statusCode === 201 && !!businessId, businessId?.slice(0, 8));
  expect('Default chart of accounts', accounts?.length === 6, `${accounts?.length} accounts`);

  const bizList = await app.inject({ method: 'GET', url: '/api/v1/businesses', headers: h() });
  expect('List businesses', bizList.json().data?.length === 1);

  const bizGet = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}`, headers: h() });
  expect('Get business', bizGet.json().data?.name === 'Golden Path Entertainment');
  expect('Cross-tenant block', (await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}`, headers: headers('other-tenant', fullPerms)() })).statusCode === 404);

  const metrics = await app.inject({ method: 'GET', url: `/api/v1/businesses/${businessId}/metrics`, headers: h() });
  expect('Business metrics', metrics.json().data?.recognizedRevenue === 0);

  // ── 3. BOOKING — Full lifecycle ──────────────────────────────────
  console.log('\n── 3. Booking ──');

  const hbiz = h({ 'x-business-id': businessId });
  const booking = await app.inject({
    method: 'POST', url: '/api/v1/bookings', headers: hbiz,
    payload: { eventType: 'wedding', eventName: 'Smith-Johnson Wedding', eventDate: '2026-08-15',
      startTime: '2026-08-15T16:00:00Z', endTime: '2026-08-15T23:00:00Z',
      quotedAmountCents: 350000, source: 'website' },
  });
  const bookingId: string = booking.json().data?.id;
  expect('Create booking', booking.statusCode === 201 && !!bookingId, `${booking.json().data?.status}`);

  for (const status of ['tentative', 'confirmed', 'contracted', 'completed'] as const) {
    const p = await app.inject({
      method: 'PATCH', url: `/api/v1/bookings/${bookingId}/status`, headers: h(),
      payload: { status },
    });
    expect(status.charAt(0).toUpperCase() + status.slice(1), p.statusCode === 200);
  }

  const bookings = await app.inject({ method: 'GET', url: '/api/v1/bookings', headers: h() });
  expect('List bookings', bookings.json().data?.length === 1);

  // ── 4. LEDGER — Double-entry journal + revenue ───────────────────
  console.log('\n── 4. Ledger ──');

  const acctsResp = await app.inject({ method: 'GET', url: `/api/v1/ledger/accounts?businessId=${businessId}`, headers: h() });
  const accts = acctsResp.json().data as { id: string; code: string }[];
  const cashAcct = accts.find(a => a.code === '1000')!;
  const deferredAcct = accts.find(a => a.code === '2000')!;
  const revenueAcct = accts.find(a => a.code === '4000')!;
  expect('Ledger accounts seeded', !!cashAcct && !!deferredAcct && !!revenueAcct, '6 accounts');

  const journal = await app.inject({
    method: 'POST', url: '/api/v1/ledger/journal', headers: h(),
    payload: {
      businessId,
      memo: 'Deposit for Smith-Johnson Wedding',
      entries: [
        { accountId: cashAcct.id, direction: 'debit', amountCents: 175000 },
        { accountId: deferredAcct.id, direction: 'credit', amountCents: 175000 },
      ],
      referenceType: 'booking', referenceId: bookingId,
    },
  });
  expect('Post journal (deposit)', journal.statusCode === 201, `${journal.json().data?.journal?.id?.slice(0, 8)}`);
  expect('Journal entries valid', journal.json().data?.entries?.length === 2);

  const badJournal = await app.inject({
    method: 'POST', url: '/api/v1/ledger/journal', headers: h(),
    payload: { businessId, memo: 'Bad', entries: [
      { accountId: cashAcct.id, direction: 'debit', amountCents: 10000 },
    ]},
  });
  expect('Rejects unbalanced journal', badJournal.statusCode === 400);

  const rev = await app.inject({
    method: 'POST', url: '/api/v1/ledger/revenue', headers: h(),
    payload: { businessId, eventType: 'deposit', amountCents: 175000,
      recognitionDate: '2026-08-15', referenceType: 'booking', referenceId: bookingId },
  });
  expect('Revenue event', rev.statusCode === 201 && rev.json().data?.event?.amountCents === 175000);

  // ── 5. AGENTS — Create + Run ────────────────────────────────────
  console.log('\n── 5. Agent ──');

  const agent = await app.inject({
    method: 'POST', url: '/api/v1/agents', headers: h(),
    payload: { name: 'Booking Scout', role: 'scout', businessId,
      autonomyLevel: 3, budgetDailyCents: 50000 },
  });
  const agentId: string = agent.json().data?.id;
  expect('Create agent', agent.statusCode === 201 && !!agentId, `autonomy L${agent.json().data?.autonomyLevel}`);

  const run = await app.inject({
    method: 'POST', url: `/api/v1/agents/${agentId}/runs`, headers: h(),
    payload: { goal: 'Find 5 wedding venues in NYC metro area within budget' },
  });
  const runId: string = run.json().data?.id;
  expect('Trigger agent run', run.statusCode === 201 && !!runId, runId?.slice(0, 8));

  const runs = await app.inject({ method: 'GET', url: `/api/v1/agents/${agentId}/runs`, headers: h() });
  expect('List agent runs', runs.json().data?.length === 1);

  // ── 6. MARKETPLACE — Listings + Deals ────────────────────────────
  console.log('\n── 6. Marketplace ──');

  const listing = await app.inject({
    method: 'POST', url: '/api/v1/marketplace/listings', headers: h(),
    payload: { sellerBusinessId: businessId, listingType: 'artist_availability',
      title: 'Wedding Band — Summer 2026 Saturdays', askingPriceCents: 250000,
      evidenceTier: 'platform_verified' },
  });
  const listingId: string = listing.json().data?.id;
  expect('Create listing', listing.statusCode === 201 && !!listingId, listing.json().data?.evidenceTier);

  const publish = await app.inject({
    method: 'PATCH', url: `/api/v1/marketplace/listings/${listingId}/publish`, headers: h(),
    payload: {},
  });
  expect('Publish listing', publish.statusCode === 200 && publish.json().data?.status === 'published');

  const deal = await app.inject({
    method: 'POST', url: '/api/v1/marketplace/deals', headers: h(),
    payload: { listingId, buyerUserId: userId },
  });
  expect('Create deal room', deal.statusCode === 201 && deal.json().data?.status === 'created');

  // ── 7. RIGHTS — Anchors → Assets → Passports ─────────────────────
  console.log('\n── 7. Rights ──');

  const anchor = await app.inject({
    method: 'POST', url: '/api/v1/rights/anchors', headers: h(),
    payload: { documentUri: 'ipfs://QmExample123', documentHash: 'sha256:abc123def456',
      documentType: 'master_recording_license' },
  });
  const anchorId: string = anchor.json().data?.id;
  expect('Legal anchor', anchor.statusCode === 201 && !!anchorId);

  const asset = await app.inject({
    method: 'POST', url: '/api/v1/rights/assets', headers: h(),
    payload: { businessId, assetType: 'sound_recording', title: 'Live at Golden Path — Master' },
  });
  const assetId: string = asset.json().data?.id;
  expect('Rights asset', asset.statusCode === 201 && !!assetId);

  const passport = await app.inject({
    method: 'POST', url: '/api/v1/rights/passports', headers: h(),
    payload: { rightsAssetId: assetId, legalAnchorId: anchorId, passportType: 'full_rights' },
  });
  const passportId: string = passport.json().data?.id;
  expect('Issue passport', passport.statusCode === 201 && !!passportId, passportId?.slice(0, 8));

  // ── 8. CROSS-CUTTING ────────────────────────────────────────────
  console.log('\n── 8. Cross-Cutting ──');

  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: h() });
  expect('Session check', me.statusCode === 200 && me.json().data?.email === 'demo@entertainment.exchange');

  const health = await app.inject({ method: 'GET', url: '/health' });
  const healthBody = health.json();
  expect('Health check', healthBody.status === 'ok' || healthBody.status === 'degraded', healthBody.status);

  const noPerm = await app.inject({
    method: 'POST', url: '/api/v1/businesses',
    headers: headers(tenantId, [])(),
    payload: { name: 'Should Fail' },
  });
  expect('Permission gate (403)', noPerm.statusCode === 403);

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  TOTAL: ${pass.pass} pass, ${pass.fail} fail`);
  console.log(`  ${pass.fail === 0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  await app.close();
  process.exit(pass.fail > 0 ? 1 : 0);
}

main().catch(err => { console.error('E2E seed failed:', err); process.exit(1); });
