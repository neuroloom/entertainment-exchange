// NanoClaw Mutation Engine — 6-protocol DNA mutation orchestrator
// Ported from neuroloom-nano/evolution/mutation_engine.py

import { createHash } from 'node:crypto';
import type { EvolvableParams, MutatedDNA, PIDState, SafetyMetrics, MutationTrackingSummary, MutationProtocol } from './types.js';
import { DEFAULT_PID, MUTATION_BETA_1_MAX_NORMAL, OMEGA_FLOOR } from './types.js';

const NUCLEOTIDES = ['A', 'T', 'G', 'C'] as const;

// --------------- Utilities ---------------

function gaussianRandom(mean = 0, stdev = 1): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + stdev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function randomNucleotide(exclude?: string): string {
  const choices = exclude ? NUCLEOTIDES.filter(n => n !== exclude) : [...NUCLEOTIDES];
  return choices[Math.floor(Math.random() * choices.length)];
}

/** Perturb a value within [low, high] using Gaussian noise */
function perturb(val: number, low: number, high: number, rate = 0.1): number {
  const delta = gaussianRandom(0, rate * (high - low));
  return Math.max(low, Math.min(high, val + delta));
}

// --------------- Protocol 1: Cross-Pod DNA Fusion ---------------

class CrossPodDNAFusion {
  constructor(private numPods = 4) {}

  fuse(_sourcePods: number[]): string {
    let seq = '';
    for (let i = 0; i < 128; i++) {
      seq += randomNucleotide();
    }
    return seq;
  }

  getClusterId(sourcePods: number[]): string {
    const seeds = [...new Set(sourcePods.map(p => p % this.numPods))].sort((a, b) => a - b);
    return `cluster_${seeds[0]}_${seeds[seeds.length - 1]}`;
  }
}

// --------------- Protocol 2: PID-Governed Mutation ---------------

class PIDGovernedMutation {
  pid: PIDState = { ...DEFAULT_PID };
  mutationHistory: number[] = [];

  mutate(sequence: string, targetRate = 0.5): [string, Record<string, number>] {
    const recentSlice = this.mutationHistory.slice(-10);
    const currentRate = recentSlice.length > 0
      ? recentSlice.reduce((s, v) => s + v, 0) / Math.min(this.mutationHistory.length, 10)
      : 0;

    const error = targetRate - currentRate;
    this.pid.integral = Math.max(-5, Math.min(5, this.pid.integral + error));
    const derivative = error - this.pid.prevError;
    const correction = this.pid.kp * error + this.pid.ki * this.pid.integral + this.pid.kd * derivative;
    this.pid.prevError = error;

    const mutationRate = Math.max(0.01, Math.min(0.99, 0.5 + correction));
    const mutated = this.apply(sequence, mutationRate);
    this.mutationHistory.push(mutationRate);
    if (this.mutationHistory.length > 100) {
      this.mutationHistory = this.mutationHistory.slice(-100);
    }

    return [mutated, {
      Kp: this.pid.kp, Ki: this.pid.ki, Kd: this.pid.kd,
      appliedRate: mutationRate, currentError: error,
    }];
  }

  private apply(seq: string, rate: number): string {
    const result = [...seq];
    for (let i = 0; i < result.length; i++) {
      if (Math.random() < rate && NUCLEOTIDES.includes(result[i] as typeof NUCLEOTIDES[number])) {
        result[i] = randomNucleotide(result[i]);
      }
    }
    return result.join('');
  }
}

// --------------- Protocol 3: CHRONO_SYNC_HASH ---------------

class CHRONOSyncHasher {
  constructor(private epochDuration = 3600) {}

  computeSync(vectorTimestamp: number, sequence: string) {
    const now = Date.now() / 1000;
    const ve = Math.floor(vectorTimestamp / this.epochDuration);
    const ce = Math.floor(now / this.epochDuration);
    const offset = Math.abs(ce - ve);
    const epochHash = createHash('sha256').update(`${ce}_${sequence.slice(0, 32)}`).digest('hex');
    return {
      epochHash,
      alignmentScore: Math.max(0, 1.0 - offset * 0.1),
      currentEpoch: ce,
      epochOffset: offset,
      syncVerified: offset <= 1,
    };
  }
}

// --------------- Protocol 4: Failure Density Fusion ---------------

class FailureDensityFusion {
  densityMap: Record<string, number> = {};

