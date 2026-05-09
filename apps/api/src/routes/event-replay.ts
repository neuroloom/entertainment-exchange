// Event replay routes — reconstruct entity state from event history
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { eventReplay } from '../services/event-replay.service.js';

export async function eventReplayRoutes(app: FastifyInstance) {
  app.get('/events/replay/:entityType/:entityId', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const { entityType, entityId } = params(req);
    const state = eventReplay.replay(entityType, entityId);
    if (!state || (state as unknown as Record<string, unknown>).tenantId !== ctx.tenantId) throw AppError.notFound('No events found for this entity');
    reply.send({ data: state });
  });

  app.get('/events/timeline/:entityType/:entityId', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const { entityType, entityId } = params(req);
    const timeline = eventReplay.getTimeline(entityType, entityId);
    const filtered = timeline.filter(e => (e as unknown as Record<string, unknown>).tenantId === ctx.tenantId);
    reply.send({ data: filtered });
  });
}
