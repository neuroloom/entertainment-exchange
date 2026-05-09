// Activity log export — exhaustive tenant activity log with filtering
import type { FastifyInstance } from 'fastify';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { sharedAudit } from '../services/audit-helpers.js';



export async function activityLogRoutes(app: FastifyInstance) {
  app.get('/activity-log', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;

    let events = sharedAudit.all(ctx.tenantId);

    // Filters
    if (query.action) events = events.filter((e) => e.action === query.action);
    if (query.resourceType) events = events.filter((e) => e.resourceType === query.resourceType);
    if (query.actorId) events = events.filter((e) => e.actorId === query.actorId);
    if (query.businessId) events = events.filter((e) => e.businessId === query.businessId);
    if (query.since) events = events.filter((e) => new Date(e.createdAt) >= new Date(query.since));
    if (query.until) events = events.filter((e) => new Date(e.createdAt) <= new Date(query.until));

    // Sort newest first
    events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const p = paginate(req.query);
    const sliced = events.slice(p.offset, p.offset + p.limit);

    reply.send({
      data: sliced.map((e) => ({
        id: e.id, action: e.action, resourceType: e.resourceType, resourceId: e.resourceId,
        actorId: e.actorId, actorType: e.actorType, businessId: e.businessId,
        metadata: e.metadata, createdAt: e.createdAt,
      })),
      meta: { ...paginatedResponse(sliced, events.length, p), filters: { action: query.action, resourceType: query.resourceType, actorId: query.actorId, since: query.since, until: query.until } },
    });
  });

  app.get('/activity-log/stats', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    const events = sharedAudit.all(ctx.tenantId);

    const since = query.since ? new Date(query.since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const filtered = events.filter((e) => new Date(e.createdAt) >= since);

    const byAction: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    const byActor: Record<string, number> = {};

    for (const e of filtered) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
      byDay[e.createdAt.slice(0, 10)] = (byDay[e.createdAt.slice(0, 10)] ?? 0) + 1;
      byActor[e.actorId] = (byActor[e.actorId] ?? 0) + 1;
    }

    reply.send({
      data: {
        total: filtered.length,
        periodDays: Math.round((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)),
        byAction, byDay, byActor,
      },
    });
  });
}
