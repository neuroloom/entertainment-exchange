// TOTP routes — two-factor authentication setup and verification
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { totpService } from '../services/totp.service.js';

const VerifyTokenSchema = z.object({
  token: z.string().min(6).max(8),
});

export async function totpRoutes(app: FastifyInstance) {
  app.post('/auth/2fa/setup', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    const { secret, uri, backupCodes } = await totpService.setup(userId, ctx.tenantId);
    reply.status(201).send({
      data: {
        secret,       // Base32 secret for manual entry
        uri,          // otpauth:// URI for QR code generation
        backupCodes,  // Show once — store securely
      },
    });
  });

  app.post('/auth/2fa/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string', minLength: 6, maxLength: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    const { token } = VerifyTokenSchema.parse(req.body);
    const result = await totpService.verify(userId, ctx.tenantId, token);
    if (!result.valid) throw AppError.invalid(result.error ?? 'Invalid 2FA code');
    reply.send({ data: { verified: true } });
  });

  app.get('/auth/2fa/status', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');
    reply.send({ data: totpService.getStatus(userId, ctx.tenantId) });
  });

  app.post('/auth/2fa/disable', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    totpService.disable(userId, ctx.tenantId);
    reply.send({ data: { disabled: true } });
  });
}
