/**
 * Boss art screenshots (stage ART-B): the new bosses in the DEV preview (`?flags=bosses,bossOrder,bossMotion,bossMoves
 * &play=1&wave=3&boss=...`), desktop and a 390 x 844 phone, written to docs/screenshots/boss_art/boss_fight_*.png.
 * The script steps the ticks itself, dodges with the mouse / the stick and shoots at a wanted moment of each fight
 * (a cast, a ring, a chain, the hands). Dev server only: the preview flags are dead code in a production build.
 * Run: node tests-e2e/boss_art_shots.cjs
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots', 'boss_art');
const PORT = 4196;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLAGS = 'bosses,bossOrder,bossMotion,bossMoves';

/** The moment to shoot, per boss: the first tick (alive) where `want` holds; the wants are tried in order. */
const WANTS = {
  thorn: [(d) => d.boss.pattern && d.boss.pattern !== 'hedge' && d.tick > d.boss.phase[2] + (d.boss.phase[3] - d.boss.phase[2]) * 0.7 && d.tick < d.boss.phase[3]],
  lich: [(d) => d.boss.pattern === 'grasp' && d.tick > d.boss.phase[2] + (d.boss.phase[3] - d.boss.phase[2]) * 0.7 && d.tick < d.boss.phase[3],
         (d) => d.boss.pattern === 'soulfire' && d.tick > d.boss.phase[2] + 8 && d.tick < d.boss.phase[3],
         // (a phone sees the Lich only when it comes near: any wind-up in view will do there)
         (d) => !!d.cam && !!d.boss.pattern && d.tick > d.boss.phase[2] + 8 && d.tick < d.boss.phase[3]],
  toller: [(d) => d.boss.chain === 'bound', (d) => d.boss.rings > 0 && d.tick % 7 === 0, (d) => d.boss.chain === 'thrown' && d.tick > d.boss.phase[2] + 30],
};

/** How far a body reaches above / below its sim position (src/render/bossArt.ts `bossLook` boxes). */
const BODY = { thorn: [22, 42], lich: [36, 28], toller: [18, 38] };

async function fight(b, boss, phone, file) {
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript(() => localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'easy', hero: 'knight', settings: { touchHintSeen: true, hintsDone: true, music: 0, sfx: 0 }, best: {}, daily: [] })));
  await ctx.addInitScript(() => { window.__ngManual = true; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `http://localhost:${PORT}/?flags=${FLAGS}&play=1&wave=3&boss=${boss}`;
  let shot = false;
  for (let attempt = 0; attempt < 40 && !shot; attempt++) {
    await page.goto(url);
    await page.waitForFunction(() => window.__ngDebug && window.__ngDebug.tick >= 0, null, { timeout: 20000 });
    await sleep(400);
    const box = await page.evaluate(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const snap = () => page.evaluate(() => { const d = window.__ngDebug; return { x: d.x, y: d.y, tick: d.tick, alive: d.alive, proj: d.proj, boss: d.boss, game: d.game, cam: d.cam, hint: d.hint }; });
    const held = {};
    for (let i = 0; i < 2400 && !shot; i++) {
      const d = await snap();
      if (!d.alive) break;
      // dodge: step away from projectiles that are close and coming, drift back toward a spot below the boss
      // (a phone sees a window round the hero: there he walks to a spot under the boss, so the boss is in view)
      const home = phone && d.boss ? [Math.max(70, Math.min(410, d.boss.x)), Math.max(60, Math.min(225, d.boss.y + 78))] : [240, 150];
      let [fx, fy] = [(home[0] - d.x) * 0.02, (home[1] - d.y) * 0.02];
      for (const [px, py, vx, vy] of d.proj) {
        const [rx, ry] = [d.x - px, d.y - py];
        const dist = Math.hypot(rx, ry);
        if (dist < 70 && rx * vx + ry * vy > 0) {
          const side = rx * vy - ry * vx > 0 ? 1 : -1; // sidestep across its path
          const sp = Math.hypot(vx, vy) || 1;
          fx += ((-vy * side) / sp) * (70 - dist) * 0.2 + (rx / (dist || 1)) * 0.6;
          fy += ((vx * side) / sp) * (70 - dist) * 0.2 + (ry / (dist || 1)) * 0.6;
        }
      }
      const n = Math.hypot(fx, fy) || 1;
      if (!phone) await page.mouse.move(box.x + ((d.x + (fx / n) * 30) * box.w) / 480, box.y + ((d.y + (fy / n) * 30) * box.h) / 270);
      else {
        // the phone is steered with the keys (the keyboard works on every device; the layout stays the phone's)
        const want = { KeyA: fx / n < -0.35 && Math.hypot(fx, fy) > 0.15, KeyD: fx / n > 0.35 && Math.hypot(fx, fy) > 0.15, KeyW: fy / n < -0.35 && Math.hypot(fx, fy) > 0.15, KeyS: fy / n > 0.35 && Math.hypot(fx, fy) > 0.15 };
        for (const k of Object.keys(want)) {
          if (want[k] && !held[k]) await page.keyboard.down(k);
          if (!want[k] && held[k]) await page.keyboard.up(k);
          held[k] = want[k];
        }
      }
      await page.evaluate((m) => window.__ngDebug.step(m), 2);
      // phones play a zoomed window: the boss must be inside it (its whole body), or the shot shows no boss
      const [up, down] = BODY[boss];
      const inView = !d.cam || (d.boss && d.boss.x > d.cam[0] + 26 && d.boss.x < d.cam[2] - 26 && d.boss.y - up > d.cam[1] && d.boss.y + down < d.cam[3]);
      if (d.boss && !d.boss.dead && d.tick >= d.boss.introEnd && inView && WANTS[boss].some((w) => w(d))) {
        await sleep(120);
        const after = await snap();
        if (!after.alive) break;
        // the game canvas only (the page round it is not what is reviewed)
        await page.locator('#game canvas').screenshot({ path: path.join(OUT, file) });
        shot = true;
      }
    }
  }
  await ctx.close();
  return { shot, errors };
}

(async () => {
  const srv = spawn(process.execPath, [VITE_BIN, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(3500);
  const b = await chromium.launch();
  let fails = 0;
  try {
    // optional filter: node tests-e2e/boss_art_shots.cjs lich phone
    const only = process.argv.slice(2);
    for (const boss of ['thorn', 'lich', 'toller'])
      for (const phone of [false, true]) {
        const [bosses, devs] = [only.filter((x) => x in BODY), only.filter((x) => x === 'phone' || x === 'desktop')];
        if ((bosses.length && !bosses.includes(boss)) || (devs.length && !devs.includes(phone ? 'phone' : 'desktop'))) continue;
        const file = `boss_fight_${boss}${phone ? '_phone' : ''}.png`;
        const r = await fight(b, boss, phone, file);
        console.log(`${r.shot ? 'ok  ' : 'FAIL'} ${file}${r.errors.length ? ' errors: ' + r.errors.slice(0, 3).join(' | ') : ''}`);
        if (!r.shot || r.errors.length) fails++;
      }
  } finally {
    await b.close();
    srv.kill();
  }
  process.exit(fails ? 1 : 0);
})();
