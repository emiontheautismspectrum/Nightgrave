/**
 * Boss, beam, boss bar, pickups and their HUD timers. Render-only: everything is drawn from sim timestamps, so the
 * visuals can never desync from the simulation.
 */
import Phaser from 'phaser';
import { addText, setTextValue, snap, type UIText } from './text';
import { TICK_RATE } from '../data/tuning';
import { ticks } from '../sim/params';
import type { SimParams } from '../sim/params';
import { parryActiveTicks } from '../sim/sim';
import type { Boss, Chain, Ring, SimEvent, SimState } from '../sim/state';
import { BossMemo, bossFx, bossLook, bossPose, HIT_TICKS, ringRuns, useNewBossArt } from './bossArt';
import { ringReturning } from './edgeMarkers';
import { ATLAS, frame, type SpriteName } from './assets';
import { save } from '../storage';
import { t } from '../i18n';

const BAR_H = 10;
/** Full view: the classic bar under the arena; zoomed phone portrait: above the touch buttons, screen width. */
const BAR_FULL = { x: 48, y: 250, w: 384 };
const BAR_ZOOMED = { x: 8, y: 324, w: 200 };
export { bossLook } from './bossArt';

const COL = { bone: 0xd9d2c0, stone: 0x3a4558, bg0: 0x0b0d12, violet: 0x9b6bff, violetDark: 0x3d2a78, blood: 0xd12b3a, bloodDark: 0x6e1423, teal: 0x4fd1c5, gold: 0xffd86b, ember: 0xff7a2f };

export class BossView {
  private body: Phaser.GameObjects.Sprite;
  private bar: Phaser.GameObjects.Image;
  private gfx: Phaser.GameObjects.Graphics;
  private barGfx: Phaser.GameObjects.Graphics;
  private beams = new Map<number, Phaser.GameObjects.TileSprite>();
  private pickup: Phaser.GameObjects.Sprite;
  private glow: Phaser.GameObjects.Sprite;
  private timers: { icon: Phaser.GameObjects.Sprite; ring: Phaser.GameObjects.Image }[];
  private ember: UIText;
  private barAt: { x: number; y: number; w: number } = BAR_FULL;
  /** The new bosses' cues (pooled, created only when such a boss appears): bloom spots and toll markers. */
  private bloomPool: Phaser.GameObjects.Sprite[] = [];
  private ringPool: Phaser.GameObjects.Sprite[] = [];
  private tolls: number[] = [];
  private zoomed = false;
  /** What the view remembers of the boss between draws (the Eye's lean, the Toller's teleport); never read by the sim. */
  private memo = new BossMemo();
  /** The effect sprites of the boss moves (new art, flagged runs only; pooled, created on first use). */
  private fxPool: Phaser.GameObjects.Sprite[] = [];
  private ringDark: number[] = [];
  private ringCore: number[] = [];

  constructor(
    private scene: Phaser.Scene,
    private depth: { ysort: number; fog: number; hud: number },
    private vignette: Phaser.GameObjects.Image,
    private banner: UIText,
    private baseVignette: number,
  ) {
    this.body = scene.add.sprite(0, 0, ATLAS, frame('eye_sentinel_idle')).setVisible(false);
    this.gfx = scene.add.graphics().setDepth(depth.fog - 1);
    this.bar = scene.add.image(BAR_FULL.x, BAR_FULL.y, ATLAS, frame('boss_bar' as SpriteName)).setOrigin(0).setDepth(depth.hud).setVisible(false);
    this.barGfx = scene.add.graphics().setDepth(depth.hud);
    this.glow = scene.add.sprite(0, 0, ATLAS, frame('pickup_glow')).setVisible(false);
    this.pickup = scene.add.sprite(0, 0, ATLAS, frame('pickup_slow_time')).setVisible(false);
    this.timers = [0, 1].map((i) => ({
      // top HUD band (y 4..22): pickup timers as small icons with a shrinking ring
      icon: scene.add.sprite(268 + i * 22, 13, ATLAS, frame(i ? 'pickup_double_score' : 'pickup_slow_time')).setDepth(depth.hud),
      ring: scene.add.image(268 + i * 22, 13, ATLAS, frame('icon_ring')).setDepth(depth.hud),
    }));
    this.ember = addText(scene, 236, 9, '', { color: '#ff7a2f' }).setDepth(depth.hud);
  }

