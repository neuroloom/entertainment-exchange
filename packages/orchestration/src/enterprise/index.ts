// Enterprise Orchestration — OMEGA-integrated CEO run loop with constitutional safety
// Derived from neuroloomorg/neuroloom-enterprise-orchestrator
// Wire into OMEGA OutputMaximizer, AutoRouter, WarpCache, and MetricsCollector

// ─── Core Orchestrator ──────────────────────────────────────────────────────
export { EnterpriseOrchestrator } from './orchestrator.js';

// ─── Constitutional Safety ──────────────────────────────────────────────────
export { ConstitutionalEnforcer } from './constitutional-enforcer.js';

// ─── Team Heartbeat ─────────────────────────────────────────────────────────
export { TeamHeartbeatMonitor, HeartbeatEmitter, HealthAggregator } from './team-heartbeat.js';

// ─── All Types ──────────────────────────────────────────────────────────────
export type {
  // CEO / Config
  CEOConfig,
  // Team definitions
  TeamDef,
  TeamTrigger,
  TeamRunResult,
  // Heartbeat
  HeartbeatConfig,
  HeartbeatSignal,
  CompanyHealth,
  AgentStatus,
  // Constitution
  ConstitutionalPrinciple,
  CompanyAction,
  ValidationResult,
  Decision,
  PolicyResult,
  PolicyOutcome,
  // Budget
  BudgetConfig,
  BudgetState,
  BudgetViolation,
  // Governance
  KillSwitchConfig,
} from './types.js';

export {
  DEFAULT_CEO_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_PRINCIPLES,
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_KILL_SWITCH_CONFIG,
} from './types.js';
