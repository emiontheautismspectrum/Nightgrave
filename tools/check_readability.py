#!/usr/bin/env python3
"""Readability check for the arena (exit 1 on failure).

1. GROUND (gating): every projectile frame is evaluated at EVERY position inside the arena rectangle on the
   composed ground (forest + arena_ground), with fog and vignette drawn over it exactly as in the game. For each
   placement: mean relative luminance of the projectile's body pixels (violet / blood, after fog) vs. the mean
   luminance of the 3 px ring around its silhouette -> WCAG contrast ratio. Targets: violet >= 3.0, blood >= 2.5,
   for the worst placement. (The spec asks for >= 300 seeded positions; the exhaustive sweep is a superset.)
2. OVER PROPS (reported, not gating): the same sweep over ground + placed props. Props are drawn behind
   projectiles but some are bright (bone, moon rim), so this shows where Part C's y-sort/translucency and prop
   palette matter.
3. CALM ZONE (gating): the central 200x120 of arena_ground has no neighbouring-pixel contrast above CALM_MAX, and no
   prop box enters it except the author's authoritative graveyard (fence contour reaches x=163).

If a value is below target, fix the GROUND (darker/calmer), never recolor threats.
Usage: python3 tools/check_readability.py
"""
import json
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
TARGET = {"violet": 3.0, "blood": 2.5}
PROJECTILES = {"orb_small": "violet", "orb_large": "violet", "rune_shard": "violet", "wraith": "violet", "blade": "blood"}
CALM_MAX = 1.6
CALM_EXEMPT_KINDS = {"fence", "grave"}  # inside the author's fence contour


def lum_table():
    def lin(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return np.array([0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) for r, g, b in RGB] + [0.0])


LUM = lum_table()


def load_idx(path):
    px = np.array(Image.open(path).convert("RGBA"))
    out = np.full(px.shape[:2], -1, dtype=np.int16)
    for i, (r, g, b) in enumerate(RGB):
        out[(px[..., 0] == r) & (px[..., 1] == g) & (px[..., 2] == b) & (px[..., 3] == 255)] = i
    return out


def shifted_sum(img, mask, ys, xs):
    """sum over mask offsets of img, for every top-left position (ys x xs grid)."""
    out = np.zeros((len(ys), len(xs)))
    for dy, dx in zip(*np.nonzero(mask)):
        out += img[ys[0] + dy:ys[-1] + dy + 1, xs[0] + dx:xs[-1] + dx + 1]
    return out


def sweep(base, fog_mask, frames, hue):
    """Worst/percentile contrast of a projectile at every position inside the arena."""
    x0, y0, x1, y1 = L.ARENA
    lum = LUM[base]
    fog_l = LUM[IDX["fog"]]
    hue_l = LUM[IDX[hue]]
    allr = []
    for f in frames:
        fh, fw = f.shape
        sil = f != -1
        body = f == IDX[hue]
        pad = 3
        ring = np.zeros((fh + 2 * pad, fw + 2 * pad), dtype=bool)
        silp = np.zeros_like(ring)
        silp[pad:pad + fh, pad:pad + fw] = sil
        for dy in range(-pad, pad + 1):
            for dx in range(-pad, pad + 1):
                ring |= np.roll(np.roll(silp, dy, 0), dx, 1)
        ring &= ~silp
        ys = np.arange(y0, y1 - fh)
        xs = np.arange(x0, x1 - fw)
        # body luminance after fog: fog pixels replace body pixels where the fog layer has a pixel
        fogged = shifted_sum(fog_mask.astype(float), body, ys, xs)
        nb = body.sum()
        body_l = (fogged * fog_l + (nb - fogged) * hue_l) / nb
        ring_l = shifted_sum(lum, ring, ys - pad, xs - pad) / ring.sum()
        hi, lo = np.maximum(body_l, ring_l), np.minimum(body_l, ring_l)
        allr.append(((hi + 0.05) / (lo + 0.05)).ravel())
    return np.concatenate(allr)


