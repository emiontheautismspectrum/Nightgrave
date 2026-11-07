/**
 * The console shell on screen (render-only). The static shell from shellParts() is baked ONCE per layout into ONE
 * canvas texture (`SHELL_TEX`): the screen-sized base image plus, under it, the frames of the per-frame images (caps
 * up / pressed, the knob). A new layout, a stick-mode switch or a WebGL context restore bakes again; the old texture is
 * destroyed first (one shell texture at any time). Per frame: cap frames, the cooldown shade, lamp frames and the knob
 * position only, with no allocations.
 */
import Phaser from 'phaser';
import { SHELL, SHELL_PALETTE, LAMP_FRAMES, type LampKind } from '../data/shell';
import { ATLAS, frame } from './assets';
import type { PortraitLayout, Rect } from './portraitLayout';
import { shellParts, type ShellOptions, type ShellParts } from './shellParts';

export const SHELL_TEX = 'ng_shell';
const hex = (c: string): number => parseInt(c.slice(1), 16);
const SHADE = hex(SHELL_PALETTE.bg0);
const COOL = hex(SHELL_PALETTE[SHELL.colors.cooldown]);
type CapId = 'parry' | 'dash';

export class ShellView {
  private base: Phaser.GameObjects.Image;
  private caps: Record<CapId, Phaser.GameObjects.Image>;
  private shade: Phaser.GameObjects.Graphics;
  private lamps: Phaser.GameObjects.Image[] = [];
  private knob: Phaser.GameObjects.Image;
  /** Lamp frame names (off, on) per kind: built once, no strings per frame. */
  private lampFrame: Record<LampKind, [string, string]>;
  private lampOn: boolean[] = [];
  private capRect: Record<CapId, Rect> = { parry: { x: 0, y: 0, w: 0, h: 0 }, dash: { x: 0, y: 0, w: 0, h: 0 } };
  private capDown: Record<CapId, boolean> = { parry: false, dash: false };
  private last: { L: PortraitLayout; o: ShellOptions } | null = null;
  parts: ShellParts | null = null;
  /** How many times the shell was baked (tests). */
  bakes = 0;
  visible = false;

