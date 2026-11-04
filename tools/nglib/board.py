"""Style board: the composed arena with sprites in context + a labelled catalogue, scaled 3x."""
import numpy as np

from . import canvas as C
from . import font
from .arena import W, H, rune_positions

SCALE = 3


def compose_arena(bg, sp):
    a = bg["floor"].copy()
    C.paste(a, bg["bg_forest_far"], 0, 0)
    C.paste(a, bg["bg_forest_near"], 0, 14)
    C.paste(a, bg["ground_ritual"], 120, 28)
    for g, (rx, ry) in enumerate(rune_positions(240, 148)):
        C.paste(a, sp[f"rune_glow_{g}"][g % 4], rx - 5, ry - 5)
    props = [("dead_tree_a", 14, 40), ("dead_tree_b", 438, 52), ("dead_tree_b", 60, 200), ("dead_tree_a", 392, 196),
             ("gravestone_a", 80, 110), ("gravestone_b", 100, 150), ("gravestone_c", 66, 160),
             ("gravestone_a", 380, 120), ("gravestone_c", 400, 92), ("gravestone_b", 372, 158)]
    for name, x, y in props:
        C.paste(a, sp[name][0], x, y)
    # fog sits above the ground but below actors so threats stay readable
    fog = bg["fog_overlay"]
    for ty in range(0, H, 256):
        for tx in range(0, W, 256):
            C.paste(a, fog, tx, ty)
    actors = [
        ("hero_shadow", 0, 196, 155), ("parry_pulse", 1, 190, 140), ("knight_parry", 1, 194, 144),
        ("hero_shadow", 0, 298, 167), ("dash_trail", 0, 280, 154), ("wisp_idle", 0, 296, 156),
        ("orb_small", 0, 214, 136), ("orb_small", 1, 230, 120), ("orb_small", 0, 250, 110),
        ("orb_large", 0, 170, 120), ("orb_large", 1, 330, 190),
        ("rune_shard", 0, 262, 196), ("rune_shard", 1, 274, 206),
        ("blade", 0, 340, 120), ("blade", 2, 150, 196),
        ("wraith", 0, 230, 216), ("wraith_fade", 1, 330, 70),
        ("parry_spark", 0, 208, 138), ("ember_particle", 0, 286, 150), ("cursor_reticle", 0, 250, 150),
    ]
    for name, f, x, y in actors:
        C.paste(a, sp[name][f], x, y)
    C.paste(a, bg["vignette"], 0, 0)
    return a


def catalogue(sp, order):
    margin, gap, lab = 6, 6, 7
    x, y, row_h = margin, margin, 0
    placements = []
    for name in order:
        frames = sp[name]
        fh, fw = frames[0].shape
        wbox = max(font.width(name), len(frames) * (fw + 2) - 2)
        if x + wbox > W - margin:
            x, y = margin, y + row_h + gap
            row_h = 0
        placements.append((name, x, y))
        x += wbox + gap
        row_h = max(row_h, lab + fh)
    height = y + row_h + margin
    a = np.full((height, W), C.ci("bg1"), dtype=np.int16)
    a[C.bayer_mask(W, height, 0.06)] = C.ci("fog")
    a[0, :] = C.ci("stone_dark")
    for name, px, py in placements:
        font.text(a, px, py, name.replace("_", " "))
        fh, fw = sp[name][0].shape
        for i, f in enumerate(sp[name]):
            C.paste(a, f, px + i * (fw + 2), py + lab)
    return a


def style_board(bg, sp, order, title):
    arena = compose_arena(bg, sp)
    cat = catalogue(sp, order)
    header = np.full((11, W), C.ci("bg0"), dtype=np.int16)
    font.text(header, 4, 3, f"{title} - STYLE BOARD - 16 COLOR PALETTE - 480X270 AT 3X", "amber")
    from .palette import NAMES
    for i, n in enumerate(NAMES):  # palette swatches
        header[2:9, W - 4 - (16 - i) * 8:W - 4 - (16 - i) * 8 + 7] = C.ci(n)
    board = np.vstack([header, arena, cat])
    return np.repeat(np.repeat(board, SCALE, axis=0), SCALE, axis=1)
