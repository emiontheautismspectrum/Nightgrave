/**
 * Hard death panel: submit the run to today's board. Shown only when the score would enter the top 10 (fresh GET).
 * Real <input> fields (so touch devices open the native keyboard), positioned over the canvas, NOT auto-focused.
 * Enter submits, Esc leaves the field; while a field is focused, keys only type. Everything else (Space, a click or
 * tap outside the fields) still restarts instantly. Text is set with .value / Phaser text only (never innerHTML).
 */
import Phaser from 'phaser';
import { reasonText, submitRun, wouldRank, fetchBoard } from '../net/api';
import { encodeInputLog } from '../shared/replayCodec';
import { validateMessage, validateName, type TextError } from '../shared/text';
import { CLIENT_VERSION, tuningFingerprint } from '../shared/version';
import { persist, save } from '../storage';
import type { InputFrame } from '../sim/input';
import { C, FONT, onTap } from './ui';

export interface RunResult {
  date: string;
  seed: number;
  score: number;
  hero: 'knight' | 'wisp';
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
  private status!: Phaser.GameObjects.Text;
  private note: Phaser.GameObjects.Text | null = null;
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

  private build(run: RunResult, rank: number): void {
    this.run = run;
    this.wantsMessage = rank === 1;
    const s = this.scene;
    const y0 = 186;
    const label = (x: number, y: number, t: string, col: string = C.dim) =>
      s.add.text(x, y, t, { fontFamily: FONT, fontSize: '8px', color: col }).setDepth(this.depth);
    this.objs.push(s.add.rectangle(240, y0 + 26, 300, 58, 0x0b0d12, 0.92).setStrokeStyle(1, 0x3a4558).setDepth(this.depth - 1));
    this.objs.push(label(96, y0, rank === 1 ? 'TODAY\'S BEST! RANK 1' : `TODAY'S TOP 10: RANK ${rank}`, C.gold));
    this.field('NAME', 16, save().boardName);
    if (this.wantsMessage) this.field('MESSAGE (OPTIONAL)', 40, '');
    const btn = (x: number, t: string, fn: () => void) => {
      const o = s.add.text(x, y0 + 40, t, { fontFamily: FONT, fontSize: '8px', color: C.bone }).setPadding(4, 3, 4, 3).setDepth(this.depth);
      o.setInteractive({ useHandCursor: true });
      onTap(o, fn);
      this.rects.push([o.x - 4, o.y - 4, o.x + o.width + 4, o.y + o.height + 4]);
      this.objs.push(o);
    };
    btn(150, 'SUBMIT', () => void this.submit());
    btn(270, 'SKIP', () => this.close());
    this.status = label(96, y0 + 54, '');
    this.note = label(96, y0 + 64, '', C.gold);
    this.objs.push(this.status, this.note);
    this.place();
    window.addEventListener('resize', this.onResize);
    this.validate();
  }

  /** Position the DOM fields over the canvas (game px -> page px). */
  private place(): void {
    const c = this.scene.game.canvas.getBoundingClientRect();
    const k = c.width / this.scene.scale.width;
    // name on the left, the optional rank-1 message on the right (game px; the DOM fields sit above the canvas)
    const boxes: [number, number][] = [[96, 140], [242, 142]];
    this.inputs.forEach((el, i) => {
      const [gx, gw] = boxes[i] ?? [96, 140];
      el.style.left = `${c.left + gx * k}px`;
      el.style.top = `${c.top + 196 * k}px`;
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
    if (!this.busy && !this.done) this.status?.setText(msg).setColor(C.ember);
    return ok;
  }

  private async submit(): Promise<void> {
    if (this.busy || this.done || !this.validate()) return;
    this.busy = true;
    this.status.setText('SENDING...').setColor(C.dim);
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
      name: name.ok ? name.value : '',
      ...(this.wantsMessage && msgRaw ? { message: msgRaw } : {}),
      playerId: save().playerId,
      tuningFingerprint: tuningFingerprint(),
      clientVersion: CLIENT_VERSION,
      replay: encodeInputLog(r.log),
    });
    this.busy = false;
    if (!this.objs.length) return; // closed meanwhile
    if (!res) this.status.setText('BOARD UNAVAILABLE').setColor(C.ember);
    else if (res.accepted) {
      this.done = true;
      // shown on the board only after the replay is re-simulated by the verifier
      this.status.setText(res.provisionalRank ? `SUBMITTED (RANK ${res.provisionalRank}). ON THE BOARD AFTER` : 'SUBMITTED. ON THE BOARD AFTER').setColor(C.gold);
      this.note?.setText('VERIFICATION (USUALLY WITHIN 20 MINUTES)');
      for (const el of this.inputs) el.disabled = true;
    } else this.status.setText(reasonText(res.reason)).setColor(C.ember);
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
