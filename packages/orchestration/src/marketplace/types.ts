// Marketplace Types — integrated from neuroloom/velra Phase 3 Trust Marketplace
// Source: https://github.com/neuroloom/velra (apps/agent-swarms/phase3-trust-marketplace.tsx)

// ─── Verification & Escrow ───────────────────────────────────────────────────

export type VerificationLevel =
  | 'unverified'
  | 'email_verified'
  | 'identity_verified'
  | 'pro_seller';

// Evidence tiers for deal-room readiness (L3 Marketplace)
export type EvidenceTier =
  | 'self_reported'
  | 'document_supported'
  | 'platform_verified'
  | 'acquisition_ready';

export interface EvidenceValidationResult {
  valid: boolean;
  missingDocuments: string[];
  reasons: string[];
}

// Deal state machine (13 states for the acquisition lifecycle)
export type DealState =
  | 'created'
  | 'offer_submitted'
  | 'offer_accepted'
  | 'due_diligence'
  | 'terms_negotiated'
  | 'terms_agreed'
  | 'escrow_funded'
  | 'legal_review'
  | 'closing'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type EscrowState =
  | 'initiated'
  | 'funded'
  | 'in_due_diligence'
  | 'approved'
  | 'disputed'
  | 'completed'
  | 'refunded';

// ─── Escrow Transaction ──────────────────────────────────────────────────────

export interface EscrowTransaction {
  id: number;
  listing_id: number;
  buyer_id: number;
  seller_id: number;
  amount_cents: number;
  state: EscrowState;
  created_at: string;
  funded_at?: string;
  due_diligence_end?: string;
  approved_at?: string;
  completed_at?: string;
  refunded_at?: string;
  dispute_reason?: string;
  dispute_evidence?: string[];
}

// ─── Acquisition / Offer Flow ────────────────────────────────────────────────

export interface OfferHistoryEntry {
  timestamp: string;
  from: 'buyer' | 'seller';
  amount_cents: number;
  message?: string;
  action: 'initial' | 'counter' | 'accept' | 'reject';
}

export interface AcquisitionOffer {
  id: number;
  listing_id: number;
  buyer_id: number;
  seller_id: number;
  amount_cents: number;
  status: 'pending' | 'countered' | 'accepted' | 'rejected';
  counter_amount_cents?: number;
  message?: string;
  created_at: string;
  responded_at?: string;
  history?: OfferHistoryEntry[];
}

// ─── Lease Agreement ─────────────────────────────────────────────────────────

export interface LeaseAgreement {
  id: number;
  listing_id: number;
  lessor_id: number;
  lessee_id: number;
  monthly_rate_cents: number;
  duration_months: number;
  auto_renew: boolean;
  revenue_share_percent?: number;
  terms: string;
  status: 'active' | 'cancelled' | 'expired';
  start_date: string;
  end_date?: string;
  generated_document?: string;
}

// ─── Review & Rating ─────────────────────────────────────────────────────────

export interface Review {
  id: number;
  transaction_id: number;
  listing_id: number;
  reviewer_id: number;
  rating: number; // 1-5
  comment: string;
  created_at: string;
  helpful_count?: number;
}

// ─── Dispute Resolution ─────────────────────────────────────────────────────

export interface DisputeTimelineEntry {
  timestamp: string;
  event: string;
  description: string;
  by?: 'buyer' | 'seller' | 'platform';
}

export interface DisputeResolution {
  id: number;
  escrow_transaction_id: number;
  reason: string;
  evidence_urls: string[];
  status: 'open' | 'investigating' | 'resolved_buyer' | 'resolved_seller';
  timeline: DisputeTimelineEntry[];
  created_at: string;
  resolved_at?: string;
  resolution_notes?: string;
}

// ─── Seller Analytics ───────────────────────────────────────────────────────

export interface SellerAnalytics {
  seller_id: number;
  period_start: string;
  period_end: string;
  total_views: number;
  total_inquiries: number;
  total_offers: number;
  offers_accepted: number;
  conversion_rate: number;
  revenue_from_sales_cents: number;
  revenue_from_leases_cents: number;
  avg_time_to_sale_days: number;
}

