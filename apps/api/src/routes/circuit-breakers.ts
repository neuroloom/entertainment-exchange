// Circuit breaker routes — dependency health and manual reset
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { circuitBreaker } from '../services/circuit-breaker.service.js';

export async function circuitBreakerRoutes(app: FastifyInstance) {
  app.get('/system/circuits', async (_req, reply) => {
    reply.send({ data: circuitBreaker.listAll() });
  });

  app.post('/system/circuits/:name/reset', async (req, reply) => {
    const ok = circuitBreaker.reset(params(req).name);
    reply.send({ data: { reset: ok } });
  });
}
