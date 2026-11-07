"""The phone-portrait "shell": a blackened-iron relic console around the run screen (sprites only).

Original design: an iron body with bone engraving, a riveted screen bezel, recessed lamps and rectangular caps. No
brand text, logos, lettering, D-pad or SELECT / START (docs/ASSETS_SPEC.md "Shell"). Light from the top-left.
Palette: bg0, bg1, fog, stone_dark, stone, bone for the body; amber, gold and teal only in the lamps. Never red, ember
or violet (red means unparryable, violet parryable), never decor-only or ground-only colours.

Every piece is small and is assembled at runtime from whole-pixel tiles (src/render/shellParts.ts): edge strips and the
fill tile repeat, the caps are 9-slice sources whose middle row / column is ONE pixel (repeating it == stretching it,
so any whole-pixel size is exact). The round stick parts are rasterised at runtime at the layout's radius.
"""
import numpy as np

from . import canvas as C

# K bg0, B bg1, F fog, D stone_dark, S stone, W bone, A amber, G gold, T teal
LEG = {"K": "bg0", "B": "bg1", "F": "fog", "D": "stone_dark", "S": "stone", "W": "bone", "A": "amber", "G": "gold",
       "T": "teal"}
# The only colours a shell sprite may use (tools/validate_palette.py enforces it).
COLORS = {"bg0", "bg1", "fog", "stone_dark", "stone", "bone", "amber", "gold", "teal"}

BEZEL = 5  # bezel thickness (game px); src/data/shell.ts reads the sprite size, keep them equal


def A(rows):
    return C.from_ascii(rows, LEG)


# ---------------------------------------------------------------- body fill (tileable 8x8: worn blackened iron)
def fill():
    return [A(["BBBBBBBB",
               "BBBBBBBB",
               "BBBBBFBB",
               "BBBBBBBB",
               "BKBBBBBB",
               "BBBBBBBB",
               "BBBBBBBB",
               "BBBFBBBB"])]


# ---------------------------------------------------------------- bezel (5 px): outer lip, face, inner lip
# One profile from the OUTSIDE to the INSIDE of the frame, per side. Top / left are lit on the outer lip and in shadow
# on the inner lip (the screen is recessed); bottom / right the other way round.
_PROFILE = {"top": "SDDDK", "left": "SDDDK", "bottom": "KDDDS", "right": "KDDDS"}


def _bezel_side(side, length=8):
    """Tile of one side: horizontal sides are length x 5 (row 0 = the edge touching the top of the tile), vertical
    sides 5 x length. A faint fog dot every 8 px on the middle row is the engraving line."""
    prof = _PROFILE[side]
    if side in ("top", "bottom"):
        rows = prof if side == "top" else prof[::-1]  # row 0 is the top of the tile
        a = np.array([[C.ci(LEG[ch])] * length for ch in rows], dtype=np.int16)
        a[2, 3] = C.ci("fog")
        return a
    cols = prof if side == "left" else prof[::-1]  # col 0 is the left of the tile
    a = np.array([[C.ci(LEG[ch]) for ch in cols] for _ in range(length)], dtype=np.int16)
    a[3, 2] = C.ci("fog")
    return a


def bezel_h():
    return [_bezel_side("top"), _bezel_side("bottom")]


def bezel_v():
    return [_bezel_side("left"), _bezel_side("right")]


def bezel_corner():
    """TL, TR, BL, BR (5x5): mitred joins of the two side profiles, then the inner corner pixel in shadow / light."""
    n = BEZEL
    out = []
    for corner in ("tl", "tr", "bl", "br"):
        a = C.new(n, n)
        for y in range(n):
            for x in range(n):
                vy = y if corner in ("tl", "tr") else n - 1 - y  # distance from the outer horizontal edge
                vx = x if corner in ("tl", "bl") else n - 1 - x  # distance from the outer vertical edge
                horiz = "top" if corner in ("tl", "tr") else "bottom"
                vert = "left" if corner in ("tl", "bl") else "right"
                # the side whose outer edge is nearer owns the pixel (ties: the lit side, top / left)
                if vy < vx or (vy == vx and horiz == "top"):
                    ch = _PROFILE[horiz][vy]
                else:
                    ch = _PROFILE[vert][vx]
                a[y, x] = C.ci(LEG[ch])
        out.append(a)
    return out


