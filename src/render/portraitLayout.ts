/**
 * Phone-portrait run layout (pure, no Phaser; render-only). From the REAL portrait game size (src/web/screen.ts) it
 * places: the HUD band on top, the world window in the middle, the boss bar and the control strip at the bottom.
 * The world window is filled: the camera zoom is raised until the window shows at most the world height (270 px), and
 * it is a whole number of device px per world px (crisp). PARRY / DASH are sized in CSS px (thumb targets).
 */
import { PORTRAIT } from '../data/view';

export interface Btn {
  id: 'parry' | 'dash';
  x: number;
  y: number;
  /** Drawn radius and hit radius (game px). */
  r: number;
  hit: number;
}

export interface PortraitLayout {
  W: number;
  H: number;
  hudH: number;
  /** World window on the screen (game px) and its camera zoom (screen px per world px). */
  view: { x: number; y: number; w: number; h: number };
  zoom: number;
  bar: { x: number; y: number; w: number };
  buttons: Btn[];
  pause: { x: number; y: number; w: number; h: number };
}

/** Button sizes in CSS px (diameters) and the extra hit margin. */
export const BTN_CSS = { parry: 88, dash: 64, hitPad: 12 };

/**
 * @param k device px per game px (integer), @param dpr devicePixelRatio, @param zoomFloor the minimum camera zoom
 * (PORTRAIT.zoom, tunable).
 */
export function portraitLayout(W: number, H: number, k: number, dpr: number, leftHanded: boolean, zoomFloor: number = PORTRAIT.zoom): PortraitLayout {
  const css = k / Math.max(0.5, dpr); // CSS px per game px
  const g = (cssPx: number) => Math.ceil(cssPx / css);
  const hudH = PORTRAIT.hudH;
  const rP = g(BTN_CSS.parry / 2);
  const rD = g(BTN_CSS.dash / 2);
  const pad = g(BTN_CSS.hitPad);
  const margin = Math.max(6, g(10));
  const barH = 10;
  const stripH = barH + 6 + 2 * (rP + pad) + 4;
  const view = { x: 0, y: hudH, w: W, h: Math.max(60, H - hudH - stripH) };
  // fill the window: no more than the world height (270) visible, whole device px per world px
  const worldH = 270;
  const devPerWorld = Math.max(Math.ceil(zoomFloor * k), Math.ceil((k * view.h) / worldH));
  const zoom = devPerWorld / k;
  const yB = H - (rP + pad) - 2; // PARRY: bottom corner, inside the strip
  const xP = W - margin - rP;
  // DASH beside it, towards the centre, a little higher; the hit circles never touch (2 px apart)
  const xD = xP - (rP + pad) - (rD + pad) - 2;
  const yD = yB - Math.round(rP * 0.35);
  const mirror = (x: number) => (leftHanded ? W - x : x);
  const buttons: Btn[] = [
    { id: 'parry', x: mirror(xP), y: yB, r: rP, hit: rP + pad },
    { id: 'dash', x: mirror(xD), y: yD, r: rD, hit: rD + pad },
  ];
  return {
    W, H, hudH, view, zoom,
    bar: { x: margin, y: H - stripH + 4, w: W - 2 * margin },
    buttons,
    pause: { x: W - 4 - 19, y: 3, w: 19, h: 14 },
  };
}
