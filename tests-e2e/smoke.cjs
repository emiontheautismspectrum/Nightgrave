/**
 * Playwright smoke test on the PRODUCTION build (vite preview): an emulated landscape phone (touch) and a desktop
 * (mouse). Also captures the Stage 5 screenshots into assets/preview/. Run: npm run smoke
 */
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
// run vite itself (not through npx): kill() then stops the server instead of leaving an orphan on the port
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OUT = path.join(__dirname, '..', 'assets', 'preview');
// untracked output (absent in a fresh clone): create it before writing screenshots
require('node:fs').mkdirSync(OUT, { recursive: true });
const fail = (m) => {
  console.error('SMOKE FAIL:', m);
  process.exitCode = 1;
};
/** The last check that passed or failed: named in the timeout message. */
let lastStep = 'start';
const ok = (c, m) => {
  lastStep = m;
  return c ? console.log('ok  ', m) : fail(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// No step may hang the run: every page call has a timeout, and a watchdog ends the whole script with a clear message.
const STEP_TIMEOUT_MS = 15_000;
const TOTAL_TIMEOUT_MS = 240_000;
const within = (p, ms, what) => {
  let timer;
  return Promise.race([p, new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`timed out after ${ms} ms: ${what} (last check: "${lastStep}")`)), ms)))]).finally(() => clearTimeout(timer));
};

/** Game px -> page px via the canvas box. */
async function toPage(page, gx, gy) {
  const r = await within(page.evaluate(() => {
    const c = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: c.left, y: c.top, w: c.width, h: c.height };
  }), STEP_TIMEOUT_MS, 'reading the canvas box');
  return { x: r.x + (gx * r.w) / 480, y: r.y + (gy * r.h) / 270 };
}
/** Smoke builds: step n ticks while real time is frozen (__ngManual), then let a frame refresh the snapshot. */
const step = async (page, n) => {
  await within(page.evaluate((m) => window.__ngDebug.step(m), n), STEP_TIMEOUT_MS, 'stepping ticks');
  await sleep(100);
};
const dbg = (page) => within(page.evaluate(() => window.__ngDebug ?? null), STEP_TIMEOUT_MS, 'reading the game state');

