#!/usr/bin/env python3
"""Readability check for the arena (exit 1 on failure).

1. Each projectile sprite is placed at 300 seeded positions inside the arena on the composed ground
   (forest + arena_ground), then fog and vignette are drawn over it exactly as in the game. For each placement we
   compare the mean relative luminance of the projectile's body pixels (violet / blood) with the mean luminance of the
   ring of pixels around it (WCAG contrast ratio). Targets: violet things >= 3.0, blood red >= 2.5 (worst placement).
2. The central 200x120 calm zone of arena_ground must have no high-contrast detail: the largest contrast between any
   two neighbouring pixels must stay <= CALM_MAX.

If a value is below target, fix the GROUND (darker/calmer), never recolor threats.
Usage: python3 tools/check_readability.py
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import arena_layout as L  # noqa: E402
from nglib import canvas as C  # noqa: E402
from nglib.palette import IDX, RGB  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
SAMPLES = 300
TARGET = {"violet": 3.0, "blood": 2.5}
PROJECTILES = {"orb_small": "violet", "orb_large": "violet", "rune_shard": "violet", "wraith": "violet", "blade": "blood"}
CALM_MAX = 1.6


def lum_table():
    def lin(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return np.array([0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) for r, g, b in RGB] + [0.0])  # last = T


LUM = lum_table()


def load_idx(path):
    """PNG -> palette index array (-1 transparent)."""
    px = np.array(Image.open(path).convert("RGBA"))
    out = np.full(px.shape[:2], -1, dtype=np.int16)
    for i, (r, g, b) in enumerate(RGB):
        m = (px[..., 0] == r) & (px[..., 1] == g) & (px[..., 2] == b) & (px[..., 3] == 255)
        out[m] = i
    return out


def contrast(l1, l2):
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def main():
    bg = lambda n: load_idx(os.path.join(ASSETS, "backgrounds", f"{n}.png"))  # noqa: E731
    ground = np.full((L.SCREEN[1], L.SCREEN[0]), IDX["bg0"], dtype=np.int16)
    for n in ("forest_far", "forest_mid", "arena_ground"):
        C.paste(ground, bg(n), 0, 0)
    fog, vig = bg("fog_overlay"), bg("vignette")
    rng = np.random.default_rng(L.SEED)
    x0, y0, x1, y1 = L.ARENA
    failed = False
    print(f"projectile contrast vs surroundings ({SAMPLES} placements each, fog + vignette on top):")
    for name, hue in PROJECTILES.items():
        sheet = load_idx(os.path.join(ASSETS, "sprites", f"{name}.png"))
        h = sheet.shape[0]
        frames = [sheet[:, i * h:(i + 1) * h] if sheet.shape[1] % h == 0 else sheet for i in range(max(1, sheet.shape[1] // h))]
        ratios = []
        for _ in range(SAMPLES):
            f = frames[int(rng.integers(0, len(frames)))]
            fh, fw = f.shape
            x = int(rng.uniform(x0, x1 - fw))
            y = int(rng.uniform(y0, y1 - fh))
            scene = ground.copy()
            C.paste(scene, f, x, y)
            for ty in range(0, scene.shape[0], 256):
                for tx in range(0, scene.shape[1], 256):
                    C.paste(scene, fog, tx, ty)
            C.paste(scene, vig, 0, 0)
            body = np.zeros_like(scene, dtype=bool)
            body[y:y + fh, x:x + fw] = f == IDX[hue]
            sil = np.zeros_like(body)
            sil[y:y + fh, x:x + fw] = f != -1
            ring = np.zeros_like(body)
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    ring |= np.roll(np.roll(sil, dy, 0), dx, 1)
            ring &= ~sil
            ratios.append(contrast(LUM[scene[body]].mean(), LUM[scene[ring]].mean()))
        r = np.array(ratios)
        ok = r.min() >= TARGET[hue]
        failed |= not ok
        print(f"  {name:11s} ({hue:6s}) min {r.min():.2f}  p5 {np.percentile(r, 5):.2f}  median {np.median(r):.2f}"
              f"  target >= {TARGET[hue]}  {'OK' if ok else 'FAIL'}")
    # calm zone
    g = bg("arena_ground")
    cx0, cy0, cx1, cy1 = L.CALM_ZONE
    z = LUM[g[cy0:cy1, cx0:cx1]]
    worst = 0.0
    for a_, b_ in ((z[:, 1:], z[:, :-1]), (z[1:, :], z[:-1, :])):
        hi, lo = np.maximum(a_, b_), np.minimum(a_, b_)
        worst = max(worst, float(((hi + 0.05) / (lo + 0.05)).max()))
    ok = worst <= CALM_MAX
    failed |= not ok
    print(f"calm zone {L.CALM_ZONE}: max neighbour contrast {worst:.2f} (<= {CALM_MAX})  {'OK' if ok else 'FAIL'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
