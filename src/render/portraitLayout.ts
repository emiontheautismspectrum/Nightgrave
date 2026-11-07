/**
 * Phone-portrait run layout (pure, no Phaser; render-only). From the REAL portrait game size (src/web/screen.ts) it
 * places: the top band (HUD) on top, the world window in the middle, the boss bar and the controls at the bottom.
 * The world window is filled: the camera zoom is raised until the window shows at most the world height (270 px), and
 * it is a whole number of device px per world px (crisp). PARRY / DASH are sized in CSS px (thumb targets).
 *
 * With the console shell (src/data/shell.ts, the default): a top PLATE (HUD, pause pill, title plate), a riveted
 * BEZEL around the world window and a control DECK: the boss bar in a slot on its top edge, the lamp row, the stick
 * well and two RECTANGULAR caps (PARRY lower and nearest the thumb, DASH higher and further in). `SHELL.enabled =
 * false` returns the previous layout unchanged (round buttons in a plain strip).
 */
import { PORTRAIT } from '../data/view';
import { STICK } from '../data/input';
import { SHELL } from '../data/shell';
import type { TouchStick } from './touch';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Btn {
  id: 'parry' | 'dash';
  /** Centre (game px). */
  x: number;
  y: number;
  /** Drawn radius and hit radius (game px): round buttons; for a rectangular cap half its shorter side / longer hit side. */
  r: number;
  hit: number;
  /** Rectangular cap (the shell): the visible cap size and the hit rectangle, both centred at (x, y). */
  w?: number;
  h?: number;
  hitW?: number;
  hitH?: number;
  /** The visible cap on whole game px (its art covers exactly this rectangle). */
  cap?: Rect;
}

/** Where the shell's fixed pieces go (game px, integers). */
export interface ShellGeom {
  /** Top plate height (the HUD and the pause pill sit on it). */
  plateH: number;
  /** The bezel's outer rectangle (the world window is inside it, `bezelW` px in). */
  bezel: Rect;
  bezelW: number;
  /** First row of the control deck (under the bezel). */
  deckTop: number;
  /** The recessed boss bar slot (outer rectangle, 1 px around the bar). */
  slot: Rect;
  /** The lamp row's reserved band (room for SHELL.maxLamps lamps). */
  lampBand: Rect;
  /** The title plate (null: it does not fit beside the HUD). */
  title: Rect | null;
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
  /** The fixed joystick (Stick mode): bottom corner of the strip opposite the buttons. */
  stick: TouchStick;
  /** The pause button as drawn (the shell: the pill). */
  pause: Rect;
  /** The pause button's touch target (the shell: >= SHELL.pauseHit CSS px square); absent = derived by the scene. */
  pauseHit?: Rect;
  /** The console shell's geometry, or null (SHELL.enabled false). */
  shell: ShellGeom | null;
}

/** Button sizes in CSS px (diameters) and the extra hit margin (the round buttons of the plain layout). */
export const BTN_CSS = { parry: 88, dash: 64, hitPad: 12 };

/** HUD readouts on the portrait top band (src/render/GameScene.ts HUD_Z, BossView timers): right / bottom edge. */
export const HUD_RIGHT = 192;
export const HUD_BOTTOM = 33;
/** Pause pill art and the lamp sprite (tools/nglib/shell.py). */
export const PILL = { w: 19, h: 11 };
export const LAMP = 11;
/** Title plate: 4 px ends, 3x5 letters 4 px apart, 1 px padding (tools/nglib/shell.py). */
export const titleWidth = (text: string): number => 8 + 2 + Math.max(0, text.length * 4 - 1);
export const TITLE_H = 9;
/** The boss bar height (src/render/BossView.ts) and the slot recess around it. */
const BAR_H = 10;

/**
 * @param k device px per game px (integer), @param dpr devicePixelRatio, @param zoomFloor the minimum camera zoom
 * (PORTRAIT.zoom, tunable), @param shell the shell tunables (tests pass `{ ...SHELL, enabled: false }`),
 * @param title the title plate text (TITLE).
 */
