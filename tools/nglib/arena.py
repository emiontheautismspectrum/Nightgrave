"""Arena layers and props. All randomness comes from seeded numpy generators (deterministic)."""
import math

import numpy as np

from . import canvas as C

W, H = 480, 270
RUNE_RADIUS = 93  # distance of rune centres from the platform centre

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


def ground_ritual():
    s, c = 240, 120
    rng = np.random.default_rng(1001)
    xx, yy = C.grid(s, s)
    dx, dy = xx - c, yy - c
    r = np.sqrt(dx * dx + dy * dy)
    th = np.degrees(np.arctan2(dy, dx)) % 360
    a = C.new(s, s)
    plat = r <= 116
    noise = rng.random((s, s))
    coarse = C.value_noise(s, s, 12, rng)
    # tiles
    a[plat] = C.ci("stone")
    a[plat & (noise < 0.10 + coarse * 0.18)] = C.ci("stone_dark")
    # ring seams + radial seams per ring band (offset per band like masonry)
    for rr in (22, 46, 80, 104):
        a[plat & (np.abs(r - rr) < 0.6)] = C.ci("fog")
    bands = [(22, 46, 30, 0), (46, 80, 22.5, 11), (104, 116, 15, 7)]
    for r0, r1, step, off in bands:
        seam = np.abs(((th - off + step / 2) % step) - step / 2) * np.pi / 180 * r < 0.6
        a[plat & (r > r0) & (r < r1) & seam] = C.ci("fog")
    # top-left light: 1 px bright lip on the inner side of each ring seam facing the light
    lit = (dx + dy) < -0.25 * r
    for rr in (23, 47, 81, 105):
        a[plat & lit & (np.abs(r - rr) < 0.6)] = C.ci("stone")
    # carved rune channel between r=80 and r=104 (sunken: darker)
    chan = plat & (r > 81) & (r < 104)
    a[chan] = C.ci("stone_dark")
    a[chan & (noise < 0.22)] = C.ci("fog")
    # dais in the centre
    dais = r <= 21
    a[dais] = C.ci("stone_dark")
    a[(r <= 21) & (r > 19.5)] = C.ci("stone")
    a[(r <= 21) & (r > 19.5) & ~lit] = C.ci("fog")
    a[(r < 9) & (r > 7.8)] = C.ci("violet_dark")
    # outer rim: lit top-left, shadow bottom-right
    rim = (r > 113) & (r <= 116)
    a[rim] = C.ci("stone_dark")
    a[rim & lit] = C.ci("stone")
    a[(r > 115) & (r <= 116) & ~lit] = C.ci("fog")
    # moss creeping in from the rim
    moss = plat & (r > 92) & (coarse > 0.62) & C.bayer_mask(s, s, 0.5) & ~chan
    a[moss] = C.ci("moss")
    # dim runes (lit versions are separate animated sprites)
    for g, (rx, ry) in enumerate(rune_positions(c, c)):
        for y in range(-5, 6):
            for x in range(-5, 6):
                if x * x + y * y <= 30:
                    C.put(a, rx + x, ry + y, "fog")
        C.paste(a, _glyph(g, "violet_dark"), rx - 2, ry - 2)
    return a


def rune_glow(g):
    frames = []
    for i in range(4):
        a = C.new(11, 11)
        core = "violet" if i in (1, 3) else ("bone" if i == 2 else "violet_dark")
        C.paste(a, _glyph(g, core if i != 2 else "violet"), 3, 3)
        if i == 2:
            gl = _glyph(g, "bone")
            gl[[0, 4], :] = C.T
            C.paste(a, gl, 3, 3)
        if i >= 1:
            a = C.halo(a, "violet_dark", phase=i)
        if i == 2:
            a = C.halo(a, "violet_dark", phase=i + 1)
        frames.append(a)
    return frames


def _stone_shade(a, light_x):
    """Shade the right side of a stone prop darker (light from top-left)."""
    h, w = a.shape
    for y in range(h):
        for x in range(w):
            if a[y, x] == C.ci("stone") and x >= light_x:
                a[y, x] = C.ci("stone_dark")
    return a


def gravestone_a():
    rows = [
        "............",
        "....SSSS....",
        "...SSSSSS...",
        "..SSSSSSSS..",
        "..SSFFFFSS..",
        "..SSSSSSSS..",
        "..SSFFFFSS..",
        "..SSSSSSSS..",
        "..SSSFFSSS..",
        "..SSSSSSSS..",
        "..SSSSSSSS..",
        "..SSSSSSSS..",
        "..SSSSSSSS..",
        ".MSSSSSSSSM.",
        ".MMMDDDDMMM.",
        "............",
    ]
    return [C.outline(_stone_shade(C.from_ascii(rows, {"S": "stone", "F": "fog", "D": "stone_dark", "M": "moss"}), 7))]


