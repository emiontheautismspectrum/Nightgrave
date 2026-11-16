"""The new bosses (package B3 / B5, FEATURES.bosses; dark until enabled). Original designs.

Same body rule as the old bosses: dark stone, forest, moss, bone and violet_dark only; bright violet / blood appear
only where a frame is a telegraph (the cast frames' glow). The ROOT attacks of the Thorn Mother reuse the clearing's
sinuous ground-root shapes, recoloured to the threat colour (blood = unparryable).

- thorn_mother: redrawn in the boss art stage, see tools/nglib/thorn_queen.py (the keys stay `thorn_mother_*`).
- toller (40x56): a tall bell-headed figure, robed, with hanging chains; the bell swings (the visual beat) and the
  clapper strikes on the cast frames. Its teleport and chain-throw rows (boss art stage) are in toller_fx.py.
- root_bloom (16x16, 4f): a ground bloom lighting up (violet: it bursts into violet shards).
- bell_ring (32x32, 4f): the toll marker, a bone ring widening from the bell on every toll beat.
"""
import math

import numpy as np

from . import canvas as C


def _root(a, x0, y0, ang, length, width, col, wiggle=1.6, phase=0.0, tip=None):
    """A sinuous tapering root from (x0, y0): the clearing's ground-root shape."""
    x, y = float(x0), float(y0)
    steps = max(2, int(length))
    for k in range(steps):
        f = k / steps
        w = max(0.5, width * (1 - f))
        bend = math.sin(f * 5.0 + phase) * wiggle * 0.12
        ang2 = ang + bend
        x += math.cos(ang2)
        y += math.sin(ang2)
        C.disc(a, x, y, w, col)
    if tip:
        C.put(a, int(round(x)), int(round(y)), tip)
    return x, y


# ---------------------------------------------------------------- the toller 40x56

def _toller(swing=0, strike=False, glow=None, flash=False, show=1.0, tilt=0, i=0, arm=None):
    """swing: -1 left, 0 centre, 1 right (the bell's beat). arm: (hand x, hand y, chain points) raises the right arm
    out of the robe with a chain in its hand (the throw row, tools/nglib/toller_fx.py); None = both hands on the
    hanging chains (every old frame: unchanged pixels)."""
    W, H = 40, 56
    a = C.new(W, H)
    xx, yy = C.grid(W, H)
    cx = 20
    # robe: a tall narrow column widening to a ragged hem
    robe = (yy >= 22) & (yy <= 54) & (np.abs(xx - cx - tilt * (yy - 22) / 32) <= 4 + (yy - 22) * 0.28)
    hem = (yy > 51) & (((xx.astype(int) + i) % 3) == 0)
    a[robe & ~hem] = C.ci("stone_dark")
    a[robe & ~hem & ((xx - cx) > 2)] = C.ci("bg1")
    a[robe & ~hem & ((xx - cx) < -3) & (yy < 40)] = C.ci("stone")
    # shoulders and the yoke the bell hangs from
    C.line(a, cx - 7, 21, cx + 7, 21, "stone")
    C.line(a, cx, 21, cx, 17, "stone")
    # the bell (the head): a dome, a waist and a flared bone lip, turned around its hanging point (cx, 3): the swing
    ang = swing * 0.28
    ca, sa = math.cos(ang), math.sin(ang)
    px, py = cx, 3.0
    u = (xx - px) * ca + (yy - py) * sa  # bell-local coordinates (v down the bell's axis)
    v = -(xx - px) * sa + (yy - py) * ca
    half = np.where(v < 5, np.sqrt(np.clip(25 - (v - 5) ** 2, 0, None)) * 1.15, 5.6 + np.clip(v - 9, 0, None) * 0.75)
    bell = (v >= 0.5) & (v <= 16.5) & (np.abs(u) <= half)
    a[bell] = C.ci("stone")
    a[bell & (u > half - 2.2)] = C.ci("stone_dark")  # the shade side
    a[bell & (v > 14.6)] = C.ci("bone")  # the bone lip
    a[bell & (np.abs(v - 8) < 0.5)] = C.ci("stone_dark")  # a cast band round the waist
    # the clapper hangs straight down from the dome; it strikes the lip on the cast frames
    lx = px + 15.5 * -sa  # the lip centre
    kx = lx + (swing * 2.5 if strike else -swing * 2.5)
    C.line(a, px - 9 * sa, 3 + 9 * ca, kx, 17.5, "stone_dark")
    C.disc(a, kx, 18.5, 1.4, glow if strike and glow else "bone")
    # a dim face slit in the bell (two hollow eyes)
    for e in (-2.2, 2.2):
        C.put(a, int(round(px + e * ca - 6 * sa)), int(round(py + e * sa + 6 * ca)), glow or "bg0")
    C.disc(a, px, 2.2, 1.4, "stone_dark")  # the crown loop
    # chains hanging from the yoke ends to the hem, swaying with the beat
    for side in (-1, 1):
        x = cx + side * 7
        for k in range(14):
            y = 22 + k * 2
            off = int(round(math.sin(k * 0.5 + swing) * 0.8)) * side
            C.put(a, x + off + (1 if k % 2 else 0) * side, y, "stone" if k % 2 else "bone")
    # hands holding the chains (violet_dark gloves)
    for side in (-1, 1):
        if arm and side > 0:
            continue
        C.disc(a, cx + side * 8, 30, 1.3, "violet_dark")
    if arm:
        hx, hy, links = arm
        C.line(a, cx + 6, 24, hx, hy, "stone")
        C.line(a, cx + 6, 25, hx, hy + 1, "stone_dark")
        C.disc(a, hx + 0.5, hy + 0.5, 1.3, "violet_dark")
        for k, (lx, ly) in enumerate(links):
            C.put(a, lx, ly, "bone" if k % 2 == 0 else "stone")
    a = C.outline(a, color="bg0")
    if glow and strike:
        a = C.halo(a, glow, phase=i)
    if flash:
        a[(a != C.T) & (a != C.ci("bg0"))] = C.ci("bone")
    if show < 1.0:
        a = C.dither_out(a, show, ox=i, oy=i * 2)
    return a


