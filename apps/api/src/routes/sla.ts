// SLA routes — uptime and latency monitoring dashboard
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { slaMonitor, type SlaConfig } from '../services/sla-monitor.service.js';

export async function slaRoutes(app: FastifyInstance) {
  const SlaConfigSchema = z.object({
    uptimeTarget: z.number().min(90).max(100).optional(),
    latencyP95Ms: z.number().int().min(10).optional(),
    latencyP99Ms: z.number().int().min(10).optional(),
    checkWindowMinutes: z.number().int().min(5).max(1440).optional(),
  });
  app.get('/sla', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: slaMonitor.getDashboard(ctx.tenantId) });
  });

  app.put('/sla/config', {
    schema: {
      body: {
        type: 'object',
        properties: {
          uptimeTarget: { type: 'number', minimum: 90, maximum: 100 },
          latencyP95Ms: { type: 'integer', minimum: 10 },
          latencyP99Ms: { type: 'integer', minimum: 10 },
          checkWindowMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const cfg = slaMonitor.setConfig({ tenantId: ctx.tenantId, ...SlaConfigSchema.parse(req.body) } as SlaConfig);
    reply.send({ data: cfg });
  });
}