  /** Move the HUD parts for the full arena or the zoomed portrait view (screen game px). */
  setLayout(zoomed: boolean, bar?: { x: number; y: number; w: number }): void {
    this.zoomed = zoomed;
    this.barAt = zoomed ? (bar ?? BAR_ZOOMED) : BAR_FULL;
    this.timers.forEach((v, i) => {
      const [x, y] = zoomed ? [128 + i * 20, 22] : [268 + i * 22, 13];
      v.icon.setPosition(x, y);
      v.ring.setPosition(x, y);
    });
    this.ember.setPosition(zoomed ? 96 : 236, zoomed ? 17 : 9);
  }

  reset(): void {
    this.tolls = [];
    this.memo.reset();
    for (const sp of [...this.bloomPool, ...this.ringPool, ...this.fxPool]) sp.setVisible(false);
    for (const b of this.beams.values()) b.destroy();
    this.beams.clear();
    this.scene.tweens.killTweensOf(this.vignette);
    this.vignette.setAlpha(this.baseVignette);
  }

  /** Box for the translucency rule ([x0, y0, x1, y1, base]); base 0 for the hovering eye: everything over it fades. */
  box(st: SimState, p: SimParams): [number, number, number, number, number] | null {
    const b = st.boss;
    if (!b) return null;
    const L = bossLook(b.kind, useNewBossArt(p));
    return [b.x + L.box[0], b.y + L.box[1], b.x + L.box[2], b.y + L.box[3], L.hovers ? 0 : b.y + (L.base ?? L.box[3])];
  }

