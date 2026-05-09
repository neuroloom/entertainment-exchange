// Sandbox routes — isolated test environment management
import type { FastifyInstance } from 'fastify';
import { sandbox } from '../services/sandbox.service.js';

export async function sandboxRoutes(app: FastifyInstance) {
  app.post('/sandbox/enable', async (req, reply) => {
    const ctx = req.ctx;
    const s = sandbox.enable(ctx.tenantId);
    reply.send({ data: { ...s, message: 'Sandbox mode enabled. All operations are isolated from production data.' } });
  });

  app.post('/sandbox/disable', async (req, reply) => {
    const ctx = req.ctx;
    sandbox.disable(ctx.tenantId);
    reply.send({ data: { disabled: true } });
  });

  app.get('/sandbox/status', async (req, reply) => {
    const ctx = req.ctx;
    const s = sandbox.get(ctx.tenantId);
    reply.send({ data: s ?? { enabled: false, message: 'Sandbox not enabled' } });
  });

  app.get('/sandbox', async (_req, reply) => {
    reply.send({ data: sandbox.listAll() });
  });
}
