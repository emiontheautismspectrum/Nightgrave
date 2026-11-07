import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/** The production bundle must not contain the smoke-test state snapshot nor honour dev URL parameters. */
describe('production bundle', () => {
  it('has no __ngDebug and no dev URL parameters', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ng-prod-'));
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // vitest runs with NODE_ENV=test, which would make this a dev build
    try {
      delete process.env.VITE_SMOKE;
      await build({ logLevel: 'silent', mode: 'production', build: { outDir: out, emptyOutDir: true } });
      const js = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, 'assets', f), 'utf8')).join('\n');
      expect(js.length).toBeGreaterThan(1000);
      expect(js).not.toContain('__ngDebug');
      expect(js).not.toContain('__ngManual');
      expect(js).not.toContain('__nightgrave'); // the drawn-arc test hook
      expect(js).not.toContain('__ngShell'); // the shell test hook
      expect(js).not.toMatch(/get\("play"\)|get\('play'\)/);
      expect(js).not.toMatch(/get\("wave"\)|get\('wave'\)/);
      expect(js).not.toMatch(/get\("hero"\)|get\('hero'\)/); // the dev-only ?hero= helper
      // no source maps anywhere, no source-map comment in any bundle
      const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
      const every = walk(out);
      expect(every.filter((f) => f.endsWith('.map'))).toEqual([]);
      const text = every.filter((f) => /\.(js|css|html)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
      expect(text).not.toMatch(/sourceMappingURL/);
      // nothing secret-like: server secret names, token prefixes, private keys, the D1 database id field
      expect(text).not.toMatch(/ADMIN_TOKEN|VERIFIER_TOKEN|IP_SALT|database_id|BEGIN [A-Z ]*PRIVATE KEY|\b(ghp_|github_pat_|gho_|AKIA)[A-Za-z0-9]{8,}|Bearer [A-Za-z0-9._-]{16,}/);
    } finally {
      process.env.NODE_ENV = env;
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
