# Nightgrave asset spec

Goal: a cohesive dark-fantasy pixel-art look, generated entirely by code (Python + Pillow/numpy) in `tools/`.
Output: `assets/sprites/*.png`, one atlas `assets/atlas/nightgrave.png` + `nightgrave.json` (Phaser JSON hash), plus `assets/backgrounds/`.

## Style rules (strict)
- Internal resolution 480x270. Nearest-neighbor only. No anti-aliasing, no gradients, no sub-pixel.
- Fixed 19-color palette (below). Every pixel must use a palette color (a validator script must enforce this).
- 1 px outline in a darker shade of the fill. Light comes from the top-left. Max 3 shades per material.
- Hero and its effects use warm amber/ember. Hostile things use violet (parryable) or blood red (unparryable).
- Everything threatening must read in under 100 ms against the dark floor.
- Glow is baked (additive-looking dithered halo, 1-2 px) or done in a shader. No blur in the sprite files.

## Palette (hex)
bg0 #0b0d12, bg1 #12161d, fog #1c2330, stone_dark #262e3d, stone #3a4558, moss #2b3a2e, forest #0f1a15, bone #d9d2c0,
amber #ffb347, ember #ff7a2f, gold #ffd86b, blood #d12b3a, blood_dark #6e1423, violet #9b6bff, violet_dark #3d2a78, teal #4fd1c5.
Decor-only: moon #7f93b8 (rim light, reflections), earth #2b221d (dirt, roots), dry #5e4b34 (dead grass, bone shadow, bark).

Reserved gameplay colors: amber, ember, gold, blood, blood_dark, violet, violet_dark, teal. Arena decor (sprites in the
`arena` group and all arena backgrounds) must not use them. Exceptions: rune glows and portal flames (telegraph frames),
forest eyes, caster sprites and their spawn effects. No red in decor at all: red only ever means "unparryable".
`validate_palette.py` enforces the palette and the reserved-color rule; `check_readability.py` enforces contrast
(violet >= 3.0, blood >= 2.5 against the ground, fog and vignette included) and a calm central 200x120 zone.

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

Arena (480x270; layout + seeds in `tools/arena_layout.py`, composed by `tools/gen_arena.py`)
- Backgrounds: forest_far, forest_mid (tileable, parallax), forest_near (overhang ring), arena_ground (ground, curb,
  decals, ritual inlay, baked prop shadows), ground_ritual, fog_overlay 256x256, vignette. Placed props: `assets/data/arena_props.json`.
- rune_glow_0..7 11x11 4f: frame 0 dim carved stone (rest, never violet); frames 1-3 violet telegraph.
- Decor variants (2 frames = 2 shade swaps; flips per instance): gravestones 5 intact + 3 broken + 3 crosses + 2 slabs;
  trees 4 + 2 large; bone piles 4, skulls 2, grass 4, brambles 3, stones 4, roots 3, leaves 3, mushrooms 2;
  fence straight 3, broken 2, leaning 1, corner 2, post 2, double gate 1; gas lamps 2; candles 2; stuck weapons 5; helmet 1;
  workshop: workbench, weapon rack, 2 crates. Ground pieces (baked): flagstone 4, dirt 3, transition 4, curb straight 3,
  corner 2, broken 3; decals: cracks 6, moss 4, puddles 2, stains 3, bone dust 2.
- Landmarks: rune_sword 40x64 4f + rune_sword_base; gallows_tree 48x56 + gallows_cage 4f + crow 4f; hunter_wagon 48x32 3f
  + horse_skeleton; cursed_well 24x24 + well_wisp 6f; beast_ribcage 56x40; hunter_cabin 64x56 + cabin_smoke 6f +
  cabin_window 3f; portal_altar 56x44 + altar_flame 4f (moon) / altar_flame_tele 4f (violet) + altar_chain 2f.
- Casters: shade 16x20 (idle 4f, rise 6f, cast 3f, dissolve 6f), stalker 20x24 (idle 4f, emerge 6f, cast 3f, vanish 6f),
  portal_ignite 40x40 4f, portal_smoke 24x32 6f, forest_eyes 8x4 3f (rest + bright 2f), forest_leaf_ash 16x16 6f.

UI
- icon_parry 16x16, icon_dash 16x16 (ready/cooldown), panel_9slice 24x24, button_9slice 24x24
- cursor_reticle 9x9 (amber), logo_wordmark (title text in pixel style, uses TITLE constant)
- Font: OFL pixel font via npm (@fontsource/press-start-2p). No bitmap font generation needed.

## Deliverables of the art stage
1. `tools/gen_assets.py` (+ helper modules) that regenerates everything from scratch in one command.
2. `tools/validate_palette.py` that fails if any pixel is off-palette or any sprite breaks size rules.
3. `assets/preview/style_board.png`: one image showing all sprites on the arena at 3x scale for approval.
   `assets/preview/stress_board.png`: hero + ~80 projectiles of all types over the arena at 3x (readability check).
   Arena previews: `arena_board.png` (3x scene), `translucency_demo.png`, `variation_board.png`, `animation_strips.png` (4x).
4. Atlas + JSON consumed by the game through a single `src/render/assets.ts` loader.
