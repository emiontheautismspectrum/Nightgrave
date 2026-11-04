"""Arena previews: arena_board, translucency_demo, variation_board, animation_strips."""
import math

import numpy as np
from PIL import Image

from . import canvas as C
from . import font
from .palette import RGB
from .scene import H, W, compose_scene, upscale


def _hero(cx, cy):
    """Hero actors exactly as GameScene places them (sprite centre y-4, shadow centre y+5)."""
    return [("hero_shadow", 0, cx - 6, cy + 2, cy + 4, False), ("knight_idle", 0, cx - 8, cy - 12, cy + 4, False)]


def arena_board(art, threat_sprites):
    sp = {**art["sprites"], **threat_sprites}
    L = art["layout"]
    rng = np.random.default_rng(777)
    cx, cy = L["heroSpawn"]
    actors = _hero(cx, cy)
    px, py = L["portal"]
    actors.append(("shade_rise", 4, px - 8, py - 18, py + 2, False))
    h = next(h for h in L["hollows"] if h["side"] == "right")
    actors.append(("stalker_emerge", 4, h["x"] - 22, h["y"] - 20, h["y"] + 4, True))
    tele = [("portal_ignite", 2, px - 20, py - 20)]
    tele += [(f"rune_glow_{g}", 3 if g == 2 else 0, r["x"] - 5, r["y"] - 5) for g, r in enumerate(L["runes"])]
    x0, y0, x1, y1 = L["arena"]
    kinds = ["orb_small"] * 14 + ["orb_large"] * 6 + ["rune_shard"] * 9 + ["blade"] * 6 + ["wraith"] * 5
    for k in kinds:
        while True:
            x, y = rng.uniform(x0 + 6, x1 - 6), rng.uniform(y0 + 6, y1 - 6)
            if math.dist((x, y), (cx, cy)) > 22:
                break
        f = sp[k][int(rng.integers(0, len(sp[k])))]
        actors.append((k, int(rng.integers(0, len(sp[k]))), int(x - f.shape[1] / 2), int(y - f.shape[0] / 2), int(y + f.shape[0] / 2), False))
    eyes = [i for i, p in enumerate(art["props"]) if p["sprite"] == "forest_eyes"]
    over = {eyes[0]: 1} if eyes else {}
    a = compose_scene(art["backgrounds"], sp, art["props"], actors, tele, overrides=over)
    return upscale(a, 3)


def _alpha_blend(top_rgba, bottom_rgb, alpha):
    t = top_rgba[..., :3].astype(np.float32)
    m = (top_rgba[..., 3:4] > 0).astype(np.float32) * alpha
    return (t * m + bottom_rgb.astype(np.float32) * (1 - m)).astype(np.uint8)


