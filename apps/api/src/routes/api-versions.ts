// API versioning routes — version info, changelog, and deprecation notices
import type { FastifyInstance } from 'fastify';
import { apiVersioning } from '../services/api-versioning.service.js';

export async function apiVersionRoutes(app: FastifyInstance) {
  app.get('/versions', async (_req, reply) => {
    reply.send({
      data: {
        current: apiVersioning.getCurrentVersion(),
        supported: apiVersioning.getAllVersions(),
      },
    });
  });

  app.get('/versions/changelog', async (_req, reply) => {
    reply.send({ data: apiVersioning.getChangelog() });
  });

  app.get('/versions/deprecations', async (_req, reply) => {
    reply.send({ data: apiVersioning.getDeprecations() });
  });
}
