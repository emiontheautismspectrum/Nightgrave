/**
 * Automated menu layout check (smoke build): on every menu page, every text lies inside the page panel, no two texts
 * overlap, and every focusable item is on the visible 480x270 canvas. Desktop and phone (touch) layouts.
 * Phones in portrait (390x844, 360x800, 412x915, 375x667, 430x932) and a short landscape, each also with SIMULATED
 * safe-area insets (top 47 / bottom 34 CSS px, the standalone web app on an iPhone): symmetric gutters, the pinned
 * footer (controls hint + champion block, a long name and message from a mocked board) inside its own panel, and the
 * title page's menu block centred within +-8% of the visible screen's centre.
 * Run: npm run e2e:layout
 */
const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
// run vite itself (not through npx): kill() then stops the server instead of leaving an orphan on the port
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

/**
 * Phones (touch layout): the list may scroll. Every text inside the panel, no overlaps, every target inside the screen
 * width and visible at SOME scroll position, at least 44 CSS px in both directions, targets never closer than 4 px.
 */
function checkTouch(name, L) {
  const errs = [];
  if (!L) errs.push('no layout');
  else {
    const [W] = L.screen;
    const [top, bottom] = L.list;
    const [dy, min] = L.scroll;
    const [px, py, pw, ph] = L.panel;
    for (const t of L.texts) {
      const [x, y, w, h] = t.box;
      if (x < px - 0.5 || y < py - 0.5 || x + w > px + pw + 0.5 || y + h > py + ph + 0.5) errs.push(`outside panel: "${t.text}"`);
    }
    for (let i = 0; i < L.texts.length; i++)
      for (let j = i + 1; j < L.texts.length; j++) {
        const [ax, ay, aw, ah] = L.texts[i].box;
        const [bx, by, bw, bh] = L.texts[j].box;
        if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah) errs.push(`overlap: "${L.texts[i].text}" / "${L.texts[j].text}"`);
      }
    if (px < -0.5 || px + pw > W + 0.5) errs.push('panel wider than the screen');
    // symmetric gutters (the frame never touches the screen edge)
    if (L.gutter > 0 && (px < L.gutter - 0.5 || Math.abs(px - (W - px - pw)) > 1.5)) errs.push(`panel not symmetric: ${px} / ${W - px - pw}`);
    if (L.foot) {
      const [fx, fy, fw, fh] = L.foot.panel;
      if (fy + fh > L.screen[1] + 0.5 || Math.abs(fx - (W - fx - fw)) > 1.5) errs.push('footer panel off screen or not symmetric');
      if (fy < py + ph - 0.5 + (L.scroll[1] < 0 ? -1e9 : 0)) errs.push('footer overlaps the menu panel');
      for (const t of L.foot.texts) {
        const [x, y, w, h] = t.box;
        if (x < fx - 0.5 || y < fy - 0.5 || x + w > fx + fw + 0.5 || y + h > fy + fh + 0.5) errs.push(`outside footer: "${t.text}"`);
      }
      for (let i = 0; i < L.foot.texts.length; i++)
        for (let j = i + 1; j < L.foot.texts.length; j++) {
          const [ax, ay, aw, ah] = L.foot.texts[i].box;
          const [bx, by, bw, bh] = L.foot.texts[j].box;
          if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah) errs.push(`footer overlap: "${L.foot.texts[i].text}"`);
        }
    }
    if (L.balance && L.block && L.scroll[1] === 0) {
      const c = (L.block[0] + L.block[1]) / 2;
      const H = L.screen[1];
      if (Math.abs(c - H / 2) > 0.08 * H) errs.push(`menu block off centre: ${(((c - H / 2) / H) * 100).toFixed(1)}%`);
    }
    const k = L.cssPerPx;
    for (const t of L.targets) {
      const [x, y, w, h] = t.box;
      if (w * k < 44 - 0.5 || h * k < 44 - 0.5) errs.push(`target under 44 CSS px: "${t.label}" (${(w * k).toFixed(0)}x${(h * k).toFixed(0)})`);
      if (x < -0.5 || x + w > W + 0.5) errs.push(`target off screen: "${t.label}"`);
      if (t.kind !== 'back') {
        const yc = y - dy; // content coords
        // visible at some scroll s in [min, 0]: top <= yc + s and yc + h + s <= bottom
        const lo = Math.max(min, top - yc);
        const hi = Math.min(0, bottom - h - yc);
        if (lo > hi + 0.5) errs.push(`target never fully visible at any scroll: "${t.label}"`);
      }
    }
    // a row scrolled under the title band is not tappable there (the menu ignores it): skip it against BACK
    const hidden = (t) => t.kind !== 'back' && t.box[1] < top - 0.5;
    for (let i = 0; i < L.targets.length; i++)
      for (let j = i + 1; j < L.targets.length; j++) {
        if ((L.targets[i].kind === 'back' && hidden(L.targets[j])) || (L.targets[j].kind === 'back' && hidden(L.targets[i]))) continue;
        const [ax, ay, aw, ah] = L.targets[i].box;
        const [bx, by, bw, bh] = L.targets[j].box;
        if (ax < bx + bw + 4 && bx < ax + aw + 4 && ay < by + bh + 4 && by < ay + ah + 4 && !(ax + aw <= bx || bx + bw <= ax) && !(ay + ah <= by || by + bh <= ay))
          errs.push(`targets overlap: "${L.targets[i].label}" / "${L.targets[j].label}"`);
        else if (Math.abs(ay - by) < 1 && Math.abs(ax - bx) > 0) continue; // the row and its arrows share a line
        else if (ax < bx + bw && bx < ax + aw && ((ay + ah <= by && by - (ay + ah) < 4 - 0.01) || (by + bh <= ay && ay - (by + bh) < 4 - 0.01)))
          errs.push(`targets closer than 4 px: "${L.targets[i].label}" / "${L.targets[j].label}"`);
      }
  }
  if (errs.length) failed++;
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${name}${errs.length ? ': ' + [...new Set(errs)].slice(0, 4).join('; ') : ''}`);
}

function check(name, L) {
  if (L && L.touch) return checkTouch(name, L);
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
  // the board API is mocked (a long champion name and message): the title's champion block is laid out for real
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: 'http://localhost:8787' } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4183', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  try {
    const phone = (w, h, dpr) => ({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
    const runs = [
      ['desktop', { viewport: { width: 1440, height: 810 } }],
      ['phone', { ...devices['Pixel 7 landscape'] }],
      ['landscape 667x375', phone(667, 375, 3)],
    ];
    for (const ins of [null, [47, 34]])
      for (const [w, h, d] of [[390, 844, 3], [360, 800, 3], [412, 915, 2.625], [375, 667, 2], [430, 932, 3]])
        runs.push([`portrait ${w}x${h}${ins ? ' insets 47/34' : ''}`, phone(w, h, d), ins]);
    runs.push(['landscape 844x390 insets 47/34', phone(844, 390, 3), [0, 21]]);
    const now = new Date();
    const BOARD = { date: now.toISOString().slice(0, 10), serverNow: now.toISOString(), champion: { name: 'WWWWWWWWWWWWWWWW', message: 'Supercalifragilistic parries forever and ever, night' }, top: [] };
    for (const [label, opts, ins] of runs) {
      const ctx = await b.newContext(opts);
      await ctx.route('http://localhost:8787/api/daily**', (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(BOARD) }));
      await ctx.route('http://localhost:8787/api/daily/me', (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ verifiedScore: null, verifiedRank: null, pending: false, serverNow: now.toISOString() }) }));
      if (ins)
        // simulated safe-area insets: the #safe probe (normally env(safe-area-inset-*)) is padded before the game boots
        await ctx.addInitScript(([t, bt]) => {
          document.addEventListener('readystatechange', () => {
            const el = document.getElementById('safe');
            if (el) el.style.padding = `${t}px 0px ${bt}px 0px`;
          });
        }, ins);
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
      check(`${label} title`, { ...(await L()), balance: label.startsWith('portrait') });
      if (ins) {
        // the canvas sits inside the simulated insets: nothing under the status bar or the home indicator
        const r = await page.evaluate(() => { const c = document.querySelector('#game canvas').getBoundingClientRect(); return [c.top, c.bottom, innerHeight]; });
        const okIns = r[0] >= ins[0] - 0.5 && r[1] <= r[2] - ins[1] + 0.5;
        if (!okIns) failed++;
        console.log(`${okIns ? 'ok  ' : 'FAIL'} ${label} canvas inside the insets (${r.map((v) => v.toFixed(1)).join(' / ')})`);
      }
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
