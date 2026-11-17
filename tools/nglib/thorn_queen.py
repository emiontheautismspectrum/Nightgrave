"""The Thorn Mother (stage ART-B; keys `thorn_mother_*`, replaced in place; dark until FEATURES.bosses.thorn).

A forest queen, 48 x 64: a crown of thorns, a pale delicate face (hand-drawn pixel by pixel), long green hair, bare
bone-pale shoulders, a bodice of woven roots with a small warm chest core, thin arms wound with thorn vines, and a long
gown of layered leaves and roots that widens to the ground. Her chest core (row CHEST_Y) is the sim position.

Built from layers (tools/nglib/layers.py): hair, gown, arms, torso, head, fx (+ the crown, pasted last). The animation moves parts
and rows: the hair and the gown's lower rows sway by per-row offsets, the arms are redrawn per pose.

Palette (docs/ASSETS_SPEC.md "Boss art"): bark and roots = earth / dry, leaves = forest / moss with a few fern
accents, skin and thorn glints = bone (shadow: dry), eyes and chest core = a few gold / amber pixels, cast glow =
violet. NO red anywhere (red = unparryable).
"""
import math

from . import canvas as C
from . import layers as L

W, H = 48, 64
CHEST_Y = 22  # the chest core: the sim position (src/render/bossArt.ts origin)
GROUND = 64

LEG = {"B": "bone", "D": "dry", "E": "earth", "M": "moss", "F": "forest", "N": "fern", "G": "gold", "A": "amber",
       "K": "bg0", "k": "bg1", "V": "violet", "v": "violet_dark"}

# The face: cols 21..26, rows 9..17 (hand-drawn). Two eyes (a dark lash over a gold glint), a nose shade, dry lips,
# a tapering chin and a long neck.
FACE = [
    ".BBBB.",
    "BBBBBB",
    "BEBBEB",
    "BGBBGB",
    "BBBBBD",
    "BBDDBD",
    ".BBBB.",
    "..BB..",
    "..BD..",
]
FACE_AT = (21, 9)

# The crown of thorns: cols 16..31, rows 0..8. A circlet with six spikes, the two inner ones the tallest (bone tips).
CROWN = [
    "......B..B......",
    "......D..D......",
    "...B..D..D..B...",
    "...D..D..D..D...",
    "B...D.D..D.D...B",
    ".D..D.DE.DE.D.D.",
    "..D.DEDDDDDED.D.",
    "...DDDEDDEDDDD..",
]
CROWN_AT = (16, 0)

# Shoulders, the bare upper chest and the bodice of woven roots: cols 18..29, rows 18..30. The core is gold on amber.
TORSO = [
    "..BBBBBBBB..",
    "BBBBBBBBBBBD",
    ".BBBBBBBBBD.",
    "..DBBBBBBE..",
    "..DDBGGBEE..",
    "..EDDAADEE..",
    "...DEDDEE...",
    "...EDEDEE...",
    "...DDEDEE...",
    "....DEDE....",
    "....EDEE....",
    "....DEDE....",
    "...DDEDEE...",
]
TORSO_AT = (18, 18)


