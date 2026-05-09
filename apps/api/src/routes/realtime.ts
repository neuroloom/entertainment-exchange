// Realtime routes — SSE endpoint for live event streaming
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { realtime } from '../services/realtime.service.js';
import type { RealtimeEvent } from '../services/realtime.service.js';

export async function realtimeRoutes(app: FastifyInstance) {
  app.get('/realtime/stream', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(':ok\n\n');

    const unsubscribe = realtime.subscribe(ctx.tenantId, (event: RealtimeEvent) => {
      try {
        reply.raw.write(`id: ${event.id}\n`);
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        unsubscribe();
      }
    });

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      try { reply.raw.write(':ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 30_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Never resolve — keep the connection open
    return new Promise(() => {});
  });

  app.get('/realtime/stats', async (_req, reply) => {
    reply.send({ data: realtime.getStats() });
  });
}
