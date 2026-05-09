// Config export routes — export and diff tenant configuration
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { configExport } from '../services/config-export.service.js';
import { tenantSettings } from '../services/tenant-settings.service.js';
import { featureFlags } from '../services/feature-flags.service.js';
import { tenantRateLimits } from '../services/tenant-rate-limit.service.js';
import { webhookService } from '../services/webhook.service.js';
import { customFields } from '../services/custom-fields.service.js';

export async function configExportRoutes(app: FastifyInstance) {
  app.post('/config/export', async (req, reply) => {
    const ctx = req.ctx;

    const exp = configExport.exportTenant(ctx.tenantId, ctx.actor.id, {
      settings: tenantSettings.get(ctx.tenantId) as unknown as Record<string, unknown>,
      featureFlags: Object.fromEntries(featureFlags.list(ctx.tenantId).map(f => [f.key, { enabled: f.enabled, rolloutPct: f.rolloutPct }])),
      rateLimits: tenantRateLimits.get(ctx.tenantId) as unknown as Record<string, unknown>,
      webhooks: { subscriptions: webhookService.getSubscriptions(ctx.tenantId) },
      customFields: Object.fromEntries(customFields.getDefinitions(ctx.tenantId).map(f => [f.key, f])),
    });

    reply.status(201).send({ data: exp });
  });

  app.get('/config/exports', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: configExport.listExports(ctx.tenantId) });
  });

  app.get('/config/exports/:exportedAt', async (req, reply) => {
    const ctx = req.ctx;
    const exp = configExport.getExport(ctx.tenantId, params(req).exportedAt);
    reply.send({ data: exp ?? { message: 'Export not found' } });
  });
}
