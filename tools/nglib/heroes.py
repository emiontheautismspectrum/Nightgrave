"""Hero sprites: Knight and Wisp. 16x16 canvas, facing right, light from the top-left."""
import math

import numpy as np

from . import canvas as C

LEGEND = {"G": "gold", "A": "amber", "E": "ember", "B": "bone", "S": "stone", "D": "stone_dark", "K": "bg0"}

# Upper body only; legs are drawn per frame. Bone/stone highlights sit top-left, stone_dark on the right.
KNIGHT_BODY = [
    "................",
    "........A.......",
    ".......GA.......",
    "......BBBS......",
    ".....BBBBSD.....",
    ".....BKGGKD.....",
    ".....BBBSSD.....",
    "....EBBBSSDE....",
    "...EABBBSSDEE...",
    "...EABBGSSDEE...",
    "...EABBBSSDEE...",
    "....EDBSSDEE....",
    "....EES..DEE....",
    "................",
    "................",
    "................",
]


def _knight_body(plume_flicker=False):
    a = C.from_ascii(KNIGHT_BODY, LEGEND)
    if plume_flicker:
        a[1, 8] = C.ci("gold")
        a[2, 7] = C.ci("amber")
    return a


def _legs(a, lx=6, rx=9, ly=0, ry=0):
    for x, dy, top in ((lx, ly, "bone"), (rx, ry, "stone")):
        C.put(a, x, 13 + dy, top)
        C.put(a, x, 14 + dy, "stone_dark")


def _knight(dy=0, dx=0, legs=(6, 9, 0, 0), plume=False):
    a = C.new(16, 16)
    C.paste(a, _knight_body(plume), dx, dy)
    _legs(a, *legs)
    return a


def knight_idle():
    return [C.outline(_knight(dy=d, plume=p)) for d, p in ((0, False), (0, True), (1, False), (1, True))]


def knight_run():
    frames = []
    for i in range(6):
        ph = math.sin(i / 6 * 2 * math.pi)
        l = int(round(ph * 1.4))
        bob = 1 if i in (1, 4) else 0
        legs = (6 + l, 9 - l, -1 if l > 0 else 0, -1 if l < 0 else 0)
        frames.append(C.outline(_knight(dy=bob, legs=legs, plume=i % 2 == 0)))
    return frames


def _shield(a, flash):
    cx, cy = 12.5, 9.5
    C.disc(a, cx, cy, 2.7, "gold" if flash else "bone")
    if not flash:
        C.put(a, 13, 10, "stone")
        C.put(a, 13, 11, "stone")
        C.put(a, 14, 9, "stone")
        C.put(a, 12, 9, "gold")


def knight_parry():
    frames = []
    for i in range(3):
        a = _knight(legs=(6, 9, 0, 0))
        _shield(a, flash=(i == 1))
        a = C.outline(a)
        if i == 1:
            C.ring(a, 12.5, 9.5, 4.0, 5.2, "gold", mask=C.bayer_mask(16, 16, 0.5) & (a == C.T))
        if i == 2:
            C.ring(a, 12.5, 9.5, 4.5, 5.5, "amber", mask=C.bayer_mask(16, 16, 0.25) & (a == C.T))
        frames.append(a)
    return frames


def knight_dash():
    frames = []
    for i in range(2):
        a = _knight(dx=2, dy=1, legs=(6, 8, 0, 0))
        a = C.outline(a)
        streak = C.new(16, 16)
        for row, (x0, col) in enumerate(((0, "ember"), (1, "amber"), (0, "ember"), (2, "amber"), (1, "ember"))):
            for x in range(x0 + i * 2, 6):
                C.put(streak, x, 8 + row, col)
        if i == 1:
            streak = C.dither_out(streak, 0.5)
        m = (a == C.T) & (streak != C.T)
        a[m] = streak[m]
        frames.append(a)
    return frames


EMBERS = [(3, 6), (12, 4), (7, 2), (10, 7), (5, 9), (13, 10), (2, 11), (9, 3)]


def _embers(a, n, rise):
    for k, (x, y) in enumerate(EMBERS[:n]):
        C.put(a, x + (k % 3) - 1, y - rise, ("gold", "amber", "ember")[k % 3])


