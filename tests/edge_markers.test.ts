/**
 * Phone portrait fairness: with the zoomed camera following a human-like bot, every projectile or hazard whose first
 * appearance is outside the view must have had an edge marker (or be on screen) for >= 15 ticks before it could hit.
 * Also: the camera is render-only (the sim result is identical with and without it).
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { FollowCam, type ViewRect } from '../src/render/camera';
import { edgeMarkers } from '../src/render/edgeMarkers';
import { PORTRAIT } from '../src/data/view';
import { portraitLayout } from '../src/render/portraitLayout';
import { portraitGameSize } from '../src/web/screen';
import { SkilledBot } from './skilled';

const FAIR_TICKS = 15;
/** "Could hit": the gap between the threat and the hero is within this many px. */
const CONTACT_GAP = 12;
const inView = (v: ViewRect, x: number, y: number) => x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1;

/** Real phones in portrait (the taller windows of the phone UX pass): CSS viewport and devicePixelRatio. */
const PHONES: [string, number, number, number][] = [['iPhone 14', 390, 844, 3], ['Pixel 7', 412, 915, 2.625], ['375x667', 375, 667, 2], ['360x800', 360, 800, 3]];

/** The follow camera of a phone's portrait run layout (the same numbers GameScene uses). */
function makeCam(phone: [string, number, number, number] = PHONES[0]!): FollowCam {
  const [, vw, vh, dpr] = phone;
  const P = portraitGameSize(vw, vh, dpr);
  const L = portraitLayout(P.w, P.h, P.k, dpr, false);
  return new FollowCam({ viewW: L.view.w / L.zoom, viewH: L.view.h / L.zoom, worldW: 480, worldH: 270, deadZone: PORTRAIT.deadZone, lead: PORTRAIT.lead, follow: PORTRAIT.follow, followReduced: PORTRAIT.followReduced });
}

interface Track { born: number; offAtBirth: boolean; seen: boolean[]; hitAt: number; sx: number; sy: number }

function audit(seed: number, startWave: number, reduced: boolean, maxTicks = 3600, phone = PHONES[0]!) {
  const sim = new Sim(seed, 'hard', { startWave });
  const bot = new SkilledBot(seed);
  const cam = makeCam(phone);
  cam.reset(sim.state.hero.x, sim.state.hero.y);
  const proj = new Map<number, Track>();
  const sig = new Map<number, Track & { fill: number }>();
  // every tick: positions of markers and of visible cues (to credit a projectile's pre-spawn telegraph)
  const cues: { x: number; y: number }[][] = [];
  let last = { x: sim.state.hero.x, y: sim.state.hero.y };
  const fails: string[] = [];
  let checked = 0;
  while (sim.state.alive && sim.state.tick < maxTicks) {
    const s = sim.state;
    const h = s.hero;
    const mv = Math.hypot(h.x - last.x, h.y - last.y);
    cam.step(1000 / 60, h.x, h.y, mv > 0.3 ? { x: (h.x - last.x) / mv, y: (h.y - last.y) / mv } : null, reduced);
    last = { x: h.x, y: h.y };
    const v = cam.rect();
    const marks = edgeMarkers(s, sim.params, v, PORTRAIT.horizonTicks);
    const keys = new Set(marks.map((m) => m.key));
    const tickCues = marks.map((m) => ({ x: m.sx, y: m.sy }));
    for (const tg of s.telegraphs) if (inView(v, tg.x, tg.y)) tickCues.push(tg);
    for (const c of s.casters) if (inView(v, c.x, c.y)) tickCues.push(c);
    if (s.boss && inView(v, s.boss.x, s.boss.y)) tickCues.push(s.boss);
    cues[s.tick] = tickCues;
    for (const pr of s.projectiles) {
      let tr = proj.get(pr.id);
      if (!tr) proj.set(pr.id, (tr = { born: s.tick, offAtBirth: !inView(v, pr.x, pr.y), seen: [], hitAt: -1, sx: pr.x, sy: pr.y }));
      tr.seen[s.tick] = inView(v, pr.x, pr.y) || keys.has(`p${pr.id}`);
      const gap = Math.hypot(pr.x - h.x, pr.y - h.y) - pr.radius - sim.params.heroRadius;
      if (tr.hitAt < 0 && gap <= CONTACT_GAP) tr.hitAt = s.tick;
    }
    for (const g of s.sigils) {
      let tr = sig.get(g.id);
      if (!tr) sig.set(g.id, (tr = { born: s.tick, offAtBirth: !inView(v, g.x, g.y), seen: [], hitAt: g.fill, sx: g.x, sy: g.y, fill: g.fill }));
      tr.seen[s.tick] = inView(v, g.x, g.y) || keys.has(`s${g.id}`);
    }
    sim.step(bot.input(sim));
  }
  const cueNear = (t: number, x: number, y: number) => (cues[t] ?? []).some((c) => Math.hypot(c.x - x, c.y - y) <= 48);
  for (const [id, tr] of proj) {
    if (!tr.offAtBirth || tr.hitAt < 0) continue;
    checked++;
    for (let t = tr.hitAt - FAIR_TICKS; t < tr.hitAt; t++) {
      const ok = t >= tr.born ? tr.seen[t] : cueNear(t, tr.sx, tr.sy);
      if (!ok) {
        fails.push(`seed ${seed} wave ${startWave}: projectile ${id} born ${tr.born} hit-able ${tr.hitAt}, unmarked at ${t}`);
        break;
      }
    }
  }
  for (const [id, tr] of sig) {
    if (!tr.offAtBirth) continue;
    checked++;
    let run = 0;
    for (let t = tr.born; t < tr.fill; t++) run = tr.seen[t] ? run + 1 : 0;
    if (run < FAIR_TICKS) fails.push(`seed ${seed} wave ${startWave}: sigil ${id} marked only ${run} ticks before its fill`);
  }
  return { fails, checked, score: sim.score, ticks: sim.state.tick };
}

