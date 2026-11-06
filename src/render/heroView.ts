/**
 * Hero mechanics, drawn (render-only, reads sim state): the parry zone outline (the Knight's shield arc around its aim,
 * the Wisp's ring), the faint aim indicator, the guard pips and the Wisp's ember trail. The zone outline is SAMPLED
 * from the sim's own zone function (inParryZone), so the drawing can never disagree with what the parry hits.
 */
import type Phaser from 'phaser';
import type { SimParams } from '../sim/params';
import { inParryZone } from '../sim/parryZone';
import type { SimState, TrailSegment } from '../sim/state';

/** The zone's outer edge as polylines (one closed loop for a full ring, one open arc otherwise). */
export function zoneOutline(hx: number, hy: number, aimX: number, aimY: number, p: SimParams, steps = 48): [number, number][][] {
  const R = p.parryRadius - 0.01;
  const inside: boolean[] = [];
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = hx + Math.cos(a) * R;
    const y = hy + Math.sin(a) * R;
    pts.push([x, y]);
    inside.push(inParryZone(hx, hy, aimX, aimY, x, y, 0, p) >= 0);
  }
  if (inside.every(Boolean)) return [[...pts, pts[0]!]];
  // rotate so the walk starts on an outside sample, then collect the runs of inside samples
  const start = inside.indexOf(false);
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let k = 1; k <= steps; k++) {
    const i = (start + k) % steps;
    if (inside[i]) cur.push(pts[i]!);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Ember dots along the live trail: deterministic positions, alpha falls with the remaining time (flicker optional). */
export function trailEmbers(trail: readonly TrailSegment[], tick: number, lifeTicks: number, flicker: boolean): { x: number; y: number; a: number }[] {
  const out: { x: number; y: number; a: number }[] = [];
  trail.forEach((g, i) => {
    const left = Math.max(0, Math.min(1, (g.until - tick) / lifeTicks));
    const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    const n = Math.max(1, Math.round(len / 3));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const j = ((i * 7 + k * 13) % 5) - 2; // a fixed sideways jitter of -2..2 px
      const nx = len ? -(g.y1 - g.y0) / len : 0;
      const ny = len ? (g.x1 - g.x0) / len : 0;
      const f = flicker ? 0.75 + 0.25 * Math.sin(tick * 0.6 + i * 1.7 + k * 2.3) : 1;
      out.push({ x: g.x0 + (g.x1 - g.x0) * t + nx * j * 0.5, y: g.y0 + (g.y1 - g.y0) * t + ny * j * 0.5 - 1, a: left * f });
    }
  });
  return out;
}

const AMBER = 0xffb347;
const GOLD = 0xffd86b;
const EMBER = 0xff7a2f;
const BONE = 0xd9d2c0;

/** Everything above, into one Graphics (cleared by the caller). `reduced`: no pulsing or flicker. */
export function drawHeroFx(g: Phaser.GameObjects.Graphics, st: SimState, p: SimParams, parryActive: boolean, dashing: boolean, now: number, reduced: boolean): void {
  const h = st.hero;
  const hx = h.x;
  const hy = h.y - 2;
  // Wisp ember trail (under the hero)
  if (p.ability.kind === 'trail')
    for (const e of trailEmbers(st.trail, st.tick, p.ability.ticks, !reduced)) {
      g.fillStyle(e.a > 0.5 ? AMBER : EMBER, Math.min(1, e.a * 1.1));
      g.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
    }
  if (!st.alive) return;
  const stroke = (runs: [number, number][][], w: number, color: number, a: number) => {
    g.lineStyle(w, color, a);
    for (const run of runs) {
      if (run.length < 2) continue;
      g.beginPath();
      g.moveTo(run[0]![0], run[0]![1]);
      for (let i = 1; i < run.length; i++) g.lineTo(run[i]![0], run[i]![1]);
      g.strokePath();
    }
  };
  const runs = zoneOutline(hx, hy, h.aimX, h.aimY, p);
  if (parryActive) stroke(runs, p.parryFull ? 1 : 2, AMBER, p.parryFull ? 0.45 : 0.8);
  else if (!p.parryFull && !dashing) {
    // the faint aim indicator: where the shield would cover right now (12% opacity)
    stroke(runs, 1, BONE, 0.12);
  }
  // guard pips above the hero: filled per charge; a slow pulse when full (constant with reduced flashes)
  if (p.ability.kind === 'guard') {
    const n = p.ability.charges;
    const full = h.guardCharges >= n;
    const x0 = Math.round(hx - (n * 3 - 1) / 2);
    const y = Math.round(h.y - 13);
    for (let i = 0; i < n; i++) {
      const on = i < h.guardCharges;
      const a = !on ? 0.3 : full && !reduced ? 0.7 + 0.3 * Math.sin(now / 180) : 1;
      g.fillStyle(on ? (full ? GOLD : AMBER) : 0x3a4558, a);
      g.fillRect(x0 + i * 3, y, 2, 2);
    }
  }
}
