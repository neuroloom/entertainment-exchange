// IP allowlist routes — manage IP/CIDR restrictions for API key access
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ipAllowlist } from '../services/ip-allowlist.service.js';

export async function ipAllowlistRoutes(app: FastifyInstance) {
  app.get('/security/ip-allowlist', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: ipAllowlist.get(ctx.tenantId) });
  });

  app.post('/security/ip-allowlist/entries', {
    schema: {
      body: {
        type: 'object',
        required: ['cidr', 'description'],
        properties: {
          cidr: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ cidr: z.string().min(1), description: z.string() }).parse(req.body);
    const list = ipAllowlist.addEntry(ctx.tenantId, body.cidr, body.description);
    reply.status(201).send({ data: list });
  });

  app.delete('/security/ip-allowlist/entries/:cidr', async (req, reply) => {
    const ctx = req.ctx;
    ipAllowlist.removeEntry(ctx.tenantId, decodeURIComponent(params(req).cidr));
    reply.send({ data: { deleted: true } });
  });

  app.put('/security/ip-allowlist/mode', {
    schema: {
      body: {
        type: 'object',
        required: ['mode', 'enabled'],
        properties: {
          mode: { type: 'string', enum: ['allow', 'deny'] },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = z.object({ mode: z.enum(['allow', 'deny']), enabled: z.boolean() }).parse(req.body);
    const list = ipAllowlist.setMode(ctx.tenantId, body.mode, body.enabled);
    reply.send({ data: list });
  });
}
