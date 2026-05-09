// Audit enrichment routes — entity change history with before/after snapshots
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { auditEnrichment } from '../services/audit-enrichment.service.js';

export async function auditEnrichmentRoutes(app: FastifyInstance) {
  app.get('/audit/changes/:entityType/:entityId', async (req, reply) => {
    const ctx = req.ctx;
    const p = params(req);
    const history = auditEnrichment.getEntityHistory(p.entityType, p.entityId, ctx.tenantId);
    if (history.length === 0) throw AppError.notFound('No change history for this entity');
    reply.send({ data: history });
  });

  app.get('/audit/changes', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const all = auditEnrichment.getRecentChanges(ctx.tenantId, parseInt(query.limit ?? '50', 10));
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  app.get('/audit/changes/summary', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    reply.send({ data: auditEnrichment.getChangeSummary(ctx.tenantId, query.entityType) });
  });
}
