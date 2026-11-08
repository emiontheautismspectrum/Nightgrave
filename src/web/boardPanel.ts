/**
 * The desktop board panel (HTML next to the canvas) and the phone board overlay: today's Hard best. All text is set
 * with textContent (never innerHTML); styles live in src/style.css (CSP). Refreshes every 60 s while no run is played;
 * at 00:00 UTC it switches to the new day by itself (empty top 10, "Yesterday's champion" until a verified run).
 */
import { fetchBoard, fetchMe, getServerDate, hasServerClock, online, serverNowMs, type Board, type MyStanding } from '../net/api';
import { addDays, utcDateKey } from '../shared/daily';
import { save } from '../storage';
import { isInRun } from './runFlag';
import { onLangChange, t, type Key } from '../i18n';
import { fmtDate, fmtInt } from '../i18n/format';

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
  private title: HTMLElement;
  /** What is shown, kept so a language switch re-renders it without a new fetch. */
  private last: { b: Board | null; yesterday: Board | null; me: MyStanding | null; status: Key } = { b: null, yesterday: null, me: null, status: 'panel.note' };

  constructor(cls: string) {
    this.root = el('aside', cls);
    const head = el('div', 'bp-head');
    head.append((this.title = el('div', 'bp-title')), (this.date = el('div', 'bp-dim')), (this.countdown = el('div', 'bp-dim')));
    const champ = el('div', 'bp-champ');
    this.champTitle = el('div', 'bp-dim');
    this.champScore = el('div', 'bp-score');
    this.champName = el('div', 'bp-name');
    this.champMsg = el('div', 'bp-msg');
    champ.append(this.champTitle, this.champScore, this.champName, el('div', 'bp-sep'), this.champMsg);
    this.rows = el('ol', 'bp-rows');
    this.you = el('div', 'bp-you');
    this.status = el('div', 'bp-note');
    this.root.append(head, champ, this.rows, this.you, this.status);
    this.skeleton();
    this.labels();
    this.fill(null, null, null);
    // the panel lives as long as the page: a language switch re-renders what it shows (no fetch)
    onLangChange(() => {
      this.labels();
      this.fill(this.last.b, this.last.yesterday, this.last.me);
      this.countdown.textContent = t('panel.resets', { time: untilReset(this.now()) });
      if (this.shownDate) this.date.textContent = t('panel.date', { date: fmtDate(this.shownDate) });
    });
  }

  /** The fixed texts in the current language. */
  private labels(): void {
    this.root.setAttribute('aria-label', t('panel.aria'));
    this.title.textContent = t('panel.title');
    this.status.textContent = t(this.last.status);
  }

  private setStatus(k: Key): void {
    this.last.status = k;
    this.status.textContent = t(k);
  }

  /** Start the 1 s countdown and the 60 s refresh (idempotent). */
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  /** Stop the countdown and the refresh (a hidden panel or a closed overlay never polls). */
  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private now(): number {
    return hasServerClock() ? serverNowMs() : Date.now(); // offline: the local UTC clock
  }

  private tick(): void {
    this.countdown.textContent = t('panel.resets', { time: untilReset(this.now()) });
    const today = getServerDate() ?? utcDateKey(new Date());
    // a new UTC day on an open page: switch by itself; otherwise refresh every 60 s, never during a run
    // the day switch retries at most every 15 s (a failing API is not hammered once per second after midnight)
    const since = Date.now() - this.lastFetch;
    if ((today !== this.shownDate && this.shownDate !== '' && since > 15_000) || since > 60_000) {
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
    this.countdown.textContent = t('panel.resets', { time: untilReset(this.now()) });
    if (!online()) {
      this.shownDate = utcDateKey(new Date());
      this.date.textContent = t('panel.date', { date: fmtDate(this.shownDate) });
      this.fill(null, null, null);
      this.setStatus('panel.offline');
      return;
    }
    const b = await fetchBoard();
    if (!b) {
      this.fill(null, null, null);
      this.setStatus('panel.unavailable');
      return;
    }
    this.shownDate = b.date;
    this.date.textContent = t('panel.date', { date: fmtDate(b.date) });
    let yesterday: Board | null = null;
    if (!b.champion) yesterday = await fetchBoard(addDays(b.date, -1));
    const me = await fetchMe(b.date, save().playerId);
    this.fill(b, yesterday, me);
    this.setStatus('panel.note');
  }

  private fill(b: Board | null, yesterday: Board | null, me: MyStanding | null): void {
    this.last = { ...this.last, b, yesterday, me };
    const c = b?.champion ?? yesterday?.champion ?? null;
    const top = b?.top ?? [];
    this.champTitle.textContent = t(!b?.champion && yesterday?.champion ? 'panel.yesterday' : 'panel.champion');
    if (c) {
      const first = (b?.champion ? top : (yesterday?.top ?? []))[0];
      this.champScore.textContent = first ? fmtInt(first.score) : '';
      this.champName.textContent = `${c.name}${first ? ` - ${t(`hero.${first.hero}.name`)}` : ''}`;
      this.champMsg.textContent = c.message ? `"${c.message}"` : t('panel.noMessage');
      this.champMsg.classList.toggle('bp-empty', !c.message);
    } else {
      this.champScore.textContent = '';
      this.champName.textContent = b ? t('panel.noChampion') : '';
      this.champMsg.textContent = t('panel.noMessage');
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
        if (e.view === 'zoomed') n.append(el('span', 'bp-icon bp-phone'));
      }
      li.append(n, el('span', 'bp-s', e ? fmtInt(e.score) : ''));
      this.rows.append(li);
    }
    this.you.textContent = me
      ? `${t('panel.you', { score: me.verifiedScore === null ? '-' : fmtInt(me.verifiedScore) })}${me.verifiedRank ? t('panel.rank', { rank: me.verifiedRank }) : ''}${me.pending ? t('panel.pending') : ''}`
      : t('panel.you', { score: '-' });
  }
}
