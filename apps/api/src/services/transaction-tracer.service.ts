// Transaction tracer — cross-domain correlation for business transactions
export interface TransactionSpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  domain: string;
  operation: string;
  resourceId: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: 'started' | 'completed' | 'failed';
  metadata: Record<string, unknown>;
}

const spans: TransactionSpan[] = [];
const MAX_SPANS = 25_000;

export const transactionTracer = {
  startSpan(traceId: string, domain: string, operation: string, resourceId: string, parentSpanId?: string, metadata?: Record<string, unknown>): TransactionSpan {
    const span: TransactionSpan = {
      id: crypto.randomUUID(), traceId, parentSpanId, domain, operation, resourceId,
      startTime: new Date().toISOString(), status: 'started', metadata: metadata ?? {},
    };
    spans.push(span);
    if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
    return span;
  },

  endSpan(spanId: string, status: 'completed' | 'failed' = 'completed', metadata?: Record<string, unknown>): TransactionSpan | null {
    const span = spans.find(s => s.id === spanId);
    if (!span) return null;
    span.endTime = new Date().toISOString();
    span.durationMs = new Date(span.endTime).getTime() - new Date(span.startTime).getTime();
    span.status = status;
    if (metadata) Object.assign(span.metadata, metadata);
    return span;
  },

  getTrace(traceId: string): { spans: TransactionSpan[]; totalDurationMs: number; domains: string[]; status: string } {
    const traceSpans = spans.filter(s => s.traceId === traceId).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (traceSpans.length === 0) return { spans: [], totalDurationMs: 0, domains: [], status: 'not_found' };

    const totalDurationMs = traceSpans.length > 1
      ? new Date(traceSpans[traceSpans.length - 1].startTime).getTime() - new Date(traceSpans[0].startTime).getTime()
      : (traceSpans[0].durationMs ?? 0);

    const hasFailed = traceSpans.some(s => s.status === 'failed');
    const allComplete = traceSpans.every(s => s.status === 'completed');

    return {
      spans: traceSpans,
      totalDurationMs,
      domains: [...new Set(traceSpans.map(s => s.domain))],
      status: hasFailed ? 'failed' : allComplete ? 'completed' : 'in_progress',
    };
  },

  listRecent(limit = 50): TransactionSpan[] {
    return [...spans].sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, limit);
  },

  getStats(): { totalTraces: number; avgDurationMs: number; activeTraces: number; byDomain: Record<string, number> } {
    const traceIds = new Set(spans.map(s => s.traceId));
    const byDomain: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let activeTraces = 0;

    for (const tid of traceIds) {
      const trace = this.getTrace(tid);
      totalDuration += trace.totalDurationMs;
      if (trace.status === 'completed' || trace.status === 'failed') completedCount++;
      if (trace.status === 'in_progress') activeTraces++;
      for (const d of trace.domains) byDomain[d] = (byDomain[d] ?? 0) + 1;
    }

    return {
      totalTraces: traceIds.size,
      avgDurationMs: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
      activeTraces, byDomain,
    };
  },
};
