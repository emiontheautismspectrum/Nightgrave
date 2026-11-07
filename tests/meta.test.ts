import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageMeta, pagePath } from '../vite.config';
import { CONTACT_EMAIL, SITE_DOMAIN, SITE_URL, TITLE } from '../src/config';
import { contactEmail, copyrightLine, footerHtml, legalLinks } from '../src/legal';

const html = readFileSync('index.html', 'utf8');
type Ctx = { path: string; filename: string };
const transform = (site: string | undefined, src: string, file: string): string =>
  (pageMeta(site).transformIndexHtml as (h: string, c: Ctx) => string)(src, { path: `/${file}`, filename: `/repo/${file}` });
const run = (site?: string): string => transform(site, html, 'index.html');

describe('page meta (title, description, Open Graph, Twitter)', () => {
  it('footer: copyright, licence summary and links; no personal email in the repo', () => {
    expect(copyrightLine()).toMatch(/^\(c\) 2026 .+\. Code: MIT\. Art and audio: all rights reserved\.$/);
    expect(legalLinks().map((l) => l.label).slice(0, 4)).toEqual(['Privacy', 'Rules', 'Credits', 'License']);
    expect(CONTACT_EMAIL).toBe(''); // the author fills it in; never a personal address in the repository
    expect(contactEmail()).toBe('');
    expect(legalLinks().some((l) => l.label === 'Contact')).toBe(false);
    const f = footerHtml();
    expect(f).toContain('href="./privacy.html"');
    expect(f).toContain('rel="noopener noreferrer"');
    expect(run(undefined)).toContain(f);
  });
  it('every legal page exists, has the footer slot, a stylesheet, and no script or inline style', () => {
    for (const n of ['privacy', 'rules', 'credits', 'license']) {
      const src = readFileSync(`${n}.html`, 'utf8');
      const out = (pageMeta(undefined).transformIndexHtml as (h: string) => string)(src);
      expect(out).toContain(footerHtml());
      expect(out).toContain('<link rel="stylesheet"');
      expect(out).not.toMatch(/<script|<style|\sstyle="|\son[a-z]+="/i);
      expect(out).not.toMatch(/%NG_|<!--ng-/);
    }
  });
  it('fills title and description; without a site URL og:url and og:image are left out', () => {
    // an explicit empty VITE_SITE_URL turns the absolute tags off (a preview build without an address stays valid)
    const empty = run('');
    expect(empty).not.toContain('og:image');
    expect(empty).not.toContain('og:url');
    expect(empty).not.toContain('twitter:image');
    expect(empty).not.toContain('rel="canonical"');
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
  it('the site address is https://nightgrave.com (footer owner nightgrave.com); every page gets its OWN canonical = og:url', () => {
    expect(SITE_URL).toBe('https://nightgrave.com');
    expect(SITE_DOMAIN).toBe('nightgrave.com');
    expect(copyrightLine()).toBe('(c) 2026 nightgrave.com. Code: MIT. Art and audio: all rights reserved.');
    const pages = ['index', 'privacy', 'rules', 'credits', 'license'];
    const canon = pages.map((n) => {
      const out = transform(undefined, readFileSync(`${n}.html`, 'utf8'), `${n}.html`);
      const c = [...out.matchAll(/<link rel="canonical" href="([^"]+)" \/>/g)].map((m) => m[1]);
      const u = /<meta property="og:url" content="([^"]+)" \/>/.exec(out)?.[1];
      expect(c).toHaveLength(1);
      expect(c[0]).toBe(u);
      expect(out).toContain('<meta property="og:image" content="https://nightgrave.com/og-image.png" />');
      expect(out).toContain('<meta name="twitter:image" content="https://nightgrave.com/og-image.png" />');
      expect(out).not.toContain('pages.dev');
      return c[0];
    });
    expect(canon).toEqual(['https://nightgrave.com/', 'https://nightgrave.com/privacy', 'https://nightgrave.com/rules', 'https://nightgrave.com/credits', 'https://nightgrave.com/license']);
    expect(new Set(canon).size).toBe(5);
    expect(pagePath('/abs/dir/privacy.html')).toBe('/privacy');
    expect(pagePath('/index.html')).toBe('/');
    expect(pagePath(undefined)).toBe('/');
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
