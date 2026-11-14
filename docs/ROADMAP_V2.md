# Nightgrave roadmap v2 (design only)

Stage 1 of the roadmap: a design document, no gameplay code. Everything below is a proposal until a stage is built,
bot-balanced and reviewed. Related: [ASSETS_SPEC.md](ASSETS_SPEC.md), [AUDIO_LIST.md](AUDIO_LIST.md),
[I18N.md](I18N.md), [DEPLOY.md](DEPLOY.md), [RUNBOOK.md](RUNBOOK.md).

## 1. Diagnosis (code and bot, not guesses)

**How it was measured.** `main` at `41c876a`, `CLIENT_VERSION` 0.10.0, tuning fingerprint `f0214eba`; local only.
Players: the skilled bot (`tests/skilled.ts`: 200 ms reaction, +-2 ticks of timing, aim jitter), the same bot never
parrying, the instant-reaction heuristic bot (`tests/bot.ts`), three naive scripts. Seeds `n * 7919`, n = 1..100,
until death. **[B]** `npx vite-node tools/bot/balance.ts 50`. **[R]** a scratch script (outside the repository, never
committed) counting from `SimState` and `SimEvent`s: survival, wave and boss reached, score terms, multiplier ticks
and resets, parry / whiff / dash events, cooldown-ready ticks, the hero's position in 12 px cells (576), the killer.
**[H]** the same with an "immortal" skilled bot to wave 24: on death the killer is removed and the death counted.

| # | Measured (Hard unless said) | Knight | Wisp | Src |
|---|---|---|---|---|
| 1 | Median run; runs that beat boss 1 / reach wave 8 (after boss 2) / beat boss 3 | 61 s; 42% / 12% / 1% | 58 s; 39% / 11% / 2% | R |
| 2 | Wave hazard, deaths/min: waves 0-2 / 4-6 / 8-10 / 12-14 / 20-22 | 0.5-0.9 / 0.4-2.0 / 1.1-3.1 / 3.0-3.4 / 4.6-5.6 | 0.1-0.7 / 1.0-2.0 / 1.5-4.1 / 3.6-5.5 / 5.5-8.0 | H |
| 3 | Boss hazard, deaths per fight: Eye #1 / #2 / #3; Lich #1 / #2 / #3 | 0.40 / 0.49 / 0.59; 0.20 / 0.29 / 0.28 | 0.61 / 0.41 / 0.60; 0.18 / 0.37 / 0.27 | H |
| 4 | Ticks in the calm zone (25% of the arena); area holding 80% of the time | 94%; 3.0% | 94%; 3.1% | R |
| 5 | Parry pulses per minute (whiffs); dashes per minute; dash ready | 25.3 (7.5%); 1.86; 91.5% of the time | 25.6 (10.3%); 1.83; 91.6% | R |
| 6 | Deaths to violet (parryable) shots; deaths with the dash ready | 84%; 75% | 89%; 77% | R |
| 7 | Score terms: parry (+ trail) / survival / bosses / pickups | 56% / 25% / 17% / 2.5% | 58% / 25% / 15% / 2.5% | R |
| 8 | Mean multiplier; resets per minute; parry points earned at the x5 cap | x2.27; 5.7; 16% (Easy: x1.52; 7.2; 1.4%) | x2.22; 5.7; 17% (Easy: x1.50; 7.1; 0.9%) | R |
| 9 | Median survival, parrying bot vs the same bot never parrying: Easy / Medium / Hard | 94 vs 112 / 60 vs 102 / 62 vs 50 s | 120 vs 164 / 104 vs 104 / 58 vs 50 s | B |
| 10 | Instant-reaction heuristic bot: median run; PERFECT share (skilled bot: 90% / 87%) | 231 s; 71% | 110 s; 40% | R |
| 11 | Naive first run, median: stand still / mash parry / random input | (not run) | Easy 8.2 / 11.8 / 10.7 s; Hard 5.7 / 6.7 / 6.3 s | R |

Caveats: the bot has a weak pull to the centre, so row 4 is a policy as well as a property of the rules. Bots are
models, not players: 100 seeds give roughly +-10% on a median; every target in section 4 is re-measured.

**Where the run is strong.** The first 90 seconds keep adding things (waves 0-2 unlock eight patterns, wave 3 is
the first boss, split orbs debut in wave 4, the sigil in wave 5 at a median 91-93 s [R]). Restart is instant, spawns
obey the 15-tick / 60 px rules, a boss is a fixed 29-32 s set piece [H], the heroes are close on Hard (row 1), and
every board run is verified by re-simulation.

**Where it flattens.**
- **Most runs end before the content does.** Row 1: 88% of human-like Hard runs never see wave 8 (it starts at a
  median 152-154 s); the same bot reaches it in 30-56% of Easy and 35% of Medium runs.
- **After wave 8 the waves still get harder, but nothing is new.** Row 2 climbs until the density cap at wave 20
  (speed caps at wave 12: mean shot speed 156 px/s; spawns grow 3.3 -> 8.5-9.0 per second). From `TUNING`: no
  pattern unlocks after wave 5, every count cap is reached by wave 12; no skilled-bot Hard run got past wave 14.
