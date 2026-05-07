// OMEGA Architecture — Ecosystem Constants and Types
// Derived from neuroloom-warpcore + neuroloom-nanoclaw + neuroloom-openclawx
// VGDO = 0.4·Ω + 0.3·DNA_fitness + 0.2·S_iso + 0.1·ΔC

export const OMEGA_FLOOR = 0.999999;        // Six-nines coherence floor
export const OMEGA_RED_LOOM = 0.90;          // Pattern rejection threshold
export const OMEGA_SNP = 0.85;               // SNP governance threshold
export const OMEGA_SEVERANCE = 0.80;         // Pattern severance (poisoning)
export const H_CACHE_HIT_RATE = 0.9995;      // 99.95% zero-energy cache target
export const WARP_LATENCY_US = 326;          // End-to-end latency in microseconds
export const S_ISO_THRESHOLD = 0.92;         // Semantic isomorphism fusion threshold
export const MAX_CONCURRENT_AGENTS = 500_000; // Max parallel agents
export const GDO_WEIGHT_OMEGA = 0.4;
export const GDO_WEIGHT_DNA = 0.3;
export const GDO_WEIGHT_S_ISO = 0.2;
export const GDO_WEIGHT_DELTA_C = 0.1;

export interface FedSyncPattern {
  id: string;
  domain: number;
  patternType: string;
  vector: number[];
  omegaScore: number;
  createdAt: number;
}

export interface FedSyncBroadcast {
  patterns: FedSyncPattern[];
  broadcastId: string;
  timestamp: number;
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number | null;
  hits: number;
}

export interface SemanticCacheEntry {
  key: string;
  prompt: string;
  response: string;
  embedding: number[];
  contentHash: string;
  createdAt: number;
  hits: number;
}

export interface InferenceRequest {
  model: string;
  prompt: string;
  system?: string;
  options?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    stop?: string[];
  };
  stream?: boolean;
  meta?: Record<string, unknown>;
}

export interface InferenceResponse {
  model: string;
  response: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cached: boolean;
  source: 'lru' | 'semantic' | 'model' | 'ollama';
  done: boolean;
}

export interface MetricSnapshot {
  totalRequests: number;
  lruHits: number;
  semanticHits: number;
  modelHits: number;
  coalescedHits: number;
  redLoomRejects: number;
  ollamaCalls: number;
  errors: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  hitRate: number;
  tokensPerSecond: number;
  timestamp: number;
}

export interface RoutingResult {
  subtype: string;
  confidence: number;
  alternatives: Array<{ subtype: string; score: number }>;
}

export interface VGDOScore {
  omega: number;
  dnaFitness: number;
  sIso: number;
  deltaC: number;
  vgdo: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface OMEGAConfig {
  semanticCacheSize: number;
  lruCacheSize: number;
  similarityThreshold: number;
  batchSize: number;
  flushIntervalMs: number;
  maxConcurrent: number;
  model: string;
  embeddingModel: string;
  ollamaUrl: string;
}

export const DEFAULT_OMEGA_CONFIG: OMEGAConfig = {
  semanticCacheSize: 100_000,
  lruCacheSize: 50_000,
  similarityThreshold: S_ISO_THRESHOLD,
  batchSize: 24,
  flushIntervalMs: 50,
  maxConcurrent: 128,
  model: 'llama3.2',
  embeddingModel: 'nomic-embed-text',
  ollamaUrl: 'http://localhost:11434',
};
