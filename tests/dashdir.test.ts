import { describe, expect, it } from 'vitest';
import { BTN_DASH, type InputFrame } from '../src/sim/input';
import { makeParams } from '../src/sim/params';
import { createState, dashDirection, step } from '../src/sim/sim';

describe('dash direction indicator', () => {
  it('equals the direction the sim uses when dash is pressed on that tick (many random states)', () => {
    const p = makeParams('medium');
    let x = 12345;
    const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 2000; i++) {
      const s = createState(i, 'medium', p);
      s.hero.x = 60 + rnd() * 360;
      s.hero.y = 40 + rnd() * 190;
      const a = rnd() * Math.PI * 2;
      s.hero.dirX = Math.cos(a);
      s.hero.dirY = Math.sin(a);
      s.tick = 500; // dash ready
      const kind = rnd();
      const f: InputFrame =
        kind < 0.4 ? { cursor: true, mx: Math.round(rnd() * 480), my: Math.round(rnd() * 270), buttons: BTN_DASH }
        : kind < 0.55 ? { cursor: true, mx: Math.round(s.hero.x), my: Math.round(s.hero.y), buttons: BTN_DASH } // standing on the cursor
        : kind < 0.85 ? { cursor: false, mx: Math.round((rnd() - 0.5) * 200), my: Math.round((rnd() - 0.5) * 200), buttons: BTN_DASH }
        : { cursor: false, mx: 0, my: 0, buttons: BTN_DASH }; // no movement: last facing
      const shown = dashDirection(s.hero, { ...f, buttons: 0 }, p);
      step(s, f, p, { spawner: false });
      expect(s.hero.dashDirX).toBe(shown[0]);
      expect(s.hero.dashDirY).toBe(shown[1]);
    }
  });
});
