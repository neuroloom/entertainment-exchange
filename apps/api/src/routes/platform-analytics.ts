// Platform analytics — cross-tenant aggregate insights for platform operators
import type { FastifyInstance } from 'fastify';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings } from './marketplace.js';
import { journalStore } from './ledger.js';
import { usageMeter } from '../services/usage-meter.service.js';

export async function platformAnalyticsRoutes(app: FastifyInstance) {
  app.get('/platform/analytics', async (_req, reply) => {
    // Cross-tenant aggregate data (anonymized, no PII)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Collect all tenant IDs
    const tenantIds = new Set<string>();
    for (const b of businesses.values()) tenantIds.add(b.tenantId);

    let totalBusinesses = 0;
    let activeBusinesses = 0;
    let totalBookings = 0;
    let mtdBookings = 0;
    let totalRevenue = 0;
    let totalAgents = 0;
    let totalListings = 0;

    for (const tid of tenantIds) {
      const biz = businesses.all(tid);
      totalBusinesses += biz.length;
      activeBusinesses += biz.filter(b => b.status === 'active').length;

      const bk = bookings.all(tid);
      totalBookings += bk.length;
      mtdBookings += bk.filter(b => b.createdAt >= monthStart).length;

      totalAgents += agents.all(tid).length;
      totalListings += listings.all(tid).length;
    }

    // Revenue from all credit entries
    const creditEntries = journalStore.entries.filter(e => e.direction === 'credit');
    totalRevenue = creditEntries.reduce((s, e) => s + e.amountCents, 0);

    // Usage aggregation
    const usageSummaries = usageMeter.getAllTenantSummaries();
    const totalApiCalls = usageSummaries.reduce((s, u) => s + u.totalCalls, 0);

    reply.send({
      data: {
        tenants: { total: tenantIds.size },
        businesses: { total: totalBusinesses, active: activeBusinesses, avgPerTenant: tenantIds.size > 0 ? Math.round(totalBusinesses / tenantIds.size * 10) / 10 : 0 },
        bookings: { total: totalBookings, mtd: mtdBookings },
        revenue: { total: totalRevenue, formatted: `$${(totalRevenue / 100).toFixed(2)}` },
        agents: { total: totalAgents },
        listings: { total: totalListings },
        api: { totalCalls: totalApiCalls },
        generatedAt: now.toISOString(),
      },
    });
  });
}
