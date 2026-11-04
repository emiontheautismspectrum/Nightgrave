"""Style board and stress board on the revised arena (3x)."""
import numpy as np

from . import canvas as C
from . import font
from .palette import NAMES
from .scene import W, compose_scene, upscale

SCALE = 3


def _header(text):
    h = np.full((11, W), C.ci("bg0"), dtype=np.int16)
    font.text(h, 4, 3, text, "amber")
    return h


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
    a[0, :] = C.ci("stone_dark")
    for name, px, py in placements:
        font.text(a, px, py, name.replace("_", " "))
        fh, fw = sp[name][0].shape
        for i, f in enumerate(sp[name]):
            C.paste(a, f, px + i * (fw + 2), py + lab)
    return a


def style_board(art, game, order, title):
    """Gameplay sprites in context on the revised arena + a labelled catalogue of every gameplay sprite."""
    sp = {**art["sprites"], **game}
    cx, cy = art["layout"]["heroSpawn"]
    actors = [("hero_shadow", 0, cx - 6, cy + 2, cy + 4, False), ("parry_pulse", 1, cx - 12, cy - 14, cy + 4, False),
              ("knight_parry", 1, cx - 8, cy - 12, cy + 4, False),
              ("hero_shadow", 0, cx + 54, cy + 22, cy + 24, False), ("dash_trail", 0, cx + 40, cy + 4, cy + 23, False),
              ("wisp_idle", 0, cx + 52, cy + 8, cy + 24, False),
              ("orb_small", 0, cx + 20, cy - 20, cy - 14, False), ("orb_large", 0, cx - 60, cy - 30, cy - 20, False),
              ("rune_shard", 0, cx + 30, cy + 40, cy + 48, False), ("blade", 0, cx + 90, cy - 30, cy - 14, False),
              ("wraith", 0, cx - 40, cy + 40, cy + 56, False)]
    scene = compose_scene(art["backgrounds"], sp, art["props"], actors)
    sw = np.full((11, W), C.ci("bg0"), dtype=np.int16)
    head = _header(f"{title} - STYLE BOARD - 19 COLOR PALETTE - 480X270 AT 3X")
    for i, n in enumerate(NAMES):
        head[2:9, W - 4 - (len(NAMES) - i) * 8:W - 4 - (len(NAMES) - i) * 8 + 7] = C.ci(n)
    del sw
    return upscale(np.vstack([head, scene, catalogue(sp, order)]), SCALE)


def stress_board(art, game, title, count=80, seed=4242):
    """Readability check: the hero amid ~80 projectiles of every type over the full revised scene, at 3x."""
    sp = {**art["sprites"], **game}
    rng = np.random.default_rng(seed)
    x0, y0, x1, y1 = art["layout"]["arena"]
    cx, cy = art["layout"]["heroSpawn"]
    heroes = [(cx, cy), (x0 + 30, y1 - 14)]
    kinds = (["orb_small"] * 30 + ["orb_large"] * 12 + ["rune_shard"] * 20 + ["blade"] * 9 + ["wraith"] * 9)[:count]
    actors = []
    for hx, hy in heroes:
        actors += [("hero_shadow", 0, hx - 6, hy + 2, hy + 4, False), ("knight_idle", 0, hx - 8, hy - 12, hy + 4, False)]
    for k in kinds:
        while True:
            x, y = rng.uniform(x0 + 4, x1 - 4), rng.uniform(y0 + 4, y1 - 4)
            if all((x - hx) ** 2 + (y - hy) ** 2 > 100 for hx, hy in heroes):
                break
        f = int(rng.integers(0, len(sp[k])))
        h, w = sp[k][f].shape
        actors.append((k, f, int(x - w / 2), int(y - h / 2), int(y + h / 2), False))
    scene = compose_scene(art["backgrounds"], sp, art["props"], actors)
    head = _header(f"{title} - STRESS BOARD - 2 HEROES + {len(kinds)} PROJECTILES - 3X")
    return upscale(np.vstack([head, scene]), SCALE)
