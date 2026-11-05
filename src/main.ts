import '@fontsource/press-start-2p/400.css';
import './style.css';
import Phaser from 'phaser';
import { TITLE, VIEW_HEIGHT, VIEW_WIDTH } from './config';
import { dailySeed, utcDateKey } from './daily';
import { getServerDate } from './net/api';
import { audio } from './render/audio';
import { onAudioEvent } from './render/events';
import { setDevice } from './render/hints';
import { GameScene, type RunConfig } from './render/GameScene';
import { TitleScene, type TitleConfig } from './render/TitleScene';
import { save } from './storage';

document.title = TITLE;

/** URL parameters that change behaviour (?wave, ?play) only work in dev and in the smoke-test build. */
const DEV_PARAMS = import.meta.env.DEV || import.meta.env.VITE_SMOKE === '1';

/** Touch device: a coarse pointer, or any touch seen so far. */
let touchSeen = false;
const isTouch = (): boolean => touchSeen || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

/** The area inside the safe-area padding (phone notch) that the canvas may use. */
function available(): { w: number; h: number } {
  const host = document.getElementById('game');
  if (!host) return { w: innerWidth, h: innerHeight };
  const cs = getComputedStyle(host);
  const px = (v: string) => parseFloat(v) || 0;
  return {
    w: (host.clientWidth || innerWidth) - px(cs.paddingLeft) - px(cs.paddingRight),
    h: (host.clientHeight || innerHeight) - px(cs.paddingTop) - px(cs.paddingBottom),
  };
}

/**
 * Zoom in DEVICE pixels (crisp at any devicePixelRatio, e.g. Windows 125%): the largest integer number of device pixels
 * per game pixel that fits. The canvas CSS size is then 480*z/dpr x 270*z/dpr, so every game pixel is an exact z x z
 * block of device pixels (nearest-neighbour). Below 2 device px per game px (small phones) a fractional fit is used.
 */
export function deviceZoom(availW: number, availH: number, dpr: number): { cssZoom: number; device: number; exact: boolean } {
  const d = Math.max(0.5, dpr || 1);
  const device = Math.floor(Math.min((availW * d) / VIEW_WIDTH, (availH * d) / VIEW_HEIGHT));
  if (device >= 2) return { cssZoom: device / d, device, exact: true };
  const frac = Math.max(0.5, Math.min(availW / VIEW_WIDTH, availH / VIEW_HEIGHT));
  return { cssZoom: frac, device: frac * d, exact: false };
}

function fitZoom(): number {
  const { w, h } = available();
  return deviceZoom(w, h, window.devicePixelRatio).cssZoom;
}

/** Put the canvas on whole device pixels (centring could land on a half device pixel and smear the pixel grid). */
function alignCanvas(game: Phaser.Game): void {
  const c = game.canvas;
  const host = document.getElementById('game');
  if (!c || !host) return;
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = available();
  const cs = getComputedStyle(host);
  // the size from the zoom itself (Phaser may apply the new canvas size only on its next refresh)
  const z = game.scale.zoom;
  const cw = VIEW_WIDTH * z;
  const ch = VIEW_HEIGHT * z;
  c.style.width = `${cw}px`;
  c.style.height = `${ch}px`;
  // a whole number of device pixels that is also a multiple of the browser's 1/64 CSS px layout unit
  // (browser zoom reports float32 ratios such as 1.100000023841858: search only a few device px, then just round)
  const snapDevice = (cssPx: number): number => {
    const k0 = Math.round(cssPx * dpr);
    for (let n = 0; n <= 12; n++)
      for (const k of [k0 - n, k0 + n])
        if (k >= 0 && Math.abs((k / dpr) * 64 - Math.round((k / dpr) * 64)) < 1e-3) return k / dpr;
    return k0 / dpr;
  };
  const left = (parseFloat(cs.paddingLeft) || 0) + snapDevice((w - cw) / 2);
  const top = (parseFloat(cs.paddingTop) || 0) + snapDevice((h - ch) / 2);
  c.style.position = 'absolute';
  c.style.left = `${left}px`;
  c.style.top = `${top}px`;
  c.style.margin = '0';
  game.scale.updateBounds(); // Phaser maps pointers with the canvas bounds: refresh them after moving the canvas
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
  const devWave = DEV_PARAMS && q.get('wave') ? Math.max(0, Math.min(99, Number(q.get('wave')) | 0)) : 0;

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
              // the server's date when the API answered (a wrong local clock cannot shift the seed), else local UTC
              const key = getServerDate() ?? utcDateKey(new Date());
              return { seed: dailySeed(key), label: `HARD - DAILY ${key}`, date: key };
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
  // dev/test only: ?play=1 jumps straight into a run; production builds ignore every URL parameter
  if (DEV_PARAMS && q.get('play') === '1') game.scene.start('game', runConfig());
  else game.scene.start('title', titleConfig);

  // audio: unlock on the first user input (autoplay policy; iOS needs a touch), mute while hidden
  onAudioEvent((e) => audio.sfx(e));
  const unlock = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'touch') touchSeen = true;
    // the active input device (controls line on the title, first-run card)
    if (e.type === 'keydown') setDevice('desktop');
    else if (e.type === 'pointerdown') setDevice((e as PointerEvent).pointerType === 'touch' ? 'touch' : 'desktop');
    audio.unlock();
    updateRotateOverlay();
  };
  for (const t of ['pointerdown', 'keydown', 'touchend']) addEventListener(t, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
  const resize = () => {
    game.scale.setZoom(fitZoom());
    alignCanvas(game);
    updateRotateOverlay();
  };
  addEventListener('resize', resize);
  addEventListener('orientationchange', resize);
  document.addEventListener('fullscreenchange', resize);
  // devicePixelRatio changes (browser zoom, moving the window to another monitor): re-arm a resolution query each time
  const watchDpr = () => {
    try {
      matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
        resize();
        watchDpr();
      }, { once: true });
    } catch {
      /* old browser: resize events still cover most cases */
    }
  };
  watchDpr();
  game.events.once(Phaser.Core.Events.READY, resize);
  setTimeout(resize, 0);
  updateRotateOverlay();
  if (isTouch()) setDevice('touch');
  addEventListener('gamepadconnected', () => setDevice('gamepad'));
}

void boot();
