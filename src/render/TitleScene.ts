/**
 * Title screen: the arena as an animated backdrop (forest, fog drift, landmark loops, forest eyes; no sim) and the
 * main menu. Play starts a run with the last chosen difficulty and hero.
 */
import Phaser from 'phaser';
import { TITLE, VIEW_HEIGHT, VIEW_WIDTH } from '../config';
import { fetchBoard, getServerDate, online, type Board } from '../net/api';
import { openBoardOverlay } from '../web/boardOverlay';
import { utcDateKey } from '../daily';
import { addDays } from '../shared/daily';
import { DIFFICULTIES, persist, save } from '../storage';
import { audio } from './audio';
import { ARENA_PROPS, ATLAS, MANIFEST, bgKey, createAnimations, frame, preloadAssets, type SpriteName } from './assets';
import { bestPage, creditsPage, DIFF_LABEL, heroPage, settingsPage, type MenuCtx } from './menus';
import { controlsLine, getDevice } from './hints';
import { C, FONT, MenuView, type MenuPage } from './ui';
import { addText } from './text';
import { emitAudioEvent } from './events';

/** The intro plays once per browser session (sessionStorage; blocked storage = play it, never crash). */
function introSeen(): boolean {
  try {
    return sessionStorage.getItem('nightgrave.intro') === '1';
  } catch {
    return false;
  }
}
function markIntroSeen(): void {
  try {
    sessionStorage.setItem('nightgrave.intro', '1');
  } catch {
    /* blocked */
  }
}

export interface TitleConfig {
  isTouch: () => boolean;
  startRun: (scene: Phaser.Scene) => void;
}

