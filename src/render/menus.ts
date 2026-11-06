/**
 * Menu pages shared by the title screen and the pause overlay. Pages only read and write the save data (storage.ts);
 * they never touch sim state.
 */
import Phaser from 'phaser';
import { addText, snap } from './text';
import { COPYRIGHT_YEAR, legalLinks, owner } from '../legal';
import { utcDateKey } from '../daily';
import { clampSensitivity, persist, save, todaysBest, type BestEntry, type Difficulty } from '../storage';
import { audio } from './audio';
import { HERO_IDS, HEROES, type HeroId } from '../data/heroes';
import { ATLAS, frame } from './assets';
import { BEST_HEADER, fmtBestRow, fmtEntry } from './bestFormat';
import { C, FONT, type MenuPage, type MenuView } from './ui';

export interface MenuCtx {
  menu: MenuView;
  isTouch: () => boolean;
  /** Called after any setting changed (apply volumes, effects, touch layout). */
  onSettings?: () => void;
  /** Re-show the touch controls overlay (title: next run; pause: right away). */
  onShowTouchHint?: () => void;
}

/** Difficulties are always named EASY / MEDIUM / HARD (internal ids unchanged). */
export const DIFF_LABEL = (d: Difficulty): string => d.toUpperCase();

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const SMOOTH = ['off', 'low', 'high'] as const;
const step10 = (v: number, d: number): number => Math.max(0, Math.min(100, v + d * 10));

export function settingsPage(ctx: MenuCtx, back: () => void): MenuPage {
  const s = () => save().settings;
  const changed = () => {
    persist();
    audio.applyVolumes();
    ctx.onSettings?.();
  };
  const vol = (name: string, key: 'master' | 'music' | 'sfx') => ({
    label: () => `${name} ${String(s()[key]).padStart(3)}`,
    onLeft: () => ((s()[key] = step10(s()[key], -1)), changed()),
    onRight: () => ((s()[key] = step10(s()[key], 1)), changed()),
  });
  const toggle = (name: string, key: 'shake' | 'reducedFlashes' | 'leftHanded' | 'secondFingerParry' | 'haptics') => ({
    label: () => `${name} ${onOff(s()[key])}`,
    onLeft: () => ((s()[key] = !s()[key]), changed()),
    onRight: () => ((s()[key] = !s()[key]), changed()),
  });
  const fsAvailable = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled;
  const items: MenuPage['items'] = [
    vol('MASTER', 'master'),
    vol('MUSIC ', 'music'),
    vol('SFX   ', 'sfx'),
    toggle('SCREEN SHAKE', 'shake'),
    toggle('REDUCED FLASHES', 'reducedFlashes'),
    {
      label: () => `EFFECTS ${s().effects === 'high' ? 'HIGH' : 'LOW'}`,
      onLeft: () => ((s().effects = s().effects === 'high' ? 'low' : 'high'), changed()),
      onRight: () => ((s().effects = s().effects === 'high' ? 'low' : 'high'), changed()),
    },
  ];
  if (fsAvailable)
    items.push({
      // fullscreen may only be requested from a user input: this runs inside the click/key handler
      label: () => `FULLSCREEN ${onOff(!!document.fullscreenElement)}`,
      onActivate: () => {
        try {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void document.documentElement.requestFullscreen().catch(() => undefined);
        } catch {
          /* not allowed here */
        }
      },
    });
  const controlsAt = items.length;
  items.push({ label: () => 'CONTROLS', onActivate: () => ctx.menu.show(controlsPage(() => ctx.menu.show(settingsPage(ctx, back), controlsAt))) });
  if (ctx.isTouch()) {
    // the movement mode; in Stick mode the drag-only rows (sensitivity, smoothing, second-finger parry) are hidden
    const at = items.length;
    const flip = () => {
      s().touchControls = s().touchControls === 'stick' ? 'drag' : 'stick';
      changed();
      ctx.menu.show(settingsPage(ctx, back), at); // the rows below change: lay the page out again
    };
    items.push({ label: () => `TOUCH CONTROLS ${s().touchControls === 'stick' ? 'STICK' : 'DRAG'}`, onLeft: flip, onRight: flip });
    const drag = s().touchControls === 'drag';
    if (drag) items.push(
      {
        label: () => `DRAG SENSITIVITY ${s().dragSensitivity.toFixed(2)}`,
        onLeft: () => ((s().dragSensitivity = clampSensitivity(Math.max(0.5, s().dragSensitivity - 0.25))), changed()),
        onRight: () => ((s().dragSensitivity = clampSensitivity(Math.min(3, s().dragSensitivity + 0.25))), changed()),
      },
      {
        label: () => `TOUCH SMOOTHING ${s().touchSmoothing.toUpperCase()}`,
        onLeft: () => ((s().touchSmoothing = SMOOTH[(SMOOTH.indexOf(s().touchSmoothing) + 2) % 3]!), changed()),
        onRight: () => ((s().touchSmoothing = SMOOTH[(SMOOTH.indexOf(s().touchSmoothing) + 1) % 3]!), changed()),
      },
    );
    items.push(toggle('LEFT-HANDED CONTROLS', 'leftHanded'));
    if (drag) items.push(toggle('SECOND-FINGER PARRY', 'secondFingerParry'));
    items.push(toggle('HAPTICS', 'haptics'));
  }
  items.push({ label: () => 'SHOW TIPS AGAIN', onActivate: () => ((s().touchHintSeen = false), (s().hintsDone = false), (s().hintParrySeen = false), (s().hintDashSeen = false), persist(), ctx.onShowTouchHint?.()) });
  return { title: 'SETTINGS', items, onBack: back, top: 52, gap: 13 };
}

