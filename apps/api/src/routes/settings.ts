// Tenant settings routes — per-tenant configuration management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { tenantSettings } from '../services/tenant-settings.service.js';

const PatchSettingsSchema = z.object({
  currency: z.string().optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  features: z.object({
    marketplace: z.boolean().optional(),
    rights: z.boolean().optional(),
    agents: z.boolean().optional(),
    ledger: z.boolean().optional(),
    webhooks: z.boolean().optional(),
  }).optional(),
  branding: z.object({
    logoUrl: z.string().optional(),
    primaryColor: z.string().optional(),
  }).optional(),
  limits: z.object({
    maxBookingsPerMonth: z.number().int().min(0).optional(),
    maxAgents: z.number().int().min(0).optional(),
    maxListings: z.number().int().min(0).optional(),
  }).optional(),
}).strict();

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    reply.send({ data: tenantSettings.get(ctx.tenantId) });
  });

  app.patch('/settings', {
    schema: {
      body: {
        type: 'object',
        properties: {
          currency: { type: 'string' },
          timezone: { type: 'string' },
          locale: { type: 'string' },
          features: {
            type: 'object',
            properties: {
              marketplace: { type: 'boolean' },
              rights: { type: 'boolean' },
              agents: { type: 'boolean' },
              ledger: { type: 'boolean' },
              webhooks: { type: 'boolean' },
            },
          },
          branding: {
            type: 'object',
            properties: {
              logoUrl: { type: 'string' },
              primaryColor: { type: 'string' },
            },
          },
          limits: {
            type: 'object',
            properties: {
              maxBookingsPerMonth: { type: 'integer', minimum: 0 },
              maxAgents: { type: 'integer', minimum: 0 },
              maxListings: { type: 'integer', minimum: 0 },
            },
          },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const patch = PatchSettingsSchema.parse(req.body);
    const updated = tenantSettings.upsert(ctx.tenantId, patch);
    reply.send({ data: updated });
  });

  app.post('/settings/reset', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const reset = tenantSettings.reset(ctx.tenantId);
    reply.send({ data: reset });
  });
}
