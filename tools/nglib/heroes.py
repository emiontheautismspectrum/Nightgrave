"""Hero sprites: Knight and Wisp. 16x16 canvas, facing right, light from the top-left."""
import math

import numpy as np

from . import canvas as C

LEGEND = {"G": "gold", "A": "amber", "E": "ember", "B": "bone", "S": "stone", "D": "stone_dark", "F": "fog",
          "K": "bg0"}
HERO_OUTLINE = "bg0"  # darkest shade: the hero silhouette must cut cleanly out of the stone platform

# Knight, facing right. Bone armour lit from the top-left (stone shade on the right), a dark visor slit
# through the helmet front, a dark cape (stone_dark/fog) behind, and ONE amber accent: the plume.
# Legs (rows 13-14) are drawn per frame.
KNIGHT_BODY = [
    "................",
    "......AAA.......",
    ".....ABBBB......",
    ".....BBBBBS.....",
    ".....BBKKKK.....",
    ".....BBBBBS.....",
    "......DSSD......",
    "...DDBBBBSS.....",
    "..DDBBBBBSSS....",
    "..DFDBBBBSSS....",
    "..DFDSBBSSDS....",
    "..DDDSSSSSD.....",
    "...DDBB.SS......",
    "................",
    "................",
    "................",
]
# cape hem variants for the run cycle (extra pixels at the back)
CAPE_FLUTTER = [[], [(1, 10, "D")], [(1, 10, "D"), (1, 11, "D")], [(2, 12, "D")], [], [(1, 11, "F")]]


def _knight_body():
    return C.from_ascii(KNIGHT_BODY, LEGEND)


def _legs(a, lx=5, rx=8, ly=0, ry=0):
    """Two separate 2 px legs; the near (left) leg is lit, boots are dark with a forward toe."""
    for x, dy, (c0, c1) in ((lx, ly, ("bone", "stone")), (rx, ry, ("stone", "stone_dark"))):
        C.put(a, x, 13 + dy, c0)
        C.put(a, x + 1, 13 + dy, c1)
        for k in range(3):
            C.put(a, x + k, 14 + dy, "stone_dark")


def _knight(dy=0, dx=0, legs=(5, 8, 0, 0), flutter=(), glint=None, breath=0, head=0):
    """glint: x of a 1 px amber visor glint (or None); breath: chest rises 1 px; head: extra helmet bob."""
    a = C.new(16, 16)
    body = _knight_body()
    for x, y, ch in flutter:
        body[y, x] = C.ci(LEGEND[ch])
    if glint is not None:
        body[4, glint] = C.ci("amber")
    if breath:  # breathing: shoulders/chest one row higher, the helmet follows
        body[:12] = np.concatenate([body[1:12], body[11:12]], 0) if breath > 0 else body[:12]
    if head:  # the helmet (rows 1-5) dips one px on its own: it overlaps the neck row, the body stays
        top = body[1:6].copy()
        body[1] = C.T
        body[2:7] = np.where(top != C.T, top, body[2:7])
    C.paste(a, body, dx, dy)
    _legs(a, *legs)
    return a


def _finish(a):
    return C.outline(a, color=HERO_OUTLINE)


def knight_idle():
    """Breathing (chest rises on 1-2), the cape sways, a 1 px amber glint travels along the visor slit."""
    spec = ((0, 0, 7, 0), (0, 5, 8, 1), (0, 1, 9, 1), (1, 5, None, 0))
    return [_finish(_knight(dy=d, flutter=CAPE_FLUTTER[f], glint=g, breath=b)) for d, f, g, b in spec]


def knight_run():
    frames = []
    for i in range(6):
        ph = math.sin(i / 6 * 2 * math.pi)
        l = int(round(ph * 1.4))
        bob = 1 if i in (1, 4) else 0
        legs = (5 + l, 8 - l, -1 if l > 0 else 0, -1 if l < 0 else 0)
        frames.append(_finish(_knight(dy=bob, legs=legs, flutter=CAPE_FLUTTER[i], glint=8 if i % 3 == 0 else None,
                                      head=1 if i in (2, 5) else 0)))
    return frames


def _shield(a, flash):
    """Small round shield held in front (right side)."""
    cx, cy = 12.5, 9.5
    C.disc(a, cx, cy, 2.6, "bone")
    for x, y in ((14, 9), (14, 10), (13, 11), (12, 11)):
        C.put(a, x, y, "stone")  # shaded lower-right rim
    C.put(a, 12, 9, "bone" if flash else "stone_dark")  # boss


