/**
 * The arena scene. It owns a Sim, feeds it one input frame per fixed 60 Hz tick and draws the result.
 * Rendering only READS sim state (and the per-tick event list); it never mutates it.
 */
import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../config';
import { TICK_RATE, type Difficulty } from '../data/tuning';
import { encodeReplay, type Replay } from '../sim/replay';
import { dashCooldownLeft, isDashing, isFading, isParryActive, parryCooldownLeft, parryCooldownOf, Sim } from '../sim/sim';
import { playCue } from './sfx';
import { HOLLOWS, RUNES } from '../data/arena';
import type { SimEvent } from '../sim/state';
import { ARENA_PROPS, ATLAS, MANIFEST, bgKey, createAnimations, frame, preloadAssets, type SpriteName } from './assets';
import { InputCollector } from './input';

const STEP_MS = 1000 / TICK_RATE;
const MAX_STEPS_PER_FRAME = 5;
const RESTART_LOCKOUT_MS = 300;
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
  makeRun: () => { seed: number; label: string };
}

export class GameScene extends Phaser.Scene {
  private cfg!: RunConfig;
  private sim!: Sim;
  private input2!: InputCollector;
  private acc = 0;
  private best = 0;
  private deadAt = 0;
  lastReplay: Replay | null = null;

  private hero!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private pulse!: Phaser.GameObjects.Sprite;
  private reticle!: Phaser.GameObjects.Image;
  private fog!: Phaser.GameObjects.TileSprite;
  private runes: Phaser.GameObjects.Sprite[] = [];
  private runeOverlay: Phaser.GameObjects.Sprite[] = [];
  private parallax: { sprite: Phaser.GameObjects.TileSprite; k: number }[] = [];
  /** Placed props, y-sorted with the actors; `alpha` eases toward 1 or the translucency target. */
  private props: { s: Phaser.GameObjects.Sprite; x0: number; y0: number; x1: number; y1: number; base: number; fade: number }[] = [];
  private casterViews = new Map<number, { body: Phaser.GameObjects.Sprite; tele: Phaser.GameObjects.Sprite; fx: Phaser.GameObjects.Sprite }>();
  private orbs = new Map<number, Phaser.GameObjects.Sprite>();
  /** Ids destroyed by a parry this frame: removed instantly (the spark replaces them), others fade out. */
  private parried = new Set<number>();
  private hudScore!: Phaser.GameObjects.Text;
  private hudMult!: Phaser.GameObjects.Text;
  private hudWave!: Phaser.GameObjects.Text;
  private hudDaily!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private icons!: { parry: Phaser.GameObjects.Image; parryRing: Phaser.GameObjects.Image; dash: Phaser.GameObjects.Image; dashRing: Phaser.GameObjects.Image };
  private panel!: Phaser.GameObjects.Container;
  private panelText!: Phaser.GameObjects.Text;

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
    this.fog = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, bgKey('fog_overlay')).setOrigin(0).setDepth(D_FOG);
    this.add.image(0, 0, bgKey('vignette')).setOrigin(0).setDepth(D_FOG + 1);
    this.add.image(0, 0, bgKey('forest_near')).setOrigin(0).setDepth(D_FOG + 2);
    this.buildTelegraphOverlay();
    this.reticle = this.add.image(0, 0, ATLAS, frame('cursor_reticle')).setDepth(D_HUD);
    this.buildHud();
    this.input2 = new InputCollector(this);
    this.newRun();
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
    const style = { fontFamily: FONT, fontSize: '8px', color: '#d9d2c0' };
    this.hudScore = this.add.text(6, 6, '', style);
    this.hudMult = this.add.text(6, 18, '', { ...style, color: '#ffb347' });
    this.hudWave = this.add.text(6, 30, '', { ...style, color: '#3a4558' });
    this.banner = this.add.text(VIEW_WIDTH / 2, 70, '', { ...style, color: '#d9d2c0' }).setOrigin(0.5).setAlpha(0);
    // ability icons (top-right) with a pixel cooldown ring that fills clockwise
    const ix = VIEW_WIDTH - 40;
    const dx = VIEW_WIDTH - 16;
    this.icons = {
      parry: this.add.image(ix, 16, ATLAS, frame('icon_parry')),
      parryRing: this.add.image(ix, 16, ATLAS, frame('icon_ring')),
      dash: this.add.image(dx, 16, ATLAS, frame('icon_dash')),
      dashRing: this.add.image(dx, 16, ATLAS, frame('icon_ring')),
    };
    this.hudDaily = this.add.text(6, VIEW_HEIGHT - 12, '', { ...style, color: '#3a4558' });
    const bg = this.add.rectangle(0, 0, 200, 56, 0x0b0d12).setStrokeStyle(1, 0x3a4558);
    this.panelText = this.add.text(0, 0, '', { ...style, align: 'center', lineSpacing: 6 }).setOrigin(0.5);
    this.panel = this.add.container(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, [bg, this.panelText]).setVisible(false);
    for (const o of [this.hudScore, this.hudMult, this.hudWave, this.banner, this.hudDaily, this.panel, ...Object.values(this.icons)])
      o.setDepth(D_HUD);
  }

  private newRun(): void {
    const run = this.cfg.makeRun();
    this.sim = new Sim(run.seed, this.cfg.difficulty);
    this.hudDaily.setText(run.label);
    for (const s of this.orbs.values()) s.destroy();
    this.orbs.clear();
    for (const v of this.casterViews.values()) for (const o of [v.body, v.tele, v.fx]) o.destroy();
    this.casterViews.clear();
    for (const p of this.props) p.s.setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.banner.setAlpha(0);
    this.acc = 0;
    this.input2.clear();
    this.panel.setVisible(false);
    this.hero.setVisible(true).play(`${this.cfg.hero}_idle`);
    this.shadow.setVisible(true);
  }

  override update(_time: number, delta: number): void {
    this.input2.pollPad();
    const st = this.sim.state;
    if (!st.alive) {
      // Presses during the lockout are discarded every frame, so a panic click cannot restart later.
      const confirmed = this.input2.takeConfirm();
      if (confirmed && this.time.now - this.deadAt > RESTART_LOCKOUT_MS) this.newRun();
      this.draw();
      return;
    }
    this.acc = Math.min(this.acc + delta, STEP_MS * MAX_STEPS_PER_FRAME);
    while (this.acc >= STEP_MS && this.sim.state.alive) {
      this.acc -= STEP_MS;
      this.sim.step(this.input2.sample());
      for (const e of this.sim.state.events) this.onEvent(e);
    }
    this.fog.tilePositionX = Math.floor(this.sim.state.tick / 12);
    const dx = this.sim.state.hero.x - this.sim.params.cx;
    for (const l of this.parallax) l.sprite.tilePositionX = Math.round(dx * l.k);
    this.draw();
  }

  private onEvent(e: SimEvent): void {
    const h = this.sim.state.hero;
    switch (e.type) {
      case 'parry_start': {
        const scale = Math.max(1, Math.round(this.sim.params.parryRadius / 12));
        this.pulse.setVisible(true).setScale(scale).play('parry_pulse');
        this.pulse.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.pulse.setVisible(false));
        this.hero.play(this.cfg.hero === 'knight' ? 'knight_parry' : 'wisp_pulse');
        break;
      }
      case 'parry_hit':
        this.parried.add(e.id);
        playCue('parry');
        this.burst('parry_spark', e.x, e.y);
        break;
      case 'dash_start': {
        const t = this.add.sprite(h.x, h.y, ATLAS, frame('dash_trail')).setFlipX(e.dirX < 0);
        t.setDepth(D_YSORT + h.y + 3);
        t.play('dash_trail').once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => t.destroy());
        this.hero.play(`${this.cfg.hero}_dash`);
        playCue('dash');
        break;
      }
      case 'parry_whiff':
        // a miss must read as a miss: dim grey puff + soft low cue, no points
        this.burst('parry_fizzle', e.x, e.y - 2);
        playCue('whiff');
        break;
      case 'telegraph':
        playCue('telegraph');
        break;
      case 'wave':
        if (e.wave > 0) {
          this.banner.setText(`WAVE ${e.wave + 1}`).setAlpha(1);
          this.tweens.add({ targets: this.banner, alpha: 0, delay: 900, duration: 400 });
          playCue('wave');
        }
        break;
      case 'death':
        playCue('death');
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
    this.lastReplay = encodeReplay(st.seed, st.difficulty, this.sim.log);
    this.hero.play(`${this.cfg.hero}_death`);
    this.shadow.setVisible(false);
    this.burst('death_burst', st.hero.x, st.hero.y);
    this.cameras.main.shake(120, 0.01);
    const score = this.sim.score;
    const isBest = score > this.best;
    this.best = Math.max(this.best, score);
    const secs = (st.survivalTicks / TICK_RATE).toFixed(1);
    this.panelText.setText(
      `SCORE ${score}${isBest ? ' NEW!' : ''}\nBEST ${this.best}   ${secs}S\nCLICK / SPACE TO RETRY`,
    );
    this.panel.setVisible(true);
    this.input2.takeConfirm(); // ignore the press that was in flight when we died
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
    this.reticle.setVisible(this.input2.mode === 'cursor' && st.alive).setPosition(Math.round(ptr.worldX), Math.round(ptr.worldY));
    this.hudScore.setText(`${this.sim.score}`);
    this.hudMult.setText(`X${(st.multiplier / 100).toFixed(2)}`);
    this.hudWave.setText(st.wave >= 0 ? `WAVE ${st.wave + 1}` : '');
    this.cooldownIcon(this.icons.parry, this.icons.parryRing, 'icon_parry', parryCooldownLeft(st, p), parryCooldownOf(st, p));
    this.cooldownIcon(this.icons.dash, this.icons.dashRing, 'icon_dash', dashCooldownLeft(st, p), p.dashCooldown);
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
    const dt = this.game.loop.delta;
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
