// Activity feed — unified timeline across all domains for dashboards and audit
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { businesses } from './business.js';
import type { Business } from './business.js';
import { bookings } from './booking.js';
import type { Booking } from './booking.js';
import { agents } from './agent.js';
import type { Agent } from './agent.js';
import { listings } from './marketplace.js';
import type { Listing } from './marketplace.js';
import { anchors, passports } from './rights.js';
import { journalStore } from './ledger.js';
import type { LegalAnchor, RightsPassport } from '@entex/orchestration';
import type { JournalRecord } from '../services/repo.js';

type ActivityItem = Business | Booking | Agent | Listing | LegalAnchor | RightsPassport | JournalRecord;

interface ActivityEvent {
  id: string;
  domain: string;
  action: string;
  resourceId: string;
  title: string;
  status: string;
  timestamp: string;
}

export async function activityRoutes(app: FastifyInstance) {
  app.get('/activity', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const query = req.query as Record<string, string>;
    const domain = query.domain;
    const since = query.since; // ISO timestamp filter
    const events: ActivityEvent[] = [];

    const add = (domain: string, items: ActivityItem[], titleField: string, actionMap?: (item: ActivityItem) => string) => {
      for (const item of items) {
        if (item.tenantId !== ctx.tenantId) continue;
        if (since && new Date((item as unknown as Record<string, unknown>).updatedAt as string ?? (item as unknown as Record<string, unknown>).createdAt as string ?? 0) < new Date(since)) continue;
        const action = actionMap ? actionMap(item) : `${domain}.updated`;
        const rec = item as unknown as Record<string, unknown>;
        events.push({
          id: item.id, domain, action, resourceId: item.id,
          title: (rec[titleField] ?? rec.name ?? rec.eventName ?? rec.type ?? '') as string,
          status: (rec.status ?? 'active') as string,
          timestamp: (rec.updatedAt ?? rec.createdAt ?? new Date().toISOString()) as string,
        });
      }
    };

    if (!domain || domain === 'business') add('business', businesses.all(ctx.tenantId), 'name');
    if (!domain || domain === 'booking') add('booking', bookings.all(ctx.tenantId), 'eventName');
    if (!domain || domain === 'agent') add('agent', agents.all(ctx.tenantId), 'name');
    if (!domain || domain === 'listing') add('listing', listings.all(ctx.tenantId), 'title');
    if (!domain || domain === 'rights') {
      add('rights_anchor', anchors.all(ctx.tenantId), 'documentType');
      add('rights_passport', passports.all(ctx.tenantId), 'passportType');
    }
    if (!domain || domain === 'ledger') {
      for (const j of journalStore.journals) {
        if (j.tenantId !== ctx.tenantId) continue;
        if (since && new Date(j.createdAt ?? 0) < new Date(since)) continue;
        events.push({
          id: j.id, domain: 'ledger', action: 'journal.posted', resourceId: j.id,
          title: j.memo ?? 'Journal', status: 'posted', timestamp: j.createdAt ?? '',
        });
      }
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const p = paginate(req.query);
    const sliced = events.slice(p.offset, p.offset + p.limit);

    reply.send({
      data: sliced,
      meta: { ...paginatedResponse(sliced, events.length, p), domain: domain ?? 'all' },
    });
  });

  // GET /activity/stats — counts by domain for dashboard sparklines
  app.get('/activity/stats', async (req, reply) => {
    const ctx = req.ctx;
    const tenantId = ctx.tenantId;

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const recent = (items: ActivityItem[]) =>
      items.filter(i => i.tenantId === tenantId && ((i as unknown as Record<string, unknown>).createdAt as string ?? '') >= dayAgo).length;
    const weekly = (items: ActivityItem[]) =>
      items.filter(i => i.tenantId === tenantId && ((i as unknown as Record<string, unknown>).createdAt as string ?? '') >= weekAgo).length;

    const b = businesses.all(tenantId);
    const bk = bookings.all(tenantId);
    const a = agents.all(tenantId);
    const l = listings.all(tenantId);
    const an = anchors.all(tenantId);
    const pp = passports.all(tenantId);
    const jj = journalStore.journals.filter(j => j.tenantId === tenantId);

    reply.send({
      data: {
        businesses: { total: b.length, recent24h: recent(b), recent7d: weekly(b) },
        bookings: { total: bk.length, recent24h: recent(bk), recent7d: weekly(bk) },
        agents: { total: a.length, recent24h: recent(a), recent7d: weekly(a) },
        listings: { total: l.length, recent24h: recent(l), recent7d: weekly(l) },
        rights: { anchors: an.length, passports: pp.length, recent24h: recent(an) + recent(pp), recent7d: weekly(an) + weekly(pp) },
        ledger: { journals: jj.length, recent24h: recent(jj), recent7d: weekly(jj) },
      },
    });
  });
}
