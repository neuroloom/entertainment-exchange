// Webhook catalog routes — event type documentation
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { webhookCatalog } from '../services/webhook-catalog.service.js';

export async function webhookCatalogRoutes(app: FastifyInstance) {
  app.get('/webhooks/catalog', async (req, reply) => {
    const query = req.query as Record<string, string>;
    reply.send({
      data: {
        categories: webhookCatalog.listCategories(),
        events: webhookCatalog.listByCategory(query.category),
      },
    });
  });

  app.get('/webhooks/catalog/:event', async (req, reply) => {
    const event = webhookCatalog.getEvent(params(req).event);
    if (!event) throw AppError.notFound('Event type');
    reply.send({ data: event });
  });

  app.get('/webhooks/catalog/search', async (req, reply) => {
    const query = req.query as Record<string, string>;
    reply.send({ data: webhookCatalog.searchEvents(query.q ?? '') });
  });
}
