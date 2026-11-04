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

from nglib import spec  # noqa: E402
from nglib.palette import RGB  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
PAL = np.array(RGB, dtype=np.int32)
errors = []


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


def main():
    pngs = sorted(glob.glob(os.path.join(ASSETS, "**", "*.png"), recursive=True))
    if not pngs:
        err("no PNGs under assets/ - run tools/gen_assets.py first")
    images = {}
    for p in pngs:
        images[p] = load(p)
        check_pixels(p, images[p])

    # sprite sheet size rules
    found = {os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(ASSETS, "sprites", "*.png"))}
    for name in sorted(found - set(spec.SPRITES)):
        err(f"sprites/{name}.png is not listed in tools/nglib/spec.py")
    for name, (fw, fh, n) in spec.SPRITES.items():
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
        for name, (fw, fh, n) in spec.SPRITES.items():
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
    bp = os.path.join(ASSETS, "preview", "style_board.png")
    if bp not in images:
        err("missing preview/style_board.png")
    else:
        b = images[bp]
        if b.shape[0] % 3 or b.shape[1] % 3:
            err("style_board.png size is not a multiple of 3")
        else:
            base = b[::3, ::3]
            if not np.array_equal(np.repeat(np.repeat(base, 3, 0), 3, 1), b):
                err("style_board.png is not a clean 3x nearest-neighbour upscale")

    if errors:
        print(f"PALETTE/SIZE VALIDATION FAILED ({len(errors)} problems):")
        for e in errors:
            print("  -", e)
        return 1
    print(f"OK: {len(pngs)} PNGs, all pixels on the 16-color palette, sizes match spec")
    return 0


if __name__ == "__main__":
    sys.exit(main())
