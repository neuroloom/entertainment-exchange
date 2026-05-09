// Sandbox environment — isolated test mode with separate data stores
interface SandboxState {
  tenantId: string;
  enabled: boolean;
  createdAt: string;
  dataIsolation: boolean;
  mockPayments: boolean;
  mockNotifications: boolean;
  rateLimitDisabled: boolean;
}

const sandboxes = new Map<string, SandboxState>();

export const sandbox = {
  enable(tenantId: string): SandboxState {
    const s: SandboxState = {
      tenantId, enabled: true, createdAt: new Date().toISOString(),
      dataIsolation: true, mockPayments: true,
      mockNotifications: true, rateLimitDisabled: true,
    };
    sandboxes.set(tenantId, s);
    return s;
  },

  disable(tenantId: string): boolean {
    return sandboxes.delete(tenantId);
  },

  isSandbox(tenantId: string): boolean {
    return sandboxes.get(tenantId)?.enabled ?? false;
  },

  get(tenantId: string): SandboxState | undefined {
    return sandboxes.get(tenantId);
  },

  isMockEnabled(tenantId: string, feature: 'payments' | 'notifications'): boolean {
    const s = sandboxes.get(tenantId);
    if (!s?.enabled) return false;
    return feature === 'payments' ? s.mockPayments : s.mockNotifications;
  },

  listAll(): SandboxState[] {
    return [...sandboxes.values()];
  },
};
