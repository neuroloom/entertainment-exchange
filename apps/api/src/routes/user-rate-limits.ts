// User rate limits routes — per-user rate limiting configuration
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { userRateLimits } from '../services/user-rate-limits.service.js';

export async function userRateLimitRoutes(app: FastifyInstance) {
  app.get('/rate-limits/user/:userId', async (req, reply) => {
    const ctx = req.ctx;
    const userId = params(req).userId;
    const check = userRateLimits.check(userId, ctx.tenantId);
    reply.send({ data: { userId, ...check } });
  });

  app.post('/rate-limits/user/:userId/reset', async (req, reply) => {
    const ctx = req.ctx;
    userRateLimits.reset(params(req).userId, ctx.tenantId);
    reply.send({ data: { reset: true } });
  });
}
