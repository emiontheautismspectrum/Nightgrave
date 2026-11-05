#!/usr/bin/env python3
"""Visual-noise check for the arena (exit 1 on failure).

Metrics, measured on the arena rectangle minus the calm zone, on the composed background WITHOUT threats or hero:
  energy - mean Sobel gradient magnitude of perceptual lightness L* (0..100), averaged over 16x16 blocks
  busy   - share of 4x4 blocks whose L* range exceeds BUSY_RANGE
Baselines are rendered from git, by exporting that commit's tools/ into a temp dir and running its own generator:
  STAGE0 (the first committed floor: ground + ritual platform + forest + fog + vignette, no sprites, as Stage 0 composed it)
  PREV   (the arena right before the v2 softening pass: same composition as the current arena, incl. placed props)
Requirements (both metrics): new <= 1.3 x STAGE0 and new <= 0.6 x PREV. The Stage 0 baseline is a floor without
sprites, so it is compared like-for-like with the new floor (no props). The full arena with props is held to the
approved v4 baseline (ARENA_BASELINE): at most 10% noisier, at most 10% flatter (see ASSETS_SPEC.md).
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
PREV_COMMIT = "ea8e8f4"  # the pre-V2 arena: the commit right before "art: arena v2 softening and layout"
V2_COMMIT = "72c0155"  # the arena v2 ground (wagon close-up "previous version")
V3_COMMIT = "e02b6b5"  # "art: arena v3 ground, giant tree, trees, wagon" (flatness baseline for v4)
JOINT_STONE_MAX = 1.35
BUSY_RANGE = 8.0  # L* units
PROP_DITHER_MAX = 4  # "a few pixels of texture" per prop sprite
MAX_VS_STAGE0 = 1.3
# Approved stone-courtyard arena (author sign-off after the Stage 4 fixups, commit "art: arena v4 fixups"):
# absolute values of the full arena with props. A future change may be at most 10% noisier or 10% flatter.
ARENA_BASELINE = {"energy": 1.744, "busy": 0.315, "depth": 3.00}
BASELINE_TOLERANCE = 0.10
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
    if os.path.exists(os.path.join(bgd, "forest_overhang.png")):
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


def depth(img):
    """Large-scale depth: std of block-mean L* over 32x32 blocks fully inside the arena outside the calm zone."""
    l = lstar(img)
    m = region_mask()
    means = [l[y:y + 32, x:x + 32].mean() for y in range(0, l.shape[0] - 31, 32) for x in range(0, l.shape[1] - 31, 32)
             if m[y:y + 32, x:x + 32].all()]
    return float(np.std(means))


def write_v3_compare(v2_img, v3_img, floor_img):
    """assets/preview/arena_v3_compare.png (V2 | V3 at 2x) and ground_closeup.png (2x crop of the bare ground)."""
    out = np.zeros((v2_img.shape[0], v2_img.shape[1] * 2 + 8, 3), dtype=np.uint8)
    out[:] = (11, 13, 18)
    out[:, :v2_img.shape[1]] = v2_img
    out[:, v2_img.shape[1] + 8:] = v3_img
    pv = os.path.join(ROOT, "assets", "preview")
    Image.fromarray(np.repeat(np.repeat(out, 2, 0), 2, 1)).save(os.path.join(pv, "arena_v3_compare.png"), optimize=False)
    x0, y0, x1, y1 = L.ARENA
    crop = floor_img[y0:y1, x0:x1]
    Image.fromarray(np.repeat(np.repeat(crop, 2, 0), 2, 1)).save(os.path.join(pv, "ground_closeup.png"), optimize=False)


def write_v4_compare(imgs, floor_img):
    """arena_v4_compare.png (pre-V2 | V3 | V4 at 2x) and ground_closeup.png (2x crop of the bare ground covering the
    calm centre, the mid ring, the left edge and the altar plaza)."""
    h, w = imgs[0].shape[:2]
    out = np.zeros((h, len(imgs) * (w + 8) - 8, 3), dtype=np.uint8)
    out[:] = (11, 13, 18)
    for i, im in enumerate(imgs):
        out[:, i * (w + 8):i * (w + 8) + w] = im
    pv = os.path.join(ROOT, "assets", "preview")
    Image.fromarray(np.repeat(np.repeat(out, 2, 0), 2, 1)).save(os.path.join(pv, "arena_v4_compare.png"), optimize=False)
    crop = floor_img[27:191, 40:300]
    Image.fromarray(np.repeat(np.repeat(crop, 2, 0), 2, 1)).save(os.path.join(pv, "ground_closeup.png"), optimize=False)


def stone_checks():
    """v4 stone rules on the generator's own masks + the brightness cap inside the arena rect."""
    from nglib import compose as CP
    from nglib import canvas as CC
    from nglib.palette import IDX, RGB as PRGB
    import gen_arena
    art = gen_arena.build()
    g, M = CP.ground(art["sprites"], art["decals"], art["props"], CP.ritual_runes(), return_masks=True)
    disk = np.array(Image.open(os.path.join(ROOT, "assets", "backgrounds", "arena_ground.png")).convert("RGBA"))
    failed = False
    lum = lambda c: float(lstar(np.array([[PRGB[c]]], dtype=np.uint8))[0, 0])  # noqa: E731
    order = {IDX[t]: i for i, t in enumerate(CP.STONE)}
    x0, y0, x1, y1 = L.ARENA
    inside = np.zeros_like(M["cover"])
    inside[y0:y1, x0:x1] = True
    # 1. the generator's array is what is on disk
    on_disk = np.array(CC.to_image(g))
    if not np.array_equal(on_disk, disk):
        print("  stone masks do not match assets/backgrounds/arena_ground.png  FAIL")
        return True
    lab, tone, joint = M["lab"], M["tone"], M["joint"]
    plain = inside & M["cover"] & ~M["decal"] & ~M["missing"][lab]
    # 2. no stone pixel more than one step lighter than its stone's base tone
    st = plain & ~joint
    step = np.vectorize(lambda c: order.get(int(c), -9))(g[st])
    over = (step - tone[lab][st]) > 1
    # 3. joints never lighter than an adjacent stone; joint/stone contrast <= 1.35
    jt = plain & joint
    bad_light, worst = 0, 0.0
    ys, xs = np.nonzero(jt)
    for y, x in zip(ys, xs):
        jl = lum(g[y, x])
        for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            yy_, xx_ = y + dy, x + dx
            if 0 <= yy_ < g.shape[0] and 0 <= xx_ < g.shape[1] and st[yy_, xx_]:
                sl = lum(g[yy_, xx_])
                bad_light += jl > sl + 1e-9
                worst = max(worst, (max(sl, jl) + 5) / (min(sl, jl) + 5))  # L* proxy ratio (see below)
    # contrast ratio in WCAG terms (relative luminance)
    def rel(c):
        r_, g_, b_ = [v / 255 for v in PRGB[c]]
        f = lambda u: u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4  # noqa: E731
        return 0.2126 * f(r_) + 0.7152 * f(g_) + 0.0722 * f(b_)
    worst_ratio = 0.0
    pairs = set()
    for y, x in zip(ys, xs):
        for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            yy_, xx_ = y + dy, x + dx
            if 0 <= yy_ < g.shape[0] and 0 <= xx_ < g.shape[1] and st[yy_, xx_]:
                pairs.add((int(g[y, x]), int(g[yy_, xx_])))
    for a_, b_ in pairs:
        la, lb = rel(a_), rel(b_)
        worst_ratio = max(worst_ratio, (max(la, lb) + 0.05) / (min(la, lb) + 0.05))
    ok = not over.any() and bad_light == 0 and worst_ratio <= JOINT_STONE_MAX
    failed |= not ok
    print(f"stones: pixels > 1 step above base {int(over.sum())}, joints lighter than a stone {bad_light}, "
          f"max joint/stone contrast {worst_ratio:.2f} (<= {JOINT_STONE_MAX})  {'OK' if ok else 'FAIL'}")
    # 5. geometry: no 4-way '+' junctions, no axis-aligned seam > 20 px, neighbours within one tone step,
    #    calm-centre stones large (median sqrt(area) reported vs 36-44 px)
    q = np.stack([lab[:-1, :-1], lab[:-1, 1:], lab[1:, :-1], lab[1:, 1:]])
    four = int(((q[0] != q[1]) & (q[0] != q[2]) & (q[0] != q[3]) & (q[1] != q[2]) & (q[1] != q[3]) & (q[2] != q[3]))[
        inside[:-1, :-1]].sum())
    seams = [s_ for s_ in CP.long_seams(np.where(inside, lab, -1), 20) if s_[0] >= 0]
    miss = M["missing"]
    pairs_t = set()
    for a_, b_ in ((lab[:, :-1], lab[:, 1:]), (lab[:-1, :], lab[1:, :])):
        m = (a_ != b_) & inside[:a_.shape[0], :a_.shape[1]]
        pairs_t |= set(zip(a_[m].tolist(), b_[m].tolist()))
    steps = [(i, j) for i, j in pairs_t if not miss[i] and not miss[j] and abs(int(tone[i]) - int(tone[j])) > 1]
    calm_ids = np.unique(lab[L.CALM_ZONE[1]:L.CALM_ZONE[3], L.CALM_ZONE[0]:L.CALM_ZONE[2]])
    areas = np.bincount(lab.ravel())
    calm_sizes = np.sqrt(areas[[i for i in calm_ids if M["calm"][i]]])
    ok = four == 0 and not seams and not steps
    failed |= not ok
    print(f"stone geometry: '+' junctions {four}, straight seams > 20 px {len(seams)}, neighbour step > 1 {len(steps)}, "
          f"calm stone size median {np.median(calm_sizes):.0f} px (36-44 target)  {'OK' if ok else 'FAIL'}")
    # 4. brightness cap inside the rect; stone and moss never in the ground (puddle moon glints excepted)
    cap = rel(IDX["stone_dark"])
    vals = np.unique(g[inside & (g != -1)])
    too_bright = [CP.STONE[0] if False else int(v) for v in vals if rel(int(v)) > cap + 1e-12 and int(v) != IDX["moon"]]
    moon_px = int(((g == IDX["moon"]) & inside).sum())
    banned = [n for n in ("stone", "moss") if (g == IDX[n]).any()]
    ok = not too_bright and not banned and moon_px <= 2 * len(L.PUDDLES)
    failed |= not ok
    print(f"brightness cap (<= stone_dark inside the rect): over-cap colours {too_bright or 0}, stone/moss in ground "
          f"{banned or 0}, moon glint px {moon_px} (puddles only)  {'OK' if ok else 'FAIL'}")
    return failed


