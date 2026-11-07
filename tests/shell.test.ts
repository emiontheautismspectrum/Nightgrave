/**
 * The phone-portrait console shell: its layout (sizes in CSS px, no overlaps, the world window, safe edges), the pure
 * part list (integers, exact tiling, nothing over the window / the stick zone / a hit rectangle / the slot), the
 * rectangular cap hit test (edges, corners, pads, multi-touch) and the palette rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../assets/atlas/manifest.json';
import { TITLE } from '../src/config';
import { heroDef } from '../src/data/heroes';
import { SHELL, SHELL_PALETTE } from '../src/data/shell';
import { STICK } from '../src/data/input';
import { HUD_BOTTOM, HUD_RIGHT, portraitLayout, rectHitsCircle, rectsOverlap, type Btn, type PortraitLayout, type Rect } from '../src/render/portraitLayout';
import { capParts, discRows, heroLamps, shellParts, type Part } from '../src/render/shellParts';
import { onButton, TouchModel } from '../src/render/touch';
import { BTN_DASH, BTN_PARRY } from '../src/sim/input';
import { portraitGameSize } from '../src/web/screen';

/** [vw, vh, dpr, top inset, bottom inset] (CSS px): the five phones with the notch / home-indicator insets and without. */
const PHONES: [number, number, number, number, number][] = [];
for (const [vw, vh, dpr] of [[390, 844, 3], [360, 800, 3], [412, 915, 2.625], [375, 667, 2], [430, 932, 3]] as const)
  for (const [t, b] of [[47, 34], [0, 0]] as const) PHONES.push([vw, vh, dpr, t, b]);

const lay = (vw: number, vh: number, dpr: number, t: number, b: number, lh: boolean): { L: PortraitLayout; css: number } => {
  const { w, h, k } = portraitGameSize(vw, vh - t - b, dpr);
  return { L: portraitLayout(w, h, k, dpr, lh, 1, SHELL, TITLE), css: k / dpr };
};
const hitRect = (b: Btn): Rect => ({ x: b.x - b.hitW! / 2, y: b.y - b.hitH! / 2, w: b.hitW!, h: b.hitH! });
const inside = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
const OPTS = [
  { lamps: heroLamps(heroDef('knight').ability), stick: true, title: TITLE },
  { lamps: heroLamps(heroDef('wisp').ability), stick: false, title: TITLE },
];

