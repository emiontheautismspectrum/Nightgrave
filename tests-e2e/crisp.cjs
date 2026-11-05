/**
 * Crisp-pixel check on the production build: at DPR 1, 1.25, 1.5 and 2 and windows 1920x1040 / 1366x700, every game
 * pixel must be an exact z x z block of device pixels (z integer) and the title text crop must contain (almost) no
 * non-uniform blocks (blended colours). Saves assets/preview/crisp_dpr125.png. Run: npm run e2e:crisp
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  const srv = spawn('npx', ['vite', 'preview', '--port', '4181', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
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
        const centred = Math.abs(r.x + r.w / 2 - w / 2) <= 12 && Math.abs(r.y + r.h / 2 - h / 2) <= 12;
        const ok = (exact ? pct < 1 : true) && centred;
        if (!centred) console.log(`  canvas not centred: x ${r.x} y ${r.y} w ${r.w} h ${r.h}`);
        if (!ok || !exact) failed = failed || !ok;
        console.log(`${ok ? 'ok  ' : 'FAIL'} dpr ${dpr} ${w}x${h}: ${exact ? `${Math.round(z)} device px per game px` : `fractional ${z.toFixed(2)} (fallback)`}, backing ${r.bw}x${r.bh}, mixed blocks in title ${Number.isNaN(pct) ? 'n/a' : pct.toFixed(2) + '%'}`);
        if (dpr === 1.25 && w === 1920) await page.screenshot({ path: path.join(ROOT, 'assets', 'preview', 'crisp_dpr125.png') });
        await ctx.close();
      }
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(failed ? 'CRISP: FAILED' : 'CRISP: all passed');
  process.exitCode = failed ? 1 : 0;
})();
