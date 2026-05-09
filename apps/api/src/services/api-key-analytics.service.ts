// API key usage analytics — per-key usage tracking and patterns
interface KeyUsage {
  keyId: string;
  tenantId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  timestamp: string;
}

const usage: KeyUsage[] = [];
const MAX_USAGE = 50_000;

export const apiKeyAnalytics = {
  recordUsage(keyId: string, tenantId: string, endpoint: string, method: string, statusCode: number): void {
    usage.push({ keyId, tenantId, endpoint, method, statusCode, timestamp: new Date().toISOString() });
    if (usage.length > MAX_USAGE) usage.splice(0, usage.length - MAX_USAGE);
  },

  getKeySummary(keyId: string, tenantId: string): { totalCalls: number; lastUsed?: string; topEndpoints: Array<{ endpoint: string; count: number }>; errorRate: string } {
    const keyUsage = usage.filter(u => u.keyId === keyId && u.tenantId === tenantId);
    if (keyUsage.length === 0) return { totalCalls: 0, topEndpoints: [], errorRate: '0%' };

    const epMap = new Map<string, number>();
    let errors = 0;
    let lastUsed = '';

    for (const u of keyUsage) {
      epMap.set(u.endpoint, (epMap.get(u.endpoint) ?? 0) + 1);
      if (u.statusCode >= 400) errors++;
      if (!lastUsed || u.timestamp > lastUsed) lastUsed = u.timestamp;
    }

    return {
      totalCalls: keyUsage.length, lastUsed,
      topEndpoints: [...epMap.entries()].map(([e, c]) => ({ endpoint: e, count: c })).sort((a, b) => b.count - a.count).slice(0, 5),
      errorRate: ((errors / keyUsage.length) * 100).toFixed(1) + '%',
    };
  },

  getTenantSummary(tenantId: string): { totalCalls: number; uniqueKeys: number; byKey: Record<string, number> } {
    const tenantUsage = usage.filter(u => u.tenantId === tenantId);
    const byKey: Record<string, number> = {};
    for (const u of tenantUsage) {
      byKey[u.keyId] = (byKey[u.keyId] ?? 0) + 1;
    }
    return { totalCalls: tenantUsage.length, uniqueKeys: Object.keys(byKey).length, byKey };
  },
};
