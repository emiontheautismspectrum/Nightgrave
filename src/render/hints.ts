/**
 * Minimal controls explanation (pure, no Phaser): the active input device, the one-line controls under PLAY, the
 * first-run card, and two one-time contextual hints ("Parry!", "Can't parry - dash!"). Render-only: they read sim
 * state and never change the sim or the replay.
 */
import type { SimState } from '../sim/state';

export type Device = 'desktop' | 'touch' | 'gamepad';
let device: Device = 'desktop';
export const getDevice = (): Device => device;
export function setDevice(d: Device): void {
  device = d;
}

export function controlsLine(d: Device): string {
  if (d === 'touch') return 'DRAG MOVE - PARRY - DASH';
  if (d === 'gamepad') return 'STICK MOVE - A PARRY - B/RT DASH';
  return 'MOUSE MOVE - LMB PARRY - RMB/SPACE DASH';
}

export function cardLines(d: Device, leftHanded: boolean): string[] {
  const how =
    d === 'touch'
      ? ['DRAG ANYWHERE TO MOVE', `PARRY: BIG BUTTON (${leftHanded ? 'LEFT' : 'RIGHT'}), DASH ABOVE IT`, 'SECOND FINGER TAP = PARRY']
      : d === 'gamepad'
        ? ['LEFT STICK: MOVE', 'A: PARRY   B / RT: DASH', 'START: PAUSE']
        : ['MOUSE: MOVE   LEFT CLICK: PARRY', 'RIGHT CLICK / SPACE: DASH', 'KEYS: WASD MOVE, J PARRY, K DASH'];
  return [...how, '', 'VIOLET: PARRY IT.', 'RED: DODGE OR DASH.', '', d === 'touch' ? 'TAP TO START' : 'PRESS ANY KEY TO START'];
}

export type HintKind = 'parry' | 'dash';
export const HINT_TEXT: Record<HintKind, string> = { parry: 'PARRY!', dash: "CAN'T PARRY - DASH!" };

/** One-time contextual hints: the first violet (parryable) and the first red projectile closing in on the hero. */
export class ContextHints {
  shown = new Set<HintKind>();
  constructor(private enabled: boolean) {}
  get done(): boolean {
    return this.shown.size === 2;
  }
  tick(st: Pick<SimState, 'hero' | 'projectiles' | 'alive'>): HintKind | null {
    if (!this.enabled || !st.alive) return null;
    const h = st.hero;
    for (const pr of st.projectiles) {
      const kind: HintKind = pr.parryable ? 'parry' : 'dash';
      if (this.shown.has(kind)) continue;
      const dx = h.x - pr.x;
      const dy = h.y - pr.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 70 && dx * pr.vx + dy * pr.vy > 0) {
        this.shown.add(kind);
        return kind;
      }
    }
    return null;
  }
}
