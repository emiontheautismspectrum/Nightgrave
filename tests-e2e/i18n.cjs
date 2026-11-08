/**
 * Languages on the smoke build (the language is chosen only through the stored setting or the browser language: no
 * URL parameter, no debug hook):
 * - auto: a browser in Russian gets Russian (the first-run card included), <html lang="ru">; English otherwise; the
 *   automatic choice is NOT stored;
 * - the title's language row: keyboard (and the same focus order as the other rows), mouse and touch; the title page
 *   is rebuilt in place with the focus on the switch; 10 switches leak no scene object and no language listener;
 * - Settings: the LANGUAGE row keeps the page and the row; hidden in Settings opened from the pause menu;
 * - the HTML board panel re-renders on a switch;
 * - a Hard death in Russian: Cyrillic typed into the name field (insertText), the submission is valid UTF-8 JSON
 *   with the Cyrillic name, and the board shows it (a mocked board, BitmapText title footer and HTML panel);
 * - screenshots (assets/preview/, untracked): ru_title, ru_settings, ru_hint_touch, ru_hint_desktop, ru_run_portrait,
 *   ru_run_landscape, ru_boss, ru_pause, ru_death_submit, ru_board_panel, ru_board_overlay.
 * Run: node tests-e2e/i18n.cjs
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const VITE_BIN = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'preview');
fs.mkdirSync(OUT, { recursive: true });
const API = 'http://localhost:8787';
const URL0 = 'http://localhost:4198/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, name, extra = '') => {
  if (!c) failed++;
  console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};
const phone = (w, h, dpr = 3) => ({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });

async function session(b, dev, o = {}) {
  const ctx = await b.newContext({ ...dev, ...(o.locale ? { locale: o.locale } : {}) });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('nightgrave.intro', '1'); } catch {} });
  if (o.save !== null) {
    const settings = { touchHintSeen: !o.hint, hintsDone: true, ...(o.lang ? { language: o.lang } : {}) };
    const sv = { v: 1, difficulty: o.difficulty ?? 'hard', hero: 'knight', settings, best: {}, daily: [], boardName: '' };
    await ctx.addInitScript((s) => { if (!sessionStorage.getItem('ng.s')) { localStorage.setItem('nightgrave.v1', s); sessionStorage.setItem('ng.s', '1'); } }, JSON.stringify(sv));
  }
  if (o.manual) await ctx.addInitScript(() => { window.__ngManual = true; });
  const now = new Date();
  const top = o.top ?? [];
  const board = { date: now.toISOString().slice(0, 10), serverNow: now.toISOString(), champion: top[0] ? { name: top[0].name, message: 'Парируй ночь, друг!' } : null, top };
  await ctx.route(`${API}/api/daily**`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(board) }));
  await ctx.route(`${API}/api/daily/me`, (r) => r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ verifiedScore: 1234, verifiedRank: 2, pending: true, serverNow: now.toISOString() }) }));
  const sent = [];
  await ctx.route(`${API}/api/submit`, (r) => {
    sent.push(r.request().postDataBuffer());
    return r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ accepted: true, pending: true, provisionalRank: 1 }) });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
  await page.goto(URL0 + (o.url ?? ''));
  await sleep(1800);
  const L = () => page.evaluate(() => window.__ngLayout ?? null);
  const dbg = () => page.evaluate(() => { const d = window.__ngDebug; return d ? JSON.parse(JSON.stringify(d)) : null; });
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(140); } await sleep(150); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('nightgrave.v1') || '{}').settings?.language ?? null);
  return { ctx, page, errs, sent, L, dbg, key, stored };
}

(async () => {
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '1', VITE_API_BASE: API } });
  const srv = spawn(process.execPath, [VITE_BIN, 'preview', '--port', '4198', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(2500);
  const b = await chromium.launch();
  const watchdog = setTimeout(() => { console.log('I18N: FAILED (timed out)'); srv.kill(); process.exit(1); }, 900_000);
  try {
    // ---- auto: the browser's language, never stored; the first-run card already in Russian
    {
      const s = await session(b, phone(390, 844), { locale: 'ru-RU', save: null, url: '?play=1' });
      const html = await s.page.evaluate(() => document.documentElement.lang);
      ok(html === 'ru', 'auto: a Russian browser gets <html lang="ru">', html);
      await sleep(800);
      await s.page.screenshot({ path: path.join(OUT, 'ru_hint_touch.png') });
      ok((await s.stored()) === null || (await s.stored()) === 'auto', 'auto: the detected language is not stored', String(await s.stored()));
      ok(s.errs.length === 0, 'auto: no page errors / CSP messages', s.errs.join(' | '));
      await s.ctx.close();
      const e = await session(b, { viewport: { width: 1280, height: 720 } }, { locale: 'de-DE', save: null });
      ok((await e.L()).lang === 'en', 'auto: a German browser gets English');
      await e.ctx.close();
      const u = await session(b, { viewport: { width: 1280, height: 720 } }, { locale: 'uz-UZ', save: null });
      ok((await u.L()).lang === 'ru', 'auto: an Uzbek browser gets Russian for now');
      await u.ctx.close();
      const d = await session(b, { viewport: { width: 1280, height: 720 } }, { lang: 'ru', hint: true, url: '?play=1' });
      await sleep(600);
      await d.page.screenshot({ path: path.join(OUT, 'ru_hint_desktop.png') });
      await d.ctx.close();
    }

    // ---- the title switch: keyboard, the same page, focus kept, no leaks; the board panel re-renders
    {
      const s = await session(b, { viewport: { width: 1280, height: 720 } }, { lang: 'en' });
      let l = await s.L();
      const objs0 = l.objects;
      const lis0 = l.langListeners;
      const rows = l.targets.filter((t) => t.kind === 'row').length;
      await s.key('ArrowDown', rows); // the language row is the last row: reachable like the others
      l = await s.L();
      const focus = l.focus;
      ok(/\[EN\]/.test(l.targets.find((t) => t.i === focus)?.label ?? ''), 'keyboard: the language row is in the focus order', l.targets.find((t) => t.i === focus)?.label);
      await s.key('Enter');
      l = await s.L();
      ok(l.lang === 'ru' && l.htmlLang === 'ru' && l.focus === focus && l.title === 'NIGHTGRAVE', 'keyboard: Enter switches to Russian, same page, focus kept', `${l.lang} ${l.focus}`);
      ok((await s.stored()) === 'ru', 'a manual choice is stored');
      const panelRu = await s.page.evaluate(() => document.querySelector('.bp-title')?.textContent ?? '');
      ok(/ЛУЧШИЕ/.test(panelRu), 'the board panel re-renders in Russian', panelRu);
      await s.page.screenshot({ path: path.join(OUT, 'ru_title.png') });
      await s.page.screenshot({ path: path.join(OUT, 'ru_board_panel.png'), clip: await s.page.evaluate(() => { const r = document.querySelector('.bpanel').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 700) }; }) });
      for (let i = 0; i < 10; i++) await s.key(i % 2 ? 'ArrowRight' : 'ArrowLeft');
      l = await s.L();
      ok(l.objects === objs0 && l.langListeners === lis0, '10 switches: no leaked scene object or language listener', `objects ${objs0} -> ${l.objects}, listeners ${lis0} -> ${l.langListeners}`);
      // mouse: a click on the row switches back
      const row = l.targets.find((t) => t.i === focus);
      const c = await s.page.evaluate(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / document.querySelector('#game canvas').width }; });
      await s.page.mouse.click(c.x + (row.box[0] + row.box[2] / 2) * c.k, c.y + (row.box[1] + row.box[3] / 2) * c.k);
      await sleep(400);
      ok((await s.L()).lang !== l.lang, 'mouse: a click on the language row switches');
      ok(s.errs.length === 0, 'title switch: no page errors / CSP messages', s.errs.join(' | '));
      await s.ctx.close();
    }

    // ---- touch: the switch by tap on a phone (>= 44 CSS px, inside the screen), settings keep the page and the row
    {
      const s = await session(b, phone(390, 844), { lang: 'ru' });
      const cdp = await s.ctx.newCDPSession(s.page);
      const tap = async (t) => {
        const c = await s.page.evaluate(() => { const r = document.querySelector('#game canvas').getBoundingClientRect(); return { x: r.left, y: r.top, k: r.width / document.querySelector('#game canvas').width }; });
        const p = { x: c.x + (t.box[0] + t.box[2] / 2) * c.k, y: c.y + (t.box[1] + t.box[3] / 2) * c.k, id: 1 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(400);
      };
      let l = await s.L();
      const sw = l.targets.find((t) => t.kind === 'row' && /\[RU\]/.test(t.label));
      ok(!!sw && sw.box[2] * l.cssPerPx >= 44 && sw.box[3] * l.cssPerPx >= 44, 'touch: the language row is a >= 44 CSS px target', sw && `${(sw.box[2] * l.cssPerPx).toFixed(0)}x${(sw.box[3] * l.cssPerPx).toFixed(0)}`);
      await s.page.screenshot({ path: path.join(OUT, 'ru_title_phone.png') });
      await tap(sw);
      l = await s.L();
      ok(l.lang === 'en', 'touch: a tap switches the language', l.lang);
      await tap(l.targets.find((t) => t.kind === 'row' && /\[EN\]/.test(t.label)));
      // settings: the LANGUAGE row keeps the page and the row
      l = await s.L();
      await tap(l.targets.find((t) => t.kind === 'row' && /НАСТРОЙКИ/.test(t.label)));
      l = await s.L();
      ok(l.title === 'НАСТРОЙКИ', 'settings opened in Russian', l.title);
      const langRow = l.targets.find((t) => t.kind === 'row' && /ЯЗЫК/.test(t.label));
      ok(!!langRow, 'settings: the LANGUAGE row');
      await s.page.screenshot({ path: path.join(OUT, 'ru_settings.png') });
      const right = l.targets.find((t) => t.kind === 'right' && t.i === langRow.i);
      await tap(right); // ru -> auto
      await tap(right); // auto -> en
      l = await s.L();
      ok(l.lang === 'en' && l.title === 'SETTINGS' && l.focus === langRow.i, 'settings: the switch keeps the page and the row', `${l.lang} ${l.title} ${l.focus}`);
      ok((await s.stored()) === 'en', 'settings: the choice is stored');
      // the phone board overlay re-renders after a switch
      await s.key('Escape');
      l = await s.L();
      await tap(l.targets.find((t) => t.kind === 'row' && /\[EN\]/.test(t.label)));
      l = await s.L();
      await tap(l.targets.find((t) => t.kind === 'row' && /РЕЙТИНГ/.test(t.label)));
      await sleep(600);
      const ov = await s.page.evaluate(() => ({ back: document.querySelector('.bover-back')?.textContent, title: document.querySelector('.bover .bp-title')?.textContent }));
      ok(ov.back === '< НАЗАД' && /ЛУЧШИЕ/.test(ov.title ?? ''), 'the board overlay is in Russian', JSON.stringify(ov));
      await s.page.screenshot({ path: path.join(OUT, 'ru_board_overlay.png') });
      ok(s.errs.length === 0, 'touch switch: no page errors / CSP messages', s.errs.join(' | '));
      await s.ctx.close();
    }

    // ---- no switch during a run: Settings from the pause menu has no LANGUAGE row; screenshots of the run in Russian
    {
      const s = await session(b, phone(390, 844), { lang: 'ru', url: '?play=1' });
      await sleep(600);
      await s.page.screenshot({ path: path.join(OUT, 'ru_run_portrait.png') });
      await s.key('KeyP');
      let l = await s.L();
      ok(l.title === 'ПАУЗА', 'pause in Russian', l.title);
      await s.page.screenshot({ path: path.join(OUT, 'ru_pause.png') });
      await s.key('ArrowDown', 2);
      await s.key('Enter');
      l = await s.L();
      ok(l.title === 'НАСТРОЙКИ' && !l.targets.some((t) => /ЯЗЫК/.test(t.label)), 'settings from the pause menu: no LANGUAGE row', l.targets.map((t) => t.label).join('|'));
      await s.ctx.close();
      const ls = await session(b, phone(844, 390), { lang: 'ru', url: '?play=1' });
      await sleep(600);
      await ls.page.screenshot({ path: path.join(OUT, 'ru_run_landscape.png') });
      await ls.ctx.close();
      const bs = await session(b, phone(390, 844), { lang: 'ru', url: '?play=1&wave=7', manual: true, difficulty: 'easy' });
      await bs.page.evaluate(() => window.__ngDebug.step(100));
      await sleep(300);
      await bs.page.screenshot({ path: path.join(OUT, 'ru_boss.png') });
      await bs.ctx.close();
    }

    // ---- a Hard death in Russian: Cyrillic typed into the name field, sent as UTF-8 JSON, shown by the board
    {
      const s = await session(b, phone(390, 844), { lang: 'ru', url: '?play=1', manual: true });
      let d = await s.dbg();
      for (let i = 0; i < 300 && d.alive; i++) {
        await s.page.evaluate(() => window.__ngDebug.step(60));
        d = await s.dbg();
      }
      await sleep(1800);
      const field = s.page.locator('input[data-ng="1"]').first();
      ok((await field.count()) === 1, 'the name field is offered');
      if (await field.count()) {
        const ph = await field.getAttribute('placeholder');
        ok(ph === 'ИМЯ', 'the name field placeholder is Russian', ph);
        await field.click();
        await field.fill('');
        await s.page.keyboard.insertText('Пётр Ёлкин');
        await sleep(300);
        await s.page.screenshot({ path: path.join(OUT, 'ru_death_submit.png') });
        await s.page.keyboard.press('Enter');
        await sleep(1500);
      }
      ok(s.sent.length === 1, 'submitted (mocked board)');
      if (s.sent.length) {
        const buf = s.sent[0];
        const txt = buf.toString('utf8');
        let body = null;
        try { body = JSON.parse(txt); } catch {}
        ok(!!body && body.name === 'Пётр Ёлкин' && Buffer.from(txt, 'utf8').equals(buf), 'the submission is valid UTF-8 JSON with the Cyrillic name', body && body.name);
      }
      await s.ctx.close();
      // the board shows a Cyrillic name: the HTML panel and the title's BitmapText champion block
      const top = [{ rank: 1, name: 'Пётр Ёлкин', score: 12345, hero: 'wisp', durationTicks: 3600, view: 'zoomed' }];
      const t = await session(b, { viewport: { width: 1280, height: 720 } }, { lang: 'ru', top });
      await sleep(800);
      const champ = await t.page.evaluate(() => document.querySelector('.bp-name')?.textContent ?? '');
      ok(champ.startsWith('Пётр Ёлкин'), 'the board panel shows the Cyrillic name', champ);
      const foot = ((await t.L()).texts ?? []).map((x) => x.text).join('|');
      ok(foot.includes('Пётр Ёлкин') && !foot.includes('?'), 'the title champion block renders the Cyrillic name (no "?")', foot.slice(0, 120));
      ok(t.errs.length === 0, 'board: no page errors / CSP messages', t.errs.join(' | '));
      await t.ctx.close();
    }
  } catch (e) {
    ok(false, 'exception', String(e && e.stack));
  } finally {
    clearTimeout(watchdog);
    await b.close();
    srv.kill();
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_SMOKE: '', VITE_API_BASE: '' } });
  }
  console.log(failed ? `I18N: ${failed} FAILED` : 'I18N: all passed');
  process.exitCode = failed ? 1 : 0;
})();
