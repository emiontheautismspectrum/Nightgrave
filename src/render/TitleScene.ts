/**
 * Title screen: the arena as an animated backdrop (forest, fog drift, landmark loops, forest eyes; no sim) and the
 * main menu. Play starts a run with the last chosen difficulty and hero.
 */
import Phaser from 'phaser';
import { TITLE, VIEW_HEIGHT, VIEW_WIDTH } from '../config';
import { fetchBoard, getServerDate, online, type Board } from '../net/api';
import { openBoardOverlay } from '../web/boardOverlay';
import { getScreen, onScreenChange } from '../web/screen';
import { requestRelayout } from '../web/runFlag';
import { utcDateKey } from '../daily';
import { addDays } from '../shared/daily';
import { DIFFICULTIES, persist, save } from '../storage';
import { audio } from './audio';
import { ARENA_PROPS, ATLAS, MANIFEST, bgKey, createAnimations, frame, preloadAssets, type SpriteName } from './assets';
import { bestPage, creditsPage, DIFF_LABEL, heroName, heroPage, heroShort, settingsPage, type MenuCtx } from './menus';
import { t, type Key } from '../i18n';
import { fmtDate, fmtInt } from '../i18n/format';
import { boardHeader, boardRow } from './boardTable';
import { controlsLine, getDevice } from './hints';
import { C, FONT, MenuView, type MenuPage } from './ui';
import { addText } from './text';
import { clampLines } from './textFit';
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
  private champion: { label: Key; name: string; message: string | null } | null = null;
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
    // phones in portrait: the arena stays as a dimmed background, cropped to fill the tall screen
    this.bgDim = this.add.rectangle(0, 0, VIEW_WIDTH, VIEW_HEIGHT, 0x0b0d12, 0.45).setOrigin(0).setDepth(950).setVisible(false);
    this.menu = new MenuView(this, 1000);
    // the screen changed (rotation, browser bars, resize): the canvas size, then the open page
    const off = onScreenChange(() => this.applyView());
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, this.filterCameras, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off();
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, this.filterCameras, this); // the scene is reused
      this.uiCam = null;
    });
    this.applyView();
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
    const W = this.scale.width;
    const H = this.scale.height;
    const cy = Math.round(H * 0.43); // the classic screen: 116
    const cover = this.add.rectangle(0, 0, W, H, 0x0b0d12, 0.92).setOrigin(0).setDepth(1100).setInteractive();
    this.introCover = cover;
    objs.push(cover);
    const word = TITLE.toUpperCase();
    const x0 = W / 2 - (word.length * 16) / 2;
    [...word].forEach((ch, i) => {
      const t = addText(this, x0 + i * 16, cy + 12, ch, { size: 16, color: C.bone }).setDepth(1102).setAlpha(0);
      this.tweens.add({ targets: t, y: cy - 8, alpha: 1, delay: 120 + i * 110, duration: 520, ease: 'Sine.easeOut' });
      objs.push(t);
    });
    if (!calm) {
      const ring = this.add.circle(W / 2, cy, 4, 0x9b6bff, 0).setStrokeStyle(1, 0x9b6bff, 0.8).setDepth(1101);
      this.tweens.add({ targets: ring, radius: 70, alpha: 0, duration: 1400, delay: 500 });
      objs.push(ring);
      for (let k = 0; k < 10; k++) {
        const sp = this.add.sprite(x0 + ((k * 37) % (word.length * 16)), cy + 24, ATLAS, frame('ember_particle')).setDepth(1103);
        this.tweens.add({ targets: sp, y: cy - 46 + (k % 4) * 8, alpha: 0, delay: 300 + k * 140, duration: 1100 });
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
  private uiCam: Phaser.Cameras.Scene2D.Camera | null = null;
  private bgDim: Phaser.GameObjects.Rectangle | null = null;
  private introCover: Phaser.GameObjects.Rectangle | null = null;

  /**
   * A phone in portrait: the canvas takes the real screen aspect (src/web/screen.ts), the arena art is a dimmed
   * background cropped to fill (main camera, zoomed), the menu sits on a fixed UI camera at 1:1 (crisp, large rows).
   * Everything else: the classic 480x270 screen.
   */
  private applyView(): void {
    const sc = getScreen();
    const portrait = sc.phone && sc.portrait;
    const W = portrait ? sc.portraitSize.w : VIEW_WIDTH;
    const H = portrait ? sc.portraitSize.h : VIEW_HEIGHT;
    if (this.scale.width !== W || this.scale.height !== H) this.scale.resize(W, H);
    const cam = this.cameras.main;
    cam.setViewport(0, 0, W, H);
    if (portrait) {
      cam.setZoom(Math.max(W / VIEW_WIDTH, H / VIEW_HEIGHT)).centerOn(VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
      if (!this.uiCam) this.uiCam = this.cameras.add(0, 0, W, H, false, 'ui');
      this.uiCam.setViewport(0, 0, W, H).setScroll(0, 0).setVisible(true);
    } else {
      cam.setZoom(1).setScroll(0, 0);
      this.uiCam?.setVisible(false);
      for (const o of this.children.list) o.cameraFilter = 0;
    }
    this.bgDim?.setVisible(portrait);
    if (this.introCover?.active) {
      // an intro still running covers the new size (and still takes the skip tap everywhere)
      this.introCover.setSize(W, H);
      (this.introCover.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setTo(0, 0, W, H);
    }
    requestRelayout();
    this.menu.relayout();
  }

  /** Portrait: menus and the intro (depth >= 1000) only on the UI camera, the arena only on the zoomed one. */
  private filterCameras(): void {
    const ui = this.uiCam;
    if (!ui || !ui.visible) return;
    const mainId = this.cameras.main.id;
    for (const o of this.children.list) o.cameraFilter = (o as unknown as { depth: number }).depth >= 1000 ? mainId : ui.id;
  }

  private async loadBoard(): Promise<void> {
    if (!online()) return;
    const b = await fetchBoard();
    if (!this.scene.isActive()) return;
    if (!b) {
      this.boardState = 'error';
    } else {
      this.board = b;
      this.boardState = 'ready';
      if (b.champion) this.champion = { label: 'champ.today', ...b.champion };
      else {
        const y = await fetchBoard(addDays(b.date, -1));
        if (!this.scene.isActive()) return;
        if (y?.champion) this.champion = { label: 'champ.yesterday', ...y.champion };
      }
    }
    if (this.onBoardPage) this.showBoard();
    else this.menu.refresh();
  }

  /**
   * The champion block: a label, the name, the message (untrusted text, rendered only as BitmapText) on at most two
   * lines with a clean "..." (portrait phones: as wide as the screen allows; desktop: one 40-char line fits).
   */
  private boardLines(): string[] {
    if (this.boardState === 'offline') return [t('board.footOffline')];
    if (this.boardState === 'loading') return [t('board.footLoading')];
    if (this.boardState === 'error') return [t('board.unavailable')];
    const c = this.champion;
    if (!c) return [t('champ.none')];
    const chars = Math.floor((this.scale.width - 48) / 8);
    return [t(c.label), ...clampLines(c.name, chars, 1), ...(c.message ? clampLines(`"${c.message}"`, chars, 2) : [])];
  }

  private showBoard(): void {
    this.onBoardPage = true;
    const b = this.board;
    const lines: string[] = [];
    // nothing to show: a short centred message (the panel sizes itself to it)
    if (this.boardState === 'loading') lines.push(t('board.loading'));
    else if (this.boardState === 'offline') lines.push(t('board.offline1'), t('board.offline2'));
    else if (!b) lines.push(t('board.unavailableDot'));
    else if (!b.top.length) lines.push(t('board.empty1'), t('board.empty2'));
    else {
      lines.push(t('board.dateLine', { date: fmtDate(b.date) }), '', boardHeader());
      for (const e of b.top)
        lines.push(boardRow(String(e.rank), e.name, fmtInt(e.score), heroShort(e.hero), t('unit.seconds', { n: Math.floor(e.durationTicks / 60) })));
    }
    this.menu.show({
      title: t('title.todaysBest'),
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
        { label: () => t('title.play'), onActivate: () => this.cfg.startRun(this) },
        {
          label: () => t('title.difficulty', { diff: DIFF_LABEL(sv.difficulty) }),
          onLeft: () => ((sv.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(sv.difficulty) + 2) % 3]!), persist()),
          onRight: () => ((sv.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(sv.difficulty) + 1) % 3]!), persist()),
        },
        // only for Hard: a dim second line with the daily seed date (not focusable)
        // phones: two deliberate centred lines; desktop: one line (it fits the 480 px screen)
        {
          label: () => {
            if (sv.difficulty !== 'hard') return '';
            const d = getServerDate() ?? utcDateKey(new Date());
            return t(this.cfg.isTouch() ? 'title.dailySeedTouch' : 'title.dailySeed', { date: fmtDate(d) });
          },
          disabled: true,
        },
        { label: () => t('title.hero', { hero: heroName(sv.hero) }), onActivate: () => this.menu.show(heroPage(() => this.showMain(3), () => this.showMain(3))) },
        { label: () => t('title.settings'), onActivate: () => this.menu.show(settingsPage(this.ctx(), () => this.showMain(4))) },
        { label: () => t('title.bestScores'), onActivate: () => this.showBest() },
        // phones: the full-screen board overlay (same content as the desktop side panel)
        { label: () => t(this.cfg.isTouch() ? 'title.board' : 'title.todaysBest'), onActivate: () => (this.cfg.isTouch() ? openBoardOverlay() : this.showBoard()) },
        { label: () => t('title.credits'), onActivate: () => this.menu.show(creditsPage(() => this.showMain(7))) },
      ],
      // the controls hint for the active device and the champion block: the footer (pinned at the bottom in portrait)
      lines: () => [],
      foot: () => [controlsLine(getDevice(), save().settings.touchControls !== 'drag'), '', ...this.boardLines()],
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
