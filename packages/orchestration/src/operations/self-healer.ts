// SelfHealer — Autonomous agent recovery, health scoring, and circuit breaker
// Moat 4: 3-year competitive advantage through self-healing infrastructure

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface AgentHealth {
  agentId: string;
  score: number; // 0-100
  status: 'healthy' | 'degraded' | 'critical' | 'paused';
  recentRuns: number;
  recentFailures: number;
  avgLatencyMs: number;
  circuitBreakerTripped: boolean;
  lastRecoveryAt?: number;
}

export interface RecoveryAction {
  actionId: string;
  agentId: string;
  runId: string;
  action: 'retry' | 'pause' | 'resume' | 'alert';
  reason: string;
  attempt: number;
  timestamp: number;
}

export interface AgentRunRecord {
  runId: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  updatedAt: number;
  latencyMs?: number;
  costCents?: number;
  error?: string;
}

export interface CircuitBreakerState {
  tripped: boolean;
  failures: number;
  resetsAt?: number;
}

interface AgentState {
  runs: AgentRunRecord[];
  health: AgentHealth;
  breaker: CircuitBreakerState;
  consecutiveFailures: number;
  recoveryLog: RecoveryAction[];
  history: Array<{ timestamp: number; success: boolean; latencyMs: number; costCents: number }>;
  budgetCents: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes without update
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000]; // seconds
const CIRCUIT_BREAKER_THRESHOLD = 3; // consecutive failures
const CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 minutes before reset
const HEALTH_WINDOW_SIZE = 20; // recent runs for health calc
const DEGRADED_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 40;

let _actionCounter = 0;
function nextActionId(): string {
  _actionCounter++;
  return `recovery_${Date.now()}_${_actionCounter}`;
}

// ─── In-Memory Store ────────────────────────────────────────────────────────────

class MemoryStore<T> {
  private store = new Map<string, T>();
  get(key: string): T | undefined { return this.store.get(key); }
  set(key: string, value: T): void { this.store.set(key, value); }
  delete(key: string): boolean { return this.store.delete(key); }
  has(key: string): boolean { return this.store.has(key); }
  entries(): IterableIterator<[string, T]> { return this.store.entries(); }
  clear(): void { this.store.clear(); }
  get size(): number { return this.store.size; }
}

// ─── Utility ────────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ─── SelfHealer ─────────────────────────────────────────────────────────────────

export class SelfHealer {
  private agents = new MemoryStore<AgentState>();
  private auditLog: RecoveryAction[] = [];

  // ─── Run Lifecycle ────────────────────────────────────────────────────────

  /** Register a new run start. Called when an agent begins a run. */
  startRun(agentId: string, runId: string, budgetCents: number = 0): void {
    const state = this.ensureAgent(agentId);
    const now = Date.now();

    // If circuit breaker is tripped, reject new runs
    if (state.breaker.tripped) {
      // Check if it's time to reset
      if (state.breaker.resetsAt && now >= state.breaker.resetsAt) {
        this.resetBreaker(state, agentId);
      } else {
        throw AppError.invalid(
          `Agent ${agentId} is paused by circuit breaker. Resets at ${state.breaker.resetsAt ? new Date(state.breaker.resetsAt).toISOString() : 'N/A'}`,
        );
      }
    }

    state.runs.push({
      runId,
      agentId,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      costCents: 0,
    });
    state.budgetCents = budgetCents || state.budgetCents;
  }

  /** Mark a run as completed successfully. */
  completeRun(runId: string, latencyMs: number = 0, costCents: number = 0): void {
    const state = this.findStateByRun(runId);
    if (!state) throw AppError.notFound(`Run ${runId}`);

    const run = state.runs.find(r => r.runId === runId);
    if (!run) throw AppError.notFound(`Run ${runId}`);

    run.status = 'completed';
    run.updatedAt = Date.now();
    run.latencyMs = latencyMs;
    run.costCents = costCents;

    state.consecutiveFailures = 0;
    state.history.push({ timestamp: Date.now(), success: true, latencyMs, costCents });
    this.pruneHistory(state);
    this.recomputeHealth(agentIdFromRun(runId, state));
  }

  /** Mark a run as failed. Triggers recovery logic. */
  failRun(runId: string, error: string, latencyMs: number = 0, costCents: number = 0): RecoveryAction | null {
    const state = this.findStateByRun(runId);
    if (!state) throw AppError.notFound(`Run ${runId}`);

    const run = state.runs.find(r => r.runId === runId);
    if (!run) throw AppError.notFound(`Run ${runId}`);

    run.status = 'failed';
    run.updatedAt = Date.now();
    run.latencyMs = latencyMs;
    run.costCents = costCents;
    run.error = error;

    state.history.push({ timestamp: Date.now(), success: false, latencyMs, costCents });
    this.pruneHistory(state);
    state.consecutiveFailures++;

    // Check circuit breaker
    if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      return this.tripBreaker(state, run.agentId, runId);
    }