export function portraitLayout(W: number, H: number, k: number, dpr: number, leftHanded: boolean, zoomFloor: number = PORTRAIT.zoom, shell: typeof SHELL = SHELL, title = ''): PortraitLayout {
  return shell.enabled ? shellLayout(W, H, k, dpr, leftHanded, zoomFloor, shell, title) : plainLayout(W, H, k, dpr, leftHanded, zoomFloor);
}

/** Whole device px per world px, at most the world height visible. */
function zoomFor(viewH: number, k: number, zoomFloor: number): number {
  const worldH = 270;
  const devPerWorld = Math.max(Math.ceil(zoomFloor * k), Math.ceil((k * viewH) / worldH));
  return devPerWorld / k;
}

/** The plain layout (SHELL.enabled false): exactly the layout before the shell. */
function plainLayout(W: number, H: number, k: number, dpr: number, leftHanded: boolean, zoomFloor: number): PortraitLayout {
  const css = k / Math.max(0.5, dpr); // CSS px per game px
  const g = (cssPx: number) => Math.ceil(cssPx / css);
  const hudH = PORTRAIT.hudH;
  const rP = g(BTN_CSS.parry / 2);
  const rD = g(BTN_CSS.dash / 2);
  const pad = g(BTN_CSS.hitPad);
  const margin = Math.max(6, g(10));
  const barH = 10;
  // the fixed joystick: STICK.portrait CSS px across, the knob STICK.knob; the strip is tall enough for it too
  const rS = g(STICK.portrait / 2);
  const stripH = barH + 6 + Math.max(2 * (rP + pad), 2 * rS + 2 * g(8)) + 4;
  const view = { x: 0, y: hudH, w: W, h: Math.max(60, H - hudH - stripH) };
  // fill the window: no more than the world height (270) visible, whole device px per world px
  const zoom = zoomFor(view.h, k, zoomFloor);
  const yB = H - (rP + pad) - 2; // PARRY: bottom corner, inside the strip
  const xP = W - margin - rP;
  // DASH beside it, towards the centre, a little higher; the hit circles never touch (2 px apart)
  const xD = xP - (rP + pad) - (rD + pad) - 2;
  const yD = yB - Math.round(rP * 0.35);
  const mirror = (x: number) => (leftHanded ? W - x : x);
  // the stick: the bottom corner opposite PARRY (left; right when left-handed), under the boss bar. On a very narrow
  // screen it shrinks so its base never reaches DASH's hit circle (the buttons keep their sizes)
  const rFit = Math.floor((xD - (rD + pad) - margin - 4) / 2);
  const rStick = Math.max(8, Math.min(rS, rFit));
  const stick: TouchStick = { x: mirror(margin + rStick), y: H - g(8) - rStick - 2, r: rStick, knob: Math.min(g(STICK.knob / 2), Math.round(rStick * 0.5)), zone: rStick + g(STICK.zonePad) };
  const buttons: Btn[] = [
    { id: 'parry', x: mirror(xP), y: yB, r: rP, hit: rP + pad },
    { id: 'dash', x: mirror(xD), y: yD, r: rD, hit: rD + pad },
  ];
  return {
    W, H, hudH, view, zoom,
    bar: { x: margin, y: H - stripH + 4, w: W - 2 * margin },
    buttons,
    stick,
    pause: { x: W - 4 - 19, y: 3, w: 19, h: 14 },
    shell: null,
  };
}

/** Does the rectangle come within `zone` of the circle centre (any overlap with the open disc)? */
export function rectHitsCircle(r: Rect, cx: number, cy: number, rad: number): boolean {
  const nx = Math.min(Math.max(cx, r.x), r.x + r.w);
  const ny = Math.min(Math.max(cy, r.y), r.y + r.h);
  return (nx - cx) ** 2 + (ny - cy) ** 2 < rad * rad;
}

export const rectsOverlap = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

