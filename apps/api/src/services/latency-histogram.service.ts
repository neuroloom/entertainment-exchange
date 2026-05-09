// Latency histogram — detailed response time distribution analysis
interface LatencySample { tenantId: string; endpoint: string; durationMs: number; timestamp: string; }
const samples: LatencySample[] = [];
const MAX_SAMPLES = 50_000;

const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export const latencyHistogram = {
  record(tenantId: string, endpoint: string, durationMs: number): void {
    samples.push({ tenantId, endpoint, durationMs, timestamp: new Date().toISOString() });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  },

  getDistribution(tenantId: string, hours = 24): Record<string, number> {
    const cutoff = Date.now() - hours * 3600000;
    const filtered = samples.filter(s => s.tenantId === tenantId && new Date(s.timestamp).getTime() > cutoff);
    const dist: Record<string, number> = {};

    for (const s of filtered) {
      let bucket = `${BUCKETS[BUCKETS.length - 1]}+`;
      for (const b of BUCKETS) {
        if (s.durationMs <= b) { bucket = `≤${b}ms`; break; }
      }
      dist[bucket] = (dist[bucket] ?? 0) + 1;
    }

    return dist;
  },

  getPercentiles(tenantId: string, hours = 24): { p50: number; p75: number; p90: number; p95: number; p99: number; max: number; count: number } {
    const cutoff = Date.now() - hours * 3600000;
    const filtered = samples
      .filter(s => s.tenantId === tenantId && new Date(s.timestamp).getTime() > cutoff)
      .map(s => s.durationMs)
      .sort((a, b) => a - b);

    if (filtered.length === 0) return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0, count: 0 };

    const p = (pct: number) => filtered[Math.floor(filtered.length * pct)];
    return {
      p50: p(0.5), p75: p(0.75), p90: p(0.9), p95: p(0.95), p99: p(0.99),
      max: filtered[filtered.length - 1], count: filtered.length,
    };
  },

  getSlowest(tenantId: string, limit = 10): Array<{ endpoint: string; durationMs: number; timestamp: string }> {
    return samples
      .filter(s => s.tenantId === tenantId)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, limit);
  },
};
