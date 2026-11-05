/**
 * The desktop board panel (HTML next to the canvas) and the phone board overlay: today's Hard best. All text is set
 * with textContent (never innerHTML); styles live in src/style.css (CSP). Refreshes every 60 s while no run is played;
 * at 00:00 UTC it switches to the new day by itself (empty top 10, "Yesterday's champion" until a verified run).
 */
import { fetchBoard, fetchMe, getServerDate, hasServerClock, online, serverNowMs, type Board, type MyStanding } from '../net/api';
import { addDays, utcDateKey } from '../shared/daily';
import { save } from '../storage';
import { isInRun } from './runFlag';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** hh:mm:ss until the next 00:00 UTC of the given clock. */
export function untilReset(nowMs: number): string {
  const next = Math.floor(nowMs / 86_400_000 + 1) * 86_400_000;
  const s = Math.max(0, Math.floor((next - nowMs) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export class BoardPanel {
  readonly root: HTMLElement;
  private date: HTMLElement;
  private countdown: HTMLElement;
  private champTitle: HTMLElement;
  private champScore: HTMLElement;
  private champName: HTMLElement;
  private champMsg: HTMLElement;
  private rows: HTMLOListElement;
  private you: HTMLElement;
  private status: HTMLElement;
  private shownDate = '';
  private timer = 0;
  private lastFetch = 0;

  constructor(cls: string) {
    this.root = el('aside', cls);
    this.root.setAttribute('aria-label', "Today's Hard best");
    const head = el('div', 'bp-head');
    head.append(el('div', 'bp-title', "TODAY'S HARD BEST"), (this.date = el('div', 'bp-dim')), (this.countdown = el('div', 'bp-dim')));
    const champ = el('div', 'bp-champ');
    this.champTitle = el('div', 'bp-dim', 'CHAMPION OF THE NIGHT');
    this.champScore = el('div', 'bp-score');
    this.champName = el('div', 'bp-name');
    this.champMsg = el('div', 'bp-msg');
    champ.append(this.champTitle, this.champScore, this.champName, el('div', 'bp-sep'), this.champMsg);
    this.rows = el('ol', 'bp-rows');
    this.you = el('div', 'bp-you');
    this.status = el('div', 'bp-note', 'ONLY HARD - REPLAY-VERIFIED - NEW RUNS APPEAR IN ~20 MIN');
    this.root.append(head, champ, this.rows, this.you, this.status);
    this.skeleton();
  }

  /** Start the 1 s countdown and the 60 s refresh (idempotent). */
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  private now(): number {
    return hasServerClock() ? serverNowMs() : Date.now(); // offline: the local UTC clock
  }

  private tick(): void {
    this.countdown.textContent = `RESETS IN ${untilReset(this.now())}`;
    const today = getServerDate() ?? utcDateKey(new Date());
    // a new UTC day on an open page: switch by itself; otherwise refresh every 60 s, never during a run
    if ((today !== this.shownDate && this.shownDate !== '') || Date.now() - this.lastFetch > 60_000) {
      if (!isInRun()) void this.refresh();
    }
  }

  private skeleton(): void {
    this.rows.replaceChildren();
    for (let r = 2; r <= 10; r++) {
      const li = el('li', 'bp-row bp-skel');
      li.append(el('span', 'bp-rank', String(r)), el('span', 'bp-n', '...'), el('span', 'bp-s', ''));
      this.rows.append(li);
    }
  }

  async refresh(): Promise<void> {
    this.lastFetch = Date.now();
    this.countdown.textContent = `RESETS IN ${untilReset(this.now())}`;
    if (!online()) {
      this.shownDate = utcDateKey(new Date());
      this.date.textContent = `${this.shownDate} UTC`;
      this.fill(null, null, null);
      this.status.textContent = 'BOARD OFFLINE';
      return;
    }
    const b = await fetchBoard();
    if (!b) {
      this.fill(null, null, null);
      this.status.textContent = 'BOARD UNAVAILABLE';
      return;
    }
    this.shownDate = b.date;
    this.date.textContent = `${b.date} UTC`;
    let yesterday: Board | null = null;
    if (!b.champion) yesterday = await fetchBoard(addDays(b.date, -1));
    const me = await fetchMe(b.date, save().playerId);
    this.fill(b, yesterday, me);
    this.status.textContent = 'ONLY HARD - REPLAY-VERIFIED - NEW RUNS APPEAR IN ~20 MIN';
  }

  private fill(b: Board | null, yesterday: Board | null, me: MyStanding | null): void {
    const c = b?.champion ?? yesterday?.champion ?? null;
    const top = b?.top ?? [];
    this.champTitle.textContent = b?.champion ? 'CHAMPION OF THE NIGHT' : yesterday?.champion ? "YESTERDAY'S CHAMPION" : 'CHAMPION OF THE NIGHT';
    if (c) {
      const first = (b?.champion ? top : (yesterday?.top ?? []))[0];
      this.champScore.textContent = first ? String(first.score) : '';
      this.champName.textContent = `${c.name}${first ? ` - ${first.hero.toUpperCase()}` : ''}`;
      this.champMsg.textContent = c.message ? `"${c.message}"` : 'NO MESSAGE';
      this.champMsg.classList.toggle('bp-empty', !c.message);
    } else {
      this.champScore.textContent = '';
      this.champName.textContent = b ? 'NO CHAMPION YET. BE THE FIRST!' : '';
      this.champMsg.textContent = 'NO MESSAGE';
      this.champMsg.classList.add('bp-empty');
    }
    this.rows.replaceChildren();
    for (let r = 2; r <= 10; r++) {
      const e = top[r - 1];
      const li = el('li', 'bp-row');
      li.append(el('span', 'bp-rank', String(r)));
      const n = el('span', 'bp-n', e ? e.name : '-');
      if (e) {
        const icon = el('span', `bp-icon bp-${e.hero}`);
        icon.title = e.hero;
        n.append(icon);
        if ((e as { view?: string }).view === 'zoomed') n.append(el('span', 'bp-icon bp-phone'));
      }
      li.append(n, el('span', 'bp-s', e ? String(e.score) : ''));
      this.rows.append(li);
    }
    this.you.textContent = me
      ? `YOU - BEST TODAY  ${me.verifiedScore ?? '-'}${me.verifiedRank ? ` (#${me.verifiedRank})` : ''}${me.pending ? ' (PENDING)' : ''}`
      : 'YOU - BEST TODAY  -';
  }
}
