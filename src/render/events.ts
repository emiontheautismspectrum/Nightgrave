/**
 * One small render-side event hook for audio (Stage 5 attaches real sounds here). Render-only: the sim never imports it.
 * Listeners must never throw into the game loop; errors are swallowed.
 */
export type AudioEvent = 'boss_intro_eye' | 'boss_intro_lich' | 'boss_hit' | 'boss_death' | 'pickup_slow' | 'pickup_double';

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
