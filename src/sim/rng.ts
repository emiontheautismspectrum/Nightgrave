/** mulberry32: tiny seeded PRNG. State is a uint32 kept inside SimState so snapshots are complete. */
export function nextU32(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform float in [0, 1). */
export function nextFloat(state: { rng: number }): number {
  return nextU32(state) / 4294967296;
}

/** Uniform float in [a, b). */
export function range(state: { rng: number }, a: number, b: number): number {
  return a + (b - a) * nextFloat(state);
}

/** Normalise any number into a valid uint32 seed. */
export function toSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}
