/**
 * Arena geometry shared by the sim. Rune centres are copied from the generated art
 * (assets/atlas/manifest.json -> layout.runes); tests/layout.test.ts keeps them in sync.
 */
export const RUNES: readonly { readonly x: number; readonly y: number }[] = [
  { x: 299, y: 159 },
  { x: 264, y: 194 },
  { x: 216, y: 194 },
  { x: 181, y: 159 },
  { x: 181, y: 111 },
  { x: 216, y: 76 },
  { x: 264, y: 76 },
  { x: 299, y: 111 },
];
