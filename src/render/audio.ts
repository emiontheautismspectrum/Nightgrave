/**
 * The audio manager (Web Audio). Files come from a build-time manifest of assets/audio/*.mp3, so only existing files
 * are requested; a file that fails to load or decode is treated as missing and the synthesized fallback plays instead.
 * Music crossfades between tracks; ambience loops quietly under the run. Unlocked on the first user input, muted while
 * the tab is hidden, volumes applied live. Never throws into the game.
 */
import { save } from '../storage';
import { AMBIENCE, buildManifest, fadeMsFor, pitchFor, SFX_FILE, VoiceLimiter, type MusicTrack, type SfxEvent } from './audioLogic';
import { playSynth, startDrone } from './sfx';

const glob = import.meta.glob('../../assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const MANIFEST = buildManifest(glob);

interface Track {
  name: string;
  gain: GainNode;
  stop: () => void;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private buffers = new Map<string, AudioBuffer | 'missing' | 'loading'>();
  private voices = new VoiceLimiter(3);
  private music: Track | null = null;
  private amb: Track | null = null;
  private wantMusic: MusicTrack | null = null;
  private wantAmb = false;
  private hidden = false;
  private rnd = 1;

  /** Create/resume the context. Call from a user input handler (autoplay policy; iOS needs a touch). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(this.ctx.destination);
        this.applyVolumes();
        if (this.wantMusic) this.setMusic(this.wantMusic);
        this.setAmbience(this.wantAmb);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyVolumes();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = save().settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.hidden ? 0 : s.master / 100, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music / 100, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx / 100, t, 0.05);
  }

  private load(stem: string): AudioBuffer | null {
    const b = this.buffers.get(stem);
    if (b instanceof AudioBuffer) return b;
    if (b) return null; // missing or still loading: the caller falls back
    const url = MANIFEST.get(stem);
    if (!url || !this.ctx) {
      this.buffers.set(stem, 'missing');
      return null;
    }
    this.buffers.set(stem, 'loading');
    const ctx = this.ctx;
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => this.buffers.set(stem, buf))
      .catch(() => this.buffers.set(stem, 'missing')); // broken file = missing
    return null;
  }

  sfx(e: SfxEvent): void {
    try {
      if (!this.ctx || this.ctx.state !== 'running' || this.hidden) return;
      if (!this.voices.tryStart(e)) return;
      this.rnd = (Math.imul(this.rnd, 1664525) + 1013904223) >>> 0;
      const rate = pitchFor(e, this.rnd / 4294967296);
      const done = () => this.voices.end(e);
      const buf = this.load(SFX_FILE[e]);
      if (!buf) {
        playSynth(this.ctx, this.sfxBus, e, rate, done);
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(this.sfxBus);
      src.onended = done;
      src.start();
    } catch {
      /* never break the game */
    }
  }

  private startTrack(name: string, volume: number, fadeMs: number, drone: boolean): Track | null {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicBus);
    gain.gain.setTargetAtTime(volume, ctx.currentTime, fadeMs / 3000);
    const buf = this.load(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      return { name, gain, stop: () => { try { src.stop(); } catch { /* stopped */ } } };
    }
    if (!drone) return { name, gain, stop: () => undefined }; // missing ambience is silent
    const stop = startDrone(ctx, gain, name);
    // when the real file finishes loading later, swap it in on the next track change
    return { name, gain, stop };
  }

  private fadeOut(t: Track | null, ms: number): void {
    if (!t || !this.ctx) return;
    t.gain.gain.setTargetAtTime(0, this.ctx.currentTime, ms / 3000);
    setTimeout(() => {
      t.stop();
      try {
        t.gain.disconnect();
      } catch {
        /* gone */
      }
    }, ms + 200);
  }

  setMusic(track: MusicTrack): void {
    const from = this.music?.name as MusicTrack | undefined;
    this.wantMusic = track;
    if (!this.ctx || from === track) return;
    const ms = fadeMsFor(from ?? null, track);
    this.fadeOut(this.music, ms);
    this.music = this.startTrack(track, 0.8, ms, true);
  }

  current(): MusicTrack | null {
    return this.wantMusic;
  }

  setAmbience(on: boolean): void {
    this.wantAmb = on;
    if (!this.ctx) return;
    if (on && !this.amb) this.amb = this.startTrack(AMBIENCE, 0.35, 2000, false);
    if (!on && this.amb) {
      this.fadeOut(this.amb, 1500);
      this.amb = null;
    }
  }
}

export const audio = new AudioManager();
