import '@fontsource/press-start-2p/400.css';
import Phaser from 'phaser';
import { TITLE, VIEW_HEIGHT, VIEW_WIDTH } from './config';
import type { Difficulty } from './data/tuning';
import { dailySeed, utcDateKey } from './daily';
import { GameScene, type HeroKind, type RunConfig } from './render/GameScene';

document.title = TITLE;

/** Largest integer zoom that fits the window (pixel-perfect, nearest-neighbour). */
const fitZoom = (): number => Math.max(1, Math.floor(Math.min(innerWidth / VIEW_WIDTH, innerHeight / VIEW_HEIGHT)));

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

async function boot(): Promise<void> {
  try {
    await document.fonts.load(`8px "Press Start 2P"`);
  } catch {
    /* fall back to monospace */
  }
  const q = new URLSearchParams(location.search);
  const difficulty = pick<Difficulty>(q.get('d'), ['easy', 'medium', 'hard'], 'medium');
  const run: RunConfig = {
    difficulty,
    hero: pick<HeroKind>(q.get('hero'), ['knight', 'wisp'], 'knight'),
    // Hard: the same daily seed for everyone. The UTC date is read ONCE per run and both the seed and
    // the HUD label come from it, so they can never disagree at midnight.
    makeRun:
      difficulty === 'hard'
        ? () => {
            const key = utcDateKey(new Date());
            return { seed: dailySeed(key), label: `HARD - DAILY ${key}` };
          }
        : () => ({ seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1, label: '' }),
  };
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    backgroundColor: '#0b0d12',
    pixelArt: true,
    roundPixels: true,
    input: { gamepad: true },
    scale: { mode: Phaser.Scale.NONE, zoom: fitZoom() },
    banner: false,
  });
  game.scene.add('game', GameScene, true, run);
  addEventListener('resize', () => game.scale.setZoom(fitZoom()));
}

void boot();
