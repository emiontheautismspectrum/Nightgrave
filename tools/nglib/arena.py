"""Ritual rune glyphs and their glow/telegraph frames (the arena itself lives in compose.py)."""
import math

import numpy as np

from . import canvas as C



# Original angular arcane rune marks (v3): no letters, digits or console symbols.
GLYPHS = [
    ["#...#", ".#.#.", "..#..", "..#..", ".#.#."],
    [".##..", "#..#.", "..#..", ".#..#", "..##."],
    ["#.#.#", ".#.#.", "#...#", ".#.#.", "#.#.#"],
    ["..#..", ".##..", "#.###", "..##.", "..#.."],
    ["#..##", ".#.#.", "..#..", ".#.#.", "##..#"],
    ["###..", "..#..", ".#.#.", "..#..", "..###"],
    [".#.#.", "#...#", ".#.#.", "..#..", ".###."],
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


