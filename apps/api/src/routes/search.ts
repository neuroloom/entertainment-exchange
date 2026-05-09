// Search routes — cross-domain search across businesses, listings, bookings, agents, rights
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings } from './marketplace.js';
import { anchors, passports } from './rights.js';

interface SearchHit {
  domain: string;
  id: string;
  title: string;
  snippet: string;
  status: string;
  score: number;
}

function score(q: string, target: string): number {
  const lower = target.toLowerCase();
  const qLower = q.toLowerCase();
  if (lower === qLower) return 10;
  if (lower.startsWith(qLower)) return 8;
  if (lower.includes(qLower)) return 5;
  const words = qLower.split(/\s+/).filter(w => w.length > 1);
  let s = 0;
  for (const w of words) {
    if (lower.includes(w)) s += 3;
  }
  return Math.min(s, 10);
}

function highlight(q: string, text: string, maxLen = 120): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + q.length + 40);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet += '...';
  return snippet;
}

export async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const query = (req.query as Record<string, string>);
    const q = query.q?.trim();
    const domain = query.domain;

    if (!q || q.length < 2) {
      throw AppError.invalid('Query parameter "q" is required (minimum 2 characters)');
    }

    const allHits: SearchHit[] = [];
    const tenantId = ctx.tenantId;

    if (!domain || domain === 'business') {
      for (const b of businesses.all(tenantId)) {
        const s = score(q, b.name);
        if (s > 0) allHits.push({ domain: 'business', id: b.id, title: b.name, snippet: highlight(q, b.name), status: b.status, score: s });
      }
    }
    if (!domain || domain === 'booking') {
      for (const b of bookings.all(tenantId)) {
        const title = b.eventName ?? '';
        const s = score(q, title);
        if (s > 0) allHits.push({ domain: 'booking', id: b.id, title, snippet: highlight(q, title), status: b.status, score: s });
      }
    }
    if (!domain || domain === 'agent') {
      for (const a of agents.all(tenantId)) {
        const s = score(q, a.name);
        if (s > 0) allHits.push({ domain: 'agent', id: a.id, title: a.name, snippet: highlight(q, a.name), status: a.status, score: s });
      }
    }
    if (!domain || domain === 'listing') {
      for (const l of listings.all(tenantId)) {
        const s = score(q, l.title);
        if (s > 0) allHits.push({ domain: 'listing', id: l.id, title: l.title, snippet: highlight(q, l.title), status: l.status, score: s });
      }
    }
    if (!domain || domain === 'rights') {
      for (const a of anchors.all(tenantId)) {
        const title = a.documentType ?? '';
        const s = score(q, title);
        if (s > 0) allHits.push({ domain: 'rights_anchor', id: a.id, title, snippet: highlight(q, title), status: 'anchored', score: s });
      }
      for (const p of passports.all(tenantId)) {
        const title = `Passport ${p.id.slice(0, 8)}`;
        const s = score(q, title);
        if (s > 0) allHits.push({ domain: 'rights_passport', id: p.id, title, snippet: highlight(q, title), status: p.status ?? 'draft', score: s });
      }
    }

    // Sort by score descending
    allHits.sort((a, b) => b.score - a.score);

    const p = paginate(req.query);
    const sliced = allHits.slice(p.offset, p.offset + p.limit);

    const result = paginatedResponse(sliced, allHits.length, p);
    reply.send({
      data: sliced,
      meta: { total: result.total, limit: result.limit, offset: result.offset, query: q, domain: domain ?? 'all' },
    });
  });
}
