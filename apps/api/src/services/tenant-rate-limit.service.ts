// Per-tenant rate limit configuration — plan-based defaults with override support
export interface TenantRateLimit {
  tenantId: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  burstMultiplier: number;      // Max burst above per-minute limit
  exemptEndpoints: string[];    // Endpoints excluded from rate limiting
  enabled: boolean;
}

const PLAN_DEFAULTS: Record<string, Omit<TenantRateLimit, 'tenantId'>> = {
  starter: { requestsPerMinute: 60, requestsPerHour: 1000, burstMultiplier: 2, exemptEndpoints: ['/health', '/metrics'], enabled: true },
  pro: { requestsPerMinute: 300, requestsPerHour: 5000, burstMultiplier: 3, exemptEndpoints: ['/health', '/metrics'], enabled: true },
  enterprise: { requestsPerMinute: 1000, requestsPerHour: 20000, burstMultiplier: 5, exemptEndpoints: ['/health', '/metrics'], enabled: true },
};

const overrides = new Map<string, Partial<TenantRateLimit>>();
const tenantPlans = new Map<string, string>();

export const tenantRateLimits = {
  setPlan(tenantId: string, plan: string): void {
    tenantPlans.set(tenantId, plan);
  },

  getPlan(tenantId: string): string {
    return tenantPlans.get(tenantId) ?? 'starter';
  },

  setOverride(tenantId: string, patch: Partial<TenantRateLimit>): TenantRateLimit {
    const existing = overrides.get(tenantId) ?? {};
    const merged = { ...existing, ...patch };
    overrides.set(tenantId, merged);
    return this.get(tenantId);
  },

  clearOverride(tenantId: string): boolean {
    return overrides.delete(tenantId);
  },

  get(tenantId: string): TenantRateLimit {
    const plan = this.getPlan(tenantId);
    const base = PLAN_DEFAULTS[plan] ?? PLAN_DEFAULTS.starter;
    const ov = overrides.get(tenantId) ?? {};
    return { tenantId, ...base, ...ov };
  },

  getPlanDefaults(): Record<string, Omit<TenantRateLimit, 'tenantId'>> {
    return { ...PLAN_DEFAULTS };
  },
};
