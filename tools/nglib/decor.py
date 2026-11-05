"""Arena decor variants. Moonlit (cold 1 px rim top-left, dark outline), no reserved colors.

Every placeable prop returns 2 frames: [shade A, shade B] (a darker/weathered swap within the same palette group).
Ground pieces and decals return 1 frame; they are baked into arena_ground.png.
"""
import math

import numpy as np

from . import canvas as C

SHADE_B = {"stone": "stone_dark", "stone_dark": "fog", "moss": "forest", "dry": "earth", "moon": "stone"}


def prop(a, shade_b=None):
    """Finish a prop (v2 softness): a DARKER-shade outline of the fill (never a light rim), plus its shade-B twin."""
    fa = C.outline(a)
    b = C.recolor(a, shade_b or SHADE_B)
    return [fa, C.outline(b)]


def _lit_split(a, frac=0.55):
    """Light from the top-left: within each row, the right part of `stone` becomes stone_dark."""
    out = a.copy()
    for y in range(a.shape[0]):
        xs = np.nonzero(a[y] == C.ci("stone"))[0]
        if len(xs):
            cut = xs.min() + (xs.max() - xs.min() + 1) * frac
            out[y, (np.arange(a.shape[1]) >= cut) & (a[y] == C.ci("stone"))] = C.ci("stone_dark")
    return out


# ---------------------------------------------------------------- gravestones

