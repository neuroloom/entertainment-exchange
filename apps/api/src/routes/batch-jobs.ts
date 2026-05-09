// Batch job routes — progress tracking for long operations
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { batchJobTracker } from '../services/batch-job-tracker.service.js';

export async function batchJobRoutes(app: FastifyInstance) {
  const CreateJobSchema = z.object({
    type: z.string().min(1),
    total: z.number().int().min(1),
  });

  app.post('/jobs', {
    schema: {
      body: {
        type: 'object',
        required: ['type', 'total'],
        properties: {
          type: { type: 'string', minLength: 1 },
          total: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = CreateJobSchema.parse(req.body);
    const job = batchJobTracker.create(ctx.tenantId, body.type, body.total);
    batchJobTracker.start(job.id);
    reply.status(201).send({ data: job });
  });

  app.get('/jobs', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: batchJobTracker.list(ctx.tenantId) });
  });

  app.get('/jobs/:id', async (req, reply) => {
    const ctx = req.ctx;
    const job = batchJobTracker.get(params(req).id, ctx.tenantId);
    if (!job) throw AppError.notFound('Job');
    reply.send({ data: job });
  });
}
