import type { Difficulty } from '../data/tuning';

/** Sentinel start tick meaning "never happened" (JSON-safe, unlike -Infinity). */
export const NEVER = -1_000_000_000;

export type ProjectileKind = 'orb_small' | 'orb_large' | 'rune_shard' | 'blade' | 'wraith' | 'orb_armored' | 'orb_split';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  parryable: boolean;
  /** Tick on which it was spawned (render uses it for animation phase). */
  born: number;
  /** Speed in px/tick (homing renormalises to it). */
  speed: number;
  /** Homing steer factor per tick (0 = straight). */
  homing: number;
  /** Per-tick velocity rotation (cos, sin); (1, 0) = no curve. */
  turnC: number;
  turnS: number;
  /** Tick at which it starts fading (harmless from then on); -1 = never. */
  expires: number;
  /** Tick at which a fading projectile is removed; -1 = never. */
  fadeEnd: number;
  /** Boss attack serial that launched it (0 = not a boss projectile). */
  boss: number;
  /** Shell left (armored orb: 1 = the next parry only cracks it). */
  armor: number;
  /** parryStart of the pulse that cracked it / burst its parent (-1 = never): that pulse cannot also destroy it. */
  crackedBy: number;
  /** Harmless before this tick (split pieces), -1 = always harmful. */
  safeUntil: number;
}

/** Blood sigil ground hazard: [start, fill) telegraph, [fill, end) lethal, [end, gone) fading (harmless). */
export interface Sigil {
  id: number;
  x: number;
  y: number;
  r: number;
  start: number;
  fill: number;
  end: number;
  gone: number;
}

export type BossKind = 'eye' | 'lich';
export type BossPattern = 'ring' | 'beam' | 'spawns' | 'fan' | 'wraiths' | 'triple';

/** A boss attack in progress: [windStart, fire) wind-up (telegraph), launched at `fire`. */
export interface BossAttack {
  pattern: BossPattern;
  /** Lich: teleport out from `tpOut`, appears at the new spot at `tpIn`, wind-up starts at `windStart`. */
  tpOut: number;
  tpIn: number;
  windStart: number;
  fire: number;
  /** Beam: unit start direction, rotation sign; spawns: telegraphed points. */
  dirX: number;
  dirY: number;
  sign: number;
  points: [number, number][];
}

/** The rotating eye beam (unparryable). Active (lethal) for ticks [start, end). */
export interface Beam {
  serial: number;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** Per-tick rotation (cos, sin). */
  turnC: number;
  turnS: number;
  start: number;
  end: number;
  halfWidth: number;
  length: number;
}

export interface Boss {
  kind: BossKind;
  /** The wave this boss replaces, and how many times this boss kind was met before (speed bonus). */
  wave: number;
  encounter: number;
  segments: number;
  remaining: number;
  x: number;
  y: number;
  start: number;
  /** Intro ends (the first wind-up may start): no attack before this tick. */
  introEnd: number;
  /** Next attack sequence starts at this tick (wind-up or teleport). */
  nextAt: number;
  attack: BossAttack | null;
  /** Serial of the most recently launched attack (0 = none yet). */
  serial: number;
  /** Tick of the last removed segment (hit flash), -1 = none. */
  hitTick: number;
  /** Tick the boss was defeated (-1 while fighting); the body is removed at deathTick + deathTicks. */
  deathTick: number;
  /** Speed multiplier for this encounter (difficulty speed is already in the params). */
  speed: number;
}

export type PickupKind = 'slow' | 'double';

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  born: number;
  expires: number;
}

export type CasterKind = 'shade' | 'stalker';
export type CasterAttack = 'orbFan' | 'shardFan' | 'wraith' | 'blade';

/**
 * A summoner (emitter only: never hittable, never lethal, no collision). All phase boundaries are absolute ticks:
 * [start, appear0) telegraph, [appear0, appear) rise/emerge, [appear, castStart) idle, [castStart, fire) wind-up,
 * fire = the single attack, [fire, end) dissolve; removed at `end`.
 */
export interface Caster {
  id: number;
  kind: CasterKind;
  /** -1 = the portal altar; otherwise the index into HOLLOWS. */
  source: number;
  x: number;
  y: number;
  start: number;
  appear0: number;
  appear: number;
  castStart: number;
  fire: number;
  end: number;
  attack: CasterAttack;
}

/** A rune lighting up before it fires a radial ring of rune shards. */
export interface Telegraph {
  id: number;
  rune: number;
  x: number;
  y: number;
  start: number;
  fire: number;
  shards: number;
  /** Shard speed in px/tick, fixed when the telegraph starts. */
  speed: number;
}