def translucency_demo(art, threat_sprites):
    """The hero behind a tree, the fence and the cabin: normal vs faded (35% alpha), side by side, 3x.
    (The chapel facade was dropped from the final landmark set; the cabin stands in for it.)
    This preview shows a real alpha blend, so it is exempt from the palette check."""
    sp = {**art["sprites"], **threat_sprites}
    bg = art["backgrounds"]
    props = art["props"]
    picks = []
    for want in ("tree_", "fence_run_", "hunter_cabin"):
        p = next(p for p in props if p["sprite"].startswith(want) and p["kind"] != "forest")
        picks.append(p)
    tiles = []
    for p in picks:
        hx = p["x"] + p["w"] // 2
        hy = p["baseY"] - 6  # just behind the prop's base: the prop is drawn in front
        cw, ch = max(64, p["w"] + 24), max(56, p["h"] + 20)
        x0 = int(np.clip(hx - cw // 2, 0, W - cw))
        y0 = int(np.clip(p["baseY"] - ch + 8, 0, H - ch))
        others = [q for q in props if q is not p]
        base = compose_scene(bg, sp, others, _hero(hx, hy), fog=False)
        rgb_base = np.array(C.to_image(base))[..., :3]
        spr = p and sp[p["sprite"]][p["frame"]]
        if p["flip"]:
            spr = spr[:, ::-1]
        layer = C.new(W, H)
        C.paste(layer, spr, p["x"], p["y"])
        top = np.array(C.to_image(layer))
        normal = _alpha_blend(top, rgb_base, 1.0)
        faded = _alpha_blend(top, rgb_base, 0.35)
        crop = lambda im: im[y0:y0 + ch, x0:x0 + cw]
        tiles.append((crop(normal), crop(faded), p["sprite"]))
    pad = 6
    th = max(t[0].shape[0] for t in tiles)
    tw = sum(t[0].shape[1] * 2 + pad * 3 for t in tiles) + pad
    canvas = np.zeros((th + 14, tw, 3), dtype=np.uint8)
    canvas[:] = RGB[0]
    x = pad
    lab = C.new(tw, 14)
    for n, f, name in tiles:
        canvas[12:12 + n.shape[0], x:x + n.shape[1]] = n
        font.text(lab, x, 3, "NORMAL", "moon")
        x += n.shape[1] + pad
        canvas[12:12 + f.shape[0], x:x + f.shape[1]] = f
        font.text(lab, x, 3, "FADED 35%", "moon")
        x += f.shape[1] + pad * 2
    labrgb = np.array(C.to_image(lab))
    m = labrgb[..., 3] > 0
    canvas[:14][m] = labrgb[..., :3][m]
    return np.repeat(np.repeat(canvas, 3, axis=0), 3, axis=1)


def _grid_board(entries, title, scale, cols_w=W):
    """entries: (label, [frames]) -> labelled grid on a calm background."""
    margin, gap, lab = 6, 8, 7
    x, y, row_h = margin, margin + 10, 0
    placed = []
    for label, frames in entries:
        fh = max(f.shape[0] for f in frames)
        fw = frames[0].shape[1]
        wbox = max(font.width(label), len(frames) * (fw + 2) - 2)
        if x + wbox > cols_w - margin:
            x, y = margin, y + row_h + gap
            row_h = 0
        placed.append((label, frames, x, y))
        x += wbox + gap
        row_h = max(row_h, lab + fh)
    height = y + row_h + margin
    a = np.full((height, cols_w), C.ci("bg1"), dtype=np.int16)
    font.text(a, margin, 3, title, "moon")
    for label, frames, px, py in placed:
        font.text(a, px, py, label.replace("_", " "), "bone")
        fw = frames[0].shape[1]
        for i, f in enumerate(frames):
            C.paste(a, f, px + i * (fw + 2), py + lab)
    return upscale(a, scale)


def variation_board(art):
    sp = art["sprites"]
    entries = []
    for name in sorted(n for n, g in art["groups"].items() if g == "arena" and not n.startswith("fence_run_")):
        frames = sp[name]
        entries.append((name, frames if len(frames) <= 2 else frames[:1]))
    for name in sorted(art["pieces"]):
        entries.append((name, art["pieces"][name]))
    for name in sorted(art["decals"]):
        entries.append((name, art["decals"][name]))
    return _grid_board(entries, "VARIATION BOARD - DECOR VARIANTS - 2 FRAMES = SHADE A / B", 3, cols_w=720)


ANIMS = ["shade_rise", "shade_idle", "shade_cast", "shade_dissolve", "portal_ignite", "portal_smoke",
         "stalker_emerge", "stalker_idle", "stalker_cast", "stalker_vanish", "forest_eyes", "forest_leaf_ash",
         "rune_sword", "gallows_cage", "crow", "hunter_wagon", "well_wisp", "cabin_smoke", "cabin_window",
         "altar_flame", "altar_flame_tele", "altar_chain"] + [f"rune_glow_{g}" for g in range(2)]


def animation_strips(art):
    sp = art["sprites"]
    return _grid_board([(n, sp[n]) for n in ANIMS], "ANIMATION STRIPS - SPAWN / VANISH + LANDMARK LOOPS - 4X", 4, cols_w=400)
