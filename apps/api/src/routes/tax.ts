// Tax routes — jurisdiction lookup and calculation
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { taxService } from '../services/tax.service.js';

export async function taxRoutes(app: FastifyInstance) {
  // GET /tax/jurisdictions — list all supported tax jurisdictions
  app.get('/tax/jurisdictions', async (_req, reply) => {
    reply.send({ data: taxService.listJurisdictions() });
  });

  // GET /tax/jurisdictions/:code — get a specific jurisdiction
  app.get('/tax/jurisdictions/:code', async (req, reply) => {
    const j = taxService.getJurisdiction(params(req).code);
    if (!j) throw AppError.notFound('Jurisdiction');
    reply.send({ data: j });
  });

  // POST /tax/calculate — calculate tax for an amount in a jurisdiction
  app.post('/tax/calculate', {
    schema: {
      body: {
        type: 'object',
        required: ['amountCents', 'jurisdictionCode'],
        properties: {
          amountCents: { type: 'integer', minimum: 1 },
          jurisdictionCode: { type: 'string', minLength: 2 },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ amountCents: z.number().int().min(1), jurisdictionCode: z.string().min(2) }).parse(req.body);
    const result = taxService.calculate(body.amountCents, body.jurisdictionCode);
    reply.send({ data: result });
  });

  // GET /tax/resolve — resolve a tax rate from a region code
  app.get('/tax/resolve', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const result = taxService.resolveRate(query.region);
    reply.send({ data: result });
  });
}
