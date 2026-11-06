/**
 * Touch controls as pure logic (no DOM, no Phaser): a relative-drag virtual trackpad plus on-screen buttons.
 * The output is the SAME per-tick input as the mouse (cursor target + buttons), so replays, determinism and fairness
 * are identical across platforms.
 *
 * Each touch is classified once at touchstart: on a button = that button; elsewhere = movement, or (if another finger
 * is already moving) a candidate parry tap. A tap = down and up within TAP_MS with < TAP_PX of movement. A single tap
 * of the only finger does nothing; a tap by a second finger parries when that setting is on.
 *
 * Stick mode (the default on touch): a FIXED joystick instead of the drag trackpad. A touch that starts inside the stick
 * zone grabs it (the knob follows the finger, clamped to the ring; release = centre) and its deflection is the AXIS
 * input (stickAxis, the same frames as keys / a gamepad); touches elsewhere (not on a button) do nothing.
 */
import { BTN_DASH, BTN_PARRY } from '../sim/input';
import { STICK, TOUCH_INPUT, type TouchSmoothing } from '../data/input';
import { getScreen } from '../web/screen';
import { PORTRAIT } from '../data/view';

export const TAP_MS = 200;
export const TAP_PX = 6;
/** Arena rect (x 48..432, y 27..243): buttons live in the side margins and never overlap it. */
export const ARENA = { x0: 48, y0: 27, x1: 432, y1: 243 };
export const VIEW_W = 480;

export interface TouchButton {
  id: 'parry' | 'dash';
  x: number;
  y: number;
  r: number;
  /** Hit radius (default r + 2). */
  hit?: number;
}

/**
 * Buttons in the right margin (left-handed: mirrored to the left margin). PARRY ~36 px across, DASH ~28 px above.
 * Zoomed phone-portrait view: both sit in the bottom strip under the world window (PARRY at the outer edge).
 */
export function touchButtons(leftHanded: boolean, view: 'full' | 'zoomed' = 'full'): TouchButton[] {
  if (view === 'zoomed') {
    const y = PORTRAIT.h - 26;
    const px = leftHanded ? 28 : PORTRAIT.w - 28;
    const dx = leftHanded ? 40 : -40;
    return [
      { id: 'parry', x: px, y, r: 18 },
      { id: 'dash', x: px + dx, y: y + 3, r: 14 },
    ];
  }
  const cx = leftHanded ? ARENA.x0 / 2 : VIEW_W - (VIEW_W - ARENA.x1) / 2;
  // hit areas of at least 44 CSS px across where the margin allows (24 px radius at most: inside the 48 px margin and
  // clear of each other, 50 px apart)
  const css = Math.max(0.1, getScreen().cssPerPx);
  const hit = (r: number) => Math.max(r + 2, Math.min(24, Math.ceil(22 / css)));
  return [
    { id: 'parry', x: cx, y: 222, r: 18, hit: hit(18) },
    { id: 'dash', x: cx, y: 172, r: 14, hit: hit(14) },
  ];
}

/** The fixed joystick (game px, screen space): base ring radius, knob radius, grab zone radius. */
export interface TouchStick {
  x: number;
  y: number;
  r: number;
  knob: number;
  zone: number;
}

/**
 * The landscape (full arena) stick: bottom corner of the side margin opposite the buttons (left; right when
 * left-handed). The base is STICK.landscape CSS px across when the 48 px margin holds it, else STICK.landscapeMin
 * (then it reaches a little over the arena's bottom corner; the arena is never blocked: it is drawn translucent).
 */
export function touchStick(leftHanded: boolean, cssPerPx = getScreen().cssPerPx): TouchStick {
  const css = Math.max(0.1, cssPerPx);
  const g = (c: number) => Math.ceil(c / css);
  const margin = ARENA.x0; // 48 game px
  const r = g(STICK.landscape) <= margin - 4 ? g(STICK.landscape / 2) : g(STICK.landscapeMin / 2);
  const x = leftHanded ? VIEW_W - 2 - r : 2 + r;
  return { x, y: 270 - 2 - r, r, knob: g(STICK.knob / 2), zone: r + g(STICK.zonePad) };
}

type Role = 'parry' | 'dash' | 'move' | 'tap' | 'stick' | 'none';
interface Touch {
  role: Role;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  moved: number;
  /** The screen layout changed under this finger: its next move only sets a new baseline. */
  rebase?: boolean;
  /** Finger movement not yet applied (below the jitter dead zone). */
  jx: number;
  jy: number;
}

