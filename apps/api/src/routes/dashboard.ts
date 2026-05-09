// Dashboard routes — aggregated KPIs across all domains
import type { FastifyInstance } from 'fastify';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings, deals } from './marketplace.js';
import { anchors, passports } from './rights.js';
import { journalStore } from './ledger.js';
import { usageMeter } from '../services/usage-meter.service.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', async (req, reply) => {
    const ctx = req.ctx;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

    const tenantBiz = businesses.all(ctx.tenantId);
    const tenantBookings = bookings.all(ctx.tenantId);
    const tenantAgents = agents.all(ctx.tenantId);
    const tenantListings = listings.all(ctx.tenantId);
    const tenantAnchors = anchors.all(ctx.tenantId);
    const tenantPassports = passports.all(ctx.tenantId);

    // Revenue: sum credit entries for this tenant
    const tenantJournals = journalStore.journals.filter(j => j.tenantId === ctx.tenantId);
    const journalIds = new Set(tenantJournals.map(j => j.id));
    const creditEntries = journalStore.entries.filter(
      e => journalIds.has(e.journalId) && e.direction === 'credit',
    );

    const totalRevenue = creditEntries.reduce((s, e) => s + e.amountCents, 0);
    const mtdRevenue = creditEntries
      .filter(e => {
        const j = tenantJournals.find(jj => jj.id === e.journalId);
        return j && (j.occurredAt ?? j.createdAt) >= monthStart;
      })
      .reduce((s, e) => s + e.amountCents, 0);

    // Bookings funnel
    const confirmed = tenantBookings.filter(b => b.status === 'confirmed' || b.status === 'contracted').length;
    const completed = tenantBookings.filter(b => b.status === 'completed').length;
    const cancelled = tenantBookings.filter(b => b.status === 'cancelled').length;

    // Deals
    let dealCount = 0;
    let dealsClosed = 0;
    for (const dlist of deals.values()) {
      for (const d of dlist) {
        if (d.tenantId !== ctx.tenantId) continue;
        dealCount++;
        if (d.status === 'completed') dealsClosed++;
      }
    }

    // Agents
    const activeAgents = tenantAgents.filter(a => a.status === 'active').length;

    // Rights
    const activePassports = tenantPassports.filter(p => p.status === 'active').length;

    // Usage
    const usage = usageMeter.getSummary(ctx.tenantId);

    reply.send({
      data: {
        businesses: { total: tenantBiz.length, active: tenantBiz.filter(b => b.status === 'active').length },
        bookings: {
          total: tenantBookings.length, confirmed, completed, cancelled,
          mtd: tenantBookings.filter(b => b.createdAt >= monthStart).length,
          ytd: tenantBookings.filter(b => b.createdAt >= yearStart).length,
          conversionRate: tenantBookings.length > 0 ? (completed / tenantBookings.length * 100).toFixed(1) + '%' : '0%',
        },
        revenue: {
          total: totalRevenue,
          mtd: mtdRevenue,
          formatted: `$${(totalRevenue / 100).toFixed(2)}`,
        },
        agents: { total: tenantAgents.length, active: activeAgents, utilisationPct: tenantAgents.length > 0 ? Math.round(activeAgents / tenantAgents.length * 100) : 0 },
        marketplace: { listings: tenantListings.length, activeDeals: dealCount, dealsClosed },
        rights: { anchors: tenantAnchors.length, passports: tenantPassports.length, activePassports },
        usage: { callsMtd: usage.totalCalls, uniqueEndpoints: usage.uniqueEndpoints, errorRate: usage.totalCalls > 0 ? (usage.errorCount / usage.totalCalls * 100).toFixed(1) + '%' : '0%' },
      },
      meta: { tenantId: ctx.tenantId, generatedAt: now.toISOString() },
    });
  });
}
