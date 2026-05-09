// API key analytics routes — per-key usage tracking and patterns
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { apiKeyAnalytics } from '../services/api-key-analytics.service.js';
import { apiKeyService } from '../services/api-keys.service.js';

export async function apiKeyAnalyticsRoutes(app: FastifyInstance) {
  app.get('/api-keys/:id/analytics', async (req, reply) => {
    const ctx = req.ctx;
    const keyId = params(req).id;
    const key = apiKeyService.getKey(keyId, ctx.tenantId);
    if (!key) throw AppError.notFound('API key');
    reply.send({ data: apiKeyAnalytics.getKeySummary(keyId, ctx.tenantId) });
  });

  app.get('/api-keys/analytics/overview', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: apiKeyAnalytics.getTenantSummary(ctx.tenantId) });
  });
}
