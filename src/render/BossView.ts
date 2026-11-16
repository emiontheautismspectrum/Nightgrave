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
import type { Boss, BossKind, Chain, Ring, SimEvent, SimState } from '../sim/state';
import { unknownBoss } from '../sim/boss';
import { inRingGap } from '../sim/tollerMoves';
import { ringReturning } from './edgeMarkers';
import { ATLAS, frame, type SpriteName } from './assets';
import { save } from '../storage';
import { t } from '../i18n';

const BAR_H = 10;
/** Full view: the classic bar under the arena; zoomed phone portrait: above the touch buttons, screen width. */
const BAR_FULL = { x: 48, y: 250, w: 384 };
const BAR_ZOOMED = { x: 8, y: 324, w: 200 };
const HIT_TICKS = 8;
/** Per boss kind: the sprite family, the banner key, the anchor of the body (origin) and its translucency box. */
interface BossLook {
  name: 'eye_sentinel' | 'lich_mage' | 'thorn_mother' | 'toller';
  banner: 'boss.eye' | 'boss.lich' | 'boss.thorn' | 'boss.toller';
  /** Sprite origin y (0..1) placed at the sim position (+ dy); the eye hovers (depth over the y-sort). */
  originY: number;
  dy: number;
  /** [x0, y0, x1, y1] around the sim position; base = the y it sorts by (0 = everything over it fades). */
  box: [number, number, number, number];
  hovers: boolean;
}

