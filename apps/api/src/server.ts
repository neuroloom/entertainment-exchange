// Entertainment Business Exchange — Fastify API Server
// ADR-001: Fastify-first MVP with domain boundaries preserved for Cloudflare later
import Fastify from 'fastify';
import { requestContextPlugin } from './plugins/requestContext.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { businessRoutes } from './routes/business.js';
import { bookingRoutes } from './routes/booking.js';
import { ledgerRoutes } from './routes/ledger.js';
import { agentRoutes } from './routes/agent.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { rightsRoutes } from './routes/rights.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  // Plugins
  app.register(requestContextPlugin);
  app.register(errorHandlerPlugin);

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

// Start server when run directly
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const server = buildServer();
server.listen({ port: PORT, host: '0.0.0.0' }, (err, addr) => {
  if (err) { server.log.error(err); process.exit(1); }
  server.log.info(`Entertainment Business Exchange running at ${addr}`);
});

export default server;
