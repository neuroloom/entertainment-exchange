// Validation rules — centralized request validation constraints
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const RuleSchema = z.object({
  domain: z.enum(['businesses', 'bookings', 'agents', 'listings']),
  field: z.string().min(1),
  rule: z.enum(['required', 'minLength', 'maxLength', 'pattern', 'min', 'max', 'enum']),
  value: z.union([z.string(), z.number()]).optional(),
  message: z.string().optional(),
});

interface ValidationRule { domain: string; field: string; rule: string; value?: string | number; message?: string; createdAt: string; }
const rules: ValidationRule[] = [];

export async function validationRuleRoutes(app: FastifyInstance) {
  app.post('/validation/rules', {
    schema: {
      body: {
        type: 'object',
        required: ['domain', 'field', 'rule'],
        properties: {
          domain: { type: 'string', enum: ['businesses', 'bookings', 'agents', 'listings'] },
          field: { type: 'string', minLength: 1 },
          rule: { type: 'string', enum: ['required', 'minLength', 'maxLength', 'pattern', 'min', 'max', 'enum'] },
          value: { },
          message: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = RuleSchema.parse(req.body);
    const r: ValidationRule = { ...body, createdAt: new Date().toISOString() };
    rules.push(r);
    reply.status(201).send({ data: r });
  });

  app.get('/validation/rules', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const filtered = query.domain ? rules.filter(r => r.domain === query.domain) : rules;
    reply.send({ data: filtered });
  });

  app.post('/validation/check', {
    schema: {
      body: {
        type: 'object',
        required: ['domain', 'data'],
        properties: {
          domain: { type: 'string' },
          data: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ domain: z.string().min(1), data: z.record(z.unknown()) }).parse(req.body);
    const domainRules = rules.filter(r => r.domain === body.domain);
    const violations: Array<{ field: string; rule: string; message: string }> = [];

    for (const r of domainRules) {
      const val = body.data[r.field];
      switch (r.rule) {
        case 'required': if (val === undefined || val === null || val === '') violations.push({ field: r.field, rule: 'required', message: r.message ?? `${r.field} is required` }); break;
        case 'minLength': if (typeof val === 'string' && val.length < Number(r.value)) violations.push({ field: r.field, rule: 'minLength', message: r.message ?? `${r.field} min ${r.value}` }); break;
        case 'maxLength': if (typeof val === 'string' && val.length > Number(r.value)) violations.push({ field: r.field, rule: 'maxLength', message: r.message ?? `${r.field} max ${r.value}` }); break;
        case 'min': if (typeof val === 'number' && val < Number(r.value)) violations.push({ field: r.field, rule: 'min', message: r.message ?? `${r.field} min ${r.value}` }); break;
        case 'max': if (typeof val === 'number' && val > Number(r.value)) violations.push({ field: r.field, rule: 'max', message: r.message ?? `${r.field} max ${r.value}` }); break;
        case 'pattern': if (typeof val === 'string' && !new RegExp(String(r.value)).test(val)) violations.push({ field: r.field, rule: 'pattern', message: r.message ?? `${r.field} invalid format` }); break;
      }
    }

    reply.send({ data: { valid: violations.length === 0, violations } });
  });
}