def knight_death():
    base = _knight()
    frames = [C.outline(C.recolor(base, {"stone": "bone", "stone_dark": "bone", "ember": "gold", "amber": "gold"}),
                        color="ember")]
    tilt = C.new(16, 16)
    for y in range(16):  # shear the body to the right: falling over
        sh = max(0, (12 - y) // 4)
        for x in range(16):
            if base[y, x] != C.T and 0 <= x + sh < 16:
                tilt[y, x + sh] = base[y, x]
    frames.append(C.outline(tilt))
    lying = C.new(16, 16)
    rot = np.rot90(base, k=-1)
    C.paste(lying, rot, 0, 3)
    lying = C.outline(lying)
    frames.append(lying)
    for i, keep in enumerate((0.6, 0.3, 0.0)):
        a = C.dither_out(lying, keep, ox=i, oy=i)
        a = C.recolor(a, {"stone": "ember", "bone": "amber", "stone_dark": "blood_dark"}) if keep < 0.5 else a
        _embers(a, 8 - i * 2, rise=2 + i * 2)
        frames.append(a)
    return frames


# ---------------------------------------------------------------- wisp

def _flame(w, h, cx, cy, r, tip_x, tip_y, eyes=True):
    xx, yy = C.grid(w, h)
    d = np.full((h, w), 9.0)
    lower = yy >= cy
    d[lower] = (np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r)[lower]
    t = (yy - cy) / (tip_y - cy)
    upper = (~lower) & (t <= 1.0)
    center = cx + (tip_x - cx) * t * t
    half = r * np.clip(1.0 - t, 0.0, 1.0) ** 0.9
    with np.errstate(divide="ignore", invalid="ignore"):
        du = np.abs(xx - center) / np.where(half > 0.05, half, 0.05)
    d[upper] = du[upper]
    a = C.new(w, h)
    a[d <= 1.0] = C.ci("ember")
    a[d <= 0.72] = C.ci("amber")
    a[d <= 0.38] = C.ci("gold")
    if eyes:
        C.put(a, int(cx - 1.5), int(cy), "bg0")
        C.put(a, int(cx + 1.0), int(cy), "bg0")
    return a


def wisp_idle():
    frames = []
    for i, (tx, ty) in enumerate(((8, 2.5), (9, 3.0), (8, 2.0), (7, 3.0))):
        a = C.outline(_flame(16, 16, 8, 10, 4.5, tx, ty))
        C.put(a, (3, 12, 4, 11)[i], (4, 2, 2, 5)[i], "amber")
        frames.append(a)
    return frames


def wisp_pulse():
    frames = []
    spec = ((5.0, 6.0, "gold", 1.0), (6.0, 7.5, "amber", 0.5), (6.5, 7.8, "ember", 0.25))
    for i, (r0, r1, col, cov) in enumerate(spec):
        a = C.outline(_flame(16, 16, 8, 9.5, 4.0 + (i == 0) * 0.6, 8, 2.5))
        C.ring(a, 8, 9, r0, r1, col, mask=(a == C.T) & C.bayer_mask(16, 16, cov))
        frames.append(a)
    return frames


def wisp_dash():
    frames = []
    for i in range(2):
        f = _flame(16, 16, 8, 9.5, 4.2, 8, 0.5 - i * 1.0, eyes=False)
        a = C.new(16, 16)
        C.paste(a, np.rot90(f, k=1), 1, 0)  # tip points left (trailing)
        C.put(a, 10, 8, "bg0")
        C.put(a, 10, 10, "bg0")
        a = C.outline(a)
        for k, x in enumerate(range(0, 4)):
            if (x + i) % 2 == 0:
                C.put(a, x, 6 + (k % 3) * 2, "amber")
        frames.append(a)
    return frames


def wisp_death():
    frames = []
    for i, r in enumerate((4.5, 3.6, 2.6, 1.6, 0, 0)):
        a = C.new(16, 16)
        if r > 0:
            a = _flame(16, 16, 8, 10, r, 8, 10 - r * 1.6, eyes=(i < 2))
            if i == 0:
                a = C.recolor(a, {"ember": "gold", "amber": "gold"})
            a = C.outline(a)
        spread = i * 1.4
        for k in range(8):
            ang = k / 8 * 2 * math.pi + 0.3
            if (i < 5 or k % 2 == 0) and i > 0:
                C.put(a, int(8 + math.cos(ang) * spread * 1.6), int(10 + math.sin(ang) * spread - i),
                      ("gold", "amber", "ember")[(k + i) % 3])
        frames.append(a)
    return frames


def hero_shadow():
    a = C.new(12, 6)
    xx, yy = C.grid(12, 6)
    m = ((xx - 6) / 5.5) ** 2 + ((yy - 3) / 2.6) ** 2 <= 1.0
    a[m & C.bayer_mask(12, 6, 0.5)] = C.ci("bg0")
    return [a]


SPRITES = {
    "knight_idle": knight_idle, "knight_run": knight_run, "knight_parry": knight_parry,
    "knight_dash": knight_dash, "knight_death": knight_death,
    "wisp_idle": wisp_idle, "wisp_pulse": wisp_pulse, "wisp_dash": wisp_dash, "wisp_death": wisp_death,
    "hero_shadow": hero_shadow,
}
