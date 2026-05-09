// Marketplace tests — listings, evidence tiers, publishing, deals
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const SELLER_BUSINESS_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const BUYER_USER_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

function headers(tenantId: string, permissions: string) {
  return {
    'x-tenant-id': tenantId,
    'x-actor-permissions': permissions,
  };
}

describe('Marketplace routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Create Listing ──────────────────────────────────────────────────────

  describe('POST /api/v1/marketplace/listings', () => {
    it('creates a listing with 201 and includes evidence tier', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Customer Support Agent - 99% CSAT',
          askingPriceCents: 500000,
          evidenceTier: 'platform_verified',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.listingType).toBe('agent');
      expect(body.data.title).toBe('Customer Support Agent - 99% CSAT');
      expect(body.data.evidenceTier).toBe('platform_verified');
      expect(body.data.status).toBe('draft');
      expect(body.data.tenantId).toBe(TENANT_A);
      expect(body.data.sellerBusinessId).toBe(SELLER_BUSINESS_ID);
      expect(body.data.askingPriceCents).toBe(500000);
    });

    it('defaults evidenceTier to self_reported when omitted', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'workflow',
          title: 'Basic Workflow',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.evidenceTier).toBe('self_reported');
    });

    it('returns 403 without listing:publish permission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'read'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Blocked Listing',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when tenant id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: { 'x-actor-permissions': 'listing:publish' },
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'No Tenant',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('TENANT_REQUIRED');
    });

    it('returns 400 for invalid evidence tier', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Bad Evidence Tier',
          evidenceTier: 'super_verified',
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── List Listings ───────────────────────────────────────────────────────

  describe('GET /api/v1/marketplace/listings', () => {
    beforeAll(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Tenant A Listing',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_B, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'company',
          title: 'Tenant B Listing',
        },
      });
    });

    it('returns tenant-scoped listings', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body.data)).toBe(true);
      for (const listing of body.data) {
        expect(listing.tenantId).toBe(TENANT_A);
      }
    });

    it('returns 400 when tenant id is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/listings',
        headers: { 'x-actor-permissions': 'listing:publish' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Publish Listing ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/marketplace/listings/:id/publish', () => {
    let listingId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Publishable Agent',
          evidenceTier: 'document_supported',
        },
      });
      listingId = JSON.parse(res.payload).data.id;
    });

    it('publishes a listing with status change and publishedAt', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/marketplace/listings/${listingId}/publish`,
        headers: headers(TENANT_A, 'listing:publish'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('published');
      expect(body.data.publishedAt).toBeDefined();
      expect(body.data.publishedAt).not.toBeNull();
    });

    it('returns 404 for non-existent listing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/marketplace/listings/nonexistent-id/publish',
        headers: headers(TENANT_A, 'listing:publish'),
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 403 without listing:publish permission', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/marketplace/listings/${listingId}/publish`,
        headers: headers(TENANT_A, 'read'),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Create Deal ─────────────────────────────────────────────────────────

  describe('POST /api/v1/marketplace/deals', () => {
    let listingId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'For Deal Agent',
        },
      });
      listingId = JSON.parse(res.payload).data.id;
    });

    it('creates a deal with 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/deals',
        headers: headers(TENANT_A, 'deal:close'),
        payload: {
          listingId,
          buyerUserId: BUYER_USER_ID,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.listingId).toBe(listingId);
      expect(body.data.status).toBe('created');
      expect(body.data.buyerUserId).toBe(BUYER_USER_ID);
      expect(body.data.tenantId).toBe(TENANT_A);
    });

    it('returns 403 without deal:close permission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/deals',
        headers: headers(TENANT_A, 'read'),
        payload: {
          listingId,
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for non-existent listing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/deals',
        headers: headers(TENANT_A, 'deal:close'),
        payload: {
          listingId: '99999999-9999-4999-9999-999999999999',
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── List Deals ──────────────────────────────────────────────────────────

  describe('GET /api/v1/marketplace/deals', () => {
    beforeAll(async () => {
      const listingRes = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Deal Room Agent',
        },
      });
      const lid = JSON.parse(listingRes.payload).data.id;

      await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/deals',
        headers: headers(TENANT_A, 'deal:close'),
        payload: { listingId: lid, buyerUserId: BUYER_USER_ID },
      });
    });

    it('returns deals (deal rooms) scoped to tenant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/deals',
        headers: headers(TENANT_A, 'deal:close'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body.data)).toBe(true);
      for (const deal of body.data) {
        expect(deal.tenantId).toBe(TENANT_A);
      }
    });

    it('returns 400 when tenant id is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/marketplace/deals',
        headers: { 'x-actor-permissions': 'deal:close' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Edge cases: PATCH published listing, PATCH deal invalid transition, DELETE nonexistent ─

  describe('PATCH /api/v1/marketplace/listings/:id — published listing', () => {
    it('returns 400 when updating a published listing (not draft)', async () => {
      // Create and publish a listing
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Soon Published',
        },
      });
      const listingId = JSON.parse(createRes.payload).data.id;

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/marketplace/listings/${listingId}/publish`,
        headers: headers(TENANT_A, 'listing:publish'),
      });

      // Try to update the now-published listing
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/marketplace/listings/${listingId}`,
        headers: headers(TENANT_A, 'listing:publish'),
        payload: { title: 'Updated Published' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message).toContain('Only draft listings can be updated');
    });
  });

  describe('PATCH /api/v1/marketplace/deals/:id — invalid transition', () => {
    it('returns 400 for an invalid deal transition (created → completed)', async () => {
      // Create a listing and deal
      const listingRes = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/listings',
        headers: headers(TENANT_A, 'listing:publish'),
        payload: {
          sellerBusinessId: SELLER_BUSINESS_ID,
          listingType: 'agent',
          title: 'Deal Transition Test',
        },
      });
      const lid = JSON.parse(listingRes.payload).data.id;

      const dealRes = await app.inject({
        method: 'POST',
        url: '/api/v1/marketplace/deals',
        headers: headers(TENANT_A, 'deal:close'),
        payload: { listingId: lid, buyerUserId: BUYER_USER_ID },
      });
      const dealId = JSON.parse(dealRes.payload).data.id;

      // created → completed is invalid (must go through negotiating → agreed → escrow_funded)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/marketplace/deals/${dealId}`,
        headers: headers(TENANT_A, 'deal:close'),
        payload: { status: 'completed' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message).toContain('Cannot transition deal');
    });
  });

  describe('DELETE /api/v1/marketplace/listings/:id — nonexistent listing', () => {
    it('returns 404 for a nonexistent listing', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/marketplace/listings/00000000-0000-0000-0000-000000000000',
        headers: headers(TENANT_A, 'listing:publish'),
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});
