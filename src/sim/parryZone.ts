/**
 * THE parry zone (one shared function): the sim's parry resolution (and with it the boss reflect bonus, the PERFECT
 * measure and armored / splitting orbs) and the renderer's pulse drawing all use it.
 *
 * Inside = centre distance <= radius + projectile radius AND, for an arc below 360 degrees, the angle between the
 * hero's aim and the vector hero -> projectile is <= half the arc + asin(projectile radius / distance) (a projectile
 * that overlaps the edge of the arc counts). A projectile closer than overlapPx always counts (no blind spot on top of
 * the hero). Only +, -, *, / and Math.sqrt: deterministic on every JS engine (the arc's cos / sin come from dmath).
 */
import type { SimParams } from './params';

type Zone = Pick<SimParams, 'parryRadius' | 'parryFull' | 'parryHalfCos' | 'parryHalfSin' | 'parryOverlap'>;

/** Squared centre distance if the projectile is inside the zone, else -1. */
export function inParryZone(hx: number, hy: number, aimX: number, aimY: number, px: number, py: number, r: number, z: Zone): number {
  const dx = px - hx;
  const dy = py - hy;
  const d2 = dx * dx + dy * dy;
  const reach = z.parryRadius + r;
  if (d2 > reach * reach) return -1;
  if (z.parryFull || d2 <= z.parryOverlap * z.parryOverlap) return d2;
  const d = Math.sqrt(d2); // > overlapPx > 0: no division by zero
  const cosA = (dx * aimX + dy * aimY) / d;
  // the tolerance angle t = asin(clamp(r / d, 0, 1)) as sin / cos
  const sinT = r >= d ? 1 : r / d;
  const cosT = Math.sqrt(1 - sinT * sinT);
  // arcs wider than 180 degrees: half + t >= 180 degrees covers every direction
  if (z.parryHalfCos < 0 && sinT >= z.parryHalfSin) return d2;
  // angle <= half + t  <=>  cos(angle) >= cos(half + t) = cos(half) cos(t) - sin(half) sin(t)
  return cosA >= z.parryHalfCos * cosT - z.parryHalfSin * sinT ? d2 : -1;
}

/** Distance from point (px, py) to the segment (x0, y0)-(x1, y1) squared (trail hits). */
export function segDist2(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - x0) * vx + (py - y0) * vy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x0 + vx * t - px;
  const qy = y0 + vy * t - py;
  return qx * qx + qy * qy;
}
