// Bulk delete routes — batch cleanup across domains
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { type StoreEntity } from '../services/repo.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings } from './marketplace.js';
import { anchors, passports } from './rights.js';

export async function bulkDeleteRoutes(app: FastifyInstance) {
  app.post('/bulk-delete', {
    schema: {
      body: {
        type: 'object',
        required: ['domain', 'ids'],
        properties: {
          domain: { type: 'string', enum: ['businesses', 'bookings', 'agents', 'listings', 'anchors', 'passports'] },
          ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ domain: z.enum(['businesses', 'bookings', 'agents', 'listings', 'anchors', 'passports']), ids: z.array(z.string()).min(1).max(100) }).parse(req.body);

    let store: { get: (id: string) => StoreEntity | undefined; delete: (id: string) => boolean };
    switch (body.domain) {
      case 'businesses': store = businesses; break;
      case 'bookings': store = bookings; break;
      case 'agents': store = agents; break;
      case 'listings': store = listings; break;
      case 'anchors': store = anchors; break;
      case 'passports': store = passports; break;
      default: throw AppError.invalid('Unknown domain');
    }

    let deleted = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of body.ids) {
      const item = store.get(id);
      if (!item || item.tenantId !== ctx.tenantId) {
        errors.push({ id, error: 'Not found or wrong tenant' });
        continue;
      }
      store.delete(id);
      deleted++;
    }

    reply.send({ data: { deleted, total: body.ids.length, errors } });
  });
}
