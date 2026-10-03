import type { Database, Queryable } from './database.js';
import { migrations, type Migration } from './migrations.js';

// any constant works; it only has to be the same in every instance of this app
const MIGRATION_LOCK_ID = 6007;

// Applies migrations that haven't run yet. Runs whenever an instance starts. On Vercel several instances can
// cold-start at the same moment, so the work happens under a transaction-level advisory lock and the list of
// pending migrations is read again once the lock is held. (A transaction-level lock also works through Neon's
// PgBouncer pooler, which a session-level lock would not.)
export async function migrate(db: Database, log: (msg: string) => void = () => {}): Promise<string[]> {
  if ((await pendingMigrations(db)).length === 0) return []; // usual case: nothing to do, no lock taken
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      description text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const newlyApplied: string[] = [];
    for (const m of await pendingMigrations(tx)) {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (version, description) VALUES ($1, $2)', [m.version, m.description]);
      newlyApplied.push(m.version);
      log(`applied migration ${m.version} (${m.description})`);
    }
    return newlyApplied;
  });
}

async function pendingMigrations(db: Queryable): Promise<Migration[]> {
  const { rows: [table] } = await db.query<{ present: boolean }>(`SELECT to_regclass('schema_migrations') IS NOT NULL AS present`);
  if (!table?.present) return migrations;
  const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  return migrations.filter((m) => !applied.has(m.version));
}
