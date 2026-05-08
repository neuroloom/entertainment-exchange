import { describe, it, expect } from 'vitest';
import { OutputMaximizer } from '../output-maximizer.js';
describe('OutputMaximizer Benchmarks', () => {
  // Cache hit rate benchmark
  it('achieves > 90% cache hit rate on repeated prompts', async () => {
    const om = new OutputMaximizer({ lruCacheSize: 1000, batchSize: 8 });
    const prompt = 'What is the capital of France?';
    // Model response must be >10 chars to pass OMEGA_RED_LOOM (0.90) coherence gate
    om.setModelFn(async () => 'Paris is the capital city of France');
    const first = await om.infer({ model: 'test', prompt });
    expect(first.cached).toBe(false);
    // Subsequent calls: should be cache hits
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      const res = await om.infer({ model: 'test', prompt });
      if (res.cached) hits++;
    }
    const hitRate = hits / 100;
    expect(hitRate).toBeGreaterThan(0.9);
  });
  // Request coalescing benchmark
  it('coalesces concurrent identical requests', async () => {
    // Use short flush interval so batch fires quickly
    const om = new OutputMaximizer({ batchSize: 8, flushIntervalMs: 5 });
    let callCount = 0;
    let resolveModel: ((v: string) => void) | undefined;
    om.setModelFn(async (_req) => {
      callCount++;
      return new Promise<string>((resolve) => {
        resolveModel = resolve;
      });
    });
    // Fire the first request; it will enqueue and the flush timer will start
    const p1 = om.infer({ model: 'test', prompt: 'coalesce test' });
    // Poll until the batch flushes and the model function is invoked
    for (let i = 0; i < 50 && callCount === 0; i++) {
      await new Promise(r => setTimeout(r, 2));
    }
    expect(callCount).toBe(1);
    expect(resolveModel).toBeDefined();
    // Now fire 19 more concurrent requests — they should all hit the inFlight map
    const extra = Array.from({ length: 19 }, () =>
      om.infer({ model: 'test', prompt: 'coalesce test' })
    );
    // Resolve the held model call; all 20 calls share the same batch promise
    resolveModel!('Coalesced response long enough to pass the coherence gate test');
    const results = await Promise.all([p1, ...extra]);
    expect(results.length).toBe(20);
    results.forEach(r => expect(r.done).toBe(true));
    // Coalescing should have reduced model calls
    const stats = om.getStats();
    expect(stats.coalescedHits).toBeGreaterThan(0);
  });
  // Batch processing benchmark
  it('processes batch within latency threshold', async () => {
    const om = new OutputMaximizer({ batchSize: 24, flushIntervalMs: 10 });
    om.setModelFn(async (_req) => {
      return 'Batched response for item processed successfully enough chars';
    });
    const start = performance.now();
    const promises = Array.from({ length: 48 }, (_, i) =>
      om.infer({ model: 'test', prompt: `batch item ${i}` })
    );
    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;
    expect(results.length).toBe(48);
    results.forEach(r => expect(r.done).toBe(true));
    // Batch should complete within 2 seconds
    expect(elapsed).toBeLessThan(2000);
  });
  // VGDO score benchmark
  it('computes VGDO score within expected range', () => {
    const om = new OutputMaximizer();
    const vgdo = om.getVGDO();
    expect(vgdo.vgdo).toBeGreaterThanOrEqual(0);
    expect(vgdo.vgdo).toBeLessThanOrEqual(1);
    expect(['S', 'A', 'B', 'C', 'D', 'F']).toContain(vgdo.grade);
  });
  // LRU eviction benchmark
  it('evicts oldest entries when cache is full', async () => {
    const om = new OutputMaximizer({ lruCacheSize: 10, batchSize: 4, flushIntervalMs: 5 });
    om.setModelFn(async (req) => 'Response for prompt: ' + req.prompt + ' with extra padding');
    // Fill cache beyond capacity
    for (let i = 0; i < 20; i++) {
      await om.infer({ model: 'test', prompt: 'prompt-' + i });
    }
    // Cache size should not exceed max
    expect(om.lru.size).toBeLessThanOrEqual(10);
  }, 15000);
  // Embedding fallback benchmark
  it('embedding fallback is deterministic', async () => {
    const om = new OutputMaximizer();
    // No OPENAI_API_KEY set -> should use ngram fallback
    const v1 = await (om as any)['embedAsync']('test text');
    const v2 = await (om as any)['embedAsync']('test text');
    expect(v1).toEqual(v2);
    expect(v1.length).toBeGreaterThan(0);
  });
});
