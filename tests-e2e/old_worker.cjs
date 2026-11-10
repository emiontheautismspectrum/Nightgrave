/**
 * A NEW client against the OLD Worker (the one live before the heroes pass), with no Cloudflare and no live board:
 * - the game is built with VITE_API_BASE=http://localhost:8787 and every API call is answered by Playwright mocks (the
 *   e2e board mock); any request to another host fails the test (nothing can reach the live board);
 * - the POST /api/submit body the client really sends is handed to the OLD Worker's own code (by default the commit before the last CLIENT_VERSION change, checked out
 *   in a temporary git worktree, run against an in-memory D1), and its real response goes back to the page;
 * - expected: the old Worker refuses it as outdated (409) with zero rows written, and the client shows the graceful
 *   "GAME UPDATED: RELOAD THE PAGE" message. Zero CSP violations (the production CSP is applied to every document).
 * Run: node tests-e2e/old_worker.cjs [git ref of the old Worker, default: the commit before the last CLIENT_VERSION change]
 */
const { chromium } = require('playwright');
const { spawn, execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
// the main checkout's own runner (never `npx`: inside the worktree a missing package would be downloaded)
const VITE_NODE_BIN = path.join(__dirname, '..', 'node_modules', 'vite-node', 'dist', 'cli.mjs');

const ROOT = path.join(__dirname, '..');
// default: the Worker as it was before the CURRENT client version (the parent of the last commit that changed
// src/shared/version.ts), so the check is meaningful even when main already runs this version
const lastBump = () => execSync('git log -1 --format=%H -- src/shared/version.ts', { cwd: path.join(__dirname, '..') }).toString().trim();
const REF = process.argv[2] ?? `${lastBump()}^`;
const API = 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => {
  console.error('E2E FAIL:', m);
  process.exitCode = 1;
};
const ok = (c, m) => (c ? console.log('ok  ', m) : fail(m));

const OLD_SUBMIT = `
import { readFileSync } from 'node:fs';
import { handle, type Env } from './server/src/index';
import { makeD1 } from './server/test/d1shim';
const d = makeD1();
const env = { DB: d.DB, ADMIN_TOKEN: 'a'.repeat(40), IP_SALT: 'salt-0123456789abcdef', VERIFIER_TOKEN: 'v'.repeat(40), ALLOWED_ORIGINS: 'http://localhost:5173' } as unknown as Env;
const req = new Request('https://api.test/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', 'CF-Connecting-IP': '10.0.0.1' }, body: readFileSync(process.argv[2], 'utf8') });
const r = await handle(req, env);
const rows = (d.raw.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n;
console.log('RESULT ' + JSON.stringify({ status: r.status, ct: r.headers.get('Content-Type'), body: await r.text(), rows }));
`;

(async () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ng-old-worker-'));
  execFileSync('git', ['worktree', 'add', '--detach', wt, REF], { cwd: ROOT, stdio: 'ignore' });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(wt, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(wt, 'old_submit.ts'), OLD_SUBMIT);
  const oldVersion = /CLIENT_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(wt, 'src', 'shared', 'version.ts'), 'utf8'))?.[1];
  console.log(`old Worker: ${REF} (client version ${oldVersion})`);

  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_API_BASE: API, VITE_SMOKE: '1' } });
  const csp = /Content-Security-Policy: (.*)/.exec(fs.readFileSync(path.join(ROOT, 'dist', '_headers'), 'utf8'))[1];
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '5173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const violations = [];
  const foreign = [];
  let old = null;
  let sent = null;
  try {
    await sleep(2500);
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
    await ctx.addInitScript(() => {
      localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'hard', hero: 'knight', settings: { touchHintSeen: true, hintsDone: true }, best: {}, daily: [] }));
    });
    const now = new Date();
    const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    await ctx.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(`${API}/api/submit`)) {
        // the client's real submission, answered by the OLD Worker's real code
        sent = route.request().postData();
        const f = path.join(wt, 'body.json');
        fs.writeFileSync(f, sent);
        const out = execFileSync(process.execPath, [VITE_NODE_BIN, 'old_submit.ts', f], { cwd: wt }).toString();
        old = JSON.parse(/RESULT (.*)/.exec(out)[1]);
        return route.fulfill({ status: old.status, contentType: old.ct ?? 'application/json', body: old.body });
      }
      if (url.startsWith(`${API}/api/daily/me`)) return route.fulfill(json({ verifiedScore: null, verifiedRank: null, pending: false, serverNow: now.toISOString() }));
      if (url.startsWith(`${API}/api/daily`)) return route.fulfill(json({ date: now.toISOString().slice(0, 10), serverNow: now.toISOString(), champion: null, top: [] }));
      if (url.startsWith(API)) return route.fulfill(json({ error: 'not mocked' }, 404));
      if (!url.startsWith('http://localhost:5173/')) {
        foreign.push(url);
        return route.abort();
      }
      const res = await route.fetch();
      const h = { ...res.headers() };
      if ((h['content-type'] ?? '').includes('text/html')) h['content-security-policy'] = csp;
      return route.fulfill({ response: res, headers: h });
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (/Content Security Policy|CSP/i.test(m.text())) violations.push(m.text()); });
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
    ok(d && !d.alive, 'hard run (Knight) ended by death');
    await sleep(1500);
    const field = page.locator('input[data-ng="1"]').first();
    ok((await field.count()) === 1, 'the submit field appears');
    await field.click();
    await field.fill('');
    await page.keyboard.type('Old Worker');
    await page.keyboard.press('Enter');
    await sleep(2500);
    const body = sent ? JSON.parse(sent) : {};
    ok(body.clientVersion === require('node:fs').readFileSync(path.join(ROOT, 'src', 'shared', 'version.ts'), 'utf8').match(/CLIENT_VERSION = '([^']+)'/)[1] && body.hero === 'knight', `the new client sent its submission (client ${body.clientVersion}, hero ${body.hero})`);
    ok(old && old.status === 409 && JSON.parse(old.body).reason === 'outdated', `the old Worker refused it as outdated (${old && old.status} ${old && old.body})`);
    ok(old && old.rows === 0, 'the old Worker wrote nothing (0 rows)');
    await page.screenshot({ path: path.join(os.tmpdir(), 'old_worker_submit.png') });
    const shown = await page.evaluate(() => window.__ngDebug?.submitStatus ?? null);
    ok(shown === 'GAME UPDATED: RELOAD THE PAGE', `the client shows the graceful message ("${shown}")`);
    ok(foreign.length === 0, `no request left localhost (nothing can reach the live board) ${foreign.join(' ')}`);
    ok(violations.length === 0, `zero CSP violations / page errors ${violations.join(' | ')}`);
    await browser.close();
  } catch (e) {
    fail(String(e));
  } finally {
    srv.kill();
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'ignore' });
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '', VITE_API_BASE: '' } });
  }
  console.log(process.exitCode ? 'E2E: FAILED' : 'E2E: all passed');
})();
