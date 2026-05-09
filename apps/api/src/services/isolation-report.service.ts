// Isolation report — verify no cross-tenant data leaks
import type { StoreEntity } from './repo.js';

interface IsolationCheck { domain: string; totalRecords: number; tenantIsolated: number; crossTenantRisks: number; passed: boolean; }
const checks: IsolationCheck[] = [];

export const isolationReport = {
  checkAll(tenantId: string, stores: Record<string, { all: (tid: string) => StoreEntity[] }>): IsolationCheck[] {
    const results: IsolationCheck[] = [];

    for (const [domain, store] of Object.entries(stores)) {
      const tenantRecords = store.all(tenantId);
      const totalRecords = tenantRecords.length;
      let tenantIsolated = 0;
      let crossTenantRisks = 0;

      for (const r of tenantRecords) {
        if (r.tenantId === tenantId) tenantIsolated++;
        else crossTenantRisks++;
      }

      results.push({
        domain, totalRecords, tenantIsolated, crossTenantRisks,
        passed: crossTenantRisks === 0,
      });
    }

    checks.push(...results);
    return results;
  },

  getLatestReport(): IsolationCheck[] {
    return [...checks].sort((a, b) => b.totalRecords - a.totalRecords);
  },

  getOverallStatus(checks: IsolationCheck[]): { allPassed: boolean; failedDomains: string[]; riskLevel: 'none' | 'low' | 'critical' } {
    const failed = checks.filter(c => !c.passed);
    return {
      allPassed: failed.length === 0,
      failedDomains: failed.map(c => c.domain),
      riskLevel: failed.length === 0 ? 'none' : failed.every(c => c.crossTenantRisks < 5) ? 'low' : 'critical',
    };
  },
};
