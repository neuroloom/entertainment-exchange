// Tenant migration routes — transfer data between tenants
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { tenantMigration } from '../services/tenant-migration.service.js';
import { businesses } from './business.js';
import type { Business } from './business.js';
import { bookings } from './booking.js';
import type { Booking } from './booking.js';
import { agents } from './agent.js';
import type { Agent } from './agent.js';
import { listings } from './marketplace.js';
import type { Listing } from './marketplace.js';

type CreateBody = { targetTenantId: string; domains: string[] };

export async function migrationRoutes(app: FastifyInstance) {
  app.post('/migration/jobs', {
    schema: {
      body: {
        type: 'object',
        required: ['targetTenantId', 'domains'],
        properties: {
          targetTenantId: { type: 'string' },
          domains: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { ctx } = req;
    const body = req.body as CreateBody;
    const job = tenantMigration.createJob(ctx.tenantId, body.targetTenantId, body.domains);
    reply.status(201).send({ data: job });
  });

  app.post('/migration/jobs/:id/execute', async (req, reply) => {
    const { ctx } = req;
    const job = tenantMigration.getJob(params(req).id);
    if (!job || job.sourceTenantId !== ctx.tenantId) throw AppError.notFound('Migration job');

    const sourceData: Record<string, unknown[]> = {};
    for (const d of job.domains) {
      if (d === 'businesses') sourceData.businesses = businesses.all(ctx.tenantId);
      else if (d === 'bookings') sourceData.bookings = bookings.all(ctx.tenantId);
      else if (d === 'agents') sourceData.agents = agents.all(ctx.tenantId);
      else if (d === 'listings') sourceData.listings = listings.all(ctx.tenantId);
    }

    const result = await tenantMigration.execute(job.id, sourceData, (domain, records, targetTenantId) => {
      switch (domain) {
        case 'businesses': for (const r of records) businesses.set(r as unknown as Business); break;
        case 'bookings': for (const r of records) bookings.set(r as unknown as Booking); break;
        case 'agents': for (const r of records) agents.set(r as unknown as Agent); break;
        case 'listings': for (const r of records) listings.set(r as unknown as Listing); break;
      }
    });
    reply.send({ data: result });
  });

  app.post('/migration/jobs/:id/rollback', async (req, reply) => {
    const { ctx } = req;
    const job = tenantMigration.getJob(params(req).id);
    if (!job || job.sourceTenantId !== ctx.tenantId) throw AppError.notFound('Migration job');

    const result = tenantMigration.rollback(job.id, (domain, records) => {
      switch (domain) {
        case 'businesses': for (const r of records) businesses.set(r as unknown as Business); break;
        case 'bookings': for (const r of records) bookings.set(r as unknown as Booking); break;
        case 'agents': for (const r of records) agents.set(r as unknown as Agent); break;
        case 'listings': for (const r of records) listings.set(r as unknown as Listing); break;
      }
    });
    if (!result) throw AppError.notFound('Migration job');
    reply.send({ data: result });
  });

  app.get('/migration/jobs', async (req, reply) => {
    const { ctx } = req;
    reply.send({ data: tenantMigration.listJobs(ctx.tenantId) });
  });

  app.get('/migration/jobs/:id', async (req, reply) => {
    const job = tenantMigration.getJob(params(req).id);
    if (!job) throw AppError.notFound('Migration job');
    reply.send({ data: job });
  });
}
