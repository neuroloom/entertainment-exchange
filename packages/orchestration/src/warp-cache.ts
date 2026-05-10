// WarpCache — LRU + Semantic dual-layer cache with OMEGA validation
// Target: 99.95% hit rate (H_CACHE_HIT_RATE), 326µs latency (WARP_LATENCY_US)

import { cosineSimilarity } from './omega-governance.js';
import { S_ISO_THRESHOLD } from './types.js';
import type { CacheEntry, SemanticCacheEntry, MetricSnapshot } from './types.js';

export class LRUCache<K = string, V = unknown> {
  private store = new Map<K, CacheEntry<V>>();
  constructor(private maxSize = 50_000, private ttlMs?: number) {}

  set(key: K, value: V): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { key: String(key), value, createdAt: Date.now(), expiresAt: this.ttlMs ? Date.now() + this.ttlMs : null, hits: 0 });
    if (this.store.size > this.maxSize) { const oldest = this.store.keys().next().value; if (oldest !== undefined) this.store.delete(oldest); }
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) { this.store.delete(key); return undefined; }
    this.store.delete(key); this.store.set(key, { ...entry, hits: entry.hits + 1 });
    return entry.value;
  }

  has(key: K): boolean { return this.get(key) !== undefined; }
  delete(key: K): boolean { return this.store.delete(key); }
  clear(): void { this.store.clear(); }
  get size(): number { return this.store.size; }
}

export class SemanticCache {
  private entries: SemanticCacheEntry[] = [];
  private hitCount = 0;
  private missCount = 0;

  constructor(private maxEntries = 100_000, private threshold = S_ISO_THRESHOLD) {}

  put(key: string, prompt: string, response: string, embedding: number[]): void {
    // Guard: skip zero-magnitude vectors (can never match cosine)
    const mag = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    if (mag === 0) return;
    this.entries.push({ key, prompt, response, embedding, contentHash: hashFNV(prompt), createdAt: Date.now(), hits: 0 });
    if (this.entries.length > this.maxEntries) {
      // Evict oldest entries, but preserve recency-biased distribution
      const removed = this.entries.length - this.maxEntries;
      this.entries.splice(0, removed);
    }
  }

  query(embedding: number[]): { response: string; similarity: number } | undefined {
    if (this.entries.length === 0) { this.missCount++; return undefined; }
    // Zero-vector short-circuit: if query has no magnitude, skip expensive cosine loop
    const queryMag = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    if (queryMag === 0) { this.missCount++; return undefined; }

    let best: SemanticCacheEntry | undefined;
    let bestSim = -1;
    for (const entry of this.entries) {
      const sim = cosineSimilarity(entry.embedding, embedding);
      if (sim > bestSim) { bestSim = sim; best = entry; }
    }
    if (best && bestSim >= this.threshold) {
      best.hits++; this.hitCount++;
      return { response: best.response, similarity: bestSim };
    }
    this.missCount++;
    return undefined;
  }

  get hitRate(): number {
    const total = this.hitCount + this.missCount;
    return total === 0 ? 0 : this.hitCount / total;
  }

  get size(): number { return this.entries.length; }
}

export class BatchProcessor<TIn = string, TOut = unknown> {
  private queue: Array<{ payload: TIn; resolve: (v: TOut) => void; reject: (e: Error) => void }> = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private processFn: (items: TIn[]) => Promise<TOut[]>,
    private maxBatchSize = 24,
    private flushIntervalMs = 50,
  ) {}

  enqueue(payload: TIn): Promise<TOut> {
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      if (this.queue.length >= this.maxBatchSize) { void this.flush(); return; }
      if (!this.timer) { this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs); }
    });
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.queue.length === 0) return;
    const batch = this.queue; this.queue = [];
    try {
      const results = await this.processFn(batch.map(i => i.payload));
      batch.forEach((item, i) => item.resolve(results[i]));
    } catch (err) {
      batch.forEach(item => item.reject(err instanceof Error ? err : new Error(String(err))));
    }
  }

  get pending(): number { return this.queue.length; }
}

export class MetricsCollector {
  private counters = new Map<string, number>();
  private latencies: number[] = [];
  private timestamps: number[] = [];
  private startTime = Date.now();

  increment(metric: string, val = 1): void { this.counters.set(metric, (this.counters.get(metric) ?? 0) + val); }
  get(metric: string): number { return this.counters.get(metric) ?? 0; }
  recordLatency(ms: number): void { this.latencies.push(ms); if (this.latencies.length > 10_000) this.latencies.shift(); }
  recordTimestamp(): void { this.timestamps.push(Date.now()); if (this.timestamps.length > 10_000) this.timestamps.shift(); }

  snapshot(): MetricSnapshot {
    const total = this.get('total') || 1;
    const lruHits = this.get('lruHit');
    const semHits = this.get('semanticHit');
    const modelHits = this.get('modelHit');
    const coalescedHits = this.get('coalescedHit');
    const redLoomRejects = this.get('redLoomReject');
    const ollama = this.get('ollamaCall');
    const errors = this.get('error');
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const tokens = this.get('tokens');
    return {
      totalRequests: total, lruHits, semanticHits: semHits, modelHits, coalescedHits, redLoomRejects,
      ollamaCalls: ollama, errors,
      avgLatencyMs: Math.round(avg * 1000) / 1000,
      p95LatencyMs: Math.round(p95 * 1000) / 1000,
      hitRate: (lruHits + semHits + modelHits + coalescedHits) / total,
      tokensPerSecond: elapsed > 0 ? Math.round(tokens / elapsed) : 0,
      timestamp: Date.now(),
    };
  }
}

function hashFNV(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