export interface TouchOptions {
  sensitivity: number;
  leftHanded: boolean;
  secondFingerParry: boolean;
  /** Per-tick cursor smoothing (default 'off' when absent: the cursor follows the finger exactly). */
  smoothing?: TouchSmoothing;
  /** Stick mode: the fixed joystick moves the hero (axis frames); default false = the drag trackpad. */
  stick?: boolean;
}

export class TouchModel {
  /**
   * The virtual cursor RECORDED each tick (game px), or null until the first drag (then it starts at the hero). With
   * smoothing it follows `target` (where the finger points) by an exponential low-pass, advanced once per tick in
   * smoothTick(), BEFORE the frame is recorded: the replay holds the smoothed cursor and stays exact.
   */
  cursor: { x: number; y: number } | null = null;
  /** Where the finger drags the cursor to (sensitivity applied, jitter dead zone applied). */
  target: { x: number; y: number } | null = null;
  pending = 0;
  /** Screen layout of the buttons (game px): the full arena or the zoomed portrait view. */
  view: 'full' | 'zoomed' = 'full';
  /** The zoomed portrait view's buttons, sized for the real screen (src/render/portraitLayout.ts). */
  zoomedButtons: TouchButton[] | null = null;
  private touches = new Map<number, Touch>();
  /** Stick mode: where the stick is on the current screen (set by the scene for each view), the finger holding it and
   * the knob offset from the centre (game px, clamped to the ring). After a re-layout the held stick turns RELATIVE
   * (the knob moves by the finger's movement) until released: a moved stick never jumps to full deflection. */
  stickLayout: TouchStick | null = null;
  private stickId: number | null = null;
  private knob = { x: 0, y: 0 };
  private stickRelative = false;

  constructor(public opts: TouchOptions) {}

  /** The knob offset from the stick centre (game px), for drawing. */
  knobOffset(): { x: number; y: number } {
    return { ...this.knob };
  }

  stickHeld(): boolean {
    return this.stickId !== null;
  }

  /**
   * The stick's output in -1..1 (x, y): the deflection past the dead zone, rescaled so it starts from 0 at the dead-zone
   * edge and reaches 1 at the ring. [0, 0] when released or in Drag mode.
   */
  stickAxis(): [number, number] {
    const S = this.stickLayout;
    if (!this.opts.stick || !S || this.stickId === null) return [0, 0];
    const d = Math.hypot(this.knob.x, this.knob.y);
    const m = d / S.r;
    if (m <= STICK.deadZone || d === 0) return [0, 0];
    const out = Math.min(1, (m - STICK.deadZone) / (1 - STICK.deadZone));
    return [(this.knob.x / d) * out, (this.knob.y / d) * out];
  }

  private setKnob(x: number, y: number): void {
    const S = this.stickLayout;
    if (!S) return;
    const d = Math.hypot(x, y);
    const k = d > S.r ? S.r / d : 1;
    this.knob = { x: x * k, y: y * k };
  }

  private releaseStick(): void {
    this.stickId = null;
    this.knob = { x: 0, y: 0 };
    this.stickRelative = false;
  }

  /** A new run: the virtual cursor restarts at the hero on the next drag. */
  reset(): void {
    this.cursor = null;
    this.target = null;
    this.pending = 0;
    this.touches.clear();
    this.releaseStick();
  }

  buttons(): TouchButton[] {
    return this.view === 'zoomed' && this.zoomedButtons ? this.zoomedButtons : touchButtons(this.opts.leftHanded, this.view);
  }

  /** Which button (if any) is held right now (for the pressed look). */
  held(id: 'parry' | 'dash'): boolean {
    for (const t of this.touches.values()) if (t.role === id) return true;
    return false;
  }

