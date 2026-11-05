/**
 * Automated menu layout check (smoke build): on every menu page, every text lies inside the page panel, no two texts
 * overlap, and every focusable item is on the visible 480x270 canvas. Desktop and phone (touch) layouts.
 * Run: npm run e2e:layout
 */
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

function check(name, L) {
  const errs = [];
  if (!L) errs.push('no layout');
  else {
    const [px, py, pw, ph] = L.panel;
    const T = L.texts;
    for (const t of T) {
      const [x, y, w, h] = t.box;
      if (x < px - 0.5 || y < py - 0.5 || x + w > px + pw + 0.5 || y + h > py + ph + 0.5) errs.push(`outside panel: "${t.text}"`);
      if (t.focusable && (x < 0 || y < 0 || x + w > 480 || y + h > 270)) errs.push(`focusable off canvas: "${t.text}"`);
    }
    for (let i = 0; i < T.length; i++)
      for (let j = i + 1; j < T.length; j++) {
        const [ax, ay, aw, ah] = T[i].box;
        const [bx, by, bw, bh] = T[j].box;
        if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah) errs.push(`overlap: "${T[i].text}" / "${T[j].text}"`);
      }
    if (px < 0 || py < 0 || px + pw > 480 || py + ph > 270) errs.push('panel off canvas');
  }
  if (errs.length) failed++;
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${name}${errs.length ? ': ' + errs.slice(0, 4).join('; ') : ''}`);
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1' } });
  const srv = spawn('npx', ['vite', 'preview', '--port', '4183', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  try {
    for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 810 } }], ['phone', { ...devices['Pixel 7 landscape'] }]]) {
      const ctx = await b.newContext(opts);
      await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} }); // tests skip the site intro
      await ctx.addInitScript(() => localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'hard', settings: { touchHintSeen: true, hintsDone: true }, best: {}, daily: [] })));
      const page = await ctx.newPage();
      const L = () => page.evaluate(() => window.__ngLayout);
      const key = async (k, n = 1) => {
        for (let i = 0; i < n; i++) await page.keyboard.press(k);
        await sleep(250);
      };
      await page.goto('http://localhost:4183/');
      await sleep(1800);
      check(`${label} title`, await L());
      // pages reachable from the title: DIFF(1) HERO(2) SETTINGS(3) BEST(4) TODAY(5) CREDITS(6) (disabled rows skipped)
      for (const [name, downs, sub] of [['hero', 2], ['settings', 3], ['best scores', 4], ["today's best", 5], ['credits', 6], ['controls', 3, true]]) {
        await page.goto('http://localhost:4183/');
        await sleep(1500);
        await key('ArrowDown', downs);
        await key('Enter');
        if (sub) {
          // settings -> CONTROLS: the last focusable item before the touch-only ones
          const n = label === 'phone' ? 7 : 7;
          await key('ArrowDown', n);
          await key('Enter');
        }
        check(`${label} ${name}`, await L());
      }
      await page.goto('http://localhost:4183/');
      await sleep(1500);
      await key('Enter'); // play
      await sleep(400);
      await key('KeyP'); // pause
      check(`${label} pause`, await L());
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '' } });
  }
  console.log(failed ? `LAYOUT: ${failed} FAILED` : 'LAYOUT: all passed');
  process.exitCode = failed ? 1 : 0;
})();
