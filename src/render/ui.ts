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
import { getScreen } from '../web/screen';
import { getLang, langListenerCount, t } from '../i18n';

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
  /**
   * Footer lines (the title page: controls hint, champion block). Phones in portrait pin them in their own panel at the
   * bottom of the screen (the bottom band); everywhere else they simply follow `lines`.
   */
  foot?: () => string[];
  /** Back goes here; undefined = root page (no back). */
  onBack?: () => void;
  /** Extra objects for this page (e.g. hero sprites); destroyed when the page changes. */
  /** `touch`: the phone layout (rows from rowY, full width); otherwise the classic desktop positions. */
  decorate?: (scene: Phaser.Scene, rowY: (i: number) => number, touch: boolean) => Phaser.GameObjects.GameObject[];
  /** y of the first text line (default: right under the items). */
  linesTop?: number;
  /** First row y (default 64) and row spacing (default 14). */
  top?: number;
  gap?: number;
}

/**
 * A tap on an object: the pointer must go DOWN on it and come UP on it, and a drag of more than TAP_SLOP_CSS px cancels
 * it (a finger that started a scroll or a drag never activates anything). Movement is measured in CSS px, so a small
 * finger wobble on a phone does not cancel the tap. `onPress` shows a pressed state while the finger is down.
 */
export const TAP_SLOP_CSS = 10;
export function onTap(o: Phaser.GameObjects.GameObject, fn: (p: Phaser.Input.Pointer) => void, onPress?: (down: boolean) => void): void {
  const scene = o.scene;
  const downs = new Map<number, { x: number; y: number }>();
  const css = () => getScreen().cssPerPx || 1;
  const end = (id: number) => {
    if (downs.delete(id)) onPress?.(false);
  };
  o.on('pointerdown', (p: Phaser.Input.Pointer) => {
    downs.set(p.id, { x: p.x, y: p.y });
    onPress?.(true);
  });
  const move = (p: Phaser.Input.Pointer) => {
    const d = downs.get(p.id);
    if (d && Math.hypot(p.x - d.x, p.y - d.y) * css() > TAP_SLOP_CSS) end(p.id);
  };
  const up = (p: Phaser.Input.Pointer) => {
    if (!downs.has(p.id)) return;
    end(p.id);
    // released on the object (or within the slop of where it went down)
    if (scene.input.hitTestPointer(p).includes(o)) fn(p);
  };
  scene.input.on('pointermove', move);
  scene.input.on('pointerup', up);
  o.once('destroy', () => {
    scene.input.off('pointermove', move);
    scene.input.off('pointerup', up);
  });
}

/** Content of every menu page starts here (the page title sits at y 30 above it). */
export const MENU_TOP = 58;
export const PANEL_PAD = 8;
/** Phones: gap between the screen edge and the menu frame (CSS px). Portrait: the logo band (share of the height) and
 * how far rows may grow beyond their minimum (48 CSS px) before the block is centred instead. */
export const MENU_GUTTER_CSS = 10;
export const LOGO_BAND = 0.18;
export const ROW_GROW = 1.6;
/** Phones: an info row (disabled, not a tap target) takes this share of a row's height. */
export const INFO_ROW = 0.6;

const PAD = { a: 0, b: 1, start: 9, up: 12, down: 13, left: 14, right: 15 };

/** Minimum touch target sizes (CSS px) on phones: rows in portrait / landscape, small buttons (BACK, arrows). */
export const TOUCH_ROW_CSS = { portrait: 48, landscape: 44 };
export const TOUCH_TARGET_CSS = 44;

/**
 * Padding (game px, each side) that makes a w x h control a touch target of at least TOUCH_TARGET_CSS on phones
 * (`min` px elsewhere).
 */
export function hitPad(w: number, h: number, min = 4): { x: number; y: number } {
  const sc = getScreen();
  if (!sc.phone) return { x: min, y: min };
  const need = TOUCH_TARGET_CSS / Math.max(0.1, sc.cssPerPx);
  return { x: Math.max(min, Math.ceil((need - w) / 2)), y: Math.max(min, Math.ceil((need - h) / 2)) };
}

