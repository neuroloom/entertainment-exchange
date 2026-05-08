// Repository layer — in-memory stores with PostgreSQL write-through and read-through hydration
// Routes keep their existing Map/Array-based interface.
// When DATABASE_URL is set, writes persist to PG and startup hydrates from PG.

// ── Column name conversion ──────────────────────────────────────────────────

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
}

function mapKeys(obj: Record<string, unknown>, fn: (k: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[fn(k)] = v;
  }
  return out;
}

// ── PG connection pool ──────────────────────────────────────────────────────

interface PoolLike { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>; end: () => Promise<void>; }
let _pool: PoolLike | null = null;
let _poolInit = false;

async function getPool(): Promise<PoolLike | null> {
  if (_pool) return _pool;
  if (_poolInit) return null;
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

// ── Store registry — hydrated at startup ────────────────────────────────────

const _stores: Array<{ hydrate: () => Promise<void> }> = [];

export function registerStore(store: { hydrate: () => Promise<void> }): void {
  _stores.push(store);
}

export async function hydrateAllStores(): Promise<void> {
  const pool = await getPool();
  if (!pool) return; // no PG, skip hydration — in-memory only
  const results = await Promise.allSettled(_stores.map(s => s.hydrate()));
  for (const r of results) {
    if (r.status === 'rejected') {
      console.warn('[repo] hydration error (non-fatal):', (r.reason as Error).message);
    }
  }
}

export async function pingPg(): Promise<boolean> {
  try {
    const pool = await getPool();
    if (!pool) return false;
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function migrateForward(): Promise<string[]> {
  // Dynamic import to avoid bundling migration runner into runtime unless needed
  const { migrate } = await import('../../../../packages/db/src/migrate.js');
  return migrate();
}

// ── In-Memory Store with PG persistence + hydration ─────────────────────────

export class MemoryStore<T = any> {
  private data = new Map<string, T>();

  constructor(private tableName?: string) {
    if (tableName) registerStore(this);
  }

  // ── Hydration (called at startup) ──────────────────────────────────────

  async hydrate(): Promise<void> {
    const pool = await getPool();
    if (!pool || !this.tableName) return;
    const { rows } = await pool.query(`SELECT * FROM ${this.tableName}`);
    for (const row of rows) {
      const mapped = mapKeys(row as Record<string, unknown>, snakeToCamel) as unknown as T;
      const id = (mapped as any).id;
      if (id) this.data.set(id, mapped);
    }
  }

  // ── Data access ────────────────────────────────────────────────────────

  set(itemOrKey: T | string, value?: T): void {
    if (typeof itemOrKey === 'string' && value !== undefined) {
      this.data.set(itemOrKey, value);
      if (this.tableName) void this.persist(value);
    } else {
      const item = itemOrKey as T;
      this.data.set((item as any).id, item);
      if (this.tableName) void this.persist(item);
    }
  }

  get(id: string): T | undefined { return this.data.get(id); }
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

  // ── Persistence ────────────────────────────────────────────────────────

  private async persist(item: T): Promise<void> {
    const pool = await getPool();
    if (!pool) return;
    try {
      const mapped = mapKeys(item as Record<string, unknown>, camelToSnake);
      const keys = Object.keys(mapped);
      const vals = keys.map(k => mapped[k]);
      const placeholders = vals.map((_, i) => `$${i + 1}`);
      await pool.query(
        `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (id) DO UPDATE SET ${keys.filter(k => k !== 'id').map((k, i) => `${k} = EXCLUDED.${k}`).join(', ')}`,
        vals,
      );
    } catch { /* PG unavailable — in-memory still works */ }
  }
}

// ── Audit Store ─────────────────────────────────────────────────────────────

export class AuditStore {
  private events: any[] = [];

  constructor() { registerStore(this); }

  async hydrate(): Promise<void> {
    const pool = await getPool();
    if (!pool) return;
    const { rows } = await pool.query('SELECT * FROM audit_events ORDER BY created_at');
    for (const row of rows) {
      const mapped = mapKeys(row as Record<string, unknown>, snakeToCamel);
      // Rename tenant_id→tenantId etc already handled by snakeToCamel
      this.events.push(mapped);
    }
  }

  push(event: any): void {
    this.events.push(event);
    void this.persist(event);
  }

  all(tenantId?: string): any[] {
    return tenantId ? this.events.filter((e: any) => e.tenantId === tenantId) : this.events;
  }

  filter(predicate: (event: any) => boolean): any[] { return this.events.filter(predicate); }
  find(predicate: (event: any) => boolean): any | undefined { return this.events.find(predicate); }
  some(predicate: (event: any) => boolean): boolean { return this.events.some(predicate); }
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

// ── Journal Store ───────────────────────────────────────────────────────────

export class JournalStore {
  journals: any[] = [];
  entries: any[] = [];

  constructor() { registerStore(this); }

  async hydrate(): Promise<void> {
    const pool = await getPool();
    if (!pool) return;
    const jRes = await pool.query('SELECT * FROM ledger_journals ORDER BY created_at');
    for (const row of jRes.rows) {
      const mapped = mapKeys(row as Record<string, unknown>, snakeToCamel);
      // PG columns use ledgers_journals schema; map referenceType/referenceId etc
      this.journals.push(mapped);
    }
    const eRes = await pool.query('SELECT * FROM ledger_entries ORDER BY journal_id');
    for (const row of eRes.rows) {
      const mapped = mapKeys(row as Record<string, unknown>, snakeToCamel);
      this.entries.push(mapped);
    }
  }

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
        `INSERT INTO ledger_journals (id, tenant_id, business_id, memo, reference_type, reference_id, occurred_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [j.id, j.tenantId, j.businessId, j.memo, j.referenceType, j.referenceId, j.occurredAt, j.createdAt],
      );
      for (const entry of e) {
        await pool.query(
          `INSERT INTO ledger_entries (id, tenant_id, journal_id, account_id, direction, amount_cents) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
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
