"""Arena layers and props. All randomness comes from seeded numpy generators (deterministic)."""
import math

import numpy as np

from . import canvas as C

W, H = 480, 270
RUNE_RADIUS = 93  # distance of rune centres from the platform centre
PLATFORM_RADIUS = 116
# Nothing decorative may intrude into this radius around the ritual centre (the play circle + rim).
PROP_CLEAR_RADIUS = 119

GLYPHS = [
    ["..#..", ".###.", "#.#.#", "..#..", "..#.."],
    ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    ["###..", "#....", "####.", "...#.", "..###"],
    ["..#..", ".#.#.", "#...#", ".#.#.", "..#.."],
    ["#.#.#", "#.#.#", "#####", "..#..", "..#.."],
    ["####.", "#..#.", "####.", "#....", "#...."],
    [".###.", "#...#", "..##.", ".#...", "#####"],
    ["#....", "##...", "#.#..", "#..#.", "#####"],
]


def _glyph(g, col):
    return C.from_ascii(GLYPHS[g], {"#": col})


def rune_positions(cx, cy):
    """Centres of the 8 runes (22.5 deg offset so none sits straight above the centre)."""
    out = []
    for k in range(8):
        ang = (k * 45 + 22.5) * math.pi / 180
        out.append((cx + round(math.cos(ang) * RUNE_RADIUS), cy + round(math.sin(ang) * RUNE_RADIUS)))
    return out



def _edge_dither(a, mask, outside_col):
    """Pixels of `mask` touching the outside get a checkerboard of `outside_col`: dithering on edges only."""
    h, w = a.shape
    p = np.zeros((h + 2, w + 2), dtype=bool)
    p[1:-1, 1:-1] = mask
    border = mask & ~(p[1:-1, :-2] & p[1:-1, 2:] & p[:-2, 1:-1] & p[2:, 1:-1])
    yy, xx = np.mgrid[0:h, 0:w]
    a[border & ((xx + yy) % 2 == 0)] = C.ci(outside_col)


def ground_ritual():
    """Flat stone platform: large calm tiles, 1 px seams, light from the top-left, carved rune channel."""
    s, c = 240, 120
    rng = np.random.default_rng(1001)
    xx, yy = C.grid(s, s)
    dx, dy = xx - c, yy - c
    r = np.sqrt(dx * dx + dy * dy)
    th = np.degrees(np.arctan2(dy, dx)) % 360
    lit = (dx + dy) < 0  # top-left half faces the light
    a = C.new(s, s)
    R = PLATFORM_RADIUS
    plat = r <= R
    a[plat] = C.ci("stone")
    seam = np.zeros((s, s), dtype=bool)
    for rr in (22, 46, 80, 104):
        seam |= np.abs(r - rr) < 0.55
    for r0, r1, step, off in ((22, 46, 45, 0), (46, 80, 30, 15), (104, 113, 22.5, 7)):
        rad = np.abs(((th - off + step / 2) % step) - step / 2) * np.pi / 180 * r < 0.55
        seam |= rad & (r > r0) & (r < r1)
    a[plat & seam] = C.ci("stone_dark")
    # a few long cracks for character (no per-pixel noise)
    for _ in range(5):
        ang = rng.uniform(0, 2 * np.pi)
        r0 = rng.uniform(25, 70)
        x0, y0 = c + np.cos(ang) * r0, c + np.sin(ang) * r0
        for _k in range(3):
            ang2 = ang + rng.uniform(-0.7, 0.7)
            x1, y1 = x0 + np.cos(ang2) * rng.uniform(5, 9), y0 + np.sin(ang2) * rng.uniform(5, 9)
            C.line(a, x0, y0, x1, y1, "stone_dark")
            x0, y0 = x1, y1
    # carved rune channel: sunken, so its outer lip is lit at the bottom-right and shaded top-left
    chan = (r > 80.5) & (r < 103.5)
    a[chan] = C.ci("stone_dark")
    a[(np.abs(r - 81) < 0.6) & ~lit] = C.ci("fog")
    a[(np.abs(r - 103) < 0.6) & lit] = C.ci("fog")
    # central dais
    a[(r <= 20.5) & (r > 19.4)] = C.ci("stone_dark")  # dais edge seam; the dais itself stays light stone
    a[(np.abs(r - 8) < 0.55)] = C.ci("stone_dark")
    # rim: raised edge, lit top-left, shaded bottom-right
    rim = (r > 113) & plat
    a[rim] = C.ci("stone_dark")
    a[rim & lit & (r < 115)] = C.ci("stone")
    a[(r > 115) & plat & ~lit] = C.ci("fog")
    # flat moss patches on the rim, with dithered edges only
    moss = plat & (r > 106) & (C.value_noise(s, s, 20, rng) > 0.66) & ~chan
    a[moss] = C.ci("moss")
    _edge_dither(a, moss, "stone_dark")
    # dithered falloff just outside the rim
    halo = (r > R) & (r <= R + 1.5)
    a[halo & C.bayer_mask(s, s, 0.5)] = C.ci("stone_dark")
    # carved rune slots (the rune_glow overlay sits on top; at rest it shows dim stone)
    for g, (rx, ry) in enumerate(rune_positions(c, c)):
        for y in range(-5, 6):
            for x in range(-5, 6):
                if x * x + y * y <= 26:
                    C.put(a, rx + x, ry + y, "fog")
        C.paste(a, _glyph(g, "stone_dark"), rx - 2, ry - 2)
    return a


