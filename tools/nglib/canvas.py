"""Index-color canvas helpers. A canvas is an int16 numpy array of palette indices, -1 = transparent.

Everything is integer / nearest-neighbour: no anti-aliasing, no partial alpha.
"""
import numpy as np
from PIL import Image

from .palette import IDX, DARKER, RGB

T = -1
BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.int16)

_RGBA = np.zeros((len(RGB) + 1, 4), dtype=np.uint8)
for _i, (_r, _g, _b) in enumerate(RGB):
    _RGBA[_i + 1] = (_r, _g, _b, 255)


def ci(col):
    """Accept a palette name or index."""
    return IDX[col] if isinstance(col, str) else int(col)


def new(w, h):
    return np.full((h, w), T, dtype=np.int16)


def grid(w, h):
    yy, xx = np.mgrid[0:h, 0:w]
    return xx + 0.5, yy + 0.5


def put(a, x, y, col):
    h, w = a.shape
    if 0 <= x < w and 0 <= y < h:
        a[y, x] = ci(col)


def disc(a, cx, cy, r, col):
    h, w = a.shape
    xx, yy = grid(w, h)
    a[(xx - cx) ** 2 + (yy - cy) ** 2 <= r * r] = ci(col)


def ring(a, cx, cy, r0, r1, col, mask=None):
    h, w = a.shape
    xx, yy = grid(w, h)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    m = (d >= r0) & (d <= r1)
    if mask is not None:
        m &= mask
    a[m] = ci(col)


def line(a, x0, y0, x1, y1, col):
    """Bresenham line."""
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        put(a, x0, y0, col)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def from_ascii(rows, legend):
    h, w = len(rows), len(rows[0])
    a = new(w, h)
    for y, row in enumerate(rows):
        assert len(row) == w, f"ragged ascii row {y}: {row!r}"
        for x, ch in enumerate(row):
            if ch != ".":
                a[y, x] = ci(legend[ch])
    return a


def paste(dst, src, ox, oy):
    """Paste opaque pixels of src onto dst at offset (clipped)."""
    h, w = src.shape
    H, W = dst.shape
    for y in range(h):
        ty = y + oy
        if not 0 <= ty < H:
            continue
        for x in range(w):
            tx = x + ox
            if 0 <= tx < W and src[y, x] != T:
                dst[ty, tx] = src[y, x]


def shifted(src, dx, dy):
    out = new(src.shape[1], src.shape[0])
    paste(out, src, dx, dy)
    return out


def neighbors4(a):
    """Yield (dy, dx) shifted views helper: returns list of arrays of neighbour colors (T outside)."""
    h, w = a.shape
    p = np.full((h + 2, w + 2), T, dtype=np.int16)
    p[1:-1, 1:-1] = a
    return [p[1:-1, 0:-2], p[0:-2, 1:-1], p[1:-1, 2:], p[2:, 1:-1]]  # left, up, right, down


def outline(a, color=None):
    """Add a 1 px outline around opaque pixels, in the darker shade of the adjacent fill."""
    out = a.copy()
    empty = a == T
    darker = np.array(DARKER, dtype=np.int16)
    for nb in neighbors4(a):
        m = empty & (out == T) & (nb != T)
        if color is None:
            out[m] = darker[nb[m]]
        else:
            out[m] = ci(color)
    return out


def halo(a, col, phase=0):
    """Baked glow: checkerboard-dithered 1 px halo outside the shape (8-neighbourhood)."""
    h, w = a.shape
    p = np.full((h + 2, w + 2), T, dtype=np.int16)
    p[1:-1, 1:-1] = a
    near = np.zeros((h, w), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx or dy:
                near |= p[1 + dy:h + 1 + dy, 1 + dx:w + 1 + dx] != T
    xx, yy = np.mgrid[0:w, 0:h]
    checker = ((xx.T + yy.T + phase) % 2) == 0
    out = a.copy()
    out[(a == T) & near & checker] = ci(col)
    return out


def bayer_mask(w, h, level, ox=0, oy=0):
    """True where an ordered-dither pattern keeps a pixel, for coverage level in [0, 1]."""
    yy, xx = np.mgrid[0:h, 0:w]
    return BAYER4[(yy + oy) % 4, (xx + ox) % 4] < level * 16


def dither_out(a, keep, ox=0, oy=0):
    """Remove pixels with ordered dithering, keeping roughly `keep` fraction (translucency)."""
    h, w = a.shape
    out = a.copy()
    out[~bayer_mask(w, h, keep, ox, oy)] = T
    return out


def recolor(a, mapping):
    out = a.copy()
    for src, dst in mapping.items():
        out[a == ci(src)] = ci(dst)
    return out


def to_image(a):
    return Image.fromarray(_RGBA[a + 1], "RGBA")


def strip(frames):
    """Horizontal strip of equally sized frames."""
    h, w = frames[0].shape
    out = new(w * len(frames), h)
    for i, f in enumerate(frames):
        assert f.shape == (h, w), "frame size mismatch"
        out[:, i * w:(i + 1) * w] = f
    return out


def value_noise(w, h, cell, rng, wrap=False):
    """Smooth value noise in [0,1] via bilinear interpolation of a coarse random grid."""
    gw, gh = w // cell + 2, h // cell + 2
    if wrap:
        assert w % cell == 0 and h % cell == 0
        gw, gh = w // cell, h // cell
    g = rng.random((gh, gw))
    yy, xx = np.mgrid[0:h, 0:w]
    fx, fy = xx / cell, yy / cell
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    if wrap:
        x1, y1 = (x0 + 1) % gw, (y0 + 1) % gh
        x0, y0 = x0 % gw, y0 % gh
    else:
        x1, y1 = x0 + 1, y0 + 1
    top = g[y0, x0] * (1 - tx) + g[y0, x1] * tx
    bot = g[y1, x0] * (1 - tx) + g[y1, x1] * tx
    return top * (1 - ty) + bot * ty
