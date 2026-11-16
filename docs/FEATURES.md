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

`withFeatures('patternPack')` returns a copy of the flags with that block enabled (`'thorn'` / `'toller'` one new boss,
`'bosses'` both; `'bossOrder'`, `'bossMotion'`, `'bossMoves'` the U3b blocks). Pass it to the sim:
`new Sim(seed, 'hard', { hero, features })` or `makeParams(difficulty, hero, features)`. Never edit the production
flags to try something.

A variant run cannot reach the board:

- its replay is encoded with its own flags (`replayOf(sim)`, or `encodeReplay(..., meta, sim.features)`) and carries
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
break; emissions already queued finish, like rune telegraphs and casters. The long pieces (curtain, crossfire,
stalkerPair) are also not started in the last `bossLeadSeconds` (5 s) before a boss wave. The cues keep the tells the
player already knows: a rune piece launches on a full glow, a stalker at the end of its cast.

| Piece | Wave | What it is | Cue | Cap per instance |
|---|---|---|---|---|
| `spiral` | 1 | a rune emits small orbs over 1.2 s while the direction turns; the first one flies at the hero | rune glow (full at the first orb, then lit while it emits) | 16 |
| `gapRing` | 2 | a dense rune burst with ONE gap of 0.7 rad, opened near the hero's direction | rune glow | 20 |
| `pincer` | 3 | two orb fans from opposite edges, crossing at the hero | far edge spawn | 10 |
| `curtain` | 4 | a line of large orbs sweeps in from the far edge with one 44 px gap within walking reach; one at a time | far edge spawn | 28 |
| `echoFan` | 5 | an orb fan, then the same fan 0.5 s later, turned by half a ray gap | far edge spawn | 12 |
| `crossfire` | 6 | two stalkers on two sides cast together: 2-3 blades each, side by side in lanes 12 px apart (red) | stalkers; every blade leaves at the end of the usual cast | 6 + 2 casters |
| `pulseRings` | 8 | one rune fires 3 shard rings 0.4 s apart, each turned by a third of the spacing | rune glow, a full ramp before every ring | 36 |
| `heavyLine` | 9 | large orbs from points along one far edge, parallel, 0.15 s apart | far edge spawn | 7 |
| `slowThenFast` | 11 | two wraiths, then 1.2 s later one fast small orb aimed ahead of the hero's drift | far edge spawns (the wraiths >= 60 px, the fast orb >= 150 px away) | 3 |
| `stalkerPair` | 13 | two stalkers; the second casts 0.7 s after the first (a violet fan, then any attack) | stalkers | 14 + 2 casters |

Fairness, all tested in `tests/pattern_pack.test.ts` and `tests/edge_markers.test.ts` on the enabled variant: nothing
appears within 60 px of the hero without a cue of at least 15 ticks (an uncued edge shot that would is dropped); violet
is parryable and red is blades only; a walking-only solver (no parry, no dash) finds a way through every piece on 200
seeds each, from the centre, the corners and the edges, up to the speed and count caps; every off-view threat of the
pack is marked on the edge of the zoomed phone view at least 15 ticks before it can hit.

