#!/usr/bin/env python3
"""Regenerate every Nightgrave art asset from scratch. Deterministic: same code => byte-identical PNGs.

Usage: python3 tools/gen_assets.py
"""
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gen_arena  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from nglib import arena_previews as AP  # noqa: E402
from nglib import board, bosses, effects, heroes, threats  # noqa: E402
from nglib import canvas as C  # noqa: E402
from nglib import spec  # noqa: E402
from nglib.pack import pack  # noqa: E402

SCREENSHOT_PREFIXES = ("boss_fight_", "menu_", "death_panel", "touch_layout")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def read_title():
    """TITLE lives in src/config.ts (one constant). Fall back to the working title before it exists."""
    path = os.path.join(ROOT, "src", "config.ts")
    if os.path.exists(path):
        m = re.search(r"TITLE\s*=\s*['\"]([^'\"]+)['\"]", open(path, encoding="utf-8").read())
        if m:
            return m.group(1)
    return "Nightgrave"


def save(a, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    C.to_image(a).save(path, optimize=False)


def gameplay_sprites():
    builders = {}
    for mod in (heroes.SPRITES, threats.SPRITES, effects.SPRITES, bosses.SPRITES):
        builders.update(mod)
    assert set(builders) == set(spec.SPRITES), set(builders) ^ set(spec.SPRITES)
    sprites = {}
    for name in spec.SPRITES:  # spec order = stable order
        frames = builders[name]()
        fw, fh, n = spec.SPRITES[name]
        assert len(frames) == n, f"{name}: {len(frames)} frames, expected {n}"
        for f in frames:
            assert f.shape == (fh, fw), f"{name}: frame {f.shape}, expected {(fh, fw)}"
        sprites[name] = frames
    return sprites


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fp:
        json.dump(data, fp, indent=1, sort_keys=True)
        fp.write("\n")


def boss_board(art, game):
    """Both bosses (all frames), the beam, the boss bar with 12 drawn segments and the pickups, at 3x."""
    from nglib.palette import RGB
    pal = np.array(RGB + [(11, 13, 18)], dtype=np.uint8)
    rows = [["eye_sentinel_idle", "eye_sentinel_charge", "eye_sentinel_hit"], ["eye_sentinel_death"],
            ["lich_mage_idle", "lich_mage_cast", "lich_mage_hit"], ["lich_mage_teleport_out", "lich_mage_teleport_in"],
            ["lich_mage_death"], ["eye_beam", "pickup_slow_time", "pickup_double_score", "pickup_glow"]]
    W_, pad = 560, 4
    blocks = []
    for row in rows:
        h = max(game[n][0].shape[0] for n in row) + pad
        line = np.full((h, W_), C.ci("fog"), dtype=np.int16)
        x = pad
        for n in row:
            for f in game[n]:
                fh, fw = f.shape
                m = f != C.T
                line[pad // 2:pad // 2 + fh, x:x + fw][m] = f[m]
                x += fw + 2
            x += 6
        blocks.append(line)
    bar = np.full((14, W_), C.ci("fog"), dtype=np.int16)
    frame_ = art["sprites"]["boss_bar"][0] if "boss_bar" in art["sprites"] else None
    if frame_ is not None:
        fw = min(W_ - 8, frame_.shape[1])
        m = frame_[:, :fw] != C.T
        bar[2:12, 4:4 + fw][m] = frame_[:, :fw][m]
        seg_w = (fw - 4) / 12
        for k in range(12):
            x0 = int(4 + 2 + k * seg_w) + 1
            x1 = int(4 + 2 + (k + 1) * seg_w) - 1
            bar[4:10, x0:x1] = C.ci("violet_dark" if k >= 9 else "bone")
    blocks.append(bar)
    a = np.concatenate(blocks, 0)
    a = np.where(a < 0, len(RGB), a)
    img = pal[a]
    return np.repeat(np.repeat(img, 3, 0), 3, 1)


def write_web_manifest(title, game):
    """public/manifest.webmanifest + home-screen icons (the wisp on the night colour), so "Add to Home Screen" opens the
    game fullscreen in landscape. Name comes from the TITLE constant."""
    pub = os.path.join(ROOT, "public")
    icons = os.path.join(pub, "icons")
    os.makedirs(icons, exist_ok=True)
    from nglib.palette import RGB
    pal = np.array(RGB, dtype=np.uint8)
    spr = game["wisp_idle"][0]
    for size in (192, 512):
        k = size // 24  # 16 px sprite with a margin, integer scaled
        img = np.zeros((size, size, 3), dtype=np.uint8)
        img[:] = pal[C.ci("bg0")]
        big = np.repeat(np.repeat(spr, k, 0), k, 1)
        o = (size - big.shape[0]) // 2
        m = big != C.T
        region = img[o:o + big.shape[0], o:o + big.shape[1]]
        region[m] = pal[big[m]]
        Image.fromarray(img).save(os.path.join(icons, f"icon-{size}.png"), optimize=False)
    manifest = {
        "name": title, "short_name": title, "start_url": "./", "scope": "./", "display": "fullscreen",
        "orientation": "landscape", "background_color": "#0b0d12", "theme_color": "#0b0d12",
        "icons": [{"src": f"icons/icon-{s_}.png", "sizes": f"{s_}x{s_}", "type": "image/png"} for s_ in (192, 512)],
    }
    with open(os.path.join(pub, "manifest.webmanifest"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, indent=1)
        fp.write("\n")


def main():
    # gameplay/menu screenshots are captured from the running game (tests-e2e/smoke.cjs), not generated: keep them
    pdir = os.path.join(ASSETS, "preview")
    keep = {n: open(os.path.join(pdir, n), "rb").read() for n in (os.listdir(pdir) if os.path.isdir(pdir) else [])
            if n.startswith(SCREENSHOT_PREFIXES)}
    for sub in ("sprites", "backgrounds", "atlas", "preview", "data"):
        shutil.rmtree(os.path.join(ASSETS, sub), ignore_errors=True)
    os.makedirs(pdir, exist_ok=True)
    for n, b in keep.items():
        with open(os.path.join(pdir, n), "wb") as fp:
            fp.write(b)

    game = gameplay_sprites()
    art = gen_arena.build()
    overlap = set(game) & set(art["sprites"])
    assert not overlap, overlap
    sprites = {**game, **art["sprites"]}
    groups = {**{n: "gameplay" for n in game}, **art["groups"]}
    for name, frames in sprites.items():
        save(C.strip(frames), os.path.join(ASSETS, "sprites", f"{name}.png"))

    backgrounds = art["backgrounds"]
    assert set(backgrounds) == set(spec.BACKGROUNDS), set(backgrounds) ^ set(spec.BACKGROUNDS)
    for name, (w, h) in spec.BACKGROUNDS.items():
        assert backgrounds[name].shape == (h, w), f"{name}: {backgrounds[name].shape}"
        save(backgrounds[name], os.path.join(ASSETS, "backgrounds", f"{name}.png"))

    atlas, atlas_json = pack(sprites, width=512)
    save(atlas, os.path.join(ASSETS, "atlas", "nightgrave.png"))
    write_json(os.path.join(ASSETS, "atlas", "nightgrave.json"), atlas_json)
    manifest = {
        "sprites": {n: {"w": f[0].shape[1], "h": f[0].shape[0], "frames": len(f), "group": groups[n]}
                    for n, f in sprites.items()},
        "backgrounds": {n: {"w": w, "h": h} for n, (w, h) in spec.BACKGROUNDS.items()},
        "layout": art["layout"],
    }
    write_json(os.path.join(ASSETS, "atlas", "manifest.json"), manifest)
    write_json(os.path.join(ASSETS, "data", "arena_props.json"), {"props": art["props"], "layout": art["layout"]})
    # gameplay-relevant layout for the sim (portal, hollows, runes, arena rect): read by src/data/arena.ts
    lay = art["layout"]
    write_json(os.path.join(ASSETS, "data", "arena_layout.json"), {
        "arena": lay["arena"], "heroSpawn": lay["heroSpawn"], "calmZone": lay["calmZone"], "portal": lay["portal"],
        "portalClearRadius": lay["portalClearRadius"], "hollows": lay["hollows"], "runes": lay["runes"],
        # ground anchors of solid-looking props (pickups never spawn on them): [x, baseY, radius]
        "propAnchors": [[pr["x"] + pr["w"] // 2, pr["baseY"], max(4, min(20, pr["w"] // 2))] for pr in art["props"]
                        if pr["kind"] in ("landmark", "grave", "tree")]})
    os.makedirs(os.path.join(ASSETS, "data"), exist_ok=True)

    title = read_title().upper()
    pv = lambda n: os.path.join(ASSETS, "preview", n)  # noqa: E731
    os.makedirs(os.path.join(ASSETS, "preview"), exist_ok=True)
    rgb = lambda a, n: Image.fromarray(a).save(pv(n), optimize=False)  # noqa: E731
    rgb(board.style_board(art, game, list(spec.SPRITES), title), "style_board.png")
    rgb(board.stress_board(art, game, title), "stress_board.png")
    ab = AP.arena_board(art, game)
    rgb(ab, "arena_board.png")
    rgb(AP.squint_test(ab), "squint_test.png")
    scene = AP.scene_only(art, game)  # the composed arena without threats, for close-ups
    rgb(np.repeat(np.repeat(scene[0:70, 140:400], 2, 0), 2, 1), "forest_top_closeup.png")
    rgb(np.repeat(np.repeat(scene[176:270, 0:120], 4, 0), 4, 1), "cabin_closeup.png")
    rgb(AP.translucency_demo(art, game), "translucency_demo.png")
    save(AP.variation_board(art), pv("variation_board.png"))
    save(AP.animation_strips(art), pv("animation_strips.png"))
    rgb(boss_board(art, game), "boss_board.png")
    write_web_manifest(read_title(), game)
    for n in art["notes"]:
        print("note:", n)
    print(f"generated {len(sprites)} sprites ({len(art['sprites'])} arena), {len(art['props'])} placed props, "
          f"{len(backgrounds)} backgrounds, atlas {atlas.shape[1]}x{atlas.shape[0]}")


if __name__ == "__main__":
    main()
