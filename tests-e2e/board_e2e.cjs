/**
 * Local end-to-end check of the online board under the production CSP.
 * Needs `npx wrangler dev --port 8787` running in server/ (local D1, migrations applied).
 * Builds the game with VITE_API_BASE=http://localhost:8787 (+ VITE_SMOKE for the state snapshot), serves dist on
 * :5173 (an allowed origin), applies dist/_headers' CSP to every document, plays a Hard run until death, submits a
 * name and checks the entry on the API. Fails on any CSP violation. Run: npm run e2e:board
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const API = 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => {
  console.error('E2E FAIL:', m);
  process.exitCode = 1;
};
const ok = (c, m) => (c ? console.log('ok  ', m) : fail(m));

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_API_BASE: API, VITE_SMOKE: '1' } });
  const headers = fs.readFileSync(path.join(ROOT, 'dist', '_headers'), 'utf8');
  const csp = /Content-Security-Policy: (.*)/.exec(headers)[1];
  ok(csp.includes(`connect-src 'self' ${API}`), 'CSP connect-src includes the API origin');
  const srv = spawn('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const violations = [];
  try {
    await sleep(2500);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    // the production CSP on every HTML document (vite preview does not read _headers)
    await ctx.route('**/*', async (route) => {
      const res = await route.fetch();
      const h = { ...res.headers() };
      if ((h['content-type'] ?? '').includes('text/html')) h['content-security-policy'] = csp;
      await route.fulfill({ response: res, headers: h });
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'hard', settings: {}, best: {}, daily: [] }));
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (/Content Security Policy|CSP/i.test(m.text())) violations.push(m.text());
    });
    page.on('pageerror', (e) => violations.push(String(e)));
    await page.goto('http://localhost:5173/');
    await sleep(2000);
    await page.keyboard.press('Enter'); // PLAY (Hard)
    let d;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      d = await page.evaluate(() => window.__ngDebug ?? null);
      if (d && !d.alive) break;
    }
    ok(d && !d.alive, 'hard run ended by death');
    await sleep(1500);
    const field = page.locator('input[data-ng="1"]').first();
    ok((await field.count()) === 1, 'the submit field appears (score would rank on an empty board)');
    const focusedBefore = await page.evaluate(() => document.activeElement?.tagName);
    ok(focusedBefore !== 'INPUT', 'the field is not auto-focused');
    await field.click();
    await field.fill('');
    await page.keyboard.type('E2E Tester');
    await page.keyboard.press('Enter');
    await sleep(1500);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'board_submit.png') });
    const board = await (await fetch(`${API}/api/daily`)).json();
    const mine = board.top.find((e) => e.name === 'E2E Tester');
    ok(!!mine, `the run is on today's board (rank ${mine && mine.rank}, score ${mine && mine.score})`);
    // the title shows today's champion
    await page.goto('http://localhost:5173/');
    await sleep(2500);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'board_title.png') });
    ok(violations.length === 0, `zero CSP violations / page errors ${violations.join(' | ')}`);
    await browser.close();
  } catch (e) {
    fail(String(e));
  } finally {
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '', VITE_API_BASE: '' } });
  }
  console.log(process.exitCode ? 'E2E: FAILED' : 'E2E: all passed');
})();
