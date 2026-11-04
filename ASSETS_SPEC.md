# Nightgrave asset spec

Goal: a cohesive dark-fantasy pixel-art look, generated entirely by code (Python + Pillow/numpy) in `tools/`.
Output: `assets/sprites/*.png`, one atlas `assets/atlas/nightgrave.png` + `nightgrave.json` (Phaser JSON hash), plus `assets/backgrounds/`.

## Style rules (strict)
- Internal resolution 480x270. Nearest-neighbor only. No anti-aliasing, no gradients, no sub-pixel.
- Fixed 16-color palette (below). Every pixel must use a palette color (a validator script must enforce this).
- 1 px outline in a darker shade of the fill. Light comes from the top-left. Max 3 shades per material.
- Hero and its effects use warm amber/ember. Hostile things use violet (parryable) or blood red (unparryable).
- Everything threatening must read in under 100 ms against the dark floor.
- Glow is baked (additive-looking dithered halo, 1-2 px) or done in a shader. No blur in the sprite files.

## Palette (hex)
bg0 #0b0d12, bg1 #12161d, fog #1c2330, stone_dark #262e3d, stone #3a4558, moss #2b3a2e, forest #0f1a15, bone #d9d2c0,
amber #ffb347, ember #ff7a2f, gold #ffd86b, blood #d12b3a, blood_dark #6e1423, violet #9b6bff, violet_dark #3d2a78, teal #4fd1c5.

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
- boss_bar frame 128x8 + fill

Pickups
- pickup_slow_time 12x12 4f (teal hourglass), pickup_double_score 12x12 4f (gold "x2" rune)

Arena (480x270 composed from layers)
- bg_forest_far, bg_forest_mid, bg_forest_near (3 parallax layers of tree silhouettes with fog bands, tileable horizontally)
- ground_ritual 240x240: circular stone platform with 8 runes. This circle is the play area; props stay outside it.
- rune_glow_0..7 11x11 4f: frame 0 = dim carved stone at rest (never violet); frames 1-3 = violet telegraph before a rune burst
- gravestone_a/b/c, crypt_door, dead_tree_a/b, iron_fence_segment, bones_decals
- fog_overlay 256x256 seamless (alpha via dithering), vignette 480x270

UI
- icon_parry 16x16, icon_dash 16x16 (ready/cooldown), panel_9slice 24x24, button_9slice 24x24
- cursor_reticle 9x9 (amber), logo_wordmark (title text in pixel style, uses TITLE constant)
- Font: OFL pixel font via npm (@fontsource/press-start-2p). No bitmap font generation needed.

## Deliverables of the art stage
1. `tools/gen_assets.py` (+ helper modules) that regenerates everything from scratch in one command.
2. `tools/validate_palette.py` that fails if any pixel is off-palette or any sprite breaks size rules.
3. `assets/preview/style_board.png`: one image showing all sprites on the arena at 3x scale for approval.
   `assets/preview/stress_board.png`: hero + ~80 projectiles of all types over the arena at 3x (readability check).
4. Atlas + JSON consumed by the game through a single `src/render/assets.ts` loader.
