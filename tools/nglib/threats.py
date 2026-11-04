"""Threat sprites. Violet = parryable, blood red = unparryable."""
import math

import numpy as np

from . import canvas as C


def _orb(size, r, hi):
    c = size / 2
    a = C.new(size, size)
    C.disc(a, c, c, r, "violet")
    # lower-right shade inside the body (light from top-left)
    xx, yy = C.grid(size, size)
    body = a != C.T
    a[body & ((xx - c) + (yy - c) > r * 0.9)] = C.ci("violet_dark")
    for x, y in hi:
        C.put(a, x, y, "bone")
    return C.outline(a)


def orb_small():
    return [_orb(6, 2.1, [(2, 2)]), _orb(6, 2.1, [(2, 2), (3, 2)])]


def orb_large():
    f0 = C.halo(_orb(10, 3.3, [(3, 3), (4, 3), (3, 4)]), "violet_dark", 0)
    f1 = C.halo(_orb(10, 3.6, [(3, 3), (4, 3)]), "violet_dark", 1)
    return [f0, f1]


def rune_shard():
    frames = []
    for i in range(2):
        a = C.new(8, 8)
        xx, yy = C.grid(8, 8)
        if i == 0:
            m = np.abs(xx - 4) + np.abs(yy - 4) <= 3.0
        else:
            m = (np.abs(xx - 4) <= 2.0) & (np.abs(yy - 4) <= 2.0)
        a[m] = C.ci("violet")
        C.put(a, 3, 3, "bone")
        C.put(a, 4, 4, "bone")
        frames.append(C.outline(a))
    return frames


def _blade(rot):
    s = 16
    xx, yy = C.grid(s, s)
    dx, dy = xx - 8, yy - 8
    r = np.sqrt(dx * dx + dy * dy)
    th = np.arctan2(dy, dx)
    a = C.new(s, s)
    for k in range(3):
        base = rot + k * 2 * math.pi / 3
        curve = base + (r / 7.0) * 1.3  # arms sweep backwards: crescent
        off = (th - curve + math.pi) % (2 * math.pi) - math.pi
        width = 0.75 * (1.0 - r / 8.2)
        arm = (r >= 1.5) & (r <= 7.2) & (np.abs(off) <= width)
        a[arm] = C.ci("blood")
        edge = arm & (off > width * 0.35) & (r > 3.0)
        a[edge] = C.ci("bone")
    C.disc(a, 8, 8, 2.0, "blood_dark")
    C.put(a, 7, 7, "blood")
    return C.outline(a)


def blade():
    return [_blade(i * (2 * math.pi / 3) / 4) for i in range(4)]


def _wraith(i, keep=1.0):
    a = C.new(16, 16)
    C.disc(a, 8, 6, 4.2, "violet")
    xx, yy = C.grid(16, 16)
    sway = (0, 1, 0, -1)[i % 4]
    body = (yy >= 6) & (yy <= 14) & (np.abs(xx - 8 - sway * (yy - 6) / 8) <= 3.2 + (yy - 6) * 0.35)
    a[body] = C.ci("violet")
    # tattered hem: ragged bottom that moves per frame
    for x in range(16):
        cut = 12 + ((x * 7 + i * 3) % 4)
        a[cut:, x] = C.T
    # shade: right side and lower body dark
    a[(a != C.T) & ((xx - 8) > 1.5)] = C.ci("violet_dark")
    a[(a != C.T) & (yy > 11)] = C.ci("violet_dark")
    # hood opening + eyes
    for x in (6, 7, 8, 9):
        C.put(a, x, 6, "bg0")
        C.put(a, x, 7, "bg0")
    C.put(a, 6, 6, "bone")
    C.put(a, 9, 6, "bone")
    a = C.outline(a, color="violet_dark")
    # translucent lower body via dithering
    low = C.bayer_mask(16, 16, 0.5, ox=i)
    low[:11, :] = True
    a[~low] = C.T
    if keep < 1.0:
        a = C.dither_out(a, keep, ox=i, oy=i)
    return a


def wraith():
    return [_wraith(i) for i in range(4)]


def wraith_fade():
    return [_wraith(i, keep) for i, keep in enumerate((0.75, 0.5, 0.25, 0.07))]


SPRITES = {
    "orb_small": orb_small, "orb_large": orb_large, "rune_shard": rune_shard,
    "blade": blade, "wraith": wraith, "wraith_fade": wraith_fade,
}