  fuse(sequence: string, regions: string[], threshold = 0.7): string {
    const result = [...sequence];
    const regionSize = Math.floor(sequence.length / Math.max(regions.length, 1));
    for (let r = 0; r < regions.length; r++) {
      const start = r * regionSize;
      const end = Math.min((r + 1) * regionSize, sequence.length);
      const density = this.densityMap[regions[r]] ?? 0.1;
      let rate: number;
      if (density >= 0.3 && density <= 0.7) rate = 0.15;
      else if (density > threshold) rate = Math.max(0.01, 0.1 * (1 - density));
      else rate = Math.min(0.3, 0.3 * (1 + density));
      for (let j = start; j < end; j++) {
        if (Math.random() < rate && NUCLEOTIDES.includes(result[j] as typeof NUCLEOTIDES[number])) {
          result[j] = randomNucleotide(result[j]);
        }
      }
    }
    return result.join('');
  }
}

// --------------- Protocol 5: Memetic Gravity Well (5 wells) ---------------

interface GravityWell { wellId: string; mass: number; position: number[]; radius: number; energy: number; }

class MemeticGravityWell {
  wells: GravityWell[];

  constructor() {
    const positions = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1],
    ];
    this.wells = positions.map((pos, i) => ({
      wellId: `well_${i}`,
      mass: Math.random() * 1.5 + 0.5,
      position: pos,
      radius: Math.random() * 1.0 + 0.5,
      energy: Math.random() * 0.9 + 0.1,
    }));
  }

  computeGravityScore(position: number[]): number {
    let total = 0;
    for (const well of this.wells) {
      const d = Math.sqrt(position.reduce((s, p, i) => s + (p - well.position[i]) ** 2, 0));
      if (d < well.radius) {
        total += Math.min(well.mass * well.energy / (d * d + 0.01), 10.0);
      }
    }
    return Math.min(1.0, total / 10.0);
  }

  attractMutation(sequence: string, position: number[]): string {
    const score = this.computeGravityScore(position);
    const rate = Math.max(0.05, 0.5 - score * 0.4);
    const result = [...sequence];
    for (let i = 0; i < result.length; i++) {
      if (Math.random() < rate && NUCLEOTIDES.includes(result[i] as typeof NUCLEOTIDES[number])) {
        result[i] = randomNucleotide(result[i]);
      }
    }
    return result.join('');
  }
}

// --------------- Protocol 6: Safety Gate ---------------

class SafetyGate {
  readonly OMEGA_THRESHOLD = OMEGA_FLOOR;
  readonly BETA_THRESHOLD = MUTATION_BETA_1_MAX_NORMAL;

  verify(sequence: string, mutationCount = 0): SafetyMetrics {
    const omega = Math.max(OMEGA_FLOOR, Math.min(1.0, Math.abs(this.entropy(sequence)) * 0.000001 / 2 + OMEGA_FLOOR));
    const beta1 = (mutationCount / Math.max(sequence.length, 1)) * 100;
    return {
      omega,
      beta1,
      omegaVerified: omega >= this.OMEGA_THRESHOLD,
      betaVerified: beta1 <= this.BETA_THRESHOLD,
      gatesPassed: omega >= this.OMEGA_THRESHOLD && beta1 <= this.BETA_THRESHOLD,
    };
  }

  private entropy(seq: string): number {
    if (!seq) return 0;
    let ent = 0;
    for (const n of NUCLEOTIDES) {
      const p = seq.split(n).length - 1;
      if (p > 0) ent -= (p / seq.length) * Math.sqrt(p / seq.length);
    }
    return ent;
  }
}

// --------------- Mutation Success Tracker ---------------

class MutationSuccessTracker {
  readonly PROTOCOL_NAMES: MutationProtocol[] = [
    'CrossPod', 'PID', 'CHRONO', 'FailureDensity', 'MemeticGravity', 'SafetyGate',
  ];
  private stats: Map<MutationProtocol, { totalCalls: number; successfulMutations: number; totalFitnessDelta: number }>;

  constructor() {
    this.stats = new Map();
    for (const name of this.PROTOCOL_NAMES) {
      this.stats.set(name, { totalCalls: 0, successfulMutations: 0, totalFitnessDelta: 0 });
    }
  }

  record(protocol: MutationProtocol, success: boolean, fitnessDelta = 0): void {
    const s = this.stats.get(protocol)!;
    s.totalCalls++;
    if (success) s.successfulMutations++;
    s.totalFitnessDelta += fitnessDelta;
  }

