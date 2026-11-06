import { describe, expect, it } from 'vitest';
import manifest from '../assets/atlas/manifest.json';
import { RUNES } from '../src/data/arena';
import type { Difficulty } from '../src/data/tuning';
import { dailySeed, utcDateKey } from '../src/daily';
import { BTN_PARRY, NEUTRAL_INPUT, type InputFrame } from '../src/sim/input';
import { encodeReplay, playReplay } from '../src/sim/replay';
import { isFading, Sim, spawnProjectile, type SimOptions } from '../src/sim/sim';
import type { ProjectileKind, SimEvent } from '../src/sim/state';
import { waveDensity, waveSpeed } from '../src/sim/waves';
import { botInput } from './bot';
import { mulberryInputs } from './scripted';

const idle = (): InputFrame => ({ ...NEUTRAL_INPUT });
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

/** Run with a player function, collecting every event. */
function collect(sim: Sim, player: (sim: Sim, t: number) => InputFrame, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < ticks && sim.state.alive; t++) {
    sim.step(player(sim, t));
    all.push(...sim.state.events);
  }
  return all;
}

describe('fairness: nothing appears near the hero without a >= 0.25 s telegraph', () => {
  const players: [string, (sim: Sim, t: number) => InputFrame][] = [
    ['bot', (sim) => botInput(sim)],
    // walks the rim through top, right, bottom, left (targets outside the circle are clamped onto it)
    ['rim hugger', (_s, t) => {
      const pts = [[240, 0], [480, 150], [240, 300], [0, 150]] as const;
      const [mx, my] = pts[Math.floor(t / 150) % 4]!;
      return { cursor: true, mx, my, buttons: 0 };
    }],
    // runs onto whichever rune is lit (or the nearest one) and stands on it
    ['rune camper', (sim, t) => {
      const lit = sim.state.telegraphs[0];
      const r = lit ? RUNES[lit.rune]! : RUNES[Math.floor(t / 240) % RUNES.length]!;
      return { cursor: true, mx: r.x, my: r.y, buttons: 0 };
    }],
    ['scripted', (() => { const f = mulberryInputs(9, 60 * 120); return (_s: Sim, t: number) => f[t] ?? idle(); })()],
  ];
  for (const d of DIFFS) {
    for (const [name, player] of players) {
      it(`${d} / ${name}`, () => {
        let spawns = 0;
        for (const startWave of [0, 3, 8]) {
          for (let seed = 1; seed <= 6; seed++) {
            const sim = new Sim(seed * 31 + startWave, d, { startWave, bosses: false });
            const p = sim.params;
            for (const e of collect(sim, player, 60 * 90)) {
              if (e.type !== 'spawn') continue;
              spawns++;
              const ok = e.dist >= p.fairDistance || e.telegraphTicks >= p.fairTelegraph;
              expect(ok, `${e.kind} spawned ${e.dist.toFixed(1)} px from hero, telegraph ${e.telegraphTicks}`).toBe(true);
            }
          }
        }
        expect(spawns).toBeGreaterThan(100);
      });
    }
  }
});

describe('determinism with every threat type', () => {
  for (const seed of [3, 1234, 99991]) {
    it(`seed ${seed}: two runs from wave 3 are identical and include every projectile kind`, () => {
      const run = () => {
        const sim = new Sim(seed, 'hard', { startWave: 3, bosses: false });
        const kinds = new Set<ProjectileKind>();
        const frames = mulberryInputs(seed, 60 * 150);
        // mostly the bot (so the run lives long enough to see every kind), with scripted noise mixed in
        // an immortal hero (test only): the harder Polish 2 rules would end the run before every kind appears
        for (let t = 0; t < 60 * 150; t++) {
          sim.state.alive = true;
          sim.step(t % 7 ? botInput(sim) : (frames[t] ?? idle()));
          for (const e of sim.state.events) if (e.type === 'spawn') kinds.add(e.kind);
        }
        return { sim, kinds };
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(b.sim.state)).toBe(JSON.stringify(a.sim.state));
      expect([...a.kinds].sort()).toEqual(['blade', 'orb_armored', 'orb_large', 'orb_small', 'orb_split', 'rune_shard', 'wraith']);
    });
  }

  for (const d of DIFFS) {
    it(`${d}: a long bot run replays exactly (encode -> JSON -> decode -> play)`, () => {
      const sim = new Sim(777, d);
      const kinds = new Set<ProjectileKind>();
      for (const e of collect(sim, (s) => botInput(s), 60 * 60 * 4)) if (e.type === 'spawn') kinds.add(e.kind);
      expect(kinds.size).toBeGreaterThanOrEqual(5); // a real (non test-option) run that reached blades and wraiths
      const replayed = playReplay(JSON.parse(JSON.stringify(encodeReplay(777, d, sim.log))));
      const strip = (st: object) => JSON.stringify({ ...st, events: undefined });
      expect(strip(replayed.state)).toBe(strip(sim.state));
      expect(replayed.score).toBe(sim.score);
    });
  }
});

