// Migration runner — reads .sql files from migrations/ and executes them in order
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

interface MigrationFile {
  name: string;
  path: string;
  order: number;
}

function discoverMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((name) => {
      const order = parseInt(name.split('_')[0], 10);
      return { name, path: join(dir, name), order };
    })
    .sort((a, b) => a.order - b.order);

  if (files.length === 0) {
    throw new Error(`No .sql migration files found in ${dir}`);
  }
  return files;
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function alreadyExecuted(client: pg.PoolClient, name: string): Promise<boolean> {
  const res = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  return (res.rowCount ?? 0) > 0;
}

async function recordMigration(client: pg.PoolClient, name: string): Promise<void> {
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
}

export async function migrate(databaseUrl?: string): Promise<string[]> {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for migrations');
  }

  const migrations = discoverMigrations(migrationsDir);
  const applied: string[] = [];
  const skipped: string[] = [];

  const pool = new pg.Pool({ connectionString, max: 1 });
  let client: pg.PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    for (const migration of migrations) {
      const done = await alreadyExecuted(client, migration.name);
      if (done) {
        skipped.push(migration.name);
        continue;
      }
      const sql = readFileSync(migration.path, 'utf-8');
      console.log(`[migrate] Applying: ${migration.name}`);
      await client.query(sql);
      await recordMigration(client, migration.name);
      applied.push(migration.name);
    }

    await client.query('COMMIT');
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }

  console.log(`[migrate] Applied ${applied.length}, skipped ${skipped.length}`);
  return applied;
}

// Run directly
const isMain = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isMain) {
  migrate().catch((err) => {
    console.error('[migrate] Failed:', err);
    process.exit(1);
  });
}
