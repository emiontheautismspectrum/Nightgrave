/**
 * A heuristic test player. It only READS sim state and produces inputs, like a human would.
 * Not part of the game; used for balance reports (scripts/botsim.ts) and tests.
 */
import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { dashCooldownLeft, isFading, parryCooldownLeft, type Sim } from '../src/sim/sim';

export function botInput(sim: Sim): InputFrame {
  const s = sim.state;
  const p = sim.params;
  const h = s.hero;
  let buttons = 0;
  let fx = 0;
  let fy = 0;
  let dashAway: [number, number] | null = null;
  let parryTarget = false;
  for (const pr of s.projectiles) {
    if (isFading(s, pr)) continue;
    const rx = pr.x - h.x;
    const ry = pr.y - h.y;
    const d = Math.sqrt(rx * rx + ry * ry);
    if (pr.parryable && d <= p.parryRadius + pr.radius - 3) parryTarget = true;
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
      if (!pr.parryable && t < 10) {
        const vl = Math.sqrt(v2);
        dashAway = [-pr.vy / vl, pr.vx / vl];
        if (dashAway[0] * -cx + dashAway[1] * -cy < 0) dashAway = [-dashAway[0], -dashAway[1]];
      }
    }
  }
  if (parryTarget && parryCooldownLeft(s, p) === 0) buttons |= BTN_PARRY;
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
