// RegulatoryEngine — rules-based compliance checker.
//
// Defines compliance rules as data and executes them against journal entries
// and audit events. Every check result is timestamped and stored for external
// auditor review.
//
// Moat 5: Compliance & Audit Automation

import type { JournalLine, AuditEvent } from './audit-report-generator.js';

// ─── Public types ────────────────────────────────────────────────────────────────

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  regulation: 'ASC606' | 'SOC2' | 'GAAP' | 'IRS';
  check: (events: AuditEvent[], journals: JournalLine[]) => ComplianceCheckResult;
  severity: 'info' | 'warning' | 'violation';
}

export interface ComplianceCheckResult {
  passed: boolean;
  ruleId: string;
  details: string;
  evidence: Record<string, unknown>;
  timestamp: number;
}

// ─── Built-in rules (all 5) ─────────────────────────────────────────────────────

/**
 * RULE_DUAL_ENTRY_BALANCE
 * Every journal must have equal total debits and credits.
 * Regulation: GAAP
 */
export const RULE_DUAL_ENTRY_BALANCE: ComplianceRule = {
  id: 'RULE_DUAL_ENTRY_BALANCE',
  name: 'Dual Entry Balance',
  description: 'Every journal entry must have equal total debits and credits.',
  regulation: 'GAAP',
  severity: 'violation',
  check(events: AuditEvent[], journals: JournalLine[]): ComplianceCheckResult {
    // Group lines by journalId
    const byJournal = new Map<string, JournalLine[]>();
    for (const line of journals) {
      const bucket = byJournal.get(line.journalId) ?? [];
      bucket.push(line);
      byJournal.set(line.journalId, bucket);
    }

    const unbalanced: string[] = [];
    if (byJournal.size === 0) {
      return {
        passed: true,
        ruleId: 'RULE_DUAL_ENTRY_BALANCE',
        details: 'No journal entries to check.',
        evidence: { journalCount: 0 },
        timestamp: Date.now(),
      };
    }

    for (const [journalId, lines] of byJournal) {
      const debits = lines.filter(l => l.direction === 'debit').reduce((s, l) => s + l.amount, 0);
      const credits = lines.filter(l => l.direction === 'credit').reduce((s, l) => s + l.amount, 0);
      if (debits !== credits) {
        unbalanced.push(journalId);
      }
    }

    return {
      passed: unbalanced.length === 0,
      ruleId: 'RULE_DUAL_ENTRY_BALANCE',
      details: unbalanced.length === 0
        ? `All ${byJournal.size} journal(s) are balanced.`
        : `${unbalanced.length} of ${byJournal.size} journal(s) are unbalanced: ${unbalanced.slice(0, 5).join(', ')}`,
      evidence: {
        totalJournals: byJournal.size,
        unbalancedCount: unbalanced.length,
        unbalancedJournalIds: unbalanced.slice(0, 10),
      },
      timestamp: Date.now(),
    };
  },
};

/**
 * RULE_REVENUE_RECOGNITION_TIMING
 * Revenue must be recognized at performance obligation completion (event date).
 * Regulation: ASC 606
 */
