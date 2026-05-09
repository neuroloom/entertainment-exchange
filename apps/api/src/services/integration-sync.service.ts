// Integration sync status — track last sync time and status for integrations
export interface SyncRecord {
  integrationId: string;
  tenantId: string;
  syncType: string;           // 'full', 'incremental', 'webhook'
  status: 'syncing' | 'success' | 'failed';
  recordsProcessed: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  nextScheduledAt?: string;
}

const records: SyncRecord[] = [];

export const integrationSync = {
  startSync(integrationId: string, tenantId: string, syncType: string): SyncRecord {
    const r: SyncRecord = {
      integrationId, tenantId, syncType,
      status: 'syncing', recordsProcessed: 0,
      startedAt: new Date().toISOString(),
    };
    records.push(r);
    return r;
  },

  completeSync(integrationId: string, tenantId: string, recordsCount: number, nextScheduledAt?: string): SyncRecord | null {
    const r = records.find(rr => rr.integrationId === integrationId && rr.tenantId === tenantId && rr.status === 'syncing');
    if (!r) return null;
    r.status = 'success';
    r.recordsProcessed = recordsCount;
    r.completedAt = new Date().toISOString();
    if (nextScheduledAt) r.nextScheduledAt = nextScheduledAt;
    return r;
  },

  failSync(integrationId: string, tenantId: string, error: string): SyncRecord | null {
    const r = records.find(rr => rr.integrationId === integrationId && rr.tenantId === tenantId && rr.status === 'syncing');
    if (!r) return null;
    r.status = 'failed';
    r.error = error;
    r.completedAt = new Date().toISOString();
    return r;
  },

  getLatest(integrationId: string, tenantId: string): SyncRecord | undefined {
    return records
      .filter(r => r.integrationId === integrationId && r.tenantId === tenantId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  },

  getHistory(tenantId: string, limit = 20): SyncRecord[] {
    return records
      .filter(r => r.tenantId === tenantId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(-limit);
  },

  getSummary(tenantId: string): { total: number; success: number; failed: number; syncing: number; lastSyncAt?: string } {
    const tenant = records.filter(r => r.tenantId === tenantId);
    const latest = tenant.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

    return {
      total: tenant.length,
      success: tenant.filter(r => r.status === 'success').length,
      failed: tenant.filter(r => r.status === 'failed').length,
      syncing: tenant.filter(r => r.status === 'syncing').length,
      lastSyncAt: latest?.completedAt,
    };
  },
};
