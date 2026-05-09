// Service accounts — machine-to-machine non-human user accounts
export interface ServiceAccount {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  permissions: string[];
  apiKeyId?: string;
  status: 'active' | 'disabled';
  lastUsedAt?: string;
  createdBy: string;
  createdAt: string;
}

const accounts: ServiceAccount[] = [];

export const serviceAccounts = {
  create(tenantId: string, name: string, description: string, permissions: string[], apiKeyId: string, createdBy: string): ServiceAccount {
    const sa: ServiceAccount = {
      id: crypto.randomUUID(), tenantId, name, description, permissions, apiKeyId,
      status: 'active', createdBy, createdAt: new Date().toISOString(),
    };
    accounts.push(sa);
    return sa;
  },

  list(tenantId: string): ServiceAccount[] {
    return accounts.filter(s => s.tenantId === tenantId);
  },

  get(id: string, tenantId: string): ServiceAccount | undefined {
    return accounts.find(s => s.id === id && s.tenantId === tenantId);
  },

  disable(id: string, tenantId: string): boolean {
    const s = accounts.find(ss => ss.id === id && ss.tenantId === tenantId);
    if (!s) return false;
    s.status = 'disabled';
    return true;
  },

  enable(id: string, tenantId: string): boolean {
    const s = accounts.find(ss => ss.id === id && ss.tenantId === tenantId && ss.status === 'disabled');
    if (!s) return false;
    s.status = 'active';
    return true;
  },

  delete(id: string, tenantId: string): boolean {
    const idx = accounts.findIndex(s => s.id === id && s.tenantId === tenantId);
    if (idx === -1) return false;
    accounts.splice(idx, 1);
    return true;
  },

  touch(id: string, tenantId: string): void {
    const s = accounts.find(ss => ss.id === id && ss.tenantId === tenantId);
    if (s) s.lastUsedAt = new Date().toISOString();
  },
};