describe('phone portrait: fairness edge markers', () => {
  for (const phone of PHONES)
    it(`${phone[0]}: every threat first appearing off-view is marked >= 15 ticks before it can hit`, { timeout: 60_000 }, () => {
      let checked = 0;
      const fails: string[] = [];
      for (const seed of [1, 7, 42, 1234, 99991]) {
        for (const w of [1, 4, 6, 8, 12]) {
          const r = audit(seed, w, seed % 2 === 0, 3600, phone);
          checked += r.checked;
          fails.push(...r.fails);
        }
      }
      expect(fails).toEqual([]);
      expect(checked).toBeGreaterThan(50); // the audit really saw off-view threats
    });

  it('every off-view telegraph is marked for its whole telegraph time', () => {
    const sim = new Sim(5, 'hard', { startWave: 6 });
    const bot = new SkilledBot(5);
    const cam = makeCam();
    cam.reset(sim.state.hero.x, sim.state.hero.y);
    let seen = 0;
    while (sim.state.alive && sim.state.tick < 3600) {
      const s = sim.state;
      cam.step(1000 / 60, s.hero.x, s.hero.y, null, false);
      const v = cam.rect();
      const keys = new Set(edgeMarkers(s, sim.params, v, PORTRAIT.horizonTicks).map((m) => m.key));
      for (const tg of s.telegraphs) if (s.tick >= tg.start && s.tick <= tg.fire && !inView(v, tg.x, tg.y)) (seen++, expect(keys.has(`t${tg.id}`)).toBe(true));
      for (const c of s.casters) if (s.tick >= c.start && s.tick <= c.fire && !inView(v, c.x, c.y)) (seen++, expect(keys.has(`c${c.id}`)).toBe(true));
      for (const g of s.sigils) if (s.tick >= g.start && s.tick < g.end && !inView(v, g.x, g.y)) (seen++, expect(keys.has(`s${g.id}`)).toBe(true));
      sim.step(bot.input(sim));
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('markers stay on the window edge and use the threat colours', () => {
    const sim = new Sim(3, 'hard', { startWave: 6 });
    const bot = new SkilledBot(3);
    const cam = makeCam();
    cam.reset(sim.state.hero.x, sim.state.hero.y);
    let n = 0;
    while (sim.state.alive && sim.state.tick < 1800) {
      const s = sim.state;
      cam.step(1000 / 60, s.hero.x, s.hero.y, null, false);
      const v = cam.rect();
      for (const m of edgeMarkers(s, sim.params, v, PORTRAIT.horizonTicks)) {
        n++;
        expect(inView(v, m.x, m.y)).toBe(true);
        expect(inView(v, m.sx, m.sy)).toBe(false);
        const pr = m.key.startsWith('p') ? s.projectiles.find((q) => `p${q.id}` === m.key) : null;
        if (pr) expect(m.color).toBe(pr.parryable ? 'violet' : 'red');
      }
      sim.step(bot.input(sim));
    }
    expect(n).toBeGreaterThan(0);
  });

  it('the camera is render-only: the same inputs give the same sim with or without it', () => {
    const run = (withCam: boolean) => {
      const sim = new Sim(77, 'hard', { startWave: 3 });
      const bot = new SkilledBot(77);
      const cam = makeCam();
      while (sim.state.alive && sim.state.tick < 1200) {
        if (withCam) {
          cam.step(16.7, sim.state.hero.x, sim.state.hero.y, { x: 1, y: 0 }, false);
          edgeMarkers(sim.state, sim.params, cam.rect(), PORTRAIT.horizonTicks);
        }
        sim.step(bot.input(sim));
      }
      return JSON.stringify({ log: sim.log, score: sim.score, tick: sim.state.tick });
    };
    expect(run(true)).toBe(run(false));
  });

  it('the camera keeps the hero inside the window and respects the world bounds (every phone)', () => {
    for (const phone of PHONES) {
    const cam = makeCam(phone);
    cam.reset(240, 135);
    for (let i = 0; i < 300; i++) {
      const hx = 48 + ((i * 7) % 384);
      cam.step(16.7, hx, 135, { x: 1, y: 0 }, false);
      const v = cam.rect();
      expect(v.x0).toBeGreaterThanOrEqual(0);
      expect(v.x1).toBeLessThanOrEqual(480);
      expect(hx).toBeGreaterThanOrEqual(v.x0 + 20);
      expect(hx).toBeLessThanOrEqual(v.x1 - 20);
      expect(v.y0).toBeGreaterThanOrEqual(0);
      expect(v.y1).toBeLessThanOrEqual(270);
    }
    }
  });
});
