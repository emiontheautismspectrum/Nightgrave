/**
 * Frame cost of the phone-portrait run screen on the smoke build: iPhone 14 portrait (390x844, DPR 3), 4x CPU throttle,
 * 30 s of a real-time Hard run (the stick circles; a death restarts with Space). Reports the main-thread task time per
 * frame (CDP Performance metrics / rAF frames) and the mean rAF interval. Run: node tests-e2e/perf.cjs [label]
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const URL0 = 'http://localhost:4197/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: '' } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4197', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const save = { v: 1, difficulty: 'hard', hero: 'knight', settings: { touchHintSeen: true, hintsDone: true }, best: {}, daily: [] };
    await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
    await ctx.addInitScript((sv) => localStorage.setItem('nightgrave.v1', sv), JSON.stringify(save));
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(URL0);
    await sleep(1600);
    const l = await page.evaluate(() => window.__ngLayout);
    const t = l.targets.find((x) => x.label.trim().startsWith('PLAY'));
    const box = await page.evaluate(() => { const c = document.querySelector('#game canvas'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / c.width }; });
    const at = (gx, gy, id) => ({ x: box.x + gx * box.k, y: box.y + gy * box.k, id });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(t.box[0] + t.box[2] / 2, t.box[1] + t.box[3] / 2, 1)] });
    await sleep(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(1500);
    const dbg = () => page.evaluate(() => { const d = window.__ngDebug; return d ? { alive: d.alive, stick: d.stick, game: d.game } : null; });
    let d = await dbg();
    const b2 = await page.evaluate(() => { const c = document.querySelector('#game canvas'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / c.width }; });
    Object.assign(box, b2);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Performance.enable');
    await page.evaluate(() => { window.__frames = 0; window.__f0 = performance.now(); const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const t0 = Date.now();
    let ang = 0;
    let held = false;
    let deaths = 0;
    while (Date.now() - t0 < 30000) {
      d = await dbg();
      if (d && d.alive && d.stick) {
        const S = d.stick;
        ang += 0.9;
        const p = at(S.x + Math.cos(ang) * S.r, S.y + Math.sin(ang) * S.r, 1);
        await cdp.send('Input.dispatchTouchEvent', { type: held ? 'touchMove' : 'touchStart', touchPoints: [held ? p : at(S.x, S.y, 1)] });
        held = true;
      } else if (d && !d.alive) {
        if (held) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        held = false;
        deaths++;
        await sleep(1300);
        await page.keyboard.press('Space');
      }
      await sleep(400);
    }
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const fr = await page.evaluate(() => ({ n: window.__frames, ms: performance.now() - window.__f0 }));
    const task = ((m1.TaskDuration - m0.TaskDuration) * 1000) / fr.n;
    const script = ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / fr.n;
    console.log(`PERF ${process.argv[2] ?? ''}: game ${d && d.game}, frames ${fr.n} in ${(fr.ms / 1000).toFixed(1)} s, mean rAF interval ${(fr.ms / fr.n).toFixed(2)} ms, main-thread task ${task.toFixed(2)} ms/frame, script ${script.toFixed(2)} ms/frame, deaths ${deaths}`);
    await ctx.close();
  } finally {
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '', VITE_API_BASE: '' } });
  }
})();
