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
from PIL import Image  # noqa: E402
from nglib import arena_previews as AP  # noqa: E402
from nglib import board, effects, heroes, threats  # noqa: E402
from nglib import canvas as C  # noqa: E402
from nglib import spec  # noqa: E402
from nglib.pack import pack  # noqa: E402

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
    for mod in (heroes.SPRITES, threats.SPRITES, effects.SPRITES):
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


def main():
    for sub in ("sprites", "backgrounds", "atlas", "preview", "data"):
        shutil.rmtree(os.path.join(ASSETS, sub), ignore_errors=True)

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
        "portalClearRadius": lay["portalClearRadius"], "hollows": lay["hollows"], "runes": lay["runes"]})

    title = read_title().upper()
    pv = lambda n: os.path.join(ASSETS, "preview", n)  # noqa: E731
    save(board.style_board(art, game, list(spec.SPRITES), title), pv("style_board.png"))
    save(board.stress_board(art, game, title), pv("stress_board.png"))
    save(AP.arena_board(art, game), pv("arena_board.png"))
    Image.fromarray(AP.translucency_demo(art, game)).save(pv("translucency_demo.png"), optimize=False)
    save(AP.variation_board(art), pv("variation_board.png"))
    save(AP.animation_strips(art), pv("animation_strips.png"))
    for n in art["notes"]:
        print("note:", n)
    print(f"generated {len(sprites)} sprites ({len(art['sprites'])} arena), {len(art['props'])} placed props, "
          f"{len(backgrounds)} backgrounds, atlas {atlas.shape[1]}x{atlas.shape[0]}")


if __name__ == "__main__":
    main()
