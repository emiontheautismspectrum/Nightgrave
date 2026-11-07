/**
 * Hard death panel: submit the run to today's board. Shown only when the score would enter the top 10 (fresh GET).
 * Real <input> fields (so touch devices open the native keyboard), positioned over the canvas, NOT auto-focused.
 * The fields are created ONCE per panel and never removed while it is open: a relayout (rotation, browser bars) only
 * moves and resizes them, so the focus, the caret, the typed text and the on-screen keyboard survive it.
 * Enter submits, Esc leaves the field; while a field is focused, keys only type. Everything else (Space, a click or
 * tap outside the fields) still restarts instantly. Text is set with .value / Phaser text only (never innerHTML).
 */
import type { HeroId } from '../data/heroes';
import Phaser from 'phaser';
import { addText, setTextColor, setTextValue, type UIText } from './text';
import { reasonText, submitRun, wouldRank, fetchBoard } from '../net/api';
import { encodeInputLog } from '../shared/replayCodec';
import { validateMessage, validateName, type TextError } from '../shared/text';
import { CLIENT_VERSION, tuningFingerprint } from '../shared/version';
import { persist, save } from '../storage';
import type { InputFrame } from '../sim/input';
import { C, FONT, hitPad, onTap } from './ui';
import { textFieldFocused, textFocusEnded } from '../web/textFocus';
import { getScreen } from '../web/screen';

export interface RunResult {
  date: string;
  seed: number;
  score: number;
  hero: HeroId;
  /** Metadata only: was the run played with the zoomed phone-portrait camera at any point. */
  view: 'full' | 'zoomed';
  log: readonly InputFrame[];
}

const ERR: Record<TextError, string> = { empty: 'TYPE A NAME', short: 'TOO SHORT', long: 'TOO LONG', chars: 'INVALID CHARACTERS', words: 'NOT ALLOWED WORDS' };

/** True while one of our fields has the keyboard focus (game keys must not act then). One source of truth. */
export const fieldFocused = (): boolean => textFieldFocused();

export class SubmitPanel {
  private inputs: HTMLInputElement[] = [];
  private objs: Phaser.GameObjects.GameObject[] = [];
  private status!: UIText;
  private frame: Phaser.GameObjects.Rectangle | null = null;
  private note: UIText | null = null;
  private busy = false;
  private done = false;
  /** Game-px rects of the clickable UI (the game must not treat presses there as "restart"). */
  rects: [number, number, number, number][] = [];
  private onResize = () => this.place();

  /** `centerY`: the death panel's centre (game px); the portrait panel goes above it (default: the screen middle). */
  constructor(private scene: Phaser.Scene, private depth: number, private centerY: () => number = () => scene.scale.height / 2) {}

  /** Async: fetch a fresh board, and if the run would rank, show the fields. */
  async offer(run: RunResult, alive: () => boolean): Promise<void> {
    const board = await fetchBoard(run.date);
    if (!alive()) return; // a restart happened meanwhile
    const rank = board && board.date === run.date ? wouldRank(board, run.score) : null;
    if (!rank) return;
    this.build(run, rank);
  }

