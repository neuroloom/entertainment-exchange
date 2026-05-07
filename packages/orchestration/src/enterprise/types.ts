// Enterprise Orchestrator Types
// Derived from neuroloomorg/neuroloom-enterprise-orchestrator
// Integrated with OMEGA OutputMaximizer + AutoRouter + WarpCache

// ─── CEO / Orchestrator Config ──────────────────────────────────────────────

export interface CEOConfig {
  companyId: string;
  heartbeatIntervalMs: number;
  maxHeartbeatCostCents: number;
  totalBudgetCents: number;
  cashFloorCents: number;
  dryRun: boolean;
  maxIterations: number;
  auditLogPath?: string;
}

export const DEFAULT_CEO_CONFIG: CEOConfig = {
  companyId: 'enterprise-default',
  heartbeatIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
  maxHeartbeatCostCents: 500,
  totalBudgetCents: 100_000,
  cashFloorCents: 100,
  dryRun: false,
  maxIterations: 0, // unlimited
};

// ─── Team Definitions ───────────────────────────────────────────────────────

export interface TeamDef {
  id: string;
  name: string;
  description: string;
  agentSubtypes: string[];
  maxAgents: number;
  priority: number;  // higher = earlier in cycle
  trigger?: TeamTrigger;
}

export interface TeamTrigger {
  type: 'condition' | 'schedule' | 'event';
  condition?: string;       // e.g. "inventory.paperclips >= 10"
  cronExpression?: string;   // e.g. "0 */4 * * *"
  eventName?: string;        // e.g. "order:new"
}

export interface TeamRunResult {
  teamId: string;
  agentsRan: number;
  successCount: number;
  failureCount: number;
  totalCashDelta: number;
  totalTokens: number;
  vetoed: boolean;
  vetoReason?: string;
  durationMs: number;
}

// ─── Heartbeat Config ───────────────────────────────────────────────────────

export type AgentStatus = 'healthy' | 'degraded' | 'critical' | 'offline';

export interface HeartbeatConfig {
  intervalMs: number;
  timeoutMs: number;
  revivalEnabled: boolean;
  rebalanceEnabled: boolean;
  maxOfflineBeforeCritical: number;
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: 1000,
  timeoutMs: 30_000,
  revivalEnabled: true,
  rebalanceEnabled: true,
  maxOfflineBeforeCritical: 3,
};

export interface HeartbeatSignal {
  agentId: string;
  teamId: string;
  status: AgentStatus;
  load: number;         // 0-1
  timestamp: string;
  metrics: {
    cyclesRun: number;
    decisionsBlocked: number;
    decisionsEscalated: number;
    decisionsAllowed: number;
    lastActivityAt?: string;
  };
}

export interface CompanyHealth {
  score: number;         // 0-100
  timestamp: string;
  agentCount: number;
  healthyCount: number;
  degradedCount: number;
  criticalCount: number;
  offlineCount: number;
  signals: HeartbeatSignal[];
  summary: string;
}

// ─── Constitution Rules ─────────────────────────────────────────────────────

export type PolicyOutcome = 'ALLOW' | 'BLOCK' | 'ESCALATE';

export interface ConstitutionalPrinciple {
  id: string;
  name: string;
  description: string;
  outcome: PolicyOutcome;
  keywords: string[];
  riskWeight: number;   // 0-1
  immutable: boolean;
  priority: number;     // higher = checked first
}

export interface CompanyAction {
  id: string;
  type: string;
  description: string;
  requester: string;
  payload?: Record<string, unknown>;
}

export interface ValidationResult {
  approved: boolean;
  violations: Array<{
    principle: ConstitutionalPrinciple;
    severity: number;
  }>;
  harmScore: number;
  reasoning: string;
}

export interface Decision {
  id: string;
  agentId: string;
  action: string;
  reasoning: string;
  riskScore: number;    // 0-1
  estimatedCostCents: number;
  isIrreversible: boolean;
  affectedSystems: string[];
  timestamp: string;
}

