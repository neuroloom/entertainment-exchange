// Export routes — CSV/JSON data export for compliance and data portability
// GET /export/:domain — export data from a domain in CSV, JSON, or JSONL format
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { serializeRows, getExportContentType, getExportFilename } from '../services/export.service.js';
import type { ExportFormat } from '../services/export.service.js';
import { businesses } from './business.js';
import { bookings } from './booking.js';
import { agents } from './agent.js';
import { listings } from './marketplace.js';
import { anchors, passports } from './rights.js';
import { journalStore } from './ledger.js';

const VALID_DOMAINS = ['businesses', 'bookings', 'agents', 'listings', 'anchors', 'passports', 'ledger_journals', 'ledger_entries'];

export async function exportRoutes(app: FastifyInstance) {
  app.get('/export/:domain', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const domain = params(req).domain;
    if (!VALID_DOMAINS.includes(domain)) {
      throw AppError.invalid(`Invalid domain. Must be one of: ${VALID_DOMAINS.join(', ')}`);
    }

    const query = req.query as Record<string, string>;
    const format: ExportFormat = (query.format === 'csv' || query.format === 'json' || query.format === 'jsonl')
      ? query.format : 'csv';

    let rows: Record<string, unknown>[] = [];

    switch (domain) {
      case 'businesses':
        rows = businesses.all(ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
      case 'bookings':
        rows = bookings.all(ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
      case 'agents':
        rows = agents.all(ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
      case 'listings':
        rows = listings.all(ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
      case 'anchors':
        rows = anchors.all(ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
      case 'passports':
        rows = passports.all(ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
      case 'ledger_journals':
        rows = journalStore.journals.filter(j => j.tenantId === ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
      case 'ledger_entries':
        rows = journalStore.entries.filter(e => e.tenantId === ctx.tenantId) as unknown as Record<string, unknown>[];
        break;
    }

    if (query.businessId && rows[0] && 'businessId' in rows[0]) {
      rows = rows.filter(r => r.businessId === query.businessId);
    }

    const content = serializeRows(rows, format);
    const filename = getExportFilename(domain, format);

    reply
      .header('Content-Type', getExportContentType(format))
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Export-Count', String(rows.length))
      .send(content);
  });

  // GET /export — list available export domains with row counts
  app.get('/export', async (req, reply) => {
    const ctx = req.ctx;
    const domains = [
      { domain: 'businesses', count: businesses.all(ctx.tenantId).length },
      { domain: 'bookings', count: bookings.all(ctx.tenantId).length },
      { domain: 'agents', count: agents.all(ctx.tenantId).length },
      { domain: 'listings', count: listings.all(ctx.tenantId).length },
      { domain: 'anchors', count: anchors.all(ctx.tenantId).length },
      { domain: 'passports', count: passports.all(ctx.tenantId).length },
      { domain: 'ledger_journals', count: journalStore.journals.filter(j => j.tenantId === ctx.tenantId).length },
      { domain: 'ledger_entries', count: journalStore.entries.filter(e => e.tenantId === ctx.tenantId).length },
    ];

    reply.send({ data: domains, meta: { formats: ['csv', 'json', 'jsonl'] } });
  });
}