def main():
    bg = lambda n: load_idx(os.path.join(ASSETS, "backgrounds", f"{n}.png"))  # noqa: E731
    W, H = L.SCREEN
    ground = np.full((H, W), IDX["bg0"], dtype=np.int16)
    for n in ("forest_far", "forest_mid", "arena_ground"):
        C.paste(ground, bg(n), 0, 0)
    fog_tile, vig = bg("fog_overlay"), bg("vignette")
    fog = C.new(W, H)
    for ty in range(0, H, 256):
        for tx in range(0, W, 256):
            C.paste(fog, fog_tile, tx, ty)
    C.paste(fog, vig, 0, 0)  # vignette pixels are bg0 drawn over everything, treat like fog-style overlay
    fog_mask = fog != -1

    def with_overlay(img):
        out = img.copy()
        out[fog_mask] = fog[fog_mask]
        return out

    props = json.load(open(os.path.join(ASSETS, "data", "arena_props.json"), encoding="utf-8"))["props"]
    with_props = ground.copy()
    sheets = {}
    for p in sorted(props, key=lambda q: q["baseY"]):
        if p["sprite"] not in sheets:
            sheets[p["sprite"]] = load_idx(os.path.join(ASSETS, "sprites", f"{p['sprite']}.png"))
        sh = sheets[p["sprite"]]
        fw = p["w"]
        spr = sh[:, p["frame"] * fw:(p["frame"] + 1) * fw]
        C.paste(with_props, spr[:, ::-1] if p["flip"] else spr, p["x"], p["y"])
    g_over = with_overlay(ground)
    p_over = with_overlay(with_props)

    failed = False
    print("projectile contrast vs surroundings (every position in the arena; fog + vignette on top):")
    for name, hue in PROJECTILES.items():
        sheet = load_idx(os.path.join(ASSETS, "sprites", f"{name}.png"))
        h = sheet.shape[0]
        frames = [sheet[:, i * h:(i + 1) * h] for i in range(sheet.shape[1] // h)]
        r = sweep(g_over, fog_mask, frames, hue)
        rp = sweep(p_over, fog_mask, frames, hue)
        ok = r.min() >= TARGET[hue]
        failed |= not ok
        below = (rp < TARGET[hue]).mean() * 100
        print(f"  {name:11s} ({hue:6s}) ground: min {r.min():.2f} p1 {np.percentile(r, 1):.2f} median {np.median(r):.2f}"
              f"  target >= {TARGET[hue]} {'OK' if ok else 'FAIL'}   | over props: min {rp.min():.2f}, {below:.1f}% below target")
    g = bg("arena_ground")
    cx0, cy0, cx1, cy1 = L.CALM_ZONE
    z = LUM[g[cy0:cy1, cx0:cx1]]
    worst = 0.0
    for a_, b_ in ((z[:, 1:], z[:, :-1]), (z[1:, :], z[:-1, :])):
        hi, lo = np.maximum(a_, b_), np.minimum(a_, b_)
        worst = max(worst, float(((hi + 0.05) / (lo + 0.05)).max()))
    ok = worst <= CALM_MAX
    intruders = [p for p in props if not (p["x"] + p["w"] <= cx0 or p["x"] >= cx1 or p["y"] + p["h"] <= cy0 or p["y"] >= cy1)]
    bad = [p for p in intruders if p["kind"] not in CALM_EXEMPT_KINDS and p["sprite"] not in ("portal_altar", "altar_flame")
           and not p.get("inGraveyard")]
    exempt = len(intruders) - len(bad)
    ok_props = not bad
    failed |= not (ok and ok_props)
    print(f"calm zone {L.CALM_ZONE}: max neighbour contrast {worst:.2f} (<= {CALM_MAX}) {'OK' if ok else 'FAIL'}; "
          f"props inside: {len(bad)} {'OK' if ok_props else 'FAIL ' + str([p['sprite'] for p in bad])}"
          f" ({exempt} exempt: author's graveyard fence/graves/altar)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
