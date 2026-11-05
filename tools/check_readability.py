#!/usr/bin/env python3
"""Readability check for the arena (exit 1 on failure).

1. GROUND (gating): every projectile frame is evaluated at EVERY position inside the arena rectangle on the composed
   ground (forest + mist + arena_ground), with fog, both vignette steps and the forest overhang (faded, as the game
   fades it when an actor is near the edge) drawn over it with the game's alphas. For each placement: mean relative
   luminance of the projectile's body pixels (violet / blood, after the overlays) vs. the mean luminance of the 3 px
   ring around its silhouette -> WCAG contrast. Targets: violet >= 3.0, blood >= 2.5 for the worst placement.
2. OVER PROPS (goal, reported): the same sweep over ground + placed props drawn BEHIND the projectile. Goal: violet
   < 10% and blood < 25% of positions below target. Props in FRONT of a projectile fade to 35-45% in the game.
3. CALM ZONE (gating): the central zone of arena_ground has no neighbouring-pixel contrast above CALM_MAX
   (props in the calm zone are checked by check_layout.py).

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
PROJECTILES = {"orb_small": "violet", "orb_large": "violet", "rune_shard": "violet", "wraith": "violet", "blade": "blood",
               "orb_armored": "violet", "orb_split": "violet", "blood_sigil": "blood"}
CALM_MAX = 1.6


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


def lum_rgb(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def sweep(lum, fog_mask, fog_rgb, alpha, frames, hue):
    """Contrast of a projectile at every position in the arena. `lum` = luminance of the scene under the projectile
    (fog already blended in); body pixels under fog are blended with the fog colour at the same alpha."""
    x0, y0, x1, y1 = L.ARENA
    hue_rgb = np.array(RGB[IDX[hue]], dtype=np.float64)
    l_hue = float(lum_rgb(hue_rgb))
    l_hue_fog = float(lum_rgb(hue_rgb * (1 - alpha) + fog_rgb * alpha))
    allr = []
    for f in frames:
        fh, fw = f.shape
        sil = f != -1
        body = f == IDX[hue]
        pad = 3
        silp = np.zeros((fh + 2 * pad, fw + 2 * pad), dtype=bool)
        silp[pad:pad + fh, pad:pad + fw] = sil
        ring = np.zeros_like(silp)
        for dy in range(-pad, pad + 1):
            for dx in range(-pad, pad + 1):
                ring |= np.roll(np.roll(silp, dy, 0), dx, 1)
        ring &= ~silp
        ys = np.arange(y0, y1 - fh)
        xs = np.arange(x0, x1 - fw)
        fogged = shifted_sum(fog_mask.astype(float), body, ys, xs)
        nb = body.sum()
        body_l = (fogged * l_hue_fog + (nb - fogged) * l_hue) / nb
        ring_l = shifted_sum(lum, ring, ys - pad, xs - pad) / ring.sum()
        hi, lo = np.maximum(body_l, ring_l), np.minimum(body_l, ring_l)
        allr.append(((hi + 0.05) / (lo + 0.05)).ravel())
    return np.concatenate(allr)


GOAL_OVER_PROPS = {"violet": 0.10, "blood": 0.25}
OVERHANG_FADE = 0.35
HERO_MIN = 4.0  # hero body vs the ground under it  # the game fades the overhang when an actor is near the arena edge (GameScene)


def main():
    W, H = L.SCREEN
    bgd = os.path.join(ASSETS, "backgrounds")
    lay = json.load(open(os.path.join(ASSETS, "atlas", "manifest.json")))["layout"]
    al = lay.get("alphas", {})
    rgb = lambda n: np.array(Image.open(os.path.join(bgd, f"{n}.png")).convert("RGBA"))  # noqa: E731

    def put(img, im, alpha=1.0):
        m = im[..., 3] == 255
        img[m] = img[m] * (1 - alpha) + im[..., :3][m] * alpha

    base = np.zeros((H, W, 3))
    base[:] = RGB[IDX["bg0"]]
    put(base, rgb("forest_far"))
    put(base, rgb("forest_mid"))
    put(base, rgb("forest_mist"), al.get("forest_mist", 1.0))
    put(base, rgb("arena_ground"))
    with_props = base.copy()
    props = json.load(open(os.path.join(ASSETS, "data", "arena_props.json"), encoding="utf-8"))["props"]
    for p in sorted(props, key=lambda q: q["baseY"]):
        sh = np.array(Image.open(os.path.join(ASSETS, "sprites", f"{p['sprite']}.png")).convert("RGBA"))
        spr = sh[:, p["frame"] * p["w"]:(p["frame"] + 1) * p["w"]]
        if p["flip"]:
            spr = spr[:, ::-1]
        layer = np.zeros((H, W, 4), dtype=np.uint8)
        x, y = p["x"], p["y"]
        hh, ww = spr.shape[:2]
        X0, Y0, X1, Y1 = max(0, x), max(0, y), min(W, x + ww), min(H, y + hh)
        if X1 > X0 and Y1 > Y0:
            layer[Y0:Y1, X0:X1] = spr[Y0 - y:Y1 - y, X0 - x:X1 - x]
            put(with_props, layer)
    fog = rgb("fog_overlay")
    fa = al.get("fog_overlay", 1.0)
    fog_mask = fog[..., 3] == 255
    fog_rgb = np.array(RGB[IDX["fog"]], dtype=np.float64)
    for img in (base, with_props):
        put(img, fog, fa)
        put(img, rgb("vignette"), al.get("vignette", 1.0))
        put(img, rgb("vignette_outer"), al.get("vignette_outer", 1.0))
        put(img, rgb("forest_near"))
        put(img, rgb("forest_overhang"), OVERHANG_FADE)
    # telegraph pass: every rune lit (brightest telegraph frame) -> threats must stay readable over glowing runes too
    with_tele = base.copy()
    for g_, rr_ in enumerate(lay["runes"]):
        sh_ = np.array(Image.open(os.path.join(ASSETS, "sprites", f"rune_glow_{g_}.png")).convert("RGBA"))
        fr = sh_[:, 3 * sh_.shape[0]:4 * sh_.shape[0]]
        layer = np.zeros((H, W, 4), dtype=np.uint8)
        x_, y_ = rr_["x"] - fr.shape[1] // 2, rr_["y"] - fr.shape[0] // 2
        layer[y_:y_ + fr.shape[0], x_:x_ + fr.shape[1]] = fr
        put(with_tele, layer)
    put(with_tele, fog, fa)
    lum_t = lum_rgb(with_tele)
    lum_g, lum_p = lum_rgb(base), lum_rgb(with_props)

    failed = False
    print(f"projectile contrast vs surroundings (every position in the arena; fog at alpha {fa} on top):")
    for name, hue in PROJECTILES.items():
        sheet = load_idx(os.path.join(ASSETS, "sprites", f"{name}.png"))
        h = sheet.shape[0]
        frames = [sheet[:, i * h:(i + 1) * h] for i in range(sheet.shape[1] // h)]
        r = sweep(lum_g, fog_mask, fog_rgb, fa, frames, hue)
        rp = sweep(lum_p, fog_mask, fog_rgb, fa, frames, hue)
        rt = sweep(lum_t, fog_mask, fog_rgb, fa, frames, hue)
        ok = r.min() >= TARGET[hue] and rt.min() >= TARGET[hue]
        below = (rp < TARGET[hue]).mean()
        goal_ok = below < GOAL_OVER_PROPS[hue]
        failed |= not ok
        print(f"  {name:11s} ({hue:6s}) ground: min {r.min():.2f} p1 {np.percentile(r, 1):.2f} median {np.median(r):.2f}"
              f" (>= {TARGET[hue]}) {'OK' if ok else 'FAIL'} | over props: {below * 100:.1f}% below target"
              f" (goal < {GOAL_OVER_PROPS[hue] * 100:.0f}%) {'OK' if goal_ok else 'MISSED'} | lit runes: min {rt.min():.2f}")
    # hero: body (all opaque pixels except its dark outline) vs the ground under it, everywhere in the arena
    for name in ("knight_idle", "wisp_idle"):
        sheet = load_idx(os.path.join(ASSETS, "sprites", f"{name}.png"))
        f = sheet[:, :sheet.shape[0]]
        body = (f != -1) & (f != IDX["bg0"])
        cols = np.array([RGB[i] for i in f[body]], dtype=np.float64)
        l_body = float(lum_rgb(cols).mean())
        l_body_fog = float(lum_rgb(cols * (1 - fa) + fog_rgb * fa).mean())
        x0, y0, x1, y1 = L.ARENA
        fh, fw = f.shape
        sil = f != -1
        pad = 3
        silp = np.zeros((fh + 2 * pad, fw + 2 * pad), dtype=bool)
        silp[pad:pad + fh, pad:pad + fw] = sil
        ring = np.zeros_like(silp)
        for dy in range(-pad, pad + 1):
            for dx in range(-pad, pad + 1):
                ring |= np.roll(np.roll(silp, dy, 0), dx, 1)
        ring &= ~silp
        ys, xs = np.arange(y0, y1 - fh), np.arange(x0, x1 - fw)
        fogged = shifted_sum(fog_mask.astype(float), body, ys, xs) / body.sum()
        bl = fogged * l_body_fog + (1 - fogged) * l_body
        rl = shifted_sum(lum_g, ring, ys - pad, xs - pad) / ring.sum()
        hr = (np.maximum(bl, rl) + 0.05) / (np.minimum(bl, rl) + 0.05)
        ok = hr.min() >= HERO_MIN
        failed |= not ok
        print(f"  hero {name:11s} body vs ground: min {hr.min():.2f} median {np.median(hr):.2f} (>= {HERO_MIN}) "
              f"{'OK' if ok else 'FAIL'}")
    g = load_idx(os.path.join(bgd, "arena_ground.png"))
    cx0, cy0, cx1, cy1 = L.CALM_ZONE
    z = LUM[g[cy0:cy1, cx0:cx1]]
    worst = 0.0
    for a_, b_ in ((z[:, 1:], z[:, :-1]), (z[1:, :], z[:-1, :])):
        hi, lo = np.maximum(a_, b_), np.minimum(a_, b_)
        worst = max(worst, float(((hi + 0.05) / (lo + 0.05)).max()))
    ok = worst <= CALM_MAX
    failed |= not ok
    print(f"calm zone {L.CALM_ZONE}: max neighbour contrast {worst:.2f} (<= {CALM_MAX}) {'OK' if ok else 'FAIL'}"
          " (props in the calm zone: see check_layout.py)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
