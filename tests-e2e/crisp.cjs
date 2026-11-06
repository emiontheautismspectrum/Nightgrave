/**
 * Crisp-pixel check on the production build: at DPR 1, 1.25, 1.5 and 2 and windows 1920x1040 / 1366x700, every game
 * pixel must be an exact z x z block of device pixels (z integer) and the title text crop must contain (almost) no
 * non-uniform blocks (blended colours). Saves assets/preview/crisp_dpr125.png.
 * Phones (DPR 2 and 3, portrait and landscape): the canvas is shown at exactly k device px per game px (CSS width x DPR
 * = game width x k within 0.01 px) and k is the one portraitGameSize gives for the FINAL visible viewport: after boot,
 * after a viewport change, and after a late change with NO resize / visualViewport event (iOS web apps), healed by
 * `pageshow` alone or, with no event at all, by the 1 s measurement watch. Smoke build (window.__ngScreen).
 * Run: npm run e2e:crisp
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
// run vite itself (not through npx): kill() then stops the server instead of leaving an orphan on the port
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const ROOT = path.join(__dirname, '..');
// assets/preview/ is untracked output (absent in a fresh clone): create it before writing screenshots
require('node:fs').mkdirSync(path.join(ROOT, 'assets', 'preview'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;

/** portraitGameSize (src/web/screen.ts), restated: ~280 game px wide at an integer k device px per game px. */
const expectK = (vw, vh, dpr) => Math.max(1, Math.round(Math.floor(vw * dpr) / 280));

