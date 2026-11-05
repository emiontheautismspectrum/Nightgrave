"""Arena composer: turns tools/arena_layout.py into ground/forest backgrounds and a list of placed props.

Deterministic: every random choice comes from numpy generators seeded from arena_layout.SEED.
"""
import math
import os
import sys

import numpy as np

from . import canvas as C

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import arena_layout as L  # noqa: E402

W, H = L.SCREEN
AX0, AY0, AX1, AY1 = L.ARENA
CZ = L.CALM_ZONE


def rng(k):
    return np.random.default_rng(L.SEED * 1000 + k)


# ---------------------------------------------------------------- geometry

def boxes_overlap(a, b, pad=0):
    return not (a[2] + pad <= b[0] or b[2] + pad <= a[0] or a[3] + pad <= b[1] or b[3] + pad <= a[1])


def box_hits_circle(box, cx, cy, r):
    nx = min(max(cx, box[0]), box[2])
    ny = min(max(cy, box[1]), box[3])
    return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r


def in_calm(box):
    return boxes_overlap(box, CZ)


def opaque_min_dist(spr, x, y, cx, cy):
    """Smallest distance from (cx, cy) to any opaque pixel centre of `spr` placed with its top-left at (x, y)."""
    ys, xs = np.nonzero(spr != C.T)
    if not len(xs):
        return 1e9
    return float(np.sqrt((xs + x + 0.5 - cx) ** 2 + (ys + y + 0.5 - cy) ** 2).min())


def must(p, what):
    if p is None:
        raise AssertionError(f"required arena piece could not be placed: {what}")
    return p


# ---------------------------------------------------------------- placement

class Placer:
    def __init__(self, sprites):
        self.sprites = sprites
        self.props = []
        self.boxes = []

    def box_for(self, name, cx, base_y, frame=0):
        h, w = self.sprites[name][frame].shape
        x = int(round(cx - w / 2))
        y = int(round(base_y - h))
        return (x, y, x + w, y + h)

    def free(self, box, pad=1, ignore_calm=False):
        if not ignore_calm and in_calm(box):
            return False
        return all(not boxes_overlap(box, b, pad) for b in self.boxes)

    def add(self, name, cx, base_y, flip=False, shade=0, anim=None, kind="decor", frame=None, force=False, overlay_of=None):
        f = shade if frame is None else frame
        box = self.box_for(name, cx, base_y, f)
        if not force and not self.free(box):
            return None
        p = {"sprite": name, "frame": f, "x": box[0], "y": box[1], "w": box[2] - box[0], "h": box[3] - box[1],
             "baseY": int(round(base_y)), "flip": bool(flip), "shade": int(shade), "kind": kind}
        if anim:
            p["anim"] = anim
        if overlay_of is not None:
            p["overlayOf"] = overlay_of
        self.props.append(p)
        if overlay_of is None:
            self.boxes.append(box)
        return p

    def overlay(self, parent, name, ox, oy, anim, base_bias=1):
        """An animated overlay drawn just in front of its parent (same base y + bias)."""
        h, w = self.sprites[name][0].shape
        p = {"sprite": name, "frame": 0, "x": parent["x"] + ox, "y": parent["y"] + oy, "w": w, "h": h,
             "baseY": parent["baseY"] + base_bias, "flip": False, "shade": 0, "kind": parent["kind"], "anim": anim,
             "overlayOf": parent["sprite"]}
        self.props.append(p)
        return p



TREE_HOLLOW_CLEAR = 30  # stalkers step out of hollows: trees keep the same clearance as landmarks and graves


def box_of(sprites, p):
    return (p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"])


def opaque_in_calm(sprites, p):
    """True if any opaque pixel of a placed prop falls inside the calm zone (pixel-accurate, for big sparse sprites)."""
    spr = sprites[p["sprite"]][p["frame"]]
    if p["flip"]:
        spr = spr[:, ::-1]
    ys, xs = np.nonzero(spr != C.T)
    gx, gy = xs + p["x"], ys + p["y"]
    return bool(((gx >= CZ[0]) & (gx < CZ[2]) & (gy >= CZ[1]) & (gy < CZ[3])).any())


def box_dist(a, b):
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dy)


