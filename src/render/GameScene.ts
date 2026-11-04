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
import type { SimEvent } from '../sim/state';
import { ATLAS, MANIFEST, bgKey, type BgName, createAnimations, frame, preloadAssets, type SpriteName } from './assets';
import { InputCollector } from './input';

const STEP_MS = 1000 / TICK_RATE;
const MAX_STEPS_PER_FRAME = 5;
const RESTART_LOCKOUT_MS = 300;
const FADE_MS = 120;
const FONT = '"Press Start 2P", monospace';

export type HeroKind = 'knight' | 'wisp';

export interface RunConfig {
  difficulty: Difficulty;
  hero: HeroKind;
  /** Seed source lives on the render side (Math.random/crypto is fine here, never in src/sim). */
  makeSeed: () => number;
  /** UTC date of the daily seed (Hard only), shown in the HUD; read at each restart. */
  dateKey?: () => string;
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
  private parallax: { sprite: Phaser.GameObjects.TileSprite; k: number }[] = [];
  private actors!: Phaser.GameObjects.Layer;
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
    // vignette is clear inside the play circle and sits below the actors, so it never dims threats
    this.add.image(0, 0, bgKey('vignette')).setOrigin(0);
    this.actors = this.add.layer();
    this.shadow = this.add.image(0, 0, ATLAS, frame('hero_shadow'));
    this.hero = this.add.sprite(0, 0, ATLAS, frame(`${this.cfg.hero}_idle`));
    this.pulse = this.add.sprite(0, 0, ATLAS, frame('parry_pulse')).setVisible(false);
    this.actors.add([this.shadow, this.hero, this.pulse]);
    this.reticle = this.add.image(0, 0, ATLAS, frame('cursor_reticle'));
    this.buildHud();
    this.input2 = new InputCollector(this);
    this.newRun();
  }

  private buildArena(): void {
    const L = MANIFEST.layout;
    this.add.image(0, 0, bgKey('floor')).setOrigin(0);
    // three horizontally tileable tree layers; they drift against the hero for parallax
    this.parallax = L.forest.map((f) => ({
      sprite: this.add.tileSprite(f.x, f.y, VIEW_WIDTH, MANIFEST.backgrounds[f.name as BgName].h, bgKey(f.name)).setOrigin(0),
      k: f.parallax,
    }));
    for (const p of L.props) this.add.image(p.x, p.y, ATLAS, frame(p.name as SpriteName)).setOrigin(0);
    // fog drifts over ground and props but under the raised platform, which stays calm and readable
    this.fog = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, bgKey('fog_overlay')).setOrigin(0);
    this.add.image(L.ritualOrigin[0] ?? 0, L.ritualOrigin[1] ?? 0, bgKey('ground_ritual')).setOrigin(0);
    // Runes rest on frame 0 (dim carved stone); they only glow as a rune-burst telegraph.
    this.runes = L.runes.map((r, g) => this.add.sprite(r.x, r.y, ATLAS, frame(`rune_glow_${g}` as SpriteName)));
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
  }

  private newRun(): void {
    this.sim = new Sim(this.cfg.makeSeed(), this.cfg.difficulty);
    this.hudDaily.setText(this.cfg.dateKey ? `HARD - DAILY ${this.cfg.dateKey()}` : '');
    for (const s of this.orbs.values()) s.destroy();
    this.orbs.clear();
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
        this.actors.addAt(t, 0);
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
    const s = this.add.sprite(Math.round(x), Math.round(y), ATLAS, frame(anim));
    this.actors.add(s);
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
    this.hero.setPosition(hx, hy - 4).setFlipX(h.facing < 0);
    this.shadow.setPosition(hx, hy + 5);
    this.pulse.setPosition(hx, hy - 2);
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
        this.actors.add(s);
        this.orbs.set(pr.id, s);
      }
      s.setPosition(Math.round(pr.x), Math.round(pr.y));
      if (pr.kind === 'wraith') s.setFlipX(pr.vx < 0);
      if (isFading(st, pr) && s.anims.currentAnim?.key !== 'wraith_fade') s.play('wraith_fade');
    }

    // runes: dim at rest, a 3-step violet ramp while a burst is being telegraphed
    const glow = new Map<number, number>();
    for (const t of st.telegraphs) glow.set(t.rune, 1 + Math.min(2, Math.floor(((st.tick - t.start) / (t.fire - t.start)) * 3)));
    this.runes.forEach((r, g) => r.setFrame(frame(`rune_glow_${g}` as SpriteName, glow.get(g) ?? 0)));
    for (const [id, s] of this.orbs) {
      if (!seen.has(id)) {
        this.orbs.delete(id);
        if (this.parried.has(id) || !st.alive) s.destroy();
        else this.tweens.add({ targets: s, alpha: 0, duration: FADE_MS, onComplete: () => s.destroy() });
      }
    }
    this.parried.clear();

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

  private moving(): boolean {
    const h = this.sim.state.hero;
    const last = this.lastPos;
    this.lastPos = { x: h.x, y: h.y };
    return Math.abs(h.x - last.x) + Math.abs(h.y - last.y) > 0.3;
  }
  private lastPos = { x: 0, y: 0 };
}
