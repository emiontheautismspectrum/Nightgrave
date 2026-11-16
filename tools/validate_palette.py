#!/usr/bin/env python3
"""Fail (exit 1) if any asset pixel is off-palette, uses partial alpha, or a sprite breaks size rules.

Usage: python3 tools/validate_palette.py
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gen_arena  # noqa: E402
import gen_assets  # noqa: E402
from nglib import spec  # noqa: E402
from nglib.palette import GROUND_ONLY, NAMES, RESERVED, RGB  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
PAL = np.array(RGB, dtype=np.int32)
RGB_SET_ = set(RGB)
errors = []
# Previews that intentionally show a render-side alpha blend (not game art): exempt from the palette check.
# These composites reproduce the game's render-side alphas (fog, mist, vignette steps, translucency, blur), so they
# contain blended colours by design. All sprites and backgrounds stay strictly palette-pure.
PALETTE_EXEMPT = {"translucency_demo.png", "arena_board.png", "style_board.png", "stress_board.png", "squint_test.png",
                  "noise_compare.png", "arena_v3_compare.png", "ground_closeup.png", "wagon_closeup.png",
                  "arena_v4_compare.png", "cabin_closeup.png", "forest_top_closeup.png",
                  "boss_fight_eye.png", "boss_fight_lich.png",  # real game screenshots (alpha, tints)
                  "menu_title.png", "menu_hero.png", "menu_settings.png", "death_panel.png", "touch_layout.png",
                  "heroes_compare.png", "crisp_dpr125.png", "dash_chevron.png", "best_scores.png", "first_run_hint.png",
                  "intro_frame.png", "desktop_layout.png", "desktop_layout_1366.png", "phone_portrait.png", "phone_landscape.png", "phone_board.png",
                  "og-image.png"}  # link-preview image (the arena with a translucent band), not game art
# Glow overlays are accents OF a landmark: their bright pixels (x placed copies) count against the parent's 2%.
ACCENT_PARENT = {"giant_tree_crack": "giant_tree", "glow_mushrooms": "giant_tree"}
# v2 value hierarchy: share of bone/moon-bright pixels allowed per arena sprite (decor: none; landmarks: accents)
BRIGHT = {"bone", "moon"}
GROUND_ONLY_PROP_MAX = 0.10
# Shell (phone-portrait console body): its own UI rule, see main()
SHELL_ACCENTS = {"amber", "gold", "teal"}
SHELL_COLORS = {"bg0", "bg1", "fog", "stone_dark", "stone", "bone"} | SHELL_ACCENTS


def color_share(px, names):
    op = px[..., 3] == 255
    m = np.zeros(op.shape, dtype=bool)
    for c in names:
        r_, g_, b_ = RGB[NAMES.index(c)]
        m |= op & (px[..., 0] == r_) & (px[..., 1] == g_) & (px[..., 2] == b_)
    return m.sum() / max(1, op.sum())
LANDMARK_BRIGHT_MAX = 0.02
# Reserved-color policy, independent of the generator's own group labels:
#   gameplay sprites (tools/nglib/spec.py) may use any palette color;
#   the explicit exception list below may use violet/violet_dark (telegraphs, eyes, casters) - never red;
#   EVERY other sprite (decor, landmarks, UI frames, fence runs...) and every arena background: no reserved color.
EXCEPTION_PREFIXES = ("rune_glow_", "shade_", "stalker_")
EXCEPTION_NAMES = {"altar_flame_tele", "portal_ignite", "forest_eyes", "portal_smoke", "forest_leaf_ash"}
EXCEPTION_ALLOWED = {"violet", "violet_dark"}
# Boss art (stage ART-B, docs/ASSETS_SPEC.md "Boss art"). The redrawn bosses may use ground-only greens / blues as
# small accents (fern leaves on the Thorn Mother, the mist lining of the Lich King's cloak), like props: <= 10%.
BOSS_ACCENT_PREFIXES = ("thorn_mother_", "lich_king_")
# Colour language of a boss family, per row (the row = the sprite name after the family):
#   bright violet only on the cast rows (the render sends every RED attack of the new art to a row without violet:
#   CAST_ROW in src/render/bossArt.ts; the Eye's one charge row is production art); red only on the row of a red
#   attack's ground cracks;
#   the NEW bodies (thorn_mother, lich_king) keep violet_dark to the same rows too; teal only on the Lich King;
#   gold / amber only as a few pixels of the Thorn Mother (eyes, chest core, a crown glint).
VIOLET_ROWS = ("_cast", "_charge", "_soulfire")
RED_ROWS = ("lich_king_grasp",)
NEW_BODIES = ("thorn_mother_", "lich_king_")
WARM_MAX = 0.02


def err(msg):
    errors.append(msg)


def load(path):
    img = Image.open(path)
    if img.mode not in ("RGBA", "RGB"):
        err(f"{path}: mode {img.mode}, expected RGBA/RGB")
        img = img.convert("RGBA")
    return np.array(img.convert("RGBA"))


def check_pixels(path, px):
    alpha = px[..., 3]
    bad_alpha = ~np.isin(alpha, (0, 255))
    if bad_alpha.any():
        y, x = np.argwhere(bad_alpha)[0]
        err(f"{os.path.relpath(path, ROOT)}: partial alpha {alpha[y, x]} at ({x},{y}); use dithering")
    rgb = px[..., :3].astype(np.int32)
    opaque = alpha == 255
    key = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
    pal_key = (PAL[:, 0] << 16) | (PAL[:, 1] << 8) | PAL[:, 2]
    off = opaque & ~np.isin(key, pal_key)
    if off.any():
        y, x = np.argwhere(off)[0]
        err(f"{os.path.relpath(path, ROOT)}: {int(off.sum())} off-palette px, first #{key[y, x]:06x} at ({x},{y})")


def check_board(images, bp, scale=3):
    """A preview board must exist and be an exact nearest-neighbour upscale."""
    name = os.path.relpath(bp, ASSETS)
    if bp not in images:
        # previews are untracked output: tools/gen_assets.py and check_noise.py write them (npm run assets runs both first)
        err(f"missing {name} (generate it with: npm run assets)")
        return
    b = images[bp]
    if b.shape[0] % scale or b.shape[1] % scale:
        err(f"{name} size is not a multiple of {scale}")
        return
    base = b[::scale, ::scale]
    if not np.array_equal(np.repeat(np.repeat(base, scale, 0), scale, 1), b):
        err(f"{name} is not a clean {scale}x nearest-neighbour upscale")


def main():
    if len(NAMES) != 22:
        err(f"palette has {len(NAMES)} colors, expected 22")
    pngs = sorted(glob.glob(os.path.join(ASSETS, "**", "*.png"), recursive=True))
    if not pngs:
        err("no PNGs under assets/ - run tools/gen_assets.py first")
    images = {}
    for p in pngs:
        images[p] = load(p)
        # phone_*.png: browser screenshots of the phone layouts (tests-e2e), blended like the other screenshots
        if os.path.basename(p) not in PALETTE_EXEMPT and not os.path.basename(p).startswith('phone_'):
            check_pixels(p, images[p])

    # expected sprite table: gameplay sprites (spec.py) + arena sprites (layout-dependent, from the generator)
    art = gen_arena.build()
    expected = dict(spec.SPRITES)
    for n, frames in art["sprites"].items():
        expected[n] = (frames[0].shape[1], frames[0].shape[0], len(frames))
    expected.update(spec.SHELL)
    groups = {**art["groups"], **{n: "shell" for n in spec.SHELL}}

    def reserved_used(px):
        rgb = px[..., :3][px[..., 3] == 255]
        used = {tuple(c) for c in np.unique(rgb.reshape(-1, 3), axis=0)} if len(rgb) else set()
        return {NAMES[RGB.index(c)] for c in used if c in RGB} & RESERVED

    for n in sorted(spec.SPRITES):  # hero, threats, effects, UI: never ground-only colors
        p = os.path.join(ASSETS, "sprites", f"{n}.png")
        if p not in images:
            continue
        gshare = color_share(images[p], GROUND_ONLY)
        if n.startswith(BOSS_ACCENT_PREFIXES):
            if gshare > GROUND_ONLY_PROP_MAX:
                err(f"sprites/{n}.png has {gshare * 100:.1f}% ground-only colors (max {GROUND_ONLY_PROP_MAX * 100:.0f}% on a boss)")
        elif gshare > 0:
            err(f"sprites/{n}.png (gameplay) uses ground-only colors")
    # boss colour language (see the table above)
    for n in sorted(spec.SPRITES):
        fam = next((f for f in spec.BOSS_FAMILIES if n.startswith(f + "_")), None)
        p = os.path.join(ASSETS, "sprites", f"{n}.png")
        if fam is None or p not in images:
            continue
        px = images[p]
        rgb = px[..., :3][px[..., 3] == 255]
        used = {NAMES[RGB.index(tuple(c))] for c in np.unique(rgb.reshape(-1, 3), axis=0) if tuple(c) in RGB_SET_}
        if used & {"blood", "blood_dark"} and n not in RED_ROWS:
            err(f"sprites/{n}.png (boss body) uses red: red only ever means unparryable")
        if "violet" in used and not n.endswith(VIOLET_ROWS):
            err(f"sprites/{n}.png (boss body) uses bright violet outside a violet attack's cast row")
        if "violet_dark" in used and n.startswith(NEW_BODIES) and not n.endswith(VIOLET_ROWS):
            err(f"sprites/{n}.png (boss body) uses violet_dark outside a violet attack's cast row")
        if n in RED_ROWS and used & {"violet", "violet_dark"}:
            err(f"sprites/{n}.png (a red attack's row) uses violet")
        if "teal" in used and fam != "lich_king":
            err(f"sprites/{n}.png uses teal (only the Lich King's flames and smoke; teal = Slow Time)")
        warm = used & {"gold", "amber", "ember"}
        if warm and fam != "thorn_mother":
            err(f"sprites/{n}.png (boss body) uses hero colours {sorted(warm)}")
        elif "ember" in warm or color_share(px, {"gold", "amber"}) > WARM_MAX:
            err(f"sprites/{n}.png: gold / amber are a few pixels only (<= {WARM_MAX * 100:.0f}%), never ember")
    # The phone-portrait shell (UI art, docs/ASSETS_SPEC.md "Shell"): ONLY the body colours (bg0, bg1, fog, stone_dark,
    # stone, bone) and, for the lamps, amber / gold / teal (they already mean hero / double score / slow time in the
    # HUD). Never red or violet (unparryable / parryable), ember, decor-only or ground-only colours.
    for n in sorted(spec.SHELL):
        p = os.path.join(ASSETS, "sprites", f"{n}.png")
        if p not in images:
            err(f"sprites/{n}.png is missing")
            continue
        px = images[p]
        rgb = px[..., :3][px[..., 3] == 255]
        used = {NAMES[RGB.index(tuple(c))] for c in np.unique(rgb.reshape(-1, 3), axis=0)} if len(rgb) else set()
        bad = used - SHELL_COLORS
        if bad:
            err(f"sprites/{n}.png (shell) uses colours outside the shell palette: {sorted(bad)}")
        if n != "shell_lamp" and used & SHELL_ACCENTS:
            err(f"sprites/{n}.png (shell) uses lamp accents {sorted(used & SHELL_ACCENTS)} outside the lamps")
    for n in sorted(expected):
        if n in spec.SPRITES or n in spec.SHELL:
            continue
        p = os.path.join(ASSETS, "sprites", f"{n}.png")
        if p not in images:
            continue
        allowed = EXCEPTION_ALLOWED if (n in EXCEPTION_NAMES or n.startswith(EXCEPTION_PREFIXES)) else set()
        bad = reserved_used(images[p]) - allowed
        if bad:
            err(f"sprites/{n}.png ({groups.get(n, '?')}) uses reserved gameplay colors {sorted(bad)}")
        gshare = color_share(images[p], GROUND_ONLY)
        if groups.get(n) != "arena" and gshare > 0:
            err(f"sprites/{n}.png ({groups.get(n, '?')}) uses ground-only colors")
        elif gshare > GROUND_ONLY_PROP_MAX:
            err(f"sprites/{n}.png has {gshare * 100:.1f}% ground-only colors (max {GROUND_ONLY_PROP_MAX * 100:.0f}% on props)")
        if groups.get(n) == "arena":
            px = images[p]
            op = px[..., 3] == 255
            bright = np.zeros(op.shape, dtype=bool)
            for c in BRIGHT:
                r_, g_, b_ = RGB[NAMES.index(c)]
                bright |= op & (px[..., 0] == r_) & (px[..., 1] == g_) & (px[..., 2] == b_)
            share = bright.sum() / max(1, op.sum())
            limit = LANDMARK_BRIGHT_MAX if n in gen_arena.LANDMARK_STATIC + gen_arena.LANDMARK_ANIM else 0.0
            if n in ACCENT_PARENT:
                fw = expected[n][0]
                per_frame = max(bright[:, i * fw:(i + 1) * fw].sum() for i in range(expected[n][2]))
                copies = sum(q["sprite"] == n for q in json.load(open(os.path.join(ASSETS, "data", "arena_props.json")))["props"])
                parent = images[os.path.join(ASSETS, "sprites", f"{ACCENT_PARENT[n]}.png")][..., 3] == 255
                share = per_frame * copies / max(1, parent.sum())
            if share > limit:
                err(f"sprites/{n}.png has {share * 100:.1f}% bone/moon-bright pixels (max {limit * 100:.0f}%)")
    for n in spec.BACKGROUNDS:  # every arena background is decor
        p = os.path.join(ASSETS, "backgrounds", f"{n}.png")
        if p in images:
            bad = reserved_used(images[p])
            if bad:
                err(f"backgrounds/{n}.png uses reserved gameplay colors {sorted(bad)}")

    # sprite sheet size rules
    found = {os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(ASSETS, "sprites", "*.png"))}
    for name in sorted(found - set(expected)):
        err(f"sprites/{name}.png is not produced by the generators")
    for name, (fw, fh, n) in expected.items():
        p = os.path.join(ASSETS, "sprites", f"{name}.png")
        if p not in images:
            err(f"missing sprite sheet sprites/{name}.png")
            continue
        h, w = images[p].shape[:2]
        if (w, h) != (fw * n, fh):
            err(f"sprites/{name}.png is {w}x{h}, expected {fw * n}x{fh} ({n} frames of {fw}x{fh})")
        for i in range(n):
            if not images[p][:, i * fw:(i + 1) * fw, 3].any():
                err(f"sprites/{name}.png frame {i} is empty")
    for name, (bw, bh) in spec.BACKGROUNDS.items():
        p = os.path.join(ASSETS, "backgrounds", f"{name}.png")
        if p not in images:
            err(f"missing background backgrounds/{name}.png")
        elif images[p].shape[:2] != (bh, bw):
            err(f"backgrounds/{name}.png is {images[p].shape[1]}x{images[p].shape[0]}, expected {bw}x{bh}")

    # atlas: every frame present, in bounds, sized per spec, pixels equal to the source sheet
    ap, jp = os.path.join(ASSETS, "atlas", "nightgrave.png"), os.path.join(ASSETS, "atlas", "nightgrave.json")
    if ap in images and os.path.exists(jp):
        atlas = images[ap]
        frames = json.load(open(jp, encoding="utf-8"))["frames"]
        for name, (fw, fh, n) in expected.items():
            sheet = images.get(os.path.join(ASSETS, "sprites", f"{name}.png"))
            for i in range(n):
                fr = frames.get(f"{name}_{i}")
                if fr is None:
                    err(f"atlas missing frame {name}_{i}")
                    continue
                f, src, ss = fr["frame"], fr["sourceSize"], fr["spriteSourceSize"]
                # a frame is stored whole, or (the dark boss art only) trimmed to its opaque box: then the box must
                # hold every opaque pixel of the source frame and sit inside it
                trimmed = (f["w"], f["h"]) != (fw, fh)
                if trimmed != fr["trimmed"] or (trimmed and not name.startswith(gen_assets.ATLAS_TRIM)):
                    err(f"atlas frame {name}_{i} is trimmed but not on the trim list")
                if ((src["w"], src["h"]) != (fw, fh) or (ss["w"], ss["h"]) != (f["w"], f["h"]) or ss["x"] < 0 or ss["y"] < 0
                        or ss["x"] + ss["w"] > fw or ss["y"] + ss["h"] > fh
                        or f["x"] + f["w"] > atlas.shape[1] or f["y"] + f["h"] > atlas.shape[0]):
                    err(f"atlas frame {name}_{i} has bad rect {f} / {ss}")
                elif sheet is not None:
                    full = np.zeros((fh, fw, 4), dtype=atlas.dtype)
                    full[ss["y"]:ss["y"] + ss["h"], ss["x"]:ss["x"] + ss["w"]] = atlas[f["y"]:f["y"] + f["h"], f["x"]:f["x"] + f["w"]]
                    want = sheet[:, i * fw:(i + 1) * fw].copy()
                    want[want[..., 3] == 0] = 0
                    full[full[..., 3] == 0] = 0
                    if not np.array_equal(full, want):
                        err(f"atlas frame {name}_{i} differs from sprites/{name}.png")
    else:
        err("missing atlas/nightgrave.png or atlas/nightgrave.json")

    # style board: exact 3x nearest-neighbour upscale
    for board, scale in (("style_board", 3), ("stress_board", 3), ("arena_board", 3), ("variation_board", 3),
                         ("animation_strips", 4), ("translucency_demo", 3), ("noise_compare", 2), ("squint_test", 1)):
        check_board(images, os.path.join(ASSETS, "preview", f"{board}.png"), scale)
    pj = os.path.join(ASSETS, "data", "arena_props.json")
    if not os.path.exists(pj):
        err("missing data/arena_props.json")
    else:
        for p in json.load(open(pj, encoding="utf-8"))["props"]:
            if p["sprite"] not in expected or p["frame"] >= expected[p["sprite"]][2]:
                err(f"arena_props.json references missing sprite/frame {p['sprite']}:{p['frame']}")

    if errors:
        print(f"PALETTE/SIZE VALIDATION FAILED ({len(errors)} problems):")
        for e in errors:
            print("  -", e)
        return 1
    print(f"OK: {len(pngs)} PNGs on the {len(NAMES)}-color palette, sizes match, no reserved colors in decor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
