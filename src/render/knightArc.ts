/**
 * The Knight's shield arc as drawn (pure geometry, no Phaser: unit-tested). It is the NOMINAL sim parry zone: centred
 * on the hero's SIM position (hero.x, hero.y: the point src/sim/parryZone.ts measures from, not the sprite), radius =
 * the hero's parry radius, spanning aim +- arcDegrees / 2. Both numbers come from the HeroDef in src/data/heroes.ts.
 * The real hit zone is a little more forgiving (+ projectile radius, + asin(r / d) at the arc ends, and everything
 * within overlapPx of the hero), so a shot touching the drawn arc always counts.
 */
import type { HeroDef } from '../data/heroes';

export interface ArcGeom {
  cx: number;
  cy: number;
  r: number;
  /** Radians (screen space, y down): start = aim - half, end = aim + half. */
  start: number;
  end: number;
}

/** The drawn arc for a hero at (x, y) aiming (aimX, aimY), or null for a full-ring hero (no persistent arc). */
export function arcGeom(def: HeroDef, x: number, y: number, aimX: number, aimY: number): ArcGeom | null {
  if (def.parry.arcDegrees >= 360) return null;
  const aim = Math.atan2(aimY, aimX);
  const half = (def.parry.arcDegrees / 2) * (Math.PI / 180);
  return { cx: x, cy: y, r: def.parry.radius, start: aim - half, end: aim + half };
}

/**
 * Integer pixels of a 1 px arc (crisp: whole game pixels, no anti-aliasing): the pixel CONTAINING each arc point
 * (floor: a 1x1 rect at (x, y) covers [x, x + 1), so its centre is within 0.71 px of the true arc, no half-pixel bias),
 * in order from start to end; `inset` draws
 * the same arc that many px further in (the thicker pulse). Appends x, y pairs to `out` from index `len` (reused: no
 * garbage) and skips any pixel already in out[0..len) so a translucent arc never stacks alpha. Returns the new length.
 */
export function arcPixels(g: ArcGeom, inset: number, out: number[], len = 0): number {
  const r = g.r - inset;
  const n = Math.max(2, Math.ceil((g.end - g.start) * r * 2)); // ~0.5 px steps along the arc
  for (let i = 0; i <= n; i++) {
    const a = g.start + ((g.end - g.start) * i) / n;
    const x = Math.floor(g.cx + Math.cos(a) * r);
    const y = Math.floor(g.cy + Math.sin(a) * r);
    let dup = false;
    for (let k = len - 2; k >= 0 && !dup; k -= 2) dup = out[k] === x && out[k + 1] === y;
    if (dup) continue;
    out[len++] = x;
    out[len++] = y;
  }
  return len;
}
