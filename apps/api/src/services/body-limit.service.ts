// Request body limits — configurable size limits per endpoint
interface BodyLimitRule {
  tenantId: string;
  endpoint: string;
  maxBytes: number;
  createdAt: string;
}

const rules: BodyLimitRule[] = [];
const GLOBAL_DEFAULTS: Record<string, number> = {
  '/import/bookings': 5 * 1024 * 1024,     // 5MB for CSV imports
  '/attachments': 10 * 1024 * 1024,         // 10MB for files
  default: 1 * 1024 * 1024,                 // 1MB default
};

export const bodyLimits = {
  setRule(tenantId: string, endpoint: string, maxBytes: number): BodyLimitRule {
    const existing = rules.find(r => r.tenantId === tenantId && r.endpoint === endpoint);
    if (existing) { existing.maxBytes = maxBytes; return existing; }
    const r: BodyLimitRule = { tenantId, endpoint, maxBytes, createdAt: new Date().toISOString() };
    rules.push(r);
    return r;
  },

  getLimit(tenantId: string, endpoint: string): number {
    const rule = rules.find(r => r.tenantId === tenantId && r.endpoint === endpoint);
    if (rule) return rule.maxBytes;
    // Match by prefix
    for (const [prefix, limit] of Object.entries(GLOBAL_DEFAULTS)) {
      if (prefix !== 'default' && endpoint.startsWith(prefix)) return limit;
    }
    return GLOBAL_DEFAULTS.default;
  },

  checkContentLength(tenantId: string, endpoint: string, contentLength?: string): { ok: boolean; maxBytes: number; actualBytes: number } {
    const maxBytes = this.getLimit(tenantId, endpoint);
    const actualBytes = parseInt(contentLength ?? '0', 10) || 0;
    return { ok: actualBytes <= maxBytes, maxBytes, actualBytes };
  },

  listRules(tenantId: string): BodyLimitRule[] {
    return rules.filter(r => r.tenantId === tenantId);
  },

  deleteRule(tenantId: string, endpoint: string): boolean {
    const idx = rules.findIndex(r => r.tenantId === tenantId && r.endpoint === endpoint);
    if (idx === -1) return false;
    rules.splice(idx, 1);
    return true;
  },
};
