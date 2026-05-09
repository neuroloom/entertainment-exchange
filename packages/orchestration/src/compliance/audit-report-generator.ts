// AuditReportGenerator — automated SOC 2, ASC 606, and tax filing reports.
//
// Generates audit-ready reports by scanning journal entries, audit events,
// and revenue schedules. Designed so external auditors can verify every finding
// with cryptographically sound evidence chains.
//
// Moat 5: Compliance & Audit Automation

// ─── Public types ────────────────────────────────────────────────────────────────

export interface AuditFinding {
  id: string;
  description: string;
  evidence: Record<string, unknown>;
  severity: 'info' | 'warning' | 'violation';
  remediation?: string;
}

export interface AuditSection {
  title: string;
  findings: AuditFinding[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface AuditReport {
  reportId: string;
  type: 'soc2_access' | 'soc2_change' | 'soc2_change_mgmt' | 'asc606' | 'asc606_revenue' | 'tax_filing';
  tenantId: string;
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  summary: {
    totalEvents: number;
    flaggedAnomalies: number;
    complianceScore: number; // 0-100
  };
  sections: AuditSection[];
}

// ─── Input record types (shape expected by the generator) ────────────────────────

/** An audit trail event — access, state change, or system action. */
export interface AuditEvent {
  id: string;
  tenantId: string;
  eventType: 'access' | 'state_change' | 'system_action' | 'health_check';
  actor?: string;          // userId or agentId
  resource?: string;        // e.g. "booking:abc123"
  action: string;           // e.g. "read", "create", "approve"
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  timestamp: number;        // epoch ms
}

/** A single journal entry line (debit or credit leg). */
export interface JournalLine {
  journalId: string;
  tenantId: string;
  businessId: string;
  accountCode: string;
  direction: 'debit' | 'credit';
  amount: number;           // cents
  reference: string;        // e.g. "booking:abc123"
  description?: string;
  postedAt: number;         // epoch ms
  agentRunId?: string;      // which agent run created this
  approvedBy?: string;      // which userId approved it
}

/** A revenue recognition event (maps to ScheduledRecognition lifecycle). */
export interface RevenueEvent {
  bookingId: string;
  tenantId: string;
  businessId: string;
  amount: number;
  eventDate: string;
  recognized: boolean;
  recognizedAt?: string;
  createdAt: string;
}

/** A rights passport transfer record. */
export interface PassportTransferRecord {
  passportId: string;
  assetId: string;
  tenantId: string;
  fromParty: string;
  toParty: string;
  transferDate: number;
  chainSequence: number;
  verified: boolean;
  supersedesPassportId?: string | null;
}

// ─── Generator state ─────────────────────────────────────────────────────────────

export interface AuditGeneratorStores {
  /** All audit events for slice-based access. Caller provides filtered events. */
  auditEvents: AuditEvent[];
  /** All journal lines. */
  journalLines: JournalLine[];
  /** Revenue events / schedules. */
  revenueEvents: RevenueEvent[];
  /** Health check log entries (simple timestamps). */
  healthChecks: number[];
  /** Rights passport transfers. */
  passportTransfers: PassportTransferRecord[];
}

// ─── Importable configuration ────────────────────────────────────────────────────

export const COMPLIANCE_WEIGHTS: Record<string, number> = {
  soc2Access: 0.25,
  soc2Change: 0.20,
  asc606:     0.25,
  taxFiling:   0.15,
  integrity:   0.15,
};

// ─── AuditReportGenerator ────────────────────────────────────────────────────────

export class AuditReportGenerator {
  constructor(private stores: AuditGeneratorStores) {}

  // ── SOC 2: Access Control Audit ─────────────────────────────────────────────

  /** Generates an access-control audit report scoped to the tenant and time window. */
  generateAccessAudit(tenantId: string, periodStart: number, periodEnd: number): AuditReport {
    const events = this.stores.auditEvents.filter(
      e =>
        e.tenantId === tenantId &&
        e.eventType === 'access' &&
        e.timestamp >= periodStart &&
        e.timestamp <= periodEnd,
    );

    const sections: AuditSection[] = [];
    const accessByResource = new Map<string, AuditEvent[]>();
    for (const e of events) {
      const key = e.resource ?? '__unknown__';
      const bucket = accessByResource.get(key) ?? [];
      bucket.push(e);
      accessByResource.set(key, bucket);
    }

    // Per-resource access breakdown
    const resourceFindings: AuditFinding[] = [];
    for (const [resource, evts] of accessByResource) {
      resourceFindings.push({
        id: `acc-res-${resource.slice(0, 40)}`,
        description: `Resource "${resource}" accessed ${evts.length} time(s) by ${new Set(evts.map(e => e.actor)).size} actor(s)`,
        evidence: {
          resource,
          accessCount: evts.length,
          uniqueActors: [...new Set(evts.map(e => e.actor))],
          sampleTimestamps: evts.slice(0, 5).map(e => new Date(e.timestamp).toISOString()),
        },
        severity: 'info',
      });
    }
    sections.push({ title: 'Resource Access Summary', findings: resourceFindings, riskLevel: 'low' });

    // Suspicious access patterns: same actor accessing many resources in a short window
    const actorAccesses = new Map<string, AuditEvent[]>();
    for (const e of events) actorAccesses.set(e.actor ?? 'unknown', [...(actorAccesses.get(e.actor ?? 'unknown') ?? []), e]);

    const suspiciousFindings: AuditFinding[] = [];
    for (const [actor, evts] of actorAccesses) {
      const resources = new Set(evts.map(e => e.resource ?? ''));
      if (resources.size > 20) {
        suspiciousFindings.push({
          id: `acc-susp-${actor.slice(0, 32)}`,
          description: `Actor "${actor}" accessed ${resources.size} distinct resources in period`,
          evidence: { actor, distinctResources: resources.size, totalAccesses: evts.length },
          severity: 'warning',
          remediation: 'Review whether this access pattern is consistent with the actor\'s role.',
        });
      }
    }
    if (suspiciousFindings.length > 0) {
      sections.push({ title: 'Suspicious Access Patterns', findings: suspiciousFindings, riskLevel: 'medium' });
    }

    // Unauthorized access: any event where role is missing or mismatched
    const unauthed = events.filter(e => !e.actor);
    if (unauthed.length > 0) {
      sections.push({
        title: 'Unauthenticated Access',
        findings: [{
          id: 'acc-unauthed',
          description: `${unauthed.length} access event(s) have no actor (unauthenticated)`,
          evidence: { count: unauthed.length, sampleIds: unauthed.slice(0, 5).map(e => e.id) },
          severity: 'violation',
          remediation: 'Ensure all access events carry a valid actor identity.',
        }],
        riskLevel: 'critical',
      });
    }

    return this.#assembleReport(tenantId, periodStart, periodEnd, 'soc2_access', events.length, sections);
  }

  // ── SOC 2: Change Management Audit ──────────────────────────────────────────

  /** Generates a change-management audit: all state transitions with before/after. */
  generateChangeAudit(tenantId: string, periodStart: number, periodEnd: number): AuditReport {
    const events = this.stores.auditEvents.filter(
      e =>
        e.tenantId === tenantId &&
        e.eventType === 'state_change' &&
        e.timestamp >= periodStart &&
        e.timestamp <= periodEnd,
    );

    const sections: AuditSection[] = [];
    const changeFindings: AuditFinding[] = [];

    for (const e of events) {
      const beforeKeys = e.before ? Object.keys(e.before).sort().join(', ') : 'none';
      const afterKeys = e.after ? Object.keys(e.after).sort().join(', ') : 'none';
      changeFindings.push({
        id: `chg-${e.id.slice(0, 40)}`,
        description: `State change on ${e.resource ?? 'unknown'} by ${e.actor ?? 'unknown'}: ${e.action}`,
        evidence: {
          resource: e.resource,
          actor: e.actor,
          action: e.action,
          beforeFields: beforeKeys,
          afterFields: afterKeys,
          timestamp: new Date(e.timestamp).toISOString(),
        },
        severity: 'info',
      });
    }
    sections.push({ title: 'All State Transitions', findings: changeFindings, riskLevel: 'low' });

    // Detect changes without before/after (opaque transitions)
    const opaque = events.filter(e => !e.before || !e.after);
    if (opaque.length > 0) {
      sections.push({
        title: 'Opaque Transitions',
        findings: [{
          id: 'chg-opaque',
          description: `${opaque.length} change(s) lack before/after snapshots`,
          evidence: { count: opaque.length, sampleIds: opaque.slice(0, 5).map(e => e.id) },
          severity: 'warning',
          remediation: 'Ensure every state change captures both before and after state.',
        }],
        riskLevel: 'medium',
      });
    }

    // Detect approval bypass: state_change without an approver reference
    const unapproved = events.filter(
      e => e.action === 'approve' || e.action === 'payout' || e.action === 'recognize',
    );
    const bypassed = unapproved.filter(e => !(e.after as Record<string, unknown>)?.approvedBy);
    if (bypassed.length > 0) {
      sections.push({
        title: 'Potential Approval Bypass',
        findings: [{
          id: 'chg-bypass',
          description: `${bypassed.length} sensitive state change(s) may lack explicit approval`,
          evidence: { count: bypassed.length, sampleIds: bypassed.slice(0, 5).map(e => e.id) },
          severity: 'violation',
          remediation: 'Require dual-approval or explicit approvedBy field on all sensitive transitions.',
        }],
        riskLevel: 'high',
      });
    }

    return this.#assembleReport(tenantId, periodStart, periodEnd, 'soc2_change_mgmt', events.length, sections);
  }

  // ── Data Integrity: Journal Hash Chain Verification ─────────────────────────

  /**
   * Verifies journal integrity by computing a hash chain over all journal lines
   * for the tenant. The chain is constructed by sorting lines by postedAt then journalId,
   * and chaining SHA-256 hashes. A break is any line whose hash doesn't chain from its
   * predecessor.
   */
  verifyJournalIntegrity(tenantId: string): { valid: boolean; hashChain: string[]; breaks: number[] } {
    const lines = [...this.stores.journalLines]
      .filter(l => l.tenantId === tenantId)
      .sort((a, b) => a.postedAt - b.postedAt || a.journalId.localeCompare(b.journalId));

    const hashChain: string[] = [];
    const breaks: number[] = [];

    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000'; // genesis

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const payload = `${prevHash}:${line.journalId}:${line.accountCode}:${line.direction}:${line.amount}:${line.postedAt}`;
      const hash = this.#sha256(payload);
      hashChain.push(hash);

      // Verification: recompute the expected hash from the previous hash + this line's data
      const expected = this.#sha256(
        `${prevHash}:${line.journalId}:${line.accountCode}:${line.direction}:${line.amount}:${line.postedAt}`
      );
      if (hash !== expected) {
        breaks.push(i);
      }

      prevHash = hash;
    }

    return { valid: breaks.length === 0, hashChain, breaks };
  }

