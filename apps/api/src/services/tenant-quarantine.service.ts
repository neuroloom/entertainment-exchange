// Tenant quarantine — suspend or isolate suspicious tenants
export interface QuarantineRecord {
  tenantId: string;
  status: 'active' | 'quarantined' | 'suspended';
  reason: string;
  quarantinedBy: string;
  quarantinedAt: string;
  liftedAt?: string;
  liftedBy?: string;
}

const records: QuarantineRecord[] = [];

export const tenantQuarantine = {
  quarantine(tenantId: string, reason: string, actorId: string): QuarantineRecord {
    const existing = records.find(r => r.tenantId === tenantId && r.status === 'quarantined');
    if (existing) return existing;

    const r: QuarantineRecord = {
      tenantId, status: 'quarantined', reason,
      quarantinedBy: actorId, quarantinedAt: new Date().toISOString(),
    };
    records.push(r);
    return r;
  },

  suspend(tenantId: string, reason: string, actorId: string): QuarantineRecord {
    const r: QuarantineRecord = {
      tenantId, status: 'suspended', reason,
      quarantinedBy: actorId, quarantinedAt: new Date().toISOString(),
    };
    records.push(r);
    return r;
  },

  lift(tenantId: string, actorId: string): QuarantineRecord | null {
    const r = records.find(rr => rr.tenantId === tenantId && (rr.status === 'quarantined' || rr.status === 'suspended'));
    if (!r) return null;
    r.status = 'active';
    r.liftedAt = new Date().toISOString();
    r.liftedBy = actorId;
    return r;
  },

  getStatus(tenantId: string): { status: string; reason?: string; since?: string } {
    const r = records.find(rr => rr.tenantId === tenantId && rr.status !== 'active');
    if (!r) return { status: 'active' };
    return { status: r.status, reason: r.reason, since: r.quarantinedAt };
  },

  isBlocked(tenantId: string): boolean {
    const r = records.find(rr => rr.tenantId === tenantId && rr.status === 'suspended');
    return !!r;
  },

  listAll(): QuarantineRecord[] {
    return [...records].sort((a, b) => b.quarantinedAt.localeCompare(a.quarantinedAt));
  },
};
