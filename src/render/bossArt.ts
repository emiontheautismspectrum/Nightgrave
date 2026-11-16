/**
 * Boss art and animation as pure data (no Phaser; render-only: it READS sim state and params, never writes them).
 * BossView turns the results into sprites.
 *
 * DARK ART (stage ART-B): the redrawn bosses are drawn only in a flagged run (`useNewBossArt`). A production run
 * (no flags) goes through `legacyPose`, which is the frame choice of the code before this stage, line for line
 * (tests/boss_art.test.ts compares it tick by tick with a frozen copy), so it draws exactly the old sprites: the Eye
 * and the old `lich_mage_*`. The Thorn Mother and the Toller exist only in flagged runs.
 *
 * Every animation state comes from the sim: the tick, the attack and its phases (tpOut / tpIn / windStart / fire), the
 * hit and death ticks, and two things the view remembers in a `BossMemo`: the last two sim positions (the Eye's
 * lean) and the tick and old spot of the Toller's teleport (the sim's `boss_teleport` event).
 */
import { TICK_RATE } from '../data/tuning';
import { unknownBoss } from '../sim/boss';
import { ticks } from '../sim/params';
import type { SimParams } from '../sim/params';
import type { Boss, BossKind, BossPattern, Ring, SimEvent, SimState } from '../sim/state';

/** Is the new boss art drawn? Any new boss row, the boss motion or the boss moves (all dark until 0.11.0). */
export function useNewBossArt(p: Pick<SimParams, 'thorn' | 'toller' | 'motion' | 'moves'>): boolean {
  return p.thorn !== null || p.toller !== null || p.motion !== null || p.moves !== null;
}

export type BossFamily = 'eye_sentinel' | 'lich_mage' | 'lich_king' | 'thorn_mother' | 'toller';

/** Per boss kind: the sprite family, the banner key, the anchor of the body (origin) and its translucency box. */
export interface BossLook {
  name: BossFamily;
  banner: 'boss.eye' | 'boss.lich' | 'boss.thorn' | 'boss.toller';
  /** Sprite origin (0..1) placed at the sim position (+ dy); the eye hovers (depth over the y-sort). */
  originX: number;
  originY: number;
  dy: number;
  /** [x0, y0, x1, y1] around the sim position: the body's box for the translucency rule. */
  box: [number, number, number, number];
  /** The y (from the sim position) the body sorts by among the world's actors; default: the box's bottom. */
  base?: number;
  hovers: boolean;
}

/** EXHAUSTIVE: a new kind must get its own look here (never another boss's art, banner or box). */
export function bossLook(kind: BossKind, newArt = false): BossLook {
  switch (kind) {
    case 'eye':
      return { name: 'eye_sentinel', banner: 'boss.eye', originX: 0.5, originY: 0.5, dy: 0, box: [-22, -20, 22, 22], hovers: true };
    case 'lich':
      // the new Lich King (40 x 64) is anchored as the old lich is: its crown tip 36 px above the sim position and
      // the cloak's hem (row 40) 4 px below it, exactly where the old robe's top and hem are; the smoke tail trails
      // below the hem, so the body still sorts by the hem (a hero in front of the tail is drawn over it)
      if (newArt) return { name: 'lich_king', banner: 'boss.lich', originX: 0.5, originY: 36 / 64, dy: 0, box: [-17, -36, 18, 28], base: 4, hovers: false };
      return { name: 'lich_mage', banner: 'boss.lich', originX: 0.5, originY: 1, dy: 4, box: [-12, -36, 12, 4], hovers: false };
    case 'thorn':
      // her chest core (row 22 of 64, where the shots leave) at the sim position; the gown widens to the ground below
      return { name: 'thorn_mother', banner: 'boss.thorn', originX: 0.5, originY: 22 / 64, dy: 0, box: [-24, -22, 24, 42], hovers: false };
    case 'toller':
      // the bell's lip (where the rings leave) at the sim position; the robe hangs below it
      return { name: 'toller', banner: 'boss.toller', originX: 0.5, originY: 18 / 56, dy: 0, box: [-20, -18, 20, 38], hovers: false };
    default:
      return unknownBoss(kind);
  }
}

