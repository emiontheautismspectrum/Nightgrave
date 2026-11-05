/**
 * A small menu component shared by the title screen and the pause overlay. Works with mouse, touch (Phaser pointer
 * events), keyboard (arrows/WASD + Enter/Space, Esc back) and gamepad (stick/d-pad + A, B back). Focus is always
 * visible; every page except the root has a back button in the top-left corner, and Esc/B always go back one level.
 * Text is only ever set through Phaser text objects (never innerHTML).
 */
import Phaser from 'phaser';
import { emitAudioEvent } from './events';

export const FONT = '"Press Start 2P", monospace';
export const C = { bone: '#d9d2c0', gold: '#ffd86b', dim: '#7f93b8', stone: '#3a4558', ember: '#ff7a2f', violet: '#9b6bff', teal: '#4fd1c5' };

export interface MenuItem {
  label: () => string;
  onActivate?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  /** Not focusable (a heading or spacer). */
  disabled?: boolean;
}

export interface MenuPage {
  title: string;
  items: MenuItem[];
  /** Extra text lines under the title (scores, controls, credits). */
  lines?: () => string[];
  /** Back goes here; undefined = root page (no back). */
  onBack?: () => void;
  /** Extra objects for this page (e.g. hero sprites); destroyed when the page changes. */
  decorate?: (scene: Phaser.Scene, rowY: (i: number) => number) => Phaser.GameObjects.GameObject[];
  /** First row y (default 64) and row spacing (default 14). */
  top?: number;
  gap?: number;
}

/**
 * A tap on an object: the pointer must go DOWN and UP on it (a finger that started a drag elsewhere and lifts over a
 * menu row must not trigger it).
 */
export function onTap(o: Phaser.GameObjects.GameObject, fn: (p: Phaser.Input.Pointer) => void): void {
  const downs = new Set<number>();
  o.on('pointerdown', (p: Phaser.Input.Pointer) => downs.add(p.id));
  o.on('pointerout', (p: Phaser.Input.Pointer) => downs.delete(p.id));
  o.on('pointerup', (p: Phaser.Input.Pointer) => {
    if (!downs.delete(p.id)) return;
    fn(p);
  });
}

const PAD = { a: 0, b: 1, start: 9, up: 12, down: 13, left: 14, right: 15 };

export class MenuView {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private rows: Phaser.GameObjects.Text[] = [];
  private lineTexts: Phaser.GameObjects.Text[] = [];
  private page: MenuPage | null = null;
  private focus = 0;
  private padPrev: Record<string, boolean> = {};
  private padRepeat = 0;
  private keyHandler: (e: KeyboardEvent) => void;
  active = false;
  /** The key press that opened a menu must not also act inside it (e.g. Esc opening the pause menu). */
  private fresh = false;

