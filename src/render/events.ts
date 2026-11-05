/**
 * One small render-side event hook for sound. Sound events are derived on the render side (SoundDiffer, UI code) and
 * emitted here; the audio manager listens. The sim never imports this. Listener errors are swallowed.
 */
import type { SfxEvent } from './audioLogic';

export type AudioEvent = SfxEvent;

type Listener = (e: AudioEvent) => void;
const listeners = new Set<Listener>();

export function onAudioEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitAudioEvent(e: AudioEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      /* a broken listener must not stop the game */
    }
  }
}
