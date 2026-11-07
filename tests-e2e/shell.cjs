/**
 * The phone-portrait console shell on the smoke build (touch, insets 47 / 34 CSS px):
 * - the baked texture equals its parts pixel for pixel (every tile, cropped tile, 9-slice repeat and rasterised rect);
 * - the RENDERED deck equals the baked texture at DPR 2, 2.625 and 3: every game px is one uniform k x k device px
 *   block of the baked colour (no half-pixel seams between tiles);
 * - 20 relayouts keep the texture count constant (the old shell texture is destroyed), each one bakes again;
 * - a WebGL context loss + restore bakes again and the render still matches;
 * - a Hard death with a mocked board: the death panel and the name field stay on the visible screen, above the deck;
 * - the boss bar sits in its slot; Left-handed; Knight and Wisp lamps; screenshots in assets/preview/ (untracked):
 *   shell_run_390, shell_run_360, shell_run_375x667, shell_boss, shell_death_submit, shell_knight_lamps,
 *   shell_wisp_lamps, shell_lefthanded.
 * Run: node tests-e2e/shell.cjs
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'preview');
fs.mkdirSync(OUT, { recursive: true });
const API = 'http://localhost:8787';
const URL0 = 'http://localhost:4196/';
const INS = [47, 34];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, name, extra = '') => {
  if (!c) failed++;
  console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};

/** Minimal PNG decoder (8-bit RGB / RGBA, not interlaced: what Chromium writes) -> { w, h, px: Uint8Array RGBA }. */
function decodePng(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 4);
  const stride = w * bpp;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      px[(y * w + x) * 4] = cur[x * bpp];
      px[(y * w + x) * 4 + 1] = cur[x * bpp + 1];
      px[(y * w + x) * 4 + 2] = cur[x * bpp + 2];
      px[(y * w + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev = cur;
  }
  return { w, h, px };
}

async function session(b, w, h, dpr, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const save = { v: 1, difficulty: opts.difficulty ?? 'hard', hero: opts.hero ?? 'knight', settings: { touchHintSeen: true, hintsDone: true, leftHanded: !!opts.leftHanded, touchControls: opts.drag ? 'drag' : 'stick' }, best: {}, daily: [] };
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript((sv) => { if (!sessionStorage.getItem('ng.s')) { localStorage.setItem('nightgrave.v1', sv); sessionStorage.setItem('ng.s', '1'); } }, JSON.stringify(save));
  await ctx.addInitScript(() => { window.__ngManual = true; });
  await ctx.addInitScript(([t, bt]) => {
    document.addEventListener('readystatechange', () => {
      const el = document.getElementById('safe');
      if (el) el.style.padding = `${t}px 0px ${bt}px 0px`;
    });
  }, INS);
  const now = new Date();
  const board = { date: now.toISOString().slice(0, 10), serverNow: now.toISOString(), champion: null, top: [] };
  await ctx.route(`${API}/api/daily**`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(board) }));
  await ctx.route(`${API}/api/daily/me`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ verifiedScore: null, verifiedRank: null, pending: false, serverNow: now.toISOString() }) }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
  await page.goto(`${URL0}?play=1${opts.wave ? `&wave=${opts.wave}` : ''}`);
  await sleep(2000);
  const shell = () => page.evaluate(() => { const s = window.__ngShell(); return JSON.parse(JSON.stringify({ ...s, canvas: null, atlas: null })); });
  const dbg = () => page.evaluate(() => { const d = window.__ngDebug; return d ? JSON.parse(JSON.stringify(d)) : null; });
  const step = async (n) => { await page.evaluate((m) => window.__ngDebug.step(m), n); await sleep(80); };
  return { ctx, page, errs, shell, dbg, step };
}

