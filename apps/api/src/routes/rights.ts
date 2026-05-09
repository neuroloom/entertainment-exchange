// Rights routes — legal anchors, rights assets, passports
// Tasks 036-040: POST /rights/assets, POST /rights/anchors, POST /rights/passports
// L3 MARKETPLACE+RIGHTS: Wired with PassportVerifier, chain-of-title, transferability scoring
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { MemoryStore, AuditStore } from '../services/repo.js';
import { journalStore, getOrCreateAccounts } from './ledger.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings, deals } from './marketplace.js';
import {
  PassportVerifier,
  TransferabilityScorer,
} from '@entertainment-exchange/orchestration';
import type {
  LegalAnchor,
  RightsAsset,
  RightsPassport,
  BusinessProfile,
} from '@entertainment-exchange/orchestration';

const CreateAnchorSchema = z.object({
  documentUri: z.string().min(1),
  documentHash: z.string().min(1),
  documentType: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const CreateAssetSchema = z.object({
  businessId: z.string().uuid(),
  assetType: z.string().min(1),
  title: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const IssuePassportSchema = z.object({
  rightsAssetId: z.string().uuid(),
  legalAnchorId: z.string().uuid(),
  passportType: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.string().optional(),
});

const anchors = new MemoryStore<LegalAnchor>('legal_anchors');
const assets = new MemoryStore<RightsAsset>('rights_assets');
const passports = new MemoryStore<RightsPassport>('rights_passports');
const auditEvents = new AuditStore();

// Create a shared PassportVerifier backed by the route-level stores
const passVerifier = new PassportVerifier({ anchors: anchors as any, assets: assets as any, passports: passports as any });

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function rightsRoutes(app: FastifyInstance) {
  // ═══ Legal Anchors ══════════════════════════════════════════════════════════

  app.post('/anchors', {
    schema: {
      body: {
        type: 'object',
        required: ['documentUri', 'documentHash', 'documentType'],
        properties: {
          documentUri: { type: 'string', minLength: 1 },
          documentHash: { type: 'string', minLength: 1 },
          documentType: { type: 'string', minLength: 1 },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const body = CreateAnchorSchema.parse(req.body);
    const anchorId = uuid();
    const anchor: LegalAnchor = {
      id: anchorId, tenantId: ctx.tenantId, documentUri: body.documentUri,
      documentHash: body.documentHash, documentType: body.documentType,
      metadata: body.metadata ?? {}, createdAt: new Date().toISOString(),
    };
    anchors.set(anchor);
    writeAudit(ctx, 'anchor.create', 'legal_anchor', anchorId, undefined, { documentType: body.documentType });
    reply.status(201).send({ data: anchor });
  });

  app.get('/anchors', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const p = paginate(req.query);
    const all = anchors.all(ctx.tenantId);
    const sliced = all.slice(p.offset, p.offset + p.limit);

    reply.send(paginatedResponse(sliced, all.length, p));
  });

  app.get('/anchors/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const a = anchors.get((req.params as any).id);
    if (!a || a.tenantId !== ctx.tenantId) throw AppError.notFound('LegalAnchor');
    reply.send({ data: a });
  });

  app.patch('/anchors/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          documentUri: { type: 'string', minLength: 1 },
          documentHash: { type: 'string', minLength: 1 },
          metadata: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const anchor = anchors.get((req.params as any).id);
    if (!anchor || anchor.tenantId !== ctx.tenantId) throw AppError.notFound('LegalAnchor');

    const body = z.object({
      documentUri: z.string().min(1).optional(),
      documentHash: z.string().min(1).optional(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const updated = { ...anchor };
    if (body.documentUri !== undefined) updated.documentUri = body.documentUri;
    if (body.documentHash !== undefined) updated.documentHash = body.documentHash;
    if (body.metadata !== undefined) updated.metadata = body.metadata;
    anchors.set(updated);

    writeAudit(ctx, 'anchor.update', 'legal_anchor', anchor.id, undefined, { changes: Object.keys(body) });
    reply.send({ data: updated });
  });

  // ═══ Rights Assets ═══════════════════════════════════════════════════════════

  app.post('/assets', {
    schema: {
      body: {
        type: 'object',
        required: ['businessId', 'assetType', 'title'],
        properties: {
          businessId: { type: 'string', format: 'uuid' },
          assetType: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const body = CreateAssetSchema.parse(req.body);
    const assetId = uuid();
    const asset: RightsAsset = {
      id: assetId, tenantId: ctx.tenantId, businessId: body.businessId,
      assetType: body.assetType, title: body.title, status: 'active',
      metadata: body.metadata ?? {}, createdAt: new Date().toISOString(),
    };
    assets.set(asset);
    writeAudit(ctx, 'asset.create', 'rights_asset', assetId, body.businessId);
    reply.status(201).send({ data: asset });
  });

  app.get('/assets', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const p = paginate(req.query);
    const all = assets.all(ctx.tenantId);
    const sliced = all.slice(p.offset, p.offset + p.limit);

    reply.send(paginatedResponse(sliced, all.length, p));
  });

  app.patch('/assets/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          metadata: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const asset = assets.get((req.params as any).id);
    if (!asset || asset.tenantId !== ctx.tenantId) throw AppError.notFound('RightsAsset');

    const body = z.object({
      title: z.string().min(1).optional(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const updated = { ...asset };
    if (body.title !== undefined) updated.title = body.title;
    if (body.metadata !== undefined) updated.metadata = body.metadata;
    assets.set(updated);

    writeAudit(ctx, 'asset.update', 'rights_asset', asset.id, asset.businessId, { changes: Object.keys(body) });
    reply.send({ data: updated });
  });

  app.delete('/assets/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const asset = assets.get((req.params as any).id);
    if (!asset || asset.tenantId !== ctx.tenantId) throw AppError.notFound('RightsAsset');

    const archived = { ...asset, status: 'archived' };
    assets.set(archived);

    writeAudit(ctx, 'asset.archive', 'rights_asset', asset.id, asset.businessId);
    reply.send({ data: archived });
  });

  app.get('/assets/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const a = assets.get((req.params as any).id);
    if (!a || a.tenantId !== ctx.tenantId) throw AppError.notFound('RightsAsset');
    reply.send({ data: a });
  });

  // ─── Chain of Title endpoint ────────────────────────────────────────────────

  app.get('/assets/:id/chain-of-title', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const assetId = (req.params as any).id;
    const asset = assets.get(assetId);
    if (!asset || asset.tenantId !== ctx.tenantId) throw AppError.notFound('RightsAsset');

    const chain = passVerifier.getChainOfTitle(assetId);
    reply.send({ data: chain });
  });

  // ═══ Passports (wired to PassportVerifier) ══════════════════════════════════

  app.post('/passports', {
    schema: {
      body: {
        type: 'object',
        required: ['rightsAssetId', 'legalAnchorId', 'passportType'],
        properties: {
          rightsAssetId: { type: 'string', format: 'uuid' },
          legalAnchorId: { type: 'string', format: 'uuid' },
          passportType: { type: 'string', minLength: 1 },
          metadata: { type: 'object', additionalProperties: true },
          expiresAt: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const body = IssuePassportSchema.parse(req.body);

    // Enforce tenant ownership
    const asset = assets.get(body.rightsAssetId);
    if (!asset || asset.tenantId !== ctx.tenantId) throw AppError.notFound('RightsAsset');
    const anchor = anchors.get(body.legalAnchorId);
    if (!anchor || anchor.tenantId !== ctx.tenantId) throw AppError.notFound('LegalAnchor');

    const passportType = body.passportType as any;
    const passport = passVerifier.issuePassport(
      body.rightsAssetId,
      body.legalAnchorId,
      passportType,
      body.metadata ?? {},
      body.expiresAt,
    );

    writeAudit(ctx, 'passport.issue', 'rights_passport', passport.id, asset.businessId);
    reply.status(201).send({ data: passport });
  });

  app.get('/passports', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const p = paginate(req.query);
    const all = passports.all(ctx.tenantId);
    const sliced = all.slice(p.offset, p.offset + p.limit);

    reply.send(paginatedResponse(sliced, all.length, p));
  });

  app.get('/passports/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const p = passports.get((req.params as any).id);
    if (!p || p.tenantId !== ctx.tenantId) throw AppError.notFound('Passport');

    // Auto-expiry: check if expiresAt has passed and update status to expired
    if (p.expiresAt && p.status === 'active') {
      const expires = new Date(p.expiresAt);
      if (!isNaN(expires.getTime()) && expires < new Date()) {
        p.status = 'expired';
        passports.set(p);
      }
    }

    reply.send({ data: p });
  });

  // ─── Revoke passport ───────────────────────────────────────────────────────

  app.post('/passports/:id/revoke', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    const passportId = (req.params as any).id;
    const passport = passports.get(passportId);
    if (!passport || passport.tenantId !== ctx.tenantId) throw AppError.notFound('Passport');

    passVerifier.revokePassport(passportId, body.reason);
    writeAudit(ctx, 'passport.revoke', 'rights_passport', passportId, undefined, { reason: body.reason });
    reply.send({ data: passport });
  });

  // ─── Renew passport ─────────────────────────────────────────────────────────

  app.post('/passports/:id/renew', {
    schema: {
      body: {
        type: 'object',
        properties: {
          expiresAt: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const passportId = (req.params as any).id;
    const existing = passports.get(passportId);
    if (!existing || existing.tenantId !== ctx.tenantId) throw AppError.notFound('Passport');

    if (existing.status === 'revoked') {
      throw AppError.invalid('Cannot renew a revoked passport');
    }

    const body = z.object({ expiresAt: z.string().optional() }).parse(req.body);
    const renewed = passVerifier.renewPassport(passportId, body.expiresAt);

    writeAudit(ctx, 'passport.renew', 'rights_passport', renewed.id, assets.get(renewed.rightsAssetId)?.businessId, {
      previousPassportId: passportId,
    });
    reply.status(201).send({
      data: {
        renewed: renewed,
        previous: existing,
      },
    });
  });

  app.delete('/passports/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const passport = passports.get((req.params as any).id);
    if (!passport || passport.tenantId !== ctx.tenantId) throw AppError.notFound('Passport');
    if (passport.status === 'revoked') throw AppError.invalid('Passport already revoked');

    passport.status = 'revoked';
    passports.set(passport);

    writeAudit(ctx, 'passport.delete', 'rights_passport', passport.id,
      assets.get(passport.rightsAssetId)?.businessId);
    reply.send({ data: passport });
  });

  // ═══ Business Transferability Scoring ════════════════════════════════════════

  app.get('/businesses/:id/transferability', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.params as any).id;

    // Collect business profile from across the rights store
    const businessAssets = assets.all(ctx.tenantId).filter(a => a.businessId === businessId);
    const businessPassports = passports.all(ctx.tenantId).filter(p => {
      const a = assets.get(p.rightsAssetId);
      return a?.businessId === businessId;
    });

    let verifiedAnchors = 0;
    for (const p of businessPassports) {
      const verif = passVerifier.verifyPassport(p.id, p.legalAnchorId);
      if (verif.valid) verifiedAnchors++;
    }

    const chainChecks = businessAssets.map(a => {
      const chain = passVerifier.getChainOfTitle(a.id);
      return chain.isUnbroken;
    });

    const isExpired = businessPassports.some(p => {
      if (!p.expiresAt) return false;
      return new Date(p.expiresAt) < new Date();
    });

    const minExpiryDays = businessPassports.reduce<number | null>((min, p) => {
      if (!p.expiresAt) return min;
      const days = Math.ceil((new Date(p.expiresAt).getTime() - Date.now()) / 86_400_000);
      return min === null ? days : Math.min(min, days);
    }, null);

    const hasDisputes = auditEvents.some(
      e => e.businessId === businessId && e.action.includes('dispute'),
    );
    const disputeCount = auditEvents.filter(
      e => e.businessId === businessId && e.action.includes('dispute'),
    ).length;

    const firstAudit = auditEvents.find(e => e.businessId === businessId);
    const platformTenureDays = firstAudit
      ? Math.ceil((Date.now() - new Date(firstAudit.createdAt).getTime()) / 86_400_000)
      : 0;

    // ── Compute revenue history from journal entries ──────────────────────────
    const bizJournals = journalStore.listJournals(ctx.tenantId, businessId);
    const accts = getOrCreateAccounts(businessId, ctx.tenantId);
    const revenueAcct = accts.find((a: any) => a.code === '4000');
    let revenueHistoryMonths = 0;
    let totalRevenueCents = 0;
    if (revenueAcct && bizJournals.length > 0) {
      const monthSet = new Set<string>();
      for (const j of bizJournals) {
        const d = j.occurredAt ? new Date(j.occurredAt) : null;
        if (d && !isNaN(d.getTime())) {
          monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        // Sum recognized revenue entries for account 4000
        const entries = journalStore.getEntries(j.id);
        for (const e of entries) {
          if (e.accountId === revenueAcct.id && e.direction === 'credit') {
            totalRevenueCents += e.amountCents;
          }
        }
      }
      revenueHistoryMonths = monthSet.size;
    }
    const monthlyRevenueAvg = revenueHistoryMonths > 0
      ? Math.round(totalRevenueCents / revenueHistoryMonths)
      : 0;

    // ── Marketplace listings for this business ─────────────────────────────────
    const marketplaceListings = listings.all(ctx.tenantId).filter(
      (l: any) => l.sellerBusinessId === businessId,
    ).length;

    // ── Marketplace sales (deals for this business) ────────────────────────────
    let marketplaceSales = 0;
    for (const dlist of deals.values()) {
      const bizDeals = dlist.filter((d: any) =>
        d.tenantId === ctx.tenantId &&
        (d.sellerBusinessId === businessId || d.buyerBusinessId === businessId),
      );
      marketplaceSales += bizDeals.length;
    }

    // ── Agent automation level (avg autonomyLevel of active agents) ────────────
    const bizAgents = agents.all(ctx.tenantId).filter(
      (a: any) => a.businessId === businessId && a.status === 'active',
    );
    let agentAutomationLevel = 0;
    if (bizAgents.length > 0) {
      const totalAutonomy = bizAgents.reduce((sum: number, a: any) => sum + (a.autonomyLevel ?? 0), 0);
      // Convert from 0-5 scale to 0-100 for the scorer
      agentAutomationLevel = Math.round((totalAutonomy / bizAgents.length) * 20);
    }

    // ── Booking completion rate ────────────────────────────────────────────────
    const bizBookings = bookings.all(ctx.tenantId).filter(
      (b: any) => b.businessId === businessId,
    );
    let bookingCompletionRate = 0;
    if (bizBookings.length > 0) {
      const completed = bizBookings.filter(
        (b: any) => b.status === 'completed',
      ).length;
      bookingCompletionRate = Math.round((completed / bizBookings.length) * 100) / 100;
    }

    const profile: BusinessProfile = {
      id: businessId,
      chainOfTitleUnbroken: chainChecks.every(Boolean) && chainChecks.length > 0,
      verifiedAnchorCount: verifiedAnchors,
      verifiedAnchorRequired: businessPassports.length,
      hasDisputes,
      disputeCount,
      passportExpired: isExpired,
      passportExpiresInDays: minExpiryDays,
      revenueHistoryMonths,
      monthlyRevenueAvg,
      marketplaceListings,
      marketplaceSales,
      agentAutomationLevel,
      bookingCompletionRate,
      platformTenureDays,
    };

    const scorer = new TransferabilityScorer();
    const result = scorer.scoreBreakdown(profile);

    reply.send({ data: result });
  });
}
