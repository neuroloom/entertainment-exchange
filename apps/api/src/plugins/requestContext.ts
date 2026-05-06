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
    (req as any).ctx = {
      requestId: uuid(),
      traceId: (req.headers['x-trace-id'] as string) ?? uuid(),
      tenantId: (req.headers['x-tenant-id'] as string) ?? '',
      actor: {
        type: 'system',
        id: 'anonymous',
        roles: [],
        permissions: [],
      },
    };
  });
}