def rune_glow(g):
    """Frame 0: dim carved stone (rest). Frames 1-3: violet telegraph ramp right before a rune burst."""
    frames = []
    rest = C.new(11, 11)
    C.paste(rest, _glyph(g, "stone"), 3, 3)
    frames.append(rest)
    f1 = C.new(11, 11)
    C.paste(f1, _glyph(g, "violet_dark"), 3, 3)
    frames.append(f1)
    f2 = C.new(11, 11)
    C.paste(f2, _glyph(g, "violet"), 3, 3)
    frames.append(C.halo(f2, "violet_dark"))
    f3 = C.new(11, 11)
    C.paste(f3, _glyph(g, "violet"), 3, 3)
    core = _glyph(g, "bone")
    core[[0, 4], :] = C.T
    C.paste(f3, core, 3, 3)
    f3 = C.halo(f3, "violet", phase=0)
    f3 = C.halo(f3, "violet_dark", phase=1)
    frames.append(f3)
    return frames


def _stone_prop(rows, legend=None, shade_from=None):
    legend = legend or {"S": "stone", "F": "fog", "D": "stone_dark", "M": "moss", "B": "bone"}
    a = C.from_ascii(rows, legend)
    if shade_from is not None:
        h, w = a.shape
        for y in range(h):
            for x in range(shade_from, w):
                if a[y, x] == C.ci("stone"):
                    a[y, x] = C.ci("stone_dark")
    return [C.outline(a)]


def _slab(w, h, top_r, tilt=0, broken=False, seed=0):
    """Rounded-top gravestone slab with engraving, moss at the foot, right third shaded."""
    rng = np.random.default_rng(seed)
    a = C.new(w, h)
    xx, yy = C.grid(w, h)
    cx = w / 2
    body_w = w - 4
    x0 = (w - body_w) / 2
    lean = tilt * (h - 3 - yy) / h
    inside = (xx - lean >= x0) & (xx - lean <= x0 + body_w) & (yy >= top_r + 1) & (yy <= h - 3)
    inside |= ((xx - lean - cx) ** 2 + (yy - top_r - 1.5) ** 2 <= (body_w / 2) ** 2) & (yy >= 1)
    if broken:  # jagged top
        for x in range(w):
            cut = 2 + int(rng.integers(0, 5)) if x > w / 2 else 1 + int(rng.integers(0, 2))
            inside[:cut, x] = False
    a[inside] = C.ci("stone")
    a[inside & (xx - lean > x0 + body_w * 0.62)] = C.ci("stone_dark")
    a[inside & (xx - lean < x0 + 1.2)] = C.ci("stone")
    # engraving lines
    for k, ey in enumerate((top_r + 4, top_r + 7, top_r + 9)):
        if ey < h - 5:
            ln = int(body_w * (0.5 if k else 0.3))
            for x in range(int(cx - ln / 2 + tilt * 0.3), int(cx + ln / 2 + tilt * 0.3)):
                if 0 <= x < w and inside[ey, x]:
                    a[ey, x] = C.ci("fog")
    # base + moss
    for x in range(1, w - 1):
        a[h - 2, x] = C.ci("stone_dark")
    moss = (yy >= h - 4) & (yy <= h - 2) & ((xx < 4) | (xx > w - 5) | C.bayer_mask(w, h, 0.25))
    a[moss & (a != C.T)] = C.ci("moss")
    return [C.outline(a)]


