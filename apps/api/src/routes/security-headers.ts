// Security headers routes — CSP, HSTS, and response security management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { securityHeaders, type SecurityHeaderConfig } from '../services/security-headers.service.js';

export async function securityHeaderRoutes(app: FastifyInstance) {
  const UpdateHeadersSchema = z.object({
    hsts: z.object({
      enabled: z.boolean().optional(),
      maxAge: z.number().int().optional(),
    }).optional(),
    csp: z.object({
      enabled: z.boolean().optional(),
    }).optional(),
    xFrameOptions: z.enum(['DENY', 'SAMEORIGIN']).optional(),
    xContentTypeOptions: z.boolean().optional(),
    referrerPolicy: z.string().optional(),
  });
  app.get('/security/headers', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: securityHeaders.get(ctx.tenantId) });
  });

  app.patch('/security/headers', {
    schema: {
      body: {
        type: 'object',
        properties: {
          hsts: { type: 'object', properties: { enabled: { type: 'boolean' }, maxAge: { type: 'integer' } } },
          csp: { type: 'object', properties: { enabled: { type: 'boolean' } } },
          xFrameOptions: { type: 'string', enum: ['DENY', 'SAMEORIGIN'] },
          xContentTypeOptions: { type: 'boolean' },
          referrerPolicy: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const config = securityHeaders.update(ctx.tenantId, UpdateHeadersSchema.parse(req.body) as Partial<SecurityHeaderConfig>);
    reply.send({ data: config });
  });

  app.get('/security/headers/preview', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: securityHeaders.generateHeaders(ctx.tenantId) });
  });
}
