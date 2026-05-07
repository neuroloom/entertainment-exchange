// Rights routes — legal anchors, rights assets, passports
// Tasks 036-040: POST /rights/assets, POST /rights/anchors, POST /rights/passports
// L3 MARKETPLACE+RIGHTS: Wired with PassportVerifier, chain-of-title, transferability scoring
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
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

const anchors = new Map<string, LegalAnchor>();
const assets = new Map<string, RightsAsset>();
const passports = new Map<string, RightsPassport>();
const auditEvents: any[] = [];

// Create a shared PassportVerifier backed by the route-level stores
const passVerifier = new PassportVerifier({ anchors, assets, passports });

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function rightsRoutes(app: FastifyInstance) {
  // ═══ Legal Anchors ══════════════════════════════════════════════════════════

  app.post('/anchors', async (req, reply) => {
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
    anchors.set(anchorId, anchor);
    writeAudit(ctx, 'anchor.create', 'legal_anchor', anchorId, undefined, { documentType: body.documentType });
    reply.status(201).send({ data: anchor });
  });

  app.get('/anchors', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    reply.send({ data: [...anchors.values()].filter(a => a.tenantId === ctx.tenantId) });
  });

  app.get('/anchors/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const a = anchors.get((req.params as any).id);
    if (!a || a.tenantId !== ctx.tenantId) throw AppError.notFound('LegalAnchor');
    reply.send({ data: a });
  });

  // ═══ Rights Assets ═══════════════════════════════════════════════════════════

  app.post('/assets', async (req, reply) => {
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
    assets.set(assetId, asset);
    writeAudit(ctx, 'asset.create', 'rights_asset', assetId, body.businessId);
    reply.status(201).send({ data: asset });
  });

  app.get('/assets', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    reply.send({ data: [...assets.values()].filter(a => a.tenantId === ctx.tenantId) });
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

  app.post('/passports', async (req, reply) => {
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
    reply.send({ data: [...passports.values()].filter(p => p.tenantId === ctx.tenantId) });
  });

  app.get('/passports/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const p = passports.get((req.params as any).id);
    if (!p || p.tenantId !== ctx.tenantId) throw AppError.notFound('Passport');
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

  // ═══ Business Transferability Scoring ════════════════════════════════════════

  app.get('/businesses/:id/transferability', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const businessId = (req.params as any).id;

    // Collect business profile from across the rights store
    const businessAssets = [...assets.values()].filter(a => a.businessId === businessId && a.tenantId === ctx.tenantId);
    const businessPassports = [...passports.values()].filter(p => {
      const a = assets.get(p.rightsAssetId);
      return a?.businessId === businessId && p.tenantId === ctx.tenantId;
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

    const profile: BusinessProfile = {
      id: businessId,
      chainOfTitleUnbroken: chainChecks.every(Boolean) && chainChecks.length > 0,
      verifiedAnchorCount: verifiedAnchors,
      verifiedAnchorRequired: businessPassports.length,
      hasDisputes,
      disputeCount,
      passportExpired: isExpired,
      passportExpiresInDays: minExpiryDays,
      revenueHistoryMonths: 0,         // stub — wired from billing service
      monthlyRevenueAvg: 0,            // stub
      marketplaceListings: 0,          // stub — wired from marketplace service
      marketplaceSales: 0,             // stub
      agentAutomationLevel: 0,         // stub — wired from agent metrics
      bookingCompletionRate: 0,        // stub — wired from booking service
      platformTenureDays,
    };

    const scorer = new TransferabilityScorer();
    const result = scorer.score(profile);

    reply.send({ data: result });
  });
}
