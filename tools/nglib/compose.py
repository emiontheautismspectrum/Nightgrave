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
            if x < L.ROOT_MIN_X + 1:  # a root ends where it reaches the limit (no clamped stubs)
                break
            y = min(max(y, AY0 + 4), AY1 - 3)
            pts.append((x, y, 9.5 - 7.5 * t))
        roots.append(pts)
        if i % 2 == 0 and len(pts) > 14:  # one branch per alternate root
            k0 = int(r.integers(9, 14))
            bx, by, bt = pts[k0]
            bang = ang + (0.7 if i % 4 == 0 else -0.7)
            br = [(bx, by, bt * 0.7)]
            for k in range(12):
                nx = br[-1][0] + math.cos(bang) * 2.6
                if nx < L.ROOT_MIN_X + 1:
                    break
                br.append((nx, min(max(br[-1][1] + math.sin(bang) * 1.6, AY0 + 4), AY1 - 3), bt * 0.7 * (1 - k / 13) + 1.5))
            roots.append(br)
    return roots


def root_mushroom_spots():
    """Crevices between neighbouring main roots near the trunk, for the glowing mushroom clusters."""
    roots = giant_roots()
    spots = []
    mains = roots[:L.GIANT_TREE_ROOTS + (L.GIANT_TREE_ROOTS + 1) // 2]
    for i in range(len(mains) - 1):
        for k in (5, 8, 3):
            if k >= min(len(mains[i]), len(mains[i + 1])):
                continue
            a_, b_ = mains[i][k], mains[i + 1][k]
            x, y = (a_[0] + b_[0]) / 2, (a_[1] + b_[1]) / 2 + 2
            if x >= CZ[2] + 6 or not CZ[1] - 6 <= y <= CZ[3] + 6:  # never in the calm zone
                spots.append((x, y))
                break
    return spots[:L.GLOW_MUSHROOMS]


from .palette import RGB as _RGB  # noqa: E402

LUMI = np.array([0.2126 * ((c[0] / 255) ** 2.2) + 0.7152 * ((c[1] / 255) ** 2.2) + 0.0722 * ((c[2] / 255) ** 2.2)
                 for c in _RGB])
STONE = ["bg0", "bg1", "fog", "mist", "stone_dark"]  # v4 stone ramp, darkest first (cap = stone_dark)
MOSS = ["forest", "fern"]
SOIL = ["earth", "loam"]
STEP_DOWN = {"stone_dark": "mist", "mist": "fog", "fog": "bg1", "bg1": "bg0", "bg0": "bg0", "fern": "forest",
             "forest": "bg0", "loam": "earth", "earth": "bg0"}
STEP_UP = {"bg0": "bg1", "bg1": "fog", "fog": "mist", "mist": "stone_dark", "stone_dark": "stone_dark", "forest": "fern",
           "fern": "fern", "earth": "loam", "loam": "loam"}


def _poly_dist(px, py, poly):
    best = 1e9
    for (x0, y0), (x1, y1) in zip(poly, poly[1:]):
        vx, vy = x1 - x0, y1 - y0
        t = max(0.0, min(1.0, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy)))
        best = min(best, math.hypot(px - x0 - t * vx, py - y0 - t * vy))
    return best


