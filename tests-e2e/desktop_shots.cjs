/**
 * Desktop page layout screenshots with a mocked board API (production build): assets/preview/desktop_layout.png
 * (1920x1080) and desktop_layout_1366.png (1366x768). Checks: panel next to the game, no horizontal scroll.
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// assets/preview/ is untracked output (absent in a fresh clone): create it before writing screenshots
require('node:fs').mkdirSync(path.join(ROOT, 'assets', 'preview'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'http://localhost:8799';
const now = new Date();
const date = now.toISOString().slice(0, 10);
const names = ['NightOwl', 'Ember_Ash', 'Rune.Keeper', 'Wisp42', 'Graveborn', 'MothQueen', 'Ludo', 'Stonewall', 'Kira'];
const BOARD = {
  date, serverNow: now.toISOString(),
  top: [{ rank: 1, name: 'Lantern', score: 48210, hero: 'wisp', durationTicks: 9000, view: 'full' },
    ...names.slice(0, 7).map((n, i) => ({ rank: i + 2, name: n, score: 40000 - i * 3700, hero: i % 2 ? 'wisp' : 'knight', durationTicks: 7000 - i * 400, view: i === 2 ? 'zoomed' : 'full' }))],
  champion: { name: 'Lantern', message: 'The night is long, but the parry is longer!' },
};

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_API_BASE: API } });
  const srv = spawn('npx', ['vite', 'preview', '--port', '4186', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  let bad = 0;
  try {
    for (const [w, h, file] of [[1920, 1080, 'desktop_layout.png'], [1366, 768, 'desktop_layout_1366.png']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
      await ctx.route(`${API}/api/daily**`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(BOARD) }));
      await ctx.route(`${API}/api/daily/me`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ verifiedScore: 31250, verifiedRank: 4, pending: true }) }));
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto('http://localhost:4186/');
      await sleep(2500);
      const m = await p.evaluate(() => {
        const g = document.querySelector('#frame').getBoundingClientRect();
        const pn = document.querySelector('.bpanel')?.getBoundingClientRect();
        return { g: [g.x, g.y, g.width, g.height], p: pn ? [pn.x, pn.y, pn.width, pn.height] : null, sw: document.documentElement.scrollWidth, vw: innerWidth };
      });
      const side = m.p && m.p[0] > m.g[0] + m.g[2] && Math.abs(m.p[3] - m.g[3]) < 1;
      const ok = side && m.sw <= m.vw && errs.length === 0;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}x${h}: game ${m.g.map(Math.round)} panel ${m.p && m.p.map(Math.round)} scrollW ${m.sw} ${errs.join(' | ')}`);
      await p.screenshot({ path: path.join(ROOT, 'assets', 'preview', file) });
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  }
  process.exitCode = bad ? 1 : 0;
})();
