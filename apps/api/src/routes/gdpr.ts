// GDPR / Privacy routes — data export, anonymization, and right-to-delete
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import type { Booking } from './booking.js';
import { agents } from './agent.js';
import { listings } from './marketplace.js';
import { anchors, passports } from './rights.js';
import { journalStore } from './ledger.js';

const REDACTED = '___REDACTED___';

interface DeletionReport {
  domain: string;
  itemsScrubbed: number;
  itemsDeleted: number;
}

export async function gdprRoutes(app: FastifyInstance) {
  // GET /gdpr/export — export all data for a specified user/business
  app.get('/gdpr/export', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const query = req.query as Record<string, string>;
    const businessId = query.businessId;
    const userId = query.userId;

    const data: Record<string, unknown[]> = {};

    if (businessId) {
      const b = businesses.get(businessId);
      if (b && b.tenantId === ctx.tenantId) data.businesses = [b];
      data.bookings = bookings.all(ctx.tenantId).filter(bk => bk.businessId === businessId);
      data.ledgerJournals = journalStore.journals.filter(j => j.businessId === businessId && j.tenantId === ctx.tenantId);
    }
    if (userId) {
      const bookingsForFilter = (data.bookings as Booking[] | undefined) ?? bookings.all(ctx.tenantId);
      data.bookings = bookingsForFilter.filter(b => b.clientId === userId);
      data.listings = listings.all(ctx.tenantId).filter(l => l.sellerBusinessId);
    }
    if (!businessId && !userId) {
      data.businesses = businesses.all(ctx.tenantId);
      data.bookings = bookings.all(ctx.tenantId);
      data.listings = listings.all(ctx.tenantId);
      data.agents = agents.all(ctx.tenantId);
      data.anchors = anchors.all(ctx.tenantId);
      data.passports = passports.all(ctx.tenantId);
    }

    const totalRecords = Object.values(data).reduce((s, arr) => s + arr.length, 0);
    reply.send({ data, meta: { totalRecords, exportedAt: new Date().toISOString() } });
  });

  // POST /gdpr/delete — scrub personal data for a specified entity
  app.post('/gdpr/delete', {
    schema: {
      body: {
        type: 'object',
        properties: {
          businessId: { type: 'string' },
          userId: { type: 'string' },
          domains: { type: 'array', items: { type: 'string', enum: ['businesses', 'bookings', 'listings', 'rights', 'agents'] } },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = z.object({ businessId: z.string().optional(), userId: z.string().optional(), domains: z.array(z.string()).optional() }).parse(req.body);
    if (!body.businessId && !body.userId) {
      throw AppError.invalid('At least one of businessId or userId is required');
    }

    const domains = body.domains ?? ['businesses', 'bookings', 'listings', 'rights', 'agents'];
    const report: DeletionReport[] = [];

    if (domains.includes('businesses') && body.businessId) {
      const b = businesses.get(body.businessId);
      if (b && b.tenantId === ctx.tenantId) {
        b.name = REDACTED;
        b.legalName = REDACTED;
        b.metadata = {};
        b.status = 'archived';
        businesses.set(b);
        report.push({ domain: 'businesses', itemsScrubbed: 1, itemsDeleted: 0 });
      }
    }

    if (domains.includes('bookings')) {
      let items = bookings.all(ctx.tenantId);
      if (body.businessId) items = items.filter(bk => bk.businessId === body.businessId);
      if (body.userId) items = items.filter(bk => bk.clientId === body.userId);

      for (const bk of items) {
        bk.eventName = REDACTED;
        bk.metadata = {};
        bk.clientId = null;
        bookings.set(bk);
      }
      report.push({ domain: 'bookings', itemsScrubbed: items.length, itemsDeleted: 0 });
    }

    if (domains.includes('listings') && body.businessId) {
      const items = listings.all(ctx.tenantId).filter(l => l.sellerBusinessId === body.businessId);
      for (const l of items) {
        l.title = REDACTED;
        l.metadata = {};
        listings.set(l);
      }
      report.push({ domain: 'listings', itemsScrubbed: items.length, itemsDeleted: 0 });
    }

    if (domains.includes('rights') && body.businessId) {
      let count = anchors.all(ctx.tenantId).length;
      for (const p of passports.all(ctx.tenantId)) {
        p.metadata = {};
        passports.set(p);
        count++;
      }
      report.push({ domain: 'rights', itemsScrubbed: count, itemsDeleted: 0 });
    }

    if (domains.includes('agents')) {
      const items = agents.all(ctx.tenantId);
      let count = 0;
      for (const a of items) {
        if (body.businessId && a.businessId !== body.businessId) continue;
        a.name = REDACTED;
        a.role = REDACTED;
        agents.set(a);
        count++;
      }
      report.push({ domain: 'agents', itemsScrubbed: count, itemsDeleted: 0 });
    }

    const totalScrubbed = report.reduce((s, r) => s + r.itemsScrubbed, 0);
    reply.send({
      data: {
        message: `Data deletion complete. ${totalScrubbed} records scrubbed across ${report.length} domains.`,
        report,
        requestedBy: ctx.actor.id,
        completedAt: new Date().toISOString(),
      },
    });
  });
}
