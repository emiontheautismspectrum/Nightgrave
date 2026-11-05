#!/usr/bin/env python3
"""Run every asset check (noise, layout, readability, palette), print all results, exit 1 if ANY failed.
(A failing check never hides the others, and no threshold is relaxed.)"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
failed = []
for name in ("check_noise.py", "check_layout.py", "check_readability.py", "validate_palette.py"):
    print(f"== {name}")
    if subprocess.run([sys.executable, os.path.join(HERE, name)]).returncode:
        failed.append(name)
print("== checks failed: " + ", ".join(failed) if failed else "== all checks passed")
sys.exit(1 if failed else 0)
