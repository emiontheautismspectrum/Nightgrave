import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configConst, pageMeta } from '../vite.config';
import { DESCRIPTION, SITE_URL, TITLE } from '../src/config';

const html = readFileSync('index.html', 'utf8');
const run = (site?: string): string => {
  const p = pageMeta(site);
  const t = p.transformIndexHtml as (h: string) => string;
  return t(html);
};

describe('page meta (title, description, Open Graph, Twitter)', () => {
  it('reads the constants from src/config.ts', () => {
    expect(configConst('TITLE')).toBe(TITLE);
    expect(configConst('DESCRIPTION')).toBe(DESCRIPTION);
    expect(configConst('SITE_URL')).toBe(SITE_URL);
  });
  it('fills title and description; without a site URL og:url and og:image are left out', () => {
    const out = run(undefined);
    expect(out).toContain(`<title>${TITLE}</title>`);
    expect(out).toContain(`<meta property="og:title" content="${TITLE}" />`);
    expect(out).toContain('name="twitter:card" content="summary_large_image"');
    expect(out).not.toMatch(/%NG_|ng-site-url/);
    if (!SITE_URL) {
      expect(out).not.toContain('og:image');
      expect(out).not.toContain('og:url');
      expect(out).not.toContain('twitter:image');
    }
  });
  it('with a site URL: absolute og:url / og:image / twitter:image, escaped, no inline script or style', () => {
    const out = run('https://nightgrave.example/');
    expect(out).toContain('<meta property="og:url" content="https://nightgrave.example/" />');
    expect(out).toContain('<meta property="og:image" content="https://nightgrave.example/og-image.png" />');
    expect(out).toContain('<meta name="twitter:image" content="https://nightgrave.example/og-image.png" />');
    expect(run('javascript:alert(1)')).not.toContain('og:image');
    expect(run('https://x.example/"><script>')).not.toContain('"><script>');
    expect(out).not.toMatch(/<script(?![^>]*src=)/);
    expect(out).not.toMatch(/<style|style="/);
  });
});
