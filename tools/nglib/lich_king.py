"""The Lich King (stage ART-B; NEW keys `lich_king_*`: the old `lich_mage_*` art stays in production until the
0.11.0 cut-over; drawn only in flagged runs, src/render/bossArt.ts `useNewBossArt`).

A skeleton king, 40 x 64, tall and thin: a jagged bone crown, a skull with teal-lit sockets, pale hair, an open
ribcage, a tattered dark-blue cloak with pointed shoulders and moon-pale ribbons, a bone staff with a teal flame in
its forked head, a teal flame in the raised free hand, no legs: the cloak dissolves into a trailing tail of teal
smoke. The cloak's hem (row ANCHOR_Y) is the sim position, as the old lich's robe hem is; the tail trails below it.

Layers (tools/nglib/layers.py): cloak, sleeves, hair, ribbons, tabard, ribs, skull, staff, hands; the crown, the
flames (with their dithered halo) and the smoke tail go on after the outline pass (thin spikes, light sources and
dithered smoke are not outlined).

Palette (docs/ASSETS_SPEC.md "Boss art"): cloak = stone_dark / stone / fog with a few mist pixels in the lining,
ribbons and rim light = moon, skeleton and crown = bone (shadow: stone), flames and smoke = teal (dithered). NO violet
and NO red on the body: violet sparks only on the cast frames, red ground cracks only on the grasp frames.
"""
import math

from . import canvas as C
from . import layers as L

W, H = 40, 64
CX = 20
ANCHOR_Y = 40  # the cloak's hem: the sim position

LEG = {"B": "bone", "S": "stone", "s": "stone_dark", "K": "bg0", "k": "bg1", "T": "teal", "O": "moon", "f": "fog"}

CROWN = [
    ".....B.....",
    ".....B.....",
    "..B..B..B..",
    "..B..B..B..",
    "B.B.BBB.B.B",
    "B.BBBBBBB.B",
    "BBBSBTBSBBB",
    ".BBBBBBBBB.",
]
CROWN_AT = (15, 0)

SKULL = [
    ".BBBBB.",
    "BBBBBBB",
    "BKKBKKS",
    "BKTBTKS",
    "BBBKBBS",
    ".BBBBS.",
    ".BKBKB.",
    "..BBB..",
]
SKULL_AT = (17, 8)

RIBS = [
    "...B...",
    "BBBBBBB",
    "KKKBKKK",
    "BBKBKBS",
    "KKTBTKK",
    "BBKBKBS",
    "KKKBKKK",
    ".BKBKS.",
    "..KBK..",
    "...B...",
    ".BBBBB.",
]
RIBS_AT = (17, 16)

STAFF_HEAD = [
    "B.....B",
    "B.....B",
    "BB...BB",
    ".B...B.",
    ".B...B.",
    ".BB.BB.",
    "..BBS..",
    "...B...",
]
STAFF_X = 33  # the shaft's column

TATTER = [5, 2, 6, 3, 0, 4, 7, 1, 5, 2, 6, 0, 3, 7, 2, 4, 6, 1, 5, 3, 7, 0, 4, 2, 6, 1, 5, 3, 0, 6]


def _cloak_hw(y):
    if y <= 16:
        return 5
    if y == 17:
        return 8
    if y <= 22:
        return 9
    if y <= 28:
        return 8
    return 8 + (y - 28) * 0.28


def _cloak(r, hem=0):
    """The cloak: pointed shoulders, long folds (lit on the left), a ragged hem of long tatters."""
    a = r.layer("cloak")
    for y in range(16, 52):
        hw = _cloak_hw(min(y, 40))
        for x in range(int(round(CX - hw)), int(round(CX + hw)) + 1):
            end = 38 + TATTER[(x + hem) % len(TATTER)]
            if y > end or ((x + hem) % 5 == 4 and y > 37):
                continue
            rel = (x - CX) / max(1.0, hw)
            col = "stone" if rel < -0.4 else "stone_dark"
            if (x in (14, 23, 27) or (x == 17 and y > 30)) and y > 20:
                col = "fog"  # deep folds
            if rel > 0.8 and y > 24:
                col = "fog"
            if x == 24 and y > 27:
                col = "mist"  # the lining shows in one fold
            C.put(a, x, y, col)
    # pointed shoulders, a moon rim on the lit one
    for side in (-1, 1):
        C.put(a, CX + side * 10, 17, "stone_dark")
        C.put(a, CX + side * 10, 16, "stone" if side < 0 else "stone_dark")
        C.put(a, CX + side * 11, 15, "stone" if side < 0 else "stone_dark")
    for x in range(10, 15):
        C.put(a, x, 17 if x > 10 else 16, "moon")
    return a


