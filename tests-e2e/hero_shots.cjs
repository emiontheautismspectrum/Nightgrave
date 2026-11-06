/**
 * Hero mechanics screenshots (smoke build, ticks stepped by the script): assets/preview/knight_arc.png (the shield arc
 * around the aim during a parry, the faint aim indicator and the guard pips) and wisp_trail.png (the ember trail right
 * after a dash). Crops of the 3x canvas (pixel-exact). Run: node tests-e2e/hero_shots.cjs
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'preview');
require('node:fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(b, hero, file, act) {
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript((h) => localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'easy', hero: h, settings: { touchHintSeen: true, hintsDone: true }, best: {}, daily: [] })), hero);
  await ctx.addInitScript(() => { window.__ngManual = true; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:4192/?play=1');
  await sleep(2000);
  const box = await page.evaluate(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { x: r.x, y: r.y, k: r.width / 480 }; });
  const dbg = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__ngDebug)));
  const step = (n) => page.evaluate((m) => window.__ngDebug.step(m), n);
  const mouse = (gx, gy) => page.mouse.move(box.x + gx * box.k, box.y + gy * box.k);
  await act({ dbg, step, mouse, page });
  await sleep(150);
  const d = await dbg();
  // a 160 x 90 game-px crop around the hero
  const cx = Math.max(48, Math.min(432 - 160, Math.round(d.x - 80)));
  const cy = Math.max(0, Math.min(270 - 90, Math.round(d.y - 50)));
  await page.screenshot({ path: path.join(OUT, file), clip: { x: box.x + cx * box.k, y: box.y + cy * box.k, width: 160 * box.k, height: 90 * box.k } });
  await ctx.close();
  return { alive: d.alive, errors };
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1' } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4192', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  let fails = 0;
  try {
    // Knight: three parries of real orbs fill the guard (pips), then a pulse toward the upper right shows the arc
    const k = await shoot(b, 'knight', 'knight_arc.png', async ({ dbg, step, mouse, page }) => {
      await mouse(240, 135);
      for (let i = 0, tries = 0; i < 20000; i++) {
        let d = await dbg();
        if (!d.alive) {
          // a random seed each run: start over until the guard fills
          if (++tries > 30) break;
          await page.reload();
          await sleep(1500);
          d = await dbg();
        }
        const red = d.proj.some(([x, y, vx, vy, r, par]) => !par && Math.hypot(x - d.x, y - d.y) - r < 18 && (x - d.x) * vx + (y - d.y) * vy < 0);
        if (red) await page.keyboard.press('k');
        const near = d.proj.find(([x, y, vx, vy, r, par]) => par && Math.hypot(x - d.x, y - d.y) - r < 20 && (x - d.x) * vx + (y - d.y) * vy < 0);
        if (near) {
          // turn the shield to it (the cursor a few px toward the orb), then parry
          const l = Math.hypot(near[0] - d.x, near[1] - d.y) || 1;
          await mouse(d.x + ((near[0] - d.x) / l) * 7, d.y + ((near[1] - d.y) / l) * 7);
          await step(1);
          await page.keyboard.press('j');
        } else await mouse(240, 135);
        await step(1);
        const e = await dbg();
        if (e.guard >= 3) break;
      }
      await mouse((await dbg()).x + 30, (await dbg()).y - 18);
      await step(2);
      await page.keyboard.press('j');
      await step(2);
    });
    console.log(k.alive && !k.errors.length ? 'ok   knight_arc.png' : `FAIL knight_arc.png ${JSON.stringify(k)}`);
    fails += k.alive && !k.errors.length ? 0 : 1;
    const w = await shoot(b, 'wisp', 'wisp_trail.png', async ({ dbg, step, mouse, page }) => {
      await step(60);
      const d = await dbg();
      await mouse(d.x + 100, d.y + 10);
      await page.keyboard.press('k');
      await step(14);
    });
    console.log(w.alive && !w.errors.length ? 'ok   wisp_trail.png' : `FAIL wisp_trail.png ${JSON.stringify(w)}`);
    fails += w.alive && !w.errors.length ? 0 : 1;
  } finally {
    await b.close();
    srv.kill();
  }
  process.exitCode = fails ? 1 : 0;
})();
