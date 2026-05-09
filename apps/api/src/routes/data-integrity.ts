// Data integrity routes — hash chain verification and tamper detection
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { dataIntegrity } from '../services/data-integrity.service.js';

export async function dataIntegrityRoutes(app: FastifyInstance) {
  app.get('/integrity/verify-all', async (_req, reply) => {
    reply.send({ data: dataIntegrity.verifyAll() });
  });

  app.get('/integrity/chain/:entityId', async (req, reply) => {
    const chain = dataIntegrity.getChain(params(req).entityId);
    const verification = dataIntegrity.verifyChain(params(req).entityId);
    reply.send({ data: { chain, ...verification } });
  });
}
