#!/usr/bin/env python3
"""Visual-noise check for the arena (exit 1 on failure).

Metrics, measured on the arena rectangle minus the calm zone, on the composed background WITHOUT threats or hero:
  energy - mean Sobel gradient magnitude of perceptual lightness L* (0..100), averaged over 16x16 blocks
  busy   - share of 4x4 blocks whose L* range exceeds BUSY_RANGE
Baselines are rendered from git, by exporting that commit's tools/ into a temp dir and running its own generator:
  STAGE0 (the first committed floor: ground + ritual platform + forest + fog + vignette, no sprites, as Stage 0 composed it)
  PREV   (the arena right before the v2 softening pass: same composition as the current arena, incl. placed props)
Requirements (both metrics): new <= 1.3 x STAGE0 and new <= 0.6 x PREV. The Stage 0 baseline is a floor without
sprites, so it is compared like-for-like with the new floor (no props) AND, as asked, with the full new arena.
Also: zero fine dither in ground, forest, fog and vignette layers: no 4x4 window may be a non-uniform period-2 lattice
(1-px checkerboards, stripes, 25/50/75% bayer). The coarse 2x2-block pattern allowed on the fog edge has period 4.
Placed arena props may have at most PROP_DITHER_MAX such windows each.
Usage: python3 tools/check_noise.py [--json out.json]
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arena_layout as L  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGE0_COMMIT = "7454e7f"  # "Stage 0: deterministic pixel-art pipeline, palette validator, style board"
PREV_COMMIT = "ff5f5a3"  # Part C: the last arena before the v2 softening pass
BUSY_RANGE = 8.0  # L* units
PROP_DITHER_MAX = 4  # "a few pixels of texture" per prop sprite
MAX_VS_STAGE0 = 1.3
MAX_VS_PREV = 0.6
LAYERS = ("arena_ground", "forest_far", "forest_mid", "forest_mist", "forest_near", "forest_overhang", "fog_overlay",
          "vignette", "vignette_outer")
CACHE = os.path.join(tempfile.gettempdir(), "nightgrave-noise-cache")


def lstar(rgb):
    c = rgb.astype(np.float64) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    return np.where(y > 216 / 24389, 116 * np.cbrt(y) - 16, y * 24389 / 27)


def over(dst, path, x=0, y=0, frame=None, flip=False):
    im = np.array(Image.open(path).convert("RGBA"))
    if frame is not None:
        fw, i = frame
        im = im[:, i * fw:(i + 1) * fw]
    if flip:
        im = im[:, ::-1]
    h, w = im.shape[:2]
    H, W = dst.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    src = im[y0 - y:y1 - y, x0 - x:x1 - x]
    m = src[..., 3] == 255
    dst[y0:y1, x0:x1][m] = src[..., :3][m]


def tile(dst, path):
    t = Image.open(path)
    for ty in range(0, dst.shape[0], t.height):
        for tx in range(0, dst.shape[1], t.width):
            over(dst, path, tx, ty)


def blend(dst, path, alpha):
    im = np.array(Image.open(path).convert("RGBA"))
    m = im[..., 3] == 255
    dst[m] = (dst[m].astype(np.float64) * (1 - alpha) + im[..., :3][m] * alpha).round().astype(np.uint8)


def compose_current(assets):
    """As the game draws it: forest far/mid -> mist (alpha) -> ground -> y-sorted props (no actors) -> fog (alpha)
    -> vignette steps (alpha) -> forest near. Older arenas without alphas are composed opaque, as they were drawn."""
    bgd = os.path.join(assets, "backgrounds")
    lay = json.load(open(os.path.join(assets, "atlas", "manifest.json")))["layout"]
    al = lay.get("alphas", {})
    img = np.zeros((L.SCREEN[1], L.SCREEN[0], 3), dtype=np.uint8)
    img[:] = (11, 13, 18)
    for n in ("forest_far", "forest_mid"):
        over(img, os.path.join(bgd, f"{n}.png"))
    if os.path.exists(os.path.join(bgd, "forest_mist.png")):
        blend(img, os.path.join(bgd, "forest_mist.png"), al.get("forest_mist", 1.0))
    over(img, os.path.join(bgd, "arena_ground.png"))
    props = json.load(open(os.path.join(assets, "data", "arena_props.json")))["props"]
    for p in sorted(props, key=lambda q: (q["baseY"], q["x"])):
        over(img, os.path.join(assets, "sprites", f"{p['sprite']}.png"), p["x"], p["y"], (p["w"], p["frame"]), p["flip"])
    fog = os.path.join(bgd, "fog_overlay.png")
    if "fog_overlay" in al:
        blend(img, fog, al["fog_overlay"])
    else:
        tile(img, fog)
    for n in ("vignette", "vignette_outer"):
        f = os.path.join(bgd, f"{n}.png")
        if os.path.exists(f):
            blend(img, f, al.get(n, 1.0))
    over(img, os.path.join(bgd, "forest_near.png"))
    if os.path.exists(os.path.join(bgd, "forest_overhang.png")):
        over(img, os.path.join(bgd, "forest_overhang.png"))
    return img


def compose_floor(assets):
    """The current arena WITHOUT props (like-for-like with the Stage 0 floor baseline)."""
    bgd = os.path.join(assets, "backgrounds")
    al = json.load(open(os.path.join(assets, "atlas", "manifest.json")))["layout"].get("alphas", {})
    img = np.zeros((L.SCREEN[1], L.SCREEN[0], 3), dtype=np.uint8)
    img[:] = (11, 13, 18)
    for n in ("forest_far", "forest_mid"):
        over(img, os.path.join(bgd, f"{n}.png"))
    blend(img, os.path.join(bgd, "forest_mist.png"), al.get("forest_mist", 1.0))
    over(img, os.path.join(bgd, "arena_ground.png"))
    blend(img, os.path.join(bgd, "fog_overlay.png"), al.get("fog_overlay", 1.0))
    for n in ("vignette", "vignette_outer"):
        blend(img, os.path.join(bgd, f"{n}.png"), al.get(n, 1.0))
    over(img, os.path.join(bgd, "forest_near.png"))
    over(img, os.path.join(bgd, "forest_overhang.png"))
    return img


def compose_stage0(assets):
    """The Stage 0 floor exactly as that commit's board composed it (positions from its board.py), without sprites."""
    bgd = os.path.join(assets, "backgrounds")
    img = np.zeros((270, 480, 3), dtype=np.uint8)
    over(img, os.path.join(bgd, "floor.png"))
    over(img, os.path.join(bgd, "bg_forest_far.png"), 0, 0)
    over(img, os.path.join(bgd, "bg_forest_near.png"), 0, 14)
    over(img, os.path.join(bgd, "ground_ritual.png"), 120, 28)
    tile(img, os.path.join(bgd, "fog_overlay.png"))
    over(img, os.path.join(bgd, "vignette.png"))
    return img