describe('shell layout', () => {
  for (const [vw, vh, dpr, ti, bi] of PHONES)
    for (const lh of [false, true])
      it(`${vw}x${vh} DPR ${dpr} insets ${ti}/${bi}${lh ? ' left-handed' : ''}`, () => {
        const { L, css } = lay(vw, vh, dpr, ti, bi, lh);
        const G = L.shell!;
        expect(G).not.toBeNull();
        const screen = { x: 0, y: 0, w: L.W, h: L.H };
        // caps: never below the minimum sizes, at least today's circles in area, hit areas 12 CSS px on every side
        const [P, D] = L.buttons as [Btn, Btn];
        expect(P.id).toBe('parry');
        expect(P.w! * css).toBeGreaterThanOrEqual(100);
        expect(P.h! * css).toBeGreaterThanOrEqual(72);
        expect(D.w! * css).toBeGreaterThanOrEqual(76);
        expect(D.h! * css).toBeGreaterThanOrEqual(56);
        expect(P.w! * P.h! * css * css).toBeGreaterThanOrEqual(Math.PI * 44 * 44);
        expect(D.w! * D.h! * css * css).toBeGreaterThanOrEqual(Math.PI * 32 * 32);
        for (const b of [P, D]) {
          expect(((b.hitW! - b.w!) / 2) * css).toBeGreaterThanOrEqual(12 - 1e-9);
          expect(((b.hitH! - b.h!) / 2) * css).toBeGreaterThanOrEqual(12 - 1e-9);
          // the art is the visible rectangle, centred on the hit rectangle, on whole px
          const c = b.cap!;
          expect([c.x, c.y, c.w, c.h].every(Number.isInteger)).toBe(true);
          expect(c.x + c.w / 2).toBe(b.x);
          expect(c.y + c.h / 2).toBe(b.y);
          expect(inside(hitRect(b), screen)).toBe(true);
          expect(hitRect(b).y).toBeGreaterThanOrEqual(G.deckTop); // in the deck: never over the window or the HUD
          expect(rectHitsCircle(hitRect(b), L.stick.x, L.stick.y, L.stick.zone)).toBe(false);
          expect(rectsOverlap(hitRect(b), G.slot)).toBe(false);
        }
        // >= 4 CSS px between the two hit rectangles
        expect(rectsOverlap(hitRect(P), hitRect(D), 4 / css - 1e-9)).toBe(false);
        // the thumb side: PARRY lower and outermost, DASH higher and further in
        expect(D.y).toBeLessThan(P.y);
        if (lh) expect(D.x).toBeGreaterThan(P.x);
        else expect(D.x).toBeLessThan(P.x);
        // the stick: >= 120 CSS px base and >= 56 knob, inside the deck, in the corner opposite PARRY
        const S = L.stick;
        expect(S.r * 2 * css).toBeGreaterThanOrEqual(STICK.portrait);
        expect(S.knob * 2 * css).toBeGreaterThanOrEqual(STICK.knob);
        expect(S.x - S.r - 2).toBeGreaterThanOrEqual(0);
        expect(S.x + S.r + 2).toBeLessThanOrEqual(L.W);
        expect(S.y + S.r + 2).toBeLessThanOrEqual(L.H);
        expect(S.y - S.r - 2).toBeGreaterThan(G.slot.y + G.slot.h);
        expect(lh ? S.x > L.W / 2 : S.x < L.W / 2).toBe(true);
        // the pause target: >= 44 CSS px, on the plate, right of every HUD readout
        const ph = L.pauseHit!;
        expect(ph.w * css).toBeGreaterThanOrEqual(44 - 1e-9);
        expect(ph.h * css).toBeGreaterThanOrEqual(44 - 1e-9);
        expect(inside(ph, { x: 0, y: 0, w: L.W, h: G.plateH })).toBe(true);
        expect(ph.x).toBeGreaterThan(HUD_RIGHT);
        expect(inside(L.pause, ph)).toBe(true);
        expect(G.plateH).toBeGreaterThanOrEqual(Math.max(30, HUD_BOTTOM));
        // the title plate: only where it fits beside the HUD, never over the pause target
        if (G.title) {
          expect(G.title.x).toBeGreaterThan(HUD_RIGHT);
          expect(rectsOverlap(G.title, ph)).toBe(false);
          expect(G.title.y + G.title.h).toBeLessThanOrEqual(G.plateH);
        }
        // the world window: inside the bezel, between the plate and the deck, crisp zoom, at most the world height
        const v = L.view;
        expect(v.x).toBe(G.bezel.x + G.bezelW);
        expect(v.y).toBe(G.plateH + G.bezelW);
        expect(v.y + v.h + G.bezelW).toBeLessThanOrEqual(G.deckTop);
        expect(v.h / L.zoom).toBeLessThanOrEqual(270 + 1e-9);
        expect(Math.abs(L.zoom * (css * dpr) - Math.round(L.zoom * css * dpr))).toBeLessThan(1e-9);
        expect(L.zoom).toBeGreaterThanOrEqual(1);
        if (vw === 390 && vh === 844) expect(v.h / L.H).toBeGreaterThanOrEqual(0.6);
        // the boss bar sits in its slot on the deck's top edge
        expect(L.bar.y).toBe(G.slot.y + 1);
        expect(L.bar.y).toBeGreaterThanOrEqual(G.deckTop);
        // the lamp band: in the deck, clear of the controls
        expect(G.lampBand.y).toBeGreaterThan(G.slot.y + G.slot.h);
        for (const b of [P, D]) expect(rectsOverlap(G.lampBand, hitRect(b))).toBe(false);
        expect(rectHitsCircle(G.lampBand, S.x, S.y, S.zone)).toBe(false);
      });

  it('Left-handed mirrors the stick and the caps; the decoration stays put', () => {
    const { L: R } = lay(390, 844, 3, 47, 34, false);
    const { L: M } = lay(390, 844, 3, 47, 34, true);
    expect(M.stick.x).toBe(R.W - R.stick.x);
    for (let i = 0; i < 2; i++) {
      expect(M.buttons[i]!.cap!.x).toBe(R.W - R.buttons[i]!.cap!.x - R.buttons[i]!.cap!.w);
      expect(M.buttons[i]!.y).toBe(R.buttons[i]!.y);
    }
    expect(M.view).toEqual(R.view);
    expect(M.shell!.slot).toEqual(R.shell!.slot);
    expect(M.pauseHit).toEqual(R.pauseHit);
  });

  it('the title plate shows TITLE where the plate is wide enough and is dropped elsewhere (the HUD wins)', () => {
    expect(lay(390, 844, 3, 47, 34, false).L.shell!.title).not.toBeNull(); // 291 game px wide
    expect(lay(375, 667, 2, 47, 34, false).L.shell!.title).toBeNull(); // 250 game px wide
    const L = portraitLayout(291, 570, 4, 3, false, 1, SHELL, 'A MUCH LONGER GAME NAME');
    expect(L.shell!.title).toBeNull();
    expect(portraitLayout(291, 570, 4, 3, false, 1, { ...SHELL, title: false }, TITLE).shell!.title).toBeNull();
  });
});

