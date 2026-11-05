"""Landmarks (one-off set pieces) and their render-side loop animations. Original designs, moonlit, no reserved colors.

Static bodies return 1 frame; animated overlays return their loop frames.
"""
import math

import numpy as np

from . import canvas as C
from .decor import picket


def _finish(a):
    """v2: darker-shade outline (never a light rim)."""
    return C.outline(a)


# ---------------------------------------------------------------- giant tree + ornate rune sword

GIANT_TREE_BASE = (48, 119)  # trunk base centre inside the 96x120 giant_tree sprite (v3)
GIANT_TREE_CRACK_AT = (52, 46)  # top-left of the glowing crack overlay inside the sprite


def giant_tree():
    """Colossal ancient trunk (v3): ~72 px at the base, rising out of the top of the frame, bark in 3 flat tones
    (bg1 shade / earth mid / dry lit, one tone darker than v2) with deep vertical grooves and a few knots.
    The roots are ground relief (baked into arena_ground); the crown lives in the forest layers."""
    w, h = 96, 120
    a = C.new(w, h)
    cx, base = GIANT_TREE_BASE
    xx, yy = C.grid(w, h)
    t = (base - yy) / base  # 0 at the base, 1 at the top of the frame
    sway = np.sin(t * 3.0) * 3
    half = 26 - 6 * t + np.clip(0.12 - t, 0, None) * 85  # flare to ~36 px half-width at the base
    trunk = (np.abs(xx - cx - sway) <= half) & (yy <= base)
    a[trunk] = C.ci("earth")
    rel = (xx - cx - sway) / np.maximum(half, 1)
    a[trunk & (rel > 0.25)] = C.ci("bg1")  # shaded right side
    a[trunk & (rel < -0.62) & (rel > -0.9)] = C.ci("dry")  # narrow lit band toward the moon
    for g, ph in ((-0.45, 0.0), (-0.12, 1.3), (0.12, 2.1), (0.42, 0.7), (0.7, 1.7)):  # deep vertical grooves
        groove = trunk & (np.abs(rel - g - 0.06 * np.sin(yy / 9.0 + ph)) < 0.05)
        a[groove] = C.ci("bg0")
    for kx, ky, kr in ((-12, 70, 3.2), (14, 40, 2.6), (-4, 22, 2.2)):  # knots
        C.ring(a, cx + kx, ky, kr - 1.2, kr, "bg1")
        C.disc(a, cx + kx, ky, kr - 1.3, "bg0")
    # root flare above ground: short knuckles (the long roots are ground decals)
    for k, (dx, ln) in enumerate(((-30, 10), (-20, 8), (22, 9), (32, 11))):
        for tt in range(3):
            C.line(a, cx + dx, base - 6 + tt, cx + dx + (ln if dx > 0 else -ln) // 2, base + 0, "earth" if tt else "bg1")
    return [_finish(a)]


def giant_tree_crack():
    """Thin vertical glowing crack in the trunk: slow 4f pulse, low amplitude (pale moon accents only)."""
    frames = []
    for i in range(4):
        a = C.new(4, 30)
        for y in range(1, 29):
            x = 1 + (1 if (y // 6) % 2 else 0)
            C.put(a, x, y, "bg0")
        lit = (0, 2, 4, 2)[i]
        for y in range(10 - lit, 18 + lit):
            x = 1 + (1 if (y // 6) % 2 else 0)
            C.put(a, x, y, "moon" if abs(y - 14) <= lit // 2 else "stone")
        frames.append(a)
    return frames


def glow_mushrooms():
    """Tiny cluster of pale glowing mushrooms for root crevices: subtle 3f pulse (moon/bone caps, stone stems)."""
    frames = []
    for i in range(3):
        a = C.new(7, 5)
        caps = ((1, 1), (4, 0), (5, 2))
        for k, (x, y) in enumerate(caps):
            col = "bone" if (k + i) % 3 == 0 else "moon"
            C.put(a, x, y, col)
            C.put(a, x + 1, y, "moon" if i != 1 else "stone")
            C.put(a, x, y + 1, "stone_dark")
        frames.append(a)
    return frames


RUNE_ROWS = (24, 29, 34, 39, 44)


def _sword_body():
    """Ornate runed greatsword, 24x58: ring pommel, wrapped grip, curled quillons, ricasso, fullered 44 px blade."""
    a = C.new(24, 58)
    # ring pommel
    C.ring(a, 12, 3.5, 1.4, 2.9, "stone")
    C.put(a, 13, 4, "stone_dark")
    # wrapped grip
    for y in range(6, 13):
        a[y, 11:13] = C.ci("dry" if y % 2 else "earth")
    # crossguard with curled quillons
    a[13:15, 3:21] = C.ci("stone")
    a[14, 3:21] = C.ci("stone_dark")
    for x, y in ((2, 12), (1, 11), (2, 10), (21, 15), (22, 16), (21, 17)):
        C.put(a, x, y, "stone")
    a[12, 10:14] = C.ci("stone_dark")  # langet
    # ricasso + blade (point hidden in the base)
    for y in range(15, 58):
        half = 3 if y < 52 else max(1, 3 - (y - 52) // 2)
        a[y, 12 - half:12] = C.ci("stone")
        a[y, 12:12 + half] = C.ci("stone_dark")
        if 18 <= y < 52:
            a[y, 12] = C.ci("fog")  # fuller
    for y in RUNE_ROWS:  # carved runes inside the fuller (rest: dark)
        a[y, 11:14] = C.ci("bg1")
        a[y - 1, 11] = C.ci("bg1")
        a[y + 1, 13] = C.ci("bg1")
    return a


def rune_sword():
    """4f slow, LOW-amplitude rune pulse: dark -> faint -> faint with a 2 px pale core -> faint."""
    frames = []
    glow = ["bg1", "stone", "stone", "stone"]
    for i in range(4):
        a = _sword_body()
        for y in RUNE_ROWS:
            for x, yy in ((11, y), (12, y), (13, y), (11, y - 1), (13, y + 1)):
                a[yy, x] = C.ci(glow[i])
        if i == 2:
            C.put(a, 12, RUNE_ROWS[1], "moon")  # landmark accent: 2 px (<= 2% of the sprite)
            C.put(a, 12, RUNE_ROWS[3], "moon")
        frames.append(_finish(a))
    return frames


def rune_sword_base():
    """Small cracked stone base the sword is stuck in."""
    w, h = 28, 10
    a = C.new(w, h)
    xx, yy = C.grid(w, h)
    top = ((xx - 14) / 12.5) ** 2 + ((yy - 4) / 3.2) ** 2 <= 1
    side = (np.abs(xx - 14) <= 12) & (yy > 4) & (yy <= 8)
    a[side] = C.ci("stone_dark")
    a[top] = C.ci("stone")
    a[top & ((xx - 14) > 4)] = C.ci("stone_dark")
    a[2:6, 12:16] = C.ci("bg1")  # slot
    C.line(a, 6, 4, 2, 6, "bg1")
    C.line(a, 20, 3, 25, 5, "bg1")
    for x in (3, 9, 18, 24):
        C.put(a, x, 8, "moss")
    return [_finish(a)]


# ---------------------------------------------------------------- gallows tree, cage, crow

def gallows_tree():
    w, h = 48, 56
    a = C.new(w, h)
    # dead trunk on the left, slightly leaning, with a kink
    for t in range(4):
        C.line(a, 10 + t, 55, 12 + t, 30, "dry" if t == 0 else "earth")
        C.line(a, 12 + t, 30, 9 + t, 6, "dry" if t == 0 else "earth")
    C.line(a, 11, 18, 3, 10, "earth")
    C.line(a, 12, 26, 4, 22, "earth")
    C.line(a, 4, 22, 2, 17, "earth")
    # crossbeam (lashed on) extending right
    a[8:11, 9:44] = C.ci("earth")
    a[8, 9:44] = C.ci("dry")
    C.line(a, 14, 18, 24, 10, "earth")  # brace
    C.line(a, 15, 18, 25, 10, "earth")
    a[7:12, 12] = C.ci("stone_dark")  # iron lashing
    for x in range(8, 18):  # roots
        C.put(a, x, 55, "earth")
    return [_finish(a)]


def gallows_cage():
    """Rope + hanging iron cage, 4f sway (pivot at the top centre)."""
    frames = []
    for i, sway in enumerate((0, 1, 0, -1)):
        a = C.new(14, 26)
        for y in range(0, 9):  # rope
            C.put(a, 7 + (sway * y) // 9, y, "dry")
        cx = 7 + sway
        for y in range(9, 24):
            for x in (cx - 4, cx - 1, cx + 2):  # bars 3 px apart (period-2 bars read as fine stripes)
                C.put(a, x, y, "stone_dark")
        for x in range(cx - 4, cx + 4):
            C.put(a, x, 9, "stone")
            C.put(a, x, 16, "stone_dark")
            C.put(a, x, 23, "stone")
        C.put(a, cx - 1, 8, "stone")
        C.put(a, cx - 3, 12, "dry")  # something left inside
        C.put(a, cx - 2, 19, "dry")
        frames.append(_finish(a))
    return frames


def crow():
    """4f: perched, hop, flap, land."""
    perched = ["........", "...KK...", "..KKKm..", ".KKKKKs.", "KKKKK...", "..s.s..."]
    hop = ["...KK...", "..KKKm..", ".KKKKKs.", "KKKKK...", "..s.s...", "........"]
    flap = ["s.....s.", "sK.KK.Ks", ".KKKKm..", "..KKKKs.", "..KK....", "........"]
    land = ["........", "........", "..KKKm..", ".KKKKKs.", "KKKKKK..", "..s.s..."]
    leg = {"K": "bg0", "m": "stone", "s": "stone_dark"}
    # low amplitude: perched most of the loop, a single small hop and flap
    return [C.outline(C.from_ascii(r, leg), color="bg1") for r in (perched, perched, hop, land)]


# ---------------------------------------------------------------- hunter's wagon + horse skeleton

def hunter_wagon():
    """Gothic hunter's wagon (v3), 56x40 in 3/4 top-down view: arched dark-wood box with a spiked roof rail, two tall
    leaf-shaped windows, iron-banded planks, two large spoked wheels (the rear one broken and tilted), shafts lying on
    the ground, a hanging lantern (3f low flicker) and a torn cloth edge. 3 flat wood tones + iron, darker outline."""
    frames = []
    for i, lamp in enumerate(("moon", "stone", "fog")):
        w, h = 56, 40
        a = C.new(w, h)
        x0, x1 = 10, 46  # box side face
        # roof seen from above (lighter): arched top, then the side face below it
        for y in range(4, 12):
            arch = int(round(2.5 - 2.5 * math.cos((y - 4) / 7 * math.pi / 2)))
            a[y, x0 - 1 + arch:x1 + 1 - arch] = C.ci("earth")
        a[4, x0 + 2:x1 - 2] = C.ci("dry")  # lit roof ridge (moon side)
        for x in range(x0 + 1, x1, 3):  # spiked roof rail
            C.put(a, x, 3, "stone_dark")
            C.put(a, x, 2, "stone")
        a[11, x0:x1] = C.ci("bg0")  # eave shadow
        # side face: vertical dark planks with iron bands
        a[12:28, x0:x1] = C.ci("bg1")
        for x in range(x0 + 2, x1 - 3, 4):  # planks (the last one kept off the outline: no 1-px stripes)
            a[12:28, x] = C.ci("bg0")
        for y in (14, 25):
            a[y, x0:x1] = C.ci("stone_dark")
            for x in range(x0 + 1, x1, 6):
                C.put(a, x, y, "stone")  # rivets
        a[12:28, x0] = C.ci("earth")  # lit front edge
        # two tall gothic leaf-shaped windows
        for wx in (19, 33):
            for y in range(14, 25):  # carved frame (lighter wood) around the leaf-shaped opening
                half = 1 if y == 14 else (2 if y < 18 else 3 if y < 22 else 2)
                a[y, wx - half:wx + half + 1] = C.ci("earth")
            for y in range(15, 24):
                half = 0 if y == 15 else (1 if y < 18 else 2 if y < 22 else 1)
                a[y, wx - half:wx + half + 1] = C.ci("bg0")
            C.put(a, wx - 1, 18, "earth")
            C.put(a, wx, 17, "moon" if i == 0 else "stone")  # tiny glint
        # torn cloth hanging from the roof edge at the back
        for k, ln in enumerate((8, 8, 6, 5, 3)):  # one ragged edge (no alternating strands)
            for y in range(12, 12 + ln):
                C.put(a, x1 - 1 - k, y, "stone_dark")
        # undercarriage + wheels: front wheel intact, rear wheel broken and tilted
        a[28:30, x0 + 2:x1 - 2] = C.ci("bg0")
        for cx_, cy_, r, broken in ((17, 31, 7.0, False), (40, 32, 6.5, True)):
            sq = 0.7 if broken else 1.0
            for k in range(40):
                ang = k / 40 * 2 * math.pi
                if broken and 0.4 < ang < 1.5:
                    continue
                C.put(a, int(round(cx_ + math.cos(ang) * r)), int(round(cy_ + math.sin(ang) * r * sq)), "earth")
                C.put(a, int(round(cx_ + math.cos(ang) * (r - 1))), int(round(cy_ + math.sin(ang) * (r - 1) * sq)), "bg1")
            for k in range(8 if not broken else 4):
                ang = k / 8 * 2 * math.pi + (0.3 if broken else 0)
                C.line(a, cx_, cy_, cx_ + math.cos(ang) * (r - 1), cy_ + math.sin(ang) * (r - 1) * sq, "dry" if k % 2 else "earth")
            a[cy_ - 1:cy_ + 1, cx_ - 1:cx_ + 1] = C.ci("stone_dark")
        # shafts lying on the ground in front (left)
        for k in range(2):
            C.line(a, x0 - 1, 27 + k * 3, 1, 33 + k * 4, "earth")
            C.line(a, x0 - 1, 28 + k * 3, 1, 34 + k * 4, "bg1")
        # hanging lantern (unlit-pale flicker) from the front roof corner
        C.line(a, x0 - 2, 6, x0 - 4, 8, "stone_dark")
        a[9:13, x0 - 6:x0 - 3] = C.ci("stone_dark")
        a[10:12, x0 - 5] = C.ci(lamp)
        frames.append(_finish(a))
    return frames


def horse_skeleton():
    rows = [
        "................................",
        "....................BBB.........",
        "...................BBKBB........",
        "..................BBBBBBD.......",
        ".................BB.....B.......",
        "..BBBBBBBBBBBBBBBB..............",
        ".B.B.B.B.B.B.B.BD...............",
        ".B.B.B.B.B.B.B.B................",
        "..D.D.D.D.D.D.D.................",
        "..BBB.......BBB.................",
        "...B.B.......B.B................",
        "...B..B.......B.B...............",
        "..DDDDDDDDDDDDDDDDD.............",
        "................................",
    ]
    return [_finish(C.from_ascii(rows, {"B": "dry", "D": "earth", "K": "bg0"}))]


# ---------------------------------------------------------------- cursed well + ribcage

def cursed_well():
    w, h = 24, 24
    a = C.new(w, h)
    xx, yy = C.grid(w, h)
    rim = ((xx - 12) / 10.5) ** 2 + ((yy - 9) / 5) ** 2 <= 1
    hole = ((xx - 12) / 7.5) ** 2 + ((yy - 9) / 3.2) ** 2 <= 1
    wall = (np.abs(xx - 12) <= 10.5) & (yy >= 9) & (yy <= 19)
    a[wall] = C.ci("stone_dark")
    for y in range(11, 20, 3):  # masonry courses
        a[y, 2:23] = C.ci("bg1")
    for x in range(4, 22, 5):
        a[12:15, x] = C.ci("bg1")
        a[15:18, x + 2] = C.ci("bg1")
    a[rim] = C.ci("stone")
    a[rim & ((xx - 12) > 5)] = C.ci("stone_dark")
    a[hole] = C.ci("bg0")
    for x in range(3, 22, 3):
        C.put(a, x, 19, "moss")
    return [_finish(a)]


def well_wisp():
    """6f loop: a pale wisp rises out of the water and fades; a ripple spreads on the surface (bottom rows)."""
    frames = []
    for i in range(6):
        a = C.new(12, 20)
        # ripple ring on the water surface (bottom), widening
        r = 1 + i * 0.8
        for k in range(16):
            ang = k / 16 * 2 * math.pi
            if i < 5:
                C.put(a, int(6 + math.cos(ang) * r), int(17 + math.sin(ang) * r * 0.35), "fog" if i > 2 else "stone_dark")
        # wisp: a small pale flame climbing, then dithering out
        y = 15 - i * 2.4
        blob = C.new(12, 20)
        C.disc(blob, 6, y, 2.0 - i * 0.15, "stone")
        C.put(blob, 6, int(y) - 3, "fog")
        C.put(blob, 5, int(y) + 2, "fog")
        keep = 1.0 if i < 3 else (0.5 if i < 5 else 0.25)
        blob = C.dither_out(blob, keep, ox=i)
        m = (blob != C.T) & (a == C.T)
        a[m] = blob[m]
        frames.append(a)
    return frames


def beast_ribcage():
    """Half-buried horned ribcage of a large beast."""
    w, h = 56, 40
    a = C.new(w, h)
    # spine arching along the top
    pts = [(6, 30), (14, 18), (24, 12), (34, 12), (44, 18), (50, 28)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        C.line(a, x0, y0, x1, y1, "dry")
        C.line(a, x0, y0 + 1, x1, y1 + 1, "earth")
    # ribs curving down into the earth
    for k, (sx, sy) in enumerate([(14, 18), (19, 15), (24, 13), (29, 12), (34, 12), (39, 14), (44, 18)]):
        depth = 18 - abs(k - 3) * 2
        for t in range(depth):
            ang = 0.4 + t / depth * 1.2
            x = sx + (math.cos(ang) * 5 if k % 2 else -math.cos(ang) * 3)
            C.put(a, int(x), sy + t, "dry" if t < depth - 4 else "earth")
    # horned skull at the left end, lying in the dirt
    a[28:35, 2:12] = C.ci("dry")
    a[30:32, 4:6] = C.ci("bg0")
    a[33:35, 2:8] = C.ci("earth")
    C.line(a, 4, 28, 1, 20, "dry")  # horns
    C.line(a, 1, 20, 3, 15, "dry")
    C.line(a, 9, 28, 13, 22, "dry")
    C.line(a, 13, 22, 12, 17, "dry")
    C.put(a, 3, 16, "bone")  # landmark accent: pale horn tips (2 px)
    C.put(a, 12, 18, "bone")
    # earth mound burying the lower half
    xx, yy = C.grid(w, h)
    mound = ((xx - 28) / 27) ** 2 + ((yy - 40) / 9) ** 2 <= 1
    a[mound] = C.ci("earth")
    a[mound & (yy > 37)] = C.ci("bg1")  # flat darker foot, no dithering
    return [_finish(a)]


# ---------------------------------------------------------------- hunter's cabin

def hunter_cabin():
    w, h = 64, 56
    a = C.new(w, h)
    # log walls
    for y in range(26, 54):
        a[y, 6:52] = C.ci("earth")
        if y % 3 == 0:
            a[y, 6:52] = C.ci("dry")
    a[26:54, 6] = C.ci("dry")
    # sagging roof: stone_dark shingles, a gap broken through
    for y in range(8, 28):
        sag = int(2 * math.sin((y - 8) / 20 * math.pi))
        x0 = 2 + (27 - y) // 3
        x1 = 56 - (27 - y) // 3
        for x in range(x0, x1):
            yy = y + (sag if 18 < x < 40 else 0)
            if 0 <= yy < h:
                a[yy, x] = C.ci("stone_dark" if (x + y) % 5 else "fog")
    for x in range(2, 57):
        C.put(a, x, 27, "stone")  # roof edge catches the moon
    a[14:19, 26:33] = C.T  # hole in the roof
    a[16:19, 27:32] = C.ci("bg0")
    # stone chimney on the right
    a[2:28, 46:53] = C.ci("stone_dark")
    a[2:28, 46:48] = C.ci("stone")
    for y in range(4, 28, 3):
        a[y, 46:53] = C.ci("bg1")
    a[1, 45:54] = C.ci("stone")
    # door (dark, ajar) and the window frame (glow is an overlay)
    a[38:54, 14:22] = C.ci("bg0")
    a[38:54, 14] = C.ci("dry")
    a[33:40, 32:41] = C.ci("dry")
    a[34:39, 33:40] = C.ci("bg0")
    a[36, 33:40] = C.ci("earth")
    a[54, 4:54] = C.ci("stone_dark")  # foundation
    return [_finish(a)]


CABIN_WINDOW_AT = (33, 34)  # top-left of the window glow overlay inside hunter_cabin
CABIN_SMOKE_AT = (43, -18)  # top-left of the smoke overlay


def cabin_window():
    frames = []
    for i, col in enumerate(("stone", "fog", "stone")):
        a = C.new(7, 5)
        a[:, :] = C.ci(col)
        a[2, :] = C.ci("earth")
        a[:, 3] = C.ci("earth")
        if i == 0:
            a[0, 1] = C.ci("moon")  # landmark accent
        frames.append(a)
    return frames


def cabin_smoke():
    frames = []
    puffs = [(6, 18), (7, 13), (5, 8), (7, 3)]
    for i in range(6):
        a = C.new(12, 20)
        for k, (x, y) in enumerate(puffs):
            yy = y - (i * 5 // 6)
            r = 1.3 + k * 0.5
            col = "stone_dark" if k < 2 else "fog"
            blob = C.new(12, 20)
            C.disc(blob, x + ((i + k) % 3) - 1, yy, r, col)
            m = (blob != C.T) & (a == C.T)
            a[m] = blob[m]
        frames.append(a)
    return frames


# ---------------------------------------------------------------- portal altar

BRAZIERS = [(6, 20), (46, 20), (10, 34), (42, 34)]  # top-left of each altar_flame overlay inside portal_altar
CHAINS = [(8, 4), (44, 4)]  # top-left of each altar_chain overlay
ALTAR_CENTER = (28, 26)  # centre of the dais inlay inside the sprite


def portal_altar():
    w, h = 56, 44
    a = C.new(w, h)
    xx, yy = C.grid(w, h)
    cx, cy = ALTAR_CENTER
    side = (np.abs(xx - cx) <= 20) & (yy >= cy) & (yy <= cy + 6) & (((xx - cx) / 20) ** 2 + ((yy - cy - 6) / 4) ** 2 <= 1.2)
    top = ((xx - cx) / 20) ** 2 + ((yy - cy) / 9) ** 2 <= 1
    a[side] = C.ci("stone_dark")
    a[top] = C.ci("stone")
    a[top & ((xx - cx) + (yy - cy) * 2 > 10)] = C.ci("stone_dark")
    ring = (((xx - cx) / 16) ** 2 + ((yy - cy) / 7) ** 2 <= 1) & (((xx - cx) / 14.5) ** 2 + ((yy - cy) / 6) ** 2 > 1)
    a[ring] = C.ci("fog")
    for k in range(-5, 6):  # cross-shaped rune inlay (the author's cross)
        C.put(a, cx + k, cy, "fog")
    for k in range(-4, 5):
        C.put(a, cx, cy + k // 2 if abs(k) < 4 else cy + (2 if k > 0 else -2), "fog")
    C.put(a, cx - 1, cy - 1, "stone_dark")
    # broken pillars at the back, wrapped in chains (chain overlay animates)
    for px in (8, 44):
        a[4:22, px:px + 5] = C.ci("stone")
        a[4:22, px + 3:px + 5] = C.ci("stone_dark")
        a[4, px + 2] = C.T
        a[4:6, px + 4] = C.T
        a[6, px:px + 2] = C.ci("bg0")
    # ring of skulls and bones around the dais
    for k in range(14):
        ang = k / 14 * 2 * math.pi
        x = int(cx + math.cos(ang) * 24)
        y = int(cy + 3 + math.sin(ang) * 11)
        if 0 <= y < h - 2 and 0 <= x < w - 2:
            if k % 2 == 0:
                a[y:y + 2, x:x + 2] = C.ci("dry")
                C.put(a, x, y + 1, "bg0")
            else:
                C.put(a, x, y + 1, "dry")
                C.put(a, x + 1, y + 1, "earth")
    # 4 small iron braziers (bowls on legs; cold flames are overlays)
    for bx, by in BRAZIERS:
        a[by + 7, bx:bx + 6] = C.ci("stone_dark")
        a[by + 6, bx + 1:bx + 5] = C.ci("stone")
        a[by + 8:by + 10, bx + 1] = C.ci("stone_dark")
        a[by + 8:by + 10, bx + 4] = C.ci("stone_dark")
    return [_finish(a)]


def _flame(col_core, col_edge, i):
    a = C.new(6, 8)
    tip = (2, 3, 2, 3)[i]
    rows = [(tip, 0), (2, 1), (1, 2), (1, 3), (1, 4), (1, 5)]
    for k, (x, y) in enumerate(rows):
        w = 1 if k < 2 else (3 if k < 5 else 4)
        for dx in range(w):
            C.put(a, x + dx + (1 if k < 2 else 0), y + 1, col_edge)
    C.put(a, 2, 5, col_core)
    C.put(a, 3, 4, col_core)
    if i % 2:
        C.put(a, 4, 2, col_edge)
    return a


def altar_flame():
    """Cold ghost flames at rest: a low-amplitude mid-tone flicker (4f); violet only in altar_flame_tele."""
    return [_flame("stone", "stone_dark", i) for i in range(4)]


def altar_flame_tele():
    """The same flames during the portal telegraph: violet (allowed exception)."""
    return [_flame("bone", "violet", i) for i in range(4)]


def altar_chain():
    """Rusty chain wrapped around a pillar, 2f sway."""
    frames = []
    for i in range(2):
        a = C.new(5, 18)
        for y in range(0, 18, 2):
            x = 2 + ((y // 4 + i) % 2) - (1 if y > 12 and i else 0)
            C.put(a, x, y, "dry")
            C.put(a, x, y + 1, "earth")
        C.line(a, 0, 6, 4, 9, "dry")
        frames.append(a)
    return frames
