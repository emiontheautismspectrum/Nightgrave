/**
 * Phones: a full-screen board overlay with the same content as the desktop panel, opened by the "Board" button on the
 * title and on the death panel. A back button (and Esc / the gamepad B through the scenes) closes it; the list scrolls
 * by dragging. Never shown during a run. All text via textContent (CSP: no inline styles or scripts).
 */
import { BoardPanel } from './boardPanel';
import { isInRun, onRunChange } from './runFlag';
import { onLangChange, t } from '../i18n';

let root: HTMLDivElement | null = null;
let panel: BoardPanel | null = null;

export const boardOverlayOpen = (): boolean => !!root && !root.hidden;

export function closeBoardOverlay(): void {
  if (root) root.hidden = true;
  panel?.stop();
}

export function openBoardOverlay(): void {
  if (isInRun()) return;
  if (!root) {
    root = document.createElement('div');
    root.className = 'bover';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', t('panel.aria'));
    const bar = document.createElement('div');
    bar.className = 'bover-bar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'bover-back';
    back.textContent = t('overlay.back');
    back.addEventListener('click', closeBoardOverlay);
    // the overlay lives as long as the page: a language switch re-labels it (the panel re-renders itself)
    onLangChange(() => {
      root?.setAttribute('aria-label', t('panel.aria'));
      back.textContent = t('overlay.back');
    });
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
