/**
 * The Knight's always-visible shield arc, against the Vite DEV server (?hero=knight is dev-only). Reads the drawn arc
 * through the dev / smoke test hook window.__nightgrave.arc (never in a production build) and checks, after moving the
 * cursor in four directions, that its centre is the hero's sim position and its angles are the sim aim +- arcDegrees / 2;
 * that it is null on the title screen, after quitting to the title and after death, and frozen while paused. A cheap
 * pixel check: no amber of the removed dash chevron where it used to be drawn (next to the Knight, outside its sprite). No brightness
 * assertions on the forest floor. Screenshots for the author (untracked): assets/preview/knight_arc_{right,left,up,
 * down,pulse,phone}.png. Run: npm run e2e:knight-arc
 */
const { chromium, devices } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'preview');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5181;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => {
  console.error('KNIGHT ARC FAIL:', m);
  process.exitCode = 1;
};
const ok = (c, m, extra = '') => (c ? console.log('ok  ', m) : fail(`${m} ${extra}`));
// the Knight's arc from src/data/heroes.ts (read, not copied)
const heroesSrc = fs.readFileSync(path.join(ROOT, 'src', 'data', 'heroes.ts'), 'utf8');
const knightBlock = heroesSrc.slice(heroesSrc.indexOf('knight: {'), heroesSrc.indexOf('wisp: {'));
const ARC = Number(/arcDegrees: (\d+(?:\.\d+)?)/.exec(knightBlock)[1]);
const RADIUS = Number(/radius: (\d+(?:\.\d+)?)/.exec(knightBlock)[1]);
const HALF = ((ARC / 2) * Math.PI) / 180;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const SAVE = JSON.stringify({ v: 1, difficulty: 'easy', hero: 'knight', settings: { touchHintSeen: true, hintsDone: true }, best: {}, daily: [] });

