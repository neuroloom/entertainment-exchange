// AgentMarketplace — integrated from neuroloom/velra Phase 3 Trust Marketplace
// Wraps listing, search, escrow, offer, lease, review, and dispute flows
// Wire into OutputMaximizer via TaskRouter (route marketplace queries here)

import type {
  MarketplaceListing,
  MarketplaceFilters,
  MarketplaceSearchResult,
  EscrowTransaction,
  EscrowState,
  AcquisitionOffer,
  LeaseAgreement,
  Review,
  DisputeResolution,
  TransactionReceipt,
  AgentPurchaseTransaction,
  AgentReplies,
} from './types.js';

import {
  generateAgentReplies,
} from './agent-exchange.js';

// ─── In-memory store (replace with Prisma / DB adapter in production) ────────

interface MarketStore {
  listings: Map<number, MarketplaceListing>;
  escrow: Map<number, EscrowTransaction>;
  offers: Map<number, AcquisitionOffer>;
  leases: Map<number, LeaseAgreement>;
  reviews: Map<number, Review[]>;
  disputes: Map<number, DisputeResolution>;
  purchases: Map<string, AgentPurchaseTransaction>;
  nextId: number;
}

function createEmptyStore(): MarketStore {
  return {
    listings: new Map(),
    escrow: new Map(),
    offers: new Map(),
    leases: new Map(),
    reviews: new Map(),
    disputes: new Map(),
    purchases: new Map(),
    nextId: 1,
  };
}

function nextId(store: MarketStore): number {
  return store.nextId++;
}

// ─── AgentMarketplace ────────────────────────────────────────────────────────

export class AgentMarketplace {
  private store: MarketStore;

  constructor(initialListings: MarketplaceListing[] = []) {
    this.store = createEmptyStore();
    for (const listing of initialListings) {
      this.store.listings.set(listing.id, listing);
      if (listing.id >= this.store.nextId) {
        this.store.nextId = listing.id + 1;
      }
    }
  }

  // ── Listing CRUD ───────────────────────────────────────────────────────