/** Menu geometry. Desktop: the classic centred list; phones (touch): full-width rows, bigger targets, scrolling. */
interface Geo {
  touch: boolean;
  portrait: boolean;
  W: number;
  H: number;
  /** Game px per CSS px of a touch target. */
  css: number;
  size: 8 | 16;
  rowH: number;
  mx: number;
  titleY: number;
  listTop: number;
  listBottom: number;
  arrowW: number;
  backW: number;
  /** Phones: the gap between the screen edge and the panel frame (game px, ~10 CSS px), the first row's top edge. */
  gutter: number;
  rowTop: number;
  /** Portrait: the pinned footer's text top (Infinity = none). */
  footTop: number;
}

type Target = { kind: 'row' | 'left' | 'right' | 'back'; i: number; x: number; y: number; w: number; h: number; scrolls: boolean };

export class MenuView {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private rows: UIText[] = [];
  private lineTexts: UIText[] = [];
  /** Portrait footer (pinned, not scrolling): its texts, its panel and how many lines it was laid out for. */
  private footTexts: UIText[] = [];
  private footPanel: Phaser.GameObjects.Rectangle | null = null;
  private footCount = 0;
  private arrows: UIText[] = [];
  /** The dark panel behind the page, sized to its content (+ even padding) on every refresh. */
  private panel: Phaser.GameObjects.Rectangle | null = null;
  /** Scrolling content (rows, arrows, lines, decorations, panel); the title and BACK stay fixed. */
  private list: Phaser.GameObjects.Container | null = null;
  private pressRect: Phaser.GameObjects.Rectangle | null = null;
  private deco: Phaser.GameObjects.GameObject[] = [];
  /** The page title and BACK (the layout check: they never overlap). */
  private head: UIText[] = [];
  private page: MenuPage | null = null;
  private g: Geo | null = null;
  private targets: Target[] = [];
  private scrollMin = 0;
  private press: { id: number; x0: number; y0: number; t: Target | null; scroll0: number; moved: '' | 'tap' | 'scroll' | 'slide'; slid: number } | null = null;
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
    const down = (p: Phaser.Input.Pointer) => this.pointerDown(p);
    const move = (p: Phaser.Input.Pointer) => this.pointerMove(p);
    const up = (p: Phaser.Input.Pointer) => this.pointerUp(p);
    scene.input.on('pointerdown', down);
    scene.input.on('pointermove', move);
    scene.input.on('pointerup', up);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.keyboard?.off('keydown', this.keyHandler);
      scene.input.off('pointerdown', down);
      scene.input.off('pointermove', move);
      scene.input.off('pointerup', up);
    });
  }

  private geo(page: MenuPage): Geo {
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const sc = getScreen();
    const touch = sc.phone;
    const portrait = touch && H > W;
    const css = 1 / Math.max(0.1, sc.cssPerPx);
    const safe = touch ? sc.safe : { t: 0, b: 0, l: 0, r: 0 };
    if (!touch) {
      const top = Math.max(MENU_TOP, page.top ?? MENU_TOP);
      return { touch, portrait, W, H, css, size: 8, rowH: page.gap ?? 14, mx: 0, titleY: 30, listTop: top, listBottom: H, arrowW: 0, backW: 0, gutter: 0, rowTop: top, footTop: Infinity };
    }
    // the target is the row minus a 4 px gap: the row is the minimum target size + 4
    const rowH = Math.max(page.gap ?? 14, Math.ceil((portrait ? TOUCH_ROW_CSS.portrait : TOUCH_ROW_CSS.landscape) * css) + 4);
    const backW = Math.ceil(TOUCH_TARGET_CSS * css);
    // a symmetric gutter (~10 CSS px) between the screen edge and the panel frame; rows start PANEL_PAD inside the frame
    const gutter = Math.max(Math.ceil(MENU_GUTTER_CSS * css), safe.l, safe.r);
    // portrait: the logo / title band is the top ~18% of the real screen; the title sits in its middle
    const band = portrait ? Math.round((H - safe.t - safe.b) * LOGO_BAND) : 0;
    const titleY = safe.t + Math.max(Math.ceil(backW / 2), portrait ? Math.max(20, Math.round(band / 2)) : 14);
    const listTop = Math.max(titleY + Math.ceil(backW / 2) + 6, safe.t + band);
    return {
      touch, portrait, W, H, css, size: 16, rowH,
      mx: gutter + PANEL_PAD,
      titleY,
      listTop,
      listBottom: H - safe.b - 4,
      arrowW: backW,
      backW,
      gutter,
      rowTop: listTop,
      footTop: Infinity,
    };
  }

  /** Phones: disabled rows with an empty label (e.g. the Hard-only daily line) take no space. */
  private collapsed = '';
  private collapseKey(): string {
    return (this.page?.items ?? []).map((it) => (it.disabled && it.label().trim() === '' ? '1' : '0')).join('');
  }

  /** Centre y (content coords) of row i. */
  private rowY(i: number): number {
    const g = this.g;
    const it = this.page?.items[i];
    if (!g || !it) return 0;
    if (!g.touch) return it.y ?? g.listTop + i * g.rowH;
    let n = 0;
    for (let k = 0; k < i; k++) n += this.slot(this.page!.items[k]!, this.collapsed[k] === '1');
    return Math.round(g.rowTop + g.rowH * (n + this.slot(it, false) / 2));
  }

  /**
   * Phones: the height of a row in row units. A collapsed row (a disabled row with an empty label) takes none, an info
   * row (disabled, e.g. the daily seed line: not a tap target) INFO_ROW of a row, every other row a full one.
   */
  private slot(it: MenuItem, collapsed: boolean): number {
    return collapsed ? 0 : it.disabled ? INFO_ROW : 1;
  }

  /** Rows taking space on a page (phones, in row units), before it is shown. */
  private shownRowsOf(page: MenuPage): number {
    return page.items.reduce((a, it) => a + this.slot(it, !!it.disabled && it.label().trim() === ''), 0);
  }

  /** Rows taking space (phones, in row units). */
  private shownRows(): number {
    return (this.page?.items ?? []).reduce((a, it, k) => a + this.slot(it, this.collapsed[k] === '1'), 0);
  }

  show(page: MenuPage, focus = -1): void {
    this.clear();
    this.page = page;
    if (!this.active) this.fresh = true;
    this.active = true;
    const s = this.scene;
    const g = (this.g = this.geo(page));
    this.collapsed = g.touch ? this.collapseKey() : '';
    if (this.dim > 0) this.objs.push(s.add.rectangle(0, 0, g.W, g.H, 0x0b0d12, this.dim).setOrigin(0).setDepth(this.depth).setInteractive());
    this.list = s.add.container(0, 0).setDepth(this.depth + 0.5);
    this.objs.push(this.list);
    this.panel = s.add.rectangle(0, 0, 10, 10, 0x0b0d12, 0.8).setOrigin(0).setStrokeStyle(1, 0x3a4558);
    this.pressRect = s.add.rectangle(0, 0, 10, 10, 0xd9d2c0, 0.14).setOrigin(0).setVisible(false);
    this.list.add([this.panel, this.pressRect]);
    // the title (and BACK) stay on top of the scrolling list
    const titleBg = g.touch ? s.add.rectangle(0, 0, g.W, g.listTop - 2, 0x0b0d12, 0.85).setOrigin(0).setDepth(this.depth + 0.9) : null;
    if (titleBg) this.objs.push(titleBg);
    const titleText = snap(addText(s, g.W / 2, g.titleY, page.title, { size: 16, color: C.bone }).setOrigin(0.5).setDepth(this.depth + 1));
    this.objs.push(titleText);
    this.head = [titleText];
    if (page.onBack) {
      const back = addText(s, g.touch ? g.mx + 4 : 8, g.touch ? g.titleY - 4 : 8, t('common.back'), { color: C.dim }).setDepth(this.depth + 1);
      this.objs.push(back);
      this.head.push(back);
      // a long title (another language) would run into BACK: the 8 px font, still centred, never below 8 px
      if (g.touch && g.W / 2 - titleText.width / 2 < back.x + back.width + 6) snap(titleText.setFontSize(8));
      const bw = Math.max(back.width + 8, g.backW);
      const bh = Math.max(back.height + 8, g.backW);
      this.targets.push({ kind: 'back', i: -1, x: back.x - 4, y: back.y + back.height / 2 - bh / 2, w: bw, h: bh, scrolls: false });
    }
    // lines (and the footer) are measured first: in portrait they decide the row spacing and the vertical centring
    let lines = page.lines?.() ?? [];
    let foot = page.foot?.() ?? [];
    const lineObjs = (ls: string[]) =>
      ls.map((l) => {
        const t = snap(addText(s, g.W / 2, 0, l, { color: C.dim }).setOrigin(0.5, 0));
        if (g.touch) t.setMaxWidth(g.W - 2 * g.mx - 8);
        return t;
      });
    const lineH = (t: UIText) => (g.touch ? Math.max(11, t.height + 3) : 11);
    if (g.portrait && foot.length) {
      const probe = lineObjs(foot);
      const footH = probe.reduce((a, t) => a + lineH(t), 0);
      probe.forEach((t) => t.destroy());
      const footTop = g.H - g.gutter - PANEL_PAD - footH;
      // the pinned footer only when the rows (at their minimum size) and the lines still fit above it
      const need = this.shownRowsOf(page) * g.rowH + 6 + lines.length * 11 + 2 * PANEL_PAD;
      if (footTop - PANEL_PAD - 6 - g.listTop >= need) {
        g.footTop = footTop;
        g.listBottom = footTop - PANEL_PAD - 6;
      }
    }
    if (g.footTop === Infinity) {
      lines = [...lines, ...(foot.length ? ['', ...foot] : [])];
      foot = [];
    }
    this.footCount = foot.length;
    const lineTexts = lineObjs(lines);
    const linesH = lineTexts.reduce((a, t) => a + lineH(t), 0);
    if (g.portrait) {
      // rows grow (up to 1.6x the minimum) before anything else, then the whole block is centred in the middle band
      const n = this.shownRows();
      const room = g.listBottom - g.listTop - 2 * PANEL_PAD - (lines.length ? linesH + 6 : 0);
      if (n > 0) g.rowH = Math.max(g.rowH, Math.min(Math.floor(room / n), Math.round(g.rowH * ROW_GROW)));
      const block = n * g.rowH + (lines.length ? 6 + linesH : 0);
      const spare = g.listBottom - g.listTop - 2 * PANEL_PAD - block;
      if (spare > 0) g.rowTop = g.listTop + PANEL_PAD + Math.floor(spare / 2);
    }
    page.items.forEach((it, i) => {
      const x = g.touch ? g.W / 2 : (it.x ?? g.W / 2);
      const t = addText(s, x, this.rowY(i), '', { color: C.bone, size: g.size }).setOrigin(0.5);
      t.setCenterAlign(); // a two-line label (the daily seed row) stays centred
      this.rows.push(t);
      this.list?.add(t);
      if (!it.disabled && g.touch && (it.onLeft || (it.onRight && !it.onActivate))) {
        const l = addText(s, g.mx + g.arrowW / 2, this.rowY(i), '<', { color: C.dim, size: g.size }).setOrigin(0.5);
        const r = addText(s, g.W - g.mx - g.arrowW / 2, this.rowY(i), '>', { color: C.dim, size: g.size }).setOrigin(0.5);
        this.arrows.push(l, r);
        this.list?.add([l, r]);
      }
    });
    const placed = page.items.filter((it) => it.y === undefined).length;
    const lowest = Math.max(g.listTop - g.rowH, ...page.items.map((_it, i) => this.rowY(i)));
    let y = g.touch
      ? g.rowTop + g.rowH * this.shownRows() + 6
      : (page.linesTop ?? (page.items.length ? (placed === page.items.length ? g.listTop + placed * g.rowH + 6 : lowest + g.rowH) : g.listTop));
    if (g.touch && page.linesTop !== undefined && !page.items.every((it) => it.y === undefined)) y = Math.max(y, page.linesTop);
    lineTexts.forEach((t) => {
      snap(t.setY(Math.round(y)));
      this.lineTexts.push(t);
      this.list?.add(t);
      y += lineH(t);
    });
    // the pinned footer (portrait): its own panel above the home indicator, never scrolling
    if (foot.length) {
      this.footPanel = s.add.rectangle(g.gutter, g.footTop - PANEL_PAD, g.W - 2 * g.gutter, 10, 0x0b0d12, 0.8).setOrigin(0).setStrokeStyle(1, 0x3a4558).setDepth(this.depth + 0.6);
      this.objs.push(this.footPanel);
      let fy = g.footTop;
      for (const t of lineObjs(foot)) {
        snap(t.setY(Math.round(fy)).setDepth(this.depth + 0.7));
        this.footTexts.push(t);
        this.objs.push(t);
        fy += lineH(t);
      }
      const h = Math.round(fy - g.footTop + 2 * PANEL_PAD - 3);
      this.footPanel.setSize(g.W - 2 * g.gutter, h).setDisplaySize(g.W - 2 * g.gutter, h);
    }
    this.deco = page.decorate ? page.decorate(s, (i) => this.rowY(i), g.touch) : [];
    this.list.add(this.deco);
    const first = page.items.findIndex((it) => !it.disabled);
    this.focus = focus >= 0 && focus < page.items.length && !page.items[focus]?.disabled ? focus : Math.max(0, first);
    this.refresh();
    this.ensureVisible(this.focus);
  }

  /** Lay the current page out again (the screen changed: rotation, browser bars, a resize). */
  relayout(): void {
    // also while inactive (e.g. under the intro): the page must match the canvas once it is shown
    if (this.page) {
      const active = this.active;
      const fresh = this.fresh;
      this.show(this.page, this.focus);
      this.active = active;
      this.fresh = fresh;
    }
  }

  hide(): void {
    this.clear();
    this.active = false;
    this.page = null;
    this.scene.input.setDefaultCursor('default');
  }

  private clear(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.footTexts = [];
    this.head = [];
    this.footPanel = null;
    this.rows = [];
    this.lineTexts = [];
    this.arrows = [];
    this.targets = [];
    this.deco = [];
    this.list = null;
    this.panel = null;
    this.pressRect = null;
    this.press = null;
  }

  /** Re-render labels (after a value changed). */
  refresh(): void {
    const p = this.page;
    const g = this.g;
    if (!p || !g) return;
    const footNow = p.foot?.() ?? [];
    const merged = (p.lines?.() ?? []).length + (this.footTexts.length ? 0 : footNow.length ? footNow.length + 1 : 0);
    // a row appeared / vanished, or the number of lines changed (e.g. the board loaded the champion block)
    if ((g.touch && this.collapseKey() !== this.collapsed) || (this.footTexts.length > 0 && footNow.length !== this.footCount) || merged !== this.lineTexts.length) {
      // a row appeared or vanished (e.g. the difficulty changed): lay the page out again
      const fresh = this.fresh;
      this.show(p, this.focus);
      this.fresh = fresh;
      return;
    }
    this.targets = this.targets.filter((t) => t.kind === 'back');
    let a = 0;
    p.items.forEach((it, i) => {
      const t = this.rows[i];
      if (!t) return;
      const on = i === this.focus && !it.disabled;
      const lab = it.label();
      const valueRow = !!(it.onLeft || (it.onRight && !it.onActivate));
      if (g.touch) {
        // phones: the focus is shown by colour; value rows have their own tappable < > arrows. The 16 px font when the
        // label fits on one line, else the 8 px font (wrapped only if even that is too wide)
        const maxW = g.W - 2 * g.mx - (valueRow ? 2 * g.arrowW : 8);
        setTextValue(t, lab);
        t.setMaxWidth(0).setFontSize(16);
        if (t.width > maxW) {
          t.setFontSize(8).setLineSpacing(2);
          if (t.width > maxW) t.setMaxWidth(maxW);
        }
      } else setTextValue(t, valueRow ? `${on ? '<' : ' '} ${lab} ${on ? '>' : ' '}` : on ? `> ${lab} <` : lab);
      setTextColor(t, it.disabled ? C.dim : on ? C.gold : C.bone);
      snap(t);
      if (it.disabled) return;
      if (g.touch) {
        // a full-width row; rows never closer than 4 px; the arrows take the row's ends
        const y = this.rowY(i) - g.rowH / 2 + 2;
        if (valueRow) {
          this.targets.push({ kind: 'left', i, x: g.mx, y, w: g.arrowW, h: g.rowH - 4, scrolls: true });
          this.targets.push({ kind: 'right', i, x: g.W - g.mx - g.arrowW, y, w: g.arrowW, h: g.rowH - 4, scrolls: true });
          this.targets.push({ kind: 'row', i, x: g.mx + g.arrowW + 4, y, w: g.W - 2 * g.mx - 2 * g.arrowW - 8, h: g.rowH - 4, scrolls: true });
          this.arrows[a++]?.setTint(on ? 0xffd86b : 0x7f93b8);
          this.arrows[a++]?.setTint(on ? 0xffd86b : 0x7f93b8);
        } else this.targets.push({ kind: 'row', i, x: g.mx, y, w: g.W - 2 * g.mx, h: g.rowH - 4, scrolls: true });
      } else {
        const b = t.getBounds();
        this.targets.push({ kind: 'row', i, x: b.x - 8, y: t.y - t.height / 2 - 3, w: t.width + 16, h: 14, scrolls: true });
      }
    });
    // the footer follows the lines unless it is pinned (portrait)
    const lines = this.footTexts.length ? (p.lines?.() ?? []) : [...(p.lines?.() ?? []), ...(footNow.length ? ['', ...footNow] : [])];
    this.lineTexts.forEach((t, i) => snap(setTextValue(t, lines[i] ?? '')));
    this.footTexts.forEach((t, i) => snap(setTextValue(t, footNow[i] ?? '')));
    this.fitPanel();
  }

  /** Content height beyond the screen: the list scrolls (touch layouts only). */
  private updateScroll(): void {
    const g = this.g;
    if (!g || !this.list) return;
    const y0 = this.list.y;
    this.list.y = 0;
    let bottom = 0;
    for (const o of [...this.rows, ...this.lineTexts, ...this.deco] as unknown as { getBounds?: () => Phaser.Geom.Rectangle }[]) {
      const b = o.getBounds?.();
      if (b && Number.isFinite(b.bottom) && b.height > 0) bottom = Math.max(bottom, b.bottom);
    }
    // the last row's whole tap slot must scroll into view, not only its text
    if (g.touch) bottom = Math.max(bottom, g.rowTop + this.shownRows() * g.rowH);
    this.scrollMin = g.touch ? Math.min(0, g.listBottom - (bottom + PANEL_PAD + 4)) : 0;
    this.list.y = Math.max(this.scrollMin, Math.min(0, y0));
  }

  /** Keep a (keyboard / gamepad) focused row on screen. */
  private ensureVisible(i: number): void {
    const g = this.g;
    if (!g || !this.list || !g.touch) return;
    const y = this.rowY(i) + this.list.y;
    if (y - g.rowH / 2 < g.listTop) this.list.y += g.listTop - (y - g.rowH / 2);
    else if (y + g.rowH / 2 > g.listBottom) this.list.y -= y + g.rowH / 2 - g.listBottom;
    this.list.y = Math.round(Math.max(this.scrollMin, Math.min(0, this.list.y)));
    this.snapshot();
  }

  // ------------------------------------------------------------------ pointer (mouse, pen and touch alike)

  private targetAt(x: number, y: number): Target | null {
    const dy = this.list?.y ?? 0;
    const g = this.g;
    for (const t of this.targets) {
      const ty = t.y + (t.scrolls ? dy : 0);
      if (t.scrolls && g?.touch && (y < g.listTop || y > g.listBottom)) continue; // under the title band
      if (x >= t.x && x <= t.x + t.w && y >= ty && y <= ty + t.h) return t;
    }
    return null;
  }

  private showPress(t: Target | null): void {
    const r = this.pressRect;
    if (!r) return;
    if (!t || t.kind === 'back' || !this.g?.touch) {
      r.setVisible(false);
      return;
    }
    r.setVisible(true).setPosition(t.x, t.y).setSize(t.w, t.h);
    r.setDisplaySize(t.w, t.h);
  }

  private pointerDown(p: Phaser.Input.Pointer): void {
    if (!this.active || !this.page || boardOverlayOpen()) return;
    const t = this.targetAt(p.x, p.y);
    this.press = { id: p.id, x0: p.x, y0: p.y, t, scroll0: this.list?.y ?? 0, moved: '', slid: 0 };
    this.showPress(t);
  }

  private pointerMove(p: Phaser.Input.Pointer): void {
    if (!this.active || !this.page) return;
    const pr = this.press;
    if (!pr || pr.id !== p.id) {
      // mouse hover moves the focus (as before)
      if (!p.wasTouch) {
        const t = this.targetAt(p.x, p.y);
        if (t && t.kind === 'row') this.setFocus(t.i);
        this.scene.input.setDefaultCursor(t ? 'pointer' : 'default'); // the hand cursor over items, as before
      }
      return;
    }
    const g = this.g;
    const dx = p.x - pr.x0;
    const dy = p.y - pr.y0;
    if (!pr.moved && Math.hypot(dx, dy) / (g?.css ?? 1) > TAP_SLOP_CSS) {
      // a drag: never a tap. Vertical = scroll the list; horizontal on a value row = step its value
      const it = pr.t && pr.t.kind !== 'back' ? this.page.items[pr.t.i] : undefined;
      // a value slide needs a clearly horizontal touch drag; anything else on a phone scrolls (never changes a value)
      const slide = p.wasTouch && Math.abs(dx) > 2 * Math.abs(dy) && !!(it?.onLeft && it?.onRight);
      pr.moved = slide ? 'slide' : Math.abs(dy) >= Math.abs(dx) ? 'scroll' : 'tap';
      this.showPress(null);
    }
    if (pr.moved === 'scroll' && this.list && g?.touch) {
      this.list.y = Math.round(Math.max(this.scrollMin, Math.min(0, pr.scroll0 + dy)));
      this.snapshot();
    } else if (pr.moved === 'slide' && pr.t) {
      const steps = Math.trunc(dx / 24) - pr.slid;
      if (steps !== 0) {
        this.setFocus(pr.t.i);
        for (let k = 0; k < Math.abs(steps); k++) (steps < 0 ? this.left() : this.right());
        pr.slid += steps;
      }
    }
  }

  private pointerUp(p: Phaser.Input.Pointer): void {
    const pr = this.press;
    if (!pr || pr.id !== p.id) return;
    this.press = null;
    this.showPress(null);
    if (!this.active || pr.moved || !pr.t) return;
    const t = this.targetAt(p.x, p.y);
    if (!t || t.kind !== pr.t.kind || t.i !== pr.t.i) return; // up on another item: nothing
    this.fire(t, p);
  }

  private fire(t: Target, p: Phaser.Input.Pointer): void {
    if (t.kind === 'back') {
      this.back();
      return;
    }
    const it = this.page?.items[t.i];
    if (!it) return;
    this.setFocus(t.i);
    if (t.kind === 'left') this.left();
    else if (t.kind === 'right') this.right();
    else if (this.g?.touch) {
      // phones: a tap on a row = activate, or the next value
      if (it.onActivate) this.activate();
      else this.right();
    } else {
      // mouse: value rows, the left third steps down, the rest steps up / activates
      const row = this.rows[t.i];
      if (it.onLeft && row && p.x < row.x - row.width / 6) this.left();
      else if (it.onRight && !it.onActivate) this.right();
      else this.activate();
    }
  }

  /** Size the panel to everything on the page except the title and BACK (even padding on every side). */
  private fitPanel(): void {
    if (!this.panel || !this.list || !this.g) return;
    const dy = this.list.y;
    this.list.y = 0; // bounds in content coords
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
    this.list.y = dy;
    if (!Number.isFinite(x0)) {
      this.panel.setVisible(false);
      this.updateScroll();
      this.snapshot();
      return;
    }
    const pad = PANEL_PAD;
    const g = this.g;
    if (g.touch) {
      // phones: the panel spans the rows (full width, symmetric gutters) so every target sits on it
      x0 = Math.min(x0, g.mx);
      x1 = Math.max(x1, g.W - g.mx);
      y0 = Math.min(y0, g.rowTop + 2);
      // the row slots are symmetric: the panel covers the last slot as fully as the first one
      const n = this.shownRows();
      if (n > 0) y1 = Math.max(y1, g.rowTop + n * g.rowH - 2);
    }
    const w = g.touch ? x1 - x0 + 2 * pad : Math.max(160, x1 - x0 + 2 * pad);
    const cx = g.touch ? (x0 + x1) / 2 : g.W / 2;
    // phones: always the full width between the two (equal) gutters
    const px = g.touch ? g.gutter : Math.max(0, Math.round(cx - w / 2));
    const pw = g.touch ? g.W - 2 * g.gutter : Math.min(g.W - px, Math.round(w));
    this.panel.setVisible(true).setPosition(px, Math.round(y0 - pad)).setSize(pw, Math.round(y1 - y0 + 2 * pad));
    this.panel.setDisplaySize(pw, Math.round(y1 - y0 + 2 * pad));
    this.updateScroll();
    this.snapshot();
  }

  /** Layout snapshot for the automated layout check (dev / smoke builds only). Screen coords, current scroll. */
  private snapshot(): void {
    if (!(import.meta.env.DEV || import.meta.env.VITE_SMOKE === '1') || !this.panel || !this.list || !this.g) return;
    const dy = this.list.y;
    const box = (o: { getBounds: () => Phaser.Geom.Rectangle }) => {
      const b = o.getBounds();
      return [b.x, b.y, b.width, b.height];
    };
    const focusable = new Set(this.targets.filter((t) => t.kind === 'row').map((t) => t.i));
    const g = this.g;
    (window as unknown as { __ngLayout?: object }).__ngLayout = {
      title: this.page?.title,
      lang: getLang(),
      head: this.head.filter((o) => o.active).map((o) => ({ box: box(o), text: o.text })),
      // leak checks (tests-e2e/i18n.cjs): scene objects and language listeners
      objects: this.scene.children.list.length,
      langListeners: langListenerCount(),
      htmlLang: document.documentElement.lang,
      focus: this.focus,
      touch: g.touch,
      screen: [g.W, g.H],
      cssPerPx: 1 / g.css,
      list: [g.listTop, g.listBottom],
      portrait: g.portrait,
      gutter: g.gutter,
      // the rows' block (content coords) for the vertical balance check
      block: this.rows.length ? [Math.min(...this.rows.filter((t) => t.text.trim() !== '').map((t) => t.getBounds().y)), Math.max(...this.rows.filter((t) => t.text.trim() !== '').map((t) => t.getBounds().bottom))] : null,
      foot: this.footPanel ? { panel: [this.footPanel.x, this.footPanel.y, this.footPanel.width, this.footPanel.height], texts: this.footTexts.filter((t) => t.text.trim() !== '').map((t) => ({ box: box(t), text: t.text })) } : null,
      scroll: [dy, this.scrollMin],
      panel: [this.panel.x, this.panel.y + dy, this.panel.width, this.panel.height],
      texts: [...this.rows.map((t, i) => ({ t, f: focusable.has(i) })), ...this.lineTexts.map((t) => ({ t, f: false })), ...(this.deco.filter((o) => o instanceof Phaser.GameObjects.BitmapText) as UIText[]).map((t) => ({ t, f: false }))]
        .filter(({ t }) => t.text.trim() !== '')
        .map(({ t, f }) => ({ box: box(t), text: t.text, focusable: f })),
      targets: this.targets.map((t) => ({ kind: t.kind, i: t.i, box: [t.x, t.y + (t.scrolls ? dy : 0), t.w, t.h], label: t.i >= 0 ? (this.page?.items[t.i]?.label() ?? '') : 'BACK' })),
    };
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
    this.ensureVisible(i);
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
    if (!pad) return false;
    if (boardOverlayOpen()) {
      // the phone board overlay is on top: B closes it; every button must be released before the menu reacts again
      if (pad.isButtonDown(PAD.b)) closeBoardOverlay();
      this.padPrev = { a: true, b: true, start: true, up: true, down: true, left: true, right: true };
      return false;
    }
    if (!this.active) return false;
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
