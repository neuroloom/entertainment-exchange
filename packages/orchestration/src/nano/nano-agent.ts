// NanoClaw Agent Wrapper — Evolution loop wired into OutputMaximizer cache
// Ported from neuroloom-nano/evolution/epoch_runner.py
//
// Each epoch:
// 1. Mutate DNA via 6-protocol engine
// 2. Mutate evolvable params via hill-climbing
// 3. Evaluate on synthetic benchmark
// 4. Run inference through OutputMaximizer cache pipeline
// 5. Keep improvements, discard regressions
// 6. Council of Worlds every 100 epochs, Federation sync every 50
// 7. Checkpoint state for resume capability

import { performance } from 'node:perf_hooks';
import type { OutputMaximizer } from '../output-maximizer.js';
import type { InferenceRequest } from '../types.js';
import { NanoMutationEngine, mutateParams } from './mutation.js';
import { evaluateParams, scoreVGDO, fitnessGrade, computeVGDO } from './fitness.js';
import { dnaFromConfig, dnaToVector } from './dna.js';
import { saveCheckpoint, loadLatestCheckpoint, listSessions } from './checkpoint.js';
import type {
  EvolvableParams,
  EvolutionOptions,
  EvolutionResult,
  EpochRecord,
  FitnessGrade,
  VGDOResult,
  MutatedDNA,
} from './types.js';
import {
  DEFAULT_EVOLVABLE_PARAMS,
  DEFAULT_EVOLUTION_OPTIONS,
  OMEGA_FLOOR,
} from './types.js';

// ---------------------------------------------------------------------------
// Epoch callback type
// ---------------------------------------------------------------------------

export type EpochCallback = (epoch: number, vgdo: number, grade: FitnessGrade, improved: boolean) => void | Promise<void>;

// ---------------------------------------------------------------------------
// NanoAgent
// ---------------------------------------------------------------------------

export class NanoAgent {
  readonly engine = new NanoMutationEngine(4);
  readonly sessionId: string;

  private bestParams: EvolvableParams;
  private bestFitness: number;
  private bestVgdo: number;
  private history: EpochRecord[] = [];
  private improvements = 0;
  private regressions = 0;
  private rollbackCount = 0;
  private epochsNoProgress = 0;
  private haltedEarly = false;
  private haltEpoch: number | null = null;
  private startTime = 0;

  // PID controller state
  private pidIntegral = 0;
  private pidPrevError = 0;
  private readonly pidKp = 1.0;
  private readonly pidKi = 0.1;
  private readonly pidKd = 0.05;
  private readonly pidTarget = 0.85;

