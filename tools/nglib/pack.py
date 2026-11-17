"""Deterministic shelf packer producing a Phaser 3 'JSON hash' atlas.

Frames are sorted by height and placed first-fit into shelves (a frame goes into the first shelf that still has room
for it, so the ends of earlier rows are filled). Frames whose name starts with one of `trim` are stored TRIMMED to
their opaque bounding box (Phaser restores the full frame from `spriteSourceSize` / `sourceSize`, so origins and
positions are unchanged); every other frame keeps its full rectangle, as before.
"""
import numpy as np

from . import canvas as C

PAD = 1


def _bbox(f):
    op = f != C.T
    if not op.any():
        return 0, 0, f.shape[1], f.shape[0]
    ys = np.flatnonzero(op.any(axis=1))
    xs = np.flatnonzero(op.any(axis=0))
    return int(xs[0]), int(ys[0]), int(xs[-1] - xs[0] + 1), int(ys[-1] - ys[0] + 1)


def pack(sheets, width=256, trim=()):
    """sheets: dict name -> list of frames. Returns (atlas_array, json_dict)."""
    items = []
    for name, frames in sheets.items():
        for i, f in enumerate(frames):
            box = _bbox(f) if name.startswith(tuple(trim)) and trim else (0, 0, f.shape[1], f.shape[0])
            items.append((f"{name}_{i}", f, box))
    items.sort(key=lambda it: (-it[2][3], -it[2][2], it[0]))
    shelves = []  # [y, height, next x]
    placed = []
    y_next = 0
    for key, f, (bx, by, bw, bh) in items:
        for sh in shelves:
            if sh[1] >= bh and sh[2] + bw + PAD <= width:
                break
        else:
            sh = [y_next, bh, 0]
            shelves.append(sh)
            y_next += bh + PAD
        placed.append((key, f, sh[2], sh[0], (bx, by, bw, bh)))
        sh[2] += bw + PAD
    height = y_next - PAD
    hp = 1
    while hp < height:
        hp *= 2
    atlas = C.new(width, hp)
    frames = {}
    for key, f, fx, fy, (bx, by, bw, bh) in sorted(placed, key=lambda p: p[0]):
        h, w = f.shape
        atlas[fy:fy + bh, fx:fx + bw] = f[by:by + bh, bx:bx + bw]
        frames[key] = {
            "frame": {"x": fx, "y": fy, "w": bw, "h": bh},
            "rotated": False, "trimmed": (bw, bh) != (w, h),
            "spriteSourceSize": {"x": bx, "y": by, "w": bw, "h": bh},
            "sourceSize": {"w": w, "h": h},
        }
    meta = {"app": "nightgrave tools/gen_assets.py", "version": "1", "image": "nightgrave.png",
            "format": "RGBA8888", "size": {"w": width, "h": hp}, "scale": "1", "usedHeight": height}
    return atlas, {"frames": frames, "meta": meta}
