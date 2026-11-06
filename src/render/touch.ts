/**
 * Touch controls as pure logic (no DOM, no Phaser): a relative-drag virtual trackpad plus on-screen buttons.
 * The output is the SAME per-tick input as the mouse (cursor target + buttons), so replays, determinism and fairness
 * are identical across platforms.
 *
 * Each touch is classified once at touchstart: on a button = that button; elsewhere = movement, or (if another finger
 * is already moving) a candidate parry tap. A tap = down and up within TAP_MS with < TAP_PX of movement. A single tap
 * of the only finger does nothing; a tap by a second finger parries when that setting is on.
 */
import { BTN_DASH, BTN_PARRY } from '../sim/input';
import { TOUCH_INPUT, type TouchSmoothing } from '../data/input';
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

type Role = 'parry' | 'dash' | 'move' | 'tap';
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

  constructor(public opts: TouchOptions) {}

  /** A new run: the virtual cursor restarts at the hero on the next drag. */
  reset(): void {
    this.cursor = null;
    this.target = null;
    this.pending = 0;
    this.touches.clear();
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
    if (role === 'parry') this.pending |= BTN_PARRY;
    else if (role === 'dash') this.pending |= BTN_DASH;
    else if ([...this.touches.values()].some((o) => o.role === 'move')) role = 'tap';
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
    if (tc.role === 'tap' && this.opts.secondFingerParry && t - tc.t0 <= TAP_MS && tc.moved < TAP_PX) this.pending |= BTN_PARRY;
  }

  cancel(id: number): void {
    this.touches.delete(id);
  }

  /** Consume latched button presses for one tick. */
  take(): number {
    const b = this.pending;
    this.pending = 0;
    return b;
  }
}
