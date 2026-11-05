import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_SFX, buildManifest, MUSIC, pickMusic, pitchFor, SFX_FILE, SoundDiffer, VoiceLimiter, type MusicTrack,
} from '../src/render/audioLogic';
import { canRestart, portraitPause, RESTART_GUARD_MS, RunDriver, STEP_MS } from '../src/render/runDriver';
import { TAP_MS, TouchModel, touchButtons } from '../src/render/touch';
import { BTN_DASH, BTN_PARRY, type InputFrame } from '../src/sim/input';
import { decodeReplay, encodeReplay, playReplay } from '../src/sim/replay';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/state';
import {
  BEST_PER_DIFFICULTY, DAILY_DAYS, defaultSave, loadSave, mergeFromDisk, recordRun, save, shouldSaveRun, STORAGE_KEY, todaysBest,
  validateSave, writeSave, type KV,
} from '../src/storage';
import { botInput } from './bot';
import { mulberryInputs } from './scripted';

const memKV = (init?: string): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  if (init !== undefined) data.set(STORAGE_KEY, init);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const throwingKV: KV = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceeded');
  },
};

describe('storage', () => {
  it('blocked or missing storage -> defaults, no crash; writes fail softly', () => {
    expect(loadSave(null)).toEqual(defaultSave());
    expect(loadSave(throwingKV)).toEqual(defaultSave());
    expect(writeSave(defaultSave(), throwingKV)).toBe(false);
    expect(writeSave(defaultSave(), null)).toBe(false);
  });

  it('corrupted data falls back to defaults', () => {
    for (const raw of ['{', 'null', '[]', '"x"', '{"v":2}', 'x'.repeat(200_000), '{"v":1,"settings":7}']) {
      const s = loadSave(memKV(raw));
      expect(s.settings).toEqual(defaultSave().settings);
      expect(s.best.easy).toEqual([]);
    }
  });

  it('the schema rejects bad data field by field', () => {
    const s = validateSave({
      v: 1,
      settings: { master: 250, music: -5, sfx: '50', shake: 'yes', effects: 'ultra', dragSensitivity: 99, haptics: true },
      hero: '<img src=x onerror=alert(1)>',
      difficulty: 'nightmare',
      best: {
        easy: [
          { score: 100, hero: 'knight', date: '2026-11-05', secs: 12.34 },
          { score: -1, hero: 'knight', date: '2026-11-05', secs: 1 },
          { score: 5, hero: 'mage', date: '2026-11-05', secs: 1 },
          { score: 5, hero: 'wisp', date: '<script>', secs: 1 },
          { score: 1.5, hero: 'wisp', date: '2026-11-05', secs: 1 },
          'junk',
        ],
        medium: 'nope',
      },
      daily: [{ date: 'x', entry: {} }, { date: '2026-11-05', entry: { score: 9, hero: 'wisp', date: '2026-11-05', secs: 3 } }],
    });
    expect(s.settings.master).toBe(80);
    expect(s.settings.music).toBe(60);
    expect(s.settings.sfx).toBe(80);
    expect(s.settings.shake).toBe(true);
    expect(s.settings.effects).toBe('high');
    expect(s.settings.dragSensitivity).toBe(1.5);
    expect(s.settings.haptics).toBe(true);
    expect(s.hero).toBe('knight');
    expect(s.difficulty).toBe('medium');
    expect(s.best.easy).toEqual([{ score: 100, hero: 'knight', date: '2026-11-05', secs: 12.3 }]);
    expect(s.best.medium).toEqual([]);
    expect(s.daily.length).toBe(1);
  });

  it('round-trips through storage', () => {
    const kv = memKV();
    const s = defaultSave();
    s.hero = 'wisp';
    s.settings.music = 30;
    recordRun(s, 'easy', { score: 42, hero: 'wisp', date: '2026-11-05', secs: 7 }, '2026-11-05');
    expect(writeSave(s, kv)).toBe(true);
    expect(loadSave(kv)).toEqual(s);
  });

  it('best scores: insertion, ordering, cap 5 per difficulty, new-record flag', () => {
    const s = defaultSave();
    const runs = [50, 10, 90, 30, 70, 20, 80];
    const flags = runs.map((score) => recordRun(s, 'medium', { score, hero: 'knight', date: '2026-11-05', secs: 1 }, '2026-11-05').newRecord);
    expect(flags).toEqual([true, false, true, false, false, false, false]);
    expect(s.best.medium.map((e) => e.score)).toEqual([90, 80, 70, 50, 30]);
    expect(s.best.medium.length).toBe(BEST_PER_DIFFICULTY);
    expect(s.best.easy).toEqual([]);
  });

  it("Hard: today's best per UTC date, at most 7 days kept", () => {
    const s = defaultSave();
    for (let d = 1; d <= 9; d++) {
      const date = `2026-11-0${d}`;
      recordRun(s, 'hard', { score: d * 10, hero: 'knight', date, secs: 1 }, date);
      recordRun(s, 'hard', { score: d * 10 - 5, hero: 'wisp', date, secs: 1 }, date); // lower: does not replace
    }
    expect(s.daily.length).toBe(DAILY_DAYS);
    expect(todaysBest(s, '2026-11-09')?.score).toBe(90);
    expect(todaysBest(s, '2026-11-01')).toBeNull(); // dropped (oldest)
    recordRun(s, 'medium', { score: 999, hero: 'knight', date: '2026-11-09', secs: 1 }, '2026-11-09');
    expect(todaysBest(s, '2026-11-09')?.score).toBe(90); // only Hard counts for the daily
  });

  it('two tabs never erase each other: scores saved by another tab are merged before recording', () => {
    const other = defaultSave();
    recordRun(other, 'easy', { score: 500, hero: 'wisp', date: '2026-11-05', secs: 9 }, '2026-11-05');
    recordRun(other, 'hard', { score: 70, hero: 'wisp', date: '2026-11-05', secs: 9 }, '2026-11-05');
    const kv = memKV(JSON.stringify(other));
    recordRun(save(), 'easy', { score: 300, hero: 'knight', date: '2026-11-05', secs: 5 }, '2026-11-05');
    mergeFromDisk(kv);
    mergeFromDisk(kv); // idempotent
    expect(save().best.easy.map((e) => e.score)).toEqual([500, 300]);
    expect(todaysBest(save(), '2026-11-05')?.score).toBe(70);
  });

  it('discarded runs are not saved: restart/quit from pause, dev ?wave runs', () => {
    expect(shouldSaveRun('death', undefined)).toBe(true);
    expect(shouldSaveRun('restart', undefined)).toBe(false);
    expect(shouldSaveRun('quit', undefined)).toBe(false);
    expect(shouldSaveRun('death', 3)).toBe(false);
  });
});

