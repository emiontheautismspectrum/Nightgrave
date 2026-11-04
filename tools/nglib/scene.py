"""Compose the arena scene in the spec's draw order (palette arrays, nearest-neighbour, no blending).

forest_far, forest_mid -> arena_ground -> ground telegraphs -> y-sorted props + actors -> fog -> vignette -> forest_near
"""
import numpy as np

from . import canvas as C

W, H = 480, 270


def frame_of(sprites, name, f=0, flip=False):
    a = sprites[name][f]
    return a[:, ::-1] if flip else a


def compose_scene(bg, sprites, props, actors=(), telegraphs=(), fog=True, overrides=None):
    """actors: (sprite, frame, x, y, baseY, flip). telegraphs: (sprite, frame, x, y) drawn on the ground.
    overrides: {prop index: frame} to show animation frames."""
    a = np.full((H, W), C.ci("bg0"), dtype=np.int16)
    for name in ("forest_far", "forest_mid"):
        C.paste(a, bg[name], 0, 0)
    C.paste(a, bg["arena_ground"], 0, 0)
    for name, f, x, y in telegraphs:
        C.paste(a, sprites[name][f], x, y)
    items = []
    for i, p in enumerate(props):
        f = (overrides or {}).get(i, p["frame"])
        items.append((p["baseY"], 0, i, frame_of(sprites, p["sprite"], f, p["flip"]), p["x"], p["y"]))
    for k, (name, f, x, y, base, flip) in enumerate(actors):
        items.append((base, 1, k, frame_of(sprites, name, f, flip), x, y))
    for _b, _o, _k, spr, x, y in sorted(items, key=lambda t: (t[0], t[1], t[2])):
        C.paste(a, spr, x, y)
    if fog:
        for ty in range(0, H, 256):
            for tx in range(0, W, 256):
                C.paste(a, bg["fog_overlay"], tx, ty)
    C.paste(a, bg["vignette"], 0, 0)
    C.paste(a, bg["forest_near"], 0, 0)
    return a


def upscale(a, s):
    return np.repeat(np.repeat(a, s, axis=0), s, axis=1)
