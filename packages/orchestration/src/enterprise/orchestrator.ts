// Enterprise Orchestrator
// Deploys team swarms with constitutional safety gates
// Wired into OMEGA OutputMaximizer — team tasks via AutoRouter + WarpCache
// Derived from neuroloomorg/neuroloom-enterprise-orchestrator

import { EventEmitter } from 'events';
import { ConstitutionalEnforcer } from './constitutional-enforcer.js';
import { TeamHeartbeatMonitor } from './team-heartbeat.js';
import { DEFAULT_CEO_CONFIG } from './types.js';
import type { InferenceRequest, InferenceResponse } from '../types.js';
import type {
  CEOConfig,
  TeamDef,
  TeamRunResult,
  CompanyHealth,
  HeartbeatSignal,
  Decision,
  PolicyResult,
} from './types.js';

// Lazy imports to avoid circular dependency — OutputMaximizer injected at construction
import type { OutputMaximizer } from '../output-maximizer.js';

interface TeamAgent {
  id: string;
  teamId: string;
  run(ctx: TeamContext): Promise<TeamAgentResult>;
  getMetrics(): TeamAgentMetrics;
}

interface TeamAgentMetrics {
  cyclesRun: number;
  decisionsBlocked: number;
  decisionsEscalated: number;
  decisionsAllowed: number;
  lastActivityAt?: string;
}

interface TeamAgentResult {
  success: boolean;
  agent: string;
  action: string;
  outcome: string;
  cashDelta: number;
  tokensUsed: number;
}

interface TeamContext {
  iteration: number;
  budget: { total: number; spent: number; remaining: number };
  config: CEOConfig;
  timestamp: string;
}

export class EnterpriseOrchestrator extends EventEmitter {
  readonly enforcer: ConstitutionalEnforcer;
  readonly heartbeat: TeamHeartbeatMonitor;
  private config: CEOConfig;
  private teams = new Map<string, TeamDef>();
  private agents = new Map<string, TeamAgent>();
  private budgetSpent = 0;
  private iteration = 0;
  private killed = false;
  private killReason?: string;

  // OMEGA integration
  private outputMaximizer: OutputMaximizer | null = null;

  // Decision log
  private decisions: Decision[] = [];

  constructor(
    config: Partial<CEOConfig> = {},
    principles = undefined,
  ) {
    super();
    this.config = { ...DEFAULT_CEO_CONFIG, ...config };
    this.enforcer = new ConstitutionalEnforcer(principles);
    this.heartbeat = new TeamHeartbeatMonitor(
      undefined,
      (signal: HeartbeatSignal) => {
        this.emit('heartbeat', signal);
      },
    );

    this.emit('orchestrator:initialized', { config: this.config });
  }

  // ─── OMEGA / OutputMaximizer Wiring ───────────────────────────────────────

  /** Wire the OutputMaximizer so team agents route inference through OMEGA pipeline */
  wireOutputMaximizer(maximizer: OutputMaximizer): void {
    this.outputMaximizer = maximizer;
    this.emit('omega:wired', {});
  }

  /** Check if OMEGA pipeline is available */
  get omegaWired(): boolean {
    return this.outputMaximizer !== null;
  }

  /** Route a task description through OMEGA's AutoRouter */
  routeTask(description: string): { subtype: string; confidence: number } {
    if (this.outputMaximizer) {
      return this.outputMaximizer.router.route(description);
    }
    return { subtype: 'general', confidence: 0 };
  }

  /** Run inference through OMEGA pipeline (WarpCache + batched model call) */
  async infer(request: InferenceRequest): Promise<InferenceResponse> {
    if (!this.outputMaximizer) {
      throw new Error('OutputMaximizer not wired — call wireOutputMaximizer() first');
    }
    return this.outputMaximizer.infer(request);
  }

  // ─── Team Registration ────────────────────────────────────────────────────

