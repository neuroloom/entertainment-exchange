// Endpoint popularity — usage ranking and adoption metrics
interface EndpointHit { tenantId: string; path: string; method: string; statusCode: number; timestamp: string; }
const hits: EndpointHit[] = [];
const MAX_HITS = 50_000;

export const endpointPopularity = {
  record(tenantId: string, path: string, method: string, statusCode: number): void {
    hits.push({ tenantId, path, method, statusCode, timestamp: new Date().toISOString() });
    if (hits.length > MAX_HITS) hits.splice(0, hits.length - MAX_HITS);
  },

  getRankings(tenantId: string, hours = 24): Array<{ endpoint: string; calls: number; pctOfTotal: number; avgStatus: number }> {
    const cutoff = Date.now() - hours * 3600000;
    const filtered = hits.filter(h => h.tenantId === tenantId && new Date(h.timestamp).getTime() > cutoff);
    const total = filtered.length;

    const byEndpoint = new Map<string, { count: number; statusSum: number }>();
    for (const h of filtered) {
      const key = `${h.method} ${h.path}`;
      const s = byEndpoint.get(key) ?? { count: 0, statusSum: 0 };
      s.count++; s.statusSum += h.statusCode;
      byEndpoint.set(key, s);
    }

    return [...byEndpoint.entries()]
      .map(([endpoint, s]) => ({ endpoint, calls: s.count, pctOfTotal: total > 0 ? Math.round(s.count / total * 1000) / 10 : 0, avgStatus: Math.round(s.statusSum / s.count) }))
      .sort((a, b) => b.calls - a.calls);
  },

  getAdoptionTrend(tenantId: string, days = 30): Array<{ date: string; uniqueEndpoints: number; totalCalls: number }> {
    const cutoff = Date.now() - days * 24 * 3600000;
    const byDay = new Map<string, { endpoints: Set<string>; calls: number }>();
    for (const h of hits) {
      if (h.tenantId !== tenantId) continue;
      if (new Date(h.timestamp).getTime() < cutoff) continue;
      const day = h.timestamp.slice(0, 10);
      const s = byDay.get(day) ?? { endpoints: new Set(), calls: 0 };
      s.endpoints.add(`${h.method} ${h.path}`); s.calls++;
      byDay.set(day, s);
    }
    return [...byDay.entries()].map(([date, s]) => ({ date, uniqueEndpoints: s.endpoints.size, totalCalls: s.calls })).sort((a, b) => a.date.localeCompare(b.date));
  },
};
