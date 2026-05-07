// NanoClaw Integration Types — DNA Evolution, Checkpoint/Resume, Epoch Runner
// Ported from neuroloomorg/neuroloom-nano (Python) to TypeScript
// Ref: neuro/nano/evolution/genome.py, fitness.py, mutation_engine.py, epoch_runner.py

/** 128-char ATGC DNA strand (SHA-512 derived from agent config) */
export interface DNAStrand {
  /** 128-character string of A/T/G/C only */
  sequence: string;
  /** Hashed lineage chain (parent hashes) */
  lineage: string[];
}

/** All evolvable agent hyperparameters */
export interface EvolvableParams {
  temperature: number;
  promptWeight: number;
  toolThreshold: number;
  cacheAggressiveness: number;
  compactThreshold: number;
  maxToolLoops: number;
  contextReserve: number;
  costWeight: number;
  speedWeight: number;
  qualityWeight: number;
}

/** Default evolvable params (matching Python epoch_runner.py defaults) */
export const DEFAULT_EVOLVABLE_PARAMS: EvolvableParams = {
  temperature: 0.7,
  promptWeight: 1.0,
  toolThreshold: 0.5,
  cacheAggressiveness: 0.8,
  compactThreshold: 0.7,
  maxToolLoops: 20,
  contextReserve: 0.3,
  costWeight: 0.33,
  speedWeight: 0.33,
  qualityWeight: 0.34,
};

/** VGDO meta-fitness weights (matching Python fitness.py constants) */
export const GDO_WEIGHTS = {
  omega: 0.4,
  dna: 0.3,
  sIso: 0.2,
  deltaC: 0.1,
} as const;

/** Fitness grade thresholds */
export const GRADE_THRESHOLDS: Array<{ grade: FitnessGrade; min: number }> = [
  { grade: 'S', min: 0.95 },
  { grade: 'A', min: 0.85 },
  { grade: 'B', min: 0.75 },
  { grade: 'C', min: 0.60 },
  { grade: 'D', min: 0.40 },
];

/** Grade literal type */
export type FitnessGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/** VGDO score result */
export interface VGDOResult {
  omega: number;
  dnaFitness: number;
  sIso: number;
  deltaC: number;
  vgdo: number;
  grade: FitnessGrade;
}

/** A single epoch's evolution record */
export interface EpochRecord {
  epoch: number;
  vgdo: number;
  delta: number;
  fitness: number;
  grade: FitnessGrade;
  omega: number;
  improved: boolean;
  params: EvolvableParams;
}

/** Full evolution run result */
export interface EvolutionResult {
  epochs: number;
  elapsedSeconds: number;
  avgVgdo: number;
  bestVgdo: number;
  finalVgdo: number;
  finalGrade: FitnessGrade;
  improvements: number;
  regressions: number;
  improvementRate: string;
  bestParams: EvolvableParams;
  historyLength: number;
  haltedEarly: boolean;
  haltEpoch: number | null;
  rollbackCount: number;
  history: EpochRecord[];
}

/** Evolution run options */
export interface EvolutionOptions {
  epochs: number;
  noProgressLimit: number;
  rollbackThreshold: number;
  dryRun: boolean;
  concurrency: number;
}

/** Default evolution options */
export const DEFAULT_EVOLUTION_OPTIONS: EvolutionOptions = {
  epochs: 1000,
  noProgressLimit: 50,
  rollbackThreshold: 0.05,
  dryRun: false,
  concurrency: 4,
};

/** PID controller state */
export interface PIDState {
  kp: number;
  ki: number;
  kd: number;
  setpoint: number;
  prevError: number;
  integral: number;
}

/** Default PID params (matching Python fitness.py) */
export const DEFAULT_PID: PIDState = {
  kp: 1.0,
  ki: 0.1,
  kd: 0.05,
  setpoint: 0.85,
  prevError: 0,
  integral: 0,
};

/** DNA mutation protocol names */
export type MutationProtocol =
  | 'CrossPod'
  | 'PID'
  | 'CHRONO'
  | 'FailureDensity'
  | 'MemeticGravity'
  | 'SafetyGate';

/** Mutation protocol tracking stats */
export interface ProtocolStats {
  protocolName: MutationProtocol;
  totalCalls: number;
  successfulMutations: number;
  totalFitnessDelta: number;
}

/** Mutation tracking summary (per-protocol) */
export interface MutationTrackingSummary {
  [protocol: string]: {
    totalCalls: number;
    successRate: number;
    avgFitnessDelta: number;
  };
}

/** Safety gate metrics */
export interface SafetyMetrics {
  omega: number;
  beta1: number;
  omegaVerified: boolean;
  betaVerified: boolean;
  gatesPassed: boolean;
}

/** Mutated DNA result (matching Python MutatedDNA dataclass) */
export interface MutatedDNA {
  dnaId: string;
  originalVectorIds: string[];
  mutationOperators: string[];
  mutatedSequence: string;
  gravityScore: number;
  pidParams: Record<string, number>;
  chronoSync: Record<string, unknown>;
  clusterId: string;
  safetyMetrics: SafetyMetrics;
}

/** Checkpoint entry stored to disk */
export interface CheckpointEntry {
  step: number;
  timestamp: number;
  sessionId: string;
  functionName: string;
  messages: unknown[];
  result: unknown;
  state: Record<string, unknown>;
}

/** Checkpoint summary (for listing) */
export interface CheckpointSummary {
  step: number;
  timestamp: number;
  functionName: string;
  messagesSize: number;
  resultPreview: string;
}

/** Session summary (for listing sessions) */
export interface SessionSummary {
  sessionId: string;
  steps: number;
  lastTimestamp: number;
}

/** Lyapunov stability verdict */
export type StabilityVerdict = 'STABLE' | 'MARGINALLY_STABLE' | 'UNSTABLE' | 'CHAOTIC';

/** Constants from Python fitness.py */
export const OMEGA_FLOOR = 0.999999;
export const LYAPUNOV_CRITICAL = 0.05;
export const LYAPUNOV_KILL = 0.5;
export const S_ISO_FUSION_THRESHOLD = 0.87;
export const H_CACHE_HIT_RATE = 0.9995;
export const MUTATION_BETA_1_MAX_NORMAL = 100;
export const MARKET_DECISION_ACCURACY_TARGET = 0.99999;
export const MARKET_VIRTUAL_ANALYSTS = 1000;
