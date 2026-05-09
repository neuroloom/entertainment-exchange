// Backup/restore service — tenant data snapshot for disaster recovery
import { v4 as uuid } from 'uuid';

export interface BackupSnapshot {
  id: string;
  tenantId: string;
  label: string;
  createdAt: string;
  domains: Record<string, unknown[]>;
  recordCount: number;
  sizeBytes: number;
}

export interface RestoreResult {
  snapshotId: string;
  restoredAt: string;
  domains: Array<{ domain: string; recordsRestored: number }>;
  totalRecords: number;
}

const snapshots: BackupSnapshot[] = [];
const MAX_SNAPSHOTS_PER_TENANT = 10;

export const backupService = {
  createSnapshot(tenantId: string, label: string, domainData: Record<string, unknown[]>): BackupSnapshot {
    const snapshot: BackupSnapshot = {
      id: uuid(), tenantId, label,
      createdAt: new Date().toISOString(),
      domains: domainData,
      recordCount: Object.values(domainData).reduce((s, arr) => s + arr.length, 0),
      sizeBytes: new TextEncoder().encode(JSON.stringify(domainData)).length,
    };

    // Enforce max snapshots
    const tenantSnapshots = snapshots.filter(s => s.tenantId === tenantId);
    if (tenantSnapshots.length >= MAX_SNAPSHOTS_PER_TENANT) {
      const oldest = tenantSnapshots[0];
      const idx = snapshots.indexOf(oldest);
      snapshots.splice(idx, 1);
    }

    snapshots.push(snapshot);
    return snapshot;
  },

  listSnapshots(tenantId: string): Omit<BackupSnapshot, 'domains'>[] {
    return snapshots
      .filter(s => s.tenantId === tenantId)
      .map(({ domains, ...rest }) => rest)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  getSnapshot(id: string, tenantId: string): BackupSnapshot | undefined {
    return snapshots.find(s => s.id === id && s.tenantId === tenantId);
  },

  deleteSnapshot(id: string, tenantId: string): boolean {
    const idx = snapshots.findIndex(s => s.id === id && s.tenantId === tenantId);
    if (idx === -1) return false;
    snapshots.splice(idx, 1);
    return true;
  },

  restoreFrom(id: string, tenantId: string, writeFn: (domain: string, records: unknown[]) => void): RestoreResult | null {
    const snapshot = this.getSnapshot(id, tenantId);
    if (!snapshot) return null;

    const domains: RestoreResult['domains'] = [];
    let totalRecords = 0;

    for (const [domain, records] of Object.entries(snapshot.domains)) {
      writeFn(domain, records);
      domains.push({ domain, recordsRestored: records.length });
      totalRecords += records.length;
    }

    return {
      snapshotId: id,
      restoredAt: new Date().toISOString(),
      domains,
      totalRecords,
    };
  },
};
