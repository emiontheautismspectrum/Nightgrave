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

from nglib import arena, board, effects, heroes, threats  # noqa: E402
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


def main():
    builders = {}
    for mod in (heroes.SPRITES, threats.SPRITES, effects.SPRITES, arena.PROPS):
        builders.update(mod)
    assert set(builders) == set(spec.SPRITES), set(builders) ^ set(spec.SPRITES)
    assert set(arena.BACKGROUNDS) == set(spec.BACKGROUNDS)

    for sub in ("sprites", "backgrounds", "atlas", "preview"):
        shutil.rmtree(os.path.join(ASSETS, sub), ignore_errors=True)

    sprites = {}
    for name in spec.SPRITES:  # spec order = stable order
        frames = builders[name]()
        fw, fh, n = spec.SPRITES[name]
        assert len(frames) == n, f"{name}: {len(frames)} frames, expected {n}"
        for f in frames:
            assert f.shape == (fh, fw), f"{name}: frame {f.shape}, expected {(fh, fw)}"
        sprites[name] = frames
        save(C.strip(frames), os.path.join(ASSETS, "sprites", f"{name}.png"))

    backgrounds = {}
    for name, (w, h) in spec.BACKGROUNDS.items():
        a = arena.BACKGROUNDS[name]()
        assert a.shape == (h, w), f"{name}: {a.shape}"
        backgrounds[name] = a
        save(a, os.path.join(ASSETS, "backgrounds", f"{name}.png"))

    bad = arena.check_props_clear(sprites)
    assert not bad, "props intrude into the play circle: " + "; ".join(bad)

    atlas, atlas_json = pack(sprites)
    save(atlas, os.path.join(ASSETS, "atlas", "nightgrave.png"))
    with open(os.path.join(ASSETS, "atlas", "nightgrave.json"), "w", encoding="utf-8") as fp:
        json.dump(atlas_json, fp, indent=1, sort_keys=True)
        fp.write("\n")
    manifest = {
        "sprites": {n: {"w": w, "h": h, "frames": k} for n, (w, h, k) in spec.SPRITES.items()},
        "backgrounds": {n: {"w": w, "h": h} for n, (w, h) in spec.BACKGROUNDS.items()},
        "layout": {
            "ritualOrigin": list(arena.RITUAL_ORIGIN),
            "ritualCenter": list(arena.RITUAL_CENTER),
            "platformRadius": arena.PLATFORM_RADIUS,
            "forest": [{"name": n, "x": x, "y": y, "parallax": k} for n, x, y, k in arena.FOREST_LAYOUT],
            "props": [{"name": n, "x": x, "y": y} for n, x, y in arena.PROP_LAYOUT],
            "runes": [{"x": x, "y": y} for x, y in arena.rune_positions(*arena.RITUAL_CENTER)],
        },
    }
    with open(os.path.join(ASSETS, "atlas", "manifest.json"), "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, indent=1)
        fp.write("\n")

    sb = board.style_board(backgrounds, sprites, list(spec.SPRITES), read_title().upper())
    save(sb, os.path.join(ASSETS, "preview", "style_board.png"))
    stress = board.stress_board(backgrounds, sprites, read_title().upper())
    save(stress, os.path.join(ASSETS, "preview", "stress_board.png"))
    print(f"generated {len(sprites)} sprites, {len(backgrounds)} backgrounds, atlas {atlas.shape[1]}x{atlas.shape[0]}")


if __name__ == "__main__":
    main()
