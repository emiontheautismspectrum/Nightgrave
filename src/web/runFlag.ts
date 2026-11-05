/**
 * Page state shared by the Phaser scenes and the HTML around the canvas (no Phaser, no DOM here).
 * - Is a run being played? The board panel never fetches during a run, the phone board overlay closes.
 * - The game asks the page to lay out again (the canvas size changed: full arena <-> zoomed portrait view).
 */
let inRun = false;
const listeners = new Set<(inRun: boolean) => void>();
export const isInRun = (): boolean => inRun;
export function setInRun(v: boolean): void {
  if (inRun === v) return;
  inRun = v;
  for (const f of listeners) f(v);
}
export function onRunChange(f: (inRun: boolean) => void): void {
  listeners.add(f);
}

let relayoutFn: () => void = () => undefined;
/** main.ts registers the page layout here. */
export function setRelayout(f: () => void): void {
  relayoutFn = f;
}
export function requestRelayout(): void {
  relayoutFn();
}
