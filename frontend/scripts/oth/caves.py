# OVERHILL — the valley's CAVES, modelled in Blender (2026-11-07, the user: "use Blender to make / sculpt a cave, a
# proper one"; "see the cave, the rounded … ours is a flat big thing on top — need natural blending";
# frontend/refer/caves/grassy-hollow-rolling-hills.png).
#
#   blender -b --factory-startup --python scripts/oth/caves.py -- [STYLES=hall,sky,den] [PREVIEW=screenshots/caves-blender]
#
# Each cave is ONE ROUNDED HILL with the cave carved into it, as METABALLS: the hill a few blobs (a dome, shoulders, a
# lump behind, a brow over the mouth) that melt into one another — no plateau, no edge; the cave NEGATIVE blobs (the
# chamber, a passage that wanders a little, the mouth breaking out through the front slope), so the opening rounds into
# the hillside by itself. Then a voxel remesh (even triangles), a soft noise (lumps, nothing regular), smoothing, and
# the count brought down. Faces looking into the cave are ROCK, the rest GRASS (the material index: 1 / 0).
# The frame: the mouth's floor at the origin, the mouth looking toward −Y (the game's +z), the ground at z = 0; the hill
# goes on ~2 m below the ground (the game lays its foot on the land where it stands).
# PREVIEW: renders of each (front, three-quarter, above, inside, inside looking out) over a golden ground, and the
# .blend — to look at before anything goes into the game.
import sys, os, math, time
import bpy, bmesh
from mathutils import Vector

T0 = time.time()
ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
STYLES = ARGS.get('STYLES', 'hall,sky,den').split(',')
PREVIEW = ARGS.get('PREVIEW', 'screenshots/caves-blender')
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)

K = 0.574  # a metaball's surface sits at 0.574 × radius × size (threshold 0.6, measured)

# ---------------------------------------------------------------------------------------------------------- the shapes
# (centre, half-extents, negative?, stiffness) — metres, Blender's frame (x right, y back into the hill, z up)
def cave_spec(style):
    if style == 'world': return [], [((-8, 72, -4), (28, 24, 13))]  # (the preview's lamp: the hall)
    if style == 'den':  # small and low, in a bank
        hill = [((0, 10, -3), (15, 13, 11.5)), ((-9, 4, -2.5), (9, 9, 7)), ((9, 6, -2.5), (9, 9, 7.5)), ((2, 17, -2), (10, 9, 7)),
                ((-0.5, 2, 0.5), (6.5, 4.5, 5.5)), ((2.6, 0.8, 2.6), (3.4, 2.8, 3))]
        void = [((0, 10, 1.0), (6.2, 6.4, 3.8)), ((0.4, 5, 0.9), (3.2, 3.8, 2.9)), ((0.2, 1, 0.7), (3.5, 3.4, 2.9)), ((0.9, -2.5, 0.4), (3.6, 2.6, 2.9))]
    elif style == 'sky':  # a great chamber with a hole in its roof
        hill = [((0, 22, -4), (28, 27, 22)), ((-18, 10, -3), (13, 13, 11)), ((17, 13, -3), (14, 14, 12)), ((3, 37, -3), (16, 13, 11)),
                ((-1, 4, 1), (11, 8, 10)), ((5, 1.8, 5), (5.5, 4.5, 5)), ((-6, 3, 3.5), (5, 4.5, 4.5))]
        void = [((0, 22, 2.0), (12.5, 12.5, 8)), ((0.9, 11.5, 1.6), (4.2, 5, 4.0)), ((-0.8, 5.5, 1.4), (4.2, 4.6, 3.9)),
                ((0.2, 0.5, 1.1), (5.0, 4.0, 3.9)), ((1.6, -3.5, 0.7), (5.2, 3.2, 3.7)), ((-3, -2.5, 0.2), (2.8, 2.8, 2.6)),
                ((0, 22, 14), (3.2, 3.2, 8))]  # the skylight's shaft
    else:  # hall: a long gallery
        hill = [((0, 19, -4), (22, 25, 18)), ((-14, 8, -3), (12, 12, 10)), ((13, 11, -3), (12, 13, 11)), ((3, 33, -3), (14, 12, 10)),
                ((-1, 4, 1), (10, 7, 9)), ((4, 1.5, 4.5), (5, 4, 4.5)), ((-5, 2.5, 3), (4.5, 4, 4))]  # the brow: lumps, not one arc
        void = [((0, 20, 1.6), (8.0, 13, 5.2)), ((0.8, 9.5, 1.4), (3.6, 4.6, 3.4)), ((-0.8, 4.5, 1.3), (3.8, 4.2, 3.3)),
                ((0.2, 0, 1.0), (4.4, 3.8, 3.4)), ((1.4, -3.5, 0.6), (4.6, 3.0, 3.2)), ((-2.6, -2.5, 0.2), (2.4, 2.6, 2.2))]  # (the mouth: wide, low, one side lower)
    return hill, void

# THE CAVE WORLD (2026-11-07, the user: "a single mesh, a big one, like a small world which can be explored — like in
# Genshin"; "inner faces can be rock shapes, rounded; the rock texture with the shader in the game"): a great rounded
# hill (~200 × 170 m) with the mouth in its front slope; inside, one continuous cave with its OWN flat floors: the way
# in winding down, the GREAT HALL under a skylight, a side gallery, a LOWER CHAMBER with a basin, a loop back, a dead-
# end grotto; ROUNDED ROCK in it — pillars floor to roof, boulders, bulging walls. The deep parts go below the ground
# (the outside world unloaded in there — the game's own, later).
# Made as a SIGNED DISTANCE FIELD (numpy) — metaballs couldn't hollow a hill this big (their fields add: the small
# hollows came out as beads) — then SURFACE NETS (one vertex per crossed cell, quads across crossed edges), then
# Blender's remesh / smoothing / decimation as for the small ones.
import numpy as np
import random as _r

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)
def ell(P, c, r):  # an ellipsoid's distance (≈, good near it)
    q = np.sqrt(((P[0] - c[0]) / r[0]) ** 2 + ((P[1] - c[1]) / r[1]) ** 2 + ((P[2] - c[2]) / r[2]) ** 2)
    return (q - 1) * min(r)
def seg(P, a, b, r, rz):  # a passage: distance to a segment, squashed in z (a wide, low section), radius r
    ax, ay, az = a; bx, by, bz = b; dx, dy, dz = bx - ax, by - ay, bz - az
    t = np.clip(((P[0] - ax) * dx + (P[1] - ay) * dy + (P[2] - az) * dz) / (dx * dx + dy * dy + dz * dz), 0, 1)
    ex, ey, ez = P[0] - (ax + dx * t), P[1] - (ay + dy * t), (P[2] - (az + dz * t)) * (r / rz)
    return np.sqrt(ex * ex + ey * ey + ez * ez) - r
