export { OutputMaximizer } from './output-maximizer.js';
export { LRUCache, SemanticCache, BatchProcessor, MetricsCollector } from './warp-cache.js';
export { SNPGovernance, FedSyncReceiver, computeVGDO, cosineSimilarity } from './omega-governance.js';
export { TaskRouter, NgramEmbedder, SkillIndex } from './auto-router.js';
export { OpenAIEmbeddingProvider, getEmbeddingProvider, setEmbeddingProvider, vectorFallback } from './embeddings.js';
export type { EmbeddingProvider } from './embeddings.js';
export { runBenchmark, findMaxThroughput } from './benchmark.js';
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
export { AgentMarketplace, generateAgentReplies } from './marketplace/index.js';
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
  BusinessProfile,
} from './rights/index.js';

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
