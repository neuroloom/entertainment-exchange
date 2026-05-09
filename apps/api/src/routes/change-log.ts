// Change log routes — configuration change tracking and auditing
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { changeLog } from '../services/change-log.service.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';

export async function changeLogRoutes(app: FastifyInstance) {
  app.get('/changes', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const all = changeLog.list(ctx.tenantId, {
      entityType: query.entityType, entityId: query.entityId,
      since: query.since, field: query.field,
    });
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/changes/summary', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: changeLog.getSummary(ctx.tenantId, query.since) });
  });

  app.get('/changes/:id', async (req, reply) => {
    const ctx = req.ctx;
    const r = changeLog.get(params(req).id, ctx.tenantId);
    if (!r) throw AppError.notFound('Change record');
    reply.send({ data: r });
  });
}