export const HIT_TICKS = 8;
/** The Toller's teleport (the peal): the fade-out at the old spot and the fade-in at the new one, in ticks. */
export const TOLLER_TP_TICKS = 16;
/** Ticks per idle frame of the six-frame idles (the Thorn Mother breathes slowly, the Lich's cloak flutters). */
const IDLE_TICKS: Partial<Record<BossFamily, number>> = { thorn_mother: 10, lich_king: 7 };
/** RENDER MOTION (render-only, whole pixels, capped; off with EFFECTS LOW): the Eye's lean against its velocity. */
export const BOSS_MOTION_RENDER = { eyeLeanPerPxTick: 6, eyeLeanMax: 2, jumpPxTick: 3 } as const;

/** What the view remembers between draws (never read by the sim). */
export class BossMemo {
  /** The last observed tick and sim position, and the velocity between the last two observations (px / tick). */
  tick = -1;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  private start = -1;
  /** The Toller's last teleport: its tick and the spot it left. */
  tpTick = -1e9;
  tpX = 0;
  tpY = 0;

  reset(): void {
    this.tick = -1;
    this.start = -1;
    this.vx = this.vy = 0;
    this.tpTick = -1e9;
  }

  /** A sim event of this tick (before `observe`): the Toller's teleport leaves a fading figure at the old spot. */
  onEvent(e: SimEvent, st: SimState): void {
    if (e.type !== 'boss_teleport' || !st.boss || st.boss.kind !== 'toller' || this.start !== st.boss.start) return;
    this.tpTick = st.tick;
    this.tpX = this.x;
    this.tpY = this.y;
  }

  /** Once per drawn state: the velocity from the last two sim positions (0 across a teleport or a new boss). */
  observe(st: SimState): void {
    const b = st.boss;
    if (!b) return this.reset();
    if (st.tick === this.tick && b.start === this.start) return; // paused / the same state drawn again
    const dt = st.tick - this.tick;
    if (b.start === this.start && dt > 0) {
      const [vx, vy] = [(b.x - this.x) / dt, (b.y - this.y) / dt];
      const jump = Math.hypot(vx, vy) > BOSS_MOTION_RENDER.jumpPxTick;
      this.vx = jump ? 0 : vx;
      this.vy = jump ? 0 : vy;
    } else this.vx = this.vy = 0;
    this.start = b.start;
    this.tick = st.tick;
    this.x = b.x;
    this.y = b.y;
  }
}

/** The Eye's lean: 1-2 whole pixels against its velocity (never a rotation or a scale). */
export function eyeLean(vx: number, vy: number): [number, number] {
  const M = BOSS_MOTION_RENDER;
  const c = (v: number): number => Math.max(-M.eyeLeanMax, Math.min(M.eyeLeanMax, -Math.round(v * M.eyeLeanPerPxTick))) + 0;
  return [c(vx), c(vy)];
}

/** One sprite of a draw list. */
export interface BossSprite {
  key: string;
  frame: number;
  x: number;
  y: number;
  alpha: number;
  /** The y it sorts by among the world's actors, or 'over' (above the world's actors and props, under the fog). */
  base: number | 'over';
  /** Sprite origin (default: its centre). */
  ox?: number;
  oy?: number;
}

/**
 * The wind-up row of an attack pattern (default: `cast`, the row with the violet glow). A RED (unparryable) attack
 * never winds up on the violet row: the hedge, the lash, the grasp and the Toller's red moves have rows without
 * violet (their red cue is drawn in code); the chains have the throw row. (The Eye keeps its one charge row.)
 */
export const CAST_ROW: Partial<Record<BossPattern, string>> = {
  hedge: 'hedge', lash: 'lash', grasp: 'grasp', chains: 'throw', pendulum: 'strike', knell: 'strike', peal: 'strike', echo: 'strike',
};

export interface BossPose {
  /** Sprite key (`<family>_<row>`) and frame of the body. */
  key: string;
  frame: number;
  alpha: number;
  /** Whole-pixel shift of the body: up by `rise`, and (dx, dy) of the render motion. */
  rise: number;
  dx: number;
  dy: number;
  /** False while the Thorn Mother is under the ground. */
  visible: boolean;
}

const clampProg = (t: number, s0: number, s1: number, n: number): number => Math.max(0, Math.min(n - 1, Math.floor(((t - s0) / Math.max(1, s1 - s0)) * n)));

/**
 * The frame choice of the code BEFORE the boss art stage (the production path), kept line for line: the old families,
 * the old rows, the old `rise` and alpha.
 */
