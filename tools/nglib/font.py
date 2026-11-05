"""Tiny 3x5 pixel font (palette-pure labels for the style board and wordmarks, no anti-aliasing)."""
from . import canvas as C

_SRC = """
A .#. #.# ### #.# #.#
B ##. #.# ##. #.# ##.
C .## #.. #.. #.. .##
D ##. #.# #.# #.# ##.
E ### #.. ##. #.. ###
F ### #.. ##. #.. #..
G .## #.. #.# #.# .##
H #.# #.# ### #.# #.#
I ### .#. .#. .#. ###
J ..# ..# ..# #.# .#.
K #.# #.# ##. #.# #.#
L #.. #.. #.. #.. ###
M #.# ### ### #.# #.#
N ##. #.# #.# #.# #.#
O .#. #.# #.# #.# .#.
P ##. #.# ##. #.. #..
Q .#. #.# #.# ##. .##
R ##. #.# ##. #.# #.#
S .## #.. .#. ..# ##.
T ### .#. .#. .#. .#.
U #.# #.# #.# #.# ###
V #.# #.# #.# .#. .#.
W #.# #.# ### ### #.#
X #.# #.# .#. #.# #.#
Y #.# #.# .#. .#. .#.
Z ### ..# .#. #.. ###
0 ### #.# #.# #.# ###
1 .#. ##. .#. .#. ###
2 ##. ..# .#. #.. ###
3 ##. ..# .#. ..# ##.
4 #.# #.# ### ..# ..#
5 ### #.. ##. ..# ##.
6 .## #.. ### #.# ###
7 ### ..# .#. .#. .#.
8 ### #.# ### #.# ###
9 ### #.# ### ..# ##.
_ ... ... ... ... ###
- ... ... ### ... ...
: ... .#. ... .#. ...
. ... ... ... ... .#.
+ ... .#. ### .#. ...
% #.# ..# .#. #.. #.#
"""

GLYPHS = {" ": ["..."] * 5}
for _line in _SRC.strip().splitlines():
    _k, *_rows = _line.split()
    assert len(_rows) == 5 and all(len(r) == 3 for r in _rows), _line
    GLYPHS[_k] = _rows


def text(a, x, y, s, col="bone"):
    for ch in s.upper():
        for gy, row in enumerate(GLYPHS.get(ch, GLYPHS[" "])):
            for gx, c in enumerate(row):
                if c == "#":
                    C.put(a, x + gx, y + gy, col)
        x += 4
    return x


def width(s):
    return len(s) * 4 - 1
