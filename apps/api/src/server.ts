// Entertainment Business Exchange — Fastify API Server
// ADR-001: Fastify-first MVP with domain boundaries preserved for Cloudflare later
import Fastify from 'fastify';
import { v4 as uuid } from 'uuid';
import type { RequestContext } from './plugins/requestContext.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { rateLimitPlugin } from './plugins/rate-limit.plugin.js';
import { loggerPlugin } from './plugins/logger.plugin.js';
import { metricsPlugin } from './plugins/metrics.plugin.js';
import { healthPlugin } from './plugins/health.plugin.js';
import { sanitizePlugin } from './plugins/sanitize.plugin.js';
import { authPlugin } from './plugins/auth.plugin.js';
import { hydrateAllStores, migrateForward } from './services/repo.js';
import { authRoutes } from './routes/auth.js';
import { businessRoutes } from './routes/business.js';
import { bookingRoutes } from './routes/booking.js';
import { ledgerRoutes } from './routes/ledger.js';
import { agentRoutes } from './routes/agent.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { rightsRoutes } from './routes/rights.js';

export async function buildServer() {
  const app = Fastify({ logger: true });

  // Request context — decorator + hook directly on root so ALL children inherit
  app.decorateRequest('ctx', null as unknown as RequestContext);
  app.addHook('onRequest', async (req) => {
    const perms = (req.headers['x-actor-permissions'] as string)?.split(',').map(s => s.trim()) ?? [];
    (req as any).ctx = {
      requestId: uuid(),
      traceId: (req.headers['x-trace-id'] as string) ?? uuid(),
      tenantId: (req.headers['x-tenant-id'] as string) ?? '',
      businessId: (req.headers['x-business-id'] as string) ?? undefined,
      actor: {
        type: (req.headers['x-actor-type'] as any) ?? 'system',
        id: (req.headers['x-actor-id'] as string) ?? 'anonymous',
        userId: (req.headers['x-actor-id'] as string) ?? undefined,
        roles: [],
        permissions: perms,
      },
    };
  });

  // Error handler — directly on root so ALL children inherit
  await errorHandlerPlugin(app);

  // Auth plugin — reads Authorization: Bearer and populates ctx
  await authPlugin(app);

  // Sanitize plugin — strips bidi chars, trims strings, blocks XSS in body/query
  await sanitizePlugin(app);

  // L5 PRODUCTION — Observability plugins
  await rateLimitPlugin(app);
  await loggerPlugin(app);
  await metricsPlugin(app);
  await healthPlugin(app);

  // PG migrations + hydration — must run before routes register stores
  try {
    const applied = await migrateForward();
    if (applied.length > 0) app.log.info(`Migrations applied: ${applied.join(', ')}`);
  } catch (err) {
    app.log.warn(`Migrations skipped (no PG?): ${(err as Error).message}`);
  }
  await hydrateAllStores();

  // Routes — domain boundaries preserved per service boundary spec
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(businessRoutes, { prefix: '/api/v1' });
  app.register(bookingRoutes, { prefix: '/api/v1' });
  app.register(ledgerRoutes, { prefix: '/api/v1/ledger' });
  app.register(agentRoutes, { prefix: '/api/v1/agents' });
  app.register(marketplaceRoutes, { prefix: '/api/v1/marketplace' });
  app.register(rightsRoutes, { prefix: '/api/v1/rights' });

  return app;
}

// Start server only when run directly (not when imported)
const isMain = process.argv[1]?.includes('server');
if (isMain) {
  (async () => {
    const PORT = parseInt(process.env.PORT ?? '3000', 10);
    const server = await buildServer();

    // Wait for server to be ready before attaching shutdown handlers
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`Entertainment Business Exchange running at ${server.listeningOrigin}`);

    // Graceful shutdown
    async function shutdown(signal: string) {
      server.log.info(`Received ${signal} — shutting down gracefully`);
      try {
        await server.close();
        server.log.info('Server closed');
        process.exit(0);
      } catch (err) {
        server.log.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })();
}

// Global error boundaries — catch the uncaught
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
