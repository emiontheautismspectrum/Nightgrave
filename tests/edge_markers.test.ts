/**
 * Phone portrait fairness: with the zoomed camera following a human-like bot, every projectile or hazard whose first
 * appearance is outside the view must have had an edge marker (or be on screen) for >= 15 ticks before it could hit.
 * Also: the camera is render-only (the sim result is identical with and without it).
 */
import { describe, expect, it } from 'vitest';
import { Sim, type SimOptions } from '../src/sim/sim';
import { FollowCam, type ViewRect } from '../src/render/camera';
import { edgeMarkers } from '../src/render/edgeMarkers';
import { PORTRAIT } from '../src/data/view';
import { portraitLayout } from '../src/render/portraitLayout';
import { portraitGameSize } from '../src/web/screen';
import { SkilledBot } from './skilled';
import type { Features } from '../src/data/features';
import { PACK_KEYS } from '../src/data/features';
import { onlyPiece, PACK } from './pack_tools';
import { COMBOS } from './hunt_tools';
import { withFeatures } from '../src/data/features';
import { huntSprites } from '../src/render/huntsView';

const FAIR_TICKS = 15;
/** A briar line's gap is marked (or in view) at least this long before the line reaches the hero. */
const GAP_TICKS = 45;
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

function audit(seed: number, startWave: number, reduced: boolean, maxTicks = 3600, phone = PHONES[0]!, features?: Features, extra: SimOptions = {}) {
  const sim = new Sim(seed, 'hard', { startWave, ...(features ? { features } : {}), ...extra });
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
  /** Off-view threats of the pattern pack that were audited, per set piece. */
  const pack: Record<string, number> = {};
  const packOf = new Map<number, string>();
  /** The hunts (FEATURES.knot / briar): knots off-view at creation, lines and gaps audited before arrival. */
  const hunts = { knots: 0, lines: 0, gaps: 0 };
  const knotOff = new Map<number, boolean>();
  const lineSeen = new Map<number, { start: number; seen: boolean[]; gap: boolean[]; arrive: number }>();
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
      if (pr.pack) packOf.set(pr.id, pr.pack);
      const gap = Math.hypot(pr.x - h.x, pr.y - h.y) - pr.radius - sim.params.heroRadius;
      if (tr.hitAt < 0 && gap <= CONTACT_GAP) tr.hitAt = s.tick;
    }
    for (const k of s.knots ?? []) {
      if (!knotOff.has(k.id)) knotOff.set(k.id, !inView(v, k.x, k.y));
      if (inView(v, k.x, k.y)) tickCues.push(k);
      // a knot off-view when it appeared is marked (or in view) for its whole fuse
      if (knotOff.get(k.id) && !inView(v, k.x, k.y) && !keys.has(`k${k.id}`)) fails.push(`seed ${seed} wave ${startWave}: knot ${k.id} unmarked at ${s.tick}`);
    }
    for (const w of s.walls ?? []) {
      let tr = lineSeen.get(w.id);
      if (!tr) lineSeen.set(w.id, (tr = { start: s.tick, seen: [], gap: [], arrive: -1 }));
      const across = Math.min(w.axis === 'x' ? sim.params.y1 : sim.params.x1, Math.max(w.axis === 'x' ? sim.params.y0 : sim.params.x0, w.axis === 'x' ? h.y : h.x));
      const [nx, ny] = w.axis === 'x' ? [w.pos, across] : [across, w.pos];
      const [gx, gy] = w.axis === 'x' ? [w.pos, w.gap] : [w.gap, w.pos];
      tr.seen[s.tick] = inView(v, nx, ny) || keys.has(`w${w.id}`);
      tr.gap[s.tick] = inView(v, gx, gy) || keys.has(`g${w.id}`);
      const gapPx = Math.abs((w.axis === 'x' ? h.x : h.y) - w.pos) - w.halfWidth - sim.params.heroRadius;
      if (tr.arrive < 0 && gapPx <= CONTACT_GAP) tr.arrive = s.tick;
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
    const piece = packOf.get(id);
    if (piece) pack[piece] = (pack[piece] ?? 0) + 1;
    for (let t = tr.hitAt - FAIR_TICKS; t < tr.hitAt; t++) {
      const ok = t >= tr.born ? tr.seen[t] : cueNear(t, tr.sx, tr.sy);
      if (!ok) {
        fails.push(`seed ${seed} wave ${startWave}: projectile ${id} born ${tr.born} hit-able ${tr.hitAt}, unmarked at ${t}`);
        break;
      }
    }
  }
  for (const off of knotOff.values()) if (off) hunts.knots++;
  for (const [id, tr] of lineSeen) {
    if (tr.arrive < 0) continue; // never came close (the run ended first)
    hunts.lines++;
    // the line: marked or in view from its first tick to its arrival; its gap: >= 45 ticks before the arrival
    for (let t = tr.start; t < tr.arrive; t++)
      if (!tr.seen[t]) {
        fails.push(`seed ${seed} wave ${startWave}: briar ${id} unmarked at ${t} (arrives ${tr.arrive})`);
        break;
      }
    if (tr.arrive - tr.start < GAP_TICKS) fails.push(`seed ${seed} wave ${startWave}: briar ${id} arrived ${tr.arrive - tr.start} ticks after it appeared`);
    let run = 0;
    for (let t = tr.start; t < tr.arrive; t++) run = tr.gap[t] ? run + 1 : 0;
    if (run < GAP_TICKS) fails.push(`seed ${seed} wave ${startWave}: briar ${id} gap marked only ${run} ticks before the line arrived`);
    else hunts.gaps++;
  }
  for (const [id, tr] of sig) {
    if (!tr.offAtBirth || tr.fill > sim.state.tick) continue; // (a run that ended before the fill never met it)
    checked++;
    let run = 0;
    for (let t = tr.born; t < tr.fill; t++) run = tr.seen[t] ? run + 1 : 0;
    if (run < FAIR_TICKS) fails.push(`seed ${seed} wave ${startWave}: sigil ${id} marked only ${run} ticks before its fill`);
  }
  return { fails, checked, pack, hunts, score: sim.score, ticks: sim.state.tick };
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

