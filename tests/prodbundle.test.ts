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
      expect(js).not.toMatch(/get\("play"\)|get\('play'\)/);
      expect(js).not.toMatch(/get\("wave"\)|get\('wave'\)/);
      expect(js).not.toMatch(/get\("hero"\)|get\('hero'\)/); // the dev-only ?hero= helper
    } finally {
      process.env.NODE_ENV = env;
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
