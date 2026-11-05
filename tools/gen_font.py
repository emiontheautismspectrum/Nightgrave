#!/usr/bin/env python3
"""Pixel-exact bitmap font from Press Start 2P (OFL) for Phaser BitmapText: no browser anti-aliasing, so text stays
crisp at every integer device scale. Glyphs are rendered at 8 px without anti-aliasing (the font is drawn on an 8 px
grid); 16 px text is the same glyphs scaled 2x with nearest-neighbour in the game. Output: public/fonts/px8.png + .xml.
Deterministic. Covers Latin, Latin-1/Extended-A, Greek and Cyrillic; other characters render as '?' in the game.
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = os.path.join(ROOT, "node_modules", "@fontsource", "press-start-2p", "files")
SUBSETS = ["latin", "latin-ext", "greek", "cyrillic"]
RANGES = [(0x20, 0x7E), (0xA0, 0x17F), (0x370, 0x3FF), (0x400, 0x4FF), (0x2018, 0x201E), (0x2026, 0x2026)]
CELL = 8


def glyph(font, ch):
    img = Image.new("L", (16, 16), 0)
    d = ImageDraw.Draw(img)
    d.fontmode = "1"  # no anti-aliasing
    d.text((0, 0), ch, font=font, fill=255)
    a = np.array(img)[:CELL, :CELL]
    return (a > 127).astype(np.uint8)


def main(out_dir=None):
    out_dir = out_dir or os.path.join(ROOT, "public", "fonts")
    fonts = [ImageFont.truetype(os.path.join(FILES, f"press-start-2p-{s}-400-normal.woff"), CELL) for s in SUBSETS]
    blank = [glyph(f, "") for f in fonts]  # .notdef shape of each subset
    chars = []
    for lo, hi in RANGES:
        for cp in range(lo, hi + 1):
            ch = chr(cp)
            for f, nd in zip(fonts, blank):
                g = glyph(f, ch)
                if cp == 0x20 or cp == 0xA0 or (g.any() and not np.array_equal(g, nd)):
                    chars.append((cp, g))
                    break
    cols = 32
    rows = (len(chars) + cols - 1) // cols
    sheet = np.zeros((rows * (CELL + 1), cols * (CELL + 1), 4), dtype=np.uint8)
    xml = [f'<?xml version="1.0"?>\n<font>\n  <info face="px8" size="{CELL}"/>\n  <common lineHeight="{CELL}" base="{CELL}" scaleW="{sheet.shape[1]}" scaleH="{sheet.shape[0]}" pages="1"/>\n  <pages><page id="0" file="px8.png"/></pages>\n  <chars count="{len(chars)}">']
    for i, (cp, g) in enumerate(chars):
        x, y = (i % cols) * (CELL + 1), (i // cols) * (CELL + 1)
        sheet[y:y + CELL, x:x + CELL][g == 1] = (255, 255, 255, 255)  # white: tinted to palette colours in the game
        xml.append(f'    <char id="{cp}" x="{x}" y="{y}" width="{CELL}" height="{CELL}" xoffset="0" yoffset="0" xadvance="{CELL}" page="0"/>')
    xml.append("  </chars>\n</font>\n")
    os.makedirs(out_dir, exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(os.path.join(out_dir, "px8.png"), optimize=False)
    with open(os.path.join(out_dir, "px8.xml"), "w", encoding="utf-8") as fp:
        fp.write("\n".join(xml))
    return len(chars)


if __name__ == "__main__":
    print("glyphs:", main())