  constructor(
    private maximizer: OutputMaximizer,
    sessionId?: string,
    initialParams?: Partial<EvolvableParams>,
  ) {
    this.sessionId = sessionId ?? `nano-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.bestParams = { ...DEFAULT_EVOLVABLE_PARAMS, ...initialParams };
    this.bestFitness = evaluateParams(this.bestParams);
    this.bestVgdo = 0;
  }

  // -----------------------------------------------------------------------
  // Evolution Runner
  // -----------------------------------------------------------------------

  /** Run the full evolution loop, equivalent to Python run_evolution() */
  async run(options: Partial<EvolutionOptions> = {}, callback?: EpochCallback): Promise<EvolutionResult> {
    const opts: EvolutionOptions = { ...DEFAULT_EVOLUTION_OPTIONS, ...options };
    const epochs = opts.epochs;
    const noProgressLimit = opts.noProgressLimit;
    const rollbackThreshold = opts.rollbackThreshold;
    const dryRun = opts.dryRun;

    this.startTime = performance.now();

    // Attempt resume from checkpoint
    const resumed = loadLatestCheckpoint(this.sessionId);
    if (resumed?.state) {
      const s = resumed.state as Record<string, unknown>;
      if (s.bestParams) {
        this.bestParams = { ...DEFAULT_EVOLVABLE_PARAMS, ...(s.bestParams as Partial<EvolvableParams>) };
      }
      if (typeof s.bestFitness === 'number') this.bestFitness = s.bestFitness;
      if (typeof s.bestVgdo === 'number') this.bestVgdo = s.bestVgdo;
      if (Array.isArray(s.history)) {
        this.history = s.history as EpochRecord[];
      }
      if (typeof s.improvements === 'number') this.improvements = s.improvements;
      if (typeof s.regressions === 'number') this.regressions = s.regressions;
      if (typeof s.epochsNoProgress === 'number') this.epochsNoProgress = s.epochsNoProgress;
    }

    for (let epoch = this.history.length + 1; epoch <= epochs; epoch++) {
      // ---- 1. DNA mutation via 6-protocol engine ----
      const vectors = [{ id: `vec_${epoch}`, timestamp: performance.now() / 1000, sourcePods: [0, 1] }];
      const mutatedDNAs = this.engine.mutate(vectors);

      // ---- 2. Parameter mutation (hill-climbing candidate) ----
      const candidate = mutateParams(this.bestParams, 0.1 / (1 + epoch * 0.001));
      const candidateFitness = evaluateParams(candidate);

      // ---- 3. Compute VGDO from mutation results ----
      let omega = OMEGA_FLOOR;
      let vgdoResult: VGDOResult;
      let grade: FitnessGrade;

      if (mutatedDNAs.length > 0) {
        const dna = mutatedDNAs[0];
        omega = dna.safetyMetrics.omega;
        vgdoResult = scoreVGDO(omega, candidateFitness, 0.85, 0.9);
        grade = vgdoResult.grade;

        // PID-governed correction
        const error = this.pidTarget - vgdoResult.vgdo;
        this.pidIntegral = Math.max(-5, Math.min(5, this.pidIntegral + error));
        const derivative = error - this.pidPrevError;
        const _pidOutput = this.pidKp * error + this.pidKi * this.pidIntegral + this.pidKd * derivative;
        this.pidPrevError = error;
      } else {
        vgdoResult = scoreVGDO(omega, candidateFitness, 0.85, 0.9);
        grade = vgdoResult.grade;
      }

      // ---- 4. Route inference through OutputMaximizer cache ----
      if (!dryRun) {
        await this.cacheInference(candidate, epoch, vgdoResult, mutatedDNAs);
      }

      // ---- 5. Hill climbing: accept improvement, discard regression ----
      const delta = candidateFitness - this.bestFitness;
      const improved = delta > 0;

      if (improved) {
        this.bestParams = candidate;
        this.bestFitness = candidateFitness;
        this.improvements++;
        this.epochsNoProgress = 0;
      } else {
        this.regressions++;
        this.epochsNoProgress++;
        if (candidateFitness < this.bestFitness * (1 - rollbackThreshold)) {
          this.rollbackCount++;
        }
      }

      this.bestVgdo = Math.max(this.bestVgdo, vgdoResult.vgdo);

      // ---- 6. Record epoch ----
      const record: EpochRecord = {
        epoch,
        vgdo: +(vgdoResult.vgdo.toFixed(6)),
        delta: +(delta.toFixed(6)),
        fitness: +(candidateFitness.toFixed(6)),
        grade,
        omega,
        improved,
        params: { ...this.bestParams },
      };
      this.history.push(record);

      // ---- 7. Checkpoint state ----
      if (!dryRun) {
        saveCheckpoint(this.sessionId, epoch, [], record, {
          bestParams: this.bestParams,
          bestFitness: this.bestFitness,
          bestVgdo: this.bestVgdo,
          history: this.history,
          improvements: this.improvements,
          regressions: this.regressions,
          epochsNoProgress: this.epochsNoProgress,
        }, 'run_evolution');
      }

      // ---- 8. Council of Worlds every 100 epochs ----
      if (epoch % 100 === 0) {
        this.onCouncil(epoch, vgdoResult);
      }

      // ---- 9. Federation sync every 50 epochs ----
      if (epoch % 50 === 0) {
        this.onFedSync(epoch, vgdoResult);
      }

      // ---- 10. Callback ----
      if (callback) {
        try {
          const result = callback(epoch, vgdoResult.vgdo, grade, improved);
          if (result instanceof Promise) await result;
        } catch {
          // Callback errors are non-fatal
        }
      }

      // ---- 11. Yield control periodically ----
      if (epoch % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }

      // ---- 12. Early halt check ----
      if (this.epochsNoProgress >= noProgressLimit) {
        this.haltedEarly = true;
        this.haltEpoch = epoch;
        break;
      }
    }

    const elapsedMs = performance.now() - this.startTime;
    const elapsedSeconds = +(elapsedMs / 1000).toFixed(2);

    const final = this.history[this.history.length - 1];
    const avgVgdo = this.history.length > 0
      ? this.history.reduce((s, h) => s + h.vgdo, 0) / this.history.length
      : 0;

    return {
      epochs: this.history.length,
      elapsedSeconds,
      avgVgdo: +(avgVgdo.toFixed(4)),
      bestVgdo: +(this.bestVgdo.toFixed(4)),
      finalVgdo: final?.vgdo ?? 0,
      finalGrade: final?.grade ?? 'F',
      improvements: this.improvements,
      regressions: this.regressions,
      improvementRate: `${((this.improvements / Math.max(this.history.length, 1)) * 100).toFixed(1)}%`,
      bestParams: { ...this.bestParams },
      historyLength: this.history.length,
      haltedEarly: this.haltedEarly,
      haltEpoch: this.haltEpoch,
      rollbackCount: this.rollbackCount,
      history: this.history,
    };
  }

  // -----------------------------------------------------------------------
  // OutputMaximizer Integration
  // -----------------------------------------------------------------------

  /** Cache inference results through the OutputMaximizer pipeline */
  private async cacheInference(
    params: EvolvableParams,
    epoch: number,
    vgdo: VGDOResult,
    mutatedDNAs: MutatedDNA[],
  ): Promise<void> {
    // Build a synthetic prompt representing this epoch's state
    const dnaSeq = mutatedDNAs.length > 0 ? mutatedDNAs[0].mutatedSequence.slice(0, 32) : 'none';
    const prompt = [
      `[nano:epoch:${epoch}]`,
      `vgdo=${vgdo.vgdo.toFixed(4)} grade=${vgdo.grade}`,
      `temp=${params.temperature.toFixed(3)}`,
      `tools=${params.maxToolLoops}`,
      `dna=${dnaSeq}`,
    ].join(' ');

    const request: InferenceRequest = {
      model: 'nano-evolution',
      prompt,
      options: {
        temperature: params.temperature,
        topP: 0.9,
        maxTokens: 64,
      },
      meta: {
        epoch,
        vgdo: vgdo.vgdo,
        grade: vgdo.grade,
        omega: vgdo.omega,
        params: params as unknown as Record<string, unknown>,
      },
    };

    try {
      const response = await this.maximizer.infer(request);
      // The response result is cached by OutputMaximizer automatically.
      // We store nothing extra — this is purely for cache population.
      void response;
    } catch {
      // Inference failures are non-fatal during evolution
    }
  }

  // -----------------------------------------------------------------------
  // Hooks: Council of Worlds + Federation Sync
  // -----------------------------------------------------------------------

  /** Called every 100 epochs — integrates with Council of Worlds */
  private onCouncil(epoch: number, vgdo: VGDOResult): void {
    // In the Python source this spawns a council.run().
    // In TypeScript, we emit a structured event that OutputMaximizer can consume.
    // The council would be a separate module / agent.
    // For now we record it in the checkpoint state for observability.
    saveCheckpoint(
      this.sessionId,
      epoch,
      [{ role: 'system', content: `Council of Worlds @ epoch ${epoch}` }],
      { vgdo: vgdo.vgdo, grade: vgdo.grade, omega: vgdo.omega },
      { councilEpoch: epoch },
      'council_of_worlds',
    );
  }

  /** Called every 50 epochs — Federation sync broadcast */
  private onFedSync(epoch: number, vgdo: VGDOResult): void {
    // In the Python source this calls FEDERATION.broadcast().
    // In TypeScript, we hydrate FedSyncPatterns into the maximizer cache.
    const dnaVector = dnaToVector(dnaFromConfig(this.bestParams as unknown as Record<string, unknown>));

    // Hydrate a pattern into the OutputMaximizer's semantic cache via FedSyncReceiver
    // This is equivalent to the Python FEDERATION.broadcast() pattern sharing
    this.maximizer.hydratePatterns([{
      id: `${this.sessionId}-epoch-${epoch}`,
      domain: epoch,
      patternType: 'nano-evolution',
      vector: [...dnaVector],
      omegaScore: vgdo.omega,
      createdAt: Date.now() / 1000,
    }]);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  get best(): { params: EvolvableParams; fitness: number; vgdo: number } {
    return { params: { ...this.bestParams }, fitness: this.bestFitness, vgdo: this.bestVgdo };
  }

  get currentOmega(): number {
    return this.maximizer.omega;
  }

  get trackingSummary() {
    return this.engine.getTrackingSummary();
  }

  /** Format evolution progress as a compact table (matching Python format_evolution_progress) */
  static formatProgress(history: EpochRecord[]): string {
    if (history.length === 0) return 'No evolution history.';

    const lines: string[] = [];
    lines.push('┌────────┬────────┬───────┬──────────┬─────────┐');
    lines.push('│ Epoch  │ V_GDO  │ Grade │ Δ Fitness│ Improved│');
    lines.push('├────────┼────────┼───────┼──────────┼─────────┤');

    for (const entry of history) {
      if (entry.epoch % 100 === 0 || entry === history[history.length - 1]) {
        const deltaStr = entry.delta >= 0 ? `+${entry.delta.toFixed(4)}` : entry.delta.toFixed(4);
        const improvedMarker = entry.improved ? '  ✓  ' : '  ✗  ';
        lines.push(
          `│ ${String(entry.epoch).padStart(6)} │ ${entry.vgdo.toFixed(4)} │   ${entry.grade}   │ ${String(deltaStr).padStart(8)} │ ${improvedMarker}   │`,
        );
      }
    }
    lines.push('└────────┴────────┴───────┴──────────┴─────────┘');
    return lines.join('\n');
  }

  /** Resume from the most recent session checkpoint */
  static resumeLatest(maximizer: OutputMaximizer): NanoAgent | null {
    const sessions = listSessions();
    if (sessions.length === 0) return null;
    const latest = sessions[0];
    const cp = loadLatestCheckpoint(latest.sessionId);
    if (!cp) return null;

    const agent = new NanoAgent(maximizer, latest.sessionId, cp.state?.bestParams as Partial<EvolvableParams> | undefined);

    // Restore state
    if (cp.state) {
      const s = cp.state;
      if (typeof s.bestFitness === 'number') agent.bestFitness = s.bestFitness;
      if (typeof s.bestVgdo === 'number') agent.bestVgdo = s.bestVgdo;
      if (Array.isArray(s.history)) agent.history = s.history as EpochRecord[];
      if (typeof s.improvements === 'number') agent.improvements = s.improvements;
      if (typeof s.regressions === 'number') agent.regressions = s.regressions;
      if (typeof s.epochsNoProgress === 'number') agent.epochsNoProgress = s.epochsNoProgress;
    }

    return agent;
  }
}
