"""Style board: the composed arena with sprites in context + a labelled catalogue, scaled 3x."""
import numpy as np

from . import canvas as C
from . import font
from .arena import FOREST_LAYOUT, H, PROP_LAYOUT, RITUAL_CENTER, RITUAL_ORIGIN, W, rune_positions

SCALE = 3


def compose_ground(bg, sp, telegraph=True):
    a = bg["floor"].copy()
    for name, x, y, _par in FOREST_LAYOUT:
        C.paste(a, bg[name], x, y)
    # fog drifts over the ground and props but under the raised platform, which stays calm and flat
    fog = bg["fog_overlay"]
    for name, x, y in PROP_LAYOUT:
        C.paste(a, sp[name][0], x, y)
    for ty in range(0, H, 256):
        for tx in range(0, W, 256):
            C.paste(a, fog, tx, ty)
    C.paste(a, bg["ground_ritual"], *RITUAL_ORIGIN)
    for g, (rx, ry) in enumerate(rune_positions(*RITUAL_CENTER)):
        C.paste(a, sp[f"rune_glow_{g}"][3 if (telegraph and g == 1) else 0], rx - 5, ry - 5)  # one rune telegraphs
    return a


def compose_arena(bg, sp):
    a = compose_ground(bg, sp)
    actors = [
        ("hero_shadow", 0, 196, 155), ("parry_pulse", 1, 190, 140), ("knight_parry", 1, 194, 144),
        ("hero_shadow", 0, 298, 167), ("dash_trail", 0, 280, 154), ("wisp_idle", 0, 296, 156),
        ("orb_small", 0, 214, 136), ("orb_small", 1, 230, 120), ("orb_small", 0, 250, 110),
        ("orb_large", 0, 170, 120), ("orb_large", 1, 330, 190),
        ("rune_shard", 0, 262, 196), ("rune_shard", 1, 274, 206),
        ("blade", 0, 340, 120), ("blade", 2, 150, 196),
        ("wraith", 0, 230, 216), ("wraith_fade", 1, 300, 90),
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


def stress_board(bg, sp, title, count=80, seed=4242):
    """Readability check: the hero amid ~80 projectiles of every type, over the real arena, at 3x."""
    rng = np.random.default_rng(seed)
    a = compose_ground(bg, sp, telegraph=False)
    cx, cy = RITUAL_CENTER
    kinds = ["orb_small"] * 30 + ["orb_large"] * 12 + ["rune_shard"] * 20 + ["blade"] * 9 + ["wraith"] * 9
    kinds = kinds[:count]
    for i, k in enumerate(kinds):
        while True:
            ang = rng.uniform(0, 2 * np.pi)
            r = 108 * np.sqrt(rng.uniform(0, 1))
            x, y = cx + np.cos(ang) * r, cy + np.sin(ang) * r
            if (x - cx) ** 2 + (y - cy) ** 2 > 18 ** 2:  # keep the hero itself visible
                break
        f = sp[k][int(rng.integers(0, len(sp[k])))]
        C.paste(a, f, int(x - f.shape[1] / 2), int(y - f.shape[0] / 2))
    C.paste(a, sp["hero_shadow"][0], cx - 6, cy + 5)
    C.paste(a, sp["knight_idle"][0], cx - 8, cy - 7)
    C.paste(a, bg["vignette"], 0, 0)
    header = np.full((11, W), C.ci("bg0"), dtype=np.int16)
    font.text(header, 4, 3, f"{title} - STRESS BOARD - HERO + {len(kinds)} PROJECTILES - 3X", "amber")
    board = np.vstack([header, a])
    return np.repeat(np.repeat(board, SCALE, axis=0), SCALE, axis=1)
