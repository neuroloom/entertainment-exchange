// Integration health — third-party integration status tracking
export interface Integration {
  id: string;
  tenantId: string;
  name: string;
  type: 'slack' | 'stripe' | 'google_oauth' | 'github_oauth' | 'smtp' | 'custom_webhook';
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  lastCheckedAt?: string;
  errorMessage?: string;
  connectedAt?: string;
  metadata: Record<string, unknown>;
}

const integrations: Integration[] = [];

export const integrationHealth = {
  register(tenantId: string, name: string, type: Integration['type'], metadata?: Record<string, unknown>): Integration {
    const existing = integrations.find(i => i.tenantId === tenantId && i.type === type);
    if (existing) return existing;

    const i: Integration = {
      id: crypto.randomUUID(), tenantId, name, type,
      status: 'pending', metadata: metadata ?? {},
    };
    integrations.push(i);
    return i;
  },

  updateStatus(id: string, tenantId: string, status: Integration['status'], errorMessage?: string): Integration | null {
    const i = integrations.find(ii => ii.id === id && ii.tenantId === tenantId);
    if (!i) return null;

    i.status = status;
    i.lastCheckedAt = new Date().toISOString();
    if (errorMessage) i.errorMessage = errorMessage;
    if (status === 'connected' && !i.connectedAt) i.connectedAt = new Date().toISOString();

    return i;
  },

  list(tenantId: string): Integration[] {
    return integrations.filter(i => i.tenantId === tenantId);
  },

  get(id: string, tenantId: string): Integration | undefined {
    return integrations.find(i => i.id === id && i.tenantId === tenantId);
  },

  delete(id: string, tenantId: string): boolean {
    const idx = integrations.findIndex(i => i.id === id && i.tenantId === tenantId);
    if (idx === -1) return false;
    integrations.splice(idx, 1);
    return true;
  },

  getSummary(tenantId: string): { total: number; connected: number; errors: number; disconnected: number } {
    const tenant = integrations.filter(i => i.tenantId === tenantId);
    return {
      total: tenant.length,
      connected: tenant.filter(i => i.status === 'connected').length,
      errors: tenant.filter(i => i.status === 'error').length,
      disconnected: tenant.filter(i => i.status === 'disconnected').length,
    };
  },
};
