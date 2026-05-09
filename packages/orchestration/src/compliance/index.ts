// Compliance module — automated SOC 2, ASC 606, and tax filing reports.
// Moat 5: Compliance & Audit Automation
//
// AuditReportGenerator: produces audit-ready reports for access control,
// change management, revenue recognition, journal integrity, and tax filings.
//
// RegulatoryEngine: rules-based compliance checker with 5 built-in rules
// covering dual-entry balance, revenue timing, idempotency, segregation of
// duties, and rights transfer chain-of-title.

export { AuditReportGenerator, COMPLIANCE_WEIGHTS } from './audit-report-generator.js';
export type {
  AuditReport,
  AuditSection,
  AuditFinding,
  AuditEvent,
  JournalLine,
  RevenueEvent,
  PassportTransferRecord,
  AuditGeneratorStores,
} from './audit-report-generator.js';

export {
  RegulatoryEngine,
  BUILT_IN_RULES,
  RULE_DUAL_ENTRY_BALANCE,
  RULE_REVENUE_RECOGNITION_TIMING,
  RULE_IDEMPOTENCY,
  RULE_SEGREGATION_OF_DUTIES,
  RULE_RIGHTS_TRANSFER,
} from './regulatory-engine.js';
export type {
  ComplianceRule,
  ComplianceCheckResult,
  RegulatoryEngineStores,
  CachedCheckResult,
} from './regulatory-engine.js';
