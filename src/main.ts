import '@fontsource/press-start-2p/400.css';
import Phaser from 'phaser';
import { TITLE, VIEW_HEIGHT, VIEW_WIDTH } from './config';
import { dailySeed, utcDateKey } from './daily';
import { audio } from './render/audio';
import { onAudioEvent } from './render/events';
import { GameScene, type RunConfig } from './render/GameScene';
import { TitleScene, type TitleConfig } from './render/TitleScene';
import { save } from './storage';

document.title = TITLE;

/** Touch device: a coarse pointer, or any touch seen so far. */
let touchSeen = false;
const isTouch = (): boolean => touchSeen || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

/** The area inside the safe-area padding (phone notch) that the canvas may use. */
function available(): { w: number; h: number } {
  const host = document.getElementById('game');
  return { w: host?.clientWidth || innerWidth, h: host?.clientHeight || innerHeight };
}

/**
 * Zoom: the largest integer that fits (pixel-perfect). Phones in landscape are often below 2x; there a fractional
 * fit is used instead of a tiny 1x canvas (nearest-neighbour keeps it sharp enough).
 */
function fitZoom(): number {
  const { w, h } = available();
  const exact = Math.min(w / VIEW_WIDTH, h / VIEW_HEIGHT);
  return exact >= 2 ? Math.floor(exact) : Math.max(0.5, exact);
}

function updateRotateOverlay(): void {
  const el = document.getElementById('rotate');
  if (el) el.hidden = !(isTouch() && innerHeight > innerWidth);
}

async function boot(): Promise<void> {
  try {
    await document.fonts.load(`8px "Press Start 2P"`);
  } catch {
    /* fall back to monospace */
  }
  const q = new URLSearchParams(location.search);
  // dev-only start wave (screenshots of boss fights); never available in a production build, never saved
  const devWave = import.meta.env.DEV && q.get('wave') ? Math.max(0, Math.min(99, Number(q.get('wave')) | 0)) : 0;

  const runConfig = (): RunConfig => {
    const difficulty = save().difficulty;
    return {
      difficulty,
      hero: save().hero,
      // Hard: the same daily seed for everyone. The UTC date is read ONCE per run and both the seed and the HUD label
      // come from it, so they can never disagree at midnight.
      makeRun:
        difficulty === 'hard'
          ? () => {
              const key = utcDateKey(new Date());
              return { seed: dailySeed(key), label: `HARD - DAILY ${key}` };
            }
          : () => ({ seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1, label: '' }),
      ...(devWave ? { startWave: devWave } : {}),
      isTouch,
      quit: (scene) => scene.scene.start('title', titleConfig),
    };
  };
  const titleConfig: TitleConfig = {
    isTouch,
    startRun: (scene) => scene.scene.start('game', runConfig()),
  };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    backgroundColor: '#0b0d12',
    pixelArt: true,
    roundPixels: true,
    input: { gamepad: true, activePointers: 4 },
    scale: { mode: Phaser.Scale.NONE, zoom: fitZoom() },
    banner: false,
    disableContextMenu: true,
  });
  game.scene.add('title', TitleScene, false);
  game.scene.add('game', GameScene, false);
  // dev: ?play=1 (screenshots, smoke tests) jumps straight into a run
  if (q.get('play') === '1') game.scene.start('game', runConfig());
  else game.scene.start('title', titleConfig);

  // audio: unlock on the first user input (autoplay policy; iOS needs a touch), mute while hidden
  onAudioEvent((e) => audio.sfx(e));
  const unlock = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'touch') touchSeen = true;
    audio.unlock();
    updateRotateOverlay();
  };
  for (const t of ['pointerdown', 'keydown', 'touchend']) addEventListener(t, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
  const resize = () => {
    game.scale.setZoom(fitZoom());
    updateRotateOverlay();
  };
  addEventListener('resize', resize);
  addEventListener('orientationchange', resize);
  updateRotateOverlay();
}

void boot();
