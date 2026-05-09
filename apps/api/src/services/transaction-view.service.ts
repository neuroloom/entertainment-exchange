// Transaction view — cross-domain transaction lifecycle reconstruction
export interface TransactionView {
  transactionId: string;
  tenantId: string;
  domains: Array<{
    domain: string;
    entityId: string;
    action: string;
    timestamp: string;
    details: Record<string, unknown>;
  }>;
  timeline: Array<{ domain: string; step: string; timestamp: string }>;
  status: 'in_progress' | 'completed' | 'failed';
}

const views: TransactionView[] = [];
const MAX = 5000;

export const transactionView = {
  build(transactionId: string, tenantId: string, events: Array<{ domain: string; entityId: string; action: string; timestamp: string; details?: Record<string, unknown> }>): TransactionView {
    const tx: TransactionView = {
      transactionId, tenantId,
      domains: events.map(e => ({
        domain: e.domain, entityId: e.entityId, action: e.action,
        timestamp: e.timestamp, details: e.details ?? {},
      })),
      timeline: events.map(e => ({ domain: e.domain, step: e.action, timestamp: e.timestamp })).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      status: events.some(e => e.action.includes('failed') || e.action.includes('cancelled')) ? 'failed' : 'completed',
    };

    views.push(tx);
    if (views.length > MAX) views.splice(0, views.length - MAX);
    return tx;
  },

  get(transactionId: string, tenantId: string): TransactionView | undefined {
    return views.find(v => v.transactionId === transactionId && v.tenantId === tenantId);
  },

  list(tenantId: string, limit = 20): TransactionView[] {
    return views.filter(v => v.tenantId === tenantId).sort((a, b) => b.timeline[b.timeline.length - 1].timestamp.localeCompare(a.timeline[a.timeline.length - 1].timestamp)).slice(0, limit);
  },

  getStats(tenantId: string): { total: number; completed: number; failed: number; avgDomainsPerTx: number } {
    const tenant = views.filter(v => v.tenantId === tenantId);
    return {
      total: tenant.length,
      completed: tenant.filter(v => v.status === 'completed').length,
      failed: tenant.filter(v => v.status === 'failed').length,
      avgDomainsPerTx: tenant.length > 0 ? Math.round(tenant.reduce((s, v) => s + v.domains.length, 0) / tenant.length * 10) / 10 : 0,
    };
  },
};