def build_commit(commit):
    """Export <commit>:tools into a cached temp dir and run its generator there (never touches the repo)."""
    sha = subprocess.check_output(["git", "-C", ROOT, "rev-parse", commit], text=True).strip()
    d = os.path.join(CACHE, sha)
    if os.path.exists(os.path.join(d, ".done")):
        return os.path.join(d, "assets")
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    tar = subprocess.check_output(["git", "-C", ROOT, "archive", sha, "tools"])
    subprocess.run(["tar", "-x", "-C", d], input=tar, check=True)
    subprocess.run([sys.executable, os.path.join(d, "tools", "gen_assets.py")], cwd=d, check=True, stdout=subprocess.DEVNULL)
    open(os.path.join(d, ".done"), "w").close()
    return os.path.join(d, "assets")


def region_mask():
    m = np.zeros((L.SCREEN[1], L.SCREEN[0]), dtype=bool)
    x0, y0, x1, y1 = L.ARENA
    m[y0:y1, x0:x1] = True
    cx0, cy0, cx1, cy1 = L.CALM_ZONE
    m[cy0:cy1, cx0:cx1] = False
    return m


def metrics(img):
    l = lstar(img)
    gx = np.zeros_like(l)
    gy = np.zeros_like(l)
    gx[1:-1, 1:-1] = (l[:-2, 2:] + 2 * l[1:-1, 2:] + l[2:, 2:]) - (l[:-2, :-2] + 2 * l[1:-1, :-2] + l[2:, :-2])
    gy[1:-1, 1:-1] = (l[2:, :-2] + 2 * l[2:, 1:-1] + l[2:, 2:]) - (l[:-2, :-2] + 2 * l[:-2, 1:-1] + l[:-2, 2:])
    mag = np.sqrt(gx * gx + gy * gy) / 8
    m = region_mask()
    blocks = []
    for y in range(0, l.shape[0] - 15, 16):
        for x in range(0, l.shape[1] - 15, 16):
            if m[y:y + 16, x:x + 16].all():
                blocks.append(mag[y:y + 16, x:x + 16].mean())
    busy = []
    for y in range(0, l.shape[0] - 3, 4):
        for x in range(0, l.shape[1] - 3, 4):
            if m[y:y + 4, x:x + 4].all():
                b = l[y:y + 4, x:x + 4]
                busy.append(b.max() - b.min() > BUSY_RANGE)
    return float(np.mean(blocks)), float(np.mean(busy))


