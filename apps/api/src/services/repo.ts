// Repository layer — in-memory stores with optional PostgreSQL write-through
// Routes keep their existing Map-based interface. When DATABASE_URL is set,
// write operations also persist to PostgreSQL.

interface PoolLike { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>; end: () => Promise<void>; }
let _pool: PoolLike | null = null;
let _poolInit = false;

async function getPool(): Promise<PoolLike | null> {
  if (_pool) return _pool;
  if (_poolInit) return null; // already tried and failed
  _poolInit = true;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const pg = await import('pg');
    const Pool = pg.default?.Pool ?? pg.Pool;
    _pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }) as PoolLike;
    return _pool;
  } catch { return null; }
}

let _sqlCounter = 0;
function buildQuery(strings: TemplateStringsArray, values: unknown[]): { text: string; params: unknown[] } {
  let text = strings[0];
  const params: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    params.push(values[i]);
    _sqlCounter++;
    text += `$${_sqlCounter}${strings[i + 1]}`;
  }
  _sqlCounter = 0; // reset for next call
  return { text, params };
}

// ── In-Memory Store with optional SQL persistence ──────────────────────────

export class MemoryStore<T = any> {
  private data = new Map<string, T>();

  constructor(private tableName?: string) {}

  set(itemOrKey: T | string, value?: T): void {
    // Dual signature: set(item) or set(key, value) for Map-compatible usage
    if (typeof itemOrKey === 'string' && value !== undefined) {
      this.data.set(itemOrKey, value);
      if (this.tableName) void this.persist(value);
    } else {
      const item = itemOrKey as T;
      this.data.set((item as any).id, item);
      if (this.tableName) void this.persist(item);
    }
  }

  get(id: string): T | undefined {
    return this.data.get(id);
  }

  has(id: string): boolean { return this.data.has(id); }

  delete(id: string): boolean { return this.data.delete(id); }

  all(tenantId: string): T[] {
    return [...this.data.values()].filter(item => (item as any).tenantId === tenantId);
  }

  find(predicate: (item: T) => boolean): T | undefined {
    for (const item of this.data.values()) {
      if (predicate(item)) return item;
    }
    return undefined;
  }

  values(): IterableIterator<T> { return this.data.values(); }

  size(): number { return this.data.size; }

  private async persist(item: T): Promise<void> {
    const pool = await getPool();
    if (!pool) return;
    try {
      const keys = Object.keys(item as object);
      const vals = keys.map(k => (item as Record<string, unknown>)[k]);
      const placeholders = vals.map((_, i) => `$${i + 1}`);
      await pool.query(
        `INSERT INTO ${this.tableName} (${keys.join(',')}) VALUES (${placeholders.join(',')}) ON CONFLICT (id) DO NOTHING`,
        vals,
      );
    } catch { /* PG unavailable, in-memory still works */ }
  }
}

export class AuditStore {
  private events: any[] = [];

  push(event: any): void {
    this.events.push(event);
    void this.persist(event);
  }

  /** Returns all events, optionally filtered by tenantId */
  all(tenantId?: string): any[] {
    return tenantId ? this.events.filter((e: any) => e.tenantId === tenantId) : this.events;
  }

  filter(predicate: (event: any) => boolean): any[] {
    return this.events.filter(predicate);
  }

  find(predicate: (event: any) => boolean): any | undefined {
    return this.events.find(predicate);
  }

  some(predicate: (event: any) => boolean): boolean {
    return this.events.some(predicate);
  }

  count(tenantId?: string): number { return this.all(tenantId).length; }

  private async persist(event: any): Promise<void> {
    const pool = await getPool();
    if (!pool) return;
    try {
      const { id, tenantId, businessId, actorType, actorId, action, resourceType, resourceId, metadata, createdAt } = event;
      await pool.query(
        `INSERT INTO audit_events (id, tenant_id, business_id, actor_type, actor_id, action, resource_type, resource_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [id, tenantId, businessId ?? null, actorType, actorId, action, resourceType, resourceId, JSON.stringify(metadata ?? {}), createdAt],
      );
    } catch { /* PG unavailable */ }
  }
}

// ── Shared journal/account stores (for ledger) ─────────────────────────────

export class JournalStore {
  journals: any[] = [];
  entries: any[] = [];

  addJournal(j: any, e: any[]): void {
    this.journals.push(j);
    this.entries.push(...e);
    void this.persistJournal(j, e);
  }

  getJournal(id: string): any | undefined { return this.journals.find(j => j.id === id); }

  getEntries(journalId: string): any[] { return this.entries.filter(e => e.journalId === journalId); }

  listJournals(tenantId: string, businessId?: string): any[] {
    return this.journals.filter(j => j.tenantId === tenantId && (!businessId || j.businessId === businessId));
  }

  private async persistJournal(j: any, e: any[]): Promise<void> {
    const pool = await getPool();
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO journals (id, tenant_id, business_id, memo, reference_type, reference_id, occurred_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [j.id, j.tenantId, j.businessId, j.memo, j.referenceType, j.referenceId, j.occurredAt, j.createdAt],
      );
      for (const entry of e) {
        await pool.query(
          `INSERT INTO journal_entries (id, tenant_id, journal_id, account_id, direction, amount_cents) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [entry.id, j.tenantId, j.id, entry.accountId, entry.direction, entry.amountCents],
        );
      }
    } catch { /* PG unavailable */ }
  }
}

/** Close the pool if open. Call during graceful shutdown. */
export async function closeRepoPool(): Promise<void> {
  if (_pool) { await _pool.end(); _pool = null; }
}
