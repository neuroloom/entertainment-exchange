// Marketplace integration smoke test
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
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
    assert.equal(result.total, 1);
    assert.equal(result.listings[0].name, 'Alpha Support Bot');
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
    assert.equal(created.name, 'LeadForge Co');
    assert.ok(created.id > 0);
    assert.ok(created.created_at);
  });

  it('filters by type', () => {
    const result = market.list({ type: 'agent' });
    assert.ok(result.listings.every((l) => l.type === 'agent'));
  });

  it('filters by verification level', () => {
    const result = market.list({ verification_level: 'identity_verified' });
    assert.equal(result.total, 1);
  });

  it('filters by price range', () => {
    const result = market.list({ min_price_cents: 100000, max_price_cents: 500000 });
    assert.equal(result.total, 1);
  });

  it('filters by query', () => {
    const result = market.list({ query: 'support' });
    assert.equal(result.total, 1);
    const noResult = market.list({ query: 'nonexistent' });
    assert.equal(noResult.total, 0);
  });

  it('sorts by price ascending', () => {
    const result = market.list({ sort_by: 'price_asc' });
    const prices = result.listings.map((l) => l.price_cents);
    for (let i = 1; i < prices.length; i++) {
      assert.ok(prices[i] >= prices[i - 1]);
    }
  });

  it('creates and transitions escrow', () => {
    const escrow = market.createEscrow(1, 10, 250000);
    assert.equal(escrow.state, 'initiated');
    assert.ok(escrow.due_diligence_end);

    const funded = market.fundEscrow(escrow.id);
    assert.equal(funded?.state, 'funded');

    const approved = market.approveEscrow(escrow.id);
    assert.equal(approved?.state, 'approved');

    const completed = market.completeEscrow(escrow.id);
    assert.equal(completed?.state, 'completed');
    assert.ok(completed?.completed_at);
  });

  it('handles escrow dispute and refund', () => {
    const escrow = market.createEscrow(1, 20, 250000);
    market.fundEscrow(escrow.id);
    const disputed = market.disputeEscrow(escrow.id, 'Listing misrepresented', ['evidence1.png']);
    assert.equal(disputed?.state, 'disputed');
    assert.equal(disputed?.dispute_reason, 'Listing misrepresented');

    const refunded = market.refundEscrow(escrow.id);
    assert.equal(refunded?.state, 'refunded');
  });

  it('creates and negotiates offers', () => {
    const offer = market.createOffer(1, 10, 100, 200000, 'Interested in this agent');
    assert.equal(offer.status, 'pending');
    assert.equal(offer.amount_cents, 200000);
    assert.equal(offer.history?.length, 1);

    const countered = market.counterOffer(offer.id, 230000, 'Counter at higher price');
    assert.equal(countered?.status, 'countered');
    assert.equal(countered?.counter_amount_cents, 230000);
    assert.equal(countered?.history?.length, 2);

    const accepted = market.acceptOffer(offer.id);
    assert.equal(accepted?.status, 'accepted');
  });

  it('creates and cancels leases', () => {
    const lease = market.createLease(1, 100, 200, 50000, 6, 'Standard lease terms', 10);
    assert.equal(lease.status, 'active');
    assert.equal(lease.monthly_rate_cents, 50000);
    assert.equal(lease.duration_months, 6);
    assert.equal(lease.revenue_share_percent, 10);

    const cancelled = market.cancelLease(lease.id);
    assert.equal(cancelled?.status, 'cancelled');
  });

  it('adds reviews and updates listing rating', () => {
    market.addReview(1, 1, 10, 5, 'Excellent agent!');
    market.addReview(1, 2, 20, 4, 'Good but could improve speed');
    const reviews = market.getReviews(1);
    assert.equal(reviews.length, 2);

    const listing = market.getListing(1);
    assert.ok(listing);
    assert.equal(listing.rating, 4.5);
    assert.equal(listing.review_count, 2);
  });

  it('creates and resolves disputes', () => {
    const dispute = market.createDispute(1, 'Evidence mismatch', ['screenshot.png']);
    assert.equal(dispute.status, 'open');
    assert.equal(dispute.timeline.length, 1);

    const resolved = market.resolveDispute(dispute.id, 'resolved_buyer', 'Evidence confirmed');
    assert.equal(resolved?.status, 'resolved_buyer');
    assert.equal(resolved?.timeline.length, 2);
    assert.ok(resolved?.resolved_at);
  });

  it('creates and completes purchases', () => {
    const purchase = market.createPurchase(1, 10, 100, 250000);
    assert.equal(purchase.status, 'pending');

    const completed = market.completePurchase(purchase.id);
    assert.equal(completed?.status, 'completed');

    const receipt = market.generateReceipt(purchase.id);
    assert.ok(receipt);
    assert.equal(receipt?.amount_cents, 250000);
  });
});

describe('generateAgentReplies', () => {
  it('returns alpha and beta replies', () => {
    const replies = generateAgentReplies('We found a bug in production');
    assert.ok(replies.alpha.length > 0);
    assert.ok(replies.beta.length > 0);
  });

  it('handles empty input', () => {
    const replies = generateAgentReplies('');
    assert.ok(replies.alpha.includes('AGENT_ALPHA'));
    assert.ok(replies.beta.includes('AGENT_BETA'));
  });
});
