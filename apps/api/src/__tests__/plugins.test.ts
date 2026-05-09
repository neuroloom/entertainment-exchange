// Plugins tests — errorHandler AppError factories, paginate(), rateLimitPlugin
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { AppError, errorHandlerPlugin } from '../plugins/errorHandler.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import type { Pagination } from '../plugins/paginate.plugin.js';
import { rateLimitPlugin } from '../plugins/rate-limit.plugin.js';

describe('AppError factory methods', () => {
  it('base constructor sets code, message, status, details', () => {
    const err = new AppError('TEST', 'Something happened', 418, { key: 'val' });
    expect(err.code).toBe('TEST');
    expect(err.message).toBe('Something happened');
    expect(err.status).toBe(418);
    expect(err.details).toEqual({ key: 'val' });
  });

  it('forbidden returns 403 with FORBIDDEN code', () => {
    const err = AppError.forbidden('Nope');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('Nope');
    expect(err.status).toBe(403);
  });

  it('forbidden defaults message to "Forbidden"', () => {
    const err = AppError.forbidden();
    expect(err.message).toBe('Forbidden');
    expect(err.status).toBe(403);
  });

  it('notFound formats resource name', () => {
    const err = AppError.notFound('Widget');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Widget not found');
    expect(err.status).toBe(404);
  });

  it('invalid returns 400 with INVALID_INPUT code', () => {
    const err = AppError.invalid('Bad data');
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toBe('Bad data');
    expect(err.status).toBe(400);
  });

  it('conflict returns 409 with CONFLICT code', () => {
    const err = AppError.conflict('Duplicate');
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('Duplicate');
    expect(err.status).toBe(409);
  });

  it('tenantRequired returns 400 with TENANT_REQUIRED', () => {
    const err = AppError.tenantRequired();
    expect(err.code).toBe('TENANT_REQUIRED');
    expect(err.message).toBe('X-Tenant-ID header required');
    expect(err.status).toBe(400);
  });

  it('unauthenticated returns 401 with UNAUTHENTICATED', () => {
    const err = AppError.unauthenticated('No token');
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.message).toBe('No token');
    expect(err.status).toBe(401);
  });

  it('unauthenticated defaults message', () => {
    const err = AppError.unauthenticated();
    expect(err.message).toBe('Unauthenticated');
  });
});

describe('errorHandlerPlugin', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    // Fastify v5 encapsulation: error handlers must be set on the root scope,
    // not inside a register() call. Call the plugin function directly.
    await errorHandlerPlugin(app);

    // Route that throws AppError
    app.get('/throw-app-error', async () => {
      throw AppError.forbidden('Test forbidden');
    });

    // Route that throws a generic Error
    app.get('/throw-error', async () => {
      throw new Error('Boom!');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles AppError with correct status and body', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/throw-app-error',
      headers: { 'x-request-id': 'req-1' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('Test forbidden');
  });

  it('handles generic Error as 500 Internal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/throw-error',
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('Internal server error');
  });
});

describe('paginate', () => {
  it('returns defaults when query is empty', () => {
    const result = paginate({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('returns defaults when query is undefined', () => {
    const result = paginate(undefined as any);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('parses valid limit from query string', () => {
    const result = paginate({ limit: '50' });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('clamps limit to MAX_LIMIT (100)', () => {
    const result = paginate({ limit: '500' });
    expect(result.limit).toBe(100);
  });

  it('converts negative limit to positive via Math.abs', () => {
    // Math.abs(-5) = 5, then clamp between 1 and 100 → 5
    const result = paginate({ limit: '-5' });
    expect(result.limit).toBe(5);
  });

  it('handles NaN limit by using default', () => {
    const result = paginate({ limit: 'not-a-number' });
    expect(result.limit).toBe(20);
  });

  it('parses valid offset from query string', () => {
    const result = paginate({ offset: '30' });
    expect(result.offset).toBe(30);
    expect(result.limit).toBe(20);
  });

  it('converts negative offset to positive via Math.abs', () => {
    // Math.abs(-10) = 10, then Math.max(0, 10) → 10
    const result = paginate({ offset: '-10' });
    expect(result.offset).toBe(10);
  });

  it('handles NaN offset by using default', () => {
    const result = paginate({ offset: 'abc' });
    expect(result.offset).toBe(0);
  });

  it('handles fractional limit by flooring', () => {
    const result = paginate({ limit: '25.7' });
    expect(result.limit).toBe(25);
  });

  it('handles fractional offset by flooring', () => {
    const result = paginate({ offset: '15.9' });
    expect(result.offset).toBe(15);
  });

  it('parses both limit and offset together', () => {
    const result = paginate({ limit: '75', offset: '200' });
    expect(result.limit).toBe(75);
    expect(result.offset).toBe(200);
  });

  it('handles very large offset', () => {
    const result = paginate({ offset: '999999' });
    expect(result.offset).toBe(999999);
  });
});

describe('paginatedResponse', () => {
  it('builds the correct response envelope', () => {
    const data = [{ id: '1' }, { id: '2' }];
    const pagination: Pagination = { limit: 10, offset: 5 };
    const result = paginatedResponse(data, 42, pagination);

    expect(result.data).toEqual(data);
    expect(result.total).toBe(42);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(5);
  });

  it('handles empty data array', () => {
    const pagination: Pagination = { limit: 20, offset: 0 };
    const result = paginatedResponse([], 0, pagination);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.limit).toBe(20);
  });
});

describe('rateLimitPlugin', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();

    // Register routes first, then the rate limit plugin hook
    app.get('/limited', async (_req: any, reply: any) => {
      reply.send({ ok: true });
    });

    app.get('/health', async (_req: any, reply: any) => {
      reply.send({ status: 'ok' });
    });

    app.get('/metrics', async (_req: any, reply: any) => {
      reply.send({ up: true });
    });

    // Call the rate limit plugin directly (not via register) so the hook
    // attaches to the root scope and covers routes registered both before and after.
    await rateLimitPlugin(app, { max: 3, windowMs: 60_000 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests within the limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/limited' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
  });

  it('rate-limits after exceeding max', async () => {
    // Consume all tokens (max is 3): first request already used above + 2 more = 3 total
    await app.inject({ method: 'GET', url: '/limited' });
    await app.inject({ method: 'GET', url: '/limited' });
    // This is the 4th request — should be rate limited
    const res = await app.inject({ method: 'GET', url: '/limited' });
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toBe('Too many requests');
    expect(body.error).toHaveProperty('retryAfter');
  });

  it('exempts health endpoint from rate limiting', async () => {
    // Should always succeed regardless of rate limit state
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('exempts metrics endpoint from rate limiting', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
  });
});
