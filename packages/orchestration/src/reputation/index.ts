// Reputation module — composite scoring, cross-tenant benchmarks, fraud detection
// L4 NETWORK EFFECTS

export { ReputationEngine, REPUTATION_TIER_THRESHOLDS } from './reputation-engine.js';
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
  TierBenefit,
  CrossTenantTrustRecord,
} from './reputation-engine.js';
