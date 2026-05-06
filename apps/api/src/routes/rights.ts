// Rights routes — legal anchors, rights assets, passports
// Task 036-040: POST /rights/assets, POST /rights/anchors, POST /rights/passports
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';

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
});

const anchors = new Map<string, any>();
const assets = new Map<string, any>();
const passports = new Map<string, any>();
const auditEvents: any[] = [];

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function rightsRoutes(app: FastifyInstance) {
  // Legal Anchors
  app.post('/anchors', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const body = CreateAnchorSchema.parse(req.body);
    const anchorId = uuid();
    const anchor = {
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

  // Rights Assets
  app.post('/assets', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const body = CreateAssetSchema.parse(req.body);
    const assetId = uuid();
    const asset = {
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

  // Passports
  app.post('/passports', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('rights:issue')) throw AppError.forbidden('Missing rights:issue permission');

    const body = IssuePassportSchema.parse(req.body);
    const asset = assets.get(body.rightsAssetId);
    if (!asset || asset.tenantId !== ctx.tenantId) throw AppError.notFound('RightsAsset');
    const anchor = anchors.get(body.legalAnchorId);
    if (!anchor || anchor.tenantId !== ctx.tenantId) throw AppError.notFound('LegalAnchor');

    const passportId = uuid();
    const passport = {
      id: passportId, tenantId: ctx.tenantId,
      rightsAssetId: body.rightsAssetId, legalAnchorId: body.legalAnchorId,
      passportType: body.passportType, status: 'draft',
      metadata: body.metadata ?? {}, issuedAt: null,
    };
    passports.set(passportId, passport);
    writeAudit(ctx, 'passport.issue', 'rights_passport', passportId, asset.businessId);
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
}
