// Health plugin — enhanced health check endpoint with PG ping
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pingPg } from '../services/repo.js';

interface CheckResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  uptime: number;
  checks: {
    db: { status: 'ok' | 'error'; message?: string };
    memory: { status: 'ok' | 'warn' | 'critical'; usageBytes: number; limitBytes: number };
  };
}

export async function healthPlugin(app: FastifyInstance) {
  const startTime = Date.now();
  const MEMORY_WARN_BYTES = 250 * 1024 * 1024;
  const MEMORY_CRITICAL_BYTES = 500 * 1024 * 1024;

  app.get('/health', { logLevel: 'warn' }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const uptime = (Date.now() - startTime) / 1000;
    const heapUsed = process.memoryUsage().heapUsed;

    let memoryStatus: 'ok' | 'warn' | 'critical' = 'ok';
    if (heapUsed > MEMORY_CRITICAL_BYTES) memoryStatus = 'critical';
    else if (heapUsed > MEMORY_WARN_BYTES) memoryStatus = 'warn';

    const pgOk = await pingPg();
    const dbStatus: 'ok' | 'error' = pgOk ? 'ok' : 'error';
    const dbMessage = pgOk ? undefined : 'PostgreSQL unreachable';

    const overallStatus = (dbStatus === 'error' || memoryStatus === 'critical') ? 'degraded' : 'ok';

    const result: CheckResult = {
      status: overallStatus,
      uptime: Math.round(uptime),
      checks: {
        db: { status: dbStatus, ...(dbMessage ? { message: dbMessage } : {}) },
        memory: { status: memoryStatus, usageBytes: heapUsed, limitBytes: MEMORY_CRITICAL_BYTES },
      },
    };

    return reply.status(overallStatus === 'degraded' ? 503 : 200).send(result);
  });
}
