/**
 * Audio decisions as pure logic (no DOM, no Phaser, no Web Audio): file manifest, voice limits, pitch variation,
 * music selection with hysteresis, and sound events derived on the render side by diffing sim state between frames.
 */
import type { SimEvent, SimState } from '../sim/state';

export type SfxEvent =
  | 'parry' | 'parry_chain' | 'dash' | 'death' | 'orb_spawn' | 'rune_charge' | 'rune_burst' | 'blade_whoosh'
  | 'wraith_wail' | 'boss_intro_eye' | 'boss_intro_lich' | 'boss_hit' | 'boss_death' | 'pickup_slow'
  | 'pickup_double' | 'new_record' | 'ui_click' | 'ui_confirm';
export type MusicTrack = 'music_menu' | 'music_run_calm' | 'music_run_tense' | 'music_boss';
export const AMBIENCE = 'amb_graveyard';

/** Event -> file stem from AUDIO_LIST.md (the boss intros are named sfx_boss_<kind>_intro there). */
export const SFX_FILE: Record<SfxEvent, string> = {
  parry: 'sfx_parry', parry_chain: 'sfx_parry_chain', dash: 'sfx_dash', death: 'sfx_death',
  orb_spawn: 'sfx_orb_spawn', rune_charge: 'sfx_rune_charge', rune_burst: 'sfx_rune_burst',
  blade_whoosh: 'sfx_blade_whoosh', wraith_wail: 'sfx_wraith_wail', boss_intro_eye: 'sfx_boss_eye_intro',
  boss_intro_lich: 'sfx_boss_lich_intro', boss_hit: 'sfx_boss_hit', boss_death: 'sfx_boss_death',
  pickup_slow: 'sfx_pickup_slow', pickup_double: 'sfx_pickup_double', new_record: 'sfx_new_record',
  ui_click: 'sfx_ui_click', ui_confirm: 'sfx_ui_confirm',
};
export const ALL_SFX = Object.keys(SFX_FILE) as SfxEvent[];

/** Build-time manifest: glob result (path -> url) -> file stem -> url. Only files that exist are ever requested. */
export function buildManifest(glob: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [path, url] of Object.entries(glob)) {
    const name = path.split('/').pop() ?? '';
    const stem = name.replace(/\.mp3$/i, '');
    if (stem !== name && /^[a-z0-9_]+$/.test(stem)) m.set(stem, url);
  }
  return m;
}

/** At most `max` simultaneous instances of the same sfx. */
export class VoiceLimiter {
  private active = new Map<string, number>();
  constructor(private max = 3) {}
  tryStart(name: string): boolean {
    const n = this.active.get(name) ?? 0;
    if (n >= this.max) return false;
    this.active.set(name, n + 1);
    return true;
  }
  end(name: string): void {
    const n = this.active.get(name) ?? 0;
    if (n <= 1) this.active.delete(name);
    else this.active.set(name, n - 1);
  }
  count(name: string): number {
    return this.active.get(name) ?? 0;
  }
}

const VARIED: ReadonlySet<SfxEvent> = new Set(['parry', 'orb_spawn', 'ui_click']);
/** Playback rate: +-3% for frequent sfx (`r` in [0, 1) from any render-side source), exactly 1 otherwise. */
export const pitchFor = (e: SfxEvent, r: number): number => (VARIED.has(e) ? 0.97 + 0.06 * r : 1);

/** Music intensity thresholds (tunable) with hysteresis so the run music does not flicker. */
export const MUSIC = { tenseWave: 5, tenseProjectiles: 25, calmProjectiles: 15, runFadeMs: 2000, bossFadeMs: 1500 };

/**
 * Which track should play. `wave` is 0-based (wave index 5 = "wave 6"). Tense from wave 6 or with 25+ projectiles,
 * back to calm only below wave 6 AND under 15 projectiles. The boss theme wins during a boss fight.
 */
export function pickMusic(screen: 'menu' | 'run', st: Pick<SimState, 'wave' | 'boss'> & { projectiles: { length: number } } | null, current: MusicTrack | null): MusicTrack {
  if (screen === 'menu' || !st) return 'music_menu';
  if (st.boss) return 'music_boss';
  const n = st.projectiles.length;
  const wasTense = current === 'music_run_tense';
  if (st.wave >= MUSIC.tenseWave || n >= MUSIC.tenseProjectiles) return 'music_run_tense';
  if (wasTense && n >= MUSIC.calmProjectiles) return 'music_run_tense';
  return 'music_run_calm';
}
export const fadeMsFor = (from: MusicTrack | null, to: MusicTrack): number =>
  from === 'music_boss' || to === 'music_boss' ? MUSIC.bossFadeMs : MUSIC.runFadeMs;

/** Sound events for one simulated tick, derived on the render side from its events and the multiplier change. */
export class SoundDiffer {
  private lastOrb = -1e9;
  private prevMult = 100;
  constructor(private orbGapMs = 150) {}
  reset(): void {
    this.lastOrb = -1e9;
    this.prevMult = 100;
  }
  tick(st: Pick<SimState, 'multiplier' | 'projectiles'>, events: readonly SimEvent[], nowMs: number): SfxEvent[] {
    const out: SfxEvent[] = [];
    let parried = false;
    let runeBurst = false;
    for (const e of events) {
      switch (e.type) {
        case 'parry_hit':
          parried = true;
          break;
        case 'dash_start':
          out.push('dash');
          break;
        case 'death':
          out.push('death');
          break;
        case 'telegraph':
          out.push('rune_charge');
          break;
        case 'spawn':
          if (e.kind === 'rune_shard') runeBurst ||= e.telegraphTicks > 0;
          else if (e.kind === 'blade') out.push('blade_whoosh');
          else if (e.kind === 'wraith') out.push('wraith_wail');
          else if (nowMs - this.lastOrb >= this.orbGapMs) {
            this.lastOrb = nowMs;
            out.push('orb_spawn');
          }
          break;
        case 'boss_intro':
          out.push(e.kind === 'eye' ? 'boss_intro_eye' : 'boss_intro_lich');
          break;
        case 'boss_segment':
          out.push('boss_hit');
          break;
        case 'boss_defeated':
          out.push('boss_death');
          break;
        case 'pickup_take':
          out.push(e.kind === 'slow' ? 'pickup_slow' : 'pickup_double');
          break;
        default:
          break;
      }
    }
    if (parried) out.push('parry');
    if (runeBurst) out.push('rune_burst');
    if (st.multiplier > this.prevMult) out.push('parry_chain'); // one per multiplier step
    this.prevMult = st.multiplier;
    // dedupe within a tick (a 16-shard ring is one burst; two blades one whoosh)
    return [...new Set(out)];
  }
}