async function touch(cdp, type, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
}

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} }); // tests skip the site intro
  // ticks are stepped by the test (smoke build hook): a projectile can never end the run between two checks
  await ctx.addInitScript(() => { window.__ngManual = true; });
  const page = await ctx.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS); // clicks, key presses, navigation and screenshots fail instead of hanging
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL);
  await sleep(1500);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (gx, gy) => {
    const p = await toPage(page, gx, gy);
    await touch(cdp, 'touchStart', [p]);
    await sleep(40);
    await touch(cdp, 'touchEnd', []);
    await sleep(150);
  };
  await tap(240, 76); // PLAY
  await sleep(800);
  let d = await dbg(page);
  ok(d && d.hint, 'phone: first run shows the touch controls overlay');
  await tap(240, 135); // dismiss
  await sleep(300);
  d = await dbg(page);
  ok(d && !d.paused, 'phone: overlay dismissed, run is live');
  // drag on the arena: the hero follows the virtual cursor
  const x0 = d.x;
  const a = await toPage(page, 200, 200);
  await touch(cdp, 'touchStart', [a]);
  for (let k = 1; k <= 10; k++) {
    await touch(cdp, 'touchMove', [{ x: a.x + k * 8, y: a.y }]);
    await sleep(30);
  }
  await step(page, 40);
  await touch(cdp, 'touchEnd', []);
  await sleep(100);
  d = await dbg(page);
  ok(d && d.x > x0 + 20, `phone: drag moves the hero (${x0.toFixed(0)} -> ${d && d.x.toFixed(0)})`);
  const ps = d.parryStart;
  await tap(456, 222); // PARRY button (right margin)
  await step(page, 2);
  d = await dbg(page);
  ok(d && d.parryStart !== ps, 'phone: the PARRY button triggers a parry');
  await page.screenshot({ path: path.join(OUT, 'touch_layout.png') });
  await tap(420, 13); // pause button (right end of the top band, inside the arena width)
  await sleep(300);
  d = await dbg(page);
  ok(d && d.paused && d.menu, 'phone: the pause button pauses');
  await tap(240, 90); // RESUME
  await sleep(300);
  await page.setViewportSize({ width: 412, height: 915 }); // portrait
  await sleep(500);
  const rotate = await page.evaluate(() => !!document.getElementById('rotate'));
  d = await dbg(page);
  ok(!rotate, 'phone: no rotate overlay (portrait plays with the zoomed camera)');
  ok(d && d.paused && d.menu, 'phone: rotating mid-run auto-pauses');
  ok(errs.length === 0, `phone: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} }); // tests skip the site intro
  const page = await ctx.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS); // clicks, key presses, navigation and screenshots fail instead of hanging
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL);
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'menu_title.png') });
  // hero select
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'menu_hero.png') });
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // settings
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'menu_settings.png') });
  await page.keyboard.press('Escape');
  await sleep(200);
  // PLAY by a click on its row (keyboard focus after Escape depends on frame timing under load: flaky)
  const L = await within(page.evaluate(() => window.__ngLayout ?? null), STEP_TIMEOUT_MS, 'reading the menu layout');
  const row = L && L.texts.find((t) => t.text.replace(/[<>]/g, '').trim() === 'PLAY');
  ok(!!row, 'desktop: the PLAY row is on the title');
  if (row) {
    const at = await toPage(page, row.box[0] + row.box[2] / 2, row.box[1] + row.box[3] / 2);
    await page.mouse.click(at.x, at.y);
  }
  for (let i = 0; i < 20 && !(await dbg(page)); i++) await sleep(100); // the run scene is up
  await sleep(500);
  let d = await dbg(page);
  ok(d && d.hint && d.paused, 'desktop: first run shows the controls card (run paused)');
  await page.keyboard.press('KeyX'); // any key dismisses it (after 250 ms) and is not used as an action
  await sleep(300);
  d = await dbg(page);
  ok(d && d.alive && !d.paused && !d.hint, 'desktop: the card is dismissed by a key, Play starts the run');
  const ps0 = d.parryStart;
  const p = await toPage(page, 330, 135);
  await page.mouse.move(p.x, p.y);
  await sleep(700);
  d = await dbg(page);
  ok(d && d.x > 270, `desktop: the hero follows the mouse (x ${d && d.x.toFixed(0)})`);
  ok(d && d.parryStart === ps0, 'desktop: dismissing the card did not trigger a parry');
  const ps = d.parryStart;
  await page.mouse.down();
  await page.mouse.up();
  await sleep(150);
  d = await dbg(page);
  ok(d && d.parryStart !== ps, 'desktop: left click parries');
  await page.keyboard.press('Escape');
  await sleep(200);
  d = await dbg(page);
  ok(d && d.paused && d.menu, 'desktop: Esc pauses');
  const t0 = d.tick;
  await sleep(500);
  d = await dbg(page);
  ok(d && d.tick === t0, 'desktop: no ticks while paused');
  await page.keyboard.press('Escape');
  await sleep(200);
  d = await dbg(page);
  ok(d && !d.paused, 'desktop: Esc resumes');
  // stand still until death for the death panel
  for (let i = 0; i < 120 && d && d.alive; i++) {
    await sleep(500);
    d = await dbg(page);
  }
  await sleep(400);
  ok(d && !d.alive, 'desktop: death panel reached');
  await page.screenshot({ path: path.join(OUT, 'death_panel.png') });
  const t1 = d.tick;
  await page.keyboard.press('Space');
  await sleep(400);
  d = await dbg(page);
  ok(d && d.alive && d.tick < t1, 'desktop: Space restarts instantly');
  ok(errs.length === 0, `desktop: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}

/** Is something already listening on the port (e.g. a stale vite preview serving an old build)? */
const busyOn = (port, host) =>
  new Promise((res) => {
    const s = require('node:net').connect(port, host);
    s.once('connect', () => (s.destroy(), res(true)));
    s.once('error', () => res(false));
  });
// vite may listen on IPv6 (::1) or IPv4 "localhost": check both
const portBusy = async (port) => (await busyOn(port, '127.0.0.1')) || (await busyOn(port, '::1'));

(async () => {
  if (await portBusy(PORT)) {
    console.error(`SMOKE FAIL: port ${PORT} is already in use (a stale "vite preview"?); stop it and run again.`);
    console.log('SMOKE: FAILED');
    process.exit(1);
  }
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  const watchdog = setTimeout(() => {
    console.error(`SMOKE FAIL: the whole smoke test took longer than ${TOTAL_TIMEOUT_MS / 1000} s (last check: "${lastStep}")`);
    console.log('SMOKE: FAILED');
    srv.kill();
    process.exit(1);
  }, TOTAL_TIMEOUT_MS);
  let browser = null;
  try {
    await sleep(2500);
    browser = await within(chromium.launch(), 60_000, 'launching the browser');
    await phone(browser);
    await desktop(browser);
  } catch (e) {
    fail(String(e));
  } finally {
    if (browser) await within(browser.close(), STEP_TIMEOUT_MS, 'closing the browser').catch((e) => fail(String(e)));
    srv.kill();
    clearTimeout(watchdog);
  }
  console.log(process.exitCode ? 'SMOKE: FAILED' : 'SMOKE: all passed');
  process.exit(process.exitCode ?? 0); // never wait on a stray handle
})();
