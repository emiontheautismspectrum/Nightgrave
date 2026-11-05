/**
 * A small menu component shared by the title screen and the pause overlay. Works with mouse, touch (Phaser pointer
 * events), keyboard (arrows/WASD + Enter/Space, Esc back) and gamepad (stick/d-pad + A, B back). Focus is always
 * visible; every page except the root has a back button in the top-left corner, and Esc/B always go back one level.
 * Text is only ever set through Phaser text objects (never innerHTML).
 */
import Phaser from 'phaser';
import { addText, setTextColor, setTextValue, snap, type UIText } from './text';
import { emitAudioEvent } from './events';
import { setDevice } from './hints';
import { boardOverlayOpen, closeBoardOverlay } from '../web/boardOverlay';

export const FONT = '"Press Start 2P", monospace';
export const C = { bone: '#d9d2c0', gold: '#ffd86b', dim: '#7f93b8', stone: '#3a4558', ember: '#ff7a2f', violet: '#9b6bff', teal: '#4fd1c5' };

export interface MenuItem {
  label: () => string;
  onActivate?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  /** Not focusable (a heading or spacer). */
  disabled?: boolean;
  /** Optional fixed position (e.g. heroes side by side); default: the centred vertical list. */
  x?: number;
  y?: number;
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
  /** y of the first text line (default: right under the items). */
  linesTop?: number;
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

/** Content of every menu page starts here (the page title sits at y 30 above it). */
export const MENU_TOP = 58;
export const PANEL_PAD = 8;

const PAD = { a: 0, b: 1, start: 9, up: 12, down: 13, left: 14, right: 15 };

export class MenuView {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private rows: UIText[] = [];
  private lineTexts: UIText[] = [];
  /** The dark panel behind the page, sized to its content (+ even padding) on every refresh. */
  private panel: Phaser.GameObjects.Rectangle | null = null;
  private deco: Phaser.GameObjects.GameObject[] = [];
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
    // every page: title at y 30, the panel content starting at the same y below it
    const top = Math.max(MENU_TOP, page.top ?? MENU_TOP);
    const gap = page.gap ?? 14;
    if (this.dim > 0) this.objs.push(s.add.rectangle(0, 0, s.scale.width, s.scale.height, 0x0b0d12, this.dim).setOrigin(0).setDepth(this.depth).setInteractive());
    this.panel = s.add.rectangle(0, 0, 10, 10, 0x0b0d12, 0.8).setOrigin(0).setStrokeStyle(1, 0x3a4558).setDepth(this.depth + 0.5);
    this.objs.push(this.panel);
    this.objs.push(snap(addText(s, s.scale.width / 2, 30, page.title, { size: 16, color: C.bone }).setOrigin(0.5).setDepth(this.depth + 1)));
    if (page.onBack) {
      const back = addText(s, 8, 8, '< BACK', { color: C.dim }).setDepth(this.depth + 1);
      back.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-4, -4, back.width + 8, back.height + 8), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      onTap(back, () => this.back());
      this.objs.push(back);
    }
    page.items.forEach((it, i) => {
      const t = addText(s, it.x ?? s.scale.width / 2, it.y ?? top + i * gap, '', { color: C.bone }).setOrigin(0.5).setDepth(this.depth + 1);
      if (!it.disabled) {
        // a fixed, generous tap target (>= 12 px tall) around the row; the label width changes with its value
        t.setInteractive({ hitArea: new Phaser.Geom.Rectangle(0, -3, 1, 14), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
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
    const placed = page.items.filter((it) => it.y === undefined).length;
    const lowest = Math.max(top - gap, ...page.items.map((it, i) => it.y ?? top + i * gap));
    const firstLineY = page.linesTop ?? (page.items.length ? (placed === page.items.length ? top + placed * gap + 6 : lowest + gap) : top);
    lines.forEach((l, i) => {
      const t = snap(addText(s, s.scale.width / 2, firstLineY + i * 11, l, { color: C.dim }).setOrigin(0.5, 0).setDepth(this.depth + 1));
      this.lineTexts.push(t);
    });
    this.objs.push(...this.lineTexts);
    this.deco = page.decorate ? page.decorate(s, (i) => top + i * gap) : [];
    this.objs.push(...this.deco);
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
      setTextValue(t, it.onLeft || (it.onRight && !it.onActivate) ? `${on ? '<' : ' '} ${lab} ${on ? '>' : ' '}` : on ? `> ${lab} <` : lab);
      setTextColor(t, it.disabled ? C.dim : on ? C.gold : C.bone);
      snap(t);
      const hit = t.input?.hitArea as Phaser.Geom.Rectangle | undefined;
      if (hit) hit.setTo(-8, -3, t.width + 16, 14);
    });
    const lines = p.lines?.() ?? [];
    this.lineTexts.forEach((t, i) => snap(setTextValue(t, lines[i] ?? '')));
    this.fitPanel();
  }

  /** Size the panel to everything on the page except the title and BACK (even padding on every side). */
  private fitPanel(): void {
    if (!this.panel) return;
    // empty texts (e.g. the Hard-only daily line on other difficulties) have no meaningful bounds: skip them
    const content = [...this.rows.filter((t) => t.text.trim() !== ''), ...this.lineTexts.filter((t) => t.text.trim() !== ''), ...this.deco] as unknown as { getBounds?: () => Phaser.Geom.Rectangle }[];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const o of content) {
      const b = o.getBounds?.();
      if (!b || !(b.width > 0) || !Number.isFinite(b.x + b.y + b.width + b.height)) continue;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.right);
      y1 = Math.max(y1, b.bottom);
    }
    if (!Number.isFinite(x0)) {
      this.panel.setVisible(false);
      return;
    }
    const pad = PANEL_PAD;
    const w = Math.max(160, x1 - x0 + 2 * pad);
    const cx = this.scene.scale.width / 2;
    this.panel.setVisible(true).setPosition(Math.round(cx - w / 2), Math.round(y0 - pad)).setSize(Math.round(w), Math.round(y1 - y0 + 2 * pad));
    this.panel.setDisplaySize(Math.round(w), Math.round(y1 - y0 + 2 * pad));
    if (import.meta.env.DEV || import.meta.env.VITE_SMOKE === '1') {
      // layout snapshot for the automated layout check (dev / smoke builds only)
      const box = (o: { getBounds: () => Phaser.Geom.Rectangle }) => {
        const b = o.getBounds();
        return [b.x, b.y, b.width, b.height];
      };
      (window as unknown as { __ngLayout?: object }).__ngLayout = {
        title: this.page?.title,
        panel: [this.panel.x, this.panel.y, this.panel.width, this.panel.height],
        texts: [...this.rows, ...this.lineTexts, ...(this.deco.filter((o) => o instanceof Phaser.GameObjects.BitmapText) as UIText[])].filter((t) => t.text.trim() !== '').map((t) => ({ box: box(t), text: t.text, focusable: !!t.input })),
      };
    }
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
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (a && a.tagName === 'INPUT') return; // a text field has the keyboard
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
    if (boardOverlayOpen()) {
      // the phone board overlay is on top: B closes it; every button must be released before the menu reacts again
      if (pad.isButtonDown(PAD.b)) closeBoardOverlay();
      this.padPrev = { a: true, b: true, start: true, up: true, down: true, left: true, right: true };
      return false;
    }
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
    if (Object.values(now).some(Boolean)) setDevice('gamepad');
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
