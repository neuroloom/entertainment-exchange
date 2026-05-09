// Dead letter queue — store failed webhook/event deliveries for inspection
export interface DeadLetter {
  id: string;
  tenantId: string;
  source: string;           // e.g., 'webhook', 'notification', 'audit_stream'
  destination: string;      // URL or channel
  payload: unknown;
  error: string;
  attempts: number;
  lastAttemptAt: string;
  createdAt: string;
  acknowledged: boolean;
}

const letters: DeadLetter[] = [];
const MAX_LETTERS = 10_000;

export const deadLetters = {
  push(tenantId: string, source: string, destination: string, payload: unknown, error: string): DeadLetter {
    const dl: DeadLetter = {
      id: crypto.randomUUID(), tenantId, source, destination, payload, error,
      attempts: 1, lastAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), acknowledged: false,
    };
    letters.push(dl);
    if (letters.length > MAX_LETTERS) letters.splice(0, letters.length - MAX_LETTERS);
    return dl;
  },

  list(tenantId: string, source?: string): DeadLetter[] {
    return letters
      .filter(l => l.tenantId === tenantId && (!source || l.source === source))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  get(id: string, tenantId: string): DeadLetter | undefined {
    return letters.find(l => l.id === id && l.tenantId === tenantId);
  },

  acknowledge(id: string, tenantId: string): boolean {
    const l = letters.find(ll => ll.id === id && ll.tenantId === tenantId);
    if (!l || l.acknowledged) return false;
    l.acknowledged = true;
    return true;
  },

  retry(id: string, tenantId: string, retryFn: (letter: DeadLetter) => Promise<boolean>): Promise<boolean> {
    const l = letters.find(ll => ll.id === id && ll.tenantId === tenantId);
    if (!l) return Promise.resolve(false);
    l.attempts++;
    l.lastAttemptAt = new Date().toISOString();
    return retryFn(l).then(ok => {
      if (ok) l.acknowledged = true;
      return ok;
    });
  },

  stats(tenantId: string): { total: number; unacknowledged: number; bySource: Record<string, number> } {
    const tenant = letters.filter(l => l.tenantId === tenantId);
    const bySource: Record<string, number> = {};
    for (const l of tenant) bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    return { total: tenant.length, unacknowledged: tenant.filter(l => !l.acknowledged).length, bySource };
  },
};
