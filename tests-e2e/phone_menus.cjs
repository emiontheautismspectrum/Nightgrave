/**
 * Phones, taps only (smoke build + mocked board API): Pixel 7, iPhone 14 and a 360x800 phone, each portrait and
 * landscape. Every menu page is operated by taps (pick a hero, change settings, Best Scores, the board overlay, back,
 * start a run); every target is >= 44 CSS px; in a run PARRY >= 88 and DASH >= 64 CSS px and, in portrait, the game
 * fills >= 95% of the viewport height; zero page errors / CSP messages.
 * Screenshots (assets/preview/): phone_title, phone_settings, phone_hero, phone_run, phone_death (iPhone 14 portrait),
 * phone_landscape_menu (Pixel 7 landscape). Run: node tests-e2e/phone_menus.cjs
 */
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const OUT = path.join(ROOT, 'assets', 'preview');
require('node:fs').mkdirSync(OUT, { recursive: true });
const URL0 = 'http://localhost:4193/';
const API = 'http://localhost:8799';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = new Date();
const BOARD = {
  date: now.toISOString().slice(0, 10), serverNow: now.toISOString(),
  top: ['Lantern', 'NightOwl', 'Ember_Ash'].map((n, i) => ({ rank: i + 1, name: n, score: 30000 - i * 4000, hero: i % 2 ? 'wisp' : 'knight', durationTicks: 6000, view: i === 1 ? 'zoomed' : 'full' })),
  champion: { name: 'Lantern', message: 'Parry the night away' },
};
let failed = 0;
const ok = (c, name, extra = '') => {
  if (!c) failed++;
  console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const phone = (w, h, dpr) => ({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });

const DEVICES = [
  ['Pixel 7 portrait', devices['Pixel 7']],
  ['Pixel 7 landscape', devices['Pixel 7 landscape']],
  ['iPhone 14 portrait', devices['iPhone 14']],
  ['iPhone 14 landscape', devices['iPhone 14 landscape']],
  ['360x800 portrait', phone(360, 800, 3)],
  ['360x800 landscape', phone(800, 360, 3)],
];

async function session(b, dev, url = URL0, manual = false) {
  const ctx = await b.newContext({ ...dev });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript(() => localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'hard', settings: { touchHintSeen: true, hintsDone: true }, best: { hard: [{ score: 4321, hero: 'knight', date: '2026-11-01', secs: 77 }] }, daily: [] })));
  if (manual) await ctx.addInitScript(() => { window.__ngManual = true; });
  await ctx.route(`${API}/api/daily**`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(BOARD) }));
  await ctx.route(`${API}/api/daily/me`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ verifiedScore: null, verifiedRank: null, pending: false, serverNow: now.toISOString() }) }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url);
  await sleep(1600);
  const L = () => page.evaluate(() => window.__ngLayout ?? null);
  const dbg = () => page.evaluate(() => { const d = window.__ngDebug; return d ? JSON.parse(JSON.stringify(d)) : null; });
  const box = () => page.evaluate(() => { const c = document.querySelector('#game canvas'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / c.width, h: r.height, vh: innerHeight }; });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tapAt = async (gx, gy) => {
    const r = await box();
    await touch('touchStart', [{ x: r.x + gx * r.k, y: r.y + gy * r.k, id: 9 }]);
    await sleep(50);
    await touch('touchEnd', []);
    await sleep(350);
  };
  /** Tap a menu target by label (prefix), scrolling the list by dragging first when it is off screen. */
  const tap = async (label, kind = 'row') => {
    const find = async () => {
      const l = await L();
      const t = l && l.targets.find((x) => x.kind === kind && x.label.trim().startsWith(label));
      return { l, t };
    };
    let { l, t } = await find();
    if (!t) return false;
    for (let k = 0; k < 8 && t.kind !== 'back' && (t.box[1] < l.list[0] || t.box[1] + t.box[3] > l.list[1]); k++) {
      const r = await box();
      const up = t.box[1] + t.box[3] > l.list[1];
      const x = r.x + (l.screen[0] / 2) * r.k;
      const y0 = r.y + ((l.list[0] + l.list[1]) / 2) * r.k;
      const dy = (up ? -1 : 1) * (l.list[1] - l.list[0]) * 0.4 * r.k;
      await touch('touchStart', [{ x, y: y0, id: 8 }]);
      for (let i = 1; i <= 6; i++) {
        await touch('touchMove', [{ x, y: y0 + (dy * i) / 6, id: 8 }]);
        await sleep(15);
      }
      await touch('touchEnd', []);
      await sleep(150);
      ({ l, t } = await find());
    }
    await tapAt(t.box[0] + t.box[2] / 2, t.box[1] + t.box[3] / 2);
    return true;
  };
  return { ctx, page, errs, L, dbg, box, tap, tapAt, touch };
}