export const RULE_REVENUE_RECOGNITION_TIMING: ComplianceRule = {
  id: 'RULE_REVENUE_RECOGNITION_TIMING',
  name: 'Revenue Recognition Timing',
  description: 'Revenue must be recognized at or after performance obligation completion (event date).',
  regulation: 'ASC606',
  severity: 'violation',
  check(events: AuditEvent[], journals: JournalLine[]): ComplianceCheckResult {
    // Find revenue recognition lines (2000 debit + 4000 credit paired by journalId)
    const recognitionJournals = new Map<string, JournalLine[]>();
    for (const line of journals) {
      if (line.accountCode === '2000' && line.direction === 'debit') {
        const bucket = recognitionJournals.get(line.journalId) ?? [];
        bucket.push(line);
        recognitionJournals.set(line.journalId, bucket);
      }
      if (line.accountCode === '4000' && line.direction === 'credit') {
        const bucket = recognitionJournals.get(line.journalId) ?? [];
        bucket.push(line);
        recognitionJournals.set(line.journalId, bucket);
      }
    }

    if (recognitionJournals.size === 0) {
      return {
        passed: true,
        ruleId: 'RULE_REVENUE_RECOGNITION_TIMING',
        details: 'No revenue recognition journal entries to check.',
        evidence: { recognitionJournalsCount: 0 },
        timestamp: Date.now(),
      };
    }

    // For each recognition journal, check that the corresponding state_change event
    // (obligation completion) occurred before the journal post date.
    const violations: { journalId: string; postedAt: string; nearestEvent: string }[] = [];
    for (const [journalId, lines] of recognitionJournals) {
      const reference = lines[0]?.reference ?? '';
      const postedAt = lines[0]?.postedAt ?? 0;

      // Find matching completion event for this reference
      const completionEvent = events
        .filter(e => e.eventType === 'state_change' && e.resource === reference)
        .sort((a, b) => b.timestamp - a.timestamp) // most recent first
        .find(
          e =>
            e.action === 'complete' ||
            e.action === 'recognize' ||
            e.action === 'finalize',
        );

      if (completionEvent && postedAt < completionEvent.timestamp) {
        violations.push({
          journalId,
          postedAt: new Date(postedAt).toISOString(),
          nearestEvent: new Date(completionEvent.timestamp).toISOString(),
        });
      }
    }

    return {
      passed: violations.length === 0,
      ruleId: 'RULE_REVENUE_RECOGNITION_TIMING',
      details: violations.length === 0
        ? `All ${recognitionJournals.size} revenue recognition journal(s) are properly timed.`
        : `${violations.length} recognition(s) posted before performance obligation completion.`,
      evidence: {
        totalRecognitionJournals: recognitionJournals.size,
        violationCount: violations.length,
        violations: violations.slice(0, 10),
      },
      timestamp: Date.now(),
    };
  },
};

/**
 * RULE_IDEMPOTENCY
 * No duplicate journal entries with the same reference, account, direction, and amount.
 * Regulation: GAAP
 */
export const RULE_IDEMPOTENCY: ComplianceRule = {
  id: 'RULE_IDEMPOTENCY',
  name: 'Journal Idempotency',
  description: 'No duplicate journal entries with the same reference, account, direction, and amount.',
  regulation: 'GAAP',
  severity: 'violation',
  check(events: AuditEvent[], journals: JournalLine[]): ComplianceCheckResult {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const line of journals) {
      const key = `${line.journalId}:${line.accountCode}:${line.direction}:${line.amount}:${line.reference}`;
      if (seen.has(key)) {
        duplicates.push(key);
      } else {
        seen.add(key);
      }
    }

    return {
      passed: duplicates.length === 0,
      ruleId: 'RULE_IDEMPOTENCY',
      details: duplicates.length === 0
        ? `All ${journals.length} journal line(s) are unique.`
        : `${duplicates.length} duplicate journal line(s) detected.`,
      evidence: {
        totalLines: journals.length,
        duplicateCount: duplicates.length,
        duplicates: duplicates.slice(0, 10),
      },
      timestamp: Date.now(),
    };
  },
};

/**
 * RULE_SEGREGATION_OF_DUTIES
 * The agent run approver must differ from the agent run creator.
 * Regulation: SOC 2
 */
