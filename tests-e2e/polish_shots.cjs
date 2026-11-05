/** Polish screenshots (smoke build, VITE_SMOKE=1): first_run_hint, dash_chevron (3x crop), best_scores. */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'preview');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1' } });
  const srv = spawn('npx', ['vite', 'preview', '--port', '4182', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  try {
    // 1440x810 at DPR 1 = exactly 3 device px per game px
    const ctx = await b.newContext({ viewport: { width: 1440, height: 810 } });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} }); // tests skip the site intro
    const page = await ctx.newPage();
    await page.goto('http://localhost:4182/');
    await sleep(1500);
    await page.keyboard.press('Enter');
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, 'first_run_hint.png') });
    await page.keyboard.press('KeyX');
    await sleep(300);
    await page.mouse.move(900, 300);
    await sleep(500);
    const d = await page.evaluate(() => window.__ngDebug);
    const box = await page.evaluate(() => document.querySelector('#game canvas').getBoundingClientRect().toJSON());
    await page.screenshot({ path: path.join(OUT, 'dash_chevron.png'), clip: { x: box.x + (d.x - 30) * 3, y: box.y + (d.y - 30) * 3, width: 180, height: 180 } });
    await ctx.close();
    const ctx2 = await b.newContext({ viewport: { width: 1440, height: 810 } });
    await ctx2.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} }); // tests skip the site intro
    await ctx2.addInitScript(() => {
      localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'medium', settings: { touchHintSeen: true, hintsDone: true },
        best: { medium: [{ score: 15230, hero: 'knight', date: '2026-11-05', secs: 312.4 }, { score: 980, hero: 'wisp', date: '2026-11-04', secs: 41 }] }, daily: [] }));
    });
    const p2 = await ctx2.newPage();
    await p2.goto('http://localhost:4182/');
    await sleep(1500);
    for (let i = 0; i < 4; i++) await p2.keyboard.press('ArrowDown'); // PLAY, DIFFICULTY, HERO, SETTINGS -> BEST SCORES
    await p2.keyboard.press('Enter');
    await sleep(400);
    await p2.screenshot({ path: path.join(OUT, 'best_scores.png') });
    await ctx2.close();
  } finally {
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '' } });
  }
  console.log('shots done');
})();
