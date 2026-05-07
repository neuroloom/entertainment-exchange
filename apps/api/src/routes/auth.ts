// Auth routes — register, login, session management
// Task 004: Auth, RBAC, Audit — Route matrix: POST /auth/register → users, memberships
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { createToken } from '../plugins/auth.plugin.js';
import { AppError } from '../plugins/errorHandler.js';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  tenantName: z.string().min(1).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// In-memory stores for MVP (Postgres migration pending)
const users = new Map<string, { id: string; email: string; password: string; firstName?: string; lastName?: string; role: string; tenantId: string }>();
const tenants = new Map<string, { id: string; name: string; slug: string }>();
const memberships = new Map<string, { id: string; tenantId: string; userId: string; role: string }>();

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);

    const tenantId = uuid();
    const tenantSlug = body.tenantName?.toLowerCase().replace(/\s+/g, '-') ?? `tenant-${uuid().slice(0, 8)}`;
    tenants.set(tenantId, { id: tenantId, name: body.tenantName ?? 'My Business', slug: tenantSlug });

    const userId = uuid();
    users.set(userId, { id: userId, email: body.email, password: body.password, firstName: body.firstName, lastName: body.lastName, role: 'tenant_admin', tenantId });

    const membershipId = uuid();
    memberships.set(membershipId, { id: membershipId, tenantId, userId, role: 'tenant_admin' });

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

  app.post('/login', async (req, reply) => {
    const { email, password } = LoginSchema.parse(req.body);
    const user = [...users.values()].find(u => u.email === email && u.password === password);
    if (!user) throw AppError.unauthenticated('Invalid credentials');

    const permissions = ['business:create', 'business:manage'];
    const token = await createToken(user.id, user.tenantId, permissions);

    (req as any).ctx = {
      requestId: uuid(), traceId: uuid(),
      tenantId: user.tenantId,
      actor: { type: 'human', id: user.id, userId: user.id, roles: [user.role], permissions },
    };

    reply.send({ data: { token, userId: user.id, tenantId: user.tenantId, role: user.role } });
  });

  app.get('/me', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.actor?.userId) throw AppError.unauthenticated('Not authenticated');
    const user = users.get(ctx.actor.userId);
    reply.send({ data: user ?? null });
  });
}
