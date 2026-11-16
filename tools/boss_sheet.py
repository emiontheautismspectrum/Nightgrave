#!/usr/bin/env python3
"""Boss art review sheets (stage ART-B) -> docs/screenshots/boss_art/. Deterministic (byte-identical on a re-run).

Per boss:
- sheet_<boss>.png: every frame of every row at 4x on the floor colour, next to the concept reference
  (docs/art_refs/, scaled to the same height: REFERENCE ONLY, it is never an input of a sprite), plus a squint-test
  band: the key frames at 1x on the four floor tones a boss can stand on.
- anim_<boss>.gif: the rows played in sequence at 3x (idle, cast, ..., death).
And sheet_effects.png (the effect sprites of the boss moves at 4x) and sheet_silhouettes.png (the squint test of the
whole cast: flat silhouettes at 2x and 1x, then the idle sprites at 1x on the four floor tones).

Usage: python3 tools/boss_sheet.py            (writes the files)
       python3 tools/boss_sheet.py --digest   (prints {file: sha256} of what it WOULD write; tools/check_repro.py)
"""
import hashlib
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
import importlib  # noqa: E402

from nglib import canvas as C  # noqa: E402
from nglib import font  # noqa: E402
from nglib.palette import RGB  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "screenshots", "boss_art")
REFS = os.path.join(ROOT, "docs", "art_refs")
FLOOR = "fog"
SQUINT_TONES = ("bg1", "fog", "mist", "stone_dark")
SCALE, ANIM_SCALE = 4, 3

BUILD = {}
for _m in ("bosses", "bosses2", "thorn_queen", "lich_king", "toller_fx"):
    try:
        BUILD.update(importlib.import_module(f"nglib.{_m}").SPRITES)
    except ModuleNotFoundError:  # a sheet shows whatever boss art exists
        pass

BOSSES = {
    "thorn_mother": {"ref": "thorn_mother.png", "rows": ["idle", "cast", "lash", "hedge", "hit", "death", "sink", "emerge"],
                     "anim": ["idle", "cast", "hedge", "hit", "sink", "emerge", "death"]},
    "lich_king": {"ref": "lich.png", "rows": ["idle", "cast", "grasp", "hit", "death", "teleport_out", "teleport_in"],
                  "anim": ["idle", "cast", "grasp", "hit", "teleport_out", "teleport_in", "death"]},
    "toller": {"ref": None, "rows": ["idle", "cast", "strike", "throw", "hit", "death", "tp_out", "tp_in"],
               "anim": ["idle", "cast", "throw", "hit", "tp_out", "tp_in", "death"]},
}
EFFECTS = ["lich_king_soulfire", "bone_hand", "grasp_crack", "chain_iron", "chain_violet", "chain_wrap_iron",
           "chain_wrap_violet", "root_bloom", "bell_ring"]
PAL = np.array(RGB, dtype=np.uint8)


def rgb(idx):
    return PAL[idx]


def page(rows, label_col="bone"):
    """An index canvas at 1x: one labelled line of frames per row name."""
    pad, lab = 3, 7
    frames = {n: BUILD[n]() for n in rows}
    width = max(len(f) * (f[0].shape[1] + pad) for f in frames.values()) + pad
    height = sum(f[0].shape[0] + lab + pad for f in frames.values()) + pad
    a = np.full((height, width), C.ci(FLOOR), dtype=np.int16)
    y = pad
    for n in rows:
        font.text(a, pad, y, n.replace("_", " "), label_col)
        y += lab
        x = pad
        for f in frames[n]:
            h, w = f.shape
            m = f != C.T
            a[y:y + h, x:x + w][m] = f[m]
            x += w + pad
        y += frames[n][0].shape[0] + pad
    return a


def up(img, k):
    return np.repeat(np.repeat(img, k, 0), k, 1)


def squint(boss, rows):
    """The key frames (the first frame of every row + the last of the long ones) at 1x on the floor tones."""
    keys = []
    for n in rows:
        fr = BUILD[f"{boss}_{n}"]()
        keys.append(fr[0])
        if len(fr) >= 4:
            keys.append(fr[-1])
    h = max(f.shape[0] for f in keys)
    w = sum(f.shape[1] + 2 for f in keys) + 2
    bands = []
    for tone in SQUINT_TONES:
        a = np.full((h + 4, w), C.ci(tone), dtype=np.int16)
        x = 2
        for f in keys:
            fh, fw = f.shape
            m = f != C.T
            a[2 + h - fh:2 + h, x:x + fw][m] = f[m]
            x += fw + 2
        bands.append(a)
    return rgb(np.concatenate(bands, 0))


