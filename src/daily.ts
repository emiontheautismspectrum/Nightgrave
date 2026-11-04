/**
 * Daily seed for Hard: everyone gets the same projectile sequence on the same UTC date.
 * Lives outside src/sim (it reads the clock); the sim only receives the resulting number.
 */
export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

/** FNV-1a of "nightgrave:YYYY-MM-DD" -> uint32 seed. */
export function dailySeed(dateKey: string): number {
  const src = `nightgrave:${dateKey}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}
