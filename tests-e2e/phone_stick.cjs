/**
 * The fixed joystick on the PRODUCTION (smoke) build, touch only, DPR 3: Pixel 7, iPhone 14, 360x800 and 375x667, in
 * portrait and landscape. The stick moves the hero in 4 directions and 4 diagonals (sim positions); stick + PARRY +
 * DASH by other fingers at once; Left-handed mirrors stick and buttons; rotating mid-run with the stick held pauses,
 * RESUME by tap continues with nothing stuck; the game fills >= 95% of the viewport height in portrait; a Hard run
 * played with the stick is submitted (mocked board) and the captured submission verifies with `npm run
 * verify:replay`. Screenshots (assets/preview/, untracked): phone_title2, phone_run_stick, phone_menu_short,
 * phone_landscape_stick, phone_standalone_sim. Run: npm run e2e:phone-stick
 */
const { LANG, L: lab } = require('./lang.cjs');
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'preview');
fs.mkdirSync(OUT, { recursive: true });
const API = 'http://localhost:8787';
const URL0 = 'http://localhost:4194/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = new Date();
let failed = 0;
const ok = (c, name, extra = '') => {
  if (!c) failed++;
  console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const phone = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const PHONES = [['Pixel 7', 412, 915], ['iPhone 14', 390, 844], ['360x800', 360, 800], ['375x667', 375, 667]];

async function session(b, dev, opts = {}) {
  const ctx = await b.newContext({ ...dev });
  const save = { v: 1, difficulty: opts.difficulty ?? 'easy', hero: opts.hero ?? 'knight', settings: { touchHintSeen: true, hintsDone: true, leftHanded: !!opts.leftHanded, language: LANG }, best: {}, daily: [] };
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript((sv) => { if (!sessionStorage.getItem('ng.s')) { localStorage.setItem('nightgrave.v1', sv); sessionStorage.setItem('ng.s', '1'); } }, JSON.stringify(save));
  if (opts.manual !== false) await ctx.addInitScript(() => { window.__ngManual = true; });
  if (opts.insets)
    await ctx.addInitScript(([t, bt]) => {
      document.addEventListener('readystatechange', () => {
        const el = document.getElementById('safe');
        if (el) el.style.padding = `${t}px 0px ${bt}px 0px`;
      });
    }, opts.insets);
  const board = { date: now.toISOString().slice(0, 10), serverNow: now.toISOString(), champion: { name: 'Lantern', message: 'Parry the night away' }, top: [] };
  await ctx.route(`${API}/api/daily**`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(board) }));
  await ctx.route(`${API}/api/daily/me`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ verifiedScore: null, verifiedRank: null, pending: false, serverNow: now.toISOString() }) }));
  const sent = [];
  await ctx.route(`${API}/api/submit`, (r) => {
    sent.push(r.request().postData());
    return r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ accepted: true, pending: true, provisionalRank: 1 }) });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL0);
  await sleep(1600);
  const L = () => page.evaluate(() => window.__ngLayout ?? null);
  const dbg = () => page.evaluate(() => { const d = window.__ngDebug; return d ? JSON.parse(JSON.stringify(d)) : null; });
  const box = () => page.evaluate(() => { const c = document.querySelector('#game canvas'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / c.width, h: r.height, vh: innerHeight }; });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const pt = async (gx, gy, id) => { const r = await box(); return { x: r.x + gx * r.k, y: r.y + gy * r.k, id }; };
  const step = async (n) => { await page.evaluate((m) => window.__ngDebug.step(m), n); await sleep(60); };
  const tapAt = async (gx, gy) => {
    await touch('touchStart', [await pt(gx, gy, 9)]);
    await sleep(50);
    await touch('touchEnd', []);
    await sleep(300);
  };
  const tap = async (label) => {
    const l = await L();
    const t = l && l.targets.find((x) => x.label.trim().startsWith(label));
    if (!t) return false;
    await tapAt(t.box[0] + t.box[2] / 2, t.box[1] + t.box[3] / 2);
    return true;
  };
  return { ctx, page, errs, sent, L, dbg, box, touch, pt, step, tapAt, tap };
}

