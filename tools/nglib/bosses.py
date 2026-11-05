"""Boss and pickup sprites (Stage 4). Original designs.

Boss bodies use dark stone, bone and violet_dark only; bright violet and blood red appear only where a frame is a
telegraph (the eye's charge, the lich's cast) and in the beam. Bodies are never lethal (projectiles and beams are).
Pickups: teal = Slow Time, gold = Double Score.
"""
import math

import numpy as np

from . import canvas as C


# ---------------------------------------------------------------- eye sentinel 48x48

def _eye(i=0, look=(0, 0), lid=1.0, glow=None, flash=False, crack=0):
    """A floating carved stone shell around a single bone eye, with four slow orbiting stone shards."""
    S = 48
    a = C.new(S, S)
    xx, yy = C.grid(S, S)
    cx, cy = 24, 22 + (0, -1, -1, 0)[i % 4]  # slow hover bob
    # shell: an almond of dark stone with a carved rim
    shell = ((xx - cx) / 15.5) ** 2 + ((yy - cy) / 11.5) ** 2 <= 1
    a[shell] = C.ci("stone_dark")
    a[shell & ((xx - cx) + (yy - cy) > 8)] = C.ci("bg1")  # lower-right shade
    a[shell & ((xx - cx) + (yy - cy) < -12)] = C.ci("stone")  # top-left rim light
    # carved notches on the rim (bone rune marks)
    for ang in (-2.4, -1.57, -0.7, 0.7, 2.4):
        C.put(a, int(cx + math.cos(ang) * 13), int(cy + math.sin(ang) * 9.5), "violet_dark")
    # the eye socket and the eye
    sock = ((xx - cx) / 10) ** 2 + ((yy - cy) / (6.5 * lid + 0.01)) ** 2 <= 1
    a[shell & sock] = C.ci("bg0")
    white = ((xx - cx) / 8.5) ** 2 + ((yy - cy) / (5.2 * lid + 0.01)) ** 2 <= 1
    a[white] = C.ci("bone")
    if lid > 0.3:
        ix, iy = cx + look[0], cy + look[1]
        iris = (xx - ix) ** 2 + (yy - iy) ** 2 <= 3.6 ** 2
        a[white & iris] = C.ci(glow or "violet_dark")
        a[white & ((xx - ix) ** 2 + (yy - iy) ** 2 <= 1.6 ** 2)] = C.ci("bg0")
        C.put(a, int(ix) - 2, int(iy) - 2, "bone")
    # a lower drip of stone (it hangs, it does not stand)
    for k in range(5):
        C.put(a, cx - 1 + (k % 2), cy + 12 + k, "stone_dark" if k < 3 else "bg1")
    # four orbiting shards
    for k in range(4):
        ang = k * math.pi / 2 + i * math.pi / 8
        sx, sy = cx + math.cos(ang) * 20, cy + math.sin(ang) * 14
        C.disc(a, sx, sy, 2.2, "stone_dark")
        C.put(a, int(sx) - 1, int(sy) - 1, "stone")
    if crack:
        for k in range(crack * 3):
            C.put(a, cx - 8 + k * 2, cy - 7 + (k * 5) % 13, "bg0")
    a = C.outline(a, color="bg0")
    if glow:  # charging: the telegraph glow rings the shell
        a = C.halo(a, glow, phase=i)
    if flash:
        a[(a != C.T) & (a != C.ci("bg0"))] = C.ci("bone")
    return a


def eye_sentinel_idle():
    looks = [(0, 0), (1, 0), (0, 1), (-1, 0)]
    return [_eye(i, looks[i]) for i in range(4)]


def eye_sentinel_charge():
    return [_eye(0, (0, 1), lid=1.0 + 0.1 * k, glow="violet") for k in range(3)]


def eye_sentinel_hit():
    return [_eye(0, (0, 0), lid=0.6, flash=True), _eye(1, (0, 0), lid=0.8)]


def eye_sentinel_death():
    frames = []
    for k in range(6):
        a = _eye(k % 4, (0, 2), lid=max(0.0, 1 - k * 0.2), crack=min(3, k + 1))
        if k >= 2:
            a = C.dither_out(a, 1 - (k - 1) / 5, ox=k, oy=k)
        frames.append(a)
    return frames


def eye_beam():
    """16x4 beam segment (tiled along the beam in code): blood core, blood_dark edges, a moving bone glint."""
    frames = []
    for i in range(2):
        a = C.new(16, 4)
        a[0, :] = C.ci("blood_dark")
        a[3, :] = C.ci("blood_dark")
        a[1:3, :] = C.ci("blood")
        for x in range(i * 4, 16, 8):
            a[1, x:x + 2] = C.ci("bone")
        frames.append(a)
    return frames


# ---------------------------------------------------------------- lich mage 32x40

