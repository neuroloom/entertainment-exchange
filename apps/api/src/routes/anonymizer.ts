// Data anonymizer routes — generate safe test data or sanitize exports
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { anonymizer } from '../services/anonymizer.service.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';

export async function anonymizerRoutes(app: FastifyInstance) {
  app.post('/anonymize', {
    schema: {
      body: {
        type: 'object',
        required: ['domain'],
        properties: {
          domain: { type: 'string', enum: ['businesses', 'bookings'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ domain: z.enum(['businesses', 'bookings']) }).parse(req.body);

    const records = body.domain === 'businesses'
      ? businesses.all(ctx.tenantId) as unknown as Record<string, unknown>[]
      : bookings.all(ctx.tenantId) as unknown as Record<string, unknown>[];

    const anonymized = anonymizer.anonymizeDataset(records, body.domain === 'businesses' ? 'business' : 'booking');
    reply.send({ data: anonymized, meta: { count: anonymized.length } });
  });

  app.get('/anonymize/generate', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const count = Math.min(100, Math.max(1, parseInt(query.count ?? '10', 10) || 10));

    const items: Record<string, unknown>[] = [];
    if (query.type === 'businesses') {
      for (let i = 0; i < count; i++) items.push(anonymizer.generateFakeBusiness());
    } else {
      for (let i = 0; i < count; i++) items.push(anonymizer.generateFakeBooking());
    }
    reply.send({ data: items, meta: { count } });
  });
}
