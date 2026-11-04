/** The single loader for generated art (atlas + backgrounds + manifest). */
import Phaser from 'phaser';
import atlasUrl from '../../assets/atlas/nightgrave.png?url';
import atlasData from '../../assets/atlas/nightgrave.json';
import manifest from '../../assets/atlas/manifest.json';

export const ATLAS = 'ng';
export const MANIFEST = manifest;
export type SpriteName = keyof typeof manifest.sprites;
export type BgName = keyof typeof manifest.backgrounds;

const backgroundUrls = import.meta.glob('../../assets/backgrounds/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const bgKey = (name: string): string => `bg_${name}`;
export const frame = (name: SpriteName, i = 0): string => `${name}_${i}`;

/** Animation playback rates (frames per second) and looping. */
const ANIM: Partial<Record<SpriteName, { fps: number; loop: boolean }>> = {
  knight_idle: { fps: 4, loop: true },
  knight_run: { fps: 12, loop: true },
  knight_parry: { fps: 20, loop: false },
  knight_dash: { fps: 10, loop: true },
  knight_death: { fps: 10, loop: false },
  wisp_idle: { fps: 6, loop: true },
  wisp_pulse: { fps: 20, loop: false },
  wisp_dash: { fps: 10, loop: true },
  wisp_death: { fps: 10, loop: false },
  orb_small: { fps: 6, loop: true },
  orb_large: { fps: 4, loop: true },
  rune_shard: { fps: 6, loop: true },
  blade: { fps: 16, loop: true },
  wraith: { fps: 6, loop: true },
  wraith_fade: { fps: 10, loop: false },
  parry_pulse: { fps: 27, loop: false },
  parry_spark: { fps: 30, loop: false },
  dash_trail: { fps: 15, loop: false },
  hit_flash: { fps: 20, loop: false },
  death_burst: { fps: 14, loop: false },
};

export function preloadAssets(scene: Phaser.Scene): void {
  scene.load.atlas(ATLAS, atlasUrl, atlasData);
  for (const name of Object.keys(manifest.backgrounds)) {
    const url = Object.entries(backgroundUrls).find(([path]) => path.endsWith(`/${name}.png`))?.[1];
    if (url) scene.load.image(bgKey(name), url);
  }
}

export function createAnimations(scene: Phaser.Scene): void {
  for (const [name, info] of Object.entries(manifest.sprites)) {
    if (info.frames < 2 || scene.anims.exists(name)) continue;
    const cfg = ANIM[name as SpriteName] ?? (name.startsWith('rune_glow') ? { fps: 3, loop: true } : { fps: 8, loop: true });
    scene.anims.create({
      key: name,
      frames: scene.anims.generateFrameNames(ATLAS, { prefix: `${name}_`, start: 0, end: info.frames - 1 }),
      frameRate: cfg.fps,
      repeat: cfg.loop ? -1 : 0,
    });
  }
}
