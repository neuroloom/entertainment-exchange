// Risk scoring routes — tenant behavioral risk assessment
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { riskScoring } from '../services/risk-scoring.service.js';

export async function riskScoreRoutes(app: FastifyInstance) {
  app.get('/admin/risk-scores', async (_req, reply) => {
    reply.send({ data: riskScoring.getAllScores() });
  });

  app.get('/admin/risk-scores/:tenantId', async (req, reply) => {
    reply.send({ data: riskScoring.assess(params(req).tenantId) });
  });
}