  list(filters: MarketplaceFilters = {}): MarketplaceSearchResult {
    let results = Array.from(this.store.listings.values());

    // Apply filters
    if (filters.query) {
      const q = filters.query.toLowerCase();
      results = results.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.description ?? '').toLowerCase().includes(q) ||
          l.category.toLowerCase().includes(q),
      );
    }
    if (filters.type) {
      results = results.filter((l) => l.type === filters.type);
    }
    if (filters.category) {
      results = results.filter((l) => l.category === filters.category);
    }
    if (filters.min_price_cents !== undefined) {
      results = results.filter((l) => l.price_cents >= filters.min_price_cents!);
    }
    if (filters.max_price_cents !== undefined) {
      results = results.filter((l) => l.price_cents <= filters.max_price_cents!);
    }
    if (filters.min_rating !== undefined) {
      results = results.filter((l) => l.rating >= filters.min_rating!);
    }
    if (filters.verification_level) {
      results = results.filter((l) => l.verification_level === filters.verification_level);
    }
    if (filters.escrow_protected === true) {
      results = results.filter((l) => l.escrow_protected);
    }

    // Sort
    const sort = filters.sort_by ?? 'newest';
    switch (sort) {
      case 'price_asc':
        results.sort((a, b) => a.price_cents - b.price_cents);
        break;
      case 'price_desc':
        results.sort((a, b) => b.price_cents - a.price_cents);
        break;
      case 'rating':
        results.sort((a, b) => b.rating - a.rating);
        break;
      case 'revenue':
        results.sort((a, b) => (b.monthly_revenue_cents ?? 0) - (a.monthly_revenue_cents ?? 0));
        break;
      case 'popular':
        results.sort((a, b) => b.hire_count - a.hire_count);
        break;
      default: // newest
        results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    const page = filters.page ?? 1;
    const pageSize = filters.page_size ?? 20;
    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = results.slice(start, start + pageSize);

    return { listings: paged, total, page, page_size: pageSize, total_pages: totalPages };
  }

  getListing(id: number): MarketplaceListing | undefined {
    return this.store.listings.get(id);
  }

  createListing(listing: Omit<MarketplaceListing, 'id' | 'created_at' | 'updated_at'>): MarketplaceListing {
    const id = nextId(this.store);
    const now = new Date().toISOString();
    const full: MarketplaceListing = { ...listing, id, created_at: now, updated_at: now };
    this.store.listings.set(id, full);
    return full;
  }

  updateListing(id: number, patch: Partial<MarketplaceListing>): MarketplaceListing | undefined {
    const existing = this.store.listings.get(id);
    if (!existing) return undefined;
    const updated: MarketplaceListing = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
    this.store.listings.set(id, updated);
    return updated;
  }

  deleteListing(id: number): boolean {
    return this.store.listings.delete(id);
  }

  // ── Escrow ──────────────────────────────────────────────────────────────

  createEscrow(listingId: number, buyerId: number, amountCents: number): EscrowTransaction {
    const id = nextId(this.store);
    const now = new Date().toISOString();
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const escrow: EscrowTransaction = {
      id,
      listing_id: listingId,
      buyer_id: buyerId,
      seller_id: 0, // resolved from listing
      amount_cents: amountCents,
      state: 'initiated',
      created_at: now,
      due_diligence_end: dueDate,
    };
    this.store.escrow.set(id, escrow);
    return escrow;
  }

  fundEscrow(escrowId: number): EscrowTransaction | undefined {
    return this.transitionEscrow(escrowId, 'funded');
  }

  approveEscrow(escrowId: number): EscrowTransaction | undefined {
    return this.transitionEscrow(escrowId, 'approved');
  }

  completeEscrow(escrowId: number): EscrowTransaction | undefined {
    return this.transitionEscrow(escrowId, 'completed');
  }

  disputeEscrow(escrowId: number, reason: string, evidence?: string[]): EscrowTransaction | undefined {
    const escrow = this.store.escrow.get(escrowId);
    if (!escrow) return undefined;
    escrow.state = 'disputed';
    escrow.dispute_reason = reason;
    escrow.dispute_evidence = evidence;
    return escrow;
  }

  refundEscrow(escrowId: number): EscrowTransaction | undefined {
    return this.transitionEscrow(escrowId, 'refunded');
  }

  getEscrow(id: number): EscrowTransaction | undefined {
    return this.store.escrow.get(id);
  }

  private transitionEscrow(escrowId: number, to: EscrowState): EscrowTransaction | undefined {
    const escrow = this.store.escrow.get(escrowId);
    if (!escrow) return undefined;
    escrow.state = to;
    const now = new Date().toISOString();
    switch (to) {
      case 'funded':
        escrow.funded_at = now;
        break;
      case 'approved':
        escrow.approved_at = now;
        break;
      case 'completed':
        escrow.completed_at = now;
        break;
      case 'refunded':
        escrow.refunded_at = now;
        break;
    }
    return escrow;
  }

  // ── Offers ──────────────────────────────────────────────────────────────

  createOffer(
    listingId: number,
    buyerId: number,
    sellerId: number,
    amountCents: number,
    message?: string,
  ): AcquisitionOffer {
    const id = nextId(this.store);
    const now = new Date().toISOString();
    const offer: AcquisitionOffer = {
      id,
      listing_id: listingId,
      buyer_id: buyerId,
      seller_id: sellerId,
      amount_cents: amountCents,
      status: 'pending',
      message,
      created_at: now,
      history: [
        {
          timestamp: now,
          from: 'buyer',
          amount_cents: amountCents,
          message,
          action: 'initial',
        },
      ],
    };
    this.store.offers.set(id, offer);
    return offer;
  }

  counterOffer(offerId: number, counterAmountCents: number, message?: string): AcquisitionOffer | undefined {
    const offer = this.store.offers.get(offerId);
    if (!offer) return undefined;
    offer.status = 'countered';
    offer.counter_amount_cents = counterAmountCents;
    offer.responded_at = new Date().toISOString();
    offer.history = offer.history ?? [];
    offer.history.push({
      timestamp: new Date().toISOString(),
      from: 'seller',
      amount_cents: counterAmountCents,
      message,
      action: 'counter',
    });
    return offer;
  }

  acceptOffer(offerId: number): AcquisitionOffer | undefined {
    const offer = this.store.offers.get(offerId);
    if (!offer) return undefined;
    offer.status = 'accepted';
    offer.responded_at = new Date().toISOString();
    offer.history = offer.history ?? [];
    offer.history.push({
      timestamp: new Date().toISOString(),
      from: 'seller',
      amount_cents: offer.counter_amount_cents ?? offer.amount_cents,
      action: 'accept',
    });
    return offer;
  }

  rejectOffer(offerId: number): AcquisitionOffer | undefined {
    const offer = this.store.offers.get(offerId);
    if (!offer) return undefined;
    offer.status = 'rejected';
    offer.responded_at = new Date().toISOString();
    offer.history = offer.history ?? [];
    offer.history.push({
      timestamp: new Date().toISOString(),
      from: 'seller',
      amount_cents: offer.amount_cents,
      action: 'reject',
    });
    return offer;
  }

  getOffer(id: number): AcquisitionOffer | undefined {
    return this.store.offers.get(id);
  }

  // ── Lease ───────────────────────────────────────────────────────────────

  createLease(
    listingId: number,
    lessorId: number,
    lesseeId: number,
    monthlyRateCents: number,
    durationMonths: number,
    terms: string,
    revenueSharePercent?: number,
    autoRenew = false,
  ): LeaseAgreement {
    const id = nextId(this.store);
    const now = new Date().toISOString();
    const endDate = new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
    const lease: LeaseAgreement = {
      id,
      listing_id: listingId,
      lessor_id: lessorId,
      lessee_id: lesseeId,
      monthly_rate_cents: monthlyRateCents,
      duration_months: durationMonths,
      auto_renew: autoRenew,
      revenue_share_percent: revenueSharePercent,
      terms,
      status: 'active',
      start_date: now,
      end_date: endDate,
    };
    this.store.leases.set(id, lease);
    return lease;
  }

  getLease(id: number): LeaseAgreement | undefined {
    return this.store.leases.get(id);
  }

  cancelLease(id: number): LeaseAgreement | undefined {
    const lease = this.store.leases.get(id);
    if (!lease) return undefined;
    lease.status = 'cancelled';
    lease.end_date = new Date().toISOString();
    return lease;
  }

  // ── Reviews ─────────────────────────────────────────────────────────────

  addReview(listingId: number, transactionId: number, reviewerId: number, rating: number, comment: string): Review {
    const id = nextId(this.store);
    const review: Review = {
      id,
      transaction_id: transactionId,
      listing_id: listingId,
      reviewer_id: reviewerId,
      rating: Math.max(1, Math.min(5, rating)),
      comment,
      created_at: new Date().toISOString(),
      helpful_count: 0,
    };
    const existing = this.store.reviews.get(listingId) ?? [];
    existing.push(review);
    this.store.reviews.set(listingId, existing);

    // Update listing aggregate rating
    const listing = this.store.listings.get(listingId);
    if (listing) {
      const allReviews = this.store.reviews.get(listingId) ?? [];
      const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
      listing.rating = Math.round(avg * 10) / 10;
      listing.review_count = allReviews.length;
    }
    return review;
  }

  getReviews(listingId: number): Review[] {
    return this.store.reviews.get(listingId) ?? [];
  }

  // ── Disputes ────────────────────────────────────────────────────────────

  createDispute(escrowTransactionId: number, reason: string, evidenceUrls: string[] = []): DisputeResolution {
    const id = nextId(this.store);
    const now = new Date().toISOString();
    const dispute: DisputeResolution = {
      id,
      escrow_transaction_id: escrowTransactionId,
      reason,
      evidence_urls: evidenceUrls,
      status: 'open',
      timeline: [{ timestamp: now, event: 'Dispute opened', description: reason, by: 'buyer' }],
      created_at: now,
    };
    this.store.disputes.set(id, dispute);
    return dispute;
  }

  getDispute(id: number): DisputeResolution | undefined {
    return this.store.disputes.get(id);
  }

  resolveDispute(id: number, resolution: 'resolved_buyer' | 'resolved_seller', notes?: string): DisputeResolution | undefined {
    const dispute = this.store.disputes.get(id);
    if (!dispute) return undefined;
    dispute.status = resolution;
    dispute.resolved_at = new Date().toISOString();
    dispute.resolution_notes = notes;
    dispute.timeline.push({
      timestamp: new Date().toISOString(),
      event: `Resolved in favor of ${resolution === 'resolved_buyer' ? 'buyer' : 'seller'}`,
      description: notes ?? 'Resolution finalized',
      by: 'platform',
    });
    return dispute;
  }

  // ── Purchase Transaction ────────────────────────────────────────────────

  createPurchase(listingId: number, buyerId: number, sellerId: number, amountCents: number): AgentPurchaseTransaction {
    const id = `purchase-${nextId(this.store)}`;
    const purchase: AgentPurchaseTransaction = {
      id,
      listing_id: listingId,
      buyer_id: buyerId,
      seller_id: sellerId,
      amount_cents: amountCents,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    this.store.purchases.set(id, purchase);
    return purchase;
  }

  completePurchase(purchaseId: string): AgentPurchaseTransaction | undefined {
    const purchase = this.store.purchases.get(purchaseId);
    if (!purchase) return undefined;
    purchase.status = 'completed';
    purchase.completed_at = new Date().toISOString();
    return purchase;
  }

  getPurchase(id: string): AgentPurchaseTransaction | undefined {
    return this.store.purchases.get(id);
  }

  // ── Receipt Generation ──────────────────────────────────────────────────

  generateReceipt(purchaseId: string): TransactionReceipt | undefined {
    const purchase = this.store.purchases.get(purchaseId);
    if (!purchase) return undefined;
    const listing = this.store.listings.get(purchase.listing_id);
    return {
      id: nextId(this.store),
      type: 'purchase',
      listing_name: listing?.name ?? `Listing #${purchase.listing_id}`,
      amount_cents: purchase.amount_cents,
      date: purchase.completed_at ?? purchase.created_at,
      transaction_id: purchase.id,
    };
  }

  // ── Agent Replies (from agent-exchange integration) ─────────────────────

  generateReplies(userContent: string): AgentReplies {
    return generateAgentReplies(userContent);
  }

  // ── Store Access (for testing / hydration) ──────────────────────────────

  get allListings(): MarketplaceListing[] {
    return Array.from(this.store.listings.values());
  }

  get listingCount(): number {
    return this.store.listings.size;
  }

  get activeEscrows(): EscrowTransaction[] {
    return Array.from(this.store.escrow.values()).filter(
      (e) => !['completed', 'refunded'].includes(e.state),
    );
  }
}