describe('pause and restart', () => {
  it('pause freezes the sim: no ticks, no input sampled; the replay and score are unchanged', () => {
    const frames = mulberryInputs(5, 900);
    const plain = new Sim(77, 'medium');
    for (const f of frames) plain.step(f);
    const paused = new Sim(77, 'medium');
    const d = new RunDriver(paused);
    let i = 0;
    let sampled = 0;
    const sample = (): InputFrame => (sampled++, frames[i++]!);
    let frame = 0;
    while (i < frames.length && paused.state.alive) {
      if (frame % 50 === 10) d.pause('menu');
      if (frame % 50 === 30) d.resume('menu');
      if (frame % 70 === 5) d.pause('hidden');
      if (frame % 70 === 45) d.resume('hidden');
      d.advance(STEP_MS, sample);
      frame++;
    }
    expect(sampled).toBe(paused.log.length);
    expect(paused.state.tick).toBe(Math.min(plain.state.tick, paused.state.tick));
    if (!plain.state.alive || i >= frames.length) {
      expect(JSON.stringify({ ...paused.state, events: [] })).toBe(JSON.stringify({ ...plain.state, events: [] }));
      expect(paused.score).toBe(plain.score);
    }
    expect(JSON.stringify(encodeReplay(77, 'medium', paused.log))).toBe(JSON.stringify(encodeReplay(77, 'medium', plain.log.slice(0, paused.log.length))));
  });

  it('a paused driver does not catch up the paused time', () => {
    const d = new RunDriver(new Sim(1, 'easy'));
    d.pause('blur');
    expect(d.advance(5000, () => ({ cursor: false, mx: 0, my: 0, buttons: 0 }))).toBe(0);
    d.resume('blur');
    expect(d.advance(STEP_MS * 1.5, () => ({ cursor: false, mx: 0, my: 0, buttons: 0 }))).toBe(1);
    expect(d.advance(100_000, () => ({ cursor: false, mx: 0, my: 0, buttons: 0 }))).toBeLessThanOrEqual(5);
  });

  it('the 250 ms restart guard', () => {
    expect(RESTART_GUARD_MS).toBe(250);
    expect(canRestart(1000 + 249, 1000)).toBe(false);
    expect(canRestart(1000 + 250, 1000)).toBe(true);
  });

  it('portrait on a touch device pauses; landscape or desktop does not', () => {
    expect(portraitPause(390, 844, true)).toBe(true);
    expect(portraitPause(844, 390, true)).toBe(false);
    expect(portraitPause(390, 844, false)).toBe(false);
    const d = new RunDriver(new Sim(1, 'easy'));
    if (portraitPause(390, 844, true)) d.pause('portrait');
    expect(d.paused).toBe(true);
    d.resume('portrait');
    expect(d.paused).toBe(false);
  });
});

