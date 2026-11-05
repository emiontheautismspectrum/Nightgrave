"""Compose the arena scene exactly like the game draws it (RGB, with the render-side alphas of the flat layers).

forest_far, forest_mid -> forest_mist (alpha) -> arena_ground -> ground telegraphs -> y-sorted props + actors
-> fog_overlay (alpha) -> vignette, vignette_outer (alpha) -> forest_near
Sprite and background PNGs stay palette-pure; only these composites contain blended colours.
"""
import numpy as np

from . import canvas as C
from .palette import RGB

W, H = 480, 270
RGBF = np.array(RGB, dtype=np.float64)


def frame_of(sprites, name, f=0, flip=False):
    a = sprites[name][f]
    return a[:, ::-1] if flip else a


def paste_rgb(img, idx, x, y, alpha=1.0):
    h, w = idx.shape
    x0, y0, x1, y1 = max(0, x), max(0, y), min(img.shape[1], x + w), min(img.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    src = idx[y0 - y:y1 - y, x0 - x:x1 - x]
    m = src != C.T
    dst = img[y0:y1, x0:x1]
    dst[m] = dst[m] * (1 - alpha) + RGBF[src[m]] * alpha


def compose_rgb(bg, sprites, props, actors=(), telegraphs=(), alphas=None, overrides=None, prop_alpha=None):
    """actors: (sprite, frame, x, y, baseY, flip). telegraphs: (sprite, frame, x, y). overrides: {prop index: frame}.
    prop_alpha: {prop index: alpha} (translucency demo)."""
    al = alphas or {}
    img = np.zeros((H, W, 3), dtype=np.float64)
    img[:] = RGBF[C.ci("bg0")]
    paste_rgb(img, bg["forest_far"], 0, 0)
    paste_rgb(img, bg["forest_mid"], 0, 0)
    if "forest_mist" in bg:
        paste_rgb(img, bg["forest_mist"], 0, 0, al.get("forest_mist", 1.0))
    paste_rgb(img, bg["arena_ground"], 0, 0)
    for name, f, x, y in telegraphs:
        paste_rgb(img, sprites[name][f], x, y)
    items = []
    for i, p in enumerate(props):
        f = (overrides or {}).get(i, p["frame"])
        a = (prop_alpha or {}).get(i, 1.0)
        items.append((p["baseY"], 0, i, frame_of(sprites, p["sprite"], f, p["flip"]), p["x"], p["y"], a))
    for k, (name, f, x, y, base, flip) in enumerate(actors):
        items.append((base, 1, k, frame_of(sprites, name, f, flip), x, y, 1.0))
    for _b, _o, _k, spr, x, y, a in sorted(items, key=lambda t: (t[0], t[1], t[2])):
        paste_rgb(img, spr, x, y, a)
    paste_rgb(img, bg["fog_overlay"], 0, 0, al.get("fog_overlay", 1.0))
    paste_rgb(img, bg["vignette"], 0, 0, al.get("vignette", 1.0))
    if "vignette_outer" in bg:
        paste_rgb(img, bg["vignette_outer"], 0, 0, al.get("vignette_outer", 1.0))
    paste_rgb(img, bg["forest_near"], 0, 0)
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


def upscale(a, s):
    return np.repeat(np.repeat(a, s, axis=0), s, axis=1)
