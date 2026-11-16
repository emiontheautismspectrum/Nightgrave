"""The Toller's new rows and the U3b effect art (stage ART-B; dark: FEATURES.bossMotion / bossMoves).

- toller_tp_out / toller_tp_in (40x56, 4f each): the bell tolls and the figure fades to bone motes, and back (the
  peal's teleport).
- toller_throw (40x56, 4f): the right arm leaves the robe, rises with a chain and throws it into the ground (the cast
  row of the `chains` attack).
- chain_iron / chain_violet (8x8, 2 variants each): chain links laid along the chain from the raised hand to its spot,
  never rotated (variant 0 = a link seen flat, variant 1 = the next one seen edge-on). IRON = ash grey (stone) with
  bone glints; PARRY-BREAK = violet.
- chain_wrap_iron / chain_wrap_violet (16x16, 2f each): links wound round the bound hero.
The Toller's body itself is tools/nglib/bosses2.py `_toller` (its look stays).
"""
import math

from . import canvas as C
from .bosses2 import _toller


def _motes(a, k, rising, n):
    for j in range(n):
        x = 6 + (j * 7 + k * 5) % 28
        y = (50 - ((j * 13 + k * 8) % 46)) if rising else (6 + ((j * 13 + k * 8) % 46))
        C.put(a, x, y, "bone")
        if j % 3 == 0:
            C.put(a, x + 1, y, "stone")
    return a


def toller_tp_out():
    out = []
    for k in range(4):
        a = _toller((1, -1, 1, 0)[k], strike=k < 2, show=1 - (k + 1) / 5, i=k)
        out.append(_motes(a, k, True, 5 + k * 4))
    return out


def toller_tp_in():
    out = []
    for k in range(4):
        a = _toller((0, -1, 1, 0)[k], strike=k >= 2, show=(k + 1) / 4, i=k)
        out.append(_motes(a, k, False, 14 - k * 4) if k < 3 else a)
    return out


def toller_throw():
    """The arm rises with the chain gathered in the hand (two frames), swings over (the links fly up), then points
    down as the chain goes into the ground."""
    def hang(hx, hy, n):
        return [(hx + (k % 2), hy + 2 + k) for k in range(n)]
    poses = [
        (31, 26, hang(31, 26, 5)),
        (33, 19, hang(33, 19, 6)),
        (33, 13, [(34 + (k % 2), 12 - k) for k in range(5)]),
        (35, 24, [(35 + k // 2, 26 + k * 2) for k in range(9)] + [(36 + k // 2, 27 + k * 2) for k in range(8)]),
    ]
    return [_toller(0, strike=k == 3, i=k, arm=p) for k, p in enumerate(poses)]


FLAT = ["........", "..XGXX..", ".XG..XX.", ".G....X.", ".X....G.", ".XX..GX.", "..XXGX..", "........"]
EDGE = ["........", "........", "...XX...", "..XGGX..", "..XGGX..", "...XX...", "........", "........"]


def _links(ring, glint, edge):
    out = []
    for rows in (FLAT, EDGE):
        a = C.from_ascii(rows, {"X": ring, "G": glint})
        out.append(C.outline(a, color=edge))
    return out


def chain_iron():
    return _links("stone", "bone", "bg0")


def chain_violet():
    return _links("violet", "bone", "violet_dark")


def _wrap(ring, glint, edge):
    """Two coils round the hero (16x16): the links alternate ring / glint, frame 1 slides them by one link."""
    out = []
    for f in range(2):
        a = C.new(16, 16)
        for cy, ry, ph in ((6.5, 3.0, 0.0), (10.5, 3.4, 0.5)):
            n = 28
            for k in range(n):
                ang = 2 * math.pi * k / n + ph
                x, y = int(round(7.5 + math.cos(ang) * 6.6)), int(round(cy + math.sin(ang) * ry))
                if math.sin(ang) < -0.55:
                    continue  # the far side of the coil is behind the hero
                C.put(a, x, y, glint if (k + f) % 2 == 0 else ring)
        out.append(C.outline(a, color=edge))
    return out


def chain_wrap_iron():
    return _wrap("stone", "bone", "bg0")


def chain_wrap_violet():
    return _wrap("violet", "bone", "violet_dark")


SPRITES = {
    "toller_tp_out": toller_tp_out,
    "toller_tp_in": toller_tp_in,
    "toller_throw": toller_throw,
    "chain_iron": chain_iron,
    "chain_violet": chain_violet,
    "chain_wrap_iron": chain_wrap_iron,
    "chain_wrap_violet": chain_wrap_violet,
}
