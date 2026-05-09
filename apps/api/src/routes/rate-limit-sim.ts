// Rate limit simulator routes — dry-run testing
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rateLimitSimulator } from '../services/rate-limit-simulator.service.js';

export async function rateLimitSimRoutes(app: FastifyInstance) {
  const SimulateSchema = z.object({
    currentRpm: z.number().int().min(0),
    limitRpm: z.number().int().min(1),
    concurrency: z.number().int().min(0),
  });

  const WhatIfSchema = z.object({
    currentRpm: z.number().int().min(0),
    growthPct: z.number().min(0),
    limitRpm: z.number().int().min(1),
  });
  app.post('/rate-limits/simulate', {
    schema: {
      body: {
        type: 'object',
        required: ['currentRpm', 'limitRpm', 'concurrency'],
        properties: {
          currentRpm: { type: 'integer', minimum: 0 },
          limitRpm: { type: 'integer', minimum: 1 },
          concurrency: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = SimulateSchema.parse(req.body);
    reply.send({ data: rateLimitSimulator.simulate(ctx.tenantId, body.currentRpm, body.limitRpm, body.concurrency) });
  });

  app.post('/rate-limits/what-if', {
    schema: {
      body: {
        type: 'object',
        required: ['currentRpm', 'growthPct', 'limitRpm'],
        properties: {
          currentRpm: { type: 'integer', minimum: 0 },
          growthPct: { type: 'number', minimum: 0 },
          limitRpm: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = WhatIfSchema.parse(req.body);
    const projections = rateLimitSimulator.whatIf(ctx.tenantId, body.currentRpm, body.growthPct, body.limitRpm);
    const capacity = rateLimitSimulator.capacityPlanning(ctx.tenantId, body.currentRpm, body.growthPct, body.limitRpm);
    reply.send({ data: { projections, capacity } });
  });
}
