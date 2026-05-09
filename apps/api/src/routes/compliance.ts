// Compliance routes — evidence collection and coverage reporting
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { complianceEvidence } from '../services/compliance-evidence.service.js';

const CollectEvidenceSchema = z.object({
  control: z.string().min(1),
  evidence: z.record(z.unknown()),
});

export async function complianceRoutes(app: FastifyInstance) {
  app.get('/compliance/controls', async (_req, reply) => {
    reply.send({ data: complianceEvidence.listControls() });
  });

  app.post('/compliance/evidence', {
    schema: {
      body: {
        type: 'object',
        required: ['control', 'evidence'],
        properties: {
          control: { type: 'string', minLength: 1 },
          evidence: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CollectEvidenceSchema.parse(req.body);
    const item = complianceEvidence.collect(ctx.tenantId, body.control, body.evidence);
    reply.status(201).send({ data: item });
  });

  app.get('/compliance/evidence', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: complianceEvidence.list(ctx.tenantId, query.control, query.category) });
  });

  app.get('/compliance/coverage', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: complianceEvidence.getCoverage(ctx.tenantId) });
  });

  app.get('/compliance/evidence/:id', async (req, reply) => {
    const ctx = req.ctx;
    const item = complianceEvidence.get(params(req).id, ctx.tenantId);
    if (!item) throw AppError.notFound('Evidence item');
    reply.send({ data: item });
  });
}
