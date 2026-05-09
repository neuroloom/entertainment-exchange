// Auth routes — register, login, refresh, session management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { createToken, generateRefreshToken, refreshTokenExpiresAt, withAuth } from '../plugins/auth.plugin.js';
import { AppError } from '../plugins/errorHandler.js';
import { MemoryStore } from '../services/repo.js';
import { storeRefreshToken as persistRefreshToken, consumeRefreshToken } from '../services/token-store.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  tenantName: z.string().min(1).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', 'qwerty123',
  'admin123', 'letmein1', 'welcome1', 'monkey123', 'dragon123',
]);

// ── Password hashing (bcrypt-like via Web Crypto API) ───────────────────────

async function hashPassword(password: string): Promise<string> {
  // Use PBKDF2 via Web Crypto API (available in Node 20+)
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256,
  );
  const hashHex = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt, b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256,
  );
  const computed = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  return computed === hashHex;
}

// ── Stores ──────────────────────────────────────────────────────────────────

const users = new MemoryStore('users');
const tenants = new MemoryStore('tenants');
const memberships = new MemoryStore('memberships');

// ── Routes ──────────────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const body = RegisterSchema.parse(req.body);

    // Password strength check
    if (COMMON_PASSWORDS.has(body.password.toLowerCase())) {
      throw AppError.invalid('Password is too common. Choose a stronger password.');
    }

    const existing = users.find(u => u.email === body.email);
    if (existing) throw AppError.conflict('Email already registered');

    const passwordHash = await hashPassword(body.password);
    const tenantId = uuid();
    const tenantSlug = body.tenantName?.toLowerCase().replace(/\s+/g, '-') ?? `tenant-${uuid().slice(0, 8)}`;
    tenants.set({ id: tenantId, name: body.tenantName ?? 'My Business', slug: tenantSlug, tenantId });

    const userId = uuid();
    users.set({
      id: userId, email: body.email, passwordHash,
      firstName: body.firstName, lastName: body.lastName,
      role: 'tenant_admin', tenantId,
    });

    const membershipId = uuid();
    memberships.set({ id: membershipId, tenantId, userId, role: 'tenant_admin' });

    (req as any).ctx = {
      requestId: uuid(), traceId: uuid(),
      tenantId, actor: { type: 'human', id: userId, userId, roles: ['tenant_admin'], permissions: ['business:create', 'business:manage'] },
    };

    reply.status(201).send({
      data: {
        user: { id: userId, email: body.email },
        tenant: { id: tenantId, name: tenants.get(tenantId)!.name },
        membership: { role: 'tenant_admin' },
      },
    });
  });

  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = LoginSchema.parse(req.body);
    const user = users.find(u => u.email === email);
    if (!user) throw AppError.unauthenticated('Invalid credentials');

    const isValid = await verifyPassword(password, user.passwordHash ?? user.password ?? '');
    if (!isValid) throw AppError.unauthenticated('Invalid credentials');

    const permissions = ['business:create', 'business:manage'];
    const token = await createToken(user.id, user.tenantId, permissions);
    const refreshToken = generateRefreshToken();
    persistRefreshToken(refreshToken, user.id, user.tenantId, refreshTokenExpiresAt());

    (req as any).ctx = {
      requestId: uuid(), traceId: uuid(),
      tenantId: user.tenantId,
      actor: { type: 'human', id: user.id, userId: user.id, roles: [user.role], permissions },
    };

    reply.send({ data: { token, refreshToken, userId: user.id, tenantId: user.tenantId, role: user.role } });
  });

  app.post('/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { refreshToken } = RefreshSchema.parse(req.body);
    const stored = consumeRefreshToken(refreshToken);
    if (!stored) {
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }

    // Issue new rotated token
    const permissions = ['business:create', 'business:manage'];
    const token = await createToken(stored.userId, stored.tenantId, permissions);
    const newRefresh = generateRefreshToken();
    persistRefreshToken(newRefresh, stored.userId, stored.tenantId, refreshTokenExpiresAt());

    reply.send({ data: { token, refreshToken: newRefresh } });
  });

  app.get('/me', { preHandler: withAuth() }, async (req, reply) => {
    const ctx = (req as any).ctx;
    const user = users.get(ctx.actor.userId);
    if (!user) throw AppError.notFound('User');
    // Never expose password hash
    const { passwordHash, password, ...safe } = user;
    reply.send({ data: safe });
  });
}
