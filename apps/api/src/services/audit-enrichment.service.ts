// Audit enrichment — before/after snapshots on entity mutations for detailed audit trail
export interface EntitySnapshot {
  entityType: string;
  entityId: string;
  tenantId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  action: string;
  actorId: string;
  timestamp: string;
}

const snapshots: EntitySnapshot[] = [];
const MAX_SNAPSHOTS = 25_000;

export const auditEnrichment = {
  captureChange(opts: {
    entityType: string;
    entityId: string;
    tenantId: string;
    action: string;
    actorId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }): void {
    snapshots.push({ ...opts, timestamp: new Date().toISOString() });
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
  },

  getEntityHistory(entityType: string, entityId: string, tenantId: string): EntitySnapshot[] {
    return snapshots
      .filter(s => s.entityType === entityType && s.entityId === entityId && s.tenantId === tenantId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  },

  getRecentChanges(tenantId: string, limit = 50): EntitySnapshot[] {
    return snapshots
      .filter(s => s.tenantId === tenantId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  },

  getChangeSummary(tenantId: string, entityType?: string): { totalChanges: number; byAction: Record<string, number>; byEntityType: Record<string, number> } {
    const relevant = entityType
      ? snapshots.filter(s => s.tenantId === tenantId && s.entityType === entityType)
      : snapshots.filter(s => s.tenantId === tenantId);

    const byAction: Record<string, number> = {};
    const byEntityType: Record<string, number> = {};
    for (const s of relevant) {
      byAction[s.action] = (byAction[s.action] ?? 0) + 1;
      byEntityType[s.entityType] = (byEntityType[s.entityType] ?? 0) + 1;
    }

    return { totalChanges: relevant.length, byAction, byEntityType };
  },
};