def _value_field(xx, yy):
    """Large flat value structure: lit upper-left/altar/left of centre, shade bottom-right/forest edge/under the tree,
    diagonal moonbeams from the top-left, wide top-left -> bottom-right falloff. Returns ~0..1."""
    n1 = C.value_noise(W, H, 64, rng(51))
    v = 0.5 + (n1 - 0.5) * 0.35
    v += 0.45 - 0.9 * (((xx - AX0) / (AX1 - AX0)) * 0.55 + ((yy - AY0) / (AY1 - AY0)) * 0.45)
    for bx, by, ln, wd in ((92, 60, 84, 18), (300, 56, 66, 13), (70, 170, 60, 13), (236, 222, 60, 12)):
        u = ((xx - bx) + (yy - by)) / math.sqrt(2)
        w_ = ((xx - bx) - (yy - by)) / math.sqrt(2)
        v += 0.22 * np.clip(1.2 - ((u / ln) ** 2 + (w_ / wd) ** 2), 0, 1)
    ax, ay = L.PORTAL_ALTAR
    v += 0.12 * np.clip(1 - np.hypot(xx - ax, yy - ay) / 60, 0, 1)
    din = np.minimum.reduce([xx - AX0, AX1 - xx, yy - AY0, AY1 - yy])
    v -= 0.4 * np.clip(1 - din / 34, 0, 1)
    gx, gy = L.GIANT_TREE
    v -= 0.4 * np.clip(1 - (((xx - gx) / 72) ** 2 + ((yy - gy + 8) / 48) ** 2), 0, 1)
    return v, din


