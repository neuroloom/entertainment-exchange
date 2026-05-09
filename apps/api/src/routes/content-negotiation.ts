// Content negotiation routes — format and locale selection
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const SUPPORTED_LOCALES = ['en-US', 'en-GB', 'es', 'fr', 'de', 'ja', 'pt-BR'];
const ERROR_MESSAGES: Record<string, Record<string, string>> = {
  'en-US': { notFound: 'Not found', invalid: 'Invalid request', forbidden: 'Access denied' },
  es: { notFound: 'No encontrado', invalid: 'Solicitud inválida', forbidden: 'Acceso denegado' },
  fr: { notFound: 'Non trouvé', invalid: 'Requête invalide', forbidden: 'Accès refusé' },
  de: { notFound: 'Nicht gefunden', invalid: 'Ungültige Anfrage', forbidden: 'Zugriff verweigert' },
};

export async function contentNegotiationRoutes(app: FastifyInstance) {
  app.get('/locales', async (_req, reply) => {
    reply.send({ data: SUPPORTED_LOCALES });
  });

  app.get('/locales/:locale', async (req, reply) => {
    const locale = params(req).locale;
    const messages = ERROR_MESSAGES[locale] ?? ERROR_MESSAGES['en-US'];
    reply.send({ data: { locale, messages } });
  });

  // Translate helper endpoint
  app.post('/locales/translate', {
    schema: {
      body: {
        type: 'object',
        required: ['key', 'locale'],
        properties: {
          key: { type: 'string', enum: ['notFound', 'invalid', 'forbidden'] },
          locale: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ key: z.enum(['notFound', 'invalid', 'forbidden']), locale: z.string() }).parse(req.body);
    const messages = ERROR_MESSAGES[body.locale] ?? ERROR_MESSAGES['en-US'];
    reply.send({ data: { key: body.key, locale: body.locale, message: messages[body.key] ?? body.key } });
  });
}
