/**
 * Page layout (pure, testable): the framed game on the left, the board panel on the right, a footer below, the pair
 * centred. The game keeps the crisp integer DEVICE-pixel scaling from Polish 1, computed for the space left after the
 * panel, the gap, both frames and the footer. If even 2x does not fit next to the panel, the panel moves under the game
 * ('stack'); phones ('phone') use the whole screen with no panel.
 */
export const VIEW_W = 480;
export const VIEW_H = 270;
export const GAP = 26;
export const PANEL_MAX = 360;
export const PANEL_MIN = 280;
export const FOOTER_H = 24;
export const MARGIN = 12;
/** Frame thickness in game pixels (4 stone bands). */
export const FRAME_GP = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Layout {
  mode: 'side' | 'stack' | 'phone';
  /** Phaser zoom (CSS px per game px) and device px per game px. */
  zoom: number;
  device: number;
  exact: boolean;
  /** The canvas box (inside the frame) in CSS px. */
  game: Rect;
  panel: Rect | null;
  footerY: number;
  /** One game pixel in CSS px (frame bands use it). */
  gp: number;
  pageH: number;
}

/** A CSS offset that is a whole number of device pixels AND on the browser's 1/64 px layout grid. */
export function snap(css: number, dpr: number): number {
  const k0 = Math.round(css * dpr);
  for (let n = 0; n <= 12; n++)
    for (const k of [k0 - n, k0 + n])
      if (k >= 0 && Math.abs((k / dpr) * 64 - Math.round((k / dpr) * 64)) < 1e-3) return k / dpr;
  return k0 / dpr;
}

export function computeLayout(vw: number, vh: number, dprIn: number, phone: boolean): Layout {
  const dpr = Math.max(0.5, dprIn || 1);
  if (phone) {
    const device = Math.floor(Math.min((vw * dpr) / VIEW_W, (vh * dpr) / VIEW_H));
    const exact = device >= 2;
    const zoom = exact ? device / dpr : Math.max(0.5, Math.min(vw / VIEW_W, vh / VIEW_H));
    const w = VIEW_W * zoom;
    const h = VIEW_H * zoom;
    return { mode: 'phone', zoom, device: exact ? device : zoom * dpr, exact, game: { x: snap((vw - w) / 2, dpr), y: snap((vh - h) / 2, dpr), w, h }, panel: null, footerY: vh, gp: zoom, pageH: vh };
  }
  for (let z = Math.floor(((vh - FOOTER_H - 2 * MARGIN) * dpr) / VIEW_H); z >= 2; z--) {
    const gp = z / dpr;
    const f = FRAME_GP * gp;
    const gw = VIEW_W * gp;
    const gh = VIEW_H * gp;
    if (gh + 2 * f + FOOTER_H + 2 * MARGIN > vh) continue;
    const panelW = Math.min(PANEL_MAX, vw - 2 * MARGIN - gw - 4 * f - GAP);
    if (panelW < PANEL_MIN) continue;
    const total = gw + 2 * f + GAP + panelW + 2 * f;
    const left = snap((vw - total) / 2 + f, dpr);
    const top = snap((vh - (gh + 2 * f + FOOTER_H)) / 2 + f, dpr);
    return {
      mode: 'side', zoom: gp, device: z, exact: true, gp,
      game: { x: left, y: top, w: gw, h: gh },
      panel: { x: snap(left + gw + f + GAP + f, dpr), y: top, w: Math.floor(panelW), h: gh },
      footerY: top + gh + f + 6,
      pageH: vh,
    };
  }
  // not even 2x fits next to the panel: the panel goes under the game (vertical scroll, never horizontal)
  for (let z = Math.floor(((vh - 2 * MARGIN) * dpr) / VIEW_H); z >= 2; z--) {
    const gp = z / dpr;
    const f = FRAME_GP * gp;
    const gw = VIEW_W * gp;
    const gh = VIEW_H * gp;
    if (gw + 2 * f + 2 * MARGIN > vw || gh + 2 * f + 2 * MARGIN > vh) continue;
    const left = snap((vw - gw) / 2, dpr);
    const top = snap(MARGIN + f, dpr);
    const pw = Math.min(PANEL_MAX, vw - 2 * MARGIN - 2 * f);
    const py = top + gh + f + GAP + f;
    return {
      mode: 'stack', zoom: gp, device: z, exact: true, gp,
      game: { x: left, y: top, w: gw, h: gh },
      panel: { x: snap((vw - pw) / 2, dpr), y: py, w: Math.floor(pw), h: 0 },
      footerY: py + 520,
      pageH: py + 520 + FOOTER_H + MARGIN,
    };
  }
  // tiny window: fractional fit, the panel below
  const zoom = Math.max(0.5, Math.min((vw - 2 * MARGIN) / VIEW_W, (vh - 2 * MARGIN) / VIEW_H) * 0.95);
  const gw = VIEW_W * zoom;
  const gh = VIEW_H * zoom;
  const f = FRAME_GP * zoom;
  const left = snap((vw - gw) / 2, dpr);
  const top = snap(MARGIN + f, dpr);
  const pw = Math.min(PANEL_MAX, vw - 2 * MARGIN);
  return {
    mode: 'stack', zoom, device: zoom * dpr, exact: false, gp: zoom,
    game: { x: left, y: top, w: gw, h: gh },
    panel: { x: snap((vw - pw) / 2, dpr), y: top + gh + f + GAP, w: Math.floor(pw), h: 0 },
    footerY: top + gh + f + GAP + 520,
    pageH: top + gh + f + GAP + 520 + FOOTER_H + MARGIN,
  };
}