function legacyPose(st: SimState, p: SimParams, b: Boss): BossPose {
  const t = st.tick;
  const L = bossLook(b.kind, false);
  const name = L.name;
  const eye = b.kind === 'eye';
  const lich = b.kind === 'lich';
  const a = b.attack;
  const prog = (s0: number, s1: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(((t - s0) / Math.max(1, s1 - s0)) * n)));
  let f: [string, number];
  let alpha = 1;
  let rise = 0;
  // the idle frame: the Toller's bell swings on its beat (centre, right, centre, left over two beats), the others loop
  const beat = b.kind === 'toller' && p.toller ? Math.max(1, Math.round(p.toller.beatTicks)) : 0;
  const phase = beat ? ((((t - b.introEnd + beat / 4) % (2 * beat)) + 2 * beat) % (2 * beat)) : 0; // an extreme on every beat
  const idle = (): [string, number] => [`${name}_idle`, beat ? (Math.floor(phase / (beat / 2)) + 1) & 3 : (t >> 3) & 3];
  if (b.deathTick >= 0) f = [`${name}_death`, prog(b.deathTick, b.deathTick + ticks(p.bosses.deathSeconds), 6)];
  else if (t < b.introEnd) {
    // intro: the eye rises from behind the tree line, the lich materialises at the portal, the new bosses rise out
    // of the ground (dithered in)
    if (eye) {
      f = [`${name}_idle`, (t >> 3) & 3];
      rise = Math.round((1 - (t - b.start) / Math.max(1, b.introEnd - b.start)) * 40);
      alpha = Math.min(1, (t - b.start) / 40);
    } else if (lich) f = [`${name}_teleport_in`, prog(b.start, b.introEnd, 4)];
    else {
      f = [`${name}_death`, 5 - prog(b.start, b.introEnd, 6)];
      rise = -Math.round((1 - (t - b.start) / Math.max(1, b.introEnd - b.start)) * 8);
    }
  } else if (b.hitTick >= 0 && t - b.hitTick < HIT_TICKS) f = [`${name}_hit`, (t - b.hitTick) < HIT_TICKS / 2 ? 0 : 1];
  else if (a && b.kind === 'thorn' && a.tpIn > a.tpOut && t < a.windStart) {
    // FEATURES.bossMotion: roots pull her down [tpOut, tpIn) (gone at tpIn), she rises at the new spot [tpIn, windStart)
    const sinking = t < a.tpIn;
    const k = sinking ? (t - a.tpOut) / Math.max(1, a.tpIn - a.tpOut) : 1 - (t - a.tpIn) / Math.max(1, a.windStart - a.tpIn);
    f = [`${name}_death`, Math.min(5, Math.floor(k * 6))];
    rise = -Math.round(k * 8);
    alpha = 1 - k;
  } else if (a && lich && t < a.tpIn) f = [`${name}_teleport_out`, prog(a.tpOut, a.tpIn, 4)];
  else if (a && lich && t < a.windStart) f = [`${name}_teleport_in`, prog(a.tpIn, a.windStart, 4)];
  else if (a && t >= a.windStart) f = [eye ? `${name}_charge` : `${name}_cast`, prog(a.windStart, a.fire, eye ? 3 : 4)];
  else f = idle();
  // FEATURES.bossMotion: the drifting bodies bob (RENDER ONLY: the sim position carries no bob)
  const drift = p.motion && (eye || lich) ? (eye ? p.motion.eye : p.motion.lich) : null;
  if (drift && b.deathTick < 0 && t >= b.introEnd) rise += Math.round(Math.sin((2 * Math.PI * (t - b.introEnd)) / Math.max(1, drift.bobSeconds * TICK_RATE)) * drift.bobPx);
  return { key: f[0], frame: f[1], alpha, rise, dx: 0, dy: 0, visible: true };
}

/** Sink slots: six frames, then one slot under the ground (not drawn). */
const SINK_SLOTS = 7;

/**
 * The body's sprite for this state. `motion`: the render motion is on (EFFECTS HIGH). With the flags off this is the
 * old frame choice exactly; with any boss flag on, the new families and rows:
 * death; intro (the Lich re-forms, the Thorn Mother emerges, the Toller fades in); the Toller's teleport; hit; the
 * Thorn Mother's sink / under ground / emerge; the Lich's teleport out / in; the cast row of the attack's pattern
 * (hedge, grasp and chains have their own rows); idle.
 */
