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

export async function cleanupExpiredTokens(): Promise<number> {
  const now = Date.now();
  let cleaned = 0;
  for (const [k, v] of inMemoryFallback) {
    if (v.expiresAt < now) {
      store.delete(k);
      inMemoryFallback.delete(k);
      cleaned++;
    }
  }
  // Sweep store values that were hydrated from PG but not in the in-memory fallback
  for (const item of store.values()) {
    if (item.expiresAt < now) {
      store.delete(item.id);
      cleaned++;
    }
  }
  return cleaned;
}
