import { describe, it, expect } from 'vitest';
import { storeRefreshToken, consumeRefreshToken, cleanupExpiredTokens } from '../services/token-store.js';

describe('tokenStore', () => {
  it('stores and consumes a valid token', () => {
    const expiresAt = Date.now() + 3600_000;
    storeRefreshToken('valid-token', 'user-1', 'tenant-1', expiresAt);

    const stored = consumeRefreshToken('valid-token');
    expect(stored).toBeDefined();
    expect(stored!.userId).toBe('user-1');
    expect(stored!.tenantId).toBe('tenant-1');
    expect(stored!.expiresAt).toBe(expiresAt);
  });

  it('returns undefined for unknown token', () => {
    expect(consumeRefreshToken('nonexistent')).toBeUndefined();
  });

  it('returns undefined for expired token', () => {
    const expiredAt = Date.now() - 1000; // 1 second ago
    storeRefreshToken('expired-token', 'user-1', 'tenant-1', expiredAt);

    expect(consumeRefreshToken('expired-token')).toBeUndefined();
  });

  it('consumes token only once (single-use)', () => {
    storeRefreshToken('once-token', 'user-1', 'tenant-1', Date.now() + 3600_000);

    const first = consumeRefreshToken('once-token');
    expect(first).toBeDefined();

    const second = consumeRefreshToken('once-token');
    expect(second).toBeUndefined();
  });

  it('cleanup removes expired tokens', async () => {
    storeRefreshToken('keep-token', 'user-1', 'tenant-1', Date.now() + 3600_000);
    storeRefreshToken('expire-token', 'user-2', 'tenant-1', Date.now() - 1000);
    storeRefreshToken('also-expired', 'user-3', 'tenant-1', Date.now() - 5000);

    const cleaned = await cleanupExpiredTokens();
    expect(cleaned).toBeGreaterThanOrEqual(2);
    expect(consumeRefreshToken('keep-token')).toBeDefined();
  });
});