# ---------------------------------------------------------------- small ornaments
def rivet():
    return [A([".S.",
               "SWD",
               ".DK"])]


def screw():
    return [A([".SSD.",
               "SFSKD",
               "SSKSD",
               "DKSDK",
               ".DKK."])]


def rune():
    """An original engraved stave (bone line, bg0 groove shadow below-right)."""
    w = ["....W....",
         "...W.W...",
         "..W.W.W..",
         "....W....",
         "....W....",
         "..W.W.W..",
         ".W..W..W.",
         "....W....",
         "....W...."]
    a = C.new(10, 10)
    for y, row in enumerate(w):
        for x, ch in enumerate(row):
            if ch == "W":
                a[y + 1, x + 1] = C.ci("bg0")
    for y, row in enumerate(w):
        for x, ch in enumerate(row):
            if ch == "W":
                a[y, x] = C.ci("bone")
    return [a]


def grille():
    """Speaker grille tile 4x4 on a stone_dark plate: one recessed 2x2 hole (shadow top-left, lit bottom-right)."""
    return [A(["KKDD",
               "KSDD",
               "DDDD",
               "DDDD"])]


def pause_pill():
    """19x11 rounded pill with a bone pause glyph (two bars)."""
    return [A([".KKKKKKKKKKKKKKKKK.",
               "KSSSSSSSSSSSSSSSSSK",
               "KSDDDDDDDDDDDDDDDBK",
               "KSDDDDDWWDWWDDDDDBK",
               "KSDDDDDWWDWWDDDDDBK",
               "KSDDDDDWWDWWDDDDDBK",
               "KSDDDDDWWDWWDDDDDBK",
               "KSDDDDDWWDWWDDDDDBK",
               "KSDDDDDDDDDDDDDDDBK",
               "KBBBBBBBBBBBBBBBBBK",
               ".KKKKKKKKKKKKKKKKK."])]


def plate_ends():
    """Title plate: left end, right end (4x9) and the 1x9 middle column (repeated: the text is drawn on it)."""
    left = A([".KKK",
              "KSSS",
              "KSDD",
              "KSDD",
              "KSFD",
              "KSDD",
              "KSDD",
              "KBBB",
              ".KKK"])
    right = A(["KKK.",
               "SSSK",
               "DDBK",
               "DDBK",
               "DFBK",
               "DDBK",
               "DDBK",
               "BBBK",
               "KKK."])
    return [left, right]


def plate_mid():
    return [A(["K", "S", "D", "D", "D", "D", "D", "B", "K"])]


# ---------------------------------------------------------------- caps (9-slice sources, middle = 1 px)
def _cap(c, pressed):
    """A (2c+1) x (2c+2) cap: rounded corners of radius c-1, a 1 px bg0 outline, a lit top-left bevel, a shaded
    bottom-right and (up) a 1 px dark side under the face. Pressed: the face is flat (no bevel) and shifted 1 px down
    over the side; the top row then shows the dark recess. Rows / columns c are uniform along their length."""
    w = 2 * c + 1
    h = 2 * c + 2
    a = C.new(w, h)
    rad = c - 1

    def inside(x, y, fw, fh):
        # rounded rectangle [0, fw) x [0, fh) with corner radius `rad` (pixel centres)
        cx = min(max(x + 0.5, rad), fw - rad)
        cy = min(max(y + 0.5, rad), fh - rad)
        return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rad * rad + 0.25

    fh = h - 1  # the face height; the cap's side is the last row
    oy = 1 if pressed else 0
    if pressed:  # the recess behind a pressed cap
        for x in range(w):
            if inside(x, 0, w, fh):
                a[0, x] = C.ci("bg0")
    for y in range(fh):
        for x in range(w):
            if not inside(x, y, w, fh):
                continue
            edge = not (inside(x - 1, y, w, fh) and inside(x + 1, y, w, fh) and inside(x, y - 1, w, fh) and inside(x, y + 1, w, fh))
            if edge:
                col = "bg0"
            elif pressed:
                col = "stone_dark"
            else:
                tl = not (inside(x - 2, y, w, fh) and inside(x, y - 2, w, fh))  # second ring, top / left side
                br = not (inside(x + 2, y, w, fh) and inside(x, y + 2, w, fh))
                if tl and (x < c or y < c) and not br:
                    col = "stone"
                elif br and (x > c or y > c):
                    col = "bg1"
                else:
                    col = "stone_dark"
            a[y + oy, x] = C.ci(col)
    if not pressed:  # the cap's dark side under the face
        for x in range(w):
            if inside(x, fh - 1, w, fh):
                a[fh, x] = C.ci("bg0")
    return a


