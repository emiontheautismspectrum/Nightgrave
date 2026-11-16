/**
 * A strict but safe UPPER BOUND of the score of a run that lasted `durationTicks`, derived from TUNING (Hard is the
 * densest difficulty, every cap at its maximum). Used by the server's plausibility check. It assumes the impossible
 * best case everywhere: Double Score always on, every parry pulse at the max multiplier with the shortest cooldown,
 * the maximum number of kills per pulse bounded by the number of projectiles that can exist, every pickup taken,
 * every boss killed as early as the schedule allows. It bounds EVERY hero: the most kills per pulse of any hero, plus
 * the Wisp-style trail term (every dash burns the most trail kills at the max multiplier).
 */
import { FEATURES, type Features } from '../data/features';
import { HEROES, HERO_IDS } from '../data/heroes';
import { TICK_RATE, TUNING } from '../data/tuning';
import { packEntityCaps } from '../sim/patternPack';

const t = (s: number): number => Math.max(1, Math.round(s * TICK_RATE));

/**
 * Upper bound of projectiles spawned per second on Hard at the density cap (stream + set pieces + casters + boss).
 * `features`: the flags of the run (default: production). An ENABLED pattern pack adds its biggest set piece, an
 * enabled hex knot a knot plus its burst (FEATURES.knot), an enabled briar line nothing (FEATURES.briar: no projectile);
 * a disabled block is not read, so the bound of a dark build is unchanged. Today this spawn rate is not the binding
 * term of maxPossibleScore (kills are capped by pulses x kills per pulse first), so the pack leaves the score bound
 * itself where it is; the term is kept honest for the day a rule makes it bind.
 */
export function maxSpawnsPerSecond(features: Features = FEATURES): number {
  const T = TUNING;
  const dens = T.waves.densityCap * Math.max(...Object.values(T.difficulty).map((d) => d.density));
  const stream = dens / T.stream.intervalSeconds;
  const P = T.patterns;
  // a splitting orb can turn into (children) more parryable orbs
  const pack = features.patternPack.enabled === true ? Math.max(...Object.values(packEntityCaps(features.patternPack)).map((c) => c.projectiles)) : 0;
  // the hunts (enabled only): a knot pick is one parryable knot that bursts into its shards later; a briar pick adds
  // no projectile at all (a line is not a kill), and its fallback is an orb fan, already counted
  const knot = features.knot.enabled === true ? 1 + Math.max(1, Math.round(features.knot.shards)) : 0;
  const biggestSet = Math.max(P.orbFan.maxCount, P.runeBurst.maxShards, P.blades.maxCount, P.wraiths.maxCount, P.heavyOrbs.maxCount,
    P.armored.maxCount, P.split.maxCount * (1 + T.newThreats.split.children), pack, knot);
  const sets = (dens / P.gapMinSeconds) * biggestSet;
  const casterCycle = T.casters.telegraphSeconds + T.casters.riseSeconds + T.casters.casterIdleMinSeconds + T.casters.castSeconds;
  const casters = (T.casters.maxActive / casterCycle) * Math.max(P.orbFan.maxCount, T.casters.shardFan.count);
  const B = T.bosses;
  const ring = Math.floor((2 * Math.PI) / B.minGapRad);
  // the new bosses (FEATURES.bosses, enabled rows only): the most projectiles one attack can emit, per cadence
  const bossDens = Math.max(...Object.values(T.difficulty).map((d) => d.density));
  const per = (n: number): number => Math.ceil(n * bossDens);
  const th = features.bosses.thorn;
  const to = features.bosses.toller;
  const thorn = th.enabled === true ? Math.max(th.bloom.maxCount * th.bloom.maxShards, th.lash.maxCount, per(th.spores.count)) / th.cadenceSeconds : 0;
  const toller = to.enabled === true ? Math.max(to.toll.rings * to.toll.maxCount, to.knell.maxCount) / to.cadenceSeconds : 0;
  const boss = Math.max(ring / Math.min(B.eye.cadenceSeconds, B.lich.cadenceSeconds), thorn, toller);
  return stream + sets + casters + boss;
}

