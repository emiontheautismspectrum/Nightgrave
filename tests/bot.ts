/**
 * A heuristic test player. It only READS sim state and produces inputs, like a human would.
 * Not part of the game; used by tests (the balance report, npm run bot, is tools/bot/balance.ts with the skilled bot).
 */
import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { inParryZone } from '../src/sim/parryZone';
import { dashCooldownLeft, isFading, parryCooldownLeft, type Sim } from '../src/sim/sim';
import type { Ring } from '../src/sim/state';
import { breakBound, inRingGap } from '../src/sim/tollerMoves';

export interface BotOptions {
  /** false = dodge-only bot (never presses parry). Default true. */
  parry?: boolean;
  /** Dash across a beam sweeping in from the front (the skilled bot). Default false. */
  beamDash?: boolean;
  /**
   * Hex knots (FEATURES.knot only): walk to a knot that can be reached before its fuse ends, parry it, and step away
   * from one about to burst. Default true; false = ignore knots entirely (the walking-only fairness solver). Nothing
   * of this runs while no knot exists, so the bot plays exactly as before without the block.
   */
  knots?: boolean;
  /**
   * The Toller's rings (FEATURES.bossMoves only): the caller (the skilled bot) parries a ring itself when its parry is
   * ready in time, so this bot does not dash across that ring. Default false: dash across every ring (and parry it when
   * the pulse covers it, if `parry`).
   */
  ringParry?: boolean;
}

/**
 * The Toller's ring coming at the hero (FEATURES.bossMoves only): the most urgent band that is not passing through a
 * gap at the hero's angle. ticks = until its band touches the hero; (nx, ny) = its point nearest the hero; (ux, uy) =
 * the way across the band (a dash that way crosses it).
 */
export function ringAhead(sim: Sim): { ticks: number; gap: number; nx: number; ny: number; ux: number; uy: number; ring: Ring } | null {
  const s = sim.state;
  const p = sim.params;
  const h = s.hero;
  let best: { ticks: number; gap: number; nx: number; ny: number; ux: number; uy: number; ring: Ring } | null = null;
  for (const ring of s.rings ?? []) {
    const d = Math.hypot(h.x - ring.x, h.y - ring.y) || 1e-6;
    const ux = (h.x - ring.x) / d;
    const uy = (h.y - ring.y) / d;
    const outward = ring.phase === 'grow';
    if (outward ? ring.r > d + ring.halfWidth + p.heroRadius : ring.r < d - ring.halfWidth - p.heroRadius) continue; // passed
    if (inRingGap(ring, ux, uy, d, p.heroRadius + 1)) continue; // it passes through a gap here
    const gap = Math.max(0, Math.abs(d - ring.r) - ring.halfWidth - p.heroRadius);
    const ticks = ring.phase === 'hold' ? ring.holdUntil - s.tick + gap / ring.back : gap / (outward ? ring.speed : ring.back);
    const dir = outward ? -1 : 1; // across the band: towards the centre (it grows) or away from it (it returns)
    if (!best || ticks < best.ticks) best = { ticks, gap, nx: ring.x + ux * ring.r, ny: ring.y + uy * ring.r, ux: ux * dir, uy: uy * dir, ring };
  }
  return best;
}

/** A briar line ahead of the hero (FEATURES.briar): ticks until it touches the hero, and the gap error across it. */
export function wallAhead(sim: Sim): { tc: number; err: number; w: NonNullable<Sim['state']['walls']>[number] } | null {
  const s = sim.state;
  const p = sim.params;
  const h = s.hero;
  let best: { tc: number; err: number; w: NonNullable<Sim['state']['walls']>[number] } | null = null;
  for (const w of s.walls ?? []) {
    const a = w.axis === 'x' ? h.x : h.y;
    const c = w.axis === 'x' ? h.y : h.x;
    const da = (a - w.pos) * w.dir - (w.halfWidth + p.heroRadius); // > 0: not touched yet
    if (da < -(w.halfWidth + p.heroRadius) * 2) continue; // passed
    const tc = Math.max(0, da) / w.speed + Math.max(0, w.move - s.tick);
    if (!best || tc < best.tc) best = { tc, err: w.gap - c, w };
  }
  return best;
}