def fine_dither(path, frame_w=None):
    """Count 4x4 windows that form a non-uniform period-2 lattice (1-px checkerboards, 1-px stripes, 25/50/75% bayer,
    any 2x2-periodic texture). Transparent counts as a colour. The coarse 2x2-block pattern has period 4 and passes."""
    im = np.array(Image.open(path).convert("RGBA")).astype(np.int64)
    key = np.where(im[..., 3] == 255, (im[..., 0] << 16) | (im[..., 1] << 8) | im[..., 2], -1)
    if key.shape[0] < 4 or key.shape[1] < 4:
        return 0
    a = key
    hgt, wid = a.shape
    per = np.ones((hgt - 3, wid - 3), dtype=bool)
    nonuni = np.zeros_like(per)
    base = a[:hgt - 3, :wid - 3]
    for dy in range(4):
        for dx in range(4):
            cell = a[dy:hgt - 3 + dy, dx:wid - 3 + dx]
            ref = a[dy % 2:hgt - 3 + dy % 2, dx % 2:wid - 3 + dx % 2]
            per &= cell == ref
            nonuni |= cell != base
    hits = per & nonuni
    if frame_w:  # ignore windows straddling two frames of a strip
        cols = np.arange(wid - 3)
        hits &= ((cols % frame_w) + 3) < frame_w
    return int(hits.sum())


fine_checkers = fine_dither


def write_compare(panels):
    """assets/preview/noise_compare.png: the three composites side by side at 2x, numbers written under each."""
    from nglib import canvas as C
    from nglib import font
    h, w = panels[0][1].shape[:2]
    gap, lab = 8, 16
    out = np.zeros((h + lab, len(panels) * (w + gap) - gap, 3), dtype=np.uint8)
    out[:] = (11, 13, 18)
    text = C.new(out.shape[1], lab)
    for i, (name, img, (e, b)) in enumerate(panels):
        x = i * (w + gap)
        out[:h, x:x + w] = img
        font.text(text, x + 2, 3, name, "bone")
        font.text(text, x + 2, 9, f"ENERGY {e:.2f}  BUSY {b * 100:.1f}", "stone")
    t = np.array(C.to_image(text))
    m = t[..., 3] > 0
    out[h:][m] = t[..., :3][m]
    path = os.path.join(ROOT, "assets", "preview", "noise_compare.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(np.repeat(np.repeat(out, 2, 0), 2, 1)).save(path, optimize=False)


def main():
    here = os.path.join(ROOT, "assets")
    cur_img = compose_current(here)
    s0_img = compose_stage0(build_commit(STAGE0_COMMIT))
    prev_img = compose_current(build_commit(PREV_COMMIT))
    cur, s0, prev = metrics(cur_img), metrics(s0_img), metrics(prev_img)
    cur_floor = metrics(compose_floor(here))
    failed = False
    print("noise on the arena outside the calm zone (energy = mean Sobel |grad L*| per 16x16 block; busy = share of 4x4 "
          f"blocks with L* range > {BUSY_RANGE}):")
    rows = (("Stage 0 floor", s0), ("previous arena", prev), ("new arena", cur), ("new floor only", cur_floor))
    for name, (e, b) in rows:
        print(f"  {name:15s} energy {e:6.3f}   busy {b * 100:5.1f}%")
    print("requirements (both metrics):")
    for i, label in enumerate(("energy", "busy")):
        checks = (
            ("new arena / previous arena", cur[i] / prev[i], MAX_VS_PREV),
            ("new floor / Stage 0 floor (like-for-like)", cur_floor[i] / s0[i], MAX_VS_STAGE0),
            ("new arena (with props) / Stage 0 floor", cur[i] / s0[i], MAX_VS_STAGE0),
        )
        for name, ratio, limit in checks:
            ok = ratio <= limit
            failed |= not ok
            print(f"  {label:6s} {name:42s} {ratio:5.2f} (<= {limit})  {'OK' if ok else 'FAIL'}")
    write_compare([("STAGE 0 FLOOR", s0_img, s0), ("PREVIOUS ARENA", prev_img, prev), ("NEW ARENA", cur_img, cur)])
    bad = {}
    for n in LAYERS:
        c = fine_checkers(os.path.join(ROOT, "assets", "backgrounds", f"{n}.png"))
        if c:
            bad[n] = c
    failed |= bool(bad)
    print(f"fine dither (period-2 lattice) windows in {', '.join(LAYERS)}: {bad or 0}  {'FAIL' if bad else 'OK'}")
    # placed arena props: at most a few texture pixels (v2 rule 2)
    props = json.load(open(os.path.join(here, "data", "arena_props.json")))["props"]
    manifest = json.load(open(os.path.join(here, "atlas", "manifest.json")))["sprites"]
    prop_hits = {}
    for name in sorted({p["sprite"] for p in props if p["kind"] != "eyes"}):
        if manifest[name]["group"] != "arena":
            continue
        c = fine_dither(os.path.join(here, "sprites", f"{name}.png"), manifest[name]["w"])
        if c:
            prop_hits[name] = c
    worst = max(prop_hits.values(), default=0)
    ok = worst <= PROP_DITHER_MAX
    failed |= not ok
    print(f"fine dither windows in placed arena props (<= {PROP_DITHER_MAX} each): {prop_hits or 0}  {'OK' if ok else 'FAIL'}")
    if "--json" in sys.argv:
        json.dump({"stage0": s0, "prev": prev, "current": cur, "current_floor": cur_floor},
                  open(sys.argv[sys.argv.index("--json") + 1], "w"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