def knight_parry():
    frames = []
    for i in range(3):
        a = _knight(dx=-1)
        _shield(a, flash=(i == 1))
        a = _finish(a)
        if i == 1:
            C.ring(a, 12.5, 9.5, 4.0, 5.2, "bone", mask=C.bayer_mask(16, 16, 0.5) & (a == C.T))
        if i == 2:
            C.ring(a, 12.5, 9.5, 4.5, 5.5, "bone", mask=C.bayer_mask(16, 16, 0.25) & (a == C.T))
        frames.append(a)
    return frames


def knight_dash():
    """Cloak dash: body leans forward, the cape streams straight back."""
    frames = []
    for i in range(2):
        a = _knight(dx=2, dy=1, legs=(6, 8, -1, 0))
        # remove the hanging cape, then draw it streaming horizontally behind
        a[(a == C.ci("stone_dark")) & (np.arange(16)[None, :] < 7) & (np.arange(16)[:, None] < 13)] = C.T
        a[(a == C.ci("fog")) & (np.arange(16)[None, :] < 7)] = C.T
        for row, (x0, col) in enumerate(((3 + i, "stone_dark"), (1 + i, "fog"), (0 + i, "stone_dark"),
                                         (2 + i, "stone_dark"))):
            for x in range(x0, 8):
                C.put(a, x, 8 + row, col)
        frames.append(_finish(a))
    return frames


EMBERS = [(3, 6), (12, 4), (7, 2), (10, 7), (5, 9), (13, 10), (2, 11), (9, 3)]


def _embers(a, n, rise):
    for k, (x, y) in enumerate(EMBERS[:n]):
        C.put(a, x + (k % 3) - 1, y - rise, ("gold", "amber", "ember")[k % 3])


def knight_death():
    base = _knight()
    flash = C.recolor(base, {"stone": "bone", "stone_dark": "bone", "fog": "bone", "bg0": "bone"})
    frames = [C.outline(flash, color="amber")]
    kneel = C.new(16, 16)  # drops to one knee: body sinks, legs fold
    C.paste(kneel, _knight_body(), 0, 2)
    frames.append(_finish(kneel))
    lying = C.new(16, 16)
    C.paste(lying, np.rot90(_knight(), k=-1), 0, 3)
    lying = _finish(lying)
    frames.append(lying)
    for i, keep in enumerate((0.6, 0.3, 0.0)):
        a = C.dither_out(lying, keep, ox=i, oy=i)
        if keep < 0.5:
            a = C.recolor(a, {"stone": "ember", "bone": "amber", "stone_dark": "blood_dark", "fog": "blood_dark"})
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
        a = _finish(_flame(16, 16, 8, 10, 4.5, tx, ty))
        C.put(a, (3, 12, 4, 11)[i], (4, 2, 2, 5)[i], "amber")
        frames.append(a)
    return frames


def wisp_pulse():
    frames = []
    spec = ((5.0, 6.0, "gold", 1.0), (6.0, 7.5, "amber", 0.5), (6.5, 7.8, "ember", 0.25))
    for i, (r0, r1, col, cov) in enumerate(spec):
        a = _finish(_flame(16, 16, 8, 9.5, 4.0 + (i == 0) * 0.6, 8, 2.5))
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
        a = _finish(a)
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
            a = _finish(a)
        spread = i * 1.4
        for k in range(8):
            ang = k / 8 * 2 * math.pi + 0.3
            if (i < 5 or k % 2 == 0) and i > 0:
                C.put(a, int(8 + math.cos(ang) * spread * 1.6), int(10 + math.sin(ang) * spread - i),
                      ("gold", "amber", "ember")[(k + i) % 3])
        frames.append(a)
    return frames


def hero_shadow():
    """Contact shadow + amber under-glow: solid bg0 core, checker amber rim. Reads on stone and dark floor."""
    a = C.new(12, 6)
    xx, yy = C.grid(12, 6)
    e = ((xx - 6) / 5.6) ** 2 + ((yy - 3) / 2.7) ** 2
    a[(e <= 1.0) & C.bayer_mask(12, 6, 0.5)] = C.ci("amber")
    a[e <= 0.55] = C.ci("bg0")
    return [a]


SPRITES = {
    "knight_idle": knight_idle, "knight_run": knight_run, "knight_parry": knight_parry,
    "knight_dash": knight_dash, "knight_death": knight_death,
    "wisp_idle": wisp_idle, "wisp_pulse": wisp_pulse, "wisp_dash": wisp_dash, "wisp_death": wisp_death,
    "hero_shadow": hero_shadow,
}
