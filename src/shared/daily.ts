/**
 * Daily seed for Hard: everyone gets the same projectile sequence on the same UTC date.
 * Shared by the game and the Worker (pure: no clock, no DOM). The caller passes the date.
 */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/** Milliseconds of 00:00 UTC of a YYYY-MM-DD date (NaN if malformed). */
export function dayStartMs(dateKey: string): number {
  if (!DATE_RE.test(dateKey)) return NaN;
  const t = Date.parse(`${dateKey}T00:00:00.000Z`);
  return utcDateKey(new Date(t)) === dateKey ? t : NaN; // rejects 2026-02-31
}

export function addDays(dateKey: string, days: number): string {
  return utcDateKey(new Date(dayStartMs(dateKey) + days * 86_400_000));
}
