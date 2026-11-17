"""Digests for the reproducibility check (tools/check_repro.py).

Two kinds per generated file:
- "bytes": sha256 of the encoded file. Two fresh builds in the SAME environment must agree on it.
- "pixels": sha256 of the DECODED image (frame count, then every frame's size and RGBA bytes). This is what is
  compared with the files committed to the repository: a PNG / GIF written by another Pillow or zlib version holds
  the same pixels in different bytes. A JSON file has no pixels: its "pixels" digest is its exact bytes.
"""
import hashlib
import io

from PIL import Image

IMAGE_EXT = (".png", ".gif")


def pixel_digest(data):
    """sha256 over the decoded image: the number of frames, then per frame its size and its RGBA pixels."""
    im = Image.open(io.BytesIO(data))
    n = getattr(im, "n_frames", 1)
    h = hashlib.sha256(f"frames:{n};".encode())
    for i in range(n):
        im.seek(i)
        fr = im.convert("RGBA")
        h.update(f"{fr.width}x{fr.height};".encode())
        h.update(fr.tobytes())
    return h.hexdigest()


def content_digest(name, data):
    """The digest a file on disk is compared by: decoded pixels for an image, exact bytes for anything else."""
    return pixel_digest(data) if name.lower().endswith(IMAGE_EXT) else hashlib.sha256(data).hexdigest()


def digests(files):
    """files: {name: bytes} -> {"bytes": {name: sha256}, "pixels": {name: sha256}} (sorted by name)."""
    names = sorted(files)
    return {"bytes": {n: hashlib.sha256(files[n]).hexdigest() for n in names},
            "pixels": {n: content_digest(n, files[n]) for n in names}}
