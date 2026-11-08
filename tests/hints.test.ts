import { describe, expect, it } from 'vitest';
import { cardLines, ContextHints, controlsLine, hintText } from '../src/render/hints';
import { makeParams } from '../src/sim/params';
import { createState, spawnProjectile } from '../src/sim/sim';

describe('controls explanation', () => {
  it('one line per device and a card with the colour rule', () => {
    expect(controlsLine('desktop')).toBe('MOUSE MOVE - LMB PARRY - RMB/SPACE DASH');
    expect(controlsLine('touch')).toBe('STICK MOVE - PARRY - DASH');
    expect(controlsLine('gamepad')).toBe('STICK MOVE - A PARRY - B/RT DASH');
    for (const d of ['desktop', 'touch', 'gamepad'] as const) {
      const c = cardLines(d, false).join(' ');
      expect(c).toContain('VIOLET: PARRY IT.');
      expect(c).toContain('RED: DODGE OR DASH.');
    }
  });
  it('contextual hints: once each (violet then red), only for an approaching projectile, never touching the sim', () => {
    const p = makeParams('medium');
    const s = createState(1, 'medium', p.hero, p);
    const h = new ContextHints(true);
    spawnProjectile(s, p, 'orb_small', s.hero.x + 50, s.hero.y, 1, 0); // moving away: no hint
    expect(h.tick(s)).toBeNull();
    s.projectiles = [];
    spawnProjectile(s, p, 'orb_small', s.hero.x + 50, s.hero.y, -1, 0);
    const before = JSON.stringify(s);
    expect(h.tick(s)).toBe('parry');
    expect(JSON.stringify(s)).toBe(before); // read-only: the sim state is untouched
    expect(h.tick(s)).toBeNull(); // only once
    spawnProjectile(s, p, 'blade', s.hero.x - 40, s.hero.y, 1, 0);
    expect(h.tick(s)).toBe('dash');
    expect(h.done).toBe(true);
    expect(new ContextHints(false).tick(s)).toBeNull(); // disabled after the first time
    expect(hintText('dash')).toBe("CAN'T PARRY - DASH!");
  });
});
