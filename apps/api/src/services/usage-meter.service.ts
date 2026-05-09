// Usage metering — per-tenant API call tracking with endpoint-level counters
export interface UsageRecord {
  tenantId: string;
  endpoint: string;
  method: string;
  timestamp: string;
  statusCode: number;
  durationMs: number;
}

export interface UsageSummary {
  tenantId: string;
  month: string;               // YYYY-MM
  totalCalls: number;
  byEndpoint: Record<string, number>;
  avgDurationMs: number;
  errorCount: number;          // 4xx + 5xx
  uniqueEndpoints: number;
}

const records: UsageRecord[] = [];
const MAX_RECORDS = 100_000;

export const usageMeter = {
  record(tenantId: string, endpoint: string, method: string, statusCode: number, durationMs: number): void {
    if (!tenantId) return;
    records.push({ tenantId, endpoint, method, timestamp: new Date().toISOString(), statusCode, durationMs });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  },

  getSummary(tenantId: string, month?: string): UsageSummary {
    const targetMonth = month ?? new Date().toISOString().slice(0, 7);
    const matching = records.filter(
      r => r.tenantId === tenantId && r.timestamp.startsWith(targetMonth),
    );

    const byEndpoint: Record<string, number> = {};
    let totalDuration = 0;
    let errors = 0;

    for (const r of matching) {
      const key = `${r.method} ${r.endpoint}`;
      byEndpoint[key] = (byEndpoint[key] ?? 0) + 1;
      totalDuration += r.durationMs;
      if (r.statusCode >= 400) errors++;
    }

    return {
      tenantId,
      month: targetMonth,
      totalCalls: matching.length,
      byEndpoint,
      avgDurationMs: matching.length > 0 ? Math.round(totalDuration / matching.length) : 0,
      errorCount: errors,
      uniqueEndpoints: Object.keys(byEndpoint).length,
    };
  },

  getTopEndpoints(tenantId: string, limit = 10): Array<{ endpoint: string; count: number }> {
    const summary = this.getSummary(tenantId);
    return Object.entries(summary.byEndpoint)
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },

  getAllTenantSummaries(month?: string): UsageSummary[] {
    const tenantIds = new Set(records.map(r => r.tenantId));
    return [...tenantIds].map(id => this.getSummary(id, month));
  },

  getRecent(tenantId: string, limit = 50): UsageRecord[] {
    return records.filter(r => r.tenantId === tenantId).slice(-limit).reverse();
  },
};
