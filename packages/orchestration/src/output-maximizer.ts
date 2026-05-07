// OMEGA Output Maximizer — Unified pipeline for maximum token throughput
// Combines: WarpCache + SNP Governance + FED_SYNC + AutoRouter + BatchProcessor
// Target: max tokens/sec at OMEGA ≥ 0.999999, -10% safety margin

import { LRUCache, SemanticCache, BatchProcessor, MetricsCollector } from './warp-cache.js';
import { SNPGovernance, FedSyncReceiver, computeVGDO } from './omega-governance.js';
import { TaskRouter, NgramEmbedder } from './auto-router.js';
import { AgentMarketplace } from './marketplace/agent-marketplace.js';
import { getEmbeddingProvider } from './embeddings.js';
import type { EmbeddingProvider } from './embeddings.js';
import {
  OMEGA_FLOOR, OMEGA_RED_LOOM, WARP_LATENCY_US, S_ISO_THRESHOLD, DEFAULT_OMEGA_CONFIG,
} from './types.js';
import type {
  OMEGAConfig, InferenceRequest, InferenceResponse, MetricSnapshot,
  FedSyncPattern, VGDOScore,
} from './types.js';

export class OutputMaximizer {
  // Dual-layer cache
  readonly lru = new LRUCache<string, InferenceResponse>();
  readonly semantic = new SemanticCache();
  // Governance
  readonly snp = new SNPGovernance();
  readonly fedSync = new FedSyncReceiver();
  // Routing
  readonly router = new TaskRouter();
  // Shared embedder (avoid recomputing ngrams per call)
  readonly embedder = new NgramEmbedder(3);
  // Real embedding provider (lazy-init, graceful fallback to ngrams)
  private embeddingProvider: EmbeddingProvider | null | undefined = undefined;
  // Marketplace (from neuroloom/velra + neuroloom/agent-exchange)
  readonly marketplace = new AgentMarketplace();
  // Metrics
  readonly metrics = new MetricsCollector();
  // Batch processor
  private batch: BatchProcessor<InferenceRequest, InferenceResponse>;
  // In-flight request coalescing (dedup bursty identical prompts)
  private inFlight = new Map<string, Promise<InferenceResponse>>();

  private config: OMEGAConfig;
  private currentOmega = 1.0;
  private modelFn: ((req: InferenceRequest) => Promise<string>) | null = null;

  constructor(config: Partial<OMEGAConfig> = {}) {
    this.config = { ...DEFAULT_OMEGA_CONFIG, ...config };
    this.lru = new LRUCache(this.config.lruCacheSize);
    this.semantic = new SemanticCache(this.config.semanticCacheSize, this.config.similarityThreshold);

    // Wire FED_SYNC: accepted patterns update semantic cache
    this.fedSync.onPattern((pattern: FedSyncPattern) => {
      if (pattern.vector?.length > 0) {
        this.semantic.put(pattern.id, pattern.patternType, `${pattern.patternType} @ Ω${pattern.omegaScore}`, pattern.vector);
      }
    });

    // Register marketplace routing skills so marketplace queries route to AgentMarketplace
    this.router.registerSkill('marketplace-list', 'search listing browse find agent company marketplace catalog');
    this.router.registerSkill('marketplace-buy', 'buy purchase acquire escrow transaction pay checkout order');
    this.router.registerSkill('marketplace-sell', 'sell list create listing publish offer post agent company');
    this.router.registerSkill('marketplace-lease', 'lease rent monthly subscription recurring lease agreement terms');
    this.router.registerSkill('marketplace-review', 'review rating feedback star rate score comment');
    this.router.registerSkill('marketplace-dispute', 'dispute refund complaint resolution resolve problem');
    this.router.registerSkill('agent-thread', 'thread message chat conversation talk agent alpha beta reply');

    // Batch processor for model calls
    this.batch = new BatchProcessor<InferenceRequest, InferenceResponse>(
      async (items) => this.processBatch(items),
      this.config.batchSize,
      this.config.flushIntervalMs,
    );
  }

  setModelFn(fn: (req: InferenceRequest) => Promise<string>): void { this.modelFn = fn; }

  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    const startUs = performance.now() * 1000;
    const lruKey = `${request.model}:${request.prompt}`;

    // Layer 0: Exact LRU match
    const cached = this.lru.get(lruKey);
    if (cached) {
      this.metrics.increment('lruHit');
      this.metrics.increment('total');
      this.metrics.increment('tokens', cached.completionTokens);
      this.metrics.recordLatency((performance.now() * 1000 - startUs) / 1000);
      return { ...cached, cached: true, source: 'lru' };
    }

    // Layer 0.5: Request coalescing — dedup in-flight duplicate prompts
    const inFlight = this.inFlight.get(lruKey);
    if (inFlight) {
      this.metrics.increment('coalescedHit');
      return inFlight;
    }

