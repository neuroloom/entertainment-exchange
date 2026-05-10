// Cache warmer — pre-populate caches for hot data paths
interface WarmRule { tenantId: string; path: string; ttlMs: number; priority: number; lastWarmedAt?: string; }
const rules: WarmRule[] = [];

export const cacheWarmer = {
  addRule(tenantId: string, path: string, ttlMs: number = 30_000, priority: number = 1): WarmRule {
    const r: WarmRule = { tenantId, path, ttlMs, priority };
    rules.push(r);
    return r;
  },

  listRules(tenantId: string): WarmRule[] {
    return rules.filter(r => r.tenantId === tenantId).sort((a, b) => b.priority - a.priority);
  },

  removeRule(tenantId: string, path: string): boolean {
    const idx = rules.findIndex(r => r.tenantId === tenantId && r.path === path);
    if (idx === -1) return false;
    rules.splice(idx, 1);
    return true;
  },

  getDueWarms(tenantId: string): WarmRule[] {
    const now = Date.now();
    return rules.filter(r => r.tenantId === tenantId && (!r.lastWarmedAt || now - new Date(r.lastWarmedAt).getTime() > r.ttlMs));
  },

  recordWarm(tenantId: string, path: string): void {
    const r = rules.find(rr => rr.tenantId === tenantId && rr.path === path);
    if (r) r.lastWarmedAt = new Date().toISOString();
  },

  getRecommendedRules(_tenantId: string): Array<{ path: string; reason: string; suggestedTtl: number; suggestedPriority: number }> {
    return [
      { path: '/api/v1/dashboard', reason: 'Most-accessed overview', suggestedTtl: 30_000, suggestedPriority: 10 },
      { path: '/api/v1/activity', reason: 'Frequently polled feed', suggestedTtl: 15_000, suggestedPriority: 8 },
      { path: '/api/v1/businesses', reason: 'Core entity list', suggestedTtl: 60_000, suggestedPriority: 7 },
      { path: '/api/v1/search?q=*', reason: 'Search results', suggestedTtl: 30_000, suggestedPriority: 5 },
    ];
  },
};
