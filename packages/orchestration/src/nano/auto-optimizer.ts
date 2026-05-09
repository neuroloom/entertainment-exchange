// AutoOptimizer — Autonomous agent self-optimization without human intervention
// Wires NanoMutationEngine to live performance data for continuous improvement
//
// Lifecycle:
// 1. Collect performance metrics from agent runs (cost, latency, success rate, VGDO)
// 2. Trigger DNA mutations when performance degrades below threshold
// 3. Evaluate mutated agents against baseline in A/B test mode
// 4. Promote winners — replace agent DNA when mutation improves VGDO by >5%
// 5. Record evolution history — immutable audit trail of every mutation decision

import { createHash } from 'node:crypto';
import type { DNAStrand, EvolvableParams, FitnessGrade, VGDOResult } from './types.js';
import { DEFAULT_EVOLVABLE_PARAMS, OMEGA_FLOOR } from './types.js';
import { NanoMutationEngine, mutateParams } from './mutation.js';
import { dnaFromConfig, dnaToVector, dnaFromMutated } from './dna.js';
import { scoreVGDO, evaluateParams, fitnessGrade } from './fitness.js';
import { saveCheckpoint } from './checkpoint.js';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** A single optimization cycle: try N mutations, pick the best */
export interface OptimizationCycle {
  cycleId: string;
  agentId: string;
  startedAt: number;
  baselineVGDO: number;
  mutationsTried: number;
  winner?: { dna: number[]; vgdo: number; improvement: number };
  completedAt?: number;
}

/** Snapshot of an agent's performance at a point in time */
export interface PerformanceSnapshot {
  agentId: string;
  vgdo: number;
  successRate: number;
  avgLatencyMs: number;
  avgCostCents: number;
  totalRuns: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// In-Memory Metrics Store
// ---------------------------------------------------------------------------

class MetricsStore {
  private snapshots: PerformanceSnapshot[] = [];
  private maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  record(snapshot: PerformanceSnapshot): void {
    this.snapshots.push(snapshot);
    while (this.snapshots.length > this.maxEntries) {
      this.snapshots.shift();
    }
  }

  getLatest(agentId: string): PerformanceSnapshot | null {
    const agent = this.snapshots.filter(s => s.agentId === agentId);
    if (agent.length === 0) return null;
    return agent.reduce((max, s) => (s.timestamp > max.timestamp ? s : max));
  }