- **After boss 2 the bosses barely grow.** Row 3: while wave hazard rises at least sixfold, the Lich stays at 0.2-0.4
  deaths per fight and the Eye at 0.4-0.6 (only the Knight's Eye creeps up). At boss 6 a Lich is about 0.5
  deaths/min against 5-8 in the waves around it: a rest, not a peak. A boss only gains `encounterSpeedStep` (+5%,
  cap +20%); its patterns and counts never change.
- **Repetition and an unused arena.** Ten set pieces, and for nine the answer is the same: wait near the centre and
  time one press or one sidestep (only the sigil makes the hero move). Row 4: 80% of the time in 3% of the area.
  Row 6: 84-89% of deaths are a mistimed or swamped parry.
- **The second button is a panic button.** Row 5: one dash per 32 s against a 3 s cooldown; three of four deaths
  happen with the dash unused. The Wisp's "dash burns shots" yields 1.4 kills per run [B].
- **The multiplier is a Hard-only system and never a decision.** Row 8: it resets every 8-11 s; on Easy the stream is
  too thin to hold a chain. Row 9: below Hard, parrying buys score, not life; for the default hero on the default
  difficulty (Knight, Medium) it costs life in the bot's hands (60 s vs 102 s).
- **Reading time dominates.** Row 10: the same movement with zero reaction delay lives 2-4 times longer. Anything
  that adds reaction load (more, faster, smaller) lands on the weakest point, hardest on a zoomed phone window.

**What a top player does that a new player cannot discover** (in the code, not on the screen): PERFECT is "edge
within 0.75 x the parry radius" and doubles the multiplier step, yet nothing shows that radius before the press. A
whiff costs 1.4 s, a hit 0.9 s, a crack-only pulse 0.2 s; the first kill of a pulse pays 25, extra kills 5. Only the
first 0.12 s of a dash is invulnerable; the side behind the Eye beam's start line is safe. Guard i-frames do not stop
red; trail kills never refresh the multiplier; Double Score multiplies it, so holding x5 before the gold pickup is
the big play. And row 11: a first run lasts about 10 s on Easy; the first death arrives before the first lesson.

## 2. Design pillars

1. **One answer per colour, forever.** Violet = parry it, red = dodge or dash. New content changes where and when the
   player answers; it never adds a third answer or a third button.
2. **The first minute is the game.** The median Hard run is 60 s. Anything that only exists after wave 8 ranks below
   anything that changes waves 0-3.
3. **A run is a replay.** Seed + difficulty + hero + input log, nothing else. A choice is a movement or one of the two
   buttons on a tick. What the verifier cannot recompute never touches the score or the board.
4. **Skill is visible before it is required.** Every rule a top player uses gets a cue on the screen.
5. **Make space and both buttons matter.** Prefer ideas that move the hero or give the dash a positive job over one
   more thing to parry in the centre.
6. **Ship alone, switch off in one line.** Each rule block sits behind a data flag whose off state reproduces today's
   golden numbers; one version cut-over per stage; additive formats only.

## 3. Candidate ideas

Scores 1-5, **5 is always best** (risk and cost columns: 5 = lowest risk / cheapest). F fun and depth, I fit with
"one input, instantly addictive", R replay / determinism safety, A art + audio cheapness, B balance safety, P phone
fit, C build cheapness.

| # | Idea (group) | What the player does differently | F | I | R | A | B | P | C | Sum |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | CLOSE CALL (scoring) | A dash whose i-frames cancel a red hit pays and keeps the chain alive | 5 | 5 | 5 | 5 | 3 | 5 | 4 | 32 |
| 2 | Game-speed assist (accessibility) | Easy / Medium at 70-100% speed: render clock only; never on Hard | 3 | 5 | 5 | 5 | 5 | 5 | 4 | 32 |
| 3 | Clarity pass (mastery, onboarding) | Sees the PERFECT ring, EARLY / LATE, what killed them and whether the answer was ready | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 31 |
| 4 | Stepped multiplier decay (scoring) | Loses x1.00 per idle 3 s instead of everything | 3 | 5 | 5 | 5 | 3 | 5 | 5 | 31 |
| 5 | Hex knot (threat) | A violet knot far away on a 4 s fuse: go and parry it, or take its shard ring | 4 | 5 | 5 | 4 | 4 | 4 | 4 | 30 |
| 6 | Boss rush (run structure) | Bosses back to back; a local best, never submitted | 3 | 4 | 5 | 5 | 4 | 5 | 4 | 30 |
| 7 | Golem (hero, original) | Timing: one slow wide pulse (0.22 s, 5 kills, 1.7 s cooldown); weak against dense streams | 3 | 5 | 5 | 3 | 4 | 5 | 4 | 29 |
| 8 | Omens (seed-fair daily modifiers) | Tonight's run has one named twist, the same for everyone, derived from the seed | 4 | 5 | 4 | 5 | 2 | 5 | 4 | 29 |
| 9 | Practice mode + "First night" lesson | Trains one boss or threat, or plays a 20 s scripted lesson; nothing saved or submitted | 3 | 4 | 5 | 4 | 5 | 4 | 3 | 28 |
| 10 | Ember motes (space) | Amber pickups far from the hero pay x multiplier and refresh the chain | 3 | 5 | 4 | 5 | 3 | 4 | 4 | 28 |
| 11 | Verified marks and titles (meta) | Badges (NO DASH, 20 PERFECT) recomputed by the verifier from the replay | 3 | 5 | 4 | 4 | 5 | 4 | 3 | 28 |
| 12 | High-contrast shots, audio / haptic cues (accessibility) | Plain violet gets a dark core dot, red gets spikes and a cross (the bone rim stays "armored"); distinct spawn sounds | 2 | 5 | 5 | 3 | 5 | 5 | 3 | 28 |
| 13 | Skins and grave journal (meta) | Local palette variants and a codex; the skin id is replay metadata only | 2 | 5 | 5 | 3 | 5 | 5 | 3 | 28 |
| 14 | Briar line (threat) | A red wall with one gap sweeps the arena: walk to the gap or dash through | 4 | 5 | 5 | 4 | 3 | 3 | 3 | 27 |
| 15 | Mage (hero) | Timing: the pulse is a ward left on the ground that bursts 0.3 s later; the dash is a blink; nothing reactive up close | 5 | 4 | 4 | 3 | 2 | 4 | 3 | 25 |
| 16 | The Toller (boss 4) | A bell on a beat: parry ring 1, walk through ring 2, parry ring 3 | 5 | 4 | 5 | 2 | 3 | 4 | 2 | 25 |
| 17 | Raven (hero, original) | Movement: weaving; a parry shortens the dash cooldown, a CLOSE CALL the parry cooldown; radius 17, no safety net | 5 | 3 | 4 | 3 | 2 | 4 | 3 | 24 |
| 18 | Boons (run structure) | After a boss, walks into one of two amber circles: the choice is movement already in the log | 3 | 3 | 4 | 4 | 3 | 4 | 3 | 24 |
| 19 | Hart, the moon stag (hero, mythical beast) | Movement: momentum; sprinting widens the ring, standing shrinks it; weak in tight spaces | 4 | 4 | 4 | 3 | 2 | 3 | 3 | 23 |
| 20 | Thorn Mother (boss 3) | A boss about space: briar lines, hex knots, a short red lash | 4 | 4 | 5 | 2 | 3 | 3 | 2 | 23 |

**How every idea meets the hard constraints.**

| Constraint | Rule every idea follows |
|---|---|
| 1 Pure function | New state lives in `SimState`. What must be the same for every player of a seed (omen, boss order, boon offers) is a hash of the seed, never the run PRNG (its stream depends on movement). Choices are movement or the two buttons: no new input type, `LOG_FORMAT` and `REPLAY_VERSION` stay 2. Practice and boss rush use unrecorded options: no replay, never submitted (practice saves nothing, boss rush a local best). |
| 2 Two buttons | No idea adds a button or a hold (buttons are rising edges in the log); every ability rides on PARRY, DASH and movement. |
| 3 Colour | Violet is parryable, red is not, amber / gold / teal stay "good for the hero". New shapes: knot = stationary hollow ring with fuse pips; briar = thorn band with a gap. New edge markers: bone = safe passage, amber = pickup. 22-colour palette, validators unchanged. |
| 4 Art, 5 Portrait | Every sprite comes from `tools/gen_assets.py`; generic folklore names, original bosses. Anything that can be off-view (knots, the briar gap, motes, boon circles) gets an edge marker for its whole telegraph. |
| 6 Strings | Keys in `src/i18n/en.ts` + `ru.ts`; hero names <= 6 letters (MAGE / МАГ, GOLEM / ГОЛЕМ, HART / ОЛЕНЬ, RAVEN / ВОРОН), stat lines <= 19 / 18 characters. |
| 7 Entity caps | Knots <= 2 (burst <= 16 shards), briar lines <= 1, motes <= 2, boon circles <= 2, wards <= 1, Toller rings <= 30 orbs, knell rings <= 1; O(1) collision per entity per tick. |
| 8 Hero parity | A hero ships only when `balance.ts` (50 and 150 seeds, Hard) puts its median survival and score within +-12% of the existing heroes, per omen and per boss once those exist. |
| 9 Flags | Each rule block is a row of a new `src/data/features.ts` with `enabled: false`. It holds everything the block needs (pattern rows, hero rows, omen and boon tables) until enabled; the sim never reads a disabled row (section 6). |

## 4. Recommended order: three packages

First fix what every run touches in minute one (A), then give each night a different texture (B), then add heroes
once the threat set is stable (C): every hero must be re-balanced against every threat, omen and boss. A package can
ship without the others (the first one built brings `features.ts` and its fingerprint rule); two optional parts have
links: boss rush (B5) needs the practice path of A2, and the Raven (C4) stays disabled while `closeCall` is off.
Every enabling pull request also edits CLAUDE.md where it changes a stated rule: A3 (dash "rare", the full reset),
B1 (the trail does not burn knots), B3 (bosses "alternating"), C1 (kills per pulse and window per hero).

### Package A: "First minute"

*Pitch.* You can now see the perfect moment before you press, and the game tells you what killed you and what would
have saved you. Dashing through a red blade at the last instant pays and keeps your chain alive, so both buttons
score. Your first night is a 20-second lesson, and practice never touches your records.

| Stage | Ships | Sim / replay / server impact | Cut-over |
|---|---|---|---|
| A1 Clarity | PERFECT ring (sampled from `parryZone.ts` at radius x `closeFraction`), EARLY / LATE, a death line, run marks on the death panel, speed assist, high-contrast shots, new saves start with the Wisp (open question 1) | Render and storage only; reads `SimEvent`s | No |
| A2 Practice + lesson | PRACTICE on the title (Eye, Lich, single threats); the lesson on first launch | `DirectorOptions` gains unrecorded `only` / `script` (scripted spawns and hint keys exist only there); default runs are byte-identical. No replay, no best, no submit (the `shouldSaveRun` path of the dev start wave); a forged submit fails re-simulation | No |
| A3 Scoring | CLOSE CALL + stepped decay | Scoring only: spawns and the survival of every recorded input log are unchanged; `maxPossibleScore` gains a graze term | 0.11.0 |
| A4 Motes | Ember motes | Consumes the run PRNG (spawn schedules change); the score bound gains a mote term | 0.12.0, paused |

```ts
/** src/data/features.ts (new). A disabled block is not read by the sim and is NOT in the fingerprint (section 6). */
export const FEATURES = {
  /** A lethal overlap with an unparryable threat (blade, lethal sigil, beam) that the DASH i-frames cancelled. */
  closeCall: { enabled: false, points: 15, maxPerDash: 2, refreshChain: true },
  /** At decayAt (state): lose stepLoss, never below the start value, re-arm decayAt = tick + resetSeconds. */
  softDecay: { enabled: false, stepLoss: 1.0 },
  /** Amber walk-over motes, seeded, far from the hero: points x multiplier, refresh the chain. */
  motes: { enabled: false, intervalSeconds: 6, lifeSeconds: 5, maxActive: 2, minHeroDist: 70, edgeInset: 24, radius: 6, points: 10 },
} as const;
/** src/data/practice.ts (new): never read by a normal run. The lesson is a preset with a script. */
export interface PracticePreset { id: string; difficulty: Difficulty; startWave?: number; only?: PatternKey[]; script?: ScriptStep[] }
export interface ScriptStep { atSeconds: number; spawn: ProjectileKind; from: 'left' | 'right'; speedFactor: number; hint?: 'hint.parry' | 'hint.dash' }
```

Rules. CLOSE CALL is the hit loop's own overlap test, evaluated while `tick - dashStart < dashInvuln` (guard i-frames
never count; no pad, so dashing away from a sigil you stand next to pays nothing). Once per threat per dash; it adds
`points x multiplier` (x2 under Double Score) and re-arms the chain; it never steps the multiplier, gives no guard
charge and never consumes the PRNG. Decay: a state field `decayAt` is set to `tick + resetSeconds` by every chain
refresh (a destroyed projectile, a CLOSE CALL, a mote) and by every decay step.

