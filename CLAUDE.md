# Nightgrave (working title)

Dark-fantasy single-arena dodge/parry survival game. Score attack, endless, instant restart.
Inspired by the "one input, instantly addictive" feel of mousedash.net, with a deeper skill ceiling (parry + dash).
The title lives in ONE constant (`TITLE` in `src/config.ts`); it must be trivial to rename. Alternative: Nightspire.

## Design summary
- Genre: fixed single arena, endless survival, no story, English-only UI.
- Hero is a small pixel character. 2 heroes with DIFFERENT mechanics (the heroes pass; this replaced the old
  "cosmetic only" rule). All hero numbers live in `src/data/heroes.ts` (HeroDef: parry radius / arc / kills, dash
  distance, a typed `ability`); the sim dispatches on `ability.kind`, never on a hero name:
  - Knight: shield ARC 120 degrees around the aim, radius 23 (24 before the 0.10.0 aim fix); ability GUARD: +1 charge per successful pulse (max 3); a
    FULL guard absorbs one lethal PARRYABLE hit (charges -> 0, the projectile is destroyed, 0.6 s guard i-frames against
    parryable hits only, no points); unparryables (blades, sigils, beams) always kill, also during guard i-frames; no decay. Dash 80 px.
  - Wisp (ember spirit): full ring, radius 22; dash 100 px; ability EMBER TRAIL: the dash leaves a 0.8 s burning line
    that destroys parryable, non-armored projectiles (max 5 per dash; never the pieces of a split orb the pulse just burst), each 10 x the current multiplier (x2 under
    Double Score); no multiplier step, no reset-timer refresh, not a parry.
  - Frozen by the balance pass (`npx vite-node tools/bot/balance.ts 50`): on Hard the median survival and median score
    of the two heroes are within +-12%. A test-only `classic` hero (full circle 22, dash 80, no ability) keeps the old
    rules for the old golden numbers.
  - FACING (0.10.0, the author's rule: ONLY where the hero goes): `aimX/aimY` in the sim. For every input source
    (cursor, keys, gamepad, stick) the aim becomes this tick's movement intent direction (moveIntent ix, iy) when the
    intended step is >= `aimMinStepFrac` (0.25) x the max step; below it the aim is kept. Anti-jitter: a turn of 90
    degrees or more needs `aimTurnTicks` (2) consecutive above-threshold ticks whose directions agree within 45 degrees.
    A dash never turns it (also with cursor input); initial aim (1, 0). Never a zero / NaN vector.
  - ONE parry zone function (`src/sim/parryZone.ts`): inside = distance <= radius + projectile radius and, below 360,
    angle to the aim <= arc/2 + asin(clamp(r/d, 0, 1)); closer than `overlapPx` (6) always counts. Used by the parry,
    the boss reflect, the PERFECT measure and the renderer (the drawn arc is sampled from it). `isInvulnerable` (dash
    or guard i-frames) is one function for the sim and the renderer. Order: parry, then the trail, then hits.
  - The hero is part of the run: `createState(seed, difficulty, heroId)`, `makeParams(difficulty, hero)`; the replay
    stores it in its CORE (JSON replay v2, binary log format 2 header); a missing / unknown hero or an old-format
    replay is invalid; the verifier and the Worker take the hero from the core and reject a different claimed `hero`.
    Hero code never consumes the PRNG (tests: the PRNG state is unchanged by parries, guard, dashes and trail kills;
    a standing hero gets the identical spawn schedule with either hero; spawns depend on the hero's POSITION, so
    different movement legitimately changes them). One shared daily board.
  - Adding a hero: append its id to `HERO_IDS` (append only: the index is the replay byte), add a HeroDef in `HEROES`
    (two stat lines <= 19 chars), sprites (`<id>_idle`, `_run`, `_dash`, ... in tools/ and the atlas), a new
    `ability` kind + its sim branch only for a new mechanic, a balance run, then bump CLIENT_VERSION (the fingerprint
    covers the hero table) and follow docs/DEPLOY.md "Upgrading the game".
  - Later: Mage, mythical beast.
- ONE HIT = death. Restart in under 1 second by click/Space, with a mini score panel.
- Mood: meditative flow with a competitive score chase.

## Controls
- Mouse (default): hero follows the cursor at a max speed. LMB = Parry. RMB or Space = Dash.
- Keyboard: WASD/arrows move, J or Z = Parry, K or Shift = Dash.
- Gamepad: left stick move, A = Parry, B or RT = Dash.
- Never require the mouse button to move.
- Touch (phones/tablets), mobile UI pass 2: a FIXED on-screen joystick by default ("TOUCH CONTROLS STICK / DRAG" in
  Settings, saved; old saves = Stick; desktop never uses it; src/render/touch.ts, STICK in src/data/input.ts). Portrait:
  base 120 CSS px, knob 56 CSS px, bottom-left of the control strip; landscape: the side margin's bottom corner, 100 CSS
  px when the margin holds it, else 88 (then a little over the arena's corner, translucent); Left-handed mirrors stick
  and buttons. A touch starting in the base + 20 CSS px grabs it (the finger keeps it off the zone until lifted;
  release = centre); 12% dead zone, then the output rises from 0; it is the EXISTING axis input (cursor: false,
  -100..100: replays are plain axis frames, meta.input 'touch'). In Stick mode other touches (not a button) do nothing
  and the drag-only rows (sensitivity, smoothing, second-finger parry) are hidden. touchcancel / focus loss / a mode
  switch release it; a re-layout while held re-anchors it relatively. First run: the card draws the stick and the
  buttons with MOVE / PARRY / DASH labels.
- Touch, Drag mode (the old default): relative drag anywhere moves a virtual cursor from the hero (sensitivity 0.5-3.0,
  default 1.0; lifting keeps it, the next drag continues); the hero follows it like the mouse. Touch smoothing
  (Off / Low / High, default Low; src/data/input.ts, not TUNING): an exponential low-pass on the recorded cursor plus a
  ~2 px jitter dead zone, applied in the input layer BEFORE the per-tick cursor is recorded (replays stay exact). PARRY = large round button
  in the bottom of the right margin (~36 px), DASH = smaller button above it (~28 px); "Left-handed" mirrors them to the
  left margin; buttons never overlap the arena (x 48..432). A tap with a second finger on the arena = PARRY (setting, on
  by default); a single tap of the only finger does nothing. Touch becomes the same per-tick cursor input as the mouse
  (replays identical); the input source is replay metadata only. Pause button at the right end of the top HUD band.
- Phones (Polish 3 + phone UX pass; mobile UI pass 2): landscape plays the full arena. Portrait plays a ZOOMED CAMERA (render-only,
  `src/render/portraitLayout.ts`, `src/render/camera.ts`) on a game screen with the REAL viewport aspect
  (`src/web/screen.ts`: ~280 game px wide at an integer device-px scale, inside the safe area, >= 95% of the height):
  HUD band on top (two rows), the world window in the middle (camera zoom raised until it shows at most the world
  height, crisp; `PORTRAIT.zoom` in `src/data/view.ts` is the floor), the boss bar and the control strip at the bottom
  with PARRY >= 88 and DASH >= 64 CSS px (hit areas +12 CSS px, mirrored by Left-handed, never over the playfield) and
  the stick (the strip is tall enough for its 120 CSS px base);
  smooth follow with a dead zone and a lead (reduced motion or reduced flashes: snappier, no lead); shake follows the
  setting. The pause menu, cards and the death panel stay on the portrait screen. Multi-touch: one finger moves while
  another presses PARRY / DASH. FAIRNESS EDGE MARKERS (`src/render/edgeMarkers.ts`) on the window edge:
  every off-view projectile that can reach the hero within 90 ticks (violet / red, bigger = sooner) and every off-view
  telegraph (runes, casters, sigils, the boss and its wind-up points, beams) for its whole telegraph time; tested:
  every threat first appearing off-view is marked >= 15 ticks before it can hit. Rotating mid-run re-lays out and
  auto-pauses until RESUME (no rotate overlay). Replay / board metadata `view: "full" | "zoomed"` (never affects the
  sim or the verifier; the board shows a phone icon).
- Pause: Esc, P, gamepad Start or the pause button; auto-pause on focus loss / hidden tab.
- Menus by touch (`MenuView`, src/render/ui.ts): every item on every page is tappable; a tap fires on pointer-up over the
  item it went down on, shows a pressed state, and a drag over 10 CSS px cancels it (scrolling never activates).
  Phones in portrait: three bands from the real visible area: the title in the top ~18%, the rows centred in the middle
  band (row spacing grows up to 1.6x the 48 CSS px minimum; info rows take 0.6), a pinned footer panel (controls hint +
  champion block, message <= 2 lines with "...") above the home indicator; a symmetric ~10 CSS px gutter.
  Phones get full-width rows >= 44 CSS px (48 in portrait) with the 16 px font, tappable < > arrows on value rows (tap =
  next value, a horizontal drag steps it), a 44 px BACK and lists that scroll by dragging; portrait menus fill the real
  screen (one column, the arena as a dimmed background). Desktop menus keep their geometry; keyboard, mouse and gamepad
  work as before. A menu tap never reaches the run (the press ends before the run reads input) and vice versa.
- Hints (render-only, never in the sim or the replay): one controls line under PLAY for the active device; on the first
  run per device a card with the controls and "Violet: parry it. Red: dodge or dash." (any input after 250 ms closes it,
  without acting); two one-time contextual hints ("Parry!", "Can't parry - dash!") away from the hero; "Show tips again"
  in Settings. A small amber chevron next to the hero shows where a dash would go (not for the Knight: its arc does).
- Hero visuals (render-only, `src/render/heroView.ts`, `src/render/knightArc.ts`): Knight = a thin always-visible
  shield arc shows the aim: the nominal sim parry zone (centre = the hero's SIM position, radius and arc from HeroDef,
  aim +- arc/2), 1 px crisp violet pixels at ~30% with brighter end pixels, brighter and 2 px thick during the pulse
  (the pulse flash IS the arc), shown while the Knight is alive in a run (also in dashes, frozen while paused); the
  Knight has no dash chevron. Wisp = a ring during the pulse and the dash chevron. Test hook (dev / smoke builds only):
  `window.__nightgrave.arc`. Guard pips above the Knight (a slow pulse when
  full, steady with reduced flashes); guard i-frames blink the hero (steady and dimmed with reduced flashes). Wisp
  ember-trail particles. Sounds `guard_gain`, `guard_ready`, `guard_break`, `trail` (synthesized until files exist).
  Hero select: two stat lines per hero from HeroDef. Dev only: `?hero=knight|wisp` (import.meta.env.DEV).
  The real hit zone is a little more forgiving than the drawn arc (+ projectile radius and the asin(r/d) edge).

## Core mechanics (all values live in `src/data/tuning.ts`, tunable)
- Parry (a skill, Polish 2): pulse radius and arc per hero (see Heroes), active 0.10 s, cooldown 0.9 s after a successful parry and 1.4 s after
  a whiff. Destroys at most 3 parryable projectiles per pulse (nearest first) while they are inside it during the active
  window; each scores as before.
- Dash: rare. 80 px (Knight) / 100 px (Wisp) over 0.2 s, invulnerable only for the first 0.12 s, cooldown 3 s. Needed against unparryable threats.
- Multiplier (fix-multiplier): +0.25 for every SUCCESSFUL pulse (at least one parryable destroyed; an armored crack
  alone does not count), after its first kill has scored. A PERFECT parry (a destroyed projectile inside the parry
  zone whose EDGE is within the hero's radius x closeFraction, e.g. 22 x 0.75 = 16.5 px; ~0.16 s on Medium) adds +0.25 more,
  once per pulse, and shows "PERFECT". Cap x5; every destroyed projectile refreshes the 3 s reset timer; whiffs and
  crack-only pulses neither step nor refresh. Scoring only: survival is unchanged. A hit kills the run.
- Feedback (render-only): a floating "X1.50" / "PERFECT X2.00" label and a "+N" popup per tick, placed clear of the
  hero and every projectile; HUD multiplier by tier (x1 white, x2+ amber, x4+ gold), a pulse on each step, a slow blink
  in the last second before the reset and a dim on reset (no pulse or blink with reduced flashes). Double Score: gold
  score with an X2 tag, a thin breathing gold outline of the arena, a gold ring on pickup, gold point popups.
- Ember charge (boss drop): +0.01 s parry window per charge, cap +0.04 s (max window 0.14 s).
- Score: survival 10 pts/s + parry 25 x multiplier + Wisp trail kills 10 x multiplier + pickups + boss kill fixed 1000.
  `maxPossibleScore` (src/shared/maxScore.ts) bounds every hero (the most kills per pulse of any hero + the trail term).

## Threats
- Orb (straight, parryable), Rune burst (radial ring from ground runes, parryable),
  Blade (spinning arcs, UNPARRYABLE, dash/dodge only), Wraith (slow homing shadow, parryable, fades).
- Polish 2 threats: ARMORED ORB (violet + bone rim, wave 2+): two parries (the first cracks it and pushes it 6 px away,
  no points). SPLITTING ORB (violet, wave 3+): a parry bursts it into 3 small orbs flying outward, never inside the
  hero's hit radius and never toward him. BLOOD SIGIL (red ground hazard, wave 5+): 0.6 s outline telegraph, 1.5 s
  lethal fill, fade; unparryable, dash i-frames pass; at most 2, never under the hero, the arena always keeps a path.
  Bosses keep their own patterns (no new threats in boss fights). Base projectile speeds are +30% vs Stage 4.
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

## Arena (v2: a calm forest clearing)
- Playable rectangle 384x216 at x 48..432, y 27..243 of the 480x270 screen (16:9, 80% height). Hero spawns at (240,135)
  and moves anywhere inside the rectangle (sim clamp). Projectiles are removed 24 px outside it.
- Setting: a moonlit FOREST CLEARING (not a cemetery). Soft, calm, pleasant to look at, like the Stage 0 style board.
  Edge: a soft irregular rim of moss, roots and a few half-buried broken ring stones (no hard curb); the ground just
  outside the rectangle is slightly darker so the clamp still reads. Hollows (2 per side) are dark gaps in the tree line
  where stalkers step in.
- Decor never blocks anything: no colliders. Moon top-left: soft mid-tone rim light only, lower-right shadows, a soft
  moon pool at the centre, flat vignette steps at the edges.
- Calm zone x 165..340, y 75..195: nearly flat ground, no props.
- Portal altar at (120,78) with a 20 px clear radius, standing alone in the clearing; a few graves nearby (8-12 total in
  2-3 loose clusters plus singles) and 2-3 short broken fence fragments. No fenced graveyard.
- Landmarks (base centre = where the sprite touches the ground; small, low-amplitude render-only loops, at most 4 animated
  landmarks in any 200x120 window): colossal ancient tree (top-right, base (380,118)) with sinuous ground roots and pale
  glowing mushrooms, a runed sword stuck in a small stone base at its foot (378,140) and 3 fallen weapons; gallows
  (138,150) with cage and crows; cursed well (362,172) with a bent gas lamp (386,162); gothic hunter's wagon at the top
  edge (270,44) half behind the forest; hunter's cabin with workshop lower-left. No bones in the lower-right; bones and
  skulls only near the altar and graves (<= 4). Original designs only (mood references, no copying).
- Ground (v4): an old ruined stone courtyard reclaimed by the forest: large irregular flagstones (relaxed Voronoi), dark
  joints, calm tones capped at stone_dark; stone gives way to moss, soil and roots toward the edges and under trees;
  concentric altar plaza, cobble path to the cabin and the well, a broken low curb at the rect; depth from large flat
  value zones, moonbeams and a top-left -> bottom-right falloff; the centre is one step darker so the hero pops.
- Draw order: forest far/mid (parallax) -> ground + edge + decals -> ground telegraphs -> y-sorted props, casters, hero,
  projectiles, effects -> fog -> vignette -> forest near overhang (max 8 px into the arena) -> UI.
- Translucency: a prop/overhang drawn in front of the hero, a caster or a projectile (box + 4 px) fades to ~35% alpha
  (~45% for props wider than 40 px) in ~100 ms and back when clear. Render-only; the hero keeps its outline.
- Softness and density rules (values, dithering, budgets) live in docs/ASSETS_SPEC.md and are enforced by
  `tools/check_noise.py`, `tools/check_readability.py` and `tools/validate_palette.py`.

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
- Easy / Medium / Hard differ only by projectile speed and density (Polish 2: Easy 0.65x/0.5x, Medium 0.85x/0.75x,
  Hard 1.1x/1.2x), calibrated with the skilled bot (`npx vite-node tools/bot/balance.ts 50`).
- Only HARD has the online "Today's best" board.

## Leaderboard (Hard only)
- Daily board by UTC date, top 10, champion can leave a short message (max 40 chars) shown on the main screen.
- Daily seed: same projectile sequence for everyone that day (fairness).
- Backend: Cloudflare Worker + D1. Static game on Cloudflare Pages.
- Security: strict length limits, treat all text as untrusted, render with text-only APIs (never innerHTML),
  basic profanity filter, rate limiting, plausibility checks (score <= max possible for run time).
  Replay verification is a later stage.

## Page layout, sharing, legal (Polish 3)
- Desktop: the framed canvas (crisp integer device-pixel scale) with the HTML board panel to its right ("Today's Hard
  best": champion + message, ranks 2-10 with hero / phone icons, your standing via POST /api/daily/me, countdown to
  00:00 UTC; refresh every 60 s, never during a run); narrow windows put the panel under the canvas
  (`src/web/layout.ts`). A short intro plays once per session.
- Installed web app (standalone): apple-mobile-web-app-status-bar-style black-translucent (the page covers the screen,
  env(safe-area-inset-*) keeps canvas, menus and HUD clear of the status bar and the home indicator). The layout is
  measured again on pageshow, visualViewport resize / scroll, orientationchange, 100 / 500 ms after boot and by a 1 s
  watch (iOS may settle the viewport without an event). The portrait game size is also EXACT on the browser's 1/64 CSS
  px grid (exactSize in src/web/screen.ts): an iPhone 14 (DPR 3) otherwise got a canvas of 389.333 CSS px stretched by
  a non-integer factor (soft pixels). tests-e2e/crisp.cjs checks CSS width x DPR = game width x k on phones.
- Phones: no side panel. "BOARD" on the title and the death panel opens a full-screen board overlay (back button, drag
  scroll, Esc / B close it, never during a run). The canvas never pans, zooms, selects or shows callouts (CSS), the
  page uses 100dvh and follows visualViewport resizes; the web manifest is fullscreen in any orientation ("Add to Home
  Screen" removes the browser bars).
- Footer (static HTML, built from `src/legal.ts`): "(c) 2026 <SITE_DOMAIN or The <TITLE> Authors>. Code: MIT. Art and
  audio: all rights reserved." + Privacy, Rules, Credits, License, Source, Contact (hidden while CONTACT_EMAIL is
  empty). Hidden on phones; the in-game Credits screen has the same links.
- Constants next to TITLE in `src/config.ts`: DESCRIPTION, SITE_URL (empty: no og:url / og:image), SITE_DOMAIN,
  SOURCE_URL, CONTACT_EMAIL (never a personal address in the repo). `public/og-image.png` (1200x630) and the favicons
  are generated by `tools/gen_assets.py`.
- Pages `privacy.html`, `rules.html`, `credits.html`, `license.html`: same CSP, a stylesheet file, no script. The
  privacy page must match what the server stores (update both together). LICENSE = MIT for code;
  `assets/LICENSE.md` = art and audio all rights reserved (ElevenLabs terms; the font stays OFL).

## Tech stack
- TypeScript, Phaser 3, Vite, Vitest. Static HTML5 build.
- Pixel font: OFL-licensed (e.g. npm `@fontsource/press-start-2p`).

## Architecture rules
- `src/sim/` = pure deterministic simulation (no Phaser). `src/render/` = Phaser scenes that only read sim state.
- Fixed timestep 60 ticks/s. Seeded PRNG (mulberry32). NEVER use Math.random() or Date.now() in `src/sim/`.
- Input recorded per tick: replay = (seed, difficulty, input log). Same replay => same score.
- Game data in `src/data/`. Internal resolution 480x270, integer scaling, nearest-neighbor.

## Art and audio
- See docs/ASSETS_SPEC.md (art direction, palette, full asset list) and docs/AUDIO_LIST.md (ElevenLabs prompts).
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
3. Full asset pass (docs/ASSETS_SPEC.md), atlas, hookup, juice (hit-stop, shake, particles, fog, vignette).
4. Bosses (Eye, Lich) and pickups.
5. Menus, settings, heroes select, audio hookup with fallbacks, local best scores.
6. Backend leaderboard (Hard daily) + champion message + deploy config.
7. Release: production build, README with deploy steps, screenshots.