def lumps(P, amp, scale, seed):
    R = _r.Random(seed); n = 0
    for o in range(3):
        f = (2 ** o) / scale; k = [R.uniform(0, 6.28) for _ in range(6)]; d = [R.uniform(0.6, 1.4) for _ in range(3)]
        n = n + (0.55 ** o) * np.sin(P[0] * f * d[0] + k[0] + np.sin(P[2] * f * 0.7 + k[3])) * np.sin(P[1] * f * d[1] + k[1] + np.sin(P[0] * f * 0.6 + k[4])) * np.sin(P[2] * f * d[2] + k[2] + np.sin(P[1] * f * 0.8 + k[5]))
    return amp * n

# (2026-11-07, into the game: EVERY FLOOR ABOVE THE GROUND — the valley's terrain runs on under the hill, hidden in its
#  rock: so the way in CLIMBS a little, and the chambers stand on the land, not under it; z = 0 the ground)
PATHS = {  # (points, radius, height) — the passages
    'mouth': ([(0, -22, 2.4), (0, -4, 3.1)], 5.6, 4.4),
    'way_in': ([(0, -4, 3.1), (1, 10, 4.2), (7, 24, 5.2), (3, 38, 6.0), (-5, 50, 5.2)], 5.2, 4.4),  # (its floor ≥ 0.2 m over the land from the mouth in: no field grass on it)
    'gallery': ([(10, 66, 6), (30, 62, 5.6), (46, 70, 5.2), (54, 86, 5)], 6.0, 4.8),
    'loop': ([(44, 112, 5), (24, 122, 5.4), (-4, 116, 6), (-22, 98, 6), (-22, 82, 5.4)], 5.4, 4.4),
    'grotto': ([(3, 38, 5.5), (-14, 34, 5.5), (-24, 28, 5.5)], 3.4, 2.9),
    'haven': ([(-13, 107, 4.6), (-26, 110, 4.4), (-34, 111, 4.4)], 5.6, 4.0),  # (the loop to the Haven)
}
CHAMBERS = [  # (centre, radii, floor height) — floors flat
    ((-8, 72, 11), (34, 28, 18), 1.5),     # THE GREAT HALL (bigger — 2026-11-07, the user: "more space to walk round and do things")
    ((-46, 112, 8), (22, 18, 12), 1.5),    # THE HAVEN: a broad flat floor kept clear — the player's safe house / garage, later
    ((8, 82, 10), (17, 15, 12), 2.0),
    ((54, 104, 9), (24, 20, 13), 1.6),     # THE FAR CHAMBER — under its own skylight now, lush
    ((-28, 26, 6), (8, 7, 5), 3.4),        # the grotto's end
]
# TWICE THE HEIGHT (2026-11-07, the user: "the cave needs twice the height — you can reshape the terrain to get more"):
# every floor where it was (the lane, the pools, the Haven's pad, the drive all as before), every roof twice as high
# over it — the passages a little wider too (no tall slots); the mouth a little taller only (its arch, scaled with it);
# the hill raised over it all
TALL = {'mouth': 1.45, 'way_in': 2.0, 'gallery': 2.0, 'loop': 2.0, 'grotto': 1.8, 'haven': 2.0}
PATHS = {k: ([(a[0], a[1], a[2] + 0.62 * rz * (TALL[k] - 1)) for a in pts], r * (1.0 if k == 'mouth' else 1.15), rz * TALL[k]) for k, (pts, r, rz) in PATHS.items()}
def _taller(c, r, fl):  # (the room over the floor twice; the ellipsoid a little rounder, so its floor stays broad)
    H = c[2] + r[2] - fl; rz = r[2] * 1.9
    return ((c[0], c[1], fl + 2 * H - rz), (r[0], r[1], rz), fl)
CHAMBERS = [_taller(*q) for q in CHAMBERS]
SKY = ((-10, 72), 6.0)   # the skylight's shaft over the hall (centre x, y; radius) — wider: a longer shaft now
SKY2 = ((60, 108), 5.4)  # a second, over the far chamber (2026-11-07, the user: "like a different place": lush, lit)
POOL = ((-4, 84), (6.5, 5.5), 1.5)   # THE LAKE (2026-11-07, the user: "a small lake"): in the great hall by the garden, in the skylight's light
POOLS = [POOL, ((68, 112), (6.0, 5.0), 1.6), ((14, 88), (4.2, 3.6), 2.0)]  # (+ "small ponds": the far chamber's, the side chamber's)
def in_pool(x, y, grow=0.0):
    return any(((x - c[0]) / (r[0] + grow)) ** 2 + ((y - c[1]) / (r[1] + grow)) ** 2 < 1 for c, r, _ in POOLS)
LAKE_LEVEL = 1.15
FOOT = ((0, 72), (125, 108))
HAVEN = ((-46, 112), (17, 13.5), 1.6)  # its flat pad (centre, half widths, floor) — nothing stands on it
# THE DRIVING LANE (2026-11-07: the car's way through — cavedrive.mjs flipped on a hall stalagmite): every passage's line
# and the ways across the chambers; nothing stands on the floor within LANE m of it
LANE = 7.5
LANES = None  # (set below: every passage's line and the lane's)
# THE ENTRANCE (2026-11-07, the user: "show it at the entrance as a rounded thing — a welcome entrance, rounded, only the
# one rock texture and shader"): a rounded ARCH of rock framing the mouth — a half-torus a little proud of the hill's
# face (centre, half-width, height, its tube's radius); the cave's rock, grass all round it
ARCH = ((0.0, -17.0, 0.6), 7.0, 8.6, 1.8)  # (scaled with the taller mouth)
def arch_sdf(P):
    (cx, cy, cz), a, bb, r = ARCH
    q = (np.sqrt(((P[0] - cx) / a) ** 2 + ((P[2] - cz) / bb) ** 2) - 1) * min(a, bb)
    return np.sqrt(q * q + ((P[1] - cy) * 1.15) ** 2) - r + lumps(P, 0.18, 2.5, 31)