/** Hold the stick toward (dx, dy) for n ticks and return the hero's movement. */
async function push(s, dx, dy, n = 12) {
  const d0 = await s.dbg();
  const S = d0.stick;
  const l = Math.hypot(dx, dy) || 1;
  const c = await s.pt(S.x, S.y, 1);
  await s.touch('touchStart', [c]);
  for (let i = 1; i <= 4; i++) await s.touch('touchMove', [await s.pt(S.x + ((dx / l) * S.r * i) / 4, S.y + ((dy / l) * S.r * i) / 4, 1)]);
  await s.step(n);
  const d1 = await s.dbg();
  await s.touch('touchEnd', []);
  await s.step(1);
  return [d1.x - d0.x, d1.y - d0.y, d1];
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: API } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4194', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  const watchdog = setTimeout(() => {
    console.log('PHONE STICK: FAILED (timed out)');
    srv.kill();
    process.exit(1);
  }, 900_000);
  try {
    for (const [name, w, h] of PHONES)
      for (const portrait of [true, false]) {
        const dev = portrait ? phone(w, h) : phone(h, w);
        const label = `${name} ${portrait ? 'portrait' : 'landscape'}`;
        console.log(`-- ${label}`);
        let s = await session(b, dev);
        if (portrait && name === 'iPhone 14') await s.page.screenshot({ path: path.join(OUT, 'phone_title2.png') });
        if (portrait && name === '375x667') await s.page.screenshot({ path: path.join(OUT, 'phone_menu_short.png') });
        ok(await s.tap(lab('PLAY')), `${label}: PLAY by tap`);
        await sleep(500);
        let d = await s.dbg();
        ok(d && d.alive && d.stick, `${label}: a run with the stick`);
        const r = await s.box();
        if (portrait) ok(r.h / r.vh >= 0.95, `${label}: the game fills >= 95% of the height`, (r.h / r.vh).toFixed(3));
        // 4 directions and 4 diagonals
        const bad = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const [mx, my] = await push(s, dx, dy);
          if (Math.sign(Math.round(mx)) !== dx || Math.sign(Math.round(my)) !== dy) bad.push(`${dx},${dy} -> ${mx.toFixed(1)},${my.toFixed(1)}`);
        }
        ok(!bad.length, `${label}: the stick moves the hero in 8 directions`, bad.join('; '));
        // multi-touch: the stick held right, PARRY then DASH by a second finger
        d = await s.dbg();
        const S = d.stick;
        const [parry, dash] = d.buttons;
        const x0 = d.x;
        await s.touch('touchStart', [await s.pt(S.x, S.y, 1)]);
        await s.touch('touchMove', [await s.pt(S.x + S.r, S.y, 1)]);
        await s.step(2);
        const ps = (await s.dbg()).parryStart;
        await s.touch('touchStart', [await s.pt(S.x + S.r, S.y, 1), await s.pt(parry.x, parry.y, 2)]);
        await s.step(2);
        await s.touch('touchEnd', [await s.pt(S.x + S.r, S.y, 1)]);
        const ds = (await s.dbg()).dashStart;
        await s.step(60);
        await s.touch('touchStart', [await s.pt(S.x + S.r, S.y, 1), await s.pt(dash.x, dash.y, 3)]);
        await s.step(2);
        await s.touch('touchEnd', [await s.pt(S.x + S.r, S.y, 1)]);
        await s.step(6);
        d = await s.dbg();
        ok(d.parryStart !== ps && d.dashStart !== ds && d.x > x0 + 20, `${label}: stick + PARRY + DASH together`, `x ${x0.toFixed(0)} -> ${d.x.toFixed(0)}`);
        if (name === 'iPhone 14') await s.page.screenshot({ path: path.join(OUT, portrait ? 'phone_run_stick.png' : 'phone_landscape_stick.png') });
        await s.touch('touchEnd', []);
        await s.step(2);
        // rotation mid-run with the stick held: the run pauses; RESUME by tap; nothing stuck afterwards
        await s.touch('touchStart', [await s.pt(S.x, S.y, 1)]);
        await s.touch('touchMove', [await s.pt(S.x, S.y - S.r, 1)]);
        await s.step(2);
        await s.page.setViewportSize(portrait ? { width: h, height: w } : { width: w, height: h });
        await sleep(700);
        await s.touch('touchCancel', []);
        d = await s.dbg();
        ok(d.paused, `${label}: rotating mid-run pauses`);
        ok(await s.tap(lab('RESUME')), `${label}: RESUME by tap`);
        await sleep(300);
        const before = await s.dbg();
        await s.step(30);
        d = await s.dbg();
        ok(!d.paused && Math.hypot(d.x - before.x, d.y - before.y) < 0.01, `${label}: after RESUME nothing is stuck (the hero stands still)`, `${(d.x - before.x).toFixed(2)},${(d.y - before.y).toFixed(2)}`);
        ok(s.errs.length === 0, `${label}: no page errors / CSP messages`, s.errs.join(' | '));
        await s.ctx.close();
        // Left-handed: the stick and the buttons swap sides
        s = await session(b, dev, { leftHanded: true });
        await s.tap(lab('PLAY'));
        await sleep(500);
        d = await s.dbg();
        const W = d.game[0];
        // PARRY in the outer corner of the left side, DASH further in (on a narrow phone it may reach the middle)
        const [lp, ld] = d.buttons;
        ok(d.stick.x > W / 2 && lp.x < W / 2 && ld.x >= lp.x, `${label}: Left-handed mirrors the stick and the buttons`);
        const [mx] = await push(s, 1, 0);
        ok(mx > 5, `${label}: the mirrored stick moves the hero`);
        await s.ctx.close();
      }
    // the standalone web app (simulated insets: status bar 47, home indicator 34)
    let s = await session(b, phone(390, 844), { insets: [47, 34] });
    await s.page.screenshot({ path: path.join(OUT, 'phone_standalone_sim.png') });
    await s.ctx.close();
    // a Hard run played with the stick, submitted (mocked board): the captured submission verifies
    s = await session(b, phone(390, 844), { difficulty: 'hard', hero: 'knight' });
    await s.tap(lab('PLAY'));
    await sleep(500);
    let d = await s.dbg();
    const S = d.stick;
    await s.touch('touchStart', [await s.pt(S.x, S.y, 1)]);
    for (let i = 0; i < 300 && d.alive; i++) {
      const a = i * 0.7;
      await s.touch('touchMove', [await s.pt(S.x + Math.cos(a) * S.r * 0.9, S.y + Math.sin(a) * S.r * 0.6, 1)]);
      await s.step(20);
      d = await s.dbg();
    }
    await s.touch('touchEnd', []);
    for (let i = 0; i < 400 && d.alive; i++) {
      await s.step(60);
      d = await s.dbg();
    }
    ok(!d.alive, 'stick run: Hard run ended by death');
    await sleep(1500);
    const field = s.page.locator('input[data-ng="1"]').first();
    if ((await field.count()) === 1) {
      await field.click();
      await field.fill('Stick Tester');
      await s.page.keyboard.press('Enter');
      await sleep(1500);
    }
    ok(s.sent.length === 1, 'stick run: submitted (mocked board)');
    if (s.sent.length) {
      const body = JSON.parse(s.sent[0]);
      const f = path.join(os.tmpdir(), 'ng_stick_submission.json');
      fs.writeFileSync(f, JSON.stringify(body));
      let out = '';
      let code = 0;
      try {
        out = execSync(`npm run -s verify:replay -- ${f}`, { cwd: ROOT }).toString();
      } catch (e) {
        code = e.status;
        out = String(e.stdout);
      }
      ok(code === 0 && /^verified/.test(out.trim()), 'stick run: the submission verifies with npm run verify:replay', out.trim());
    }
    await s.ctx.close();
  } catch (e) {
    ok(false, 'exception', String(e && e.stack));
  } finally {
    clearTimeout(watchdog);
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '', VITE_API_BASE: '' } });
  }
  console.log(failed ? `PHONE STICK: ${failed} FAILED` : 'PHONE STICK: all passed');
  process.exitCode = failed ? 1 : 0;
})();