describe('phone portrait: the pattern pack (FEATURES.patternPack, enabled variant)', () => {
  const WAVES = [1, 2, 4, 5, 6, 8, 9, 12, 14];
  for (const phone of PHONES)
    it(`${phone[0]}: every pack threat first appearing off-view is marked >= 15 ticks before it can hit`, { timeout: 120_000 }, () => {
      let checked = 0;
      const pack: Record<string, number> = {};
      const fails: string[] = [];
      for (const seed of [1, 7, 42, 1234, 99991, 31337]) {
        for (const w of WAVES) {
          const r = audit(seed, w, seed % 2 === 0, 3600, phone, PACK);
          checked += r.checked;
          for (const [k, n] of Object.entries(r.pack)) pack[k] = (pack[k] ?? 0) + n;
          fails.push(...r.fails);
        }
      }
      expect(fails).toEqual([]);
      expect(checked).toBeGreaterThan(100);
      if (phone === PHONES[0]) console.log(`edge markers, pack threats audited off-view (${phone[0]}): ${JSON.stringify(pack)}`);
      // the audit really saw off-view threats of the pack: edge pieces, rune pieces and caster pieces
      const total = Object.values(pack).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(50);
      for (const k of ['pincer', 'curtain', 'echoFan', 'heavyLine']) expect(pack[k] ?? 0, k).toBeGreaterThan(0);
    });

  it('piece by piece: the off-view threats of every set piece are audited (a pool with that one pack piece)', { timeout: 180_000 }, () => {
    const pack: Record<string, number> = {};
    const fails: string[] = [];
    for (const key of PACK_KEYS)
      for (const seed of [3, 17, 404, 5150, 2718, 90210]) {
        // the piece weighs as much as half the existing pool, from a wave where the run still lasts a while
        const r = audit(seed, Math.max(6, PACK.patternPack[key].unlockWave), false, 3600, PHONES[seed % PHONES.length]!, onlyPiece(key, 9));
        pack[key] = (pack[key] ?? 0) + (r.pack[key] ?? 0);
        fails.push(...r.fails);
      }
    expect(fails).toEqual([]);
    console.log(`edge markers, off-view pack threats audited piece by piece: ${JSON.stringify(pack)}`);
    // rune pieces start at the runes around the centre, where the hero plays: they are rarely off-view at birth
    // (their glow is covered by the next test); every edge and caster piece must have been audited
    for (const k of ['pincer', 'curtain', 'echoFan', 'crossfire', 'heavyLine', 'slowThenFast', 'stalkerPair']) expect(pack[k] ?? 0, k).toBeGreaterThan(0);
  });

  it('every off-view rune and caster of a pack piece is marked from its first cue to its last emission', { timeout: 60_000 }, () => {
    let runes = 0;
    let casters = 0;
    for (const seed of [5, 11, 23]) for (const w of [2, 8, 13]) {
      const sim = new Sim(seed, 'hard', { startWave: w, features: PACK });
      const bot = new SkilledBot(seed);
      const cam = makeCam();
      cam.reset(sim.state.hero.x, sim.state.hero.y);
      // rune pieces light their rune until the last emission; pack casters hold the wind-up for the whole burst
      const runeOf = new Map<number, number>();
      while (sim.state.alive && sim.state.tick < 3600) {
        const s = sim.state;
        cam.step(1000 / 60, s.hero.x, s.hero.y, null, false);
        const v = cam.rect();
        const keys = new Set(edgeMarkers(s, sim.params, v, PORTRAIT.horizonTicks).map((m) => m.key));
        for (const tg of s.telegraphs) if (tg.shards === 0) runeOf.set(tg.id, tg.fire);
        for (const tg of s.telegraphs) if (tg.shards === 0 && !inView(v, tg.x, tg.y)) (runes++, expect(keys.has(`t${tg.id}`)).toBe(true));
        for (const c of s.casters) if (c.pack && s.tick <= c.fire && !inView(v, c.x, c.y)) (casters++, expect(keys.has(`c${c.id}`)).toBe(true));
        // a queued rune emission is never later than the glow of its rune
        // a queued rune emission always has its rune lit (re-lit glow by glow) until it leaves
        for (const e of s.packQueue ?? []) if ((e.op === 'shot' || e.op === 'ring') && e.tele >= 0) expect(s.telegraphs.some((tg) => tg.shards === 0 && Math.hypot(tg.x - e.x, tg.y - e.y) < 5 && tg.fire >= Math.min(e.at, tg.fire))).toBe(true);
        // and it leaves on a full glow: a ring exactly when a glow of its rune ends
        for (const e of s.packQueue ?? []) if (e.op === 'ring' && e.at > s.tick) expect(s.telegraphs.some((tg) => tg.x === e.x && tg.y === e.y && tg.fire <= e.at) || (s.packQueue ?? []).some((g) => g.op === 'glow' && g.fire === e.at)).toBe(true);
        sim.step(bot.input(sim));
      }
    }
    expect(runes).toBeGreaterThan(0);
    expect(casters).toBeGreaterThan(0);
  });
});

