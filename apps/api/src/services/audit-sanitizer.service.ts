// Audit sanitizer — scrub PII and sensitive data from audit exports
const PII_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  { regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[REDACTED_PHONE]' },
  { regex: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, replacement: '[REDACTED_UUID]' },
  { regex: /\b(sk|pk|secret|token|key|password|api_key)[-_]?[=:]\s*\S+/gi, replacement: '$1=[REDACTED]' },
  { regex: /\b\d{13,19}\b/g, replacement: '[REDACTED_CARD]' },
];

const SENSITIVE_FIELDS = new Set([
  'password', 'passwordHash', 'token', 'secret', 'apiKey', 'key',
  'ssn', 'taxId', 'creditCard', 'cardNumber', 'cvv', 'pin',
  'accessToken', 'refreshToken', 'privateKey', 'clientSecret',
]);

export interface SanitizeResult {
  originalFields: number;
  sanitizedFields: number;
  sanitizedPii: number;
  scrubbed: Record<string, unknown>;
}

export const auditSanitizer = {
  sanitize(obj: Record<string, unknown>): SanitizeResult {
    const scrubbed: Record<string, unknown> = {};
    let sanitizedFields = 0;
    let sanitizedPii = 0;

    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.has(key)) {
        scrubbed[key] = '[REDACTED]';
        sanitizedFields++;
        continue;
      }

      if (typeof value === 'string') {
        let cleaned = value;
        for (const pattern of PII_PATTERNS) {
          const before = cleaned.length;
          cleaned = cleaned.replace(pattern.regex, pattern.replacement);
          if (cleaned.length !== before) sanitizedPii++;
        }
        scrubbed[key] = cleaned;
      } else if (value && typeof value === 'object') {
        scrubbed[key] = this.sanitize(value as Record<string, unknown>).scrubbed;
      } else {
        scrubbed[key] = value;
      }
    }

    return { originalFields: Object.keys(obj).length, sanitizedFields, sanitizedPii, scrubbed };
  },

  sanitizeBatch(records: Record<string, unknown>[]): { sanitized: Record<string, unknown>[]; stats: { totalFields: number; sanitizedFields: number; piiFound: number } } {
    let totalFields = 0;
    let sanitizedFields = 0;
    let piiFound = 0;

    const sanitized = records.map(r => {
      const result = this.sanitize(r);
      totalFields += result.originalFields;
      sanitizedFields += result.sanitizedFields;
      piiFound += result.sanitizedPii;
      return result.scrubbed;
    });

    return { sanitized, stats: { totalFields, sanitizedFields, piiFound } };
  },

  getRules(): Array<{ pattern: string; description: string }> {
    return [
      { pattern: 'email', description: 'Email addresses → [REDACTED_EMAIL]' },
      { pattern: 'phone', description: 'Phone numbers → [REDACTED_PHONE]' },
      { pattern: 'ssn', description: 'SSN → [REDACTED_SSN]' },
      { pattern: 'uuid', description: 'UUIDs → [REDACTED_UUID]' },
      { pattern: 'credentials', description: 'Tokens/keys/secrets → [REDACTED]' },
      { pattern: 'credit_card', description: 'Long digit sequences → [REDACTED_CARD]' },
      { pattern: 'sensitive_fields', description: `${SENSITIVE_FIELDS.size} field names always redacted` },
    ];
  },
};