def long_seams(lab, max_len):
    """Axis-aligned joint runs longer than max_len px between the same two stones -> [(stone index, run length)]."""
    out = []
    for axis in (0, 1):
        a_ = lab if axis == 0 else lab.T
        # boundary between two real stones (labels < 0 = outside the arena: the rect edge is not a seam)
        diff = (a_[:, :-1] != a_[:, 1:]) & (a_[:, :-1] >= 0) & (a_[:, 1:] >= 0)
        pair = a_[:, :-1] * 100000 + a_[:, 1:]
        for x in range(diff.shape[1]):
            run, prev = 0, None
            col_d, col_p = diff[:, x], pair[:, x]
            for y in range(len(col_d)):
                if col_d[y] and col_p[y] == prev:
                    run += 1
                else:
                    if run > max_len:
                        out.append((int(prev // 100000), run))
                    run = 1 if col_d[y] else 0
                    prev = col_p[y] if col_d[y] else None
            if run > max_len:
                out.append((int(prev // 100000), run))
    return out


def stone_layout():
    """The flagstone layout: seeds (Poisson by zone, concentric at the altar, cobbles on the paths), Lloyd-relaxed Voronoi
    labels, per-stone base tone (index into STONE), joints, and which cells are missing / broken / sunken."""
    r = rng(60)
    xx, yy = C.grid(W, H)
    v, din = _value_field(xx, yy)
    ax, ay = L.PORTAL_ALTAR
    gx, gy = L.GIANT_TREE

    def zone(x, y):
        if CZ[0] <= x <= CZ[2] and CZ[1] <= y <= CZ[3]:
            return "calm"
        d_in = min(x - AX0, AX1 - x, y - AY0, AY1 - y)
        if math.hypot(x - gx, y - gy) < 60:
            return "tree"
        return "edge" if d_in < 26 else "mid"

    fixed = []  # altar plaza: concentric rings; paths: two rows of cobbles
    fixed.append((ax, ay))
    for rad, n in ((13, 6), (25, 10), (37, 15)):
        for k in range(n):
            a_ = 2 * math.pi * k / n + rad * 0.07
            fixed.append((ax + math.cos(a_) * rad, ay + math.sin(a_) * rad * 0.8))
    for path in L.PATHS:
        for (x0, y0), (x1, y1) in zip(path, path[1:]):
            seg = math.hypot(x1 - x0, y1 - y0)
            nx, ny = -(y1 - y0) / seg, (x1 - x0) / seg
            k = 0.0
            while k <= seg:
                t = k / seg
                for side in (-1, 0, 1):  # three loose rows of cobbles: jitter along AND across, uneven stagger
                    along = r.uniform(-1.8, 1.8) + (r.uniform(3, 5.5) if side == 0 else 0)
                    across = side * r.uniform(4.6, 6.4) + r.uniform(-1.5, 1.5)
                    fixed.append((x0 + (x1 - x0) * (t + along / seg) + nx * across,
                                  y0 + (y1 - y0) * (t + along / seg) + ny * across))
                k += r.uniform(8.0, 11.0)
    pts = list(fixed)
    pt_arr = np.array(pts)
    for _ in range(9000):
        x, y = r.uniform(AX0 - 14, AX1 + 14), r.uniform(AY0 - 14, AY1 + 14)
        if math.hypot(x - ax, y - ay) < L.ALTAR_PLAZA_R or any(_poly_dist(x, y, pth) < L.PATH_WIDTH / 2 + 2 for pth in L.PATHS):
            continue
        sz = L.STONE_SIZE[zone(x, y)] * r.uniform(0.85, 1.12)
        if (np.hypot(pt_arr[:, 0] - x, pt_arr[:, 1] - y) < sz * 0.82).any():
            continue
        pts.append((x, y))
        pt_arr = np.array(pts)
    nfix = len(fixed)
    seeds = np.array(pts, dtype=np.float64)

    def labels_of(sd):
        lab = np.zeros((H, W), dtype=np.int32)
        for y0_ in range(0, H, 30):
            ys_ = yy[y0_:y0_ + 30, :, None]
            xs_ = xx[y0_:y0_ + 30, :, None]
            d2 = (xs_ - sd[None, None, :, 0]) ** 2 + (ys_ - sd[None, None, :, 1]) ** 2
            lab[y0_:y0_ + 30] = np.argmin(d2, axis=2)
        return lab

    for _ in range(2):  # Lloyd relaxation (fixed seeds stay put)
        lab = labels_of(seeds)
        cnt = np.bincount(lab.ravel(), minlength=len(seeds))
        mx = np.bincount(lab.ravel(), weights=xx.ravel(), minlength=len(seeds))
        my = np.bincount(lab.ravel(), weights=yy.ravel(), minlength=len(seeds))
        ok = cnt > 0
        moved = seeds.copy()
        moved[ok, 0], moved[ok, 1] = mx[ok] / cnt[ok], my[ok] / cnt[ok]
        moved[:nfix] = seeds[:nfix]
        seeds = moved
    pd = np.full((H, W), 1e9)
    for pth in L.PATHS:
        for (x0, y0), (x1, y1) in zip(pth, pth[1:]):
            vx, vy = x1 - x0, y1 - y0
            t = np.clip(((xx - x0) * vx + (yy - y0) * vy) / (vx * vx + vy * vy), 0, 1)
            pd = np.minimum(pd, np.hypot(xx - x0 - t * vx, yy - y0 - t * vy))
    n = len(seeds)
    is_cobble = np.zeros(n, dtype=bool)
    is_cobble[32:nfix] = True
    others = np.nonzero(~is_cobble)[0]

    def full_labels(sd):
        """Voronoi labels; cobbles never grow beyond the path corridor (those pixels go to the nearest flagstone)."""
        lb = labels_of(sd)
        stray = is_cobble[lb] & (pd > L.PATH_WIDTH / 2 + 1)
        if stray.any():
            lb[stray] = others[labels_of(sd[others])[stray]]
        return lb

    lab = full_labels(seeds)
    inside = (xx > AX0 - 2) & (xx < AX1 + 2) & (yy > AY0 - 2) & (yy < AY1 + 2)
    # break 4-way "+" junctions and long axis-aligned seams: nudge the seeds involved, recompute
    for _round in range(12):
        bad = set()
        q = np.stack([lab[:-1, :-1], lab[:-1, 1:], lab[1:, :-1], lab[1:, 1:]])
        four = (q[0] != q[1]) & (q[0] != q[2]) & (q[0] != q[3]) & (q[1] != q[2]) & (q[1] != q[3]) & (q[2] != q[3])
        four &= inside[:-1, :-1]
        for y, x in zip(*np.nonzero(four)):
            bad.update(int(v_) for v_ in q[:, y, x])
        for idx, _len in long_seams(np.where(inside, lab, -1), 20):
            if idx >= 0:
                bad.add(idx)
        if not bad:
            break
        for i in sorted(bad):
            seeds[i] += r.uniform(-4.0, 4.0, 2)
        lab = full_labels(seeds)
    cnt = np.bincount(lab.ravel(), minlength=n)
    cxs = np.bincount(lab.ravel(), weights=xx.ravel(), minlength=n) / np.maximum(cnt, 1)
    cys = np.bincount(lab.ravel(), weights=yy.ravel(), minlength=n) / np.maximum(cnt, 1)
    # joints: 1 px boundary (right/down neighbour differs), widened to 2 px on some pairs; rounded junctions
    jr = np.zeros((H, W), dtype=bool)
    jr[:, :-1] |= lab[:, :-1] != lab[:, 1:]
    jr[:-1, :] |= lab[:-1, :] != lab[1:, :]
    junction = np.zeros((H, W), dtype=bool)
    junction[:-1, :-1] = (lab[:-1, :-1] != lab[1:, 1:]) & (lab[:-1, 1:] != lab[1:, :-1])
    joint = jr.copy()
    joint[1:, 1:] |= junction[:-1, :-1]
    # per-stone base tone from the value field at its centroid, with a calm irregular rhythm
    vi = v[np.clip(cys.astype(int), 0, H - 1), np.clip(cxs.astype(int), 0, W - 1)]
    tone = np.clip(np.round(-0.3 + vi * 5.0), 1, 4).astype(int)  # use the whole ramp: shade bg1 .. lit stone_dark
    tone += (r.random(n) < 0.18).astype(int) * r.choice([-1, 1], n)
    tone = np.clip(tone, 1, 4)
    calm = (cxs >= CZ[0]) & (cxs <= CZ[2]) & (cys >= CZ[1]) & (cys <= CZ[3])
    tone[calm] = np.where(r.random(calm.sum()) < 0.7, 2, 3)  # calm centre: fog / mist only
    path_cell = np.zeros(n, dtype=bool)
    path_cell[32:nfix] = True  # cobbles (all fixed seeds after the plaza's 32)
    tone[path_cell] = np.maximum(1, tone[path_cell] - 1)  # cobbles one step darker, before the neighbour smoothing
    # neighbouring stones differ by at most one step
    pairs = set()
    for a_, b_ in ((lab[:, :-1], lab[:, 1:]), (lab[:-1, :], lab[1:, :])):
        m = a_ != b_
        pairs |= set(zip(a_[m].tolist(), b_[m].tolist()))
    for _ in range(8):
        changed = False
        for i, j in pairs:
            if tone[i] - tone[j] > 1:
                tone[i] = tone[j] + 1
                changed = True
            elif tone[j] - tone[i] > 1:
                tone[j] = tone[i] + 1
                changed = True
        if not changed:
            break
    # missing stones (soil / moss showing): rare in the mid ring, frequent at the forest edge and under the tree
    dcell = np.minimum.reduce([cxs - AX0, AX1 - cxs, cys - AY0, AY1 - cys])
    p_missing = np.where(dcell < 30, 0.65 * (1 - np.clip(dcell, 0, 30) / 30), 0.04)
    p_missing = np.where(np.hypot(cxs - gx, cys - gy) < 58, np.maximum(p_missing, 0.5), p_missing)
    p_missing[calm | path_cell] = 0
    p_missing[:32] = 0  # altar plaza is intact
    missing = r.random(n) < p_missing
    sunken = (~missing) & ~calm & (r.random(n) < 0.12)
    broken = (~missing) & ~calm & (r.random(n) < 0.05)
    lit_edge = (~missing) & (tone < 4) & (r.random(n) < 0.12)
    return dict(lab=lab, tone=tone, joint=joint, missing=missing, sunken=sunken, broken=broken, lit_edge=lit_edge,
                cx=cxs, cy=cys, calm=calm, path=path_cell, n=n, v=v, din=din)


def ground(sprites, decals_, props, ritual, return_masks=False):
    """v4 stone courtyard reclaimed by the forest (see ASSETS_SPEC.md 'Ground (v4)')."""
    r = rng(5)
    S = stone_layout()
    lab, tone, joint = S["lab"], S["tone"], S["joint"]
    xx, yy = C.grid(W, H)
    din = S["din"]
    ci_stone = np.array([C.ci(t) for t in STONE], dtype=np.int16)
    g = C.new(W, H)
    decal = np.zeros((H, W), dtype=bool)  # pixels that are not plain stone/joint (moss, soil, cracks, roots, ...)
    # region the ground covers: arena + an irregular soft band outside it
    edge_noise = (C.value_noise(W, H, 12, rng(53)) - 0.5) * 6
    dx = np.maximum(0, np.maximum(AX0 - xx, xx - AX1))
    dy = np.maximum(0, np.maximum(AY0 - yy, yy - AY1))
    sd = np.where(din > 0, -din, np.maximum(dx, dy))
    cover = sd + edge_noise < L.EDGE_BAND
    # stones: base tone, then a second flat tone (sunken: darker lower-right edge; lit: 1 px top-left edge)
    g[cover] = ci_stone[tone[lab]][cover]
    left = np.roll(lab, 1, 1)
    up = np.roll(lab, 1, 0)
    right = np.roll(lab, -1, 1)
    down = np.roll(lab, -1, 0)
    nb_min0 = np.minimum.reduce([tone[lab], tone[right], tone[down], tone[left], tone[up]])
    # lit top-left edge only on stones with no darker neighbour (joint -> lit edge stays within 2 steps)
    st_lit = S["lit_edge"][lab] & ((left != lab) | (up != lab)) & ~joint & (nb_min0 == tone[lab])
    g[st_lit & cover] = ci_stone[np.minimum(4, tone[lab] + 1)][st_lit & cover]
    st_sunk = S["sunken"][lab] & ((right != lab) | (down != lab) | np.roll(joint, -1, 1) | np.roll(joint, -1, 0)) & ~joint
    g[st_sunk & cover] = ci_stone[np.maximum(0, tone[lab] - 1)][st_sunk & cover]
    # joints: one step darker than the darker of the two stones they separate
    # joint = one step below its own stone, never lighter than any stone pixel actually drawn next to it
    order = {int(c): i for i, c in enumerate(ci_stone)}
    step = np.vectorize(lambda c: order.get(int(c), 9))(g)
    step[joint] = 9
    nb_px = np.minimum.reduce([np.roll(step, 1, 0), np.roll(step, -1, 0), np.roll(step, 1, 1), np.roll(step, -1, 1)])
    jstep = np.maximum(0, np.minimum(tone[lab] - 1, nb_px))
    g[joint & cover] = ci_stone[jstep][joint & cover]
    # missing stones: soil or moss (flat), forest floor in deep shade
    miss = S["missing"][lab] & cover
    soil = C.value_noise(W, H, 18, rng(56))
    fill = np.where(soil > 0.62, C.ci("earth"), np.where(soil > 0.45, C.ci("fern"), C.ci("forest")))
    fill = np.where((din < 10) & (soil < 0.7), C.ci("forest"), fill)
    g[miss] = fill[miss]
    decal |= miss
    # broken slabs: one crack line through the stone (joint tone)
    for i in np.nonzero(S["broken"])[0][:14]:
        a_ = r.uniform(0, math.pi)
        x0, y0 = S["cx"][i] - math.cos(a_) * 14, S["cy"][i] - math.sin(a_) * 14
        line = C.new(W, H)
        C.line(line, x0, y0, x0 + math.cos(a_) * 28, y0 + math.sin(a_) * 28, "bg0")
        m = (line != C.T) & (lab == i) & ~joint & cover
        g[m] = ci_stone[max(0, tone[i] - 1)]
    # forest edge: the stone gives way to forest floor (flat patches), one step darker outside the rect
    edge_floor = cover & ((din < 6 + (soil - 0.5) * 10) | (sd > 0))
    floor_t = np.where(soil > 0.55, C.ci("forest"), C.ci("bg1"))
    g[edge_floor] = floor_t[edge_floor]
    out = cover & (sd + edge_noise * 0.5 > 0.5)
    g[out] = np.where(soil[out] > 0.5, C.ci("bg0"), C.ci("forest"))
    decal |= edge_floor
    # broken low curb at the rect: fragments with gaps (stone_dark top, mist face)
    hollows = [L.hollow_point(s_, p_) for s_, p_ in L.HOLLOWS]
    for side in range(4):
        pos = 0
        length = (AX1 - AX0) if side < 2 else (AY1 - AY0)
        while pos < length:
            seg = int(r.integers(10, 26))
            gap = int(r.integers(6, 20))
            for k in range(pos, min(length, pos + seg)):
                if side < 2:
                    x, y = AX0 + k, (AY0 if side == 0 else AY1 - 3)
                else:
                    x, y = (AX0 if side == 2 else AX1 - 3), AY0 + k
                if any(math.hypot(x - hx, y - hy) < 14 for hx, hy in hollows):
                    continue
                for t in range(3):
                    px, py = (x, y + t) if side < 2 else (x + t, y)
                    if 0 <= px < W and 0 <= py < H:
                        g[py, px] = C.ci("stone_dark") if t == 0 else C.ci("mist" if t == 1 else "bg1")
                        decal[py, px] = True
            pos += seg + gap
    # fern moss: soft patches 8-20 px at stone corners in the mid ring and the edges, weeds in joints
    for _ in range(16):
        x, y = r.uniform(AX0 + 8, AX1 - 8), r.uniform(AY0 + 8, AY1 - 8)
        if CZ[0] - 6 <= x <= CZ[2] + 6 and CZ[1] - 6 <= y <= CZ[3] + 6:
            continue
        rx, ry = r.uniform(4, 10), r.uniform(3, 7)
        m = (((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2 <= 1) & cover
        g[m] = C.ci("fern")  # one flat tone (a joint/fern alternation would read as dither)
        decal |= m
    weeds = 0
    jy, jx = np.nonzero(joint & cover & ~decal)
    order = r.permutation(len(jx))
    for k in order:
        if weeds >= L.WEEDS_MAX:
            break
        x, y = int(jx[k]), int(jy[k])
        if CZ[0] - 6 <= x <= CZ[2] + 6 and CZ[1] - 6 <= y <= CZ[3] + 6:
            continue
        for ddx, ddy in ((0, 0), (0, -1), (1, -1)):
            if 0 <= y + ddy < H and 0 <= x + ddx < W:
                g[y + ddy, x + ddx] = C.ci("fern")
                decal[y + ddy, x + ddx] = True
        weeds += 1
    # hairline cracks (<= 12, <= 4 in the calm centre): one step darker, inside a single stone
    cracks, calm_cracks = 0, 0
    for i in r.permutation(S["n"]):
        if cracks >= L.CRACKS_MAX or S["missing"][i]:
            continue
        if S["calm"][i]:
            if calm_cracks >= L.CRACKS_CALM_MAX:
                continue
            calm_cracks += 1
        x, y = S["cx"][i], S["cy"][i]
        line = C.new(W, H)
        px, py = x, y
        for _k in range(3):
            nx, ny = px + r.uniform(-5, 5), py + r.uniform(-4, 4)
            C.line(line, px, py, nx, ny, "bg0")
            px, py = nx, ny
        m = (line != C.T) & (lab == i) & ~joint & cover
        g[m] = ci_stone[max(0, tone[i] - 1)]
        decal |= m
        cracks += 1
    # altar plaza: 2-3 slabs with faint carved rune lines (one step darker)
    for i, ang in ((2, 0.4), (9, 1.2), (20, 2.6)):
        x, y = S["cx"][i], S["cy"][i]
        line = C.new(W, H)
        C.line(line, x - 3, y - 2, x + 2, y + 3, "bg0")
        C.line(line, x + 2, y - 3, x - 1, y + 1, "bg0")
        m = (line != C.T) & (lab == i) & ~joint & cover
        g[m] = ci_stone[max(0, tone[i] - 1)]
        decal |= m
    # leaf litter (3 clusters) and needle specks in shade (soil tones, neighbouring steps)
    for lx, ly in ((76, 210), (300, 52), (420, 228)):
        for _ in range(7):
            x, y = int(lx + r.uniform(-10, 10)), int(ly + r.uniform(-6, 6))
            for ddx in (0, 1):
                if 0 <= x + ddx < W:
                    g[y, x + ddx] = C.ci("earth")
                    decal[y, x + ddx] = True
    shade = (S["v"] < 0.32) & cover & ~joint
    sy_, sx_ = np.nonzero(shade)
    for k in r.permutation(len(sx_))[:24]:
        g[sy_[k], sx_[k]] = C.ci("earth") if g[sy_[k], sx_[k]] in (C.ci("forest"), C.ci("bg1"), C.ci("bg0")) else g[sy_[k], sx_[k]]
        decal[sy_[k], sx_[k]] = True
    # rune circle: faint carved ring + rune slots in the calm centre (one step darker)
    d = np.sqrt((xx - L.RITUAL_CENTER[0]) ** 2 + (yy - L.RITUAL_CENTER[1]) ** 2)
    ring = (np.abs(d - L.RITUAL_RADIUS) < 0.55) & cover & ~joint
    g[ring] = ci_stone[np.maximum(0, tone[lab] - 1)][ring]
    for (rx, ry) in ritual:
        m = ((xx - rx) ** 2 + (yy - ry) ** 2 <= 4.5 ** 2) & cover
        g[m] = ci_stone[np.maximum(0, tone[lab] - 1)][m]
        decal |= m
    decal |= ring
    # giant tree roots: relief over the stones (bark tones bg1 / earth / loam, lit top-left, dark underside)
    rm = np.zeros((H, W), dtype=bool)
    for pts in giant_roots():
        for x, y, th in pts:
            rm |= (xx - x) ** 2 + (yy - y) ** 2 <= (th / 2) ** 2
    up_r = np.roll(rm, 1, 0) & np.roll(rm, 1, 1)
    shadow = (np.roll(rm, -1, 0) | np.roll(np.roll(rm, -1, 0), -1, 1)) & ~rm & cover
    g[shadow] = C.ci("bg0")
    g[rm] = C.ci("earth")
    g[rm & ~up_r] = C.ci("loam")
    g[rm & ~np.roll(rm, -1, 0)] = C.ci("bg1")
    decal |= rm | shadow
    # puddles (<= 2): soft dark shape with a tiny moon glint
    for px_, py_, rx, ry in L.PUDDLES:
        m = (((xx - px_) / rx) ** 2 + ((yy - py_) / ry) ** 2 <= 1) & cover
        g[m] = C.ci("bg0")
        g[int(py_) - 1, int(px_) - 2:int(px_)] = C.ci("moon")
        decal |= m
    # hollows: dark gaps leading into the trees
    for hx, hy in hollows:
        m = ((xx - hx) ** 2 + (yy - hy) ** 2 <= 11 ** 2) & cover
        g[m] = C.ci("bg0")
        decal |= m
    # flat cast shadows under props: lower-right, 40-60% of the prop width, one step darker
    shadow_m = np.zeros((H, W), dtype=bool)
    for p in props:
        if p["kind"] in ("eyes", "glow") or p.get("overlayOf"):
            continue
        spr = sprites[p["sprite"]][p["frame"]]
        foot = np.nonzero((spr[-4:] != C.T).any(axis=0))[0]
        if not len(foot):
            continue
        fx0, fx1 = (p["w"] - 1 - foot.max(), p["w"] - 1 - foot.min()) if p["flip"] else (foot.min(), foot.max())
        rx = min(max(2.0, p["w"] * 0.25), p["w"] * 0.3)
        ry = max(1.5, min(5.0, rx / 2.5))
        cxs = p["x"] + (fx0 + fx1) / 2 + rx * 0.6
        shadow_m |= (((xx - cxs) / rx) ** 2 + ((yy - p["baseY"] - 1) / ry) ** 2 <= 1) & cover
    g0 = g.copy()  # one step darker, computed from the original tones (no chained steps)
    for src, dst in STEP_DOWN.items():
        g[shadow_m & (g0 == C.ci(src))] = C.ci(dst)
    # remove 1-px slivers that would form a period-2 stripe (e.g. a thin stone strip between two joints)
    jn = joint | np.roll(joint, 1, 0) | np.roll(joint, -1, 0) | np.roll(joint, 1, 1) | np.roll(joint, -1, 1)
    for _ in range(2):
        for axis in (0, 1):
            a_ = g if axis == 0 else g.T
            jt_ = joint if axis == 0 else joint.T
            jn_ = jn if axis == 0 else jn.T
            mid = a_[1:-2]
            darker = LUMI[np.clip(a_[:-3], 0, None)] < LUMI[np.clip(mid, 0, None)]
            stripe = (a_[:-3] == a_[2:-1]) & (mid == a_[3:]) & (mid != a_[:-3]) & (mid != C.T) & (a_[:-3] != C.T)
            # joints are never lightened; a stone sliver touching a joint may only take that joint's tone
            stripe &= ~(jt_[1:-2] & ~darker) & ~(jn_[1:-2] & ~jt_[1:-2] & darker & ~jt_[:-3])
            mid[stripe] = a_[:-3][stripe]
            # a dark joint between two lighter pixels (joint, then a lit edge): darken the next stone pixel instead,
            # unless that would put it below a joint it touches
            nxt = a_[2:-1]
            lum_ = LUMI[np.clip(a_, 0, None)]
            blocked = ((a_[:-3] == a_[2:-1]) & (mid == a_[3:]) & (mid != a_[:-3]) & (mid != C.T) & (a_[:-3] != C.T)
                       & jt_[1:-2] & ~darker & ~jt_[2:-1])
            ok = blocked.copy()
            for sh in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
                nb_j = np.roll(jt_, sh[0], sh[1])[2:-1]
                nb_l = np.roll(lum_, sh[0], sh[1])[2:-1]
                ok &= ~(nb_j & (nb_l > LUMI[np.clip(mid, 0, None)]))
            nxt[ok] = mid[ok]
            if axis == 1:
                g = a_.T.copy()
    # safety net: a joint the pass left lighter than a stone pixel it touches takes that stone's tone,
    # if it stays within the joint/stone contrast budget against all its stone neighbours
    st_ = cover & ~joint & ~decal & ~shadow_m & (g != C.T)
    lum = LUMI[np.clip(g, 0, None)]
    nbs = [(np.roll(np.roll(g, -dy, 0), -dx, 1), np.roll(np.roll(st_, -dy, 0), -dx, 1))
           for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0))]
    for y, x in zip(*np.nonzero(joint & cover & (g != C.T))):
        cand = [int(n[y, x]) for n, m in nbs if m[y, x] and LUMI[n[y, x]] < lum[y, x]]
        if not cand:
            continue
        c = min(cand, key=lambda k: LUMI[k])
        if all((max(LUMI[c], LUMI[n[y, x]]) + 0.05) / (min(LUMI[c], LUMI[n[y, x]]) + 0.05) <= 1.35
               for n, m in nbs if m[y, x]):
            g[y, x] = c
    if return_masks:
        return g, dict(S, decal=decal | shadow_m, cover=cover)
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
