/**
 * Boss, beam, boss bar, pickups and their HUD timers. Render-only: everything is drawn from sim timestamps, so the
 * visuals can never desync from the simulation.
 */
import Phaser from 'phaser';
import { TICK_RATE } from '../data/tuning';
import { ticks } from '../sim/params';
import type { SimParams } from '../sim/params';
import { parryActiveTicks } from '../sim/sim';
import type { Boss, SimEvent, SimState } from '../sim/state';
import { ATLAS, frame, type SpriteName } from './assets';
import { save } from '../storage';

const BAR_X = 48;
const BAR_Y = 250;
const BAR_W = 384;
const BAR_H = 10;
const HIT_TICKS = 8;
const COL = { bone: 0xd9d2c0, bg0: 0x0b0d12, violet: 0x9b6bff, violetDark: 0x3d2a78, blood: 0xd12b3a, bloodDark: 0x6e1423, teal: 0x4fd1c5, gold: 0xffd86b, ember: 0xff7a2f };

export class BossView {
  private body: Phaser.GameObjects.Sprite;
  private bar: Phaser.GameObjects.Image;
  private gfx: Phaser.GameObjects.Graphics;
  private barGfx: Phaser.GameObjects.Graphics;
  private beams = new Map<number, Phaser.GameObjects.TileSprite>();
  private pickup: Phaser.GameObjects.Sprite;
  private glow: Phaser.GameObjects.Sprite;
  private timers: { icon: Phaser.GameObjects.Sprite; ring: Phaser.GameObjects.Image }[];
  private ember: Phaser.GameObjects.Text;

