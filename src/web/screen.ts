/**
 * What the scenes need to know about the real screen (no Phaser, no DOM): set by main.ts after every layout.
 * - cssPerPx: CSS px per game px of the canvas (touch targets are sized in CSS px);
 * - phone / portrait: the touch layouts;
 * - portrait: the game size for a phone in portrait (from the REAL viewport aspect, crisp integer scale);
 * - safe: the notch / home-indicator insets in game px (HUD, buttons and menu rows stay inside).
 */
export interface ScreenInfo {
  cssPerPx: number;
  phone: boolean;
  portrait: boolean;
  /** Game size (game px) to use for a phone in portrait; also the device px per game px. */
  portraitSize: { w: number; h: number; k: number };
  safe: { t: number; b: number; l: number; r: number };
}

let info: ScreenInfo = { cssPerPx: 2, phone: false, portrait: false, portraitSize: { w: 270, h: 600, k: 4 }, safe: { t: 0, b: 0, l: 0, r: 0 } };
const listeners = new Set<() => void>();

export const getScreen = (): ScreenInfo => info;

let notifying = false;
let pending = false;
export function setScreen(next: ScreenInfo): void {
  const changed = JSON.stringify(next) !== JSON.stringify(info);
  info = next;
  if (!changed) return;
  // a listener may lay the page out again (and so call setScreen): notify once more afterwards, never re-entrantly
  if (notifying) {
    pending = true;
    return;
  }
  notifying = true;
  try {
    do {
      pending = false;
      for (const f of listeners) f();
    } while (pending);
  } finally {
    notifying = false;
  }
}

/** Called when the screen info changed (rotation, browser bars, resize). Returns an unsubscribe function. */
export function onScreenChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/**
 * The game size of a phone in portrait for a viewport of vw x vh CSS px (after the safe insets): about 280 game px
 * wide at an INTEGER number of device px per game px (crisp pixels), as tall as the viewport allows, and a size whose
 * CSS size is exact on the browser's 1/64 px grid (exactSize). The 16 px menu font
 * then fits ~16 characters per row and is ~20 CSS px tall.
 */
export function portraitGameSize(vw: number, vh: number, dprIn: number): { w: number; h: number; k: number } {
  const dpr = Math.max(0.5, dprIn || 1);
  const devW = Math.floor(vw * dpr);
  const devH = Math.floor(vh * dpr);
  const k = Math.max(1, Math.round(devW / 280));
  return { w: exactSize(Math.floor(devW / k), k, dpr), h: exactSize(Math.floor(devH / k), k, dpr), k };
}

/**
 * The largest game size <= n (at most 24 px less) whose CSS size n * k / dpr lies exactly on the browser's 1/64 CSS px
 * layout grid. Without it the browser rounds the canvas CSS size and stretches it by a NON-integer factor (soft
 * pixels): e.g. an iPhone 14 (390 CSS px, DPR 3) gave 292 x 4 / 3 = 389.333 CSS px -> 1167.98 device px instead of
 * 1168 (k = 3.9999). 291 x 4 / 3 = 388 is exact. The device px left over are margin.
 */
export function exactSize(n: number, k: number, dpr: number): number {
  const on = (m: number) => {
    const v = (m * k * 64) / dpr;
    return Math.abs(v - Math.round(v)) < 1e-6;
  };
  for (let m = n; m > 0 && n - m <= 24; m--) if (on(m)) return m;
  return n;
}