def write_wagon_closeup(old_path, new_path):
    """assets/preview/wagon_closeup.png: previous (v2) wagon and the new one side by side at 8x (first frames)."""
    old = Image.open(old_path).convert("RGBA").crop((0, 0, 48, 32))
    new = Image.open(new_path).convert("RGBA").crop((0, 0, 56, 40))
    canvas = Image.new("RGBA", (48 + 56 + 8, 40), (18, 22, 29, 255))
    canvas.paste(old, (0, 40 - 32), old)
    canvas.paste(new, (56, 0), new)
    canvas.convert("RGB").resize((canvas.width * 8, canvas.height * 8), Image.NEAREST).save(
        os.path.join(ROOT, "assets", "preview", "wagon_closeup.png"), optimize=False)


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
            # the approved stone arena replaces the stale "arena with props vs Stage 0 floor" limit
            ("new arena / approved v4 baseline", cur[i] / ARENA_BASELINE[label], round(1 + BASELINE_TOLERANCE, 2)),
        )
        for name, ratio, limit in checks:
            ok = ratio <= limit
            failed |= not ok
            print(f"  {label:6s} {name:42s} {ratio:5.2f} (<= {limit})  {'OK' if ok else 'FAIL'}")
    write_compare([("STAGE 0 FLOOR", s0_img, s0), ("PREVIOUS ARENA", prev_img, prev), ("NEW ARENA", cur_img, cur)])
    v2_dir, v3_dir = build_commit(V2_COMMIT), build_commit(V3_COMMIT)
    d_v3, d_new = depth(compose_floor(v3_dir)), depth(compose_floor(here))
    lim = (1 - BASELINE_TOLERANCE) * ARENA_BASELINE["depth"]
    ok = d_new >= lim - 1e-9
    failed |= not ok
    print(f"ground depth (std of 32x32 block-mean L*, floor without props): v3 {d_v3:.2f}, new {d_new:.2f}; "
          f"approved baseline {ARENA_BASELINE['depth']:.2f}, must stay >= {lim:.2f} (<= 10% flatter)  {'OK' if ok else 'FAIL'}")
    write_v4_compare([prev_img, compose_current(v3_dir), cur_img], compose_floor(here))
    write_wagon_closeup(os.path.join(v2_dir, "sprites", "hunter_wagon.png"), os.path.join(here, "sprites", "hunter_wagon.png"))
    failed |= stone_checks()
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
    for name in sorted({p["sprite"] for p in props if p["kind"] != "eyes"} | {f"rune_glow_{g}" for g in range(8)}):
        if manifest[name]["group"] != "arena" and not name.startswith("rune_glow"):
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
