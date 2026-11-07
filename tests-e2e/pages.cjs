/**
 * Every page of the production build under the real CSP from dist/_headers (vite preview does not send it, so the test
 * adds it to each response): zero CSP violations and page errors, the footer is present and every local footer link
 * answers 200. Run: npm run e2e:pages
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
// run vite itself (not through npx): kill() then stops the server instead of leaving an orphan on the port
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
const BASE = 'http://localhost:4189/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, name, extra = '') => {
  if (!c) failed++;
  console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  const csp = /Content-Security-Policy: (.+)/.exec(readFileSync(path.join(ROOT, 'dist', '_headers'), 'utf8'))[1].trim();
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4189', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  try {
    for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const ctx = await b.newContext({ viewport: vp });
      await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
      await ctx.route('**/*', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } });
      });
      for (const pg of ['', 'privacy.html', 'rules.html', 'credits.html', 'license.html']) {
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e)));
        page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
        await page.exposeFunction('__cspViolation', (d) => errs.push(`CSP ${d}`));
        await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => window.__cspViolation(`${e.violatedDirective} ${e.blockedURI}`)));
        const r = await page.goto(BASE + pg);
        await sleep(pg ? 400 : 2000);
        const info = await page.evaluate(() => {
          const f = document.querySelector('footer');
          return { links: f ? [...f.querySelectorAll('a')].map((a) => a.getAttribute('href')) : [], text: f ? f.textContent : '', sw: document.documentElement.scrollWidth, vw: innerWidth, font: getComputedStyle(document.body).fontFamily };
        });
        const name = `${vp.width}px ${pg || 'index.html'}`;
        ok(r.status() === 200 && errs.length === 0, `${name}: loads, no CSP violations or errors`, errs.join(' | '));
        // the site address (src/config.ts SITE_URL): one canonical per page = og:url = the page's own clean address
        // (Cloudflare Pages serves privacy.html at /privacy); none of either when SITE_URL is empty
        const site = (/export const SITE_URL = '([^']*)'/.exec(readFileSync(path.join(ROOT, 'src', 'config.ts'), 'utf8')) || [])[1] || '';
        const meta = await page.evaluate(() => ({
          canon: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href')),
          ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
          ogImg: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
        }));
        const own = site ? `${site.replace(/\/+$/, '')}/${pg.replace(/\.html$/, '')}` : null;
        ok(site ? meta.canon.length === 1 && meta.canon[0] === own && meta.ogUrl === own && meta.ogImg === `${site.replace(/\/+$/, '')}/og-image.png` : meta.canon.length === 0 && meta.ogUrl === null,
          `${name}: canonical / og:url = ${own ?? '(none)'}`, JSON.stringify(meta));
        ok(/\(c\) 2026 .+Code: MIT\. Art and audio: all rights reserved\./.test(info.text) && info.links.length >= 5, `${name}: footer`, info.links.join(' '));
        if (pg) ok(info.sw <= info.vw && /Press Start 2P/.test(info.font), `${name}: no horizontal scroll, game font`);
        for (const h of info.links.filter((x) => x.startsWith('./'))) {
          const lr = await ctx.request.get(new URL(h, BASE + pg).toString());
          if (lr.status() !== 200) ok(false, `${name}: link ${h}`, String(lr.status()));
        }
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.kill();
  }
  console.log(failed ? `PAGES: ${failed} failed` : 'PAGES: all passed');
  process.exitCode = failed ? 1 : 0;
})();
