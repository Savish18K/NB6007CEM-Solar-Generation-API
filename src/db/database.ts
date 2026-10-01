import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

// Small wrapper so the same queries run on node-postgres (production) and PGlite (dev and tests).
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  // multi-statement script without parameters, used by migrations
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PostgresDatabase implements Database {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: pg.Pool) {}

  async query<T>(text: string, params: unknown[] = []) {
    const result = await this.pool.query(text, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async exec(sql: string) {
    await this.pool.query(sql); // no parameters: simple-query protocol allows several statements
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Queryable = {
        query: async <R>(text: string, params: unknown[] = []) => {
          const r = await client.query(text, params);
          return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        },
      };
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

// PGlite is a dev dependency and loaded with a dynamic import, so its types are declared here.
type PGliteTx = {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
};
type PGliteInstance = PGliteTx & {
  transaction<T>(fn: (tx: PGliteTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

class PGliteDatabase implements Database {
  readonly kind = 'pglite' as const;
  constructor(private readonly db: PGliteInstance) {}

  async query<T>(text: string, params: unknown[] = []) {
    const r = await this.db.query<T>(text, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }

  async exec(sql: string) {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction(async (inner) =>
      fn({
        query: async <R>(text: string, params: unknown[] = []) => {
          const r = await inner.query<R>(text, params);
          return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
        },
        exec: async (sql: string) => {
          await inner.exec(sql);
        },
      }),
    );
  }

  async close() {
    await this.db.close();
  }
}

// postgres://...      PostgreSQL
// pglite://memory     in-memory PGlite (tests)
// pglite://./dir      PGlite stored on disk (local development)
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    return new PostgresDatabase(pool);
  }
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    const { PGlite } = await import('@electric-sql/pglite');
    // PGlite creates its data directory but not missing parents (e.g. .data/ on a fresh clone)
    if (target !== 'memory') mkdirSync(dirname(target), { recursive: true });
    const instance = target === 'memory' ? new PGlite() : new PGlite(target);
    return new PGliteDatabase(instance as unknown as PGliteInstance);
  }
  throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite://');
}
