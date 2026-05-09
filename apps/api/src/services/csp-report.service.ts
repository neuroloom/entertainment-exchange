// CSP violation reporting — collect and analyze Content-Security-Policy violations
export interface CspViolation {
  id: string;
  tenantId: string;
  blockedUri: string;
  violatedDirective: string;
  documentUri: string;
  referrer: string;
  scriptSample?: string;
  occurredAt: string;
}

const violations: CspViolation[] = [];
const MAX = 5000;

export const cspReport = {
  record(tenantId: string, report: { 'blocked-uri'?: string; 'violated-directive'?: string; 'document-uri'?: string; referrer?: string; 'script-sample'?: string }): CspViolation {
    const v: CspViolation = {
      id: crypto.randomUUID(), tenantId,
      blockedUri: report['blocked-uri'] ?? '',
      violatedDirective: report['violated-directive'] ?? '',
      documentUri: report['document-uri'] ?? '',
      referrer: report.referrer ?? '',
      scriptSample: report['script-sample'],
      occurredAt: new Date().toISOString(),
    };
    violations.push(v);
    if (violations.length > MAX) violations.splice(0, violations.length - MAX);
    return v;
  },

  list(tenantId: string, limit = 50): CspViolation[] {
    return violations.filter(v => v.tenantId === tenantId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  },

  getSummary(tenantId: string): { total: number; topBlockedUris: Array<{ uri: string; count: number }>; topDirectives: Array<{ directive: string; count: number }> } {
    const tenant = violations.filter(v => v.tenantId === tenantId);
    const uriCounts = new Map<string, number>();
    const directiveCounts = new Map<string, number>();

    for (const v of tenant) {
      uriCounts.set(v.blockedUri, (uriCounts.get(v.blockedUri) ?? 0) + 1);
      directiveCounts.set(v.violatedDirective, (directiveCounts.get(v.violatedDirective) ?? 0) + 1);
    }

    return {
      total: tenant.length,
      topBlockedUris: [...uriCounts.entries()].map(([uri, count]) => ({ uri, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      topDirectives: [...directiveCounts.entries()].map(([directive, count]) => ({ directive, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    };
  },
};
