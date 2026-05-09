export { OutputMaximizer } from './output-maximizer.js';
export { LRUCache, SemanticCache, BatchProcessor, MetricsCollector } from './warp-cache.js';
export { SNPGovernance, FedSyncReceiver, computeVGDO, cosineSimilarity } from './omega-governance.js';
export { TaskRouter, NgramEmbedder, SkillIndex } from './auto-router.js';
export { OpenAIEmbeddingProvider, getEmbeddingProvider, setEmbeddingProvider, vectorFallback } from './embeddings.js';
export type { EmbeddingProvider } from './embeddings.js';
export { runBenchmark, findMaxThroughput } from './benchmark.js';

// Operations module — Moat 4: Autonomous Operations (self-healing, dynamic pricing)
export { SelfHealer } from './operations/self-healer.js';
export { DynamicPricingEngine } from './operations/dynamic-pricing.js';
export type {
  AgentHealth,
  RecoveryAction,
  AgentRunRecord,
  CircuitBreakerState,
  PriceRecommendation,
  HistoricalDeal,
  DemandForecast,
  PricePointAnalysis,
} from './operations/index.js';

export {
  OMEGA_FLOOR, OMEGA_RED_LOOM, OMEGA_SNP, OMEGA_SEVERANCE,
  H_CACHE_HIT_RATE, WARP_LATENCY_US, S_ISO_THRESHOLD, MAX_CONCURRENT_AGENTS,
  GDO_WEIGHT_OMEGA, GDO_WEIGHT_DNA, GDO_WEIGHT_S_ISO, GDO_WEIGHT_DELTA_C,
  DEFAULT_OMEGA_CONFIG,
} from './types.js';
export type {
  OMEGAConfig, FedSyncPattern, FedSyncBroadcast, CacheEntry, SemanticCacheEntry,
  InferenceRequest, InferenceResponse, MetricSnapshot,
  RoutingResult, VGDOScore,
} from './types.js';

// NanoClaw DNA Evolution exports (from neuroloom-nano integration)
// Note: computeVGDO and cosineSimilarity are also exported from omega-governance.js;
// the nano versions (numeric return, array args) are accessible via the nano/ barrel.
export {
  NanoAgent,
  NanoMutationEngine,
  mutateParams,
  dnaFromConfig, dnaFromMutated, dnaToVector, dnaHash, validateDNA,
  scoreVGDO as scoreVGDO_nano,
  fitnessGrade,
  evaluateParams,
  saveCheckpoint, loadLatestCheckpoint, loadCheckpointByStep,
  listCheckpoints, listSessions, resumeLatestSession, checkpointCount,
  DEFAULT_EVOLVABLE_PARAMS, DEFAULT_EVOLUTION_OPTIONS, DEFAULT_PID,
  GDO_WEIGHTS as NANO_GDO_WEIGHTS,
  GRADE_THRESHOLDS as NANO_GRADE_THRESHOLDS,
  OMEGA_FLOOR as NANO_OMEGA_FLOOR,
  LYAPUNOV_CRITICAL, LYAPUNOV_KILL,
  S_ISO_FUSION_THRESHOLD,
  H_CACHE_HIT_RATE as NANO_H_CACHE_HIT_RATE,
  MUTATION_BETA_1_MAX_NORMAL,
  MARKET_DECISION_ACCURACY_TARGET, MARKET_VIRTUAL_ANALYSTS,
} from './nano/index.js';
export type {
  DNAStrand, EvolvableParams, VGDOResult, FitnessGrade,
  EpochRecord, EvolutionResult, EvolutionOptions,
  PIDState, SafetyMetrics, MutatedDNA,
  CheckpointEntry, CheckpointSummary, SessionSummary,
  MutationProtocol, ProtocolStats, MutationTrackingSummary,
  StabilityVerdict, EpochCallback,
} from './nano/index.js';

// Marketplace exports (from neuroloom/velra + neuroloom/agent-exchange)
export { AgentMarketplace, generateAgentReplies, EvidenceValidator, DealRoomEngine } from './marketplace/index.js';
// Booking domain exports
export { BOOKING_STATES, ALLOWED_TRANSITIONS, assertBookingTransition, isTerminalState, getNextStates, BookingStateError, calculateQuote } from './booking/index.js';
export type { BookingState, EventType, QuoteParams, QuoteBreakdown } from './booking/index.js';