def gravestone_a():
    return _slab(16, 22, 5, seed=1)


def gravestone_b():
    rows = [
        "..................",
        "........SS........",
        ".......SSSD.......",
        ".......SSSD.......",
        ".......SSSD.......",
        "...SSSSSSSSDDDD...",
        "..SSSSSSFSSDDDDD..",
        "...SSSSSSSSDDDD...",
        ".......SSSD.......",
        ".......SSSD.......",
        ".......SFSD.......",
        ".......SSSD.......",
        ".......SFSD.......",
        ".......SSSD.......",
        ".......SSSD.......",
        ".......SSSD.......",
        "......SSSSDD......",
        ".....SSSSSDDD.....",
        "....SSSSSSDDDD....",
        "....SSFFFFFFDD....",
        "....SSSSSSDDDD....",
        "...MSSSSSSDDDDM...",
        "..MMSSSSSSDDDDMM..",
        "..MMMDDDDDDDDMMM..",
        "..................",
        "..................",
    ]
    return _stone_prop(rows)


def gravestone_c():
    return _slab(14, 18, 4, tilt=2.5, broken=True, seed=3)


def iron_fence_segment():
    """32x16 wrought-iron fence: spear-tipped bars every 4 px, two rails, light on the left edges."""
    a = C.new(32, 16)
    for x in range(1, 32, 4):
        for y in range(3, 15):
            C.put(a, x, y, "stone_dark")
        C.put(a, x, 2, "stone")  # spear tip
        C.put(a, x, 1, "stone")
        C.put(a, x - 1, 3, "stone_dark")
        C.put(a, x + 1, 3, "stone_dark")
        for y in range(4, 14):
            if y % 3 == 0:
                C.put(a, x, y, "stone")  # glints on the lit side
    for x in range(0, 32):
        C.put(a, x, 5, "stone_dark")
        C.put(a, x, 12, "stone_dark")
        if x % 2 == 0:
            C.put(a, x, 4, "stone")
    for x in range(0, 32, 3):
        C.put(a, x, 15, "moss")
    return [C.outline(a)]


def crypt_door():
    """40x30 crypt entrance: stone arch and pillars, black doorway with iron bars, two steps."""
    w, h = 40, 30
    a = C.new(w, h)
    xx, yy = C.grid(w, h)
    cx = w / 2
    frame = ((np.abs(xx - cx) <= 17) & (yy >= 9)) | (((xx - cx) ** 2 + (yy - 11) ** 2) <= 17 ** 2)
    a[frame] = C.ci("stone")
    a[frame & (xx > cx + 9)] = C.ci("stone_dark")
    door = ((np.abs(xx - cx) <= 9) & (yy >= 12) & (yy <= h - 4)) | ((((xx - cx) ** 2 + (yy - 13) ** 2) <= 9 ** 2) & (yy < 13))
    a[door] = C.ci("bg0")
    for x in range(int(cx - 7), int(cx + 8), 3):
        for y in range(6, h - 4):
            if door[y, x]:
                a[y, x] = C.ci("stone_dark")
    for y in (16, 22):
        for x in range(w):
            if door[y, x]:
                a[y, x] = C.ci("stone_dark")
    # arch voussoir seams + keystone
    for k in range(-3, 4):
        ang = np.pi / 2 + k * 0.35
        x0, y0 = cx + np.cos(ang) * 10, 13 - np.sin(ang) * 10
        x1, y1 = cx + np.cos(ang) * 16, 13 - np.sin(ang) * 16
        C.line(a, x0, y0, x1, y1, "stone_dark")
    C.put(a, int(cx), 1, "bone")
    C.put(a, int(cx) - 1, 1, "stone")
    # steps
    for x in range(2, w - 2):
        a[h - 3, x] = C.ci("stone") if x < cx + 9 else C.ci("stone_dark")
        a[h - 2, x] = C.ci("stone_dark")
    for x in range(0, w):
        a[h - 1, x] = C.ci("stone_dark") if 1 <= x < w - 1 else C.T
    return [C.outline(a)]