describe('threats', () => {
  const quiet = (o: SimOptions = {}) => new Sim(1, 'medium', { spawner: false, ...o });

  it('blades are unparryable: a parry neither destroys them nor saves the hero', () => {
    const sim = quiet();
    const h = sim.state.hero;
    spawnProjectile(sim.state, sim.params, 'blade', h.x + 20, h.y, 0, 0);
    sim.step({ ...idle(), buttons: BTN_PARRY });
    expect(sim.state.projectiles).toHaveLength(1);
    expect(sim.state.parryCount).toBe(0);
    sim.state.projectiles[0]!.x = h.x;
    sim.step(idle());
    expect(sim.state.alive).toBe(false);
  });

  it('wraiths home in, are parryable, then fade harmlessly and disappear', () => {
    const sim = quiet();
    const p = sim.params;
    const s = sim.state;
    const w = spawnProjectile(s, p, 'wraith', s.hero.x + 60, s.hero.y, 0, p.wraithSpeed, {
      homing: p.wraithSteer,
      expires: p.wraithLife,
      fadeEnd: p.wraithLife + p.wraithFade,
    });
    const d0 = 60;
    for (let i = 0; i < 60; i++) sim.step(idle());
    expect(Math.hypot(w.x - s.hero.x, w.y - s.hero.y)).toBeLessThan(d0 - 10);
    // fast-forward: put it on the hero exactly when it starts fading -> harmless
    while (s.tick < p.wraithLife) {
      w.x = s.hero.x + 50;
      w.y = s.hero.y;
      sim.step(idle());
    }
    w.x = s.hero.x;
    w.y = s.hero.y;
    sim.step({ ...idle(), buttons: BTN_PARRY });
    expect(isFading(s, w)).toBe(true);
    expect(s.alive).toBe(true);
    expect(s.parryCount).toBe(0); // fading wraiths cannot be farmed for points
    while (s.tick < p.wraithLife + p.wraithFade + 1) sim.step(idle());
    expect(s.projectiles).toHaveLength(0);
  });

  it('a rune burst fires exactly runeTelegraph ticks after its telegraph, as a ring from the rune', () => {
    const sim = new Sim(5, 'medium');
    const p = sim.params;
    let tele: { tick: number; rune: number } | null = null;
    let ring: SimEvent[] = [];
    let ringTick = -1;
    for (let t = 0; t < 60 * 60 && ringTick < 0; t++) {
      // keep the hero far from the bottom runes and alive
      sim.state.projectiles = sim.state.projectiles.filter((x) => x.kind === 'rune_shard');
      sim.step({ cursor: true, mx: 240, my: 150, buttons: 0 });
      for (const e of sim.state.events) if (e.type === 'telegraph' && !tele) tele = { tick: t, rune: e.rune };
      const shards = sim.state.events.filter((e) => e.type === 'spawn' && e.kind === 'rune_shard');
      if (tele && shards.length) {
        ring = shards;
        ringTick = t;
      }
    }
    expect(tele).not.toBeNull();
    expect(ringTick - tele!.tick).toBe(p.runeTelegraph);
    expect(ring.length).toBe(p.patterns.runeBurst.shards + Math.floor(p.patterns.runeBurst.shardsPerWave * sim.state.wave));
    for (const e of ring) if (e.type === 'spawn') expect(e.telegraphTicks).toBe(p.runeTelegraph);
  });

  it('runes in the sim match the generated art', () => {
    expect(RUNES).toEqual(manifest.layout.runes);
  });
});

describe('waves', () => {
  it('a new wave every waveTicks; +5% speed and +6% density per wave, capped', () => {
    const sim = new Sim(1, 'medium', { spawner: true });
    const p = sim.params;
    const waves: number[] = [];
    for (let t = 0; t < p.graceTicks + p.waveTicks * 3 + 1; t++) {
      sim.state.projectiles = [];
      sim.state.telegraphs = [];
      sim.step(idle());
      for (const e of sim.state.events) if (e.type === 'wave') waves.push(t);
    }
    expect(waves).toEqual([0, 1, 2, 3].map((w) => p.graceTicks + w * p.waveTicks));
    expect(waveSpeed(p, 0)).toBe(1);
    expect(waveSpeed(p, 2)).toBeCloseTo(1.1, 12);
    expect(waveSpeed(p, 1000)).toBe(p.speedCap);
    expect(waveDensity(p, 1) / p.density).toBeCloseTo(1.06, 12);
    expect(waveDensity(p, 1000)).toBeCloseTo(p.densityCap * p.density, 12);
  });

  it('difficulty multipliers match CLAUDE.md', () => {
    const m = (d: Difficulty) => new Sim(1, d).params;
    const base = m('medium');
    // Polish 2 values (CLAUDE.md "Difficulty"): easy 0.65/0.5, medium 0.85/0.75, hard 1.1/1.2
    expect(m('easy').smallSpeed / base.smallSpeed).toBeCloseTo(0.65 / 0.85, 12);
    expect(m('hard').smallSpeed / base.smallSpeed).toBeCloseTo(1.1 / 0.85, 12);
    expect(m('easy').density).toBe(0.5);
    expect(base.density).toBe(0.75);
    expect(m('hard').density).toBe(1.2);
  });
});