describe('replay metadata', () => {
  it('hero and input source are metadata only: same frames => same state and score', () => {
    const sim = new Sim(9, 'hard');
    for (const f of mulberryInputs(3, 1500)) sim.step(f);
    const a = encodeReplay(9, 'hard', sim.log, { hero: 'knight', input: ['mouse'] });
    const b = encodeReplay(9, 'hard', sim.log, { hero: 'wisp', input: ['touch'] });
    expect(a.tuning).toBe(b.tuning);
    expect(a.runs).toEqual(b.runs);
    const ra = playReplay(JSON.parse(JSON.stringify(a)));
    const rb = playReplay(JSON.parse(JSON.stringify(b)));
    expect(JSON.stringify({ ...ra.state, events: [] })).toBe(JSON.stringify({ ...rb.state, events: [] }));
    expect(ra.score).toBe(rb.score);
    expect(decodeReplay(JSON.parse(JSON.stringify(b))).meta).toEqual({ hero: 'wisp', input: ['touch'] });
    // untrusted metadata is sanitized, never trusted
    const bad = { ...a, meta: { hero: '<b>x</b>', input: ['touch', 'evil'] } };
    expect(decodeReplay(bad).meta).toBeUndefined();
    expect(decodeReplay({ ...a, meta: { hero: 'wisp', input: ['evil', 'touch'] } }).meta).toEqual({ hero: 'wisp', input: ['touch'] });
  });
});

