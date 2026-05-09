// Tenant migration — transfer data between tenants with validation and rollback
import { v4 as uuid } from 'uuid';

export interface MigrationJob {
  id: string;
  sourceTenantId: string;
  targetTenantId: string;
  domains: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
  progress: { copied: number; total: number };
  errors: Array<{ domain: string; error: string }>;
  createdAt: string;
  completedAt?: string;
}

const jobs: MigrationJob[] = [];
const SNAPSHOT_MAX = 10;
const snapshots = new Map<string, Map<string, unknown[]>>();

export const tenantMigration = {
  createJob(sourceTenantId: string, targetTenantId: string, domains: string[]): MigrationJob {
    const job: MigrationJob = {
      id: uuid(), sourceTenantId, targetTenantId, domains,
      status: 'pending', progress: { copied: 0, total: 0 }, errors: [],
      createdAt: new Date().toISOString(),
    };
    jobs.push(job);
    return job;
  },

  getJob(id: string): MigrationJob | undefined {
    return jobs.find(j => j.id === id);
  },

  listJobs(tenantId: string): MigrationJob[] {
    return jobs.filter(j => j.sourceTenantId === tenantId || j.targetTenantId === tenantId);
  },

  async execute(id: string, sourceData: Record<string, unknown[]>, writeFn: (domain: string, records: unknown[], targetTenantId: string) => void): Promise<MigrationJob> {
    const job = jobs.find(j => j.id === id);
    if (!job || job.status !== 'pending') throw new Error('Job not found or not pending');

    job.status = 'running';

    // Snapshot source before migration
    const snapshot = new Map<string, unknown[]>();
    for (const [domain, records] of Object.entries(sourceData)) {
      snapshot.set(domain, [...records]);
    }
    const snapKey = `${job.sourceTenantId}-${job.id}`;
    snapshots.set(snapKey, snapshot);
    // Enforce max snapshots per tenant
    const tenantSnaps = [...snapshots.keys()].filter(k => k.startsWith(job.sourceTenantId));
    if (tenantSnaps.length > SNAPSHOT_MAX) {
      snapshots.delete(tenantSnaps[0]);
    }

    // Execute migration domain by domain
    job.progress.total = Object.values(sourceData).reduce((s, a) => s + a.length, 0);

    for (const domain of job.domains) {
      try {
        const records = sourceData[domain] ?? [];
        const migrated = (records as Record<string, unknown>[]).map(r => ({
          ...r,
          tenantId: job.targetTenantId,
          id: uuid(), // Assign new IDs to avoid collisions
        }));
        writeFn(domain, migrated, job.targetTenantId);
        job.progress.copied += records.length;
      } catch (err) {
        job.errors.push({ domain, error: err instanceof Error ? err.message : 'Unknown error' });
        job.status = 'failed';
        return job;
      }
    }

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    return job;
  },

  rollback(id: string, writeFn: (domain: string, records: unknown[], tenantId: string) => void): MigrationJob | null {
    const job = jobs.find(j => j.id === id);
    if (!job) return null;

    const snapKey = `${job.sourceTenantId}-${job.id}`;
    const snapshot = snapshots.get(snapKey);
    if (!snapshot) {
      job.status = 'failed';
      job.errors.push({ domain: 'all', error: 'No snapshot available for rollback' });
      return job;
    }

    for (const [domain, records] of snapshot) {
      writeFn(domain, records, job.sourceTenantId);
    }

    job.status = 'rolled_back';
    job.completedAt = new Date().toISOString();
    snapshots.delete(snapKey);
    return job;
  },
};
