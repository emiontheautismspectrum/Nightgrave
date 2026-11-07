/**
 * The phone-portrait "shell" (render-only, never read by the simulation): a blackened-iron relic console drawn around
 * the run screen of a phone in portrait (the same condition that picks the zoomed portrait layout). Top plate with the
 * HUD and the pause pill, a riveted bezel around the world window, a control deck with the stick well, the PARRY /
 * DASH caps, status lamps, a speaker grille and an engraving. `enabled: false` restores the previous layout exactly.
 * The pieces are atlas sprites (tools/nglib/shell.py); src/render/portraitLayout.ts and src/render/shellParts.ts
 * place them; colours are palette NAMES (docs/ASSETS_SPEC.md), never red / blood or violet.
 */
export type ShellColor = 'bg0' | 'bg1' | 'fog' | 'stone_dark' | 'stone' | 'bone' | 'amber' | 'gold' | 'teal';
export type LampKind = 'dash' | 'guard' | 'trail' | 'slow' | 'double';
export type ShellDecor = 'screws' | 'grille' | 'rune';

export const SHELL = {
  enabled: true,
  /** Bezel thickness (game px; equals the bezel sprites, tools/nglib/shell.py BEZEL) and the body strip beside it. */
  bezel: 5,
  side: 2,
  /** The engraved title plate (TITLE from src/config.ts) on the top plate, where it fits beside the HUD. */
  title: true,
  /** Caps (CSS px, width x height of the VISIBLE cap); the hit area is hitPad larger on every side. */
  caps: { parry: { w: 100, h: 72 }, dash: { w: 76, h: 56 }, hitPad: 12 },
  /** Minimum space between two hit rectangles (CSS px). */
  hitGap: 4,
  /** The pause pill's hit area (CSS px, square, at least). */
  pauseHit: 44,
  /** DASH sits higher than PARRY by this share of PARRY's cap height (more when the stick zone is in the way). */
  stagger: 0.35,
  /** The lamp row (left to right). `guard` is the Knight's (3 lamps, one per charge), `trail` the Wisp's. */
  lamps: ['dash', 'guard', 'slow', 'double'] as LampKind[],
  /** Lamp row reserved for the widest hero (6 lamps: dash, 3 x guard, slow, double). */
  maxLamps: 6,
  lampGap: 2,
  /** Decoration that is dropped first when there is no room (the controls never shrink for decoration). */
  dropOrder: ['rune', 'grille', 'screws'] as ShellDecor[],
  /** The grille in whole 4 px tiles: preferred, then smaller. */
  grille: [[6, 3], [4, 3], [3, 2]] as [number, number][],
  colors: {
    /** Page colour under the notch and the home indicator (matches the body). */
    body: 'bg1' as ShellColor,
    well: 'bg0' as ShellColor,
    wellLit: 'stone_dark' as ShellColor,
    ring: 'stone' as ShellColor,
    knob: 'stone' as ShellColor,
    knobLit: 'bone' as ShellColor,
    knobShade: 'stone_dark' as ShellColor,
    slot: 'bg0' as ShellColor,
    slotLit: 'stone_dark' as ShellColor,
    cooldown: 'amber' as ShellColor,
  },
};

/** The palette colours the shell may use (docs/ASSETS_SPEC.md; tests/shell.test.ts checks them against the doc). */
export const SHELL_PALETTE: Record<ShellColor, string> = {
  bg0: '#0b0d12',
  bg1: '#12161d',
  fog: '#1c2330',
  stone_dark: '#262e3d',
  stone: '#3a4558',
  bone: '#d9d2c0',
  amber: '#ffb347',
  gold: '#ffd86b',
  teal: '#4fd1c5',
};

/** Atlas frame order of `shell_lamp` (two frames each: off, on) and `shell_glyph` (tools/nglib/shell.py). */
export const LAMP_FRAMES: LampKind[] = ['dash', 'guard', 'trail', 'slow', 'double'];
export const GLYPH_ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
