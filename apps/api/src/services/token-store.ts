// Persisted refresh token store — backed by PG via MemoryStore, surviving restarts
import { MemoryStore } from './repo.js';

interface StoredToken {
  id: string;
  userId: string;
  tenantId: string;
  expiresAt: number;
}

const store = new MemoryStore<StoredToken>('refresh_tokens');
const inMemoryFallback = new Map<string, StoredToken>();

export function storeRefreshToken(
  token: string,
  userId: string,
  tenantId: string,
  expiresAt: number,
): void {
  const record: StoredToken = { id: token, userId, tenantId, expiresAt };
  store.set(record);
  inMemoryFallback.set(token, record);
}

export function consumeRefreshToken(token: string): StoredToken | undefined {
  // Fast path: check in-memory first (avoids PG roundtrip on hot reads)
  const cached = inMemoryFallback.get(token);
  const stored = cached ?? store.get(token);
  if (!stored) return undefined;
  if (stored.expiresAt < Date.now()) {
    store.delete(token);
    inMemoryFallback.delete(token);
    return undefined;
  }
  // Single-use: consume on read
  store.delete(token);
  inMemoryFallback.delete(token);
  return stored;
}

export function cleanupExpiredTokens(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [k, v] of inMemoryFallback) {
    if (v.expiresAt < now) {
      store.delete(k);
      inMemoryFallback.delete(k);
      cleaned++;
    }
  }
  // Background: also sweep PG rows (best-effort)
  const pool = (store as any)._pool;
  if (pool) {
    pool.query('DELETE FROM refresh_tokens WHERE expires_at < $1', [now]).catch(() => {});
  }
  return cleaned;
}
