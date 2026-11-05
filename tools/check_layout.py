#!/usr/bin/env python3
"""Arena v2 layout/density check on the generated data (exit 1 on failure).

- density budget inside the arena rect: small decor <= 25, non-landmark trees <= 6, graves 8-12
- >= 45% of the arena area free of any prop bounding box (flat ground decals are not props)
- calm zone: no prop box inside (landmarks: pixel-accurate, since e.g. the giant tree's box is mostly empty)
- portal: no other decor pixel within the clear radius of the altar centre
- graves: >= 24 px from every landmark box, >= 20 px from the altar box, never touching each other
- hollows: >= 30 px from every landmark's pixels and every grave's box
- animation: at most 4 animated landmarks in any 200x120 window
Usage: python3 tools/check_layout.py
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arena_layout as L  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "assets")
ANIMATED_LANDMARKS = {"portal_altar": "altar_flame", "gallows_tree": "gallows_cage", "rune_sword": "rune_sword",
                      "cursed_well": "well_wisp", "hunter_cabin": "cabin_smoke", "hunter_wagon": "hunter_wagon"}


def pixels(p, cache={}):
    if p["sprite"] not in cache:
        cache[p["sprite"]] = np.array(Image.open(os.path.join(A, "sprites", f"{p['sprite']}.png")).convert("RGBA"))[..., 3]
    a = cache[p["sprite"]][:, p["frame"] * p["w"]:(p["frame"] + 1) * p["w"]]
    if p["flip"]:
        a = a[:, ::-1]
    ys, xs = np.nonzero(a == 255)
    return xs + p["x"] + 0.5, ys + p["y"] + 0.5


def box(p):
    return (p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"])


def box_dist(a, b):
    return math.hypot(max(0, max(a[0], b[0]) - min(a[2], b[2])), max(0, max(a[1], b[1]) - min(a[3], b[3])))


def main():
    data = json.load(open(os.path.join(A, "data", "arena_props.json")))
    props, lay = data["props"], data["layout"]
    x0, y0, x1, y1 = lay["arena"]
    cz = lay["calmZone"]
    errs, info = [], []
    real = [p for p in props if p["kind"] != "eyes"]
    small = [p for p in real if p["kind"] == "small"]
    trees = [p for p in real if p["kind"] == "tree"]
    graves = [p for p in real if p["kind"] == "grave"]
    lms = [p for p in real if p["kind"] == "landmark" and not p.get("overlayOf")]
    info.append(f"small decor {len(small)} (<= 25), trees {len(trees)} (<= 6), graves {len(graves)} (8-12), "
                f"fence fragments {sum(p['sprite'].startswith('fence_frag') for p in real)}")
    if len(small) > 25:
        errs.append(f"{len(small)} small decor props (> 25)")
    if len(trees) > 6:
        errs.append(f"{len(trees)} non-landmark trees (> 6)")
    if not 8 <= len(graves) <= 12:
        errs.append(f"{len(graves)} graves (need 8-12)")
    bones = [p for p in real if p["sprite"].startswith(("bone_pile", "skull", "beast_ribcage", "horse_skeleton"))]
    info.append(f"bones/skulls {len(bones)} (<= 4, none in the lower-right quadrant)")
    if len(bones) > 4:
        errs.append(f"{len(bones)} bone/skull props (> 4)")
    for p in bones:
        if p["sprite"] in ("beast_ribcage", "horse_skeleton") or (p["x"] + p["w"] / 2 > 300 and p["baseY"] > 150):
            errs.append(f"bones {p['sprite']} at ({p['x']},{p['y']}) in the lower-right / removed set")
    frags = sum(p["sprite"].startswith("fence_frag") for p in real)
    if not 2 <= frags <= 3:
        errs.append(f"{frags} fence fragments (need 2-3)")
    occ = np.zeros((y1 - y0, x1 - x0), dtype=bool)
    for p in real:
        bx0, by0, bx1, by1 = box(p)
        occ[max(0, by0 - y0):max(0, min(y1, by1) - y0), max(0, bx0 - x0):max(0, min(x1, bx1) - x0)] = True
    free = 1 - occ.mean()
    info.append(f"arena area free of prop boxes: {free * 100:.1f}% (>= {L.FREE_AREA_MIN * 100:.0f}%)")
    if free < L.FREE_AREA_MIN:
        errs.append(f"only {free * 100:.1f}% of the arena is free of props")
    for p in real:
        if p["kind"] == "landmark":
            xs, ys = pixels(p)
            inside = ((xs > cz[0]) & (xs < cz[2]) & (ys > cz[1]) & (ys < cz[3])).any()
        else:
            b = box(p)
            inside = not (b[2] <= cz[0] or b[0] >= cz[2] or b[3] <= cz[1] or b[1] >= cz[3])
        if inside:
            errs.append(f"{p['sprite']} at ({p['x']},{p['y']}) is inside the calm zone")
    px_, py_ = lay["portal"]
    for p in real:
        if p["sprite"] in ("portal_altar", "altar_flame", "altar_chain"):
            continue
        xs, ys = pixels(p)
        d = float(np.sqrt((xs - px_) ** 2 + (ys - py_) ** 2).min()) if len(xs) else 1e9
        if d < lay["portalClearRadius"]:
            errs.append(f"{p['sprite']} is {d:.1f} px from the portal (< {lay['portalClearRadius']})")
    for i, a in enumerate(graves):  # loose clusters: graves never overlap or touch, no twin next to its twin
        for b in graves[i + 1:]:
            d = box_dist(box(a), box(b))
            if d < 1:
                errs.append(f"graves {a['sprite']}@({a['x']},{a['y']}) and {b['sprite']}@({b['x']},{b['y']}) touch")
            if a["sprite"] == b["sprite"] and d < 16:
                errs.append(f"two {a['sprite']} graves stand side by side")
    altar = next(box(p) for p in lms if p["sprite"] == "portal_altar")
    for g in graves:
        if box_dist(box(g), altar) < 20:
            errs.append(f"{g['sprite']} is within 20 px of the altar")
        for lm in lms:
            if lm["sprite"] != "portal_altar" and box_dist(box(g), box(lm)) < 24:
                errs.append(f"{g['sprite']} is within 24 px of {lm['sprite']}")
    worst = 1e9
    for h in lay["hollows"]:
        for lm in lms:
            xs, ys = pixels(lm)
            d = float(np.sqrt((xs - h["x"]) ** 2 + (ys - h["y"]) ** 2).min())
            worst = min(worst, d)
            if d < 30:
                errs.append(f"hollow {h} is {d:.1f} px from {lm['sprite']}")
        for g in graves:
            d = box_dist(box(g), (h["x"], h["y"], h["x"], h["y"]))
            worst = min(worst, d)
            if d < 30:
                errs.append(f"hollow {h} is {d:.1f} px from {g['sprite']}")
    info.append(f"closest landmark/grave to any hollow: {worst:.1f} px (>= 30)")
    anim = [(p["x"] + p["w"] / 2, p["baseY"]) for p in lms if p["sprite"] in ANIMATED_LANDMARKS]
    most = 0
    for wx in range(x0 - 200, x1 + 1, 4):
        for wy in range(y0 - 120, y1 + 1, 4):
            most = max(most, sum(wx <= ax < wx + 200 and wy <= ay < wy + 120 for ax, ay in anim))
    info.append(f"max animated landmarks in a 200x120 window: {most} (<= 4)")
    if most > 4:
        errs.append(f"{most} animated landmarks share a 200x120 window")
    for line in info:
        print(line)
    if errs:
        print(f"LAYOUT CHECK FAILED ({len(errs)}):")
        for e in errs:
            print("  -", e)
        return 1
    print("layout OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
