/**
 * Synthesized fallbacks (Web Audio): used whenever an audio file is missing or fails to decode.
 * Every sfx is a short oscillator sweep plus an optional noise burst with an envelope, distinct per event.
 * Never throws. The music fallback is a quiet, slow, low drone pad (meditative, never action music).
 */
import type { SfxEvent } from './audioLogic';

interface Voice {
  f0: number;
  f1: number;
  dur: number;
  type: OscillatorType;
  gain: number;
  noise?: number; // 0..1 noise level
}

export const SYNTH: Record<SfxEvent, Voice> = {
  parry: { f0: 880, f1: 1320, dur: 0.12, type: 'triangle', gain: 0.16, noise: 0.15 },
  parry_chain: { f0: 990, f1: 1760, dur: 0.22, type: 'sine', gain: 0.1 },
  dash: { f0: 300, f1: 120, dur: 0.15, type: 'sawtooth', gain: 0.03, noise: 0.5 },
  death: { f0: 160, f1: 40, dur: 0.7, type: 'square', gain: 0.1, noise: 0.3 },
  orb_spawn: { f0: 520, f1: 380, dur: 0.06, type: 'sine', gain: 0.03 },
  rune_charge: { f0: 140, f1: 420, dur: 0.55, type: 'sine', gain: 0.06 },
  rune_burst: { f0: 420, f1: 180, dur: 0.25, type: 'triangle', gain: 0.07, noise: 0.4 },
  blade_whoosh: { f0: 700, f1: 260, dur: 0.22, type: 'sawtooth', gain: 0.025, noise: 0.6 },
  wraith_wail: { f0: 620, f1: 480, dur: 0.6, type: 'sine', gain: 0.04 },
  boss_intro_eye: { f0: 60, f1: 110, dur: 1.6, type: 'sine', gain: 0.14, noise: 0.2 },
  boss_intro_lich: { f0: 220, f1: 110, dur: 1.4, type: 'triangle', gain: 0.08, noise: 0.25 },
  boss_hit: { f0: 240, f1: 120, dur: 0.18, type: 'square', gain: 0.07, noise: 0.35 },
  boss_death: { f0: 140, f1: 30, dur: 1.8, type: 'sawtooth', gain: 0.08, noise: 0.5 },
  pickup_slow: { f0: 660, f1: 330, dur: 0.5, type: 'sine', gain: 0.08 },
  pickup_double: { f0: 880, f1: 1760, dur: 0.3, type: 'triangle', gain: 0.08 },
  new_record: { f0: 440, f1: 880, dur: 0.9, type: 'triangle', gain: 0.09 },
  ui_click: { f0: 300, f1: 260, dur: 0.04, type: 'square', gain: 0.025 },
  ui_confirm: { f0: 330, f1: 495, dur: 0.18, type: 'sine', gain: 0.06 },
};

let noiseBuf: AudioBuffer | null = null;

/** Play one synthesized sfx into `dest`; calls `done` when it ends. */
export function playSynth(ctx: AudioContext, dest: AudioNode, e: SfxEvent, rate: number, done: () => void): void {
  try {
    const v = SYNTH[e];
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
    g.connect(dest);
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.f0 * rate, t);
    osc.frequency.exponentialRampToValueAtTime(v.f1 * rate, t + v.dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + v.dur);
    osc.onended = done;
    if (v.noise) {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        let x = 12345;
        for (let i = 0; i < d.length; i++) {
          x = (Math.imul(x, 1103515245) + 12345) >>> 0; // render-side noise (not the sim)
          d[i] = (x / 4294967296) * 2 - 1;
        }
      }
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(v.gain * v.noise, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.3, v.dur));
      n.connect(ng).connect(dest);
      n.start(t);
      n.stop(t + Math.min(0.3, v.dur));
    }
  } catch {
    done();
  }
}

/** A quiet, slow drone pad (fallback for any missing music track). Returns a stop function. */
export function startDrone(ctx: AudioContext, dest: AudioNode, track: string): () => void {
  try {
    // same key for every track (A minor-ish), denser for tense/boss: one or two more partials, never faster
    const base = 55;
    const partials = track === 'music_menu' ? [1, 1.5] : track === 'music_run_calm' ? [1, 1.5, 2] : [1, 1.2, 1.5, 2];
    const out = ctx.createGain();
    out.gain.value = 0.05;
    out.connect(dest);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07; // a very slow swell
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(out.gain);
    const oscs = partials.map((m, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = base * m;
      o.detune.value = i * 3;
      const g = ctx.createGain();
      g.gain.value = 0.5 / (i + 1);
      o.connect(g).connect(out);
      o.start();
      return o;
    });
    lfo.start();
    return () => {
      try {
        for (const o of oscs) o.stop();
        lfo.stop();
        out.disconnect();
      } catch {
        /* already stopped */
      }
    };
  } catch {
    return () => undefined;
  }
}
