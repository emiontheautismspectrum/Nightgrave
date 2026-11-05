/** Is a run being played right now? The board panel never fetches during a run. */
let inRun = false;
export const isInRun = (): boolean => inRun;
export function setInRun(v: boolean): void {
  inRun = v;
}
