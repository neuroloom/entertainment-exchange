// MFA recovery routes — generate and use recovery codes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { mfaRecovery } from '../services/mfa-recovery.service.js';

export async function mfaRecoveryRoutes(app: FastifyInstance) {
  app.post('/auth/2fa/recovery-codes', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    const codes = await mfaRecovery.generateCodes(userId, ctx.tenantId);
    reply.status(201).send({ data: { codes, message: 'Store these codes securely. Each code can be used once.' } });
  });

  app.post('/auth/2fa/recover', {
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', minLength: 10, maxLength: 10 } },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    const body = z.object({ code: z.string().length(10) }).parse(req.body);
    const valid = await mfaRecovery.verifyRecoveryCode(userId, ctx.tenantId, body.code);
    if (!valid) throw AppError.invalid('Invalid or already-used recovery code');
    reply.send({ data: { recovered: true, remainingCodes: mfaRecovery.getRemainingCodes(userId, ctx.tenantId) } });
  });

  app.get('/auth/2fa/recovery-status', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');
    reply.send({ data: { remainingCodes: mfaRecovery.getRemainingCodes(userId, ctx.tenantId) } });
  });
}
