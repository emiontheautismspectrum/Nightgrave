/** Minimal D1 adapter over node:sqlite for tests: the Worker's real SQL runs against a real SQLite database. */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type V = string | number | null;

export function makeD1(): { DB: unknown; raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  for (const m of ['0001_init.sql', '0002_verification.sql']) db.exec(readFileSync(new URL(`../migrations/${m}`, import.meta.url), 'utf8'));
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
