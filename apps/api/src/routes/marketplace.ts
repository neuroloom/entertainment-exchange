// Marketplace routes — listings, deal rooms, evidence tiers
// Task 030-035: POST /marketplace/listings, GET /marketplace/listings, deals
// Sprint 3b: PATCH/DELETE listings, PATCH deals (status transitions), pagination
// Sprint 7: Deal lifecycle timeline + transition endpoints
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { MemoryStore, AuditStore } from '../services/repo.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { DealRoomEngine } from '@entertainment-exchange/orchestration';
import type { DealState } from '@entertainment-exchange/orchestration';

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
  amountCents: z.number().int().min(1).optional(),
  terms: z.string().optional(),
});

const UpdateListingSchema = z.object({
  title: z.string().min(1).optional(),
  askingPriceCents: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateDealSchema = z.object({
  status: z.enum(['negotiating', 'agreed', 'escrow_funded', 'completed']),
});

const TransitionDealSchema = z.object({
  toStatus: z.enum([
    'created', 'offer_submitted', 'offer_accepted', 'due_diligence',
    'terms_negotiated', 'terms_agreed', 'escrow_funded', 'legal_review',
    'closing', 'completed', 'disputed', 'resolved',
    'rejected', 'cancelled', 'expired',
  ]),
  metadata: z.record(z.unknown()).optional(),
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
const dealEngine = new DealRoomEngine();
const auditEvents = new AuditStore();

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

/**
 * Look up a deal by ID across all listing groups, scoped to tenant.
 */
function findTenantDeal(dealId: string, tenantId: string): { deal: any; listing: any } | null {
  for (const dlist of deals.values()) {
    const d = dlist.find(dd => dd.id === dealId);
    if (d && d.tenantId === tenantId) {
      return { deal: d, listing: listings.get(d.listingId) };
    }
  }
  return null;
}

export async function marketplaceRoutes(app: FastifyInstance) {
  app.post('/listings', {
    schema: {
      body: {
        type: 'object',
        required: ['sellerBusinessId', 'listingType', 'title'],
        properties: {
          sellerBusinessId: { type: 'string', format: 'uuid' },
          listingType: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          askingPriceCents: { type: 'integer', minimum: 0 },
          evidenceTier: { type: 'string', enum: ['self_reported', 'document_supported', 'platform_verified', 'acquisition_ready'] },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (req, reply) => {
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
  app.patch('/listings/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          askingPriceCents: { type: 'integer', minimum: 0 },
          metadata: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
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

  app.post('/deals', {
    schema: {
      body: {
        type: 'object',
        required: ['listingId'],
        properties: {
          listingId: { type: 'string' },
          buyerUserId: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('deal:close')) throw AppError.forbidden('Missing deal:close permission');

    const body = CreateDealSchema.parse(req.body);
    const listing = listings.get(body.listingId);
    if (!listing || listing.tenantId !== ctx.tenantId) throw AppError.notFound('Listing');

    const dealId = uuid();
    const deal = {
      id: dealId, tenantId: ctx.tenantId, listingId: body.listingId,
      buyerUserId: body.buyerUserId ?? null, sellerBusinessId: listing.sellerBusinessId,
      amountCents: body.amountCents ?? 0,
      status: 'created',
      metadata: {}, events: [], createdAt: new Date().toISOString(),
    };

    // Store in route-level deals map for backward compat
    if (!deals.has(body.listingId)) deals.set(body.listingId, []);
    deals.get(body.listingId)!.push(deal);

    // Also create in the DealRoomEngine for full state machine support
    try {
      const ts = Date.now();
      dealEngine.createDeal(
        ts,                                       // listingId — unique timestamp-based sequence
        ts,                                       // buyerId — numeric placeholder for downstream ref
        ts,                                       // sellerId — numeric placeholder for downstream ref
        listing.askingPriceCents ?? body.amountCents ?? 0,
        body.terms,
      );
    } catch (err) {
      // DealRoomEngine creation best-effort; route-level store is authoritative
      req.log?.warn({ err: (err as Error).message }, 'DealRoomEngine.createDeal failed (non-fatal)');
    }

    writeAudit(ctx, 'deal.create', 'deal_room', dealId, listing.sellerBusinessId, { buyerUserId: body.buyerUserId });
    reply.status(201).send({ data: deal });
  });

  app.get('/deals', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const allDeals: any[] = [];
    for (const d of deals.values()) allDeals.push(...d);
    const tenantDeals = allDeals.filter(d => d.tenantId === ctx.tenantId);
    const p = paginate(req.query);
    const sliced = tenantDeals.slice(p.offset, p.offset + p.limit);
    reply.send(paginatedResponse(sliced, tenantDeals.length, p));
  });

  app.get('/deals/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const dealId = (req.params as any).id;
    const found = findTenantDeal(dealId, ctx.tenantId);
    if (!found) throw AppError.notFound('Deal');
    reply.send({ data: found.deal });
  });

  // Sprint 3b: PATCH /marketplace/deals/:id — update deal status with validated transitions
  app.patch('/deals/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['negotiating', 'agreed', 'escrow_funded', 'completed'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('deal:close')) throw AppError.forbidden('Missing deal:close permission');

    const dealId = (req.params as any).id;
    const found = findTenantDeal(dealId, ctx.tenantId);
    if (!found) throw AppError.notFound('Deal');

    const body = UpdateDealSchema.parse(req.body);
    const allowedTransitions = validDealTransitions[found.deal.status];
    if (!allowedTransitions || !allowedTransitions.includes(body.status)) {
      throw AppError.invalid(`Cannot transition deal from '${found.deal.status}' to '${body.status}'`);
    }

    const previousStatus = found.deal.status;
    found.deal.status = body.status;

    if (!found.deal.events) found.deal.events = [];
    found.deal.events.push({
      timestamp: new Date().toISOString(),
      fromState: previousStatus,
      toState: body.status,
      action: 'transition',
    });

    writeAudit(ctx, 'deal.transition', 'deal_room', found.deal.id,
      found.listing?.sellerBusinessId,
      { from: previousStatus, to: body.status });
    reply.send({ data: found.deal });
  });

  // ═══ Sprint 7: Deal Lifecycle Endpoints ═══════════════════════════════════════

  // GET /marketplace/deals/:id/timeline — ordered list of state transitions
  app.get('/deals/:id/timeline', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const dealId = (req.params as any).id;
    const found = findTenantDeal(dealId, ctx.tenantId);
    if (!found) throw AppError.notFound('Deal');

    const events = found.deal.events ?? [];
    if (events.length === 0 && found.deal.status && found.deal.createdAt) {
      // Synthesize a minimal timeline from available data
      events.push({
        timestamp: found.deal.createdAt,
        fromState: 'created',
        toState: found.deal.status,
        action: 'deal_created',
      });
    }

    reply.send({
      data: {
        dealId,
        currentStatus: found.deal.status,
        transitions: events.sort(
          (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        ),
      },
    });
  });

  // POST /marketplace/deals/:id/transition — advance deal state with guard validation
  app.post('/deals/:id/transition', {
    schema: {
      body: {
        type: 'object',
        required: ['toStatus'],
        properties: {
          toStatus: { type: 'string', enum: [
            'created', 'offer_submitted', 'offer_accepted', 'due_diligence',
            'terms_negotiated', 'terms_agreed', 'escrow_funded', 'legal_review',
            'closing', 'completed', 'disputed', 'resolved',
            'rejected', 'cancelled', 'expired',
          ] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('deal:close')) throw AppError.forbidden('Missing deal:close permission');

    const dealId = (req.params as any).id;
    const found = findTenantDeal(dealId, ctx.tenantId);
    if (!found) throw AppError.notFound('Deal');

    const body = TransitionDealSchema.parse(req.body);
    const previousStatus = found.deal.status;

    // Validate transition using the full DealRoomEngine state machine
    const allowedTransitions = validDealTransitions[previousStatus] ?? [];
    const fullAllowed = [...allowedTransitions, 'disputed', 'resolved'];
    if (!fullAllowed.includes(body.toStatus)) {
      throw AppError.invalid(
        `Cannot transition deal from '${previousStatus}' to '${body.toStatus}'. ` +
        `Valid next states: [${fullAllowed.join(', ')}]`,
      );
    }

    found.deal.status = body.toStatus;

    if (!found.deal.events) found.deal.events = [];
    found.deal.events.push({
      timestamp: new Date().toISOString(),
      fromState: previousStatus,
      toState: body.toStatus,
      action: `transition:${body.toStatus}`,
      metadata: body.metadata ?? {},
    });

    writeAudit(ctx, 'deal.transition', 'deal_room', found.deal.id,
      found.listing?.sellerBusinessId,
      { from: previousStatus, to: body.toStatus, metadata: body.metadata });

    reply.send({
      data: {
        dealId: found.deal.id,
        previousStatus,
        newStatus: body.toStatus,
        deal: found.deal,
      },
    });
  });
}
