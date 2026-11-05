/**
 * A heuristic test player. It only READS sim state and produces inputs, like a human would.
 * Not part of the game; used for balance reports (scripts/botsim.ts) and tests.
 */
import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { dashCooldownLeft, isFading, parryCooldownLeft, type Sim } from '../src/sim/sim';

export interface BotOptions {
  /** false = dodge-only bot (never presses parry). Default true. */
  parry?: boolean;
}

/** Eye beam threat (wind-up or active): start line, rotation sign. The side behind the start line is never swept. */
function beamThreat(sim: Sim): { x: number; y: number; dx: number; dy: number; sign: number } | null {
  const s = sim.state;
  const b = s.boss;
  if (b?.attack?.pattern === 'beam' && s.tick >= b.attack.windStart)
    return { x: b.x, y: b.y, dx: b.attack.dirX, dy: b.attack.dirY, sign: b.attack.sign };
  const bm = s.beams[0];
  if (bm) return { x: bm.x, y: bm.y, dx: bm.dirX, dy: bm.dirY, sign: bm.turnS >= 0 ? 1 : -1 };
  return null;
}

export function botInput(sim: Sim, opts: BotOptions = {}): InputFrame {
  const s = sim.state;
  const p = sim.params;
  const h = s.hero;
  let buttons = 0;
  let fx = 0;
  let fy = 0;
  let dashAway: [number, number] | null = null;
  let nearT = Infinity;
  let nearPerp: [number, number] = [0, 0];
  let parryTarget = false;
  for (const pr of s.projectiles) {
    if (isFading(s, pr)) continue;
    const rx = pr.x - h.x;
    const ry = pr.y - h.y;
    const d = Math.sqrt(rx * rx + ry * ry);
    if (pr.parryable && d <= p.parryRadius + pr.radius - 3) parryTarget = true;
    // homing threats (wraiths): keep running away from them; the straight-line prediction below cannot see them coming
    if (pr.homing > 0 && d < 56) {
      fx -= (rx / (d || 1)) * (2 / (d / 10 + 1));
      fy -= (ry / (d || 1)) * (2 / (d / 10 + 1));
    }
    // closest approach assuming the hero stands still
    const v2 = pr.vx * pr.vx + pr.vy * pr.vy || 1e-9;
    const t = Math.max(0, -(rx * pr.vx + ry * pr.vy) / v2);
    const cx = rx + pr.vx * t;
    const cy = ry + pr.vy * t;
    const miss = Math.sqrt(cx * cx + cy * cy);
    const danger = p.heroRadius + pr.radius + 6;
    if (miss < danger && t < 45) {
      // step sideways away from the closest-approach point
      let ax = -cx;
      let ay = -cy;
      if (miss < 0.5) [ax, ay] = [-pr.vy, pr.vx];
      const al = Math.sqrt(ax * ax + ay * ay) || 1;
      const w = (pr.parryable ? 1 : 2.5) / (t + 4);
      fx += (ax / al) * w;
      fy += (ay / al) * w;
      if (t < nearT) {
        nearT = t;
        nearPerp = [-pr.vy, pr.vx];
      }
      if (!pr.parryable && t < 10) {
        const vl = Math.sqrt(v2);
        dashAway = [-pr.vy / vl, pr.vx / vl];
        if (dashAway[0] * -cx + dashAway[1] * -cy < 0) dashAway = [-dashAway[0], -dashAway[1]];
      }
    }
  }
  if (parryTarget && opts.parry !== false && parryCooldownLeft(s, p) === 0) buttons |= BTN_PARRY;
  // beam: get behind its start line (opposite to the rotation) and stay there until it is over
  const bt = beamThreat(sim);
  if (bt) {
    const nx = bt.dy * bt.sign; // unit normal pointing to the side the beam rotates away from
    const ny = -bt.dx * bt.sign;
    const c = (h.x - bt.x) * nx + (h.y - bt.y) * ny;
    if (c < 14) {
      fx += nx * 3;
      fy += ny * 3;
    }
  }
  // converging shots can cancel each other's sidestep: break the tie by stepping across the most urgent one
  if (nearT < 45 && Math.abs(fx) + Math.abs(fy) < 0.05) {
    const l = Math.sqrt(nearPerp[0] * nearPerp[0] + nearPerp[1] * nearPerp[1]) || 1;
    fx += (nearPerp[0] / l) * 0.2;
    fy += (nearPerp[1] / l) * 0.2;
  }
  // gentle pull towards the centre so the bot does not hug the rim
  fx += (p.cx - h.x) * 0.002;
  fy += (p.cy - h.y) * 0.002;
  let tx = h.x + fx * 400;
  let ty = h.y + fy * 400;
  if (dashAway && dashCooldownLeft(s, p) === 0) {
    buttons |= BTN_DASH;
    tx = h.x + dashAway[0] * 40;
    ty = h.y + dashAway[1] * 40;
  }
  return { cursor: true, mx: Math.round(tx), my: Math.round(ty), buttons };
}

/** Ticks survived by the bot (capped). */
export function runBot(sim: Sim, capTicks: number): number {
  while (sim.state.alive && sim.state.tick < capTicks) sim.step(botInput(sim));
  return sim.state.survivalTicks;
}

export const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] ?? 0) : ((a[m - 1] ?? 0) + (a[m] ?? 0)) / 2;
};