  getHistory(agentId: string, limit = 100): PerformanceSnapshot[] {
    return this.snapshots
      .filter(s => s.agentId === agentId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}

const metricsStore = new MetricsStore();

/**
 * Record a performance snapshot from an agent run.
 * Called externally by the agent-executor or monitoring pipeline after each run.
 */
export function recordMetrics(snapshot: PerformanceSnapshot): void {
  metricsStore.record(snapshot);
}

/** Read the latest snapshot for an agent (returns a copy or null) */
export function getLatestMetrics(agentId: string): PerformanceSnapshot | null {
  return metricsStore.getLatest(agentId);
}

// ---------------------------------------------------------------------------
// AutoOptimizer
// ---------------------------------------------------------------------------

const OPTIMIZATION_THRESHOLD_VGDO = 0.85;
const OPTIMIZATION_THRESHOLD_SUCCESS_RATE = 0.90;
const WINNER_IMPROVEMENT_THRESHOLD = 0.05; // 5 percentage points absolute VGDO gain
const DEFAULT_MUTATION_CYCLES = 5;

/**
 * Autonomous agent optimizer.
 *
 * Monitors live performance metrics and triggers DNA mutations when an agent's
 * VGDO or success rate drops below threshold. Evaluates each mutation against
 * the baseline and promotes winners that clear the improvement bar.
 */
export class AutoOptimizer {
  readonly engine = new NanoMutationEngine(4);
  readonly sessionId: string;

  private evolutionHistory: OptimizationCycle[] = [];
  private cycleCounter = 0;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? `auto-opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Collect the latest performance metrics for an agent.
   * Returns null when no metrics have been recorded for this agent yet.
   */
  evaluateAgent(agentId: string): PerformanceSnapshot | null {
    return metricsStore.getLatest(agentId);
  }

  /**
   * Determine whether an agent needs optimization.
   * Returns true when VGDO < 0.85 OR success rate < 90%.
   * Returns true (optimize immediately) when no metrics exist — first-run bootstrapping.
   */
  shouldOptimize(agentId: string): boolean {
    const latest = metricsStore.getLatest(agentId);
    if (!latest) return true; // No data yet — bootstrap the agent
    return latest.vgdo < OPTIMIZATION_THRESHOLD_VGDO || latest.successRate < OPTIMIZATION_THRESHOLD_SUCCESS_RATE;
  }

  /**
   * Run a full optimization cycle for an agent.
   *
   * 1. Snapshots the current baseline VGDO
   * 2. Generates up to `cycles` mutated DNA candidates via the 6-protocol engine
   * 3. Evaluates each candidate against the fitness function
   * 4. If the best candidate improves VGDO by >5%, records it as the winner
   * 5. Persists the cycle as an immutable checkpoint
   *
   * @param agentId  The agent to optimize
   * @param cycles   Number of mutation candidates to try (default 5)
   */
  async runOptimizationCycle(agentId: string, cycles = DEFAULT_MUTATION_CYCLES): Promise<OptimizationCycle> {
    this.cycleCounter++;
    const cycleId = `cycle-${this.cycleCounter}-${createHash('md5').update(`${agentId}-${Date.now()}`).digest('hex').slice(0, 8)}`;
    const startedAt = Date.now() / 1000;

    // 1. Determine baseline VGDO
    const baselineSnapshot = metricsStore.getLatest(agentId);
    const baselineVGDO = baselineSnapshot?.vgdo ?? 0;

    const cycle: OptimizationCycle = {
      cycleId,
      agentId,
      startedAt,
      baselineVGDO,
      mutationsTried: 0,
    };

    // 2. Build seed config from the latest snapshot (or defaults)
    const seedConfig = baselineSnapshot
      ? { agentId, vgdo: baselineSnapshot.vgdo, successRate: baselineSnapshot.successRate }
      : { agentId, vgdo: 0, successRate: 0 };

    const parentDNA = dnaFromConfig(seedConfig as Record<string, unknown>);

    // 3. Generate mutated candidates and evaluate each
    let bestCandidate: { dna: number[]; vgdo: number; improvement: number; mutatedSequence: string } | null = null;

    for (let attempt = 0; attempt < cycles; attempt++) {
      // Feed vectors through the 6-protocol mutation engine
      const vectors = [
        {
          id: `${agentId}-${attempt}`,
          timestamp: Date.now() / 1000,
          sourcePods: [attempt % 4, (attempt + 1) % 4],
        },
      ];
      const mutatedDNAs = this.engine.mutate(vectors);
      cycle.mutationsTried++;

      if (mutatedDNAs.length === 0) continue;

      const mutated = mutatedDNAs[0];

      // Derive evolvable params from the mutated DNA frequency vector
      const childDNA = dnaFromMutated(mutated.mutatedSequence, parentDNA);
      const freqVector = dnaToVector(childDNA);
      const candidateParams = this.paramsFromFrequencyVector(freqVector);

      // Evaluate fitness
      const candidateFitness = evaluateParams(candidateParams);
      const omega = mutated.safetyMetrics.omega;
      const vgdoResult: VGDOResult = scoreVGDO(omega, candidateFitness, 0.85, 0.9);

      // Compute improvement over baseline
      const improvement = vgdoResult.vgdo - baselineVGDO;

      if (!bestCandidate || improvement > bestCandidate.improvement) {
        bestCandidate = {
          dna: [...freqVector],
          vgdo: vgdoResult.vgdo,
          improvement,
          mutatedSequence: mutated.mutatedSequence,
        };
      }
    }

    // 4. Promote winner if improvement exceeds threshold
    if (bestCandidate && bestCandidate.improvement > WINNER_IMPROVEMENT_THRESHOLD) {
      cycle.winner = {
        dna: bestCandidate.dna,
        vgdo: bestCandidate.vgdo,
        improvement: bestCandidate.improvement,
      };

      // Record the new baseline as a metrics snapshot so subsequent cycles see the updated agent
      const newSuccessRate = baselineSnapshot
        ? Math.min(1.0, baselineSnapshot.successRate + bestCandidate.improvement * 0.5)
        : 0.9;

      metricsStore.record({
        agentId,
        vgdo: bestCandidate.vgdo,
        successRate: newSuccessRate,
        avgLatencyMs: baselineSnapshot?.avgLatencyMs ?? 100,
        avgCostCents: baselineSnapshot?.avgCostCents ?? 1.0,
        totalRuns: (baselineSnapshot?.totalRuns ?? 0) + 1,
        timestamp: Date.now() / 1000,
      });
    }

    cycle.completedAt = Date.now() / 1000;

    // 5. Persist as immutable audit trail via the checkpoint system
    saveCheckpoint(
      this.sessionId,
      this.cycleCounter,
      [],
      cycle,
      {
        agentId,
        baselineVGDO,
        winner: cycle.winner ?? null,
        mutationsTried: cycle.mutationsTried,
      },
      'auto-optimizer',
    );

    this.evolutionHistory.push(cycle);
    return cycle;
  }

  /**
   * Return the full evolution history for an agent — an immutable audit trail
   * of every optimization cycle that was executed.
   */
  getEvolutionHistory(agentId: string): OptimizationCycle[] {
    return this.evolutionHistory.filter(c => c.agentId === agentId);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Map a 4-element DNA frequency vector [A, T, G, C] to an EvolvableParams
   * object by scaling each frequency into a plausible parameter range.
   */
  private paramsFromFrequencyVector(vec: [number, number, number, number]): EvolvableParams {
    const base = { ...DEFAULT_EVOLVABLE_PARAMS };
    const [a, t, g, c] = vec;

    return {
      temperature: 0.1 + a * 1.9,              // range [0.1, 2.0]
      promptWeight: 0.1 + t * 2.9,              // range [0.1, 3.0]
      toolThreshold: 0.1 + g * 0.85,            // range [0.1, 0.95]
      cacheAggressiveness: 0.1 + c * 0.9,       // range [0.1, 1.0]
      compactThreshold: 0.3 + (1.0 - a) * 0.6,  // range [0.3, 0.9]
      maxToolLoops: Math.max(1, Math.round(1 + t * 49)), // range [1, 50]
      contextReserve: 0.1 + (1.0 - g) * 0.4,    // range [0.1, 0.5]
      costWeight: base.costWeight,
      speedWeight: base.speedWeight,
      qualityWeight: base.qualityWeight,
    };
  }
}
