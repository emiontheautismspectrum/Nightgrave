# Nightgrave (working title)

Dark-fantasy single-arena dodge/parry survival game. Score attack, endless, instant restart.
Inspired by the "one input, instantly addictive" feel of mousedash.net, with a deeper skill ceiling (parry + dash).
The title lives in ONE constant (`TITLE` in `src/config.ts`); it must be trivial to rename. Alternative: Nightspire.

## Design summary
- Genre: fixed single arena, endless survival, no story, English-only UI.
- Hero is a small pixel character. 2 heroes in MVP (cosmetic difference only, identical stats):
  - Knight: parry = shield flash, dash = cloak dash.
  - Wisp (ember spirit): parry = flare pulse, dash = flame streak.
  - Later (not MVP): Mage, mythical beast.
- ONE HIT = death. Restart in under 1 second by click/Space, with a mini score panel.
- Mood: meditative flow with a competitive score chase.

## Controls
- Mouse (default): hero follows the cursor at a max speed. LMB = Parry. RMB or Space = Dash.
- Keyboard: WASD/arrows move, J or Z = Parry, K or Shift = Dash.
- Gamepad: left stick move, A = Parry, B or RT = Dash.
- Never require the mouse button to move.

## Core mechanics (all values live in `src/data/tuning.ts`, tunable)
- Parry: short pulse, radius ~28 px, active ~0.15 s, cooldown ~0.4 s. Destroys parryable projectiles inside the pulse, grants points and builds the multiplier.
- Dash: rare. ~80 px, ~0.2 s of invulnerability, cooldown ~3 s. Needed against unparryable threats.
- Multiplier: +0.25 per successful parry, cap x5, resets after 5 s without a parry. A hit kills the run.
- Score: survival 10 pts/s + parry 25 x multiplier + pickups + boss kill fixed 1000.

## Threats
- Orb (straight, parryable), Rune burst (radial ring from ground runes, parryable),
  Blade (spinning arcs, UNPARRYABLE, dash/dodge only), Wraith (slow homing shadow, parryable, fades).
- Visual language: parryable = violet, unparryable = blood red. Must be readable at a glance.
- Waves every ~15 s. Endless scaling: +5% speed, +6% density per wave, with caps.
- Casters summon attacks (they are emitters only: not hittable, not lethal, no collision). Their attacks are the
  threats above, so parry/dash rules and colors are unchanged.
  - Shade (portal altar): portal ignites violet (telegraph), a hooded shade rises, idles, casts, dissolves into violet smoke.
  - Stalker (forest hollows): eyes light up (telegraph), a hunched antlered silhouette steps out, idles, casts, melts into the trees.
  - Timing: rise/emerge anim, then idle a seeded 1.0-3.0 s (`casterIdleMinSeconds/MaxSeconds`), cast wind-up >= 15 ticks,
    one attack, dissolve ~0.4 s. A cap on simultaneous casters lives in tuning.
- Fairness (all spawns, incl. casters): >= 0.25 s (15 ticks) from the first visual cue to the first projectile;
  no projectile spawns within 60 px of the hero unless telegraphed; spawn points come from the seeded PRNG only.

## Arena
- Playable rectangle 384x216 at x 48..432, y 27..243 of the 480x270 screen (16:9, 80% height). Hero spawns at (240,135)
  and moves anywhere inside the rectangle (sim clamp). Projectiles are removed 24 px outside it.
- Border: low mossy, cracked stone curb (~6 px), broken in places. Gaps ("hollows", 2 per side) are where stalkers step in.
- Decor never blocks anything: no colliders. Moonlit night, moon top-left: cold 1 px `moon` rim light on top-left edges,
  hard dithered shadows lower-right, a soft "moon pool" of lighter ground at the centre, vignette at the edges.
- Zones: GRAVEYARD upper-left inside a wrought-iron fence (author anchors in `tools/arena_layout.py`, gate on the bottom
  side) with ~24-30 gravestones and the PORTAL ALTAR (shade spawn, at (120,78), 28 px clear radius); OPEN FIELD (centre
  and right, calm, keeps the ritual runes); DARK FOREST outside the curb (3 parallax layers, fog, roots, eyes).
- Landmarks (final set, one each, small render-only loops): giant rune sword with a field of fallen weapons, gallows tree
  with cage and crows, hunter's wagon, cursed well with a beast ribcage, hunter's cabin with workshop props.
  Keep the central 200x120 calm zone and the portal clear. Original designs only (mood references, no copying).
