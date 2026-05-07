// Health plugin — enhanced health check endpoint
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

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

  // Memory limits: warn at 250MB, critical at 500MB heap used
  const MEMORY_WARN_BYTES = 250 * 1024 * 1024;
  const MEMORY_CRITICAL_BYTES = 500 * 1024 * 1024;

  app.get('/health', { logLevel: 'warn' }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const uptime = (Date.now() - startTime) / 1000;

    // Memory check
    const heapUsed = process.memoryUsage().heapUsed;
    let memoryStatus: 'ok' | 'warn' | 'critical' = 'ok';
    if (heapUsed > MEMORY_CRITICAL_BYTES) {
      memoryStatus = 'critical';
    } else if (heapUsed > MEMORY_WARN_BYTES) {
      memoryStatus = 'warn';
    }

    // DB check — graceful degradation, do not crash if DB is unavailable
    let dbStatus: 'ok' | 'error' = 'ok';
    let dbMessage: string | undefined;
    try {
      // Check if the app has a db decorator (assumes db plugin sets app.decorate('db', ...))
      const db = (app as any).db;
      if (db) {
        // Try a simple query or ping
        if (typeof db.raw === 'function') {
          await db.raw('SELECT 1');
        } else if (typeof db.query === 'function') {
          await db.query('SELECT 1');
        } else if (typeof db.ping === 'function') {
          await db.ping();
        } else {
          // DB object exists but has no known method — assume it's configured
          dbStatus = 'ok';
        }
      }
      // If no db decorator, just report ok (no database configured)
    } catch (err) {
      dbStatus = 'error';
      dbMessage = err instanceof Error ? err.message : 'Database connection failed';
    }

    // Determine overall status
    let overallStatus: 'ok' | 'degraded' = 'ok';
    if (dbStatus === 'error' || memoryStatus === 'critical') {
      overallStatus = 'degraded';
    }

    const result: CheckResult = {
      status: overallStatus,
      uptime: Math.round(uptime),
      checks: {
        db: {
          status: dbStatus,
          ...(dbMessage ? { message: dbMessage } : {}),
        },
        memory: {
          status: memoryStatus,
          usageBytes: heapUsed,
          limitBytes: MEMORY_CRITICAL_BYTES,
        },
      },
    };

    const statusCode = overallStatus === 'degraded' ? 503 : 200;
    return reply.status(statusCode).send(result);
  });
}
