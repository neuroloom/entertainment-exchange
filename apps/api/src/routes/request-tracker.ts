import type { FastifyInstance } from 'fastify';
import { params } from '../plugins/requestContext.js';
import { requestTracker } from '../services/request-tracker.service.js';

export async function requestTrackerRoutes(app: FastifyInstance) {
  app.get('/system/requests/stats', async (_req, reply) => {
    reply.send({ data: requestTracker.getStats() });
  });
  app.get('/system/requests/slowest', async (_req, reply) => {
    reply.send({ data: requestTracker.getSlowest() });
  });
  app.get('/system/requests/:requestId', async (req, reply) => {
    const lc = requestTracker.get(params(req).requestId);
    reply.send({ data: lc ?? { message: 'Not found' } });
  });
}
