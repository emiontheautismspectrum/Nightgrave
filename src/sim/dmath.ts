/**
 * Deterministic math for the simulation. Only +, -, *, / and Math.sqrt are used: these are exactly
 * specified by IEEE 754 in every JS engine, unlike Math.sin/cos/atan2/pow/hypot whose precision is
 * implementation-defined and would break cross-machine replay verification.
 */
export const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** sin(x) via range reduction to [-pi/2, pi/2] and an odd Taylor polynomial (error < 1e-9). */
export function dsin(x: number): number {
  if (!Number.isFinite(x)) return 0;
  // reduce to [-pi, pi]
  x = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  // Horner form of x - x^3/3! + x^5/5! - ... - x^15/15!
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** Rotate vector (x, y) by angle a (radians). */
export function rotate(x: number, y: number, a: number): [number, number] {
  const c = dcos(a);
  const s = dsin(a);
  return [x * c - y * s, x * s + y * c];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
