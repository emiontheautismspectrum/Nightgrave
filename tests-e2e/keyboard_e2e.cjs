/**
 * The on-screen keyboard must stay open on the board fields (phone, live-site bug): on the smoke build with a mocked
 * board (no Cloudflare), a phone (DPR 3, touch) plays a Hard run to death; the submit panel offers NAME (and MESSAGE:
 * rank 1 on an empty board). For each field: tap it, then simulate the keyboard (the viewport 300 px shorter + resize
 * and visualViewport resize events) and wait 1.5 s (the 1 s measurement watch): the SAME input node keeps the focus,
 * its value and stays enabled; typing works. Then the keyboard goes away and the field is blurred: the layout is
 * measured again (crisp invariants hold). A rotation while focused keeps the field. Layout: every submit-panel text and
 * field lies inside the panel frame, the frame inside the screen, clear of the death panel text; portrait 390x844 /
 * 375x667, landscape 844x390 / 667x375. Zero CSP violations / page errors. Run: npm run e2e:keyboard
 */
const { LANG, L } = require('./lang.cjs');
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

const ROOT = path.join(__dirname, '..');
const API = 'http://localhost:8787';
const PORT = 4195;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, name, extra = '') => {
  if (!c) failed++;
  console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const inside = (b, f) => b[0] >= f[0] - 0.5 && b[1] >= f[1] - 0.5 && b[0] + b[2] <= f[0] + f[2] + 0.5 && b[1] + b[3] <= f[1] + f[3] + 0.5;
const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

async function device(b, label, w, h, csp) {
  console.log(`-- ${label}`);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  await ctx.addInitScript((lg) => localStorage.setItem('nightgrave.v1', JSON.stringify({ v: 1, difficulty: 'hard', hero: 'knight', settings: { touchHintSeen: true, hintsDone: true, language: lg }, best: {}, daily: [] })), LANG);
  await ctx.addInitScript(() => { window.__ngManual = true; });
  const now = new Date();
  const json = (body) => ({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${API}/api/daily/me`)) return route.fulfill(json({ verifiedScore: null, verifiedRank: null, pending: false, serverNow: now.toISOString() }));
    if (url.startsWith(`${API}/api/daily`)) return route.fulfill(json({ date: now.toISOString().slice(0, 10), serverNow: now.toISOString(), champion: null, top: [] }));
    if (url.startsWith(`${API}/api/submit`)) return route.fulfill(json({ accepted: true, pending: true, provisionalRank: 1 }));
    if (url.startsWith(API)) return route.fulfill({ status: 404, body: '' });
    const res = await route.fetch();
    const hd = { ...res.headers() };
    if ((hd['content-type'] ?? '').includes('text/html')) hd['content-security-policy'] = csp;
    return route.fulfill({ response: res, headers: hd });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/`);
  await sleep(1800);
  const dbg = () => page.evaluate(() => (window.__ngDebug ? JSON.parse(JSON.stringify(window.__ngDebug, (k, v) => (typeof v === 'function' ? undefined : v))) : null));
  // PLAY by tap (the menu target), then let the idle hero die (ticks stepped by the test)
  const L = await page.evaluate(() => window.__ngLayout);
  const play = L.targets.find((t) => t.label.trim() === L('PLAY'));
  const r0 = await page.evaluate(() => { const c = document.querySelector('#game canvas').getBoundingClientRect(); return { x: c.left, y: c.top, k: c.width / document.querySelector('#game canvas').width }; });
  await page.touchscreen.tap(r0.x + (play.box[0] + play.box[2] / 2) * r0.k, r0.y + (play.box[1] + play.box[3] / 2) * r0.k);
  await sleep(600);
  let d = await dbg();
  for (let i = 0; i < 300 && d && d.alive; i++) {
    await page.evaluate(() => window.__ngDebug.step(120));
    d = await dbg();
  }
  ok(d && !d.alive, `${label}: Hard run ended by death`);
  await page.waitForSelector('input[data-ng="1"]', { timeout: 8000 }).catch(() => null);
  await sleep(400);
  const n = await page.locator('input[data-ng="1"]').count();
  ok(n === 2, `${label}: NAME and MESSAGE fields offered (rank 1 on an empty board)`, String(n));
  // layout: every text and field inside the frame, the frame inside the screen, clear of the death panel text
  d = await dbg();
  const S = d.submitBoxes;
  const W = d.game[0];
  const H = d.game[1];
  const out = S ? [...S.texts.filter((t) => !inside(t.box, S.frame)).map((t) => t.text), ...S.fields.filter((f) => !inside(f, S.frame)).map(() => 'a field')] : ['no panel'];
  ok(S && !out.length, `${label}: the submit frame contains every text and field`, out.join(', '));
  ok(S && S.frame[0] >= 0 && S.frame[1] >= 0 && S.frame[0] + S.frame[2] <= W && S.frame[1] + S.frame[3] <= H, `${label}: the frame is inside the screen`, S && S.frame.join(','));
  ok(S && d.panelBox && !overlap(S.frame, d.panelBox), `${label}: the frame does not overlap the death panel text`, d.panelBox && d.panelBox.join(','));
  ok(S && d.boardBtnBox && !overlap(S.frame, d.boardBtnBox), `${label}: the frame does not overlap the [ BOARD ] button (tap area)`, d.boardBtnBox && d.boardBtnBox.map(Math.round).join(','));
  const fontPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('input[data-ng="1"]')).fontSize));
  ok(fontPx >= 16, `${label}: field font >= 16 CSS px (no iOS zoom on focus)`, String(fontPx));

  for (const [idx, name] of [[0, 'NAME'], [1, 'MESSAGE']]) {
    const loc = page.locator('input[data-ng="1"]').nth(idx);
    await loc.evaluate((el, m) => { el.dataset.mark = m; }, name);
    await loc.tap();
    await sleep(200);
    const focused = () => page.evaluate(() => { const a = document.activeElement; return a && a.dataset ? { mark: a.dataset.mark || null, value: a.value, disabled: a.disabled, connected: a.isConnected } : null; });
    let f = await focused();
    ok(f && f.mark === name, `${label}: ${name} focused by tap`);
    const before = await loc.inputValue();
    // the on-screen keyboard: 300 px less height, resize + visualViewport events, then the 1 s watch
    await page.setViewportSize({ width: w, height: h - 300 });
    await page.evaluate(() => { window.dispatchEvent(new Event('resize')); window.visualViewport && window.visualViewport.dispatchEvent(new Event('resize')); });
    await sleep(1500);
    f = await focused();
    ok(f && f.mark === name && f.connected && !f.disabled && f.value === before, `${label}: ${name} keeps the focus (same node), its value and stays enabled under the keyboard`, JSON.stringify(f));
    await page.keyboard.type('Xy');
    f = await focused();
    ok(f && f.mark === name && f.value === before + 'Xy', `${label}: typing works in ${name}`, f && f.value);
    // the keyboard goes away, the field is left: the layout is measured again
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { window.dispatchEvent(new Event('resize')); document.activeElement && document.activeElement.blur(); });
    await sleep(700);
    const m = await page.evaluate(() => { const c = document.querySelector('#game canvas'); const r = c.getBoundingClientRect(); return { iw: innerWidth, ih: innerHeight, s: window.__ngScreen, cw: r.width, bw: c.width, dpr: devicePixelRatio }; });
    const k = (m.cw * m.dpr) / m.bw;
    ok(m.s && m.s.vh === m.ih && m.s.vw === m.iw && Math.abs(k - Math.round(k)) < 0.01 / m.bw, `${label}: re-measured after blur, crisp (k ${k.toFixed(4)})`);
  }
  // a rotation while typing re-measures but keeps the field
  const loc = page.locator('input[data-ng="1"]').first();
  await loc.tap();
  await sleep(200);
  await page.setViewportSize({ width: h, height: w });
  await page.evaluate(() => { window.dispatchEvent(new Event('orientationchange')); window.dispatchEvent(new Event('resize')); });
  await sleep(1500);
  const f = await page.evaluate(() => { const a = document.activeElement; return a && a.dataset ? { mark: a.dataset.mark || null, connected: a.isConnected } : null; });
  ok(f && f.mark === 'NAME' && f.connected, `${label}: a rotation while focused keeps the NAME field`, JSON.stringify(f));
  const d2 = await dbg();
  ok(d2 && d2.submitBoxes && d2.submitBoxes.fields.every((fb) => inside(fb, d2.submitBoxes.frame)), `${label}: after the rotation the fields sit in the new frame`);
  // submit by Enter from a focused field: the field is left before it is disabled (game keys and re-measures free)
  await page.locator('input[data-ng="1"]').first().tap();
  await sleep(200);
  await page.keyboard.type('Tester');
  await page.keyboard.press('Enter');
  await sleep(900);
  const after = await page.evaluate(() => { const a = document.activeElement; const f = document.querySelector('input[data-ng="1"]'); return { onField: !!(a && a.dataset && a.dataset.ng === '1'), disabled: f && f.disabled, status: window.__ngDebug.submitStatus }; });
  ok(!after.onField && after.disabled && /SUBMITTED/.test(after.status || ''), `${label}: Enter submits, the field is left and disabled`, JSON.stringify(after));
  ok(errs.length === 0, `${label}: no page errors / CSP messages`, errs.join(' | '));
  await ctx.close();
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: API } });
  const csp = /Content-Security-Policy: (.*)/.exec(fs.readFileSync(path.join(ROOT, 'dist', '_headers'), 'utf8'))[1];
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  try {
    for (const [label, w, h] of [['portrait 390x844', 390, 844], ['portrait 375x667', 375, 667], ['landscape 844x390', 844, 390], ['landscape 667x375', 667, 375]]) await device(b, label, w, h, csp);
  } catch (e) {
    ok(false, 'exception', String(e && e.stack));
  } finally {
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '', VITE_API_BASE: '' } });
  }
  console.log(failed ? `KEYBOARD: ${failed} FAILED` : 'KEYBOARD: all passed');
  process.exitCode = failed ? 1 : 0;
})();
