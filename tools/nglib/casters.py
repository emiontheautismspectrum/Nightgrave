"""Caster sprites (emitters only: never hittable or lethal) and their spawn/vanish effects, plus the boss bar frame.

Casters may use violet (reserved-color exception), because they announce a parryable violet attack.
"""
import math

import numpy as np

from . import canvas as C


# ---------------------------------------------------------------- shade (portal)

def _shade_body(i=0, arms=0):
    """Hooded phantom, 16x20: violet hood, black face, two bone eyes, robe dissolving into dithered tatters."""
    a = C.new(16, 20)
    xx, yy = C.grid(16, 20)
    sway = (0, 1, 0, -1)[i % 4]
    hood = ((xx - 8) / 4.6) ** 2 + ((yy - 6) / 5.0) ** 2 <= 1
    robe = (yy >= 6) & (yy <= 18) & (np.abs(xx - 8 - sway * (yy - 6) / 12) <= 2.6 + (yy - 6) * 0.32)
    a[hood | robe] = C.ci("violet")
    a[(a != C.T) & ((xx - 8) > 1.5)] = C.ci("violet_dark")
    a[4:9, 6:10] = C.ci("bg0")  # face opening
    a[3, 7:9] = C.ci("bg0")
    C.put(a, 6, 6, "bone")
    C.put(a, 9, 6, "bone")
    if arms:  # cast pose: sleeves raised
        for s in (-1, 1):
            C.line(a, 8 + s * 3, 10, 8 + s * (5 + arms), 7 - arms, "violet")
            C.put(a, 8 + s * (5 + arms), 6 - arms, "bone")
    a = C.outline(a, color="violet_dark")
    hem = C.bayer_mask(16, 20, 0.5, ox=i)
    hem[:15, :] = True
    a[~hem] = C.T
    return a


def shade_idle():
    return [_shade_body(i) for i in range(4)]


def shade_rise():
    """Vertical rise: the shade emerges from the floor line (row 19), violet motes rising around it."""
    frames = []
    for i in range(6):
        full = _shade_body(i % 4)
        a = C.new(16, 20)
        show = int(round((i + 1) / 6 * 20))
        a[20 - show:, :] = full[:show, :]
        for k in range(3):
            C.put(a, 2 + k * 5 + i % 2, 18 - (i * 2 + k * 3) % 14, "violet" if k % 2 else "violet_dark")
        frames.append(a)
    return frames


def shade_cast():
    frames = []
    for i in range(3):
        a = _shade_body(0, arms=i + 1)
        if i == 2:  # gathered energy between the raised hands
            C.disc(a, 8, 2.5, 1.6, "violet")
            C.put(a, 8, 2, "bone")
        frames.append(a)
    return frames


def shade_dissolve():
    frames = []
    for i in range(6):
        a = _shade_body(i % 4)
        a = C.dither_out(a, 1.0 - (i + 1) / 7, ox=i, oy=i)
        # violet smoke curling upward
        for k in range(4):
            C.put(a, 4 + k * 3, 10 - i * 2 + (k % 2) * 2, "violet_dark")
        frames.append(a)
    return frames


# ---------------------------------------------------------------- stalker (forest)

STALKER_ROWS = [
    "....................",
    "...S.S........S.S...",
    "....SS..S..S..SS....",
    ".....S.S....S.S.....",
    "......SS....SS......",
    ".......KKKKKK.......",
    "......KKKKKKKK......",
    "......KVKKKKVK......",
    "......KKKKKKKK......",
    ".....KKKKKKKKKK.....",
    "....KKKKKKKKKKKK....",
    "...KKKKKKKKKKKKKK...",
    "...KKKKKKKKKKKKKKK..",
    "..KKK.KKKKKKKK.KKK..",
    "..KK..KKKKKKKK..KK..",
    "..K...KKKKKKKK...K..",
    "..K...KKKKKKKK...K..",
    ".KK...KKKKKKKK...KK.",
    "......KKK..KKK......",
    "......KK....KK......",
    "......KK....KK......",
    ".....KK......KK.....",
    ".....K........K.....",
    "....................",
]