describe('touch controls', () => {
  const opts = { sensitivity: 1.5, leftHanded: false, secondFingerParry: true };
  const hero = { x: 240, y: 135 };

  it('buttons sit in the side margins, never over the arena; left-handed mirrors them', () => {
    for (const left of [false, true])
      for (const b of touchButtons(left)) {
        if (left) expect(b.x + b.r).toBeLessThanOrEqual(48);
        else expect(b.x - b.r).toBeGreaterThanOrEqual(432);
        expect(b.y + b.r).toBeLessThanOrEqual(270);
      }
    const [parry, dash] = touchButtons(false);
    expect(parry!.r * 2).toBeGreaterThanOrEqual(34);
    expect(dash!.y).toBeLessThan(parry!.y);
  });

  it('relative drag moves a virtual cursor from the hero; lifting keeps it; the next drag continues', () => {
    const t = new TouchModel(opts);
    t.down(1, 300, 200, 0, hero);
    t.move(1, 310, 200);
    expect(t.cursor).toEqual({ x: 255, y: 135 });
    t.up(1, 500);
    expect(t.cursor).toEqual({ x: 255, y: 135 });
    t.down(2, 100, 100, 600, { x: 999, y: 999 });
    t.move(2, 100, 90);
    expect(t.cursor).toEqual({ x: 255, y: 120 });
    t.move(2, 100, -1000); // clamped to the arena
    expect(t.cursor!.y).toBe(27);
    expect(t.take()).toBe(0);
  });

  it('a single tap of the only finger does nothing; a second-finger tap parries (setting on)', () => {
    const t = new TouchModel(opts);
    t.down(1, 200, 150, 0, hero);
    t.up(1, 100);
    expect(t.take()).toBe(0);
    t.down(1, 200, 150, 1000, hero);
    t.down(2, 300, 150, 1010, hero);
    t.up(2, 1010 + TAP_MS - 50);
    expect(t.take()).toBe(BTN_PARRY);
    t.down(3, 300, 150, 2000, hero);
    t.move(3, 320, 150); // moved too far: not a tap, and it never moves the hero
    const before = { ...t.cursor! };
    t.up(3, 2050);
    expect(t.take()).toBe(0);
    expect(t.cursor).toEqual(before);
    t.down(4, 300, 150, 3000, hero);
    t.up(4, 3000 + TAP_MS + 50); // too slow
    expect(t.take()).toBe(0);
    const off = new TouchModel({ ...opts, secondFingerParry: false });
    off.down(1, 200, 150, 0, hero);
    off.down(2, 300, 150, 10, hero);
    off.up(2, 50);
    expect(off.take()).toBe(0);
  });

  it('button touches press the button and never move the hero', () => {
    const t = new TouchModel(opts);
    const [parry, dash] = t.buttons();
    t.down(1, parry!.x, parry!.y, 0, hero);
    t.move(1, parry!.x - 60, parry!.y - 60);
    expect(t.cursor).toBeNull();
    expect(t.take()).toBe(BTN_PARRY);
    t.down(2, dash!.x, dash!.y, 10, hero);
    expect(t.take()).toBe(BTN_DASH);
    expect(t.held('dash')).toBe(true);
  });

  it('the same virtual-cursor sequence gives the same replay and score as the equivalent mouse input', () => {
    const t = new TouchModel(opts);
    const mouseSim = new Sim(31, 'medium');
    const touchSim = new Sim(31, 'medium');
    let x = 0;
    t.down(1, 240, 135, 0, touchSim.state.hero);
    for (let i = 0; i < 1200 && touchSim.state.alive; i++) {
      // the finger draws slow circles; parry with a second-finger tap every 40 ticks
      const nx = 240 + Math.round(Math.cos(i / 30) * 60);
      const ny = 135 + Math.round(Math.sin(i / 30) * 40);
      t.move(1, nx / 1.5 + x, ny / 1.5);
      x = 0;
      if (i % 40 === 20) {
        t.down(2, 300, 100, i * 16, touchSim.state.hero);
        t.up(2, i * 16 + 30);
      }
      const buttons = t.take();
      const c = t.cursor!;
      const frame = { cursor: true, mx: Math.round(c.x), my: Math.round(c.y), buttons };
      touchSim.step(frame);
      mouseSim.step({ ...frame }); // the mouse at the same game position with the same clicks
    }
    expect(JSON.stringify(encodeReplay(31, 'medium', touchSim.log))).toBe(JSON.stringify(encodeReplay(31, 'medium', mouseSim.log)));
    expect(touchSim.score).toBe(mouseSim.score);
  });
});

