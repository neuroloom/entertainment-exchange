// Data quality routes — completeness and health scoring
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { dataQuality } from '../services/data-quality.service.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings } from './marketplace.js';

export async function dataQualityRoutes(app: FastifyInstance) {
  app.get('/data-quality', async (req, reply) => {
    const ctx = req.ctx;
    const data: Record<string, any[]> = {
      businesses: businesses.all(ctx.tenantId),
      bookings: bookings.all(ctx.tenantId),
      agents: agents.all(ctx.tenantId),
      listings: listings.all(ctx.tenantId),
    };

    const scores = dataQuality.scoreAll(ctx.tenantId, data);
    reply.send({ data: { scores, overall: dataQuality.getOverallHealth(scores) } });
  });

  app.get('/data-quality/:domain', async (req, reply) => {
    const ctx = req.ctx;
    const domain = params(req).domain;

    let records: Record<string, unknown>[];
    switch (domain) {
      case 'businesses': records = businesses.all(ctx.tenantId) as unknown as Record<string, unknown>[]; break;
      case 'bookings': records = bookings.all(ctx.tenantId) as unknown as Record<string, unknown>[]; break;
      case 'agents': records = agents.all(ctx.tenantId) as unknown as Record<string, unknown>[]; break;
      case 'listings': records = listings.all(ctx.tenantId) as unknown as Record<string, unknown>[]; break;
      default: throw AppError.invalid('Domain not supported for quality scoring');
    }

    reply.send({ data: dataQuality.score(ctx.tenantId, domain, records) });
  });
}