  constructor(
    private scene: Phaser.Scene,
    private depth: number,
    private dim = 0,
  ) {
    this.keyHandler = (e: KeyboardEvent) => this.onKey(e);
    scene.input.keyboard?.on('keydown', this.keyHandler);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.input.keyboard?.off('keydown', this.keyHandler));
  }

  show(page: MenuPage, focus = -1): void {
    this.clear();
    this.page = page;
    if (!this.active) this.fresh = true;
    this.active = true;
    const s = this.scene;
    const top = page.top ?? 64;
    const gap = page.gap ?? 14;
    if (this.dim > 0) this.objs.push(s.add.rectangle(0, 0, s.scale.width, s.scale.height, 0x0b0d12, this.dim).setOrigin(0).setDepth(this.depth).setInteractive());
    this.objs.push(s.add.text(s.scale.width / 2, 30, page.title, { fontFamily: FONT, fontSize: '16px', color: C.bone }).setOrigin(0.5).setDepth(this.depth + 1));
    if (page.onBack) {
      const back = s.add.text(8, 8, '< BACK', { fontFamily: FONT, fontSize: '8px', color: C.dim }).setPadding(4, 4, 4, 4).setDepth(this.depth + 1);
      back.setInteractive({ useHandCursor: true });
      onTap(back, () => this.back());
      this.objs.push(back);
    }
    page.items.forEach((it, i) => {
      const t = s.add.text(s.scale.width / 2, top + i * gap, '', { fontFamily: FONT, fontSize: '8px', color: C.bone }).setOrigin(0.5).setPadding(8, 3, 8, 3).setDepth(this.depth + 1);
      if (!it.disabled) {
        t.setInteractive({ useHandCursor: true });
        t.on('pointerover', () => this.setFocus(i));
        onTap(t, (p: Phaser.Input.Pointer) => {
          this.setFocus(i);
          // value rows: the left third steps down, the rest steps up / activates
          if (it.onLeft && p.x < t.x - t.width / 6) this.left();
          else if (it.onRight && !it.onActivate) this.right();
          else this.activate();
        });
      }
      this.rows.push(t);
    });
    this.objs.push(...this.rows);
    const lines = page.lines?.() ?? [];
    const firstLineY = page.items.length ? top + page.items.length * gap + 6 : top;
    lines.forEach((l, i) => {
      const t = s.add.text(s.scale.width / 2, firstLineY + i * 11, l, { fontFamily: FONT, fontSize: '8px', color: C.dim }).setOrigin(0.5, 0).setDepth(this.depth + 1);
      this.lineTexts.push(t);
    });
    this.objs.push(...this.lineTexts);
    if (page.decorate) this.objs.push(...page.decorate(s, (i) => top + i * gap));
    const first = page.items.findIndex((it) => !it.disabled);
    this.focus = focus >= 0 && focus < page.items.length && !page.items[focus]?.disabled ? focus : Math.max(0, first);
    this.refresh();
  }

  hide(): void {
    this.clear();
    this.active = false;
    this.page = null;
  }

  private clear(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.rows = [];
    this.lineTexts = [];
  }

  /** Re-render labels (after a value changed). */
  refresh(): void {
    const p = this.page;
    if (!p) return;
    p.items.forEach((it, i) => {
      const t = this.rows[i];
      if (!t) return;
      const on = i === this.focus && !it.disabled;
      const lab = it.label();
      t.setText(it.onLeft || (it.onRight && !it.onActivate) ? `${on ? '<' : ' '} ${lab} ${on ? '>' : ' '}` : on ? `> ${lab} <` : lab);
      t.setColor(it.disabled ? C.stone : on ? C.gold : C.bone);
    });
    const lines = p.lines?.() ?? [];
    this.lineTexts.forEach((t, i) => t.setText(lines[i] ?? ''));
  }

  private setFocus(i: number): void {
    if (i === this.focus) return;
    this.focus = i;
    this.refresh();
  }

  private moveFocus(d: number): void {
    const items = this.page?.items ?? [];
    if (!items.length) return;
    let i = this.focus;
    for (let k = 0; k < items.length; k++) {
      i = (i + d + items.length) % items.length;
      if (!items[i]?.disabled) break;
    }
    this.focus = i;
    emitAudioEvent('ui_click');
    this.refresh();
  }

  private current(): MenuItem | undefined {
    return this.page?.items[this.focus];
  }
  private activate(): void {
    const it = this.current();
    if (!it || it.disabled) return;
    emitAudioEvent('ui_confirm');
    if (it.onActivate) it.onActivate();
    else it.onRight?.();
    this.refresh();
  }
  private left(): void {
    const it = this.current();
    if (it?.onLeft) {
      emitAudioEvent('ui_click');
      it.onLeft();
      this.refresh();
    }
  }
  private right(): void {
    const it = this.current();
    if (it?.onRight) {
      emitAudioEvent('ui_click');
      it.onRight();
      this.refresh();
    }
  }
  back(): void {
    if (!this.page?.onBack) return;
    emitAudioEvent('ui_click');
    this.page.onBack();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active || this.fresh) return;
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveFocus(-1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveFocus(1);
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.left();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.right();
        break;
      case 'Enter':
      case 'Space':
        this.activate();
        break;
      case 'Escape':
      case 'Backspace':
        this.back();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** Poll the gamepad (call every frame while the menu is active). Returns true if Start was pressed. */
  pollPad(deltaMs: number): boolean {
    const wasFresh = this.fresh;
    this.fresh = false;
    const gp = this.scene.input.gamepad;
    const pad = gp && gp.total > 0 ? gp.pad1 : null;
    if (!pad || !this.active) return false;
    const now: Record<string, boolean> = {
      a: pad.isButtonDown(PAD.a),
      b: pad.isButtonDown(PAD.b),
      start: pad.isButtonDown(PAD.start),
      up: pad.isButtonDown(PAD.up) || pad.leftStick.y < -0.5,
      down: pad.isButtonDown(PAD.down) || pad.leftStick.y > 0.5,
      left: pad.isButtonDown(PAD.left) || pad.leftStick.x < -0.5,
      right: pad.isButtonDown(PAD.right) || pad.leftStick.x > 0.5,
    };
    if (wasFresh) {
      this.padPrev = now; // the button that opened this menu (Start, B) must not act inside it
      return false;
    }
    const edge = (k: string) => !!now[k] && !this.padPrev[k];
    this.padRepeat -= deltaMs;
    const held = (k: string) => !!now[k] && this.padRepeat <= 0;
    let start = false;
    if (edge('a')) this.activate();
    else if (edge('b')) this.back();
    else if (edge('start')) start = true;
    for (const [k, fn] of [['up', () => this.moveFocus(-1)], ['down', () => this.moveFocus(1)], ['left', () => this.left()], ['right', () => this.right()]] as const) {
      if (edge(k)) {
        fn();
        this.padRepeat = 350;
      } else if (held(k)) {
        fn();
        this.padRepeat = 120;
      }
    }
    this.padPrev = now;
    return start;
  }
}