def cap_large():
    return [_cap(5, False), _cap(5, True)]


def cap_small():
    return [_cap(4, False), _cap(4, True)]


# ---------------------------------------------------------------- lamps (11x11; off = outlined lens, on = filled)
_GLYPHS = {
    "dash": ["XX...",
             ".XX..",
             "..XX.",
             ".XX..",
             "XX..."],
    "guard": ["XXXXX",
              "XXXXX",
              "XXXXX",
              ".XXX.",
              "..X.."],
    "trail": ["..X..",
              ".XX..",
              ".XXX.",
              "XXXXX",
              ".XXX."],
    "slow": ["XXXXX",
             ".XXX.",
             "..X..",
             ".XXX.",
             "XXXXX"],
    "double": ["XXXX.",
               "...XX",
               ".XXX.",
               "XX...",
               "XXXXX"],
}
LAMPS = [("dash", "amber"), ("guard", "amber"), ("trail", "amber"), ("slow", "teal"), ("double", "gold")]


def _lamp(glyph, col, on):
    n = 11
    a = C.new(n, n)
    xx, yy = C.grid(n, n)
    d = np.sqrt((xx - 5.5) ** 2 + (yy - 5.5) ** 2)
    a[d <= 5.6] = C.ci("bg0")  # the housing's outline
    rim = (d <= 4.9) & (d > 3.9)
    a[rim & (xx + yy < 11)] = C.ci("stone")  # lit top-left rim
    a[rim & (xx + yy >= 11)] = C.ci("stone_dark")
    lens = d <= 3.9
    if on:
        a[lens] = C.ci(col)
    else:
        a[lens] = C.ci("bg0")
        a[(d <= 3.9) & (d > 3.0)] = C.ci("bg1")
    g = _GLYPHS[glyph]
    gh, gw = len(g), len(g[0])
    ox, oy = (n - gw) // 2, (n - gh) // 2
    for y, row in enumerate(g):
        for x, ch in enumerate(row):
            if ch == "X":
                a[oy + y, ox + x] = C.ci("bg0" if on else "stone")
    if on:  # a 1 px glint top-left of the lit lens
        a[3, 4] = C.ci("bone")
    return a


def lamps():
    """Frames: for each lamp kind (LAMPS order) off, on."""
    out = []
    for glyph, col in LAMPS:
        out += [_lamp(glyph, col, False), _lamp(glyph, col, True)]
    return out