/** A briar line will reach the hero within `ticks` (the bots stop chasing pickups and turning then). */
export const wallSoon = (sim: Sim, ticks: number): boolean => (sim.state.walls?.length ? (wallAhead(sim)?.tc ?? Infinity) < ticks : false);

/** Ticks a knot hunt keeps in hand: a knot is chased only if the hero reaches it this long before its fuse ends. */
export const KNOT_MARGIN = 12;

/** The knot the bot goes for: the nearest one it can reach (inside half its parry radius) before the fuse ends. */
export function knotTarget(sim: Sim): { x: number; y: number; r: number; id: number; burst: number } | null {
  const s = sim.state;
  const p = sim.params;
  const h = s.hero;
  let best: { x: number; y: number; r: number; id: number; burst: number } | null = null;
  let bd = Infinity;
  for (const k of s.knots ?? []) {
    const d = Math.hypot(k.x - h.x, k.y - h.y);
    const reach = Math.max(0, d - p.parryRadius * 0.5) / p.heroSpeed;
    if (reach + KNOT_MARGIN > k.burst - s.tick) continue;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Eye beam threat (wind-up or active): start line, rotation sign. The side behind the start line is never swept. */
function beamThreat(sim: Sim): { x: number; y: number; dx: number; dy: number; sign: number } | null {
  const s = sim.state;
  const b = s.boss;
  if (b?.attack?.pattern === 'beam' && s.tick >= b.attack.windStart)
    return { x: b.x, y: b.y, dx: b.attack.dirX, dy: b.attack.dirY, sign: b.attack.sign };
  // the Toller's pendulum (FEATURES.bosses.toller only): its two passes sweep the same wedge out and back, so the
  // safe side is behind the START line for the whole attack (never behind the moving line)
  if (b?.kind === 'toller') {
    if (b.attack?.pattern === 'pendulum' && s.tick >= b.attack.windStart) return { x: b.x, y: b.y, dx: b.attack.dirX, dy: b.attack.dirY, sign: b.attack.sign };
    const bm = s.beams[0];
    if (bm) {
      const w = Math.atan2(bm.turnS, bm.turnC);
      const back = b.pending?.some((e) => e.op === 'swing' && e.serial === bm.serial);
      // pass 1: turn back by the rotations so far; pass 2: forward by the rotations still to come
      const k = back ? -Math.max(0, s.tick - 1 - bm.start) : Math.max(0, bm.end - s.tick);
      const c = Math.cos(k * w);
      const sn = Math.sin(k * w);
      const sign = back ? (w >= 0 ? 1 : -1) : w >= 0 ? -1 : 1;
      return { x: bm.x, y: bm.y, dx: bm.dirX * c - bm.dirY * sn, dy: bm.dirX * sn + bm.dirY * c, sign };
    }
  }
  const bm = s.beams[0];
  if (bm) return { x: bm.x, y: bm.y, dx: bm.dirX, dy: bm.dirY, sign: bm.turnS >= 0 ? 1 : -1 };
  return null;
}

/**
 * The Toller's rings (FEATURES.bosses.toller only): every toll ring and knell ring flies radially from the bell, so
 * sidesteps from single shots cancel out. Against the most imminent ring that the hero will not parry (a knell
 * always; a toll ring when the parry will not be ready), the bot slides along its circle around the bell to the
 * middle between the two shots that bracket it (a gap of the ring, or simply the space between two shots).
 * Returns that point, or null. Nothing of this runs without a Toller.
 */
export function ringSlot(sim: Sim, parry: boolean): { x: number; y: number; t: number; ids: Set<number> } | null {
  const s = sim.state;
  const p = sim.params;
  const b = s.boss;
  if (!b || b.kind !== 'toller') return null;
  const h = s.hero;
  const dh = Math.hypot(h.x - b.x, h.y - b.y) || 1;
  const ha = Math.atan2(h.y - b.y, h.x - b.x);
  // every ring shot still on its way to the hero's circle around the bell (each by its own radius: the 60 px rule may
  // have moved some forward), arriving within a human reaction; a violet one only if the parry will not be ready
  const shots: { a: number; t: number; id: number }[] = [];
  for (const pr of s.projectiles) {
    if (pr.boss <= 0) continue;
    const r = Math.hypot(pr.x - b.x, pr.y - b.y);
    if (r > dh + 4) continue; // passed
    const t = (dh - r) / (Math.hypot(pr.vx, pr.vy) || 1);
    if (t > 30) continue; // a human-like reaction: only the shots about to arrive
    if (pr.parryable && parry && parryCooldownLeft(s, p) < t - 2) continue; // it will be parried
    shots.push({ a: ((Math.atan2(pr.y - b.y, pr.x - b.x) - ha + 3 * Math.PI) % (2 * Math.PI)) - Math.PI, t, id: pr.id });
  }
  if (shots.length < 2) return null;
  // the shots just below and above the hero's angle (wrapping around): the space between them
  let lo = -Infinity;
  let hi = Infinity;
  for (const x of shots) {
    if (x.a <= 0 && x.a > lo) lo = x.a;
    if (x.a > 0 && x.a < hi) hi = x.a;
  }
  if (lo === -Infinity) lo = Math.max(...shots.map((x) => x.a)) - 2 * Math.PI;
  if (hi === Infinity) hi = Math.min(...shots.map((x) => x.a)) + 2 * Math.PI;
  const mid = ha + (lo + hi) / 2;
  return { x: b.x + Math.cos(mid) * dh, y: b.y + Math.sin(mid) * dh, t: Math.min(...shots.map((x) => x.t)), ids: new Set(shots.map((x) => x.id)) };
}

export function botInput(sim: Sim, opts: BotOptions = {}): InputFrame {
  const s = sim.state;
  const p = sim.params;
  const h = s.hero;
  let buttons = 0;
  let fx = 0;
  let fy = 0;
  let dashAway: [number, number] | null = null;
  let nearT = Infinity;
  let nearPerp: [number, number] = [0, 0];
  let parryTarget = false;
  // the Toller's rings (FEATURES.bosses.toller only): the ring the bot slides into is handled by the slide alone (the
  // single-shot sidesteps of its radial shots flip sign every tick and cancel out)
  const slot0 = s.boss?.kind === 'toller' ? ringSlot(sim, opts.parry !== false) : null;
  for (const pr of s.projectiles) {
    if (isFading(s, pr)) continue;
    if (slot0?.ids.has(pr.id)) {
      if (pr.parryable && inParryZone(h.x, h.y, h.aimX, h.aimY, pr.x, pr.y, pr.radius - 3, p) >= 0) parryTarget = true;
      continue;
    }
    const rx = pr.x - h.x;
    const ry = pr.y - h.y;
    const d = Math.sqrt(rx * rx + ry * ry);
    // inside the hero's real parry zone (radius and arc around its aim) with a 3 px margin
    if (pr.parryable && inParryZone(h.x, h.y, h.aimX, h.aimY, pr.x, pr.y, pr.radius - 3, p) >= 0) parryTarget = true;
    // homing threats (wraiths): keep running away from them; the straight-line prediction below cannot see them coming
    if (pr.homing > 0 && d < 56) {
      fx -= (rx / (d || 1)) * (2 / (d / 10 + 1));
      fy -= (ry / (d || 1)) * (2 / (d / 10 + 1));
    }
    // closest approach assuming the hero stands still
    const v2 = pr.vx * pr.vx + pr.vy * pr.vy || 1e-9;
    const t = Math.max(0, -(rx * pr.vx + ry * pr.vy) / v2);
    const cx = rx + pr.vx * t;
    const cy = ry + pr.vy * t;
    const miss = Math.sqrt(cx * cx + cy * cy);
    const danger = p.heroRadius + pr.radius + 6;
    if (miss < danger && t < 45) {
      // step sideways away from the closest-approach point
      let ax = -cx;
      let ay = -cy;
      if (miss < 0.5) [ax, ay] = [-pr.vy, pr.vx];
      const al = Math.sqrt(ax * ax + ay * ay) || 1;
      const w = (pr.parryable ? 1 : 2.5) / (t + 4);
      fx += (ax / al) * w;
      fy += (ay / al) * w;
      if (t < nearT) {
        nearT = t;
        nearPerp = [-pr.vy, pr.vx];
      }
      if (!pr.parryable && t < 10) {
        const vl = Math.sqrt(v2);
        dashAway = [-pr.vy / vl, pr.vx / vl];
        if (dashAway[0] * -cx + dashAway[1] * -cy < 0) dashAway = [-dashAway[0], -dashAway[1]];
      }
    }
  }
  // hex knots (FEATURES.knot): parry one that is inside the zone, walk to the one in reach, keep clear of a burst
  const knots = s.knots;
  if (knots && knots.length && opts.knots !== false) {
    for (const k of knots) {
      if (inParryZone(h.x, h.y, h.aimX, h.aimY, k.x, k.y, k.r - 2, p) >= 0) parryTarget = true;
      const rx = h.x - k.x;
      const ry = h.y - k.y;
      const d = Math.sqrt(rx * rx + ry * ry) || 1;
      if (k.burst - s.tick < 30 && d < 48) {
        fx += (rx / d) * 3;
        fy += (ry / d) * 3;
      }
    }
    const kt = knotTarget(sim);
    if (kt) {
      const dx = kt.x - h.x;
      const dy = kt.y - h.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      // a firm pull (stronger than the pull to the centre, weaker than a close shot) until it is well inside the zone
      // (only half as hard while a shot is closing in within 0.5 s: the hunt never outweighs a dodge)
      const w = d > p.parryRadius * 0.4 ? (nearT < 30 ? 0.12 : 0.5) : 0;
      fx += (dx / d) * w - (p.cx - h.x) * 0.002;
      fy += (dy / d) * w - (p.cy - h.y) * 0.002;
    }
  }
  // the Toller's rings and chains (FEATURES.bossMoves only): parry a ring the pulse covers, dash across one about to
  // touch; a bound bot obeys the bind (parries when parry-bound, dashes out when iron-bound)
  const bound = s.chain && s.chain.bound ? s.chain : null;
  const mayParry = opts.parry !== false || (!!s.chain && breakBound(s));
  const ra = s.rings && s.rings.length ? ringAhead(sim) : null;
  if (ra && mayParry && inParryZone(h.x, h.y, h.aimX, h.aimY, ra.nx, ra.ny, ra.ring.halfWidth - 1, p) >= 0) parryTarget = true;
  if (parryTarget && mayParry && parryCooldownLeft(s, p) === 0) buttons |= BTN_PARRY;
  // beam: get behind its start line (opposite to the rotation) and stay there until it is over
  const bt = beamThreat(sim);
  if (bt) {
    const nx = bt.dy * bt.sign; // unit normal pointing to the side the beam rotates away from
    const ny = -bt.dx * bt.sign;
    const c = (h.x - bt.x) * nx + (h.y - bt.y) * ny;
    if (c < 14) {
      fx += nx * 3;
      fy += ny * 3;
    }
    // the sweep is about to reach us from the front: dash across it to the safe side (dash i-frames)
    const active = sim.state.beams.length > 0 || ((sim.state.boss?.attack?.pattern === 'beam' || sim.state.boss?.attack?.pattern === 'pendulum') && sim.state.boss.attack.fire - sim.state.tick <= 4);
    if (opts.beamDash && active && c < 0 && c > -18) dashAway = [nx, ny];
  }
  // blood sigils: keep out of the circle while it is telegraphed or lethal; dash out if caught inside a lethal one
  for (const g of sim.state.sigils) {
    if (sim.state.tick >= g.end) continue;
    const rx = h.x - g.x;
    const ry = h.y - g.y;
    const d = Math.sqrt(rx * rx + ry * ry) || 1;
    if (d < g.r + 12) {
      fx += (rx / d) * 4;
      fy += (ry / d) * 4;
      if (sim.state.tick >= g.fill - 3 && d < g.r + p.heroRadius + 1) dashAway = [rx / d, ry / d];
    }
  }
  // the Lich's grasp hands (FEATURES.bossMoves only): keep out of a lit hand, it bursts into blades where it stands
  const gb = s.boss;
  if (gb && gb.kind === 'lich' && (gb.attack?.pattern === 'grasp' || gb.pending?.some((e) => e.op === 'grasp'))) {
    const hands: [number, number][] = gb.attack?.pattern === 'grasp' && s.tick >= gb.attack.windStart ? [...gb.attack.points] : [];
    for (const e of gb.pending ?? []) if (e.op === 'grasp') hands.push([e.x, e.y]);
    for (const [x, y] of hands) {
      const rx = h.x - x;
      const ry = h.y - y;
      const d = Math.sqrt(rx * rx + ry * ry) || 1;
      if (d < 30) {
        fx += (rx / d) * 4;
        fy += (ry / d) * 4;
      }
    }
  }
  // converging shots can cancel each other's sidestep: break the tie by stepping across the most urgent one
  if (nearT < 45 && Math.abs(fx) + Math.abs(fy) < 0.05) {
    const l = Math.sqrt(nearPerp[0] * nearPerp[0] + nearPerp[1] * nearPerp[1]) || 1;
    fx += (nearPerp[0] / l) * 0.2;
    fy += (nearPerp[1] / l) * 0.2;
  }
  // the Toller's rings (FEATURES.bosses.toller only): slide around the bell into the space between two shots
  // (a swinging beam with the hero not yet behind its start line comes first; during the pendulum's wind-up a ring
  // that arrives within 12 ticks comes first, the walk behind the line right after it)
  const beamSafe = !bt || (h.x - bt.x) * bt.dy * bt.sign + (h.y - bt.y) * -bt.dx * bt.sign >= 14;
  const slot = slot0 && (beamSafe || (s.beams.length === 0 && slot0.t < 12)) ? slot0 : null;
  if (slot) {
    const dx = slot.x - h.x;
    const dy = slot.y - h.y;
    const d = Math.hypot(dx, dy);
    const w = (slot.t < 20 ? 3 : 1) * Math.min(1, d / 4); // a firm pull that settles in the middle of the space
    if (d > 1e-6) {
      fx += (dx / d) * w;
      fy += (dy / d) * w;
    }
    // walking into the space between two shots of the ring is the answer: no dash across the ring; if the space
    // cannot be reached in time, dash THROUGH the ring toward the bell (the radial ring has already passed there)
    if (d <= p.heroSpeed * Math.max(1, slot.t - 1)) dashAway = null;
    else if (slot.t < 8 && s.boss) {
      // (with a beam swinging or winding up, toward the bell is not safe: dash toward the space instead)
      const quiet = s.beams.length === 0 && s.boss.attack?.pattern !== 'pendulum';
      const bx = quiet ? s.boss.x - h.x : dx;
      const by = quiet ? s.boss.y - h.y : dy;
      const bd = Math.hypot(bx, by) || 1;
      dashAway = [bx / bd, by / bd];
    }
  }
  // gentle pull towards the centre so the bot does not hug the rim
  fx += (p.cx - h.x) * 0.002;
  fy += (p.cy - h.y) * 0.002;
  // briar line (FEATURES.briar only): walk into the gap's lane before it arrives, back away if it cannot be reached
  // in time, hold the lane while it passes, dash through the thorns as a last resort
  const wa = s.walls && s.walls.length ? wallAhead(sim) : null;
  let lane: { axis: 'x' | 'y'; gap: number } | null = null;
  if (wa) {
    const { tc, err, w } = wa;
    const room = w.gapHalf - p.heroRadius;
    const ax = w.axis === 'x' ? 1 : 0;
    const ay = 1 - ax;
    if (tc < 240) {
      const k = Math.max(-4, Math.min(4, err / 6));
      fx += ay * k; // across the line = the other axis
      fy += ax * k;
      if (Math.abs(err) > room - 3 && Math.abs(err) / p.heroSpeed > tc - 8) {
        fx += ax * w.dir * 3; // buy time: walk away from the line
        fy += ay * w.dir * 3;
      }
      if (Math.abs(err) <= room - 2 && tc < 40) lane = { axis: w.axis, gap: w.gap };
    }
    if (tc < 4 && Math.abs(err) > room - 1) dashAway = [-ax * w.dir, -ay * w.dir];
  }
  let tx = h.x + fx * 400;
  let ty = h.y + fy * 400;
  if (lane) {
    // hold the lane: the cross coordinate of the target stays well inside the gap
    if (lane.axis === 'x') ty = Math.max(lane.gap - 12, Math.min(lane.gap + 12, ty));
    else tx = Math.max(lane.gap - 12, Math.min(lane.gap + 12, tx));
  }
  // an echo out beyond the hero comes back: keep the dash for it unless something hits within a few ticks
  // (FEATURES.bossMoves only)
  for (const ring of s.rings ?? []) {
    if (!ring.echo || ra?.ring === ring) continue;
    const d = Math.hypot(h.x - ring.x, h.y - ring.y);
    if (ring.r <= d) continue;
    const back = ring.phase === 'grow' ? (ring.maxR - ring.r) / ring.speed + 30 + (ring.maxR - d) / ring.back : ring.phase === 'hold' ? ring.holdUntil - s.tick + (ring.r - d) / ring.back : (ring.r - d) / ring.back;
    if (back < p.dashCooldown + 15 && nearT > 3) dashAway = null;
  }
  // (the rings and the binds come last: they override the other dash choices)
  if (ra && ra.gap < 7 && !(opts.ringParry === true && parryCooldownLeft(s, p) <= ra.ticks)) dashAway = [ra.ux, ra.uy];
  if (bound?.kind === 'iron' && s.tick - bound.land >= 12) dashAway ??= [(p.cx - h.x) / (Math.hypot(p.cx - h.x, p.cy - h.y) || 1), (p.cy - h.y) / (Math.hypot(p.cx - h.x, p.cy - h.y) || 1)];
  if (bound?.kind === 'break') dashAway = null; // no dash while parry-bound
  if (dashAway && dashCooldownLeft(s, p) === 0) {
    buttons |= BTN_DASH;
    tx = h.x + dashAway[0] * 40;
    ty = h.y + dashAway[1] * 40;
  }
  return { cursor: true, mx: Math.round(tx), my: Math.round(ty), buttons };
}

/** Ticks survived by the bot (capped). */
export function runBot(sim: Sim, capTicks: number): number {
  while (sim.state.alive && sim.state.tick < capTicks) sim.step(botInput(sim));
  return sim.state.survivalTicks;
}

export const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] ?? 0) : ((a[m - 1] ?? 0) + (a[m] ?? 0)) / 2;
};

/** The bot's frame clamped like a real client's (the cursor always lies on the 480x270 screen). */
export function botInputClamped(sim: Sim, opts: BotOptions = {}): InputFrame {
  const f = botInput(sim, opts);
  return f.cursor ? { ...f, mx: Math.max(0, Math.min(480, f.mx)), my: Math.max(0, Math.min(270, f.my)) } : f;
}
