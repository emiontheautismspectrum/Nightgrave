"""Ritual rune glyphs and their glow/telegraph frames (the arena itself lives in compose.py)."""
import math

import numpy as np

from . import canvas as C



# Original angular arcane rune marks (v3): no letters, digits or console symbols.
GLYPHS = [
    ["#....", "##...", ".###.", "...##", "....#"],
    ["..##.", ".#...", "####.", "...#.", ".##.."],
    ["###..", "#....", "#.###", "..#.#", "..###"],
    ["..#..", ".##..", "#.###", "..##.", "..#.."],
    ["##..#", ".#.##", ".###.", "##.#.", "#..##"],
    ["###..", "..#..", ".#.#.", "..#..", "..###"],
    [".###.", "#...#", "##.##", "..#..", ".###."],
    ["#....", ".##..", ".#.##", "..#..", ".#..#"],
]


def _glyph(g, col):
    return C.from_ascii(GLYPHS[g], {"#": col})


def rune_glow(g):
    """Frame 0: dim carved stone (rest). Frames 1-3: violet telegraph ramp right before a rune burst."""
    frames = []
    rest = C.new(11, 11)
    C.paste(rest, _glyph(g, "fog"), 3, 3)  # v3: very low contrast at rest
    frames.append(rest)
    f1 = C.new(11, 11)
    C.paste(f1, _glyph(g, "violet_dark"), 3, 3)
    frames.append(f1)
    # telegraph frames: violet marks on a SOLID dark double ring (no dither); the bright violet stays a small core so
    # violet threats crossing a lit rune keep their contrast
    f2 = C.new(11, 11)
    C.paste(f2, _glyph(g, "violet_dark"), 3, 3)
    C.put(f2, 5, 5, "violet")
    f2 = C.outline(C.outline(f2, color="bg0"), color="bg0")
    frames.append(f2)
    f3 = C.new(11, 11)
    C.paste(f3, _glyph(g, "violet_dark"), 3, 3)
    for x, y in ((5, 4), (4, 5), (5, 5), (6, 5), (5, 6)):
        C.put(f3, x, y, "violet")
    f3 = C.outline(C.outline(f3, color="bg0"), color="bg0")
    frames.append(f3)
    return frames