def _hair(r):
    """Long hair: a cap under the crown and two wavy locks falling behind the shoulders to the hips."""
    a = r.layer("hair")
    for y in range(7, 34):
        wave = int(round(math.sin((y - 7) / 3.4) * 1.2))
        taper = max(0, (y - 22) * 2 // 3)  # the locks thin out below the shoulders: her waist stays visible
        # left lock (lit): moss with forest strands
        x0, x1 = 17 - (1 if 13 <= y <= 30 else 0) + wave + taper, 20 + (1 if y > 18 else 0)
        for x in range(x0, x1 + 1):
            C.put(a, x, y, "forest" if (x + y // 3) % 3 == 0 else "moss")
        # right lock (shade side): forest with a few moss strands
        x0, x1 = 27 - (1 if y > 18 else 0), 30 + (1 if 13 <= y <= 30 else 0) + wave - taper
        for x in range(x0, x1 + 1):
            C.put(a, x, y, "moss" if (x + y // 3) % 4 == 0 else "forest")
    for x in range(20, 28):  # the cap, parted in the middle
        C.put(a, x, 8, "forest" if x in (23, 24) else "moss")
        C.put(a, x, 7, "moss" if x < 24 else "forest")
    for x in (20, 21, 26, 27):
        C.put(a, x, 9, "moss" if x < 24 else "forest")
    for x, y in ((18, 15), (19, 24), (17, 29), (29, 20), (30, 27)):  # fern accents
        C.put(a, x, y, "fern")
    return a


def _half_width(y):
    """Half width of the gown at row y (30 = the waist seam .. 63 = the ground)."""
    t = (y - 30) / 33
    return 3 + 17.5 * (t ** 1.25)


LEAF = [".XXX.", "XXXXX", "XXXXX", "XXXXX", ".XXX.", ".XXX.", "..X.."]


def _gown(r):
    """The gown: tiers of pointed leaves laid like scales (upper tiers overlap lower ones), a few withered leaves,
    roots running down its sides and spreading into the ground at the hem."""
    a = r.layer("gown")
    for y in range(30, 64):
        hw = _half_width(y)
        for x in range(int(round(24 - hw)), int(round(24 + hw))):
            C.put(a, x, y, "forest")
    body = a != C.T
    tiers = [58, 53, 48, 43, 38, 33, 29]  # bottom tier first: the upper ones are drawn over it
    for ti, ty in enumerate(tiers):
        hw = _half_width(min(63, ty + 3))
        n = max(1, int(round((2 * hw) / 5)))
        for k in range(n):
            lx = int(round(24 - hw + (k + 0.5) * (2 * hw) / n + (ti % 2))) - 2
            centre = lx + 2
            withered = (k * 3 + ti * 2) % 11 == 3 and ti < 4
            left = centre < 25  # the left of the gown faces the moon
            for dy, row in enumerate(LEAF):
                for dx, ch in enumerate(row):
                    x, y = lx + dx, ty + dy
                    if ch != "X" or not (0 <= x < W and 30 <= y < 64) or not body[y, x]:
                        continue
                    last = dx == len(row) - 1 or row[dx + 1] != "X"
                    if last:
                        col = "bg1"  # the dark seam on the shade side of every leaf
                    elif withered:
                        col = "dry" if dx <= 2 else "earth"
                    elif left:
                        col = "moss" if dx <= 2 else "forest"
                    else:
                        col = "moss" if dx <= 1 and dy < 4 else "forest"
                    C.put(a, x, y, col)
            if left and not withered and k % 2 == 0:
                C.put(a, lx + 1, ty + 2, "fern")
    # roots: four sinuous strands from the waist down the sides of the gown (dry, earth on their shade side)
    for sx, ex, ph in ((22, 10, 0.0), (25, 37, 1.3), (24, 25, 2.4)):
        px = None
        for y in range(30, 64):
            t = (y - 30) / 33
            x = int(round(sx + (ex - sx) * (t ** 1.3) + math.sin(t * 6 + ph) * 1.2 * t))
            if not 0 <= x < W or not body[y, x]:
                continue
            C.put(a, x, y, "dry" if (y + x) % 5 else "earth")
            if px is not None and abs(x - px) > 1:
                C.put(a, (x + px) // 2, y, "dry")
            px = x
    # the hem: a ragged edge, and root tips spreading over the ground beyond it
    for x in range(4, 44):
        if (x * 7) % 5 == 0:
            a[62:64, x] = C.T
        elif (x * 3) % 7 == 0:
            a[63, x] = C.T
    for x, n in ((1, 2), (4, 3), (44, 3), (46, 2)):
        for k in range(n):
            C.put(a, x + (k if x < 24 else -k), 63 - (k // 2), "dry" if k else "earth")
    return a


def _arm(a, side, elbow, hand, vines=True):
    """One thin arm (bone, dry shade) from the shoulder through the elbow to the hand, wound with a thorn vine."""
    sx = 18 if side < 0 else 29
    ex, ey = 24 + side * elbow[0], elbow[1]
    hx, hy = 24 + side * hand[0], hand[1]
    if side > 0:
        ex, hx = ex - 1, hx - 1
    shade = "bone" if side < 0 else "dry"
    L.thick_line(a, sx, 19, ex, ey, "bone", shade)
    L.thick_line(a, ex, ey, hx, hy, "bone", shade)
    # the hand: a palm and two long fingers
    down = 1 if hy >= ey else -1
    C.put(a, hx, hy + down, "bone")
    C.put(a, hx + side, hy + down, "bone")
    C.put(a, hx + side * 2, hy + 2 * down, "bone")
    C.put(a, hx, hy + 2 * down, "bone")
    if vines:
        # the vine winds round the arm (a dry band every third pixel) and throws two thorns outward (bone tips)
        n = max(abs(hx - ex), abs(hy - ey))
        for k in range(2, n, 4):
            x = int(round(ex + (hx - ex) * k / n))
            y = int(round(ey + (hy - ey) * k / n))
            C.put(a, x, y, "dry")
            C.put(a, x + 1, y, "earth" if side > 0 else "dry")
        mx, my = (sx + ex) // 2, (19 + ey) // 2
        C.put(a, mx, my, "dry")
        C.put(a, mx + side * 2, my - 1, "dry")
        C.put(a, mx + side * 3, my - 2, "bone")
        C.put(a, ex + side * 2, ey, "dry")
        C.put(a, ex + side * 3, ey - 1, "bone")
    return hx, hy


POSES = {
    # (elbow dx, y), (hand dx, y): dx is measured outward from the body axis
    "idle": ((9, 26), (13, 32)),
    "idle2": ((9, 26), (13, 31)),
    "lift1": ((11, 23), (15, 24)),
    "lift2": ((11, 20), (16, 15)),
    "lift3": ((10, 18), (15, 10)),
    "down": ((10, 28), (14, 40)),
    "ground": ((11, 30), (15, 47)),
    "limp": ((7, 27), (9, 35)),
}


def _vine(a, x0, y0, height, lean, col="dry", tip="bone", phase=0.0):
    """A root rising out of the ground at (x0, y0): thick at the base, a thorn tip on top."""
    x = float(x0)
    for k in range(height):
        y = y0 - k
        x += lean * 0.35 + math.sin(k * 0.7 + phase) * 0.45
        xi = int(round(x))
        C.put(a, xi, y, col)
        if k < height * 0.6:
            C.put(a, xi + 1, y, "earth")
        if k % 4 == 2 and k < height - 2:
            C.put(a, xi - (1 if lean > 0 else -1), y, col)  # a side thorn
    C.put(a, int(round(x)), y0 - height, tip)


def build(pose="idle", glow=None, core=None, vines=0, feet=0, wither=0):
    """The rig of one pose. glow: the cast colour of her hands; core: the chest core colour (None = gold on amber);
    vines: height of the root-vines risen beside her; feet: roots spread at her feet (hedge); wither: 0..3."""
    r = L.Rig(W, H)
    _hair(r)
    _gown(r)
    arms = r.layer("arms")
    hands = [_arm(arms, s, *POSES[pose]) for s in (-1, 1)]
    r.art("torso", TORSO, LEG, *TORSO_AT)
    r.art("head", FACE, LEG, *FACE_AT)
    fx = r.layer("fx")
    if core:
        t = r.layers["torso"]
        t[22, 23:25] = C.ci(core)
        t[23, 23:25] = C.ci("violet_dark" if core == "violet" else core)
    if vines:
        for i, (x, lean) in enumerate(((4, 0.4), (9, -0.2), (43, -0.4), (38, 0.2))):
            _vine(fx, x, 63, max(3, vines - (i % 2) * 5), lean, phase=i * 1.7)
    if feet:
        for i, x in enumerate(range(1, 47, 4)):
            if 12 < x < 34 and i % 2:
                continue
            _vine(fx, x, 63, 2 + (feet * ((i * 5) % 4 + 2)) // 3, 0.3 if x < 24 else -0.3, phase=i)
    if glow:
        for hx, hy in hands:
            C.disc(fx, hx + 0.5, hy - 1.5, 1.6, glow)
    if wither:
        # the leaves dry out from the hem upwards
        g = r.layers["gown"]
        cut = 64 - wither * 12
        for y in range(max(30, cut), 64):
            row = g[y]
            row[row == C.ci("moss")] = C.ci("dry")
            row[row == C.ci("fern")] = C.ci("earth")
    return r


def _crown(a, dx=0, dy=0, glint=None):
    """The crown goes on AFTER the outline pass: its thorns are 1 px lines with open gaps between them (an outline
    would fill the gaps and turn the crown into a block). glint: index of the tip that shines gold."""
    C.paste(a, C.from_ascii(CROWN, LEG), CROWN_AT[0] + dx, CROWN_AT[1] + dy)
    if glint is not None:
        gx, gy = TIPS[glint % len(TIPS)]
        C.put(a, gx + dx, gy + dy, "gold")
    return a


TIPS = ((22, 0), (25, 0), (28, 2), (31, 4), (16, 4), (19, 2))


def _finish(a, glow=None, phase=0, crown=(0, 0), glint=None):
    a = C.outline(a)
    if crown is not None:
        _crown(a, crown[0], crown[1], glint)
    if glow:
        a = C.halo(a, glow, phase=phase)
    return a


def _idle_frame(i, pose=None, **kw):
    """Idle frame i of 6: the hair and the gown's lower rows sway, she breathes, the crown glints, the core pulses."""
    ph = 2 * math.pi * i / 6
    r = build(pose or ("idle2" if i in (2, 3) else "idle"), **kw)
    breath = -1 if i in (2, 3) else 0
    rows = {"hair": L.sway(H, 18, 40, 1.0, 26, ph), "gown": L.sway(H, 44, 63, 1.3, 30, ph + 1.0)}
    move = {"head": (0, breath)}
    a = r.compose(move=move, rows=rows)
    if breath:  # the neck stays joined to the shoulders
        a[17, 23] = C.ci("bone")
        a[17, 24] = C.ci("dry")
    if "core" not in kw or kw["core"] is None:
        if i in (1, 2):  # the core pulses: one bright ring of amber round the gold
            a[21, 23:25] = C.ci("amber")
        if i == 4:
            a[22, 23:25] = C.ci("amber")
    return a, breath


def thorn_mother_idle():
    out = []
    for i in range(6):
        a, breath = _idle_frame(i)
        out.append(_finish(a, crown=(0, breath), glint=i))  # the crown glints: a gold tip travels over the thorns
    return out


def thorn_mother_cast():
    """Arms and root-vines rise, the chest core flares violet (the cast glow of a violet attack)."""
    out = []
    for k, (pose, vines, glow) in enumerate((("lift1", 8, None), ("lift2", 16, "violet"), ("lift3", 24, "violet"), ("lift3", 27, "violet"))):
        r = build(pose, glow=glow, core="violet" if k else "violet_dark", vines=vines)
        a = r.compose(rows={"hair": L.sway(H, 18, 40, 1.0, 26, k * 1.2), "gown": L.sway(H, 46, 63, 1.0, 30, k * 1.2)})
        out.append(_finish(a, glow if k >= 2 else None, phase=k))
    return out


def thorn_mother_lash():
    """The lash cast (red, unparryable blades): her arms and the root-vines rise as on the cast row, but nothing
    glows violet (violet = parryable); the red start line is drawn in code."""
    out = []
    for k, (pose, vines) in enumerate((("lift1", 8), ("lift2", 16), ("lift3", 24), ("lift3", 27))):
        r = build(pose, vines=vines)
        a = r.compose(rows={"hair": L.sway(H, 18, 40, 1.0, 26, k * 1.2), "gown": L.sway(H, 46, 63, 1.0, 30, k * 1.2)})
        if k >= 2:  # the core burns brighter (amber round the gold)
            a[21, 23:25] = C.ci("amber")
        out.append(_finish(a))
    return out


def thorn_mother_hedge():
    """The hedge cast: her arms go down to the ground and roots spread at her feet (no violet: the hedge is red, and
    its red cue is drawn in code at her feet)."""
    out = []
    for k, (pose, feet) in enumerate((("down", 1), ("ground", 2), ("ground", 3), ("ground", 4))):
        r = build(pose, feet=feet)
        a = r.compose(rows={"hair": L.sway(H, 18, 40, 1.0, 26, k * 1.0)}, move={"head": (0, 1 if k else 0)})
        out.append(_finish(a, crown=(0, 1 if k else 0)))
    return out


def thorn_mother_hit():
    a = _finish(_idle_frame(0)[0])
    r = build("lift1")
    b = _finish(r.compose(move={"head": (1, 0), "hair": (1, 0)}), crown=(1, 0))
    return [L.flash(a), b]


def _roots_around(a, k, n=6, burst=False):
    """Root tips around her while she sinks / emerges: they rise as she goes down (k 0..5)."""
    for i, x in enumerate((3, 9, 15, 32, 38, 44)):
        h = (2 + k * 2 + (i * 3) % 4) if not burst else (4 + ((5 - k) * 3) + (i * 5) % 5)
        _vine(a, x, 63, min(h, 22), 0.5 if x < 24 else -0.5, phase=i * 1.3 + k)
    return a


def thorn_mother_sink():
    """SINK: the roots pull her down. The figure moves down behind the ground line (its lower rows vanish first) while
    root tips rise around her; the last frame is the crown going under."""
    out = []
    for k in range(6):
        r = build("limp" if k else "idle")
        body = _finish(r.compose(rows={"hair": L.sway(H, 18, 40, 1.0, 26, k)}))
        body = L.lowered(body, (4, 14, 26, 38, 49, 58)[k], GROUND)
        C.paste(body, C.outline(_roots_around(C.new(W, H), k)), 0, 0)
        out.append(body)
    return out


def thorn_mother_emerge():
    """EMERGE: the reverse, with a burst of root tips that falls back as she stands."""
    out = []
    for k in range(6):
        r = build("lift1" if k < 4 else "idle")
        body = _finish(r.compose(rows={"hair": L.sway(H, 18, 40, 1.0, 26, k)}))
        body = L.lowered(body, (56, 44, 31, 19, 8, 1)[k], GROUND)
        C.paste(body, C.outline(_roots_around(C.new(W, H), k, burst=True)), 0, 0)
        out.append(body)
    return out


def thorn_mother_death():
    """She withers: the leaves dry from the hem up, she bows, then the figure crumbles into the ground."""
    out = []
    for k in range(6):
        r = build("limp" if k else "idle", wither=min(3, k), core="earth" if k >= 2 else None)
        bow = min(3, k)
        a = r.compose(move={"head": (bow // 2, bow), "hair": (0, bow // 2)})
        a = _finish(a, crown=(bow // 2, bow))
        a = L.lowered(a, (0, 2, 6, 12, 20, 30)[k], GROUND)
        if k >= 2:
            a = C.dither_out(a, 1 - (k - 1) / 5.5, ox=k, oy=k)
        out.append(a)
    return out


SPRITES = {
    "thorn_mother_idle": thorn_mother_idle,
    "thorn_mother_cast": thorn_mother_cast,
    "thorn_mother_hedge": thorn_mother_hedge,
    "thorn_mother_lash": thorn_mother_lash,
    "thorn_mother_hit": thorn_mother_hit,
    "thorn_mother_death": thorn_mother_death,
    "thorn_mother_sink": thorn_mother_sink,
    "thorn_mother_emerge": thorn_mother_emerge,
}