def _lich(i=0, arms=0, glow=None, flash=False, show=1.0, tilt=0):
    """A tall robed lich: violet_dark robe, bone skull under a peaked hood, a bone crown of three spikes,
    a stone staff topped with a bone ring."""
    W_, H_ = 32, 40
    a = C.new(W_, H_)
    xx, yy = C.grid(W_, H_)
    sway = (0, 1, 0, -1)[i % 4]
    cx = 16
    # robe: widening trapezoid with a ragged hem
    robe = (yy >= 12) & (yy <= 37) & (np.abs(xx - cx - sway * (yy - 12) / 26) <= 3 + (yy - 12) * 0.36)
    hem = (yy > 34) & (((xx.astype(int) + i) % 4) == 0)
    a[robe & ~hem] = C.ci("violet_dark")
    a[robe & ~hem & ((xx - cx) > 2)] = C.ci("bg1")  # shade side
    # hood
    hood = ((xx - cx) / 5.5) ** 2 + ((yy - 10) / 6) ** 2 <= 1
    a[hood] = C.ci("violet_dark")
    a[hood & ((xx - cx) > 2.5)] = C.ci("bg1")
    C.line(a, cx, 2, cx - 1, 5, "violet_dark")  # peak
    # skull face
    face = ((xx - cx) / 3) ** 2 + ((yy - 11) / 3.4) ** 2 <= 1
    a[face] = C.ci("bone")
    C.put(a, cx - 2, 10, "bg0")
    C.put(a, cx + 1, 10, "bg0")
    a[13, cx - 1:cx + 1] = C.ci("stone")
    # crown: three bone spikes over the hood
    for dx, h in ((-3, 3), (0, 4), (3, 3)):
        C.line(a, cx + dx, 5, cx + dx, 5 - h, "bone")
    # staff on the left, held by a bony hand
    lift = arms * 2
    C.line(a, 7, 14 - lift, 7 + tilt, 38, "stone")
    C.disc(a, 7, 11 - lift, 2.4, "bone")
    C.disc(a, 7, 11 - lift, 1.1, glow or "bg0")
    C.put(a, 8, 20 - lift, "bone")
    # right hand: raised when casting
    if arms:
        C.line(a, cx + 4, 18, cx + 7, 16 - arms * 2, "violet_dark")
        C.put(a, cx + 7, 15 - arms * 2, "bone")
        if glow:
            C.disc(a, cx + 8, 13 - arms * 2, 1.5, glow)
    else:
        C.put(a, cx + 5, 24, "bone")
    a = C.outline(a, color="bg0")
    if glow and arms >= 2:
        a = C.halo(a, glow, phase=i)
    if flash:
        a[(a != C.T) & (a != C.ci("bg0"))] = C.ci("bone")
    if show < 1.0:
        a = C.dither_out(a, show, ox=i, oy=i * 2)
    return a


def lich_mage_idle():
    return [_lich(i) for i in range(4)]


def lich_mage_cast():
    return [_lich(k, arms=k + 1 if k < 3 else 3, glow="violet" if k >= 1 else None) for k in range(4)]


def _ash(a, k, rising=True):
    """Violet_dark ash motes around a (dis)appearing lich."""
    for j in range(6):
        x = 6 + (j * 5 + k * 3) % 20
        y = 36 - ((j * 7 + k * 6) % 30) if rising else 8 + ((j * 7 + k * 6) % 30)
        C.put(a, x, y, "violet_dark")
    return a


def lich_mage_teleport_out():
    return [_ash(_lich(k, show=1 - (k + 1) / 5), k) for k in range(4)]


def lich_mage_teleport_in():
    return [_ash(_lich(k, show=(k + 1) / 4), k, rising=False) for k in range(4)]


def lich_mage_hit():
    return [_lich(0, flash=True), _lich(1, tilt=1)]


def lich_mage_death():
    frames = []
    for k in range(6):
        a = _lich(k % 4, tilt=min(4, k), show=1 - k / 6.5)
        # the robe collapses: shift the body down as it fades
        sh = min(8, k * 2)
        b = C.new(32, 40)
        b[sh:, :] = a[:40 - sh, :]
        frames.append(_ash(b, k))
    return frames


# ---------------------------------------------------------------- pickups 12x12

def _pickup(kind, i):
    a = C.new(12, 12)
    bob = (0, -1, -1, 0)[i]
    if kind == "slow":
        # hourglass in teal with bone frame
        for y in range(2, 10):
            w = abs(y - 5.5) * 0.8 + 0.5
            a[y + bob, int(6 - w):int(6 + w) + 1] = C.ci("teal")
        a[1 + bob, 3:9] = C.ci("bone")
        a[10 + bob, 3:9] = C.ci("bone")
        sand = (2 + i) % 4
        C.put(a, 6, 4 + sand // 2 + bob, "bone")
    else:
        # gold coin with an "x2" notch
        C.disc(a, 6, 6 + bob, 4.3, "gold")
        C.disc(a, 6, 6 + bob, 2.4, "amber")
        a[5 + bob, 5:7] = C.ci("gold")
        a[6 + bob, 6] = C.ci("gold")
        C.put(a, 4 + (i % 2), 3 + bob, "bone")
    return C.outline(a)


def pickup_slow_time():
    return [_pickup("slow", i) for i in range(4)]


def pickup_double_score():
    return [_pickup("double", i) for i in range(4)]


def pickup_glow():
    """16x16 soft pulse drawn under a pickup (bone ring, tinted in code), four sizes."""
    frames = []
    for i in range(4):
        a = C.new(16, 16)
        r = 4.5 + (0, 1, 2, 1)[i]
        C.ring(a, 8, 8, r - 0.7, r + 0.3, "bone")
        frames.append(a)
    return frames


SPRITES = {
    "eye_sentinel_idle": eye_sentinel_idle,
    "eye_sentinel_charge": eye_sentinel_charge,
    "eye_sentinel_hit": eye_sentinel_hit,
    "eye_sentinel_death": eye_sentinel_death,
    "eye_beam": eye_beam,
    "lich_mage_idle": lich_mage_idle,
    "lich_mage_cast": lich_mage_cast,
    "lich_mage_teleport_out": lich_mage_teleport_out,
    "lich_mage_teleport_in": lich_mage_teleport_in,
    "lich_mage_hit": lich_mage_hit,
    "lich_mage_death": lich_mage_death,
    "pickup_slow_time": pickup_slow_time,
    "pickup_double_score": pickup_double_score,
    "pickup_glow": pickup_glow,
}
