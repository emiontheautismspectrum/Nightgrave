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
import { BoardPanel } from './web/boardPanel';
import { computeLayout } from './web/layout';

document.title = TITLE;

/** URL parameters that change behaviour (?wave, ?play) only work in dev and in the smoke-test build. */
const DEV_PARAMS = import.meta.env.DEV || import.meta.env.VITE_SMOKE === '1';

/** Touch device: a coarse pointer, or any touch seen so far. */
let touchSeen = false;
const isTouch = (): boolean => touchSeen || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

/** Safe-area insets (phone notch) read from a probe element padded with env(safe-area-inset-*). */
function safeInsets(): { l: number; r: number; t: number; b: number } {
  const p = document.getElementById('safe');
  if (!p) return { l: 0, r: 0, t: 0, b: 0 };
  const cs = getComputedStyle(p);
  const n = (v: string) => parseFloat(v) || 0;
  return { l: n(cs.paddingLeft), r: n(cs.paddingRight), t: n(cs.paddingTop), b: n(cs.paddingBottom) };
}

let board: BoardPanel | null = null;

/**
 * Lay out the page: the framed game (crisp integer device-pixel scaling, Polish 1) with the board panel next to it
 * (desktop), the panel under it on narrow windows, the whole screen on phones (no panel, no footer during play).
 */
function applyLayout(game: Phaser.Game): void {
  const dpr = window.devicePixelRatio || 1;
  const phone = isTouch();
  const ins = phone ? safeInsets() : { l: 0, r: 0, t: 0, b: 0 };
  const L = computeLayout(innerWidth - ins.l - ins.r, innerHeight - ins.t - ins.b, dpr, phone);
  const frame = document.getElementById('frame');
  const footer = document.getElementById('footer');
  const page = document.getElementById('page');
  if (!frame || !page) return;
  document.body.classList.toggle('stack', L.mode === 'stack');
  document.body.classList.toggle('phone', L.mode === 'phone');
  page.style.setProperty('--gp', `${L.gp}px`);
  page.style.height = `${L.pageH}px`;
  frame.style.left = `${L.game.x + ins.l}px`;
  frame.style.top = `${L.game.y + ins.t}px`;
  frame.style.width = `${L.game.w}px`;
  frame.style.height = `${L.game.h}px`;
  game.scale.setZoom(L.zoom);
  const c = game.canvas;
  if (c) {
    c.style.width = `${L.game.w}px`;
    c.style.height = `${L.game.h}px`;
  }
  if (L.panel && !phone) {
    board ??= new BoardPanel('bpanel');
    if (!board.root.isConnected) page.append(board.root);
    const st = board.root.style;
    st.display = '';
    st.left = `${L.panel.x}px`;
    st.top = `${L.panel.y}px`;
    st.width = `${L.panel.w}px`;
    st.height = L.panel.h ? `${L.panel.h}px` : '';
    board.start();
  } else if (board) board.root.style.display = 'none';
  if (footer) {
    footer.style.top = `${L.footerY}px`;
    footer.hidden = phone;
  }
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
    scale: { mode: Phaser.Scale.NONE, zoom: computeLayout(innerWidth, innerHeight, window.devicePixelRatio || 1, isTouch()).zoom },
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
    applyLayout(game);
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
