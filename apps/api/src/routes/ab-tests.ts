// A/B testing routes — create and manage experiments
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { abTesting } from '../services/ab-testing.service.js';

export async function abTestRoutes(app: FastifyInstance) {
  const CreateExperimentSchema = z.object({
    name: z.string().min(1),
    description: z.string(),
    variantA: z.string(),
    variantB: z.string(),
    metric: z.enum(['cost', 'latency', 'success_rate', 'vgdo']),
  });

  app.post('/ab-tests', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'description', 'variantA', 'variantB', 'metric'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          variantA: { type: 'string' },
          variantB: { type: 'string' },
          metric: { type: 'string', enum: ['cost', 'latency', 'success_rate', 'vgdo'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const exp = abTesting.createExperiment(ctx.tenantId, CreateExperimentSchema.parse(req.body));
    reply.status(201).send({ data: exp });
  });

  app.get('/ab-tests', async (req, reply) => {
    const ctx = req.ctx;
    const all = abTesting.list(ctx.tenantId);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.post('/ab-tests/:id/start', async (req, reply) => {
    const ctx = req.ctx;
    const e = abTesting.start(params(req).id, ctx.tenantId);
    if (!e) throw AppError.notFound('Experiment');
    reply.send({ data: e });
  });

  const RecordTrialSchema = z.object({
    variant: z.enum(['A', 'B']),
    metricValue: z.number(),
  });

  app.post('/ab-tests/:id/trial', {
    schema: {
      body: {
        type: 'object',
        required: ['variant', 'metricValue'],
        properties: {
          variant: { type: 'string', enum: ['A', 'B'] },
          metricValue: { type: 'number' },
        },
      },
    },
  }, async (req, reply) => {
    const body = RecordTrialSchema.parse(req.body);
    abTesting.recordTrial(params(req).id, body.variant, body.metricValue);
    reply.send({ data: { recorded: true } });
  });

  app.post('/ab-tests/:id/complete', async (req, reply) => {
    const ctx = req.ctx;
    const e = abTesting.complete(params(req).id, ctx.tenantId);
    if (!e) throw AppError.notFound('Experiment');
    reply.send({ data: e });
  });

  app.get('/ab-tests/:id/results', async (req, reply) => {
    const ctx = req.ctx;
    const r = abTesting.getResults(params(req).id, ctx.tenantId);
    if (!r) throw AppError.notFound('Experiment');
    reply.send({ data: {
      experiment: r.experiment,
      summary: { aMean: r.aMean, bMean: r.bMean, aTrials: r.aTrials.length, bTrials: r.bTrials.length },
    }});
  });
}
