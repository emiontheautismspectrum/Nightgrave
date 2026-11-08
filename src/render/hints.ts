/**
 * Minimal controls explanation (pure, no Phaser): the active input device, the one-line controls under PLAY, the
 * first-run card, and two one-time contextual hints ("Parry!", "Can't parry - dash!"). Render-only: they read sim
 * state and never change the sim or the replay.
 */
import type { SimState } from '../sim/state';
import { t } from '../i18n';

export type Device = 'desktop' | 'touch' | 'gamepad';
let device: Device = 'desktop';
export const getDevice = (): Device => device;
export function setDevice(d: Device): void {
  device = d;
}

/** `stick`: the touch movement mode (the fixed joystick, default) or the drag trackpad. */
export function controlsLine(d: Device, stick = true): string {
  if (d === 'touch') return stick ? t('controls.touchStick') : t('controls.touchDrag');
  if (d === 'gamepad') return t('controls.gamepad');
  return t('controls.desktop');
}

export function cardLines(d: Device, leftHanded: boolean, stick = true): string[] {
  const side = t(leftHanded ? 'side.left' : 'side.right');
  const how =
    d === 'touch'
      ? stick
        ? [t('card.stick', { side: t(leftHanded ? 'side.right' : 'side.left') }), t('card.parryBig', { side }), t('card.dashSmall')]
        : [t('card.drag'), t('card.parryBigDrag', { side }), t('card.secondFinger')]
      : d === 'gamepad'
        ? [t('card.padMove'), t('card.padButtons'), t('card.padPause')]
        : [t('card.mouse1'), t('card.mouse2'), t('card.keys')];
  return [...how, '', t('card.violet'), t('card.red'), '', d === 'touch' ? t('card.tapStart') : t('card.keyStart')];
}

export type HintKind = 'parry' | 'dash';
/** The contextual hint texts (the current language). */
export const hintText = (k: HintKind): string => t(k === 'parry' ? 'hint.parry' : 'hint.dash');

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
