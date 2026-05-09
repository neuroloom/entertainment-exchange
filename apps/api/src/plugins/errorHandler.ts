// Error handler plugin — typed error responses per API_DEEP_SPEC.md
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
  static forbidden(msg = 'Forbidden') { return new AppError('FORBIDDEN', msg, 403); }
  static notFound(r: string) { return new AppError('NOT_FOUND', `${r} not found`, 404); }
  static invalid(msg: string) { return new AppError('INVALID_INPUT', msg, 400); }
  static conflict(msg: string) { return new AppError('CONFLICT', msg, 409); }
  static tenantRequired() { return new AppError('TENANT_REQUIRED', 'X-Tenant-ID header required', 400); }
  static unauthenticated(msg = 'Unauthenticated') { return new AppError('UNAUTHENTICATED', msg, 401); }
}

export async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((err: unknown, req, reply) => {
    const error = err as { validation?: unknown; code?: string; message?: string; status?: number; details?: Record<string, unknown> } & Error;

    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, requestId: req.ctx?.requestId, details: error.details },
      });
    }

    // Zod validation errors
    if (error instanceof ZodError) {
      const messages = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({
        error: { code: 'VALIDATION_FAILED', message: messages, requestId: req.ctx?.requestId },
      });
    }

    // Fastify native validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_FAILED', message: error.message, requestId: req.ctx?.requestId },
      });
    }

    const errMsg = (error instanceof Error) ? error.message : String(error);
    app.log.error({ err: errMsg, code: error?.code }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Internal server error', requestId: req.ctx?.requestId },
    });
  });
}
