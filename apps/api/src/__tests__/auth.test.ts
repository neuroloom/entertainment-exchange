// Auth route tests — register, login, me
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';

let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  // JWT_SECRET is required by the auth plugin for HS256 token signing
  process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/v1/auth/register', () => {
  it('returns 201 with user, tenant, and membership', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'register-success@test.com',
        password: 'secure-test-pass-99',
        firstName: 'Alice',
        lastName: 'Jones',
        tenantName: 'Alice Corp',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.user.email).toBe('register-success@test.com');
    expect(body.data.user).toHaveProperty('id');
    expect(body.data.tenant.name).toBe('Alice Corp');
    expect(body.data.tenant).toHaveProperty('id');
    expect(body.data.membership.role).toBe('tenant_admin');
  });

  it('returns 201 with default tenant name when tenantName omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'no-tenant@test.com', password: 'secure-test-pass-99' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.tenant.name).toBe('My Business');
    expect(body.data.user.email).toBe('no-tenant@test.com');
  });

  it('returns 400 on invalid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'notanemail', password: 'secure-test-pass-99' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('email');
  });

  it('returns 400 on short password (less than 8 chars)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'shortpw@test.com', password: '1234567' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('password');
  });

  it('returns 400 on missing email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { password: 'secure-test-pass-99' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with valid credentials', async () => {
    // Register first so the user exists
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'login-user@test.com', password: 'correctpass' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'login-user@test.com', password: 'correctpass' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveProperty('userId');
    expect(body.data).toHaveProperty('tenantId');
    expect(body.data.role).toBe('tenant_admin');
  });

  it('returns 401 on wrong password', async () => {
    // Register first
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'wrongpw@test.com', password: 'correctpass' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'wrongpw@test.com', password: 'WRONGPASSWORD' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Invalid credentials');
  });

  it('returns 401 on nonexistent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@test.com', password: 'secure-test-pass-99' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 400 on invalid email format in login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'badformat', password: 'secure-test-pass-99' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 200 with valid auth context', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'me-user@test.com', password: 'secure-test-pass-99' },
    });
    const userId = JSON.parse(regRes.body).data.user.id;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        'x-actor-id': userId,
        'x-actor-type': 'human',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.email).toBe('me-user@test.com');
    expect(body.data.role).toBe('tenant_admin');
  });

  it('returns 401 without auth headers (no x-actor-id)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      // No x-actor-id header → ctx.actor.userId is undefined
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Authentication required');
  });

  it('returns 401 with empty x-actor-id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { 'x-actor-id': '' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});
