// Marketplace barrel — exports all types and the AgentMarketplace wrapper
// Integrated from neuroloom/velra (Phase 3 Trust Marketplace) and neuroloom/agent-exchange

export { AgentMarketplace } from './agent-marketplace.js';
export { generateAgentReplies } from './agent-exchange.js';

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
