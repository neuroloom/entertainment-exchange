// API key routes — manage programmatic access keys for tenant integration
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { apiKeyService } from '../services/api-keys.service.js';

const CreateKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).min(1),
  expiresAt: z.string().optional(),
});

export async function apiKeyRoutes(app: FastifyInstance) {
  app.post('/api-keys', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'permissions'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          permissions: { type: 'array', items: { type: 'string' }, minItems: 1 },
          expiresAt: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();

    const body = CreateKeySchema.parse(req.body);
    const { apiKey, rawKey } = await apiKeyService.createKey(ctx.tenantId, body.name, body.permissions, body.expiresAt);

    // Return the raw key only once — it cannot be retrieved again
    reply.status(201).send({
      data: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        key: rawKey,
        permissions: apiKey.permissions,
        expiresAt: apiKey.expiresAt ?? null,
        createdAt: apiKey.createdAt,
      },
    });
  });

  app.get('/api-keys', async (req, reply) => {
    const ctx = req.ctx;
    const all = apiKeyService.listKeys(ctx.tenantId);
    const p = paginate(req.query);
    const sliced = all.slice(p.offset, p.offset + p.limit);

    // Never expose key hashes — only prefixes
    const safe = sliced.map(k => ({
      id: k.id, name: k.name, keyPrefix: k.keyPrefix,
      permissions: k.permissions, lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt, revoked: k.revoked, createdAt: k.createdAt,
    }));

    reply.send(paginatedResponse(safe, all.length, p));
  });

  app.get('/api-keys/:id', async (req, reply) => {
    const ctx = req.ctx;
    const k = apiKeyService.getKey(params(req).id, ctx.tenantId);
    if (!k) throw AppError.notFound('API key');

    reply.send({
      data: {
        id: k.id, name: k.name, keyPrefix: k.keyPrefix,
        permissions: k.permissions, lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt, revoked: k.revoked, createdAt: k.createdAt,
      },
    });
  });

  app.post('/api-keys/:id/revoke', async (req, reply) => {
    const ctx = req.ctx;
    const ok = apiKeyService.revokeKey(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('API key');
    reply.send({ data: { revoked: true } });
  });

  app.delete('/api-keys/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = apiKeyService.deleteKey(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('API key');
    reply.send({ data: { deleted: true } });
  });
}
