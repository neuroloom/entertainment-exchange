// Data archival service — retention policy enforcement for old records
// Auto-archives bookings older than threshold, keeping metadata for audit

export interface ArchivalPolicy {
  tenantId: string;
  bookingRetentionDays: number;    // Archive bookings older than N days
  auditRetentionDays: number;       // Archive audit events older than N days
  autoArchiveEnabled: boolean;
  lastRunAt?: string;
}

export interface ArchivalReport {
  tenantId: string;
  bookingsArchived: number;
  auditEventsArchived: number;
  runAt: string;
}

const policies: ArchivalPolicy[] = [];
const reports: ArchivalReport[] = [];

const DEFAULTS: ArchivalPolicy = {
  tenantId: '',
  bookingRetentionDays: 365,
  auditRetentionDays: 730,
  autoArchiveEnabled: false,
};

export const archivalService = {
  getPolicy(tenantId: string): ArchivalPolicy {
    return policies.find(p => p.tenantId === tenantId) ?? { ...DEFAULTS, tenantId };
  },

  setPolicy(tenantId: string, patch: Partial<Omit<ArchivalPolicy, 'tenantId'>>): ArchivalPolicy {
    let policy = policies.find(p => p.tenantId === tenantId);
    if (!policy) {
      policy = { ...DEFAULTS, tenantId, ...patch };
      policies.push(policy);
    } else {
      Object.assign(policy, patch);
    }
    return policy;
  },

  runArchival(tenantId: string, stores: {
    bookings: { all: (tid: string) => Record<string, unknown>[]; set: (item: Record<string, unknown>) => void };
    auditEvents: { all: (tid: string) => Record<string, unknown>[] };
  }): ArchivalReport {
    const policy = this.getPolicy(tenantId);
    const now = new Date();
    let bookingsArchived = 0;
    let auditArchived = 0;

    // Archive old bookings
    if (policy.bookingRetentionDays > 0) {
      const cutoff = new Date(now.getTime() - policy.bookingRetentionDays * 24 * 60 * 60 * 1000);
      const tenantBookings = stores.bookings.all(tenantId);

      for (const b of tenantBookings) {
        const status = b.status as string;
        const eventDate = new Date(b.eventDate as string);
        // Only archive completed/cancelled bookings that are old
        if (status !== 'completed' && status !== 'cancelled') continue;
        if (eventDate < cutoff) {
          b.status = 'archived';
          b.archivedAt = now.toISOString();
          stores.bookings.set(b);
          bookingsArchived++;
        }
      }
    }

    // Count audit events that would be affected
    if (policy.auditRetentionDays > 0) {
      const cutoff = new Date(now.getTime() - policy.auditRetentionDays * 24 * 60 * 60 * 1000);
      const tenantAudit = stores.auditEvents.all(tenantId);
      auditArchived = tenantAudit.filter(e => new Date(e.createdAt as string) < cutoff).length;
    }

    const report: ArchivalReport = {
      tenantId, bookingsArchived, auditEventsArchived: auditArchived, runAt: now.toISOString(),
    };
    reports.push(report);

    policy.lastRunAt = now.toISOString();
    return report;
  },

  getReports(tenantId: string): ArchivalReport[] {
    return reports.filter(r => r.tenantId === tenantId);
  },

  getLastReport(tenantId: string): ArchivalReport | undefined {
    return reports.filter(r => r.tenantId === tenantId).pop();
  },
};
