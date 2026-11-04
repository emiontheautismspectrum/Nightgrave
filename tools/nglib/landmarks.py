"""Landmarks (one-off set pieces) and their render-side loop animations. Original designs, moonlit, no reserved colors.

Static bodies return 1 frame; animated overlays return their loop frames.
"""
import math

import numpy as np

from . import canvas as C
from .decor import picket


def _finish(a):
    return C.moonlit(a)


# ---------------------------------------------------------------- giant rune sword

RUNE_ROWS = (26, 31, 36, 41, 46, 51)


def _sword_body():
    a = C.new(40, 64)
    # pommel + grip
    a[2:6, 18:22] = C.ci("stone")
    a[3:5, 21] = C.ci("stone_dark")
    for y in range(6, 17):
        a[y, 19:21] = C.ci("earth" if y % 2 else "dry")
    # crossguard: wide, drooping ends
    a[17:20, 6:34] = C.ci("stone")
    a[19, 6:34] = C.ci("stone_dark")
    a[20:22, 6:9] = C.ci("stone_dark")
    a[20:22, 31:34] = C.ci("stone_dark")
    # blade, point down into the base (bottom rows are hidden by the base sprite)
    for y in range(20, 64):
        half = 4 if y < 56 else max(1, 4 - (y - 56) // 2)
        a[y, 20 - half:20] = C.ci("stone")
        a[y, 20:20 + half] = C.ci("stone_dark")
        a[y, 20] = C.ci("fog")  # fuller
    for y in RUNE_ROWS:  # carved runes (rest: dark)
        a[y, 18:23] = C.ci("bg0")
        a[y - 1, 19] = C.ci("bg0")
        a[y + 1, 21] = C.ci("bg0")
    return a


def rune_sword():
    """4f: carved runes pulse slowly in pale moon, a few dust motes drift up."""
    frames = []
    glow = ["fog", "stone", "moon", "stone"]
    motes = [[(12, 40), (28, 30)], [(12, 37), (29, 26), (9, 50)], [(13, 34), (28, 22), (10, 46)], [(13, 31), (9, 42)]]
    for i in range(4):
        a = _sword_body()
        for y in RUNE_ROWS:
            for x, yy in ((18, y), (19, y), (20, y), (21, y), (22, y), (19, y - 1), (21, y + 1)):
                a[yy, x] = C.ci(glow[(i + RUNE_ROWS.index(y) // 2) % 4])
        a = _finish(a)
        for x, y in motes[i]:
            C.put(a, x, y, "moon" if (x + i) % 2 else "stone")
        frames.append(a)
    return frames


def rune_sword_base():
    """Cracked round stone platform the sword is stuck in (3/4 view ellipse)."""
    w, h = 48, 20
    a = C.new(w, h)
    xx, yy = C.grid(w, h)
    top = ((xx - 24) / 22) ** 2 + ((yy - 8) / 6.5) ** 2 <= 1
    side = (np.abs(xx - 24) <= 22) & (yy > 8) & (yy <= 14) & (((xx - 24) / 22) ** 2 + ((yy - 14) / 5) ** 2 <= 1.0) | (
        (np.abs(xx - 24) <= 21.5) & (yy > 8) & (yy <= 13))
    a[side] = C.ci("stone_dark")
    a[top] = C.ci("stone")
    a[top & ((xx - 24) > 6)] = C.ci("stone_dark")
    rng = np.random.default_rng(71)
    for _ in range(5):  # radial cracks from the blade
        ang = rng.uniform(0, 2 * math.pi)
        C.line(a, 24, 8, 24 + math.cos(ang) * 18, 8 + math.sin(ang) * 5.5, "bg0")
    a[6:10, 22:27] = C.ci("bg0")  # slot where the blade enters
    for x in range(3, 45, 4):
        C.put(a, x, 13, "moss")
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
            for x in (cx - 4, cx - 2, cx + 1, cx + 3):
                C.put(a, x, y, "stone_dark")
        for x in range(cx - 4, cx + 4):
            C.put(a, x, 9, "stone")
            C.put(a, x, 16, "stone_dark")
            C.put(a, x, 23, "stone")
        C.put(a, cx - 1, 8, "stone")
        C.put(a, cx - 3, 12, "bone")  # something left inside
        C.put(a, cx - 2, 19, "bone")
        frames.append(_finish(a))
    return frames


def crow():
    """4f: perched, hop, flap, land."""
    perched = ["........", "...KK...", "..KKKm..", ".KKKKKs.", "KKKKK...", "..s.s..."]
    hop = ["...KK...", "..KKKm..", ".KKKKKs.", "KKKKK...", "..s.s...", "........"]
    flap = ["s.....s.", "sK.KK.Ks", ".KKKKm..", "..KKKKs.", "..KK....", "........"]
    land = ["........", "........", "..KKKm..", ".KKKKKs.", "KKKKKK..", "..s.s..."]
    leg = {"K": "bg0", "m": "moon", "s": "stone_dark"}
    return [C.moonlit(C.from_ascii(r, leg), body_outline="bg0") for r in (perched, hop, flap, land)]


# ---------------------------------------------------------------- hunter's wagon + horse skeleton

def hunter_wagon():
    """Wrecked black funeral carriage. 3f: the lantern's pale light flickers."""
    frames = []
    for i, lamp in enumerate(("moon", "stone", "moon")):
        w, h = 48, 32
        a = C.new(w, h)
        a[8:24, 6:40] = C.ci("bg0")  # body
        a[8:24, 6] = C.ci("stone_dark")
        a[8, 6:40] = C.ci("stone_dark")
        a[6:8, 5:41] = C.ci("stone_dark")  # roof
        for x in range(6, 41, 3):  # spiked roof rail
            C.put(a, x, 5, "stone_dark")
            C.put(a, x, 4, "stone")
        for wx in (10, 20, 30):  # gothic leaf-shaped windows
            for y in range(11, 19):
                half = 2 if y > 12 else (1 if y == 12 else 0)
                for x in range(wx - half, wx + half + 1):
                    C.put(a, x + 2, y, "fog")
            C.put(a, wx + 1, 12, "moon")
        a[24, 6:40] = C.ci("stone_dark")
        # wheels: rear intact, front broken (tilted, missing spokes)
        for cx, cy, r, broken in ((12, 26, 5.5, False), (34, 27, 5.0, True)):
            for k in range(28):
                ang = k / 28 * 2 * math.pi
                if broken and 0.6 < ang < 1.8:
                    continue
                C.put(a, int(cx + math.cos(ang) * r), int(cy + math.sin(ang) * r * (0.8 if broken else 1)), "earth")
            for k in range(0, 6 if not broken else 3):
                ang = k / 6 * math.pi * 2
                C.line(a, cx, cy, cx + math.cos(ang) * r, cy + math.sin(ang) * r * (0.8 if broken else 1), "dry")
        # lantern on its bracket at the front
        C.line(a, 40, 10, 44, 10, "stone_dark")
        a[11:15, 43:46] = C.ci("stone_dark")
        a[12:14, 44] = C.ci(lamp)
        C.line(a, 0, 21, 6, 21, "earth")  # broken shaft
        a = _finish(a)
        if lamp == "moon":
            C.put(a, 47, 12, "stone" if i == 0 else "fog")
        frames.append(a)
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
    return [_finish(C.from_ascii(rows, {"B": "bone", "D": "dry", "K": "bg0"}))]


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
                C.put(a, int(6 + math.cos(ang) * r), int(17 + math.sin(ang) * r * 0.35), "stone" if i > 2 else "moon")
        # wisp: a small pale flame climbing, then dithering out
        y = 15 - i * 2.4
        blob = C.new(12, 20)
        C.disc(blob, 6, y, 2.2 - i * 0.15, "moon")
        C.put(blob, 6, int(y) - 3, "moon")
        C.put(blob, 5, int(y) + 2, "stone")
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
        C.line(a, x0, y0, x1, y1, "bone")
        C.line(a, x0, y0 + 1, x1, y1 + 1, "dry")
    # ribs curving down into the earth
    for k, (sx, sy) in enumerate([(14, 18), (19, 15), (24, 13), (29, 12), (34, 12), (39, 14), (44, 18)]):
        depth = 18 - abs(k - 3) * 2
        for t in range(depth):
            ang = 0.4 + t / depth * 1.2
            x = sx + (math.cos(ang) * 5 if k % 2 else -math.cos(ang) * 3)
            C.put(a, int(x), sy + t, "bone" if t < depth - 4 else "dry")
    # horned skull at the left end, lying in the dirt
    a[28:35, 2:12] = C.ci("bone")
    a[30:32, 4:6] = C.ci("bg0")
    a[33:35, 2:8] = C.ci("dry")
    C.line(a, 4, 28, 1, 20, "bone")  # horns
    C.line(a, 1, 20, 3, 15, "bone")
    C.line(a, 9, 28, 13, 22, "bone")
    C.line(a, 13, 22, 12, 17, "bone")
    # earth mound burying the lower half
    xx, yy = C.grid(w, h)
    mound = ((xx - 28) / 27) ** 2 + ((yy - 40) / 9) ** 2 <= 1
    a[mound] = C.ci("earth")
    a[mound & C.bayer_mask(w, h, 0.25)] = C.ci("dry")
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
    for i, col in enumerate(("moon", "stone", "moon")):
        a = C.new(7, 5)
        a[:, :] = C.ci(col)
        a[2, :] = C.ci("earth")
        a[:, 3] = C.ci("earth")
        if i == 2:
            a[0, 0:3] = C.ci("stone")
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
            col = "stone" if k < 2 else "fog"
            blob = C.new(12, 20)
            C.disc(blob, x + ((i + k) % 3) - 1, yy, r, col)
            blob = C.dither_out(blob, 1.0 - k * 0.22, ox=i, oy=k)
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
                a[y:y + 2, x:x + 2] = C.ci("bone")
                C.put(a, x, y + 1, "bg0")
            else:
                C.put(a, x, y + 1, "bone")
                C.put(a, x + 1, y + 1, "dry")
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
    """Cold ghost flames at rest: pale moon (4f)."""
    return [_flame("moon", "stone", i) for i in range(4)]


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
