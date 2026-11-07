/**
 * "One of our text fields has the focus" (the board name / message fields, `data-ng="1"`), readable everywhere without
 * a layer inversion (src/main.ts, the input router, the submit panel). While a field is focused the page layout must
 * NOT be redone by viewport changes: on a phone they are the on-screen keyboard itself, and a relayout under the field
 * used to destroy it (the keyboard closed at once). When the focus leaves (blur, Enter, Esc, submit, the panel
 * closing), listeners get one call ~150 ms later (after the keyboard animation) to measure again.
 */

/** Is the focused element one of our text fields? (The DOM itself is the source of truth.) */
export function textFieldFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const a = document.activeElement;
  return !!a && a instanceof HTMLInputElement && a.dataset.ng === '1';
}

/**
 * Pure gate (unit-tested): should a layout request run now? `forced` (a real rotation) always runs; otherwise not while
 * a field is focused, and then a re-measure is owed for later.
 */
export function layoutGate(focused: boolean, forced: boolean, pending: boolean): { run: boolean; pending: boolean } {
  if (forced || !focused) return { run: true, pending: false };
  return { run: false, pending: true };
}

/** After the keyboard animation: wait this long after the focus left before measuring again. */
export const REMEASURE_MS = 150;

const ended = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Called once, REMEASURE_MS after a field lost the focus (and nothing else of ours took it). */
export function onTextFocusEnd(f: () => void): () => void {
  ended.add(f);
  return () => ended.delete(f);
}

/** A field lost the focus (or was removed while focused): schedule the re-measure. */
export function textFocusEnded(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (textFieldFocused()) return; // focus moved to the other field: still typing
    for (const f of ended) f();
  }, REMEASURE_MS);
}

let installed = false;
/** Watch focus leaving our fields (document-level focusout: every element with data-ng="1"). */
export function installTextFocusWatch(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.dataset.ng === '1') textFocusEnded();
  });
}