export const RULE_SEGREGATION_OF_DUTIES: ComplianceRule = {
  id: 'RULE_SEGREGATION_OF_DUTIES',
  name: 'Segregation of Duties',
  description: 'Agent run approver must differ from agent run creator for financial operations.',
  regulation: 'SOC2',
  severity: 'violation',
  check(events: AuditEvent[], journals: JournalLine[]): ComplianceCheckResult {
    const violations: { journalId: string; agentRunId: string; approvedBy: string }[] = [];

    for (const line of journals) {
      // Only check financial journal entries that have an approver
      if (line.approvedBy && line.agentRunId) {
        // If the approver matches the agentRunId creator, that's a segregation failure.
        // In this model, agentRunId carries the creator identity; approvedBy is the separate approver.
        // We check: if the same user created AND approved, it's a violation.
        // For a system-level check, we look at audit events to map agentRunId → creator.
        const creatorEvent = events.find(
          e =>
            e.eventType === 'system_action' &&
            e.action === 'agent_run_started' &&
            (e.after as Record<string, unknown>)?.agentRunId === line.agentRunId,
        );

        const creator = (creatorEvent?.actor) ?? line.agentRunId;

        // If the creator and approver are the same human actor, flag it.
        if (creator === line.approvedBy && line.agentRunId !== 'system') {
          violations.push({
            journalId: line.journalId,
            agentRunId: line.agentRunId,
            approvedBy: line.approvedBy,
          });
        }
      }
    }

    return {
      passed: violations.length === 0,
      ruleId: 'RULE_SEGREGATION_OF_DUTIES',
      details: violations.length === 0
        ? `No segregation-of-duties violations across ${journals.length} journal line(s).`
        : `${violations.length} segregation-of-duties violation(s): same actor created and approved.`,
      evidence: {
        totalLines: journals.length,
        violationCount: violations.length,
        violations: violations.slice(0, 10),
      },
      timestamp: Date.now(),
    };
  },
};

/**
 * RULE_RIGHTS_TRANSFER
 * Every rights passport transfer must have a valid chain-of-title with
 * sequential chainSequence numbers.
 * Regulation: GAAP (intangible asset transfer control)
 */
export const RULE_RIGHTS_TRANSFER: ComplianceRule = {
  id: 'RULE_RIGHTS_TRANSFER',
  name: 'Rights Transfer Chain-of-Title',
  description: 'Rights passport transfers must have a valid, sequential chain-of-title.',
  regulation: 'GAAP',
  severity: 'violation',
  check(events: AuditEvent[], journals: JournalLine[]): ComplianceCheckResult {
    // Extract rights transfer events from audit log
    const transferEvents = events.filter(
      e => e.eventType === 'state_change' && e.action === 'rights_transfer',
    );

    if (transferEvents.length === 0) {
      return {
        passed: true,
        ruleId: 'RULE_RIGHTS_TRANSFER',
        details: 'No rights transfer events to check.',
        evidence: { transferCount: 0 },
        timestamp: Date.now(),
      };
    }

    // Group by asset (resource) and check chain sequence continuity
    const byAsset = new Map<string, { after: Record<string, unknown>; timestamp: number }[]>();
    for (const e of transferEvents) {
      if (e.after && e.resource) {
        const bucket = byAsset.get(e.resource) ?? [];
        bucket.push({ after: e.after as Record<string, unknown>, timestamp: e.timestamp });
        byAsset.set(e.resource, bucket);
      }
    }

    const violations: { assetId: string; reason: string }[] = [];

    for (const [assetId, transfers] of byAsset) {
      // Sort by timestamp
      transfers.sort((a, b) => a.timestamp - b.timestamp);

      for (let i = 1; i < transfers.length; i++) {
        const prev = transfers[i - 1];
        const curr = transfers[i];

        const prevSeq = prev.after.chainSequence as number | undefined;
        const currSeq = curr.after.chainSequence as number | undefined;
        const currSupersedes = curr.after.supersedesPassportId as string | undefined;
        const prevPassportId = prev.after.passportId as string | undefined;

        // Check: sequence must be sequential
        if (prevSeq !== undefined && currSeq !== undefined && currSeq !== prevSeq + 1) {
          violations.push({
            assetId,
            reason: `Chain sequence break: ${prevSeq}→${currSeq} (expected ${prevSeq + 1})`,
          });
        }

        // Check: current transfer should supersede the previous passport
        if (prevPassportId && currSupersedes && currSupersedes !== prevPassportId) {
          violations.push({
            assetId,
            reason: `Chain-of-title break: expected supersedes ${prevPassportId}, got ${currSupersedes}`,
          });
        }
      }

      // Check first entry: chainSequence should be 1
      const firstSeq = transfers[0]?.after.chainSequence;
      if (firstSeq !== 1 && firstSeq !== undefined) {
        violations.push({
          assetId,
          reason: `First transfer in chain has sequence ${firstSeq} (expected 1)`,
        });
      }
    }

    return {
      passed: violations.length === 0,
      ruleId: 'RULE_RIGHTS_TRANSFER',
      details: violations.length === 0
        ? `All ${transferEvents.length} rights transfer(s) have valid chain-of-title.`
        : `${violations.length} chain-of-title violation(s) across ${byAsset.size} asset(s).`,
      evidence: {
        totalTransfers: transferEvents.length,
        assetCount: byAsset.size,
        violationCount: violations.length,
        violations: violations.slice(0, 10),
      },
      timestamp: Date.now(),
    };
  },
};

