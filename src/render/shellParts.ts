/**
 * The console shell as a list of parts (pure, no Phaser; tests/shell.test.ts): every coordinate is a whole game px.
 * The static shell (plate, bezel, deck, grille, sockets, the stick well) is baked ONCE per layout into one texture
 * (src/render/shellView.ts); the per-frame pieces (lamps, caps up / pressed, the knob) are frames of the same texture
 * (`extras`) or atlas lamp frames at fixed positions (`lamps`).
 *
 * Parts are atlas sprites (whole tiles, a cropped last tile at a region's end, or a 1 px 9-slice middle repeated:
 * `sw === 1` / `sh === 1` whenever the destination is larger) and palette-coloured rectangles. ROUND parts (the stick
 * well, its ring, the knob) come from a pixel-exact scanline circle rasteriser (`discRows`), no anti-aliasing.
 */
import manifest from '../../assets/atlas/manifest.json';
import { GLYPH_ORDER, SHELL, type LampKind, type ShellColor } from '../data/shell';
import { LAMP, rectHitsCircle, rectsOverlap, type PortraitLayout, type Rect } from './portraitLayout';

export type ShellSprite = keyof typeof manifest.sprites & `shell_${string}`;

export interface ImgPart {
  t: 'img';
  name: ShellSprite;
  frame: number;
  /** Source rectangle inside the frame. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination (game px). */
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RectPart {
  t: 'rect';
  color: ShellColor;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Part = ImgPart | RectPart;

export interface ShellOptions {
  /** The lamps of the current hero, left to right (one entry per lamp; the Knight has three 'guard'). */
  lamps: LampKind[];
  /** Stick mode (else Drag: the well is drawn empty and dimmed). */
  stick: boolean;
  /** Title plate text (TITLE). */
  title: string;
}

export interface ShellParts {
  /** The texture size: the screen (W x H) plus the rows of per-frame images under it. */
  texW: number;
  texH: number;
  parts: Part[];
  /** Frames of the baked texture for the per-frame images (caps up / pressed, the knob). */
  extras: Record<'parry_up' | 'parry_down' | 'dash_up' | 'dash_down' | 'knob', Rect>;
  /** Lamp positions (atlas `shell_lamp`, top-left). */
  lamps: { kind: LampKind; x: number; y: number }[];
  /** Ornaments placed (for the tests): name -> rectangles. */
  ornaments: { name: string; rect: Rect }[];
}

const size = (n: ShellSprite): { w: number; h: number } => manifest.sprites[n];

/**
 * Rows of a filled circle centred at (cx, cy) (may be a half pixel) of radius r: one [x, y, w] span per pixel row,
 * the pixels whose centres lie inside the circle (symmetric, crisp).
 */
export function discRows(cx: number, cy: number, r: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  if (r <= 0) return out;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const dy = y + 0.5 - cy;
    if (dy * dy > r * r) continue;
    const hw = Math.sqrt(r * r - dy * dy);
    const x0 = Math.ceil(cx - hw - 0.5);
    const x1 = Math.floor(cx + hw - 0.5); // last pixel whose centre is inside
    if (x1 >= x0) out.push([x0, y, x1 - x0 + 1]);
  }
  return out;
}

function disc(out: Part[], color: ShellColor, cx: number, cy: number, r: number): void {
  for (const [x, y, w] of discRows(cx, cy, r)) out.push({ t: 'rect', color, x, y, w, h: 1 });
}

/** Tile a region with a whole tile pattern anchored to the screen's grid (continuous across regions); crop at the ends. */
function tile(out: Part[], name: ShellSprite, frame: number, r: Rect, anchorX = 0, anchorY = 0): void {
  const { w: tw, h: th } = size(name);
  if (r.w <= 0 || r.h <= 0) return;
  const startX = anchorX + Math.floor((r.x - anchorX) / tw) * tw;
  const startY = anchorY + Math.floor((r.y - anchorY) / th) * th;
  for (let ty = startY; ty < r.y + r.h; ty += th)
    for (let tx = startX; tx < r.x + r.w; tx += tw) {
      const x0 = Math.max(tx, r.x);
      const y0 = Math.max(ty, r.y);
      const x1 = Math.min(tx + tw, r.x + r.w);
      const y1 = Math.min(ty + th, r.y + r.h);
      out.push({ t: 'img', name, frame, sx: x0 - tx, sy: y0 - ty, sw: x1 - x0, sh: y1 - y0, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
}

const img = (name: ShellSprite, frame: number, x: number, y: number): ImgPart => {
  const s = size(name);
  return { t: 'img', name, frame, sx: 0, sy: 0, sw: s.w, sh: s.h, x, y, w: s.w, h: s.h };
};

/**
 * A 9-slice cap at (x, y, w, h): the source is (2c+1) x (2c+2) with ONE middle column (c) and ONE middle row (c);
 * the corners and the rest are copied 1:1, the middle column / row are repeated (whole px, exact).
 */
export function capParts(name: 'shell_cap_l' | 'shell_cap_s', frame: number, x: number, y: number, w: number, h: number): ImgPart[] {
  const s = size(name);
  const c = (s.w - 1) / 2;
  const bottom = s.h - c - 1; // rows below the middle row
  const out: ImgPart[] = [];
  const cols: [number, number, number, number][] = [[0, c, x, c], [c, 1, x + c, w - 2 * c], [c + 1, c, x + w - c, c]];
  const rows: [number, number, number, number][] = [[0, c, y, c], [c, 1, y + c, h - c - bottom], [c + 1, bottom, y + h - bottom, bottom]];
  for (const [sy, sh, dy, dh] of rows)
    for (const [sx, sw, dx, dw] of cols) if (dw > 0 && dh > 0) out.push({ t: 'img', name, frame, sx, sy, sw, sh, x: dx, y: dy, w: dw, h: dh });
  return out;
}

/** The stick's knob: a dome lit from the top-left inside a 2k square at (x, y) (centred on its middle). */
function knobParts(out: Part[], x: number, y: number, kn: number): void {
  const c = SHELL.colors;
  const cx = x + kn;
  const cy = y + kn;
  disc(out, 'bg0', cx, cy, kn);
  disc(out, c.knobShade, cx, cy, kn - 1);
  disc(out, c.knob, cx - 1, cy - 1, kn - 2);
  disc(out, c.knobLit, cx - Math.round(kn * 0.4), cy - Math.round(kn * 0.4), Math.max(1, kn * 0.15));
}

/** The shell for a layout (null when the layout has no shell). */
/** `S`: the shell tunables (the same object the layout was made with; tests pass a modified copy). */
export function shellParts(L: PortraitLayout, o: ShellOptions, S: typeof SHELL = SHELL): ShellParts | null {
  const G = L.shell;
  if (!G) return null;
  const { W, H } = L;
  const C = S.colors;
  const parts: Part[] = [];
  const B = G.bezelW;
  const bz = G.bezel;
  // ---- body: the plate, the two strips beside the bezel and the deck, one continuous tiled iron fill
  const body: Rect[] = [
    { x: 0, y: 0, w: W, h: bz.y },
    { x: 0, y: bz.y, w: bz.x, h: bz.h },
    { x: bz.x + bz.w, y: bz.y, w: W - bz.x - bz.w, h: bz.h },
    { x: 0, y: bz.y + bz.h, w: W, h: H - bz.y - bz.h },
  ];
  for (const r of body) tile(parts, 'shell_fill', 0, r);
  // ---- the bezel: tiled sides, mitred corners, a rivet in each corner
  tile(parts, 'shell_bezel_h', 0, { x: bz.x + B, y: bz.y, w: bz.w - 2 * B, h: B }, bz.x + B, bz.y);
  tile(parts, 'shell_bezel_h', 1, { x: bz.x + B, y: bz.y + bz.h - B, w: bz.w - 2 * B, h: B }, bz.x + B, bz.y + bz.h - B);
  tile(parts, 'shell_bezel_v', 0, { x: bz.x, y: bz.y + B, w: B, h: bz.h - 2 * B }, bz.x, bz.y + B);
  tile(parts, 'shell_bezel_v', 1, { x: bz.x + bz.w - B, y: bz.y + B, w: B, h: bz.h - 2 * B }, bz.x + bz.w - B, bz.y + B);
  const corners: [number, number][] = [[bz.x, bz.y], [bz.x + bz.w - B, bz.y], [bz.x, bz.y + bz.h - B], [bz.x + bz.w - B, bz.y + bz.h - B]];
  corners.forEach(([x, y], i) => {
    parts.push(img('shell_bezel_corner', i, x, y));
    parts.push(img('shell_rivet', 0, x + 1, y + 1));
  });
  // ---- the boss bar slot: a recess (shadow top / left, lit bottom / right lip)
  const s = G.slot;
  parts.push({ t: 'rect', color: C.slot, x: s.x, y: s.y, w: s.w, h: s.h });
  parts.push({ t: 'rect', color: C.slotLit, x: s.x, y: s.y + s.h, w: s.w + 1, h: 1 });
  parts.push({ t: 'rect', color: C.slotLit, x: s.x + s.w, y: s.y, w: 1, h: s.h });
  // ---- the stick well (always: Drag mode shows it empty and dimmed), its travel ring and four ticks (Stick mode)
  const St = L.stick;
  const wr = St.r + 2;
  disc(parts, o.stick ? C.wellLit : 'fog', St.x, St.y, wr);
  disc(parts, C.well, St.x - 1, St.y - 1, wr - 1);
  if (o.stick) {
    disc(parts, C.ring, St.x, St.y, St.r);
    disc(parts, C.well, St.x, St.y, St.r - 1);
    const t = Math.max(3, Math.round(St.r * 0.12));
    const a = St.r - 2 - t;
    parts.push({ t: 'rect', color: C.ring, x: St.x + a, y: St.y, w: t, h: 1 });
    parts.push({ t: 'rect', color: C.ring, x: St.x - a - t + 1, y: St.y, w: t, h: 1 });
    parts.push({ t: 'rect', color: C.ring, x: St.x, y: St.y + a, w: 1, h: t });
    parts.push({ t: 'rect', color: C.ring, x: St.x, y: St.y - a - t + 1, w: 1, h: t });
  }
  // ---- cap sockets: the dark recess under each cap (a pressed cap shows its top row) with a lit bottom / right lip
  const caps = L.buttons.filter((b) => b.cap);
  for (const b of caps) {
    const c = b.cap!;
    parts.push({ t: 'rect', color: 'bg0', x: c.x - 1, y: c.y - 1, w: c.w + 2, h: c.h + 2 });
    parts.push({ t: 'rect', color: 'stone_dark', x: c.x - 1, y: c.y + c.h + 1, w: c.w + 3, h: 1 });
    parts.push({ t: 'rect', color: 'stone_dark', x: c.x + c.w + 1, y: c.y - 1, w: 1, h: c.h + 2 });
  }

  // ---- ornaments: lamps first (the last to go), then screws, the grille, the rune; never over the world window, the
  // stick zone, a hit rectangle, the slot, the plate or each other
  const blocked: Rect[] = [{ x: 0, y: 0, w: W, h: G.deckTop + 1 }, { x: s.x, y: s.y, w: s.w + 1, h: s.h + 1 }];
  for (const b of caps) blocked.push({ x: b.x - b.hitW! / 2 - 1, y: b.y - b.hitH! / 2 - 1, w: b.hitW! + 2, h: b.hitH! + 2 });
  const zoneR = St.zone + 1;
  const free = (r: Rect): boolean =>
    r.x >= 2 && r.y >= 0 && r.x + r.w <= W - 2 && r.y + r.h <= H - 2 && !rectHitsCircle(r, St.x, St.y, zoneR) && !blocked.some((q) => rectsOverlap(q, r, 1));
  const ornaments: ShellParts['ornaments'] = [];
  const lamps: ShellParts['lamps'] = [];
  const band = G.lampBand;
  const lw = o.lamps.length * LAMP + Math.max(0, o.lamps.length - 1) * S.lampGap;
  const lampRect: Rect = { x: band.x + Math.floor((band.w - lw) / 2), y: band.y, w: lw, h: LAMP };
  if (o.lamps.length && free(lampRect)) {
    o.lamps.forEach((kind, i) => lamps.push({ kind, x: lampRect.x + i * (LAMP + S.lampGap), y: lampRect.y }));
    blocked.push(lampRect);
    ornaments.push({ name: 'lamps', rect: lampRect });
  }
  /** The free spot for a w x h ornament nearest to (tx, ty) within `maxD` px, or null. */
  const spot = (w: number, h: number, tx: number, ty: number, maxD = Infinity): Rect | null => {
    let best: Rect | null = null;
    let bd = Infinity;
    for (let y = G.deckTop + 1; y + h <= H - 2; y++)
      for (let x = 2; x + w <= W - 2; x++) {
        const d = Math.abs(x + w / 2 - tx) + Math.abs(y + h / 2 - ty);
        if (d >= bd || d > maxD) continue;
        const r = { x, y, w, h };
        if (free(r)) {
          best = r;
          bd = d;
        }
      }
    return best;
  };
  // the decoration is placed in the reverse of S.dropOrder: what is dropped first is placed last (when no room is
  // left, it is the one that goes)
  const midY = (G.deckTop + H) / 2;
  const placers: Record<string, () => void> = {
    // screws: the two deck corners under the slot
    screws: () => {
      const sw = size('shell_screw').w;
      for (const [tx, side] of [[4, 'l'], [W - 4, 'r']] as const) {
        const r = spot(sw, sw, tx, s.y + s.h + 6, 24);
        if (!r) continue;
        parts.push(img('shell_screw', 0, r.x, r.y));
        blocked.push(r);
        ornaments.push({ name: `screw_${side}`, rect: r });
      }
    },
    // the speaker grille: whole 4 px tiles in a recessed frame, near the middle of the deck's free area
    grille: () => {
      const gt = size('shell_grille').w;
      for (const [cols, rows] of S.grille) {
        const outer = spot(cols * gt + 3, rows * gt + 3, W / 2, midY); // the frame plus its lit lip
        if (!outer) continue;
        const r = { x: outer.x, y: outer.y, w: outer.w - 1, h: outer.h - 1 };
        parts.push({ t: 'rect', color: 'bg0', x: r.x, y: r.y, w: r.w, h: r.h });
        parts.push({ t: 'rect', color: 'stone', x: r.x + 1, y: r.y + r.h, w: r.w, h: 1 });
        parts.push({ t: 'rect', color: 'stone', x: r.x + r.w, y: r.y + 1, w: 1, h: r.h });
        tile(parts, 'shell_grille', 0, { x: r.x + 1, y: r.y + 1, w: cols * gt, h: rows * gt }, r.x + 1, r.y + 1);
        blocked.push(outer);
        ornaments.push({ name: 'grille', rect: outer });
        return;
      }
    },
    // the rune engraving
    rune: () => {
      const rs = size('shell_rune');
      const r = spot(rs.w, rs.h, W / 2, midY + 12);
      if (!r) return;
      parts.push(img('shell_rune', 0, r.x, r.y));
      blocked.push(r);
      ornaments.push({ name: 'rune', rect: r });
    },
  };
  for (const d of [...S.dropOrder].reverse()) placers[d]?.();
  // ---- the title plate on the top plate (TITLE, engraved 3x5 letters)
  if (G.title) {
    const t = G.title;
    parts.push(img('shell_plate_end', 0, t.x, t.y));
    tile(parts, 'shell_plate_mid', 0, { x: t.x + 4, y: t.y, w: t.w - 8, h: t.h }, t.x + 4, t.y);
    parts.push(img('shell_plate_end', 1, t.x + t.w - 4, t.y));
    let x = t.x + 5;
    for (const ch of o.title.toUpperCase()) {
      const i = GLYPH_ORDER.indexOf(ch);
      if (i >= 0) parts.push(img('shell_glyph', i, x, t.y + 2));
      x += 4;
    }
    ornaments.push({ name: 'title', rect: t });
  }

  // ---- the per-frame images, under the screen in the same texture: caps up / pressed, the knob
  const P = L.buttons.find((b) => b.id === 'parry')?.cap ?? { x: 0, y: 0, w: 1, h: 1 };
  const D = L.buttons.find((b) => b.id === 'dash')?.cap ?? { x: 0, y: 0, w: 1, h: 1 };
  const kd = 2 * St.knob;
  const y0 = H + 1;
  const y1 = y0 + P.h + 1;
  const extras: ShellParts['extras'] = {
    parry_up: { x: 0, y: y0, w: P.w, h: P.h },
    parry_down: { x: P.w + 1, y: y0, w: P.w, h: P.h },
    dash_up: { x: 0, y: y1, w: D.w, h: D.h },
    dash_down: { x: D.w + 1, y: y1, w: D.w, h: D.h },
    knob: { x: 2 * D.w + 2, y: y1, w: kd, h: kd },
  };
  parts.push(...capParts('shell_cap_l', 0, 0, y0, P.w, P.h), ...capParts('shell_cap_l', 1, P.w + 1, y0, P.w, P.h));
  parts.push(...capParts('shell_cap_s', 0, 0, y1, D.w, D.h), ...capParts('shell_cap_s', 1, D.w + 1, y1, D.w, D.h));
  knobParts(parts, extras.knob.x, extras.knob.y, St.knob);
  const texW = Math.max(W, 2 * P.w + 1, 2 * D.w + 2 + kd);
  const texH = y1 + Math.max(D.h, kd);
  return { texW, texH, parts, extras, lamps, ornaments };
}

/** The lamps of a hero: dash, the ability's lamps (Knight: one per guard charge; Wisp: the trail), slow, double. */
export function heroLamps(ability: { kind: string; charges?: number }): LampKind[] {
  const out: LampKind[] = [];
  for (const k of SHELL.lamps) {
    if (k === 'guard') {
      if (ability.kind === 'guard') for (let i = 0; i < (ability.charges ?? 3); i++) out.push('guard');
      else if (ability.kind === 'trail') out.push('trail');
    } else out.push(k);
  }
  return out.slice(0, SHELL.maxLamps);
}
