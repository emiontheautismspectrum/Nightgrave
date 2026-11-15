/**
 * The hunts as a draw list (pure, no Phaser; render-only, reads sim state only): hex knots (FEATURES.knot) and briar
 * lines with their gap markers (FEATURES.briar). GameScene turns every entry into a pooled sprite by its `key`.
 * With the blocks off the state has no `knots` / `walls` and the list is always empty.
 *
 * - hex_knot: the frame IS the fuse (frame i = 4 - i bone pips lit), from the sim's ticks; no number is shown.
 * - briar_tile along the band (turned 90 degrees for a vertical band), none over the gap; a briar_post at each side
 *   of the gap. During the telegraph the band stands at its entering edge, outside the arena, dimmed, still.
 * - edge_gap (bone) on both arena edges the gap passes, from the line's first tick to its last.
 */
import type { SimParams } from '../sim/params';
import type { SimState, Wall } from '../sim/state';

export type HuntSpriteName = 'hex_knot' | 'briar_tile' | 'briar_post' | 'edge_gap';

export interface HuntSprite {
  /** Stable id of the entry (pool key): "k<id>", "w<id>:<i>", "wp<id>:<side>", "wg<id>:<edge>". */
  key: string;
  name: HuntSpriteName;
  frame: number;
  x: number;
  y: number;
  /** 0, or 90 for the pieces of a vertical band. */
  angle: 0 | 90;
  alpha: number;
  /** The y the sprite sorts by among the world's actors (its base). */
  base: number;
}

/** Band tiles are this long along the band (the sprite is 8 x 8). */
export const TILE = 8;
/** Alpha of a band during its telegraph (still at the entering edge, harmless). */
export const TELEGRAPH_ALPHA = 0.55;

function wallSprites(w: Wall, s: SimState, p: SimParams, out: HuntSprite[]): void {
  const moving = s.tick >= w.move;
  const frame = moving ? (s.tick >> 3) & 1 : 0;
  const alpha = moving ? 1 : TELEGRAPH_ALPHA;
  const vertical = w.axis === 'x'; // it moves along x: the band itself is vertical
  const lo = vertical ? p.y0 : p.x0;
  const hi = vertical ? p.y1 : p.x1;
  const angle = vertical ? 90 : 0;
  const at = (along: number, across: number): [number, number] => (vertical ? [Math.round(w.pos), Math.round(across)] : [Math.round(across), Math.round(w.pos)]);
  let i = 0;
  for (let c = lo + TILE / 2; c <= hi - TILE / 2 + 1e-9; c += TILE) {
    if (Math.abs(c - w.gap) < w.gapHalf + TILE / 2) continue; // the posts close the rest
    const [x, y] = at(w.pos, c);
    out.push({ key: `w${w.id}:${i++}`, name: 'briar_tile', frame, x, y, angle, alpha, base: y });
  }
  for (const side of [-1, 1]) {
    const [x, y] = at(w.pos, w.gap + side * (w.gapHalf + 4));
    out.push({ key: `wp${w.id}:${side}`, name: 'briar_post', frame: 0, x, y, angle, alpha, base: y + (vertical ? 0 : 4) });
  }
  // the gap's way across the arena, marked on both edges it passes (bone = safe passage)
  for (const edge of [0, 1]) {
    const e = edge === 0 ? (vertical ? p.x0 : p.y0) - 2 : (vertical ? p.x1 : p.y1) + 2;
    const [x, y] = vertical ? [e, w.gap] : [w.gap, e];
    out.push({ key: `wg${w.id}:${edge}`, name: 'edge_gap', frame: 0, x: Math.round(x), y: Math.round(y), angle: 0, alpha: 1, base: -1 });
  }
}

export function huntSprites(s: SimState, p: SimParams): HuntSprite[] {
  const out: HuntSprite[] = [];
  for (const k of s.knots ?? []) {
    const frame = Math.max(0, Math.min(3, Math.floor(((s.tick - k.start) * 4) / Math.max(1, k.burst - k.start))));
    out.push({ key: `k${k.id}`, name: 'hex_knot', frame, x: Math.round(k.x), y: Math.round(k.y), angle: 0, alpha: 1, base: k.y + 6 });
  }
  for (const w of s.walls ?? []) wallSprites(w, s, p, out);
  return out;
}
