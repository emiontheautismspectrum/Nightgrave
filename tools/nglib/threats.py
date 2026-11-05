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
    """4x4 violet body, no inner shade (too small), bright 1 px bone core that shimmers between frames."""
    def f(cx):
        a = C.new(6, 6)
        C.disc(a, 3, 3, 2.1, "violet")
        C.put(a, cx, 2, "bone")
        return C.outline(a)
    return [f(2), f(3)]


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
        C.put(a, 3, 3, "bone")  # bright 1 px core
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


def _armored(i, crack=0):
    """Armored orb: violet core inside a bone shell (rim); crack frames split the shell."""
    a = C.new(10, 10)
    C.disc(a, 5, 5, 4.4, "bone")
    C.disc(a, 5, 5, 2.9, "violet")
    a[(a == C.ci("violet")) & (C.grid(10, 10)[0] + C.grid(10, 10)[1] > 11)] = C.ci("violet_dark")
    C.put(a, 4 + i, 4, "bone")
    if crack:  # broken shell: a dark gap through the rim and missing chips
        for x, y in ((2, 2), (3, 3), (7, 7), (8, 6), (2, 7)):
            C.put(a, x, y, "violet_dark" if crack == 1 else C.T)
        if crack == 2:
            for x, y in ((1, 5), (5, 1), (8, 3)):
                C.put(a, x, y, C.T)
    return C.outline(a)


def orb_armored():
    return [_armored(0), _armored(1)]


def orb_armored_crack():
    return [_armored(0, 1), _armored(1, 2)]


def orb_split():
    """Splitting orb (8x8, slightly larger): a violet orb with a bone seam that shows it will burst into three."""
    frames = []
    for i in range(2):
        a = C.new(8, 8)
        C.disc(a, 4, 4, 3.3, "violet")
        for k in range(3):  # three seams meeting in the centre
            ang = k * 2.094 + i * 0.3
            C.put(a, int(4 + math.cos(ang) * 2), int(4 + math.sin(ang) * 2), "bone")
        C.put(a, 4, 4, "bone")
        frames.append(C.outline(a))
    return frames


def blood_sigil():
    """Blood sigil ground hazard, 32x32: frames 0-1 telegraph (thin red circle outline, pulsing), 2-3 lethal fill."""
    frames = []
    xx, yy = C.grid(32, 32)
    d = np.sqrt((xx - 16) ** 2 + (yy - 16) ** 2)
    for i in range(4):
        a = C.new(32, 32)
        if i < 2:
            a[(d <= 14.5) & (d >= 13.3 - i)] = C.ci("blood")
            for k in range(6):  # tick marks around the ring
                ang = k * math.pi / 3 + i * 0.26
                C.put(a, int(16 + math.cos(ang) * 11), int(16 + math.sin(ang) * 11), "blood_dark")
        else:
            a[d <= 14.5] = C.ci("blood_dark")
            a[(d <= 14.5) & (d >= 12.8)] = C.ci("blood")
            for k in range(3):  # a bright inner rune triangle
                ang = k * 2.094 + (i - 2) * 1.047
                C.line(a, 16 + math.cos(ang) * 8, 16 + math.sin(ang) * 8, 16 + math.cos(ang + 2.094) * 8, 16 + math.sin(ang + 2.094) * 8, "blood")
        frames.append(a)
    return frames


SPRITES = {
    "orb_armored": orb_armored, "orb_armored_crack": orb_armored_crack, "orb_split": orb_split, "blood_sigil": blood_sigil,
    "orb_small": orb_small, "orb_large": orb_large, "rune_shard": rune_shard,
    "blade": blade, "wraith": wraith, "wraith_fade": wraith_fade,
}