function shellLayout(W: number, H: number, k: number, dpr: number, leftHanded: boolean, zoomFloor: number, S: typeof SHELL, title: string): PortraitLayout {
  const css = k / Math.max(0.5, dpr); // CSS px per game px
  const g = (cssPx: number) => Math.ceil(cssPx / css - 1e-9);
  const edge = 1; // hit rectangles stay this far from the screen edges (the safe area is already outside the canvas)
  // ---- top plate: the HUD (fixed positions, today's fonts), the pause pill's >= 44 CSS px target, the title plate
  const ph = Math.max(16, g(S.pauseHit));
  const plateH = Math.max(PORTRAIT.hudH, HUD_BOTTOM, ph + 2);
  const pauseHit: Rect = { x: W - edge - ph, y: 1, w: ph, h: ph };
  const pause: Rect = { x: pauseHit.x + Math.floor((ph - PILL.w) / 2), y: pauseHit.y + Math.floor((ph - PILL.h) / 2), w: PILL.w, h: PILL.h };
  let titleRect: Rect | null = null;
  if (S.title && title) {
    const tw = titleWidth(title);
    const x0 = HUD_RIGHT + 3;
    const x1 = pauseHit.x - 3;
    // the HUD wins: no title plate unless it fits between the readouts and the pause target
    if (x1 - x0 >= tw) titleRect = { x: x0 + Math.floor((x1 - x0 - tw) / 2), y: Math.floor((plateH - TITLE_H) / 2), w: tw, h: TITLE_H };
  }

  // ---- the controls (right-handed coordinates; mirrored at the end). Sizes never shrink for anything else
  const pad = g(S.caps.hitPad);
  const gap = g(S.hitGap);
  const capP = { w: g(S.caps.parry.w), h: g(S.caps.parry.h) };
  const capD = { w: g(S.caps.dash.w), h: g(S.caps.dash.h) };
  const hitP: Rect = { w: capP.w + 2 * pad, h: capP.h + 2 * pad, x: 0, y: 0 };
  const hitD: Rect = { w: capD.w + 2 * pad, h: capD.h + 2 * pad, x: 0, y: 0 };
  hitP.x = W - edge - hitP.w;
  hitP.y = H - edge - hitP.h;
  const margin = Math.max(6, g(10));
  let rStick = g(STICK.portrait / 2);
  const zonePad = g(STICK.zonePad);
  // the stick's grab zone never reaches PARRY's hit rectangle: on a very narrow screen the stick shrinks (the
  // existing narrow-screen rule; the caps keep their sizes)
  const stickAt = (r: number) => ({ x: margin + r, y: H - g(8) - r - 2 });
  while (rStick > 8 && rectHitsCircle(hitP, stickAt(rStick).x, stickAt(rStick).y, rStick + zonePad + 1)) rStick--;
  const sc = stickAt(rStick);
  const zone = rStick + zonePad;
  // DASH: left of PARRY (a gap between the hit rectangles), a little higher. Where the stick's grab zone is in the way
  // (narrow phones) it rises by the least amount that clears the zone: beside PARRY, or once it is fully above PARRY's
  // hit rectangle as far left (diagonal) as the zone allows.
  const xIdeal = hitP.x - gap - hitD.w;
  const yIdeal = hitP.y + Math.floor((hitP.h - hitD.h) / 2) - Math.round(S.stagger * capP.h);
  for (let y = yIdeal; y >= 0; y--) {
    const stacked = y + hitD.h + gap <= hitP.y;
    const xMax = stacked ? W - edge - hitD.w : xIdeal;
    const dy = Math.max(0, y - sc.y, sc.y - (y + hitD.h)); // vertical distance from the zone centre to the rectangle
    const reach = dy >= zone + 1 ? -Infinity : sc.x + Math.sqrt((zone + 1) ** 2 - dy * dy);
    const xMin = Math.max(edge, Math.ceil(reach + 1e-9));
    if (xMin <= xMax) {
      hitD.x = Math.max(Math.min(xIdeal, xMax), xMin);
      hitD.y = y;
      break;
    }
  }
  const wellR = rStick + 2; // the recessed well's rim is 2 px outside the base ring
  const controlsTop = Math.min(hitP.y, hitD.y, sc.y - wellR);
  const zoneTop = sc.y - zone;

  // ---- the lamp row: beside the raised DASH above the stick zone when it fits there, else above the controls
  const lampW = S.maxLamps * LAMP + (S.maxLamps - 1) * S.lampGap;
  let lampBand: Rect | null = null;
  const yB = zoneTop - 2 - LAMP;
  if (yB >= controlsTop && hitD.x - 2 - (edge + 2) >= lampW) lampBand = { x: edge + 2 + Math.floor((hitD.x - 2 - (edge + 2) - lampW) / 2), y: yB, w: lampW, h: LAMP };
  if (!lampBand) {
    let y = controlsTop - 2 - LAMP;
    // centred, moved clear of the stick zone's top (right of it), or above the zone when there is no room beside it
    let x = Math.floor((W - lampW) / 2);
    const band = (): Rect => ({ x, y, w: lampW, h: LAMP });
    if (rectHitsCircle(band(), sc.x, sc.y, zone + 1)) {
      let dyMax = 0; // the zone's widest point inside the band
      for (let yy = y; yy <= y + LAMP; yy++) dyMax = Math.max(dyMax, Math.sqrt(Math.max(0, (zone + 1) ** 2 - (yy - sc.y) ** 2)));
      x = Math.ceil(sc.x + dyMax) + 1;
      if (x + lampW > W - edge - 2) {
        x = Math.floor((W - lampW) / 2);
        y = Math.min(y, zoneTop - 2 - LAMP);
      }
    }
    lampBand = band();
  }
  const slotBottom = Math.min(controlsTop, lampBand.y, zoneTop) - 2; // the slot's outer rectangle ends above it
  const slot: Rect = { x: margin - 1, y: slotBottom - (BAR_H + 2), w: W - 2 * margin + 2, h: BAR_H + 2 };
  const deckTop = slot.y - 3;

  // ---- the bezel and the world window between the plate and the deck
  const B = S.bezel;
  const viewY = plateH + B;
  const view = { x: S.side + B, y: viewY, w: W - 2 * (S.side + B), h: Math.max(60, deckTop - B - viewY) };
  const bezel: Rect = { x: S.side, y: plateH, w: W - 2 * S.side, h: view.h + 2 * B };
  const zoom = zoomFor(view.h, k, zoomFloor);

  // ---- mirror (Left-handed: the stick and the caps swap corners; the decorations stay centred)
  const mx = (r: Rect): Rect => (leftHanded ? { ...r, x: W - r.x - r.w } : r);
  const btn = (id: 'parry' | 'dash', hit: Rect, cap: { w: number; h: number }): Btn => {
    const hr = mx(hit);
    const c: Rect = { x: hr.x + pad, y: hr.y + pad, w: cap.w, h: cap.h };
    return { id, x: c.x + c.w / 2, y: c.y + c.h / 2, r: Math.min(c.w, c.h) / 2, hit: Math.max(hr.w, hr.h) / 2, w: c.w, h: c.h, hitW: hr.w, hitH: hr.h, cap: c };
  };
  const stick: TouchStick = { x: leftHanded ? W - sc.x : sc.x, y: sc.y, r: rStick, knob: Math.min(g(STICK.knob / 2), Math.round(rStick * 0.5)), zone };
  return {
    W, H, hudH: plateH, view, zoom,
    bar: { x: margin, y: slot.y + 1, w: W - 2 * margin },
    buttons: [btn('parry', hitP, capP), btn('dash', hitD, capD)],
    stick,
    pause,
    pauseHit,
    shell: { plateH, bezel, bezelW: B, deckTop, slot, lampBand: mx(lampBand), title: titleRect },
  };
}