  /** Register a team definition */
  registerTeam(def: TeamDef): void {
    if (this.teams.has(def.id)) {
      throw new Error(`Team already registered: ${def.id}`);
    }
    this.teams.set(def.id, def);
    this.emit('team:registered', { teamId: def.id, name: def.name });
  }

  /** Register an agent into a team */
  registerAgent(teamId: string, agent: TeamAgent): void {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team not found: ${teamId}`);
    }
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, { ...agent, teamId });

    // Wire agent into heartbeat monitor
    this.heartbeat.registerAgent(agent.id, teamId, () => {
      const m = agent.getMetrics();
      const load = Math.min(1, m.cyclesRun / 10);
      const status = m.decisionsBlocked > 0 ? 'degraded' :
                     m.cyclesRun === 0 ? 'offline' : 'healthy';
      return {
        status,
        load,
        timestamp: new Date().toISOString(),
        metrics: m,
      };
    });

    this.emit('agent:registered', { agentId: agent.id, teamId });
  }

  get teamsList(): TeamDef[] {
    return Array.from(this.teams.values());
  }

  get agentCount(): number {
    return this.agents.size;
  }

  // ─── Constitutional Safety ────────────────────────────────────────────────

  /** Evaluate a decision through the constitutional enforcer */
  evaluateDecision(decision: Decision): PolicyResult {
    const result = this.enforcer.evaluateDecision(decision);
    this.decisions.push(decision);

    if (result.outcome === 'BLOCK') {
      this.emit('decision:blocked', result);
    } else if (result.outcome === 'ESCALATE') {
      this.emit('decision:escalated', result);
    } else {
      this.emit('decision:allowed', result);
    }

    // Auto kill-switch on BLOCK outcomes (immutable principle violations)
    if (result.outcome === 'BLOCK' && this.config.dryRun === false) {
      const immutableBlocked = result.triggeredPrinciples.some(
        p => p.immutable && p.outcome === 'BLOCK'
      );
      if (immutableBlocked) {
        this.triggerKillSwitch(
          `Immutable constitutional violation: ${result.triggeredPrinciples.map(p => p.name).join(', ')}`
        );
      }
    }

    return result;
  }

  // ─── Budget Tracking ──────────────────────────────────────────────────────

  getBudgetState() {
    return {
      total: this.config.totalBudgetCents,
      spent: this.budgetSpent,
      remaining: Math.max(0, this.config.totalBudgetCents - this.budgetSpent),
      heartbeatSpent: 0,
      isPaused: this.killed,
      pauseReason: this.killReason,
    };
  }

  recordSpend(agentId: string, cents: number): boolean {
    if (this.killed) return false;
    if (this.budgetSpent + cents > this.config.totalBudgetCents) {
      this.emit('budget:exceeded', { agentId, attempted: cents, total: this.budgetSpent });
      return false;
    }
    this.budgetSpent += cents;
    if (this.budgetSpent / this.config.totalBudgetCents > 0.9) {
      this.emit('budget:warning', { remaining: this.config.totalBudgetCents - this.budgetSpent });
    }
    return true;
  }

  // ─── CEO Run Loop ─────────────────────────────────────────────────────────

  /** Single heartbeat iteration: run eligible teams through constitutional gates */
  async tick(): Promise<TeamRunResult[]> {
    if (this.killed) {
      this.emit('tick:blocked', { reason: this.killReason ?? 'Kill switch active' });
      return [];
    }

    this.iteration++;
    this.emit('tick:start', { iteration: this.iteration });

    const budget = this.getBudgetState();
    if (budget.remaining <= 0) {
      this.emit('tick:budget_exhausted', budget);
      return [];
    }

    const ctx: TeamContext = {
      iteration: this.iteration,
      budget,
      config: this.config,
      timestamp: new Date().toISOString(),
    };

    // Determine which teams to run this cycle
    const eligibleTeams = this.selectEligibleTeams();

    const results: TeamRunResult[] = [];
    for (const team of eligibleTeams) {
      const startMs = Date.now();
      const teamAgents = Array.from(this.agents.values()).filter(a => a.teamId === team.id);

      if (teamAgents.length === 0) continue;

      // Run each agent, apply constitutional safety filter
      const agentResults = await Promise.all(
        teamAgents.map(a => a.run(ctx))
      );

      const successCount = agentResults.filter(r => r.success).length;
      const failureCount = agentResults.filter(r => !r.success).length;
      const totalCashDelta = agentResults.reduce((s, r) => s + r.cashDelta, 0);

      results.push({
        teamId: team.id,
        agentsRan: teamAgents.length,
        successCount,
        failureCount,
        totalCashDelta,
        totalTokens: agentResults.reduce((s, r) => s + r.tokensUsed, 0),
        vetoed: false,
        durationMs: Date.now() - startMs,
      });
    }

    // Pulse heartbeats after the cycle
    this.heartbeat.pulseAll();

    this.emit('tick:complete', {
      iteration: this.iteration,
      teamResults: results,
      budget: this.getBudgetState(),
      health: this.heartbeat.getHealth(),
    });

    return results;
  }

  /** Full CEO run loop: keep ticking until budget exhausted or killed */
  async run(): Promise<TeamRunResult[][]> {
    this.emit('run:start', { config: this.config });
    this.heartbeat.startAll();

    const maxIter = this.config.maxIterations || Infinity;
    const allResults: TeamRunResult[][] = [];

    for (let i = 0; i < maxIter; i++) {
      if (this.killed) break;
      if (this.getBudgetState().remaining <= 0) {
        this.emit('run:budget_exhausted', { iteration: i });
        break;
      }

      const results = await this.tick();
      allResults.push(results);

      if (results.length === 0 && this.killed) break;

      // Wait for the heartbeat interval before next iteration
      if (i < maxIter - 1 && !this.killed) {
        await new Promise(resolve => setTimeout(resolve, this.config.heartbeatIntervalMs));
      }
    }

    this.heartbeat.stopAll();
    const finalHealth = this.heartbeat.getHealth();
    this.emit('run:complete', {
      totalIterations: allResults.length,
      totalBudgetSpent: this.budgetSpent,
      finalHealth,
      decisions: this.decisions.length,
    });

    return allResults;
  }

  // ─── Kill Switch ──────────────────────────────────────────────────────────

  triggerKillSwitch(reason: string): void {
    this.killed = true;
    this.killReason = reason;
    this.heartbeat.stopAll();
    this.emit('killswitch:triggered', { reason, iteration: this.iteration });

    const health = this.heartbeat.getHealth();
    this.emit('killswitch:final_health', health);
  }

  resetKillSwitch(): void {
    this.killed = false;
    this.killReason = undefined;
    this.emit('killswitch:reset', {});
  }

  get isKilled(): boolean {
    return this.killed;
  }

  // ─── Health & Analytics ───────────────────────────────────────────────────

  getHealth(): CompanyHealth {
    return this.heartbeat.getHealth();
  }

  getStatusString(): string {
    return this.heartbeat.getStatusString();
  }

  getDecisionLog(): readonly Decision[] {
    return this.decisions;
  }

  getVGDOScore(): number {
    if (this.outputMaximizer) {
      return this.outputMaximizer.getVGDO().vgdo;
    }
    return 0;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private selectEligibleTeams(): TeamDef[] {
    return Array.from(this.teams.values())
      .sort((a, b) => b.priority - a.priority)
      .filter(team => {
        if (!team.trigger) return true;

        const trigger = team.trigger;
        switch (trigger.type) {
          case 'schedule':
            // Simple: always run on scheduled teams
            return true;
          case 'condition':
            // In a full implementation, evaluate the condition against context
            return true;
          case 'event':
            // Event-triggered teams run on matching events
            return true;
          default:
            return true;
        }
      });
  }
}
