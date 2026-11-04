"""Effect sprites (hero side = warm amber / ember / gold)."""
import math

import numpy as np

from . import canvas as C


def parry_pulse():
    spec = (
        (2.5, 5.0, [("gold", 1.0)]),
        (6.0, 8.5, [("gold", 1.0), ("amber", 1.0)]),
        (8.5, 10.5, [("amber", 0.5)]),
        (10.2, 11.6, [("ember", 0.25)]),
    )
    frames = []
    for i, (r0, r1, layers) in enumerate(spec):
        a = C.new(24, 24)
        if len(layers) == 2:
            C.ring(a, 12, 12, r0, r1, "gold")
            C.ring(a, 12, 12, r1 - 1.0, r1, "amber")
        else:
            col, cov = layers[0]
            C.ring(a, 12, 12, r0, r1, col, mask=C.bayer_mask(24, 24, cov, ox=i))
        if i == 0:
            C.ring(a, 12, 12, 0, 2.5, "amber", mask=C.bayer_mask(24, 24, 0.5))
        frames.append(a)
    return frames


def parry_spark():
    frames = []
    shapes = [
        [".#..", "####", ".#..", ".#.."], ["....", ".##.", ".##.", "...."], ["#..#", ".##.", ".##.", "#..#"],
        ["....", ".#..", "###.", ".#.."], ["#...", "....", "..#.", "...."], ["....", ".#..", "....", "...."],
        ["..#.", "....", "#...", "...."], ["....", "....", "..#.", "...."],
    ]
    cols = ["gold", "gold", "amber", "amber", "amber", "ember", "ember", "ember"]
    for s, col in zip(shapes, cols):
        frames.append(C.from_ascii(s, {"#": col}))
    return frames


def dash_trail():
    frames = []
    rows = [(4, "ember"), (6, "amber"), (8, "gold"), (10, "amber"), (12, "ember")]
    for i, keep in enumerate((1.0, 0.5, 0.25)):
        a = C.new(16, 16)
        for k, (y, col) in enumerate(rows):
            x0 = (k * 3) % 5 + i * 3
            for x in range(x0, 16 - (k % 2) * 2):
                C.put(a, x, y, col)
        if keep < 1.0:
            a = C.dither_out(a, keep, ox=i)
        frames.append(a)
    return frames


def hit_flash():
    frames = []
    for i in range(2):
        a = C.new(16, 16)
        C.disc(a, 8, 8, 5.5 - i * 1.5, "bone" if i == 0 else "gold")
        for k in range(8):
            ang = k * math.pi / 4
            C.line(a, 8, 8, 8 + math.cos(ang) * (7 - i), 8 + math.sin(ang) * (7 - i), "bone")
        if i == 1:
            a = C.dither_out(a, 0.5)
        frames.append(a)
    return frames


def death_burst():
    frames = []
    for i in range(6):
        a = C.new(32, 32)
        r = 3 + i * 2.4
        C.ring(a, 16, 16, r - 1.2, r, ("gold", "gold", "amber", "amber", "ember", "ember")[i],
               mask=C.bayer_mask(32, 32, max(0.2, 1.0 - i * 0.17), ox=i))
        for k in range(10):
            ang = k / 10 * 2 * math.pi + (k % 2) * 0.2
            d0, d1 = r + 1, r + 3 - i * 0.3
            if i < 5 or k % 2 == 0:
                C.line(a, 16 + math.cos(ang) * d0, 16 + math.sin(ang) * d0,
                       16 + math.cos(ang) * d1, 16 + math.sin(ang) * d1, "amber" if k % 2 else "ember")
        if i == 0:
            C.disc(a, 16, 16, 3, "bone")
        frames.append(a)
    return frames


def ember_particle():
    shapes = [["#.", ".."], ["##", ".."], ["#.", ".#"], ["##", "#."]]
    cols = ["gold", "amber", "ember", "ember"]
    return [C.from_ascii(s, {"#": c}) for s, c in zip(shapes, cols)]


def cursor_reticle():
    rows = [
        "##.....##",
        "#.......#",
        ".........",
        ".........",
        "....#....",
        ".........",
        ".........",
        "#.......#",
        "##.....##",
    ]
    return [C.from_ascii(rows, {"#": "amber"})]


def icon_parry():
    """HUD icon: round shield. Frame 0 ready (bone + amber rim), frame 1 cooling down (dim stone)."""
    frames = []
    for ready in (True, False):
        a = C.new(16, 16)
        C.disc(a, 8, 8, 5.5, "bone" if ready else "stone")
        C.ring(a, 8, 8, 4.4, 5.5, "amber" if ready else "stone_dark")
        C.disc(a, 8, 8, 1.5, "stone" if ready else "stone_dark")
        C.put(a, 6, 6, "bone" if ready else "stone")
        frames.append(C.outline(a, color="bg0"))
    return frames


def icon_dash():
    """HUD icon: forward chevrons with speed lines. Frame 0 ready, frame 1 cooling down."""
    rows = [
        "................",
        "................",
        "................",
        "......#...#.....",
        ".......#...#....",
        "........#...#...",
        "##.......#...#..",
        "..........#...#.",
        "##.......#...#..",
        "........#...#...",
        ".......#...#....",
        "......#...#.....",
        "................",
        "................",
        "................",
        "................",
    ]
    frames = []
    for col in ("amber", "stone"):
        a = C.from_ascii(rows, {"#": col})
        frames.append(C.outline(a, color="bg0"))
    return frames


def icon_ring():
    """20x20 cooldown ring, 13 frames: frame k has k/12 of the ring filled clockwise from the top."""
    frames = []
    xx, yy = C.grid(20, 20)
    dx, dy = xx - 10, yy - 10
    r = np.sqrt(dx * dx + dy * dy)
    ang = (np.arctan2(dx, -dy)) % (2 * math.pi)
    band = (r >= 8.0) & (r <= 9.6)
    for k in range(13):
        a = C.new(20, 20)
        a[band] = C.ci("fog")
        a[band & (ang < k / 12 * 2 * math.pi - 1e-9)] = C.ci("amber")
        frames.append(a)
    return frames


def parry_fizzle():
    """Whiffed parry: a dim grey puff, deliberately not warm, so a miss never reads as a hit."""
    frames = []
    pts = [(-3, -1), (2, -3), (3, 2), (-2, 3), (0, -4), (-4, 2), (4, -1), (1, 4)]
    for i in range(4):
        a = C.new(12, 12)
        d = 1 + i
        for k, (px, py) in enumerate(pts):
            if i == 3 and k % 2:
                continue
            x = 6 + int(round(px * d / 3))
            y = 6 + int(round(py * d / 3)) - (i // 2)
            C.put(a, x, y, "stone" if i < 2 else "stone_dark")
        if i == 0:
            C.put(a, 6, 6, "stone")
            C.put(a, 5, 6, "fog")
        frames.append(a)
    return frames


SPRITES = {
    "parry_pulse": parry_pulse, "parry_spark": parry_spark, "dash_trail": dash_trail,
    "hit_flash": hit_flash, "death_burst": death_burst, "ember_particle": ember_particle,
    "cursor_reticle": cursor_reticle, "icon_parry": icon_parry, "icon_dash": icon_dash,
    "icon_ring": icon_ring, "parry_fizzle": parry_fizzle,
}
