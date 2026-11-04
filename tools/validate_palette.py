#!/usr/bin/env python3
"""Fail (exit 1) if any asset pixel is off-palette, uses partial alpha, or a sprite breaks size rules.

Usage: python3 tools/validate_palette.py
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gen_arena  # noqa: E402
from nglib import spec  # noqa: E402
from nglib.palette import NAMES, RESERVED, RGB  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
PAL = np.array(RGB, dtype=np.int32)
errors = []
# Previews that intentionally show a render-side alpha blend (not game art): exempt from the palette check.
PALETTE_EXEMPT = {"translucency_demo.png"}
# Reserved-color policy, independent of the generator's own group labels:
#   gameplay sprites (tools/nglib/spec.py) may use any palette color;
#   the explicit exception list below may use violet/violet_dark (telegraphs, eyes, casters) - never red;
#   EVERY other sprite (decor, landmarks, UI frames, fence runs...) and every arena background: no reserved color.
EXCEPTION_PREFIXES = ("rune_glow_", "shade_", "stalker_")
EXCEPTION_NAMES = {"altar_flame_tele", "portal_ignite", "forest_eyes", "portal_smoke", "forest_leaf_ash"}
EXCEPTION_ALLOWED = {"violet", "violet_dark"}


def err(msg):
    errors.append(msg)


def load(path):
    img = Image.open(path)
    if img.mode not in ("RGBA", "RGB"):
        err(f"{path}: mode {img.mode}, expected RGBA/RGB")
        img = img.convert("RGBA")
    return np.array(img.convert("RGBA"))


def check_pixels(path, px):
    alpha = px[..., 3]
    bad_alpha = ~np.isin(alpha, (0, 255))
    if bad_alpha.any():
        y, x = np.argwhere(bad_alpha)[0]
        err(f"{os.path.relpath(path, ROOT)}: partial alpha {alpha[y, x]} at ({x},{y}); use dithering")
    rgb = px[..., :3].astype(np.int32)
    opaque = alpha == 255
    key = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    pal_key = (PAL[:, 0] << 16) | (PAL[:, 1] << 8) | PAL[:, 2]
    off = opaque & ~np.isin(key, pal_key)
    if off.any():
        y, x = np.argwhere(off)[0]
        err(f"{os.path.relpath(path, ROOT)}: {int(off.sum())} off-palette px, first #{key[y, x]:06x} at ({x},{y})")


def check_board(images, bp, scale=3):
    """A preview board must exist and be an exact nearest-neighbour upscale."""
    name = os.path.relpath(bp, ASSETS)
    if bp not in images:
        err(f"missing {name}")
        return
    b = images[bp]
    if b.shape[0] % scale or b.shape[1] % scale:
        err(f"{name} size is not a multiple of {scale}")
        return
    base = b[::scale, ::scale]
    if not np.array_equal(np.repeat(np.repeat(base, scale, 0), scale, 1), b):
        err(f"{name} is not a clean {scale}x nearest-neighbour upscale")


def main():
    if len(NAMES) != 19:
        err(f"palette has {len(NAMES)} colors, expected 19")
    pngs = sorted(glob.glob(os.path.join(ASSETS, "**", "*.png"), recursive=True))
    if not pngs:
        err("no PNGs under assets/ - run tools/gen_assets.py first")
    images = {}
    for p in pngs:
        images[p] = load(p)
        if os.path.basename(p) not in PALETTE_EXEMPT:
            check_pixels(p, images[p])

    # expected sprite table: gameplay sprites (spec.py) + arena sprites (layout-dependent, from the generator)
    art = gen_arena.build()
    expected = dict(spec.SPRITES)
    for n, frames in art["sprites"].items():
        expected[n] = (frames[0].shape[1], frames[0].shape[0], len(frames))
    groups = art["groups"]

    def reserved_used(px):
        rgb = px[..., :3][px[..., 3] == 255]
        used = {tuple(c) for c in np.unique(rgb.reshape(-1, 3), axis=0)} if len(rgb) else set()
        return {NAMES[RGB.index(c)] for c in used if c in RGB} & RESERVED

    for n in sorted(expected):
        if n in spec.SPRITES:
            continue
        p = os.path.join(ASSETS, "sprites", f"{n}.png")
        if p not in images:
            continue
        allowed = EXCEPTION_ALLOWED if (n in EXCEPTION_NAMES or n.startswith(EXCEPTION_PREFIXES)) else set()
        bad = reserved_used(images[p]) - allowed
        if bad:
            err(f"sprites/{n}.png ({groups.get(n, '?')}) uses reserved gameplay colors {sorted(bad)}")
    for n in spec.BACKGROUNDS:  # every arena background is decor
        p = os.path.join(ASSETS, "backgrounds", f"{n}.png")
        if p in images:
            bad = reserved_used(images[p])
            if bad:
                err(f"backgrounds/{n}.png uses reserved gameplay colors {sorted(bad)}")

    # sprite sheet size rules
    found = {os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(ASSETS, "sprites", "*.png"))}
    for name in sorted(found - set(expected)):
        err(f"sprites/{name}.png is not produced by the generators")
    for name, (fw, fh, n) in expected.items():
        p = os.path.join(ASSETS, "sprites", f"{name}.png")
        if p not in images:
            err(f"missing sprite sheet sprites/{name}.png")
            continue
        h, w = images[p].shape[:2]
        if (w, h) != (fw * n, fh):
            err(f"sprites/{name}.png is {w}x{h}, expected {fw * n}x{fh} ({n} frames of {fw}x{fh})")
        for i in range(n):
            if not images[p][:, i * fw:(i + 1) * fw, 3].any():
                err(f"sprites/{name}.png frame {i} is empty")
    for name, (bw, bh) in spec.BACKGROUNDS.items():
        p = os.path.join(ASSETS, "backgrounds", f"{name}.png")
        if p not in images:
            err(f"missing background backgrounds/{name}.png")
        elif images[p].shape[:2] != (bh, bw):
            err(f"backgrounds/{name}.png is {images[p].shape[1]}x{images[p].shape[0]}, expected {bw}x{bh}")

    # atlas: every frame present, in bounds, sized per spec, pixels equal to the source sheet
    ap, jp = os.path.join(ASSETS, "atlas", "nightgrave.png"), os.path.join(ASSETS, "atlas", "nightgrave.json")
    if ap in images and os.path.exists(jp):
        atlas = images[ap]
        frames = json.load(open(jp, encoding="utf-8"))["frames"]
        for name, (fw, fh, n) in expected.items():
            sheet = images.get(os.path.join(ASSETS, "sprites", f"{name}.png"))
            for i in range(n):
                fr = frames.get(f"{name}_{i}")
                if fr is None:
                    err(f"atlas missing frame {name}_{i}")
                    continue
                f = fr["frame"]
                if (f["w"], f["h"]) != (fw, fh) or f["x"] + fw > atlas.shape[1] or f["y"] + fh > atlas.shape[0]:
                    err(f"atlas frame {name}_{i} has bad rect {f}")
                elif sheet is not None and not np.array_equal(
                        atlas[f["y"]:f["y"] + fh, f["x"]:f["x"] + fw], sheet[:, i * fw:(i + 1) * fw]):
                    err(f"atlas frame {name}_{i} differs from sprites/{name}.png")
    else:
        err("missing atlas/nightgrave.png or atlas/nightgrave.json")

    # style board: exact 3x nearest-neighbour upscale
    for board, scale in (("style_board", 3), ("stress_board", 3), ("arena_board", 3), ("variation_board", 3),
                         ("animation_strips", 4), ("translucency_demo", 3)):
        check_board(images, os.path.join(ASSETS, "preview", f"{board}.png"), scale)
    pj = os.path.join(ASSETS, "data", "arena_props.json")
    if not os.path.exists(pj):
        err("missing data/arena_props.json")
    else:
        for p in json.load(open(pj, encoding="utf-8"))["props"]:
            if p["sprite"] not in expected or p["frame"] >= expected[p["sprite"]][2]:
                err(f"arena_props.json references missing sprite/frame {p['sprite']}:{p['frame']}")

    if errors:
        print(f"PALETTE/SIZE VALIDATION FAILED ({len(errors)} problems):")
        for e in errors:
            print("  -", e)
        return 1
    print(f"OK: {len(pngs)} PNGs on the {len(NAMES)}-color palette, sizes match, no reserved colors in decor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
