// OAuth routes — social login with Google and GitHub
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { oauthService } from '../services/oauth.service.js';

export async function oauthRoutes(app: FastifyInstance) {
  app.get('/auth/oauth/:provider', async (req, reply) => {
    const provider = params(req).provider;
    if (provider !== 'google' && provider !== 'github') {
      throw AppError.invalid('Unsupported provider. Use "google" or "github".');
    }

    const query = req.query as Record<string, string>;
    const { url, stateId } = oauthService.createAuthUrl(provider, query.redirect, query.tenant);
    reply.send({ data: { url, stateId } });
  });

  app.post('/auth/oauth/callback', {
    schema: {
      body: {
        type: 'object',
        required: ['provider', 'code', 'state'],
        properties: {
          provider: { type: 'string', enum: ['google', 'github'] },
          code: { type: 'string', minLength: 1 },
          state: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ provider: z.enum(['google', 'github']), code: z.string().min(1), state: z.string().min(1) }).parse(req.body);

    const state = oauthService.validateState(body.state);
    if (!state) throw AppError.invalid('Invalid or expired OAuth state');

    const result = await oauthService.exchangeCode(body.provider, body.code);
    if (!result) throw AppError.invalid('Failed to exchange authorization code');

    reply.send({
      data: {
        profile: result.profile,
        message: 'OAuth login successful. Use this profile to link or create an account.',
      },
    });
  });

  app.post('/auth/oauth/link', {
    schema: {
      body: {
        type: 'object',
        required: ['provider', 'providerId', 'email', 'name'],
        properties: {
          provider: { type: 'string', enum: ['google', 'github'] },
          providerId: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          avatarUrl: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('Authentication required');

    const body = z.object({
      provider: z.enum(['google', 'github']),
      providerId: z.string(),
      email: z.string(),
      name: z.string(),
      avatarUrl: z.string().optional(),
    }).parse(req.body);
    oauthService.linkAccount(userId, ctx.tenantId, body);
    reply.send({ data: { linked: true } });
  });

  app.get('/auth/oauth/accounts', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('Authentication required');
    reply.send({ data: oauthService.getLinkedAccounts(userId) });
  });

  app.delete('/auth/oauth/:provider', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('Authentication required');

    oauthService.unlinkAccount(userId, params(req).provider);
    reply.send({ data: { unlinked: true } });
  });
}
