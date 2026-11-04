/**
 * Arena geometry shared by the sim. Rune centres are copied from the generated art
 * (assets/atlas/manifest.json -> layout.runes); tests/layout.test.ts keeps them in sync.
 */
export const RUNES: readonly { readonly x: number; readonly y: number }[] = [
  { x: 326, y: 186 },
  { x: 276, y: 236 },
  { x: 204, y: 236 },
  { x: 154, y: 186 },
  { x: 154, y: 114 },
  { x: 204, y: 64 },
  { x: 276, y: 64 },
  { x: 326, y: 114 },
];