/** How many parts cover each pixel of a region. */
function coverage(parts: Part[], W: number, H: number): Uint8Array {
  const c = new Uint8Array(W * H);
  for (const p of parts) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) c[y * W + x]!++;
  return c;
}

describe('shell parts', () => {
  for (const [vw, vh, dpr, ti, bi] of PHONES)
    for (const lh of [false, true])
      for (const o of OPTS)
        it(`${vw}x${vh} insets ${ti}/${bi}${lh ? ' left-handed' : ''} ${o.lamps.length} lamps ${o.stick ? 'stick' : 'drag'}`, () => {
          const { L } = lay(vw, vh, dpr, ti, bi, lh);
          const P = shellParts(L, o)!;
          const G = L.shell!;
          const v = L.view;
          const S = L.stick;
          for (const p of P.parts) {
            // whole pixels, inside the texture
            const nums = [p.x, p.y, p.w, p.h, ...(p.t === 'img' ? [p.sx, p.sy, p.sw, p.sh] : [])];
            expect(nums.every(Number.isInteger)).toBe(true);
            expect(p.w > 0 && p.h > 0).toBe(true);
            expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= P.texW && p.y + p.h <= P.texH).toBe(true);
            if (p.t === 'img') {
              // never stretched: 1:1, or a ONE px 9-slice middle repeated
              if (p.w !== p.sw) expect(p.sw).toBe(1);
              if (p.h !== p.sh) expect(p.sh).toBe(1);
              const f = manifest.sprites[p.name];
              expect(p.sx + p.sw <= f.w && p.sy + p.sh <= f.h).toBe(true);
              expect(p.frame).toBeLessThan(f.frames);
            }
            // nothing on screen inside the world window
            if (p.y < L.H) expect(rectsOverlap(p, v)).toBe(false);
          }
          const screen = P.parts.filter((p) => p.y < L.H);
          // the body fill covers every screen pixel outside the bezel exactly once; the bezel tiles its ring exactly once
          const fill = coverage(screen.filter((p) => p.t === 'img' && p.name === 'shell_fill'), L.W, L.H);
          const bez = coverage(screen.filter((p) => p.t === 'img' && (p.name === 'shell_bezel_h' || p.name === 'shell_bezel_v' || p.name === 'shell_bezel_corner')), L.W, L.H);
          const bz = G.bezel;
          let fillBad = 0;
          let bezBad = 0;
          for (let y = 0; y < L.H; y++)
            for (let x = 0; x < L.W; x++) {
              const inBezel = x >= bz.x && x < bz.x + bz.w && y >= bz.y && y < bz.y + bz.h;
              const inView = x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h;
              if (fill[y * L.W + x] !== (inBezel ? 0 : 1)) fillBad++;
              if (bez[y * L.W + x] !== (inBezel && !inView ? 1 : 0)) bezBad++;
            }
          expect(fillBad).toBe(0);
          expect(bezBad).toBe(0);
          // fill tiles are aligned to one 8 px grid (no seam where two regions meet)
          for (const p of screen) if (p.t === 'img' && p.name === 'shell_fill') expect([(p.x - p.sx) % 8, (p.y - p.sy) % 8]).toEqual([0, 0]);
          // ornaments: inside the deck (or the plate: the title), never over the stick zone, a hit rectangle, the slot,
          // the lamps or each other
          const hits = L.buttons.map(hitRect);
          for (const [i, { name, rect }] of P.ornaments.entries()) {
            if (name === 'title') {
              expect(rect.y + rect.h).toBeLessThanOrEqual(G.plateH);
              continue;
            }
            expect(rect.y).toBeGreaterThan(G.slot.y + G.slot.h);
            expect(rect.x >= 0 && rect.x + rect.w <= L.W && rect.y + rect.h <= L.H).toBe(true);
            expect(rectHitsCircle(rect, S.x, S.y, S.zone)).toBe(false);
            for (const h of hits) expect(rectsOverlap(rect, h)).toBe(false);
            for (const [j, q] of P.ornaments.entries()) if (j !== i && q.name !== 'title') expect(rectsOverlap(rect, q.rect)).toBe(false);
          }
          // lamps: one per entry, in the reserved band, in order, never overlapping
          expect(P.lamps.map((l) => l.kind)).toEqual(o.lamps);
          for (const l of P.lamps) expect(inside({ x: l.x, y: l.y, w: 11, h: 11 }, G.lampBand)).toBe(true);
          // the per-frame frames: inside the texture, under the screen, never overlapping
          const ex = Object.values(P.extras);
          for (const r of ex) expect(r.y).toBeGreaterThanOrEqual(L.H);
          for (let i = 0; i < ex.length; i++) for (let j = i + 1; j < ex.length; j++) expect(rectsOverlap(ex[i]!, ex[j]!)).toBe(false);
          expect(P.extras.parry_up.w).toBe(L.buttons[0]!.cap!.w);
          expect(P.extras.dash_down.h).toBe(L.buttons[1]!.cap!.h);
        });

  it('decoration drops (rune, then grille, then screws) before the lamps; the controls never shrink', () => {
    // a tiny deck: the lamps stay when the rest goes
    const { L } = lay(375, 667, 2, 47, 34, false);
    const P = shellParts(L, OPTS[0]!)!;
    expect(P.lamps.length).toBe(6);
    const names = P.ornaments.map((o) => o.name);
    if (names.includes('rune')) expect(names).toContain('grille');
    if (names.includes('grille')) expect(names.some((n) => n.startsWith('screw'))).toBe(true);
  });

  it('lamps per hero: dash, the ability (3 guard lamps / the trail), slow, double', () => {
    expect(heroLamps(heroDef('knight').ability)).toEqual(['dash', 'guard', 'guard', 'guard', 'slow', 'double']);
    expect(heroLamps(heroDef('wisp').ability)).toEqual(['dash', 'trail', 'slow', 'double']);
    expect(heroLamps({ kind: 'none' })).toEqual(['dash', 'slow', 'double']);
  });

  it('9-slice caps: corners 1:1, one middle row / column repeated, exact size', () => {
    for (const [w, h] of [[75, 54], [57, 42], [11, 12], [12, 13]] as [number, number][]) {
      const parts = capParts('shell_cap_l', 0, 3, 4, w, h);
      const c = coverage(parts, 200, 200);
      let n = 0;
      for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) n += c[y * 200 + x]! === 1 ? 1 : 0;
      expect(n).toBe(w * h);
      for (const p of parts) expect(p.x >= 3 && p.y >= 4 && p.x + p.w <= 3 + w && p.y + p.h <= 4 + h).toBe(true);
    }
  });

  it('circles are pixel-exact and symmetric', () => {
    for (const r of [4, 17, 21, 45]) {
      const rows = discRows(100, 100, r);
      expect(rows.length).toBe(2 * r);
      for (const [x, y, w] of rows) {
        expect(x + w / 2).toBe(100); // symmetric about the centre
        const mirror = rows.find((q) => q[1] === 199 - y)!;
        expect(mirror[2]).toBe(w);
      }
    }
  });

  it('the bezel tunable equals the bezel sprites; SHELL off has no parts', () => {
    expect(manifest.sprites.shell_bezel_h.h).toBe(SHELL.bezel);
    expect(manifest.sprites.shell_bezel_v.w).toBe(SHELL.bezel);
    expect(manifest.sprites.shell_bezel_corner.w).toBe(SHELL.bezel);
    const L = portraitLayout(291, 570, 4, 3, false, 1, { ...SHELL, enabled: false });
    expect(shellParts(L, OPTS[0]!)).toBeNull();
  });
});

