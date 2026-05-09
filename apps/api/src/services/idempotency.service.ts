// Idempotency service — prevent duplicate mutations with key-based deduplication
export interface IdempotencyRecord {
  key: string;
  tenantId: string;
  response: { statusCode: number; body: unknown };
  createdAt: string;
  expiresAt: string;
}

const records: IdempotencyRecord[] = [];
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const idempotency = {
  check(key: string, tenantId: string): IdempotencyRecord | null {
    const rec = records.find(r => r.key === key && r.tenantId === tenantId);
    if (!rec) return null;
    if (new Date(rec.expiresAt) < new Date()) {
      // Expired — remove and allow retry
      const idx = records.indexOf(rec);
      records.splice(idx, 1);
      return null;
    }
    return rec;
  },

  store(key: string, tenantId: string, statusCode: number, body: unknown, ttlMs?: number): void {
    records.push({
      key, tenantId, response: { statusCode, body },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    });
    // Prevent unbounded growth
    if (records.length > 10_000) records.splice(0, records.length - 10_000);
  },

  clearForTenant(tenantId: string): number {
    const before = records.length;
    const remaining = records.filter(r => r.tenantId !== tenantId);
    records.length = 0;
    records.push(...remaining);
    return before - records.length;
  },
};