def _stalker(i=0, cast=0):
    """Hunched antlered silhouette: forest-dark body (bg0/forest), stone_dark antlers, violet eyes."""
    a = C.from_ascii(STALKER_ROWS, {"S": "stone_dark", "K": "bg0", "V": "violet"})
    a[(a == C.ci("bg0")) & (np.arange(20)[None, :] < 9)] = C.ci("forest")  # faint moonlit flank
    if i % 2:  # breathing: shoulders drop a pixel
        a[10:13, :] = np.roll(a[10:13, :], 0, axis=1)
        a[9, 5:15] = np.where(a[9, 5:15] == C.T, C.ci("bg0"), a[9, 5:15])
    if cast:
        for k in range(cast + 2):  # long arm reaching forward-up
            C.put(a, 16 + k // 2, 12 - k, "bg0")
        C.put(a, 17 + cast // 2, 10 - cast - 1, "violet")
    return C.moonlit(a, body_outline="bg0", rim="stone_dark")


def stalker_idle():
    return [_stalker(i) for i in range(4)]


def stalker_emerge():
    """Lateral step out of the trees: slides in from the left, dithering in through fog."""
    frames = []
    for i in range(6):
        body = _stalker(0)
        a = C.new(20, 24)
        C.paste(a, body, -10 + i * 2, 0)
        a = C.dither_out(a, 0.25 + i * 0.15, ox=i)
        frames.append(a)
    return frames


def stalker_cast():
    return [_stalker(0, cast=c) for c in (1, 2, 3)]


def stalker_vanish():
    """Melts back into leaves and ash: dithers out while leaves (dry/earth) and ash (fog) scatter."""
    frames = []
    rng = np.random.default_rng(88)
    for i in range(6):
        a = C.dither_out(_stalker(0), 1.0 - (i + 1) / 7, ox=i, oy=i)
        for _ in range(4 + i):
            x, y = int(rng.integers(2, 18)), int(rng.integers(4, 22))
            C.put(a, x, y, ("dry", "earth", "fog")[int(rng.integers(0, 3))])
        frames.append(a)
    return frames


# ---------------------------------------------------------------- spawn effects

def portal_ignite():
    """40x40, 4f: the runic circle on the altar ignites violet (telegraph), ring brightening and closing."""
    frames = []
    for i in range(4):
        a = C.new(40, 40)
        xx, yy = C.grid(40, 40)
        e = np.sqrt(((xx - 20) / 18) ** 2 + ((yy - 20) / 8.5) ** 2)
        cov = (0.25, 0.5, 1.0, 1.0)[i]
        a[(e >= 0.82) & (e <= 1.0) & C.bayer_mask(40, 40, cov, ox=i)] = C.ci("violet" if i >= 2 else "violet_dark")
        if i >= 1:
            for k in range(-6, 7):  # the cross inlay lights up
                C.put(a, 20 + k, 20, "violet" if i >= 2 else "violet_dark")
            for k in range(-3, 4):
                C.put(a, 20, 20 + k, "violet" if i >= 2 else "violet_dark")
        if i == 3:
            C.put(a, 20, 20, "bone")
            for k in range(0, 360, 45):  # rising sparks
                ang = math.radians(k)
                C.put(a, int(20 + math.cos(ang) * 14), int(20 + math.sin(ang) * 6) - 4, "violet")
        frames.append(a)
    return frames


def portal_smoke():
    """24x32, 6f: violet smoke column left behind by a dissolving shade."""
    frames = []
    for i in range(6):
        a = C.new(24, 32)
        for k in range(5):
            y = 28 - k * 6 - i * 2
            if y < 2:
                continue
            blob = C.new(24, 32)
            C.disc(blob, 12 + ((k + i) % 3) - 1, y, 2.5 + k * 0.6 + i * 0.2, "violet_dark" if k > 1 else "violet")
            blob = C.dither_out(blob, max(0.1, 0.9 - i * 0.14 - k * 0.08), ox=i, oy=k)
            m = (blob != C.T) & (a == C.T)
            a[m] = blob[m]
        frames.append(a)
    return frames


def forest_eyes():
    """8x4, 3f: frame 0 rest (violet_dark), frames 1-2 bright (telegraph)."""
    rest = ["........", ".D....D.", ".DD..DD.", "........"]
    bright = ["........", ".V....V.", ".VB..BV.", "........"]
    bright2 = [".V....V.", "VVV..VVV", ".VB..BV.", "........"]
    leg = {"D": "violet_dark", "V": "violet", "B": "bone"}
    return [C.from_ascii(r, leg) for r in (rest, bright, bright2)]


def forest_leaf_ash():
    """16x16, 6f: leaves and ash fluttering out (stalker vanish / emerge accent)."""
    frames = []
    rng = np.random.default_rng(64)
    pts = [(rng.uniform(4, 12), rng.uniform(6, 12), rng.uniform(-1, 1), rng.uniform(-1.6, -0.6), k) for k in range(9)]
    for i in range(6):
        a = C.new(16, 16)
        for x, y, vx, vy, k in pts:
            if i > 3 and k % 2:
                continue
            px, py = int(x + vx * i * 1.3), int(y + vy * i * 1.1 + (i * i) * 0.15)
            col = ("dry", "earth", "fog", "stone_dark")[k % 4]
            C.put(a, px, py, col)
            if k % 3 == 0 and i < 4:
                C.put(a, px + 1, py, col)
        frames.append(a)
    return frames


def boss_bar():
    """384x10 frame for the boss bar under the arena (segments are drawn in code, max 15)."""
    w, h = 384, 10
    a = C.new(w, h)
    a[0, 2:w - 2] = C.ci("stone")
    a[h - 1, 2:w - 2] = C.ci("stone_dark")
    a[2:h - 2, 0] = C.ci("stone")
    a[2:h - 2, w - 1] = C.ci("stone_dark")
    a[1, 1] = a[1, w - 2] = C.ci("stone")
    a[h - 2, 1] = a[h - 2, w - 2] = C.ci("stone_dark")
    a[1:h - 1, 1:w - 1] = np.where(a[1:h - 1, 1:w - 1] == C.T, C.ci("bg0"), a[1:h - 1, 1:w - 1])
    a[2:h - 2, 2:w - 2] = C.T  # inner area left open: the game draws the segments there
    a[0, w // 2 - 3:w // 2 + 3] = C.ci("bone")  # small centre ornament
    a[1, w // 2 - 1:w // 2 + 1] = C.ci("bone")
    return [a]
