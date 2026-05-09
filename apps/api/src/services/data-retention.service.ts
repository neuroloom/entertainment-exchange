// Data retention — automated data lifecycle policies with configurable TTLs
export interface RetentionPolicy {
  tenantId: string;
  domain: string;
  retainDays: number;
  archiveAfterDays: number;
  deleteAfterDays: number;
  enabled: boolean;
  lastEnforcedAt?: string;
  createdAt: string;
}

const policies: RetentionPolicy[] = [];
const DEFAULT_RETENTION: Record<string, { retain: number; archive: number; delete: number }> = {
  bookings: { retain: 365, archive: 730, delete: 1095 },
  audit_events: { retain: 90, archive: 365, delete: 730 },
  notifications: { retain: 30, archive: 90, delete: 180 },
  webhook_deliveries: { retain: 30, archive: 90, delete: 180 },
  sessions: { retain: 7, archive: 0, delete: 30 },
};

export const dataRetention = {
  getPolicy(tenantId: string, domain: string): RetentionPolicy {
    return policies.find(p => p.tenantId === tenantId && p.domain === domain) ?? {
      tenantId, domain,
      retainDays: DEFAULT_RETENTION[domain]?.retain ?? 90,
      archiveAfterDays: DEFAULT_RETENTION[domain]?.archive ?? 365,
      deleteAfterDays: DEFAULT_RETENTION[domain]?.delete ?? 730,
      enabled: false, createdAt: new Date().toISOString(),
    };
  },

  setPolicy(tenantId: string, domain: string, patch: Partial<Omit<RetentionPolicy, 'tenantId' | 'domain' | 'createdAt'>>): RetentionPolicy {
    let p = policies.find(pp => pp.tenantId === tenantId && pp.domain === domain);
    if (!p) {
      p = { ...this.getPolicy(tenantId, domain), ...patch };
      policies.push(p);
    } else {
      Object.assign(p, patch);
    }
    return p;
  },

  listPolicies(tenantId: string): RetentionPolicy[] {
    const domains = Object.keys(DEFAULT_RETENTION);
    return domains.map(d => this.getPolicy(tenantId, d));
  },

  enforce(tenantId: string, stores: { [domain: string]: { deleteOlderThan: (days: number) => number } }): Record<string, number> {
    const results: Record<string, number> = {};
    for (const domain of Object.keys(stores)) {
      const policy = this.getPolicy(tenantId, domain);
      if (!policy.enabled) continue;
      results[domain] = stores[domain].deleteOlderThan(policy.retainDays);
      policy.lastEnforcedAt = new Date().toISOString();
    }
    return results;
  },
};
