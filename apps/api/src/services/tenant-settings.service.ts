// Tenant settings — per-tenant configuration with sensible defaults
import { MemoryStore } from './repo.js';

export interface TenantSettings {
  id: string;
  tenantId: string;
  currency: string;
  timezone: string;
  locale: string;
  features: {
    marketplace: boolean;
    rights: boolean;
    agents: boolean;
    ledger: boolean;
    webhooks: boolean;
  };
  branding: {
    logoUrl: string;
    primaryColor: string;
  };
  limits: {
    maxBookingsPerMonth: number;
    maxAgents: number;
    maxListings: number;
  };
  updatedAt: string;
}

const DEFAULTS: Omit<TenantSettings, 'id' | 'tenantId' | 'updatedAt'> = {
  currency: 'USD',
  timezone: 'America/New_York',
  locale: 'en-US',
  features: { marketplace: true, rights: true, agents: true, ledger: true, webhooks: false },
  branding: { logoUrl: '', primaryColor: '#4F46E5' },
  limits: { maxBookingsPerMonth: 1000, maxAgents: 5, maxListings: 50 },
};

const store = new MemoryStore<TenantSettings>('tenant_settings');

export const tenantSettings = {
  get(tenantId: string): TenantSettings {
    const existing = store.find(s => s.tenantId === tenantId);
    if (existing) return existing;
    // Return defaults without persisting
    return { id: 'default', tenantId, ...DEFAULTS, updatedAt: new Date().toISOString() };
  },

  upsert(tenantId: string, patch: Record<string, unknown>): TenantSettings {
    const existing = store.find(s => s.tenantId === tenantId);
    const now = new Date().toISOString();
    if (existing) {
      const merged = { ...existing, ...patch, updatedAt: now } as TenantSettings;
      // Deep merge nested objects
      if (patch.features) merged.features = { ...existing.features, ...(patch.features as Record<string, boolean>) };
      if (patch.branding) merged.branding = { ...existing.branding, ...(patch.branding as Record<string, string>) };
      if (patch.limits) merged.limits = { ...existing.limits, ...(patch.limits as Record<string, number>) };
      store.set(merged);
      return merged;
    }
    const base = { ...DEFAULTS, ...patch };
    const created: TenantSettings = {
      id: `ts-${tenantId.slice(0, 8)}`,
      tenantId,
      currency: base.currency ?? DEFAULTS.currency,
      timezone: base.timezone ?? DEFAULTS.timezone,
      locale: base.locale ?? DEFAULTS.locale,
      features: { ...DEFAULTS.features, ...(patch.features as Record<string, boolean> ?? {}) },
      branding: { ...DEFAULTS.branding, ...(patch.branding as Record<string, string> ?? {}) },
      limits: { ...DEFAULTS.limits, ...(patch.limits as Record<string, number> ?? {}) },
      updatedAt: now,
    };
    store.set(created);
    return created;
  },

  reset(tenantId: string): TenantSettings {
    const existing = store.find(s => s.tenantId === tenantId);
    if (!existing) return this.get(tenantId);
    const reset: TenantSettings = { id: existing.id, tenantId, ...DEFAULTS, updatedAt: new Date().toISOString() };
    store.set(reset);
    return reset;
  },
};

