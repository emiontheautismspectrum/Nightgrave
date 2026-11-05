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
  return [
    { id: 'parry', x: cx, y: 222, r: 18 },
    { id: 'dash', x: cx, y: 182, r: 14 },
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
}

export interface TouchOptions {
  sensitivity: number;
  leftHanded: boolean;
  secondFingerParry: boolean;
}

export class TouchModel {
  /** Virtual cursor in game px, or null until the first drag (then it starts at the hero). */
  cursor: { x: number; y: number } | null = null;
  pending = 0;
  /** Screen layout of the buttons (game px): the full arena or the zoomed portrait view. */
  view: 'full' | 'zoomed' = 'full';
  private touches = new Map<number, Touch>();

  constructor(public opts: TouchOptions) {}

  /** A new run: the virtual cursor restarts at the hero on the next drag. */
  reset(): void {
    this.cursor = null;
    this.pending = 0;
    this.touches.clear();
  }

  buttons(): TouchButton[] {
    return touchButtons(this.opts.leftHanded, this.view);
  }

  /** Which button (if any) is held right now (for the pressed look). */
  held(id: 'parry' | 'dash'): boolean {
    for (const t of this.touches.values()) if (t.role === id) return true;
    return false;
  }

  down(id: number, x: number, y: number, t: number, hero: { x: number; y: number }): Role {
    let role: Role = 'move';
    for (const b of this.buttons()) if ((x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r + 2) ** 2) role = b.id;
    if (role === 'parry') this.pending |= BTN_PARRY;
    else if (role === 'dash') this.pending |= BTN_DASH;
    else if ([...this.touches.values()].some((o) => o.role === 'move')) role = 'tap';
    else this.cursor ??= { x: hero.x, y: hero.y };
    this.touches.set(id, { role, x0: x, y0: y, x, y, t0: t, moved: 0 });
    return role;
  }

  /** The screen space changed (full arena <-> zoomed portrait view): held fingers re-anchor without moving the cursor. */
  rebase(): void {
    for (const t of this.touches.values()) t.rebase = true;
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
    const k = this.opts.sensitivity;
    this.cursor.x = Math.min(ARENA.x1, Math.max(ARENA.x0, this.cursor.x + dx * k));
    this.cursor.y = Math.min(ARENA.y1, Math.max(ARENA.y0, this.cursor.y + dy * k));
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
