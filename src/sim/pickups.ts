/**
 * Map pickups (CLAUDE.md "Pickups"): Slow Time (teal) and Double Score (gold). Seeded, rare, at most one on the map.
 * Taking the same kind again refreshes its timer (no stacking of strength).
 */
import { PORTAL, PROP_ANCHORS, ARENA_LAYOUT } from '../data/arena';
import { ticks, type SimParams } from './params';
import { nextFloat, range } from './rng';
import type { PickupKind, SimState } from './state';

const d2 = (ax: number, ay: number, bx: number, by: number): number => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const PORTAL_CLEAR = (ARENA_LAYOUT as { portalClearRadius?: number }).portalClearRadius ?? 20;

export const isSlow = (s: SimState): boolean => s.tick < s.slowUntil;
export const isDouble = (s: SimState): boolean => s.tick < s.doubleUntil;

/** May a pickup spawn now? Never while the boss is close to defeat (<= pickupBlockSegments left) or dying. */
function spawnAllowed(s: SimState, p: SimParams): boolean {
  const b = s.boss;
  return !b || (b.deathTick < 0 && b.remaining > p.bosses.pickupBlockSegments);
}

/** Is (x, y) a legal pickup spot right now? (Exported for tests.) */
export function pickupSpotOk(s: SimState, p: SimParams, x: number, y: number): boolean {
  const c = p.pickups;
  if (x < p.x0 + c.edgeInset || x > p.x1 - c.edgeInset || y < p.y0 + c.edgeInset || y > p.y1 - c.edgeInset) return false;
  if (d2(x, y, s.hero.x, s.hero.y) < c.minHeroDist * c.minHeroDist) return false;
  if (d2(x, y, PORTAL.x, PORTAL.y) < (PORTAL_CLEAR + c.radius) * (PORTAL_CLEAR + c.radius)) return false;
  for (const [ax, ay, r] of PROP_ANCHORS) if (d2(x, y, ax, ay) < (r + c.propClear) * (r + c.propClear)) return false;
  return true;
}

function trySpawn(s: SimState, p: SimParams): void {
  const c = p.pickups;
  const kind: PickupKind = nextFloat(s) * (c.slowTime.weight + c.doubleScore.weight) < c.slowTime.weight ? 'slow' : 'double';
  for (let i = 0; i < 10; i++) {
    const x = Math.round(range(s, p.x0 + c.edgeInset, p.x1 - c.edgeInset));
    const y = Math.round(range(s, p.y0 + c.edgeInset, p.y1 - c.edgeInset));
    if (!pickupSpotOk(s, p, x, y)) continue;
    s.pickup = { id: s.nextId++, kind, x, y, born: s.tick, expires: s.tick + ticks(c.lifeSeconds) };
    s.events.push({ type: 'pickup_spawn', id: s.pickup.id, kind });
    return;
  }
}

/** One pickup tick: expire, collect (walk-over), schedule and spawn. Runs after the hero moved. */
export function runPickups(s: SimState, p: SimParams): void {
  const c = p.pickups;
  const t = s.tick;
  const pk = s.pickup;
  if (pk) {
    if (d2(pk.x, pk.y, s.hero.x, s.hero.y) <= c.radius * c.radius) {
      if (pk.kind === 'slow') s.slowUntil = t + ticks(c.slowTime.seconds);
      else s.doubleUntil = t + ticks(c.doubleScore.seconds);
      s.pickupScore += c.points;
      s.pickup = null;
      s.events.push({ type: 'pickup_take', id: pk.id, kind: pk.kind, x: pk.x, y: pk.y });
    } else if (t >= pk.expires) {
      s.pickup = null;
      s.events.push({ type: 'pickup_expire', id: pk.id });
    }
  }
  if (t >= s.pickupAt) {
    // the next attempt is scheduled from now, whether or not this one succeeds
    s.pickupAt = t + ticks(range(s, c.intervalMinSeconds, c.intervalMaxSeconds));
    if (!s.pickup && spawnAllowed(s, p)) trySpawn(s, p);
  }
}
