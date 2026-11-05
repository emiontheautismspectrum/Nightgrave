"""Expected sizes (frame w, frame h, frame count) of every generated asset. The validator enforces this."""

SPRITES = {
    # heroes
    "knight_idle": (16, 16, 4), "knight_run": (16, 16, 6), "knight_parry": (16, 16, 3),
    "knight_dash": (16, 16, 2), "knight_death": (16, 16, 6),
    "wisp_idle": (16, 16, 4), "wisp_pulse": (16, 16, 3), "wisp_dash": (16, 16, 2), "wisp_death": (16, 16, 6),
    "hero_shadow": (12, 6, 1),
    # threats
    "orb_small": (6, 6, 2), "orb_large": (10, 10, 2), "rune_shard": (8, 8, 2),
    "blade": (16, 16, 4), "wraith": (16, 16, 4), "wraith_fade": (16, 16, 4),
    # effects
    "parry_pulse": (24, 24, 4), "parry_spark": (4, 4, 8), "dash_trail": (16, 16, 3),
    "hit_flash": (16, 16, 2), "death_burst": (32, 32, 6), "ember_particle": (2, 2, 4),
    "cursor_reticle": (9, 9, 1),
    # UI
    "icon_parry": (16, 16, 2), "icon_dash": (16, 16, 2), "icon_ring": (20, 20, 13), "parry_fizzle": (12, 12, 4),
}

# Gameplay sprites above; arena decor/landmark/caster sprites are defined by tools/gen_arena.py (layout-dependent).
BACKGROUNDS = {
    "arena_ground": (480, 270), "forest_far": (480, 270), "forest_mid": (480, 270), "forest_mist": (480, 270),
    "forest_near": (480, 270), "forest_overhang": (480, 270), "fog_overlay": (480, 270), "vignette": (480, 270), "vignette_outer": (480, 270),
}
