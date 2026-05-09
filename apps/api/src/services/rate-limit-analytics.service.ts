// Rate limit analytics — track rate limit hits and patterns per tenant
interface RateLimitHit {
  tenantId: string;
  ip: string;
  endpoint: string;
  timestamp: string;
}

const hits: RateLimitHit[] = [];
const MAX_HITS = 20_000;

export const rateLimitAnalytics = {
  recordHit(tenantId: string, ip: string, endpoint: string): void {
    hits.push({ tenantId, ip, endpoint, timestamp: new Date().toISOString() });
    if (hits.length > MAX_HITS) hits.splice(0, hits.length - MAX_HITS);
  },

  getTrend(tenantId: string, hours = 24): Array<{ hour: string; count: number }> {
    const cutoff = Date.now() - hours * 3600000;
    const buckets = new Map<string, number>();

    for (const h of hits) {
      if (h.tenantId !== tenantId) continue;
      if (new Date(h.timestamp).getTime() < cutoff) continue;
      const hour = h.timestamp.slice(0, 13) + ':00';
      buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
    }

    return [...buckets.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour.localeCompare(b.hour));
  },

  getTopIps(tenantId: string, limit = 10): Array<{ ip: string; count: number; lastHit: string }> {
    const ipMap = new Map<string, { count: number; lastHit: string }>();
    for (const h of hits) {
      if (h.tenantId !== tenantId) continue;
      const existing = ipMap.get(h.ip);
      if (existing) { existing.count++; if (h.timestamp > existing.lastHit) existing.lastHit = h.timestamp; }
      else ipMap.set(h.ip, { count: 1, lastHit: h.timestamp });
    }
    return [...ipMap.entries()].map(([ip, v]) => ({ ip, ...v })).sort((a, b) => b.count - a.count).slice(0, limit);
  },

  getTopEndpoints(tenantId: string, limit = 10): Array<{ endpoint: string; count: number }> {
    const epMap = new Map<string, number>();
    for (const h of hits) {
      if (h.tenantId !== tenantId) continue;
      epMap.set(h.endpoint, (epMap.get(h.endpoint) ?? 0) + 1);
    }
    return [...epMap.entries()].map(([endpoint, count]) => ({ endpoint, count })).sort((a, b) => b.count - a.count).slice(0, limit);
  },
};
