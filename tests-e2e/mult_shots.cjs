/**
 * Multiplier / Double Score screenshots (smoke build; ticks stepped by the script, which parries like a player and walks
 * to the gold pickup): assets/preview/multiplier_hud.png and double_score.png, crops of the 3x canvas (pixel-exact).
 * Run: node tests-e2e/mult_shots.cjs
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
require('node:fs').mkdirSync(path.join(ROOT, 'assets', 'preview'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${what}`)), ms))]);

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1' } });
  const srv = spawn('npx', ['vite', 'preview', '--port', '4191', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  let ok = 0;
  try {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
    await ctx.addInitScript(() => localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'easy', settings: { touchHintSeen: true, hintsDone: true }, best: {}, daily: [] })));
    await ctx.addInitScript(() => { window.__ngManual = true; });
    const page = await ctx.newPage();
    await page.goto('http://localhost:4191/?play=1&wave=2');
    await sleep(2000);
    const box = await page.evaluate(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { x: r.x, y: r.y, k: r.width / 480 }; });
    const dbg = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__ngDebug)));
    const step = (n) => page.evaluate((m) => window.__ngDebug.step(m), n);
    const shot = async (file, d) => {
      // a crop around the hero (and the HUD band), at the canvas' 3x scale
      // the left part of the arena with the HUD band (score, multiplier) and the hero (kept near x 150)
      const h = Math.min(270, Math.max(150, Math.round(d.y) + 45));
      await page.screenshot({ path: path.join(ROOT, 'assets', 'preview', file), clip: { x: box.x + 48 * box.k, y: box.y, width: 220 * box.k, height: h * box.k } });
    };
    let gotStep = false;
    let gotDbl = false;
    let mult = 100;
    let attempts = 0;
    for (let i = 0; i < 20000 && !(gotStep && gotDbl); i++) {
      let d = await dbg();
      if (!d.alive) {
        // a random seed each run: try again until a gold pickup shows up while the hero lives
        if (++attempts > 25) break;
        await page.reload();
        await sleep(1500);
        mult = 100;
        d = await dbg();
      }
      if (d.pickup && d.pickup.kind !== 'double' && gotStep) { /* only the gold one matters */ }
      // walk to the pickup (the hero follows the mouse), otherwise stay near the centre
      const tx = d.pickup && !d.dbl ? d.pickup.x : 150;
      const ty = d.pickup && !d.dbl ? d.pickup.y : 135;
      await page.mouse.move(box.x + tx * box.k, box.y + ty * box.k);
      // dash through a red threat that is about to touch the hero; parry a violet one
      const threat = d.proj.some(([x, y, vx, vy, r, par]) => par && Math.hypot(x - d.x, y - d.y) - r < 15 && (x - d.x) * vx + (y - d.y) * vy < 0);
      if (threat) await page.keyboard.press('j');
      const red = d.proj.some(([x, y, vx, vy, r, par]) => !par && Math.hypot(x - d.x, y - d.y) - r < 18 && (x - d.x) * vx + (y - d.y) * vy < 0);
      if (red) await page.keyboard.press('k');
      await step(1);
      const e = await dbg();
      if (e.mult > mult && !gotStep) {
        await sleep(120); // let the label and the HUD pulse render
        await shot('multiplier_hud.png', e);
        gotStep = true;
        ok++;
      }
      mult = e.mult;
      if (e.dbl && !gotDbl && gotStep) {
        await page.mouse.move(box.x + 150 * box.k, box.y + 135 * box.k);
        await step(40);
        await sleep(150);
        await shot('double_score.png', await dbg());
        gotDbl = true;
        ok++;
      }
    }
    const last = await dbg();
    console.log(`multiplier step shot: ${gotStep}, double score shot: ${gotDbl} (attempts ${attempts}, tick ${last.tick})`);
  } finally {
    await withTimeout(b.close(), 10000, 'browser close').catch(() => undefined);
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  }
  process.exitCode = ok === 2 ? 0 : 1;
})();
