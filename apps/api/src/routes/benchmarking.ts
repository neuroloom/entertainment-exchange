// Benchmarking routes — anonymous cross-tenant comparison
import type { FastifyInstance } from 'fastify';
import { benchmarking } from '../services/benchmarking.service.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';

export async function benchmarkingRoutes(app: FastifyInstance) {
  app.get('/benchmarks', async (req, reply) => {
    const ctx = req.ctx;

    // Collect all tenant metrics (anonymized)
    const allTenants = new Set<string>();
    for (const b of businesses.values()) allTenants.add(b.tenantId);

    const allMetrics: Array<{ tenantId: string; metrics: Record<string, number> }> = [];
    for (const tid of allTenants) {
      allMetrics.push({
        tenantId: tid,
        metrics: {
          totalBusinesses: businesses.all(tid).length,
          totalBookings: bookings.all(tid).length,
          confirmedBookings: bookings.all(tid).filter(b => b.status === 'confirmed' || b.status === 'contracted').length,
          completedBookings: bookings.all(tid).filter(b => b.status === 'completed').length,
        },
      });
    }

    const tenantMetrics = allMetrics.find(t => t.tenantId === ctx.tenantId)?.metrics ?? {};
    const benchmarks = benchmarking.compare(ctx.tenantId, tenantMetrics, allMetrics);
    const summary = benchmarking.generateSummary(ctx.tenantId, benchmarks);

    reply.send({ data: { benchmarks, summary } });
  });
}
