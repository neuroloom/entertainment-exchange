// Marketplace routes — listings, deal rooms, evidence tiers
// Task 030-035: POST /marketplace/listings, GET /marketplace/listings, deals
// Sprint 3b: PATCH/DELETE listings, PATCH deals (status transitions), pagination
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { MemoryStore, AuditStore } from '../services/repo.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';

const CreateListingSchema = z.object({
  sellerBusinessId: z.string().uuid(),
  listingType: z.string().min(1),
  title: z.string().min(1),
  askingPriceCents: z.number().int().min(0).optional(),
  evidenceTier: z.enum(['self_reported', 'document_supported', 'platform_verified', 'acquisition_ready']).default('self_reported'),
  metadata: z.record(z.unknown()).optional(),
});

const CreateDealSchema = z.object({
  listingId: z.string().uuid(),
  buyerUserId: z.string().uuid().optional(),
});

const UpdateListingSchema = z.object({
  title: z.string().min(1).optional(),
  askingPriceCents: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateDealSchema = z.object({
  status: z.enum(['negotiating', 'agreed', 'escrow_funded', 'completed']),
});

// Valid deal status transitions: created → negotiating → agreed → escrow_funded → completed
const validDealTransitions: Record<string, string[]> = {
  created: ['negotiating'],
  negotiating: ['agreed'],
  agreed: ['escrow_funded'],
  escrow_funded: ['completed'],
};

const listings = new MemoryStore('listings');
const deals = new Map<string, any[]>();
const auditEvents = new AuditStore();

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function marketplaceRoutes(app: FastifyInstance) {
  app.post('/listings', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('listing:publish')) throw AppError.forbidden('Missing listing:publish permission');

    const body = CreateListingSchema.parse(req.body);
    const listingId = uuid();

    const listing = {
      id: listingId, tenantId: ctx.tenantId, sellerBusinessId: body.sellerBusinessId,
      listingType: body.listingType, title: body.title, status: 'draft',
      askingPriceCents: body.askingPriceCents ?? null,
      evidenceTier: body.evidenceTier, metadata: body.metadata ?? {},
      publishedAt: null, createdAt: new Date().toISOString(),
    };
    listings.set(listing);

    writeAudit(ctx, 'listing.create', 'listing', listingId, body.sellerBusinessId);
    reply.status(201).send({ data: listing });
  });

  app.get('/listings', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const all = listings.all(ctx.tenantId);
    const p = paginate(req.query);
    const sliced = all.slice(p.offset, p.offset + p.limit);
    reply.send(paginatedResponse(sliced, all.length, p));
  });

  app.get('/listings/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const l = listings.get((req.params as any).id);
    if (!l || l.tenantId !== ctx.tenantId) throw AppError.notFound('Listing');
    reply.send({ data: l });
  });

  // Sprint 3b: PATCH /marketplace/listings/:id — update title, askingPriceCents, metadata (draft only)
  app.patch('/listings/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('listing:publish')) throw AppError.forbidden('Missing listing:publish permission');

    const listing = listings.get((req.params as any).id);
    if (!listing || listing.tenantId !== ctx.tenantId) throw AppError.notFound('Listing');

    if (listing.status !== 'draft') {
      throw AppError.invalid('Only draft listings can be updated');
    }

    const body = UpdateListingSchema.parse(req.body);

    if (body.title !== undefined) listing.title = body.title;
    if (body.askingPriceCents !== undefined) listing.askingPriceCents = body.askingPriceCents;
    if (body.metadata !== undefined) listing.metadata = body.metadata;

    listings.set(listing);
    writeAudit(ctx, 'listing.update', 'listing', listing.id, listing.sellerBusinessId, { changed: Object.keys(body) });
    reply.send({ data: listing });
  });

  // Sprint 3b: DELETE /marketplace/listings/:id — delist (set status to 'delisted')
  app.delete('/listings/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('listing:publish')) throw AppError.forbidden('Missing listing:publish permission');

    const listing = listings.get((req.params as any).id);
    if (!listing || listing.tenantId !== ctx.tenantId) throw AppError.notFound('Listing');

    listing.status = 'delisted';
    listings.set(listing);
    writeAudit(ctx, 'listing.delist', 'listing', listing.id, listing.sellerBusinessId);
    reply.send({ data: listing });
  });

  app.patch('/listings/:id/publish', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('listing:publish')) throw AppError.forbidden('Missing listing:publish permission');

    const listing = listings.get((req.params as any).id);
    if (!listing || listing.tenantId !== ctx.tenantId) throw AppError.notFound('Listing');

    listing.status = 'published';
    listing.publishedAt = new Date().toISOString();
    listings.set(listing);

    writeAudit(ctx, 'listing.publish', 'listing', listing.id, listing.sellerBusinessId);
    reply.send({ data: listing });
  });

  app.post('/deals', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('deal:close')) throw AppError.forbidden('Missing deal:close permission');

    const body = CreateDealSchema.parse(req.body);
    const listing = listings.get(body.listingId);
    if (!listing || listing.tenantId !== ctx.tenantId) throw AppError.notFound('Listing');

    const dealId = uuid();
    const deal = {
      id: dealId, tenantId: ctx.tenantId, listingId: body.listingId,
      buyerUserId: body.buyerUserId ?? null, status: 'created',
      metadata: {}, createdAt: new Date().toISOString(),
    };
    if (!deals.has(body.listingId)) deals.set(body.listingId, []);
    deals.get(body.listingId)!.push(deal);

    writeAudit(ctx, 'deal.create', 'deal_room', dealId, listing.sellerBusinessId, { buyerUserId: body.buyerUserId });
    reply.status(201).send({ data: deal });
  });

  app.get('/deals', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const allDeals: any[] = [];
    for (const d of deals.values()) allDeals.push(...d);
    reply.send({ data: allDeals.filter(d => d.tenantId === ctx.tenantId) });
  });

  app.get('/deals/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const dealId = (req.params as any).id;
    for (const dlist of deals.values()) {
      const deal = dlist.find(d => d.id === dealId);
      if (deal && deal.tenantId === ctx.tenantId) return reply.send({ data: deal });
    }
    throw AppError.notFound('Deal');
  });
}