- **Assets:** `ember_mote` 6x6 4f (amber), `close_call_spark` 8x8 4f (amber + bone), `edge_mote` 3x3; the PERFECT ring
  and the high-contrast marks are drawn in code from palette colours. Audio (synthesized fallback first):
  `sfx_close_call` 0.3 s "tight metallic whisper past the ear", `sfx_mote` 0.25 s "small warm ember chime".
- **Strings (en / ru, reviewed per I18N.md):** `fb.early` EARLY / РАНО; `fb.late` LATE / ПОЗДНО; `fb.closeCall`
  CLOSE CALL / НА ВОЛОСОК; `death.by.violet` VIOLET: PARRY WAS READY / ФИОЛЕТОВОЕ: УСПЕЛ БЫ ОТБИТЬ; `death.by.red`
  RED: DASH WAS READY / КРАСНОЕ: РЫВОК БЫЛ ГОТОВ; `death.marks` PERFECT {n}/{m}  CHAIN {s}S; `settings.speed`
  GAME SPEED {pct}%; `settings.contrast` HIGH-CONTRAST SHOTS; `title.practice` PRACTICE / ТРЕНИРОВКА;
  `practice.lesson` FIRST NIGHT / ПЕРВАЯ НОЧЬ; `practice.notSaved` NOT SAVED, NOT ON THE BOARD.