async function setup(ctx) {
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem('ng.saved')) { localStorage.setItem('nightgrave.v1', s); sessionStorage.setItem('ng.saved', '1'); } }, SAVE);
  await ctx.addInitScript(() => { window.__ngManual = true; });
}

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
  await setup(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${URL}?hero=knight`);
  await sleep(3000);
  const arc = () => page.evaluate(() => (window.__nightgrave ? window.__nightgrave.arc : null));
  const dbg = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__ngDebug ?? null)));
  const box = await page.evaluate(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { x: r.x, y: r.y, k: r.width / 480 }; });
  const step = async (n) => { await page.evaluate((m) => window.__ngDebug.step(m), n); await sleep(120); };
  const mouse = (gx, gy) => page.mouse.move(box.x + gx * box.k, box.y + gy * box.k);
  const crop = (file, d, half = 40) => page.screenshot({ path: path.join(OUT, file), clip: { x: box.x + (d.x - half) * box.k, y: box.y + (d.y - half) * box.k, width: 2 * half * box.k, height: 2 * half * box.k } });

  ok((await arc()) === null, 'title screen: no arc');
  await page.keyboard.press('Enter'); // PLAY
  await sleep(1500);
  let d = await dbg();
  ok(d && d.alive, 'a Knight run started');
  // four directions: the cursor 60 px from the hero; after one tick the sim aim points at it and the arc follows
  for (const [name, dx, dy] of [['right', 1, 0], ['left', -1, 0], ['up', 0, -1], ['down', 0, 1]]) {
    d = await dbg();
    await mouse(d.x + dx * 60, d.y + dy * 60);
    await step(2); // a turn of more than 90 degrees takes 2 consistent ticks (the 0.10.0 aim rule)
    d = await dbg();
    const a = await arc();
    const aim = Math.atan2(d.aim[1], d.aim[0]);
    ok(angDiff(aim, Math.atan2(dy, dx)) < 0.05, `${name}: the sim aim turned (${aim.toFixed(3)})`);
    ok(a && a.cx === d.x && a.cy === d.y, `${name}: arc centre = hero sim position`, JSON.stringify({ a, x: d.x, y: d.y }));
    ok(a && a.r === RADIUS, `${name}: arc radius = parry radius ${RADIUS}`);
    ok(a && angDiff(a.start, aim - HALF) < 1e-9 && angDiff(a.end, aim + HALF) < 1e-9, `${name}: arc angles = aim -+ ${ARC / 2} deg`, JSON.stringify(a));
    await mouse(d.x, d.y); // stop walking
    await step(1);
    await crop(`knight_arc_${name}.png`, await dbg());
  }
  // pixel check (cheap, no brightness): the old dash chevron was a 6 px amber (0xffb347) triangle 10 px from the hero
  // centre toward the dash direction. Facing and walking right (the cursor stays 60 px away, so its reticle is far),
  // the box x +8..+14, y -6..+2 from the hero lies right of the 16 px sprite (the sprite itself has amber pixels):
  // it must hold no amber at all now. The screenshot is decoded by Python (Pillow, as the art tools).
  d = await dbg();
  await mouse(d.x + 60, d.y);
  await step(1);
  d = await dbg();
  const pix = path.join(OUT, 'knight_arc_pixelcheck.png');
  await page.screenshot({ path: pix, clip: { x: box.x + (Math.round(d.x) + 8) * box.k, y: box.y + (Math.round(d.y) - 6) * box.k, width: 7 * box.k, height: 9 * box.k } });
  const n = Number(execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB")\nw,h=im.size\nprint(sum(1 for y in range(h) for x in range(w) if im.getpixel((x,y))==(0xff,0xb3,0x47)))', pix]).toString().trim());
  fs.rmSync(pix);
  ok(n === 0, `no dash chevron amber pixels where the chevron used to be (${n})`);
  await mouse(d.x, d.y);
  await step(1);
  // the pulse: the same arc, brighter and thicker, still centred and rotated
  const before0 = await arc();
  ok(before0 && !before0.pulse && before0.alpha <= 0.35 && before0.alpha >= 0.25, 'idle arc: faint (25-35%)', JSON.stringify(before0));
  await page.keyboard.press('j');
  await step(1);
  d = await dbg();
  const pa = await arc();
  ok(pa && pa.cx === d.x && pa.cy === d.y && angDiff(pa.start, Math.atan2(d.aim[1], d.aim[0]) - HALF) < 1e-9, 'pulse: the same arc, centred and rotated');
  ok(pa && pa.pulse && before0 && pa.pixels > before0.pixels * 1.5 && pa.alpha > before0.alpha, 'pulse: brighter and about twice the pixels (2 px thick)', JSON.stringify({ pa, before0 }));
  await crop('knight_arc_pulse.png', d);
  // paused: frozen where it was
  await step(60);
  const before = await arc();
  await page.keyboard.press('Escape');
  await sleep(300);
  ok(JSON.stringify(await arc()) === JSON.stringify(before) && before !== null, 'paused: the arc stays, frozen');
  // quit to the title: no arc
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(1200);
  ok((await arc()) === null, 'back on the title: no arc');
  // a new run, then death: no arc
  await page.keyboard.press('Enter');
  await sleep(1500);
  ok((await arc()) !== null, 'new run: the arc is back');
  for (let i = 0; i < 400 && (await dbg()).alive; i++) await page.evaluate(() => window.__ngDebug.step(60));
  await sleep(200);
  ok(!(await dbg()).alive && (await arc()) === null, 'after death: no arc');
  ok(errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  await setup(ctx);
  const page = await ctx.newPage();
  await page.goto(`${URL}?hero=knight&play=1`);
  await sleep(3000);
  const d = await page.evaluate(() => JSON.parse(JSON.stringify(window.__ngDebug ?? null)));
  const a = await page.evaluate(() => (window.__nightgrave ? window.__nightgrave.arc : null));
  ok(d && d.zoomed && a && a.cx === d.x && a.cy === d.y, 'portrait phone (zoomed camera): the arc is drawn at the hero');
  await page.screenshot({ path: path.join(OUT, 'knight_arc_phone.png') });
  await ctx.close();
}

(async () => {
  const srv = spawn(process.execPath, [VITE_BIN, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  try {
    await sleep(3000);
    const browser = await chromium.launch();
    try {
      await desktop(browser);
      await phone(browser);
    } finally {
      await browser.close();
    }
  } catch (e) {
    fail(String(e));
  } finally {
    srv.kill();
  }
  console.log(process.exitCode ? 'KNIGHT ARC: FAILED' : 'KNIGHT ARC: all passed');
})();
