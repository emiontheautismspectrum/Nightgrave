/**
 * Phones (smoke build = production build + read-only debug hooks, mocked board API): Pixel 7 portrait and landscape,
 * iPhone 14 portrait. Checks: the zoomed camera follows in portrait, edge markers appear, PARRY / DASH buttons work,
 * rotation pauses and RESUME continues, the board overlay opens and closes, the title shows the board under the canvas
 * in portrait, and the same touch input gives the same replay in both orientations. Zero CSP violations / page errors.
 * Screenshots: assets/preview/phone_portrait.png, phone_landscape.png, phone_board.png.
 * Run: npm run e2e:phone
 */
const { LANG, L: lab } = require('./lang.cjs');
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
// run vite itself (not through npx): kill() then stops the server instead of leaving an orphan on the port
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
// assets/preview/ is untracked output (absent in a fresh clone): create it before writing screenshots
require('node:fs').mkdirSync(path.join(ROOT, 'assets', 'preview'), { recursive: true });
const URL0 = 'http://localhost:4187/';
const API = 'http://localhost:8799';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = new Date();
const BOARD = {
  date: now.toISOString().slice(0, 10), serverNow: now.toISOString(),
  top: ['Lantern', 'NightOwl', 'Ember_Ash', 'Rune.Keeper', 'Wisp42', 'Graveborn', 'MothQueen', 'Ludo', 'Stonewall', 'Kira'].map((n, i) => ({ rank: i + 1, name: n, score: 48000 - i * 3900, hero: i % 2 ? 'wisp' : 'knight', durationTicks: 9000 - i * 500, view: i % 3 === 1 ? 'zoomed' : 'full' })),
  champion: { name: 'Lantern', message: 'The night is long, but the parry is longer!' },
};
let failed = 0;
const ok = (cond, name, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};

