// Onboarding routes — setup wizard progress tracking
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { onboarding } from '../services/onboarding.service.js';

export async function onboardingRoutes(app: FastifyInstance) {
  app.get('/onboarding', async (req, reply) => {
    const ctx = req.ctx;
    const progress = onboarding.getProgress(ctx.tenantId);
    reply.send({
      data: {
        ...progress,
        completionPct: onboarding.getCompletionPct(ctx.tenantId),
        nextStep: onboarding.getNextStep(ctx.tenantId),
      },
    });
  });

  app.post('/onboarding/steps/:key/complete', async (req, reply) => {
    const ctx = req.ctx;
    try {
      const progress = onboarding.completeStep(ctx.tenantId, params(req).key);
      reply.send({
        data: {
          ...progress,
          completionPct: onboarding.getCompletionPct(ctx.tenantId),
          nextStep: onboarding.getNextStep(ctx.tenantId),
        },
      });
    } catch (err) {
      throw AppError.invalid(err instanceof Error ? err.message : 'Invalid step');
    }
  });

  app.post('/onboarding/reset', async (req, reply) => {
    const ctx = req.ctx;
    onboarding.reset(ctx.tenantId);
    reply.send({ data: { reset: true } });
  });
}
