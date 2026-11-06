"""The fixed 22-color palette from docs/ASSETS_SPEC.md (16 + 3 decor-only + 3 ground-only). Single source of truth."""

PALETTE = [
    ("bg0", "#0b0d12"),
    ("bg1", "#12161d"),
    ("fog", "#1c2330"),
    ("stone_dark", "#262e3d"),
    ("stone", "#3a4558"),
    ("moss", "#2b3a2e"),
    ("forest", "#0f1a15"),
    ("bone", "#d9d2c0"),
    ("amber", "#ffb347"),
    ("ember", "#ff7a2f"),
    ("gold", "#ffd86b"),
    ("blood", "#d12b3a"),
    ("blood_dark", "#6e1423"),
    ("violet", "#9b6bff"),
    ("violet_dark", "#3d2a78"),
    ("teal", "#4fd1c5"),
    # decor-only colors (never used for gameplay meaning)
    ("moon", "#7f93b8"),
    ("earth", "#2b221d"),
    ("dry", "#5e4b34"),
    # ground-only colors (v3): forest floor, worn paths, moonlit floor
    ("fern", "#17281f"),
    ("loam", "#2f241c"),
    ("mist", "#1e2d3c"),
]

# Ground-only colors: ground tiles/decals, roots, shadows, ferns, grass, leaves; small accents (<= 10%) on props;
# never in hero, threat, pickup, caster or UI sprites.
GROUND_ONLY = {"fern", "loam", "mist"}

# Gameplay colors that arena decor must never use (see docs/ASSETS_SPEC.md).
RESERVED = {"amber", "ember", "gold", "blood", "blood_dark", "violet", "violet_dark", "teal"}

NAMES = [n for n, _ in PALETTE]
IDX = {n: i for i, n in enumerate(NAMES)}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


RGB = [hex_to_rgb(h) for _, h in PALETTE]
RGB_SET = set(RGB)

# "1 px outline in a darker shade of the fill": darker neighbour for every color.
_DARKER = {
    "bg0": "bg0", "bg1": "bg0", "fog": "bg1", "stone_dark": "bg1", "stone": "stone_dark",
    "moss": "forest", "forest": "bg0", "bone": "stone", "amber": "ember", "ember": "blood_dark",
    "gold": "amber", "blood": "blood_dark", "blood_dark": "bg0", "violet": "violet_dark",
    "violet_dark": "bg0", "teal": "stone_dark", "moon": "stone", "earth": "bg0", "dry": "earth",
    "fern": "forest", "loam": "earth", "mist": "bg1",
}
DARKER = [IDX[_DARKER[n]] for n in NAMES]
