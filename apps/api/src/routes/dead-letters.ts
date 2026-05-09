// Dead letter routes — inspect and manage failed deliveries
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { deadLetters } from '../services/dead-letter.service.js';

export async function deadLetterRoutes(app: FastifyInstance) {
  app.get('/dead-letters', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const all = deadLetters.list(ctx.tenantId, query.source);
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/dead-letters/:id', async (req, reply) => {
    const ctx = req.ctx;
    const l = deadLetters.get(params(req).id, ctx.tenantId);
    if (!l) throw AppError.notFound('Dead letter');
    reply.send({ data: l });
  });

  app.post('/dead-letters/:id/acknowledge', async (req, reply) => {
    const ctx = req.ctx;
    const ok = deadLetters.acknowledge(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Dead letter');
    reply.send({ data: { acknowledged: true } });
  });

  app.get('/dead-letters/stats', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: deadLetters.stats(ctx.tenantId) });
  });
}
