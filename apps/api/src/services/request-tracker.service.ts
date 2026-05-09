// Request tracker — full request lifecycle from arrival to response
export interface RequestLifecycle {
  requestId: string;
  tenantId: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  traceId: string;
  phases: Array<{ phase: string; durationMs: number }>;
  timestamp: string;
}

const lifecycles: RequestLifecycle[] = [];
const MAX = 10_000;

export const requestTracker = {
  record(lc: RequestLifecycle): void {
    lifecycles.push(lc);
    if (lifecycles.length > MAX) lifecycles.splice(0, lifecycles.length - MAX);
  },

  get(requestId: string): RequestLifecycle | undefined {
    return lifecycles.find(l => l.requestId === requestId);
  },

  getByTrace(traceId: string): RequestLifecycle[] {
    return lifecycles.filter(l => l.traceId === traceId);
  },

  getSlowest(limit = 20): RequestLifecycle[] {
    return [...lifecycles].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
  },

  getStats(): { total: number; avgMs: number; p95Ms: number; byStatus: Record<number, number> } {
    if (lifecycles.length === 0) return { total: 0, avgMs: 0, p95Ms: 0, byStatus: {} };

    const durations = [...lifecycles].map(l => l.durationMs).sort((a, b) => a - b);
    const avg = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const byStatus: Record<number, number> = {};
    for (const l of lifecycles) byStatus[l.statusCode] = (byStatus[l.statusCode] ?? 0) + 1;

    return { total: lifecycles.length, avgMs: avg, p95Ms: p95, byStatus };
  },
};
