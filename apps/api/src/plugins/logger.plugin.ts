// Logger plugin — structured JSON logger wrapping Fastify's pino
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequestContext } from './requestContext.js';

export interface LogMeta {
  [key: string]: unknown;
}

const REDACT_KEYS = new Set([
  'password',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'accessToken',
  'refreshToken',
  'api_key',
  'access_token',
  'refresh_token',
]);

export interface StructuredLogger {
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
}

function getContext(req: FastifyRequest | undefined): Partial<RequestContext> {
  if (!req) return {};
  const ctx = (req as any).ctx as RequestContext | undefined;
  if (!ctx) return {};
  return {
    requestId: ctx.requestId,
    traceId: ctx.traceId,
    tenantId: ctx.tenantId,
  };
}

/** Recursively redact sensitive keys from an object */
function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function loggerPlugin(app: FastifyInstance) {
  // Create a structured logger that wraps Fastify's pino logger
  // Always includes timestamp, requestId, traceId, tenantId
  // Redacts sensitive fields: password, token, secret, apiKey, authorization

  const log: StructuredLogger = {
    info(msg: string, meta?: LogMeta) {
      const safeMeta = meta ? (redact(meta) as Record<string, unknown>) : {};
      app.log.info({ ...safeMeta, timestamp: new Date().toISOString() }, msg);
    },

    warn(msg: string, meta?: LogMeta) {
      const safeMeta = meta ? (redact(meta) as Record<string, unknown>) : {};
      app.log.warn({ ...safeMeta, timestamp: new Date().toISOString() }, msg);
    },

    error(msg: string, meta?: LogMeta) {
      const safeMeta = meta ? (redact(meta) as Record<string, unknown>) : {};
      app.log.error({ ...safeMeta, timestamp: new Date().toISOString() }, msg);
    },
  };

  // Decorate the app with the structured logger
  app.decorate('logStructured', log);

  // Add a hook to log each request with context fields
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const ctx = (req as any).ctx as RequestContext | undefined;
    log.info('incoming request', {
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
      tenantId: ctx?.tenantId,
      method: req.method,
      url: req.url,
    });
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply) => {
    const ctx = (req as any).ctx as RequestContext | undefined;
    log.info('request completed', {
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
      tenantId: ctx?.tenantId,
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      responseTime: Math.round(reply.elapsedTime),
    });
  });
}

// Augment Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    logStructured: StructuredLogger;
  }
}