- Draw order: forest far/mid (parallax) -> ground + curb + decals -> ground telegraphs -> y-sorted props, casters, hero,
  projectiles, effects -> fog -> vignette -> forest near overhang (max 8 px into the arena) -> UI.
- Translucency: a prop/overhang drawn in front of the hero, a caster or a projectile (box + 4 px) fades to ~35% alpha in
  ~100 ms and back when clear. Render-only; the hero keeps its outline.

## Bosses (MVP: 2)
- Eye Sentinel: rotating ring and beam patterns, spawns orbs.
- Lich Mage: teleports, summons wraiths, orb fans.
- A boss appears every 4th wave, alternating.
- Boss health is a segmented bar below the arena (x 48..432, y 250..262), spanning the arena width (classic boss bar).
- Boss HP = number of attacks it will make: 12 segments by default (tunable range 10-15, can differ per boss).
  Each boss attack (one pattern cast, a thrust or a strike) removes exactly 1 segment.
- The player survives each attack by dodging, dashing or parrying (reflecting). Both ways are valid.
- Reflect bonus (extra segments removed on a reflected projectile) exists in tuning but defaults to 0 (off).
- Attack cadence ~1 attack per 2 s (tunable), so a boss fight lasts roughly 20-30 s.
- Bar empty = boss defeated: fixed 1000 score + a strong stacking drop (placeholder: "ember charge", longer parry window for the run).
- No retreat timer: the fight ends only when the bar is empty or the player dies.

## Pickups on the map (MVP)
- Slow Time (teal): projectiles at 50% speed for 6 s.
- Double Score (gold): x2 points for 10 s.
- Shield is NOT in MVP (planned later as a bonus).

## Difficulty
- Easy / Medium / Hard differ only by projectile speed and density (Easy 0.8x/0.7x, Medium 1.0x/1.0x, Hard 1.25x/1.4x).
- Only HARD has the online "Today's best" board.

## Leaderboard (Hard only)
- Daily board by UTC date, top 10, champion can leave a short message (max 40 chars) shown on the main screen.
- Daily seed: same projectile sequence for everyone that day (fairness).
- Backend: Cloudflare Worker + D1. Static game on Cloudflare Pages.
- Security: strict length limits, treat all text as untrusted, render with text-only APIs (never innerHTML),
  basic profanity filter, rate limiting, plausibility checks (score <= max possible for run time).
  Replay verification is a later stage.

## Tech stack
- TypeScript, Phaser 3, Vite, Vitest. Static HTML5 build.
- Pixel font: OFL-licensed (e.g. npm `@fontsource/press-start-2p`).

## Architecture rules
- `src/sim/` = pure deterministic simulation (no Phaser). `src/render/` = Phaser scenes that only read sim state.
- Fixed timestep 60 ticks/s. Seeded PRNG (mulberry32). NEVER use Math.random() or Date.now() in `src/sim/`.
- Input recorded per tick: replay = (seed, difficulty, input log). Same replay => same score.
- Game data in `src/data/`. Internal resolution 480x270, integer scaling, nearest-neighbor.

## Art and audio
- See ASSETS_SPEC.md (art direction, palette, full asset list) and AUDIO_LIST.md (ElevenLabs prompts).
- All art is generated by scripts in `tools/` (Python + Pillow/numpy), output to `assets/`. Deterministic and re-runnable.
- If an audio file is missing, fall back to a simple synthesized sound and keep running.

## Workflow rules
- Work in stages; after each: tests, build, commit.
- After every meaningful change run an adversarial review: a fresh, read-only reviewer that tries to break it
  (determinism, edge cases, input handling, security of the backend). Fix real findings before the next stage.
- Keep context small; do not re-read large files needlessly.
- Code, comments, commits and configs in English only. No copyrighted characters, music or assets.

## Stages
0. Art pipeline + style board (palette, hero, arena, projectiles) so the style can be approved early.
1. Core sim: cursor movement, parry, dash, one-hit death, deterministic loop, replay log, tests.
2. Threats, waves, difficulty, scoring, multiplier, instant restart.
3. Full asset pass (ASSETS_SPEC.md), atlas, hookup, juice (hit-stop, shake, particles, fog, vignette).
4. Bosses (Eye, Lich) and pickups.
5. Menus, settings, heroes select, audio hookup with fallbacks, local best scores.
6. Backend leaderboard (Hard daily) + champion message + deploy config.
7. Release: production build, README with deploy steps, screenshots.
