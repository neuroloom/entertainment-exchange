// Rate limit plugin — token bucket algorithm (in-memory, no Redis dependency)
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface RateLimitOptions {
  /** Maximum number of requests allowed within the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  max: 100,
  windowMs: 60_000, // 60 seconds
};

/** Paths exempt from rate limiting — health checks and metrics must always be reachable */
const EXEMPT_PATHS = new Set(['/health', '/metrics']);

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export async function rateLimitPlugin(
  app: FastifyInstance,
  options: Partial<RateLimitOptions> = {},
) {
  const opts: RateLimitOptions = { ...DEFAULT_OPTIONS, ...options };
  const refillRate = opts.max / opts.windowMs; // tokens per ms

  // Per-IP token buckets
  const buckets = new Map<string, TokenBucket>();

  // Auto-clean expired entries every 60s
  // An entry is expired if it hasn't been touched for 2x the window duration.
  // Using 2x window ensures buckets from idle IPs are removed but active
  // rate-limited IPs are kept (they'll be hit again within the window).
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    const cutoff = now - opts.windowMs * 2;
    for (const [ip, bucket] of buckets) {
      if (bucket.lastRefill < cutoff) {
        buckets.delete(ip);
      }
    }
  }, 60_000);

  // Ensure cleanup timer doesn't keep the process alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Exempt health and metrics endpoints from rate limiting
    if (EXEMPT_PATHS.has(req.url)) return;

    const ip = getClientIp(req);
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { tokens: opts.max, lastRefill: now };
      buckets.set(ip, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      const newTokens = elapsed * refillRate;
      bucket.tokens = Math.min(opts.max, bucket.tokens + newTokens);
    }
    bucket.lastRefill = now;

    // Rate limit headers on all responses
    const resetTime = Math.ceil((now + (opts.max - bucket.tokens) / refillRate) / 1000);
    reply.header('X-RateLimit-Limit', opts.max);
    reply.header('X-RateLimit-Remaining', Math.max(0, Math.floor(bucket.tokens)));
    reply.header('X-RateLimit-Reset', resetTime);

    // Consume 1 token per request
    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate / 1000);
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          retryAfter,
        },
      });
    }

    bucket.tokens -= 1;
  });
}

/** Extract the client IP from the request.
 *  Only trusts proxy headers when TRUST_PROXY is set (e.g. behind nginx/load balancer).
 *  Otherwise uses the direct connection IP to prevent X-Forwarded-For spoofing. */
function getClientIp(req: FastifyRequest): string {
  const trustProxy = process.env.TRUST_PROXY === 'true';
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'] as string | undefined;
    if (xff) return xff.split(',')[0].trim();
    const realIp = req.headers['x-real-ip'] as string | undefined;
    if (realIp) return realIp;
  }
  return req.ip;
}