export type {
  VerificationLevel,
  EscrowState,
  EscrowTransaction,
  OfferHistoryEntry,
  AcquisitionOffer,
  LeaseAgreement,
  Review,
  DisputeTimelineEntry,
  DisputeResolution,
  SellerAnalytics,
  TransactionReceipt,
  AgentDNA,
  MutationEntry,
  MarketplaceListing,
  MarketplaceFilters,
  MarketplaceSearchResult,
  Company,
  MessageSender,
  AgentMessage,
  AgentThread,
  AgentReplies,
  PurchaseStatus,
  AgentPurchaseTransaction,
  EvidenceTier,
  EvidenceValidationResult,
  EvidenceDocument,
  DealState,
  DealRecord,
  DealEvent,
} from './marketplace/index.js';

// Rights module — passport chain-of-title, transferability scoring
export { PassportVerifier, TransferabilityScorer } from './rights/index.js';
export type {
  PassportStatus,
  PassportType,
  LegalAnchor,
  RightsAsset,
  RightsPassport,
  PassportChainEntry,
  PassportChain,
  VerificationResult,
  IssuePassportInput,
  PassportVerifierStores,
  TransferabilityGrade,
  TransferabilityScore,
  TransferabilityBreakdown,
  FactorDetail,
  BusinessProfile,
} from './rights/index.js';

// Tokenized Rights module — L4 fractional ownership, rights tokenization, royalty distribution
export { TokenizationEngine } from './tokenized-rights/index.js';
export type {
  RightsToken,
  RoyaltyDistribution,
  RoyaltyDistributionItem,
  OwnershipSnapshot,
  HolderHistoryEntry,
  TokenTransfer,
  TokenizationStores,
} from './tokenized-rights/index.js';

// Reputation module — composite scoring, cross-tenant benchmarks, fraud detection (L4 NETWORK EFFECTS)
export { ReputationEngine, REPUTATION_TIER_THRESHOLDS } from './reputation/index.js';
export type {
  ReputationTier,
  ReputationAuditEvent,
  ReputationReview,
  ReputationPassport,
  ReputationFactor,
  ReputationScoreFactors,
  ReputationScore,
  IndustryBenchmark,
  FraudIndicator,
} from './reputation/index.js';

// Data Pipeline — Moat 3: Proprietary Data Network Effects
export { EmbeddingIndexer, FraudDetector } from './data-pipeline/index.js';
export type {
  DomainEmbedding,
  SimilarityEdge,
  FraudDetectorStores,
} from './data-pipeline/index.js';

// Compliance module — Moat 5: Compliance & Audit Automation
export {
  AuditReportGenerator,
  COMPLIANCE_WEIGHTS,
  RegulatoryEngine,
  BUILT_IN_RULES,
  RULE_DUAL_ENTRY_BALANCE,
  RULE_REVENUE_RECOGNITION_TIMING,
  RULE_IDEMPOTENCY,
  RULE_SEGREGATION_OF_DUTIES,
  RULE_RIGHTS_TRANSFER,
} from './compliance/index.js';
export type {
  AuditReport,
  AuditSection,
  AuditFinding,
  AuditEvent,
  JournalLine,
  RevenueEvent,
  PassportTransferRecord,
  AuditGeneratorStores,
  ComplianceRule,
  ComplianceCheckResult,
  RegulatoryEngineStores,
  CachedCheckResult,
} from './compliance/index.js';

// Ledger exports
export {
  IdempotencyStore,
  idempotencyStore,
  DEPOSIT_RECIPE,
  RECOGNIZE_RECIPE,
  COMMISSION_RECIPE,
  PAYOUT_RECIPE,
  getRecipeForEvent,
  verifyRecipe,
  verifyAllRecipes,
  RevenueSchedule,
} from './ledger/index.js';
export type {
  IdempotencyEntry,
  RecipeEntry,
  RecipeResult,
  RevenueRecipe,
  ScheduledRecognition,
} from './ledger/index.js';

// Protocol Mesh — Moat 10: Multi-Protocol Agent Mesh
export { ProtocolRouter } from './protocol-mesh/index.js';
export type {
  ProtocolAdapter,
  PaymentParams,
  PaymentResult,
  PaymentVerification,
  RouteRecommendation,
  ProtocolStatus,
} from './protocol-mesh/index.js';

// Cryptographic Audit — Moat 9: Immutable Cryptographic Audit Chain
export { ChainVerifier } from './cryptographic-audit/index.js';
export type {
  HashChainEntry,
  MerkleProof,
  ComplianceProof,
} from './cryptographic-audit/index.js';