- **Tests:** a pinned fingerprint (`f0214eba` while every block is off); a golden corpus of 20 recorded Hard replays
  (both heroes) whose score and length must not move in A1, A2 or any dark merge; the "survival hash" of
  `tools/bot/multiplier_report.ts` unchanged by A3; the score bound above every bot run (ratio 0.12 today [B],
  target < 0.25); a practice run offers no submit and writes no best; the i18n test and e2e layout loops (en, ru).
- **Bot targets (Hard, 100 seeds, against section 1):** A3, with a graze-seeking skilled bot: dashes per minute
  1.9 -> >= 4; grazes 5-12% of the score; it must not outlive the plain bot by more than 5% (a graze is score, never
  safety); mean multiplier on Easy x1.5 -> >= x2.0; parry points at the cap on Hard 16-17% -> 30-45%; heroes within
  +-12%. A4, with a mote-seeking bot: calm-zone time 94% -> <= 75%, 80%-of-time area 3% -> >= 10%, motes <= 8% of
  the score, survival within +-10% of the non-seeking bot.
- **Rollback:** A1 / A2: revert the pull request (no version involved). A3 / A4: set `enabled` to false and bump the
  version (0.11.1), through the cut-over of section 6; today's fingerprint returns exactly.

### Package B: "Omens and hunts"