  down(id: number, x: number, y: number, t: number, hero: { x: number; y: number }): Role {
    let role: Role = 'move';
    for (const b of this.buttons()) if ((x - b.x) ** 2 + (y - b.y) ** 2 <= (b.hit ?? b.r + 2) ** 2) role = b.id;
    const S = this.stickLayout;
    if (role === 'parry') this.pending |= BTN_PARRY;
    else if (role === 'dash') this.pending |= BTN_DASH;
    else if (this.opts.stick) {
      // Stick mode: only the stick zone moves the hero; any other touch (not a button) does nothing
      if (S && this.stickId === null && (x - S.x) ** 2 + (y - S.y) ** 2 <= S.zone ** 2) {
        role = 'stick';
        this.stickId = id;
        this.stickRelative = false;
        this.setKnob(x - S.x, y - S.y);
      } else role = 'none';
    } else if ([...this.touches.values()].some((o) => o.role === 'move')) role = 'tap';
    else {
      this.cursor ??= { x: hero.x, y: hero.y };
      this.target ??= { ...this.cursor };
    }
    this.touches.set(id, { role, x0: x, y0: y, x, y, t0: t, moved: 0, jx: 0, jy: 0 });
    return role;
  }

  /** The screen space changed (full arena <-> zoomed portrait view): held fingers re-anchor without moving the cursor. */
  rebase(): void {
    for (const t of this.touches.values()) {
      t.rebase = true;
      t.jx = 0;
      t.jy = 0;
    }
    // a held stick keeps its deflection and turns relative until released (no jump to the new centre's offset)
    if (this.stickId !== null) this.stickRelative = true;
  }

  move(id: number, x: number, y: number): void {
    const tc = this.touches.get(id);
    if (!tc) return;
    if (tc.rebase) {
      tc.rebase = false;
      tc.x = x;
      tc.y = y;
      tc.moved = TAP_PX; // never a tap after a re-layout
      return;
    }
    const dx = x - tc.x;
    const dy = y - tc.y;
    tc.x = x;
    tc.y = y;
    tc.moved = Math.max(tc.moved, Math.sqrt((x - tc.x0) ** 2 + (y - tc.y0) ** 2));
    if (tc.role === 'stick') {
      // the finger keeps the stick even when it slides off the zone, until it is lifted
      const S = this.stickLayout;
      if (!S) return;
      if (this.stickRelative) this.setKnob(this.knob.x + dx, this.knob.y + dy);
      else this.setKnob(x - S.x, y - S.y);
      return;
    }
    if (tc.role !== 'move' || !this.cursor) return; // buttons and tap candidates never move the hero
    this.target ??= { ...this.cursor };
    // finger jitter: movement below the dead zone is held back until it adds up (smoothing on only)
    tc.jx += dx;
    tc.jy += dy;
    const dz = this.smoothing() < 1 ? TOUCH_INPUT.deadZonePx : 0;
    if (dz > 0 && Math.hypot(tc.jx, tc.jy) < dz) return;
    const k = this.opts.sensitivity;
    this.target.x = Math.min(ARENA.x1, Math.max(ARENA.x0, this.target.x + tc.jx * k));
    this.target.y = Math.min(ARENA.y1, Math.max(ARENA.y0, this.target.y + tc.jy * k));
    tc.jx = 0;
    tc.jy = 0;
    if (this.smoothing() >= 1) this.cursor = { ...this.target };
  }

  private smoothing(): number {
    return TOUCH_INPUT.smoothing[this.opts.smoothing ?? 'off'];
  }

  /** One sim tick: the recorded cursor moves its share of the way to the finger's target (smoothing). */
  smoothTick(): void {
    if (!this.cursor || !this.target) return;
    const a = this.smoothing();
    if (a >= 1) {
      this.cursor = { ...this.target };
      return;
    }
    const nx = this.cursor.x + (this.target.x - this.cursor.x) * a;
    const ny = this.cursor.y + (this.target.y - this.cursor.y) * a;
    // settle exactly once within 0.25 px (no endless sub-pixel creep)
    this.cursor = Math.hypot(this.target.x - nx, this.target.y - ny) < 0.25 ? { ...this.target } : { x: nx, y: ny };
  }

  up(id: number, t: number): void {
    const tc = this.touches.get(id);
    if (!tc) return;
    this.touches.delete(id);
    if (id === this.stickId) this.releaseStick(); // spring back to the centre
    if (tc.role === 'tap' && this.opts.secondFingerParry && t - tc.t0 <= TAP_MS && tc.moved < TAP_PX) this.pending |= BTN_PARRY;
  }

  cancel(id: number): void {
    this.touches.delete(id);
    if (id === this.stickId) this.releaseStick();
  }

  /** Every finger is gone (app switch, focus loss, a new layout): nothing stays held. */
  releaseAll(): void {
    this.touches.clear();
    this.releaseStick();
  }

  /** Consume latched button presses for one tick. */
  take(): number {
    const b = this.pending;
    this.pending = 0;
    return b;
  }
}