describe('multi-kill scoring', () => {
  it('a pulse destroys at most parryMaxKills (nearest first): ONE parry, one multiplier step, reduced extra points', () => {
    const sim = new Sim(1, 'medium', { spawner: false });
    const p = sim.params;
    const h = sim.state.hero;
    for (let k = 0; k < 16; k++) spawnProjectile(sim.state, p, 'rune_shard', h.x + 3, h.y, 0, 0);
    sim.step({ ...idle(), buttons: BTN_PARRY });
    expect(sim.state.projectiles).toHaveLength(16 - p.parryMaxKills);
    expect(sim.state.parryCount).toBe(1);
    // one step for the pulse + the PERFECT extra (the shards touch the hero)
    expect(sim.state.multiplier).toBe(p.multStart + 2 * p.multStep);
    // extras in the same pulse score at the already-stepped multiplier
    expect(sim.state.parryScoreHundredths).toBe(p.parryBase * p.multStart + (p.parryMaxKills - 1) * p.extraKillPoints * (p.multStart + 2 * p.multStep));
  });

  it('a far parry scores and steps the multiplier once; a PERFECT one steps it twice', () => {
    const sim = new Sim(1, 'medium', { spawner: false });
    const p = sim.params;
    const h = sim.state.hero;
    sim.state.multiplier = 200;
    spawnProjectile(sim.state, p, 'orb_small', h.x + p.parryRadius, h.y, 0, 0); // far: the edge is outside the perfect zone
    sim.step({ ...idle(), buttons: BTN_PARRY });
    expect(sim.state.parryCount).toBe(1);
    expect(sim.state.multiplier).toBe(200 + p.multStep);
    expect(sim.state.parryScoreHundredths).toBe(p.parryBase * 200);
    for (let i = 0; i < p.parryCooldown + 1; i++) sim.step(idle());
    spawnProjectile(sim.state, p, 'orb_small', h.x + p.parryRadius * 0.4, h.y, 0, 0); // close: perfect
    sim.step({ ...idle(), buttons: BTN_PARRY });
    expect(sim.state.multiplier).toBe(200 + 3 * p.multStep);
  });
});

describe('parry whiff', () => {
  it('emits exactly one parry_whiff on the last active tick of a parry that hit nothing', () => {
    const sim = new Sim(1, 'medium', { spawner: false });
    const ev = collect(sim, (_s, t) => ({ ...idle(), buttons: t === 0 ? BTN_PARRY : 0 }), 30);
    expect(ev.filter((e) => e.type === 'parry_whiff')).toHaveLength(1);
  });
  it('no whiff when the parry destroyed something', () => {
    const sim = new Sim(1, 'medium', { spawner: false });
    spawnProjectile(sim.state, sim.params, 'orb_small', sim.state.hero.x + 5, sim.state.hero.y, 0, 0);
    const ev = collect(sim, (_s, t) => ({ ...idle(), buttons: t === 0 ? BTN_PARRY : 0 }), 30);
    expect(ev.filter((e) => e.type === 'parry_whiff')).toHaveLength(0);
  });
});

describe('daily seed (computed outside src/sim)', () => {
  it('same UTC date -> same seed, different dates differ, UTC not local time', () => {
    expect(utcDateKey(new Date('2026-11-04T23:59:59Z'))).toBe('2026-11-04');
    expect(utcDateKey(new Date('2026-11-05T00:00:00Z'))).toBe('2026-11-05');
    expect(utcDateKey(new Date('2026-11-04T23:30:00-05:00'))).toBe('2026-11-05');
    expect(dailySeed('2026-11-04')).toBe(dailySeed('2026-11-04'));
    expect(dailySeed('2026-11-04')).not.toBe(dailySeed('2026-11-05'));
    expect(Number.isInteger(dailySeed('2026-11-04'))).toBe(true);
  });
});
