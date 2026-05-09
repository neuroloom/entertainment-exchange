// Query performance — slow query tracking and analysis
export interface QueryRecord {
  id: string;
  tenantId: string;
  query: string;       // truncated
  durationMs: number;
  rowsAffected: number;
  tableName: string;
  timestamp: string;
  isSlow: boolean;
}

const records: QueryRecord[] = [];
const MAX_RECORDS = 10_000;
const SLOW_THRESHOLD_MS = 100;

export const queryPerf = {
  record(tenantId: string, query: string, durationMs: number, rowsAffected: number, tableName: string): void {
    const r: QueryRecord = {
      id: crypto.randomUUID(), tenantId,
      query: query.slice(0, 200), durationMs, rowsAffected, tableName,
      timestamp: new Date().toISOString(),
      isSlow: durationMs > SLOW_THRESHOLD_MS,
    };
    records.push(r);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  },

  getSlowQueries(tenantId: string, limit = 20): QueryRecord[] {
    return records
      .filter(r => r.tenantId === tenantId && r.isSlow)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, limit);
  },

  getTableStats(tenantId: string): Array<{ table: string; totalQueries: number; avgDurationMs: number; slowCount: number }> {
    const byTable = new Map<string, { count: number; totalMs: number; slow: number }>();
    for (const r of records) {
      if (r.tenantId !== tenantId) continue;
      const s = byTable.get(r.tableName) ?? { count: 0, totalMs: 0, slow: 0 };
      s.count++; s.totalMs += r.durationMs; if (r.isSlow) s.slow++;
      byTable.set(r.tableName, s);
    }
    return [...byTable.entries()].map(([table, s]) => ({
      table, totalQueries: s.count, avgDurationMs: Math.round(s.totalMs / s.count), slowCount: s.slow,
    })).sort((a, b) => b.avgDurationMs - a.avgDurationMs);
  },

  getTrend(tenantId: string, hours = 24): Array<{ hour: string; avgMs: number; count: number }> {
    const cutoff = Date.now() - hours * 3600000;
    const byHour = new Map<string, { totalMs: number; count: number }>();
    for (const r of records) {
      if (r.tenantId !== tenantId) continue;
      if (new Date(r.timestamp).getTime() < cutoff) continue;
      const hour = r.timestamp.slice(0, 13) + ':00';
      const s = byHour.get(hour) ?? { totalMs: 0, count: 0 };
      s.totalMs += r.durationMs; s.count++;
      byHour.set(hour, s);
    }
    return [...byHour.entries()].map(([hour, s]) => ({ hour, avgMs: Math.round(s.totalMs / s.count), count: s.count })).sort((a, b) => a.hour.localeCompare(b.hour));
  },
};