    // Layer 1: Semantic similarity — real embeddings when available, ngram fallback
    const embedding = await this.embedAsync(request.prompt);
    const semHit = this.semantic.query(embedding);
    if (semHit) {
      this.metrics.increment('semanticHit');
      this.metrics.increment('total');
      const response: InferenceResponse = {
        model: request.model, response: semHit.response,
        promptTokens: request.prompt.length / 4, completionTokens: semHit.response.length / 4,
        latencyMs: (performance.now() * 1000 - startUs) / 1000, cached: true, source: 'semantic', done: true,
      };
      this.lru.set(lruKey, response);
      this.metrics.increment('tokens', response.completionTokens);
      this.metrics.recordLatency(response.latencyMs);
      return response;
    }

    // Layer 2: Batched model call — track in-flight for coalescing
    const batchPromise = this.batch.enqueue(request).then(resp => {
      this.inFlight.delete(lruKey);
      return resp;
    }).catch(err => {
      this.inFlight.delete(lruKey);
      throw err;
    });
    this.inFlight.set(lruKey, batchPromise);
    return batchPromise;
  }

  private async processItem(req: InferenceRequest): Promise<InferenceResponse> {
    const startUs = performance.now() * 1000;
    this.metrics.increment('total');
    const responseText = this.modelFn
      ? await this.modelFn(req)
      : `[mock] ${req.prompt.slice(0, 100)}`;

    // Coherence gate: reject responses below RED_LOOM threshold
    const omegaEstimate = responseText.length > 10 ? 0.95 : 0.70;
    if (omegaEstimate < OMEGA_RED_LOOM) {
      this.metrics.increment('redLoomReject');
      return {
        model: req.model, response: '', promptTokens: Math.ceil(req.prompt.length / 4),
        completionTokens: 0, latencyMs: (performance.now() * 1000 - startUs) / 1000,
        cached: false, source: 'model', done: false,
      };
    }

    const resp: InferenceResponse = {
      model: req.model,
      response: responseText,
      promptTokens: Math.ceil(req.prompt.length / 4),
      completionTokens: Math.ceil(responseText.length / 4),
      latencyMs: (performance.now() * 1000 - startUs) / 1000,
      cached: false, source: 'model', done: true,
    };

    const lruKey = `${req.model}:${req.prompt}`;
    this.lru.set(lruKey, resp);
    this.metrics.increment('modelHit');
    this.metrics.increment('tokens', resp.completionTokens);
    this.metrics.recordLatency(resp.latencyMs);

    // Update OMEGA coherence
    const hitRate = this.metrics.snapshot().hitRate;
    this.currentOmega = OMEGA_FLOOR * hitRate + (1 - hitRate) * 0.8;
    this.snp.setOmega(this.currentOmega);
    this.fedSync.setOmega(this.currentOmega);

    return resp;
  }

  private async processBatch(items: InferenceRequest[]): Promise<InferenceResponse[]> {
    // True parallel execution — all items in batch fire simultaneously
    return Promise.all(items.map(req =>
      this.processItem(req).catch(err => {
        this.metrics.increment('error');
        return {
          model: req.model, response: '', promptTokens: 0, completionTokens: 0,
          latencyMs: 0, cached: false, source: 'model' as const, done: false,
        };
      })
    ));
  }

  getVGDO(): VGDOScore {
    const snap = this.metrics.snapshot();
    return computeVGDO(
      this.currentOmega,
      snap.hitRate,
      snap.hitRate >= S_ISO_THRESHOLD ? snap.hitRate : 0,
      snap.hitRate >= 0.9 ? 1 : snap.hitRate,
    );
  }

  get omega(): number { return this.currentOmega; }
  getStats(): MetricSnapshot { return this.metrics.snapshot(); }

  /** Lazy-init embedding provider. Real embeddings when OPENAI_API_KEY is set, ngram fallback otherwise. */
  private async embedAsync(text: string): Promise<number[]> {
    if (this.embeddingProvider === undefined) {
      try {
        this.embeddingProvider = getEmbeddingProvider();
      } catch {
        this.embeddingProvider = null;
      }
    }
    if (this.embeddingProvider) {
      try {
        return await this.embeddingProvider.embed(text);
      } catch {
        this.embeddingProvider = null;
      }
    }
    return this.embedder.embed(text);
  }

  hydratePatterns(patterns: FedSyncPattern[]): number {
    let accepted = 0;
    for (const p of patterns) {
      if (this.snp.validatePattern(p)) {
        if (p.vector?.length > 0) {
          this.semantic.put(p.id, p.patternType, `${p.patternType}`, p.vector);
        }
        accepted++;
      }
    }
    return accepted;
  }

  /** Route a marketplace intent string through the AutoRouter and return matched skill + confidence. */
  routeMarketplace(intent: string) {
    return this.router.route(intent);
  }
}
