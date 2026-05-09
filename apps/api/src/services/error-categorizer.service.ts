// Error categorizer — classify errors by type for pattern analysis
export interface ErrorCategory {
  category: string;
  count: number;
  pctOfTotal: number;
  examples: string[];
}

interface ErrorRecord { tenantId: string; statusCode: number; message: string; endpoint: string; timestamp: string; }
const records: ErrorRecord[] = [];
const MAX = 10_000;

const CATEGORY_MAP: Record<number, string> = {
  400: 'validation', 401: 'authentication', 403: 'authorization',
  404: 'not_found', 409: 'conflict', 422: 'validation',
  429: 'rate_limit', 500: 'internal', 502: 'upstream', 503: 'unavailable',
};

export const errorCategorizer = {
  record(tenantId: string, statusCode: number, message: string, endpoint: string): void {
    if (statusCode < 400) return;
    records.push({ tenantId, statusCode, message, endpoint, timestamp: new Date().toISOString() });
    if (records.length > MAX) records.splice(0, records.length - MAX);
  },

  getCategories(tenantId: string, hours = 24): ErrorCategory[] {
    const cutoff = Date.now() - hours * 3600000;
    const filtered = records.filter(r => r.tenantId === tenantId && new Date(r.timestamp).getTime() > cutoff);
    const total = filtered.length;

    const byCategory = new Map<string, { count: number; examples: string[] }>();
    for (const r of filtered) {
      const cat = CATEGORY_MAP[r.statusCode] ?? 'other';
      const s = byCategory.get(cat) ?? { count: 0, examples: [] };
      s.count++;
      if (s.examples.length < 3) s.examples.push(`${r.statusCode}: ${r.message.slice(0, 60)}`);
      byCategory.set(cat, s);
    }

    return [...byCategory.entries()]
      .map(([category, s]) => ({ category, count: s.count, pctOfTotal: total > 0 ? Math.round(s.count / total * 100) : 0, examples: s.examples }))
      .sort((a, b) => b.count - a.count);
  },

  getTopErrors(tenantId: string, limit = 10): Array<{ endpoint: string; statusCode: number; count: number; lastSeen: string }> {
    const byKey = new Map<string, { count: number; lastSeen: string }>();
    for (const r of records) {
      if (r.tenantId !== tenantId) continue;
      const key = `${r.statusCode} ${r.endpoint}`;
      const s = byKey.get(key) ?? { count: 0, lastSeen: '' };
      s.count++;
      if (r.timestamp > s.lastSeen) s.lastSeen = r.timestamp;
      byKey.set(key, s);
    }
    return [...byKey.entries()]
      .map(([key, s]) => { const [code, ...ep] = key.split(' '); return { endpoint: ep.join(' '), statusCode: parseInt(code), count: s.count, lastSeen: s.lastSeen }; })
      .sort((a, b) => b.count - a.count).slice(0, limit);
  },
};
