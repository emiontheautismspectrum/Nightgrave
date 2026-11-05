/**
 * The arena scene. It owns a Sim, feeds it one input frame per fixed 60 Hz tick and draws the result.
 * Rendering only READS sim state (and the per-tick event list); it never mutates it.
 */
import Phaser from 'phaser';
import { addText, setTextColor, snap, type UIText } from './text';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../config';
import { TICK_RATE, type Difficulty } from '../data/tuning';
import { utcDateKey } from '../daily';
import { encodeReplay, type Replay } from '../sim/replay';
import { dashCooldownLeft, dashDirection, isDashing, isFading, isParryActive, parryCooldownLeft, parryCooldownOf, Sim } from '../sim/sim';
import { HOLLOWS, RUNES } from '../data/arena';
import type { SimEvent } from '../sim/state';
import { bestScore, mergeFromDisk, persist, recordRun, save, shouldSaveRun } from '../storage';
import { ARENA_PROPS, ATLAS, MANIFEST, bgKey, createAnimations, frame, preloadAssets, type SpriteName } from './assets';
import { audio } from './audio';
import { pickMusic, SoundDiffer } from './audioLogic';
import { BossView } from './BossView';
import { online } from '../net/api';
import { SubmitPanel } from './SubmitPanel';
import { emitAudioEvent } from './events';
import { InputCollector } from './input';
import { settingsPage, type MenuCtx } from './menus';
import { canRestart, portraitPause, RunDriver, type PauseReason } from './runDriver';
import { cardLines, ContextHints, getDevice, HINT_TEXT } from './hints';
import { TouchModel } from './touch';
import { C, MenuView, onTap, type MenuPage } from './ui';

/** Frame time above this for PERF_WINDOW_MS lowers effects for the rest of the session (render only). */
const PERF_SLOW_MS = 20;
const PERF_WINDOW_MS = 3000;
const PAUSE_BTN = { x: 452, y: 5, w: 20, h: 16 };
const FADE_MS = 120;
// draw order (CLAUDE.md "Arena"): ground < ground telegraphs < y-sorted world < fog/vignette/overhang < HUD
const D_GROUND_TELE = 3;
const D_YSORT = 10;
const D_FOG = 1000;
const D_HUD = 2000;
/** Translucency: props in front of an actor fade to this alpha (wide props a bit less), in ~100 ms. */
const FADE_ALPHA = 0.35;
const FADE_ALPHA_WIDE = 0.45;
const WIDE_PROP_PX = 40;
const FADE_PER_MS = (1 - FADE_ALPHA) / 100;
const FADE_PAD = 4;
const ARENA_RECT = MANIFEST.layout.arena as [number, number, number, number];
const OVERHANG_DEPTH = 8; // forest overhang reaches at most 8 px into the arena (arena_layout.OVERHANG_MAX)
/** Base y of the portal altar prop: the shade and its ignite telegraph draw in front of it. */
const ALTAR_BASE = ARENA_PROPS.props.find((p) => p.sprite === 'portal_altar')?.baseY ?? 0;
const FONT = '"Press Start 2P", monospace';

export type HeroKind = 'knight' | 'wisp';

export interface RunConfig {
  difficulty: Difficulty;
  hero: HeroKind;
  /**
   * Called once per run. The seed source lives on the render side (crypto/clock are fine here, never in
   * src/sim). `label` is shown in the HUD (Hard: the UTC date the daily seed was derived from).
   */
  makeRun: () => { seed: number; label: string; date?: string };
  /** Dev only (previews/screenshots): start at this wave. Never set in production builds. Such runs are never saved. */
  startWave?: number;
  isTouch: () => boolean;
  /** Quit to the title screen. */
  quit: (scene: Phaser.Scene) => void;
}

export class GameScene extends Phaser.Scene {
  private cfg!: RunConfig;
  private sim!: Sim;
  private input2!: InputCollector;
  private driver!: RunDriver;
  private deadAt = 0;
  private runLabel = '';
  /** UTC date the run's seed was derived from (Hard): its daily best goes under this date, even across midnight. */
  private runDate = '';
  private runSeed = 0;
  private submit: SubmitPanel | null = null;
  private sounds = new SoundDiffer();
  private menu!: MenuView;
  private hint: Phaser.GameObjects.Container | null = null;
  private pauseBtn!: Phaser.GameObjects.Container;
  private touchGfx!: Phaser.GameObjects.Graphics;
  /** Dash direction chevron (render-only; the same pure rule the sim uses). */
  private chevron!: Phaser.GameObjects.Graphics;
  private touchIcons: Phaser.GameObjects.Image[] = [];
  private fxLow = false;
  private slowFor = 0;
  private mist: Phaser.GameObjects.Image | null = null;
  lastReplay: Replay | null = null;

  private hero!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private pulse!: Phaser.GameObjects.Sprite;
  private reticle!: Phaser.GameObjects.Image;
  private fog!: Phaser.GameObjects.TileSprite;
  private runes: Phaser.GameObjects.Sprite[] = [];
  private runeOverlay: Phaser.GameObjects.Sprite[] = [];
  private overhang!: Phaser.GameObjects.Image;
  private parallax: { sprite: Phaser.GameObjects.TileSprite; k: number }[] = [];
  /** Placed props, y-sorted with the actors; `alpha` eases toward 1 or the translucency target. */
  private props: { s: Phaser.GameObjects.Sprite; x0: number; y0: number; x1: number; y1: number; base: number; fade: number }[] = [];
  private casterViews = new Map<number, { body: Phaser.GameObjects.Sprite; tele: Phaser.GameObjects.Sprite; fx: Phaser.GameObjects.Sprite }>();
  private orbs = new Map<number, Phaser.GameObjects.Sprite>();
  /** Ids destroyed by a parry this frame: removed instantly (the spark replaces them), others fade out. */
  private parried = new Set<number>();
  private hudScore!: UIText;
  private hudMult!: UIText;
  private hudWave!: UIText;
  private hudDaily!: UIText;
  private banner!: UIText;
  private icons!: { parry: Phaser.GameObjects.Image; parryRing: Phaser.GameObjects.Image; dash: Phaser.GameObjects.Image; dashRing: Phaser.GameObjects.Image };
  private panel!: Phaser.GameObjects.Container;
  private panelText!: UIText;
  private bossView!: BossView;
  private vigOuter!: Phaser.GameObjects.Image;

