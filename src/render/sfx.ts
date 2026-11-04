/**
 * Tiny synthesized sound cues (WebAudio). Real audio files arrive in Stage 5; per CLAUDE.md a missing
 * file must fall back to a synthesized sound, and these are those fallbacks. Never throws.
 */
type Cue = 'parry' | 'whiff' | 'dash' | 'death' | 'telegraph' | 'wave';

const CUES: Record<Cue, { f0: number; f1: number; dur: number; type: OscillatorType; gain: number }> = {
  parry: { f0: 880, f1: 1320, dur: 0.12, type: 'triangle', gain: 0.18 },
  whiff: { f0: 220, f1: 160, dur: 0.09, type: 'sine', gain: 0.06 }, // soft, low: clearly "nothing happened"
  dash: { f0: 300, f1: 120, dur: 0.15, type: 'sawtooth', gain: 0.05 },
  death: { f0: 160, f1: 40, dur: 0.6, type: 'square', gain: 0.12 },
  telegraph: { f0: 140, f1: 420, dur: 0.55, type: 'sine', gain: 0.07 },
  wave: { f0: 330, f1: 495, dur: 0.3, type: 'triangle', gain: 0.08 },
};

let ctx: AudioContext | null = null;

export function playCue(cue: Cue): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== 'running') {
      // no user activation yet (e.g. gamepad only): try to resume, but drop this cue instead of queueing
      void ctx.resume();
      return;
    }
    const c = CUES[cue];
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = c.type;
    osc.frequency.setValueAtTime(c.f0, t);
    osc.frequency.exponentialRampToValueAtTime(c.f1, t + c.dur);
    g.gain.setValueAtTime(c.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + c.dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + c.dur);
  } catch {
    /* audio unavailable: stay silent, keep running */
  }
}