/**
 * Earliest tick at which the k-th boss (1-based) could be defeated: every fight as fast as the FASTEST boss of the
 * cycle allows (intro + the shortest wind-up + (minSegments - 1) x the shortest cadence), over the old bosses and the
 * ENABLED new ones (a disabled row is not read). With no new boss this is exactly the old bound. FEATURES.bossOrder
 * draws among the same kinds, so the fastest fight is the same with or without it.
 */
export function earliestBossDefeat(k: number, features: Features = FEATURES): number {
  const T = TUNING;
  const B = T.bosses;
  const wave = t(T.waves.seconds);
  const minSeg = 10; // segments are clamped to 10..15
  const winds: number[] = [B.eye.windupSeconds, B.lich.windupSeconds];
  const cads: number[] = [B.eye.cadenceSeconds, B.lich.cadenceSeconds];
  const th = features.bosses.thorn;
  const to = features.bosses.toller;
  if (th.enabled === true) (winds.push(th.windupSeconds), cads.push(th.cadenceSeconds));
  if (to.enabled === true) (winds.push(to.windupSeconds, (to.windupBeats * to.beatTicks) / TICK_RATE), cads.push(to.cadenceSeconds));
  const fight = t(B.introSeconds) + Math.max(15, t(Math.min(...winds))) + (minSeg - 1) * t(Math.min(...cads));
  const first = t(T.waves.graceSeconds) + (B.everyNthWave - 1) * wave + fight;
  const between = t(B.breakSeconds) + (B.everyNthWave - 1) * wave + fight;
  return first + (k - 1) * between;
}

export function maxPossibleScore(durationTicks: number, features: Features = FEATURES): number {
  const T = TUNING;
  const n = Math.max(0, Math.floor(durationTicks));
  const dbl = T.pickups.doubleScore.factor;
  // survival: every tick counted twice (Double Score always on)
  const survival = Math.floor((n * dbl * T.score.survivalPerSecond) / TICK_RATE);
  // parry: one successful pulse per (shortest) cooldown; kills bounded by projectiles that could have spawned
  const pulses = Math.ceil(n / t(T.parry.cooldownSeconds));
  // kills are bounded by the projectiles that could exist AND by maxKillsPerPulse per successful pulse
  const maxKills = Math.max(T.parry.maxKillsPerPulse, ...HERO_IDS.map((id) => HEROES[id].parry.maxKillsPerPulse ?? T.parry.maxKillsPerPulse));
  const kills = Math.min(Math.ceil((n / TICK_RATE) * maxSpawnsPerSecond(features) * (1 + T.newThreats.split.children)), pulses * maxKills);
  const firsts = Math.min(pulses, kills);
  const extras = Math.max(0, kills - firsts);
  const parry = (firsts * T.score.parryBase + extras * T.score.extraKillPoints) * T.multiplier.cap * dbl;
  // pickups: the first, then one per minimum interval
  const first = t(T.pickups.firstSeconds);
  const pickups = n >= first ? (1 + Math.floor((n - first) / t(T.pickups.intervalMinSeconds))) * T.pickups.points : 0;
  // bosses: every boss that could possibly be defeated in that time
  let bosses = 0;
  while (earliestBossDefeat(bosses + 1, features) <= n) bosses++;
  // trail (any hero with a trail ability): the most trail kills on every dash, at the max multiplier, doubled
  const dashes = n > 0 ? Math.floor(n / t(T.dash.cooldownSeconds)) + 1 : 0;
  let trail = 0;
  for (const id of HERO_IDS) {
    const a = HEROES[id].ability;
    if (a.kind === 'trail') trail = Math.max(trail, a.maxKills * a.killPoints * T.multiplier.cap * dbl * dashes);
  }
  return survival + Math.ceil(parry) + Math.ceil(trail) + pickups + bosses * B_KILL();
}

const B_KILL = (): number => TUNING.bosses.killScore;