export class TitleScene extends Phaser.Scene {
  private cfg!: TitleConfig;
  private menu!: MenuView;
  private fog!: Phaser.GameObjects.TileSprite;
  /** Board state for the title: lines are rendered only with Phaser text objects. */
  private board: Board | null = null;
  private boardState: 'offline' | 'loading' | 'error' | 'ready' = online() ? 'loading' : 'offline';
  private champion: { label: string; name: string; message: string | null } | null = null;
  private onBoardPage = false;
  private shownDevice = getDevice();

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
    this.menu = new MenuView(this, 1000);
    audio.setMusic('music_menu');
    audio.setAmbience(false);
    this.showMain();
    void this.loadBoard();
    if (!introSeen()) this.playIntro();
  }

  /**
   * Site-entry intro (2-3 s, once per browser session): the title letters rise out of the fog with a few ember sparks
   * and a rune glow, then the menu fades in. Any input skips it and is NOT passed on; reduced flashes: no sparks/glow.
   */
  private playIntro(): void {
    markIntroSeen();
    this.menu.active = false; // the menu ignores keys / pad while the intro runs
    const calm = save().settings.reducedFlashes;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const cover = this.add.rectangle(0, 0, VIEW_WIDTH, VIEW_HEIGHT, 0x0b0d12, 0.92).setOrigin(0).setDepth(1100).setInteractive();
    objs.push(cover);
    const word = TITLE.toUpperCase();
    const x0 = VIEW_WIDTH / 2 - (word.length * 16) / 2;
    [...word].forEach((ch, i) => {
      const t = addText(this, x0 + i * 16, 128, ch, { size: 16, color: C.bone }).setDepth(1102).setAlpha(0);
      this.tweens.add({ targets: t, y: 108, alpha: 1, delay: 120 + i * 110, duration: 520, ease: 'Sine.easeOut' });
      objs.push(t);
    });
    if (!calm) {
      const ring = this.add.circle(VIEW_WIDTH / 2, 116, 4, 0x9b6bff, 0).setStrokeStyle(1, 0x9b6bff, 0.8).setDepth(1101);
      this.tweens.add({ targets: ring, radius: 70, alpha: 0, duration: 1400, delay: 500 });
      objs.push(ring);
      for (let k = 0; k < 10; k++) {
        const sp = this.add.sprite(x0 + ((k * 37) % (word.length * 16)), 140, ATLAS, frame('ember_particle')).setDepth(1103);
        this.tweens.add({ targets: sp, y: 70 + (k % 4) * 8, alpha: 0, delay: 300 + k * 140, duration: 1100 });
        objs.push(sp);
      }
      emitAudioEvent('rune_charge');
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.input.keyboard?.off('keydown', skip);
      this.tweens.add({ targets: objs, alpha: 0, duration: 260, onComplete: () => objs.forEach((o) => o.destroy()) });
      this.time.delayedCall(140, () => (this.menu.active = true));
    };
    const skip = () => finish();
    cover.once('pointerdown', skip);
    this.input.keyboard?.on('keydown', skip);
    this.introSkip = skip;
    this.time.delayedCall(2500, finish);
  }

  private introSkip: (() => void) | null = null;

  private async loadBoard(): Promise<void> {
    if (!online()) return;
    const b = await fetchBoard();
    if (!this.scene.isActive()) return;
    if (!b) {
      this.boardState = 'error';
    } else {
      this.board = b;
      this.boardState = 'ready';
      if (b.champion) this.champion = { label: "TODAY'S CHAMPION", ...b.champion };
      else {
        const y = await fetchBoard(addDays(b.date, -1));
        if (!this.scene.isActive()) return;
        if (y?.champion) this.champion = { label: "YESTERDAY'S CHAMPION", ...y.champion };
      }
    }
    if (this.onBoardPage) this.showBoard();
    else this.menu.refresh();
  }

  /** Always 3 lines (the menu re-renders a fixed number of lines); never wider than the panel. */
  private boardLines(): string[] {
    if (this.boardState === 'offline') return ['ONLINE BOARD: OFFLINE', '', ''];
    if (this.boardState === 'loading') return ['ONLINE BOARD: LOADING', '', ''];
    if (this.boardState === 'error') return ['BOARD UNAVAILABLE', '', ''];
    const c = this.champion;
    if (!c) return ['NO CHAMPION YET TODAY', '', ''];
    return [c.label, c.name, c.message ? `"${c.message}"` : ''];
  }

  private showBoard(): void {
    this.onBoardPage = true;
    const b = this.board;
    const lines: string[] = [];
    // nothing to show: a short centred message (the panel sizes itself to it)
    if (this.boardState === 'loading') lines.push('LOADING...');
    else if (this.boardState === 'offline') lines.push('BOARD OFFLINE.', 'YOUR HARD RUNS ARE SAVED LOCALLY.');
    else if (!b) lines.push('BOARD UNAVAILABLE.');
    else if (!b.top.length) lines.push('NO VERIFIED RUNS YET TODAY.', 'BE THE FIRST!');
    else {
      lines.push(`HARD ${b.date} UTC`, '', '#  NAME              SCORE  HERO    TIME');
      for (const e of b.top)
        lines.push(`${String(e.rank).padStart(2)} ${e.name.padEnd(16)} ${String(e.score).padStart(7)}  ${e.hero.toUpperCase().padEnd(6)} ${String(Math.floor(e.durationTicks / 60)).padStart(4)}S`);
    }
    this.menu.show({
      title: "TODAY'S BEST",
      items: [],
      top: 48,
      lines: () => lines,
      onBack: () => {
        this.onBoardPage = false;
        this.showMain(6);
      },
    });
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
        // only for Hard: a dim second line with the daily seed date (not focusable)
        { label: () => (sv.difficulty === 'hard' ? `DAILY SEED ${getServerDate() ?? utcDateKey(new Date())} - ONLINE BOARD` : ''), disabled: true },
        { label: () => `HERO ${sv.hero.toUpperCase()}`, onActivate: () => this.menu.show(heroPage(() => this.showMain(3), () => this.showMain(3))) },
        { label: () => 'SETTINGS', onActivate: () => this.menu.show(settingsPage(this.ctx(), () => this.showMain(4))) },
        { label: () => 'BEST SCORES', onActivate: () => this.showBest() },
        // phones: the full-screen board overlay (same content as the desktop side panel)
        { label: () => (this.cfg.isTouch() ? 'BOARD' : "TODAY'S BEST"), onActivate: () => (this.cfg.isTouch() ? openBoardOverlay() : this.showBoard()) },
        { label: () => 'CREDITS', onActivate: () => this.menu.show(creditsPage(() => this.showMain(7))) },
      ],
      // the controls hint for the active device sits below the menu block, above the online-board lines
      lines: () => ['', controlsLine(getDevice()), '', ...this.boardLines()],
    };
    this.menu.show(page, focus);
  }

  private showBest(): void {
    const show = (p: MenuPage) => this.menu.show(p);
    show(bestPage(() => this.showMain(5), show));
  }

  override update(_t: number, delta: number): void {
    this.fog.tilePositionX = Math.round(Math.sin(this.time.now / 10000) * 4);
    if (!this.menu.active && this.introSkip) {
      const gp = this.input.gamepad;
      const pad = gp && gp.total > 0 ? gp.pad1 : null;
      if (pad && pad.buttons.some((b) => b.pressed)) this.introSkip();
    }
    this.menu.pollPad(delta);
    if (getDevice() !== this.shownDevice) {
      this.shownDevice = getDevice();
      this.menu.refresh();
    }
  }
}

export { C, FONT };