# THE LANE'S FLOOR (x, y, its floor z): smooth, gently rising and falling — carved last, so no bump, ledge or stone is
# on it, a car's height clear over it (4.5 m)
LANE_FLOOR = [
    # (one ROUND: in by the way in, a broad bend across the hall into the gallery, the far chamber, back by the loop and
    #  across the hall's far side to the way out — no turn tighter than a car takes at walking pace: the user, "my cars
    #  must go in easily and come back")
    [(0, -10, 0.3), (0, -4, 0.6), (1, 10, 1.2), (7, 24, 2.0), (3, 38, 2.4), (-5, 50, 2.0), (-3, 58, 1.7), (2, 64, 1.6), (10, 65, 1.6),
     (30, 62, 2.0), (46, 70, 1.8), (54, 86, 1.6), (54, 100, 1.6), (44, 112, 1.7), (24, 122, 2.2), (-4, 116, 2.6), (-22, 98, 2.6),
     (-22, 82, 2.1), (-19, 74, 1.8), (-14, 64, 1.7), (-8, 56, 1.8), (-5, 50, 2.0)],  # (back round the garden — its pines stand in the light)
    [(-13, 107, 2.4), (-26, 110, 1.9), (-36, 111, 1.6)],  # (the spur into the Haven)
]
def lane_fields(P):
    """(the lane's channel of air, the lane's floor of rock) as distance fields"""
    air = fill = None
    for pts in LANE_FLOOR:
        for a, b in zip(pts, pts[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = np.clip(((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1)
            d = np.sqrt((P[0] - a[0] - dx * t) ** 2 + (P[1] - a[1] - dy * t) ** 2)
            f = a[2] + (b[2] - a[2]) * t
            ai = np.maximum(np.maximum(d - 6.0, f - P[2]), P[2] - (f + 5.0)); fi = np.maximum(d - 7.0, P[2] - f)  # (wide: a car off its line by a metre or two still on smooth ground)
            air = ai if air is None else np.minimum(air, ai); fill = fi if fill is None else np.minimum(fill, fi)
    return air, fill

def floor_z(x, y):
    """The cave's floor height about (x, y): a chamber's, else the nearest passage's (the lane's where it runs)."""
    best = None
    for (cx, cy, _), (rx, ry, _), fl in CHAMBERS:
        if ((x - cx) / (rx * 1.05)) ** 2 + ((y - cy) / (ry * 1.05)) ** 2 < 1: best = fl if best is None else min(best, fl)
    if best is not None: return best
    bd, bz = 1e9, 0.0
    for pl in LANE_FLOOR + [[(a[0], a[1], a[2] - rz * 0.62) for a in pts] for pts, _, rz in PATHS.values()]:
        for a, b in zip(pl, pl[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
            d = math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)
            if d < bd: bd, bz = d, a[2] + (b[2] - a[2]) * t
    return bz

def near_lane(x, y, extra=0.0):
    global LANES
    if LANES is None: LANES = [[(a[0], a[1]) for a in pts] for pts, _, _ in PATHS.values()] + [[(a[0], a[1]) for a in pl] for pl in LANE_FLOOR]
    for pts in LANES:
        for a, b in zip(pts, pts[1:]):
            ax, ay, bx, by = a[0], a[1], b[0], b[1]; dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
            if math.hypot(x - ax - dx * t, y - ay - dy * t) < LANE + extra: return True
    return False  # the hill's apron: an ellipse a little past its foot (centre x, y; radii)

def world_sdf(P):
    # THE HILL: rounded blobs blended smooth, lumps on it; closed far below the ground
    H = None
    # (TALLER — twice the cave's height under it: the dome ~70 m over the land at the hall, the shoulders and swells
    #  raised with it; their centres low, so the flanks still rise gently out of the apron)
    for c, r in [((0, 70, -34), (106, 92, 102)), ((-62, 40, -16), (48, 46, 46)), ((60, 52, -16), (50, 50, 50)), ((10, 130, -16), (64, 48, 56)),
                 ((-36, 112, -14), (42, 36, 50)), ((0, 4, -12), (36, 24, 36)), ((7, -2, 6), (11, 8, 10)), ((-8, -1, 4), (10, 8, 9)),
                 ((58, 104, -14), (40, 34, 68)), ((-48, 112, -14), (38, 32, 62)), ((-8, 72, -14), (54, 46, 84))]:  # (… and over the Haven, the hall)  # (a swell over the far chamber — its roof broke through to the sky)
        d = ell(P, c, r); H = d if H is None else smin(H, d, 18.0)
    H = H + lumps(P, 2.2, 26, 3)
    # (NATURALLY BLENDED — the user: its foot curves out into an apron just under the land, ~10 m of fillet, so the
    #  hill rises out of the ground, never sits on it)
    (fx, fy), (frx, fry) = FOOT
    apron = np.maximum(P[2] + 0.7, (np.sqrt(((P[0] - fx) / frx) ** 2 + ((P[1] - fy) / fry) ** 2) - 1) * fry)
    H = smin(H, apron, 14.0)
    H = smax(H, -(P[2] + 9), 2.0)  # (closed under the land — the export cuts 4 m down anyway)
    # THE CAVE: passages and chambers, each floor flat, a few lumps in the walls
    V = None
    for pts, r, rz in PATHS.values():
        for a, b in zip(pts, pts[1:]):
            d = seg(P, a, b, r, rz); d = np.maximum(d, (min(a[2], b[2]) - rz * 0.62) - P[2])  # (its floor)
            V = d if V is None else smin(V, d, 3.0)
    for c, r, fl in CHAMBERS:
        d = np.maximum(ell(P, c, r), fl - P[2]); V = smin(V, d, 5.0)
    for (sx, sy), sr in (SKY, SKY2):
        shaft = np.sqrt((P[0] - sx) ** 2 + (P[1] - sy) ** 2) - sr - 0.6 * np.sin(np.arctan2(P[1] - sy, P[0] - sx) * 3 + P[2] * 0.2)
        V = smin(V, np.maximum(shaft, 3.0 - P[2]), 3.0)  # (from the chamber's air up: never a pit under it)
    for (px, py), (prx, pry), pz in POOLS: V = smin(V, np.maximum(ell(P, (px, py, pz), (prx, pry, 3.5)), pz - 1.2 - P[2]), 1.5)
    V = V + lumps(P, 0.9, 7, 11)
    S = smax(H, -V, 1.2)
    # LEDGES (2026-11-07, the user: "inside needs more naturality, like in Genshin Impact"): the walls in bands of rock
    # shelves ~3.4 m apart that wander up and down — the hollow pushed in along each band's top
    band = (P[2] + 1.2 * np.sin(P[0] * 0.09 + 1.3) + 1.0 * np.sin(P[1] * 0.07 + 0.4)) / 3.4
    fr = band - np.floor(band)
    V = V + 0.75 * np.clip((fr - 0.55) / 0.3, 0, 1) ** 2 * (1 - np.clip((fr - 0.9) / 0.1, 0, 1))
    V = V + lumps(P, 0.45, 2.6, 23)  # (the finer knobbles)
    S = smax(H, -V, 1.0)
    # ROUNDED ROCK inside the hollow — each worked out only in its own box (there are a few hundred)
    def add(c, ext, fn, k=0.9):
        nonlocal S
        lo = [np.searchsorted(ax, c[i] - ext[i] - 2) for i, ax in enumerate(AX)]; hi = [np.searchsorted(ax, c[i] + ext[i] + 2) for i, ax in enumerate(AX)]
        if any(h <= l for l, h in zip(lo, hi)): return
        sl = (slice(lo[0], hi[0]), slice(lo[1], hi[1]), slice(lo[2], hi[2]))
        sub = (P[0][sl], P[1][sl], P[2][sl])
        S[sl] = smin(S[sl], fn(sub), k)
    AX = (P[0][:, 0, 0], P[1][0, :, 0], P[2][0, 0, :])
    R = _r.Random(7)
    boulder = lambda c, r: (lambda Q: ell(Q, c, r) + lumps(Q, 0.3, 2.2, 5))
    def cone(a, b, r):  # a rounded cone: thick at a, a point at b
        def f(Q):
            dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            t = np.clip(((Q[0] - a[0]) * dx + (Q[1] - a[1]) * dy + (Q[2] - a[2]) * dz) / (dx * dx + dy * dy + dz * dz), 0, 1)
            d = np.sqrt((Q[0] - a[0] - dx * t) ** 2 + (Q[1] - a[1] - dy * t) ** 2 + (Q[2] - a[2] - dz * t) ** 2)
            return d - r * (1 - t) ** 0.8 - 0.15 + lumps(Q, 0.12, 1.6, 9)
        return f
    # the pillars and the big boulders
    # (the pillars ≥ ~10 m off the driving lane — a lane cut through one left a lip a low car caught on)
    # (twice as tall now: floor to roof still)
    for c, r in [((-24, 60, 24), (4.2, 4.2, 27)), ((4, 76, 24), (3.3, 3.7, 28)), ((64, 96, 19), (3.6, 3.4, 21)), ((-28, 60, 12), (5.5, 4.5, 10)), ((-30, 78, 16), (4.5, 6.5, 9))]:
        add(c, r, boulder(c, r), 1.4)
    # a NATURAL ARCH across the hall's west side (wall to pillar, sagging)
    arch = [(-40, 54, 24), (-34, 56.5, 28.5), (-28, 58.5, 28), (-24, 60, 25)]
    for a2, b2 in zip(arch, arch[1:]):
        c = tuple((a2[i] + b2[i]) / 2 for i in range(3)); add(c, (6, 6, 4), lambda Q, a2=a2, b2=b2: seg(Q, a2, b2, 1.6, 1.3) + lumps(Q, 0.25, 2, 13), 1.2)
    for ci, nst, nbo, npl in [(0, 26, 44, 7), (2, 8, 12, 2), (3, 16, 28, 5), (4, 4, 8, 1)]:
        (cx, cy, cz), (rx, ry, rz), fl = CHAMBERS[ci]
        roof = lambda x, y: cz + rz * math.sqrt(max(0.0, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2))
        # STALACTITES from the roof, STALAGMITES under some of them (a few meet: columns)
        for _ in range(nst):
            x, y = cx + R.uniform(-0.75, 0.75) * rx, cy + R.uniform(-0.75, 0.75) * ry
            if any(math.hypot(x - c[0], y - c[1]) < r + 3 for c, r in (SKY, SKY2)): continue
            top = roof(x, y); room = top - fl
            if room < 4: continue
            L = R.uniform(0.12, 0.3) * room; r = R.uniform(0.6, 1.5) * (0.6 + 0.06 * L)
            if near_lane(x, y): L = min(L, room - 5.5)  # (over the lane: a car's height clear under it)
            if L > 0.8: add((x, y, top - L / 2), (r + 1, r + 1, L / 2 + 1.5), cone((x, y, top + 1.5), (x + R.uniform(-0.4, 0.4), y, top - L), r), 0.8)
            if R.random() < 0.55 and not near_lane(x, y, 1.5):
                L2 = R.uniform(0.15, 0.5) * room if R.random() < 0.8 else room - L + 0.6  # (sometimes up to meet it: a column)
                r2 = R.uniform(0.8, 1.8)
                add((x, y, fl + L2 / 2), (r2 + 1, r2 + 1, L2 / 2 + 1.5), cone((x, y, fl - 1), (x + R.uniform(-0.3, 0.3), y, fl + L2), r2), 0.8)
        # ROUNDED BOULDERS in the walls and the roof (half sunk: the walls never one smooth sheet)
        for _ in range(nbo):
            th = R.uniform(0, 2 * math.pi); ph = R.uniform(-0.15, 1.1)
            x = cx + rx * math.cos(th) * math.cos(ph) * 0.97; y = cy + ry * math.sin(th) * math.cos(ph) * 0.97; z = max(fl + 0.5, cz + rz * math.sin(ph) * 0.97)
            rr = R.uniform(1.8, 4.5); rb = (rr * R.uniform(0.9, 1.5), rr * R.uniform(0.9, 1.3), rr * R.uniform(0.6, 1.0))
            add((x, y, z), rb, boulder((x, y, z), rb), 1.0)
        # RAISED PLATFORMS and steps on the floor (levels to climb) — none in the skylight's light (the garden)
        for _ in range(npl):
            x, y = cx + R.uniform(-0.6, 0.6) * rx, cy + R.uniform(-0.6, 0.6) * ry
            if any(math.hypot(x - c[0], y - c[1]) < 12 for c, _ in (SKY, SKY2)) or in_pool(x, y, 5): continue
            pr = (R.uniform(3, 7), R.uniform(3, 6), R.uniform(1.0, 2.6)); c = (x, y, fl)
            if near_lane(x, y, max(pr[0], pr[1]) + 1): continue
            add(c, pr, lambda Q, c=c, pr=pr: np.maximum(ell(Q, c, pr), Q[2] - (c[2] + pr[2] * 0.7)) + lumps(Q, 0.2, 2.5, 17), 1.2)
        # loose boulders on the floor
        for _ in range(nbo // 2):
            rr = R.uniform(0.7, 2.4); c = (cx + R.uniform(-0.8, 0.8) * rx, cy + R.uniform(-0.8, 0.8) * ry, fl + rr * 0.3); rb = (rr * 1.3, rr, rr * 0.8)
            if any(math.hypot(c[0] - q[0], c[1] - q[1]) < 10 for q, _ in (SKY, SKY2)) or in_pool(c[0], c[1], 2) or near_lane(c[0], c[1], rb[0] + 0.5): continue
            add(c, rb, boulder(c, rb), 0.6)
    # the passages: boulders in their walls, a few on their floors
    for pts, r, rz in PATHS.values():
        for a2, b2 in zip(pts, pts[1:]):
            n = int(math.dist(a2, b2) / 3)
            for i in range(n):
                t = R.random(); c0 = [a2[q] + (b2[q] - a2[q]) * t for q in range(3)]
                if c0[1] < -6: continue  # (none in the mouth itself)
                side = R.choice([-1, 1]); dx, dy = b2[0] - a2[0], b2[1] - a2[1]; L = math.hypot(dx, dy) or 1
                ang = R.uniform(0.25, 1.3)  # (on the walls and the roof — none down on the floor: the lane)
                x = c0[0] - dy / L * side * r * math.cos(ang); y = c0[1] + dx / L * side * r * math.cos(ang); z = c0[2] + rz * math.sin(ang) * 0.9
                rr = R.uniform(1.2, 2.8); rb = (rr * 1.2, rr, rr * 0.8)
                add((x, y, z), rb, boulder((x, y, z), rb), 0.9)
    # THE ENTRANCE'S ARCH
    S = smin(S, arch_sdf(P), 0.9)
    # THE HAVEN'S PAD: a dead flat floor, 8 m of air over it, nothing standing on it (ledges, lumps, stones carved off)
    (hx, hy), (hrx, hry), hf = HAVEN
    e2 = (np.sqrt(((P[0] - hx) / hrx) ** 2 + ((P[1] - hy) / hry) ** 2) - 1) * min(hrx, hry)
    S = smin(S, np.maximum(e2, P[2] - hf), 0.6)
    pad_air = np.maximum(np.maximum(e2 - 0.5, hf - P[2]), P[2] - (hf + 8.0))
    S = smax(S, -pad_air, 1.0)
    V = np.minimum(V, pad_air)
    # THE LANE, last: its floor filled up smooth, its air carved clear
    air, fill = lane_fields(P)
    S = smin(S, fill, 0.6)
    S = smax(S, -air, 0.8)
    V = np.minimum(V, air)
    return S, V

def surface_nets(F, origin, h):
    """One vertex per cell the surface crosses (the mean of its edges' crossings), a quad across each crossed grid
    edge — faces wound so their normals point out (F > 0 outside)."""
    inside = F < 0
    nx, ny, nz = F.shape
    c = inside[:-1, :-1, :-1].astype(np.int8)
    tot = np.zeros(c.shape, np.int8)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1): tot += inside[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz]
    act = (tot > 0) & (tot < 8)
    ids = np.full(act.shape, -1, np.int64); ai = np.nonzero(act); ids[ai] = np.arange(len(ai[0]))
    acc = np.zeros((len(ai[0]), 3)); cnt = np.zeros(len(ai[0]))
    corners = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
    I, J, K = ai
    for e0, e1 in edges:
        a, b = corners[e0], corners[e1]
        fa = F[I + a[0], J + a[1], K + a[2]]; fb = F[I + b[0], J + b[1], K + b[2]]
        m = (fa < 0) != (fb < 0)
        t = np.where(m, fa / np.where(m, fa - fb, 1), 0)
        for ax in range(3):
            acc[:, ax] += np.where(m, a[ax] + (b[ax] - a[ax]) * t, 0)
        cnt += m
    V = (np.stack([I, J, K], 1) + acc / cnt[:, None]) * h + origin
    quads = []
    for ax in range(3):
        sl0 = [slice(1, -1)] * 3; sl1 = [slice(1, -1)] * 3; sl0[ax] = slice(0, -1); sl1[ax] = slice(1, None)
        s0 = inside[tuple(sl0)]; s1 = inside[tuple(sl1)]
        cross = s0 != s1
        e = np.nonzero(cross); flip = s1[e]
        o = [e[0], e[1], e[2]]; o[(ax + 1) % 3] = o[(ax + 1) % 3] + 1; o[(ax + 2) % 3] = o[(ax + 2) % 3] + 1
        # (grid point (i, j, k) of the edge, in the full grid: the sliced indices + 1 on the other two axes)
        g = [e[0].copy(), e[1].copy(), e[2].copy()]
        for q in range(3):
            if q != ax: g[q] = g[q] + 1
        u, v = (ax + 1) % 3, (ax + 2) % 3
        def cell(du, dv):
            c3 = [g[0].copy(), g[1].copy(), g[2].copy()]; c3[u] -= du; c3[v] -= dv
            return ids[c3[0], c3[1], c3[2]]
        q4 = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], 1)
        q4 = np.where(flip[:, None], q4, q4[:, ::-1])
        quads.append(q4[(q4 >= 0).all(1)])
    return V, np.concatenate(quads)

def build_world():
    h = 0.6
    xs = np.arange(-130, 130, h); ys = np.arange(-50, 200, h); zs = np.arange(-12, 96, h)
    log('world: grid', len(xs), len(ys), len(zs))
    F = np.empty((len(xs), len(ys), len(zs)), np.float32); Vd = np.empty_like(F)
    for i in range(0, len(xs), 24):  # (in slabs: memory)
        P = np.meshgrid(xs[i:i + 24], ys, zs, indexing='ij')
        F[i:i + 24], Vd[i:i + 24] = world_sdf(P)
    log('world: field')
    verts, quads = surface_nets(F, np.array([xs[0], ys[0], zs[0]]), h)
    log('world: surface', len(verts), 'verts', len(quads), 'quads')
    me = bpy.data.meshes.new('world-raw'); me.from_pydata(verts.tolist(), [], quads.tolist()); me.update()
    o = bpy.data.objects.new('cave-world', me); bpy.context.scene.collection.objects.link(o)
    m = o.modifiers.new('smooth', 'SMOOTH'); m.factor = 0.5; m.iterations = 3
    m = o.modifiers.new('fewer', 'DECIMATE'); m.ratio = 0.22
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); o.modifiers.clear(); o.data = me2
    bm = bmesh.new(); bm.from_mesh(me2)
    # (under the ground: 4 m down is enough — the terrain hides it; the game lays it on the land)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -4.0), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])  # (surface nets wound them inward: the normals out of the rock, into the air)
    bm.normal_update()
    # ROCK: the faces on the cave's side (near or in the hollow: its field < 1.4 m there)
    C = np.array([list(f.calc_center_median()) for f in bm.faces])
    gi = np.clip(np.round((C - [xs[0], ys[0], zs[0]]) / h).astype(int), 0, [len(xs) - 1, len(ys) - 1, len(zs) - 1])
    vd = Vd[gi[:, 0], gi[:, 1], gi[:, 2]]
    rock = 0
    sx, sy = SKY[0]
    for f, v, c in zip(bm.faces, vd, C):
        mi = 1 if v < 1.4 else 0
        # THE GARDEN (the user: "inside, grass where the light gets"): the floor in the skylight's light is turf
        if mi and f.normal.z > 0.5 and c[2] < 5.0 and any(math.hypot(c[0] - q[0], c[1] - q[1]) < r * 2.3 for q, r in (SKY, SKY2)): mi = 2
        # (the entrance's arch: its own part — drawn from afar too)
        if mi != 2 and arch_sdf((np.array([c[0]]), np.array([c[1]]), np.array([c[2]])))[0] < 0.9 and c[1] < ARCH[0][1] + 3.5 and c[2] > -0.5: mi = 3
        # THE CAVE'S FLOOR (the user: "inside, most of it green and golden — only the stones like rock"): what faces up at
        #  the floor's height (not a boulder's top, a platform, a ledge — those stay rock)
        if mi == 1 and f.normal.z > 0.7 and c[2] < floor_z(c[0], c[1]) + 0.8: mi = 4
        f.material_index = mi; rock += mi == 1; f.smooth = True
    bm.to_mesh(me2); bm.free()
    log('world triangles', len(me2.polygons), 'rock', rock)
    global WORLD; WORLD = (F, xs, ys, zs, h, Vd)
    return o

WORLD = None
def open_air(p, need=1.8):
    """(previews) the nearest point to p at least `need` m from any rock, in the cave world's field."""
    F, xs, ys, zs, h, Vd = WORLD
    def f(q):  # (in the CAVE's air: clear of rock and inside the hollow — never out over the hill)
        i, j, k = (int(round((q[0] - xs[0]) / h)), int(round((q[1] - ys[0]) / h)), int(round((q[2] - zs[0]) / h)))
        if not (0 <= i < len(xs) and 0 <= j < len(ys) and 0 <= k < len(zs)): return -99.0
        return float(F[i, j, k]) if Vd[i, j, k] < -0.5 else -99.0
    if f(p) >= need: return p
    best = None
    for rr in (1, 2, 3, 4, 6, 8):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    q = (p[0] + dx * rr, p[1] + dy * rr, p[2] + dz * rr)
                    if f(q) >= need and (best is None or math.dist(q, p) < math.dist(best, p)): best = q
        if best: return best
    return p

def build(style):
    if style == 'world': return build_world()
    hill, void = cave_spec(style)
    big = False
    res = 0.9 if big else 0.45
    mb = bpy.data.metaballs.new(f'{style}-mb'); mb.resolution = res; mb.render_resolution = res; mb.threshold = 0.6
    ob = bpy.data.objects.new(f'{style}-mb', mb); bpy.context.scene.collection.objects.link(ob)
    R = 10.0
    for h in hill:
        c, ext = h[0], h[1]
        e = mb.elements.new(type='ELLIPSOID'); e.co = c; e.radius = R
        if len(h) > 2: e.stiffness = 3.0  # (the rock inside: holds its own against the hollow)
        e.size_x, e.size_y, e.size_z = (x / (K * R) for x in ext)
    for c, ext in void:
        e = mb.elements.new(type='ELLIPSOID'); e.co = c; e.radius = R; e.use_negative = True; e.stiffness = 2.5
        e.size_x, e.size_y, e.size_z = (x / (K * R) for x in ext)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    o = bpy.data.objects.new(f'cave-{style}', me); bpy.context.scene.collection.objects.link(o)
    # even triangles, lumps, smooth, fewer
    m = o.modifiers.new('remesh', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = 0.7 if big else 0.35
    tex = bpy.data.textures.new(f'{style}-lumps', 'CLOUDS'); tex.noise_scale = 6.0; tex.noise_depth = 3
    m = o.modifiers.new('lumps', 'DISPLACE'); m.texture = tex; m.strength = 1.6; m.mid_level = 0.5
    m = o.modifiers.new('smooth', 'SMOOTH'); m.factor = 0.5; m.iterations = 4
    m = o.modifiers.new('fewer', 'DECIMATE'); m.ratio = 0.1 if big else 0.12
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.clear(); o.data = me2
    # under the ground: cut 2 m down (the game sinks the foot onto its land)
    bm = bmesh.new(); bm.from_mesh(me2)
    if not big: bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, -2.0), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    # ROCK where a face looks INTO the cave: rays out from it (along its normal, and four tilted) hit the cave's own walls
    # — outside, they get away to the sky; and near a void blob facing its centre (the passage's walls by the mouth,
    # whose rays leave through the opening)
    from mathutils.bvhtree import BVHTree
    bm.normal_update(); tree = BVHTree.FromBMesh(bm)
    rock = 0
    for f in bm.faces:
        p = f.calc_center_median(); n = f.normal; t1 = n.orthogonal().normalized(); t2 = n.cross(t1)
        hits = 0
        for d in (n, (n + 0.6 * t1).normalized(), (n - 0.6 * t1).normalized(), (n + 0.6 * t2).normalized(), (n - 0.6 * t2).normalized()):
            h = tree.ray_cast(p + d * 0.05, d, 80.0)
            if h[0] is not None: hits += 1
        mi = 1 if hits >= 3 else 0
        if not mi:
            for c, ext in void:
                q = math.sqrt(sum(((p[i] - c[i]) / ext[i]) ** 2 for i in range(3)))
                if q < 1.3 and n.dot(Vector(c) - p) > 0 and p.y > -1.0: mi = 1; break
        if big and p.z < -1.5 and hits >= 1: mi = 1  # (below the ground: all of it the cave's)
        f.material_index = mi; rock += mi
        f.smooth = True
    bm.to_mesh(me2); bm.free()
    log(style, 'triangles', len(me2.polygons), 'rock', rock)
    return o

# ---------------------------------------------------------------------------------------------------------- export
import json
def export_world(o, out):
    """THE CAVE WORLD into the game (public/oth/valley/cave.glb + cave.json): the mesh moved so its MOUTH (the way in's
    floor where the hill closes over it) is the origin, in the game's frame (glTF: y up, the mouth looking toward +z);
    split into TURF (the hill), ROCK (the cave), GARDEN (the turf in the skylight's light) and a lighter COLLIDER; and
    beside it: the hill's TOP (a 2 m height grid — the trees go on it), the garden's pines and tufts, the stones round
    the mouth and on the way to it, the skylight, the dark's reach."""
    F, xs, ys, zs, h, Vd = WORLD
    def field(x, y, z):
        i, j, k = int(round((x - xs[0]) / h)), int(round((y - ys[0]) / h)), int(round((z - zs[0]) / h))
        return float(F[i, j, k])
    my = -40.0
    cz0 = ARCH[0][2] + ARCH[2] - 0.8
    while field(0, my, cz0) > 0 and my < 20: my += 0.25  # (the first solid over the way in, the arch's crown's height)
    M = Vector((0, my, 0))
    log('export: mouth at y', my)
    me = o.data
    for v in me.vertices: v.co -= M
    me.validate(clean_customdata=False); me.update()
    G = lambda v: [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]  # Blender → the game's local frame
    # the parts
    os.makedirs(out, exist_ok=True)
    col = bpy.data.collections.new('cave-export'); bpy.context.scene.collection.children.link(col)
    def part(name, keepm):
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in keepm], context='FACES')
        m2 = bpy.data.meshes.new(name); bm.to_mesh(m2); bm.free()
        ob = bpy.data.objects.new(name, m2); col.objects.link(ob); return ob
    parts = [part('turf', (0,)), part('rock', (1,)), part('garden', (2,)), part('arch', (3,)), part('floor', (4,))]
    cm = me.copy(); cob = bpy.data.objects.new('collider', cm); col.objects.link(cob)
    d = cob.modifiers.new('fewer', 'DECIMATE'); d.ratio = 0.3
    for ob in parts: log('export:', ob.name, len(ob.data.polygons), 'triangles')
    # the hill's TOP: a ray down every 2 m; kept where it lands on the turf (not down the skylight)
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); tree = BVHTree.FromBMesh(bm)
    mats = [f.material_index for f in bm.faces]
    X0, X1, Z0, Z1, ST = -132, 132, -190, 34, 2.0  # (game local: z = −Blender y)
    nx, nz = int((X1 - X0) / ST) + 1, int((Z1 - Z0) / ST) + 1
    top = []
    for j in range(nz):
        for i in range(nx):
            gx, gz = X0 + i * ST, Z0 + j * ST
            hit = tree.ray_cast(Vector((gx, -gz, 140)), Vector((0, 0, -1)), 260)
            ok = hit[0] is not None and mats[hit[2]] == 0 and hit[1].z > 0.25 and hit[0].z > 0.3
            top.append(round(hit[0].z, 2) if ok else None)
    # the GARDEN: points on its faces (area-weighted) — 4 young pines near the light's middle, tufts all over
    R = _r.Random(3); gf = [f for f in bm.faces if f.material_index == 2]
    def on_garden():
        f = R.choices(gf, weights=[f.calc_area() for f in gf])[0]; a, b, c = (v.co for v in f.verts)
        u, w = R.random(), R.random()
        if u + w > 1: u, w = 1 - u, 1 - w
        return a + (b - a) * u + (c - a) * w
    sx, sy = SKY[0][0] - M.x, SKY[0][1] - M.y
    pines = []
    for _ in range(600):
        p = on_garden()
        if any(math.hypot(p.x - (c[0] - M.x), p.y - (c[1] - M.y)) < r * 1.7 for c, r in (SKY, SKY2)) and all(math.hypot(p.x - q[0], -p.y - q[2]) > 2.8 for q in pines) and not near_lane(p.x + M.x, p.y + M.y, 1.0) and not in_pool(p.x + M.x, p.y + M.y, 1): pines.append(G(p))  # (never by the lane: a car met one)
        if len(pines) >= 9: break
    tufts = [G(on_garden()) for _ in range(420)] if gf else []
    # THE FLOOR'S growth (the user: "bushes, make the cave inside beautifully full"): spots on the floor off the lane
    ff = [f for f in bm.faces if f.material_index == 4]
    fw = [f.calc_area() for f in ff]
    def on_floor():
        f = R.choices(ff, weights=fw)[0]; a, b, c = (v.co for v in f.verts)
        u, w = R.random(), R.random()
        if u + w > 1: u, w = 1 - u, 1 - w
        return a + (b - a) * u + (c - a) * w
    def off_way(p, m):
        q = p + M  # (back in the field's frame)
        return not near_lane(q.x, q.y, m - LANE) and not in_pool(q.x, q.y, 1.2) \
            and (m < 6 or ((q.x - HAVEN[0][0]) / (HAVEN[1][0] + 3)) ** 2 + ((q.y - HAVEN[0][1]) / (HAVEN[1][1] + 3)) ** 2 > 1)
    fl_tufts, fl_bushes = [], []
    for _ in range(9000):
        if len(fl_tufts) >= 2600: break
        p = on_floor()
        if off_way(p, 4.6): fl_tufts.append(G(p))
    for _ in range(8000):
        if len(fl_bushes) >= 110: break
        p = on_floor()
        if off_way(p, 6.5): fl_bushes.append(G(p))
    # TREES inside (the user: "trees — like a different place"): on the floor, ≥ 12 m clear over them, off the way,
    # 6 m apart; most in the far chamber and the hall
    trees_in = []
    for _ in range(6000):
        if len(trees_in) >= 34: break
        p = on_floor()
        if not off_way(p, 8.0) or any(math.hypot(p.x - t[0], -p.y - t[2]) < 6 for t in trees_in): continue
        up = tree.ray_cast(p + Vector((0, 0, 0.3)), Vector((0, 0, 1)), 120)
        if up[0] is None or (up[0].z - p.z) >= 12: trees_in.append(G(p) + [round(min(22.0, (up[0].z - p.z) - 3) if up[0] is not None else 22.0, 1)])
    # the STONES: a few on the way to it (the arch frames the mouth — no ring of stones round it)
    rnd = _r.Random(11); stones = []
    for i in range(10):  # (the way to it: either side of the path)
        x = rnd.uniform(-9, 9); y = rnd.uniform(-30, -8)
        if abs(x) < 3.0: x += 3.5 * (1 if x >= 0 else -1)
        stones.append([round(x, 2), 0.0, round(-y, 2), round(rnd.uniform(0.2, 0.6), 2), round(rnd.uniform(0, 6.28), 2)])
    bm.free()
    meta = {
        'about': 'scripts/oth/caves.py (Blender): the cave world — local frame: the mouth at the origin looking +z, y up, the ground at y = 0',
        'top': {'x0': X0, 'z0': Z0, 'step': ST, 'nx': nx, 'nz': nz, 'h': top},
        'foot': {'cx': FOOT[0][0] - M.x, 'cz': -(FOOT[0][1] - M.y), 'rx': FOOT[1][0], 'rz': FOOT[1][1]},
        'sky': [round(sx, 2), round(-sy, 2), SKY[1]],
        'dark': {'z1': round(-sy, 2), 'r': 92, 'top': 72},
        'pines': pines, 'tufts': tufts, 'stones': stones, 'floorTufts': fl_tufts, 'floorBushes': fl_bushes,
        'lake': [round(POOL[0][0] - M.x, 2), LAKE_LEVEL, round(-(POOL[0][1] - M.y), 2), POOL[1][0], POOL[1][1]],
        'lakes': [[round(c[0] - M.x, 2), round(fz - 0.35, 2), round(-(c[1] - M.y), 2), r[0], r[1]] for c, r, fz in POOLS],
        'sky2': [round(SKY2[0][0] - M.x, 2), round(-(SKY2[0][1] - M.y), 2), SKY2[1]],
        'innerTrees': trees_in,
        'haven': [round(HAVEN[0][0] - M.x, 2), HAVEN[2], round(-(HAVEN[0][1] - M.y), 2), HAVEN[1][0], HAVEN[1][1]],
    }
    with open(os.path.join(out, 'cave.json'), 'w') as fh: json.dump(meta, fh, separators=(',', ':'))
    bpy.ops.object.select_all(action='DESELECT')
    for ob in col.objects: ob.select_set(True)
    path = os.path.join(out, 'cave.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                              export_texcoords=False, export_materials='NONE', export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7, export_draco_position_quantization=18, export_draco_normal_quantization=10)
    log(f'export: {path} {os.path.getsize(path) / 1e6:.2f} MB, cave.json {os.path.getsize(os.path.join(out, "cave.json")) / 1e3:.0f} KB, pines {len(pines)}, tufts {len(tufts)}, stones {len(stones)}')
    bpy.data.collections.remove(col)
    for v in me.vertices: v.co += M
    me.update()

# ---------------------------------------------------------------------------------------------------------- stones
import random
def stone_mesh(name, rnd, size):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    k = [rnd.uniform(0, 6.28) for _ in range(6)]
    for v in bm.verts:  # lumpy, rounded — the stylized boulder (refer/caves/80lv-stylized-cave-8, -19)
        p = v.co; w = 1 + 0.16 * math.sin(3 * p.x + k[0]) * math.sin(2.6 * p.y + k[1]) + 0.1 * math.sin(4.4 * p.z + k[2] + 2 * p.x)
        v.co = Vector((p.x * size[0] * w, p.y * size[1] * w, p.z * size[2] * w))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for f in me.polygons: f.use_smooth = True
    return me

def rim_stones(o, style, rnd):
    """Rounded stones half sunk round the mouth's rim (where grass meets rock at the front), and a few on the ground
    before it (the path's) — (x, y, z, size, rot) each."""
    me = o.data; out = []
    rim = []
    # (the rim: vertices shared by a grass face and a rock face, at the front)
    mat_of = {}
    for f in me.polygons:
        for vi in f.vertices: mat_of.setdefault(vi, set()).add(f.material_index)
    for vi, ms in mat_of.items():
        v = me.vertices[vi].co
        if len(ms) == 2 and v.y < 1.5: rim.append(Vector(v))
    rim.sort(key=lambda v: math.atan2(v.z - 1.0, v.x))
    n = 12 if style != 'den' else 8
    for i in range(n):
        if not rim: break
        v = rim[int((i + rnd.random() * 0.6) * len(rim) / n) % len(rim)]
        s = rnd.uniform(0.55, 1.25) * (0.8 if style == 'den' else 1)
        out.append((v.x, v.y - 0.3 * s, v.z, s, rnd.uniform(0, 6.28)))
    for i in range(9):  # before the mouth, along the way out (the path's stones)
        x = rnd.uniform(-7, 7); y = rnd.uniform(-14, -3)
        if abs(x) < 1.6: x += 2.2 * (1 if x >= 0 else -1)
        out.append((x, y, 0.0, rnd.uniform(0.18, 0.5), rnd.uniform(0, 6.28)))
    return out

# ---------------------------------------------------------------------------------------------------------- preview
def mat(name, rgb, rough=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    return m

def preview(caves):
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 1280; sc.render.resolution_y = 720
    sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.68, 0.85, 1); sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
    sc.view_settings.view_transform = 'Standard'
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 4.5; sun.data.angle = math.radians(1.5); sun.rotation_euler = (math.radians(55), math.radians(0), math.radians(-40))
    grass, rockm = mat('grass', (0.55, 0.42, 0.16)), mat('rock', (0.33, 0.33, 0.34), 0.8)
    # (the preview's rock: two greys by a noise, moss on what faces up — only to read the forms; the game paints its own)
    nt = rockm.node_tree; bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.08
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (0.22, 0.23, 0.26, 1); ramp.color_ramp.elements[1].color = (0.45, 0.43, 0.40, 1)
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.72; mr.inputs['From Max'].default_value = 0.9; nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs['B'].default_value = (0.2, 0.3, 0.12, 1)
    nt.links.new(mr.outputs['Result'], mix.inputs['Factor']); nt.links.new(ramp.outputs['Color'], mix.inputs['A']); nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    ground = mat('ground', (0.5, 0.39, 0.15))
    bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, 0)); plane = bpy.context.active_object; plane.data.materials.append(ground)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 24
    aim = bpy.data.objects.new('aim', None); sc.collection.objects.link(aim)
    con = cam.constraints.new('TRACK_TO'); con.target = aim; con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
    stonem = mat('stone', (0.42, 0.42, 0.40), 0.9)
    for o in caves: o.data.materials.append(grass); o.data.materials.append(rockm); o.data.materials.append(grass)
    stones = {}
    for o in caves:
        style = o.name.split('-')[1]; rnd = random.Random(hash(style) & 0xffff); objs = []
        for k, (x, y, z, sz, rot) in enumerate(rim_stones(o, style, rnd)):
            so = bpy.data.objects.new(f'{style}-stone{k}', stone_mesh(f'{style}-stone{k}', rnd, (sz * 1.25, sz, sz * 0.75)))
            so.location = (x, y, z); so.rotation_euler = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rot)
            so.data.materials.append(stonem); sc.collection.objects.link(so); objs.append(so)
        stones[o] = objs
    glow = bpy.data.objects.new('glow', bpy.data.lights.new('glow', 'POINT')); sc.collection.objects.link(glow); glow.data.energy = 6000
    # (the cave world's chambers: a lamp each, for its inside views and the cut-away)
    lamps = []
    for k, (pos, e) in enumerate([((-8, 72, 9), 9000), ((54, 102, 8), 6000), ((10, 120, 7), 2500), ((4, 24, 6), 1500), ((-26, 27, 7), 1000), ((32, 63, 6), 2000), ((0, 46, 6), 2500), ((48, 80, 6), 2000)]):
        L = bpy.data.objects.new(f'lamp{k}', bpy.data.lights.new(f'lamp{k}', 'POINT')); L.data.energy = e; L.location = pos; L.hide_render = True
        sc.collection.objects.link(L); lamps.append(L)
    for o in caves:
        style = o.name.split('-')[1]
        for c in caves:
            c.hide_render = c is not o
            for so in stones[c]: so.hide_render = c is not o
        hill, void = cave_spec(style)
        ch = void[0][0]
        views = {
            'a_front': ((3, -42, 5), (0, 6, 4)), 'b_three_quarter': ((-38, -32, 16), (0, 10, 3)), 'c_above': ((34, -14, 46), (0, 14, 0)),
            'd_inside': ((0.5, -1, 2.0), (ch[0], ch[1], ch[2])), 'e_inside_out': ((ch[0], ch[1] - 2, 2.2), (0, -20, 2.5)),
        }
        if style == 'world':
            views = {  # (name: from, to, near clip — the cut-away's slices the roof off, the inside ones are lamp-lit)
                'a_front': ((8, -90, 10), (0, 20, 6), None), 'b_three_quarter': ((-150, -110, 60), (0, 70, 0), None), 'c_above': ((110, -80, 170), (0, 70, -5), None),
                'd_cutaway': ((10, 70, 190), (10, 71, 0), 190 - 3), 'e_way_in': ((0.5, -14, 2.4), (4, 24, 4), None), 'f_great_hall': ((2, 46, 5), (-10, 76, 4), None),
                'g_hall_up': ((-2, 70, 5), (-10, 72, 40), None), 'j_hall_wide': ((10, 86, 6), (-20, 60, 4), None), 'h_lower_chamber': ((52, 88, 4.5), (56, 108, 3), None), 'i_loop': ((-21, 92, 5.5), (12, 121, 4), None),
            }
        for v, view in views.items():
            frm, to = view[0], view[1]; clip = view[2] if len(view) > 2 else None
            if style == 'world' and v[:2] not in ('a_', 'b_', 'c_', 'd_'): frm = open_air(frm)
            cam.location = frm; aim.location = to
            cam.data.clip_start = clip if clip else 0.1; cam.data.clip_end = 1000
            inside = v[:2] in ('d_', 'e_', 'f_', 'g_', 'h_', 'i_', 'j_')
            glow.location = ch; glow.hide_render = style == 'world' or not v.startswith(('d_', 'e_'))  # (a lamp in the chamber: to see the inside's shape only)
            for L in lamps: L.hide_render = style != 'world' or not inside
            plane.hide_render = style == 'world' and inside
            sc.render.filepath = os.path.abspath(os.path.join(PREVIEW, f'{style}_{v}.png'))
            bpy.ops.render.render(write_still=True)
            log('render', style, v)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(PREVIEW, 'caves.blend')))

# ---------------------------------------------------------------------------------------------------------- run
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
caves = []
for i, s in enumerate(STYLES):
    o = build(s); o.location.x = 0; caves.append(o)
    if s == 'world' and ARGS.get('OUT'): export_world(o, ARGS['OUT'])
if ARGS.get('PREVIEW', '') != 'none': preview(caves)
log('done')
