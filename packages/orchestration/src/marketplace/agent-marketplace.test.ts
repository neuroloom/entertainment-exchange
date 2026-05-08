// Marketplace integration smoke test
import { describe, it, expect } from 'vitest';
import { AgentMarketplace, generateAgentReplies } from './index.js';
import type { MarketplaceListing } from './types.js';

describe('AgentMarketplace', () => {
  const seedListing: MarketplaceListing = {
    id: 1,
    type: 'agent',
    name: 'Alpha Support Bot',
    description: 'Customer support agent with 99% satisfaction',
    category: 'customer-support',
    price_cents: 250000, // $2,500
    monthly_revenue_cents: 820000, // $8,200/mo
    reputation_score: 92,
    verification_level: 'identity_verified',
    is_pro: false,
    hire_count: 15,
    rating: 4.7,
    review_count: 42,
    escrow_protected: true,
    seller_id: 100,
    seller_name: 'NeuralDynamics',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  };

  const market = new AgentMarketplace([seedListing]);

  it('lists agents', () => {
    const result = market.list();
    expect(result.total).toBe(1);
    expect(result.listings[0].name).toBe('Alpha Support Bot');
  });

  it('creates a listing', () => {
    const created = market.createListing({
      type: 'company',
      name: 'LeadForge Co',
      description: 'AI-powered lead gen business',
      category: 'lead-gen',
      price_cents: 1000000,
      reputation_score: 88,
      verification_level: 'pro_seller',
      is_pro: true,
      hire_count: 0,
      rating: 0,
      review_count: 0,
      escrow_protected: true,
      seller_id: 200,
      seller_name: 'ProSeller',
    });
    expect(created.name).toBe('LeadForge Co');
    expect(created.id).toBeGreaterThan(0);
    expect(created.created_at).toBeTruthy();
  });

  it('filters by type', () => {
    const result = market.list({ type: 'agent' });
    expect(result.listings.every((l) => l.type === 'agent')).toBe(true);
  });

  it('filters by verification level', () => {
    const result = market.list({ verification_level: 'identity_verified' });
    expect(result.total).toBe(1);
  });

  it('filters by price range', () => {
    const result = market.list({ min_price_cents: 100000, max_price_cents: 500000 });
    expect(result.total).toBe(1);
  });

  it('filters by query', () => {
    const result = market.list({ query: 'support' });
    expect(result.total).toBe(1);
    const noResult = market.list({ query: 'nonexistent' });
    expect(noResult.total).toBe(0);
  });

  it('sorts by price ascending', () => {
    const result = market.list({ sort_by: 'price_asc' });
    const prices = result.listings.map((l) => l.price_cents);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    }
  });

  it('creates and transitions escrow', () => {
    const escrow = market.createEscrow(1, 10, 250000);
    expect(escrow.state).toBe('initiated');
    expect(escrow.due_diligence_end).toBeTruthy();

    const funded = market.fundEscrow(escrow.id);
    expect(funded?.state).toBe('funded');

    const approved = market.approveEscrow(escrow.id);
    expect(approved?.state).toBe('approved');

    const completed = market.completeEscrow(escrow.id);
    expect(completed?.state).toBe('completed');
    expect(completed?.completed_at).toBeTruthy();
  });

  it('handles escrow dispute and refund', () => {
    const escrow = market.createEscrow(1, 20, 250000);
    market.fundEscrow(escrow.id);
    const disputed = market.disputeEscrow(escrow.id, 'Listing misrepresented', ['evidence1.png']);
    expect(disputed?.state).toBe('disputed');
    expect(disputed?.dispute_reason).toBe('Listing misrepresented');

    const refunded = market.refundEscrow(escrow.id);
    expect(refunded?.state).toBe('refunded');
  });

  it('creates and negotiates offers', () => {
    const offer = market.createOffer(1, 10, 100, 200000, 'Interested in this agent');
    expect(offer.status).toBe('pending');
    expect(offer.amount_cents).toBe(200000);
    expect(offer.history?.length).toBe(1);

    const countered = market.counterOffer(offer.id, 230000, 'Counter at higher price');
    expect(countered?.status).toBe('countered');
    expect(countered?.counter_amount_cents).toBe(230000);
    expect(countered?.history?.length).toBe(2);

    const accepted = market.acceptOffer(offer.id);
    expect(accepted?.status).toBe('accepted');
  });

  it('creates and cancels leases', () => {
    const lease = market.createLease(1, 100, 200, 50000, 6, 'Standard lease terms', 10);
    expect(lease.status).toBe('active');
    expect(lease.monthly_rate_cents).toBe(50000);
    expect(lease.duration_months).toBe(6);
    expect(lease.revenue_share_percent).toBe(10);

    const cancelled = market.cancelLease(lease.id);
    expect(cancelled?.status).toBe('cancelled');
  });

  it('adds reviews and updates listing rating', () => {
    market.addReview(1, 1, 10, 5, 'Excellent agent!');
    market.addReview(1, 2, 20, 4, 'Good but could improve speed');
    const reviews = market.getReviews(1);
    expect(reviews.length).toBe(2);

    const listing = market.getListing(1);
    expect(listing).toBeTruthy();
    expect(listing!.rating).toBe(4.5);
    expect(listing!.review_count).toBe(2);
  });

  it('creates and resolves disputes', () => {
    const dispute = market.createDispute(1, 'Evidence mismatch', ['screenshot.png']);
    expect(dispute.status).toBe('open');
    expect(dispute.timeline.length).toBe(1);

    const resolved = market.resolveDispute(dispute.id, 'resolved_buyer', 'Evidence confirmed');
    expect(resolved?.status).toBe('resolved_buyer');
    expect(resolved?.timeline.length).toBe(2);
    expect(resolved?.resolved_at).toBeTruthy();
  });

  it('creates and completes purchases', () => {
    const purchase = market.createPurchase(1, 10, 100, 250000);
    expect(purchase.status).toBe('pending');

    const completed = market.completePurchase(purchase.id);
    expect(completed?.status).toBe('completed');

    const receipt = market.generateReceipt(purchase.id);
    expect(receipt).toBeTruthy();
    expect(receipt?.amount_cents).toBe(250000);
  });
});

describe('generateAgentReplies', () => {
  it('returns alpha and beta replies', () => {
    const replies = generateAgentReplies('We found a bug in production');
    expect(replies.alpha.length).toBeGreaterThan(0);
    expect(replies.beta.length).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const replies = generateAgentReplies('');
    expect(replies.alpha.includes('AGENT_ALPHA')).toBe(true);
    expect(replies.beta.includes('AGENT_BETA')).toBe(true);
  });
});
