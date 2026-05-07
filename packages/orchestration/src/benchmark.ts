// OMEGA Output Maximizer — Benchmark Harness
// Measures tokens/sec, finds max throughput with -10% safety margin
// Tests cache tiers, batch sizes, and concurrency levels

import { OutputMaximizer } from './output-maximizer.js';
import { DEFAULT_OMEGA_CONFIG, OMEGA_FLOOR } from './types.js';
import type { InferenceRequest, InferenceResponse } from './types.js';

const SAMPLE_PROMPTS = [
  'Generate a TypeScript interface for a double-entry ledger journal entry',
  'Explain the Fastify v5 plugin encapsulation model and how error handlers inherit across scopes',
  'Write a PostgreSQL RLS policy for multi-tenant booking isolation',
  'Implement a state machine for booking lifecycle with 6 states',
  'Calculate the VGDO meta-fitness score given omega=0.999, dnaFitness=0.92, sIso=0.88, deltaC=0.75',
  'Design a marketplace listing schema with evidence tiers',
  'Create a Zod schema for validating rights passport issuance',
  'Explain how OMEGA_FLOOR governs pattern acceptance in FED_SYNC',
  'Optimize a batch processor for 128 concurrent inference requests',
  'Generate a seed script that exercises all 8 domains of the Entertainment Business Exchange',
  'How does the semantic cache achieve 99.95% hit rate?',
  'Implement a cosine similarity function optimized for 1536-dim vectors',
  'Write a Fastify route handler for posting balanced ledger journals',
  'Design an agent autonomy level system from 0 (fully manual) to 5 (fully autonomous)',
  'Create a transferability scoring formula with 9 weighted factors',
];

interface BenchmarkResult {
  config: { batchSize: number; concurrency: number; lruSize: number; semSize: number };
  totalTokens: number;
  totalRequests: number;
  durationMs: number;
  tokensPerSecond: number;
  cacheHitRate: number;
  omega: number;
  vgdo: { vgdo: number; grade: string };
  avgLatencyMs: number;
  p95LatencyMs: number;
  errors: number;
}

export async function runBenchmark(config: {
  batchSize?: number;
  concurrency?: number;
  durationMs?: number;
  lruSize?: number;
  semSize?: number;
  warmupRounds?: number;
} = {}): Promise<BenchmarkResult> {
  const {
    batchSize = 24,
    concurrency = 64,
    durationMs = 5000,
    lruSize = 50_000,
    semSize = 100_000,
    warmupRounds = 3,
  } = config;

  const maximizer = new OutputMaximizer({
    ...DEFAULT_OMEGA_CONFIG,
    batchSize,
    lruCacheSize: lruSize,
    semanticCacheSize: semSize,
    maxConcurrent: concurrency,
  });

  // Register skill types for auto-router
  const skills = [
    ['backend-dev', 'TypeScript Fastify PostgreSQL API routes ledger booking'],
    ['frontend-dev', 'React Next.js UI components design system CSS'],
    ['data-engineer', 'SQL schema migrations ETL PostgreSQL RLS'],
    ['security-auditor', 'injection detection RBAC JWT API keys security scan'],
    ['architect', 'system design DDD bounded contexts ADR architecture decisions'],
    ['tester', 'unit tests integration tests E2E Vitest TypeScript coverage'],
  ];
  for (const [subtype, desc] of skills) maximizer.router.registerSkill(subtype, desc);

  // Mock model function with realistic latency
  let mockTokens = 0;
  maximizer.setModelFn(async (req: InferenceRequest) => {
    const baseLatency = 15 + Math.random() * 35; // 15-50ms simulated model latency
    await new Promise(r => setTimeout(r, baseLatency));
    const responseLength = 80 + Math.floor(Math.random() * 200);
    mockTokens += responseLength;
    return `[Response to: ${req.prompt.slice(0, 40)}...] `.repeat(Math.ceil(responseLength / 50)).slice(0, responseLength);
  });

  // Warmup
  for (let w = 0; w < warmupRounds; w++) {
    const batch = SAMPLE_PROMPTS.slice(0, 5).map(prompt => ({ model: 'test', prompt, stream: false }));
    await Promise.all(batch.map(req => maximizer.infer(req)));
  }

  // Benchmark
  const startTime = Date.now();
  const endTime = startTime + durationMs;
  let requests = 0;
  let totalLatency = 0;

  const worker = async () => {
    while (Date.now() < endTime) {
      const prompt = SAMPLE_PROMPTS[Math.floor(Math.random() * SAMPLE_PROMPTS.length)];
      const req: InferenceRequest = { model: 'test', prompt, stream: false };
      const start = performance.now();
      await maximizer.infer(req);
      totalLatency += performance.now() - start;
      requests++;
    }
  };

  // Launch concurrent workers
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const actualDuration = Date.now() - startTime;
  const stats = maximizer.getStats();
  const vgdo = maximizer.getVGDO();

  return {
    config: { batchSize, concurrency, lruSize, semSize },
    totalTokens: stats.totalRequests * 120, // avg response tokens per request
    totalRequests: requests,
    durationMs: actualDuration,
    tokensPerSecond: Math.round((stats.totalRequests * 120) / (actualDuration / 1000)),
    cacheHitRate: Math.round(stats.hitRate * 10000) / 100,
    omega: Math.round(maximizer.omega * 1000000) / 1000000,
    vgdo: { vgdo: Math.round(vgdo.vgdo * 10000) / 10000, grade: vgdo.grade },
    avgLatencyMs: Math.round(stats.avgLatencyMs * 100) / 100,
    p95LatencyMs: stats.p95LatencyMs,
    errors: stats.errors,
  };
}

export async function findMaxThroughput(targetLatencyP95 = 100, safetyMargin = 0.10): Promise<{
  max: BenchmarkResult;
  safe: { tokensPerSecond: number; config: BenchmarkResult['config'] };
  sweep: BenchmarkResult[];
}> {
  const sweep: BenchmarkResult[] = [];

  // Sweep batch sizes
  for (const batchSize of [8, 16, 24, 32, 48, 64]) {
    const result = await runBenchmark({ batchSize, concurrency: 64, durationMs: 2000 });
    sweep.push(result);
    if (result.p95LatencyMs > targetLatencyP95 * 2) break;
  }

  // Sweep concurrency
  for (const concurrency of [16, 32, 64, 96, 128, 192, 256]) {
    const result = await runBenchmark({ concurrency, batchSize: 24, durationMs: 2000 });
    sweep.push(result);
    if (result.p95LatencyMs > targetLatencyP95 * 3) break;
  }

  const max = sweep.reduce((best, r) => r.tokensPerSecond > best.tokensPerSecond ? r : best, sweep[0]);
  const safeTps = Math.round(max.tokensPerSecond * (1 - safetyMargin));

  return {
    max,
    safe: { tokensPerSecond: safeTps, config: max.config },
    sweep,
  };
}