def _sleeves(r, lift=0, plant=0):
    """Two narrow sleeves with hanging tatters: the free arm (left, raised by `lift`) and the staff arm (right)."""
    a = r.layer("sleeves")
    hy = 23 - lift  # the free hand's row
    for x in range(5, 12):
        top = int(round(18 + (11 - x) * (hy + 1 - 18) / 6.0))
        drape = 3 + (TATTER[(x * 3) % len(TATTER)] if x % 2 == 0 else 1) + (2 if x < 9 else 0)
        for y in range(top, top + drape + 1):
            C.put(a, x, y, "stone" if y < top + 2 else "stone_dark")
    for x in range(29, 36):
        top = int(round(18 + (x - 29) * (25 + plant - 18) / 5.0))
        drape = 3 + (TATTER[(x * 5) % len(TATTER)] if x % 2 else 1) + (2 if x > 31 else 0)
        for y in range(top, top + drape + 1):
            C.put(a, x, y, "stone_dark" if y < top + 3 else "fog")
    return hy


def _hair(r):
    """Thin pale hair: a few long strands beside the skull."""
    a = r.layer("hair")
    for x, y0, y1 in ((16, 9, 19), (24, 9, 21), (15, 13, 17), (25, 14, 18)):
        for y in range(y0, y1 + 1):
            if (y + x) % 5 != 4:
                C.put(a, x, y, "moon")
    return a


def _ribbons(r):
    """Moon-pale ribbons from the belt, and the tabard between them."""
    a = r.layer("ribbons")
    for x, y1 in ((15, 39), (26, 42)):
        for y in range(28, y1 + 1):
            if (y + x) % 7 != 6:
                C.put(a, x, y, "moon")
    t = r.layer("tabard")
    for y in range(27, 42):
        hw = 2 if y < 38 else max(0, 41 - y)
        for x in range(CX - hw, CX + hw + 1):
            C.put(t, x, y, "stone" if x < CX + 2 else "stone_dark")
    # a pale rune down the tabard: a chevron over three marks
    for x, y in ((CX - 1, 30), (CX + 1, 30), (CX, 29), (CX, 32), (CX, 33), (CX, 35), (CX, 36)):
        C.put(t, x, y, "moon")
    # the belt chain: bone links swagging to the sides
    for x, y in ((14, 26), (15, 27), (16, 28), (17, 28), (23, 28), (24, 28), (25, 27), (26, 26)):
        C.put(t, x, y, "bone")
    return a


