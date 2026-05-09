// Key rotation — automated API key rotation with grace periods
interface RotationPolicy {
  tenantId: string;
  keyId: string;
  rotationDays: number;
  gracePeriodDays: number;
  lastRotatedAt?: string;
  nextRotationDue: string;
  autoRotate: boolean;
}

interface RotationEvent {
  id: string;
  tenantId: string;
  keyId: string;
  oldKeyPrefix: string;
  newKeyPrefix: string;
  rotatedAt: string;
}

const policies: RotationPolicy[] = [];
const events: RotationEvent[] = [];

export const keyRotation = {
  setPolicy(tenantId: string, keyId: string, rotationDays: number, gracePeriodDays: number, autoRotate: boolean): RotationPolicy {
    const existing = policies.find(p => p.tenantId === tenantId && p.keyId === keyId);
    const nextDue = new Date(Date.now() + rotationDays * 24 * 60 * 60 * 1000).toISOString();

    if (existing) {
      Object.assign(existing, { rotationDays, gracePeriodDays, nextRotationDue: nextDue, autoRotate });
      return existing;
    }

    const p: RotationPolicy = { tenantId, keyId, rotationDays, gracePeriodDays, lastRotatedAt: undefined, nextRotationDue: nextDue, autoRotate };
    policies.push(p);
    return p;
  },

  getPolicy(tenantId: string, keyId: string): RotationPolicy | undefined {
    return policies.find(p => p.tenantId === tenantId && p.keyId === keyId);
  },

  listPolicies(tenantId: string): RotationPolicy[] {
    return policies.filter(p => p.tenantId === tenantId);
  },

  recordRotation(tenantId: string, keyId: string, oldPrefix: string, newPrefix: string): RotationEvent {
    const ev: RotationEvent = {
      id: crypto.randomUUID(), tenantId, keyId, oldKeyPrefix: oldPrefix, newKeyPrefix: newPrefix,
      rotatedAt: new Date().toISOString(),
    };
    events.push(ev);

    // Update policy
    const p = policies.find(pp => pp.tenantId === tenantId && pp.keyId === keyId);
    if (p) {
      p.lastRotatedAt = ev.rotatedAt;
      p.nextRotationDue = new Date(Date.now() + p.rotationDays * 24 * 60 * 60 * 1000).toISOString();
    }

    return ev;
  },

  getHistory(tenantId: string, keyId?: string): RotationEvent[] {
    return events
      .filter(e => e.tenantId === tenantId && (!keyId || e.keyId === keyId))
      .sort((a, b) => b.rotatedAt.localeCompare(a.rotatedAt));
  },

  getDueRotations(tenantId: string): RotationPolicy[] {
    return policies.filter(p => p.tenantId === tenantId && p.autoRotate && new Date(p.nextRotationDue) <= new Date());
  },
};
