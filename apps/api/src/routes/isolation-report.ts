// Isolation report routes — cross-tenant data leak verification
import type { FastifyInstance } from 'fastify';
import { isolationReport } from '../services/isolation-report.service.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings } from './marketplace.js';
import { anchors, passports } from './rights.js';

export async function isolationReportRoutes(app: FastifyInstance) {
  app.post('/security/isolation-check', async (req, reply) => {
    const ctx = req.ctx;

    const stores = {
      businesses: { all: (tid: string) => businesses.all(tid) },
      bookings: { all: (tid: string) => bookings.all(tid) },
      agents: { all: (tid: string) => agents.all(tid) },
      listings: { all: (tid: string) => listings.all(tid) },
      anchors: { all: (tid: string) => anchors.all(tid) },
      passports: { all: (tid: string) => passports.all(tid) },
    };

    const checks = isolationReport.checkAll(ctx.tenantId, stores);
    const status = isolationReport.getOverallStatus(checks);

    reply.send({ data: { checks, status } });
  });

  app.get('/security/isolation-check', async (_req, reply) => {
    const latest = isolationReport.getLatestReport();
    const status = isolationReport.getOverallStatus(latest);
    reply.send({ data: { report: latest, status } });
  });
}
