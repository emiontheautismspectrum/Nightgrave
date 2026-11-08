/**
 * The English UI text, frozen: every string the pure UI builders produce (menu pages in every state, the hint cards and
 * control lines, server reason texts, best-score rows, hero lines). Recorded BEFORE the localisation layer; with the
 * language set to English the output must stay byte-for-byte identical (tests/__snapshots__/en_output.test.ts.snap).
 */
import { describe, expect, it, vi } from 'vitest';

// the builders are pure; Phaser itself needs a browser
vi.mock('phaser', () => ({ default: {} }));
import { bestPage, controlsPage, creditsPage, DIFF_LABEL, heroPage, settingsPage, type MenuCtx } from '../src/render/menus';
import { cardLines, controlsLine, hintText, type Device } from '../src/render/hints';
import { reasonText } from '../src/net/api';
import { BEST_HEADER, fmtEntry } from '../src/render/bestFormat';
import { HERO_IDS, HEROES } from '../src/data/heroes';
import { save } from '../src/storage';
import type { MenuPage } from '../src/render/ui';

const labels = (p: MenuPage) => ({ title: p.title, items: p.items.map((i) => i.label()), lines: p.lines?.() ?? [], foot: p.foot?.() ?? [] });
const ctx = (touch: boolean): MenuCtx => ({ menu: { show: () => undefined } as unknown as MenuCtx['menu'], isTouch: () => touch });

describe('English UI output (frozen)', () => {
  it('menus, hints, reasons, rows', () => {
    const s = save().settings;
    const out: Record<string, unknown> = {};
    for (const touch of [false, true])
      for (const mode of ['stick', 'drag'] as const) {
        s.touchControls = mode;
        out[`settings_${touch}_${mode}`] = labels(settingsPage(ctx(touch), () => undefined));
      }
    s.touchControls = 'stick';
    out.controls = labels(controlsPage(() => undefined));
    out.credits = labels(creditsPage(() => undefined));
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const p = labels(bestPage(() => undefined, () => undefined, d));
      // today's date moves: keep the line's shape only
      p.lines = p.lines.map((l) => l.replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD'));
      out[`best_${d}`] = p;
    }
    out.hero = labels(heroPage(() => undefined, () => undefined));
    out.diff = (['easy', 'medium', 'hard'] as const).map(DIFF_LABEL);
    const devices: Device[] = ['desktop', 'touch', 'gamepad'];
    out.controlsLine = devices.flatMap((d) => [controlsLine(d, true), controlsLine(d, false)]);
    out.cards = devices.flatMap((d) => [false, true].flatMap((lh) => [true, false].map((st) => cardLines(d, lh, st))));
    out.hintText = { parry: hintText('parry'), dash: hintText('dash') };
    out.reasons = ['outdated', 'rate', 'date', 'name', 'message', 'words', 'too_high', 'paused', 'busy', 'not_best', 'other', undefined].map((r) => reasonText(r));
    out.best = [BEST_HEADER(), fmtEntry(0, undefined), fmtEntry(1, { score: 1234, hero: 'knight', date: '2026-11-08', secs: 61.4 } as never)];
    out.heroes = HERO_IDS.map((h) => [HEROES[h].name, ...HEROES[h].lines]);
    expect(out).toMatchSnapshot();
  });
});

describe('English board table header (frozen)', () => {
  it('is the previous header byte for byte', async () => {
    const { boardHeader, boardRow } = await import('../src/render/boardTable');
    expect(boardHeader()).toBe('#  NAME              SCORE  HERO    TIME');
    expect(boardRow('1', 'Bob', '1234', 'KNIGHT', '61S')).toBe(` 1 ${'Bob'.padEnd(16)} ${'1234'.padStart(7)}  KNIGHT   61S`);
  });
});