describe('shell palette', () => {
  it('the shell colours are the palette of docs/ASSETS_SPEC.md; never red or violet', () => {
    const doc = readFileSync(new URL('../docs/ASSETS_SPEC.md', import.meta.url), 'utf8');
    for (const [name, hex] of Object.entries(SHELL_PALETTE)) expect(doc).toContain(`${name} ${hex}`);
    const names = Object.keys(SHELL_PALETTE);
    for (const bad of ['blood', 'blood_dark', 'violet', 'violet_dark', 'ember', 'moon', 'earth', 'dry', 'fern', 'loam', 'mist']) expect(names).not.toContain(bad);
    for (const c of Object.values(SHELL.colors)) expect(names).toContain(c);
  });
});

describe('rectangular caps: hit test', () => {
  const cap: Btn = { id: 'parry', x: 100.5, y: 200, r: 27, hit: 46.5, w: 75, h: 54, hitW: 93, hitH: 72 };
  const dash: Btn = { id: 'dash', x: 30, y: 150, r: 21, hit: 37.5, w: 57, h: 42, hitW: 75, hitH: 60 };
  it('edges and corners of the hit rectangle count; one px beyond does not; the pad counts like the cap', () => {
    const x0 = cap.x - 46.5;
    const x1 = cap.x + 46.5;
    const y0 = cap.y - 36;
    const y1 = cap.y + 36;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [cap.x, y0], [x0, cap.y]] as [number, number][]) expect(onButton(cap, x, y)).toBe(true);
    for (const [x, y] of [[x0 - 0.01, y0], [x1 + 0.01, y1], [cap.x, y0 - 0.01], [cap.x, y1 + 0.01]] as [number, number][]) expect(onButton(cap, x, y)).toBe(false);
    // the pad (between the cap art and the hit edge) is part of the button
    expect(onButton(cap, cap.x + 37.5 + 5, cap.y)).toBe(true);
    // a corner just outside the cap art but inside the pad: the rectangle has no rounded corners
    expect(onButton(cap, x0 + 1, y0 + 1)).toBe(true);
  });
  it('the circle path is unchanged for round buttons', () => {
    const round: Btn = { id: 'parry', x: 50, y: 50, r: 18, hit: 20 };
    expect(onButton(round, 50 + 20, 50)).toBe(true);
    expect(onButton(round, 50 + 15, 50 + 15)).toBe(false);
  });
  it('multi-touch: stick + PARRY + DASH at once, two fingers on one button, slide-off, release', () => {
    const t = new TouchModel({ sensitivity: 1, leftHanded: false, secondFingerParry: true, stick: true });
    t.view = 'zoomed';
    t.zoomedButtons = [cap, dash];
    t.stickLayout = { x: 300, y: 300, r: 40, knob: 19, zone: 54 };
    const hero = { x: 240, y: 135 };
    expect(t.down(1, 300, 300, 0, hero)).toBe('stick');
    t.move(1, 340, 300);
    expect(t.down(2, cap.x + 46, cap.y + 35, 10, hero)).toBe('parry'); // the pad corner
    expect(t.down(3, dash.x - 37, dash.y - 29, 20, hero)).toBe('dash');
    expect(t.take()).toBe(BTN_PARRY | BTN_DASH);
    expect(t.stickAxis()[0]).toBeCloseTo(1, 6);
    // a second finger on the held PARRY: one more press, the button stays held until BOTH are lifted
    expect(t.down(4, cap.x, cap.y, 30, hero)).toBe('parry');
    expect(t.take()).toBe(BTN_PARRY);
    t.up(2, 40);
    expect(t.held('parry')).toBe(true);
    t.move(4, cap.x + 200, cap.y); // slides off: still that button until lifted, no new press, no movement
    expect(t.take()).toBe(0);
    t.up(4, 50);
    expect(t.held('parry')).toBe(false);
    t.up(3, 60);
    t.up(1, 70);
    expect(t.stickAxis()).toEqual([0, 0]);
    expect(t.held('dash')).toBe(false);
  });
});