  constructor(
    private scene: Phaser.Scene,
    private depth: { ysort: number; fog: number; hud: number },
    private vignette: Phaser.GameObjects.Image,
    private banner: Phaser.GameObjects.Text,
    private baseVignette: number,
  ) {
    this.body = scene.add.sprite(0, 0, ATLAS, frame('eye_sentinel_idle')).setVisible(false);
    this.gfx = scene.add.graphics().setDepth(depth.fog - 1);
    this.bar = scene.add.image(BAR_X, BAR_Y, ATLAS, frame('boss_bar' as SpriteName)).setOrigin(0).setDepth(depth.hud).setVisible(false);
    this.barGfx = scene.add.graphics().setDepth(depth.hud);
    this.glow = scene.add.sprite(0, 0, ATLAS, frame('pickup_glow')).setVisible(false);
    this.pickup = scene.add.sprite(0, 0, ATLAS, frame('pickup_slow_time')).setVisible(false);
    this.timers = [0, 1].map((i) => ({
      // top HUD band (y 4..22): pickup timers as small icons with a shrinking ring
      icon: scene.add.sprite(262 + i * 22, 13, ATLAS, frame(i ? 'pickup_double_score' : 'pickup_slow_time')).setDepth(depth.hud),
      ring: scene.add.image(262 + i * 22, 13, ATLAS, frame('icon_ring')).setDepth(depth.hud),
    }));
    this.ember = scene.add.text(186, 9, '', { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', color: '#ff7a2f' }).setDepth(depth.hud);
  }

  reset(): void {
    for (const b of this.beams.values()) b.destroy();
    this.beams.clear();
    this.scene.tweens.killTweensOf(this.vignette);
    this.vignette.setAlpha(this.baseVignette);
  }

  /** Box for the translucency rule ([x0, y0, x1, y1, base]); base 0 for the hovering eye: everything over it fades. */
  box(st: SimState): [number, number, number, number, number] | null {
    const b = st.boss;
    if (!b) return null;
    return b.kind === 'eye' ? [b.x - 22, b.y - 20, b.x + 22, b.y + 22, 0] : [b.x - 12, b.y - 36, b.x + 12, b.y + 4, b.y + 4];
  }

  onEvent(e: SimEvent, st: SimState): void {
    switch (e.type) {
      case 'boss_intro':
        this.banner.setText(e.kind === 'eye' ? 'EYE SENTINEL' : 'LICH MAGE').setAlpha(1);
        this.scene.tweens.killTweensOf(this.banner);
        this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: 1500, duration: 400 });
        // the screen edges darken for the intro, then settle back
        this.scene.tweens.killTweensOf(this.vignette);
        // reduced flashes: a gentler darkening pulse
        this.scene.tweens.add({ targets: this.vignette, alpha: save().settings.reducedFlashes ? 0.55 : 0.85, duration: 400, yoyo: true, hold: 1200 });
        break;
      case 'boss_segment':
        if (st.boss) this.shatter(st.boss, e.remaining);
        break;
      case 'boss_defeated': {
        const s = this.scene.add.sprite(Math.round(e.x), Math.round(e.y), ATLAS, frame('death_burst')).setScale(2).setDepth(this.depth.fog - 1);
        s.play('death_burst').once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
        if (save().settings.shake) this.scene.cameras.main.shake(200, 0.006);
        this.banner.setText(`+${e.points}  EMBER CHARGE`).setAlpha(1);
        this.scene.tweens.killTweensOf(this.banner);
        this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: 1200, duration: 400 });
        break;
      }
      default:
        break;
    }
  }

  /** A removed segment shatters: four small shards fall and fade. */
  private shatter(b: Boss, remaining: number): void {
    const seg = (BAR_W - 4) / b.segments;
    const x = BAR_X + 2 + remaining * seg + seg / 2;
    for (let k = 0; k < 4; k++) {
      const r = this.scene.add.rectangle(x - 4 + k * 3, BAR_Y + 5, 2, 2, COL.bone).setDepth(this.depth.hud + 1);
      this.scene.tweens.add({ targets: r, x: r.x + (k - 1.5) * 4, y: r.y + 8 + k, alpha: 0, duration: 300, onComplete: () => r.destroy() });
    }
  }

  draw(st: SimState, p: SimParams): void {
    const t = st.tick;
    const b = st.boss;
    this.gfx.clear();
    this.barGfx.clear();
    this.body.setVisible(!!b);
    this.bar.setVisible(!!b);
    if (b) this.drawBoss(st, p, b);
    // beams: a tiled sprite rotated along the beam direction
    const seen = new Set<number>();
    for (const bm of st.beams) {
      seen.add(bm.serial);
      let s = this.beams.get(bm.serial);
      if (!s) {
        s = this.scene.add.tileSprite(bm.x, bm.y, bm.length, 4, ATLAS, frame('eye_beam')).setOrigin(0, 0.5).setDepth(this.depth.fog - 1);
        this.beams.set(bm.serial, s);
      }
      s.setFrame(frame('eye_beam', (t >> 2) & 1)).setRotation(Math.atan2(bm.dirY, bm.dirX));
    }
    for (const [k, s] of this.beams)
      if (!seen.has(k)) {
        s.destroy();
        this.beams.delete(k);
      }
    this.drawPickups(st, p);
  }

  private drawBoss(st: SimState, p: SimParams, b: Boss): void {
    const t = st.tick;
    const eye = b.kind === 'eye';
    const name = eye ? 'eye_sentinel' : 'lich_mage';
    const a = b.attack;
    const prog = (s0: number, s1: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(((t - s0) / Math.max(1, s1 - s0)) * n)));
    let f: [string, number];
    let alpha = 1;
    let rise = 0;
    if (b.deathTick >= 0) f = [`${name}_death`, prog(b.deathTick, b.deathTick + ticks(p.bosses.deathSeconds), 6)];
    else if (t < b.introEnd) {
      // intro: the eye rises from behind the tree line, the lich materialises at the portal
      if (eye) {
        f = [`${name}_idle`, (t >> 3) & 3];
        rise = Math.round((1 - (t - b.start) / Math.max(1, b.introEnd - b.start)) * 40);
        alpha = Math.min(1, (t - b.start) / 40);
      } else f = [`${name}_teleport_in`, prog(b.start, b.introEnd, 4)];
    } else if (b.hitTick >= 0 && t - b.hitTick < HIT_TICKS) f = [`${name}_hit`, (t - b.hitTick) < HIT_TICKS / 2 ? 0 : 1];
    else if (a && !eye && t < a.tpIn) f = [`${name}_teleport_out`, prog(a.tpOut, a.tpIn, 4)];
    else if (a && !eye && t < a.windStart) f = [`${name}_teleport_in`, prog(a.tpIn, a.windStart, 4)];
    else if (a && t >= a.windStart) f = [eye ? `${name}_charge` : `${name}_cast`, prog(a.windStart, a.fire, eye ? 3 : 4)];
    else f = [`${name}_idle`, (t >> 3) & 3];
    this.body.setFrame(frame(f[0] as SpriteName, f[1])).setAlpha(alpha);
    if (eye) this.body.setOrigin(0.5, 0.5).setPosition(b.x, b.y - rise).setDepth(this.depth.fog - 2);
    else this.body.setOrigin(0.5, 1).setPosition(b.x, b.y + 4).setDepth(this.depth.ysort + b.y + 4);

    // telegraphs during the wind-up: the beam's thin start line, the spawn points
    if (a && t >= a.windStart && t < a.fire) {
      const k = (t - a.windStart) / Math.max(1, a.fire - a.windStart);
      if (a.pattern === 'beam') {
        this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1);
        this.gfx.lineBetween(b.x, b.y, b.x + a.dirX * 440, b.y + a.dirY * 440);
      } else if (a.pattern === 'spawns') {
        this.gfx.lineStyle(1, COL.violet, 1);
        for (const [x, y] of a.points) this.gfx.strokeCircle(Math.round(x), Math.round(y), Math.max(2, Math.round(8 - k * 6)));
      }
    }

    // the bar: frame + one cell per segment (remaining = bone, removed = dark)
    const seg = (BAR_W - 4) / b.segments;
    for (let i = 0; i < b.segments; i++) {
      const x0 = Math.round(BAR_X + 2 + i * seg) + 1;
      const x1 = Math.round(BAR_X + 2 + (i + 1) * seg) - 1;
      const on = i < b.remaining;
      const flash = b.hitTick >= 0 && t - b.hitTick < HIT_TICKS && i === b.remaining; // the cell just removed
      this.barGfx.fillStyle(flash ? COL.violet : on ? COL.bone : COL.violetDark, flash || on ? 1 : 0.6);
      this.barGfx.fillRect(x0, BAR_Y + 2, x1 - x0, BAR_H - 4);
    }
  }

  private drawPickups(st: SimState, p: SimParams): void {
    const t = st.tick;
    const pk = st.pickup;
    this.pickup.setVisible(!!pk);
    this.glow.setVisible(!!pk);
    if (pk) {
      const name = pk.kind === 'slow' ? 'pickup_slow_time' : 'pickup_double_score';
      const blink = pk.expires - t < 2 * TICK_RATE && ((t >> 3) & 1) === 1; // last 2 s: blink before it despawns
      this.pickup.setFrame(frame(name, (t >> 3) & 3)).setPosition(pk.x, pk.y).setDepth(this.depth.ysort + pk.y + 6).setAlpha(blink ? 0.35 : 1);
      this.glow.setFrame(frame('pickup_glow', (t >> 4) & 3)).setPosition(pk.x, pk.y).setDepth(this.depth.ysort + pk.y + 5);
      this.glow.setTint(pk.kind === 'slow' ? COL.teal : COL.gold).setAlpha(0.6);
    }
    // HUD: active pickup timers as small icons with a shrinking ring
    const left = [st.slowUntil - t, st.doubleUntil - t];
    const total = [ticks(p.pickups.slowTime.seconds), ticks(p.pickups.doubleScore.seconds)];
    this.timers.forEach((v, i) => {
      const l = left[i]!;
      const on = l > 0;
      v.icon.setVisible(on);
      v.ring.setVisible(on);
      if (on) v.ring.setFrame(frame('icon_ring', Math.min(11, Math.floor((1 - l / total[i]!) * 12))));
    });
    const charges = Math.min(st.emberCharges, p.parryActiveByCharge.length - 1);
    void parryActiveTicks;
    this.ember.setText(charges > 0 ? `EMBER ${charges}` : '');
  }
}
