// Email verification routes — confirm email on registration
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { emailVerification } from '../services/email-verification.service.js';

export async function emailVerifyRoutes(app: FastifyInstance) {
  app.post('/auth/verify-email', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string', minLength: 48 },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ token: z.string().min(48) }).parse(req.body);
    const verified = emailVerification.verifyToken(body.token);
    if (!verified) throw AppError.invalid('Invalid or expired verification token');
    reply.send({ data: { verified: true, userId: verified.userId, email: verified.email } });
  });

  app.get('/auth/verify-email/status', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('Authentication required');
    reply.send({ data: emailVerification.getStatus(userId) });
  });

  app.post('/auth/verify-email/resend', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('Authentication required');

    const body = z.object({ email: z.string().email() }).parse(req.body);
    const { token, expiresAt } = emailVerification.createToken(ctx.tenantId, userId, body.email);

    reply.send({
      data: {
        message: 'Verification email sent.',
        expiresAt,
        ...(process.env.NODE_ENV === 'test' ? { token } : {}),
      },
    });
  });
}
