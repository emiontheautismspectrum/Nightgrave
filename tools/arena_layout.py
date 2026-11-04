"""Arena layout: single source of truth for the art composer (and, from Part C, the sim spawn data).

Screen 480x270. Author anchors are given in percent of the screen (x from left, y from top): px = x*4.8, y*2.7.
Everything here is data; tools/nglib/compose.py turns it into ground, fence runs and placed props.
"""

SEED = 20261104
SCREEN = (480, 270)
ARENA = (48, 27, 432, 243)  # playable rectangle x0, y0, x1, y1 (384x216)
HERO_SPAWN = (240, 135)
BOSS_BAR = (48, 250, 432, 262)
CALM_ZONE = (140, 75, 340, 195)  # central 200x120: no high-contrast ground detail, no props
CURB_THICKNESS = 6
DESPAWN_MARGIN = 24
OVERHANG_MAX = 8

# Ritual inlay (rune bursts still come from its 8 runes)
RITUAL_CENTER = HERO_SPAWN
RITUAL_RADIUS = 76
RUNE_RING_RADIUS = 64

# --- graveyard: author's 32 fence anchors (percent), merged + ordered by compose.fence_polyline()
FENCE_ANCHORS_PCT = [
    (17, 20), (17, 24), (18, 30), (18, 35), (18, 44), (17, 44), (18, 40), (22, 43), (21, 45), (26, 47), (28, 49),
    (31, 47), (20, 49), (21, 52), (25, 52), (30, 51), (33, 49), (32, 42), (33, 37), (33, 34), (34, 29), (33, 23),
    (33, 19), (27, 18), (20, 19), (23, 19), (28, 19), (30, 19), (29, 18), (19, 20), (19, 20), (22, 21),
]
FENCE_MERGE_DIST = 6  # anchors closer than this (px) are merged
GATE_WIDTH = 18  # gap on the bottom side, filled by the double gate (the anchor posts flank it)

PORTAL_ALTAR_PCT = (25, 29)  # the author's cross -> portal altar centre
PORTAL_CLEAR_RADIUS = 28

DEAD_TREES_PCT = [(22, 76), (40, 83), (43, 21), (38, 61), (71, 80), (76, 47), (68, 19), (60, 68)]

# --- landmarks: centre positions in px (guidelines; validated against the calm zone, portal and hollows)
# workshop props in front of the cabin and the wagon's horse (offsets from the landmark centre, px)
WORKSHOP = [("workbench_0", 46, 26), ("weapon_rack_0", 70, 22), ("crate_0", 36, 28), ("crate_1", 84, 28), ("gas_lamp_1", 96, 28)]
WAGON_HORSE = (44, 12)
LANDMARKS = {
    "rune_sword": (404, 100),  # nudged right of the author's dead tree at (365,127)
    "gallows": (403, 52),
    "hunter_wagon": (56, 160),
    "cursed_well": (400, 182),
    "hunter_cabin": (54, 214),
}

# --- forest hollows: gaps in the curb where stalkers step in (side, position along that side in px)
HOLLOWS = [
    ("top", 262), ("top", 362),
    ("bottom", 236), ("bottom", 318),
    ("left", 60), ("left", 120),
    ("right", 150), ("right", 186),
]
HOLLOW_CLEAR = 15  # no prop box may come closer than this to a hollow point (stalkers need a clear doorway)
HOLLOW_WIDTH = 18

# --- density per zone (props per 10,000 px^2) and min spacing for Poisson-like scatter
GRAVESTONES = (24, 30)  # min, max inside the fence (the spec's target)
# Hard floor: with the altar (56x44) and its literal 28 px clear radius inside the author's fence, only ~11 fit;
# the build fails below this floor so a regression cannot silently empty the graveyard.
GRAVESTONES_FLOOR = 10
FIELD_DENSITY = 5.0
FIELD_MIN_SPACING = 18
FOREST_EDGE_DENSITY = 9.0
DECAL_COUNT = {"crack": 16, "moss": 10, "puddle": 3, "stain": 9, "bonedust": 6}
AMBIENT_EYES = 7


def pct(p):
    return (round(p[0] * SCREEN[0] / 100), round(p[1] * SCREEN[1] / 100))


def hollow_point(side, pos):
    x0, y0, x1, y1 = ARENA
    return {"top": (pos, y0), "bottom": (pos, y1), "left": (x0, pos), "right": (x1, pos)}[side]
