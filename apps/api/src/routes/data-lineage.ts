// Data lineage routes — track data flow between domains
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { dataLineage } from '../services/data-lineage.service.js';

export async function dataLineageRoutes(app: FastifyInstance) {
  app.get('/lineage/:domain/:entityId', async (req, reply) => {
    const p = params(req);
    const query = req.query as Record<string, string>;
    const result = dataLineage.getFullLineage(p.domain, p.entityId, parseInt(query.depth ?? '3', 10));
    reply.send({ data: result });
  });

  app.get('/lineage/upstream/:domain/:entityId', async (req, reply) => {
    const p = params(req);
    reply.send({ data: dataLineage.getUpstream(p.domain, p.entityId) });
  });

  app.get('/lineage/downstream/:domain/:entityId', async (req, reply) => {
    const p = params(req);
    reply.send({ data: dataLineage.getDownstream(p.domain, p.entityId) });
  });

  app.get('/lineage/graph', async (_req, reply) => {
    reply.send({ data: { ...dataLineage.getGraph(), stats: dataLineage.getStats() } });
  });
}
