/**
 * Menu pages shared by the title screen and the pause overlay. Pages only read and write the save data (storage.ts);
 * they never touch sim state.
 */
import Phaser from 'phaser';
import { addText, snap } from './text';
import { TITLE } from '../config';
import { utcDateKey } from '../daily';
import { clampSensitivity, persist, save, todaysBest, type BestEntry, type Difficulty } from '../storage';
import { audio } from './audio';
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

export const DIFF_LABEL = (d: Difficulty): string => (d === 'hard' ? `DAILY ${utcDateKey(new Date())}` : d.toUpperCase());

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
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
    items.push(
      {
        label: () => `DRAG SENSITIVITY ${s().dragSensitivity.toFixed(2)}`,
        onLeft: () => ((s().dragSensitivity = clampSensitivity(Math.max(0.5, s().dragSensitivity - 0.25))), changed()),
        onRight: () => ((s().dragSensitivity = clampSensitivity(Math.min(3, s().dragSensitivity + 0.25))), changed()),
      },
      toggle('LEFT-HANDED BUTTONS', 'leftHanded'),
      toggle('SECOND-FINGER PARRY', 'secondFingerParry'),
      toggle('HAPTICS', 'haptics'),
      { label: () => 'SHOW TOUCH CONTROLS AGAIN', onActivate: () => ((s().touchHintSeen = false), persist(), ctx.onShowTouchHint?.()) },
    );
  }
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
    items: [{ label: () => DIFF_LABEL(d).replace(/^DAILY .*/, 'HARD (DAILY)'), onLeft: () => go(-1), onRight: () => go(1) }],
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

export function creditsPage(back: () => void): MenuPage {
  return {
    title: 'CREDITS',
    items: [],
    top: 56,
    onBack: back,
    lines: () => [
      TITLE.toUpperCase(),
      '',
      'ART AND CODE GENERATED FOR THIS PROJECT',
      '',
      'FONT: PRESS START 2P BY CODEMAN38',
      'SIL OPEN FONT LICENSE 1.1 (OFL)',
      '',
      'AUDIO: CREDITS COMING SOON',
      '',
      'ENGINE: PHASER 3',
    ],
  };
}

const HERO_LINES = { knight: 'KNIGHT  SHIELD FLASH, CLOAK DASH', wisp: 'WISP  FLARE PULSE, FLAME STREAK' };

export function heroPage(back: () => void, onPick: () => void): MenuPage {
  return {
    title: 'HERO',
    top: 150,
    gap: 16,
    onBack: back,
    items: (['knight', 'wisp'] as const).map((h) => ({
      label: () => `${save().hero === h ? '* ' : ''}${HERO_LINES[h]}`,
      onActivate: () => {
        save().hero = h;
        persist();
        onPick();
      },
    })),
    lines: () => ['', 'COSMETIC ONLY: BOTH HEROES HAVE IDENTICAL STATS'],
    decorate: (scene: Phaser.Scene) => {
      const out: Phaser.GameObjects.GameObject[] = [];
      (['knight', 'wisp'] as const).forEach((h, i) => {
        const x = 190 + i * 100;
        const sp = scene.add.sprite(x, 100, ATLAS, frame(`${h}_idle`)).setScale(3).setDepth(1001);
        if (scene.anims.exists(`${h}_idle`)) sp.play(`${h}_idle`);
        out.push(sp, snap(addText(scene, x, 128, h.toUpperCase(), { color: save().hero === h ? C.gold : C.dim }).setOrigin(0.5).setDepth(1001)));
      });
      return out;
    },
  };
}