  constructor(private scene: Phaser.Scene, depth: number) {
    // a 1x1 placeholder until the first bake; the base sits at the HUD depth UNDER every HUD object (created first)
    this.base = scene.add.image(0, 0, ATLAS, frame('shell_fill')).setOrigin(0).setDepth(depth).setVisible(false);
    this.caps = {
      parry: scene.add.image(0, 0, ATLAS, frame('shell_fill')).setOrigin(0).setDepth(depth + 0.1).setVisible(false),
      dash: scene.add.image(0, 0, ATLAS, frame('shell_fill')).setOrigin(0).setDepth(depth + 0.1).setVisible(false),
    };
    this.shade = scene.add.graphics().setDepth(depth + 0.2);
    this.knob = scene.add.image(0, 0, ATLAS, frame('shell_fill')).setOrigin(0.5).setDepth(depth + 0.3).setVisible(false);
    for (let i = 0; i < SHELL.maxLamps; i++) this.lamps.push(scene.add.image(0, 0, ATLAS, frame('shell_lamp')).setOrigin(0).setDepth(depth + 0.1).setVisible(false));
    this.lampFrame = Object.fromEntries(LAMP_FRAMES.map((k, i) => [k, [frame('shell_lamp', 2 * i), frame('shell_lamp', 2 * i + 1)]])) as Record<LampKind, [string, string]>;
    // a restored WebGL context: bake again (the canvas source survives, but the texture is rebuilt from it)
    const r = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (r && typeof r.on === 'function') r.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.onRestore, this);
  }

  private onRestore(): void {
    if (this.last) this.build(this.last.L, this.last.o);
  }

  /** Bake the shell for a layout (and show it). */
  build(L: PortraitLayout, o: ShellOptions): void {
    const P = shellParts(L, o);
    this.last = { L, o };
    if (!P) {
      this.hide();
      return;
    }
    this.parts = P;
    const tm = this.scene.textures;
    // the images let go of the old texture before it is destroyed; one shell texture exists at any time
    for (const im of [this.base, this.caps.parry, this.caps.dash, this.knob]) im.setTexture(ATLAS, frame('shell_fill'));
    if (tm.exists(SHELL_TEX)) tm.remove(SHELL_TEX);
    const tex = tm.createCanvas(SHELL_TEX, P.texW, P.texH);
    if (!tex) {
      this.hide();
      return;
    }
    const ctx = tex.context;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, P.texW, P.texH);
    const atlas = tm.get(ATLAS);
    const src = atlas.getSourceImage() as CanvasImageSource;
    for (const p of P.parts) {
      if (p.t === 'rect') {
        ctx.fillStyle = SHELL_PALETTE[p.color];
        ctx.fillRect(p.x, p.y, p.w, p.h);
      } else {
        const f = atlas.get(`${p.name}_${p.frame}`);
        ctx.drawImage(src, f.cutX + p.sx, f.cutY + p.sy, p.sw, p.sh, p.x, p.y, p.w, p.h);
      }
    }
    tex.add('base', 0, 0, 0, L.W, L.H);
    for (const [k, r] of Object.entries(P.extras)) tex.add(k, 0, r.x, r.y, r.w, r.h);
    tex.refresh();
    this.bakes++;
    this.base.setTexture(SHELL_TEX, 'base').setPosition(0, 0);
    for (const b of L.buttons) {
      if (!b.cap) continue;
      const id = b.id;
      this.capRect[id] = b.cap;
      this.capDown[id] = false;
      this.caps[id].setTexture(SHELL_TEX, `${id}_up`).setPosition(b.cap.x, b.cap.y);
    }
    this.knob.setTexture(SHELL_TEX, 'knob');
    this.lampOn = P.lamps.map(() => false);
    this.lamps.forEach((im, i) => {
      const l = P.lamps[i];
      im.setVisible(!!l);
      if (l) im.setFrame(this.lampFrame[l.kind][0]).setPosition(l.x, l.y);
    });
    this.show(o.stick);
  }

  private show(stick: boolean): void {
    this.visible = true;
    this.base.setVisible(true);
    this.caps.parry.setVisible(true);
    this.caps.dash.setVisible(true);
    this.knob.setVisible(stick);
    this.shade.setVisible(true);
  }

  hide(): void {
    this.visible = false;
    for (const im of [this.base, this.caps.parry, this.caps.dash, this.knob, ...this.lamps]) im.setVisible(false);
    this.shade.clear().setVisible(false);
  }

  /** One frame: a cap up or pressed (flat, 1 px down) and its cooldown (0 = ready .. 1 = just used). */
  cap(id: CapId, pressed: boolean, cooldown: number, first: boolean): void {
    if (!this.visible) return;
    if (pressed !== this.capDown[id]) {
      this.capDown[id] = pressed;
      this.caps[id].setFrame(pressed ? `${id}_down` : `${id}_up`);
    }
    if (first) this.shade.clear();
    if (cooldown <= 0) return;
    // the cooldown: a dark shade over the cap that drains from the bottom up (the lit part rises), with a thin amber
    // edge; steady, no flashing
    const c = this.capRect[id];
    const top = c.y + (pressed ? 1 : 0);
    const h = Math.max(1, Math.round((c.h - 1) * Math.min(1, cooldown)));
    this.shade.fillStyle(SHADE, 0.55).fillRect(c.x + 1, top, c.w - 2, h);
    this.shade.fillStyle(COOL, 0.9).fillRect(c.x + 2, top + h - 1, c.w - 4, 1);
  }

  /** One frame: lamp i on / off. */
  lamp(i: number, on: boolean): void {
    if (!this.visible || this.lampOn[i] === on || !this.parts?.lamps[i]) return;
    this.lampOn[i] = on;
    this.lamps[i]!.setFrame(this.lampFrame[this.parts.lamps[i]!.kind][on ? 1 : 0]);
  }

  /** One frame: the knob at (x, y) (whole game px), its alpha. */
  knobAt(x: number, y: number, alpha: number): void {
    if (!this.visible || !this.knob.visible) return;
    this.knob.setPosition(x, y).setAlpha(alpha);
  }

  /** Tests: the baked base image. */
  debugBase(): Phaser.GameObjects.Image {
    return this.base;
  }

  /** The cap's visible rectangle (icons are centred on it). */
  capOf(id: CapId): Rect {
    return this.capRect[id];
  }
  pressed(id: CapId): boolean {
    return this.capDown[id];
  }

  destroy(): void {
    const r = this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (r && typeof r.off === 'function') r.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.onRestore, this);
    if (this.scene.textures.exists(SHELL_TEX)) this.scene.textures.remove(SHELL_TEX);
    this.last = null;
    this.parts = null;
  }
}
