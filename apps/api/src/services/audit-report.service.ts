// Audit report service — structured report generation from audit events
export interface AuditReportRequest {
  tenantId: string;
  startDate?: string;
  endDate?: string;
  domains?: string[];
  actions?: string[];
  groupBy?: 'domain' | 'action' | 'actor' | 'day';
}

export interface AuditReport {
  generatedAt: string;
  period: { start: string; end: string };
  totalEvents: number;
  byDomain: Record<string, number>;
  byAction: Record<string, number>;
  byDay: Record<string, number>;
  topActors: Array<{ actorId: string; count: number }>;
}

export function generateAuditReport(events: Array<{
  action: string;
  resourceType: string;
  actorId: string;
  createdAt: string;
}>, opts: AuditReportRequest): AuditReport {
  const start = opts.startDate ? new Date(opts.startDate) : new Date(0);
  const end = opts.endDate ? new Date(opts.endDate) : new Date();

  const filtered = events.filter(e => {
    const d = new Date(e.createdAt);
    if (d < start || d > end) return false;
    if (opts.domains && !opts.domains.includes(e.resourceType)) return false;
    if (opts.actions && !opts.actions.includes(e.action)) return false;
    return true;
  });

  const byDomain: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const actorCounts: Record<string, number> = {};

  for (const e of filtered) {
    byDomain[e.resourceType] = (byDomain[e.resourceType] ?? 0) + 1;
    byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    const day = e.createdAt.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
    actorCounts[e.actorId] = (actorCounts[e.actorId] ?? 0) + 1;
  }

  const topActors = Object.entries(actorCounts)
    .map(([actorId, count]) => ({ actorId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    period: { start: start.toISOString(), end: end.toISOString() },
    totalEvents: filtered.length,
    byDomain, byAction, byDay, topActors,
  };
}