export interface PolicyResult {
  decision: Decision;
  outcome: PolicyOutcome;
  triggeredPrinciples: ConstitutionalPrinciple[];
  reasoning: string;
  requiresHumanApproval: boolean;
}

// ─── Default Constitutional Principles ──────────────────────────────────────

export const DEFAULT_PRINCIPLES: ConstitutionalPrinciple[] = [
  {
    id: 'honesty',
    name: 'Honesty & Transparency',
    description: 'Agents must not deceive, fabricate, or misrepresent information.',
    outcome: 'BLOCK',
    keywords: ['lie', 'fabricate', 'deceive', 'fake', 'forge', 'hallucinate', 'mislead'],
    riskWeight: 1.0,
    immutable: true,
    priority: 100,
  },
  {
    id: 'harm-prevention',
    name: 'Harm Prevention',
    description: 'Agents must not perform actions that harm humans or critical systems.',
    outcome: 'BLOCK',
    keywords: ['delete all', 'rm -rf', 'drop database', 'shutdown', 'kill process', 'harm', 'attack', 'destroy', 'wipe'],
    riskWeight: 1.0,
    immutable: true,
    priority: 100,
  },
  {
    id: 'human-oversight',
    name: 'Human Oversight',
    description: 'High-stakes irreversible actions must be escalated to a human.',
    outcome: 'ESCALATE',
    keywords: ['deploy to production', 'send email to all', 'publish', 'release', 'overwrite', 'irreversible'],
    riskWeight: 0.8,
    immutable: false,
    priority: 80,
  },
  {
    id: 'privacy',
    name: 'Privacy Protection',
    description: 'Agents must not exfiltrate or expose PII.',
    outcome: 'BLOCK',
    keywords: ['email address', 'phone number', 'ssn', 'credit card', 'password', 'api key', 'private key', 'secret'],
    riskWeight: 0.9,
    immutable: true,
    priority: 90,
  },
  {
    id: 'resource-limits',
    name: 'Resource Limits',
    description: 'Agents must not consume excessive resources.',
    outcome: 'ESCALATE',
    keywords: ['infinite loop', 'fork bomb', 'spawn unlimited', 'no limit', 'unlimited'],
    riskWeight: 0.7,
    immutable: false,
    priority: 70,
  },
  {
    id: 'budget-compliance',
    name: 'Budget Compliance',
    description: 'Agent spending must stay within approved budgets.',
    outcome: 'BLOCK',
    keywords: ['exceed budget', 'overspend', 'over limit', 'unauthorized spend'],
    riskWeight: 0.85,
    immutable: false,
    priority: 85,
  },
];

// ─── Budget Enforcement ─────────────────────────────────────────────────────

export interface BudgetConfig {
  totalBudgetCents: number;
  maxCostPerHeartbeatCents: number;
  cashFloorCents: number;
  defaultAgentBudgetCents: number;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  totalBudgetCents: 100_000,
  maxCostPerHeartbeatCents: 500,
  cashFloorCents: 100,
  defaultAgentBudgetCents: 50,
};

export interface BudgetState {
  total: number;
  spent: number;
  remaining: number;
  heartbeatSpent: number;
  isPaused: boolean;
  pauseReason?: string;
}

export interface BudgetViolation {
  type: 'overspend' | 'floor_breach' | 'agent_limit' | 'heartbeat_limit';
  severity: 'critical' | 'warning';
  agentId?: string;
  amount: number;
  limit: number;
  message: string;
}

// ─── Kill Switch / Governance ───────────────────────────────────────────────

export interface KillSwitchConfig {
  enabled: boolean;
  autoTriggerOnViolation: boolean;
  requireHumanToResume: boolean;
}

export const DEFAULT_KILL_SWITCH_CONFIG: KillSwitchConfig = {
  enabled: true,
  autoTriggerOnViolation: true,
  requireHumanToResume: true,
};
