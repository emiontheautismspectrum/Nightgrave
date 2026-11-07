/** Minimal D1 adapter over node:sqlite for tests: the Worker's real SQL runs against a real SQLite database. */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type V = string | number | null;

/** Every migration in server/migrations, in order; `upTo` stops before a migration (the live D1 before it is applied). */
export function makeD1(opts: { upTo?: string } = {}): { DB: unknown; raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const m of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (opts.upTo && m >= opts.upTo) break;
    db.exec(readFileSync(new URL(m, dir), 'utf8'));
  }
  const stmt = (sql: string, params: V[] = []) => ({
    bind: (...p: V[]) => stmt(sql, p),
    first: async <T>() => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
    run: async () => {
      const r = db.prepare(sql).run(...params);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return { DB: { prepare: (sql: string) => stmt(sql) }, raw: db };
}
