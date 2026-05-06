// Entertainment Business Exchange — Fastify API Server
// ADR-001: Fastify-first MVP with domain boundaries preserved for Cloudflare later
import Fastify from 'fastify';
import { v4 as uuid } from 'uuid';
import type { RequestContext } from './plugins/requestContext.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
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

  // Routes — domain boundaries preserved per service boundary spec
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(businessRoutes, { prefix: '/api/v1' });
  app.register(bookingRoutes, { prefix: '/api/v1' });
  app.register(ledgerRoutes, { prefix: '/api/v1/ledger' });
  app.register(agentRoutes, { prefix: '/api/v1/agents' });
  app.register(marketplaceRoutes, { prefix: '/api/v1/marketplace' });
  app.register(rightsRoutes, { prefix: '/api/v1/rights' });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  return app;
}

// Start server only when run directly (not when imported)
const isMain = process.argv[1]?.includes('server');
if (isMain) {
  (async () => {
    const PORT = parseInt(process.env.PORT ?? '3000', 10);
    const server = await buildServer();
    server.listen({ port: PORT, host: '0.0.0.0' }, (err, addr) => {
      if (err) { server.log.error(err); process.exit(1); }
      server.log.info(`Entertainment Business Exchange running at ${addr}`);
    });
  })();
}
