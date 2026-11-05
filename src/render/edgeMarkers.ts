/**
 * Fairness edge indicators for the zoomed phone-portrait view (pure, no Phaser; render-only, reads sim state only).
 *
 * A marker sits on the edge of the world window, on the line from the hero towards:
 * - every off-view projectile that can reach the hero within the horizon (violet = parryable, red = unparryable),
 * - every off-view telegraph for its whole telegraph time: rune glows, casters (portal / forest eyes, through the cast),
 *   blood sigils (outline and lethal fill), the boss (always, red while it winds up a beam) and its attack points.
 * Bigger = closer (projectiles: sooner).
 */
import type { SimParams } from '../sim/params';
import type { SimState } from '../sim/state';
import type { ViewRect } from './camera';

export interface EdgeMarker {
  /** Stable id of what it points at (e.g. "p12", "c3", "t7", "s2", "b", "bp0"). */
  key: string;
  /** World position of the marker (on the window edge) and of the source. */
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** Direction from the hero to the source (radians). */
  ang: number;
  color: 'violet' | 'red';
  size: 1 | 2 | 3;
}

/** Inset of the markers from the window edge (world px). */
export const MARKER_INSET = 6;

const inside = (v: ViewRect, x: number, y: number, pad = 0): boolean => x >= v.x0 - pad && x <= v.x1 + pad && y >= v.y0 - pad && y <= v.y1 + pad;

/** Where the ray hero -> (x, y) leaves the window, inset (falls back to clamping). */
function edgePoint(v: ViewRect, hx: number, hy: number, x: number, y: number): [number, number] {
  const x0 = v.x0 + MARKER_INSET;
  const x1 = v.x1 - MARKER_INSET;
  const y0 = v.y0 + MARKER_INSET;
  const y1 = v.y1 - MARKER_INSET;
  const cx = Math.min(x1, Math.max(x0, hx));
  const cy = Math.min(y1, Math.max(y0, hy));
  const dx = x - cx;
  const dy = y - cy;
  let t = 1;
  if (dx > 0) t = Math.min(t, (x1 - cx) / dx);
  if (dx < 0) t = Math.min(t, (x0 - cx) / dx);
  if (dy > 0) t = Math.min(t, (y1 - cy) / dy);
  if (dy < 0) t = Math.min(t, (y0 - cy) / dy);
  t = Math.max(0, t);
  return [Math.min(x1, Math.max(x0, cx + dx * t)), Math.min(y1, Math.max(y0, cy + dy * t))];
}

const bySize = (d: number, near: number, mid: number): 1 | 2 | 3 => (d <= near ? 3 : d <= mid ? 2 : 1);

export function edgeMarkers(s: SimState, p: SimParams, v: ViewRect, horizonTicks: number): EdgeMarker[] {
  const out: EdgeMarker[] = [];
  const h = s.hero;
  const t = s.tick;
  const add = (key: string, x: number, y: number, color: EdgeMarker['color'], size: EdgeMarker['size']) => {
    if (inside(v, x, y)) return;
    const [mx, my] = edgePoint(v, h.x, h.y, x, y);
    out.push({ key, x: mx, y: my, sx: x, sy: y, ang: Math.atan2(y - h.y, x - h.x), color, size });
  };
  for (const pr of s.projectiles) {
    if (pr.fadeEnd >= 0 && t >= pr.fadeEnd) continue;
    const d = Math.max(0, Math.hypot(pr.x - h.x, pr.y - h.y) - pr.radius - p.heroRadius);
    // closing speed: the threat's own speed plus the hero's (the hero may run towards it); straight and curving
    // shots can turn back towards the hero, so this is distance-in-time, not just "approaching"
    const sp = Math.max(1e-6, Math.hypot(pr.vx, pr.vy), pr.speed) + p.heroSpeed;
    const ticks = d / sp;
    if (ticks > horizonTicks) continue;
    add(`p${pr.id}`, pr.x, pr.y, pr.parryable ? 'violet' : 'red', bySize(ticks, 30, 60));
  }
  const near = (x: number, y: number) => bySize(Math.hypot(x - h.x, y - h.y), 120, 200);
  for (const tg of s.telegraphs) if (t >= tg.start && t <= tg.fire) add(`t${tg.id}`, tg.x, tg.y, 'violet', near(tg.x, tg.y));
  for (const c of s.casters) if (t >= c.start && t <= c.fire) add(`c${c.id}`, c.x, c.y, c.attack === 'blade' ? 'red' : 'violet', near(c.x, c.y));
  for (const g of s.sigils) if (t >= g.start && t < g.end) add(`s${g.id}`, g.x, g.y, 'red', near(g.x, g.y));
  const b = s.boss;
  if (b && b.deathTick < 0) {
    const a = b.attack;
    const winding = !!a && t >= a.windStart && t <= a.fire;
    add('b', b.x, b.y, winding && a?.pattern === 'beam' ? 'red' : 'violet', winding ? 3 : near(b.x, b.y));
    if (a && winding) a.points.forEach(([x, y], i) => add(`bp${i}`, x, y, 'violet', near(x, y)));
  }
  for (const bm of s.beams) if (t >= bm.start && t < bm.end) add(`m${bm.serial}`, bm.x, bm.y, 'red', 3);
  return out;
}
