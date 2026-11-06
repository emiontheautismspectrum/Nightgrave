/**
 * A deterministic "skilled bot" that plays like a good human (balance target, not a test of perfection):
 * - ~200 ms reaction: it only perceives projectiles that have existed for >= 12 ticks;
 * - small aim error: the cursor target jitters by a few px;
 * - parry timing error: it presses parry for an incoming violet threat at the ideal tick +-2 ticks (seeded);
 * - dodges red threats and dashes through them when they are about to hit; walks to pickups when it is quiet;
 * - an ARC hero (Knight) turns to the threat it is about to parry like a human would: for a few ticks around the
 *   press it puts the cursor a few px from the hero toward the threat (it walks a little toward it: the honest cost).
 * Movement and dashing reuse the heuristic bot (tests/bot.ts) restricted to what it perceives.
 */
import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { dashCooldownLeft, isFading, parryCooldownLeft, type Sim } from '../src/sim/sim';
import { botInput } from './bot';

export const REACTION_TICKS = 12;
/** Ticks before a planned parry press at which an arc hero starts turning to the threat. */
export const TURN_LEAD = 3;

export class SkilledBot {
  private rng: number;
  private parryAt = -1;
  /** The violet threat the planned parry is for (arc heroes turn to it). */
  private target = -1;
  private turnUntil = -1;
  private jitter = { x: 0, y: 0, until: 0 };
  /** parry = false: the same human-like player that never parries (the dodge-only comparison). */
  constructor(seed: number, private parry = true) {
    this.rng = (seed * 2654435761) >>> 0 || 1;
  }
  private rnd(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  input(sim: Sim): InputFrame {
    const s = sim.state;
    const p = sim.params;
    const h = s.hero;
    const t = s.tick;
    // perception: only threats seen for >= the reaction time
    const seen = s.projectiles.filter((pr) => t - pr.born >= REACTION_TICKS && !isFading(s, pr));
    const all = s.projectiles;
    s.projectiles = seen;
    let f: InputFrame;
    try {
      f = botInput(sim, { parry: false, beamDash: true });
    } finally {
      s.projectiles = all;
    }
    // aim error: a few px of jitter that changes every ~0.3 s
    if (t >= this.jitter.until) this.jitter = { x: (this.rnd() - 0.5) * 8, y: (this.rnd() - 0.5) * 8, until: t + 18 };
    if (f.cursor) f = { ...f, mx: Math.round(Math.max(0, Math.min(480, f.mx + this.jitter.x))), my: Math.round(Math.max(0, Math.min(270, f.my + this.jitter.y))) };

    // walk to a pickup when no perceived threat is close
    const near = seen.some((pr) => Math.hypot(pr.x - h.x, pr.y - h.y) < 70);
    const beam = s.beams.length > 0 || s.boss?.attack?.pattern === 'beam';
    if (s.pickup && !near && !beam && !(f.buttons & BTN_DASH)) f = { cursor: true, mx: Math.round(s.pickup.x), my: Math.round(s.pickup.y), buttons: f.buttons };

    // parry: find the first perceived violet threat that will actually reach the hero and when it gets "close"
    let buttons = f.buttons & ~BTN_PARRY;
    if (this.parry && this.parryAt < 0 && parryCooldownLeft(s, p) === 0) {
      let best = Infinity;
      for (const pr of seen) {
        if (!pr.parryable) continue;
        const rx = pr.x - h.x;
        const ry = pr.y - h.y;
        const v2 = pr.vx * pr.vx + pr.vy * pr.vy || 1e-9;
        const tc = -(rx * pr.vx + ry * pr.vy) / v2; // ticks to the closest approach
        if (tc < 0) continue;
        const cx = rx + pr.vx * tc;
        const cy = ry + pr.vy * tc;
        if (Math.hypot(cx, cy) > p.heroRadius + pr.radius + 4) continue; // it would miss anyway
        // the tick at which it is inside ~half the parry radius
        const d = Math.hypot(rx, ry);
        const want = Math.max(0, (d - p.parryRadius * 0.5) / Math.sqrt(v2));
        if (want < best) {
          best = want;
          this.target = pr.id;
        }
      }
      // a perceived violet threat already deep inside the pulse and still closing in: parry now (+-2 ticks)
      for (const pr of seen) {
        if (!pr.parryable) continue;
        const rx = pr.x - h.x;
        const ry = pr.y - h.y;
        if (Math.hypot(rx, ry) < p.parryRadius * 0.6 + pr.radius && rx * pr.vx + ry * pr.vy < 0 && best > 0) {
          best = 0;
          this.target = pr.id;
        }
      }
      if (best < 40) this.parryAt = t + Math.max(0, Math.round(best)) + Math.round((this.rnd() - 0.5) * 4.999);
    }
    if (this.parryAt >= 0 && t >= this.parryAt) {
      buttons |= BTN_PARRY;
      this.parryAt = -1;
      this.turnUntil = t + p.parryActive;
    }
    // an arc hero faces the threat from TURN_LEAD ticks before the press until the end of the pulse (or the threat's end)
    const turning = (this.parryAt >= 0 && this.parryAt - t <= TURN_LEAD) || t < this.turnUntil;
    const tgt = turning && !p.parryFull ? s.projectiles.find((pr) => pr.id === this.target) : undefined;
    if (tgt && !(buttons & BTN_DASH)) {
      const rx = tgt.x - h.x;
      const ry = tgt.y - h.y;
      const d = Math.hypot(rx, ry) || 1;
      const k = p.aimDeadzone + p.heroSpeed + 1; // after this tick's step the cursor is still beyond the dead zone
      f = { cursor: true, mx: Math.round(h.x + (rx / d) * k), my: Math.round(h.y + (ry / d) * k), buttons };
    }
    if ((f.buttons & BTN_DASH) && dashCooldownLeft(s, p) > 0) buttons &= ~BTN_DASH;
    return { ...f, buttons };
  }
}
