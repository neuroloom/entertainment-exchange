// Backup routes — snapshot and restore tenant data
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { backupService } from '../services/backup.service.js';
import { businesses } from './business.js';
import type { Business } from './business.js';
import { bookings } from './booking.js';
import type { Booking } from './booking.js';
import { agents } from './agent.js';
import type { Agent } from './agent.js';
import { listings } from './marketplace.js';
import type { Listing } from './marketplace.js';
import { anchors, passports } from './rights.js';
import type { LegalAnchor, RightsPassport } from '@entex/orchestration';

function collectDomainData(tenantId: string): Record<string, unknown[]> {
  return {
    businesses: businesses.all(tenantId),
    bookings: bookings.all(tenantId),
    agents: agents.all(tenantId),
    listings: listings.all(tenantId),
    anchors: anchors.all(tenantId),
    passports: passports.all(tenantId),
  };
}

export async function backupRoutes(app: FastifyInstance) {
  app.post('/backup/snapshots', {
    schema: {
      body: {
        type: 'object',
        properties: {
          label: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ label: z.string().optional() }).parse(req.body);
    const data = collectDomainData(ctx.tenantId);
    const snapshot = backupService.createSnapshot(ctx.tenantId, body.label ?? `backup-${Date.now()}`, data);
    const { domains, ...safe } = snapshot;
    reply.status(201).send({ data: safe });
  });

  app.get('/backup/snapshots', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: backupService.listSnapshots(ctx.tenantId) });
  });

  app.get('/backup/snapshots/:id', async (req, reply) => {
    const ctx = req.ctx;
    const snapshot = backupService.getSnapshot(params(req).id, ctx.tenantId);
    if (!snapshot) throw AppError.notFound('Snapshot');
    const { domains, ...safe } = snapshot;
    reply.send({ data: safe });
  });

  app.post('/backup/snapshots/:id/restore', async (req, reply) => {
    const ctx = req.ctx;

    function restoreDomain(domain: string, records: unknown[]): void {
      switch (domain) {
        case 'businesses':
          for (const r of records) businesses.set(r as unknown as Business);
          break;
        case 'bookings':
          for (const r of records) bookings.set(r as unknown as Booking);
          break;
        case 'agents':
          for (const r of records) agents.set(r as unknown as Agent);
          break;
        case 'listings':
          for (const r of records) listings.set(r as unknown as Listing);
          break;
        case 'anchors':
          for (const r of records) anchors.set(r as unknown as LegalAnchor);
          break;
        case 'passports':
          for (const r of records) passports.set(r as unknown as RightsPassport);
          break;
      }
    }

    const result = backupService.restoreFrom(params(req).id, ctx.tenantId, restoreDomain);
    if (!result) throw AppError.notFound('Snapshot');
    reply.send({ data: result });
  });

  app.delete('/backup/snapshots/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = backupService.deleteSnapshot(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Snapshot');
    reply.send({ data: { deleted: true } });
  });
}
