// PostgreSQL client — connection pool, tagged template literal, tenant-aware RLS
import pg from 'pg';

const { Pool } = pg;

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<QueryResult>;
}

// Internal pool singleton
let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  _pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  _pool.on('error', (err) => {
    // An idle client encountered an error — log and DO NOT crash
    console.error('[db] Unexpected pool error:', err.message);
  });
  return _pool;
}

// Shutdown helper for graceful teardown
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Build a parameterized query string from a tagged template literal.
 * Each call gets its own counter — safe for concurrent invocation.
 */
function buildQuery(strings: TemplateStringsArray, values: unknown[]): { text: string; params: unknown[] } {
  let counter = 0;
  let text = strings[0];
  const params: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    params.push(values[i]);
    counter++;
    text += `$${counter}${strings[i + 1]}`;
  }
  return { text, params };
}

/**
 * Tagged template literal for safe parameterized queries.
 *
 * Usage:
 *   const rows = await sql`SELECT * FROM bookings WHERE tenant_id = ${tenantId}`;
 */
export const sql: SqlTag = Object.assign(
  async (strings: TemplateStringsArray, ...values: unknown[]): Promise<QueryResult> => {
    const { text, params } = buildQuery(strings, values);
    const pool = getPool();
    const result = await pool.query(text, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  },
);

/**
 * Set the current tenant for Row-Level Security.
 * Must be called within a transaction or connection-scoped session
 * BEFORE any tenant-scoped queries.
 *
 * In a production app, a request-scoped pool client would hold this.
 * For MVP simplicity, we SET LOCAL inside a one-off query — this
 * works when pooling connections because SET LOCAL resets at
 * connection release.
 */
export async function withTenant<T>(tenantId: string | null, fn: (sql: SqlTag) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    if (tenantId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
    }
    // Create a query function scoped to this client
    const clientSql: SqlTag = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]): Promise<QueryResult> => {
        const { text, params } = buildQuery(strings, values);
        const result = await client.query(text, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
    );
    return await fn(clientSql);
  } finally {
    client.release();
  }
}

/**
 * For raw pool access when advanced operations are needed.
 */
export function pool(): pg.Pool {
  return getPool();
}
