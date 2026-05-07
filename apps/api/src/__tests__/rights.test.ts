// Rights tests — legal anchors, rights assets, passports
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const BUSINESS_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function headers(tenantId: string, permissions: string) {
  return {
    'x-tenant-id': tenantId,
    'x-actor-permissions': permissions,
  };
}

describe('Rights routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Create Legal Anchor ─────────────────────────────────────────────────

  describe('POST /api/v1/rights/anchors', () => {
    it('creates a legal anchor with 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          documentUri: 'ipfs://QmLegalAnchor123',
          documentHash: '0xabcdef1234567890',
          documentType: 'copyright_registration',
          metadata: { jurisdiction: 'US', registrationNumber: 'REG-2026-001' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.documentUri).toBe('ipfs://QmLegalAnchor123');
      expect(body.data.documentHash).toBe('0xabcdef1234567890');
      expect(body.data.documentType).toBe('copyright_registration');
      expect(body.data.tenantId).toBe(TENANT_A);
      expect(body.data.metadata.jurisdiction).toBe('US');
      expect(body.data.id).toBeDefined();
    });

    it('returns 403 without rights:issue permission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_A, 'read'),
        payload: {
          documentUri: 'ipfs://Blocked',
          documentHash: '0xdead',
          documentType: 'trademark',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when tenant id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/anchors',
        headers: { 'x-actor-permissions': 'rights:issue' },
        payload: {
          documentUri: 'ipfs://NoTenant',
          documentHash: '0xnone',
          documentType: 'patent',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('TENANT_REQUIRED');
    });
  });

  // ── Create Rights Asset ─────────────────────────────────────────────────

  describe('POST /api/v1/rights/assets', () => {
    it('creates a rights asset with 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/assets',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          businessId: BUSINESS_ID,
          assetType: 'film_catalog',
          title: 'Summer Blockbuster Collection',
          metadata: { genre: 'action', releaseYear: 2026 },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.businessId).toBe(BUSINESS_ID);
      expect(body.data.assetType).toBe('film_catalog');
      expect(body.data.title).toBe('Summer Blockbuster Collection');
      expect(body.data.status).toBe('active');
      expect(body.data.tenantId).toBe(TENANT_A);
      expect(body.data.id).toBeDefined();
    });

    it('returns 403 without rights:issue permission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/assets',
        headers: headers(TENANT_A, 'none'),
        payload: {
          businessId: BUSINESS_ID,
          assetType: 'music_library',
          title: 'Blocked Asset',
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Issue Passport ──────────────────────────────────────────────────────

  describe('POST /api/v1/rights/passports', () => {
    let assetId: string;
    let anchorId: string;

    beforeAll(async () => {
      const anchorRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          documentUri: 'ipfs://QmAnchorForPassport',
          documentHash: '0xpassportanchor',
          documentType: 'chain_of_title',
        },
      });
      anchorId = JSON.parse(anchorRes.payload).data.id;

      const assetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/assets',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          businessId: BUSINESS_ID,
          assetType: 'film_rights',
          title: 'Licensable Film',
        },
      });
      assetId = JSON.parse(assetRes.payload).data.id;
    });

    it('issues a passport with 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/passports',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          rightsAssetId: assetId,
          legalAnchorId: anchorId,
          passportType: 'distribution_license',
          metadata: { territory: 'North America', term: '5 years' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.rightsAssetId).toBe(assetId);
      expect(body.data.legalAnchorId).toBe(anchorId);
      expect(body.data.passportType).toBe('distribution_license');
      expect(body.data.status).toBe('active');
      expect(body.data.tenantId).toBe(TENANT_A);
      expect(body.data.id).toBeDefined();
    });

    it('returns 404 when rights asset is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/passports',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          rightsAssetId: '99999999-9999-4999-9999-999999999999',
          legalAnchorId: anchorId,
          passportType: 'distribution_license',
        },
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('RightsAsset');
    });

    it('returns 404 when legal anchor is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/passports',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          rightsAssetId: assetId,
          legalAnchorId: '99999999-9999-4999-9999-999999999999',
          passportType: 'production_rights',
        },
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('LegalAnchor');
    });

    it('returns 403 without rights:issue permission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/passports',
        headers: headers(TENANT_A, 'read'),
        payload: {
          rightsAssetId: assetId,
          legalAnchorId: anchorId,
          passportType: 'blocked',
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Chain of Title ──────────────────────────────────────────────────────

  describe('GET /api/v1/rights/assets/:id/chain-of-title', () => {
    let assetId: string;
    let anchorId: string;

    beforeAll(async () => {
      const anchorRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          documentUri: 'ipfs://QmChainAnchor',
          documentHash: '0xchain123',
          documentType: 'chain_of_title',
        },
      });
      anchorId = JSON.parse(anchorRes.payload).data.id;

      const assetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/assets',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          businessId: BUSINESS_ID,
          assetType: 'film_rights',
          title: 'Chain Test Film',
        },
      });
      assetId = JSON.parse(assetRes.payload).data.id;

      // Issue a passport so chain has an entry
      await app.inject({
        method: 'POST',
        url: '/api/v1/rights/passports',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          rightsAssetId: assetId,
          legalAnchorId: anchorId,
          passportType: 'distribution_license',
        },
      });
    });

    it('returns chain of title with expected fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/rights/assets/${assetId}/chain-of-title`,
        headers: headers(TENANT_A, 'rights:issue'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.assetId).toBe(assetId);
      expect(Array.isArray(body.data.entries)).toBe(true);
      expect(body.data.entries.length).toBeGreaterThanOrEqual(1);
      expect(typeof body.data.isUnbroken).toBe('boolean');
      expect(typeof body.data.chainLength).toBe('number');
    });

    it('returns 404 for non-existent asset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/rights/assets/99999999-9999-4999-9999-999999999999/chain-of-title',
        headers: headers(TENANT_A, 'rights:issue'),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Transferability Score ────────────────────────────────────────────────

  describe('GET /api/v1/rights/businesses/:id/transferability', () => {
    let assetId: string;
    let anchorId: string;

    beforeAll(async () => {
      const anchorRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          documentUri: 'ipfs://QmTransferableAnchor',
          documentHash: '0xtransfer123',
          documentType: 'chain_of_title',
        },
      });
      anchorId = JSON.parse(anchorRes.payload).data.id;

      const assetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rights/assets',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          businessId: BUSINESS_ID,
          assetType: 'film_rights',
          title: 'Transferable Film',
        },
      });
      assetId = JSON.parse(assetRes.payload).data.id;

      await app.inject({
        method: 'POST',
        url: '/api/v1/rights/passports',
        headers: headers(TENANT_A, 'rights:issue'),
        payload: {
          rightsAssetId: assetId,
          legalAnchorId: anchorId,
          passportType: 'distribution_license',
        },
      });
    });

    it('returns transferability score with grade', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/rights/businesses/${BUSINESS_ID}/transferability`,
        headers: headers(TENANT_A, 'rights:issue'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(typeof body.data.total).toBe('number');
      expect(body.data.total).toBeGreaterThanOrEqual(0);
      expect(body.data.total).toBeLessThanOrEqual(100);
      expect(body.data.breakdown).toBeDefined();
      expect(typeof body.data.grade).toBe('string');
      expect(['A', 'B', 'C', 'D', 'F']).toContain(body.data.grade);
    });

    it('returns 400 when tenant id is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/rights/businesses/${BUSINESS_ID}/transferability`,
        headers: { 'x-actor-permissions': 'rights:issue' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Tenant Scoping ──────────────────────────────────────────────────────

  describe('tenant scoping', () => {
    it('isolates anchors between tenants', async () => {
      // Create an anchor in Tenant B
      await app.inject({
        method: 'POST',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_B, 'rights:issue'),
        payload: {
          documentUri: 'ipfs://TenBOnly',
          documentHash: '0xbbb',
          documentType: 'nda',
        },
      });

      // List Tenant A anchors
      const resList = await app.inject({
        method: 'GET',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_A, 'rights:issue'),
      });
      const body = JSON.parse(resList.payload);
      for (const anchor of body.data) {
        expect(anchor.tenantId).not.toBe(TENANT_B);
      }
    });

    it('returns 404 for cross-tenant anchor access', async () => {
      // Get all anchors for Tenant B
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/rights/anchors',
        headers: headers(TENANT_B, 'rights:issue'),
      });
      const bAnchors = JSON.parse(listRes.payload).data;
      if (bAnchors.length > 0) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/rights/anchors/${bAnchors[0].id}`,
          headers: headers(TENANT_A, 'rights:issue'),
        });
        expect(res.statusCode).toBe(404);
      }
    });

    it('isolates assets between tenants', async () => {
      const resA = await app.inject({
        method: 'GET',
        url: '/api/v1/rights/assets',
        headers: headers(TENANT_A, 'rights:issue'),
      });
      const body = JSON.parse(resA.payload);
      for (const asset of body.data) {
        expect(asset.tenantId).toBe(TENANT_A);
      }
    });
  });
});
