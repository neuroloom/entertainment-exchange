// NanoClaw Integration Module — DNA Evolution, Checkpoint/Resume, Fitness, CLI
// Ported from neuroloomorg/neuroloom-nano (Python) to TypeScript
// Wired into the OMEGA OutputMaximizer cache pipeline
//
// Usage:
//   import { NanoAgent, NanoMutationEngine, dnaFromConfig, scoreVGDO } from '@entertainment-exchange/orchestration/nano';
//
//   const agent = new NanoAgent(outputMaximizer);
//   const result = await agent.run({ epochs: 1000 });
//   console.log(NanoAgent.formatProgress(result.history));

// Types & Constants
export type {
  DNAStrand,
  EvolvableParams,
  VGDOResult,
  FitnessGrade,
  EpochRecord,
  EvolutionResult,
  EvolutionOptions,
  PIDState,
  SafetyMetrics,
  MutatedDNA,
  CheckpointEntry,
  CheckpointSummary,
  SessionSummary,
  MutationProtocol,
  ProtocolStats,
  MutationTrackingSummary,
  StabilityVerdict,
} from './types.js';

export {
  DEFAULT_EVOLVABLE_PARAMS,
  DEFAULT_EVOLUTION_OPTIONS,
  DEFAULT_PID,
  GDO_WEIGHTS,
  GRADE_THRESHOLDS,
  OMEGA_FLOOR,
  LYAPUNOV_CRITICAL,
  LYAPUNOV_KILL,
  S_ISO_FUSION_THRESHOLD,
  H_CACHE_HIT_RATE,
  MUTATION_BETA_1_MAX_NORMAL,
  MARKET_DECISION_ACCURACY_TARGET,
  MARKET_VIRTUAL_ANALYSTS,
} from './types.js';

// DNA utilities
export { dnaFromConfig, dnaFromMutated, dnaToVector, dnaHash, validateDNA } from './dna.js';

// Fitness engine
export { computeVGDO, scoreVGDO, cosineSimilarity, fitnessGrade, evaluateParams } from './fitness.js';

// Mutation engine (6 protocols)
export { NanoMutationEngine, mutateParams } from './mutation.js';

// Checkpoint system
export {
  saveCheckpoint,
  loadLatestCheckpoint,
  loadCheckpointByStep,
  listCheckpoints,
  listSessions,
  resumeLatestSession,
  checkpointCount,
} from './checkpoint.js';

// NanoAgent (evolution runner wired into OutputMaximizer)
export { NanoAgent } from './nano-agent.js';
export type { EpochCallback } from './nano-agent.js';