*Pitch.* Most nights have an omen, the same for everyone on the board, shown on the title before you start. New
threats make you travel: a knot you must reach before it bursts, a wall of thorns with one gap. Two new bosses can be
the first boss of the night instead of waiting past minute three, where at most one Hard run in ten arrives.

| Stage | Ships | Sim / replay / server impact (each stage is one paused cut-over) |
|---|---|---|
| B1 Hunts | Hex knot (wave 2+), briar line (wave 4+), gap edge marker | `hex_knot`: stationary, body harmless, fuse = its telegraph; a parried knot scores and refreshes the chain but is never PERFECT and gives no guard charge. A `Wall` entity. Both finish during a boss intro; none is created in a boss fight except by the Thorn Mother's own patterns. The score bound counts the knot's shards |
| B2 Omens | Omen table; title, HUD and board header show tonight's omen | `omenOf(seed)`: a hash of the seed, the same rule on every difficulty. Easy / Medium stay omen-free because their render-side seed source re-draws until the omen is `none`; bots and practice pass an unrecorded omen override that the verifier never passes. No new replay or submit field (the Worker and verifier already pin `seed = dailySeed(date)`). The score bound takes the worst case over omens |
| B3 Thorn Mother + seeded boss order | Boss 3, 12 segments: `hedge` (briar line), `seeds` (2-3 knots), `lash` (short red arc), `spores` (violet fan). The boss order becomes a permutation from a hash of the seed | Every launched attack removes exactly one segment; `hedge` is not picked while a line is alive; "final attack gone" includes knots and lines |
| B4 Boons | From the defeat tick: two amber circles on the hero's row, 44 px to each side (both on the free side when a wall is within 60 px); armed after 0.5 s, taken by entering; none in 5 s = an ember charge | The pair is a hash of (seed, boss index). The ember charge moves from the defeat tick to the choice (or 5 s); circles overlap the first 3 s of the next wave. The score bound uses the shortest boon dash cooldown |
| B5 The Toller + boss rush | Boss 4, 14 segments, 1.5 s cadence on a 30-tick beat: `toll` (3 violet rings on 3 beats), `pendulum` (red arc, two passes), `knell` (red ring with two gaps). Boss rush on the practice path | As B3. Boss rush: unrecorded options, no replay, a local best in a new schema-validated save field |

```ts
/** Rows of FEATURES (their pattern rows are read only once enabled). */
knot: { enabled: false, weight: 1.5, unlockWave: 2, maxActive: 2, fuseSeconds: 4, shards: 8, minHeroDist: 90, edgeInset: 30, trailProof: true },
briar: { enabled: false, weight: 1, unlockWave: 4, maxActive: 1, telegraphSeconds: 0.75, speed: 55, halfWidth: 3, gapPx: 44, reachFraction: 0.8 },
/** Changing the omen table is a rules change (paused cut-over). An omen whose block is off is not in the table. */
export interface OmenDef {
  id: 'none' | 'blood_moon' | 'still_night' | 'shattered' | 'ember_rain' | 'hunters_night';
  weight: number;
  /** May move weights, unlock waves, pickup intervals and the first boss; may NEVER raise a count, speed, density or
   *  multiplier cap or kills per pulse (the score bound and the fairness tests rely on those). */
  patterns?: Partial<Record<PatternKey, { weight?: number; unlockWave?: number }>>;
  pickups?: { intervalMinSeconds?: number; slowWeight?: number; doubleWeight?: number };
  firstBoss?: BossKind;
}
export const OMENS: OmenDef[] = [
  { id: 'none', weight: 2 },
  { id: 'blood_moon', weight: 1, patterns: { blades: { weight: 3, unlockWave: 0 }, sigil: { unlockWave: 2 } } },
  { id: 'hunters_night', weight: 1, firstBoss: 'thorn', patterns: { knot: { weight: 3 } } }, // needs the Thorn Mother
];
```

Briar fairness: the line enters from the edge farther from the hero; the gap centre lies within `reachFraction` of the
distance the hero can WALK before it arrives; no sigil is placed in the gap's corridor while a line is alive, and no
line is launched that could still be alive at a boss intro. The dash stays an option, never a requirement.