/** In the page: every baked pixel equals the pixel its LAST part says (atlas tile pixel or the rect's colour). */
async function bakeMatchesParts(page) {
  return page.evaluate(() => {
    const s = window.__ngShell();
    const cv = s.canvas;
    const P = s.parts;
    const W = cv.width;
    const H = cv.height;
    const baked = cv.getContext('2d').getImageData(0, 0, W, H).data;
    const at = document.createElement('canvas');
    at.width = s.atlas.width;
    at.height = s.atlas.height;
    const actx = at.getContext('2d');
    actx.drawImage(s.atlas, 0, 0);
    const atlas = actx.getImageData(0, 0, at.width, at.height).data;
    const frames = Object.fromEntries(s.frames.map(([n, x, y]) => [n, [x, y]]));
    const owner = new Int32Array(W * H).fill(-1);
    P.parts.forEach((p, i) => { for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) owner[y * W + x] = i; });
    const hex = { bg0: '#0b0d12', bg1: '#12161d', fog: '#1c2330', stone_dark: '#262e3d', stone: '#3a4558', bone: '#d9d2c0', amber: '#ffb347', gold: '#ffd86b', teal: '#4fd1c5' };
    let bad = 0;
    let checked = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = owner[y * W + x];
        if (i < 0) continue;
        const p = P.parts[i];
        const o = (y * W + x) * 4;
        let r;
        let g;
        let bl;
        let a = 255;
        if (p.t === 'rect') {
          const h = hex[p.color];
          r = parseInt(h.slice(1, 3), 16);
          g = parseInt(h.slice(3, 5), 16);
          bl = parseInt(h.slice(5, 7), 16);
        } else {
          const [fx, fy] = frames[`${p.name}_${p.frame}`];
          // a repeated 1 px slice maps every destination px to that one source column / row
          const sx = fx + p.sx + (p.sw === 1 ? 0 : x - p.x);
          const sy = fy + p.sy + (p.sh === 1 ? 0 : y - p.y);
          const q = (sy * at.width + sx) * 4;
          [r, g, bl, a] = [atlas[q], atlas[q + 1], atlas[q + 2], atlas[q + 3]];
          if (a === 0) continue; // a transparent tile pixel shows what is under it
        }
        checked++;
        if (baked[o] !== r || baked[o + 1] !== g || baked[o + 2] !== bl || baked[o + 3] !== a) bad++;
      }
    return { bad, checked };
  });
}

/**
 * The rendered deck vs the baked texture: every game px of the deck that only the static shell draws (not a cap, a
 * lamp, the stick zone or the slot) must be a uniform k x k device px block of exactly the baked colour.
 */
