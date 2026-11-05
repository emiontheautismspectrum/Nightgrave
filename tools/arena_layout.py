"""Arena layout v2 (a calm forest clearing): single source of truth for the art composer and the sim spawn data.

All coordinates are screen px of the 480x270 screen. Landmark positions are the BASE CENTRE of the sprite (where it
touches the ground). tools/nglib/compose.py turns this into ground, forest and placed props; the generator writes
assets/data/arena_layout.json (read by the sim) and assets/data/arena_props.json (read by the renderer).
"""

SEED = 20261105
SCREEN = (480, 270)
ARENA = (48, 27, 432, 243)  # playable rectangle x0, y0, x1, y1 (384x216)
HERO_SPAWN = (240, 135)
BOSS_BAR = (48, 250, 432, 262)
CALM_ZONE = (165, 75, 340, 195)  # nearly flat ground, no props
DESPAWN_MARGIN = 24
OVERHANG_MAX = 8
EDGE_BAND = 10  # soft dark band just outside the rectangle so the clamp still reads

# Ritual inlay (rune bursts still come from its 8 runes)
RITUAL_CENTER = HERO_SPAWN
RITUAL_RADIUS = 76
RUNE_RING_RADIUS = 64

# Portal altar (shade spawn): stays at the author's anchor, alone in the clearing
PORTAL_ALTAR = (120, 78)  # dais centre
PORTAL_CLEAR_RADIUS = 20

# Landmarks: base centres (px)
GIANT_TREE = (378, 125)  # trunk base centre
RUNE_SWORD = (378, 140)  # sword stuck in a small stone base at the foot of the trunk
GALLOWS = (138, 150)
WELL = (362, 172)
WELL_LAMP = (386, 162)  # small bent gas lamp post next to the well
RIBCAGE = (372, 242)  # beast ribcage, bottom-right (kept off the right-side hollows)
WAGON = (270, 44)  # top edge, half behind the forest
WAGON_HORSE = (318, 46)  # horse skeleton beside the wagon
CABIN = (54, 242)  # lower-left, half hidden by the forest (unchanged from the previous arena)
WORKSHOP = [("workbench_0", 46, 26), ("weapon_rack_0", 70, 22), ("crate_0", 36, 28), ("crate_1", 84, 28), ("gas_lamp_0", 96, 28)]
FALLEN_WEAPONS = [("weapon_sword_1", 404, 152), ("weapon_spear_1", 352, 140), ("helmet_0", 396, 160)]
TIGHT_CANVAS_CROWN = True  # the giant tree crown leaves the arena through the top edge

# Forest hollows: gaps in the tree line where stalkers step in (side, position along that side).
# Chosen so that none is within HOLLOW_CLEAR px of a landmark sprite's pixels or a grave's box (generator-checked).
HOLLOWS = [
    ("top", 72), ("top", 162),
    ("bottom", 190), ("bottom", 300),
    ("left", 47), ("left", 139),
    ("right", 180), ("right", 226),
]
HOLLOW_CLEAR = 30
HOLLOW_WIDTH = 18

# Author's dead-tree anchors (percent of the screen). v2 allows at most 6 non-landmark trees: anchors that collide with
# the calm zone, a landmark or a hollow are nudged (smallest move) or dropped; the generator reports both.
DEAD_TREES_PCT = [(22, 76), (40, 83), (43, 21), (38, 61), (71, 80), (76, 47), (68, 19), (60, 68)]
MAX_TREES = 6

# Graves: 8-12 in 2-3 loose clusters (2-4 each) plus singles. Cluster centres (base points) and sizes.
# ((centre), count, (spread x, spread y)) - spreads follow the free space left by the landmarks
GRAVE_CLUSTERS = [((204, 58), 4, (10, 13)), ((246, 230), 4, (14, 10)), ((60, 103), 2, (2, 5))]
GRAVE_SINGLES = [(84, 152), (120, 195)]
GRAVE_LANDMARK_CLEAR = 24
GRAVE_ALTAR_CLEAR = 20
FENCE_FRAGMENTS = 3  # short broken fence fragments placed next to graves

# Small decor budget (<= 25) in loose clusters; Poisson-disc min spacing within a cluster
SMALL_DECOR_CLUSTERS = [((64, 60), 4), ((150, 222), 4), ((300, 70), 3), ((236, 40), 3), ((420, 120), 3), ((110, 112), 3),
                        ((330, 240), 3)]
SMALL_DECOR_MAX = 25
SMALL_DECOR_SPACING = 7
FREE_AREA_MIN = 0.45
AMBIENT_EYES = 7


def pct(p):
    return (round(p[0] * SCREEN[0] / 100), round(p[1] * SCREEN[1] / 100))


def hollow_point(side, pos):
    x0, y0, x1, y1 = ARENA
    return {"top": (pos, y0), "bottom": (pos, y1), "left": (x0, pos), "right": (x1, pos)}[side]

# Render-side alphas (shared by the game, previews and checks via manifest.layout.alphas). PNGs stay binary-alpha
# and palette-pure; these flat layers are made translucent at draw time.
ALPHAS = {"forest_mist": 0.35, "fog_overlay": 0.12, "vignette": 0.35, "vignette_outer": 0.35}