- **Assets and strings:** `hex_knot` 12x12 4f (violet hollow knot, fuse pips), `briar_tile` 8x8 2f + `briar_post` 8x12
  (blood), `edge_gap` 5x5 (bone), `boon_circle` 18x18 4f (amber) + 5 glyphs, `thorn_mother` 40x48, `toller` 40x56
  (idle 4f, cast 4f, hit 2f, death 6f); `sfx_knot_fuse`, `sfx_knot_burst`, `sfx_briar_creep`, `sfx_boon`, two boss
  intros, `sfx_toll` (the fight must also read muted). Keys: `omen.<id>.name` / `.line` (BLOOD MOON / КРОВАВАЯ ЛУНА,
  STILL NIGHT / ТИХАЯ НОЧЬ, SHATTERED / ОСКОЛКИ, EMBER RAIN / ДОЖДЬ ИСКР, HUNTER'S NIGHT / НОЧЬ ОХОТЫ), `title.omen`
  TONIGHT: {omen} / СЕГОДНЯ: {omen}, `boss.thorn` THORN MOTHER / МАТЬ ТЕРНИЙ, `boss.toller` THE TOLLER / ЗВОНАРЬ,
  `boon.<id>` (5), `practice.rush` BOSS RUSH.
- **Tests:** fairness suite extended (knot >= 90 px from the hero, shards only after the fuse; a walking-only solver
  in the style of `tools/bot/dodge_search.test.ts` survives every briar line on 200 seeds, sigils included); the
  edge-marker audit covers knots, gap markers (>= 45 ticks before arrival) and boon circles; `omenOf` golden values;
  no omen touches a capped field; one segment per boss launch; both simple bots beat each boss on Easy (>= 8 of 10).
- **Bot targets:** the skilled bot parries >= 60% of knots on Hard; the hazard of waves 2 and 4 stays within +15% of
  row 2; per omen: heroes within +-12%, median survival within +-20% of `none`; new bosses at first encounter:
  0.3-0.7 deaths per fight for the immortal bot (row 3 today: 0.2-0.6), heroes within +-15%, fights of 22-32 s.
- **Rollback:** per block (`knot`, `briar`, `omens`, `boons`, each boss), through a paused cut-over. With `omens` off
  every seed maps to `none`; with a boss off the order hash skips it.

### Package C: "New blood"

*Pitch.* Four new ways to play the same two buttons: a Golem with one slow, wide pulse, a Mage who leaves the parry
behind and blinks away, a moon stag that must keep running, a Raven that chains parry into dash into parry. Your
best runs earn marks the board can prove, because the verifier computes them from your replay.

| Stage | Ships | Sim / replay / server impact (C1-C4 are one cut-over each) |
|---|---|---|
| C1 Golem | A hero from data plus per-hero cooldown fields | `HERO_IDS` append (replay byte 2); optional `cooldownSeconds` / `whiffCooldownSeconds` in `HeroDef.parry`; `maxScore.ts` uses the shortest cooldown of any hero; an old Worker refuses the new hero as `invalid` and writes nothing |
| C2 Mage | Ward + blink | The press stores the ward centre and a burst tick; the parry test and the PERFECT measure use that centre through the ONE zone function. A blink is a 1-tick dash; the shared 0.12 s of i-frames cover the landing, so a Mage earns a CLOSE CALL only by blinking onto red |
| C3 Hart | Sprint | Sprint = consecutive ticks whose ACTUAL displacement (after the arena clamp: the same for keys, stick and cursor) is >= 90% of the current maximum step, with per-tick turns under a cosine threshold (no trig). Split-piece speed and the edge markers' closing speed are re-derived from the fastest hero |
| C4 Raven | Weave (needs CLOSE CALL) | A refund lowers the remaining cooldown to a floor, never to zero, and a threat refunds once per run; the score bound becomes `pulses <= n / parryFloor`, `dashes <= n / dashFloor` |
| C5 Marks, skins, journal | Verified marks on the board; local skins and journal | The verifier returns `marks` (a bitmask) with a verified verdict; a submission carrying `marks` is refused as `invalid`; migration `0006_marks.sql` (additive) before the Worker deploy; the privacy page is checked in the same change; the skin id lives in replay `meta` only. Worker deploy, no fingerprint change |

```ts
export type HeroAbility =
  | /* ...existing... */
  | { kind: 'ward'; delaySeconds: number }                                         // Mage: the pulse fires at the cast point
  | { kind: 'stride'; afterSeconds: number; turnCos: number; radiusBonus: number } // Hart: sprinting grows the ring
  | { kind: 'weave'; parryFloorSeconds: number; dashFloorSeconds: number };        // Raven: refunds down to a floor
// Hero rows (start values for the balance pass; they live in FEATURES.heroes.<id> until enabled)
golem: { id: 'golem', name: 'GOLEM', lines: ['WIDE SLOW PULSE', '5 KILLS PER PULSE'], dashDistance: 60, ability: { kind: 'none' },
  parry: { radius: 30, arcDegrees: 360, activeSeconds: 0.22, maxKillsPerPulse: 5, cooldownSeconds: 1.7, whiffCooldownSeconds: 2.2 } },
mage: { id: 'mage', name: 'MAGE', lines: ['WARD BURSTS LATE', 'DASH IS A BLINK'], dashDistance: 70, dashSeconds: 1 / 60,
  parry: { radius: 26, arcDegrees: 360 }, ability: { kind: 'ward', delaySeconds: 0.3 } },
hart: { id: 'hart', name: 'HART', lines: ['RUN TO GROW RING', 'LONG LEAP'], dashDistance: 110, move: { speed: 135, sprintSpeed: 190 },
  parry: { radius: 19, arcDegrees: 360 }, ability: { kind: 'stride', afterSeconds: 0.5, turnCos: 0.5, radiusBonus: 8 } },
raven: { id: 'raven', name: 'RAVEN', lines: ['PARRY READIES DASH', 'RED GRAZE = PARRY'], dashDistance: 60,
  parry: { radius: 17, arcDegrees: 360 }, ability: { kind: 'weave', parryFloorSeconds: 0.3, dashFloorSeconds: 0.8 } },
```

- **Assets and strings:** per hero `<id>_idle` 4f, `_run` 6f, `_parry` (`_cast`) 3f, `_dash` (`_blink`, `_leap`) 2f,
  `_death` 6f on 16x16 (Hart 20x16), warm palette only; skins are palette swaps from the same script (never violet,
  blood or teal); `sfx_golem_pulse`, `sfx_ward_set`, `sfx_ward_burst`, `sfx_blink`, `sfx_hart_sprint`,
  `sfx_raven_ready`. Keys: `hero.<id>.name` / `.short` / `.line1` / `.line2` (МАГ, ГОЛЕМ, ОЛЕНЬ, ВОРОН; lines <= 18),
  `mark.<id>` (NO DASH / БЕЗ РЫВКА, 20 PERFECT / 20 ИДЕАЛЬНЫХ), journal and skin names.
- **Tests and bot targets:** the existing hero suite per new hero (hero code never consumes the PRNG, identical spawn
  schedule for a standing hero, drawn zone = sim zone); `npm run e2e:old-worker`; a chained Raven is invulnerable for
  at most 25% of any 3 s window; only the verifier route can set marks. Each hero first needs its own skilled-bot
  policy (ward lead, sprint laps, weave); then Hard median survival and score within +-12% of the Knight / Wisp pair
  on 50 and 150 seeds, per omen; deaths per fight within +-15% per boss (the Golem parries one Toller ring of three
  and walks the rest); a soft +-25% check on Medium.
- **Rollback:** a hero is never removed from `HERO_IDS` (append only); `FEATURES.heroes.<id>.enabled = false` hides it
  and makes `isHeroId` refuse its byte, through a cut-over. Marks: the board ignores the column.

## 5. What NOT to do

| Rejected | Why |
|---|---|
| A third button (ultimate, item) | Constraint 2; the portrait deck holds the stick and two caps. Every ability above rides on the two buttons. |
| Hold-to-charge or double-tap inputs | The log stores rising edges only; a hold needs a new format and hides the cap under a thumb; a double-tap adds latency to the core verb. |
| Permanent upgrades or currency that change the sim | The board would rank grind. A run stays seed + difficulty + hero + inputs. |
| A card picker that pauses the run | Breaks flow and instant restart and needs input outside the tick log. Boons are walk-over instead. |
| Sim rules that branch on the difficulty (wider parry on Easy) | Difficulties differ only by speed and density. The speed assist is render-only; `omenOf` is the same rule everywhere and omen-free Easy / Medium comes from the seed source. |
| New colours for new threat classes | The colour language and the palette are fixed; new threats differ by shape and motion. |
| Wind, pull fields, inverted controls, darkness | They take control or reading away; row 10 says reading time is already the limit, most of all on a phone. |
| Homing red threats, red rings without a gap | They force a dash on a 3 s cooldown: unavoidable deaths. |
| Content that starts after wave 8; higher density or speed caps | Row 1: 12% of Hard runs would see it. Row 2: late waves are already 5-8 deaths/min; what is flat is novelty and bosses. |
| Client-reported achievements on the board | Spoofable. Only marks the verifier recomputes from the replay are shown. |
| Omens from the clock or locale; accounts, ghosts, PvP | `Date.now()` is forbidden in `src/sim`; the rest is backend, privacy and moderation scope beyond a daily board. |

## 6. Deploy and compatibility plan for package A

**What a sim change touches (from the code).**

- **Fingerprint and version.** `tuningHash()` (`src/sim/replay.ts`) hashes `TUNING`, the hero table, `HERO_RULES` and
  the spawn geometry. Proposal: it also appends the ENABLED rows of `FEATURES`, and nothing when none is enabled. A
  disabled row holds all its data and is never read, so a merge with every block off keeps `f0214eba` (pinned by a
  test) and needs no cut-over; the enabling commit changes the fingerprint and bumps `CLIENT_VERSION`
  (`src/shared/version.ts`; A3: 0.11.0, A4: 0.12.0). One cut-over per stage; A1 and A2 need none.
- **The Worker's strict equality.** After the field checks, `POST /api/submit` answers 409 `outdated` when either
  value differs from its own build, and writes nothing. An old tab against the new Worker and the new page against
  the old Worker both show "GAME UPDATED: RELOAD THE PAGE"; the second is misleading, so submissions are paused
  across the gap (`paused` is answered before every other check).
- **The pending queue.** A pending row stores the fingerprint and version it was accepted under. The verifier is the
  GitHub Action running the default branch: after the merge it SKIPS older rows (`tools/verify/pending.ts`); they
  stay pending until the daily cron expires them after 2 days, sit at the head of the 50-row batch, and turn
  `/api/health` to `"ok":false` after 90 minutes. So the queue is drained with the OLD code first.
- **The daily board on that day.** Verified entries are never re-checked and stay. *Additive* cut-over (A3: spawns
  and survival unchanged, the same play can only score more): at 00:16 UTC, after the 15-minute grace for
  yesterday's runs; entries from 00:00-00:16 are at a disadvantage, never an advantage, and can be beaten. *Paused*
  cut-over (A4, every stage of B, any rollback: anything that changes spawns, survival, the date's omen or boss
  order, or lowers scores): submissions are paused from 23:59 UTC until the new Worker is live, so one date never
  mixes two rule sets; the cost is that yesterday's last-minute and grace submissions are refused.

Package A adds no input and no core field (`REPLAY_VERSION` and `LOG_FORMAT` stay 2) and no D1 migration.

**Order of operations for the author (A3; PowerShell, one line at a time).** Before the day: the pull request is
green and NOT merged; `npm test`, `npm run build`, `npm run smoke`, `npm run e2e:old-worker` pass on its branch.

1. 00:16 UTC. GitHub -> **Actions** -> **verify-replays** -> **...** -> **Disable workflow**.
2. Pause submissions with the OLD Worker code: on the old `main`, set `SUBMISSIONS_ENABLED = "false"` in
   `server/wrangler.toml`, check, deploy. Runs that end during the pause are not kept (the game says so, no retry).

```powershell
git status; git log -1 --oneline; Select-String -Path server\wrangler.toml -Pattern "database_id|SUBMISSIONS_ENABLED"
cd server; npx wrangler deploy; cd ..
```

3. Drain the queue with the OLD code (the token never enters the history). Repeat until it prints
   `verify: nothing pending`; a summary with `skipped` above 0 means the wrong code is checked out:

```powershell
$env:NG_VERIFIER = [System.Net.NetworkCredential]::new('', (Read-Host "Verifier token" -AsSecureString)).Password
$env:API_BASE = "https://nightgrave-api.emiontheautismspectrum.workers.dev"; $env:VERIFIER_TOKEN = $env:NG_VERIFIER; npm run verify:pending
```

4. Merge the pull request on GitHub and wait for the Pages build of `main` (**Workers & Pages** -> **nightgrave** ->
   **Deployments**).
5. Pull. `--autostash` brings your local `database_id` AND the `"false"` back (`git status` must show no conflict);
   stay paused for the first deploy:

```powershell
git checkout main; git pull --autostash; git status; Select-String -Path server\wrangler.toml -Pattern "database_id|SUBMISSIONS_ENABLED"
cd server; npx wrangler deploy; cd ..
```

6. Check the version (expected `"version":"0.11.0"`) and, in the game, that a finished Hard run reports paused
   submissions; then set `SUBMISSIONS_ENABLED = "true"` and deploy again:

```powershell
curl.exe -s https://nightgrave-api.emiontheautismspectrum.workers.dev/api/health
cd server; npx wrangler deploy; cd ..
```

7. GitHub -> **Actions** -> **verify-replays** -> **Enable workflow**, then **Run workflow** once. Open
   https://nightgrave.com, play a Hard run, submit, and watch it go from pending to the board.
8. Close the terminal (it holds the token). If step 6 looked wrong, stay paused and roll back the Worker
   (`npx wrangler rollback`) and the Pages deployment (dashboard); the board keeps showing verified entries.

Rolling a live stage back later is the same list in the other direction, as a paused cut-over: drain with the code
that is LIVE, then merge the pull request that sets `enabled: false` and bumps the version.

**Cached and home-screen installs.** The game registers no service worker, and `public/_headers` gives a long cache
only to `/assets/*` (`index.html` keeps the Pages default, which revalidates), so a normal visit gets the new build.
A tab left open keeps the old bundle: it plays normally and its next Hard submit is refused with "GAME UPDATED:
RELOAD THE PAGE" (that run is not queued). An iOS home-screen app picks the new build up only after it is fully
closed and reopened (DEPLOY.md). Local best scores stay as they are (the save has no rules version); new settings
load with defaults from old saves through the schema validation.

## Open questions (with a recommended answer)

1. **Should new saves start with the Wisp?** Row 9: on Medium (the default) the bot's Knight lives 60 s, the Wisp
   104 s; part of it may be the bot, which turns the Knight by walking at the threat. *Recommendation:* yes in A1
   (new saves only), plus a +-25% Medium check in the balance report.
2. **Do Easy and Medium runs get omens?** *Recommendation:* no (their seed source only hands out `none` seeds); the
   title shows tonight's omen next to the Hard daily seed; practice can offer any omen.
3. **Does boss rush get its own online board?** It needs a `mode` byte in the replay core (log format 3) and a second
   table. *Recommendation:* local only until package B has run for a month.
4. **Does the Wisp's trail burn hex knots?** *Recommendation:* not at first (`trailProof: true`): it gives the trail a
   job but risks hero parity on knot-heavy omens; decide with bot numbers.
5. **Stepped decay on Hard too?** Difficulties may not differ in rules, so it is all or nothing. *Recommendation:*
   yes, if the top decile of Hard bot scores rises by less than 25%; otherwise keep the full reset.
