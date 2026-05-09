// Audit streamer — push audit events to external endpoints (SIEM, webhook, syslog)
export interface AuditStream {
  id: string;
  tenantId: string;
  url: string;
  filterDomains: string[];
  filterActions: string[];
  enabled: boolean;
  batchSize: number;
  flushIntervalMs: number;
  lastFlushAt?: string;
  createdAt: string;
}

const streams: AuditStream[] = [];
const buffers = new Map<string, unknown[]>();

export const auditStreamer = {
  create(tenantId: string, opts: Partial<Omit<AuditStream, 'id' | 'tenantId' | 'createdAt'>>): AuditStream {
    const s: AuditStream = {
      id: crypto.randomUUID(), tenantId,
      url: opts.url ?? '', filterDomains: opts.filterDomains ?? [],
      filterActions: opts.filterActions ?? [], enabled: true,
      batchSize: opts.batchSize ?? 100, flushIntervalMs: opts.flushIntervalMs ?? 10_000,
      createdAt: new Date().toISOString(),
    };
    streams.push(s);
    buffers.set(s.id, []);
    return s;
  },

  list(tenantId: string): AuditStream[] {
    return streams.filter(s => s.tenantId === tenantId);
  },

  get(id: string, tenantId: string): AuditStream | undefined {
    return streams.find(s => s.id === id && s.tenantId === tenantId);
  },

  delete(id: string, tenantId: string): boolean {
    const idx = streams.findIndex(s => s.id === id && s.tenantId === tenantId);
    if (idx === -1) return false;
    streams.splice(idx, 1);
    buffers.delete(id);
    return true;
  },

  pushEvent(event: { tenantId: string; action: string; resourceType: string; resourceId: string; createdAt: string }): void {
    for (const s of streams) {
      if (!s.enabled || s.tenantId !== event.tenantId) continue;
      if (s.filterDomains.length && !s.filterDomains.includes(event.resourceType)) continue;
      if (s.filterActions.length && !s.filterActions.includes(event.action)) continue;

      const buf = buffers.get(s.id);
      if (buf) buf.push(event);

      if (buf && buf.length >= s.batchSize) {
        void flushStream(s, [...buf]);
        buf.length = 0;
      }
    }
  },

  async flushAll(tenantId: string): Promise<number> {
    let flushed = 0;
    for (const s of streams) {
      if (s.tenantId !== tenantId) continue;
      const buf = buffers.get(s.id);
      if (buf && buf.length > 0) {
        await flushStream(s, [...buf]);
        flushed += buf.length;
        buf.length = 0;
      }
    }
    return flushed;
  },
};

async function flushStream(s: AuditStream, events: unknown[]): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(s.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: s.id, events, flushedAt: new Date().toISOString() }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    s.lastFlushAt = new Date().toISOString();
  } catch { /* non-fatal */ }
}