def place_all(sprites):
    from . import landmarks as LM

    P = Placer(sprites)
    notes = []
    landmarks = []  # (name, box) of every landmark sprite (graves/hollows keep their distance from these)
    hollow_pts = [L.hollow_point(s_, p_) for s_, p_ in L.HOLLOWS]

    def lm(name, base, kind="landmark", anim=None, flip=False):
        p = must(P.add(name, base[0], base[1], kind=kind, anim=anim, flip=flip, force=True), name)
        landmarks.append((name, box_of(sprites, p)))
        return p

    # 1. portal altar: dais centre on the anchor
    ah, aw = sprites["portal_altar"][0].shape
    ax, ay = L.PORTAL_ALTAR
    altar = lm("portal_altar", (ax - LM.ALTAR_CENTER[0] + aw / 2, ay - LM.ALTAR_CENTER[1] + ah))
    for bx, by in LM.BRAZIERS:
        P.overlay(altar, "altar_flame", bx, by, "altar_flame")
    for cx_, cy_ in LM.CHAINS:
        P.overlay(altar, "altar_chain", cx_, cy_, "altar_chain")
    altar_box = box_of(sprites, altar)

    # 2. landmarks (base centres)
    tree_spr = sprites["giant_tree"][0]
    tx = L.GIANT_TREE[0] - LM.GIANT_TREE_BASE[0] + tree_spr.shape[1] / 2
    gt = lm("giant_tree", (tx, L.GIANT_TREE[1] + (tree_spr.shape[0] - 1 - LM.GIANT_TREE_BASE[1]) + 1))
    P.overlay(gt, "giant_tree_crack", LM.GIANT_TREE_CRACK_AT[0], LM.GIANT_TREE_CRACK_AT[1], "giant_tree_crack")
    lm("rune_sword", L.RUNE_SWORD, anim="rune_sword")
    lm("rune_sword_base", (L.RUNE_SWORD[0], L.RUNE_SWORD[1] + 3))
    gal = lm("gallows_tree", L.GALLOWS)
    P.overlay(gal, "gallows_cage", 34, 10, "gallows_cage")
    P.overlay(gal, "crow", 20, 2, "crow")
    P.overlay(gal, "crow", 38, 2, "crow")
    well = lm("cursed_well", L.WELL)
    P.overlay(well, "well_wisp", 6, -9, "well_wisp")
    lm("gas_lamp_short", L.WELL_LAMP)
    lm("hunter_wagon", L.WAGON, anim="hunter_wagon")
    cab = lm("hunter_cabin", L.CABIN)
    P.overlay(cab, "cabin_window", LM.CABIN_WINDOW_AT[0], LM.CABIN_WINDOW_AT[1], "cabin_window")
    P.overlay(cab, "cabin_smoke", LM.CABIN_SMOKE_AT[0], LM.CABIN_SMOKE_AT[1], "cabin_smoke", base_bias=-1)
    for name, dx, dy in L.WORKSHOP:
        lm(name, (L.CABIN[0] + dx, L.CABIN[1] - 28 + dy))
    for name, x, y in L.FALLEN_WEAPONS:
        lm(name, (x, y))
    for k, (mx, my) in enumerate(root_mushroom_spots()):  # pale glowing mushrooms in root crevices (ground level)
        P.add("glow_mushrooms", mx, my, kind="glow", anim="glow_mushrooms", force=True, frame=k % 3)
    for name, box in landmarks:  # landmarks never touch the calm zone (pixel-accurate)
        p = next(q for q in P.props if q["sprite"] == name and box_of(sprites, q) == box)
        if opaque_in_calm(sprites, p):
            raise AssertionError(f"landmark {name} reaches into the calm zone")

    def hollow_ok(box):
        return all(box_dist(box, (hx, hy, hx, hy)) >= L.HOLLOW_CLEAR for hx, hy in hollow_pts)

    for name, box in landmarks:  # landmarks: pixel-accurate clearance (big sprites like the giant tree are sparse)
        p = next(q for q in P.props if q["sprite"] == name and box_of(sprites, q) == box)
        spr = sprites[p["sprite"]][p["frame"]]
        ys, xs = np.nonzero((spr[:, ::-1] if p["flip"] else spr) != C.T)
        for hx, hy in hollow_pts:
            d = float(np.sqrt((xs + p["x"] + 0.5 - hx) ** 2 + (ys + p["y"] + 0.5 - hy) ** 2).min())
            if d < L.HOLLOW_CLEAR:
                raise AssertionError(f"landmark {name} is {d:.1f} px from the hollow at ({hx},{hy})")

    # 4. graves: loose clusters + singles; varied size/lean, a couple broken, a couple half-sunk in moss
    r = rng(2)
    kinds = ["grave_intact_0", "grave_intact_2", "grave_cross_1", "grave_broken_0", "grave_sunk_0", "grave_intact_4",
             "grave_cross_2", "grave_sunk_1", "grave_broken_2", "grave_intact_1", "grave_slab_0", "grave_intact_3"]
    graves = []
    ki = 0

    def try_grave(x, y, tag):
        nonlocal ki
        for attempt in range(len(kinds)):
            v = kinds[(ki + attempt) % len(kinds)]
            b = P.box_for(v, x, y)
            grave_boxes = [box_of(sprites, q) for q in P.props if q["kind"] == "grave"]
            if any(q["sprite"] == v and box_dist(b, box_of(sprites, q)) < 16 for q in P.props if q["kind"] == "grave"):
                continue  # never the same variant side by side (same metric as check_layout)
            others_free = all(not boxes_overlap(b, ob, 2) for ob in P.boxes if ob not in grave_boxes)
            graves_free = all(not boxes_overlap(b, gb, 2) for gb in grave_boxes)  # loose clusters: graves never touch
            ok = (not in_calm(b) and others_free and graves_free and hollow_ok(b)
                  and box_dist(b, altar_box) >= L.GRAVE_ALTAR_CLEAR
                  and all(box_dist(b, lb) >= L.GRAVE_LANDMARK_CLEAR for n_, lb in landmarks if n_ != "portal_altar")
                  and b[0] >= AX0 and b[2] <= AX1 and b[1] >= AY0 - 4 and b[3] <= AY1)
            if ok:
                must(P.add(v, x, y, flip=bool(r.integers(0, 2)), shade=int(r.integers(0, 2)), kind="grave", force=True), v)
                graves.append((x, y, v, tag))
                ki += attempt + 1
                return True
        return False

    for ci, ((cx_, cy_), n, (sx, sy)) in enumerate(L.GRAVE_CLUSTERS):  # loose clusters of 2-4
        got = 0
        if ci == 1:  # the bottom-centre group uses the smaller variants
            kinds_saved, kinds[:] = list(kinds), list(L.SMALL_GRAVES)
            ki = 0
        for _ in range(60):
            if got >= n:
                break
            if try_grave(cx_ + r.uniform(-sx, sx), cy_ + r.uniform(-sy, sy), f"cluster{ci}"):
                got += 1
        if ci == 1:
            kinds[:] = kinds_saved
    for x, y in L.GRAVE_SINGLES:
        try_grave(x, y, "single")
    if not 8 <= len(graves) <= 12:
        raise AssertionError(f"{len(graves)} graves placed, need 8-12")
    # 5. short broken fence fragments next to graves
    for i in range(L.FENCE_FRAGMENTS):
        gx, gy, _v, _t = graves[(i * 3) % len(graves)]
        for dx, dy in ((14, 2), (-14, 2), (12, -8), (-12, -8), (18, 6), (-18, 6), (22, 0), (-22, 0), (0, 12), (8, 14),
                       (-8, 14), (26, 4), (-26, 4)):
            b = P.box_for(f"fence_frag_{i}", gx + dx, gy + dy)
            if not in_calm(b) and P.free(b, pad=1) and hollow_ok(b) and box_dist(b, altar_box) >= L.GRAVE_ALTAR_CLEAR:
                must(P.add(f"fence_frag_{i}", gx + dx, gy + dy, flip=bool(i % 2), kind="decor_attached"), "fence fragment")
                break
        else:
            notes.append(f"fence fragment {i} found no spot next to a grave")
    # 3. author dead trees: keep at most MAX_TREES; nudge minimally out of the calm zone / landmarks / hollows
    trees = 0
    tree_pts = [(x_, y_, "extra") for x_, y_ in L.EXTRA_TREES] + [(*L.pct(a_), "author") for a_ in L.DEAD_TREES_PCT]
    for k, (x, y, origin) in enumerate(tree_pts):
        if trees >= L.MAX_TREES:
            notes.append(f"{origin} tree at ({x},{y}) dropped (budget of {L.MAX_TREES} trees reached)")
            continue
        v = f"tree_{k % 5}"
        best = None
        for d in range(0, 66, 2):
            ring = [(dx, dy) for dx in range(-d, d + 1, 2) for dy in range(-d, d + 1, 2) if max(abs(dx), abs(dy)) == d]
            for dx, dy in sorted(ring, key=lambda t: (t[0] ** 2 + t[1] ** 2, t)):
                b = P.box_for(v, x + dx, y + dy)
                if (b[0] >= AX0 - 4 and b[2] <= AX1 + 4 and b[3] <= AY1 + 2 and b[3] >= AY0 + 14 and P.free(b, pad=2)
                        and all(box_dist(b, (hx, hy, hx, hy)) >= TREE_HOLLOW_CLEAR for hx, hy in hollow_pts)):
                    best = (dx, dy)
                    break
            if best:
                break
        if best is None:
            notes.append(f"{origin} tree at ({x},{y}) dropped (no free spot within 64 px)")
            continue
        if best != (0, 0):
            notes.append(f"{origin} tree at ({x},{y}) nudged by ({best[0]:+d},{best[1]:+d})")
        must(P.add(v, x + best[0], y + best[1], flip=bool(k % 2), shade=0, kind="tree"), f"tree {k}")
        trees += 1

    # 6. small decor (<= 25) in loose clusters, Poisson-disc spacing inside each cluster
    r = rng(3)
    for name, x, y in L.BONES:  # bones and skulls only near the altar and the graves (<= 4)
        b = P.box_for(name, x, y)
        if not in_calm(b) and P.free(b, pad=1) and hollow_ok(b) and box_dist(b, altar_box) >= 2:
            P.add(name, x, y, kind="small")
    small = (["grass_%d" % i for i in range(4)] +
             ["bramble_%d" % i for i in range(3)] + ["stone_%d" % i for i in range(4)] + ["leaves_%d" % i for i in range(3)] +
             ["mushroom_0", "mushroom_1", "root_0", "root_1"])
    placed_small = []
    for (cx_, cy_), n in L.SMALL_DECOR_CLUSTERS:
        got = 0
        for _ in range(120):
            if got >= n or len(placed_small) >= L.SMALL_DECOR_MAX:
                break
            x = cx_ + r.uniform(-16, 16)
            y = cy_ + r.uniform(-10, 10)
            if any(math.dist((x, y), q) < L.SMALL_DECOR_SPACING for q in placed_small):
                continue
            name = small[int(r.integers(0, len(small)))]
            b = P.box_for(name, x, y)
            if (b[0] >= AX0 and b[2] <= AX1 and b[1] >= AY0 and b[3] <= AY1 and hollow_ok(b)
                    and box_dist(b, altar_box) >= L.PORTAL_CLEAR_RADIUS
                    and P.add(name, x, y, flip=bool(r.integers(0, 2)), shade=int(r.integers(0, 2)), kind="small")):
                placed_small.append((x, y))
                got += 1
    # 7. ambient eye pairs in the dark gaps of the forest (violet_dark at rest; exception group)
    r = rng(4)
    eyes = 0
    for _ in range(300):
        if eyes >= L.AMBIENT_EYES:
            break
        side = int(r.integers(0, 4))
        x = r.uniform(4, AX0 - 16) if side == 0 else (r.uniform(AX1 + 16, W - 4) if side == 1 else r.uniform(60, 420))
        y = r.uniform(40, 230) if side < 2 else (r.uniform(4, AY0 - 12) if side == 2 else r.uniform(AY1 + 23, H - 1))
        b = P.box_for("forest_eyes", x, y)
        if hollow_ok(b) and P.add("forest_eyes", x, y, kind="eyes", force=False):
            eyes += 1
    for p in P.props:  # final guarantee: graves and decor keep their boxes clear of the hollows
        b = box_of(sprites, p)
        clear = TREE_HOLLOW_CLEAR if p["kind"] == "tree" else L.HOLLOW_CLEAR
        if (p["kind"] not in ("eyes", "landmark") and not p.get("overlayOf")
                and not all(box_dist(b, (hx, hy, hx, hy)) >= clear for hx, hy in hollow_pts)):
            raise AssertionError(f"{p['sprite']} at {box_of(sprites, p)[:2]} blocks a hollow")
    return P, landmarks, graves, notes


