// Exchange rate routes — currency conversion and formatting
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { exchangeRates } from '../services/exchange-rates.service.js';

export async function exchangeRateRoutes(app: FastifyInstance) {
  app.get('/currencies', async (_req, reply) => {
    reply.send({ data: exchangeRates.listCurrencies() });
  });

  app.get('/currencies/:code', async (req, reply) => {
    const info = exchangeRates.getCurrency(params(req).code);
    if (!info) throw AppError.notFound('Currency');
    reply.send({ data: info });
  });

  app.get('/exchange-rates', async (_req, reply) => {
    reply.send({ data: { base: 'USD', rates: exchangeRates.getRates(), updated: '2026-05-09' } });
  });

  app.post('/exchange-rates/convert', {
    schema: {
      body: {
        type: 'object',
        required: ['amountCents', 'from', 'to'],
        properties: {
          amountCents: { type: 'integer', minimum: 0 },
          from: { type: 'string', minLength: 3, maxLength: 3 },
          to: { type: 'string', minLength: 3, maxLength: 3 },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ amountCents: z.number().int().min(0), from: z.string().length(3), to: z.string().length(3) }).parse(req.body);

    try {
      const result = exchangeRates.convert(body.amountCents, body.from, body.to);
      reply.send({
        data: {
          ...result,
          formatted: exchangeRates.formatAmount(result.resultCents, body.to),
        },
      });
    } catch (err) {
      throw AppError.invalid(err instanceof Error ? err.message : 'Conversion failed');
    }
  });
}
