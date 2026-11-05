#!/usr/bin/env python3
"""Audio file check: which AUDIO_LIST.md files are present or missing in assets/audio/, wrong extensions or names,
and files longer than 3x the listed duration (MP3 duration measured by walking the frame headers; VBR-safe).

Usage: python3 tools/check_audio.py   (npm run audio:check). Missing files are fine (the game falls back to
synthesized sound); the exit code is non-zero only for wrong names/extensions or too-long files.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "assets", "audio")
LIST = os.path.join(ROOT, "AUDIO_LIST.md")

BITRATES = {  # MPEG-1 / MPEG-2(.5) Layer III, kbps
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def listed():
    """{file name: max listed duration in seconds} from the markdown tables."""
    out = {}
    for line in open(LIST, encoding="utf-8"):
        m = re.match(r"\|\s*([a-z0-9_]+\.mp3)\s*\|\s*([0-9.]+)(?:\s*-\s*([0-9.]+))?\s*\|", line)
        if m:
            out[m.group(1)] = float(m.group(3) or m.group(2))
    return out


def mp3_duration(path):
    data = open(path, "rb").read()
    i = 0
    if data[:3] == b"ID3" and len(data) > 10:  # skip an ID3v2 tag
        i = 10 + ((data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F))
    secs, frames = 0.0, 0
    while i + 4 <= len(data):
        if data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        ver = (data[i + 1] >> 3) & 3  # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        layer = (data[i + 1] >> 1) & 3
        br_i = data[i + 2] >> 4
        sr_i = (data[i + 2] >> 2) & 3
        pad = (data[i + 2] >> 1) & 1
        if ver == 1 or layer != 1 or br_i in (0, 15) or sr_i == 3:
            i += 1
            continue
        br = BITRATES[1 if ver == 3 else 2][br_i] * 1000
        sr = RATES[ver][sr_i]
        spf = 1152 if ver == 3 else 576
        size = (spf // 8) * br // sr + pad
        if size < 4:
            i += 1
            continue
        secs += spf / sr
        frames += 1
        i += size
    return secs if frames else None


def main():
    want = listed()
    have = sorted(os.listdir(AUDIO)) if os.path.isdir(AUDIO) else []
    problems = 0
    print(f"audio folder: {os.path.relpath(AUDIO, ROOT)}  ({len(want)} files listed in AUDIO_LIST.md)")
    for name, dur in sorted(want.items()):
        if name in have:
            d = mp3_duration(os.path.join(AUDIO, name))
            if d is None:
                print(f"  BROKEN   {name}: no MP3 frames found (the game treats it as missing)")
                problems += 1
            elif d > 3 * dur:
                print(f"  TOO LONG {name}: {d:.1f}s (listed {dur:g}s, limit {3 * dur:g}s)")
                problems += 1
            else:
                print(f"  present  {name}  {d:.1f}s")
        else:
            stem = name[:-4]
            other = [h for h in have if os.path.splitext(h)[0] == stem]
            if other:
                print(f"  WRONG EXT {other[0]} (expected {name})")
                problems += 1
            else:
                print(f"  missing  {name}  (synthesized fallback)")
    for h in have:
        if h not in want and h != "README.txt" and not any(os.path.splitext(h)[0] == n[:-4] for n in want) and not h.startswith("."):
            print(f"  UNKNOWN  {h} (not in AUDIO_LIST.md; check the name)")
            problems += 1
    print(f"{len([n for n in want if n in have])}/{len(want)} present, {problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
