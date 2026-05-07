// OMEGA Output Maximizer — Unified pipeline for maximum token throughput
// Combines: WarpCache + SNP Governance + FED_SYNC + AutoRouter + BatchProcessor
// Target: max tokens/sec at OMEGA ≥ 0.999999, -10% safety margin

import { LRUCache, SemanticCache, BatchProcessor, MetricsCollector } from './warp-cache.js';
import { SNPGovernance, FedSyncReceiver, computeVGDO } from './omega-governance.js';
import { TaskRouter, NgramEmbedder } from './auto-router.js';
import { AgentMarketplace } from './marketplace/agent-marketplace.js';
import {
  OMEGA_FLOOR, WARP_LATENCY_US, S_ISO_THRESHOLD, DEFAULT_OMEGA_CONFIG,
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
  // Marketplace (from neuroloom/velra + neuroloom/agent-exchange)
  readonly marketplace = new AgentMarketplace();
  // Metrics
  readonly metrics = new MetricsCollector();
  // Batch processor
  private batch: BatchProcessor<InferenceRequest, InferenceResponse>;

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

    // Layer 0: Exact LRU match
    const lruKey = `${request.model}:${request.prompt}`;
    const cached = this.lru.get(lruKey);
    if (cached) {
      this.metrics.increment('lruHit');
      this.metrics.increment('total');
      this.metrics.increment('tokens', cached.completionTokens);
      this.metrics.recordLatency((performance.now() * 1000 - startUs) / 1000);
      return { ...cached, cached: true, source: 'lru' };
    }

    // Layer 1: Semantic similarity via ngram embedding
    const embedder = new NgramEmbedder(3);
    const embedding = embedder.embed(request.prompt);
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

    // Layer 2: Batched model call
    return this.batch.enqueue(request);
  }

  private async processBatch(items: InferenceRequest[]): Promise<InferenceResponse[]> {
    // Route each item to the best model
    const results: InferenceResponse[] = [];
    for (const req of items) {
      const startUs = performance.now() * 1000;
      this.metrics.increment('total');
      try {
        const responseText = this.modelFn
          ? await this.modelFn(req)
          : `[mock] ${req.prompt.slice(0, 100)}`;

        const resp: InferenceResponse = {
          model: req.model,
          response: responseText,
          promptTokens: Math.ceil(req.prompt.length / 4),
          completionTokens: Math.ceil(responseText.length / 4),
          latencyMs: (performance.now() * 1000 - startUs) / 1000,
          cached: false,
          source: 'model',
          done: true,
        };

        // Cache for future
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

        results.push(resp);
      } catch (err) {
        this.metrics.increment('error');
        results.push({
          model: req.model, response: '', promptTokens: 0, completionTokens: 0,
          latencyMs: (performance.now() * 1000 - startUs) / 1000,
          cached: false, source: 'model', done: false,
        });
      }
    }
    return results;
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
