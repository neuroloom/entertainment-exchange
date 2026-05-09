// Migration status routes — database migration tracking
import type { FastifyInstance } from 'fastify';
import { migrationStatus } from '../services/migration-status.service.js';

export async function migrationStatusRoutes(app: FastifyInstance) {
  app.get('/system/migrations', async (_req, reply) => {
    reply.send({
      data: {
        status: migrationStatus.getStatus(),
        history: migrationStatus.list(),
        latest: migrationStatus.getLatest(),
      },
    });
  });
}
