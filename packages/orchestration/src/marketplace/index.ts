// Marketplace barrel — exports all types and the AgentMarketplace wrapper
// Integrated from neuroloom/velra (Phase 3 Trust Marketplace) and neuroloom/agent-exchange
// L3 Marketplace additions: EvidenceValidator + DealRoomEngine

export { AgentMarketplace } from './agent-marketplace.js';
export { generateAgentReplies } from './agent-exchange.js';
export { EvidenceValidator } from './evidence-validator.js';
export { DealRoomEngine } from './deal-room-engine.js';

export type { EvidenceTier, EvidenceValidationResult, EvidenceDocument } from './evidence-validator.js';
export type { DealState, DealRecord, DealEvent } from './deal-room-engine.js';

export type {
  // Verification & Escrow
  VerificationLevel,
  EscrowState,
  EscrowTransaction,

  // Offer & Counter-Offer
  OfferHistoryEntry,
  AcquisitionOffer,

  // Lease
  LeaseAgreement,

  // Review & Rating
  Review,

  // Dispute
  DisputeTimelineEntry,
  DisputeResolution,

  // Analytics & Receipts
  SellerAnalytics,
  TransactionReceipt,

  // Agent DNA
  AgentDNA,
  MutationEntry,

  // Listings & Search
  MarketplaceListing,
  MarketplaceFilters,
  MarketplaceSearchResult,

  // Company (from Velra README)
  Company,

  // Agent Exchange messages / threads
  MessageSender,
  AgentMessage,
  AgentThread,
  AgentReplies,

  // Purchase transaction
  PurchaseStatus,
  AgentPurchaseTransaction,
} from './types.js';
