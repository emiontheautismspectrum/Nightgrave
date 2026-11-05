"""Deterministic shelf packer producing a Phaser 3 'JSON hash' atlas."""
from . import canvas as C

PAD = 1


def pack(sheets, width=256):
    """sheets: dict name -> list of frames. Returns (atlas_array, json_dict)."""
    items = []
    for name, frames in sheets.items():
        for i, f in enumerate(frames):
            items.append((f"{name}_{i}", f))
    items.sort(key=lambda it: (-it[1].shape[0], -it[1].shape[1], it[0]))
    x = y = shelf_h = 0
    placed = []
    for key, f in items:
        h, w = f.shape
        if x + w + PAD > width:
            x, y = 0, y + shelf_h + PAD
            shelf_h = 0
        placed.append((key, f, x, y))
        x += w + PAD
        shelf_h = max(shelf_h, h)
    height = y + shelf_h
    hp = 1
    while hp < height:
        hp *= 2
    atlas = C.new(width, hp)
    frames = {}
    for key, f, fx, fy in sorted(placed, key=lambda p: p[0]):
        h, w = f.shape
        atlas[fy:fy + h, fx:fx + w] = f
        frames[key] = {
            "frame": {"x": fx, "y": fy, "w": w, "h": h},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        }
    meta = {"app": "nightgrave tools/gen_assets.py", "version": "1", "image": "nightgrave.png",
            "format": "RGBA8888", "size": {"w": width, "h": hp}, "scale": "1"}
    return atlas, {"frames": frames, "meta": meta}