    // Attempt retry with backoff
    const attempt = state.consecutiveFailures;
    const action: RecoveryAction = {
      actionId: nextActionId(),
      agentId: run.agentId,
      runId,
      action: 'retry',
      reason: `Run ${runId} failed: ${error}. Retry attempt ${attempt}.`,
      attempt,
      timestamp: Date.now(),
    };

    state.recoveryLog.push(action);
    this.auditLog.push(action);
    this.recomputeHealth(run.agentId);
    return action;
  }

  // ─── Stuck Run Detection ──────────────────────────────────────────────────

  /** Detect runs that haven't been updated within the stuck timeout. */
  detectStuckRuns(): Array<{ agentId: string; runId: string; stuckForMs: number }> {
    const stuck: Array<{ agentId: string; runId: string; stuckForMs: number }> = [];
    const now = Date.now();

    for (const [, state] of this.agents.entries()) {
      for (const run of state.runs) {
        if (run.status !== 'running') continue;
        const stuckFor = now - run.updatedAt;
        if (stuckFor > STUCK_TIMEOUT_MS) {
          stuck.push({ agentId: run.agentId, runId: run.runId, stuckForMs: stuckFor });
        }
      }
    }

    return stuck;
  }

  /** Recover a stuck run — mark as failed, then apply retry logic. */
  recoverStuckRun(runId: string): RecoveryAction {
    const stuck = this.detectStuckRuns();
    const match = stuck.find(s => s.runId === runId);
    if (!match) throw AppError.invalid(`Run ${runId} is not stuck or not found`);

    return this.failRun(runId, `Run stuck for ${match.stuckForMs}ms without update`)!;
  }

  // ─── Explicit Run Recovery ────────────────────────────────────────────────

  /** Recover a failed run with retry backoff. Public entry point. */
  recoverRun(runId: string): RecoveryAction {
    const state = this.findStateByRun(runId);
    if (!state) throw AppError.notFound(`Run ${runId}`);

    const run = state.runs.find(r => r.runId === runId);
    if (!run) throw AppError.notFound(`Run ${runId}`);
    if (run.status !== 'failed') {
      throw AppError.invalid(`Run ${runId} is not in failed state (current: ${run.status})`);
    }

    const attempt = state.consecutiveFailures + 1;
    const backoffMs = BACKOFF_SCHEDULE_MS[Math.min(attempt - 1, BACKOFF_SCHEDULE_MS.length - 1)];

    const action: RecoveryAction = {
      actionId: nextActionId(),
      agentId: run.agentId,
      runId,
      action: 'retry',
      reason: `Manual retry for run ${runId}. Backoff: ${backoffMs}ms. Attempt ${attempt}.`,
      attempt,
      timestamp: Date.now(),
    };

    state.recoveryLog.push(action);
    this.auditLog.push(action);
    return action;
  }

  // ─── Health Scoring ───────────────────────────────────────────────────────

  /** Compute per-agent health score 0-100. */
  checkAgentHealth(agentId: string): AgentHealth {
    const state = this.agents.get(agentId);
    if (!state) {
      return {
        agentId,
        score: 100,
        status: 'healthy',
        recentRuns: 0,
        recentFailures: 0,
        avgLatencyMs: 0,
        circuitBreakerTripped: false,
      };
    }
    return { ...state.health };
  }

  /** Return health for all agents. */
  getAllAgentHealth(): AgentHealth[] {
    return [...this.agents.entries()].map(([, s]) => ({ ...s.health }));
  }

  /** Circuit breaker status for a specific agent. */
  circuitBreakerStatus(agentId: string): CircuitBreakerState {
    const state = this.agents.get(agentId);
    if (!state) return { tripped: false, failures: 0 };
    return { ...state.breaker };
  }

  /** Return the full recovery audit trail. */
  getAuditLog(): ReadonlyArray<RecoveryAction> {
    return this.auditLog;
  }

  /** Explicitly resume a paused agent. */
  resumeAgent(agentId: string): RecoveryAction {
    const state = this.agents.get(agentId);
    if (!state) throw AppError.notFound(`Agent ${agentId}`);

    state.breaker.tripped = false;
    state.breaker.failures = 0;
    state.breaker.resetsAt = undefined;
    state.consecutiveFailures = 0;
    state.health.status = 'healthy';
    state.health.circuitBreakerTripped = false;

    const action: RecoveryAction = {
      actionId: nextActionId(),
      agentId,
      runId: '', // no specific run for resume
      action: 'resume',
      reason: `Agent ${agentId} manually resumed.`,
      attempt: 0,
      timestamp: Date.now(),
    };

    state.recoveryLog.push(action);
    this.auditLog.push(action);
    this.recomputeHealth(agentId);
    return action;
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  private ensureAgent(agentId: string): AgentState {
    let state = this.agents.get(agentId);
    if (!state) {
      state = this.freshState(agentId);
      this.agents.set(agentId, state);
    }
    return state;
  }

  private freshState(agentId: string): AgentState {
    return {
      runs: [],
      health: {
        agentId,
        score: 100,
        status: 'healthy',
        recentRuns: 0,
        recentFailures: 0,
        avgLatencyMs: 0,
        circuitBreakerTripped: false,
      },
      breaker: { tripped: false, failures: 0 },
      consecutiveFailures: 0,
      recoveryLog: [],
      history: [],
      budgetCents: 0,
    };
  }

  private findStateByRun(runId: string): AgentState | undefined {
    for (const [, state] of this.agents.entries()) {
      if (state.runs.some(r => r.runId === runId)) return state;
    }
    return undefined;
  }

  private recomputeHealth(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const recent = state.history.slice(-HEALTH_WINDOW_SIZE);
    const total = recent.length;

    // 50% weight: recent success rate
    const successes = recent.filter(h => h.success).length;
    const successRate = total > 0 ? successes / total : 1;

    // 25% weight: latency vs average (penalize above, reward below)
    const avgLatency = mean(recent.filter(h => h.success).map(h => h.latencyMs));
    // Normalize: 0ms → 1.0, 2x historical avg → 0.5. Historical floor is 100ms.
    const historicalAvg = mean(
      state.history.filter(h => h.success).map(h => h.latencyMs),
    ) || 100;
    const latencyRatio = historicalAvg > 0 ? clamp(avgLatency / historicalAvg, 0, 3) : 1;
    const latencyScore = latencyRatio <= 1 ? 1 : clamp(2 - latencyRatio, 0, 1);

    // 25% weight: cost per run vs budget
    const avgCost = mean(recent.filter(h => h.success).map(h => h.costCents));
    const budgetScore = state.budgetCents > 0
      ? clamp(1 - (avgCost / state.budgetCents), 0, 1)
      : 1;

    const score = Math.round(clamp(
      successRate * 50 + latencyScore * 25 + budgetScore * 25,
      0,
      100,
    ));

    let status: AgentHealth['status'] = 'healthy';
    if (state.breaker.tripped) {
      status = 'paused';
    } else if (score < CRITICAL_THRESHOLD) {
      status = 'critical';
    } else if (score < DEGRADED_THRESHOLD) {
      status = 'degraded';
    }

    state.health = {
      agentId,
      score,
      status,
      recentRuns: total,
      recentFailures: total - successes,
      avgLatencyMs: Math.round(avgLatency * 1000) / 1000,
      circuitBreakerTripped: state.breaker.tripped,
      lastRecoveryAt: state.recoveryLog.length > 0
        ? state.recoveryLog[state.recoveryLog.length - 1].timestamp
        : undefined,
    };
  }

  private tripBreaker(state: AgentState, agentId: string, runId: string): RecoveryAction {
    state.breaker.tripped = true;
    state.breaker.failures = state.consecutiveFailures;
    state.breaker.resetsAt = Date.now() + CIRCUIT_RESET_MS;

    const action: RecoveryAction = {
      actionId: nextActionId(),
      agentId,
      runId,
      action: 'pause',
      reason: `Circuit breaker tripped after ${state.consecutiveFailures} consecutive failures.`,
      attempt: state.consecutiveFailures,
      timestamp: Date.now(),
    };
    state.recoveryLog.push(action);
    this.auditLog.push(action);

    // Also produce alert action
    const alert: RecoveryAction = {
      actionId: nextActionId(),
      agentId,
      runId,
      action: 'alert',
      reason: `ALERT: Agent ${agentId} has been paused. ${state.consecutiveFailures} consecutive failures.`,
      attempt: state.consecutiveFailures,
      timestamp: Date.now(),
    };
    state.recoveryLog.push(alert);
    this.auditLog.push(alert);

    this.recomputeHealth(agentId);
    return action;
  }

  private resetBreaker(state: AgentState, agentId: string): void {
    state.breaker.tripped = false;
    state.breaker.failures = 0;
    state.breaker.resetsAt = undefined;
    state.consecutiveFailures = 0;
    state.health.status = 'healthy';
    state.health.circuitBreakerTripped = false;
    this.recomputeHealth(agentId);
  }

  private pruneHistory(state: AgentState): void {
    if (state.history.length > HEALTH_WINDOW_SIZE * 3) {
      state.history = state.history.slice(-HEALTH_WINDOW_SIZE * 2);
    }
  }
}

// ─── Helper ─────────────────────────────────────────────────────────────────────

function agentIdFromRun(runId: string, state: AgentState): string {
  const run = state.runs.find(r => r.runId === runId);
  return run?.agentId ?? 'unknown';
}