async function renderMatchesBake(page) {
  const info = await page.evaluate(() => {
    const s = window.__ngShell();
    const c = document.querySelector('#game canvas');
    const r = c.getBoundingClientRect();
    const L = s.layout;
    const baked = Array.from(s.canvas.getContext('2d').getImageData(0, L.shell.deckTop, L.W, L.H - L.shell.deckTop).data);
    return { x: r.left, y: r.top, w: r.width, h: r.height, gw: c.width, L, lamps: s.parts.lamps, baked };
  });
  // the whole page (a clip would round the canvas's CSS offset): the canvas starts on a whole device px
  const png = decodePng(await page.screenshot());
  const dpr = png.w / (await page.evaluate(() => innerWidth));
  const k = Math.round((info.w * dpr) / info.gw);
  const ox = Math.round(info.x * dpr);
  const oy = Math.round(info.y * dpr);
  if (process.env.SHELL_DEBUG) console.log('  canvas at', info.x, info.y, 'dpr', dpr, 'k', k, 'ox', ox, 'oy', oy, 'png', png.w, png.h, 'game', info.gw);
  const L = info.L;
  const skip = [];
  for (const bt of L.buttons) skip.push({ x: bt.cap.x - 1, y: bt.cap.y - 1, w: bt.cap.w + 3, h: bt.cap.h + 3 });
  for (const l of info.lamps) skip.push({ x: l.x, y: l.y, w: 11, h: 11 });
  const S = L.stick;
  skip.push({ x: S.x - S.zone, y: S.y - S.zone, w: 2 * S.zone, h: 2 * S.zone });
  skip.push(L.shell.slot);
  /** Mismatching game px if the canvas's first device px is at (ox + ex, oy + ey). */
  const count = (ex, ey, limit = Infinity) => {
    let bad = 0;
    let n = 0;
    for (let y = L.shell.deckTop; y < L.H && bad < limit; y++)
      for (let x = 0; x < L.W; x++) {
        if (skip.some((r) => x >= r.x - 1 && x < r.x + r.w + 1 && y >= r.y - 1 && y < r.y + r.h + 1)) continue;
        const o = ((y - L.shell.deckTop) * L.W + x) * 4;
        if (info.baked[o + 3] !== 255) continue;
        n++;
        let same = true;
        for (let dy = 0; dy < k && same; dy++)
          for (let dx = 0; dx < k; dx++) {
            const q = ((oy + ey + y * k + dy) * png.w + ox + ex + x * k + dx) * 4;
            if (Math.abs(png.px[q] - info.baked[o]) > 1 || Math.abs(png.px[q + 1] - info.baked[o + 1]) > 1 || Math.abs(png.px[q + 2] - info.baked[o + 2]) > 1) {
              same = false;
              break;
            }
          }
        if (!same) bad++;
      }
    return { bad, n };
  };
  // the browser may place the canvas a device px off its CSS rectangle (a half CSS px offset at DPR 2): find the real
  // device offset, then EVERY game px must be one uniform k x k block of the baked colour there
  let best = { ex: 0, ey: 0, bad: Infinity, n: 0 };
  for (let ey = -2; ey <= 2; ey++)
    for (let ex = -2; ex <= 2; ex++) {
      const c = count(ex, ey, best.bad);
      if (c.bad < best.bad) best = { ex, ey, ...c };
    }
  const { bad, n } = count(best.ex, best.ey);
  if (process.env.SHELL_DEBUG) console.log('  device offset', best.ex, best.ey);
  return { bad, n, k, off: `${best.ex},${best.ey}` };
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: API } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4196', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  const watchdog = setTimeout(() => {
    console.log('SHELL: FAILED (timed out)');
    srv.kill();
    process.exit(1);
  }, 900_000);
  try {
    // ---- pixel exactness at three DPRs, relayouts, context loss
    for (const [w, h, dpr, shot] of (process.env.SHELL_ONLY ? [[375, 667, 2, null]] : [[390, 844, 3, 'shell_run_390'], [412, 915, 2.625, null], [375, 667, 2, 'shell_run_375x667'], [360, 800, 3, 'shell_run_360']])) {
      const label = `${w}x${h} DPR ${dpr}`;
      const s = await session(b, w, h, dpr);
      let sh = await s.shell();
      ok(sh.visible, `${label}: the shell is shown in the portrait run`);
      ok(sh.body === 'rgb(18, 22, 29)', `${label}: the page under the notch / home indicator is the body colour`, sh.body);
      const m = await bakeMatchesParts(s.page);
      ok(m.bad === 0 && m.checked > 1000, `${label}: the baked texture equals its tiles and rects`, `${m.checked} px checked, ${m.bad} wrong`);
      let r = await renderMatchesBake(s.page);
      ok(r.bad === 0 && r.n > 500, `${label}: the rendered deck equals the bake, k=${r.k} (no half-pixel seams)`, `${r.n} game px, ${r.bad} wrong, device offset ${r.off}`);
      if (shot) await s.page.screenshot({ path: path.join(OUT, `${shot}.png`) });
      if (dpr === 3 && w === 390) {
        // 20 relayouts (browser bars coming and going): one shell texture at any time, a bake each time
        const t0 = sh.textures;
        const b0 = sh.bakes;
        for (let i = 0; i < 20; i++) {
          await s.page.setViewportSize({ width: w, height: i % 2 ? h : h - 60 });
          await sleep(350);
        }
        await s.page.setViewportSize({ width: w, height: h });
        await sleep(600);
        sh = await s.shell();
        ok(sh.textures === t0, '20 relayouts: the texture count stays constant', `${t0} -> ${sh.textures}`);
        ok(sh.bakes >= b0 + 20, '20 relayouts: the shell was baked again each time', `${b0} -> ${sh.bakes}`);
        // a WebGL context loss and restore: baked again, still pixel-exact
        const lost = await s.page.evaluate(async () => {
          const c = document.querySelector('#game canvas');
          const gl = c.getContext('webgl2') || c.getContext('webgl');
          const ext = gl && gl.getExtension('WEBGL_lose_context');
          if (!ext) return false;
          ext.loseContext();
          await new Promise((res) => setTimeout(res, 400));
          ext.restoreContext();
          await new Promise((res) => setTimeout(res, 1200));
          return true;
        });
        if (lost) {
          const b1 = sh.bakes;
          sh = await s.shell();
          ok(sh.bakes > b1, 'WebGL context restored: the shell was baked again', `${b1} -> ${sh.bakes}`);
          await s.step(1);
          r = await renderMatchesBake(s.page);
          ok(r.bad === 0 && r.n > 500, 'WebGL context restored: the render still equals the bake', `${r.bad} wrong`);
        } else console.log('skip WebGL context loss (no WEBGL_lose_context)');
      }
      ok(s.errs.length === 0, `${label}: no page errors / CSP messages`, s.errs.join(' | '));
      await s.ctx.close();
    }

    // ---- Knight lamps (guard charges come from parries; dash lamp on), Wisp lamps, Left-handed, Drag mode
    for (const [hero, lh, drag, shot] of [['knight', false, false, 'shell_knight_lamps'], ['wisp', false, false, 'shell_wisp_lamps'], ['knight', true, false, 'shell_lefthanded'], ['wisp', false, true, null]]) {
      const s = await session(b, 390, 844, 3, { hero, leftHanded: lh, drag });
      await s.step(30);
      const sh = await s.shell();
      ok(sh.parts.lamps.length === (hero === 'knight' ? 6 : 4), `${hero}${lh ? ' left-handed' : ''}${drag ? ' drag' : ''}: ${sh.parts.lamps.length} lamps`);
      if (lh) ok(sh.layout.stick.x > sh.layout.W / 2 && sh.layout.buttons[0].x < sh.layout.W / 2, 'Left-handed: stick right, PARRY left');
      if (drag) {
        const d = await s.dbg();
        const ring = sh.parts.parts.filter((p) => p.t === 'rect' && p.color === 'stone' && p.h === 1 && p.y < sh.layout.H).length;
        ok(!d.stick && ring < 4, 'Drag mode: an empty well (no ring, no ticks)', `stick ${JSON.stringify(d.stick)}, ${ring} ring rows`);
      }
      if (shot) await s.page.screenshot({ path: path.join(OUT, `${shot}.png`) });
      await s.ctx.close();
    }

    // ---- the boss bar in its slot
    {
      // ?wave=7: the wave index 7 is a boss wave (every 4th); the bar shows once the boss is in
      const s = await session(b, 390, 844, 3, { wave: 7, difficulty: 'easy' });
      await s.step(150);
      const sh = await s.shell();
      ok(sh.layout.bar.y === sh.layout.shell.slot.y + 1 && sh.layout.bar.x >= sh.layout.shell.slot.x, 'the boss bar sits in its slot');
      await s.page.screenshot({ path: path.join(OUT, 'shell_boss.png') });
      await s.ctx.close();
    }

    // ---- a Hard death: the death panel and the name field on the visible screen, above the deck
    {
      const s = await session(b, 375, 667, 2);
      let d = await s.dbg();
      for (let i = 0; i < 300 && d.alive; i++) {
        await s.step(60);
        d = await s.dbg();
      }
      ok(!d.alive, 'Hard run ended by death');
      await sleep(2000);
      const sh = await s.shell();
      const box = await s.page.evaluate(() => { const c = document.querySelector('#game canvas').getBoundingClientRect(); return { top: c.top, k: c.height / document.querySelector('#game canvas').height, ih: innerHeight }; });
      const deckCss = box.top + sh.layout.shell.deckTop * box.k;
      ok(sh.panel && sh.panel.y + sh.panel.height <= sh.layout.shell.deckTop, 'the death panel ends above the deck', sh.panel ? `${sh.panel.y + sh.panel.height} <= ${sh.layout.shell.deckTop}` : 'no panel');
      const f = await s.page.evaluate(() => { const el = document.querySelector('input[data-ng="1"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      ok(f && f.top >= INS[0] - 0.5 && f.bottom <= deckCss, 'the name field is on the visible screen, above the deck', f ? `${f.top.toFixed(0)}..${f.bottom.toFixed(0)} deck ${deckCss.toFixed(0)}` : 'no field');
      await s.page.screenshot({ path: path.join(OUT, 'shell_death_submit.png') });
      ok(s.errs.length === 0, 'death: no page errors / CSP messages', s.errs.join(' | '));
      await s.ctx.close();
    }
  } catch (e) {
    ok(false, 'exception', String(e && e.stack));
  } finally {
    clearTimeout(watchdog);
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '', VITE_API_BASE: '' } });
  }
  console.log(failed ? `SHELL: ${failed} FAILED` : 'SHELL: all passed');
  process.exitCode = failed ? 1 : 0;
})();