/** All built-in rules in execution order. */
export const BUILT_IN_RULES: ComplianceRule[] = [
  RULE_DUAL_ENTRY_BALANCE,
  RULE_REVENUE_RECOGNITION_TIMING,
  RULE_IDEMPOTENCY,
  RULE_SEGREGATION_OF_DUTIES,
  RULE_RIGHTS_TRANSFER,
];

// ─── Stores interface (injectable for testability) ──────────────────────────────

export interface RegulatoryEngineStores {
  events: AuditEvent[];
  journals: JournalLine[];
}

// ─── Rule execution results cache ────────────────────────────────────────────────

export interface CachedCheckResult extends ComplianceCheckResult {
  tenantId: string;
}

// ─── RegulatoryEngine ────────────────────────────────────────────────────────────

export class RegulatoryEngine {
  /** Audit trail of all check results, keyed by "tenantId:ruleId:timestamp". */
  readonly auditTrail: Map<string, CachedCheckResult> = new Map();

  constructor(private stores: RegulatoryEngineStores) {}

  /**
   * Run a single compliance check. The result is automatically stored in the
   * audit trail for external auditor review.
   */
  runCheck(rule: ComplianceRule, tenantId: string): ComplianceCheckResult {
    const tenantEvents = this.stores.events.filter(e => e.tenantId === tenantId);
    const tenantJournals = this.stores.journals.filter(l => l.tenantId === tenantId);

    const result = rule.check(tenantEvents, tenantJournals);

    const trailKey = `${tenantId}:${rule.id}:${result.timestamp}`;
    this.auditTrail.set(trailKey, { ...result, tenantId });

    return result;
  }

  /**
   * Run all built-in rules against a tenant. Returns results in rule order.
   */
  runAllChecks(tenantId: string): ComplianceCheckResult[] {
    return BUILT_IN_RULES.map(rule => this.runCheck(rule, tenantId));
  }

  /**
   * Run a specific rule by ID.
   */
  runCheckById(ruleId: string, tenantId: string): ComplianceCheckResult {
    const rule = BUILT_IN_RULES.find(r => r.id === ruleId);
    if (!rule) {
      throw new Error(`Unknown compliance rule: ${ruleId}`);
    }
    return this.runCheck(rule, tenantId);
  }

  /**
   * Returns all audit trail entries for a given tenant, ordered by timestamp.
   */
  getAuditTrail(tenantId: string): CachedCheckResult[] {
    return [...this.auditTrail.values()]
      .filter(e => e.tenantId === tenantId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Returns the latest compliance check result for each rule for a tenant.
   * Useful for dashboards showing current compliance posture.
   */
  getLatestResults(tenantId: string): Map<string, ComplianceCheckResult> {
    const latest = new Map<string, ComplianceCheckResult>();
    for (const entry of this.auditTrail.values()) {
      if (entry.tenantId !== tenantId) continue;
      const existing = latest.get(entry.ruleId);
      if (!existing || entry.timestamp > existing.timestamp) {
        latest.set(entry.ruleId, entry);
      }
    }
    return latest;
  }
}
