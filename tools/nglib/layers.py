"""Layered sprite building for the boss art (stage ART-B).

A figure is a `Rig`: named layers, each a full-size index canvas (-1 = transparent), drawn back to front. A frame of an
animation is the same rig composed with other per-layer offsets and per-row shifts (hair, gown rows, cloak rows, tail
rows) or with a layer redrawn (arms, glow), so every frame is built from drawn parts and nothing is ever resampled.
Whole-pixel moves only: no rotation, no scaling, no anti-aliasing.
"""
import math

import numpy as np

from . import canvas as C


class Rig:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.order = []
        self.layers = {}

    def layer(self, name):
        """Create (on top of the stack) or fetch a layer."""
        if name not in self.layers:
            self.layers[name] = C.new(self.w, self.h)
            self.order.append(name)
        return self.layers[name]

    def art(self, name, rows, legend, x, y):
        """Paste hand-drawn ASCII rows onto a layer with their top-left at (x, y)."""
        C.paste(self.layer(name), C.from_ascii(rows, legend), x, y)
        return self.layers[name]

    def compose(self, move=None, rows=None, hide=()):
        """Flatten. move: {layer: (dx, dy)}; rows: {layer: per-row dx (sequence of length h)}; hide: layer names."""
        out = C.new(self.w, self.h)
        for name in self.order:
            if name in hide:
                continue
            a = self.layers[name]
            if rows and name in rows:
                a = shift_rows(a, rows[name])
            dx, dy = (move or {}).get(name, (0, 0))
            C.paste(out, a, dx, dy)
        return out


def shift_rows(a, dxs):
    """Every row y moved horizontally by the whole-pixel offset dxs[y] (pixels pushed out of the canvas are lost)."""
    h, w = a.shape
    out = C.new(w, h)
    for y in range(h):
        dx = int(dxs[y])
        if dx == 0:
            out[y] = a[y]
        elif dx > 0:
            out[y, dx:] = a[y, :w - dx]
        else:
            out[y, :w + dx] = a[y, -dx:]
    return out


def sway(h, top, bottom, amp, wavelength, phase):
    """Per-row offsets of a hanging thing fixed at `top`: 0 above it, growing to +-amp at `bottom`, a travelling wave.
    Rounded half away from zero so a small amplitude still moves the lowest rows by a whole pixel."""
    out = [0] * h
    span = max(1, bottom - top)
    for y in range(top, h):
        g = min(1.0, (y - top) / span)
        v = amp * g * math.sin(2 * math.pi * (y - top) / wavelength + phase)
        out[y] = int(math.copysign(math.floor(abs(v) + 0.5), v))
    return out


def clip_below(a, ground):
    """Everything at or below row `ground` vanishes (the mask of a sink / an emerge)."""
    out = a.copy()
    out[ground:, :] = C.T
    return out


def lowered(a, dy, ground=None):
    """The figure moved down by dy rows and cut off at the ground row (default: the canvas bottom): the lower rows
    vanish first."""
    out = C.shifted(a, 0, dy)
    return clip_below(out, a.shape[0] if ground is None else ground)


def thick_line(a, x0, y0, x1, y1, col, shade=None):
    """A 2 px limb: the line plus the same line one pixel to the right (in `shade`, default the same colour)."""
    C.line(a, x0 + 1, y0, x1 + 1, y1, shade if shade is not None else col)
    C.line(a, x0, y0, x1, y1, col)


def curve(a, pts, col):
    """A polyline through whole-pixel points."""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        C.line(a, x0, y0, x1, y1, col)


def flash(a, col="bone", keep=("bg0",)):
    """The hit flash: every body pixel in one colour, the darkest outline kept."""
    out = a.copy()
    m = a != C.T
    for k in keep:
        m &= a != C.ci(k)
    out[m] = C.ci(col)
    return out


def motes(a, pts, col):
    for x, y in pts:
        C.put(a, int(x), int(y), col)
    return a


def share(frames, names):
    """Share of opaque pixels (over all frames) that use the given palette colours."""
    idx = [C.ci(n) for n in names]
    op = sum(int((f != C.T).sum()) for f in frames)
    hit = sum(int(np.isin(f, idx).sum()) for f in frames)
    return hit / max(1, op)