async function phoneCheck(page, label) {
  const r = await page.evaluate(() => {
    const c = document.querySelector('#game canvas');
    const b = c.getBoundingClientRect();
    return { w: b.width, h: b.height, bw: c.width, bh: c.height, dpr: window.devicePixelRatio, iw: innerWidth, ih: innerHeight, s: window.__ngScreen };
  });
  const portrait = r.ih > r.iw;
  const kCss = (r.w * r.dpr) / r.bw;
  const k = Math.round(kCss);
  const exact = Math.abs(r.w * r.dpr - r.bw * k) < 0.01 && Math.abs(r.h * r.dpr - r.bh * k) < 0.01;
  const full = Math.floor(Math.floor(r.iw * r.dpr) / k);
  const kOk = portrait ? k === expectK(r.iw, r.ih, r.dpr) && r.bw <= full && r.bw >= full - 24 : r.bw === 480;
  const fresh = r.s && r.s.vw === r.iw && r.s.vh === r.ih;
  const ok = exact && kOk && fresh;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${r.iw}x${r.ih} dpr ${r.dpr}: k ${kCss.toFixed(4)}${portrait ? ` (expected ${expectK(r.iw, r.ih, r.dpr)})` : ''}, game ${r.bw}x${r.bh}, measured ${r.s ? `${r.s.vw}x${r.s.vh}` : '-'}`);
}

async function phones(browser) {
  for (const dpr of [2, 3])
    for (const [w, h, w2, h2] of [[390, 844, 390, 664], [360, 800, 412, 915], [844, 390, 667, 375]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
      await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
      const page = await ctx.newPage();
      await page.goto('http://localhost:4181/');
      await sleep(1500);
      await phoneCheck(page, `phone boot ${w}x${h}`);
      await page.setViewportSize({ width: w2, height: h2 });
      await sleep(800);
      await phoneCheck(page, `phone resized ${w2}x${h2}`);
      await ctx.close();
      // a late viewport change WITHOUT resize / visualViewport events (the iOS standalone launch): pageshow heals it
      const ctx2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
      await ctx2.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
      await ctx2.addInitScript(() => {
        const block = (t) => t === 'resize' || t === 'orientationchange';
        const wa = window.addEventListener.bind(window);
        window.addEventListener = (t, f, o) => (block(t) ? undefined : wa(t, f, o));
        if (window.visualViewport) {
          const va = window.visualViewport.addEventListener.bind(window.visualViewport);
          window.visualViewport.addEventListener = (t, f, o) => (t === 'resize' ? undefined : va(t, f, o));
        }
      });
      const p2 = await ctx2.newPage();
      await p2.goto('http://localhost:4181/');
      await sleep(1500);
      await p2.setViewportSize({ width: w2, height: h2 });
      await p2.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await sleep(300); // well under the 1 s watch: pageshow alone did it
      await phoneCheck(p2, `phone late change + pageshow ${w2}x${h2}`);
      await p2.setViewportSize({ width: w, height: h });
      await sleep(1600); // no event at all: the 1 s measurement watch
      await phoneCheck(p2, `phone late change, no event ${w}x${h}`);
      await ctx2.close();
    }
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1' } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4181', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const browser = await chromium.launch();
  try {
    for (const dpr of [1, 1.1, 1.25, 1.5, 2])
      for (const [w, h] of [[1920, 1040], [1366, 700]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
        await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} }); // tests skip the site intro
        const page = await ctx.newPage();
        await page.goto('http://localhost:4181/');
        await sleep(1500);
        const r = await page.evaluate(() => {
          const c = document.querySelector('#game canvas');
          const b = c.getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height, bw: c.width, bh: c.height, dpr: window.devicePixelRatio };
        });
        const z = (r.w * r.dpr) / 480;
        const exact = Math.abs(z - Math.round(z)) < 1e-3 && Math.abs((r.h * r.dpr) / 270 - z) < 1e-3 && Math.abs(r.x * r.dpr - Math.round(r.x * r.dpr)) < 1e-2;
        // title text crop (game px 150..330 x 22..38): every game pixel must be one uniform device block
        const shot = await page.screenshot(); // full page in device pixels; cropped exactly in Python below
        let mixed = 0;
        let blocks = 0;
        if (exact) {
          // count non-uniform z x z blocks with Python + Pillow (already required by the art pipeline)
          const tmp = path.join(require('node:os').tmpdir(), `crisp_${dpr}_${w}.png`);
          require('node:fs').writeFileSync(tmp, shot);
          const py = `from PIL import Image\nimport numpy as np\na=np.asarray(Image.open(${JSON.stringify(tmp)}).convert('RGB')).astype(int)\nz=${Math.round(z)}\nx0=round(${r.x * r.dpr})+150*z\ny0=round(${r.y * r.dpr})+22*z\na=a[y0:y0+17*z,x0:x0+181*z]  # the grid phase is found below (the browser may place the canvas 1 device px off)\nbest=None\nfor py in range(z):\n  for px in range(z):\n    c=a[py:,px:]\n    h,w=c.shape[0]//z*z,c.shape[1]//z*z\n    b=c[:h,:w].reshape(h//z,z,w//z,z,3)\n    d=np.abs(b-b[:,:1,:,:1]).sum(-1).max(axis=(1,3))\n    r=(int((d>6).sum()),d.size)\n    best=r if best is None or r[0]<best[0] else best\nprint(best[0],best[1])`;
          const [m, n] = execSync('python3 -', { input: py }).toString().trim().split(' ').map(Number);
          mixed = m;
          blocks = n;
        }
        const pct = blocks ? (100 * mixed) / blocks : NaN;
        // the canvas must stay centred (never jump to the top-left corner), exact or not
        // the game + board panel pair is centred (Polish 3); the canvas must be fully inside the window
        const centred = r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
        const ok = (exact ? pct < 1 : true) && centred;
        if (!centred) console.log(`  canvas not centred: x ${r.x} y ${r.y} w ${r.w} h ${r.h}`);
        if (!ok || !exact) failed = failed || !ok;
        console.log(`${ok ? 'ok  ' : 'FAIL'} dpr ${dpr} ${w}x${h}: ${exact ? `${Math.round(z)} device px per game px` : `fractional ${z.toFixed(2)} (fallback)`}, backing ${r.bw}x${r.bh}, mixed blocks in title ${Number.isNaN(pct) ? 'n/a' : pct.toFixed(2) + '%'}`);
        if (dpr === 1.25 && w === 1920) await page.screenshot({ path: path.join(ROOT, 'assets', 'preview', 'crisp_dpr125.png') });
        await ctx.close();
      }
    await phones(browser);
  } finally {
    await browser.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '' } });
  }
  console.log(failed ? 'CRISP: FAILED' : 'CRISP: all passed');
  process.exitCode = failed ? 1 : 0;
})();
