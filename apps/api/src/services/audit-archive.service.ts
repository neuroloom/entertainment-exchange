// Audit archive — cold storage management for old audit data
export interface ArchiveBundle {
  id: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  recordCount: number;
  compressedSize: number;      // In-memory simulated
  status: 'created' | 'stored' | 'deleted';
  storageLocation?: string;
  createdAt: string;
  expiresAt?: string;          // When bundle can be purged
}

const bundles: ArchiveBundle[] = [];
const MAX_BUNDLES = 100;

export const auditArchive = {
  archive(tenantId: string, periodStart: string, periodEnd: string, recordCount: number): ArchiveBundle {
    const bundle: ArchiveBundle = {
      id: crypto.randomUUID(), tenantId,
      periodStart, periodEnd, recordCount,
      compressedSize: Math.round(recordCount * 150), // ~150 bytes/record compressed
      status: 'created',
      storageLocation: `archive://${tenantId}/${periodStart.slice(0, 7)}/audit-${Date.now()}.json.gz`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(), // 3 years
    };
    bundles.push(bundle);
    if (bundles.length > MAX_BUNDLES) bundles.shift();
    return bundle;
  },

  listBundles(tenantId: string): ArchiveBundle[] {
    return bundles.filter(b => b.tenantId === tenantId).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  },

  getBundle(id: string, tenantId: string): ArchiveBundle | undefined {
    return bundles.find(b => b.id === id && b.tenantId === tenantId);
  },

  deleteBundle(id: string, tenantId: string): boolean {
    const idx = bundles.findIndex(b => b.id === id && b.tenantId === tenantId);
    if (idx === -1) return false;
    bundles[idx].status = 'deleted';
    return true;
  },

  getStorageStats(tenantId: string): { totalBundles: number; totalRecords: number; totalSizeBytes: number; oldestBundle?: string; newestBundle?: string } {
    const tenant = bundles.filter(b => b.tenantId === tenantId && b.status !== 'deleted');
    if (tenant.length === 0) return { totalBundles: 0, totalRecords: 0, totalSizeBytes: 0 };

    return {
      totalBundles: tenant.length,
      totalRecords: tenant.reduce((s, b) => s + b.recordCount, 0),
      totalSizeBytes: tenant.reduce((s, b) => s + b.compressedSize, 0),
      oldestBundle: tenant[0].periodStart,
      newestBundle: tenant[tenant.length - 1].periodEnd,
    };
  },
};