# ---------------------------------------------------------------- engraved 3x5 letters (title plate)
GLYPH_ORDER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
_FONT = {
    "A": ["XXX", "X.X", "XXX", "X.X", "X.X"], "B": ["XX.", "X.X", "XX.", "X.X", "XX."],
    "C": ["XXX", "X..", "X..", "X..", "XXX"], "D": ["XX.", "X.X", "X.X", "X.X", "XX."],
    "E": ["XXX", "X..", "XX.", "X..", "XXX"], "F": ["XXX", "X..", "XX.", "X..", "X.."],
    "G": ["XXX", "X..", "X.X", "X.X", "XXX"], "H": ["X.X", "X.X", "XXX", "X.X", "X.X"],
    "I": ["XXX", ".X.", ".X.", ".X.", "XXX"], "J": ["..X", "..X", "..X", "X.X", "XXX"],
    "K": ["X.X", "X.X", "XX.", "X.X", "X.X"], "L": ["X..", "X..", "X..", "X..", "XXX"],
    "M": ["X.X", "XXX", "XXX", "X.X", "X.X"], "N": ["XX.", "X.X", "X.X", "X.X", "X.X"],
    "O": ["XXX", "X.X", "X.X", "X.X", "XXX"], "P": ["XXX", "X.X", "XXX", "X..", "X.."],
    "Q": ["XXX", "X.X", "X.X", "XXX", "..X"], "R": ["XX.", "X.X", "XX.", "X.X", "X.X"],
    "S": ["XXX", "X..", "XXX", "..X", "XXX"], "T": ["XXX", ".X.", ".X.", ".X.", ".X."],
    "U": ["X.X", "X.X", "X.X", "X.X", "XXX"], "V": ["X.X", "X.X", "X.X", "X.X", ".X."],
    "W": ["X.X", "X.X", "XXX", "XXX", "X.X"], "X": ["X.X", "X.X", ".X.", "X.X", "X.X"],
    "Y": ["X.X", "X.X", ".X.", ".X.", ".X."], "Z": ["XXX", "..X", ".X.", "X..", "XXX"],
    "0": ["XXX", "X.X", "X.X", "X.X", "XXX"], "1": [".X.", "XX.", ".X.", ".X.", "XXX"],
    "2": ["XXX", "..X", "XXX", "X..", "XXX"], "3": ["XXX", "..X", ".XX", "..X", "XXX"],
    "4": ["X.X", "X.X", "XXX", "..X", "..X"], "5": ["XXX", "X..", "XXX", "..X", "XXX"],
    "6": ["XXX", "X..", "XXX", "X.X", "XXX"], "7": ["XXX", "..X", ".X.", ".X.", ".X."],
    "8": ["XXX", "X.X", "XXX", "X.X", "XXX"], "9": ["XXX", "X.X", "XXX", "..X", "XXX"],
    "-": ["...", "...", "XXX", "...", "..."],
}


def glyphs():
    out = []
    for ch in GLYPH_ORDER:
        a = C.new(3, 5)
        for y, row in enumerate(_FONT[ch]):
            for x, c in enumerate(row):
                if c == "X":
                    a[y, x] = C.ci("bone")
        out.append(a)
    return out


SPRITES = {
    "shell_fill": fill, "shell_bezel_h": bezel_h, "shell_bezel_v": bezel_v, "shell_bezel_corner": bezel_corner,
    "shell_rivet": rivet, "shell_screw": screw, "shell_rune": rune, "shell_grille": grille, "shell_pause": pause_pill,
    "shell_plate_end": plate_ends, "shell_plate_mid": plate_mid, "shell_cap_l": cap_large, "shell_cap_s": cap_small,
    "shell_lamp": lamps, "shell_glyph": glyphs,
}


def board(sprites, title):
    """assets/preview/shell_parts.png: every shell sprite at 4x on the fill, plus a sample assembly."""
    from .palette import RGB
    pal = np.array(RGB + [(28, 35, 48)], dtype=np.uint8)
    W_ = 200
    blocks = []
    for name in SPRITES:
        fr = sprites[name]
        h = fr[0].shape[0] + 2
        row = np.full((h, W_), C.ci("bg1"), dtype=np.int16)
        x = 1
        for f in fr:
            if x + f.shape[1] > W_:
                break
            m = f != C.T
            row[1:1 + f.shape[0], x:x + f.shape[1]][m] = f[m]
            x += f.shape[1] + 2
        blocks.append(row)
    a = np.concatenate(blocks, 0)
    return np.repeat(np.repeat(pal[a], 4, 0), 4, 1)
