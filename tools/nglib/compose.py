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

def fence_polyline():
    """Author anchors -> px, merge near-duplicates, order by angle around the centroid (closed loop)."""
    pts = [L.pct(p) for p in L.FENCE_ANCHORS_PCT]
    merged = []
    for p in pts:
        for i, q in enumerate(merged):
            if math.dist(p, q[:2]) < L.FENCE_MERGE_DIST:
                n = q[2] + 1
                merged[i] = ((q[0] * q[2] + p[0]) / n, (q[1] * q[2] + p[1]) / n, n)
                break
        else:
            merged.append((p[0], p[1], 1))
    cx = sum(p[0] for p in merged) / len(merged)
    cy = sum(p[1] for p in merged) / len(merged)
    merged.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    return [(round(p[0]), round(p[1])) for p in merged], (cx, cy)


def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def gate_segment(poly, centroid):
    """The bottom-side segment (largest mean y, long enough) where the gate goes."""
    best = None
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if math.dist(a, b) < L.GATE_WIDTH:
            continue
        my = (a[1] + b[1]) / 2
        mx = (a[0] + b[0]) / 2
        score = my - abs(mx - centroid[0]) * 0.3
        if best is None or score > best[0]:
            best = (score, i)
    return best[1]


def boxes_overlap(a, b, pad=0):
    return not (a[2] + pad <= b[0] or b[2] + pad <= a[0] or a[3] + pad <= b[1] or b[3] + pad <= a[1])


def box_hits_circle(box, cx, cy, r):
    nx = min(max(cx, box[0]), box[2])
    ny = min(max(cy, box[1]), box[3])
    return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r


def in_calm(box):
    return boxes_overlap(box, CZ)


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


