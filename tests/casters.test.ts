import { describe, expect, it } from 'vitest';
import { HOLLOWS, PORTAL } from '../src/data/arena';
import type { Difficulty } from '../src/data/tuning';
import { NEUTRAL_INPUT, type InputFrame } from '../src/sim/input';
import { encodeReplay, playReplay } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import type { Caster, SimEvent } from '../src/sim/state';
import { botInput } from './bot';

const idle = (): InputFrame => ({ ...NEUTRAL_INPUT });

/** Run a sim, recording every caster ever seen and all events. */
function observe(seed: number, d: Difficulty, ticks: number, startWave = 2, player: (s: Sim) => InputFrame = botInput) {
  const sim = new Sim(seed, d, { startWave });
  const casters = new Map<number, Caster>();
  const events: { t: number; e: SimEvent }[] = [];
  let maxActive = 0;
  for (let t = 0; t < ticks && sim.state.alive; t++) {
    sim.step(player(sim));
    for (const c of sim.state.casters) casters.set(c.id, { ...c });
    maxActive = Math.max(maxActive, sim.state.casters.length);
    for (const e of sim.state.events) events.push({ t: sim.state.tick - 1, e });
  }
  return { sim, casters: [...casters.values()], events, maxActive };
}

describe('casters', () => {
  const runs = [1, 2, 3, 4, 5, 6].map((seed) => observe(seed * 101, 'hard', 60 * 90));
  const all = runs.flatMap((r) => r.casters);

  it('both kinds appear (shade at the portal, stalkers at hollows)', () => {
    expect(all.some((c) => c.kind === 'shade')).toBe(true);
    expect(all.some((c) => c.kind === 'stalker')).toBe(true);
    for (const c of all) {
      if (c.kind === 'shade') expect([c.x, c.y, c.source]).toEqual([PORTAL.x, PORTAL.y, -1]);
      else expect(c.source).toBeGreaterThanOrEqual(0), expect(c.source).toBeLessThan(HOLLOWS.length);
    }
  });

  it('phase timing: telegraph, rise, idle 60-180 ticks (seeded), wind-up >= 15, dissolve ~0.4 s', () => {
    const p = runs[0]!.sim.params;
    const idles = new Set<number>();
    for (const c of all) {
      expect(c.appear0 - c.start).toBe(p.casterTele);
      expect(c.appear - c.appear0).toBe(p.casterRise);
      const idleT = c.castStart - c.appear;
      expect(idleT).toBeGreaterThanOrEqual(60);
      expect(idleT).toBeLessThanOrEqual(180);
      idles.add(idleT);
      expect(c.fire - c.castStart).toBeGreaterThanOrEqual(15);
      expect(c.end - c.fire).toBe(24);
    }
    expect(idles.size).toBeGreaterThan(3); // really random, not a constant
  });

  it('a caster never attacks on appearing: its first projectile comes >= 15 ticks after its first visual cue', () => {
    for (const r of runs) {
      const byId = new Map(r.casters.map((c) => [c.id, c]));
      for (const { t, e } of r.events) {
        if (e.type !== 'caster_fire') continue;
        const c = byId.get(e.id)!;
        expect(t).toBe(c.fire);
        expect(t - c.start).toBeGreaterThanOrEqual(15);
        expect(t).toBeGreaterThan(c.appear); // not on appearing
      }
    }
  });

  it('respects the cap on simultaneous casters and never doubles up a source', () => {
    for (const r of runs) expect(r.maxActive).toBeLessThanOrEqual(r.sim.params.casterMax);
    const sim = new Sim(9, 'hard', { startWave: 4 });
    for (let t = 0; t < 60 * 60; t++) {
      sim.step(idle());
      if (!sim.state.alive) break;
      const src = sim.state.casters.map((c) => c.source);
      expect(new Set(src).size).toBe(src.length);
    }
  });

  it('caster spawns obey the fairness rule like everything else', () => {
    for (const r of runs) {
      const p = r.sim.params;
      for (const { e } of r.events) {
        if (e.type === 'spawn') expect(e.dist >= p.fairDistance || e.telegraphTicks >= p.fairTelegraph).toBe(true);
      }
    }
  });

  it('a hero standing ON a caster is never shot point-blank (the cast fizzles instead)', () => {
    let fizzles = 0;
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const sim = new Sim(seed * 13, 'hard', { startWave: 3, bosses: false });
      for (let t = 0; t < 60 * 40 && sim.state.alive; t++) {
        // walk onto the newest caster (portal or a stalker spot) and stand there
        const c = sim.state.casters[sim.state.casters.length - 1];
        sim.step(c ? { cursor: true, mx: Math.round(c.x), my: Math.round(c.y), buttons: 0 } : idle());
        for (const e of sim.state.events) {
          if (e.type === 'caster_fizzle') fizzles++;
          if (e.type !== 'caster_fire') continue;
          checked++;
          const shooter = sim.state.casters.find((k) => k.id === e.id)!;
          const d = Math.hypot(shooter.x - sim.state.hero.x, shooter.y - sim.state.hero.y);
          expect(d).toBeGreaterThanOrEqual(16);
          expect(sim.state.alive).toBe(true); // nothing kills on the very tick it is fired
        }
      }
    }
    expect(fizzles).toBeGreaterThan(0); // the scenario really happened
    expect(checked).toBeGreaterThan(0);
  });

  for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`${d}: runs with casters replay exactly`, () => {
      const sim = new Sim(4242, d);
      let saw = 0;
      for (let t = 0; t < 60 * 120 && sim.state.alive; t++) {
        sim.step(botInput(sim));
        saw += sim.state.events.filter((e) => e.type === 'caster').length;
      }
      expect(saw).toBeGreaterThan(0);
      const replayed = playReplay(JSON.parse(JSON.stringify(encodeReplay(4242, d, sim.log))));
      const strip = (st: object) => JSON.stringify({ ...st, events: undefined });
      expect(strip(replayed.state)).toBe(strip(sim.state));
    });
  }
});