export interface Hero {
  x: number;
  y: number;
  /** Last non-zero movement direction (unit vector); used for dash direction and facing. */
  dirX: number;
  dirY: number;
  facing: 1 | -1;
  /** Tick on which the current/last parry started (NEVER = long ago). Active while tick - parryStart < parryActive. */
  parryStart: number;
  /** Whether the current/last parry destroyed at least one projectile (decides its cooldown). */
  parryHit: boolean;
  /** Projectiles destroyed by the current/last pulse (capped at parryMaxKills). */
  parryKills: number;
  /** The current/last pulse already had its PERFECT kill (the extra multiplier step is taken once per pulse). */
  parryClose: boolean;
  /** The current/last pulse destroyed (scored) something; a pulse that only cracked a shell has a short cooldown. */
  parryScored: boolean;
  /** A parry press is buffered until this tick (inclusive); -1 = none. */
  parryBufferedUntil: number;
  /** Tick on which the current/last dash started (NEVER = long ago). */
  dashStart: number;
  dashBufferedUntil: number;
  dashDirX: number;
  dashDirY: number;
}

export type SimEvent =
  | { type: 'parry_start' }
  /** multiplier: the one used for these points; perfect: this kill was the pulse's PERFECT one; multAfter: after the step. */
  | { type: 'parry_hit'; id: number; x: number; y: number; points: number; multiplier: number; perfect: boolean; multAfter: number }
  /** The multiplier stepped (once per successful pulse, +1 step more for a PERFECT parry); multiplier = the new value. */
  | { type: 'mult_step'; multiplier: number; perfect: boolean; x: number; y: number }
  /** The multiplier fell back to the start after the reset time without a successful parry. */
  | { type: 'mult_reset' }
  | { type: 'dash_start'; dirX: number; dirY: number }
  | { type: 'parry_whiff'; x: number; y: number }
  | { type: 'spawn'; id: number; kind: ProjectileKind; dist: number; telegraphTicks: number }
  | { type: 'telegraph'; id: number; rune: number }
  | { type: 'caster'; id: number; kind: CasterKind; source: number }
  | { type: 'caster_fire'; id: number; attack: CasterAttack }
  | { type: 'caster_fizzle'; id: number }
  | { type: 'wave'; wave: number }
  | { type: 'death'; x: number; y: number; by: number }
  | { type: 'parry_crack'; id: number; x: number; y: number }
  | { type: 'split'; id: number; x: number; y: number }
  | { type: 'sigil'; id: number; x: number; y: number }
  | { type: 'boss_intro'; kind: BossKind }
  | { type: 'boss_attack'; kind: BossKind; pattern: BossPattern; remaining: number }
  | { type: 'boss_segment'; remaining: number; reflected: boolean }
  | { type: 'boss_teleport'; x: number; y: number }
  | { type: 'boss_defeated'; kind: BossKind; x: number; y: number; points: number; charges: number }
  | { type: 'pickup_spawn'; id: number; kind: PickupKind }
  | { type: 'pickup_take'; id: number; kind: PickupKind; x: number; y: number }
  | { type: 'pickup_expire'; id: number };

export interface SimState {
  seed: number;
  difficulty: Difficulty;
  /** Number of ticks simulated so far. */
  tick: number;
  rng: number;
  hero: Hero;
  projectiles: Projectile[];
  nextId: number;
  alive: boolean;
  /** Tick on which the hero died (-1 while alive). */
  deathTick: number;
  /** Ticks survived (stops at death). */
  survivalTicks: number;
  /** Parry score in hundredths of a point (integer: avoids float drift). */
  parryScoreHundredths: number;
  /** Multiplier in hundredths (100 = x1.00). */
  multiplier: number;
  /** Tick of the last successful parry (-1 = never). */
  lastParryTick: number;
  /** Successful parry pulses (a pulse that destroyed at least one projectile). */
  parryCount: number;
  /** Current wave (-1 before the first one starts). */
  wave: number;
  /** Fractional timer (ticks) until the next stream orb. */
  streamTimer: number;
  /** Tick of the next set piece. */
  patternAt: number;
  telegraphs: Telegraph[];
  casters: Caster[];
  sigils: Sigil[];
  /** Ticks of normal wave time elapsed (paused during boss fights and the break after them). */
  waveClock: number;
  boss: Boss | null;
  beams: Beam[];
  /** Bosses met so far per kind (the next encounter's speed bonus). */
  bossMet: Record<BossKind, number>;
  bossesDefeated: number;
  /** The last wave a boss was started for (-1 = none). */
  bossWave: number;
  /** Normal waves resume at this tick after a boss (-1 = no break). */
  breakUntil: number;
  /** Fixed boss kill points (never multiplied). */
  bossScore: number;
  emberCharges: number;
  pickup: Pickup | null;
  /** Next pickup spawn attempt. */
  pickupAt: number;
  pickupScore: number;
  slowUntil: number;
  doubleUntil: number;
  /** Survival ticks spent under Double Score (counted once more in the score). */
  doubleTicks: number;
  /** Events emitted during the most recent tick only (render reads them). */
  events: SimEvent[];
}
