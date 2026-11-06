/**
 * Multiplier and Double Score feedback as pure logic (no Phaser): HUD colours by tier, the slow blink before the
 * multiplier resets, where a floating label may go without covering the hero or an approaching projectile.
 * Render-only: it reads sim state and never writes it.
 */
import type { SimParams } from '../sim/params';
import type { SimState } from '../sim/state';

/** Palette colours (the same values as C in ui.ts; kept here so this module has no Phaser import). */
const C = { bone: '#d9d2c0', gold: '#ffd86b' } as const;

/** HUD multiplier colour: x1 white (bone), x2+ amber, x4+ gold. `mult` in hundredths. */
export function multColor(mult: number): string {
  if (mult >= 400) return C.gold;
  if (mult >= 200) return '#ffb347';
  return C.bone;
}

/** Floating label colours: a normal step amber, a PERFECT one gold; parry points gold under Double Score. */
export const LABEL = { step: '#ffb347', perfect: C.gold, points: C.bone, pointsDouble: C.gold } as const;

/** Labels fade within this time (ms). */
export const LABEL_MS = 600;

/** Ticks left before the multiplier resets (Infinity when it is at the start value or never stepped). */
export function resetTicksLeft(s: SimState, p: SimParams): number {
  if (s.multiplier === p.multStart || s.lastParryTick < 0) return Infinity;
  return Math.max(0, s.lastParryTick + p.multReset - s.tick);
}

/**
 * HUD multiplier alpha: a slow blink (period ~0.5 s) during the last second before the reset, so the player knows to
 * parry. Reduced flashes: never blinks.
 */
export function decayAlpha(s: SimState, p: SimParams, nowMs: number, reduced: boolean): number {
  if (reduced) return 1;
  const left = resetTicksLeft(s, p);
  if (left > 60) return 1;
  return Math.floor(nowMs / 250) % 2 === 0 ? 1 : 0.4;
}

/** Double Score is active (the same rule as the sim's isDouble). */
export const doubleActive = (s: SimState): boolean => s.tick < s.doubleUntil;

/** The area a label must stay inside (world px): the arena, or the camera window in the zoomed portrait view. */
export interface LabelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Ticks a label is on screen (LABEL_MS at 60 Hz): a projectile is avoided along its path for that long. */
const LABEL_TICKS = Math.ceil((LABEL_MS / 1000) * 60);

/**
 * Where a label near the hero goes (its centre). Candidates in order: above the hero, below it, then up-left / up-right
 * / down-left / down-right, clamped inside `b`; the first whose box (text width x 8 px, + 6 px of margin) touches
 * nothing wins, else the one touching the fewest. "Nothing" = no projectile anywhere along its path for the label's
 * lifetime, no telegraph (rune, caster, sigil, the boss) and no `avoid` box (this tick's kills, the other label).
 */
export function labelSpot(s: SimState, b: LabelBounds, avoid: readonly { x: number; y: number; w?: number }[] = [], widthPx = 64): { x: number; y: number } {
  const h = s.hero;
  const pts: { x: number; y: number; r: number; w: number }[] = [];
  for (const pr of s.projectiles)
    for (let k = 0; k <= LABEL_TICKS; k += 4) pts.push({ x: pr.x + pr.vx * k, y: pr.y + pr.vy * k, r: pr.radius, w: 0 });
  for (const t of s.telegraphs) pts.push({ x: t.x, y: t.y, r: 8, w: 0 });
  for (const c of s.casters) pts.push({ x: c.x, y: c.y, r: 10, w: 0 });
  for (const g of s.sigils) pts.push({ x: g.x, y: g.y, r: g.r, w: 0 });
  if (s.boss) pts.push({ x: s.boss.x, y: s.boss.y, r: 14, w: 0 });
  for (const a of avoid) pts.push({ x: a.x, y: a.y, r: 6, w: a.w ?? 0 });
  const half = widthPx / 2;
  const cands: [number, number][] = [
    [0, -22], [0, 16], [-half - 6, -18], [half + 6, -18], [-half - 6, 14], [half + 6, 14],
  ];
  let best: { x: number; y: number; n: number } | null = null;
  for (const [dx, dy] of cands) {
    const x = Math.min(b.maxX - half, Math.max(b.minX + half, h.x + dx));
    const y = h.y + dy;
    if (y - 4 < b.minY || y + 4 > b.maxY) continue;
    // never on the hero sprite (16 x 16 around its centre, the sprite is drawn 4 px up)
    if (Math.abs(x - h.x) < half + 8 && Math.abs(y - (h.y - 4)) < 4 + 8 + 2) continue;
    const n = pts.filter((q) => Math.abs(q.x - x) <= half + 6 + (q.w ? q.w / 2 : q.r) && Math.abs(q.y - y) <= 4 + 6 + q.r).length;
    if (!best || n < best.n) best = { x, y, n };
    if (n === 0) break;
  }
  const r = best ?? { x: Math.min(b.maxX - half, Math.max(b.minX + half, h.x)), y: Math.max(b.minY + 4, h.y - 22) };
  return { x: Math.round(r.x), y: Math.round(r.y) };
}