def _grave(w, h, shape, rng, engrave=True, moss=True, cracks=0):
    xx, yy = C.grid(w, h)
    m = shape(xx, yy, w, h)
    a = C.new(w, h)
    a[m] = C.ci("stone")
    a = _lit_split(a)
    if engrave:
        ys, xs = np.nonzero(m)
        top, bot = ys.min(), ys.max()
        cx = int((xs.min() + xs.max()) / 2)
        for k, ey in enumerate(range(top + 4, bot - 3, 3)):
            half = max(1, int((xs.max() - xs.min()) * (0.28 if k else 0.18)))
            for x in range(cx - half, cx + half):
                if m[ey, x]:
                    a[ey, x] = C.ci("fog")
    for _ in range(cracks):
        x0 = int(rng.integers(1, w - 1))
        y0 = int(rng.integers(1, h // 2))
        for _k in range(int(rng.integers(3, 6))):
            if 0 <= x0 < w and 0 <= y0 < h and m[y0, x0]:
                a[y0, x0] = C.ci("bg0")
            x0 += int(rng.integers(-1, 2))
            y0 += 1
    if moss:
        for x in range(w):
            col = np.nonzero(m[:, x])[0]
            if len(col):
                for y in range(col.max() - int(rng.integers(0, 3)), col.max() + 1):
                    if rng.random() < 0.6:
                        a[y, x] = C.ci("moss")
    return a


def _round_top(r_off=0):
    def f(xx, yy, w, h):
        cx, r = w / 2, w / 2 - 1
        body = (np.abs(xx - cx) <= r) & (yy >= r + 1 + r_off) & (yy <= h - 1)
        cap = ((xx - cx) ** 2 + (yy - r - 1.5 - r_off) ** 2 <= r * r) & (yy >= 1)
        return body | cap
    return f


def _pointed(xx, yy, w, h):
    cx, r = w / 2, w / 2 - 1
    body = (np.abs(xx - cx) <= r) & (yy >= 6) & (yy <= h - 1)
    tip = (np.abs(xx - cx) <= (yy - 1) * r / 5) & (yy >= 1) & (yy < 6)
    return body | tip


def _shoulders(xx, yy, w, h):
    cx = w / 2
    body = (np.abs(xx - cx) <= w / 2 - 1) & (yy >= 5) & (yy <= h - 1)
    head = (np.abs(xx - cx) <= w / 2 - 4) & (yy >= 1)
    return body | (head & (yy <= h - 1))


def _obelisk(xx, yy, w, h):
    cx = w / 2
    taper = (w / 2 - 1) - (h - yy) * 0.06
    shaft = (np.abs(xx - cx) <= taper) & (yy >= 4) & (yy <= h - 1)
    tip = (np.abs(xx - cx) <= (yy - 1) * 0.9) & (yy >= 1) & (yy < 4)
    base = (np.abs(xx - cx) <= w / 2) & (yy >= h - 3) & (yy <= h - 1)
    return shaft | tip | base


def _double_arch(xx, yy, w, h):
    q = w / 4
    body = (xx >= 1) & (xx <= w - 1) & (yy >= q + 2) & (yy <= h - 1)
    l = (xx - q - 0.5) ** 2 + (yy - q - 2) ** 2 <= q * q
    r = (xx - 3 * q + 0.5) ** 2 + (yy - q - 2) ** 2 <= q * q
    return body | ((l | r) & (yy >= 1))


def _cross(arm_y, arm_w, ring=False, lean=0.0):
    def f(xx, yy, w, h):
        cx = w / 2 + lean * (h - yy) / h
        stem = (np.abs(xx - cx) <= 1.6) & (yy >= 1) & (yy <= h - 3)
        arm = (np.abs(xx - cx) <= arm_w) & (np.abs(yy - arm_y) <= 1.2)
        base = (np.abs(xx - w / 2) <= 3.5) & (yy >= h - 3) & (yy <= h - 1)
        m = stem | arm | base
        if ring:
            rr = np.sqrt((xx - cx) ** 2 + (yy - arm_y) ** 2)
            m |= (rr >= 3.2) & (rr <= 4.3)
        return m
    return f


def _broken(kind, rng):
    def f(xx, yy, w, h):
        cx = w / 2
        body = (np.abs(xx - cx) <= w / 2 - 1) & (yy <= h - 1)
        top = np.zeros_like(body)
        jag = [int(rng.integers(2, 6)) + (3 if kind == 1 and x > w / 2 else 0) for x in range(w)]
        for x in range(w):
            top[:, x] = yy[:, x] >= jag[x]
        m = body & top
        if kind == 2:  # leaning: shear
            out = np.zeros_like(m)
            for y in range(h):
                sh = int((h - y) * 0.18)
                out[y, sh:] = m[y, :w - sh] if sh else m[y]
            m = out
        return m
    return f


def gravestones():
    rng = np.random.default_rng(101)
    out = {}
    intact = [(14, 20, _round_top()), (12, 18, _pointed), (16, 18, _shoulders), (10, 22, _obelisk), (16, 20, _double_arch)]
    for i, (w, h, sh) in enumerate(intact):
        out[f"grave_intact_{i}"] = prop(_grave(w, h, sh, rng, cracks=i % 2))
    for i, (w, h) in enumerate([(12, 14), (14, 12), (12, 18)]):
        out[f"grave_broken_{i}"] = prop(_grave(w, h, _broken(i, rng), rng, engrave=i != 1, cracks=2))
    for i, (w, h, f) in enumerate([(12, 20, _cross(6, 4.5)), (14, 20, _cross(6, 5.5, ring=True)), (12, 18, _cross(6, 4.0, lean=3.0))]):
        out[f"grave_cross_{i}"] = prop(_grave(w, h, f, rng, engrave=False))
    for i, (w, h, sh) in enumerate([(14, 18, _round_top()), (12, 16, _pointed)]):  # half-sunk in a moss mound
        a = _grave(w, h, sh, rng, cracks=1, moss=False)
        xx, yy = C.grid(w, h)
        mound = ((xx - w / 2) / (w / 2 + 1)) ** 2 + ((yy - h) / (h * 0.45)) ** 2 <= 1
        a[mound & (a != C.T)] = C.ci("moss")
        a[mound & (a == C.T) & (yy > h * 0.75)] = C.ci("moss")
        out[f"grave_sunk_{i}"] = prop(a)
    for i, (w, h) in enumerate([(18, 10), (20, 12)]):
        a = C.new(w, h)
        a[1:h - 1, 1:w - 1] = C.ci("stone_dark")
        a[1, 1:w - 1] = C.ci("stone")
        a[1:h - 1, 1] = C.ci("stone")
        for x in range(4, w - 4):
            a[h // 2, x] = C.ci("fog")
        if i == 1:
            C.line(a, 3, 2, w - 6, h - 3, "bg0")
        for x in range(2, w - 2, 3):
            if rng.random() < 0.5:
                a[h - 2, x] = C.ci("moss")
        out[f"grave_slab_{i}"] = prop(a)
    return out


# ---------------------------------------------------------------- trees

def _dead_tree(w, h, seed, spread, trunk=3, depth=4, twist=0.0):
    """Gnarled dead tree: short kinked trunk, a wide crown of forking branches (earth, dry highlight on the left)."""
    rng = np.random.default_rng(seed)
    a = C.new(w, h)

    def branch(x, y, ang, length, thick, d):
        x1 = x + math.cos(ang) * length
        y1 = y + math.sin(ang) * length
        for t in range(thick):
            C.line(a, x + t - thick // 2, y, x1 + t - thick // 2, y1, "dry" if t == 0 and thick > 1 else "earth")
        if d > 0:
            n = 3 if d == depth else 2
            for k in range(n):
                da = (k - (n - 1) / 2) * spread * (1.25 if d == depth else 1.0) + rng.uniform(-0.25, 0.25) + twist * 0.5
                branch(x1, y1, ang + da, length * rng.uniform(0.68, 0.86), max(1, thick - 1), d - 1)
        else:
            C.put(a, int(x1 + math.cos(ang) * 1.5), int(y1 + math.sin(ang) * 1.5), "earth")  # twig tip

    kink = rng.uniform(-0.2, 0.2) + twist
    base_x = w / 2
    seg = h * 0.2
    mid_x = base_x + math.cos(-math.pi / 2 + kink) * seg
    mid_y = h - 2 + math.sin(-math.pi / 2 + kink) * seg
    for t in range(trunk):
        C.line(a, base_x + t - trunk // 2, h - 2, mid_x + t - trunk // 2, mid_y, "dry" if t == 0 else "earth")
    branch(mid_x, mid_y, -math.pi / 2 - kink * 0.5, h * 0.2, trunk, depth)
    for x in range(int(base_x) - trunk, int(base_x) + trunk + 1):  # root flare
        C.put(a, x, h - 2, "earth")
    C.put(a, int(base_x) - trunk - 1, h - 1, "earth")
    C.put(a, int(base_x) + trunk + 1, h - 1, "earth")
    return a


def trees():
    out = {}
    specs = [(26, 32, 7, 0.55), (30, 36, 21, 0.5), (34, 40, 33, 0.6), (28, 34, 47, 0.52)]
    for i, (w, h, seed, sp) in enumerate(specs):
        out[f"tree_{i}"] = prop(_dead_tree(w, h, seed, sp), {"dry": "earth", "earth": "bg0"})
    for i, (seed, tw) in enumerate([(91, 0.12), (93, -0.15)]):
        out[f"tree_large_{i}"] = prop(_dead_tree(56, 64, seed, 0.5, trunk=4, depth=5, twist=tw), {"dry": "earth", "earth": "bg0"})
    return out


# ---------------------------------------------------------------- small decor

def _ascii_prop(rows, legend, shade_b=None):
    return prop(C.from_ascii(rows, legend), shade_b)


# v2 value hierarchy: props are mid-dark, so old bones read as dry/earth, never bone-bright; no moon in decor
BONE = {"B": "dry", "D": "earth", "K": "bg0", "S": "stone", "s": "stone_dark", "E": "earth", "M": "moss", "F": "forest",
        "m": "stone", "f": "fog"}


def small_decor():
    out = {}
    bones = [
        ["..........", ".BB....B..", "..BBDBBB..", ".B.DD..BB.", ".........."],
        ["..........", "...B..BB..", ".BBBBBB.B.", "..DD.DD...", ".........."],
        ["..........", "..BB.B....", ".B.BBBBD..", "...DD.BB..", ".........."],
        ["..........", "....BBB...", "..BBDDBB..", ".BDD..DB..", ".........."],
    ]
    for i, r in enumerate(bones):
        out[f"bone_pile_{i}"] = _ascii_prop(r, BONE, {"dry": "earth", "earth": "bg1"})
    skulls = [[".......", "..BBB..", ".BBBBB.", ".BKBKB.", "..BDB..", "......."],
              [".......", ".BBBB..", "BBBBBB.", "BKBBKB.", ".BDDB..", "......."]]
    for i, r in enumerate(skulls):
        out[f"skull_{i}"] = _ascii_prop(r, BONE, {"dry": "earth"})
    grass = [
        ["........", "..D...D.", ".D.D.D..", "..DDDD..", ".EEEEE..", "........"],
        ["........", ".D..D...", "..D.D.D.", ".DDDDD..", "..EEE...", "........"],
        ["........", "...D....", ".D.DD.D.", "..DDDDD.", ".EEEEE..", "........"],
        ["........", "D..D..D.", ".D.D.D..", ".DDDDDD.", "EEEEEEE.", "........"],
    ]
    for i, r in enumerate(grass):
        out[f"grass_{i}"] = _ascii_prop(r, BONE, {"dry": "earth", "earth": "bg0"})
    rng = np.random.default_rng(303)
    for i in range(3):  # thorny brambles: tangled dark stems + dry thorns
        a = C.new(14, 8)
        for _ in range(5):
            x0, y0 = rng.uniform(1, 13), rng.uniform(3, 7)
            x1, y1 = x0 + rng.uniform(-6, 6), rng.uniform(1, 7)
            C.line(a, x0, y0, x1, y1, "forest")
        for _ in range(6):
            x, y = int(rng.integers(1, 13)), int(rng.integers(1, 7))
            if a[y, x] != C.T:
                C.put(a, x, y - 1, "dry")
        out[f"bramble_{i}"] = prop(a, {"forest": "bg0", "dry": "earth"})
    stones = [
        ["......", ".SSs..", ".SSss.", "......"],
        [".......", "..SS...", ".SSss..", ".Sssss.", "......."],
        ["........", ".SSS....", ".SSsss..", "..ssss..", "........"],
        ["....", ".Ss.", "....", ],
    ]
    for i, r in enumerate(stones):
        out[f"stone_{i}"] = _ascii_prop(r, BONE)
    for i in range(3):  # roots: twisting earth lines with dry highlights
        a = C.new(16, 8)
        y = 3 + i % 2
        for x in range(1, 15):
            y = int(np.clip(y + rng.integers(-1, 2), 1, 6))
            C.put(a, x, y, "earth")
            if x % 4 == i:
                C.put(a, x, y - 1, "dry")
            if x % 5 == 0:
                C.line(a, x, y, x + 2, min(7, y + 2), "earth")
        out[f"root_{i}"] = prop(a, {"earth": "bg0", "dry": "earth"})
    leaves = [
        ["........", ".D...E..", "..E.D...", ".D..E.D.", "...D....", "........"],
        ["........", "..DD....", ".E..D.E.", "...E.D..", ".D......", "........"],
        ["........", ".E.D....", "...D..D.", ".D..E...", "..E..D..", "........"],
    ]
    for i, r in enumerate(leaves):
        out[f"leaves_{i}"] = [C.from_ascii(r, BONE), C.from_ascii(r, {**BONE, "D": "earth", "E": "bg1"})]
    mush = [["......", ".mmm..", "mmmmm.", "..B...", "..B...", "......"],
            [".......", ".mm.mm.", "mmmmmmm", ".B...B.", ".B...B.", "......."]]
    for i, r in enumerate(mush):
        out[f"mushroom_{i}"] = _ascii_prop(r, BONE, {"stone": "stone_dark", "dry": "earth"})
    return out


# ---------------------------------------------------------------- iron fence, lamps, weapons

def picket(a, x, base_y, height, bent=0, rust=True, tip=True):
    """One wrought-iron picket: dark bar, spear tip with a moon glint, rust (dry/earth) on its lower part."""
    for k in range(height):
        y = base_y - k
        xx = x + (bent * k) // max(1, height)
        col = "stone_dark"
        if rust and k < 3:
            col = "dry" if k == 1 else "earth"
        C.put(a, xx, y, col)
    if tip:
        tx = x + bent
        ty = base_y - height
        C.put(a, tx, ty, "stone")
        C.put(a, tx - 1, ty + 1, "stone_dark")
        C.put(a, tx + 1, ty + 1, "stone_dark")


def rails(a, x0, x1, y0, y1, h):
    for x in range(x0, x1 + 1):
        t = (x - x0) / max(1, x1 - x0)
        by = int(round(y0 + (y1 - y0) * t))
        C.put(a, x, by - 2, "stone_dark")
        C.put(a, x, by - h + 3, "stone_dark")


def _fence_piece(w, h, kind, seed):
    rng = np.random.default_rng(seed)
    a = C.new(w, h)
    base = h - 1
    gap = range(9, 15) if kind == "broken" else range(0)
    for x in range(1, w - 1, 3):
        if x in gap:
            continue
        lean = (x * 4) // w if kind == "leaning" else 0
        bent = int(rng.integers(-2, 3)) if kind == "broken" and abs(x - 12) < 6 else 0
        picket(a, x + lean, base, h - 3 - (2 if kind == "broken" and x in (6, 18) else 0), bent=bent)
    for x in range(1, w - 1):
        if x in gap:
            continue
        lean = (x * 4) // w if kind == "leaning" else 0
        C.put(a, x + lean if kind == "leaning" else x, base - 2, "stone_dark")
        C.put(a, x + lean if kind == "leaning" else x, base - h + 6, "stone_dark")
    if kind == "broken":
        C.line(a, 9, base, 15, base - 2, "stone_dark")  # fallen bar
    return a


def stone_post(h, finial):
    a = C.new(6, h)
    a[3:h - 1, 1:5] = C.ci("stone")
    a[3:h - 1, 3:5] = C.ci("stone_dark")
    a[2, 1:5] = C.ci("stone")
    if finial == 0:
        a[0:2, 2:4] = C.ci("stone")
    else:
        a[1, 2:4] = C.ci("stone")
        a[0, 2] = C.ci("stone")
    for y in range(h - 5, h - 1):
        a[y, 1] = C.ci("moss")
    a[h - 6, 4] = C.ci("moss")
    return a


def fence_pieces():
    """v2: no fenced graveyard, only 2-3 short broken fragments (1-3 pickets), very low contrast."""
    out = {}
    for i, (n, lean) in enumerate(((3, 0), (2, 1), (1, 0))):
        a = C.new(4 + n * 3, 14)
        for k in range(n):
            x = 2 + k * 3
            h = 10 - (k * 3 + i) % 4
            for y in range(13 - h, 13):
                C.put(a, x + ((13 - y) * lean) // 8, y, "fog")
            C.put(a, x + (h * lean) // 8, 12 - h, "stone_dark")  # dull spear tip
        if n > 1:
            for x in range(2, 2 + (n - 1) * 3 + 1):
                C.put(a, x, 8, "fog")
        for x in range(1, a.shape[1] - 1):
            C.put(a, x, 13, "moss")
        out[f"fence_frag_{i}"] = prop(a, {"fog": "stone_dark", "stone_dark": "bg1", "moss": "forest"})
    return out


def lamps_candles_weapons():
    out = {}
    for i in range(2):  # unlit gas lamp posts: intact / bent
        a = C.new(12, 28)
        for y in range(8, 27):
            x = 5 + (max(0, 14 - y) // 3 if i == 1 else 0)
            C.put(a, x, y, "stone_dark")
            C.put(a, x + 1, y, "stone_dark" if y % 4 else "stone")
        hx = 5 + (4 if i == 1 else 0)
        a[3:8, hx - 2:hx + 3] = C.ci("stone_dark")
        a[4:7, hx - 1:hx + 2] = C.ci("fog")
        C.put(a, hx - 1, 4, "stone")  # glass glint, unlit (mid tone)
        a[2, hx - 1:hx + 2] = C.ci("stone")
        a[26, 3:9] = C.ci("stone")
        out[f"gas_lamp_{i}"] = prop(a)
    for i, rows in enumerate([[".K.", ".B.", ".B.", ".B.", "DDD"], [".K..", ".BB.", ".BB.", "DDDD"]]):
        out[f"candle_{i}"] = _ascii_prop(rows, BONE, {"dry": "earth", "earth": "bg1"})
    weapons = {
        "weapon_sword_0": ["..m..", "..S..", "..S..", "..S..", "..S..", "..S..", "..S..", "..S..", ".sSs.", "sssss", "..E..", "..E..", "..D..", "..E.."],
        "weapon_sword_1": ["..m.", "..S.", ".SS.", "..S.", "..S.", "sSss", "..E.", "..D.", "..E."],
        "weapon_spear_0": ["..m..", ".mSs.", "..S..", "..s..", "..E..", "..D..", "..E..", "..D..", "..E..", "..D..", "..E..", "..D..", "..E..", "..D..", "..E.."],
        "weapon_spear_1": ["...m.", "..Ss.", "..s..", ".E...", ".D...", ".E...", "E....", "D....", "E....", "D...."],
        "weapon_halberd_0": ["...m...", "..SSs..", ".SSSSs.", "..SSs..", "...E...", "...D...", "...E...", "...D...", "...E...", "...D...", "...E...", "...D...", "...E...", "...D...", "...E..."],
    }
    for name, rows in weapons.items():
        out[name] = _ascii_prop(rows, BONE)
    out["helmet_0"] = _ascii_prop(["..........", "...SSSS...", "..SSSSss..", ".SSKKKss..", ".SSSSSss..", "..EDDDE...", ".........."], BONE)
    # hunter's workshop props
    out["workbench_0"] = _ascii_prop([
        "....................",
        ".DDDDDDDDDDDDDDDDDD.",
        ".EEEEEEEEEEEEEEEEEE.",
        "..E..S......S....E..",
        "..E.sSs....sSs...E..",
        "..E..............E..",
        "..E..............E..",
        "..E..............E..",
        "..EE............EE..",
        "....................",
    ], BONE)
    out["weapon_rack_0"] = _ascii_prop([
        "................",
        ".E..m..m..m...E.",
        ".E..S..S..S...E.",
        ".DDDSDDSDDSDDDD.",
        ".E..S..S..S...E.",
        ".E..S..S..s...E.",
        ".E..S..s..s...E.",
        ".DDDsDDsDDsDDDD.",
        ".E..E..E..E...E.",
        ".E............E.",
        ".E............E.",
        "................",
    ], BONE)
    for i in range(2):
        a = C.new(10, 10)
        a[1:9, 1:9] = C.ci("earth")
        a[1, 1:9] = C.ci("dry")
        a[1:9, 1] = C.ci("dry")
        C.line(a, 1, 8, 8, 1, "dry") if i == 0 else C.line(a, 1, 5, 8, 5, "dry")
        out[f"crate_{i}"] = prop(a, {"earth": "bg1", "dry": "earth"})
    return out


# ---------------------------------------------------------------- ground pieces (baked)

def ground_pieces():
    rng = np.random.default_rng(505)
    out = {}
    for i in range(4):  # flagstones: 2-4 stones per tile, bg1 seams, low contrast
        a = np.full((16, 16), C.ci("fog"), dtype=np.int16)  # dark, worn: keeps blood-red threats >= 2.5 contrast
        cut_x = int(rng.integers(5, 11))
        cut_y = int(rng.integers(5, 11))
        a[:, 0] = C.ci("bg1")
        a[0, :] = C.ci("bg1")
        a[cut_y, :] = C.ci("bg1")
        if i % 2 == 0:
            a[:cut_y, cut_x] = C.ci("bg1")
        else:
            a[cut_y:, cut_x] = C.ci("bg1")
        for _ in range(2 + i):
            x, y = int(rng.integers(1, 15)), int(rng.integers(1, 15))
            a[y, x] = C.ci("stone_dark")
        out[f"flagstone_{i}"] = [a]
    for i in range(3):  # dirt: earth / bg1, sparse specks
        a = np.full((16, 16), C.ci("bg1"), dtype=np.int16)
        n = rng.random((16, 16))
        a[n < 0.35 + i * 0.05] = C.ci("earth")
        a[n > 0.97] = C.ci("fog")
        out[f"dirt_{i}"] = [a]
    for i, side in enumerate(("n", "e", "s", "w")):  # flagstone fading into dirt towards one side
        a = out["flagstone_0"][0].copy()
        d = out["dirt_0"][0]
        yy, xx = np.mgrid[0:16, 0:16]
        t = {"n": 15 - yy, "e": xx, "s": yy, "w": 15 - xx}[side] / 15.0
        m = (t > 0.55) | ((t > 0.3) & ((xx + yy) % 2 == 0))
        a[m] = d[m]
        out[f"transition_{i}"] = [a]
    for i in range(3):  # curb straight (16x6): stone top lit, darker face, cracks + moss
        a = C.new(16, 6)
        a[0:2, :] = C.ci("stone")
        a[2:5, :] = C.ci("stone_dark")
        a[5, :] = C.ci("bg0")
        a[0, :] = C.ci("stone")
        for _ in range(2 + i):
            x = int(rng.integers(1, 15))
            a[0:4, x] = C.ci("bg0") if rng.random() < 0.5 else a[0:4, x]
        for x in range(16):
            if rng.random() < 0.3:
                a[int(rng.integers(1, 5)), x] = C.ci("moss")
        out[f"curb_straight_{i}"] = [a]
    for i in range(2):
        a = C.new(6, 6)
        a[:, :] = C.ci("stone_dark")
        a[0:2, :] = C.ci("stone")
        a[:, 0:2] = C.ci("stone")
        if i:
            a[3:6, 3:6] = C.ci("moss")
        out[f"curb_corner_{i}"] = [a]
    for i in range(3):  # broken curb: gaps + rubble
        a = out[f"curb_straight_{i}"][0].copy()
        g0 = int(rng.integers(3, 9))
        a[:, g0:g0 + 4 + i] = C.T
        C.put(a, g0 + 1, 4, "stone_dark")
        C.put(a, g0 + 2, 5, "stone")
        out[f"curb_broken_{i}"] = [a]
    return out


def decals():
    rng = np.random.default_rng(606)
    out = {}
    for i in range(6):  # cracks: thin bg0 polylines with branches
        a = C.new(16, 10)
        x, y = 1.0, float(rng.integers(2, 8))
        for _ in range(6):
            nx, ny = x + rng.uniform(1.5, 3.5), float(np.clip(y + rng.uniform(-2, 2), 0, 9))
            C.line(a, x, y, nx, ny, "bg0")
            if rng.random() < 0.4:
                C.line(a, nx, ny, nx + rng.uniform(-2, 2), ny + rng.uniform(-3, 3), "bg0")
            x, y = nx, ny
        out[f"crack_{i}"] = [a]
    for i in range(4):  # moss patches: flat core + dithered edge
        a = C.new(16, 10)
        xx, yy = C.grid(16, 10)
        e = ((xx - 8) / rng.uniform(5, 7.5)) ** 2 + ((yy - 5) / rng.uniform(3, 4.5)) ** 2
        a[(e <= 1.0) & C.bayer_mask(16, 10, 0.5)] = C.ci("moss")
        a[e <= 0.55] = C.ci("moss")
        a[(e <= 0.25)] = C.ci("forest")
        out[f"moss_{i}"] = [a]
    for i in range(2):  # puddles: dark water with a cold moon reflection streak
        a = C.new(16, 8)
        xx, yy = C.grid(16, 8)
        e = ((xx - 8) / 7) ** 2 + ((yy - 4) / 3) ** 2
        a[e <= 1.0] = C.ci("bg0")
        for x in range(4 + i, 10 + i):  # mostly stone, two cold moon glints (moon is as bright as violet)
            C.put(a, x, 3, "stone_dark" if x in (6 + i, 8 + i) else "fog")
        C.put(a, 6, 5, "stone_dark")
        out[f"puddle_{i}"] = [a]
    for i in range(3):  # dark soil stains
        a = C.new(14, 10)
        xx, yy = C.grid(14, 10)
        e = ((xx - 7) / rng.uniform(4, 6.5)) ** 2 + ((yy - 5) / rng.uniform(2.5, 4.5)) ** 2
        a[(e <= 1.0) & C.bayer_mask(14, 10, 0.5)] = C.ci("earth")
        a[e <= 0.5] = C.ci("earth")
        out[f"stain_{i}"] = [a]
    for i in range(2):  # bone dust: sparse dull specks (no bright bone on the ground: keeps threats readable)
        a = C.new(10, 6)
        for _ in range(6):
            C.put(a, int(rng.integers(0, 10)), int(rng.integers(0, 6)), "dry" if rng.random() < 0.4 else "stone_dark")
        out[f"bonedust_{i}"] = [a]
    return out
