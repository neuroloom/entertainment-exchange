#!/usr/bin/env tsx
// OMEGA Output Maximizer — CLI Benchmark Runner
// Finds max tokens/sec at OMEGA ≥ 0.999999 with -10% safety margin

import { findMaxThroughput, runBenchmark } from './benchmark.js';
import { OMEGA_FLOOR, DEFAULT_OMEGA_CONFIG } from './types.js';

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  OMEGA Output Maximizer — Throughput Benchmark  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log(`  OMEGA_FLOOR:    ${OMEGA_FLOOR}`);
  console.log(`  S_ISO_THRESHOLD: ${DEFAULT_OMEGA_CONFIG.similarityThreshold}`);
  console.log(`  Target latency:  <${DEFAULT_OMEGA_CONFIG.flushIntervalMs}ms flush\n`);

  // Quick single-config test
  console.log('── Phase 1: Single-config baseline ──\n');
  const baseline = await runBenchmark({ durationMs: 3000, concurrency: 64, batchSize: 24 });
  console.log(`  Requests:     ${baseline.totalRequests}`);
  console.log(`  Duration:     ${baseline.durationMs}ms`);
  console.log(`  Tokens/sec:   ${baseline.tokensPerSecond.toLocaleString()}`);
  console.log(`  Cache hit:    ${baseline.cacheHitRate}%`);
  console.log(`  Omega (Ω):    ${baseline.omega}`);
  console.log(`  VGDO:         ${baseline.vgdo.vgdo} (${baseline.vgdo.grade})`);
  console.log(`  Avg latency:  ${baseline.avgLatencyMs}ms`);
  console.log(`  P95 latency:  ${baseline.p95LatencyMs}ms`);
  console.log(`  Errors:       ${baseline.errors}\n`);

  // Sweep for max
  console.log('── Phase 2: Sweep for maximum ──\n');
  const { max, safe, sweep } = await findMaxThroughput(100, 0.10);

  console.log('  Sweep results:');
  console.log('  ┌──────────┬─────────────┬───────────────┬──────────┬──────────┐');
  console.log('  │  batch   │ concurrency │  tokens/sec   │  p95 ms  │  Ω       │');
  console.log('  ├──────────┼─────────────┼───────────────┼──────────┼──────────┤');
  for (const r of sweep) {
    console.log(`  │ ${String(r.config.batchSize).padStart(7)}  │ ${String(r.config.concurrency).padStart(10)}  │ ${String(r.tokensPerSecond.toLocaleString()).padStart(12)}  │ ${String(r.p95LatencyMs).padStart(7)}  │ ${String(r.omega).padStart(7)}  │`);
  }
  console.log('  └──────────┴─────────────┴───────────────┴──────────┴──────────┘\n');

  console.log('── Results ──\n');
  console.log(`  MAX tokens/sec:   ${max.tokensPerSecond.toLocaleString()}  (batch=${max.config.batchSize}, concurrency=${max.config.concurrency})`);
  console.log(`  SAFE (-10%):      ${safe.tokensPerSecond.toLocaleString()}`);
  console.log(`  Cache hit rate:   ${max.cacheHitRate}%`);
  console.log(`  Omega (Ω):        ${max.omega}`);
  console.log(`  VGDO grade:       ${max.vgdo.grade}`);
  console.log(`  P95 latency:      ${max.p95LatencyMs}ms`);

  if (max.omega < OMEGA_FLOOR) {
    console.log(`\n  ⚠ OMEGA below floor (${OMEGA_FLOOR}) — increase cache size or similarity threshold`);
  } else {
    console.log(`\n  ✓ OMEGA at six-nines coherence (≥ ${OMEGA_FLOOR})`);
  }

  console.log(`\n  Recommended config: ${JSON.stringify(safe.config)}\n`);
}

main().catch(err => { console.error('Benchmark failed:', err); process.exit(1); });
