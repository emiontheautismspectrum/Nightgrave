/**
 * Hard death panel: submit the run to today's board. Shown only when the score would enter the top 10 (fresh GET).
 * Real <input> fields (so touch devices open the native keyboard), positioned over the canvas, NOT auto-focused.
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

/** True while one of our fields has the keyboard focus (game keys must not act then). */
export const fieldFocused = (): boolean => {
  const a = document.activeElement;
  return !!a && a instanceof HTMLInputElement && a.dataset.ng === '1';
};

export class SubmitPanel {
  private inputs: HTMLInputElement[] = [];
  private objs: Phaser.GameObjects.GameObject[] = [];
  private status!: UIText;
  private note: UIText | null = null;
  private busy = false;
  private done = false;
  /** Game-px rects of the clickable UI (the game must not treat presses there as "restart"). */
  rects: [number, number, number, number][] = [];
  private onResize = () => this.place();

  constructor(private scene: Phaser.Scene, private depth: number) {}

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
    document.body.appendChild(el);
    this.inputs.push(el);
    return el;
  }

  private run!: RunResult;
  private wantsMessage = false;

  /**
   * Where everything goes (game px). The classic 480x270 screen: under the death panel, fields side by side. The
   * narrow phone-portrait screen: full-width fields stacked under the death panel.
   */
  private geo(): { x: number; w: number; y0: number; fields: [number, number, number][]; btnY: number; btnX: [number, number]; h: number } {
    const W = this.scene.scale.width;
    const H = this.scale();
    if (H <= W) return { x: 96, w: 300, y0: 186, fields: [[96, 196, 140], [242, 196, 142]], btnY: 226, btnX: [150, 270], h: 58 };
    const y0 = Math.round(H / 2 + 56);
    const fw = W - 16;
    const msg = this.wantsMessage ? 18 : 0;
    return { x: 8, w: W - 8, y0, fields: [[8, y0 + 12, fw], [8, y0 + 30, fw]], btnY: y0 + 34 + msg, btnX: [Math.round(W * 0.2), Math.round(W * 0.62)], h: 78 + msg };
  }
  private scale(): number {
    return this.scene.scale.height;
  }

  private rank = 0;

  /** The screen changed (rotation, keyboard, browser bars): rebuild at the new size, keeping what was typed. */
  relayout(): void {
    if (!this.objs.length || !this.run) return;
    const vals = this.inputs.map((el) => el.value);
    const status = this.status?.text ?? '';
    const note = this.note?.text ?? '';
    const done = this.done;
    window.removeEventListener('resize', this.onResize);
    for (const el of this.inputs) el.remove();
    for (const o of this.objs) o.destroy();
    this.inputs = [];
    this.objs = [];
    this.rects = [];
    this.build(this.run, this.rank);
    this.inputs.forEach((el, i) => {
      el.value = vals[i] ?? el.value;
      el.disabled = done;
    });
    if (status) setTextValue(this.status, status);
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
    this.objs.push(s.add.rectangle(s.scale.width / 2, y0 - 6 + G.h / 2, G.w, G.h, 0x0b0d12, 0.92).setStrokeStyle(1, 0x3a4558).setDepth(this.depth - 1));
    // rank 1 is a new high score of the day and the only one that may leave a message (shown on the title and board)
    this.objs.push(label(G.x, y0, rank === 1 ? 'NEW HIGH SCORE! YOUR MESSAGE:' : `TODAY'S TOP 10: RANK ${rank}`, C.gold));
    this.field('NAME', 16, save().boardName);
    if (this.wantsMessage) this.field('MESSAGE (OPTIONAL)', 40, '');
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
    this.status = label(G.x, G.btnY + 14, '');
    this.note = label(G.x, G.btnY + 24, '', C.gold);
    if (this.scale() > s.scale.width) for (const t of [this.status, this.note]) t.setMaxWidth(G.w - 8); // narrow portrait screen
    this.objs.push(this.status, this.note);
    this.place();
    window.addEventListener('resize', this.onResize);
    this.validate();
  }

  /** Position the DOM fields over the canvas (game px -> page px). */
  private place(): void {
    const c = this.scene.game.canvas.getBoundingClientRect();
    const k = c.width / this.scene.scale.width;
    // name and the optional rank-1 message (game px; the DOM fields sit above the canvas)
    const boxes = this.geo().fields;
    this.inputs.forEach((el, i) => {
      const [gx, gy, gw] = boxes[i] ?? boxes[0]!;
      el.style.left = `${c.left + gx * k}px`;
      el.style.top = `${c.top + gy * k}px`;
      el.style.width = `${gw * k}px`;
      el.style.height = `${14 * k}px`;
      el.style.fontSize = `${Math.max(8, Math.round(8 * k))}px`;
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
      for (const el of this.inputs) el.disabled = true;
    } else setTextColor(setTextValue(this.status, reasonText(res.reason)), C.ember);
  }

  /** The status line as shown (smoke-build snapshot for the e2e checks). */
  statusText(): string {
    return this.status?.text ?? '';
  }

  close(): void {
    window.removeEventListener('resize', this.onResize);
    for (const el of this.inputs) el.remove();
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