  onEvent(e: SimEvent, st: SimState): void {
    this.memo.onEvent(e, st);
    switch (e.type) {
      case 'boss_intro':
        snap(setTextValue(this.banner, t(bossLook(e.kind).banner)).setAlpha(1));
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
      case 'boss_toll':
        this.tolls.push(st.tick - 1); // the toll marker widens from the bell (the beat, readable muted)
        break;
      case 'boss_defeated': {
        const s = this.scene.add.sprite(Math.round(e.x), Math.round(e.y), ATLAS, frame('death_burst')).setScale(2).setDepth(this.depth.fog - 1);
        s.play('death_burst').once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
        if (save().settings.shake) this.scene.cameras.main.shake(200, 0.006);
        snap(setTextValue(this.banner, t('banner.ember', { points: e.points })).setAlpha(1));
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
    const B = this.barAt;
    const seg = (B.w - 4) / b.segments;
    const x = B.x + 2 + remaining * seg + seg / 2;
    for (let k = 0; k < 4; k++) {
      const r = this.scene.add.rectangle(x - 4 + k * 3, B.y + 5, 2, 2, COL.bone).setDepth(this.depth.hud + 1);
      this.scene.tweens.add({ targets: r, x: r.x + (k - 1.5) * 4, y: r.y + 8 + k, alpha: 0, duration: 300, onComplete: () => r.destroy() });
    }
  }

  /** `motion`: the render motion of the bodies is on (off with EFFECTS LOW). */
  draw(st: SimState, p: SimParams, motion = true): void {
    const t = st.tick;
    const b = st.boss;
    this.gfx.clear();
    this.barGfx.clear();
    this.memo.observe(st);
    this.body.setVisible(!!b);
    this.bar.setVisible(!!b && !this.zoomed);
    if (b) this.drawBoss(st, p, b, motion);
    else for (const sp of [...this.bloomPool, ...this.ringPool]) sp.setVisible(false);
    // FEATURES.bossMoves: the Toller's rings (rasterised, pixel-exact) and the chain's spot; the effect sprites
    for (const ring of st.rings ?? []) this.drawRing(ring, p);
    if (st.chain && b) this.drawChain(st, st.chain);
    const fx = bossFx(st, p, this.memo);
    fx.forEach((e, i) => {
      const sp = this.fxPool[i] ?? (this.fxPool[i] = this.scene.add.sprite(0, 0, ATLAS, frame(e.key as SpriteName)));
      sp.setVisible(true).setFrame(frame(e.key as SpriteName, e.frame)).setOrigin(e.ox ?? 0.5, e.oy ?? 0.5).setPosition(e.x, e.y).setAlpha(e.alpha);
      sp.setDepth(e.base === 'over' ? this.depth.fog - 1 : this.depth.ysort + e.base);
    });
    for (let i = fx.length; i < this.fxPool.length; i++) this.fxPool[i]!.setVisible(false);
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

  private drawBoss(st: SimState, p: SimParams, b: Boss, motion: boolean): void {
    const t = st.tick;
    const L = bossLook(b.kind, useNewBossArt(p));
    const a = b.attack;
    // the body: family, row, frame, alpha and whole-pixel shifts all come from the sim state (bossArt.ts)
    const pose = bossPose(st, p, this.memo, motion)!;
    this.body.setVisible(pose.visible).setFrame(frame(pose.key as SpriteName, pose.frame)).setAlpha(pose.alpha);
    if (L.hovers) this.body.setOrigin(L.originX, L.originY).setPosition(b.x + pose.dx, b.y - pose.rise + pose.dy).setDepth(this.depth.fog - 2);
    else {
      const base = b.y + (L.base ?? L.box[3]);
      this.body.setOrigin(L.originX, L.originY).setPosition(b.x + pose.dx, b.y + L.dy - pose.rise + pose.dy).setDepth(this.depth.ysort + base);
    }

    // telegraphs during the wind-up: the beam's / pendulum's / lash's thin start line, the spawn points, the bloom
    // spots, the knell's red ring and the hedge's stirring roots
    let blooms = 0;
    const bloomAt = (x: number, y: number, fr: number): void => {
      const sp = this.bloomPool[blooms] ?? (this.bloomPool[blooms] = this.scene.add.sprite(0, 0, ATLAS, frame('root_bloom' as SpriteName)));
      sp.setVisible(true).setFrame(frame('root_bloom' as SpriteName, fr)).setPosition(Math.round(x), Math.round(y)).setDepth(this.depth.ysort + y - 8);
      blooms++;
    };
    if (a && t >= a.windStart && t < a.fire) {
      const k = (t - a.windStart) / Math.max(1, a.fire - a.windStart);
      switch (a.pattern) {
        case 'beam':
        case 'pendulum':
          this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1);
          this.gfx.lineBetween(b.x, b.y, b.x + a.dirX * 440, b.y + a.dirY * 440);
          break;
        case 'lash':
          this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1);
          this.gfx.lineBetween(b.x, b.y, b.x + a.dirX * 140, b.y + a.dirY * 140);
          break;
        case 'spawns':
          this.gfx.lineStyle(1, COL.violet, 1);
          for (const [x, y] of a.points) this.gfx.strokeCircle(Math.round(x), Math.round(y), Math.max(2, Math.round(8 - k * 6)));
          break;
        case 'bloom':
          for (const [x, y] of a.points) bloomAt(x, y, Math.min(3, Math.floor(k * 4)));
          break;
        case 'knell':
          this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1);
          this.gfx.strokeCircle(Math.round(b.x), Math.round(b.y), Math.round(22 - k * 10));
          break;
        // (the Lich's grasp hands and soulfire embers, FEATURES.bossMoves, are sprites: bossFx)
        case 'peal':
        case 'echo': {
          // FEATURES.bossMoves: the ring forms as ticks around the bell over the wind-up (red: walking will not pass it)
          const n = 16;
          const lit = Math.min(n, Math.floor(k * n) + 1);
          this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1);
          for (let i = 0; i < lit; i++) {
            const ang = (2 * Math.PI * i) / n;
            const [cx, cy] = [Math.cos(ang), Math.sin(ang)];
            this.gfx.lineBetween(b.x + cx * 12, b.y + cy * 12, b.x + cx * 16, b.y + cy * 16);
          }
          break;
        }
        case 'hedge':
          // roots stirring at her feet (red; her hem is 41 px under her chest): the wall rises at the far edge when
          // the wind-up ends
          this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1);
          for (let i = -3; i <= 3; i++) this.gfx.lineBetween(b.x + i * 7, b.y + 40, b.x + i * 9, b.y + 44 + (i & 1) * 2);
          break;
        default:
          break;
      }
    }
    // blooms launched but not yet burst stay fully lit until they burst (FEATURES.bosses.thorn); so do the Lich's
    // hands (bossFx)
    for (const e of b.pending ?? []) if (e.op === 'bloom') bloomAt(e.x, e.y, 3);
    for (let i = blooms; i < this.bloomPool.length; i++) this.bloomPool[i]!.setVisible(false);
    // the Toller's toll markers: a bone ring widening from the bell on every toll beat
    this.tolls = this.tolls.filter((s0) => t - s0 < 20);
    this.tolls.forEach((s0, i) => {
      const sp = this.ringPool[i] ?? (this.ringPool[i] = this.scene.add.sprite(0, 0, ATLAS, frame('bell_ring' as SpriteName)).setDepth(this.depth.fog - 1));
      sp.setVisible(true).setFrame(frame('bell_ring' as SpriteName, Math.min(3, Math.floor((t - s0) / 5)))).setPosition(Math.round(b.x), Math.round(b.y));
    });
    for (let i = this.tolls.length; i < this.ringPool.length; i++) this.ringPool[i]!.setVisible(false);

    // the bar: frame + one cell per segment (remaining = bone, removed = dark)
    const B = this.barAt;
    if (this.zoomed) {
      // the bar sprite is arena-wide: the narrow portrait bar gets a plain frame
      this.barGfx.fillStyle(COL.bg0, 0.8).fillRect(B.x, B.y, B.w, BAR_H);
      this.barGfx.lineStyle(1, 0x3a4558, 1).strokeRect(B.x + 0.5, B.y + 0.5, B.w - 1, BAR_H - 1);
    }
    const seg = (B.w - 4) / b.segments;
    for (let i = 0; i < b.segments; i++) {
      const x0 = Math.round(B.x + 2 + i * seg) + 1;
      const x1 = Math.round(B.x + 2 + (i + 1) * seg) - 1;
      const on = i < b.remaining;
      const flash = b.hitTick >= 0 && t - b.hitTick < HIT_TICKS && i === b.remaining; // the cell just removed
      this.barGfx.fillStyle(flash ? COL.violet : on ? COL.bone : COL.violetDark, flash || on ? 1 : 0.6);
      this.barGfx.fillRect(x0, B.y + 2, x1 - x0, BAR_H - 4);
    }
  }

  /**
   * FEATURES.bossMoves: a ring of the Toller, rasterised pixel-exact (its radius changes every tick): a blood_dark
   * outer edge, a blood core, a dithered inner edge, torn ends at the cut gaps (bossArt.ts `ringRuns`). An echo out
   * beyond the arena marks the arena border (bone ticks) so its return is visible.
   */
  private drawRing(ring: Ring, p: SimParams): void {
    const [dark, core] = [this.ringDark, this.ringCore];
    dark.length = core.length = 0;
    ringRuns(ring, [0, 0, 480, 270], (x, y, w, tone) => (tone === 'blood' ? core : dark).push(x, y, w));
    this.gfx.fillStyle(COL.bloodDark, 1);
    for (let i = 0; i < dark.length; i += 3) this.gfx.fillRect(dark[i]!, dark[i + 1]!, dark[i + 2]!, 1);
    this.gfx.fillStyle(COL.blood, 1);
    for (let i = 0; i < core.length; i += 3) this.gfx.fillRect(core[i]!, core[i + 1]!, core[i + 2]!, 1);
    if (!ringReturning(ring, p)) return;
    this.gfx.fillStyle(COL.bone, 1);
    for (let x = p.x0 + 8; x <= p.x1 - 8; x += 16) {
      this.gfx.fillRect(x - 2, p.y0 - 3, 4, 2);
      this.gfx.fillRect(x - 2, p.y1 + 1, 4, 2);
    }
    for (let y = p.y0 + 8; y <= p.y1 - 8; y += 16) {
      this.gfx.fillRect(p.x0 - 3, y - 2, 2, 4);
      this.gfx.fillRect(p.x1 + 1, y - 2, 2, 4);
    }
  }

  /**
   * FEATURES.bossMoves: the chain's spot, a circle until it lands (iron: ash grey; parry-break: violet). The links
   * from the Toller's hand and the coils round the bound hero are sprites (bossFx).
   */
  private drawChain(st: SimState, c: Chain): void {
    if (c.bound) return;
    const k = Math.min(1, (st.tick - c.start) / Math.max(1, c.land - c.start));
    this.gfx.lineStyle(1, c.kind === 'iron' ? COL.bone : COL.violet, 0.5 + 0.5 * k).strokeCircle(Math.round(c.x), Math.round(c.y), c.r);
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
    this.ember.setText(charges > 0 ? `E${charges}` : ''); // ember charges (short: the band is the arena width)
  }
}
