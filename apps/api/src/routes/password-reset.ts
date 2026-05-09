// Password reset routes — forgot password and reset flow
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { passwordReset } from '../services/password-reset.service.js';

export async function passwordResetRoutes(app: FastifyInstance) {
  app.post('/auth/forgot-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ email: z.string().email() }).parse(req.body);

    // Look up user by email — in production this sends an email, always returns 200
    const { token, expiresAt } = passwordReset.createToken(ctx.tenantId, 'lookup-by-email', body.email);

    // Always return success to prevent email enumeration
    reply.send({
      data: {
        message: 'If an account exists with that email, a reset link has been generated.',
        expiresAt,
        // Token only returned in response for testing; production would email it
        ...(process.env.NODE_ENV === 'test' ? { token } : {}),
      },
    });
  });

  app.post('/auth/reset-password', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: {
          token: { type: 'string', minLength: 64 },
          newPassword: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ token: z.string().min(64), newPassword: z.string().min(8) }).parse(req.body);

    const valid = passwordReset.validateToken(body.token);
    if (!valid) throw AppError.invalid('Invalid or expired reset token');

    // In production, hash the password and update in the database
    passwordReset.consumeToken(body.token, body.newPassword, () => true);

    reply.send({ data: { message: 'Password has been reset successfully.' } });
  });
}