def gravestone_b():
    rows = [
        "..............",
        "......SS......",
        "......SS......",
        "......SS......",
        "..SSSSSSSSSS..",
        "..SSSSSSSSSS..",
        "......SS......",
        "......SS......",
        "......SS......",
        "......SS......",
        "......SS......",
        "......SS......",
        ".....SSSS.....",
        "....SSSSSS....",
        "...SSSSSSSS...",
        "..MSSSSSSSSM..",
        "..MMDDDDDDMM..",
        "..............",
    ]
    return [C.outline(_stone_shade(C.from_ascii(rows, {"S": "stone", "D": "stone_dark", "M": "moss"}), 7))]


def gravestone_c():
    rows = [
        "..........",
        "..S.......",
        "..SSS.....",
        "..SSSS.S..",
        "..SSSSSS..",
        "..SFSSSS..",
        "..SSFSSS..",
        "..SSSSSS..",
        ".MSSSSSSM.",
        ".MMDDDDMM.",
        "..........",
        "..........",
    ]
    return [C.outline(_stone_shade(C.from_ascii(rows, {"S": "stone", "F": "fog", "D": "stone_dark", "M": "moss"}), 6))]


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
    rng = np.random.default_rng(2024)
    a = np.full((H, W), C.ci("bg1"), dtype=np.int16)
    n = C.value_noise(W, H, 24, rng)
    fine = rng.random((H, W))
    a[n < 0.35] = C.ci("bg0")
    a[(n > 0.62) & C.bayer_mask(W, H, 0.5)] = C.ci("forest")
    a[(n > 0.72) & C.bayer_mask(W, H, 0.25)] = C.ci("moss")
    a[fine < 0.02] = C.ci("fog")
    return a


def _treeline(w, h, seed, col, base_col, amp):
    rng = np.random.default_rng(seed)
    a = C.new(w, h)
    heights = np.zeros(w)
    x = 0
    while x < w:  # spiky conifer-like dead silhouettes, periodic in x
        tw = int(rng.integers(5, 11))
        th = int(rng.integers(amp // 2, amp))
        for k in range(tw):
            v = th * (1 - abs(k - tw / 2) / (tw / 2 + 0.5))
            heights[(x + k) % w] = max(heights[(x + k) % w], v)
        x += int(rng.integers(3, 8))
    for x in range(w):
        top = int(h - heights[x])
        a[max(0, top):, x] = C.ci(col)
    a[h - 4:, :][C.bayer_mask(w, 4, 0.5)] = C.ci(base_col)
    return a


def bg_forest_far():
    return _treeline(W, 34, 77, "forest", "fog", 30)


def bg_forest_near():
    return _treeline(W, 22, 78, "bg0", "forest", 20)


def fog_overlay():
    rng = np.random.default_rng(31)
    s = 256
    n = C.value_noise(s, s, 32, rng, wrap=True) * 0.6 + C.value_noise(s, s, 16, rng, wrap=True) * 0.4
    level = np.clip((n - 0.45) * 1.6, 0, 0.45)
    yy, xx = np.mgrid[0:s, 0:s]
    keep = C.BAYER4[yy % 4, xx % 4] < level * 16
    a = C.new(s, s)
    a[keep] = C.ci("fog")
    return a


def vignette():
    xx, yy = C.grid(W, H)
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / math.sqrt(2)
    level = np.clip((d - 0.45) / 0.4, 0, 1)
    a = C.new(W, H)
    a[C.BAYER4[(yy - 0.5).astype(int) % 4, (xx - 0.5).astype(int) % 4] < level * 16] = C.ci("bg0")
    return a


PROPS = {
    "gravestone_a": gravestone_a, "gravestone_b": gravestone_b, "gravestone_c": gravestone_c,
    "dead_tree_a": dead_tree_a, "dead_tree_b": dead_tree_b,
}
PROPS.update({f"rune_glow_{g}": (lambda g=g: rune_glow(g)) for g in range(8)})

BACKGROUNDS = {
    "floor": floor, "ground_ritual": ground_ritual, "bg_forest_far": bg_forest_far,
    "bg_forest_near": bg_forest_near, "fog_overlay": fog_overlay, "vignette": vignette,
}
