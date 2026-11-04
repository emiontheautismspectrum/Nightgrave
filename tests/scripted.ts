import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';

/**
 * A deterministic pseudo-player for tests: a cursor that wanders, plus parry/dash presses.
 * Uses its own LCG (tests may do anything; only src/sim must stay clean).
 */
export function mulberryInputs(seed: number, n: number): InputFrame[] {
  let x = seed >>> 0 || 1;
  const rnd = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
  const out: InputFrame[] = [];
  let tx = 240;
  let ty = 135;
  let useAxis = false;
  for (let i = 0; i < n; i++) {
    if (i % 45 === 0) {
      tx = Math.floor(rnd() * 480);
      ty = Math.floor(rnd() * 270);
      useAxis = rnd() < 0.3;
    }
    let buttons = 0;
    if (rnd() < 0.08) buttons |= BTN_PARRY;
    if (rnd() < 0.01) buttons |= BTN_DASH;
    out.push(
      useAxis
        ? { cursor: false, mx: Math.round((rnd() - 0.5) * 200), my: Math.round((rnd() - 0.5) * 200), buttons }
        : { cursor: true, mx: tx, my: ty, buttons },
    );
  }
  return out;
}
