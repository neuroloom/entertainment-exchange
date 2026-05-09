// Activity digest routes — daily/weekly summaries
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { activityDigest } from '../services/activity-digest.service.js';
import { bookings } from './booking.js';
import { businesses } from './business.js';
import { listings } from './marketplace.js';
import { agents } from './agent.js';
import { usageMeter } from '../services/usage-meter.service.js';

export async function activityDigestRoutes(app: FastifyInstance) {
  app.post('/activity/digest', {
    schema: {
      body: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['daily', 'weekly'] },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ period: z.enum(['daily', 'weekly']).optional() }).parse(req.body);
    const period = (body.period === 'weekly' ? 'weekly' : 'daily') as 'daily' | 'weekly';

    const tenantBookings = bookings.all(ctx.tenantId);
    const tenantBiz = businesses.all(ctx.tenantId);
    const tenantListings = listings.all(ctx.tenantId);
    const tenantAgents = agents.all(ctx.tenantId);
    const usage = usageMeter.getSummary(ctx.tenantId);

    const stats = {
      newBookings: tenantBookings.length,
      confirmedBookings: tenantBookings.filter(b => b.status === 'confirmed').length,
      newListings: tenantListings.length,
      dealsClosed: 0,
      revenue: 0,
      apiCalls: usage.totalCalls,
      newBusinesses: tenantBiz.length,
      activeAgents: tenantAgents.filter(a => a.status === 'active').length,
    };

    const highlights: string[] = [];
    if (stats.confirmedBookings > 0) highlights.push(`${stats.confirmedBookings} bookings confirmed`);
    if (stats.newListings > 0) highlights.push(`${stats.newListings} active listings`);
    if (stats.apiCalls > 0) highlights.push(`${stats.apiCalls} API calls`);
    if (highlights.length === 0) highlights.push('No significant activity');

    const d = activityDigest.generate(ctx.tenantId, period, stats, highlights, {
      recentBookings: tenantBookings.slice(-3).map(b => b.eventName ?? b.eventType),
      recentBusinesses: tenantBiz.slice(-3).map(b => b.name),
    });

    reply.send({ data: d });
  });

  app.get('/activity/digests', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: activityDigest.list(ctx.tenantId) });
  });

  app.get('/activity/digests/:id', async (req, reply) => {
    const ctx = req.ctx;
    const d = activityDigest.get(params(req).id, ctx.tenantId);
    if (!d) throw AppError.notFound('Digest');
    reply.send({ data: d });
  });
}