def _tree(w, h, seed, spread):
    rng = np.random.default_rng(seed)
    a = C.new(w, h)

    def branch(x, y, ang, length, thick, depth):
        x1 = x + math.cos(ang) * length
        y1 = y + math.sin(ang) * length
        for t in range(thick):
            C.line(a, x + t - thick // 2, y, x1 + t - thick // 2, y1, "stone_dark" if t > 0 else "stone")
        if depth > 0:
            n = 2 if depth > 1 else 3
            for k in range(n):
                da = (k - (n - 1) / 2) * spread + rng.uniform(-0.25, 0.25)
                branch(x1, y1, ang + da, length * rng.uniform(0.55, 0.75), max(1, thick - 1), depth - 1)

    branch(w / 2, h - 2, -math.pi / 2, h * 0.38, 3, 4)
    for x in range(w // 2 - 3, w // 2 + 3):  # roots
        C.put(a, x, h - 2, "stone_dark")
    return [C.outline(a)]


def dead_tree_a():
    return _tree(32, 40, 7, 0.55)


def dead_tree_b():
    return _tree(24, 36, 21, 0.45)


def floor():
    """Calm ground: large flat areas of bg1 / bg0 / forest, checker dithering only along region edges."""
    rng = np.random.default_rng(2024)
    a = np.full((H, W), C.ci("bg1"), dtype=np.int16)
    n = C.value_noise(W, H, 56, rng)
    dark = n < 0.36
    green = n > 0.64
    a[dark] = C.ci("bg0")
    a[green] = C.ci("forest")
    _edge_dither(a, dark, "bg1")
    _edge_dither(a, green, "bg1")
    return a


def _forest_layer(w, h, seed, col, band_col, count, tree_h):
    """Horizontally tileable band of dead-tree silhouettes standing in a fog band."""
    rng = np.random.default_rng(seed)
    pad = 48
    big = C.new(w + 2 * pad, h)

    def branch(x, y, ang, length, thick, depth):
        x1 = x + math.cos(ang) * length
        y1 = y + math.sin(ang) * length
        for t in range(thick):
            C.line(big, x + t - thick // 2, y, x1 + t - thick // 2, y1, col)
        if depth > 0:
            for k in range(2):
                da = (k - 0.5) * rng.uniform(0.6, 1.0) + rng.uniform(-0.2, 0.2)
                branch(x1, y1, ang + da, length * rng.uniform(0.6, 0.8), max(1, thick - 1), depth - 1)

    for i in range(count):
        x = pad + (i + rng.uniform(0.1, 0.9)) * w / count
        th = rng.uniform(tree_h * 0.45, tree_h * 0.7)  # headroom: crowns never touch row 0
        branch(x, h - 4, -math.pi / 2 + rng.uniform(-0.12, 0.12), th * 0.45, 3, 4)
    out = C.new(w, h)
    for x in range(w + 2 * pad):  # fold the padding back so the band tiles seamlessly
        col_px = big[:, x]
        tx = (x - pad) % w
        m = col_px != C.T
        out[m, tx] = col_px[m]
    out[h - 4:, :] = C.ci(col)
    # fog band over the tree bases: solid line + two dithered rows above it
    band = np.zeros((h, w), dtype=bool)
    band[h - 3:h - 1, :] = True
    out[band] = C.ci(band_col)
    out[(h - 6 <= np.mgrid[0:h, 0:w][0]) & (np.mgrid[0:h, 0:w][0] < h - 3) & C.bayer_mask(w, h, 0.5)] = C.ci(band_col)
    out[(h - 9 <= np.mgrid[0:h, 0:w][0]) & (np.mgrid[0:h, 0:w][0] < h - 6) & C.bayer_mask(w, h, 0.125)] = C.ci(band_col)
    return out


def bg_forest_far():
    return _forest_layer(W, 64, 77, "fog", "stone_dark", 22, 64)


def bg_forest_mid():
    return _forest_layer(W, 56, 78, "forest", "fog", 14, 56)


def bg_forest_near():
    return _forest_layer(W, 44, 79, "bg0", "forest", 9, 44)


def fog_overlay():
    rng = np.random.default_rng(31)
    s = 256
    n = C.value_noise(s, s, 64, rng, wrap=True) * 0.7 + C.value_noise(s, s, 32, rng, wrap=True) * 0.3
    level = np.clip((n - 0.55) * 1.2, 0, 0.25)
    yy, xx = np.mgrid[0:s, 0:s]
    keep = C.BAYER4[yy % 4, xx % 4] < level * 16
    a = C.new(s, s)
    a[keep] = C.ci("fog")
    return a


def vignette():
    """Centred on the play circle and fully clear inside it: it only darkens the setting around it."""
    xx, yy = C.grid(W, H)
    cx, cy = RITUAL_CENTER
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    level = np.clip((d - (PLATFORM_RADIUS + 8)) / 200, 0, 0.7)
    a = C.new(W, H)
    a[C.BAYER4[(yy - 0.5).astype(int) % 4, (xx - 0.5).astype(int) % 4] < level * 16] = C.ci("bg0")
    return a


# Where the ritual platform and props sit in the 480x270 arena (shared with the game via manifest.json).
RITUAL_ORIGIN = (120, 30)
RITUAL_CENTER = (RITUAL_ORIGIN[0] + 120, RITUAL_ORIGIN[1] + 120)
FOREST_LAYOUT = [("bg_forest_far", 0, 0, 0.02), ("bg_forest_mid", 0, 8, 0.05), ("bg_forest_near", 0, 18, 0.1)]
PROP_LAYOUT = [
    ("crypt_door", 220, 0),
    ("iron_fence_segment", 176, 13), ("iron_fence_segment", 264, 13),
    ("iron_fence_segment", 34, 226), ("iron_fence_segment", 412, 226),
    ("dead_tree_a", 26, 66), ("dead_tree_b", 446, 66), ("dead_tree_b", 66, 196), ("dead_tree_a", 392, 190),
    ("gravestone_a", 78, 98), ("gravestone_b", 92, 140), ("gravestone_c", 50, 168),
    ("gravestone_a", 384, 126), ("gravestone_c", 404, 96), ("gravestone_b", 372, 166),
]

PROPS = {
    "gravestone_a": gravestone_a, "gravestone_b": gravestone_b, "gravestone_c": gravestone_c,
    "dead_tree_a": dead_tree_a, "dead_tree_b": dead_tree_b,
    "iron_fence_segment": iron_fence_segment, "crypt_door": crypt_door,
}
PROPS.update({f"rune_glow_{g}": (lambda g=g: rune_glow(g)) for g in range(8)})

BACKGROUNDS = {
    "floor": floor, "ground_ritual": ground_ritual, "bg_forest_far": bg_forest_far, "bg_forest_mid": bg_forest_mid,
    "bg_forest_near": bg_forest_near, "fog_overlay": fog_overlay, "vignette": vignette,
}


def check_props_clear(sprites):
    """Fail if any opaque prop pixel lies inside PROP_CLEAR_RADIUS of the ritual centre."""
    cx, cy = RITUAL_CENTER
    bad = []
    for name, x, y in PROP_LAYOUT:
        f = sprites[name][0]
        ys, xs = np.nonzero(f != C.T)
        d = np.sqrt((xs + x + 0.5 - cx) ** 2 + (ys + y + 0.5 - cy) ** 2)
        if len(d) and d.min() < PROP_CLEAR_RADIUS:
            bad.append(f"{name}@({x},{y}) reaches r={d.min():.1f}")
        if x < 0 or y < 0 or x + f.shape[1] > W or y + f.shape[0] > H:
            bad.append(f"{name}@({x},{y}) leaves the screen")
    return bad
