// Feature flags — per-tenant feature toggles with percentage rollout
export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  tenantId: string;
  enabled: boolean;
  rolloutPct: number;    // 0-100% of users
  rules?: Array<{ field: string; op: 'eq' | 'in'; values: string[] }>;
  createdAt: string;
}

const flags: FeatureFlag[] = [];
const BUILT_IN: Omit<FeatureFlag, 'tenantId' | 'createdAt'>[] = [
  { key: 'marketplace_v2', name: 'Marketplace v2', description: 'Redesigned marketplace with advanced filters', enabled: false, rolloutPct: 0 },
  { key: 'agent_autonomy', name: 'Agent Autonomy', description: 'Allow agents to auto-confirm bookings', enabled: true, rolloutPct: 100 },
  { key: 'crypto_payments', name: 'Crypto Payments', description: 'Enable cryptocurrency payment rails', enabled: false, rolloutPct: 0 },
  { key: 'fractional_rights', name: 'Fractional Rights', description: 'Enable fractional ownership of rights', enabled: false, rolloutPct: 0 },
  { key: 'ai_fraud_detection', name: 'AI Fraud Detection', description: 'Enable ML-based fraud detection', enabled: false, rolloutPct: 50 },
  { key: 'dark_mode', name: 'Dark Mode UI', description: 'Enable dark mode in dashboard', enabled: false, rolloutPct: 100 },
];

export const featureFlags = {
  init(tenantId: string): void {
    for (const f of BUILT_IN) {
      if (!flags.find(ff => ff.tenantId === tenantId && ff.key === f.key)) {
        flags.push({ ...f, tenantId, createdAt: new Date().toISOString() });
      }
    }
  },

  list(tenantId: string): FeatureFlag[] {
    return flags.filter(f => f.tenantId === tenantId);
  },

  get(tenantId: string, key: string): FeatureFlag | undefined {
    return flags.find(f => f.tenantId === tenantId && f.key === key);
  },

  isEnabled(tenantId: string, key: string, userId?: string): boolean {
    const f = this.get(tenantId, key);
    if (!f || !f.enabled) return false;
    if (f.rolloutPct >= 100) return true;
    if (f.rolloutPct <= 0) return false;

    // Deterministic rollout based on userId hash
    if (userId) {
      let hash = 0;
      for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
      return Math.abs(hash) % 100 < f.rolloutPct;
    }
    return Math.random() * 100 < f.rolloutPct;
  },

  update(tenantId: string, key: string, patch: Partial<Pick<FeatureFlag, 'enabled' | 'rolloutPct'>>): FeatureFlag | null {
    const f = this.get(tenantId, key);
    if (!f) return null;
    if (patch.enabled !== undefined) f.enabled = patch.enabled;
    if (patch.rolloutPct !== undefined) f.rolloutPct = patch.rolloutPct;
    return f;
  },
};
