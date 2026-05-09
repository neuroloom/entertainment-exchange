// Change management log — track configuration and entity changes
export interface ChangeRecord {
  id: string;
  tenantId: string;
  entityType: string;       // 'tenant_settings', 'rate_limit', 'feature_flag', 'webhook', 'integration'
  entityId: string;
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
  changedBy: string;
  changedAt: string;
  approvedBy?: string;
}

const records: ChangeRecord[] = [];
const MAX_RECORDS = 25_000;

export const changeLog = {
  record(opts: Omit<ChangeRecord, 'id' | 'changedAt'>): ChangeRecord {
    const r: ChangeRecord = {
      id: crypto.randomUUID(), ...opts, changedAt: new Date().toISOString(),
    };
    records.push(r);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    return r;
  },

  list(tenantId: string, opts?: { entityType?: string; entityId?: string; since?: string; field?: string }): ChangeRecord[] {
    return records
      .filter(r => r.tenantId === tenantId)
      .filter(r => !opts?.entityType || r.entityType === opts.entityType)
      .filter(r => !opts?.entityId || r.entityId === opts.entityId)
      .filter(r => !opts?.since || new Date(r.changedAt) >= new Date(opts.since))
      .filter(r => !opts?.field || r.field === opts.field)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  },

  get(id: string, tenantId: string): ChangeRecord | undefined {
    return records.find(r => r.id === id && r.tenantId === tenantId);
  },

  getSummary(tenantId: string, since?: string): { total: number; byEntityType: Record<string, number>; byChangedBy: Record<string, number>; recentChanges: ChangeRecord[] } {
    const recent = this.list(tenantId, { since: since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });

    const byEntityType: Record<string, number> = {};
    const byChangedBy: Record<string, number> = {};
    for (const r of recent) {
      byEntityType[r.entityType] = (byEntityType[r.entityType] ?? 0) + 1;
      byChangedBy[r.changedBy] = (byChangedBy[r.changedBy] ?? 0) + 1;
    }

    return { total: recent.length, byEntityType, byChangedBy, recentChanges: recent.slice(0, 20) };
  },
};
