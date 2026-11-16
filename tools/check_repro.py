#!/usr/bin/env python3
"""Reproducibility check (exit 1 on failure): the art is byte-identical on a re-run.

Every sprite sheet, the atlas (PNG + JSON) and the boss review sheets are built IN MEMORY by two fresh Python
processes with different hash seeds; the two digests must be equal to each other and to the files on disk
(assets/sprites, assets/atlas, docs/screenshots/boss_art). Nothing is written, so it is safe to run at any time.

Usage: python3 tools/check_repro.py
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def run(script, seed):
    env = dict(os.environ, PYTHONHASHSEED=str(seed))
    out = subprocess.run([sys.executable, os.path.join(HERE, script), "--digest"], env=env, capture_output=True, text=True)
    if out.returncode:
        print(out.stderr)
        raise SystemExit(f"{script} --digest failed")
    return json.loads(out.stdout.strip().splitlines()[-1])


def sha(path):
    with open(path, "rb") as fp:
        return hashlib.sha256(fp.read()).hexdigest()


def main():
    bad = []
    for script, base, owned in (("gen_assets.py", os.path.join(ROOT, "assets"), None),
                                ("boss_sheet.py", os.path.join(ROOT, "docs", "screenshots", "boss_art"), ("sheet_", "anim_"))):
        a, b = run(script, 1), run(script, 2)
        if a != b:
            bad += [f"{script}: {n} differs between two runs" for n in sorted(set(a) | set(b)) if a.get(n) != b.get(n)]
        for n, h in sorted(a.items()):
            p = os.path.join(base, n)
            if not os.path.exists(p):
                bad.append(f"{os.path.relpath(p, ROOT)} is missing (run the generator)")
            elif sha(p) != h:
                bad.append(f"{os.path.relpath(p, ROOT)} differs from a fresh build")
        if owned:  # no stale sheet left behind
            for n in sorted(os.listdir(base)) if os.path.isdir(base) else []:
                if n.startswith(owned) and n not in a:
                    bad.append(f"{os.path.relpath(os.path.join(base, n), ROOT)} is not produced by {script}")
        print(f"  {script}: {len(a)} files, two fresh builds {'identical' if a == b else 'DIFFER'}")
    if bad:
        print(f"REPRODUCIBILITY CHECK FAILED ({len(bad)} problems):")
        for e in bad[:40]:
            print("  -", e)
        return 1
    print("OK: sprites, atlas and boss sheets are byte-identical on a re-run and match the files on disk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
