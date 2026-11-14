# Feature blocks (dark merges)

New rules arrive in blocks behind data flags (`src/data/features.ts`, design in [ROADMAP_V2.md](ROADMAP_V2.md),
sections 4 and 6). A block is merged DARK (`enabled: false`): the live game, the fingerprint and the version do not
change. It is switched on later by its own small change, with a version bump and the cut-over of
[DEPLOY.md](DEPLOY.md).

## What a block is

- One entry of `FEATURES` with `enabled: false` and ALL the data the block needs (rows, weights, unlock waves).
- A disabled block is never read by the sim. Only `makeParams` looks at a block, and only at its `enabled` flag; the
  sim sees an enabled block through a field of `SimParams` that is `null` while it is off
  (`patternPack` -> `params.pack`). `tests/features.test.ts` runs the sim with flags whose disabled blocks throw on
  any read.
- While it is off a block consumes no PRNG draw and adds no state: the state of a dark run is identical, field for
  field, to the state before the block existed.

## The fingerprint

`tuningHash(features = FEATURES)` hashes TUNING, the hero table, the spawn geometry and then the canonical JSON of
the ENABLED blocks. With no block enabled nothing is appended (no separator), so a dark build keeps the fingerprint it
had: `f0214eba`, with `CLIENT_VERSION` 0.10.0. Both are pinned in `tests/features.test.ts`.

- Editing the rows of a disabled block never changes the fingerprint.
- Enabling a block, or editing a row of an enabled block, changes it: that is a rules change.

## Variants (bots and tests)

`withFeatures('patternPack')` returns a copy of the flags with that block enabled. Pass it to the sim:
`new Sim(seed, 'hard', { hero, features })` or `makeParams(difficulty, hero, features)`. Never edit the production
flags to try something.

A variant run cannot reach the board:

- its replay is encoded with its own flags (`encodeReplay(..., meta, sim.features)`) and carries
  `tuningHash(variant)`; `decodeReplay` and `playReplay` refuse it under the production flags ("different tuning"),
  and `playReplay` always decodes and simulates under the SAME flags;
- the game, the Worker and the verifier never pass flags, so they always use the production ones; the Worker answers
  a foreign fingerprint with `outdated`, and a variant log sent under the production fingerprint fails
  re-simulation.

## Adding a block

1. Add its type and its entry to `FEATURES` with `enabled: false`; add a nullable field to `SimParams` and set it in
   `makeParams` from the flag.
2. Write the sim code so that every path into it starts with that field (`if (p.pack) ...`), new state exists only
   while the block is on, and the PRNG is touched only there.
3. Test the enabled variant (fairness, bots, score bound) with `withFeatures`.
4. Merge dark: `npm test` passes with the pinned fingerprint and the golden corpus UNCHANGED. No deploy step, no
   version bump, no Worker deploy.

## Enabling a block (a rules change)

One pull request: set `enabled: true`, bump `CLIENT_VERSION`, re-pin the fingerprint, re-record the golden corpus,
update CLAUDE.md where a stated rule changes. Deploy it with the cut-over of DEPLOY.md "Upgrading the game" (an
additive or a paused cut-over, ROADMAP_V2 section 6). Rolling back is the same in the other direction.

## The golden corpus

`tests/fixtures/golden_corpus.json`: 20 recorded Hard runs (10 Knight, 10 Wisp, the skilled bot, fixed seeds, 10 of
them reach a boss). `tests/golden_corpus.test.ts` re-simulates every input log and compares the score, the length in
ticks and the death tick exactly, and checks the fingerprint and version they were recorded under.

- A dark merge must leave the fixture and its test untouched and green: that is the proof that the live rules did not
  move.
- It is re-recorded only by a change that is meant to change the rules (enabling a block, a tuning change):
  `npx vite-node tools/bot/golden_record.ts <commit>`; the pull request says so.

## Blocks

### `patternPack` (dark)

Ten set pieces built from the existing threats only (no new entity kind, sprite, string or sound), in
`src/sim/patternPack.ts`; rows in `FEATURES.patternPack`. When the block is on, its rows join the director's pool AFTER
the existing patterns: the existing order, weights and draws are untouched and the pick is still one PRNG draw. A
piece that cannot start falls back to an orb fan, like a summon. No piece starts from a boss intro to the end of the
break; emissions already queued finish, like rune telegraphs and casters.

| Piece | Wave | What it is | Cue | Cap per instance |
|---|---|---|---|---|
| `spiral` | 1 | a rune emits small orbs over 1.2 s while the direction turns; the first one flies at the hero | rune glow | 16 |
| `gapRing` | 2 | a dense rune burst with ONE gap of 0.7 rad, opened near the hero's direction | rune glow | 20 |
| `pincer` | 3 | two orb fans from opposite edges, crossing at the hero | far edge spawn | 10 |
| `curtain` | 4 | a line of large orbs sweeps in from the far edge with one 44 px gap within walking reach; one at a time | far edge spawn | 28 |
| `echoFan` | 5 | an orb fan, then the same fan 0.5 s later, turned by half a ray gap | far edge spawn | 12 |
| `crossfire` | 6 | two stalkers on two sides cast 2-3 blades each at the same time (red) | stalkers, wind-up held for the burst | 6 + 2 casters |
| `pulseRings` | 8 | one rune fires 3 shard rings 0.4 s apart, each turned by a third of the spacing | rune glow | 36 |
| `heavyLine` | 9 | large orbs from points along one far edge, parallel, 0.15 s apart | far edge spawn | 7 |
| `slowThenFast` | 11 | two wraiths, then 1.2 s later one fast small orb aimed ahead of the hero's drift | spawns >= 150 px away | 3 |
| `stalkerPair` | 13 | two stalkers; the second casts 0.7 s after the first (a violet fan, then any attack) | stalkers | 14 + 2 casters |

Fairness, all tested in `tests/pattern_pack.test.ts` and `tests/edge_markers.test.ts` on the enabled variant: nothing
appears within 60 px of the hero without a cue of at least 15 ticks (an uncued edge shot that would is dropped); violet
is parryable and red is blades only; a walking-only solver (no parry, no dash) finds a way through every piece on 200
seeds each, from the centre, the corners and the edges, up to the speed and count caps; every off-view threat of the
pack is marked on the edge of the zoomed phone view at least 15 ticks before it can hit.

Bot report (the targets of the pack and per-piece numbers, today's rules against the variant):
`npx vite-node tools/bot/pack_report.ts 100 hard`. Read it before enabling: a 100-seed median moves by 10-20% between
seed sets (the first boss opens a hole in the survival distribution at 70-80 s), so check 300 seeds as well.
