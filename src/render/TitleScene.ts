/**
 * Title screen: the arena as an animated backdrop (forest, fog drift, landmark loops, forest eyes; no sim) and the
 * main menu. Play starts a run with the last chosen difficulty and hero.
 */
import Phaser from 'phaser';
import { TITLE, VIEW_HEIGHT, VIEW_WIDTH } from '../config';
import { DIFFICULTIES, persist, save } from '../storage';
import { audio } from './audio';
import { ARENA_PROPS, ATLAS, MANIFEST, bgKey, createAnimations, frame, preloadAssets, type SpriteName } from './assets';
import { bestPage, creditsPage, DIFF_LABEL, heroPage, settingsPage, type MenuCtx } from './menus';
import { C, FONT, MenuView, type MenuPage } from './ui';

export interface TitleConfig {
  isTouch: () => boolean;
  startRun: (scene: Phaser.Scene) => void;
}

export class TitleScene extends Phaser.Scene {
  private cfg!: TitleConfig;
  private menu!: MenuView;
  private fog!: Phaser.GameObjects.TileSprite;

  constructor() {
    super('title');
  }

  init(cfg: TitleConfig): void {
    this.cfg = cfg;
  }

  preload(): void {
    preloadAssets(this);
  }

  create(): void {
    createAnimations(this);
    const al: Record<string, number> = MANIFEST.layout.alphas;
    for (const f of MANIFEST.layout.forest) if (f.parallax > 0) this.add.image(0, 0, bgKey(f.name)).setOrigin(0);
    this.add.image(0, 0, bgKey('forest_mist')).setOrigin(0).setAlpha(al.forest_mist ?? 1);
    this.add.image(0, 0, bgKey('arena_ground')).setOrigin(0);
    for (const p of ARENA_PROPS.props) {
      const s = this.add.sprite(p.x, p.y, ATLAS, frame(p.sprite as SpriteName, p.frame)).setOrigin(0).setFlipX(p.flip);
      s.setDepth(p.kind === 'eyes' ? 900 : 10 + p.baseY);
      if (p.anim) s.play({ key: p.anim, startFrame: (p.x + p.y) % MANIFEST.sprites[p.anim as SpriteName].frames });
    }
    this.fog = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, bgKey('fog_overlay')).setOrigin(0).setDepth(800).setAlpha(al.fog_overlay ?? 1);
    this.add.image(0, 0, bgKey('vignette')).setOrigin(0).setDepth(801).setAlpha(al.vignette ?? 1);
    this.add.image(0, 0, bgKey('vignette_outer')).setOrigin(0).setDepth(801).setAlpha(al.vignette_outer ?? 1);
    this.add.image(0, 0, bgKey('forest_near')).setOrigin(0).setDepth(802);
    // a calm dark plate behind the menu so it reads over the arena
    this.add.rectangle(VIEW_WIDTH / 2, 150, 300, 190, 0x0b0d12, 0.72).setDepth(990);
    this.menu = new MenuView(this, 1000);
    audio.setMusic('music_menu');
    audio.setAmbience(false);
    this.showMain();
  }

  private ctx(): MenuCtx {
    return { menu: this.menu, isTouch: this.cfg.isTouch };
  }

  private showMain(focus = 0): void {
    const sv = save();
    const page: MenuPage = {
      title: TITLE.toUpperCase(),
      top: 76,
      items: [
        { label: () => 'PLAY', onActivate: () => this.cfg.startRun(this) },
        {
          label: () => `DIFFICULTY ${DIFF_LABEL(sv.difficulty)}`,
          onLeft: () => ((sv.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(sv.difficulty) + 2) % 3]!), persist()),
          onRight: () => ((sv.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(sv.difficulty) + 1) % 3]!), persist()),
        },
        { label: () => `HERO ${sv.hero.toUpperCase()}`, onActivate: () => this.menu.show(heroPage(() => this.showMain(2), () => this.showMain(2))) },
        { label: () => 'SETTINGS', onActivate: () => this.menu.show(settingsPage(this.ctx(), () => this.showMain(3))) },
        { label: () => 'BEST SCORES', onActivate: () => this.showBest() },
        { label: () => 'CREDITS', onActivate: () => this.menu.show(creditsPage(() => this.showMain(5))) },
      ],
      lines: () => ['', '', '', 'ONLINE BOARD: COMING SOON'],
    };
    this.menu.show(page, focus);
  }

  private showBest(): void {
    const show = (p: MenuPage) => this.menu.show(p);
    show(bestPage(() => this.showMain(4), show));
  }

  override update(_t: number, delta: number): void {
    this.fog.tilePositionX = Math.round(Math.sin(this.time.now / 10000) * 4);
    this.menu.pollPad(delta);
  }
}

export { C, FONT };