export function bossPose(st: SimState, p: SimParams, memo: BossMemo, motion = true): BossPose | null {
  const b = st.boss;
  if (!b) return null;
  if (!useNewBossArt(p)) return legacyPose(st, p, b);
  const t = st.tick;
  const L = bossLook(b.kind, true);
  const name = L.name;
  const a = b.attack;
  const out: BossPose = { key: `${name}_idle`, frame: 0, alpha: 1, rise: 0, dx: 0, dy: 0, visible: true };
  const set = (row: string, frame: number): void => {
    out.key = `${name}_${row}`;
    out.frame = frame;
  };
  const prog = (s0: number, s1: number, n: number): number => clampProg(t, s0, s1, n);
  const intro = t < b.introEnd;
  if (b.deathTick >= 0) set('death', prog(b.deathTick, b.deathTick + ticks(p.bosses.deathSeconds), 6));
  else if (intro && b.kind === 'eye') {
    // the eye rises from behind the tree line (as before)
    set('idle', (t >> 3) & 3);
    out.rise = Math.round((1 - (t - b.start) / Math.max(1, b.introEnd - b.start)) * 40);
    out.alpha = Math.min(1, (t - b.start) / 40);
  } else if (intro && b.kind === 'lich') set('teleport_in', prog(b.start, b.introEnd, 4));
  else if (intro && b.kind === 'thorn') set('emerge', prog(b.start, b.introEnd, 6));
  else if (intro) set('tp_in', prog(b.start, b.introEnd, 4));
  else if (b.kind === 'toller' && t >= memo.tpTick && t - memo.tpTick < TOLLER_TP_TICKS) set('tp_in', prog(memo.tpTick, memo.tpTick + TOLLER_TP_TICKS, 4));
  else if (b.hitTick >= 0 && t - b.hitTick < HIT_TICKS) set('hit', t - b.hitTick < HIT_TICKS / 2 ? 0 : 1);
  else if (a && b.kind === 'thorn' && a.tpIn > a.tpOut && t < a.windStart) {
    // FEATURES.bossMotion: roots pull her down [tpOut, tpIn): six frames, then she is under the ground (not drawn)
    // until she emerges at the new spot [tpIn, windStart)
    // (the sim moves her while it processes tick tpIn, so the state drawn AT tpIn still holds the old spot: sunk)
    if (t <= a.tpIn) {
      const slot = Math.floor(((t - a.tpOut) / Math.max(1, a.tpIn - a.tpOut)) * SINK_SLOTS);
      if (slot >= 6) out.visible = false;
      set('sink', Math.max(0, Math.min(5, slot)));
    } else set('emerge', prog(a.tpIn, a.windStart, 6));
  } else if (a && b.kind === 'lich' && t < a.tpIn) set('teleport_out', prog(a.tpOut, a.tpIn, 4));
  else if (a && b.kind === 'lich' && t < a.windStart) set('teleport_in', prog(a.tpIn, a.windStart, 4));
  else if (a && t >= a.windStart) {
    if (b.kind === 'eye') set('charge', prog(a.windStart, a.fire, 3));
    else set(CAST_ROW[a.pattern] ?? 'cast', prog(a.windStart, a.fire, 4));
  } else if (b.kind === 'toller' && p.toller) {
    // the bell swings on its beat (centre, right, centre, left over two beats): an extreme on every beat
    const beat = Math.max(1, Math.round(p.toller.beatTicks));
    const phase = (((t - b.introEnd + beat / 4) % (2 * beat)) + 2 * beat) % (2 * beat);
    set('idle', (Math.floor(phase / (beat / 2)) + 1) & 3);
  } else {
    const per = IDLE_TICKS[name];
    set('idle', per ? Math.floor(t / per) % 6 : (t >> 3) & 3);
  }
  const fighting = b.deathTick < 0 && t >= b.introEnd;
  // FEATURES.bossMotion: the drifting bodies bob (RENDER ONLY: the sim position carries no bob; as before)
  const drift = p.motion && (b.kind === 'eye' || b.kind === 'lich') ? (b.kind === 'eye' ? p.motion.eye : p.motion.lich) : null;
  if (drift && fighting) out.rise += Math.round(Math.sin((2 * Math.PI * (t - b.introEnd)) / Math.max(1, drift.bobSeconds * TICK_RATE)) * drift.bobPx);
  // the Eye glides: it leans 1-2 px against its velocity (from the last two sim positions the view saw)
  if (motion && b.kind === 'eye' && fighting) [out.dx, out.dy] = eyeLean(memo.vx, memo.vy);
  return out;
}

