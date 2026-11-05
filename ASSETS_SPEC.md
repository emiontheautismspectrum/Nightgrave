# Nightgrave asset spec

Goal: a cohesive dark-fantasy pixel-art look, generated entirely by code (Python + Pillow/numpy) in `tools/`.
Output: `assets/sprites/*.png`, one atlas `assets/atlas/nightgrave.png` + `nightgrave.json` (Phaser JSON hash), plus `assets/backgrounds/`.

## Style rules (strict)
- Internal resolution 480x270. Nearest-neighbor only. No anti-aliasing, no gradients, no sub-pixel.
- Fixed 22-color palette (below). Every pixel must use a palette color (a validator script must enforce this).
- 1 px outline in a darker shade of the fill. Light comes from the top-left. Max 3 shades per material.
- Hero and its effects use warm amber/ember. Hostile things use violet (parryable) or blood red (unparryable).
- Everything threatening must read in under 100 ms against the dark floor.
- Glow is baked (additive-looking dithered halo, 1-2 px) or done in a shader. No blur in the sprite files.

## Palette (hex)
bg0 #0b0d12, bg1 #12161d, fog #1c2330, stone_dark #262e3d, stone #3a4558, moss #2b3a2e, forest #0f1a15, bone #d9d2c0,
amber #ffb347, ember #ff7a2f, gold #ffd86b, blood #d12b3a, blood_dark #6e1423, violet #9b6bff, violet_dark #3d2a78, teal #4fd1c5.
Decor-only: moon #7f93b8 (rim light, reflections), earth #2b221d (dirt, roots), dry #5e4b34 (dead grass, bone shadow, bark).
Ground-only (v3): fern #17281f (teal-green floor), loam #2f241c (worn paths, desaturated), mist #1e2d3c (soft moonlit
floor). Darker than first suggested (#2f4a3a / #243447): an L* ladder bg0 3.6, forest 8.0, fern 14.4, mist 17.6, and a blade keeps >= 2.5 contrast on every ground tone. Allowed in
ground tiles/decals, roots, shadows, ferns, grass, leaves, and as small moss/fern accents (<= 10% of pixels) on props;
never in hero, threat, pickup, caster or UI sprites.

Reserved gameplay colors: amber, ember, gold, blood, blood_dark, violet, violet_dark, teal. Arena decor (sprites in the
`arena` group and all arena backgrounds) must not use them. Exceptions: rune glows and portal flames (telegraph frames),
forest eyes, caster sprites and their spawn effects. No red in decor at all: red only ever means "unparryable".
`validate_palette.py` enforces the palette and the reserved-color rule; `check_readability.py` enforces contrast
(violet >= 3.0, blood >= 2.5 against the ground, fog and vignette included) and a calm central zone.

## Asset list (name: size, frames)
Heroes (16x16 canvas each)
- knight_idle 4f, knight_run 6f, knight_parry 3f, knight_dash 2f, knight_death 6f
- wisp_idle 4f, wisp_pulse 3f, wisp_dash 2f, wisp_death 6f
- hero_shadow 12x6 (soft dither ellipse)

Threats
- orb_small 6x6 2f, orb_large 10x10 2f (violet, parryable)
- rune_shard 8x8 2f (violet)
- blade 16x16 4f spin (blood red, unparryable)
- wraith 16x16 4f, wraith_fade 4f (violet, translucent via dithering)

Effects
- parry_pulse 24x24 4f, parry_spark 4x4 8f, dash_trail 16x16 3f, hit_flash 16x16 2f
- death_burst 32x32 6f, ember_particle 2x2 4 variants, pickup_glow 16x16 4f

Bosses
- eye_sentinel 48x48: idle 4f, charge 3f, hit 2f, death 6f; eye_beam segment 16x4 2f
- lich_mage 32x40: idle 4f, cast 4f, teleport_out 4f, teleport_in 4f, hit 2f, death 6f
- boss_bar 384x10 frame (9-slice style; segments drawn in code, max 15)

Pickups
- pickup_slow_time 12x12 4f (teal hourglass), pickup_double_score 12x12 4f (gold "x2" rune)

Arena v2 (480x270; layout + seeds in `tools/arena_layout.py`, composed by `tools/gen_arena.py`)
- Backgrounds: forest_far, forest_mid (tileable, parallax), forest_near (overhang ring), arena_ground (forest floor, soft
  edge, decals, ritual rune inlay, baked prop shadows), fog_overlay 256x256, vignette. Placed props:
  `assets/data/arena_props.json`; sim layout (arena, portal, hollows, runes): `assets/data/arena_layout.json`.
- rune_glow_0..7 11x11 4f: frame 0 dim carved stone (rest, never violet); frames 1-3 violet telegraph.
- Decor variants (2 frames = 2 shade swaps; flips per instance): gravestones (intact, broken, crosses, slabs, half-sunk),
  dead trees, bones, skulls, grass, thorns, stones, roots, leaves, mushrooms, short fence fragments, gas lamps,
  fallen weapons, workshop props.
- Landmarks: giant_tree (colossal, ~72 px trunk) + giant_tree_crack 4f + glow_mushrooms 3f, rune_sword (ornate, 40+ px
  blade, 4f low pulse) + rune_sword_base; gallows_tree + gallows_cage 4f + crow 4f; hunter_wagon 56x40 3f; cursed_well +
  well_wisp 6f; hunter_cabin + cabin_smoke 6f + cabin_window 3f; portal_altar + altar_flame 4f / altar_flame_tele 4f
  + altar_chain 2f. (v3 removed the beast ribcage and the horse skeleton.)
- Casters: shade 16x20 (idle 4f, rise 6f, cast 3f, dissolve 6f), stalker 20x24 (idle 4f, emerge 6f, cast 3f, vanish 6f),
  portal_ignite 40x40 4f, portal_smoke 24x32 6f, forest_eyes 8x4 3f (rest + bright 2f), forest_leaf_ash 16x16 6f.

Arena softness rules (v2, refined in v3; everything in the arena group)
1. Value hierarchy: ground darkest, props mid-dark, threats/pickups brighter, hero brightest. No bone/moon-bright pixels
   in props except landmark accents (<= 2% of that landmark's pixels). Prop outlines are a DARKER shade of the fill.
2. No fine dithering anywhere in ground, forest, fog, vignette; large flat tonal patches. Coarse 2x2 only on the fog edge.
3. Ground (v4) = an old ruined STONE COURTYARD being reclaimed by the forest (supersedes the v3 forest floor).
   Ground colour ramps (relative luminance, darkest first; one step = the next colour in the same ramp):
   STONE bg0 < bg1 < fog < mist < stone_dark; MOSS forest < fern; SOIL earth < loam.
   Brightness cap inside the arena rect: no ground or decal pixel brighter than stone_dark; `stone` and `moss` are
   never used in the ground (they stay allowed on props). Only exception: tiny `moon` glints on the 2 puddles and on
   the glowing mushrooms.
   Stones: large irregular flagstones (20-44 px) from relaxed seeded Voronoi cells (no bricks, no grid, T/Y joints, no
   long straight seams, no "+" crosses), <= 2 flat tones per stone within one step, neighbours differ by <= 1 step in a
   calm irregular rhythm; joints 1-2 px one step DARKER than the stone (never lighter, joint/stone contrast <= 1.35);
   a 1 px lit top-left edge on <= 15% of stones, one step lighter, never above the cap. Some stones broken, a few
   missing (soil/moss showing), some sunken or tilted (1 px darker bottom-right edge).
   Value structure from large flat shapes: lit zone (upper-left, altar, left of centre), mid zone, shade zone
   (bottom-right, forest edge, under the giant tree); 3-4 diagonal moonbeam patches (stones one step lighter); a wide
   top-left -> bottom-right falloff; flat cast shadows under props (lower-right, 40-60% of the prop width, one step darker).
   Zones: calm centre = the largest stones (36-44 px), fog/mist only, bg1 joints, <= 4 hairline cracks, one step darker
   than its surroundings, faint rune circle; mid ring = medium stones, fern moss in joints/corners, sparse cracks, a few
   sunken stones, 2-4 broken slabs; edges and under trees = stones fragment and sink, fern moss, soil, needle specks and
   root tendrils take over, forest floor along the forest edge; boundary = a broken low curb (fragments with gaps),
   forest floor beyond it, one step darker outside the rect; altar plaza (r ~40 around the altar) = stones laid in a
   subtle concentric pattern, 2-3 slabs with faint carved rune lines; cobble path (8-14 px cobbles, one step darker than
   the flagstones) from the altar to the cabin around the gallows, plus a short branch toward the well; giant tree roots
   lift and crack the flagstones around its base.
   Details (low contrast, clustered): <= 12 hairline cracks (<= 4 in the calm centre), fern moss patches 8-20 px,
   <= 25 joint weeds (ground decals, not props), 3 leaf-litter clusters, needle specks in shade, <= 2 small puddles.
4. Density budget in the arena rect: small decor <= 25, non-landmark trees <= 6, gravestones 8-12 (never overlapping),
   bones/skulls <= 4 and only near the altar and graves, >= 45% of the arena free of prop boxes.
5. Soft edge (moss, roots, half-buried ring stones); ground just outside the rect slightly darker.
6. Forest ring: 3 parallax layers of real tree silhouettes (tapered trunks with branches, varied widths and heights; no
   rectangles, no round blobs) in 3 flat tones with flat translucent mist bands; branches overlap the cabin, the wagon and
   the arena edges in the overhang layer (thin, fading like props when an actor is near).
7. Landmark animations at low amplitude; at most 4 animated landmarks in any 200x120 window.
8. Translucency 35% (45% for props wider than 40 px), render-only.
9. Giant tree (v3): base centre (380,118), ~72 px trunk with deep grooves and knots, a thin pale glowing crack (4f), 6-8
   sinuous roots as ground relief (lit top-left edge, dark underside, 60-110 px, tips at x >= 320), 5-7 tiny pale glowing
   mushroom clusters in root crevices (3f); crown in the forest layers; one tone darker than v2.
10. Small trees (v3): 5 variants 28-44 px (leaning, forked, broken top, hanging vines, low and twisted): thick tapered
   trunk in 3 flat tones, 3-6 sturdy branches ending in clustered twig masses, knotted base with root flares.
11. Wagon (v3): gothic hunter's wagon ~56x40 in 3/4 view: arched dark-wood box, spiked roof rail, two tall leaf-shaped
   windows, iron-banded planks, two large spoked wheels (one broken), shafts on the ground, one hanging lantern (3f),
   torn cloth. No bones.
Noise baseline (re-baselined after the Stage 4 fixups, approved by the author): the stone-courtyard arena with props
measures energy 1.744, busy 31.5% and ground depth 3.00 (std of 32x32 block-mean L*). These absolute values are the
baseline in `check_noise.py` (`ARENA_BASELINE`). A future change fails if it is more than 10% noisier (energy or busy
> 1.10x the baseline) or more than 10% flatter (depth < 0.90x). The older "arena with props <= 1.3x the Stage 0 floor"
and "depth >= 1.5x v3" limits were written for a soft-earth floor and are retired; the like-for-like floor vs Stage 0
(<= 1.3x) and the vs pre-v2 (<= 0.6x) limits stay.
Checks: `tools/check_noise.py` (noise vs Stage 0, the pre-v2 arena and the approved v4 baseline, no fine dither),
`tools/check_layout.py` (budgets, zones, hollows, bones), `tools/check_readability.py` (threats and hero contrast),
`tools/validate_palette.py` (palette, reserved and ground-only colours, bright accents).


UI
- icon_parry 16x16, icon_dash 16x16 (ready/cooldown), panel_9slice 24x24, button_9slice 24x24
- cursor_reticle 9x9 (amber), logo_wordmark (title text in pixel style, uses TITLE constant)
- Font: OFL pixel font via npm (@fontsource/press-start-2p). No bitmap font generation needed.

## Deliverables of the art stage
1. `tools/gen_assets.py` (+ helper modules) that regenerates everything from scratch in one command.
2. `tools/validate_palette.py` that fails if any pixel is off-palette or any sprite breaks size rules.
3. `assets/preview/style_board.png`: one image showing all sprites on the arena at 3x scale for approval.
   `assets/preview/stress_board.png`: hero + ~80 projectiles of all types over the arena at 3x (readability check).
   Arena previews: `arena_board.png` (3x scene), `noise_compare.png` (2x), `squint_test.png`, `translucency_demo.png`,
   `variation_board.png`, `animation_strips.png` (4x), `arena_v3_compare.png`, `ground_closeup.png`, `wagon_closeup.png`.
4. Atlas + JSON consumed by the game through a single `src/render/assets.ts` loader.

## Polish part 1: heroes, reach ring, dash chevron, text
- Knight: idle 4f (breathing: chest rises 1 px on frames 2-3, cape sway, a 1 px amber glint travelling along the visor
  slit), run 6f (head bob on frames 3 and 6, cape flutter, visor glint), parry pose 3f with a 60 ms render-only hit-stop
  when it hits. Effects: `knight_bash` 32x32x4 (shield arc flash in the facing direction: bone -> gold with an amber
  edge, then bone/amber metallic chips), `knight_cloak_trail` 16x16x3 (stone_dark/fog cloak streaks + one bone glint),
  `dust_puff` 8x8x4 (stone/fog, render-only on sharp turns). The Wisp keeps `parry_pulse` (flare) and `dash_trail`
  (flame streak).
- Parry reach ring (both heroes): a 1 px amber circle at 45% alpha, radius = TUNING parry radius (read at runtime, so it
  follows any tuning change), shown only while the parry is active. The hitbox is the same circle for both heroes.
- Dash chevron: a 6 px amber triangle with a dark notch, ~10 px from the hero centre, pointing where a dash would go
  (the sim's own dashDirection); 100% when the dash is ready, 35% on cooldown, hidden during the dash.
- Text: Phaser BitmapText from `public/fonts/px8.png` (tools/gen_font.py: Press Start 2P at 8 px, no anti-aliasing,
  Latin + Greek + Cyrillic; 16 px = 2x nearest); white glyphs tinted to palette colours.