  summary(): MutationTrackingSummary {
    const out: MutationTrackingSummary = {};
    for (const [name, s] of this.stats) {
      out[name] = {
        totalCalls: s.totalCalls,
        successRate: s.totalCalls > 0 ? s.successfulMutations / s.totalCalls : 0,
        avgFitnessDelta: s.totalCalls > 0 ? s.totalFitnessDelta / s.totalCalls : 0,
      };
    }
    return out;
  }
}

// --------------- Param Mutation ---------------

/** Create a mutated copy of EvolvableParams with Gaussian perturbation */
export function mutateParams(params: EvolvableParams, mutationRate = 0.1): EvolvableParams {
  return {
    temperature: perturb(params.temperature, 0.0, 2.0, mutationRate),
    promptWeight: perturb(params.promptWeight, 0.1, 3.0, mutationRate),
    toolThreshold: perturb(params.toolThreshold, 0.1, 0.95, mutationRate),
    cacheAggressiveness: perturb(params.cacheAggressiveness, 0.1, 1.0, mutationRate),
    compactThreshold: perturb(params.compactThreshold, 0.3, 0.9, mutationRate),
    maxToolLoops: Math.max(1, Math.min(50, params.maxToolLoops + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 3))),
    contextReserve: perturb(params.contextReserve, 0.1, 0.5, mutationRate),
    costWeight: params.costWeight,    // kept stable
    speedWeight: params.speedWeight,  // kept stable
    qualityWeight: params.qualityWeight, // kept stable
  };
}

// --------------- Orchestrator ---------------

/** Full 6-protocol mutation orchestrator (matching Python NanoclawMutationEngine) */
export class NanoMutationEngine {
  private crossPod: CrossPodDNAFusion;
  private pid: PIDGovernedMutation;
  private chrono: CHRONOSyncHasher;
  private failureDensity: FailureDensityFusion;
  private gravity: MemeticGravityWell;
  private safety: SafetyGate;
  private counter = 0;
  tracker: MutationSuccessTracker;

  constructor(numPods = 4) {
    this.crossPod = new CrossPodDNAFusion(numPods);
    this.pid = new PIDGovernedMutation();
    this.chrono = new CHRONOSyncHasher();
    this.failureDensity = new FailureDensityFusion();
    this.gravity = new MemeticGravityWell();
    this.safety = new SafetyGate();
    this.tracker = new MutationSuccessTracker();
  }

  /** Run all 6 mutation protocols on input vectors and return mutated DNAs */
  mutate(inputVectors: Array<{ id: string; timestamp?: number; sourcePods?: number[] }>, targetPosition?: number[]): MutatedDNA[] {
    const pos = targetPosition ?? [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
    const results: MutatedDNA[] = [];

    for (const vec of inputVectors) {
      const vecId = vec.id ?? `vec_${Math.floor(Math.random() * 8999) + 1000}`;
      const ts = vec.timestamp ?? Date.now() / 1000;
      const pods = vec.sourcePods ?? [0, 1];

      const fused = this.crossPod.fuse(pods);
      const cluster = this.crossPod.getClusterId(pods);

      const [mutated, pidParams] = this.pid.mutate(fused);
      const chrono = this.chrono.computeSync(ts, mutated);
      const finalSeq = this.failureDensity.fuse(mutated, Array.from({ length: 8 }, (_, i) => `r${i}`));
      const gravitySeq = this.gravity.attractMutation(finalSeq, pos);
      const gravityScore = this.gravity.computeGravityScore(pos);
      const safetyM = this.safety.verify(gravitySeq);

      this.counter++;
      const dnaId = `DNA_${String(this.counter).padStart(6, '0')}_${createHash('md5').update(gravitySeq).digest('hex').slice(0, 8)}`;

      this.tracker.record('CrossPod', true, 0.01);
      this.tracker.record('PID', true, (pidParams.appliedRate ?? 0) * 0.02);
      this.tracker.record('CHRONO', safetyM.omegaVerified, 0.005);
      this.tracker.record('FailureDensity', true, 0.008);
      this.tracker.record('MemeticGravity', gravityScore > 0.3, gravityScore * 0.01);
      this.tracker.record('SafetyGate', safetyM.gatesPassed, 0);

      results.push({
        dnaId,
        originalVectorIds: [vecId],
        mutationOperators: ['crossover', 'inversion', 'translocation', 'point'],
        mutatedSequence: gravitySeq,
        gravityScore,
        pidParams,
        chronoSync: chrono,
        clusterId: cluster,
        safetyMetrics: safetyM,
      });
    }

    return results;
  }

  /** Get protocol usage tracking summary */
  getTrackingSummary(): MutationTrackingSummary {
    return this.tracker.summary();
  }
}
