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
    lm("giant_tree", (tx, L.GIANT_TREE[1] + (tree_spr.shape[0] - 1 - LM.GIANT_TREE_BASE[1]) + 1))
    lm("rune_sword", L.RUNE_SWORD, anim="rune_sword")
    lm("rune_sword_base", (L.RUNE_SWORD[0], L.RUNE_SWORD[1] + 3))
    gal = lm("gallows_tree", L.GALLOWS)
    P.overlay(gal, "gallows_cage", 34, 10, "gallows_cage")
    P.overlay(gal, "crow", 20, 2, "crow")
    P.overlay(gal, "crow", 38, 2, "crow")
    well = lm("cursed_well", L.WELL)
    P.overlay(well, "well_wisp", 6, -9, "well_wisp")
    lm("gas_lamp_short", L.WELL_LAMP)
    lm("beast_ribcage", L.RIBCAGE)
    lm("hunter_wagon", L.WAGON, anim="hunter_wagon")
    lm("horse_skeleton", L.WAGON_HORSE, flip=True)
    cab = lm("hunter_cabin", L.CABIN)
    P.overlay(cab, "cabin_window", LM.CABIN_WINDOW_AT[0], LM.CABIN_WINDOW_AT[1], "cabin_window")
    P.overlay(cab, "cabin_smoke", LM.CABIN_SMOKE_AT[0], LM.CABIN_SMOKE_AT[1], "cabin_smoke", base_bias=-1)
    for name, dx, dy in L.WORKSHOP:
        lm(name, (L.CABIN[0] + dx, L.CABIN[1] - 28 + dy))
    for name, x, y in L.FALLEN_WEAPONS:
        lm(name, (x, y))
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
            others_free = all(not boxes_overlap(b, ob, 2) for ob in P.boxes if ob not in grave_boxes)
            graves_free = all(not boxes_overlap(b, gb, 2) for gb in grave_boxes)  # loose clusters: graves never touch
            if graves and graves[-1][2] == v:
                continue  # never the same variant twice in a row
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
        for _ in range(60):
            if got >= n:
                break
            if try_grave(cx_ + r.uniform(-sx, sx), cy_ + r.uniform(-sy, sy), f"cluster{ci}"):
                got += 1
    for x, y in L.GRAVE_SINGLES:
        try_grave(x, y, "single")
    if not 8 <= len(graves) <= 12:
        raise AssertionError(f"{len(graves)} graves placed, need 8-12")
    # 5. short broken fence fragments next to graves
    for i in range(L.FENCE_FRAGMENTS):
        gx, gy, _v, _t = graves[(i * 3) % len(graves)]
        for dx, dy in ((14, 2), (-14, 2), (12, -8), (-12, -8), (18, 6), (-18, 6)):
            b = P.box_for(f"fence_frag_{i}", gx + dx, gy + dy)
            if not in_calm(b) and P.free(b, pad=1) and hollow_ok(b) and box_dist(b, altar_box) >= L.GRAVE_ALTAR_CLEAR:
                must(P.add(f"fence_frag_{i}", gx + dx, gy + dy, flip=bool(i % 2), kind="decor_attached"), "fence fragment")
                break
        else:
            notes.append(f"fence fragment {i} found no spot next to a grave")
    # 3. author dead trees: keep at most MAX_TREES; nudge minimally out of the calm zone / landmarks / hollows
    trees = 0
    for k, a in enumerate(L.DEAD_TREES_PCT):
        if trees >= L.MAX_TREES:
            notes.append(f"author tree {k} at {L.pct(a)} dropped (budget of {L.MAX_TREES} trees reached)")
            continue
        x, y = L.pct(a)
        v = f"tree_{k % 4}"
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
            notes.append(f"author tree {k} at ({x},{y}) dropped (no free spot within 64 px)")
            continue
        if best != (0, 0):
            notes.append(f"author tree {k} at ({x},{y}) nudged by ({best[0]:+d},{best[1]:+d})")
        must(P.add(v, x + best[0], y + best[1], flip=bool(k % 2), shade=k % 2, kind="tree"), f"tree {k}")
        trees += 1

    # 6. small decor (<= 25) in loose clusters, Poisson-disc spacing inside each cluster
    r = rng(3)
    small = (["bone_pile_%d" % i for i in range(4)] + ["skull_0", "skull_1"] + ["grass_%d" % i for i in range(4)] +
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


DARKER_TONE = {"fog": "bg1", "earth": "bg1", "forest": "bg0", "bg1": "bg0", "moss": "forest", "stone_dark": "bg1",
               "stone": "stone_dark", "bg0": "bg0"}


def ground(sprites, decals_, props, ritual):
    r = rng(5)
    g = C.new(W, H)
    xx, yy = C.grid(W, H)
    # forest floor: flat low-frequency patches (bg1 / forest / earth), no flagstones, no dithering
    base = tone_field(51, 40, [0.4, 0.78], ["bg1", "forest", "earth"])
    # moon pool: a flat lighter clearing at the centre (fog), patches around it
    cx, cy = L.HERO_SPAWN
    e = ((xx - cx) / 150) ** 2 + ((yy - cy) / 96) ** 2
    pool_noise = C.value_noise(W, H, 28, rng(52))
    edge_only = np.clip((e - 0.35) / 0.3, 0, 1)  # irregular rim, smooth flat inside (no holes)
    pool = e + (pool_noise - 0.5) * 0.35 * edge_only < 0.62
    base[pool] = C.ci("fog")
    rim = (~pool) & (e < 0.95) & (base == C.ci("bg1"))
    base[rim] = C.ci("forest")
    base = majority(base, 2, 1)
    # the region the ground covers: arena + an irregular soft band outside it
    edge_noise = (C.value_noise(W, H, 12, rng(53)) - 0.5) * 6
    dx = np.maximum(0, np.maximum(AX0 - xx, xx - AX1))
    dy = np.maximum(0, np.maximum(AY0 - yy, yy - AY1))
    din = np.minimum.reduce([xx - AX0, AX1 - xx, yy - AY0, AY1 - yy])  # > 0 inside the rectangle
    sd = np.where(din > 0, -din, np.maximum(dx, dy))  # signed distance to the rectangle edge
    cover = sd + edge_noise < L.EDGE_BAND
    g[cover] = base[cover]
    # just outside the rectangle the ground is darker (so the clamp reads): flat bg0/bg1 patches, irregular rim
    band = cover & (sd + edge_noise * 0.5 > 0.5)
    dark = tone_field(54, 16, [0.5], ["bg0", "bg1"])
    g[band] = dark[band]
    # sparse tiny low-contrast details outside the calm zone: leaves, ferns, needles, thin roots
    for _ in range(70):
        x, y = int(r.uniform(AX0 + 2, AX1 - 4)), int(r.uniform(AY0 + 2, AY1 - 4))
        if CZ[0] - 4 <= x <= CZ[2] + 4 and CZ[1] - 4 <= y <= CZ[3] + 4:
            continue
        t = g[y, x]
        k = int(r.integers(0, 3))
        col = "earth" if t in (C.ci("forest"), C.ci("bg1")) else "stone_dark"
        if k == 0:  # leaf (3 px)
            for ddx, ddy in ((0, 0), (1, 0), (1, 1)):
                C.put(g, x + ddx, y + ddy, col)
        elif k == 1:  # tiny fern
            for ddx, ddy in ((0, 0), (-1, -1), (1, -1), (0, -1)):
                C.put(g, x + ddx, y + ddy, "forest" if t != C.ci("forest") else "moss")
        else:  # needle speck pair
            C.put(g, x, y, col)
            C.put(g, x + 2, y + 1, col)
    # ritual inlay at the centre: carved rings + rune slots in a tone of nearly equal lightness (calm)
    d = np.sqrt((xx - L.RITUAL_CENTER[0]) ** 2 + (yy - L.RITUAL_CENTER[1]) ** 2)
    for rr in (L.RITUAL_RADIUS, L.RITUAL_RADIUS - 24):
        g[(np.abs(d - rr) < 0.55) & pool] = C.ci("earth")
    for (rx, ry) in ritual:
        g[np.sqrt((xx - rx) ** 2 + (yy - ry) ** 2) <= 5.2] = C.ci("earth")
    # giant tree roots: flat ground decals spreading from the trunk (<= 36 px toward the centre, <= 48 elsewhere)
    gx_, gy_ = L.GIANT_TREE
    for ang, ln, w_ in ((3.0, 34, 3), (2.45, 36, 3), (1.9, 30, 2), (1.25, 44, 3), (0.75, 46, 3), (0.2, 40, 2), (-0.3, 30, 2)):
        x1, y1 = gx_ + math.cos(ang) * ln, gy_ + math.sin(ang) * ln * 0.55
        if x1 < CZ[2] + 1:
            x1 = CZ[2] + 1
        for k in range(w_):
            C.line(g, gx_ + math.cos(ang) * 22, gy_ + k - 1, x1, y1 + k - 1, "earth" if k < w_ - 1 else "bg1")
    # soft edge inside the rectangle: a few flat moss pads, thin roots and half-buried broken ring stones
    for _ in range(14):
        side = int(r.integers(0, 4))
        t = r.uniform(0.05, 0.95)
        x = int(AX0 + t * (AX1 - AX0)) if side < 2 else (AX0 + 3 if side == 2 else AX1 - 8)
        y = int(AY0 + 2 if side == 0 else AY1 - 6) if side < 2 else int(AY0 + t * (AY1 - AY0))
        if any(math.dist((x, y), L.hollow_point(s_, p_)) < 22 for s_, p_ in L.HOLLOWS):
            continue
        g[y:y + 4, x:x + 6] = C.ci("forest")
    for _ in range(10):
        side = int(r.integers(0, 4))
        t = r.uniform(0.08, 0.92)
        x = int(AX0 + t * (AX1 - AX0)) if side < 2 else (AX0 + 2 if side == 2 else AX1 - 7)
        y = int(AY0 + 2 if side == 0 else AY1 - 4) if side < 2 else int(AY0 + t * (AY1 - AY0))
        if any(math.dist((x, y), L.hollow_point(s_, p_)) < 22 for s_, p_ in L.HOLLOWS):
            continue
        g[y:y + 3, x:x + 6] = C.ci("stone_dark")  # half-buried ring stone
        g[y, x + 1:x + 4] = C.ci("stone")
    # hollows: dark gaps leading into the trees
    for s_, p_ in L.HOLLOWS:
        hx, hy = L.hollow_point(s_, p_)
        m = ((xx - hx) ** 2 + (yy - hy) ** 2 <= 11 ** 2) & cover
        g[m] = C.ci("bg0")
    # flat contact shadows to the lower-right: a small ellipse under each prop's footprint, one tone darker
    sh = np.zeros((H, W), dtype=bool)
    for p in props:
        if p["kind"] == "eyes" or p.get("overlayOf"):
            continue
        spr = sprites[p["sprite"]][p["frame"]]
        foot = np.nonzero((spr[-4:] != C.T).any(axis=0))[0]
        if not len(foot):
            continue
        fx0, fx1 = (p["w"] - 1 - foot.max(), p["w"] - 1 - foot.min()) if p["flip"] else (foot.min(), foot.max())
        cxs = p["x"] + (fx0 + fx1) / 2 + 3
        rx = max(2.5, (fx1 - fx0 + 1) / 2 + 1)
        ry = max(1.5, min(5.0, rx / 3))
        sh |= ((xx - cxs) / rx) ** 2 + ((yy - p["baseY"] - 0.5) / ry) ** 2 <= 1
    sh &= g != C.T
    for src, dst in DARKER_TONE.items():
        g[sh & (g == C.ci(src))] = C.ci(dst)
    return g


# ---------------------------------------------------------------- forest ring (flat silhouettes)

def _forest(seed, trunk_col, count, wmin, wmax, crowns=True, keep_outside=None):
    """Tileable band of solid tree silhouettes in ONE flat tone: wide trunks, a few heavy limbs, rounded crowns."""
    r = rng(seed)
    pad = 64
    big = C.new(W + 2 * pad, H)
    for _ in range(count):
        x = r.uniform(pad, W + pad)
        w = int(r.integers(wmin, wmax + 1))
        lean = r.uniform(-0.05, 0.05)
        for y in range(H):
            xx_ = int(x + (H - y) * lean)
            big[y, xx_ - w // 2:xx_ + (w + 1) // 2] = C.ci(trunk_col)
        for _k in range(int(r.integers(1, 3))):
            y0 = r.uniform(10, H - 30)
            side = r.choice([-1, 1])
            ln = r.uniform(12, 26)
            bx = x + (H - y0) * lean + side * w / 2
            for t in range(3):
                C.line(big, bx, y0 + t, bx + side * ln, y0 + t - ln * 0.6, trunk_col)
        if crowns:
            for _k in range(3):
                cy_ = r.uniform(-10, 40)
                C.disc(big, x + r.uniform(-14, 14), cy_, r.uniform(10, 18), trunk_col)
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
    sil = _gap_hollows(_forest(11, "stone_dark", 30, 8, 16), 16)  # hollows stay dark gaps in every layer
    a[sil != C.T] = sil[sil != C.T]
    return a


def forest_mid():
    return _gap_hollows(_forest(12, "bg1", 22, 10, 18), 14)


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
    a = _forest(14, "bg0", 18, 10, 16, crowns=False)
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