  private field(placeholder: string, max: number, value: string): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = max;
    el.placeholder = placeholder;
    el.value = value;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.dataset.ng = '1';
    const st = el.style;
    st.position = 'fixed';
    st.zIndex = '5';
    st.boxSizing = 'border-box';
    st.background = '#12161d';
    st.color = '#d9d2c0';
    st.border = '1px solid #3a4558';
    st.outline = 'none';
    st.padding = '0 4px';
    st.fontFamily = FONT;
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void this.submit();
      if (e.key === 'Escape') el.blur();
    });
    el.addEventListener('input', () => this.validate());
    // touch: once the keyboard is up, make sure the field is in the visible part (portrait puts the panel in the upper
    // half anyway; a short landscape screen may need the browser to bring it into view). One scroll, no page jumps.
    el.addEventListener('focus', () => {
      if (!this.touch()) return;
      setTimeout(() => {
        const vv = window.visualViewport;
        const r = el.getBoundingClientRect();
        if (document.activeElement !== el || !vv || (r.bottom <= vv.offsetTop + vv.height && r.top >= vv.offsetTop)) return;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        // still hidden (a fixed field on a non-scrolling page, e.g. a short landscape screen on Android): lift only this
        // field to the top of the visible area while it is focused; place() puts it back when it is left
        const r2 = el.getBoundingClientRect();
        if (r2.bottom > vv.offsetTop + vv.height || r2.top < vv.offsetTop) el.style.top = `${Math.round(vv.offsetTop + 8)}px`;
      }, 350);
    });
    el.addEventListener('blur', () => this.place());
    document.body.appendChild(el);
    this.inputs.push(el);
    return el;
  }

  private run!: RunResult;
  private wantsMessage = false;

  /** Phones: the fields use a >= 16 CSS px font (smaller makes iOS Safari zoom the page on focus) in a >= 24 CSS px box. */
  private touch(): boolean {
    return getScreen().phone;
  }
  /** CSS px per game px of the canvas. */
  private k(): number {
    const c = this.scene.game.canvas.getBoundingClientRect();
    return c.width / this.scene.scale.width || 1;
  }

  /**
   * Where everything goes (game px), the frame computed from its content (label, fields, buttons, status, note).
   * The classic 480x270 screen: under the death panel, across the arena width, fields side by side. The narrow
   * phone-portrait screen: ABOVE the death panel (the upper half stays clear of the on-screen keyboard), full-width
   * fields stacked; status and note may wrap to two lines there.
   */
  private geo(): { frame: [number, number, number, number]; x: number; y0: number; fields: [number, number, number][]; fh: number; btnY: number; btnX: [number, number]; statusY: number; noteY: number; textW: number } {
    const W = this.scene.scale.width;
    const H = this.scale();
    const fh = this.touch() ? Math.max(14, Math.ceil(24 / this.k())) : 14;
    if (H <= W) {
      const y0 = 190;
      const fy = y0 + 10;
      const btnY = fy + fh + 6;
      const statusY = btnY + 13;
      const noteY = statusY + 10;
      const top = y0 - 6;
      return { frame: [52, top, 376, noteY + 8 + 4 - top], x: 60, y0, fields: [[60, fy, 176], [244, fy, 176]], fh, btnY, btnX: [150, 290], statusY, noteY, textW: 360 };
    }
    const fields = this.wantsMessage ? 2 : 1;
    const content = 12 + fields * (fh + 4) + 2 + 14 + 20 + 20; // label, fields, buttons, status (2 lines), note (2 lines)
    // above the death panel (its box spans centerY +- 48) AND above its [ BOARD ] button (centred at centerY - 62, a >= 44
    // CSS px tap target): the frame ends clear of that target. The shell moves the centre up off the control deck.
    const bottom = Math.round(this.centerY() - 62 - Math.ceil(22 / this.k()) - 4);
    const top = Math.max(4, bottom - (content + 16));
    const y0 = top + 6;
    const fw = W - 16;
    const f1 = y0 + 12;
    const f2 = f1 + fh + 4;
    const btnY = (fields === 2 ? f2 : f1) + fh + 6;
    const statusY = btnY + 14;
    const noteY = statusY + 20;
    return { frame: [4, top, W - 8, noteY + 18 + 4 - top], x: 8, y0, fields: [[8, f1, fw], [8, f2, fw]], fh, btnY, btnX: [Math.round(W * 0.2), Math.round(W * 0.62)], statusY, noteY, textW: W - 16 };
  }
  private scale(): number {
    return this.scene.scale.height;
  }

  private rank = 0;

  /**
   * The screen changed (rotation, browser bars): rebuild the Phaser objects at the new size and MOVE the same DOM
   * fields (never removed, never recreated: focus, caret, text and the on-screen keyboard survive).
   */
  relayout(): void {
    if (!this.objs.length || !this.run) return;
    const status = this.status?.text ?? '';
    const statusTint = this.status?.tintTopLeft;
    const note = this.note?.text ?? '';
    window.removeEventListener('resize', this.onResize);
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.rects = [];
    this.build(this.run, this.rank);
    if (status) setTextValue(this.status, status);
    if (statusTint !== undefined) this.status.setTint(statusTint);
    if (note) this.note?.setText(note);
  }

  private build(run: RunResult, rank: number): void {
    this.run = run;
    this.rank = rank;
    this.wantsMessage = rank === 1;
    const s = this.scene;
    const G = this.geo();
    const y0 = G.y0;
    const label = (x: number, y: number, t: string, col: string = C.dim) =>
      addText(s, x, y, t, { color: col }).setDepth(this.depth);
    const [fx, fy, fw, fhh] = G.frame;
    this.frame = s.add.rectangle(fx, fy, fw, fhh, 0x0b0d12, 0.92).setOrigin(0).setStrokeStyle(1, 0x3a4558).setDepth(this.depth - 1);
    this.objs.push(this.frame);
    // rank 1 is a new high score of the day and the only one that may leave a message (shown on the title and board)
    this.objs.push(label(G.x, y0, rank === 1 ? 'NEW HIGH SCORE! YOUR MESSAGE:' : `TODAY'S TOP 10: RANK ${rank}`, C.gold));
    // the DOM fields exist once per panel: a relayout keeps (and only moves) them
    if (!this.inputs.length) {
      this.field('NAME', 16, save().boardName);
      if (this.wantsMessage) this.field('MESSAGE (OPTIONAL)', 40, '');
    }
    const btn = (x: number, t: string, fn: () => void) => {
      const o = addText(s, x, G.btnY, t, { color: C.bone }).setDepth(this.depth);
      const pd = hitPad(o.width, o.height);
      o.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-pd.x, -pd.y, o.width + 2 * pd.x, o.height + 2 * pd.y), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      onTap(o, fn, (down) => o.setAlpha(down ? 0.6 : 1));
      this.rects.push([o.x - pd.x, o.y - pd.y, o.x + o.width + pd.x, o.y + o.height + pd.y]);
      this.objs.push(o);
    };
    btn(G.btnX[0], 'SUBMIT', () => void this.submit());
    btn(G.btnX[1], 'SKIP', () => this.close());
    this.status = label(G.x, G.statusY, '');
    this.note = label(G.x, G.noteY, '', C.gold);
    for (const t of [this.status, this.note]) t.setMaxWidth(G.textW); // inside the frame (two lines at most in portrait)
    this.objs.push(this.status, this.note);
    this.place();
    window.addEventListener('resize', this.onResize);
    this.validate();
  }

  /** Position the DOM fields over the canvas (game px -> page px). */
  private place(): void {
    const c = this.scene.game.canvas.getBoundingClientRect();
    const k = c.width / this.scene.scale.width;
    // name and the optional rank-1 message (game px; the DOM fields sit above the canvas). Phones: a >= 16 CSS px font
    // (iOS Safari zooms the page on focus below that); desktop keeps its look
    const G = this.geo();
    const font = this.touch() ? Math.max(16, Math.round(8 * k)) : Math.max(8, Math.round(8 * k));
    this.inputs.forEach((el, i) => {
      const [gx, gy, gw] = G.fields[i] ?? G.fields[0]!;
      el.style.left = `${c.left + gx * k}px`;
      el.style.top = `${c.top + gy * k}px`;
      el.style.width = `${gw * k}px`;
      el.style.height = `${G.fh * k}px`;
      el.style.fontSize = `${font}px`;
    });
  }

  private validate(): boolean {
    const n = validateName(this.inputs[0]?.value ?? '');
    let msg = '';
    let ok = n.ok;
    if (!n.ok) msg = `NAME: ${ERR[n.error]}`;
    const m = this.inputs[1];
    if (ok && m && m.value.trim()) {
      const r = validateMessage(m.value);
      if (!r.ok) {
        ok = false;
        msg = `MESSAGE: ${ERR[r.error]}`;
      }
    }
    if (!this.busy && !this.done && this.status) setTextColor(setTextValue(this.status, msg), C.ember);
    return ok;
  }

  private async submit(): Promise<void> {
    if (this.busy || this.done || !this.validate()) return;
    this.busy = true;
    setTextColor(setTextValue(this.status, 'SENDING...'), C.dim);
    const name = validateName(this.inputs[0]?.value ?? '');
    const msgRaw = this.inputs[1]?.value.trim() ?? '';
    const r = this.run;
    if (name.ok) {
      save().boardName = name.value;
      persist();
    }
    const res = await submitRun({
      date: r.date,
      seed: r.seed,
      difficulty: 'hard',
      score: r.score,
      durationTicks: r.log.length,
      hero: r.hero,
      view: r.view,
      name: name.ok ? name.value : '',
      ...(this.wantsMessage && msgRaw ? { message: msgRaw } : {}),
      playerId: save().playerId,
      tuningFingerprint: tuningFingerprint(),
      clientVersion: CLIENT_VERSION,
      replay: encodeInputLog(r.log, r.hero),
    });
    this.busy = false;
    if (!this.objs.length) return; // closed meanwhile
    if (!res) setTextColor(setTextValue(this.status, 'BOARD UNAVAILABLE'), C.ember);
    else if (res.accepted) {
      this.done = true;
      // shown on the board only after the replay is re-simulated by the verifier
      setTextColor(setTextValue(this.status, res.provisionalRank ? `SUBMITTED (RANK ${res.provisionalRank}). ON THE BOARD AFTER` : 'SUBMITTED. ON THE BOARD AFTER'), C.gold);
      this.note?.setText('VERIFICATION (USUALLY WITHIN 20 MINUTES)');
      // leave the field BEFORE disabling it (a disabled focused input fires no focusout: the owed re-measure and the
      // game keys would stay blocked)
      for (const el of this.inputs) el.blur();
      textFocusEnded();
      for (const el of this.inputs) el.disabled = true;
    } else setTextColor(setTextValue(this.status, reasonText(res.reason)), C.ember);
  }

  /** Smoke / dev snapshot for the layout checks: the frame and every text box (game px), the DOM fields (game px). */
  debugBoxes(): { frame: number[]; texts: { text: string; box: number[] }[]; fields: number[][] } | null {
    if (!this.frame || !this.objs.length) return null;
    const c = this.scene.game.canvas.getBoundingClientRect();
    const k = c.width / this.scene.scale.width || 1;
    const texts = this.objs
      .filter((o): o is UIText => o instanceof Phaser.GameObjects.BitmapText && o.text.trim() !== '')
      .map((t) => {
        const b = t.getBounds();
        return { text: t.text, box: [b.x, b.y, b.width, b.height] };
      });
    const fields = this.inputs.map((el) => {
      const r = el.getBoundingClientRect();
      return [(r.left - c.left) / k, (r.top - c.top) / k, r.width / k, r.height / k];
    });
    return { frame: [this.frame.x, this.frame.y, this.frame.width, this.frame.height], texts, fields };
  }

  /** The status line as shown (smoke-build snapshot for the e2e checks). */
  statusText(): string {
    return this.status?.text ?? '';
  }

  close(): void {
    window.removeEventListener('resize', this.onResize);
    const hadFocus = textFieldFocused();
    for (const el of this.inputs) el.remove();
    // a field removed while focused fires no reliable focusout: owe the page its re-measure (and free the game keys)
    if (hadFocus) textFocusEnded();
    for (const o of this.objs) o.destroy();
    this.inputs = [];
    this.objs = [];
    this.rects = [];
  }

  /** Is (x, y) in game px on one of our controls? */
  hit(x: number, y: number): boolean {
    return this.rects.some((r) => r && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
  }
}
