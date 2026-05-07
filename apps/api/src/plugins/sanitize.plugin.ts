// Sanitize plugin — preHandler hook that sanitizes all request bodies and query params
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from './errorHandler.js';

// Strip bidirectional override characters: U+202A–U+202E and U+2066–U+2069
const BIDI_OVERRIDE_RE = /[‪-‮⁦-⁩]/g;

// Detect script tags for XSS prevention
const SCRIPT_TAG_RE = /<\s*script[\s/>]/i;

function sanitizeString(value: string, context: string): string {
  let sanitized = value.trim();
  sanitized = sanitized.replace(BIDI_OVERRIDE_RE, '');
  if (SCRIPT_TAG_RE.test(sanitized)) {
    throw AppError.invalid(`Potentially unsafe content in ${context}`);
  }
  return sanitized;
}

function sanitizeValue(value: unknown, context: string): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, `${context}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeValue(val, `${context}.${key}`);
    }
    return result;
  }
  return value;
}

export async function sanitizePlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    // Sanitize request body recursively (handles nested objects)
    if (req.body && typeof req.body === 'object') {
      const sanitized = sanitizeValue(req.body, 'request body');
      req.body = sanitized as any;
    }

    // Sanitize query parameters
    if (req.query) {
      const query = req.query as Record<string, unknown>;
      for (const key of Object.keys(query)) {
        const val = query[key];
        if (typeof val === 'string') {
          query[key] = sanitizeString(val, `query parameter '${key}'`);
        }
      }
    }

    // Track that sanitization was applied
    (req.ctx as any).sanitized = true;
  });
}