export function controlsPage(back: () => void): MenuPage {
  return {
    title: 'CONTROLS',
    items: [],
    top: 50,
    onBack: back,
    lines: () => [
      'MOUSE: HERO FOLLOWS THE CURSOR',
      'LEFT CLICK = PARRY   RIGHT CLICK = DASH',
      '',
      'KEYBOARD: WASD / ARROWS MOVE',
      'J OR Z = PARRY   K OR SHIFT OR SPACE = DASH',
      'ESC OR P = PAUSE',
      '',
      'GAMEPAD: LEFT STICK MOVES',
      'A = PARRY   B OR RT = DASH   START = PAUSE',
      '',
      'TOUCH: DRAG ANYWHERE TO MOVE',
      'PARRY BUTTON BOTTOM RIGHT, DASH ABOVE IT',
      'SECOND FINGER TAP = PARRY',
    ],
  };
}

export function bestPage(back: () => void, show: (p: MenuPage) => void, d: Difficulty = save().difficulty): MenuPage {
  const order: Difficulty[] = ['easy', 'medium', 'hard'];
  const go = (k: number) => show(bestPage(back, show, order[(order.indexOf(d) + k + 3) % 3]!));
  return {
    title: 'BEST SCORES',
    top: 52,
    onBack: back,
    items: [{ label: () => DIFF_LABEL(d), onLeft: () => go(-1), onRight: () => go(1) }],
    lines: () => {
      const list = save().best[d];
      const out = ['', BEST_HEADER];
      for (let i = 0; i < 5; i++) out.push(fmtEntry(i, list[i]));
      if (d === 'hard') {
        const today = utcDateKey(new Date());
        const t = todaysBest(save(), today);
        out.push('', `TODAY'S BEST (${today} UTC)`.padEnd(BEST_HEADER.length), t ? fmtBestRow('1', String(t.score), t.hero.toUpperCase(), today, `${t.secs.toFixed(0)}S`) : fmtBestRow('', '-', '', '', ''));
      }
      return out;
    },
  };
}

/** Open one of the static pages / links in a new tab (from a tap or key press: a user gesture). */
function openLink(href: string): void {
  try {
    if (href.startsWith('mailto:')) location.href = href; // a mail link in a new tab leaves an empty tab behind
    else window.open(new URL(href, location.href).toString(), '_blank', 'noopener,noreferrer');
  } catch {
    /* blocked pop-up: nothing else to do */
  }
}

