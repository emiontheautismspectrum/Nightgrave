/**
 * Phones: a full-screen board overlay with the same content as the desktop panel, opened by the "Board" button on the
 * title and on the death panel. A back button (and Esc / the gamepad B through the scenes) closes it; the list scrolls
 * by dragging. Never shown during a run. All text via textContent (CSP: no inline styles or scripts).
 */
import { BoardPanel } from './boardPanel';
import { isInRun, onRunChange } from './runFlag';

let root: HTMLDivElement | null = null;
let panel: BoardPanel | null = null;

export const boardOverlayOpen = (): boolean => !!root && !root.hidden;

export function closeBoardOverlay(): void {
  if (root) root.hidden = true;
}

export function openBoardOverlay(): void {
  if (isInRun()) return;
  if (!root) {
    root = document.createElement('div');
    root.className = 'bover';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', "Today's Hard best");
    const bar = document.createElement('div');
    bar.className = 'bover-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'bover-back';
    back.textContent = '< BACK';
    back.addEventListener('click', closeBoardOverlay);
    bar.append(back);
    const scroll = document.createElement('div');
    scroll.className = 'bover-scroll';
    panel = new BoardPanel('bpanel');
    scroll.append(panel.root);
    dragScroll(scroll);
    root.append(bar, scroll);
    document.body.append(root);
  }
  root.hidden = false;
  panel?.start();
  void panel?.refresh();
  root.querySelector<HTMLButtonElement>('.bover-back')?.focus();
}

/** Touch scrolls natively (overflow-y: auto); a mouse or pen drag scrolls too. */
function dragScroll(el: HTMLElement): void {
  let y0 = -1;
  let top0 = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    y0 = e.clientY;
    top0 = el.scrollTop;
  });
  el.addEventListener('pointermove', (e) => {
    if (y0 >= 0) el.scrollTop = top0 - (e.clientY - y0);
  });
  const end = () => (y0 = -1);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
}

/** Esc closes the overlay; while it is open no key reaches the game or its menus. */
export function initBoardOverlay(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!boardOverlayOpen()) return;
      if (e.key === 'Escape' || e.key === 'Backspace') closeBoardOverlay();
      if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );
  onRunChange((r) => r && closeBoardOverlay());
}