def reference(name, height):
    """The concept reference scaled to `height` (review only; quantized to 64 colours to keep the sheet small)."""
    im = Image.open(os.path.join(REFS, name)).convert("RGB")
    w = max(1, round(im.width * height / im.height))
    im = im.resize((w, height), Image.LANCZOS).quantize(64, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    return np.array(im)


def png_bytes(img):
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def sheet(boss, cfg):
    rows = [f"{boss}_{n}" for n in cfg["rows"]]
    main = up(rgb(page(rows)), SCALE)
    sq = squint(boss, cfg["rows"])
    fh = BUILD[rows[0]]()[0].shape[0]
    parts = []
    if cfg["ref"]:
        parts.append(reference(cfg["ref"], fh * SCALE))
    floor = PAL[C.ci(FLOOR)]
    side_w = max([p.shape[1] for p in parts] + [sq.shape[1]]) + 8
    side = np.zeros((main.shape[0], side_w, 3), dtype=np.uint8)
    side[:] = floor
    y = 8
    for p in parts + [sq]:
        if y + p.shape[0] > side.shape[0]:
            break
        side[y:y + p.shape[0], 4:4 + p.shape[1]] = p
        y += p.shape[0] + 12
    return np.concatenate([side, main], 1)


def anim(boss, cfg):
    """GIF bytes: the rows in sequence at 3x on the floor colour (a global palette = the game palette)."""
    seq = []
    for n in cfg["anim"]:
        fr = BUILD[f"{boss}_{n}"]()
        ms = 160 if n == "idle" else 120
        for i, f in enumerate(fr):
            seq.append((f, ms if i < len(fr) - 1 else ms * 3))
    h, w = seq[0][0].shape
    pal = []
    for r_, g_, b_ in RGB:
        pal += [r_, g_, b_]
    pal += [0] * (768 - len(pal))
    images = []
    for f, _ in seq:
        a = np.where(f == C.T, C.ci(FLOOR), f).astype(np.uint8)
        im = Image.fromarray(up(a, ANIM_SCALE), "P")
        im.putpalette(pal)
        images.append(im)
    buf = io.BytesIO()
    images[0].save(buf, format="GIF", save_all=True, append_images=images[1:], duration=[d for _, d in seq], loop=0,
                   optimize=False, disposal=1)
    return buf.getvalue()


def build():
    out = {}
    for boss, cfg in BOSSES.items():
        cfg = dict(cfg, rows=[n for n in cfg["rows"] if f"{boss}_{n}" in BUILD], anim=[n for n in cfg["anim"] if f"{boss}_{n}" in BUILD])
        if not cfg["rows"]:
            continue
        out[f"sheet_{boss}.png"] = png_bytes(sheet(boss, cfg))
        out[f"anim_{boss}.gif"] = anim(boss, cfg)
    out["sheet_effects.png"] = png_bytes(up(rgb(page([n for n in EFFECTS if n in BUILD])), SCALE))
    out["sheet_silhouettes.png"] = png_bytes(silhouettes())
    return out


def silhouettes():
    """The squint test of the whole cast: every boss as a flat silhouette at 1x and 2x (can each be named from its
    outline alone?), then the idle sprites at 1x on the four floor tones."""
    names = [n for n in ("eye_sentinel_idle", "lich_mage_idle", "lich_king_idle", "thorn_mother_idle", "toller_idle") if n in BUILD]
    frames = [BUILD[n]()[0] for n in names]
    h = max(f.shape[0] for f in frames)
    w = sum(f.shape[1] + 6 for f in frames) + 6

    def band(tone, flat, k):
        a = np.full((h + 6, w), C.ci(tone), dtype=np.int16)
        x = 6
        for f in frames:
            fh, fw = f.shape
            m = f != C.T
            a[3 + h - fh:3 + h, x:x + fw][m] = C.ci("bone") if flat else f[m]
            x += fw + 6
        return up(rgb(a), k)

    top = band("bg0", True, 2)
    rows = [band("bg0", True, 1)] + [band(t, False, 1) for t in SQUINT_TONES]
    small = np.concatenate(rows, 0)
    pad = np.zeros((small.shape[0], top.shape[1] - small.shape[1], 3), dtype=np.uint8)
    pad[:] = PAL[C.ci("bg0")]
    return np.concatenate([top, np.concatenate([small, pad], 1)], 0)


def files_on_disk():
    """The sheet files this tool owns (the game screenshots in the same folder are captured, not generated)."""
    return [n for n in sorted(os.listdir(OUT)) if n.startswith(("sheet_", "anim_"))] if os.path.isdir(OUT) else []


def main():
    files = build()
    if "--digest" in sys.argv:
        print(json.dumps({n: hashlib.sha256(b).hexdigest() for n, b in sorted(files.items())}))
        return 0
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for n, b in files.items():
        with open(os.path.join(OUT, n), "wb") as fp:
            fp.write(b)
        total += len(b)
    print(f"boss sheets: {len(files)} files, {total / 1024:.0f} KB -> {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
