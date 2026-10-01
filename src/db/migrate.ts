import type { Database } from './database.js';
import { migrations } from './migrations.js';

// Applies migrations that haven't run yet. Runs on every start.
export async function migrate(db: Database, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    description text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const newlyApplied: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (version, description) VALUES ($1, $2)', [m.version, m.description]);
    });
    newlyApplied.push(m.version);
    log(`applied migration ${m.version} (${m.description})`);
  }
  return newlyApplied;
}