function targetsOk(l) {
  if (!l || !l.touch) return 'no touch layout';
  const bad = l.targets.filter((t) => t.box[2] * l.cssPerPx < 43.5 || t.box[3] * l.cssPerPx < 43.5).map((t) => t.label);
  return bad.length ? `small: ${bad.join(', ')}` : '';
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: API } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4193', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  const watchdog = setTimeout(() => {
    console.log('PHONE MENUS: FAILED (timed out)');
    srv.kill();
    process.exit(1);
  }, 600_000);
  try {
    for (const [label, dev] of DEVICES) {
      console.log(`-- ${label}`);
      const portrait = dev.viewport.height > dev.viewport.width;
      const shots = label === 'iPhone 14 portrait';
      let s = await session(b, dev);
      let l = await s.L();
      ok(l && l.title === 'NIGHTGRAVE' && !targetsOk(l), 'title: targets >= 44 CSS px', targetsOk(l));
      if (portrait) {
        const r = await s.box();
        ok(r.h / r.vh >= 0.95, 'title fills >= 95% of the viewport height', (r.h / r.vh).toFixed(3));
      }
      if (shots) await s.page.screenshot({ path: path.join(OUT, 'phone_title.png') });
      if (label === 'Pixel 7 landscape') await s.page.screenshot({ path: path.join(OUT, 'phone_landscape_menu.png') });
      // hero: tap WISP
      ok(await s.tap('HERO'), 'tap HERO');
      l = await s.L();
      ok(l.title === 'HERO' && !targetsOk(l), 'hero page by tap, targets >= 44', targetsOk(l));
      if (shots) {
        await s.page.screenshot({ path: path.join(OUT, 'phone_hero.png') });
        await s.page.screenshot({ path: path.join(OUT, 'hero_select_phone.png') }); // the heroes pass: stat lines from HeroDef
      }
      ok(await s.tap('WISP'), 'tap WISP');
      l = await s.L();
      const hero = await s.page.evaluate(() => JSON.parse(localStorage.getItem('nightgrave.v1')).hero);
      ok(l.title === 'NIGHTGRAVE' && hero === 'wisp', 'picked the Wisp by tap', hero);
      // settings: a toggle by tap on the row, a volume by tap on the > arrow, back
      ok(await s.tap('SETTINGS'), 'tap SETTINGS');
      l = await s.L();
      ok(l.title === 'SETTINGS' && !targetsOk(l), 'settings by tap, targets >= 44', targetsOk(l));
      const shake0 = l.targets.find((t) => t.label.startsWith('SCREEN SHAKE')).label;
      await s.tap('SCREEN SHAKE');
      const master0 = (await s.L()).targets.find((t) => t.label.startsWith('MASTER')).label;
      await s.tap('MASTER', 'left');
      l = await s.L();
      const shake1 = l.targets.find((t) => t.label.startsWith('SCREEN SHAKE')).label;
      const master1 = l.targets.find((t) => t.label.startsWith('MASTER')).label;
      ok(shake1 !== shake0 && master1 !== master0, 'settings change by tap (row and < arrow)', `${shake0} -> ${shake1}, ${master0.replace(/ +/g, ' ')} -> ${master1.replace(/ +/g, ' ')}`);
      // Stick (default): the drag-only rows are hidden; switching to DRAG shows them, and the choice persists
      ok(l.targets.some((t) => t.label === 'TOUCH CONTROLS STICK') && !l.targets.some((t) => t.label.startsWith('TOUCH SMOOTHING')), 'settings: TOUCH CONTROLS STICK, drag-only rows hidden');
      await s.tap('TOUCH CONTROLS', 'right');
      l = await s.L();
      const smooth = l.targets.find((t) => t.label.startsWith('TOUCH SMOOTHING'));
      const mode = await s.page.evaluate(() => JSON.parse(localStorage.getItem('nightgrave.v1')).settings.touchControls);
      ok(!!smooth && l.targets.some((t) => t.label === 'TOUCH CONTROLS DRAG') && mode === 'drag', 'settings: DRAG shows sensitivity / smoothing and is saved', mode);
      await s.tap('TOUCH CONTROLS', 'right');
      l = await s.L();
      ok(l.targets.some((t) => t.label === 'TOUCH CONTROLS STICK'), 'settings: back to STICK');
      if (shots) await s.page.screenshot({ path: path.join(OUT, 'phone_settings.png') });
      ok(await s.tap('BACK', 'back'), 'tap BACK');
      ok((await s.L()).title === 'NIGHTGRAVE', 'back to the title');
      // best scores
      ok(await s.tap('BEST SCORES'), 'tap BEST SCORES');
      l = await s.L();
      ok(l.title === 'BEST SCORES' && l.texts.some((t) => t.text.includes('4321')), 'best scores by tap (the saved run is listed)');
      await s.tap('BACK', 'back');
      // the board overlay
      ok(await s.tap('BOARD'), 'tap BOARD');
      const ov = await s.page.evaluate(() => { const o = document.querySelector('.bover'); const bk = o && o.querySelector('.bover-back').getBoundingClientRect(); return o && !o.hidden ? { rows: o.querySelectorAll('.bp-row').length, bw: bk.width, bh: bk.height } : null; });
      ok(ov && ov.rows >= 9 && ov.bw >= 44 && ov.bh >= 44, 'board overlay by tap (BACK >= 44 px)', JSON.stringify(ov));
      const bb = await s.page.evaluate(() => { const r = document.querySelector('.bover-back').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
      await s.touch('touchStart', [{ x: bb[0], y: bb[1], id: 3 }]);
      await sleep(40);
      await s.touch('touchEnd', []);
      await sleep(300);
      ok(await s.page.evaluate(() => document.querySelector('.bover').hidden), 'board overlay closed by tapping BACK');
      // a run by tap
      ok(await s.tap('PLAY'), 'tap PLAY');
      await sleep(600);
      let d = await s.dbg();
      ok(d && d.alive && !d.menu, 'run started by tap (no menu, alive)');
      const r = await s.box();
      const cssPx = r.k;
      const parry = d.buttons.find((x) => x.id === 'parry');
      const dash = d.buttons.find((x) => x.id === 'dash');
      if (portrait) {
        ok(parry.r * 2 * cssPx >= 88 - 0.5 && dash.r * 2 * cssPx >= 64 - 0.5, 'run: PARRY >= 88 and DASH >= 64 CSS px', `${(parry.r * 2 * cssPx).toFixed(0)} / ${(dash.r * 2 * cssPx).toFixed(0)}`);
        ok(r.h / r.vh >= 0.95, 'run fills >= 95% of the viewport height', (r.h / r.vh).toFixed(3));
      } else ok(parry.r > 0 && dash.r > 0, 'run: landscape buttons in the side margin');
      ok(d.parryStart < 0, 'the PLAY tap did not leak into the run (no parry)', String(d.parryStart));
      if (shots) {
        await sleep(1200);
        await s.page.screenshot({ path: path.join(OUT, 'phone_run.png') });
      }
      ok(s.errs.length === 0, 'no page errors / CSP messages', s.errs.join(' | '));
      await s.ctx.close();
      // the death panel (iPhone 14 portrait): a later wave, the hero stands still until a hit
      if (shots) {
        s = await session(b, dev, `${URL0}?play=1&wave=8`, true);
        for (let i = 0; i < 60; i++) {
          await s.page.evaluate(() => window.__ngDebug.step(60));
          d = await s.dbg();
          if (!d.alive) break;
        }
        await sleep(900);
        ok(!d.alive, 'death panel reached');
        await s.page.screenshot({ path: path.join(OUT, 'phone_death.png') });
        await s.ctx.close();
      }
    }
  } finally {
    clearTimeout(watchdog);
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  }
  console.log(failed ? `PHONE MENUS: ${failed} failed` : 'PHONE MENUS: all passed');
  process.exit(failed ? 1 : 0);
})();
