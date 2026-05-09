// Tenant benchmarking — anonymized cross-tenant comparison metrics
export interface Benchmark {
  metric: string;
  tenantValue: number;
  platformAvg: number;
  platformMedian: number;
  topQuartile: number;
  percentile: number;       // Where this tenant ranks (0-100)
  trend: 'above_avg' | 'avg' | 'below_avg';
}

export const benchmarking = {
  compare(tenantId: string, metrics: Record<string, number>, allTenantMetrics: Array<{ tenantId: string; metrics: Record<string, number> }>): Benchmark[] {
    const results: Benchmark[] = [];

    for (const [metric, tenantValue] of Object.entries(metrics)) {
      const platformValues = allTenantMetrics.map(t => t.metrics[metric] ?? 0).filter(v => v > 0);
      if (platformValues.length < 2) {
        results.push({ metric, tenantValue, platformAvg: tenantValue, platformMedian: tenantValue, topQuartile: tenantValue, percentile: 50, trend: 'avg' });
        continue;
      }

      const sorted = [...platformValues].sort((a, b) => a - b);
      const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      const median = sorted[Math.floor(sorted.length / 2)];
      const topQuartile = sorted[Math.floor(sorted.length * 0.75)];

      // Higher percentile = better (more bookings, more revenue, etc.)
      const rank = sorted.filter(v => v < tenantValue).length;
      const percentile = Math.round(rank / sorted.length * 100);

      let trend: 'above_avg' | 'avg' | 'below_avg';
      if (tenantValue > avg * 1.2) trend = 'above_avg';
      else if (tenantValue < avg * 0.8) trend = 'below_avg';
      else trend = 'avg';

      results.push({ metric, tenantValue, platformAvg: Math.round(avg), platformMedian: median, topQuartile, percentile, trend });
    }

    return results;
  },

  generateSummary(tenantId: string, benchmarks: Benchmark[]): { strengths: string[]; opportunities: string[] } {
    const strengths = benchmarks.filter(b => b.trend === 'above_avg').map(b => `${b.metric}: top ${100 - b.percentile}%`);
    const opportunities = benchmarks.filter(b => b.trend === 'below_avg').map(b => `${b.metric}: bottom ${b.percentile}%`);
    return { strengths, opportunities };
  },
};
