// User rate limits — per-user rate limiting on top of IP-based limits
interface UserBucket { tokens: number; lastRefill: number; }
const buckets = new Map<string, UserBucket>();

export const userRateLimits = {
  check(userId: string, tenantId: string, max: number = 30, windowMs: number = 60_000): { allowed: boolean; remaining: number; resetInMs: number } {
    const key = `${tenantId}:${userId}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = { tokens: max, lastRefill: now };
      buckets.set(key, bucket);
    }

    const refillRate = max / windowMs;
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) bucket.tokens = Math.min(max, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;

    return { allowed, remaining: Math.floor(bucket.tokens), resetInMs: Math.ceil((max - bucket.tokens) / refillRate) };
  },

  getLimit(userId: string, tenantId: string, max: number): number {
    const key = `${tenantId}:${userId}`;
    const bucket = buckets.get(key);
    return bucket ? Math.floor(bucket.tokens) : max;
  },

  reset(userId: string, tenantId: string): void {
    buckets.delete(`${tenantId}:${userId}`);
  },
};
