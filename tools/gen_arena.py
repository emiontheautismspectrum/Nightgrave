#!/usr/bin/env python3
"""Arena art: decor variants, landmarks, casters, composed ground + forest layers, placed props.

`build()` is used by tools/gen_assets.py (so `npm run assets` stays the single command); running this file directly
just builds and prints a summary.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import arena_layout as L  # noqa: E402
from nglib import canvas as C  # noqa: E402
from nglib import casters, compose, decor, landmarks  # noqa: E402
from nglib.arena import rune_glow  # noqa: E402

# Sprite groups decide which colors are allowed (see validate_palette.py):
#   arena     - decor: no reserved gameplay colors
#   telegraph - ground telegraphs (rune glow, violet portal flames) and forest eyes: violet allowed
#   caster    - casters and their spawn/vanish effects: violet allowed
#   ui        - HUD pieces
LANDMARK_STATIC = ["rune_sword_base", "gallows_tree", "horse_skeleton", "cursed_well", "beast_ribcage", "hunter_cabin",
                   "portal_altar"]
LANDMARK_ANIM = ["rune_sword", "gallows_cage", "crow", "hunter_wagon", "well_wisp", "cabin_window", "cabin_smoke",
                 "altar_flame", "altar_chain"]
CASTER = ["shade_idle", "shade_rise", "shade_cast", "shade_dissolve", "stalker_idle", "stalker_emerge", "stalker_cast",
          "stalker_vanish", "portal_smoke", "forest_leaf_ash"]
TELEGRAPH = ["altar_flame_tele", "portal_ignite", "forest_eyes"] + [f"rune_glow_{g}" for g in range(8)]


def build():
    sprites, groups = {}, {}

    def put(d, group):
        for k, v in d.items():
            sprites[k] = v
            groups[k] = group

    for fn in (decor.gravestones, decor.trees, decor.small_decor, decor.fence_pieces, decor.lamps_candles_weapons):
        put(fn(), "arena")
    put({n: getattr(landmarks, n)() for n in LANDMARK_STATIC + LANDMARK_ANIM}, "arena")
    put({n: getattr(casters, n)() for n in CASTER}, "caster")
    put({"altar_flame_tele": landmarks.altar_flame_tele(), "portal_ignite": casters.portal_ignite(),
         "forest_eyes": casters.forest_eyes()}, "telegraph")
    put({f"rune_glow_{g}": rune_glow(g) for g in range(8)}, "telegraph")
    put({"boss_bar": casters.boss_bar()}, "ui")
    pieces = decor.ground_pieces()
    decals = decor.decals()

    placer, poly, runs, gate_pt, notes = compose.place_all(sprites)
    for name, a, b, seg in runs:  # per-layout fence runs (composite sprites)
        spr, (x, y), base = compose.fence_run_sprite(a, b, seg)
        sprites[name] = [spr]
        groups[name] = "arena"
        placer.props.append({"sprite": name, "frame": 0, "x": x, "y": y, "w": spr.shape[1], "h": spr.shape[0],
                             "baseY": base, "flip": False, "shade": 0, "kind": "fence"})
    runes = compose.ritual_runes()
    ground = compose.ground(sprites, pieces, decals, placer.props, poly, gate_pt, runes)
    backgrounds = {
        "forest_far": compose.forest_far(),
        "forest_mid": compose.forest_mid(),
        "forest_near": compose.forest_near(),
        "arena_ground": ground,
        "fog_overlay": compose.fog_overlay(),
        "vignette": compose.vignette(),
    }
    for p in placer.props:  # props standing inside the author's fence contour (calm-zone exemption)
        p["inGraveyard"] = compose.point_in_poly(p["x"] + p["w"] / 2, p["baseY"], poly)
    props = sorted(placer.props, key=lambda p: (p["baseY"], p["x"], p["sprite"]))
    layout = {
        "arena": list(L.ARENA), "heroSpawn": list(L.HERO_SPAWN), "bossBar": list(L.BOSS_BAR), "calmZone": list(L.CALM_ZONE),
        "portal": list(L.pct(L.PORTAL_ALTAR_PCT)), "portalClearRadius": L.PORTAL_CLEAR_RADIUS,
        "hollows": [{"side": s, "x": L.hollow_point(s, p)[0], "y": L.hollow_point(s, p)[1]} for s, p in L.HOLLOWS],
        "fence": [list(p) for p in poly], "gate": [round(gate_pt[0]), round(gate_pt[1])],
        "ritualCenter": list(L.RITUAL_CENTER), "ritualRadius": L.RITUAL_RADIUS,
        "runes": [{"x": x, "y": y} for x, y in runes],
        "forest": [{"name": "forest_far", "parallax": 0.02}, {"name": "forest_mid", "parallax": 0.05},
                   {"name": "forest_near", "parallax": 0.0}],
    }
    return {"sprites": sprites, "groups": groups, "pieces": pieces, "decals": decals, "backgrounds": backgrounds,
            "props": props, "layout": layout, "notes": notes, "poly": poly}


if __name__ == "__main__":
    out = build()
    print(f"{len(out['sprites'])} arena sprites, {len(out['props'])} props, notes: {out['notes']}")