/** The Toller's raised hand (from the bell's lip) on each frame of the throw row, then its resting hand. */
const THROW_HAND: readonly (readonly [number, number])[] = [[11, 8], [13, 1], [13, -5], [15, 6]];
const REST_HAND: readonly [number, number] = [8, 12];
/** Chain links are laid this far apart along the chain (the tiles are 8 x 8, never rotated). */
export const LINK_STEP = 5;
const MAX_LINKS = 96;

/**
 * The effect sprites of the boss moves (new art; all of these exist only in flagged runs): the Toller's fading figure
 * at the spot it left, the Lich's soulfire embers, bone hands in their red crack rings (winding up, then lit until
 * they burst), and the chain: links flying from the Toller's hand to the spot over the telegraph, then from the hand
 * to the bound hero with two coils round him.
 */
export function bossFx(st: SimState, p: SimParams, memo: BossMemo): BossSprite[] {
  const out: BossSprite[] = [];
  const b = st.boss;
  if (!b || !useNewBossArt(p)) return out;
  const t = st.tick;
  const a = b.attack;
  if (b.kind === 'toller' && b.deathTick < 0 && t >= memo.tpTick && t - memo.tpTick < TOLLER_TP_TICKS) {
    const L = bossLook('toller', true);
    out.push({ key: 'toller_tp_out', frame: clampProg(t, memo.tpTick, memo.tpTick + TOLLER_TP_TICKS, 4), x: memo.tpX, y: memo.tpY, alpha: 1, base: memo.tpY + L.box[3], ox: L.originX, oy: L.originY });
  }
  const hand = (x: number, y: number, k: number): void => {
    const f = Math.max(0, Math.min(3, Math.floor(k * 4)));
    // a telegraph of an unparryable burst: above every prop (a tree or the gallows must never hide it), as the
    // code-drawn cue it replaces was
    out.push({ key: 'grasp_crack', frame: f, x: Math.round(x), y: Math.round(y), alpha: 1, base: 'over' });
    out.push({ key: 'bone_hand', frame: f, x: Math.round(x), y: Math.round(y) - 5, alpha: 1, base: 'over' });
  };
  // (the launch runs while the sim processes tick `fire`: the state drawn AT `fire` is still winding up)
  if (a && t >= a.windStart && t <= a.fire && b.deathTick < 0) {
    const k = (t - a.windStart) / Math.max(1, a.fire - a.windStart);
    if (a.pattern === 'grasp') for (const [x, y] of a.points) hand(x, y, k);
    if (a.pattern === 'soulfire') out.push({ key: 'lich_king_soulfire', frame: Math.max(0, Math.min(5, Math.floor(k * 6))), x: b.x, y: b.y - 15, alpha: 1, base: 'over' });
  }
  for (const e of b.pending ?? []) if (e.op === 'grasp') hand(e.x, e.y, 1);
  const c = st.chain;
  if (c && b.kind === 'toller') {
    const key = c.kind === 'iron' ? 'chain_iron' : 'chain_violet';
    const throwing = !!a && a.pattern === 'chains' && t < a.fire;
    const [ox, oy] = throwing ? THROW_HAND[clampProg(t, a!.windStart, a!.fire, 4)]! : REST_HAND;
    const [hx, hy] = [b.x + ox, b.y + oy];
    const [tx, ty] = c.bound ? [st.hero.x, st.hero.y] : [c.x, c.y];
    const len = Math.hypot(tx - hx, ty - hy);
    // the chain flies out over the telegraph (it reaches the spot when it lands); a bound chain is whole
    const reach = c.bound ? 1 : Math.max(0, Math.min(1, (t - c.start) / Math.max(1, c.land - c.start)));
    const n = Math.min(MAX_LINKS, Math.floor((len * reach) / LINK_STEP));
    for (let i = 1; i <= n; i++) {
      const d = (i * LINK_STEP) / Math.max(1e-6, len);
      const [x, y] = [hx + (tx - hx) * d, hy + (ty - hy) * d];
      out.push({ key, frame: i & 1, x: Math.round(x), y: Math.round(y), alpha: 1, base: 'over' });
    }
    if (c.bound) out.push({ key: c.kind === 'iron' ? 'chain_wrap_iron' : 'chain_wrap_violet', frame: (t >> 3) & 1, x: Math.round(st.hero.x), y: Math.round(st.hero.y) - 4, alpha: 1, base: 'over' });
  }
  return out;
}

