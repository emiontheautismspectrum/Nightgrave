import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { DESCRIPTION, SITE_URL, TITLE } from './src/config';
import { contactHtml, footerHtml, owner } from './src/legal';

/** dist/_headers: the CSP's connect-src gets the API origin from VITE_API_BASE (or nothing when offline). */
function headers(apiBase: string): Plugin {
  return {
    name: 'nightgrave-headers',
    apply: 'build',
    closeBundle() {
      let origin = '';
      try {
        origin = apiBase ? new URL(apiBase).origin : '';
      } catch {
        origin = '';
      }
      const src = readFileSync(resolve(__dirname, 'public/_headers'), 'utf8');
      writeFileSync(resolve(__dirname, 'dist/_headers'), src.replace("connect-src 'self' __API_ORIGIN__", origin ? `connect-src 'self' ${origin}` : "connect-src 'self'"));
    },
  };
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Every page (index.html and the legal pages): title, description, footer, and the Open Graph / Twitter tags from src/config.ts. og:url, og:image and
 * twitter:image need an absolute address: they are only written when SITE_URL (or VITE_SITE_URL) is a valid
 * http(s) URL, otherwise left out. og:url and the canonical link are the page's OWN address: `<site>/` for the game,
 * `<site>/privacy` (rules, credits, license) for the legal pages: the clean form Cloudflare Pages answers with 200
 * (it serves privacy.html there and redirects /privacy.html to it). og:image is the same file on every page.
 */
export function pagePath(file: string | undefined): string {
  const name = (file ?? '').split(/[\\/]/).pop()?.replace(/\?.*$/, '') ?? '';
  const m = /^([a-z0-9-]+)\.html$/i.exec(name);
  return !m || m[1]!.toLowerCase() === 'index' ? '/' : `/${m[1]!.toLowerCase()}`;
}

export function pageMeta(siteUrlEnv: string | undefined): Plugin {
  return {
    name: 'nightgrave-meta',
    transformIndexHtml(html, ctx) {
      const own = pagePath(ctx?.filename || ctx?.path);
      const title = attr(TITLE);
      const desc = attr(DESCRIPTION);
      let site = (siteUrlEnv ?? SITE_URL).trim().replace(/\/+$/, '');
      try {
        const u = new URL(site);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') site = '';
      } catch {
        site = '';
      }
      const extra = site
        ? [
            `<meta property="og:url" content="${attr(site + own)}" />`,
            `<meta property="og:image" content="${attr(site)}/og-image.png" />`,
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
            `<meta property="og:image:alt" content="${title}: a moonlit forest clearing arena" />`,
            `<meta name="twitter:image" content="${attr(site)}/og-image.png" />`,
            `<link rel="canonical" href="${attr(site + own)}" />`,
          ].join('\n    ')
        : '';
      return html
        // replacer functions: a '$' in a constant is never read as a replacement pattern
        .replace(/%NG_TITLE%/g, () => title)
        .replace(/%NG_DESCRIPTION%/g, () => desc)
        .replace(/%NG_OWNER%/g, () => attr(owner()))
        .replace('<!--ng-site-url-->', () => extra)
        .replace('<!--ng-footer-->', () => footerHtml())
        .replace('<!--ng-contact-->', () => contactHtml());
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    build: {
      target: 'es2022',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2000,
      // the legal pages share the CSP, the stylesheet and the footer; they have no script at all
      rollupOptions: { input: Object.fromEntries(['index', 'privacy', 'rules', 'credits', 'license'].map((n) => [n, resolve(__dirname, `${n}.html`)])) },
    },
    plugins: [headers(env.VITE_API_BASE ?? process.env.VITE_API_BASE ?? ''), pageMeta(env.VITE_SITE_URL ?? process.env.VITE_SITE_URL)],
    test: { include: ['tests/**/*.test.ts', 'server/test/**/*.test.ts'], environment: 'node' },
  };
});