def toller_idle():
    # the swing of one beat pair: centre, right, centre, left (the renderer picks the frame from the beat)
    return [_toller(s, i=k) for k, s in enumerate((0, 1, 0, -1))]


def toller_cast():
    return [_toller(0, i=0), _toller(0, strike=True, i=1), _toller(0, strike=True, glow="violet", i=2), _toller(0, strike=True, glow="violet", i=3)]


def toller_hit():
    return [_toller(0, flash=True), _toller(1, tilt=1)]


def toller_death():
    frames = []
    for k in range(6):
        a = _toller((-1, 1)[k % 2] if k < 3 else 0, tilt=min(4, k), show=1 - k / 6.5, i=k)
        sh = min(10, k * 2)
        b = C.new(40, 56)
        b[sh:, :] = a[:56 - sh, :]
        frames.append(b)
    return frames


# ---------------------------------------------------------------- telegraphs

def root_bloom():
    """A ground bloom lighting up (16x16, 4f): a violet_dark root knot that opens into violet petals (it bursts
    into violet shards when the cue is full)."""
    frames = []
    xx, yy = C.grid(16, 16)
    for i in range(4):
        a = C.new(16, 16)
        for k in range(5):
            ang = k * 2 * math.pi / 5 + 0.3
            r = 2.5 + i * 1.3
            C.line(a, 8, 8, 8 + math.cos(ang) * r, 8 + math.sin(ang) * r, "violet" if i >= 2 else "violet_dark")
            C.put(a, int(round(8 + math.cos(ang) * r)), int(round(8 + math.sin(ang) * r)), "violet" if i >= 1 else "violet_dark")
        C.disc(a, 8, 8, 1.6 + i * 0.3, "violet_dark")
        if i >= 2:
            C.put(a, 7, 7, "bone")
        frames.append(C.outline(a, color="bg0"))
    return frames


def bell_ring():
    """The toll marker (32x32, 4f): a thin bone ring widening from the bell on a toll beat."""
    frames = []
    for i in range(4):
        a = C.new(32, 32)
        r = 5 + i * 3.4
        C.ring(a, 16, 16, r - 0.6, r + 0.4, "bone")
        if i >= 2:
            a = C.dither_out(a, 1 - (i - 1) * 0.3, ox=i, oy=i)
        frames.append(a)
    return frames


SPRITES = {
    "toller_idle": toller_idle,
    "toller_cast": toller_cast,
    "toller_hit": toller_hit,
    "toller_death": toller_death,
    "root_bloom": root_bloom,
    "bell_ring": bell_ring,
}
