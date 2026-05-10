// Request context plugin — typed RequestContext on every Fastify request
import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

/** Typed route params — single cast replacing 146 `as any` call sites */
export function params<T extends Record<string, string> = Record<string, string>>(
  req: { params: unknown },
): T {
  return req.params as T;
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  tenantId: string;
  businessId?: string;
  sanitized?: boolean;
  actor: {
    type: 'human' | 'agent' | 'system' | 'provider' | 'api_key';
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
    req.ctx = {
      requestId: uuid(),
      traceId: (req.headers['x-trace-id'] as string) ?? uuid(),
      tenantId: (req.headers['x-tenant-id'] as string) ?? '',
      businessId: (req.headers['x-business-id'] as string) ?? undefined,
      actor: {
        type: (req.headers['x-actor-type'] as RequestContext['actor']['type']) || 'system',
        id: (req.headers['x-actor-id'] as string) ?? 'anonymous',
        roles: [],
        permissions: perms,
      },
    };
  });
}