  constructor() {
    super('game');
  }

  init(cfg: RunConfig): void {
    this.cfg = cfg;
  }

  preload(): void {
    preloadAssets(this);
  }

  create(): void {
    createAnimations(this);
    this.buildArena();
    // y-sorted world: props, casters, hero, projectiles and effects all use depth = Y_SORT + base y
    this.shadow = this.add.image(0, 0, ATLAS, frame('hero_shadow'));
    this.hero = this.add.sprite(0, 0, ATLAS, frame(`${this.cfg.hero}_idle`));
    this.pulse = this.add.sprite(0, 0, ATLAS, frame('parry_pulse')).setVisible(false);
    // fog, vignette and the thin near-forest overhang above the world, then telegraph copies, reticle, HUD
    // flat layers are palette-pure PNGs made translucent here (alphas shared with previews/checks via the manifest)
    const al: Record<string, number> = MANIFEST.layout.alphas;
    this.fog = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, bgKey('fog_overlay')).setOrigin(0).setDepth(D_FOG);
    this.fog.setAlpha(al.fog_overlay ?? 1);
    this.add.image(0, 0, bgKey('vignette')).setOrigin(0).setDepth(D_FOG + 1).setAlpha(al.vignette ?? 1);
    this.vigOuter = this.add.image(0, 0, bgKey('vignette_outer')).setOrigin(0).setDepth(D_FOG + 1).setAlpha(al.vignette_outer ?? 1);
    this.add.image(0, 0, bgKey('forest_near')).setOrigin(0).setDepth(D_FOG + 2);
    // the thin overhang reaching into the arena (<= 8 px) fades like a prop when an actor comes near the edge
    this.overhang = this.add.image(0, 0, bgKey('forest_overhang')).setOrigin(0).setDepth(D_FOG + 2);
    this.buildTelegraphOverlay();
    this.reticle = this.add.image(0, 0, ATLAS, frame('cursor_reticle')).setDepth(D_HUD);
    this.buildHud();
    this.bossView = new BossView(this, { ysort: D_YSORT, fog: D_FOG, hud: D_HUD }, this.vigOuter, this.banner, al.vignette_outer ?? 1);
    const st = save().settings;
    const touch = new TouchModel({ sensitivity: st.dragSensitivity, leftHanded: st.leftHanded, secondFingerParry: st.secondFingerParry });
    this.input2 = new InputCollector(this, touch, {
      uiHit: (x, y) => this.uiHit(x, y),
      hero: () => this.sim.state.hero,
      onPause: () => this.togglePause(),
      onTouch: () => this.applyTouchLayout(),
      menuOpen: () => this.menu?.active === true,
    });
    this.menu = new MenuView(this, D_HUD + 10, 0.7);
    this.buildPauseButton();
    this.touchGfx = this.add.graphics().setDepth(D_HUD);
    this.chevron = this.add.graphics();
    this.touchIcons = [this.add.image(0, 0, ATLAS, frame('icon_parry')), this.add.image(0, 0, ATLAS, frame('icon_dash'))];
    for (const i of this.touchIcons) i.setDepth(D_HUD + 1);
    // auto-pause when the tab loses focus or becomes hidden, or the device turns to portrait
    const onVis = () => {
      if (document.hidden) this.autoPause('hidden');
      else this.driver?.resume('hidden');
    };
    const onBlur = () => this.autoPause('blur');
    const onFocus = () => this.driver?.resume('blur');
    const onOrient = () => this.checkPortrait();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('resize', onOrient);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.submit?.close();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('resize', onOrient);
    });
    audio.setAmbience(true);
    this.applySettings();
    this.newRun();
    this.checkPortrait();
  }

  // ------------------------------------------------------------------ pause, touch, settings

  private uiHit(x: number, y: number): boolean {
    if (this.menu?.active || this.hint || this.submit?.hit(x, y)) return true;
    const b = PAUSE_BTN;
    return x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4;
  }

  private buildPauseButton(): void {
    const b = PAUSE_BTN;
    const bg = this.add.rectangle(0, 0, b.w, b.h, 0x0b0d12, 0.6).setOrigin(0).setStrokeStyle(1, 0x3a4558);
    const t = addText(this, b.w / 2 - 7, b.h / 2 - 4, 'II', { color: C.bone });
    this.pauseBtn = this.add.container(b.x, b.y, [bg, t]).setDepth(D_HUD + 1).setSize(b.w, b.h);
    this.pauseBtn.setInteractive(new Phaser.Geom.Rectangle(-4, -4, b.w + 8, b.h + 8), Phaser.Geom.Rectangle.Contains);
    onTap(this.pauseBtn, () => this.togglePause());
  }

  private isPortrait(): boolean {
    return portraitPause(window.innerWidth, window.innerHeight, this.cfg.isTouch());
  }

  private checkPortrait(): void {
    if (!this.driver) return;
    if (this.isPortrait()) this.autoPause('portrait');
    else this.driver.resume('portrait');
  }

  /** Focus loss, hidden tab, portrait: pause and open the pause menu so the player resumes deliberately. */
  private autoPause(r: PauseReason): void {
    if (!this.driver || !this.sim.state.alive) return;
    this.driver.pause(r);
    if (!this.menu.active) this.openPause();
  }

  private togglePause(): void {
    if (!this.sim.state.alive || this.hint) return;
    if (this.menu.active) this.closePause();
    else this.openPause();
  }

  private openPause(): void {
    this.driver.pause('menu');
    this.input2.clear();
    this.showPauseMenu();
  }

  private showPauseMenu(focus = 0): void {
    const page: MenuPage = {
      title: 'PAUSED',
      top: 90,
      items: [
        { label: () => 'RESUME', onActivate: () => this.closePause() },
        // restart or quit from pause discards the run: it is never saved as a best score
        { label: () => 'RESTART', onActivate: () => (this.menu.hide(), this.newRun()) },
        { label: () => 'SETTINGS', onActivate: () => this.menu.show(settingsPage(this.menuCtx(), () => this.showPauseMenu(2))) },
        { label: () => 'QUIT TO TITLE', onActivate: () => this.cfg.quit(this) },
      ],
      onBack: () => this.closePause(),
    };
    this.menu.show(page, focus);
  }

  private menuCtx(): MenuCtx {
    return { menu: this.menu, isTouch: this.cfg.isTouch, onSettings: () => this.applySettings(), onShowTouchHint: () => (this.closePause(), this.showTouchHint()) };
  }

  private closePause(): void {
    this.menu.hide();
    this.input2.clear();
    // a missed focus/visibility event must never leave the run frozen after RESUME
    if (document.hasFocus()) this.driver.resume('blur');
    if (!document.hidden) this.driver.resume('hidden');
    if (!this.isPortrait()) this.driver.resume('portrait');
    this.driver.resume('menu');
  }

  private applySettings(): void {
    const st = save().settings;
    const t = this.input2.touch;
    t.opts = { sensitivity: st.dragSensitivity, leftHanded: st.leftHanded, secondFingerParry: st.secondFingerParry };
    const low = st.effects === 'low' || this.fxLow;
    this.fog.setVisible(!low);
    this.mist?.setVisible(!low);
  }

  private applyTouchLayout(): void {
    if (!save().settings.touchHintSeen && !this.hint && this.sim.state.alive && this.sim.state.tick === 0) this.showTouchHint();
  }

  /**
   * First run on this device: one card with the controls of the active device and the colour rule. Dismissed by any
   * input after 250 ms; the dismissing press is never used as a parry or dash (the run is paused, presses cleared).
   */
  private showTouchHint(): void {
    if (this.hint) return;
    this.driver.pause('hint');
    const lines = cardLines(getDevice(), save().settings.leftHanded);
    const bg = this.add.rectangle(0, 0, VIEW_WIDTH, VIEW_HEIGHT, 0x0b0d12, 0.82).setOrigin(0);
    const t = snap(addText(this, VIEW_WIDTH / 2, VIEW_HEIGHT / 2, lines.join('\n'), { color: C.bone, align: 'center', lineSpacing: 5 }).setOrigin(0.5));
    this.hint = this.add.container(0, 0, [bg, t]).setDepth(D_HUD + 20);
    const shownAt = this.time.now;
    const dismiss = (e?: KeyboardEvent) => {
      if (e?.repeat) return; // a key held from the title (auto-repeat) must not close the card unread
      if (!this.hint || this.time.now - shownAt < 250) return; // the press that opened it must not also close it
      save().settings.touchHintSeen = true;
      persist();
      this.hint.destroy();
      this.hint = null;
      this.input.keyboard?.off('keydown', dismiss);
      this.input2.clear();
      this.driver.resume('hint');
    };
    this.hintDismiss = dismiss;
    this.hintPadArmed = false;
    bg.setInteractive().on('pointerup', dismiss);
    this.input.keyboard?.on('keydown', dismiss);
  }

  private hintDismiss: (() => void) | null = null;
  /** Gamepad buttons must be released once after the card opens (A held from PLAY must not close it). */
  private hintPadArmed = false;
  private ctxHints = new ContextHints(false);
  private ctxText: UIText | null = null;

  /** One-time contextual hints, shown away from the hero (never pausing, never covering him). */
  private contextHints(): void {
    const k = this.ctxHints.tick(this.sim.state);
    if (k) {
      this.ctxText?.destroy();
      const y = this.sim.state.hero.y < 135 ? 222 : 36;
      const t = snap(addText(this, VIEW_WIDTH / 2, y, HINT_TEXT[k], { color: k === 'parry' ? C.violet : '#d12b3a' }).setOrigin(0.5).setDepth(D_HUD));
      this.ctxText = t;
      this.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 300, onComplete: () => t.destroy() });
      // each hint is remembered on its own (a player who never meets a blade still sees 'PARRY!' only once)
      if (k === 'parry') save().settings.hintParrySeen = true;
      else save().settings.hintDashSeen = true;
      save().settings.hintsDone = save().settings.hintParrySeen && save().settings.hintDashSeen;
      persist();
    }
  }

  private buildArena(): void {
    const L = MANIFEST.layout;
    // far/mid forest: horizontally tileable, drifting slightly against the hero for parallax
    this.parallax = L.forest
      .filter((f) => f.parallax > 0)
      .map((f) => ({
        sprite: this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, bgKey(f.name)).setOrigin(0),
        k: f.parallax,
      }));
    this.mist = this.add.image(0, 0, bgKey('forest_mist')).setOrigin(0).setAlpha(MANIFEST.layout.alphas.forest_mist ?? 1);
    this.add.image(0, 0, bgKey('arena_ground')).setOrigin(0);
    // Runes rest on frame 0 (dim carved stone); they only glow as a rune-burst telegraph.
    this.runes = RUNES.map((r, g) => this.add.sprite(r.x, r.y, ATLAS, frame(`rune_glow_${g}` as SpriteName)));
    this.runes.forEach((r) => r.setDepth(D_GROUND_TELE));
    // Placed decor + landmarks, y-sorted with the actors by their base y (where they touch the ground)
    for (const p of ARENA_PROPS.props) {
      const s = this.add.sprite(p.x, p.y, ATLAS, frame(p.sprite as SpriteName, p.frame)).setOrigin(0).setFlipX(p.flip);
      s.setDepth(D_YSORT + p.baseY);
      if (p.anim) s.play({ key: p.anim, startFrame: (p.x + p.y) % MANIFEST.sprites[p.anim as SpriteName].frames });
      if (p.kind === 'eyes') {
        s.setDepth(D_FOG + 3); // ambient forest eyes glow above the overhang
        continue;
      }
      const fade = p.w > WIDE_PROP_PX ? FADE_ALPHA_WIDE : FADE_ALPHA;
      this.props.push({ s, x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h, base: p.baseY, fade });
    }
  }

  /** Telegraph copies drawn ABOVE the actors, so a hero standing on a rune still sees it light up. */
  private buildTelegraphOverlay(): void {
    this.runeOverlay = RUNES.map((r, g) =>
      this.add.sprite(r.x, r.y, ATLAS, frame(`rune_glow_${g}` as SpriteName)).setAlpha(0.65).setVisible(false).setDepth(D_FOG + 4),
    );
  }

  private buildHud(): void {
    // top band above the arena (y 4..22) on a subtle dark translucent strip
    this.add.rectangle(4, 4, VIEW_WIDTH - 8, 18, 0x0b0d12, 0.55).setOrigin(0).setDepth(D_HUD - 1);
    this.hudScore = addText(this, 8, 9, '');
    this.hudMult = addText(this, 78, 9, '', { color: '#ffb347' });
    this.hudWave = addText(this, 126, 9, '', { color: '#7f93b8' });
    this.hudDaily = addText(this, 292, 9, '', { color: '#7f93b8' });
    this.banner = addText(this, VIEW_WIDTH / 2, 70, '').setOrigin(0.5).setAlpha(0);
    // ability cooldown icons in the left margin at the bottom (x 8..40, y 214..262); touch buttons replace them
    this.icons = {
      parry: this.add.image(24, 228, ATLAS, frame('icon_parry')),
      parryRing: this.add.image(24, 228, ATLAS, frame('icon_ring')),
      dash: this.add.image(24, 251, ATLAS, frame('icon_dash')),
      dashRing: this.add.image(24, 251, ATLAS, frame('icon_ring')),
    };
    const bg = this.add.rectangle(0, 0, 232, 96, 0x0b0d12, 0.92).setStrokeStyle(1, 0x3a4558);
    this.panelText = addText(this, 0, 0, '', { align: 'center', lineSpacing: 5 }).setOrigin(0.5);
    this.panel = this.add.container(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, [bg, this.panelText]).setVisible(false);
    for (const o of [this.hudScore, this.hudMult, this.hudWave, this.banner, this.hudDaily, this.panel, ...Object.values(this.icons)])
      o.setDepth(D_HUD);
  }

  private newRun(): void {
    const run = this.cfg.makeRun();
    this.cfg.hero = save().hero;
    this.sim = new Sim(run.seed, this.cfg.difficulty, this.cfg.startWave ? { startWave: this.cfg.startWave } : {});
    this.driver = new RunDriver(this.sim);
    if (this.isPortrait()) this.driver.pause('portrait');
    this.sounds.reset();
    this.bossView.reset();
    this.runLabel = run.label;
    this.runDate = run.date ?? utcDateKey(new Date());
    this.runSeed = run.seed;
    this.submit?.close();
    this.submit = null;
    this.hudDaily.setText(run.label);
    for (const s of this.orbs.values()) s.destroy();
    this.orbs.clear();
    for (const v of this.casterViews.values()) for (const o of [v.body, v.tele, v.fx]) o.destroy();
    for (const sp of this.sigilViews.values()) sp.destroy();
    this.sigilViews.clear();
    this.casterViews.clear();
    for (const p of this.props) p.s.setAlpha(1);
    this.overhang.setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.banner.setAlpha(0);
    this.input2.newRun();
    this.panel.setVisible(false);
    this.ctxHints = new ContextHints(!save().settings.hintsDone);
    if (save().settings.hintParrySeen) this.ctxHints.shown.add('parry');
    if (save().settings.hintDashSeen) this.ctxHints.shown.add('dash');
    if (!save().settings.touchHintSeen && !this.hint) this.showTouchHint();
    this.hero.setVisible(true).play(`${this.cfg.hero}_idle`);
    this.shadow.setVisible(true);
  }

  override update(_time: number, delta: number): void {
    this.input2.pollPad();
    if (this.hint && this.hintDismiss) {
      const gp = this.input.gamepad;
      const pad = gp && gp.total > 0 ? gp.pad1 : null;
      const any = !!pad && pad.buttons.some((b) => b.pressed);
      if (!any) this.hintPadArmed = true;
      else if (this.hintPadArmed) this.hintDismiss();
    }
    if (this.menu.active && this.menu.pollPad(delta) && this.sim.state.alive) this.closePause();
    this.watchPerf(delta);
    const st = this.sim.state;
    if (!st.alive) {
      // Presses during the guard are discarded every frame, so the press held at death cannot skip the panel.
      const confirmed = this.input2.takeConfirm();
      if (confirmed && canRestart(this.time.now, this.deadAt) && !this.menu.active) this.newRun();
      this.draw();
      return;
    }
    this.driver.advance(delta, () => this.input2.sample(), () => {
      for (const e of this.sim.state.events) this.onEvent(e);
      for (const ev of this.sounds.tick(this.sim.state, this.sim.state.events, this.time.now)) emitAudioEvent(ev);
    });
    audio.setMusic(pickMusic('run', this.sim.state, audio.current()));
    this.contextHints();
    // slow, small fog drift (a few px back and forth; the fog layer is full-screen and avoids the calm zone)
    this.fog.tilePositionX = Math.round(Math.sin(this.sim.state.tick / 600) * 4);
    const dx = this.sim.state.hero.x - this.sim.params.cx;
    for (const l of this.parallax) l.sprite.tilePositionX = Math.round(dx * l.k);
    this.draw();
  }

  /** Frame time over 20 ms for 3 s: lower particles and fog for the rest of the session (render only, never back). */
  private watchPerf(delta: number): void {
    if (this.fxLow || this.driver.paused) return;
    this.slowFor = delta > PERF_SLOW_MS ? this.slowFor + delta : 0;
    if (this.slowFor >= PERF_WINDOW_MS) {
      this.fxLow = true;
      this.applySettings();
    }
  }

  private lowFx(): boolean {
    return this.fxLow || save().settings.effects === 'low';
  }

  private vibrate(ms: number): void {
    try {
      if (save().settings.haptics && this.cfg.isTouch() && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    } catch {
      /* not supported */
    }
  }

  private onEvent(e: SimEvent): void {
    const h = this.sim.state.hero;
    this.bossView.onEvent(e, this.sim.state);
    switch (e.type) {
      case 'parry_start': {
        if (this.cfg.hero === 'knight') {
          // Knight: shield bash in the facing direction (arc flash + metallic sparks)
          const f = h.facing;
          const b = this.add.sprite(Math.round(h.x + f * 9), Math.round(h.y - 2), ATLAS, frame('knight_bash')).setFlipX(f < 0).setAlpha(0.9);
          b.setDepth(D_YSORT + h.y + 4.1).play('knight_bash').once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => b.destroy());
        } else {
          // Wisp: round flare pulse
          const scale = Math.max(1, Math.round(this.sim.params.parryRadius / 12));
          this.pulse.setVisible(true).setScale(scale).play('parry_pulse');
          this.pulse.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.pulse.setVisible(false));
        }
        this.hero.play(this.cfg.hero === 'knight' ? 'knight_parry' : 'wisp_pulse');
        break;
      }
      case 'parry_hit':
        this.parried.add(e.id);
        if (!this.lowFx()) this.burst('parry_spark', e.x, e.y);
        if (this.cfg.hero === 'knight' && this.hero.anims.isPlaying) {
          // render-only hit-stop: the parry pose holds for a moment (the sim never pauses)
          this.hero.anims.pause();
          this.time.delayedCall(60, () => this.hero.anims.resume());
        }
        this.vibrate(12);
        break;
      case 'dash_start': {
        const trail = this.cfg.hero === 'knight' ? 'knight_cloak_trail' : 'dash_trail'; // cloak vs flame streak
        const t = this.add.sprite(h.x, h.y, ATLAS, frame(trail)).setFlipX(e.dirX < 0);
        t.setDepth(D_YSORT + h.y + 3);
        t.play(trail).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => t.destroy());
        this.hero.play(`${this.cfg.hero}_dash`);
        break;
      }
      case 'parry_whiff':
        // a miss must read as a miss: dim grey puff + soft low cue, no points
        this.burst('parry_fizzle', e.x, e.y - 2);
        break;
      case 'wave':
        if (e.wave > 0) {
          snap(this.banner.setText(`WAVE ${e.wave + 1}`).setAlpha(1));
          this.tweens.add({ targets: this.banner, alpha: 0, delay: 900, duration: 400 });
        }
        break;
      case 'death':
        this.vibrate(80);
        this.onDeath();
        break;
      default:
        break;
    }
  }

  private burst(anim: SpriteName, x: number, y: number): void {
    const s = this.add.sprite(Math.round(x), Math.round(y), ATLAS, frame(anim)).setDepth(D_YSORT + y + 8);
    s.play(anim).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
  }

  private onDeath(): void {
    const st = this.sim.state;
    this.deadAt = this.time.now;
    this.menu.hide();
    const hero = this.cfg.hero;
    const meta = { hero, input: [...this.input2.sources] };
    // a dev start-wave run is not a real run: no replay (startWave is not recorded) and never saved
    this.lastReplay = this.cfg.startWave ? null : encodeReplay(st.seed, st.difficulty, this.sim.log, meta);
    this.hero.play(`${hero}_death`);
    this.shadow.setVisible(false);
    this.burst('death_burst', st.hero.x, st.hero.y);
    if (save().settings.shake) this.cameras.main.shake(120, save().settings.reducedFlashes ? 0.004 : 0.01);
    const score = this.sim.score;
    const secs = st.survivalTicks / TICK_RATE;
    const d = this.cfg.difficulty;
    const prevBest = bestScore(save(), d);
    let isNew = false;
    if (shouldSaveRun('death', this.cfg.startWave)) {
      mergeFromDisk(); // another tab may have saved scores meanwhile
      isNew = recordRun(save(), d, { score, hero, date: utcDateKey(new Date()), secs }, this.runDate).newRecord;
      persist();
    }
    if (isNew) emitAudioEvent('new_record');
    const best = Math.max(prevBest, this.cfg.startWave ? 0 : score);
    this.panelText.setText(
      [
        isNew ? 'NEW RECORD!' : `SCORE ${score}`,
        isNew ? `SCORE ${score}` : `BEST ${best}`,
        `TIME ${secs.toFixed(1)}S  PARRIES ${st.parryCount}`,
        `BOSSES ${st.bossesDefeated}`,
        this.cfg.isTouch() ? 'TAP TO RETRY' : 'CLICK / SPACE / A TO RETRY',
      ].join('\n'),
    );
    snap(setTextColor(this.panelText, isNew ? C.gold : C.bone));
    this.panel.setVisible(true);
    this.input2.takeConfirm(); // ignore the press that was in flight when we died
    // Hard only, online, never a dev run: offer the board if the score would enter today's top 10
    if (d === 'hard' && online() && shouldSaveRun('death', this.cfg.startWave)) {
      const sim = this.sim;
      this.submit = new SubmitPanel(this, D_HUD + 6);
      void this.submit.offer({ date: this.runDate, seed: this.runSeed, score, hero, log: sim.log }, () => this.sim === sim);
    }
  }

  private draw(): void {
    const st = this.sim.state;
    const p = this.sim.params;
    const h = st.hero;
    const hx = Math.round(h.x);
    const hy = Math.round(h.y);
    this.hero.setPosition(hx, hy - 4).setFlipX(h.facing < 0).setDepth(D_YSORT + hy + 4);
    this.shadow.setPosition(hx, hy + 5).setDepth(D_YSORT + hy + 3.9);
    this.pulse.setPosition(hx, hy - 2).setDepth(D_YSORT + hy + 4.1);
    this.drawCasters();
    this.drawSigils();
    this.bossView.draw(st, p);
    this.drawChevron();
    if (st.alive) {
      const anim = this.hero.anims.currentAnim?.key ?? '';
      const busy = this.hero.anims.isPlaying && (anim.endsWith('_parry') || anim.endsWith('_pulse'));
      if (isDashing(st, p)) {
        if (!anim.endsWith('_dash')) this.hero.play(`${this.cfg.hero}_dash`);
      } else if (!busy && !isParryActive(st, p)) {
        const target = `${this.cfg.hero}_${this.cfg.hero === 'knight' && this.moving() ? 'run' : 'idle'}`;
        if (anim !== target) this.hero.play(target);
      }
    }

    // projectiles: sync sprite pool with sim state by id
    const seen = new Set<number>();
    for (const pr of st.projectiles) {
      seen.add(pr.id);
      let s = this.orbs.get(pr.id);
      if (!s) {
        s = this.add.sprite(0, 0, ATLAS, frame(pr.kind)).play(pr.kind).setAlpha(0);
        this.tweens.add({ targets: s, alpha: 1, duration: FADE_MS }); // render-only fade-in at the rim
        this.orbs.set(pr.id, s);
      }
      s.setPosition(Math.round(pr.x), Math.round(pr.y)).setDepth(D_YSORT + pr.y + s.height / 2);
      if (pr.kind === 'wraith') s.setFlipX(pr.vx < 0);
      if (pr.kind === 'orb_armored' && pr.armor === 0 && s.anims.currentAnim?.key !== 'orb_armored_crack') s.play('orb_armored_crack');
      if (isFading(st, pr) && s.anims.currentAnim?.key !== 'wraith_fade') s.play('wraith_fade');
    }

    // runes: dim at rest, a 3-step violet ramp while a burst is being telegraphed
    const glow = new Map<number, number>();
    for (const t of st.telegraphs) glow.set(t.rune, 1 + Math.min(2, Math.floor(((st.tick - t.start) / (t.fire - t.start)) * 3)));
    this.runes.forEach((r, g) => r.setFrame(frame(`rune_glow_${g}` as SpriteName, glow.get(g) ?? 0)));
    this.runeOverlay.forEach((r, g) => {
      const f = glow.get(g);
      r.setVisible(f !== undefined);
      if (f !== undefined) r.setFrame(frame(`rune_glow_${g}` as SpriteName, f));
    });
    for (const [id, s] of this.orbs) {
      if (!seen.has(id)) {
        this.orbs.delete(id);
        if (this.parried.has(id) || !st.alive) s.destroy();
        else this.tweens.add({ targets: s, alpha: 0, duration: FADE_MS, onComplete: () => s.destroy() });
      }
    }
    this.parried.clear();
    this.updateTranslucency();

    const ptr = this.input.activePointer;
    const cur = this.input2.cursorPos();
    this.reticle.setVisible(!!cur && st.alive && !this.driver.paused).setPosition(Math.round(cur?.x ?? ptr.worldX), Math.round(cur?.y ?? ptr.worldY));
    this.hudScore.setText(`${this.sim.score}`);
    this.hudMult.setText(`X${(st.multiplier / 100).toFixed(2)}`);
    this.hudWave.setText(st.wave >= 0 ? `WAVE ${st.wave + 1}` : '');
    this.hudDaily.setText(this.runLabel.replace('HARD - ', ''));
    const touch = this.cfg.isTouch();
    for (const o of Object.values(this.icons)) o.setVisible(!touch);
    if (!touch) {
      this.cooldownIcon(this.icons.parry, this.icons.parryRing, 'icon_parry', parryCooldownLeft(st, p), parryCooldownOf(st, p));
      this.cooldownIcon(this.icons.dash, this.icons.dashRing, 'icon_dash', dashCooldownLeft(st, p), p.dashCooldown);
    }
    this.drawTouchButtons(touch);
    // read-only snapshot for the smoke tests (copies of plain numbers; nothing can be written back into the sim)
    // dev / smoke-test builds only (VITE_SMOKE=1): never in a production bundle, it would make bots trivial
    if (import.meta.env.DEV || import.meta.env.VITE_SMOKE === '1') (window as unknown as { __ngDebug?: object }).__ngDebug = {
      x: st.hero.x, y: st.hero.y, tick: st.tick, alive: st.alive, parryStart: st.hero.parryStart, paused: this.driver.paused,
      menu: this.menu.active, hint: !!this.hint,
    };
  }

  /**
   * Small amber chevron ~10 px from the hero centre pointing where a dash would go right now (dashDirection: the same
   * function the sim uses). Bright when the dash is ready, dimmed on cooldown, hidden during the dash and after death.
   */
  private drawChevron(): void {
    const g = this.chevron;
    g.clear();
    const st = this.sim.state;
    const p = this.sim.params;
    // the true parry reach (radius from TUNING, follows any change automatically), both heroes, while the parry is active
    if (st.alive && isParryActive(st, p)) {
      g.lineStyle(1, 0xffb347, 0.45);
      g.strokeCircle(Math.round(st.hero.x), Math.round(st.hero.y - 2), p.parryRadius);
    }
    this.dust(st);
    if (!st.alive || isDashing(st, p)) return;
    const h = st.hero;
    const [dx, dy] = dashDirection(h, this.input2.peek(), p);
    const cx = h.x + dx * 10;
    const cy = h.y - 2 + dy * 10;
    const px = -dy;
    const py = dx;
    const ready = dashCooldownLeft(st, p) === 0;
    g.setDepth(D_YSORT + h.y + 4.2);
    g.fillStyle(0xffb347, ready ? 1 : 0.35);
    // a 6 px chevron: tip ahead, two wings back (pixel-rounded vertices)
    const r = (v: number) => Math.round(v);
    g.fillTriangle(r(cx + dx * 3), r(cy + dy * 3), r(cx - dx * 2 + px * 3), r(cy - dy * 2 + py * 3), r(cx - dx * 2 - px * 3), r(cy - dy * 2 - py * 3));
    g.fillStyle(0x0b0d12, ready ? 1 : 0.35);
    g.fillTriangle(r(cx), r(cy), r(cx - dx * 3 + px * 2), r(cy - dy * 3 + py * 2), r(cx - dx * 3 - px * 2), r(cy - dy * 3 - py * 2));
  }

  private lastDir = { x: 1, y: 0, at: 0 };
  /** Knight: small dust puffs on sharp direction changes (render-only). */
  private dust(st: { alive: boolean; hero: { x: number; y: number; dirX: number; dirY: number } }): void {
    if (this.cfg.hero !== 'knight' || !st.alive || this.lowFx()) return;
    const h = st.hero;
    const dot = h.dirX * this.lastDir.x + h.dirY * this.lastDir.y;
    if (dot < 0 && this.moving() && this.time.now - this.lastDir.at > 150) {
      const d = this.add.sprite(Math.round(h.x - h.dirX * 4), Math.round(h.y + 4), ATLAS, frame('dust_puff')).setDepth(D_YSORT + h.y + 3.5);
      d.play('dust_puff').once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => d.destroy());
      this.lastDir.at = this.time.now;
    }
    this.lastDir.x = h.dirX;
    this.lastDir.y = h.dirY;
  }

  private sigilViews = new Map<number, Phaser.GameObjects.Sprite>();
  /** Blood sigils: thin red outline while telegraphed, filled while lethal, then fading (frames from sim ticks). */
  private drawSigils(): void {
    const st = this.sim.state;
    const t = st.tick;
    const seen = new Set<number>();
    for (const g of st.sigils) {
      seen.add(g.id);
      let sp = this.sigilViews.get(g.id);
      if (!sp) {
        sp = this.add.sprite(Math.round(g.x), Math.round(g.y), ATLAS, frame('blood_sigil')).setDepth(D_GROUND_TELE + 1);
        this.sigilViews.set(g.id, sp);
      }
      const f = t < g.fill ? (t >> 3) & 1 : 2 + ((t >> 3) & 1);
      sp.setFrame(frame('blood_sigil', f)).setAlpha(t >= g.end ? Math.max(0, 1 - (t - g.end) / Math.max(1, g.gone - g.end)) : 1);
    }
    for (const [id, sp] of this.sigilViews)
      if (!seen.has(id)) {
        sp.destroy();
        this.sigilViews.delete(id);
      }
  }

  /** Touch buttons in the side margin: semi-transparent circles with cooldown rings (replace the desktop icons). */
  private drawTouchButtons(touch: boolean): void {
    const g = this.touchGfx;
    g.clear();
    this.touchIcons.forEach((i) => i.setVisible(touch));
    if (!touch) return;
    const st = this.sim.state;
    const p = this.sim.params;
    const t = this.input2.touch;
    const left = { parry: parryCooldownLeft(st, p) / parryCooldownOf(st, p), dash: dashCooldownLeft(st, p) / p.dashCooldown };
    t.buttons().forEach((b, i) => {
      const held = t.held(b.id);
      g.fillStyle(0x12161d, held ? 0.75 : 0.45).fillCircle(b.x, b.y, b.r);
      g.lineStyle(1, 0x3a4558, 0.9).strokeCircle(b.x, b.y, b.r);
      const cd = left[b.id];
      if (cd > 0) {
        g.lineStyle(2, 0xffb347, 0.9);
        g.beginPath();
        g.arc(b.x, b.y, b.r - 2, -Math.PI / 2, -Math.PI / 2 + (1 - cd) * Math.PI * 2, false);
        g.strokePath();
      }
      this.touchIcons[i]?.setPosition(b.x, b.y).setFrame(frame(b.id === 'parry' ? 'icon_parry' : 'icon_dash', cd > 0 ? 1 : 0)).setAlpha(0.85);
    });
  }

  private cooldownIcon(icon: Phaser.GameObjects.Image, ring: Phaser.GameObjects.Image, name: SpriteName, left: number, total: number): void {
    const cooling = left > 0;
    icon.setFrame(frame(name, cooling ? 1 : 0));
    ring.setVisible(cooling);
    if (cooling) ring.setFrame(frame('icon_ring', Math.min(11, Math.floor((1 - left / total) * 12))));
  }

  /** Casters are drawn purely from sim timestamps (phase progress), so the visuals can never desync. */
  private drawCasters(): void {
    const st = this.sim.state;
    const t = st.tick;
    const seen = new Set<number>();
    for (const c of st.casters) {
      seen.add(c.id);
      let v = this.casterViews.get(c.id);
      if (!v) {
        const shade = c.kind === 'shade';
        const hollow = c.source >= 0 ? HOLLOWS[c.source] : undefined;
        // the portal ignite and the shade are drawn above the altar prop, so the first visual cue is never hidden
        const tele = shade
          ? this.add.sprite(c.x, c.y, ATLAS, frame('portal_ignite')).setDepth(D_YSORT + ALTAR_BASE + 0.5)
          : this.add.sprite(hollow?.x ?? c.x, hollow?.y ?? c.y, ATLAS, frame('forest_eyes')).setDepth(D_FOG + 3);
        if (hollow) {
          const o = 7; // eyes glow in the dark just outside the gap (bottom: less, to stay above the boss bar)
          tele.setPosition(hollow.x + (hollow.side === 'left' ? -o : hollow.side === 'right' ? o : 0),
            hollow.y + (hollow.side === 'top' ? -o : hollow.side === 'bottom' ? 3 : 0));
        }
        const body = this.add.sprite(c.x, c.y + 4, ATLAS, frame(shade ? 'shade_rise' : 'stalker_emerge')).setOrigin(0.5, 1);
        body.setFlipX(!shade && (hollow?.side === 'right' || (hollow?.side !== 'left' && c.x > VIEW_WIDTH / 2)));
        body.setDepth(shade ? D_YSORT + ALTAR_BASE + 1 : D_YSORT + c.y + 4);
        const fx = this.add.sprite(c.x, c.y, ATLAS, frame(shade ? 'portal_smoke' : 'forest_leaf_ash')).setOrigin(0.5, 1);
        fx.setDepth(D_YSORT + c.y + 5).setVisible(false);
        v = { body, tele, fx };
        this.casterViews.set(c.id, v);
      }
      const shade = c.kind === 'shade';
      const prog = (a: number, b: number, n: number) => Math.min(n - 1, Math.floor(((t - a) / Math.max(1, b - a)) * n));
      v.tele.setVisible(t < c.appear0 || (shade && t < c.appear));
      if (t < c.appear0) v.tele.setFrame(frame(shade ? 'portal_ignite' : 'forest_eyes', shade ? prog(c.start, c.appear0, 4) : 1 + ((t >> 3) & 1)));
      else if (shade) v.tele.setFrame(frame('portal_ignite', 3));
      v.body.setVisible(t >= c.appear0);
      if (t < c.appear0) continue;
      if (t < c.appear) v.body.setFrame(frame(shade ? 'shade_rise' : 'stalker_emerge', prog(c.appear0, c.appear, 6)));
      else if (t < c.castStart) v.body.setFrame(frame(shade ? 'shade_idle' : 'stalker_idle', (t >> 3) & 3));
      else if (t < c.fire) v.body.setFrame(frame(shade ? 'shade_cast' : 'stalker_cast', prog(c.castStart, c.fire, 3)));
      else {
        const f = prog(c.fire, c.end, 6);
        v.body.setFrame(frame(shade ? 'shade_dissolve' : 'stalker_vanish', f));
        v.fx.setVisible(true).setFrame(frame(shade ? 'portal_smoke' : 'forest_leaf_ash', f));
      }
    }
    for (const [id, v] of this.casterViews) {
      if (seen.has(id)) continue;
      v.body.destroy();
      v.tele.destroy();
      v.fx.destroy();
      this.casterViews.delete(id);
    }
  }

  /**
   * Translucency (render-only): a prop drawn IN FRONT of the hero, a caster or a projectile (its base is lower on
   * screen) and overlapping that actor's box (+4 px) fades to ~35% alpha (~45% for wide props) within ~100 ms.
   */
  private updateTranslucency(): void {
    const st = this.sim.state;
    const boxes: [number, number, number, number, number][] = [];
    const h = st.hero;
    boxes.push([h.x - 8, h.y - 12, h.x + 8, h.y + 5, h.y + 4]); // also while dying: the death burst stays visible
    for (const pr of st.projectiles) {
      const hh = (this.orbs.get(pr.id)?.height ?? 12) / 2; // same base as the sprite's depth
      boxes.push([pr.x - hh, pr.y - hh, pr.x + hh, pr.y + hh, pr.y + hh]);
    }
    for (const c of st.casters) if (st.tick >= c.appear0) boxes.push([c.x - 10, c.y - 20, c.x + 10, c.y + 4, c.y + 4]);
    const bb = this.bossView.box(st);
    if (bb) boxes.push(bb);
    if (st.pickup) boxes.push([st.pickup.x - 7, st.pickup.y - 7, st.pickup.x + 7, st.pickup.y + 7, st.pickup.y + 6]);
    const dt = this.game.loop.delta;
    // overhang: fade while any actor box comes within (overhang depth + pad) of the arena rectangle's edge
    const [ax0, ay0, ax1, ay1] = ARENA_RECT;
    const reach = OVERHANG_DEPTH + FADE_PAD;
    const nearEdge = boxes.some(([x0, y0, x1, y1]) => x0 < ax0 + reach || x1 > ax1 - reach || y0 < ay0 + reach || y1 > ay1 - reach);
    const oTarget = nearEdge ? FADE_ALPHA : 1;
    const oa = this.overhang.alpha;
    if (oa !== oTarget)
      this.overhang.setAlpha(oa < oTarget ? Math.min(oTarget, oa + FADE_PER_MS * dt) : Math.max(oTarget, oa - FADE_PER_MS * dt));
    for (const p of this.props) {
      let behind = false;
      for (const [x0, y0, x1, y1, base] of boxes) {
        if (base < p.base && x1 + FADE_PAD > p.x0 && x0 - FADE_PAD < p.x1 && y1 + FADE_PAD > p.y0 && y0 - FADE_PAD < p.y1) {
          behind = true;
          break;
        }
      }
      const target = behind ? p.fade : 1;
      const a = p.s.alpha;
      if (a !== target) p.s.setAlpha(a < target ? Math.min(target, a + FADE_PER_MS * dt) : Math.max(target, a - FADE_PER_MS * dt));
    }
  }

  private moving(): boolean {
    const h = this.sim.state.hero;
    const last = this.lastPos;
    this.lastPos = { x: h.x, y: h.y };
    return Math.abs(h.x - last.x) + Math.abs(h.y - last.y) > 0.3;
  }
  private lastPos = { x: 0, y: 0 };
}
