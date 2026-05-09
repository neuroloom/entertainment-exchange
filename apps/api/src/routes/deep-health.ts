// Deep health routes — comprehensive dependency verification
import type { FastifyInstance } from 'fastify';
import { deepHealth } from '../services/deep-health.service.js';
import { pingPg } from '../services/repo.js';

// Register PostgreSQL checker
deepHealth.registerChecker('postgresql', async () => {
  const ok = await pingPg();
  return { ok, error: ok ? undefined : 'PostgreSQL connection failed' };
});

export async function deepHealthRoutes(app: FastifyInstance) {
  app.get('/health/deep', async (_req, reply) => {
    const report = await deepHealth.runAll();
    const statusCode = report.overall === 'healthy' ? 200 : report.overall === 'degraded' ? 200 : 503;
    reply.status(statusCode).send(report);
  });
}