describe('phone portrait: the hunts (FEATURES.knot / briar, every enabled combination)', () => {
  for (const combo of COMBOS)
    it(`${combo.join(' + ')}: off-view knots are marked for their whole fuse, lines until they arrive, gaps >= 45 ticks before`, { timeout: 120_000 }, () => {
      const base = withFeatures(...combo);
      // the hunt rows weigh three times as much here, so the audit sees many of them
      const f = { ...base, knot: { ...base.knot, weight: base.knot.weight * 3 }, briar: { ...base.briar, weight: base.briar.weight * 3 } };
      const fails: string[] = [];
      const tot = { knots: 0, lines: 0, gaps: 0 };
      let checked = 0;
      const seeds = [1, 7, 42, 1234, 99991, 31337];
      seeds.forEach((seed, i) => {
        for (const w of [4, 5, 6, 8, 9, 12]) {
          const r = audit(seed, w, i % 2 === 0, 3600, PHONES[i % PHONES.length]!, f);
          fails.push(...r.fails);
          checked += r.checked;
          tot.knots += r.hunts.knots;
          tot.lines += r.hunts.lines;
          tot.gaps += r.hunts.gaps;
        }
      });
      expect(fails).toEqual([]);
      console.log(`edge markers, ${combo.join('+')}: ${JSON.stringify(tot)}, ${checked} off-view threats`);
      if (combo.includes('knot')) expect(tot.knots).toBeGreaterThan(5);
      if (combo.includes('briar')) expect(tot.lines).toBeGreaterThan(5);
      expect(tot.gaps).toBe(tot.lines);
    });

  it('the full view (desktop, landscape): every line shows its gap markers on both edges from its first tick', () => {
    const kb = withFeatures('knot', 'briar');
    const sim = new Sim(21, 'hard', { hero: 'wisp', features: { ...kb, briar: { ...kb.briar, weight: 4 } }, startWave: 4 });
    const bot = new SkilledBot(21);
    const first = new Map<number, number>();
    let lines = 0;
    while (sim.state.tick < 60 * 90) {
      const s = sim.state;
      const list = huntSprites(s, sim.params);
      for (const w of s.walls ?? []) {
        if (!first.has(w.id)) (first.set(w.id, s.tick), lines++);
        expect(list.filter((e) => e.name === 'edge_gap' && e.key.startsWith(`wg${w.id}:`))).toHaveLength(2);
      }
      s.alive = true;
      sim.step(bot.input(sim));
    }
    expect(lines).toBeGreaterThan(2);
  });
});

describe('phone portrait: the new bosses (FEATURES.bosses)', () => {
  for (const kind of ['thorn', 'toller'] as const)
    it(`${kind}: every off-view boss threat (bloom spots, rings, blades, root walls and gaps) is marked >= 15 ticks before it can hit`, { timeout: 120_000 }, () => {
      const f = withFeatures('bosses');
      const fails: string[] = [];
      let checked = 0;
      let lines = 0;
      [1, 7, 42, 1234, 99991, 31337, 5, 11, 77, 404, 2024, 8080].forEach((seed, i) => {
        const r = audit(seed, 3, i % 2 === 0, 60 * 40, PHONES[i % PHONES.length]!, f, { firstBoss: kind });
        fails.push(...r.fails);
        checked += r.checked;
        lines += r.hunts.lines;
      });
      expect(fails).toEqual([]);
      console.log(`edge markers, ${kind}: ${checked} off-view threats, ${lines} root walls`);
      // the Toller stands in view at the top more often (its rings start at the bell): fewer off-view births
      expect(checked).toBeGreaterThan(kind === 'thorn' ? 20 : 4);
      if (kind === 'thorn') expect(lines).toBeGreaterThan(0);
    });
});
