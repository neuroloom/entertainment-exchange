// Session routes — list and revoke active user sessions
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { sessionManager } from '../services/session-manager.service.js';

export async function sessionRoutes(app: FastifyInstance) {
  app.get('/sessions', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');
    reply.send({ data: sessionManager.listForUser(userId, ctx.tenantId) });
  });

  app.get('/sessions/stats', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: sessionManager.stats(ctx.tenantId) });
  });

  app.delete('/sessions/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = sessionManager.revoke(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Session');
    reply.send({ data: { revoked: true } });
  });

  app.post('/sessions/revoke-all', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');
    const count = sessionManager.revokeAllForUser(userId, ctx.tenantId);
    reply.send({ data: { revoked: count } });
  });
}
