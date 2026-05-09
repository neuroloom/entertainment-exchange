// SDK metadata routes — endpoint registry and client config generation
import type { FastifyInstance } from 'fastify';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { sdkMetadata } from '../services/sdk-metadata.service.js';

export async function sdkMetadataRoutes(app: FastifyInstance) {
  app.get('/sdk/endpoints', async (req, reply) => {
    const query = req.query as Record<string, string>;
    reply.send({
      data: {
        endpoints: sdkMetadata.listEndpoints({ domain: query.domain, method: query.method, auth: query.auth === 'true' ? true : query.auth === 'false' ? false : undefined }),
        domains: sdkMetadata.getDomains(),
      },
    });
  });

  app.get('/sdk/endpoints/:method::path', async (req, reply) => {
    const p = params(req);
    const ep = sdkMetadata.getEndpoint(`/api/v1/${p.path}`, p.method?.toUpperCase());
    reply.send({ data: ep ?? { message: 'Endpoint not found in registry' } });
  });

  app.get('/sdk/client-config/:language', async (req, reply) => {
    const lang = params(req).language;
    if (lang !== 'typescript' && lang !== 'python' && lang !== 'curl') {
      throw AppError.invalid('Unsupported language. Use typescript, python, or curl.');
    }
    reply.send({ data: sdkMetadata.generateClientConfig(lang) });
  });
}