/**
 * Credits, plus the footer links as menu items: phones hide the page footer, so Privacy, Rules, Credits, License,
 * Source and Contact are reachable here.
 */
export function creditsPage(back: () => void): MenuPage {
  return {
    title: 'CREDITS',
    top: 50,
    gap: 12,
    onBack: back,
    items: legalLinks().map((l) => ({ label: () => (l.label === 'Credits' ? 'FULL CREDITS' : l.label.toUpperCase()), onActivate: () => openLink(l.href) })),
    lines: () => [
      '',
      'ART AND CODE GENERATED FOR THIS PROJECT',
      'FONT: PRESS START 2P BY CODEMAN38 (OFL 1.1)',
      'AUDIO: CREDITS COMING SOON - ENGINE: PHASER 3',
      '',
      `(C) ${COPYRIGHT_YEAR} ${owner().toUpperCase()}`,
      'CODE: MIT - ART AND AUDIO: ALL RIGHTS RESERVED',
    ],
  };
}

const HERO_LINES = (h: HeroId): readonly string[] => HEROES[h].lines;
/** Desktop: heroes side by side, evenly spread over the 480 px screen. */
const heroX = (h: HeroId): number => Math.round((480 * (HERO_IDS.indexOf(h) + 1)) / (HERO_IDS.length + 1));

/** Each hero: sprite, name (the focusable item: "> <" + highlight when focused), two stat lines (HeroDef), a SELECTED tag. */
export function heroPage(back: () => void, onPick: () => void): MenuPage {
  return {
    title: 'HERO',
    onBack: back,
    items: HERO_IDS.map((h) => ({
      label: () => HEROES[h].name,
      x: heroX(h),
      y: 132,
      onActivate: () => {
        save().hero = h;
        persist();
        onPick();
      },
    })),
    lines: () => ['THE SHIELD FACES WHERE YOU MOVE'],
    linesTop: 186,
    gap: 60, // phones: room for SELECTED above the name and the two stat lines under it in one row
    decorate: (scene: Phaser.Scene, rowY: (i: number) => number, touch: boolean) => {
      const out: Phaser.GameObjects.GameObject[] = [];
      if (touch) {
        // phones: one row per hero: the sprite on the left, the name (the row), its two stat lines under it, SELECTED right
        const W = scene.scale.width;
        HERO_IDS.forEach((h, i) => {
          const y = rowY(i);
          // the sprite (y-22..y+10) sits above the ability line (y+11..y+19): the line can stay centred on any width
          const sp = scene.add.sprite(40, Math.round(y - 6), ATLAS, frame(`${h}_idle`)).setScale(2); // clear of the frame
          if (scene.anims.exists(`${h}_idle`)) sp.play(`${h}_idle`);
          out.push(sp);
          HERO_LINES(h).forEach((l, k) => out.push(snap(addText(scene, W / 2, Math.round(y + 12 + k * 9), l, { color: C.dim }).setOrigin(0.5))));
          if (save().hero === h) out.push(snap(addText(scene, W - 20 - 32, Math.round(y - 14), 'SELECTED', { color: C.gold }).setOrigin(0.5))); // top-right of the row, inside the frame
        });
        return out;
      }
      HERO_IDS.forEach((h) => {
        const x = heroX(h);
        const sp = scene.add.sprite(x, 98, ATLAS, frame(`${h}_idle`)).setScale(3).setDepth(1001);
        if (scene.anims.exists(`${h}_idle`)) sp.play(`${h}_idle`);
        out.push(sp);
        HERO_LINES(h).forEach((l, k) => out.push(snap(addText(scene, x, 146 + k * 10, l, { color: C.dim }).setOrigin(0.5).setDepth(1001))));
        if (save().hero === h) out.push(snap(addText(scene, x, 170, 'SELECTED', { color: C.gold }).setOrigin(0.5).setDepth(1001)));
      });
      return out;
    },
  };
}
