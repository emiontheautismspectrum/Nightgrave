import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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

/** A string constant from src/config.ts (TITLE, DESCRIPTION, SITE_URL): the page meta comes from the same source. */
export function configConst(name: string): string {
  const src = readFileSync(resolve(__dirname, 'src/config.ts'), 'utf8');
  const m = new RegExp(`export const ${name} = '((?:[^'\\\\]|\\\\.)*)';`).exec(src);
  return m ? m[1]!.replace(/\\'/g, "'") : '';
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * index.html: title, description and the Open Graph / Twitter tags from src/config.ts. og:url, og:image and
 * twitter:image need an absolute address: they are only written when SITE_URL (or VITE_SITE_URL) is a valid
 * http(s) URL, otherwise left out.
 */
export function pageMeta(siteUrlEnv: string | undefined): Plugin {
  return {
    name: 'nightgrave-meta',
    transformIndexHtml(html) {
      const title = attr(configConst('TITLE'));
      const desc = attr(configConst('DESCRIPTION'));
      let site = (siteUrlEnv ?? configConst('SITE_URL')).trim().replace(/\/+$/, '');
      try {
        const u = new URL(site);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') site = '';
      } catch {
        site = '';
      }
      const extra = site
        ? [
            `<meta property="og:url" content="${attr(site)}/" />`,
            `<meta property="og:image" content="${attr(site)}/og-image.png" />`,
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
            `<meta property="og:image:alt" content="${title}: a moonlit forest clearing arena" />`,
            `<meta name="twitter:image" content="${attr(site)}/og-image.png" />`,
            `<link rel="canonical" href="${attr(site)}/" />`,
          ].join('\n    ')
        : '';
      return html.replace(/%NG_TITLE%/g, title).replace(/%NG_DESCRIPTION%/g, desc).replace('<!--ng-site-url-->', extra);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
    plugins: [headers(env.VITE_API_BASE ?? process.env.VITE_API_BASE ?? ''), pageMeta(env.VITE_SITE_URL ?? process.env.VITE_SITE_URL)],
    test: { include: ['tests/**/*.test.ts', 'server/test/**/*.test.ts'], environment: 'node' },
  };
});