async function open(b, device, { manual = false, url = URL0 } = {}) {
  const ctx = await b.newContext({ ...device });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript((lg) => localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'hard', settings: { touchHintSeen: true, hintsDone: true, language: lg }, best: {}, daily: [] })), LANG);
  if (manual) await ctx.addInitScript(() => { window.__ngManual = true; });
  await ctx.route(`${API}/api/daily**`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(BOARD) }));
  await ctx.route(`${API}/api/daily/me`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ verifiedScore: 31250, verifiedRank: 4, pending: false }) }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url);
  await sleep(1800);
  const dbg = () => page.evaluate(() => { const d = window.__ngDebug; return d ? JSON.parse(JSON.stringify(d)) : null; });
  /** Game px -> CSS px of the canvas. */
  const toCss = async (gx, gy) => page.evaluate(([x, y]) => {
    const c = document.querySelector('#game canvas');
    const r = c.getBoundingClientRect();
    return [r.left + (x * r.width) / c.width, r.top + (y * r.height) / c.height, r.width / c.width];
  }, [gx, gy]);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tapGame = async (gx, gy) => {
    const [x, y] = await toCss(gx, gy);
    await touch('touchStart', [{ x, y, id: 9 }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(120);
  };
  const tapText = async (text) => {
    const find = async () => {
      const L = await page.evaluate(() => window.__ngLayout);
      const t = L && (L.targets || []).find((x) => x.kind === 'row' && x.label.replace(/[<>]/g, '').trim() === text);
      const tt = L && L.texts.find((x) => x.text.replace(/[<>]/g, '').trim() === text);
      return { L, box: t ? t.box : tt ? tt.box : null };
    };
    let { L, box } = await find();
    if (!box) return false;
    // touch layouts scroll: drag the list until the row is inside it (as a player would)
    for (let k = 0; k < 6 && L.list && (box[1] < L.list[0] || box[1] + box[3] > L.list[1]); k++) {
      const up = box[1] + box[3] > L.list[1];
      const [x, y0] = await toCss(L.screen[0] / 2, (L.list[0] + L.list[1]) / 2);
      const [, y1] = await toCss(L.screen[0] / 2, (L.list[0] + L.list[1]) / 2 + (up ? -1 : 1) * (L.list[1] - L.list[0]) * 0.4);
      await touch('touchStart', [{ x, y: y0, id: 7 }]);
      for (let i = 1; i <= 6; i++) {
        await touch('touchMove', [{ x, y: y0 + ((y1 - y0) * i) / 6, id: 7 }]);
        await sleep(20);
      }
      await touch('touchEnd', []);
      await sleep(150);
      ({ L, box } = await find());
    }
    await tapGame(box[0] + box[2] / 2, box[1] + box[3] / 2);
    return true;
  };
  return { ctx, page, errs, dbg, toCss, touch, tapGame, tapText };
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: API } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4187', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  const replays = {};
  try {
    for (const [label, dev, portrait] of [['Pixel 7 portrait', devices['Pixel 7'], true], ['Pixel 7 landscape', devices['Pixel 7 landscape'], false], ['iPhone 14 portrait', devices['iPhone 14'], true]]) {
      console.log(`-- ${label}`);
      // title: the board under the canvas (portrait), the BOARD overlay
      let s = await open(b, dev);
      const under = await s.page.evaluate(() => {
        const p = document.querySelector('.bpanel');
        const g = document.querySelector('#frame').getBoundingClientRect();
        if (!p || getComputedStyle(p).display === 'none') return null;
        const r = p.getBoundingClientRect();
        return { below: r.top >= g.bottom - 0.5, inside: r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5, sw: document.documentElement.scrollWidth, vw: innerWidth };
      });
      // portrait: the title uses the whole screen (the board is the BOARD overlay); landscape: no side panel either
      const fill = await s.page.evaluate(() => { const c = document.querySelector('#game canvas').getBoundingClientRect(); return { h: c.height / innerHeight, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
      ok(!under && fill.sw <= fill.vw && (!portrait || fill.h >= 0.95), 'title: no side panel, no overflow, portrait fills >= 95% of the height', JSON.stringify(fill));
      // mobile browser behaviour: the canvas never pans / zooms / selects; the page never scrolls; installable fullscreen
      const mob = await s.page.evaluate(async () => {
        const cs = getComputedStyle(document.querySelector('#game canvas'));
        const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
        return { ta: cs.touchAction, us: cs.userSelect || cs.webkitUserSelect, sh: document.documentElement.scrollHeight, ih: innerHeight, display: m.display, orientation: m.orientation, theme: m.theme_color };
      });
      ok(mob.ta === 'none' && mob.us === 'none' && mob.sh <= mob.ih + 1 && mob.display === 'fullscreen' && mob.orientation === 'any' && mob.theme === '#0b0d12', 'mobile: no pan / zoom / select, no page scroll, fullscreen manifest', JSON.stringify(mob));
      ok(await s.tapText('BOARD'), 'title: BOARD item tapped');
      await sleep(600);
      const ov = await s.page.evaluate(() => {
        const o = document.querySelector('.bover');
        return o && !o.hidden ? { rows: o.querySelectorAll('.bp-row').length, phone: o.querySelectorAll('.bp-phone').length, champ: o.querySelector('.bp-score')?.textContent } : null;
      });
      ok(ov && ov.rows >= 9 && ov.phone > 0 && ov.champ, 'board overlay open with rows and phone icons', JSON.stringify(ov));
      const scrolled = await s.page.evaluate(() => { const e = document.querySelector('.bover-scroll'); e.scrollTop = 40; return e.scrollHeight > e.clientHeight ? e.scrollTop > 0 : true; });
      ok(scrolled, 'board overlay scrolls');
      if (label === 'Pixel 7 portrait') await s.page.screenshot({ path: path.join(ROOT, 'assets', 'preview', 'phone_board.png') });
      await s.page.click('.bover-back');
      await sleep(300);
      ok(await s.page.evaluate(() => document.querySelector('.bover').hidden), 'board overlay closes with BACK');
      ok(s.errs.length === 0, 'title: no page errors / CSP violations', s.errs.join(' | '));
      await s.ctx.close();

      // a run: zoomed view in portrait, buttons, camera follow
      // ticks are stepped by the test here (real time frozen): the checks never race a projectile
      s = await open(b, dev, { manual: true, url: `${URL0}?play=1` });
      // __ngDebug is refreshed on the next rendered frame: wait for one after stepping
      const stepN = async (n) => {
        await s.page.evaluate((m) => window.__ngDebug.step(m), n);
        await sleep(80);
      };
      let d = await s.dbg();
      ok(d && d.zoomed === portrait && (portrait ? d.game[1] > d.game[0] : d.game[0] === 480), 'run view', d && `zoomed ${d.zoomed} game ${d.game}`);
      const btn = (id) => { const b = d.buttons.find((x) => x.id === id); return [b.x, b.y]; };
      const PARRY = btn('parry');
      const DASH = btn('dash');
      const PAUSE = [d.pause.x + d.pause.w / 2, d.pause.y + d.pause.h / 2];
      const p0 = d.parryStart;
      await s.tapGame(...PARRY);
      await stepN(2);
      d = await s.dbg();
      ok(d.parryStart !== p0, 'PARRY button parries', `tick ${d.tick} paused ${d.paused} menu ${d.menu} hint ${d.hint} parry ${d.parryStart}`);
      const d0 = d.dashStart;
      await s.tapGame(...DASH);
      await stepN(2);
      d = await s.dbg();
      ok(d.dashStart !== d0, 'DASH button dashes');
      if (portrait) {
        const cam0 = d.cam;
        const [x, y, k] = await s.toCss(108, 200);
        await s.touch('touchStart', [{ x, y, id: 1 }]);
        for (let i = 1; i <= 10; i++) {
          await s.touch('touchMove', [{ x: x + i * 8 * k, y, id: 1 }]);
          await stepN(3);
          await sleep(20); // render frames move the camera (render-only)
        }
        for (let i = 0; i < 20; i++) {
          await stepN(2);
          await sleep(30);
        }
        await s.touch('touchEnd', []);
        d = await s.dbg();
        ok(d.cam[0] > cam0[0] + 20 && d.x > d.cam[0] && d.x < d.cam[2], 'camera follows the hero', `cam ${cam0[0].toFixed(1)} -> ${d.cam[0].toFixed(1)}, hero x ${d.x.toFixed(1)}`);
      }
      // rotation: re-layout + auto-pause until RESUME
      const vp = s.page.viewportSize();
      await s.page.setViewportSize({ width: vp.height, height: vp.width });
      await sleep(700);
      d = await s.dbg();
      ok(d.paused && d.menu && d.zoomed === !portrait, 'rotation pauses (pause menu on the new layout)');
      ok(await s.tapText('RESUME'), 'RESUME tapped');
      await sleep(400);
      d = await s.dbg();
      ok(!d.paused && d.zoomed === !portrait, 'RESUME continues in the new orientation', `zoomed ${d.zoomed}`);
      await s.page.setViewportSize(vp);
      await sleep(700);
      await s.tapText('RESUME');
      await sleep(300);
      if (portrait) {
        // quit to the title and play again: the HUD camera must be rebuilt (the old one died with the scene)
        await s.tapGame(...PAUSE); // pause button (zoomed HUD)
        ok(await s.tapText('QUIT TO TITLE'), 'QUIT TO TITLE tapped');
        await sleep(700);
        ok(await s.tapText('PLAY'), 'PLAY tapped again');
        await sleep(900);
        d = await s.dbg();
        ok(d && d.zoomed && d.uiCam && d.game[1] > d.game[0], 'after quit + play: zoomed view with a live HUD camera', d && `uiCam ${d.uiCam}`);
      }
      ok(s.errs.length === 0, 'run: no page errors', s.errs.join(' | '));
      await s.ctx.close();

      // multi-touch in a fresh run (no cooldowns from the checks above)
      s = await open(b, dev, { manual: true, url: `${URL0}?play=1` });
      {
        const stepN = async (n) => {
          await s.page.evaluate((m) => window.__ngDebug.step(m), n);
          await sleep(80);
        };
        const d = await s.dbg();
        const btn = (id) => { const bb = d.buttons.find((x) => x.id === id); return [bb.x, bb.y]; };
        const PARRY = btn('parry');
        const DASH = btn('dash');
        // multi-touch: one finger drags (movement) while a second finger presses PARRY, then DASH; the drag continues
        {
          const [mx, my, k] = await s.toCss(portrait ? d.game[0] * 0.3 : 200, portrait ? d.game[1] * 0.45 : 150);
          const [pX, pY] = await s.toCss(...PARRY);
          const [dX, dY] = await s.toCss(...DASH);
          let e = await s.dbg();
          const x0 = e.x;
          const dir = x0 > 240 ? -1 : 1; // towards the middle of the arena (the hero may stand at an edge)
          const pz0 = e.parryStart;
          await s.touch('touchStart', [{ x: mx, y: my, id: 1 }]);
          await stepN(2);
          await s.touch('touchMove', [{ x: mx + dir * 20 * k, y: my, id: 1 }]);
          await stepN(4);
          await s.touch('touchStart', [{ x: mx + dir * 20 * k, y: my, id: 1 }, { x: pX, y: pY, id: 2 }]); // PARRY with finger 2
          await stepN(2);
          await s.touch('touchEnd', [{ x: mx + dir * 20 * k, y: my, id: 1 }]); // finger 2 lifts, finger 1 stays
          e = await s.dbg();
          const parried = e.parryStart !== pz0;
          const dz0 = e.dashStart;
          await s.touch('touchMove', [{ x: mx + dir * 40 * k, y: my, id: 1 }]);
          await stepN(4);
          await s.touch('touchStart', [{ x: mx + dir * 40 * k, y: my, id: 1 }, { x: dX, y: dY, id: 3 }]); // DASH with a second finger
          await stepN(2);
          await s.touch('touchEnd', [{ x: mx + dir * 40 * k, y: my, id: 1 }]);
          e = await s.dbg();
          const dashed = e.dashStart !== dz0;
          await s.touch('touchMove', [{ x: mx + dir * 60 * k, y: my, id: 1 }]); // the movement finger still steers
          await stepN(30);
          e = await s.dbg();
          await s.touch('touchEnd', []);
          ok(parried && dashed && Math.abs(e.x - x0) > 30, 'multi-touch: drag + PARRY + DASH with a second finger, movement kept', `parried ${parried} dashed ${dashed} x ${x0.toFixed(0)} -> ${e.x.toFixed(0)}`);
        }
      }
      await s.ctx.close();

      // later waves: edge markers in portrait; screenshots
      s = await open(b, dev, { url: `${URL0}?play=1&wave=6` });
      let marks = 0;
      for (let i = 0; i < 40 && marks === 0; i++) {
        await sleep(150);
        d = await s.dbg();
        if (!d.alive) break;
        marks = d.markers;
      }
      if (portrait) ok(marks > 0, 'edge markers appear for off-view threats', `markers ${marks}`);
      else ok(marks === 0, 'no edge markers on the full arena');
      if (label === 'Pixel 7 portrait') await s.page.screenshot({ path: path.join(ROOT, 'assets', 'preview', 'phone_portrait.png') });
      if (label === 'Pixel 7 landscape') await s.page.screenshot({ path: path.join(ROOT, 'assets', 'preview', 'phone_landscape.png') });
      await s.ctx.close();

      // the same touch input (game px) gives the same replay in both orientations (ticks stepped by the test)
      if (label.startsWith('Pixel 7')) {
        s = await open(b, dev, { manual: true, url: `${URL0}?play=1` });
        const [x, y, k] = await s.toCss(portrait ? 60 : 200, portrait ? 150 : 120);
        // 21 game px = a whole number of CSS px in both orientations (32 / 40 CSS px on the Pixel 7)
        const step = (n) => s.page.evaluate((m) => window.__ngDebug.step(m), n);
        await step(3);
        await s.touch('touchStart', [{ x, y, id: 1 }]);
        await step(5);
        await s.touch('touchMove', [{ x: x + 42 * k, y, id: 1 }]);
        await step(10);
        await s.touch('touchMove', [{ x: x + 42 * k, y: y + 42 * k, id: 1 }]);
        await step(10);
        const [px, py] = await s.toCss(...PARRY);
        await s.touch('touchStart', [{ x: x + 42 * k, y: y + 42 * k, id: 1 }, { x: px, y: py, id: 2 }]);
        await step(4);
        await s.touch('touchEnd', [{ x: x + 42 * k, y: y + 42 * k, id: 1 }]);
        await step(4);
        await s.touch('touchMove', [{ x: x + 42 * k, y: y + 42 * k, id: 1 }]);
        await step(8);
        await s.touch('touchEnd', []);
        await step(5);
        replays[label] = await s.page.evaluate(() => window.__ngDebug.replay());
        await s.ctx.close();
      }
    }
    const a = replays['Pixel 7 portrait'];
    const c = replays['Pixel 7 landscape'];
    ok(a && a === c && JSON.parse(a).length === 49, 'same touch input => same replay in portrait and landscape', a && c ? `${JSON.parse(a).length} / ${JSON.parse(c).length} ticks` : 'missing');
  } finally {
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  }
  console.log(failed ? `PHONE: ${failed} failed` : 'PHONE: all passed');
  process.exitCode = failed ? 1 : 0;
})();