describe('audio logic (no real audio)', () => {
  it('manifest: only existing .mp3 files with valid names; every sfx maps to an AUDIO_LIST.md file', () => {
    const m = buildManifest({ '../../assets/audio/sfx_parry.mp3': '/a.mp3', '../../assets/audio/Evil Name.mp3': '/b', '../../assets/audio/sfx_dash.ogg': '/c' });
    expect([...m.keys()]).toEqual(['sfx_parry']);
    expect(buildManifest({}).size).toBe(0);
    const list = readFileSync('AUDIO_LIST.md', 'utf8');
    for (const e of ALL_SFX) expect(list).toContain(`${SFX_FILE[e]}.mp3`);
    expect(ALL_SFX.length).toBe(18);
  });

  it('voice limit 3 per sfx, pitch +-3% only on frequent sfx', () => {
    const v = new VoiceLimiter(3);
    expect([1, 2, 3, 4].map(() => v.tryStart('parry'))).toEqual([true, true, true, false]);
    v.end('parry');
    expect(v.tryStart('parry')).toBe(true);
    expect(v.tryStart('dash')).toBe(true);
    for (const r of [0, 0.5, 0.999]) {
      expect(Math.abs(pitchFor('parry', r) - 1)).toBeLessThanOrEqual(0.03 + 1e-9);
      expect(pitchFor('death', r)).toBe(1);
    }
  });

  it('music: calm/tense with hysteresis, boss theme in fights, menu on menus', () => {
    const st = (wave: number, n: number, boss = false) => ({ wave, boss: boss ? ({} as never) : null, projectiles: { length: n } });
    let cur: MusicTrack | null = null;
    const seq: MusicTrack[] = [];
    for (const [w, n] of [[0, 0], [1, 26], [1, 20], [1, 14], [MUSIC.tenseWave, 0], [MUSIC.tenseWave - 1, 16], [2, 10]] as const) {
      cur = pickMusic('run', st(w, n), cur);
      seq.push(cur);
    }
    expect(seq).toEqual(['music_run_calm', 'music_run_tense', 'music_run_tense', 'music_run_calm', 'music_run_tense', 'music_run_tense', 'music_run_calm']);
    expect(pickMusic('run', st(9, 50, true), 'music_run_tense')).toBe('music_boss');
    expect(pickMusic('menu', null, 'music_boss')).toBe('music_menu');
  });

  it('sound events are derived on the render side; orb_spawn throttled to one per 150 ms; parry_chain per step', () => {
    const d = new SoundDiffer();
    const spawn = (id: number, kind: 'orb_small' | 'blade' | 'wraith' | 'rune_shard', tele = 0): SimEvent => ({ type: 'spawn', id, kind, dist: 100, telegraphTicks: tele });
    expect(d.tick({ multiplier: 100, projectiles: [] }, [spawn(1, 'orb_small'), spawn(2, 'orb_small')], 0)).toEqual(['orb_spawn']);
    expect(d.tick({ multiplier: 100, projectiles: [] }, [spawn(3, 'orb_small')], 100)).toEqual([]);
    expect(d.tick({ multiplier: 100, projectiles: [] }, [spawn(4, 'orb_small')], 160)).toEqual(['orb_spawn']);
    expect(d.tick({ multiplier: 125, projectiles: [] }, [{ type: 'parry_hit', id: 1, x: 0, y: 0, points: 1, multiplier: 1 }], 200)).toEqual(['parry', 'parry_chain']);
    expect(d.tick({ multiplier: 125, projectiles: [] }, [spawn(5, 'blade'), spawn(6, 'wraith'), spawn(7, 'rune_shard', 30), spawn(8, 'rune_shard', 30)], 400)).toEqual(['blade_whoosh', 'wraith_wail', 'rune_burst']);
  });

  it('a whole bot run produces sound events without touching the sim', () => {
    const sim = new Sim(4, 'medium', { startWave: 3 });
    const d = new SoundDiffer();
    const seen = new Set<string>();
    while (sim.state.alive && sim.state.tick < 3000) {
      const before = JSON.stringify(sim.state);
      for (const e of d.tick(sim.state, sim.state.events, sim.state.tick * 16)) seen.add(e);
      expect(JSON.stringify(sim.state)).toBe(before);
      sim.step(botInput(sim));
    }
    expect(seen.has('boss_intro_eye')).toBe(true);
    expect(seen.has('boss_hit')).toBe(true);
  });
});

describe('architecture', () => {
  it('menus, storage and audio never import or touch src/sim state', () => {
    for (const f of ['src/render/ui.ts', 'src/render/menus.ts', 'src/render/TitleScene.ts', 'src/storage.ts', 'src/render/audio.ts', 'src/render/sfx.ts', 'src/render/events.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from '\.\.\/sim\/(sim|waves|boss|pickups)'/);
      expect(src, f).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(/);
    }
    for (const f of ['src/sim/sim.ts', 'src/sim/waves.ts', 'src/sim/state.ts']) expect(readFileSync(f, 'utf8')).not.toMatch(/from '\.\.\/(render|storage)/);
  });
});