def _staff(r, plant=0, tilt=0):
    a = r.layer("staff")
    for y in range(9 + plant, 55 + plant):
        x = STAFF_X + (tilt * (y - 30)) // 24
        C.put(a, x, y, "bone")
        if y % 9 == 4:
            C.put(a, x + 1, y, "stone")  # a knot
    C.paste(a, C.from_ascii(STAFF_HEAD, LEG), STAFF_X - 3 - (tilt * 21) // 24, 1 + plant)
    return STAFF_X - (tilt * 21) // 24, 1 + plant


def _hands(r, hy, plant=0):
    a = r.layer("hands")
    # the free hand: a forearm out of the sleeve, an open palm with three claws cradling the flame
    for y in range(hy, hy + 2):
        C.put(a, 6, y, "bone")
    for x, y in ((5, hy), (7, hy), (4, hy - 1), (6, hy - 1), (8, hy - 1), (4, hy - 2), (8, hy - 2)):
        C.put(a, x, y, "bone")
    # the staff hand: knuckles round the shaft
    for x, y in ((32, 25), (33, 25), (34, 25), (32, 26), (34, 26), (33, 27)):
        C.put(a, x, y + plant, "bone" if x < 34 else "stone")


def flame(cx, base, size, i, core="bone"):
    """A teal flame (a light source: no outline): a teardrop that flickers with frame i, a pale core, on its own
    canvas so its dithered halo can be baked round it."""
    a = C.new(W, H)
    shapes = ([1, 2, 2, 2, 1, 1, 0, 0], [1, 2, 2, 1, 1, 0, 0, -1], [1, 2, 2, 2, 2, 1, 1, 0])
    wv = shapes[i % 3]
    lean = (0, 1, 0, -1, 0, 1)[i % 6]
    n = min(len(wv), 4 + size)
    for k in range(n):
        if wv[k] < 0:
            continue
        y = base - k
        shift = lean if k >= 4 else 0
        hw = min(wv[k], size)
        for x in range(cx - hw + shift, cx + hw + shift + 1):
            C.put(a, x, y, "teal")
    C.put(a, cx, base, core)
    C.put(a, cx, base - 1, core)
    if size >= 2:
        C.put(a, cx - 1, base - 1, core)
    return a


def _tail(i, grow=1.0):
    """The smoke tail: the cloak dissolves into curling teal smoke. A solid teal core, a checkered middle on the
    cloak's dark tones and a thin dithered edge (no partial alpha: baked dither only)."""
    a = C.new(W, H)
    ph = 2 * math.pi * i / 6
    for y in range(34, 64):
        t = (y - 34) / 29
        hw = 9.5 * (1 - t) ** 0.6 * grow
        if hw < 0.4:
            continue
        cx = CX + math.sin(t * 4.6 + ph) * (0.5 + 4.5 * t)
        for x in range(int(round(cx - hw)), int(round(cx + hw)) + 1):
            if not 0 <= x < W:
                continue
            d = abs(x + 0.5 - cx) / max(0.6, hw)
            if d < 0.32:
                col = "teal"
            elif d < 0.7:
                col = "teal" if (x + y + i) % 2 == 0 else ("stone_dark" if x < cx else "fog")
            else:
                col = "teal" if C.BAYER4[(y + i) % 4, (x + 2 * i) % 4] < 5 else None
            if col:
                C.put(a, x, y, col)
    return a


def build(i=0, lift=0, plant=0, tilt=0):
    r = L.Rig(W, H)
    _cloak(r, hem=i)
    hy = _sleeves(r, lift, plant)
    _hair(r)
    _ribbons(r)
    r.art("ribs", RIBS, LEG, *RIBS_AT)
    r.art("skull", SKULL, LEG, *SKULL_AT)
    head = _staff(r, plant, tilt)
    _hands(r, hy, plant)
    return r, hy, head


def _flutter(i, amp=1.0):
    ph = 2 * math.pi * i / 6
    return {"cloak": L.sway(H, 30, 50, 1.2 * amp, 22, ph), "ribbons": L.sway(H, 29, 44, 1.6 * amp, 14, ph + 0.8),
            "tabard": L.sway(H, 34, 44, 0.8 * amp, 22, ph + 0.4), "hair": L.sway(H, 12, 21, 0.8 * amp, 12, ph),
            "sleeves": L.sway(H, 27, 38, 1.0 * amp, 16, ph + 1.6)}


def frame(i=0, lift=0, plant=0, tilt=0, hand=2, staff=2, sparks=None, cracks=0, halo=True, tail=1.0, move=None):
    """One finished frame. hand / staff: flame sizes (0 = out); sparks: a colour for cast sparks; cracks: 0..3."""
    r, hy, (sx, sy) = build(i, lift, plant, tilt)
    body = C.outline(r.compose(rows=_flutter(i), move=move))
    C.paste(body, C.from_ascii(CROWN, LEG), *CROWN_AT)
    out = _tail(i, grow=tail) if tail > 0 else C.new(W, H)
    C.paste(out, body, 0, 0)
    fl = C.new(W, H)
    if hand:
        C.paste(fl, flame(6, hy - 2, hand, i), 0, 0)
    if staff:
        C.paste(fl, flame(sx, sy + 5, staff, i + 1), 0, 0)
    if sparks:
        ang0 = i * 1.1
        for k in range(5):
            ang = ang0 + k * 1.257
            for (cx, cy, rad) in ((6, hy - 5, 4 + (k % 2)), (sx, sy + 2, 5)):
                x, y = int(round(cx + math.cos(ang) * rad)), int(round(cy + math.sin(ang) * rad * 0.8))
                C.put(fl, x, y, sparks)
                if k % 2 == 0:
                    C.put(fl, x + 1, y, sparks)
    if halo:
        fl = C.halo(fl, sparks or "teal", phase=i)
    C.paste(out, fl, 0, 0)
    over = C.new(W, H)  # the fork of the staff and the claws stay in front of their flames
    C.paste(over, r.layers["staff"], 0, 0)
    over[14 + plant:, :] = C.T
    C.paste(over, r.layers["hands"], 0, 0)
    over[:, 12:30] = C.T
    C.paste(out, over, 0, 0)
    if cracks:
        # the grasp: red cracks run over the ground from under the staff's foot (blood_dark first, then blood)
        gy = 62
        for k, (dx, ln) in enumerate(((-1, 5), (1, 4), (-1, 9), (1, 8), (-1, 13), (1, 12))):
            if k >= cracks * 2:
                break
            x = STAFF_X
            for s in range(ln):
                x += dx
                y = gy + (1 if (s + k) % 3 == 0 else 0) - (k % 2)
                C.put(out, x, y, "blood" if cracks >= 2 and s < ln - 2 else "blood_dark")
    return out


def lich_king_idle():
    return [frame(i) for i in range(6)]


def lich_king_cast():
    """A violet attack: the free hand lifts its flame, the staff flame flares, violet sparks circle both."""
    return [frame(0, lift=1, hand=2, staff=2), frame(1, lift=3, hand=3, staff=3, sparks="violet"),
            frame(2, lift=5, hand=3, staff=3, sparks="violet"), frame(3, lift=5, hand=3, staff=3, sparks="violet")]


def lich_king_grasp():
    """The grasp (red, unparryable blades): he plants the staff and red cracks run over the ground."""
    return [frame(0, lift=1, plant=2), frame(1, lift=2, plant=5, cracks=1), frame(2, lift=2, plant=6, cracks=2),
            frame(3, lift=2, plant=6, cracks=3)]


def lich_king_hit():
    a = frame(0, halo=False)
    return [L.flash(a), frame(1, tilt=2, move={"skull": (1, 0), "hair": (1, 0)})]


def _motes(a, k, rising=True, n=9):
    for j in range(n):
        x = 6 + (j * 7 + k * 3) % 28
        y = (52 - ((j * 11 + k * 9) % 48)) if rising else (8 + ((j * 11 + k * 9) % 48))
        C.put(a, x, y, "teal")
        if j % 3 == 0:
            C.put(a, x, y + (1 if rising else -1), "stone")
    return a


def lich_king_teleport_out():
    """He dissolves into teal motes that rise."""
    out = []
    for k in range(4):
        a = frame(k, hand=max(0, 2 - k), staff=max(0, 2 - k), halo=k < 2, tail=1 - k * 0.2)
        a = C.dither_out(a, 1 - (k + 1) / 5, ox=k, oy=k * 2)
        out.append(_motes(a, k, rising=True, n=6 + k * 3))
    return out


def lich_king_teleport_in():
    """He re-forms out of falling teal motes."""
    out = []
    for k in range(4):
        a = frame(k, hand=min(2, k), staff=min(2, k), halo=k >= 2, tail=0.4 + k * 0.2)
        if k < 3:
            a = C.dither_out(a, (k + 1) / 4, ox=k, oy=k * 2)
        out.append(_motes(a, k, rising=False, n=15 - k * 4) if k < 3 else a)
    return out


def lich_king_death():
    """The cloak collapses into smoke and bones: the flames go out, the figure sinks and thins, the crown and the
    skull drop onto a small pile of bones while the last smoke rises."""
    out = []
    drop = (0, 3, 9, 18, 30, 44)
    for k in range(6):
        a = frame(k, tilt=min(5, k * 2), hand=max(0, 2 - k), staff=max(0, 1 - k), halo=k < 1, tail=max(0.0, 1 - k * 0.25))
        a = L.lowered(a, drop[k], 62)
        if k >= 1:
            a = C.dither_out(a, 1 - k / 6.5, ox=k, oy=k)
        if k >= 2:
            # the pile: ribs and a long bone on the ground, then the skull and the crown on top of it
            for x, y in ((14, 62), (15, 62), (16, 61), (17, 62), (22, 62), (23, 61), (24, 62), (25, 62), (19, 62), (20, 62)):
                if k >= 3 or x < 20:
                    C.put(a, x, y, "bone")
            for x in range(13, 27):
                C.put(a, x, 63, "stone" if x % 3 else "bone")
        if k >= 4:
            C.paste(a, C.from_ascii(SKULL, LEG), 16, 54)
            C.paste(a, C.from_ascii(CROWN[2:], LEG), 14 + (k - 4), 48 + (k - 4) * 2)
        if k >= 1:
            _motes(a, k, rising=True, n=3 + k * 2)
        out.append(a)
    return out


def lich_king_soulfire():
    """The soulfire wind-up (an overlay, 40 x 40, drawn over his chest): violet embers circling in, six frames."""
    out = []
    for i in range(6):
        a = C.new(40, 40)
        rx, ry = 17 - i * 1.6, 9 - i * 0.8
        for k in range(6):
            ang = k * math.pi / 3 + i * 0.75
            for s_, col in ((0.55, "violet_dark"), (0.4, "violet_dark"), (0.25, "violet"), (0.12, "violet")):
                C.put(a, int(round(20 + math.cos(ang - s_) * rx)), int(round(20 + math.sin(ang - s_) * ry)), col)
            x, y = int(round(20 + math.cos(ang) * rx)), int(round(20 + math.sin(ang) * ry))
            for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                C.put(a, x + dx, y + dy, "violet")
            if i >= 3:
                C.put(a, x, y, "bone")
        out.append(a)
    return out


def bone_hand():
    """A skeletal hand rising from the ground (16 x 16, 4f): finger tips first, then the palm and the wrist. The red
    crack ring round it is its own sprite (grasp_crack)."""
    full = C.from_ascii([
        "................",
        "..B..B..B..B....",
        "..B..B..B..B....",
        "..B..B..B..B.B..",
        "..BS.BS.BS.B.B..",
        "..BS.BS.BS.BSB..",
        "..BBBBBBBBBBSB..",
        "...BBBBBBBBBB...",
        "...BBBBBBBBBS...",
        "....BBBBBBBS....",
        "....BBBBBBS.....",
        ".....BBBBBS.....",
        ".....BBBBS......",
        ".....BBBBS......",
        "................",
        "................",
    ], LEG)
    out = []
    for k, down in enumerate((9, 6, 3, 0)):
        a = L.lowered(full, down, 14)
        a = C.outline(a)
        a[14:, :] = C.T
        for x in (3, 6, 10, 12)[:2 + k]:  # crumbs of earth pushed up
            C.put(a, x, 14, "stone")
        out.append(a)
    return out


def grasp_crack():
    """The red ground crack ring of the grasp (24 x 24, 4f): cracks close into a ring round the hand over the
    wind-up (blood_dark, then blood: the blades will burst from here)."""
    out = []
    for k in range(4):
        a = C.new(24, 24)
        rad = 10.5 - k * 0.8
        n = 14
        for j in range(n):
            if k < 3 and (j * 5 + k) % (4 - k) == 0 and k < 2:
                continue  # an open ring first: the cracks have not joined yet
            a0 = 2 * math.pi * j / n
            a1 = 2 * math.pi * (j + 0.8) / n
            jag = ((j * 7) % 3) - 1
            x0, y0 = 12 + math.cos(a0) * (rad + jag * 0.6), 12 + math.sin(a0) * (rad + jag * 0.6) * 0.62
            x1, y1 = 12 + math.cos(a1) * (rad - jag * 0.6), 12 + math.sin(a1) * (rad - jag * 0.6) * 0.62
            C.line(a, x0, y0, x1, y1, "blood" if k >= 2 else "blood_dark")
            if k >= 1 and j % 3 == 0:  # a crack running outward
                C.line(a, x0, y0, 12 + math.cos(a0) * (rad + 2.5), 12 + math.sin(a0) * (rad + 2.5) * 0.62, "blood_dark" if k < 3 else "blood")
        out.append(a)
    return out


SPRITES = {
    "lich_king_idle": lich_king_idle,
    "lich_king_cast": lich_king_cast,
    "lich_king_grasp": lich_king_grasp,
    "lich_king_hit": lich_king_hit,
    "lich_king_death": lich_king_death,
    "lich_king_teleport_out": lich_king_teleport_out,
    "lich_king_teleport_in": lich_king_teleport_in,
    "lich_king_soulfire": lich_king_soulfire,
    "bone_hand": bone_hand,
    "grasp_crack": grasp_crack,
}