def place_all(sprites):
    from . import landmarks as LM

    P = Placer(sprites)
    poly, centroid = fence_polyline()
    altar_c = L.pct(L.PORTAL_ALTAR_PCT)
    notes = []

    # 1. portal altar first (graveyard far end)
    ah, aw = sprites["portal_altar"][0].shape
    altar = P.add("portal_altar", altar_c[0], altar_c[1] - LM.ALTAR_CENTER[1] + ah, kind="landmark", force=True)
    # the altar's dais centre must sit on the anchor
    altar["x"] = altar_c[0] - LM.ALTAR_CENTER[0]
    altar["y"] = altar_c[1] - LM.ALTAR_CENTER[1]
    altar["baseY"] = altar["y"] + ah
    P.boxes[-1] = (altar["x"], altar["y"], altar["x"] + aw, altar["y"] + ah)
    for i, (bx, by) in enumerate(LM.BRAZIERS):
        P.overlay(altar, "altar_flame", bx, by, "altar_flame")
    for cx_, cy_ in LM.CHAINS:
        P.overlay(altar, "altar_chain", cx_, cy_, "altar_chain")
    portal_clear = (altar_c[0], altar_c[1], L.PORTAL_CLEAR_RADIUS)
    altar_foot = (altar["x"], altar["y"] + 12, altar["x"] + aw, altar["y"] + ah)  # dais + pillars' ground area

    # 2. landmarks
    lm = L.LANDMARKS
    sx, sy = lm["rune_sword"]
    base = P.add("rune_sword_base", sx, sy + 30, kind="landmark", force=True)
    sw = P.add("rune_sword", sx, sy + 26, kind="landmark", anim="rune_sword", force=True)
    gx, gy = lm["gallows"]
    gal = P.add("gallows_tree", gx, gy + 28, kind="landmark", force=True)
    P.overlay(gal, "gallows_cage", 34, 10, "gallows_cage")
    P.overlay(gal, "crow", 20, 2, "crow")
    P.overlay(gal, "crow", 38, 2, "crow")
    wx, wy = lm["hunter_wagon"]
    P.add("hunter_wagon", wx, wy + 16, kind="landmark", anim="hunter_wagon", force=True)
    P.add("horse_skeleton", wx + 6, wy + 30, kind="landmark", flip=True)
    kx, ky = lm["cursed_well"]
    well = P.add("cursed_well", kx, ky + 12, kind="landmark", force=True)
    P.overlay(well, "well_wisp", 6, -9, "well_wisp")
    P.add("beast_ribcage", kx + 4, ky + 52, kind="landmark", force=True)
    hx, hy = lm["hunter_cabin"]
    cab = P.add("hunter_cabin", hx, hy + 28, kind="landmark", force=True)
    P.overlay(cab, "cabin_window", LM.CABIN_WINDOW_AT[0], LM.CABIN_WINDOW_AT[1], "cabin_window")
    P.overlay(cab, "cabin_smoke", LM.CABIN_SMOKE_AT[0], LM.CABIN_SMOKE_AT[1], "cabin_smoke", base_bias=-1)
    # workshop props in front of the cabin
    for name, dx, dy in (("workbench_0", 22, 30), ("weapon_rack_0", 40, 22), ("crate_0", 10, 34), ("crate_1", 32, 36),
                         ("gas_lamp_1", 48, 34)):
        P.add(name, hx + dx, hy + dy, kind="decor", shade=0)
    # field of fallen hunters' weapons around the rune sword
    r = rng(1)
    for name in ("weapon_sword_0", "weapon_spear_0", "weapon_halberd_0", "weapon_sword_1", "weapon_spear_1", "helmet_0"):
        for _ in range(30):
            ang = r.uniform(0, 2 * math.pi)
            d = r.uniform(26, 40)
            if P.add(name, sx + math.cos(ang) * d, sy + 32 + math.sin(ang) * d * 0.6, flip=bool(r.integers(0, 2)),
                     shade=int(r.integers(0, 2))):
                break

    # 3. graveyard fence: runs between consecutive anchors, stone posts at anchors, gate on the bottom side
    gate_i = gate_segment(poly, centroid)
    fence_runs = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if i == gate_i:
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            d = math.dist(a, b)
            ux, uy = (b[0] - a[0]) / d, (b[1] - a[1]) / d
            g0 = (mx - ux * L.GATE_WIDTH / 2, my - uy * L.GATE_WIDTH / 2)
            g1 = (mx + ux * L.GATE_WIDTH / 2, my + uy * L.GATE_WIDTH / 2)
            fence_runs += [(a, g0, i), (g1, b, i)]
            gate = P.add("fence_gate_0", mx, my + 2, kind="fence", force=True)
            for side in (-1, 1):
                P.add("gas_lamp_0", mx + side * (L.GATE_WIDTH / 2 + 7), my + 4, kind="decor", flip=side > 0)
            gate_pt = (mx, my)
        else:
            fence_runs.append((a, b, i))
    run_names = []
    for k, (a, b, seg) in enumerate(fence_runs):
        if math.dist(a, b) < 3:
            continue
        run_names.append((f"fence_run_{len(run_names):02d}", a, b, seg))
    # stone posts with finials roughly every 6 pickets (~18 px) along the fence, plus every sharp corner
    walked = 0.0
    for i in range(len(poly)):
        a_, b_ = poly[i], poly[(i + 1) % len(poly)]
        seg_len = math.dist(a_, b_)
        if i == gate_i:
            walked = 0.0
            continue
        t = 0.0
        while t <= seg_len:
            if walked >= 18 or t == 0.0 and walked == 0.0:
                px_ = a_[0] + (b_[0] - a_[0]) * t / max(seg_len, 1e-9)
                py_ = a_[1] + (b_[1] - a_[1]) * t / max(seg_len, 1e-9)
                P.add(f"fence_post_{int(px_ + py_) % 2}", px_, py_ + 2, kind="fence", force=True)
                walked = 0.0
            step = min(3.0, seg_len - t) if seg_len - t > 0 else 3.0
            t += 3.0
            walked += 3.0
    for gx_, gy_ in (poly[gate_i], poly[(gate_i + 1) % len(poly)]):  # posts flanking the gate
        P.add("fence_post_0", gx_, gy_ + 2, kind="fence", force=True)

    # 4. gravestones: loose seeded rows inside the polygon, away from the altar, the path and the fence
    r = rng(2)
    variants = [f"grave_intact_{i}" for i in range(5)] + [f"grave_broken_{i}" for i in range(3)] + \
               [f"grave_cross_{i}" for i in range(3)] + [f"grave_slab_{i}" for i in range(2)]
    target = int(r.integers(L.GRAVESTONES[0], L.GRAVESTONES[1] + 1))
    ys = [y for y in range(int(min(p[1] for p in poly)) + 10, int(max(p[1] for p in poly)) + 2, 13)]
    cands = []
    ys = list(range(int(min(p[1] for p in poly)) + 8, int(max(p[1] for p in poly)) + 2, 8))
    for y in ys:
        for x in range(int(min(p[0] for p in poly)) + 3, int(max(p[0] for p in poly)) - 1, 7):
            cands.append((x + r.uniform(-2, 2), y + r.uniform(-1.5, 1.5)))
    r.shuffle(cands)
    placed = []
    path_line = (gate_pt, (altar_c[0], altar_c[1] + 12))

    def near_path(x, y):
        (x0, y0), (x1, y1) = path_line
        t = max(0, min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)))
        return math.dist((x, y), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) < 6

    def edge_dist(x, y):
        best = 1e9
        for i in range(len(poly)):
            (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
            l2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 or 1
            t = max(0, min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / l2))
            best = min(best, math.dist((x, y), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)))
        return best

    for x, y in cands:
        if len(placed) >= target:
            break
        if not point_in_poly(x, y, poly) or near_path(x, y) or edge_dist(x, y) < 3:
            continue
        # loose rows: graves may overlap in depth (3/4 view, y-sorted), but their bases keep >= 9 px apart
        if any(math.dist((px, py), (x, y)) < 9 for px, py, _v in placed):
            continue
        neigh = [v for (px, py, v) in placed if math.dist((px, py), (x, y)) < 22]
        choices = [v for v in variants if v not in neigh]
        v = choices[int(r.integers(0, len(choices)))]
        box = P.box_for(v, x, y)
        foot = (box[0], box[3] - 4, box[2], box[3])  # ground footprint (3/4 view)
        if box_hits_circle(foot, *portal_clear) or boxes_overlap(foot, altar_foot, 1):
            continue
        # inside the fence the author's anchors win over the calm zone and the generic spacing rule
        if P.add(v, x, y, flip=bool(r.integers(0, 2)), shade=int(r.integers(0, 2)), kind="grave", force=True):
            placed.append((x, y, v))
    if len(placed) < L.GRAVESTONES[0]:
        notes.append(f"only {len(placed)} gravestones fit (target {target})")
    # small graveyard clutter
    for name in ("bone_pile_0", "skull_0", "grass_1", "mushroom_0", "candle_0", "candle_1", "grass_3", "bone_pile_2",
                 "skull_1", "leaves_1", "mushroom_1", "grass_0"):
        for _ in range(40):
            x, y = r.uniform(80, 165), r.uniform(55, 140)
            b_ = P.box_for(name, x, y)
            if point_in_poly(x, y, poly) and not box_hits_circle((b_[0], b_[3] - 3, b_[2], b_[3]), *portal_clear):
                if P.add(name, x, y, flip=bool(r.integers(0, 2)), shade=int(r.integers(0, 2)), kind="decor"):
                    break

    # 5. author's dead trees (authoritative anchors; small variants inside the calm zone)
    for k, a in enumerate(L.DEAD_TREES_PCT):
        x, y = L.pct(a)
        v = f"tree_{k % 4}"
        box = P.box_for(v, x, y)
        if in_calm(box):
            v = "tree_0"
            notes.append(f"author tree at ({x},{y}) lies in the calm zone: kept (authoritative), smallest variant")
        P.add(v, x, y, flip=bool(k % 2), shade=k % 2, kind="tree", force=True)

    # 6. open-field scatter (Poisson-like dart throwing with min spacing)
    r = rng(3)
    field_kinds = (["bone_pile_%d" % i for i in range(4)] + ["skull_0", "skull_1"] + ["grass_%d" % i for i in range(4)] * 2 +
                   ["bramble_%d" % i for i in range(3)] + ["stone_%d" % i for i in range(4)] * 2 +
                   ["leaves_%d" % i for i in range(3)] + ["mushroom_0", "mushroom_1", "candle_0", "helmet_0"])
    area = (AX1 - AX0) * (AY1 - AY0)
    n_field = int(area / 10000 * L.FIELD_DENSITY)
    pts = []
    for _ in range(n_field * 30):
        if len(pts) >= n_field:
            break
        x, y = r.uniform(AX0 + 6, AX1 - 6), r.uniform(AY0 + 10, AY1 - 2)
        if point_in_poly(x, y, poly) or any(math.dist((x, y), q) < L.FIELD_MIN_SPACING for q in pts):
            continue
        name = field_kinds[int(r.integers(0, len(field_kinds)))]
        if P.add(name, x, y, flip=bool(r.integers(0, 2)), shade=int(r.integers(0, 2))):
            pts.append((x, y))
    # 7. forest edge: brambles, grass, stones hugging the curb (never in hollows)
    hollow_pts = [L.hollow_point(s, p) for s, p in L.HOLLOWS]
    n_edge = int((2 * (AX1 - AX0) + 2 * (AY1 - AY0)) * 12 / 10000 * L.FOREST_EDGE_DENSITY)
    edge_kinds = ["bramble_0", "bramble_1", "bramble_2", "grass_2", "grass_3", "stone_1", "stone_2", "leaves_0", "root_0"]
    for _ in range(n_edge * 20):
        side = int(r.integers(0, 4))
        if side == 0:
            x, y = r.uniform(AX0, AX1), AY0 + r.uniform(8, 14)
        elif side == 1:
            x, y = r.uniform(AX0, AX1), AY1 - r.uniform(0, 4)
        elif side == 2:
            x, y = AX0 + r.uniform(3, 10), r.uniform(AY0 + 8, AY1)
        else:
            x, y = AX1 - r.uniform(3, 10), r.uniform(AY0 + 8, AY1)
        if any(math.dist((x, y), h) < L.HOLLOW_WIDTH for h in hollow_pts) or point_in_poly(x, y, poly):
            continue
        name = edge_kinds[int(r.integers(0, len(edge_kinds)))]
        P.add(name, x, y, flip=bool(r.integers(0, 2)), shade=int(r.integers(0, 2)))
    # 8. large forest trees just outside the curb corners (in the forest, not in the arena)
    for k, (x, y) in enumerate(((22, 70), (458, 120), (24, 268), (456, 268))):
        P.add(f"tree_large_{k % 2}", x, y, flip=bool(k % 2), shade=k // 2, kind="forest", force=True)
    # 9. ambient eye pairs in the dark gaps of the forest (violet_dark at rest; exception group)
    r = rng(4)
    eyes = 0
    for _ in range(200):
        if eyes >= L.AMBIENT_EYES:
            break
        side = int(r.integers(0, 4))
        x = r.uniform(4, AX0 - 14) if side == 0 else (r.uniform(AX1 + 14, W - 4) if side == 1 else r.uniform(60, 420))
        y = r.uniform(30, 240) if side < 2 else (r.uniform(4, AY0 - 10) if side == 2 else r.uniform(AY1 + 8, H - 4))
        if P.add("forest_eyes", x, y, kind="eyes"):
            eyes += 1
    return P, poly, run_names, gate_pt, notes


# ---------------------------------------------------------------- fence runs (composite sprites)

def fence_run_sprite(a, b, seg):
    """Pickets every 3 px along a polyline segment, rails, rust; style varies per segment (straight/broken/leaning)."""
    from .decor import picket
    x0, y0 = a
    x1, y1 = b
    minx, maxx = int(min(x0, x1)) - 2, int(max(x0, x1)) + 3
    miny, maxy = int(min(y0, y1)) - 15, int(max(y0, y1)) + 2
    w, h = maxx - minx, maxy - miny
    s = C.new(max(4, w), max(4, h))
    length = math.dist(a, b)
    style = ("straight", "straight", "broken", "straight", "leaning")[seg % 5]
    n = max(1, int(length // 3))
    for k in range(n + 1):
        t = k / max(1, n)
        px = x0 + (x1 - x0) * t - minx
        py = y0 + (y1 - y0) * t - miny
        if style == "broken" and 0.4 < t < 0.65:
            if k % 2 == 0:
                C.put(s, int(px), int(py), "stone_dark")  # fallen bits
            continue
        lean = int(t * 3) if style == "leaning" else 0
        picket(s, int(px), int(py), 11, bent=lean)
        C.put(s, int(px), int(py) - 2, "stone_dark")
        C.put(s, int(px) + 1, int(py) - 2, "stone_dark")
        C.put(s, int(px), int(py) - 8, "stone_dark")
        C.put(s, int(px) + 1, int(py) - 8, "stone_dark")
    return C.moonlit(s), (minx, miny), int(max(y0, y1))


# ---------------------------------------------------------------- ground

def ground(sprites, pieces, decals_, props, poly, gate_pt, ritual):
    r = rng(5)
    g = C.new(W, H)
    flags = [pieces[f"flagstone_{i}"][0] for i in range(4)]
    dirts = [pieces[f"dirt_{i}"][0] for i in range(3)]
    trans = [pieces[f"transition_{i}"][0] for i in range(4)]
    noise = C.value_noise(W, H, 48, r)
    cols, rows = (AX1 - AX0) // 16, (AY1 - AY0 + 15) // 16
    kind = np.zeros((rows, cols), dtype=int)
    for j in range(rows):
        for i in range(cols):
            x, y = AX0 + i * 16 + 8, AY0 + j * 16 + 8
            kind[j, i] = 1 if noise[min(y, H - 1), x] > 0.46 or point_in_poly(x, y, poly) else 0
    for j in range(rows):
        for i in range(cols):
            x, y = AX0 + i * 16, AY0 + j * 16
            if kind[j, i] == 1:
                tile = dirts[int(r.integers(0, 3))]
            else:
                nb = [(0, -1, 0), (1, 0, 1), (0, 1, 2), (-1, 0, 3)]
                side = next((s for dx, dy, s in nb if 0 <= j + dy < rows and 0 <= i + dx < cols and kind[j + dy, i + dx] == 1), None)
                tile = trans[side] if side is not None and r.random() < 0.7 else flags[int(r.integers(0, 4))]
                if r.random() < 0.5:
                    tile = tile[:, ::-1]
            hh = min(16, AY1 - y)
            g[y:y + hh, x:x + 16] = tile[:hh]
    # moon pool: lighter ground around the centre, dithered falloff (bg1 / earth -> fog)
    xx, yy = C.grid(W, H)
    e = ((xx - L.HERO_SPAWN[0]) / 150) ** 2 + ((yy - L.HERO_SPAWN[1]) / 92) ** 2
    lev = np.clip((1.0 - e) * 1.6, 0, 1)
    lift = C.BAYER4[(yy - 0.5).astype(int) % 4, (xx - 0.5).astype(int) % 4] < lev * 16
    for src, dst in (("bg1", "fog"), ("earth", "fog")):
        g[lift & (g == C.ci(src))] = C.ci(dst)
    # flagstone path from the graveyard gate up to the altar
    ax, ay = L.pct(L.PORTAL_ALTAR_PCT)
    steps = int(math.dist(gate_pt, (ax, ay + 18)) // 6)
    for k in range(steps + 1):
        t = k / max(1, steps)
        px = gate_pt[0] + (ax - gate_pt[0]) * t
        py = gate_pt[1] + (ay + 18 - gate_pt[1]) * t
        g[int(py) - 2:int(py) + 2, int(px) - 3:int(px) + 3] = C.ci("stone_dark")
        g[int(py) - 2, int(px) - 3:int(px) + 3] = C.ci("fog")
    # ritual inlay (rune ring) at the centre: low-contrast carved circles
    cx, cy = L.RITUAL_CENTER
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    for rr in (L.RITUAL_RADIUS, L.RITUAL_RADIUS - 24, 14):
        g[np.abs(d - rr) < 0.55] = C.ci("stone_dark")
    for (rx, ry) in ritual:
        g[(np.sqrt((xx - rx) ** 2 + (yy - ry) ** 2) <= 5.2)] = C.ci("fog")
    # decals (puddles/moss kept out of the calm zone)
    for name, count in L.DECAL_COUNT.items():
        variants = [k for k in decals_ if k.startswith(name + "_")]
        n = 0
        for _ in range(count * 30):
            if n >= count:
                break
            v = variants[int(r.integers(0, len(variants)))]
            d_ = decals_[v][0]
            h_, w_ = d_.shape
            x = int(r.uniform(AX0, AX1 - w_))
            y = int(r.uniform(AY0, AY1 - h_))
            box = (x, y, x + w_, y + h_)
            if name in ("puddle", "moss", "bonedust") and in_calm(box):
                continue
            if any(math.dist((x + w_ / 2, y + h_ / 2), q) < 10 for q in ritual):
                continue
            C.paste(g, d_ if r.random() < 0.5 else d_[:, ::-1], x, y)
            n += 1
    # hard dithered prop shadows to the lower-right (moon is top-left)
    sh = np.zeros((H, W), dtype=bool)
    for p in props:
        if p["kind"] in ("eyes",) or p.get("overlayOf"):
            continue
        spr = sprites[p["sprite"]][p["frame"]]
        if p["flip"]:
            spr = spr[:, ::-1]
        m = spr != C.T
        hh, ww = m.shape
        # shadow = silhouette squashed to the lower half, shifted right/down
        foot = np.zeros_like(m)
        foot[hh // 2:, :] = m[hh // 2:, :]
        ox, oy = p["x"] + 3, p["y"] + 2
        y0, x0 = max(0, oy), max(0, ox)
        y1, x1 = min(H, oy + hh), min(W, ox + ww)
        if y1 > y0 and x1 > x0:
            sh[y0:y1, x0:x1] |= foot[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    inside = np.zeros((H, W), dtype=bool)
    inside[AY0:AY1, AX0:AX1] = True
    sh &= inside & C.bayer_mask(W, H, 0.5)
    g[sh] = C.ci("bg0")
    # curb around the rectangle (outside it), broken in places, hollows left open
    curb_s = [pieces[f"curb_straight_{i}"][0] for i in range(3)]
    curb_b = [pieces[f"curb_broken_{i}"][0] for i in range(3)]
    hollows = [L.hollow_point(s, p) for s, p in L.HOLLOWS]
    t = L.CURB_THICKNESS

    def curb_piece():
        return curb_b[int(r.integers(0, 3))] if r.random() < 0.18 else curb_s[int(r.integers(0, 3))]

    for x in range(AX0, AX1, 16):
        for y, flip_v in ((AY0 - t, False), (AY1, True)):
            if any(abs(x + 8 - hx) < L.HOLLOW_WIDTH / 2 + 6 and abs(y + 3 - hy) < 8 for hx, hy in hollows):
                continue
            pc = curb_piece()
            C.paste(g, pc[::-1] if flip_v else pc, x, y)
    for y in range(AY0, AY1, 16):
        for x, flip_h in ((AX0 - t, False), (AX1, True)):
            if any(abs(y + 8 - hy) < L.HOLLOW_WIDTH / 2 + 6 and abs(x + 3 - hx) < 8 for hx, hy in hollows):
                continue
            pc = np.rot90(curb_piece(), k=1)
            C.paste(g, pc[:, ::-1] if flip_h else pc, x, y)
    for cx_, cy_ in ((AX0 - t, AY0 - t), (AX1, AY0 - t), (AX0 - t, AY1), (AX1, AY1)):
        C.paste(g, pieces[f"curb_corner_{(cx_ + cy_) % 2}"][0], cx_, cy_)
    # hollows: dark earth path leading into the trees, roots spilling in
    roots = [decals_.get(f"crack_{i}") for i in range(2)]
    for hx, hy in hollows:
        for k in range(-L.HOLLOW_WIDTH // 2, L.HOLLOW_WIDTH // 2):
            for depth in range(-10, 5):
                if hy in (AY0, AY1):
                    x, y = hx + k, hy + (depth if hy == AY1 else -depth)
                else:
                    x, y = hx + (depth if hx == AX1 else -depth), hy + k
                if 0 <= x < W and 0 <= y < H:
                    g[y, x] = C.ci("bg0") if abs(k) < L.HOLLOW_WIDTH // 2 - 3 or (x + y) % 2 else C.ci("earth")
    # roots creeping over the curb
    root_spr = [sprites[f"root_{i}"][0] for i in range(3)]
    for _ in range(14):
        side = int(r.integers(0, 4))
        spr = root_spr[int(r.integers(0, 3))]
        if side < 2:
            x = int(r.uniform(AX0, AX1 - 16))
            y = AY0 - 8 if side == 0 else AY1 - 1
            if any(abs(x + 8 - hx) < 20 and abs(y - hy) < 12 for hx, hy in hollows):
                continue
            C.paste(g, spr, x, y)
        else:
            spr = np.rot90(spr)
            y = int(r.uniform(AY0, AY1 - 16))
            x = AX0 - 8 if side == 2 else AX1 - 1
            if any(abs(y + 8 - hy) < 20 and abs(x - hx) < 12 for hx, hy in hollows):
                continue
            C.paste(g, spr, x, y)
    return g


# ---------------------------------------------------------------- forest layers

def _forest(seed, trunk_col, rim_col, bg_col, band_col, count, wmin, wmax, branchy=True):
    """Tileable band of tree trunks: solid trunk colour, 1 px moonward rim on the left, a few bare branches,
    and solid fog bands (dithered only on their edges)."""
    r = rng(seed)
    pad = 64
    big = C.new(W + 2 * pad, H)
    if bg_col:
        big[:, :] = C.ci(bg_col)
    for _ in range(count):
        x = r.uniform(pad, W + pad)
        w = int(r.integers(wmin, wmax + 1))
        lean = r.uniform(-0.06, 0.06)
        for y in range(H):
            xx = int(x + (H - y) * lean)
            big[y, xx - w // 2:xx + (w + 1) // 2] = C.ci(trunk_col)
            big[y, xx - w // 2] = C.ci(rim_col)
        if branchy:
            for _k in range(int(r.integers(2, 5))):
                y0 = r.uniform(10, H - 10)
                side = r.choice([-1, 1])
                ln = r.uniform(10, 24)
                bx = x + (H - y0) * lean + side * w / 2
                C.line(big, bx, y0, bx + side * ln, y0 - ln * r.uniform(0.4, 0.9), trunk_col)
                C.line(big, bx, y0 + 1, bx + side * ln * 0.8, y0 + 1 - ln * 0.5, trunk_col)
    out = C.new(W, H)
    for x in range(W + 2 * pad):
        col = big[:, x]
        m = col != C.T
        out[m, (x - pad) % W] = col[m]
    if band_col:
        yy = np.mgrid[0:H, 0:W][0]
        for by in (14, 96, 176, 252):
            out[(yy >= by) & (yy < by + 3)] = C.ci(band_col)
            out[((yy == by - 1) | (yy == by + 3)) & C.bayer_mask(W, H, 0.5)] = C.ci(band_col)
    return out


def forest_far():
    return _forest(11, "stone_dark", "fog", "bg0", "fog", 40, 4, 8)


def forest_mid():
    return _forest(12, "bg1", "stone_dark", None, None, 26, 6, 11)


def forest_near():
    """Overhang ring: black trunks only outside the curb, thin branches reaching <= OVERHANG_MAX px into the arena."""
    r = rng(13)
    a = _forest(14, "bg0", "bg0", None, None, 18, 8, 14, branchy=False)
    keep = np.ones((H, W), dtype=bool)
    m = L.OVERHANG_MAX
    keep[AY0 - L.CURB_THICKNESS:AY1 + L.CURB_THICKNESS, AX0 - L.CURB_THICKNESS:AX1 + L.CURB_THICKNESS] = False
    a[~keep] = C.T
    # thin twigs hanging over the curb into the arena
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
        C.line(a, x0, y0, x0 + dx, y0 + dy, "bg0")
        C.line(a, x0 + dx * 0.6, y0 + dy * 0.6, x0 + dx * 0.6 + r.uniform(-4, 4), y0 + dy * 0.6 + r.uniform(-4, 4), "bg0")
    # hard guarantee: nothing deeper than OVERHANG_MAX into the arena
    a[AY0 + m:AY1 - m, AX0 + m:AX1 - m] = C.T
    return a


def vignette():
    """Darkens the forest toward the screen edges; zero inside the arena + curb so the play field stays calm."""
    xx, yy = C.grid(W, H)
    m = L.CURB_THICKNESS + 3
    dx = np.maximum(0, np.maximum(AX0 - m - xx, xx - (AX1 + m)))
    dy = np.maximum(0, np.maximum(AY0 - m - yy, yy - (AY1 + m)))
    d = np.sqrt(dx * dx + dy * dy)
    level = np.clip(d / 40, 0, 0.6)
    a = C.new(W, H)
    a[C.BAYER4[(yy - 0.5).astype(int) % 4, (xx - 0.5).astype(int) % 4] < level * 16] = C.ci("bg0")
    return a


def fog_overlay():
    r = rng(15)
    s = 256
    n = C.value_noise(s, s, 64, r, wrap=True) * 0.7 + C.value_noise(s, s, 32, r, wrap=True) * 0.3
    level = np.clip((n - 0.6) * 0.8, 0, 0.125)
    yy, xx = np.mgrid[0:s, 0:s]
    a = C.new(s, s)
    a[C.BAYER4[yy % 4, xx % 4] < level * 16] = C.ci("fog")
    return a


def ritual_runes():
    cx, cy = L.RITUAL_CENTER
    out = []
    for k in range(8):
        ang = (k * 45 + 22.5) * math.pi / 180
        out.append((cx + round(math.cos(ang) * L.RUNE_RING_RADIUS), cy + round(math.sin(ang) * L.RUNE_RING_RADIUS)))
    return out
