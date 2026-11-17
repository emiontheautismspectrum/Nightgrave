#!/usr/bin/env python3
"""Reproducibility check (exit 1 on failure): the art is the same on a re-run.

Every sprite sheet, the atlas (PNG + JSON) and the boss review sheets are built IN MEMORY by two fresh Python
processes with different hash seeds.
1. The two fresh builds must be IDENTICAL: the same encoded bytes and the same decoded pixels for every file.
2. The files on disk (assets/sprites, assets/atlas, docs/screenshots/boss_art) must match a fresh build by CONTENT:
   decoded pixels (frame count, sizes, RGBA) for PNG / GIF, exact bytes for JSON. Encoded image bytes are NOT
   compared with the repository: another Pillow or zlib version writes the same pixels as different bytes.
Nothing is written, so it is safe to run at any time.

Usage: python3 tools/check_repro.py
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from nglib import repro  # noqa: E402


def run(script, seed):
    env = dict(os.environ, PYTHONHASHSEED=str(seed))
    out = subprocess.run([sys.executable, os.path.join(HERE, script), "--digest"], env=env, capture_output=True, text=True)
    if out.returncode:
        print(out.stderr)
        raise SystemExit(f"{script} --digest failed")
    return json.loads(out.stdout.strip().splitlines()[-1])


def main():
    bad = []
    for script, base, owned in (("gen_assets.py", os.path.join(ROOT, "assets"), None),
                                ("boss_sheet.py", os.path.join(ROOT, "docs", "screenshots", "boss_art"), ("sheet_", "anim_"))):
        a, b = run(script, 1), run(script, 2)
        same = a == b
        if not same:
            for kind in ("bytes", "pixels"):
                bad += [f"{script}: {n} differs between two fresh builds ({kind})"
                        for n in sorted(set(a[kind]) | set(b[kind])) if a[kind].get(n) != b[kind].get(n)]
        encoded = 0
        for n, want in sorted(a["pixels"].items()):
            p = os.path.join(base, n)
            if not os.path.exists(p):
                bad.append(f"{os.path.relpath(p, ROOT)} is missing (run the generator)")
                continue
            with open(p, "rb") as fp:
                data = fp.read()
            try:
                got = repro.content_digest(n, data)
            except Exception as e:  # an unreadable image is a difference, not a crash
                bad.append(f"{os.path.relpath(p, ROOT)} cannot be decoded ({e})")
                continue
            if got != want:
                what = "pixels" if n.lower().endswith(repro.IMAGE_EXT) else "bytes"
                bad.append(f"{os.path.relpath(p, ROOT)} differs from a fresh build ({what})")
            elif hashlib.sha256(data).hexdigest() != a["bytes"][n]:
                encoded += 1  # the same pixels, written by another Pillow / zlib: fine
        if owned:  # no stale sheet left behind
            for n in sorted(os.listdir(base)) if os.path.isdir(base) else []:
                if n.startswith(owned) and n not in a["pixels"]:
                    bad.append(f"{os.path.relpath(os.path.join(base, n), ROOT)} is not produced by {script}")
        note = f"; {encoded} on disk are encoded differently (same pixels)" if encoded else ""
        print(f"  {script}: {len(a['pixels'])} files, two fresh builds {'identical' if same else 'DIFFER'}{note}")
    if bad:
        print(f"REPRODUCIBILITY CHECK FAILED ({len(bad)} problems):")
        for e in bad[:40]:
            print("  -", e)
        return 1
    print("OK: two fresh builds are identical, and the files on disk hold the same pixels (PNG / GIF) and bytes (JSON)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