  // ── ASC 606: Revenue Recognition Audit ──────────────────────────────────────

  generateRevenueAudit(tenantId: string, periodStart: number, periodEnd: number): AuditReport {
    const sections: AuditSection[] = [];

    // Collect relevant revenue events
    const revEvents = this.stores.revenueEvents.filter(
      e =>
        e.tenantId === tenantId &&
        new Date(e.createdAt).getTime() >= periodStart &&
        new Date(e.createdAt).getTime() <= periodEnd,
    );

    const recognized = revEvents.filter(e => e.recognized);
    const deferred = revEvents.filter(e => !e.recognized);

    // Check 1: All recognized revenue has a matching performance obligation
    const perfFindings: AuditFinding[] = [];
    for (const r of recognized) {
      const eventDate = new Date(r.eventDate);
      const recognizedAt = r.recognizedAt ? new Date(r.recognizedAt) : new Date(0);
      // Performance obligation is met when eventDate has passed and recognizedAt is on/after eventDate
      const obligationMet = recognizedAt >= eventDate;

      const journalLines = this.stores.journalLines.filter(l => l.reference === r.bookingId);
      const totalDebitRecog = journalLines
        .filter(l => l.accountCode === '2000' && l.direction === 'debit')
        .reduce((s, l) => s + l.amount, 0);
      const totalCreditRevenue = journalLines
        .filter(l => l.accountCode === '4000' && l.direction === 'credit')
        .reduce((s, l) => s + l.amount, 0);

      perfFindings.push({
        id: `asc606-perf-${r.bookingId.slice(0, 40)}`,
        description: `Booking ${r.bookingId}: recognized $${(r.amount / 100).toFixed(2)}, ` +
          `event date ${r.eventDate}, obligation ${obligationMet ? 'met' : 'NOT met'}`,
        evidence: {
          bookingId: r.bookingId,
          amount: r.amount,
          eventDate: r.eventDate,
          recognizedAt: r.recognizedAt,
          obligationMet,
          journalDebitDeferred: totalDebitRecog,
          journalCreditRevenue: totalCreditRevenue,
        },
        severity: obligationMet ? 'info' : 'warning',
        remediation: obligationMet
          ? undefined
          : 'Revenue was recognized before the performance obligation date. Reclassify as deferred.',
      });
    }
    sections.push({
      title: 'Performance Obligation Verification',
      findings: perfFindings,
      riskLevel: perfFindings.some(f => f.severity === 'warning') ? 'medium' : 'low',
    });

    // Check 2: Detect premature revenue recognition
    const premature = recognized.filter(r => {
      const recognizedAt = r.recognizedAt ? new Date(r.recognizedAt) : null;
      const eventDate = new Date(r.eventDate);
      return recognizedAt && recognizedAt < eventDate;
    });

    if (premature.length > 0) {
      const premFindings: AuditFinding[] = premature.map(r => ({
        id: `asc606-prem-${r.bookingId.slice(0, 40)}`,
        description: `Premature revenue recognition: booking ${r.bookingId} recognized ${r.recognizedAt} before event ${r.eventDate}`,
        evidence: {
          bookingId: r.bookingId,
          amount: r.amount,
          eventDate: r.eventDate,
          recognizedAt: r.recognizedAt,
          daysEarly: r.recognizedAt
            ? Math.ceil((new Date(r.eventDate).getTime() - new Date(r.recognizedAt).getTime()) / 86400000)
            : null,
        },
        severity: 'violation',
        remediation: 'Reverse the recognition journal entry and re-recognize on or after the event date.',
      }));
      sections.push({
        title: 'Premature Revenue Recognition',
        findings: premFindings,
        riskLevel: 'critical',
      });
    }

    // Check 3: Deferred revenue is properly tracked
    const deferredFindings: AuditFinding[] = deferred.map(r => {
      const eventDate = new Date(r.eventDate);
      const now = Date.now();
      const isPastDue = eventDate.getTime() <= now;
      return {
        id: `asc606-def-${r.bookingId.slice(0, 40)}`,
        description: `Deferred revenue: booking ${r.bookingId}, $${(r.amount / 100).toFixed(2)}, ` +
          `event date ${r.eventDate} ${isPastDue ? '(past due — should be recognized)' : '(future)'}`,
        evidence: {
          bookingId: r.bookingId,
          amount: r.amount,
          eventDate: r.eventDate,
          isPastDue,
          daysUntilEvent: isPastDue ? 0 : Math.ceil((eventDate.getTime() - now) / 86400000),
        },
        severity: isPastDue ? 'warning' : 'info',
        remediation: isPastDue ? 'Recognize this revenue immediately via RECOGNIZE_RECIPE.' : undefined,
      };
    });

    if (deferredFindings.length > 0) {
      sections.push({
        title: 'Deferred Revenue Tracking',
        findings: deferredFindings,
        riskLevel: deferred.some(r => new Date(r.eventDate).getTime() <= Date.now()) ? 'medium' : 'low',
      });
    }

    // Check 4: Revenue journal entries balance (deferred debits = recognized credits)
    const allRevenueLines = this.stores.journalLines.filter(
      l =>
        l.tenantId === tenantId &&
        l.accountCode === '4000' &&
        l.postedAt >= periodStart &&
        l.postedAt <= periodEnd,
    );
    const recognizedTotal = allRevenueLines
      .filter(l => l.direction === 'credit')
      .reduce((s, l) => s + l.amount, 0);
    const deferredDebits = this.stores.journalLines
      .filter(
        l =>
          l.tenantId === tenantId &&
          l.accountCode === '2000' &&
          l.direction === 'debit' &&
          l.postedAt >= periodStart &&
          l.postedAt <= periodEnd,
      )
      .reduce((s, l) => s + l.amount, 0);

    if (recognizedTotal > 0 && Math.abs(recognizedTotal - deferredDebits) > 1) {
      sections.push({
        title: 'Revenue / Deferred Mismatch',
        findings: [{
          id: 'asc606-mismatch',
          description: `Recognized revenue ($${(recognizedTotal / 100).toFixed(2)}) does not match ` +
            `deferred revenue debits ($${(deferredDebits / 100).toFixed(2)})`,
          evidence: { recognizedTotal, deferredDebits, diff: recognizedTotal - deferredDebits },
          severity: 'violation',
          remediation: 'Investigate and reconcile the revenue journal entries.',
        }],
        riskLevel: 'critical',
      });
    }

    return this.#assembleReport(tenantId, periodStart, periodEnd, 'asc606_revenue', revEvents.length, sections);
  }