Bot report (the targets of the pack and per-piece numbers, today's rules against the variant):
`npx vite-node tools/bot/pack_report.ts 100 hard`. Read it before enabling: a 100-seed median moves by 10-20% between
seed sets (the first boss opens a hole in the survival distribution at 70-80 s), so check 300 seeds as well.

### `knot` (dark): hex knot

A stationary hollow violet ring with four fuse pips (`src/sim/hunts.ts`; rows in `FEATURES.knot`). Pool order:
existing patterns, the pack, the knot, the briar line; still ONE draw. Unlocks at wave 4 (after the first boss; see the
balance note below).

| Row | Value | Meaning |
|---|---|---|
| `weight`, `unlockWave` | 1.5, 4 | its row in the director's pool (ROADMAP_V2 proposed 2; see below) |
| `maxActive` | 2 | knots alive at once (a burst is at most 2 x 8 = 16 shards) |
| `fuseSeconds` | 4 | counted in ticks: NOT slowed by Slow Time, the same on every difficulty |
| `shards` | 8 | ordinary `rune_shard`s (speed: shard speed x difficulty x wave speed, like a rune burst) |
| `minHeroDist`, `edgeInset`, `spacingPx` | 90, 30, 40 | placement: from the hero, inside the arena edge, from another knot |
| `radius` | 5 | the body the parry zone tests (the ONE zone function: Knight arc and Wisp circle as for orbs) |
| `trailProof` | true | the Wisp's ember trail does not destroy knots |
| `bossLeadSeconds` | 1 | no knot is created whose fuse would end later than 1 s before a boss wave |

Rules: the body is harmless and a dash does not touch it; its life ends only at the burst or a parry. A pulse that
covers it destroys it: it counts as one kill of the pulse, pays like a parried projectile (the pulse's first kill
`parryBase` x the multiplier and one multiplier step, later kills `extraKillPoints`; x2 under Double Score) and
refreshes the reset timer; it is never PERFECT, never gives a guard charge and is never a boss reflect. Should a knot
still be alive when a boss wave begins (impossible under the creation rule), it is removed without a burst.

### `briar` (dark): briar line

A new entity kind `Wall` (`src/sim/hunts.ts`; rows in `FEATURES.briar`): a band of thorns across the whole arena with
ONE gap. Red: unparryable, lethal on touch; the dash i-frames pass through it (the Knight's guard i-frames do not).
Unlocks at wave 4.

| Row | Value | Meaning |
|---|---|---|
| `weight`, `unlockWave` | 1, 4 | its row in the director's pool |
| `maxActive` | 1 | lines alive at once |
| `telegraphSeconds` | 0.75 | the band waits, dimmed, at its entering edge (outside the reachable area) before it moves |
| `speed` | 55 | px/s x the difficulty and wave speed (worst case Hard at the cap: 96.8 px/s; the hero walks 150); Slow Time slows it |
| `halfWidth`, `gapPx` | 3, 44 | the band and its gap (a hero centre within 19 px of the gap centre is safe) |
| `reachFraction` | 0.8 | the gap centre lies within 80% of the distance the hero can WALK before the line arrives |
| `bossLeadSeconds` | 1 | no line is started that would (unslowed) still be alive 1 s before a boss wave |

Rules: it enters from the edge farther from the hero; the axis is a seeded coin. No line starts while a pattern-pack
`curtain` is alive and no curtain while a line is alive; the gap never opens into a blood sigil (else the line does
not start and an orb fan plays instead) and no sigil is placed in the gap corridor while the line is alive. A line
kept alive by Slow Time withers at the boss intro. Collision is O(1) per line per tick.

### The hunts: cues, render, tests

- Every cue is visible: the knot's pips are its fuse (no number), the band's telegraph stands at its edge, the bone
  `edge_gap` marks the gap on both arena edges from the line's first tick; in the zoomed phone view off-view knots
  (violet), lines (red) and gaps (bone) are marked on the window edge (`src/render/edgeMarkers.ts`). Render reads a
  pure draw list (`src/render/huntsView.ts`), empty while the blocks are off. Sounds `sfx_knot_fuse`,
  `sfx_knot_burst`, `sfx_briar_creep` fall back to synthesized ones; the fight reads muted.
- Tests: `tests/hunts.test.ts` (rules, the boss rule, walking-only solvers on 200 seeds from the centre, corners and
  edges: knot bursts ignored by the hero, briar lines with and without blood sigils; Easy and Medium spot checks),
  `tests/hunts_view.test.ts`, `tests/edge_markers.test.ts` (every enabled combination), `tests/features.test.ts`
  (every combination of blocks has its own fingerprint and is refused by production), `tests/shared.test.ts` (the
  score bound counts the knot and its burst; a line adds no projectile).
- Enabling: `withFeatures('knot')`, `withFeatures('briar')`, or both, with or without `'patternPack'`, for bots and
  tests. Bot report: `npx vite-node tools/bot/hunts_report.ts 50 hard` (targets in its header). Switching a block on
  for players is the usual rules change above (paused cut-over, ROADMAP_V2 section 6).

Balance note (Hard, `tools/bot/hunts_report.ts 100 hard 150`): with the knot at wave 2 (the ROADMAP_V2 proposal) the
immortal Wisp's hazard in waves 0-2 rose by 23% over 300 seeds (+33% on seeds 1-150, +12% on 151-300); the bot that
ignores knots showed +8%, so the cost was the hunt itself right before the first boss. Weight 1.0 and `maxActive` 1
did not move it; `unlockWave` 4 (after the first boss, with the briar line) did. At 4 every Hard target passes: knots
parried 89-100%, hazard of waves 0-2 unchanged and of waves 4-6 -10% to +6%, heroes within 3-9%, median survival
97-100% of the same flags without the hunts, knots 0% and briar lines 1% of deaths.

### `bosses` (dark): the Thorn Mother and the Toller

A GROUP block: `FEATURES.bosses` has no flag of its own; each row (`thorn`, `toller`) is its own switch, so each boss can
be enabled alone (`withFeatures('thorn')`, `withFeatures('toller')`, both: `withFeatures('bosses')`). The sim reads a
row only through `params.thorn` / `params.toller` (null while off); a disabled row is not in the fingerprint (the
fingerprint appends `["bosses", {<enabled rows>}]` only when a row is on). Code: `src/sim/newBosses.ts`, the order and
the kind switches in `src/sim/boss.ts`.

**The boss order.** The cycle is the Eye, the Lich and every ENABLED new boss. With no new boss it is exactly the old
alternation (eye, lich, eye, ...). With one, every cycle of k boss waves holds each boss once, in a Fisher-Yates
permutation driven by an integer hash of (seed, cycle index): no PRNG draw, so spawn schedules do not shift; a new boss
can be the first boss of the night. `bossMet` gets a key for a new kind only while it is enabled; the encounter speed
bonus counts per kind. The score bound (`earliestBossDefeat`) uses the fastest fight over the enabled bosses.

**One attack = one segment**, also for attacks that emit over time (blooms, the three toll rings, the pendulum's two
passes): the segment goes at the launch; the later emissions wait in `boss.pending` (a key only new bosses have) with
the same serial; the next attack's cadence is unchanged; the defeat waits for the queue, her walls and the final
attack's projectiles and beams. Bodies never collide or kill; kill = 1000 + an ember charge, as for the old bosses.

| Thorn Mother (`thorn`) | Value | |
|---|---|---|
| segments, cadence, wind-up | 12, 2.0 s, 0.5 s | top-centre (240, 60) |
| `hedge` (weight 2) | the briar `Wall`, owned by the attack serial: red root line with ONE 44 px gap, 0.75 s telegraph at its edge, 50 px/s (x difficulty speed x encounter bonus), gap within 80% of the walking reach, never through her (24 px) nor into a sigil (else a spore fan) | never with another wall or a curtain alive |
| `bloom` (2) | up to 3 lit ground spots >= 90 px from the hero (60 px apart) during the wind-up; each bursts into 9 (max 10) violet rune shards with ONE gap (>= 0.6 rad and >= 1.6 x the ring spacing, within 0.8 rad of the hero's direction), 0.3 s apart; never in a live wall's gap corridor | blooms <= 3 |
| `lash` (2) | 3 (max 4) red blades over 0.5 rad along the wind-up's line | |
| `spores` (3) | a violet fan of 5 small orbs over 1.2 rad at the hero | |

No knots in her fight; the hunts never start in a boss fight (only her walls exist there). Her walls are drawn by the
briar sprites, restyled into roots (`docs/ASSETS_SPEC.md`), and marked like briar lines (edge gap markers, phone edge
markers).

| The Toller (`toller`) | Value | |
|---|---|---|
| segments, cadence, beat | 14, 1.5 s, 30 ticks | every wind-up and launch on a beat tick; wind-ups in beats (1, the pendulum 2) |
| `toll` (weight 3) | three violet orb rings on three consecutive beats, 9 (max 10) orbs each (<= 30 per toll), 80 px/s; ring 2's gap (>= 1.0 rad, >= 1.6 x the spacing) opens within 0.4 rad of the hero; rings 1 and 3 are turned by 1.7 rad steps (consecutive gaps never overlap): parry 1, walk through 2, parry 3 | |
| `pendulum` (4) | the Eye's beam entity swung out 50 degrees at 55 deg/s (<= 60) from a start line fixed at the wind-up (18-34 px beside the hero) and back to it: two passes of one attack; behind the start line is safe for both | never with a beam alive, never over a toll still ringing (any toll's orbs in flight or rings to come) |
| `knell` (3.5) | a ring of 15 (max 18) red blades at 1.35 x the blade speed with TWO gaps (>= 0.6 rad, >= 1.6 x the spacing) | knell rings alive <= 1 |

The fight reads muted: the bell swings on the beat (an extreme on every beat) and a bone ring widens from it on every
toll; the rings themselves are spaced one beat apart.

**Fairness** (`tests/new_bosses_fair.test.ts`, `tests/new_bosses.test.ts`, `tests/edge_markers.test.ts`): every wind-up
>= 15 ticks; no boss shot appears within 60 px of the hero except a bloom's (a lit ground cue of >= 30 ticks); nothing
in the intro; a WALKING hero (no parry, no dash) gets through every attack alone on 200 seeds from the centre, corners
and edges, and through random sequences of four attacks across attack boundaries (200 seeds per boss); every off-view
bloom, ring, blade, root wall and gap is marked on the phone's window edge >= 15 ticks before it can hit.

**Balance** (`npx vite-node tools/bot/bosses_report.ts 100 hard`; first encounter, the immortal skilled bot, both
heroes; a row override for tuning: `NG_ROWS='{"toller":{"knell":{"weight":2}}}'`): targets 0.3-0.7 deaths per fight
(today's bosses 0.2-0.6), heroes within +-15% of each other in fights survived, fights of 22-32 s; both simple bots beat
each new boss on Easy in >= 8 of 10 (`tests/bossbots.test.ts`). The bots learn the new attacks in `tests/` only, and
only while such a boss is on the field (the pendulum's start line, the space between two ring shots, a dash through a
ring toward the bell).

| Hard, 100 seeds per hero | deaths per fight (knight / wisp) | fights survived (knight / wisp) | fight length |
|---|---|---|---|
| Eye (today) | 0.46 (0.61 / 0.32) | 54% / 71% (24% apart) | 26-29 s |
| Lich (today) | 0.16 (0.22 / 0.10) | 80% / 92% (13% apart) | 26-33 s |
| Thorn Mother | 0.57 (0.62 / 0.52) | 60% / 68% (12% apart) | median 27.6 s (26-33) |
| The Toller | 0.33 (0.48 / 0.17) | 74% / 83% (11% apart) | median 25.7 s (23-26) |

Heroes are compared by fights survived: deaths per fight split by hero are noisy and hero-biased by colour (the
Knight's guard is stronger against violet, the Wisp's longer dash against red; today's Eye is 48% apart the same way).
Rows tuned during the balance pass: bloom shards 10 -> 9 (max 12 -> 10); toll gap 0.6 -> 1.0 rad aimed within 0.4 rad
(the gap of ring 2, as the design asks); knell 12 -> 15 blades (max 18) at 1.35 x speed, weight 3.5; pendulum weight 4.
Rules added: no pendulum over a toll still ringing (any toll); the hedge's gap never through her body; no bloom in a
live wall's gap corridor.

### U3b (dark): `bossOrder`, `bossMotion`, `bossMoves`

Three plain blocks (each its own flag, any combination; `withFeatures('bossOrder')`, `'bossMotion'`, `'bossMoves'`).
Code: `src/sim/boss.ts` (order, the hold and the deferral in `runBoss`), `src/sim/bossMotion.ts`,
`src/sim/tollerMoves.ts`, `src/sim/lichMoves.ts`. Nothing about the bosses' NEW placement or choices draws from the
PRNG: every such choice is an integer hash of (seed, boss start, serial or pick) (`orderHash`, `hashUnit`), so the
spawn schedule of everything else never shifts. The only PRNG use is the existing one: one draw per pattern pick
(the new weights are appended after the old patterns), and the old patterns' own draws.

**`bossOrder`.** Every boss wave draws its kind among all the bosses of the run (the Eye, the Lich, each enabled new
boss): kind(0) = hash(seed, 0) mod k, kind(n) = uniform among the k - 1 OTHER kinds by hash(seed, n), walked from
n = 0 (a pure function of the seed and n). Never the same boss twice in a row; with only the Eye and the Lich it is an
alternation whose first boss is drawn. Shares within 20% of uniform (tested over 2000 seeds x 12 waves). The forced
first boss of the dev preview still works. The score bound is unchanged (same kinds).

**`bossMotion`.** The band: >= 30 px inside the arena, y <= 120 (the upper 43%). Every body is HELD (does not move)
from the start of an attack (the Lich's teleport-out, every wind-up) to its launch, and while a beam or a deferred
emission of the boss lives, so a telegraph fixed at the wind-up start (a start line, a lash's line, spawn points)
always matches its attack. Motion begins at the intro's end.

| Boss | Motion |
|---|---|
| Eye Sentinel | slides at 14 px/s between hashed band targets, each >= 80 px from the hero when picked; bob (2 px, 2.4 s) RENDER ONLY |
| Lich Mage | drifts the same way at 12 px/s (bob render only); its teleports stay as they are (PRNG spots); from a spot outside the band it drifts back in, never a jump |
| Thorn Mother | stands; before every 3rd attack she SINKS (0.6 s, roots pull her down; no marker, no threat) and EMERGES (0.6 s) at a hashed band spot >= 90 px from the hero, then winds up there. The sink comes on top of her cadence |
| The Toller | does not drift; it teleports only with its `peal` |

With the block on (or `bossMoves`, whose peal teleports the Toller), a swinging beam (the Eye's beam, the pendulum) whose safe side (behind its start line) would lie
outside the arena turns the other way (no draw: the drawn sign is flipped). Without that, a body high in the band
with the hero on the top edge left the walking hero no answer; production has the same case once in 200 seeds (Eye,
seed 729, top-right corner), which stays as it is while the block is off.

**`bossMoves`.** New attacks of existing bosses; a row is read only for a boss that exists in the run (the `toller`
rows need `bosses.toller` enabled too, else they are ignored: tested with a sealed row). The old rows are untouched.

| The Toller (`bossMoves.toller`) | Value |
|---|---|
| `peal` (weight 0.55) | 2-beat wind-up (the ring forms as red ticks around the bell); a RING (radius 8) expands from the bell at 90 px/s x difficulty speed x encounter bonus, never slower than leaving the arena in 4.5 s; then the Toller teleports to a hashed band spot (>= 30 px inside, y <= 120) >= 90 px from the hero and its next attack starts 1 beat sooner (`hastenCount` 1, `hastenBeats` 1: 2 beats = 1.0 s instead of 3 beats = 1.5 s; never below 2 beats, always on the beat) |
| `echo` (0.5) | like the peal (no teleport, no hasten), 100 px/s with a floor that keeps its whole life <= 8 s; holds 0.5 s at the farthest arena corner + 20 px (outside the arena), then contracts back to the bell at 70% of its speed; gaps cut persist, a cut on the way back pays nothing. While it is out beyond the hero (until it passed him back) no other attack starts or launches (`ownsReturn`) |
| `chains` (0.6) | the chain lands on the hero's position fixed at the wind-up start, after >= 0.75 s (2 beats); a highlighted circle of 16 px marks it. A hero inside at the landing (the launch: the segment goes there) is BOUND, no damage; a hero who walked out, or is dashing, is not. Variant by hash of the serial (weights 1 : 1): IRON (ash grey): bound 2.0 s, cannot move (the aim still follows the input), the parry works, the dash breaks it at once; cast only while the dash is ready (else a toll starts instead: never a wait, so a held dash key cannot stall the fight), and an iron chain landing on a hero whose dash is on cooldown misses. PARRY-BREAK (violet): bound until 3 parry pulses were fired (every pulse counts, a whiff too) or 5.0 s; the DASH IS DISABLED while bound; the boss then launches only the allowed patterns (`allow`: the toll), one at a time (no start while an earlier hazard lives), its rings 2 beats apart (longer than the 0.9 s parry cooldown) |

**The ring** (`Ring`, `s.rings`, one at a time): a FULL red circle, 2 px half-width, not a ring of orbs. The hero dies
where his circle overlaps the band outside every gap: O(1) (distance to the centre within the band, and the unit
vector centre -> hero outside every gap by a dot product with each gap's direction and its cos / sin; no atan2).
Unparryable to touch; the dash i-frames pass. **Walking cannot pass a full ring: the answers are the parry and the
dash.** The PARRY CUTS it: a pulse whose zone (`inParryZone`, the band's half-width as the radius) covers the ring's
point nearest the hero opens a gap of 0.45 rad there (max 4 per ring, for the ring's life). The first cut of a ring
pays one parry (parryBase x the multiplier, doubled under Double Score; it steps the multiplier when it is the
pulse's first scoring kill and refreshes the chain; never PERFECT, no guard charge); later cuts pay nothing. Slow
Time slows rings like projectiles (never a bind or the chain's timers). Not picked while the hero is within 70 px of
the bell, and a toll at the launch if he is (the ring would reach him with no time to answer).

**One thing at a time.** The peal, the echo and the chains never take the last segment (the defeat never waits for
a long ring or a bind). A drawn new move never STARTS while an earlier hazard (`earlierHazardsAlive`: a projectile,
wall, beam, ring or pending emission) is alive: the Toller keeps the drawn move (no new draw) and starts it on the
first beat the field is clear (a literal filter of the table made them practically never appear: the bell always has
something in flight). While a ring will reach the hero's current distance within 1.5 s (`ring.holdSeconds`), or
passed him less than 0.5 s ago, NO other attack of the boss launches or starts its wind-up (the launch waits for the
Toller's next beat; the cadence is not shortened); this covers the echo's way back.

**The bind** (`Chain`, `s.chain`): derived only from the inputs and the state (replays need nothing more). `sim.ts`
reads it only where the key exists (the block and the Toller enabled): a bound hero's step is 0, the dash is refused
under a parry-break chain, a dash frees an iron one, every pulse counts. The bind ends at once when the boss is
defeated (or its bar is empty), with the run, or at its time (real ticks).

| The Lich (`bossMoves.lich`) | Value |
|---|---|
| `soulfire` (weight 1.4) | a violet orb spiral from where the Lich stood at the launch, over 1.0 s: 10 (max 12) small orbs at 0.95 x the orb speed, each turned >= 0.5 rad (turns x 2 pi / count) from the last, through the deferred queue (one attack, one segment; the defeat waits for the queue) |
| `grasp` (1.5) | 3 (max 3) bone hands at hashed spots >= 90 px from the hero, 60 px apart, 30 px inside the arena, lit for >= 0.75 s (its wind-up); each bursts into a red ring of 6 blades (1.2 x the blade speed) with ONE gap (>= 0.5 rad and >= 1.6 x the ring spacing) centred within 1.0 rad of the hero's direction, 0.3 s apart. Dash or walk through the gap |

The Thorn Mother's new move is her sink and emerge (`bossMotion`).

**Fairness** (`tests/boss_moves_fair.test.ts`, `tests/toller_moves.test.ts`, `tests/lich_moves.test.ts`,
`tests/edge_markers.test.ts`): every wind-up >= 15 ticks; no boss shot within 60 px of the hero uncued (bloom and
grasp blades start on their lit ground cue); with the bodies moving, a beam leaves from the body of its wind-up.
Walking-only solver (200 seeds, centre, corners, edges): every boss's random sequences of four attacks with the body
at random band spots (motion on), and with every block on (the Toller's ring and chains weighed 0); soulfire and grasp
alone. The ring: on 200 seeds (every spot, both heroes, every difficulty) the parry on time and the dash both survive,
and standing still and six walking policies all die to it (unless the walk takes the hero under the bell before the
launch: then it is a toll). The chains: walking out of the spot is never bound; bound, the dash (iron) or the parry
(break) always gets through; bound and idle can die; under a parry-break bind only parryable shots fly, no beam, no
ring, the rings >= 2 beats apart; an iron bind starts with the dash ready. Off-view rings are marked >= 15 ticks before
they can reach the hero (red), an echo's return >= 45 ticks (bone while it is out; the full view marks the arena border
with bone ticks); grasp hands red, soulfire orbs violet.

**Entity caps:** rings <= 1, chains <= 1, soulfire <= 12 orbs per attack, grasp <= 3 hands x 6 blades; the existing
ones unchanged (toll <= 30 orbs, knell rings <= 1, blooms <= 3, walls <= 1).

**Balance** (`NG_FLAGS=bosses,bossOrder,bossMotion,bossMoves npx vite-node tools/bot/bosses_report.ts 50 hard`; row
overrides `NG_ROWS` for the bosses, `NG_MOVES` for bossMoves; first encounter, the immortal skilled bot):

| Hard, 50 seeds per hero | deaths / fight off -> on (knight / wisp on) | fights survived on (knight / wisp) | fight length on (median, range) | new attacks' share of deaths |
|---|---|---|---|---|
| Eye | 0.46 -> 0.25 (0.28 / 0.22) | 78% / 78% | 28.1 s (26-30) | - |
| Lich | 0.15 -> 0.33 (0.48 / 0.18) | 66% / 84% | 28.8 s (27-33) | soulfire 21%, grasp 21% |
| Thorn Mother | 0.44 -> 0.59 (0.66 / 0.52) | 52% / 66% | 32.3 s (30-37) | (her sink is no attack) |
| The Toller | 0.39 -> 0.67 (0.94 / 0.40) | 52% / 68% | 36.3 s (23-51) | echo 4%, peal 1%, chains 0% (binds survived 100%) |

Simple bots (`tests/bossbots.test.ts`, every block on): Easy 8-10 of 10 for both bots and every boss; Medium 8-10 of
10, except the parry bot against the Toller (4 of 10, as without the U3b blocks: its old toll handling). Rows
tuned in the balance pass: new-move weights (peal 2 -> 0.55, echo 1.5 -> 0.5, chains 1.5 -> 0.6), `hastenCount`
2 -> 1, the ring's `minHeroDist` 90 -> 70 (at 90 the hero in the centre, 77 px from the bell, never saw a ring),
`echo.ownsReturn`, soulfire 0.95 x speed (weight 1.4), grasp 3 hands at 1.2 x speed aimed within 1.0 rad. Targets
missed (the rows were tuned, not the targets): the Eye dies 0.25 per fight (< 0.3: the reachable beam side makes its
beam fairer); heroes are 21-24% apart in fights survived for the Lich, the Thorn Mother and the Toller (the old
bosses already split 15-24% without the blocks); the Toller's fights are 36 s at the median (the clear-field waits).
The bots learn the new things in `tests/` only, and only while such a thing exists (a ring, a bind, a grasp hand):
the skilled bot cuts a ring in front of it (keeping its parry for it) or dashes, the heuristic bot dashes across it;
a bound bot parries when parry-bound and dashes when iron-bound.

**Enabling.** `bossOrder`, `bossMotion` and `bossMoves` are separate rules changes; each needs the cut-over of
"Enabling a block". `bossMoves` without the Toller enabled adds only the Lich's moves. Render placeholders (palette
colours only; `docs/ASSETS_SPEC.md`): the ring, the chain and its spot, the grasp hands, the soulfire sparks, the
echo's border ticks.

### Dev preview (`npm run dev` only)

Play dark blocks without editing a file. The parameters are read only when `import.meta.env.DEV` is true: in a
production build the code is dead (`tests/prodbundle.test.ts`).

- `?flags=bosses,knot,briar,patternPack,bossOrder,bossMotion,bossMoves`: any subset by block name (`thorn`, `toller`
  for one new boss);
- `?boss=thorn|toller|eye|lich`: the FIRST boss of the run (an unrecorded option, like `?wave=`; ignored for a disabled
  boss);
- with `?wave=3` the first boss comes at once, `&play=1` skips the title.

Examples: `http://localhost:5173/?flags=bosses&boss=thorn&wave=3`, `http://localhost:5173/?flags=toller&boss=toller&wave=3&play=1`,
`http://localhost:5173/?flags=bosses,knot,briar&wave=3`, the whole of U3b:
`http://localhost:5173/?flags=bosses,bossOrder,bossMotion,bossMoves&play=1` (with `&boss=toller&wave=3` for the
Toller at once). A preview run is never saved, never submitted, never counts as a
best, has no replay, and shows a PREVIEW tag in the HUD.