// ─── Transaction Receipt ─────────────────────────────────────────────────────

export interface TransactionReceipt {
  id: number;
  type: 'purchase' | 'sale' | 'lease_start' | 'lease_payment';
  listing_name: string;
  amount_cents: number;
  date: string;
  buyer_name?: string;
  seller_name?: string;
  transaction_id: string;
}

// ─── Agent DNA (Phase 2) ─────────────────────────────────────────────────────

export interface AgentDNA {
  speed: number;        // 1-100: Task completion velocity
  accuracy: number;     // 1-100: Output precision
  creativity: number;   // 1-100: Novel solution generation
  reliability: number;  // 1-100: Consistent performance
  learningRate: number; // 1-100: Adaptation speed
}

export interface MutationEntry {
  timestamp: string;
  trigger: 'task_success' | 'task_failure' | 'review';
  trait: keyof AgentDNA;
  delta: number;
  newValue: number;
}

// ─── Marketplace Listing ─────────────────────────────────────────────────────

export interface MarketplaceListing {
  id: number;
  type: 'agent' | 'company';
  name: string;
  description?: string;
  category: string;
  price_cents: number;
  monthly_revenue_cents?: number;
  reputation_score: number;
  verification_level: VerificationLevel;
  is_pro: boolean;
  hire_count: number;
  rating: number;
  review_count: number;
  escrow_protected: boolean;
  seller_id: number;
  seller_name: string;
  dna?: AgentDNA;
  mutation_history?: MutationEntry[];
  created_at: string;
  updated_at: string;
}

// ─── Company (from Velra README) ─────────────────────────────────────────────

export interface Company {
  id: number;
  name: string;
  category: string;
  status: 'active' | 'paused' | 'listed';
  reputation: number;      // 0-100 score
  valuation_cents: number;
  monthly_revenue_cents: number;
  agent_count: number;
  playbook_count: number;
}

// ─── Search / Filter ─────────────────────────────────────────────────────────

export interface MarketplaceFilters {
  query?: string;
  type?: 'agent' | 'company';
  category?: string;
  min_price_cents?: number;
  max_price_cents?: number;
  min_rating?: number;
  verification_level?: VerificationLevel;
  escrow_protected?: boolean;
  sort_by?: 'price_asc' | 'price_desc' | 'rating' | 'revenue' | 'newest' | 'popular';
  page?: number;
  page_size?: number;
}

export interface MarketplaceSearchResult {
  listings: MarketplaceListing[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ─── Agent Exchange (from neuroloom/agent-exchange) ──────────────────────────

export type MessageSender = 'USER' | 'AGENT_ALPHA' | 'AGENT_BETA';

export interface AgentMessage {
  id: string;
  thread_id: string;
  sender: MessageSender;
  content: string;
  created_at: string;
}

export interface AgentThread {
  id: string;
  title: string | null;
  messages: AgentMessage[];
  created_at: string;
  updated_at: string;
}

export interface AgentReplies {
  alpha: string;
  beta: string;
}

// ─── Agent Exchange Transaction (for marketplace buy/sell) ───────────────────

export type PurchaseStatus = 'pending' | 'escrowed' | 'completed' | 'cancelled' | 'refunded';

export interface AgentPurchaseTransaction {
  id: string;
  listing_id: number;
  buyer_id: number;
  seller_id: number;
  amount_cents: number;
  status: PurchaseStatus;
  escrow_id?: number;
  created_at: string;
  completed_at?: string;
  cancelled_at?: string;
  refunded_at?: string;
}

// ─── Deal Room (L3 Marketplace) ──────────────────────────────────────────────

export interface DealEvent {
  timestamp: string;
  fromState: DealState;
  toState: DealState;
  action: string;
  metadata?: Record<string, unknown>;
}

export interface DealRecord {
  id: string;
  listingId: number;
  buyerId: number;
  sellerId: number;
  state: DealState;
  amountCents: number;
  counterAmountCents?: number;
  terms?: string;
  escrowTxHash?: string;
  events: DealEvent[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
