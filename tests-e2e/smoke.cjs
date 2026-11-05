/**
 * Playwright smoke test on the PRODUCTION build (vite preview): an emulated landscape phone (touch) and a desktop
 * (mouse). Also captures the Stage 5 screenshots into assets/preview/. Run: npm run smoke
 */
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OUT = path.join(__dirname, '..', 'assets', 'preview');
const fail = (m) => {
  console.error('SMOKE FAIL:', m);
  process.exitCode = 1;
};
const ok = (c, m) => (c ? console.log('ok  ', m) : fail(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Game px -> page px via the canvas box. */
async function toPage(page, gx, gy) {
  const r = await page.evaluate(() => {
    const c = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: c.left, y: c.top, w: c.width, h: c.height };
  });
  return { x: r.x + (gx * r.w) / 480, y: r.y + (gy * r.h) / 270 };
}
const dbg = (page) => page.evaluate(() => window.__ngDebug ?? null);

async function touch(cdp, type, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
}

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage();
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
  await touch(cdp, 'touchEnd', []);
  await sleep(600);
  d = await dbg(page);
  ok(d && d.x > x0 + 20, `phone: drag moves the hero (${x0.toFixed(0)} -> ${d && d.x.toFixed(0)})`);
  const ps = d.parryStart;
  await tap(456, 222); // PARRY button (right margin)
  await sleep(200);
  d = await dbg(page);
  ok(d && d.parryStart !== ps, 'phone: the PARRY button triggers a parry');
  await page.screenshot({ path: path.join(OUT, 'touch_layout.png') });
  await tap(462, 13); // pause button
  await sleep(300);
  d = await dbg(page);
  ok(d && d.paused && d.menu, 'phone: the pause button pauses');
  await tap(240, 90); // RESUME
  await sleep(300);
  await page.setViewportSize({ width: 412, height: 915 }); // portrait
  await sleep(500);
  const rotate = await page.evaluate(() => !document.getElementById('rotate').hidden);
  d = await dbg(page);
  ok(rotate, 'phone: portrait shows the rotate overlay');
  ok(d && d.paused, 'phone: portrait auto-pauses');
  ok(errs.length === 0, `phone: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
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
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter'); // play
  await sleep(800);
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

(async () => {
  const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  try {
    await sleep(2500);
    const browser = await chromium.launch();
    await phone(browser);
    await desktop(browser);
    await browser.close();
  } catch (e) {
    fail(String(e));
  } finally {
    srv.kill();
  }
  console.log(process.exitCode ? 'SMOKE: FAILED' : 'SMOKE: all passed');
})();
