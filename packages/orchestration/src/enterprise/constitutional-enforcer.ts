// Constitutional Safety Enforcer
// Validates team actions against constitutional principles before execution
// Derived from neuroloomorg/neuroloom-enterprise-orchestrator

import {
  DEFAULT_PRINCIPLES,
} from './types.js';
import type {
  ConstitutionalPrinciple,
  CompanyAction,
  ValidationResult,
  Decision,
  PolicyResult,
  PolicyOutcome,
} from './types.js';

export class ConstitutionalEnforcer {
  private principles: ConstitutionalPrinciple[];

  constructor(principles: ConstitutionalPrinciple[] = DEFAULT_PRINCIPLES) {
    this.principles = [...principles].sort((a, b) => b.priority - a.priority);
  }

  /** Add a new principle (non-immutable only may be replaced) */
  addPrinciple(p: ConstitutionalPrinciple): void {
    const existing = this.principles.findIndex(e => e.id === p.id);
    if (existing >= 0) {
      if (this.principles[existing].immutable) {
        throw new Error(`Cannot modify immutable principle: ${p.id}`);
      }
      this.principles[existing] = p;
    } else {
      this.principles.push(p);
    }
    this.principles.sort((a, b) => b.priority - a.priority);
  }

  /** Compute a 0-1 harm score for an action based on keyword matching */
  computeHarmScore(action: CompanyAction): number {
    const harmKeywords = [
      'delete all', 'expose', 'leak', 'harm', 'illegal', 'fraud',
      'deceive', 'manipulate', 'fork bomb', 'infinite', 'wipe',
    ];
    const desc = action.description.toLowerCase();
    let score = 0;
    for (const kw of harmKeywords) {
      if (desc.includes(kw)) score += 0.2;
    }
    return Math.min(1, score);
  }

  /** Validate an action against all principles */
  async validate(action: CompanyAction): Promise<ValidationResult> {
    const harmScore = this.computeHarmScore(action);
    const violations: Array<{ principle: ConstitutionalPrinciple; severity: number }> = [];

    for (const principle of this.principles) {
      const desc = action.description.toLowerCase();
      const match = principle.keywords.some(kw => desc.includes(kw.toLowerCase()));
      if (match) {
        violations.push({ principle, severity: principle.riskWeight });
      }
    }

    // If harm score is high and no-harm principle exists, add it
    if (harmScore > 0.3 && !violations.some(v => v.principle.id === 'harm-prevention')) {
      const noHarm = this.principles.find(p => p.id === 'harm-prevention');
      if (noHarm) {
        violations.push({ principle: noHarm, severity: harmScore });
      }
    }

    // Immutable violations are automatic disapproval
    const hasImmutableViolation = violations.some(
      v => v.principle.immutable && v.principle.outcome === 'BLOCK'
    );

    return {
      approved: !hasImmutableViolation,
      violations,
      harmScore,
      reasoning: violations.length === 0
        ? 'Action is compliant with all constitutional principles.'
        : `Violations: ${violations.map(v => `${v.principle.name} (severity ${v.severity.toFixed(2)})`).join(', ')}`,
    };
  }

  /** Enforce — returns null if action is vetoed */
  async enforce(action: CompanyAction): Promise<CompanyAction | null> {
    const result = await this.validate(action);
    if (!result.approved) {
      console.warn(`[ConstitutionalEnforcer] Action vetoed: ${action.id} — ${result.reasoning}`);
      return null;
    }
    return action;
  }

  /** Evaluate a decision through constitutional principles */
  evaluateDecision(decision: Decision): PolicyResult {
    const triggered: ConstitutionalPrinciple[] = [];
    let worstOutcome: PolicyOutcome = 'ALLOW';

    for (const principle of this.principles) {
      const actionText = `${decision.action} ${decision.reasoning}`.toLowerCase();
      const match = principle.keywords.some(kw => actionText.includes(kw.toLowerCase()));

      if (match || (principle.id === 'budget-compliance' && decision.estimatedCostCents > 0)) {
        triggered.push(principle);
        if (principle.outcome === 'BLOCK') worstOutcome = 'BLOCK';
        else if (principle.outcome === 'ESCALATE' && worstOutcome !== 'BLOCK') worstOutcome = 'ESCALATE';
      }
    }

    if (decision.isIrreversible && worstOutcome === 'ALLOW') {
      worstOutcome = 'ESCALATE';
      const oversight = this.principles.find(p => p.id === 'human-oversight');
      if (oversight && !triggered.includes(oversight)) triggered.push(oversight);
    }

    return {
      decision,
      outcome: worstOutcome,
      triggeredPrinciples: triggered,
      reasoning: triggered.length === 0
        ? 'Decision passed all constitutional checks.'
        : `Triggered: ${triggered.map(p => p.name).join(', ')}`,
      requiresHumanApproval: worstOutcome !== 'ALLOW',
    };
  }

  getPrinciples(): ConstitutionalPrinciple[] {
    return [...this.principles];
  }
}
