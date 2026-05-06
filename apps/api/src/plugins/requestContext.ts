// Request context plugin — typed RequestContext on every Fastify request
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuid } from 'uuid';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  tenantId: string;
  businessId?: string;
  actor: {
    type: 'human' | 'agent' | 'system' | 'provider';
    id: string;
    userId?: string;
    roles: string[];
    permissions: string[];
  };
}

export async function requestContextPlugin(app: FastifyInstance) {
  app.decorateRequest('ctx', null as unknown as RequestContext);

  app.addHook('onRequest', async (req) => {
    const perms = (req.headers['x-actor-permissions'] as string)?.split(',').map(s => s.trim()) ?? [];
    (req as any).ctx = {
      requestId: uuid(),
      traceId: (req.headers['x-trace-id'] as string) ?? uuid(),
      tenantId: (req.headers['x-tenant-id'] as string) ?? '',
      businessId: (req.headers['x-business-id'] as string) ?? undefined,
      actor: {
        type: (req.headers['x-actor-type'] as string) ?? 'system',
        id: (req.headers['x-actor-id'] as string) ?? 'anonymous',
        roles: [],
        permissions: perms,
      },
    };
  });
}