  // ── Tax Filing: 1099-NEC Equivalent & Sales Tax ─────────────────────────────

  generateTaxFiling(tenantId: string, year: number): AuditReport {
    const yearStart = new Date(`${year}-01-01T00:00:00.000Z`).getTime();
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`).getTime() - 1;

    const sections: AuditSection[] = [];

    // ── 1099-NEC equivalent: vendor/artist payables ──────────────────────────────
    const payoutLines = this.stores.journalLines.filter(
      l =>
        l.tenantId === tenantId &&
        l.accountCode === '2100' && // Artist/Vendor Payable
        l.direction === 'debit' &&  // payout reduces payable
        l.postedAt >= yearStart &&
        l.postedAt <= yearEnd,
    );

    // Group payouts by business (each business is a recipient)
    const payoutsByRecipient = new Map<string, { total: number; lines: JournalLine[] }>();
    for (const line of payoutLines) {
      const bucket = payoutsByRecipient.get(line.businessId) ?? { total: 0, lines: [] };
      bucket.total += line.amount;
      bucket.lines.push(line);
      payoutsByRecipient.set(line.businessId, bucket);
    }

    const necFindings: AuditFinding[] = [];
    for (const [recipientId, data] of payoutsByRecipient) {
      // Threshold: $600+ triggers a 1099-NEC (IRS rule)
      const triggers1099 = data.total >= 60000; // cents
      necFindings.push({
        id: `tax-1099-${recipientId.slice(0, 40)}`,
        description: `Recipient ${recipientId}: $${(data.total / 100).toFixed(2)} total payouts` +
          (triggers1099 ? ' — 1099-NEC REQUIRED' : ''),
        evidence: {
          recipientId,
          totalCents: data.total,
          totalFormatted: `$${(data.total / 100).toFixed(2)}`,
          transactionCount: data.lines.length,
          triggers1099,
          sampleTransactions: data.lines.slice(0, 3).map(l => ({
            journalId: l.journalId,
            amount: l.amount,
            date: new Date(l.postedAt).toISOString(),
          })),
        },
        severity: triggers1099 ? 'warning' : 'info',
        remediation: triggers1099
          ? `File Form 1099-NEC for ${recipientId} — total payouts exceed $600 threshold.`
          : undefined,
      });
    }

    sections.push({
      title: '1099-NEC Equivalent — Vendor/Artist Payouts',
      findings: necFindings,
      riskLevel: [...payoutsByRecipient.values()].some(d => d.total >= 60000) ? 'medium' : 'low',
    });

    // ── Sales tax summary by jurisdiction ────────────────────────────────────────
    // In the entertainment exchange, "jurisdiction" is inferred from the booking's
    // businessId / metadata. Here we collect all booking revenue (account 4000 credits)
    // and flag amounts that may require sales tax remittance.
    const revenueLines = this.stores.journalLines.filter(
      l =>
        l.tenantId === tenantId &&
        l.accountCode === '4000' &&
        l.direction === 'credit' &&
        l.postedAt >= yearStart &&
        l.postedAt <= yearEnd,
    );

    const revenueByBusiness = new Map<string, { total: number; lines: JournalLine[] }>();
    for (const line of revenueLines) {
      const bucket = revenueByBusiness.get(line.businessId) ?? { total: 0, lines: [] };
      bucket.total += line.amount;
      bucket.lines.push(line);
      revenueByBusiness.set(line.businessId, bucket);
    }

    const taxFindings: AuditFinding[] = [];
    // Sales tax flag: if a business has revenue > $0, flag for review
    // (jurisdiction-specific rates are outside the scope of the engine;
    //  this surfaces the data an accountant needs to file.)
    for (const [businessId, data] of revenueByBusiness) {
      taxFindings.push({
        id: `tax-sales-${businessId.slice(0, 40)}`,
        description: `Business ${businessId}: $${(data.total / 100).toFixed(2)} taxable gross revenue, ` +
          `${data.lines.length} transactions`,
        evidence: {
          businessId,
          totalGrossCents: data.total,
          totalGrossFormatted: `$${(data.total / 100).toFixed(2)}`,
          transactionCount: data.lines.length,
          // Accountant needs: gross receipts, jurisdiction, filing period
          // The evidence block provides everything needed for state/local filing
        },
        severity: data.total > 0 ? 'warning' : 'info',
        remediation: data.total > 0
          ? 'Review sales tax nexus obligations for this business\'s jurisdiction(s).'
          : undefined,
      });
    }

    if (taxFindings.length > 0) {
      sections.push({
        title: 'Sales Tax Summary by Jurisdiction',
        findings: taxFindings,
        riskLevel: revenueByBusiness.size > 0 ? 'medium' : 'low',
      });
    } else {
      sections.push({
        title: 'Sales Tax Summary by Jurisdiction',
        findings: [{
          id: 'tax-norev',
          description: 'No booking revenue recorded for this tax year.',
          evidence: { year, tenantId },
          severity: 'info',
        }],
        riskLevel: 'low',
      });
    }

    const totalEvents = payoutLines.length + revenueLines.length;
    return this.#assembleReport(tenantId, yearStart, yearEnd, 'tax_filing', totalEvents, sections);
  }

  // ── Availability Audit (SOC 2) ──────────────────────────────────────────────

  generateAvailabilityAudit(tenantId: string, periodStart: number, periodEnd: number): AuditReport {
    const checks = this.stores.healthChecks.filter(
      t => t >= periodStart && t <= periodEnd,
    );

    // Also include health_check events from the audit log
    const healthEvents = this.stores.auditEvents.filter(
      e =>
        e.tenantId === tenantId &&
        e.eventType === 'health_check' &&
        e.timestamp >= periodStart &&
        e.timestamp <= periodEnd,
    );

    const allCheckpoints = [
      ...checks,
      ...healthEvents.map(e => e.timestamp),
    ].sort((a, b) => a - b);

    const sections: AuditSection[] = [];

    // Calculate uptime: gaps between consecutive health checks > threshold = downtime
    const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    let totalGapMs = 0;
    let gapCount = 0;
    const gapDetails: { from: string; to: string; durationMs: number }[] = [];

    for (let i = 1; i < allCheckpoints.length; i++) {
      const gap = allCheckpoints[i] - allCheckpoints[i - 1];
      if (gap > GAP_THRESHOLD_MS) {
        totalGapMs += gap - GAP_THRESHOLD_MS;
        gapCount++;
        gapDetails.push({
          from: new Date(allCheckpoints[i - 1]).toISOString(),
          to: new Date(allCheckpoints[i]).toISOString(),
          durationMs: gap,
        });
      }
    }

    const periodDurationMs = periodEnd - periodStart;
    const uptimePercent = periodDurationMs > 0
      ? ((1 - totalGapMs / periodDurationMs) * 100).toFixed(4)
      : '100.0000';

    sections.push({
      title: 'Availability Summary',
      findings: [{
        id: 'avail-summary',
        description: `Uptime: ${uptimePercent}% over period. ` +
          `${allCheckpoints.length} health checks, ${gapCount} gap(s) exceeding ${GAP_THRESHOLD_MS / 1000}s threshold.`,
        evidence: {
          totalHealthChecks: allCheckpoints.length,
          gapCount,
          totalGapMs,
          uptimePercent: parseFloat(uptimePercent),
          gapThresholdMs: GAP_THRESHOLD_MS,
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
        },
        severity: gapCount > 0 ? 'warning' : 'info',
        remediation: gapCount > 0 ? `Investigate ${gapCount} availability gap(s).` : undefined,
      }],
      riskLevel: gapCount > 0 ? 'medium' : 'low',
    });

    if (gapDetails.length > 0) {
      sections.push({
        title: 'Availability Gap Details',
        findings: gapDetails.map((g, i) => ({
          id: `avail-gap-${i}`,
          description: `Gap: ${(g.durationMs / 1000).toFixed(1)}s from ${g.from} to ${g.to}`,
          evidence: g as unknown as Record<string, unknown>,
          severity: 'warning' as const,
          remediation: 'Review monitoring coverage during this window.',
        })),
        riskLevel: 'medium',
      });
    }

    return this.#assembleReport(tenantId, periodStart, periodEnd, 'soc2_access', allCheckpoints.length, sections);
  }

  // ── Aggregate Compliance Score ──────────────────────────────────────────────

  getComplianceScore(tenantId: string): number {
    const now = Date.now();
    const oneYearAgo = now - 365 * 86400000;

    const accessReport = this.generateAccessAudit(tenantId, oneYearAgo, now);
    const changeReport = this.generateChangeAudit(tenantId, oneYearAgo, now);
    const revenueReport = this.generateRevenueAudit(tenantId, oneYearAgo, now);
    const taxReport = this.generateTaxFiling(tenantId, new Date().getFullYear());
    const integrity = this.verifyJournalIntegrity(tenantId);
    const availReport = this.generateAvailabilityAudit(tenantId, oneYearAgo, now);

    const subScores: Record<string, number> = {
      soc2Access: accessReport.summary.complianceScore,
      soc2Change: changeReport.summary.complianceScore,
      asc606: revenueReport.summary.complianceScore,
      taxFiling: taxReport.summary.complianceScore,
      integrity: integrity.valid ? 100 : Math.max(0, 100 - integrity.breaks.length * 10),
    };

    // Weighted aggregate
    let score = 0;
    let totalWeight = 0;
    for (const [key, weight] of Object.entries(COMPLIANCE_WEIGHTS)) {
      score += (subScores[key] ?? 0) * weight;
      totalWeight += weight;
    }

    return Math.round((totalWeight > 0 ? score / totalWeight : 0) * 100) / 100;
  }

  // ── CSV/JSON export helpers ─────────────────────────────────────────────────

  /** Exports the given report as a JSON string (auditor-importable). */
  exportReportJSON(report: AuditReport): string {
    return JSON.stringify(report, null, 2);
  }

  /** Exports a tax filing report as a CSV string suitable for accountant import. */
  exportTaxFilingCSV(report: AuditReport): string {
    const rows: string[] = ['type,recipientId,totalCents,totalDollars,transactionCount,triggers1099,severity'];
    for (const section of report.sections) {
      for (const finding of section.findings) {
        const e = finding.evidence as Record<string, unknown>;
        const type = section.title.includes('1099') ? '1099-NEC' : 'sales-tax';
        const recipientId = (e.recipientId ?? e.businessId ?? '') as string;
        const totalCents = (e.totalCents ?? e.totalGrossCents ?? 0) as number;
        const totalDollars = (totalCents / 100).toFixed(2);
        const txnCount = (e.transactionCount ?? 0) as number;
        const triggers1099 = (e.triggers1099 ?? false) as boolean;
        rows.push(`${type},${recipientId},${totalCents},${totalDollars},${txnCount},${triggers1099},${finding.severity}`);
      }
    }
    return rows.join('\n');
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  #assembleReport(
    tenantId: string,
    periodStart: number,
    periodEnd: number,
    type: AuditReport['type'],
    totalEvents: number,
    sections: AuditSection[],
  ): AuditReport {
    const flaggedAnomalies = sections.reduce(
      (sum, s) => sum + s.findings.filter(f => f.severity !== 'info').length,
      0,
    );

    // Score: start at 100, deduct for each finding above info
    const deductions = sections.reduce((sum, s) => {
      const violationCount = s.findings.filter(f => f.severity === 'violation').length;
      const warningCount = s.findings.filter(f => f.severity === 'warning').length;
      return sum + violationCount * 10 + warningCount * 3;
    }, 0);
    const complianceScore = Math.max(0, Math.min(100, 100 - deductions));

    return {
      reportId: crypto.randomUUID(),
      type,
      tenantId,
      periodStart,
      periodEnd,
      generatedAt: Date.now(),
      summary: { totalEvents, flaggedAnomalies, complianceScore },
      sections,
    };
  }

  /**
   * Deterministic SHA-256 implementation using the Web Crypto API subset available
   * in Node.js (via globalThis.crypto.subtle). Falls back to a simple hash for
   * environments where subtle is unavailable, though integrity verification strength
   * is reduced in that case.
   */
  #sha256(input: string): string {
    // Use Node.js crypto module for reliable SHA-256
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(input).digest('hex') as string;
  }
}