/** The colours of the ring's band (palette indices are the renderer's business; these are names). */
export type RingTone = 'blood' | 'bloodDark';
/** The torn end of a cut: the band thins over this many px of arc before the gap. */
export const RING_TEAR_PX = 8;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * The Toller's ring (peal / echo) as pixel-exact horizontal runs inside `clip` ([x0, y0, x1, y1), whole px): a band
 * as thick as the lethal one (2 x halfWidth): a blood_dark outer edge (1 px), a blood core, a checker-dithered
 * blood_dark inner edge (1 px). A cut gap is empty; next to it the band's EDGES are torn (an ordered dither thinning
 * to nothing over RING_TEAR_PX of arc) while its core stays solid up to the cut, so the opening never looks wider
 * than it is. Runs come row by row, left to right; nothing is rotated or blended.
 */
export function ringRuns(ring: Ring, clip: readonly [number, number, number, number], emit: (x: number, y: number, w: number, tone: RingTone) => void): void {
  const hw = Math.max(1.5, ring.halfWidth);
  const ro = ring.r + hw;
  const ri = Math.max(0, ring.r - hw);
  const [cx0, cy0, cx1, cy1] = clip;
  const y0 = Math.max(cy0, Math.floor(ring.y - ro));
  const y1 = Math.min(cy1, Math.ceil(ring.y + ro));
  // per gap: the cos of its half-angle and of (half-angle + the tear), for the torn ends
  const gaps = ring.gaps.map((g) => {
    const half = Math.atan2(g.sin, g.cos);
    return { x: g.x, y: g.y, cos: g.cos, half, tear: RING_TEAR_PX / Math.max(8, ring.r) };
  });
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - ring.y;
    const d2 = ro * ro - dy * dy;
    if (d2 <= 0) continue;
    const xo = Math.sqrt(d2);
    const xi = Math.abs(dy) < ri ? Math.sqrt(ri * ri - dy * dy) : 0;
    // the row crosses the band in one span (near the top / bottom) or two (left and right)
    const spans: [number, number][] = xi > 0 ? [[ring.x - xo, ring.x - xi], [ring.x + xi, ring.x + xo]] : [[ring.x - xo, ring.x + xo]];
    let done = cx0; // (two spans of one row never share a pixel column)
    for (const [sa, sb] of spans) {
      const xa = Math.max(done, Math.floor(sa));
      const xb = Math.min(cx1, Math.ceil(sb));
      done = Math.max(done, xb);
      let runX = 0;
      let runW = 0;
      let runTone: RingTone | null = null;
      const flush = (): void => {
        if (runTone && runW > 0) emit(runX, y, runW, runTone);
        runTone = null;
        runW = 0;
      };
      for (let x = xa; x < xb; x++) {
        const dx = x + 0.5 - ring.x;
        const d = Math.hypot(dx, dy);
        let tone: RingTone | null = null;
        if (d <= ro && d >= ri) {
          if (d > ro - 1) tone = 'bloodDark';
          else if (d >= ri + 1) tone = 'blood';
          else tone = ((x + y) & 1) === 0 ? 'bloodDark' : null;
        }
        if (tone && gaps.length && d > 1e-6) {
          const [ux, uy] = [dx / d, dy / d];
          const core = tone === 'blood';
          for (const g of gaps) {
            const c = ux * g.x + uy * g.y;
            if (c >= g.cos) {
              tone = null; // inside the cut
              break;
            }
            if (core) continue; // the core stays solid right up to the cut: only the edges tear
            const beyond = Math.acos(Math.max(-1, Math.min(1, c))) - g.half; // rad past the gap's edge
            if (beyond < g.tear && BAYER4[((y & 3) << 2) | (x & 3)]! >= (beyond / g.tear) * 16) {
              tone = null; // the torn end
              break;
            }
          }
        }
        if (tone !== runTone) {
          flush();
          runTone = tone;
          runX = x;
        }
        if (tone) runW++;
      }
      flush();
    }
  }
}