/** EXHAUSTIVE: a new kind must get its own look here (never another boss's art, banner or box). */
export function bossLook(kind: BossKind): BossLook {
  switch (kind) {
    case 'eye':
      return { name: 'eye_sentinel', banner: 'boss.eye', originY: 0.5, dy: 0, box: [-22, -20, 22, 22], hovers: true };
    case 'lich':
      return { name: 'lich_mage', banner: 'boss.lich', originY: 1, dy: 4, box: [-12, -36, 12, 4], hovers: false };
    case 'thorn':
      // her chest (where the shots leave) at the sim position; the root cloak spreads below it
      return { name: 'thorn_mother', banner: 'boss.thorn', originY: 28 / 48, dy: 0, box: [-20, -28, 20, 20], hovers: false };
    case 'toller':
      // the bell's lip (where the rings leave) at the sim position; the robe hangs below it
      return { name: 'toller', banner: 'boss.toller', originY: 18 / 56, dy: 0, box: [-20, -18, 20, 38], hovers: false };
    default:
      return unknownBoss(kind);
  }
}

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
    for (const sp of [...this.bloomPool, ...this.ringPool]) sp.setVisible(false);
    for (const b of this.beams.values()) b.destroy();
    this.beams.clear();
    this.scene.tweens.killTweensOf(this.vignette);
    this.vignette.setAlpha(this.baseVignette);
  }

  /** Box for the translucency rule ([x0, y0, x1, y1, base]); base 0 for the hovering eye: everything over it fades. */
  box(st: SimState): [number, number, number, number, number] | null {
    const b = st.boss;
    if (!b) return null;
    const L = bossLook(b.kind);
    return [b.x + L.box[0], b.y + L.box[1], b.x + L.box[2], b.y + L.box[3], L.hovers ? 0 : b.y + L.box[3]];
  }

  onEvent(e: SimEvent, st: SimState): void {
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

  draw(st: SimState, p: SimParams): void {
    const t = st.tick;
    const b = st.boss;
    this.gfx.clear();
    this.barGfx.clear();
    this.body.setVisible(!!b);
    this.bar.setVisible(!!b && !this.zoomed);
    if (b) this.drawBoss(st, p, b);
    else for (const sp of [...this.bloomPool, ...this.ringPool]) sp.setVisible(false);
    // FEATURES.bossMoves (placeholders until the art pass): the Toller's rings and chain
    for (const ring of st.rings ?? []) this.drawRing(ring, p);
    if (st.chain && b) this.drawChain(st, b, st.chain);
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
    const L = bossLook(b.kind);
    const name = L.name;
    const eye = b.kind === 'eye';
    const lich = b.kind === 'lich';
    const a = b.attack;
    const prog = (s0: number, s1: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(((t - s0) / Math.max(1, s1 - s0)) * n)));
    let f: [string, number];
    let alpha = 1;
    let rise = 0;
    // the idle frame: the Toller's bell swings on its beat (centre, right, centre, left over two beats), the others loop
    const beat = b.kind === 'toller' && p.toller ? Math.max(1, Math.round(p.toller.beatTicks)) : 0;
    const phase = beat ? ((((t - b.introEnd + beat / 4) % (2 * beat)) + 2 * beat) % (2 * beat)) : 0; // an extreme on every beat
    const idle = (): [string, number] => [`${name}_idle`, beat ? (Math.floor(phase / (beat / 2)) + 1) & 3 : (t >> 3) & 3];
    if (b.deathTick >= 0) f = [`${name}_death`, prog(b.deathTick, b.deathTick + ticks(p.bosses.deathSeconds), 6)];
    else if (t < b.introEnd) {
      // intro: the eye rises from behind the tree line, the lich materialises at the portal, the new bosses rise out
      // of the ground (dithered in)
      if (eye) {
        f = [`${name}_idle`, (t >> 3) & 3];
        rise = Math.round((1 - (t - b.start) / Math.max(1, b.introEnd - b.start)) * 40);
        alpha = Math.min(1, (t - b.start) / 40);
      } else if (lich) f = [`${name}_teleport_in`, prog(b.start, b.introEnd, 4)];
      else {
        f = [`${name}_death`, 5 - prog(b.start, b.introEnd, 6)];
        rise = -Math.round((1 - (t - b.start) / Math.max(1, b.introEnd - b.start)) * 8);
      }
    } else if (b.hitTick >= 0 && t - b.hitTick < HIT_TICKS) f = [`${name}_hit`, (t - b.hitTick) < HIT_TICKS / 2 ? 0 : 1];
    else if (a && b.kind === 'thorn' && a.tpIn > a.tpOut && t < a.windStart) {
      // FEATURES.bossMotion: roots pull her down [tpOut, tpIn) (gone at tpIn), she rises at the new spot [tpIn, windStart)
      const sinking = t < a.tpIn;
      const k = sinking ? (t - a.tpOut) / Math.max(1, a.tpIn - a.tpOut) : 1 - (t - a.tpIn) / Math.max(1, a.windStart - a.tpIn);
      f = [`${name}_death`, Math.min(5, Math.floor(k * 6))];
      rise = -Math.round(k * 8);
      alpha = 1 - k;
    } else if (a && lich && t < a.tpIn) f = [`${name}_teleport_out`, prog(a.tpOut, a.tpIn, 4)];
    else if (a && lich && t < a.windStart) f = [`${name}_teleport_in`, prog(a.tpIn, a.windStart, 4)];
    else if (a && t >= a.windStart) f = [eye ? `${name}_charge` : `${name}_cast`, prog(a.windStart, a.fire, eye ? 3 : 4)];
    else f = idle();
    this.body.setFrame(frame(f[0] as SpriteName, f[1])).setAlpha(alpha);
    // FEATURES.bossMotion: the drifting bodies bob (RENDER ONLY: the sim position carries no bob)
    const drift = p.motion && (eye || lich) ? (eye ? p.motion.eye : p.motion.lich) : null;
    if (drift && b.deathTick < 0 && t >= b.introEnd) rise += Math.round(Math.sin((2 * Math.PI * (t - b.introEnd)) / Math.max(1, drift.bobSeconds * TICK_RATE)) * drift.bobPx);
    if (L.hovers) this.body.setOrigin(0.5, L.originY).setPosition(b.x, b.y - rise).setDepth(this.depth.fog - 2);
    else {
      const base = b.y + L.box[3];
      this.body.setOrigin(0.5, L.originY).setPosition(b.x, b.y + L.dy - rise).setDepth(this.depth.ysort + base);
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
          // roots stirring at her feet (red): the wall rises at the far edge when the wind-up ends
          this.gfx.lineStyle(1, k > 0.6 ? COL.blood : COL.bloodDark, 1);
          for (let i = -2; i <= 2; i++) this.gfx.lineBetween(b.x + i * 6, b.y + 18, b.x + i * 9, b.y + 22 + (i & 1) * 2);
          break;
        default:
          break;
      }
    }
    // blooms launched but not yet burst stay fully lit until they burst (FEATURES.bosses.thorn)
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
   * FEATURES.bossMoves placeholder: a ring as a red circle with its cut gaps (segments whose middle lies in a gap are
   * left out); an echo out beyond the arena marks the arena border (bone ticks) so its return is visible.
   */
  private drawRing(ring: Ring, p: SimParams): void {
    const n = Math.max(24, Math.min(160, Math.round(ring.r / 3)));
    this.gfx.lineStyle(Math.max(1, Math.round(ring.halfWidth)), COL.blood, 1);
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n;
      const a1 = (2 * Math.PI * (i + 1)) / n;
      const am = (a0 + a1) / 2;
      if (inRingGap(ring, Math.cos(am), Math.sin(am), ring.r, 0)) continue;
      this.gfx.lineBetween(ring.x + Math.cos(a0) * ring.r, ring.y + Math.sin(a0) * ring.r, ring.x + Math.cos(a1) * ring.r, ring.y + Math.sin(a1) * ring.r);
    }
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
   * FEATURES.bossMoves placeholder: the chain from the Toller's hand to its spot (iron: stone + bone, ash grey;
   * parry-break: violet), the spot's circle until the landing, then links around the bound hero.
   */
  private drawChain(st: SimState, b: Boss, c: Chain): void {
    const iron = c.kind === 'iron';
    const col = iron ? COL.stone : COL.violet;
    const hx = b.x + 10;
    const hy = b.y + 4; // the raised hand
    const [tx, ty] = c.bound ? [st.hero.x, st.hero.y] : [c.x, c.y];
    this.gfx.lineStyle(1, col, 1).lineBetween(hx, hy, tx, ty);
    this.gfx.fillStyle(iron ? COL.bone : COL.violet, 1);
    const len = Math.hypot(tx - hx, ty - hy);
    for (let d = 6; d < len; d += 8) this.gfx.fillRect(Math.round(hx + ((tx - hx) * d) / len) - 1, Math.round(hy + ((ty - hy) * d) / len) - 1, 2, 2);
    if (!c.bound) {
      const k = Math.min(1, (st.tick - c.start) / Math.max(1, c.land - c.start));
      this.gfx.lineStyle(1, col, 0.5 + 0.5 * k).strokeCircle(Math.round(c.x), Math.round(c.y), c.r);
      return;
    }
    this.gfx.lineStyle(1, col, 1).strokeCircle(Math.round(st.hero.x), Math.round(st.hero.y), 6);
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      this.gfx.fillRect(Math.round(st.hero.x + Math.cos(a) * 6) - 1, Math.round(st.hero.y + Math.sin(a) * 6) - 1, 2, 2);
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
    this.ember.setText(charges > 0 ? `E${charges}` : ''); // ember charges (short: the band is the arena width)
  }
}