# ---------------------------------------------------------------- tones (no dithering anywhere)

def majority(a, r=2, iters=2):
    """Mode filter over (2r+1)^2 windows: removes specks and thin noise -> large flat patches."""
    vals = np.unique(a)
    for _ in range(iters):
        counts = []
        for v in vals:
            m = (a == v).astype(np.int32)
            c = np.cumsum(np.cumsum(np.pad(m, ((r + 1, r), (r + 1, r)), mode="edge"), 0), 1)
            k = 2 * r + 1
            counts.append(c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k])
        a = vals[np.argmax(np.stack(counts), axis=0)]
    return a


def tone_field(seed, cell, cuts, tones, octave=0.35):
    r = rng(seed)
    n = C.value_noise(W, H, cell, r) * (1 - octave) + C.value_noise(W, H, max(8, cell // 2), r) * octave
    idx = np.digitize(n, cuts)
    out = np.array([C.ci(t) for t in tones], dtype=np.int16)[idx]
    return majority(out, 2, 2)


DARKER_TONE = {"mist": "fern", "fern": "forest", "fog": "bg1", "earth": "bg1", "loam": "earth", "forest": "bg0",
               "bg1": "bg0", "moss": "forest", "stone_dark": "bg1", "stone": "stone_dark", "bg0": "bg0"}
LADDER = ["bg0", "forest", "fern", "mist"]  # ground value ladder, dark -> light (L* 3.6 / 8.0 / 14.4 / 17.6)


def giant_roots():
    """Main roots of the giant tree as polylines [(x, y, thickness)]: S-curved, branching, 60-110 px, tips x >= 320."""
    r = rng(70)
    gx, gy = L.GIANT_TREE
    roots = []
    angles = [math.radians(a_) for a_ in (172, 150, 128, 104, 76, 48, 18, -8)][:L.GIANT_TREE_ROOTS]
    for i, ang in enumerate(angles):
        length = r.uniform(60, 110)
        bend = r.uniform(0.35, 0.6) * (1 if i % 2 else -1)
        pts = []
        for k in range(26):
            t = k / 25
            a_ = ang + bend * math.sin(t * math.pi * 1.4)  # S-curve
            if not pts:
                x, y = gx + math.cos(ang) * 30, gy + math.sin(ang) * 6
            else:
                x, y = pts[-1][0] + math.cos(a_) * length / 25, pts[-1][1] + math.sin(a_) * length / 25 * 0.6
            x = max(x, L.ROOT_MIN_X + 1)
            y = min(max(y, AY0 + 4), AY1 - 3)
            pts.append((x, y, 9.5 - 7.5 * t))
        roots.append(pts)
        if i % 2 == 0:  # one branch per alternate root
            k0 = int(r.integers(9, 14))
            bx, by, bt = pts[k0]
            bang = ang + (0.7 if i % 4 == 0 else -0.7)
            br = [(bx, by, bt * 0.7)]
            for k in range(12):
                br.append((max(br[-1][0] + math.cos(bang) * 2.6, L.ROOT_MIN_X + 1),
                           min(max(br[-1][1] + math.sin(bang) * 1.6, AY0 + 4), AY1 - 3), bt * 0.7 * (1 - k / 13) + 1.5))
            roots.append(br)
    return roots


def root_mushroom_spots():
    """Crevices between neighbouring main roots near the trunk, for the glowing mushroom clusters."""
    roots = giant_roots()
    spots = []
    mains = roots[:L.GIANT_TREE_ROOTS + (L.GIANT_TREE_ROOTS + 1) // 2]
    for i in range(len(mains) - 1):
        for k in (5, 8, 3):
            a_, b_ = mains[i][k], mains[i + 1][k]
            x, y = (a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2 + 2
            if x >= CZ[2] + 6 or not CZ[1] - 6 <= y <= CZ[3] + 6:  # never in the calm zone
                spots.append((x, y))
                break
    return spots[:L.GLOW_MUSHROOMS]


def ground(sprites, decals_, props, ritual):
    """v3 forest floor: one colour story (teal-green floor, loam paths, cool moonlit patches), depth from large flat
    organic shapes only (value zones, diagonal moonbeams, top-left -> bottom-right falloff, cast shadows)."""
    r = rng(5)
    g = C.new(W, H)
    xx, yy = C.grid(W, H)
    n1 = C.value_noise(W, H, 56, rng(51))
    n2 = C.value_noise(W, H, 28, rng(52))
    v = 0.48 + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.18
    # (c) slow value falloff: lighter top-left, darker bottom-right, in wide flat bands after quantisation
    v += 0.22 - 0.44 * (((xx - AX0) / (AX1 - AX0)) * 0.55 + ((yy - AY0) / (AY1 - AY0)) * 0.45)
    # (b) wide diagonal moonbeam patches from the top-left (away from the hero spawn area)
    for bx, by, ln, wd in ((92, 60, 80, 16), (300, 52, 70, 13), (72, 168, 60, 12), (238, 220, 64, 12)):
        u = ((xx - bx) + (yy - by)) / math.sqrt(2)
        w_ = ((xx - bx) - (yy - by)) / math.sqrt(2)
        beam = (u / ln) ** 2 + (w_ / wd) ** 2
        v += 0.18 * np.clip(1.2 - beam, 0, 1)
    # (a) shade near the forest edge and under the giant tree
    din = np.minimum.reduce([xx - AX0, AX1 - xx, yy - AY0, AY1 - yy])
    v -= 0.22 * np.clip(1 - din / 26, 0, 1)
    gx, gy = L.GIANT_TREE
    v -= 0.3 * np.clip(1 - (((xx - gx) / 70) ** 2 + ((yy - gy + 10) / 46) ** 2), 0, 1)
    # the centre: same floor, one tone calmer and slightly darker so the hero pops
    cx0, cy0, cx1, cy1 = CZ
    calm = np.clip(1 - np.maximum(np.maximum(cx0 - xx, xx - cx1), np.maximum(cy0 - yy, yy - cy1)) / 14, 0, 1)
    v = v * (1 - calm) + 0.4 * calm
    idx = np.digitize(v, [0.22, 0.44, 0.74])  # mist (cool moonlight) only in the brightest beam cores
    base = np.array([C.ci(t) for t in LADDER], dtype=np.int16)[idx]
    base = majority(base, 3, 2)  # flat organic patches >= 6x6
    # the region the ground covers: arena + an irregular soft band outside it (darker, so the clamp reads)
    edge_noise = (C.value_noise(W, H, 12, rng(53)) - 0.5) * 6
    dx = np.maximum(0, np.maximum(AX0 - xx, xx - AX1))
    dy = np.maximum(0, np.maximum(AY0 - yy, yy - AY1))
    sd = np.where(din > 0, -din, np.maximum(dx, dy))
    cover = sd + edge_noise < L.EDGE_BAND
    g[cover] = base[cover]
    band = cover & (sd + edge_noise * 0.5 > 0.5)
    g[band] = C.ci("bg0")
    # (e) worn loam paths with irregular edges (low contrast)
    pn = C.value_noise(W, H, 10, rng(55))
    for path in L.PATHS:
        for (x0_, y0_), (x1_, y1_) in zip(path, path[1:]):
            vx, vy = x1_ - x0_, y1_ - y0_
            l2 = vx * vx + vy * vy
            t = np.clip(((xx - x0_) * vx + (yy - y0_) * vy) / l2, 0, 1)
            d = np.sqrt((xx - x0_ - t * vx) ** 2 + (yy - y0_ - t * vy) ** 2)
            half = (L.PATH_WIDTH[0] + (L.PATH_WIDTH[1] - L.PATH_WIDTH[0]) * pn) / 2
            m = cover & (d <= half) & ~band
            g[m & ~((xx >= cx0) & (xx < cx1) & (yy >= cy0) & (yy < cy1))] = C.ci("loam")
    g = np.where(cover, majority(np.where(cover, g, C.ci("bg0")), 2, 1), g)
    # rune circle: faint carved ring + rune slots, one step from the calm centre tone
    d = np.sqrt((xx - L.RITUAL_CENTER[0]) ** 2 + (yy - L.RITUAL_CENTER[1]) ** 2)
    ring = np.abs(d - L.RITUAL_RADIUS) < 0.55
    g[ring & (g == C.ci("forest"))] = C.ci("bg1")
    for (rx, ry) in ritual:
        g[(np.sqrt((xx - rx) ** 2 + (yy - ry) ** 2) <= 5.2) & cover] = C.ci("bg1")
    # giant tree roots: ground relief (lit top-left edge, dark underside), under the y-sorted layer
    rm = np.zeros((H, W), dtype=bool)
    for pts in giant_roots():
        for x, y, th in pts:
            rm |= (xx - x) ** 2 + (yy - y) ** 2 <= (th / 2) ** 2
    up = np.roll(rm, 1, 0) & np.roll(rm, 1, 1)
    low = np.roll(rm, -1, 0)
    shadow = np.roll(rm, -1, 0) | np.roll(np.roll(rm, -1, 0), -1, 1)
    g[shadow & ~rm & cover] = C.ci("bg0")  # arching roots cast a thin dark underside
    g[rm] = C.ci("earth")
    g[rm & ~up] = C.ci("loam")  # lit top-left edge
    g[rm & ~low] = C.ci("bg1")
    # (f) low-contrast ground details in clusters (never in the calm zone or on the roots)
    groups = [("fern", 3), ("grass_clump", 3), ("leaf_cluster", 2), ("moss_rock", 2), ("root_tendril", 1), ("pale_mushroom", 1)]
    centres = [(80, 60), (310, 64), (64, 180), (190, 228), (410, 210), (300, 236), (420, 70), (140, 46), (110, 236),
               (420, 150), (60, 130), (240, 44)]
    for k, (cx_, cy_) in enumerate(centres):
        for j in range(4):
            name, _w = groups[(k + j) % len(groups)]
            variants = [n for n in decals_ if n.startswith(name + "_")]
            dsp = decals_[variants[int(r.integers(0, len(variants)))]][0]
            x = int(cx_ + r.uniform(-14, 14))
            y = int(cy_ + r.uniform(-8, 8))
            bb = (x, y, x + dsp.shape[1], y + dsp.shape[0])
            if boxes_overlap(bb, CZ) or rm[max(0, y):y + dsp.shape[0], max(0, x):x + dsp.shape[1]].any():
                continue
            C.paste(g, dsp if r.random() < 0.5 else dsp[:, ::-1], x, y)
    # hollows: dark gaps leading into the trees
    for s_, p_ in L.HOLLOWS:
        hx, hy = L.hollow_point(s_, p_)
        g[((xx - hx) ** 2 + (yy - hy) ** 2 <= 11 ** 2) & cover] = C.ci("bg0")
    # (d) flat cast shadows under every prop: lower-right, 40-60% of its width, `forest` or darker
    for p in props:
        if p["kind"] in ("eyes", "glow") or p.get("overlayOf"):
            continue
        spr = sprites[p["sprite"]][p["frame"]]
        foot = np.nonzero((spr[-4:] != C.T).any(axis=0))[0]
        if not len(foot):
            continue
        fx0, fx1 = (p["w"] - 1 - foot.max(), p["w"] - 1 - foot.min()) if p["flip"] else (foot.min(), foot.max())
        fw = fx1 - fx0 + 1
        rx = max(2.0, fw * 0.25 + (p["w"] * 0.05))
        rx = min(rx, p["w"] * 0.3)
        ry = max(1.5, min(5.0, rx / 2.5))
        cxs = p["x"] + (fx0 + fx1) / 2 + rx * 0.6
        m = (((xx - cxs) / rx) ** 2 + ((yy - p["baseY"] - 1) / ry) ** 2 <= 1) & cover
        dark = np.isin(g, [C.ci("bg0"), C.ci("forest"), C.ci("bg1")])
        g[m & dark] = C.ci("bg0")
        g[m & ~dark] = C.ci("forest")
    return g


# ---------------------------------------------------------------- forest ring (flat silhouettes)

def _forest(seed, trunk_col, count, wmin, wmax, crowns=False, keep_outside=None, hmin=40, hmax=95):
    """Tileable band of REAL tree silhouettes in one flat tone (v3): each tree stands at a random base point, with a
    tapered trunk 40-95 px tall and sturdy forking branches; varied widths and heights, no rectangles, no round blobs."""
    r = rng(seed)
    pad = 64
    big = C.new(W + 2 * pad, H)

    def limb(x0, y0, ang, ln, th, depth):
        x1, y1 = x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln
        for k in range(max(1, int(th))):
            C.line(big, x0 + k - th / 2, y0, x1 + k - th / 2, y1, trunk_col)
        if depth > 0:
            for sgn in (-1, 1):
                limb(x1, y1, ang + sgn * r.uniform(0.3, 0.6), ln * r.uniform(0.55, 0.75), max(2, th - 1.5), depth - 1)

    for _ in range(count):
        x = r.uniform(pad, W + pad)
        base_y = r.uniform(30, H + 20)
        hgt = r.uniform(hmin, hmax)
        w0 = r.uniform(wmin, wmax)
        lean = r.uniform(-0.08, 0.08)
        for k in range(int(hgt)):  # tapered trunk
            y = base_y - k
            half = w0 / 2 * (1 - 0.55 * k / hgt)
            xc = x + lean * k
            big[int(max(0, min(H - 1, y))), int(xc - half):int(xc + half) + 1] = C.ci(trunk_col) if 0 <= y < H else C.T
        tx, ty = x + lean * hgt, base_y - hgt
        for ang in (-2.2, -1.57, -0.95):
            limb(tx, ty + 4, ang + r.uniform(-0.2, 0.2), r.uniform(10, 18), max(2.5, w0 / 3), 2)
        for _k in range(int(r.integers(1, 3))):  # a low side branch
            yb = base_y - hgt * r.uniform(0.35, 0.65)
            side = r.choice([-1, 1])
            limb(x + lean * (base_y - yb), yb, -1.57 + side * r.uniform(0.7, 1.1), r.uniform(8, 14), 2.5, 1)
    out = C.new(W, H)
    for x in range(W + 2 * pad):
        col = big[:, x]
        m = col != C.T
        out[m, (x - pad) % W] = col[m]
    return majority(out, 1, 1)


def _gap_hollows(a, radius):
    """Hollows read as dark gaps in the tree line: clear the silhouettes around each hollow."""
    xx, yy = C.grid(W, H)
    for s_, p_ in L.HOLLOWS:
        hx, hy = L.hollow_point(s_, p_)
        ox = {"left": -1, "right": 1}.get(s_, 0) * 12
        oy = {"top": -1, "bottom": 1}.get(s_, 0) * 12
        a[((xx - hx - ox) ** 2 + (yy - hy - oy) ** 2) <= radius ** 2] = C.T
    return a


def forest_far():
    a = np.full((H, W), C.ci("bg0"), dtype=np.int16)
    sil = _gap_hollows(_forest(11, "stone_dark", 46, 6, 12, hmin=30, hmax=70), 16)  # hollows stay dark in every layer
    a[sil != C.T] = sil[sil != C.T]
    return a


def forest_mid():
    return _gap_hollows(_forest(12, "bg1", 34, 8, 15, hmin=40, hmax=85), 14)


def forest_mist():
    """Flat mist bands (drawn translucent): smooth wavy strips, coarse 2x2 pattern only on their edges."""
    a = C.new(W, H)
    xx, yy = C.grid(W, H)
    wave = (C.value_noise(W, H, 48, rng(16)) - 0.5) * 14
    for by, th in ((22, 10), (110, 12), (200, 10), (256, 9)):
        core = np.abs(yy - by - wave) < th / 2
        edge = (np.abs(yy - by - wave) < th / 2 + 2) & ~core
        coarse = (((xx.astype(int) // 2) + (yy.astype(int) // 2)) % 2) == 0
        a[core | (edge & coarse)] = C.ci("fog")
    inside = (xx > AX0 + 4) & (xx < AX1 - 4) & (yy > AY0 + 4) & (yy < AY1 - 4)
    a[inside] = C.T  # the clearing itself stays clear
    return a


def forest_near():
    """Overhang ring: black trunks only outside the arena edge, thin branches reaching <= OVERHANG_MAX px into it."""
    r = rng(13)
    a = _forest(14, "bg0", 26, 10, 18, hmin=50, hmax=110)
    # crown of the giant tree: thick limbs leaving the arena through the top edge (drawn in the near forest)
    rr = rng(17)
    gx = L.GIANT_TREE[0]

    def climb(x0, y0, ang, ln, th, depth):
        x1, y1 = x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln
        for k in range(max(1, int(th))):
            C.line(a, x0 + k - th / 2, y0, x1 + k - th / 2, y1, "bg0")
        if depth > 0:
            for sgn in (-1, 1):
                climb(x1, y1, ang + sgn * rr.uniform(0.35, 0.6), ln * 0.7, max(2, th - 2), depth - 1)

    for ang in (-2.3, -1.9, -1.4, -1.0, -0.6):
        climb(gx + math.cos(ang) * 10, AY0 - 2, ang, rr.uniform(16, 26), 7, 3)
    keep = np.ones((H, W), dtype=bool)
    eb = L.EDGE_BAND - 4
    keep[AY0 - eb:AY1 + eb, AX0 - eb:AX1 + eb] = False
    a[~keep] = C.T
    m = L.OVERHANG_MAX
    for _ in range(18):
        side = int(r.integers(0, 4))
        if side == 0:
            x0, y0, dx, dy = r.uniform(AX0, AX1), AY0 - 8, r.uniform(-6, 6), m + 8
        elif side == 1:
            x0, y0, dx, dy = r.uniform(AX0, AX1), AY1 + 8, r.uniform(-6, 6), -(m + 8)
        elif side == 2:
            x0, y0, dx, dy = AX0 - 8, r.uniform(AY0, AY1), m + 8, r.uniform(-6, 6)
        else:
            x0, y0, dx, dy = AX1 + 8, r.uniform(AY0, AY1), -(m + 8), r.uniform(-6, 6)
        for t in range(2):  # 2 px thick twigs (single-pixel lines read as noise)
            C.line(a, x0 + t * (side >= 2), y0 + t * (side < 2), x0 + dx, y0 + dy, "bg0")
    a[AY0 + m:AY1 - m, AX0 + m:AX1 - m] = C.T
    return _gap_hollows(a, 12)


def split_overhang(near):
    """forest_near -> (outside part, opaque) + (overhang inside the arena rect, fades like a prop in the game)."""
    inside = np.zeros((H, W), dtype=bool)
    inside[AY0:AY1, AX0:AX1] = True
    outer, over = near.copy(), near.copy()
    outer[inside] = C.T
    over[~inside] = C.T
    return outer, over


def vignette(outer=False):
    """Flat vignette step: a bg0 band outside the arena (drawn translucent; two nested steps)."""
    xx, yy = C.grid(W, H)
    dx = np.maximum(0, np.maximum(AX0 - xx, xx - AX1))
    dy = np.maximum(0, np.maximum(AY0 - yy, yy - AY1))
    d = np.sqrt(dx * dx + dy * dy)
    a = C.new(W, H)
    a[d > (30 if outer else L.EDGE_BAND + 6)] = C.ci("bg0")
    return a


def fog_overlay():
    """A few large flat fog blobs near the edges (drawn translucent), coarse 2x2 pattern only on their rims."""
    xx, yy = C.grid(W, H)
    n = C.value_noise(W, H, 64, rng(15))
    edge_w = np.clip(1 - np.minimum.reduce([xx - AX0, AX1 - xx, yy - AY0, AY1 - yy]) / 60, 0, 1)
    v = n * 0.6 + edge_w * 0.5
    core = v > 0.78
    rim = (v > 0.74) & ~core
    coarse = (((xx.astype(int) // 2) + (yy.astype(int) // 2)) % 2) == 0
    a = C.new(W, H)
    a[core | (rim & coarse)] = C.ci("fog")
    a[CZ[1]:CZ[3], CZ[0]:CZ[2]] = C.T
    return a


def ritual_runes():
    cx, cy = L.RITUAL_CENTER
    out = []
    for k in range(8):
        ang = (k * 45 + 22.5) * math.pi / 180
        out.append((cx + round(math.cos(ang) * L.RUNE_RING_RADIUS), cy + round(math.sin(ang) * L.RUNE_RING_RADIUS)))
    return out
