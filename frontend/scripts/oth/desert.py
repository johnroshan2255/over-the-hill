# OVER THE HILL — the DESERT's terrain (Blender's Python + numpy), the second world (2026-11-02, the user: "Red desert
# canyons … check Over the Hill's desert and make it exactly like that … make this new map in Blender so you can sculpt
# the desert cliffs, rocks and the oasis").
#
#   blender -b --factory-startup --python scripts/oth/desert.py -- [OUT=public/oth/desert] [PREVIEW=<dir>] [SEED=7]
#
# Their desert (Over the Hill's Algeria region, the Steam shots): an OASIS RIVER winding along a canyon floor — palms,
# green scrub and round bushes on pale orange sand — between red sandstone walls of STACKED SLABS (flat tops, rounded
# edges, layer on layer); tall pointed SPIRES on the plateaus; a NATURAL ARCH the track drives over; a deep GORGE of
# huge blocks with rapids and a plank bridge; a waterfall at the head of the canyon; DUNES; ruins by the water.
# Built here as real terrain, the sandstone's beds TERRACED into the heights (the walls step in benches — physics, the
# shadows, the culling all see them); desert_rocks.py then models the slabs' skins, the spires, the arch and the
# gorge's blocks in Blender over it (formations.glb).
#
# Writes the same files as the valley (terrain.py): height.bin (2 m), far.bin (16 m), mask.bin (4 m: R rock,
# G loose sand, B wet / water, A oasis growth), trail.bin, meta.json (+ the GATE: the pass road the crossing arrives
# on), and scripts/oth/.cache/desert.npz for desert_rocks.py.
import sys, os, math, json, time, heapq
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrainlib import hash2, gnoise, fbm, ridged, smoothstep, blur, grid, bilinear, spline, polyline_field, chaikin, rdp, resample
from ledgeroad import LedgeRoad

T0 = time.time()
ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/desert')
PREVIEW = ARGS.get('PREVIEW')
SEED = int(ARGS.get('SEED', 7))
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)

HALF = 2048.0          # the box
FAR_HALF = 8192.0      # the world
N_IN = 2049            # 2 m
N_MID = 1025           # 4 m (masks)
N_FAR = 1025           # 16 m
BED = 9.0              # the sandstone's bed (a slab's thickness, m)

# ---------------------------------------------------------------------------------------------------------- layout
# (x east, z south: north is −z.) The crossing arrives on the HIGH PLATEAU at the south edge (the pass, in the cloud)
# and the road comes down the ESCARPMENT onto the PLAIN; the oasis CANYON runs west → east across the middle, a
# waterfall at its head (west), the lagoon and the old aqueduct in its wide reach, the GORGE at its east end; the
# NORTH PLATEAU above it carries the spire field (west) and the arch over a side slot (east); the DUNES fill the
# plain's west.
PLAIN = 160.0
NORTH = 238.0
HIGH = 318.0
RIVER_P = np.array([(-1640, 40), (-1380, 110), (-1100, 60), (-820, 180), (-520, 120), (-260, 250), (60, 170), (360, 290),
                    (680, 200), (960, 260), (1240, 170), (1560, 240), (1880, 150), (2400, 220)], float)
RIVER = spline(RIVER_P, 6.0)
_racc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(RIVER, axis=0).T))])
RIVER_LEN = _racc[-1]
# (its course on beyond the box, east to the world's edge: the far world's gorge — only there; the box keeps RIVER)
RIVER_OUT = spline(np.array([(2400, 220), (2950, 330), (3600, 250), (4300, 420), (5100, 360), (6000, 520), (7000, 460),
                             (8400, 600)], float), 16.0)
RIVER_FAR = np.vstack([RIVER, RIVER_OUT[1:]])
def river_x_at(s): return np.interp(s, _racc, RIVER[:, 0])
# the canyon floor's half width (m) along the river: the head's amphitheatre, the wide oasis reach, the gorge
def floor_hw(s):
    x = np.interp(s, _racc, RIVER[:, 0])
    w = 190 + 70 * np.sin(s / 520 + 1.3) + 40 * np.sin(s / 210)
    w = np.where(x < -1450, 150 + (x + 1640) * 0.4, w)                  # (the head: closing to the falls)
    return np.where(x > 860, 70 - 25 * smoothstep(860, 1300, x) + 10 * np.sin(s / 90), w)  # (the gorge)
def wall_w(s):
    x = np.interp(s, _racc, RIVER[:, 0])
    return np.where(x > 860, 26.0, 150 + 50 * np.sin(s / 300 + 0.4))
# the floor's height: the water's level + a bank; the river falls 104 → 96 along the oasis, then down the gorge's rapids
def river_surface(s):
    x = np.interp(s, _racc, RIVER[:, 0])
    return 104 - 8 * smoothstep(-1640, 860, x) - 30 * smoothstep(860, 2300, x)
def river_hw(s):
    x = np.interp(s, _racc, RIVER[:, 0])
    return np.where(x > 860, 7.0, 10 + 4 * np.sin(s / 160))
LAGOON = dict(cx=-330.0, cz=290.0, rx=145.0, rz=80.0, rot=0.25)   # (on the floor, beside the river — never into a wall)
FALL = dict(x=-1700.0, z=10.0)       # the waterfall: off the north plateau into the head pool
ARCH = dict(x=1180.0, z=-760.0, rot=math.pi / 2, span=46.0)   # the natural arch over the side slot (the track runs W–E over it)
SLOT = np.array([(1260, -1500), (1210, -1150), (1180, -760), (1150, -420), (1120, -60)], float)  # the slot, to the gorge
GORGE_BRIDGE_X = 1420.0
AQUEDUCT = dict(x0=-560.0, z0=600.0, x1=-90.0, z1=560.0)   # across the valley floor behind the lagoon (south side)
KSAR = dict(x=980.0, z=1020.0)       # the ruins in the basin below a blind summit (south-east)

X, Z = grid(N_IN, HALF)
CELL = 2 * HALF / (N_IN - 1)

# THE STRATA (2026-11-04 — the user: the walls looked "like a trenched hill", every slope cut into the same 9 m steps
# by the old terrace()):
# the sandstone in beds of their OWN thickness, 7–37 m — most HARD (a cliff over a short bench: the riser 25–55 % of
# the bed), a third SOFT (no step: a plain slope of crumbled rock between two cliffs). The table is the same for every
# wall, so a hard bed reads as one cliff band right round a mesa — but the beds are offset at the JOINTS (joint_offsets):
# no ledge runs on unbroken.
_srng = np.random.default_rng(SEED + 90)
_LB, _LT, _LH, _LC = [-160.0], [], [], []
while _LB[-1] < 900.0:
    soft = _srng.random() < 0.3
    t = _srng.uniform(3.0, 10.0) if soft else 7.0 + 30.0 * _srng.random() ** 1.3
    _LT.append(t); _LH.append(0.0 if soft else _srng.uniform(0.8, 1.0)); _LC.append(_srng.uniform(0.45, 0.7))
    _LB.append(_LB[-1] + t)
LAYER_B, LAYER_T, LAYER_H, LAYER_C = np.array(_LB[:-1]), np.array(_LT), np.array(_LH), np.array(_LC)

def strata(h, phase=None):
    """h → the beds' height: within a bed (base b, thickness t), a hard bed's bench then its riser, a soft bed unchanged."""
    p = 0 if phase is None else phase
    q = h + p
    k = np.clip(np.searchsorted(LAYER_B, q, side='right') - 1, 0, len(LAYER_B) - 1)
    b, t, hd, c = LAYER_B[k], LAYER_T[k], LAYER_H[k], LAYER_C[k]
    f = np.clip((q - b) / t, 0.0, 1.0)
    s = np.clip((f - (1 - c)) / c, 0.0, 1.0)
    g = (1 - hd) * f + hd * s * s * (3 - 2 * s)
    return b + t * g - p

def joint_offsets(X, Z, cell, seed, amp):
    """The JOINTS: the rock split into blocks ~cell across (a jittered-grid Voronoi), each slumped its own ±amp/2 m —
    a bed's ledge steps up or down where it crosses a joint, the way a real wall is cut by vertical cracks."""
    gx0, gz0 = np.floor(X / cell).astype(np.int64), np.floor(Z / cell).astype(np.int64)
    best = np.full(X.shape, 1e18); val = np.zeros(X.shape)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            cx, cz = gx0 + di, gz0 + dj
            fx = (cx + (hash2(cx, cz, seed) & 1023) / 1024.0) * cell
            fz = (cz + (hash2(cx, cz, seed + 1) & 1023) / 1024.0) * cell
            d = (X - fx) ** 2 + (Z - fz) ** 2
            m = d < best
            best = np.where(m, d, best)
            val = np.where(m, (hash2(cx, cz, seed + 2) & 1023) / 1023.0 - 0.5, val)
    return val * amp

def local_min(A, r):
    """The lowest value within r cells (a square window, separable) — the ground a wall's foot stands on."""
    out = A.copy()
    for ax in (0, 1):
        src = out.copy()
        p = np.pad(src, [((r, r) if k == ax else (0, 0)) for k in range(2)], mode='edge')
        n = src.shape[ax]
        for o in range(2 * r + 1):
            sl = [slice(None), slice(None)]; sl[ax] = slice(o, o + n)
            out = np.minimum(out, p[tuple(sl)])
    return out

def relief(X, Z):
    """THE LAND'S OWN RELIEF (2026-11-04 — the user: "a big flat plane with hills put in random places … it needs real
    natural heights"): broad swells and basins, ridges and valleys a few hundred metres across, knolls on them — all
    domain-warped, so nothing is round or regular. Returns (metres, high): `high` 0..1 is the high ground, where the
    rock masses stand (canyon_country)."""
    wx = X + 260 * fbm(X / 1600, Z / 1600, SEED + 101, 2)
    wz = Z + 260 * fbm(X / 1600 + 3.1, Z / 1600, SEED + 102, 2)
    big = fbm(wx / 1500, wz / 1500, SEED + 1, 3)
    mid = fbm(wx / 520, wz / 520, SEED + 103, 3)
    ridge = ridged(wx / 850, wz / 850, SEED + 104, 3)
    R = 60 * big + 27 * mid + 32 * (ridge - 0.45) + 8 * fbm(X / 170, Z / 170, SEED + 2, 3)
    high = smoothstep(-0.12, 0.1, 0.55 * big + 0.32 * mid + 0.45 * (ridge - 0.45) + 0.08 * fbm(X / 220, Z / 220, SEED + 105, 2))
    return R, high

def landforms(X, Z, inner=True):
    """The big shapes: the plain, the north plateau, the high south plateau, mesas, spires, dunes (no canyon yet)."""
    # (the plain: no plain — the land's relief, never below ~20 m over the canyon's rim level)
    R_ = relief(X, Z)[0]
    H = PLAIN + 18 + R_
    # (the plateaus have it too — 2026-11-04: they were two flat tables — calmed only where something sits at a set
    #  level: the falls' lip, the arch's slot, the pass, the gate and the escarpment's road)
    def _rect(x0, x1, z0, z1): return np.hypot(np.maximum(np.maximum(x0 - X, X - x1), 0), np.maximum(np.maximum(z0 - Z, Z - z1), 0))
    damp_n = smoothstep(150, 400, np.hypot(X - FALL['x'], Z - FALL['z'])) * smoothstep(60, 220, _rect(1050, 1330, -1600, -300))
    damp_s = smoothstep(60, 220, _rect(-220, 440, 1380, 2200))
    # the NORTH PLATEAU: its rim a ragged line (bays and promontories); the plateau's top slopes gently, slickrock
    rim = Z + 340 + 160 * fbm(X / 700, Z / 700, SEED + 3, 3) + 60 * fbm(X / 180, Z / 180, SEED + 4, 2)
    up = 1 - smoothstep(-60, 30, rim)
    top = NORTH + 10 * fbm(X / 600, Z / 600, SEED + 5, 2) + 5 * fbm(X / 120, Z / 120, SEED + 6, 2) + 0.7 * R_ * damp_n
    H = H + (top - H) * up ** 0.8
    # the HIGH PLATEAU in the south (the pass): the escarpment's foot ~ z 1430, its rim ~ z 1600
    rim2 = Z - 1520 - 90 * fbm(X / 600, Z / 600, SEED + 7, 3) - 40 * fbm(X / 150, Z / 150, SEED + 8, 2)
    up2 = smoothstep(-80, 40, rim2)
    H = H + (HIGH + 8 * fbm(X / 500, Z / 500, SEED + 9, 2) + 0.55 * R_ * damp_s - H) * up2 ** 0.75
    # DUNES (the erg): the plain's west and the far world's — crescent ridges across the wind (from the north-west),
    # a long windward slope, a steep slip face; their crests wander
    wind = 0.6
    u = X * math.cos(wind) + Z * math.sin(wind)
    v = -X * math.sin(wind) + Z * math.cos(wind)
    warp = 90 * fbm(v / 420, u / 420, SEED + 10, 2) + 30 * fbm(v / 150, u / 150, SEED + 11, 2)
    # (crescents: the crest bowed downwind between its horns — the phase pushed back with the distance from a ridge's
    #  middle, each ridge its own length)
    def train(u, v, lam, s_):
        cres = 0.22 * lam * np.abs(np.sin(v / (lam * 1.25) + 1.7 * fbm(u / 900, v / 900, s_, 2)))
        t = (u + warp - cres) / lam
        f = t - np.floor(t)
        return np.where(f < 0.7, smoothstep(0, 0.7, f), 1 - smoothstep(0.7, 1.0, f))
    u2 = X * math.cos(wind + 0.9) + Z * math.sin(wind + 0.9); v2 = -X * math.sin(wind + 0.9) + Z * math.cos(wind + 0.9)
    saw = np.maximum(train(u, v, 210.0, SEED + 14), 0.65 * train(u2, v2, 140.0, SEED + 15))
    amp = 24 + 26 * smoothstep(-0.4, 0.4, fbm(X / 700, Z / 700, SEED + 12, 2))
    # (the far world's erg carries the box's on west: it stopped at the box's edge — DESERT_MATCH.md §8)
    band = (1 - smoothstep(-250, 150, X)) * smoothstep(540, 720, Z) * (1 - smoothstep(1300, 1440, Z))
    erg = band if inner else \
        np.maximum(band, np.clip(smoothstep(2600, 3800, np.abs(X) + 0.3 * np.abs(Z)) * (0.5 + 0.5 * fbm(X / 3000, Z / 3000, SEED + 13, 2)), 0, 1))
    H = H + saw * amp * erg
    return H, up, up2, erg

log('landforms (2 m)')
H, UPN, UPS, ERG = landforms(X, Z)

# MESAS and BUTTES: stacked flat-topped stands on the plain and in the canyon's wide reach
rng = np.random.default_rng(SEED)
MESAS = []
MESAK = np.zeros_like(H)
def blob_r(a, R, s):
    return R * (1 + 0.22 * np.sin(3 * a + s) + 0.12 * np.sin(5 * a + 2 * s) + 0.08 * np.sin(9 * a + 3 * s))
for (mx, mz, R, top) in [(-1250, 900, 120, 70), (-900, 1180, 70, 95), (420, 820, 150, 60), (720, 640, 60, 85),
                         (-120, 1150, 90, 50), (1500, 1050, 130, 75), (1750, 700, 70, 90), (-1650, 1300, 110, 80),
                         (240, 1380, 60, 70), (1300, 1380, 80, 55)]:
    MESAS.append((mx, mz, R, top))
    dx, dz = X - mx, Z - mz
    ang = (mx * 0.013) % math.pi; ca, sa = math.cos(ang), math.sin(ang)
    u_, v_ = dx * ca + dz * sa, (-dx * sa + dz * ca) * 1.45   # (elongated)
    win = (np.abs(dx) < R * 2.2) & (np.abs(dz) < R * 2.2)
    d = np.where(win, np.hypot(u_, v_), 1e9)
    d = d + R * (0.42 * fbm(X / (R * 0.9), Z / (R * 0.9), SEED + int(mx) % 997, 3) + 0.15 * fbm(X / (R * 0.3), Z / (R * 0.3), SEED + 5 + int(mz) % 997, 2))
    k = 1 - smoothstep(R - 6, R + 22, d)
    MESAK = np.maximum(MESAK, k)
    base = bilinear(H, HALF, np.array([mx]), np.array([mz]))[0]
    H = np.where(k > 0.001, np.maximum(H, base + top * k ** 0.7 * (0.96 + 0.04 * fbm(X / 60, Z / 60, SEED + int(mx), 2))), H)  # (its own footprint only)
# SPIRES: the north-west plateau's rock forest (Tassili) — clusters of tall stacked needles, a few broad towers
SPIRES = []
SPK = np.zeros_like(H)   # (where a spire stands: the joints keep off them — a joint across a tower cut a recessed panel)
for c in range(9):
    cx = -1700 + rng.random() * 1500; cz = -1850 + rng.random() * 1050
    for k in range(int(4 + rng.random() * 7)):
        sx, sz = cx + rng.normal() * 90, cz + rng.normal() * 90
        if any(math.hypot(sx - a, sz - b) < 26 for a, b, _, _ in SPIRES): continue
        hgt = 28 + rng.random() * 58; r = hgt * (0.22 + rng.random() * 0.14)
        SPIRES.append((sx, sz, r, hgt))
# (2026-11-04 — TOWERS, not cones: the smooth cones read as nothing real. A real rock forest's towers are blocky
#  columns — a domed top, near-sheer fluted sides, an irregular outline — standing on a cone of their own rubble)
for si, (sx, sz, r, hgt) in enumerate(SPIRES):
    dx, dz = X - sx, Z - sz
    m = (np.abs(dx) < r * 1.3 + 2) & (np.abs(dz) < r * 1.3 + 2)
    if not m.any(): continue
    a = np.arctan2(dz[m], dx[m])
    d = np.hypot(dx[m], dz[m]) / (r * (1 + 0.16 * np.sin(3 * a + si) + 0.08 * np.sin(5 * a + 2 * si) + 0.05 * np.sin(9 * a + 3 * si)))
    base = bilinear(H, HALF, np.array([sx]), np.array([sz]))[0]
    # (2026-11-04: most come to a POINT — faceted needles, the stylised look; a third keep a domed top)
    pointed = si % 3 != 0
    top = (1 - 0.32 * np.clip(d / 0.5, 0, 1) ** 1.1) if pointed else (1 - 0.08 * np.clip(d / 0.5, 0, 1) ** 2)
    side = (0.68 if pointed else 0.92) - ((0.43 if pointed else 0.67) * smoothstep(0.5, 0.68, d))   # (the wall)
    apron = 0.25 * (1 - smoothstep(0.68, 1.3, d)) ** 1.5                                 # (the rubble cone)
    prof = np.where(d < 0.5, top, np.where(d < 0.68, side, apron))
    H[m] = np.maximum(H[m], base + hgt * prof)
    SPK[m] = np.maximum(SPK[m], 1 - smoothstep(1.1, 1.3, d))

# CANYON COUNTRY (2026-11-04 — the user: "the main problem is the layout: a plane map, no height, just some rocks and
# some hills on a plane"). The plain is filled with RAISED ROCK MASSES — 40–120 m, in two tiers — and the routes run
# along CANYON FLOORS between them at the plain's old level (so every road, ramp, place and the gate still work): a
# corridor 30–60 m wide down each route, its walls wandering; winding SIDE CANYONS through the masses (a noise's zero
# line — long, connected), a few open sandy BASINS. On the plateaus smaller masses (fins and buttes on the skyline), the
# erg mostly open. The beds (strata, below) step every wall; desert_rocks.py skins them.
ROUTE_SKELETON = [
    [(-147, 1440), (-60, 1100), (-150, 790)],
    [(-1520, 130), (-1100, 120), (-760, 230), (-420, 30)],
    [(-420, 30), (-150, 340), (30, 310), (560, 320), (840, 250)],
    [(-760, -600), (-1000, -800), (-1350, -1200), (-900, -1500), (-500, -1250), (-760, -600)],
    [(-500, -1250), (200, -1300), (800, -1000), (ARCH['x'] - 150, ARCH['z'])],
    [(ARCH['x'] + 150, ARCH['z']), (1440, -560)],
    [(GORGE_BRIDGE_X, 640), (1300, 900), (KSAR['x'], KSAR['z']), (600, 1150), (-60, 1100)],
    [(-150, 790), (-600, 900), (-1100, 1050), (-1500, 900), (-1200, 700), (-700, 700), (-150, 790)],
    # (the ledge ramps' lines — desert.py's carve_ramp — and the escarpment's lead: never cut through a mass)
    [(-150, 790), (150, 760), (400, 660), (330, 520), (180, 470), (60, 400), (30, 310)],
    [(-420, 30), (-760, -10), (-1050, -150), (-1120, -380), (-900, -540), (-760, -600)],
    [(1440, -560), (1700, -360), (1560, -150), (1430, -20)],
    [(-107, 1440), (-187, 1440)],
]
def canyon_country(X, Z, H, up, up2, erg):
    log('canyon country')
    Dc = np.full(X.shape, 1e9)
    for P in ROUTE_SKELETON:
        T = resample(chaikin(spline(np.array(P, float), 6.0), 2), 20.0) if len(P) > 2 else resample(np.array(P, float), 20.0)
        Dc = np.minimum(Dc, polyline_field(X, Z, T, 160)[0])
    # the corridor: its half width wandering 30–60 m, its walls never a straight line
    Dw = Dc + 18 * fbm(X / 140, Z / 140, SEED + 80, 2) + 7 * fbm(X / 45, Z / 45, SEED + 81, 2)
    wc = 24 + 22 * smoothstep(-0.3, 0.3, fbm(X / 400, Z / 400, SEED + 82, 2))
    m = smoothstep(wc, wc + 42, Dw)
    # (2026-11-04: the masses stand on the HIGH GROUND — the relief's swells and ridges are rock, the valleys between
    #  sand — not dropped on a flat plain wherever a noise said)
    m = m * relief(X, Z)[1]
    # side canyons through the masses (where a warped noise crosses zero: long, winding, joined)
    wx_ = X + 120 * fbm(X / 700, Z / 700, SEED + 83, 2); wz_ = Z + 120 * fbm(X / 700, Z / 700, SEED + 84, 2)
    side = 1 - smoothstep(0.022, 0.055, np.abs(fbm(wx_ / 640, wz_ / 640, SEED + 85, 3)))
    m = m * (1 - side)
    # (a band down every route the masses never close: the corridors' wander could pinch one shut)
    m = m * smoothstep(14, 30, Dc)
    # where: the plain fully, the plateaus a little, the erg hardly; clear of the places and the spire forest
    zone = (1 - up) * (1 - up2) + 0.6 * up * (1 - up2)
    zone = zone * (1 - 0.8 * erg)
    for (cx, cz, r) in [(KSAR['x'], KSAR['z'], 150), (130, 1490, 290), (ARCH['x'], ARCH['z'], 160), (GORGE_BRIDGE_X, 220, 200),
                        (FALL['x'], FALL['z'], 220), (LAGOON['cx'], LAGOON['cz'], 220)]:
        zone = zone * smoothstep(r, r + 60, np.hypot(X - cx, Z - cz))
    zone = zone * (1 - smoothstep(0.02, 0.2, blur(SPK, 10)))
    m = blur(m * zone, 2)
    # two tiers: the mass's edge rises to its first, its heart (a wide blur: far from every edge) to the second
    inner = blur(m, 14)
    # (2026-11-04: their edges rise GRADUALLY — a long shoulder, not a step — the user: "a sudden rise")
    tiers = 0.58 * smoothstep(0.04, 0.5, m) + 0.42 * smoothstep(0.55, 0.9, inner)
    lift = 28 + 52 * smoothstep(-0.4, 0.5, fbm(X / 1300, Z / 1300, SEED + 87, 2))   # (the high ground is already high)
    U = lift * tiers * (1 + 0.06 * fbm(X / 150, Z / 150, SEED + 88, 2))
    log(f'  rock masses: {np.mean(m > 0.5) * 100:.0f} % of the box, up to {U.max():.0f} m')
    return H + U, m, Dc

H, MASSK, DC_ROUTES = canyon_country(X, Z, H, UPN, UPS, ERG)

# THE CANYON: carved along the river — the floor (its level just over the water), the walls rising to the plain or
# the plateau over wall_w(s), then the beds terraced into them. One carving for the box (2 m) and the far world
# (16 m): the river's gorge goes on east out of the box (DESERT_MATCH.md §8 — carved into the box only, it ended in
# a 92 m wall at the box's edge).
def carve_canyon(X, Z, H, L, chan=None, chan_depth=2.6):
    """The canyon along the polyline L, cut into H. chan: the channel's (full, none) half widths (m; default the
    river's own — the far world's 16 m cells need it wider to hold the water). Returns H, Dr (warped), DrW, Sr, fw."""
    Dr, Sr, _ = polyline_field(X, Z, L, 520)
    DrW = Dr.copy()   # (the river's own distance: its channel, its water, the banks — never warped)
    # (BUTTRESSES and ALCOVES — the walls are never a straight face: the floor's edge pushed in and out by 60–90 m
    #  every few hundred metres, smaller bays on those)
    Dr = Dr + 70 * fbm(X / 260, Z / 260, SEED + 22, 3) + 22 * fbm(X / 70, Z / 70, SEED + 23, 2)
    fw, ww = floor_hw(Sr), wall_w(Sr)
    floor = river_surface(Sr) + 1.8 + 1.6 * fbm(X / 140, Z / 140, SEED + 20, 2) * smoothstep(0, 40, Dr - river_hw(Sr))
    r = smoothstep(fw, fw + ww, Dr)
    gorge = smoothstep(820, 900, X)
    prof = (0.5 * smoothstep(0.0, 0.38, r) + 0.5 * smoothstep(0.62, 1.0, r)) * (1 - gorge) + r ** 0.5 * gorge
    Hc = floor + (H - floor) * prof
    H = np.where(Dr < 600, np.minimum(H, Hc), H)
    # the river's channel and the banks: the water 1.2–2.5 m below the floor, gravel bars
    rh = river_hw(Sr)
    a, b = (rh * 0.7, rh * 1.35) if chan is None else chan
    H = H - (1 - smoothstep(a, b, DrW)) * (chan_depth + 0.8 * fbm(X / 60, Z / 60, SEED + 21, 2))
    return H, Dr, DrW, Sr, fw

log('canyon')
H, Dr, DrW, Sr, fw = carve_canyon(X, Z, H, RIVER)
# the LAGOON: a basin carved to below its level
c_, s_ = math.cos(LAGOON['rot']), math.sin(LAGOON['rot'])
lx = (X - LAGOON['cx']) * c_ + (Z - LAGOON['cz']) * s_
lz = -(X - LAGOON['cx']) * s_ + (Z - LAGOON['cz']) * c_
Lq = np.hypot(lx / LAGOON['rx'], lz / LAGOON['rz'])
LAGOON_LEVEL = float(river_surface(np.interp(LAGOON['cx'], RIVER[:, 0], _racc)))
H = np.where((Lq < 1.25) & (Dr < fw + 20), np.minimum(H, LAGOON_LEVEL - 3.2 + 3.2 * smoothstep(0.75, 1.25, Lq) + 2.2 * smoothstep(1.0, 1.25, Lq)), H)
# THE SLOT: the arch's side canyon, from the north plateau down into the gorge
Ds, _, _ = polyline_field(X, Z, spline(SLOT, 8.0), 80)
slot_floor = np.interp(Z, [-1500, -760, -60], [NORTH - 34, NORTH - 46, 100])
H = np.where(Ds < 40, np.minimum(H, slot_floor + (H - slot_floor) * smoothstep(9, 30, Ds) ** 0.6), H)

# SAND BANKED AGAINST THE WALLS (2026-11-04 — "not a sudden hill"): at the foot of every wall the ground ramps up into
# it — raised toward its 40 m surroundings (a quarter of the wall's height at its foot, fading over ~40 m), as blown
# sand and fallen rock bank against a real cliff; nothing changes on open ground. Not into the water, the lagoon or the
# slot; half as much down the routes (a corridor between two walls would fill to a V)
_ap = np.maximum(blur(H, 28) - H, 0) * 0.7
_ap = _ap * smoothstep(river_hw(Sr) + 6, river_hw(Sr) + 30, DrW) * smoothstep(1.1, 1.4, Lq) * smoothstep(20, 40, Ds)
H = H + _ap * (0.5 + 0.5 * smoothstep(15, 45, DC_ROUTES))
log(f'  sand banks: up to {_ap.max():.0f} m')

# THE BEDS: wherever the ground is steep (the canyon's walls, the plateaus' rims, the mesas, the spires, the slot), it
# steps in benches — flat ledges and steep risers, the beds wobbling a little in height
gz, gx = np.gradient(H, CELL)
slope = np.hypot(gx, gz)
# (the erg's own sand, not over a mesa: a dune's slip face is sand — never beds, never rock — but the mesas standing in
#  the erg are sandstone like the rest; DESERT_MATCH round 6: they had no beds and no rock, smooth sand-coloured blocks)
ERG_OPEN = ERG * (1 - smoothstep(0.05, 0.4, MESAK))
wall = smoothstep(0.45, 0.9, blur(slope, 2)) * (1 - smoothstep(0.05, 0.3, ERG_OPEN))
# (not on the spires: a tower's wall is a cell or two wide on the 2 m grid, and the beds made random shelves of it —
#  lens-shaped recesses up the towers; their rings are the skins' — desert_rocks.py)
wall_beds = wall * (1 - SPK)
# (nor down the routes: a bed's ledge across a road's line on the canyon's gentle rim stood 2–5 m in a cell — no road
#  could climb it)
wall_beds = wall_beds * smoothstep(30, 70, DC_ROUTES)
# (the beds' phase: a slow wobble + the joints' blocks, softened a cell so a joint is a crack, not a stair-step alias)
phase = 2.5 * fbm(X / 500, Z / 500, SEED + 30, 2) + blur(joint_offsets(X, Z, 52.0, SEED + 31, 3.0), 1) * (1 - SPK)
# (never below the ground the wall stands on: a bench cut into a wall's foot dug a MOAT round every spire and outcrop)
foot = local_min(H, 5)
H = H + (np.maximum(strata(H, phase), foot) - H) * wall_beds
# (2026-11-04: the steepest faces softened by a cell — a wall that rises 30–40 m within a cell or two of the 2 m grid
#  drew as teeth and curtains; the skins hid it, the clean look has none)
for _ in range(2):
    _gz, _gx = np.gradient(H, CELL)
    H = H + (blur(H, 1) - H) * smoothstep(1.2, 2.6, np.hypot(_gx, _gz))
# (…and NO wall steeper than ~67° (2.4 : 1): a cell's top lowered to within 2.4 cells' worth of its lowest neighbour,
#  repeated until it holds — a 120 m wall over ~50 m, never 30 m within a cell. Only ever lowered: the corridors' floors
#  — the roads — never move)
_lim = 2.4 * CELL
for _ in range(40):
    _lo = local_min(H, 1)
    _H2 = np.where(SPK > 0.3, H, np.minimum(H, _lo + _lim))   # (not the spires: needles, not pyramids)
    if np.max(H - _H2) < 0.05: break
    H = _H2
PHASE = phase
WALL = wall

# the head's waterfall cliff: a sheer amphitheatre wall where the river begins
fd = np.hypot(X - FALL['x'], Z - FALL['z'])
log('far world (16 m)')
XF, ZF = grid(N_FAR, FAR_HALF)
HF, _, _, _ergF = landforms(XF, ZF, inner=False)
# the far world: a ring of high mesas and plateaus round the box, dune seas between
ring = smoothstep(2300, 3400, np.maximum(np.abs(XF), np.abs(ZF)))
mes = smoothstep(0.05, 0.2, fbm(XF / 1400, ZF / 1400, SEED + 40, 3))
HF = HF + ring * mes * (120 + 140 * smoothstep(0, 0.5, fbm(XF / 2600, ZF / 2600, SEED + 41, 2)))
# CANYON COUNTRY beyond the box too (2026-11-04): masses from a noise alone (no roads out there), so the aerial and the
# horizon aren't a flat plain past the box's edge (the seam below eases them in over 256 m)
_mf = relief(XF, ZF)[1] * (1 - smoothstep(0.022, 0.06, np.abs(fbm(XF / 640, ZF / 640, SEED + 85, 3))))
_mf = blur(_mf, 1) * (1 - 0.8 * smoothstep(0.3, 0.8, _ergF)) * smoothstep(2048, 2300, np.maximum(np.abs(XF), np.abs(ZF)))
HF = HF + (28 + 60 * smoothstep(-0.4, 0.5, fbm(XF / 1300, ZF / 1300, SEED + 87, 2))) * (0.6 * smoothstep(0.15, 0.4, _mf) + 0.4 * smoothstep(0.6, 0.85, blur(_mf, 3)))
HF = HF + np.maximum(blur(HF, 3) - HF, 0) * 0.55   # (sand banked at the walls' feet out there too)
# the RIVER'S GORGE goes on out of the box, east to the world's edge (RIVER_OUT): the same canyon, its channel wide and
# deep enough for 16 m cells to hold the water (meta water.riverOut draws it)
HF, _, _, _, _ = carve_canyon(XF, ZF, HF, RIVER_FAR, chan=(16.0, 30.0), chan_depth=4.0)
gzf, gxf = np.gradient(HF, 16.0)
HF = HF + (np.maximum(strata(HF), local_min(HF, 1)) - HF) * smoothstep(0.3, 0.7, np.hypot(gxf, gzf))

# ---------------------------------------------------------------------------------------------------------- roads
# THE LEDGE ROADS first (the walls are sheer: nothing finds its own way up them): designed polylines cut into the
# cliffs as shelves at a steady grade — the ESCARPMENT's switchbacks under the pass (Over the Hill's roads hang on
# their walls), a ramp down the canyon's south wall, one up its north wall to the plateau, one from the plateau down
# to the gorge's rim. Then A* joins the rest over the ground (fords allowed; the lagoon, the spires not).
log('roads')
TRAIL_HW = 3.0
TRAILS = []
# the pass: heading = the way OUT of the desert (π: south, +z — the valley's gate faces north, out of the valley:
# going out of one is coming into the other on the same road); its MIST thickens from 200 m to the plateau's 315 m
# within 420 m of it (Crossing.ts)
GATE = dict(x=-120.0, z=1990.0, heading=math.pi, mist=dict(y0=200.0, y1=315.0, r=420.0))
def ground_at(x, z): return float(bilinear(H, HALF, np.array([float(x)]), np.array([float(z)]))[0])
def carve_ramp(P, y0=None, y1=None, hw=TRAIL_HW):
    """A shelf at a steady grade along the polyline P (its ends at the ground's height, or y0 / y1)."""
    global H
    T = resample(chaikin(spline(np.array(P, float), 4.0), 2), 2.0)
    ss = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(T, axis=0).T))])
    a = ground_at(*T[0]) if y0 is None else y0
    b = ground_at(*T[-1]) if y1 is None else y1
    bed = a + (b - a) * ss / ss[-1]
    D, S, _ = polyline_field(X, Z, T, 16)
    w = 1 - smoothstep(hw + 0.5, hw + 9.0, D)
    H = H + (np.interp(S, ss, bed) - H) * w
    TRAILS.append(T)
    log(f'  ledge road {len(T) * 2} m, {a:.0f} → {b:.0f} m ({abs(b - a) / ss[-1] * 100:.1f} %)')
    return T
# THE ESCARPMENT'S LEDGE ROAD (ledgeroad.py — the valley's Great Cliff the same way): 4 legs east ↔ west across the
# face, 26 m apart up it, hairpins on benches at both ends, from the plain (leg 0, starting at its west end) up to the
# plateau's edge; the face there built out where the slope was gentler (a bastion: its sides falling at ~73°, the
# plateau behind it filled up to the road's top). The top leg ends at its west end and bends south onto THE PASS,
# straight and level over the plateau through the gate to the box's edge. (2026-11-02: the first switchbacks — ramps
# carved across the slope — cut 15 m into it at one end, stood on banks at the other, and the hairpins rolled the car.)
P_ESC, NL_ESC, L_ESC = 26.0, 4, 380.0
O_ESC = (GATE['x'] + P_ESC / 2, 1440.0)       # leg 0's start: the top leg's bend lands on the pass's line
def esc_top(x, z): return HIGH + 2 + 1.5 * fbm(x / 160, z / 160, SEED + 60, 2)
ESC = LedgeRoad(O=O_ESC, eu=(1, 0), ev=(0, 1), NL=NL_ESC, L=L_ESC, y0=ground_at(*O_ESC), top=esc_top, P=P_ESC,
                y_top=HIGH + 2, SH=TRAIL_HW + 0.7, seed=SEED + 61,
                # (no joints here: a joint's step leaked through the 2 m grid into the top leg — a 2 m pothole flipped the car)
                strata_fn=lambda h, X_, Z_: strata(h, 2.5 * fbm(X_ / 500, Z_ / 500, SEED + 30, 2)))
ew = (X > O_ESC[0] - 100) & (X < O_ESC[0] + L_ESC + 100) & (Z > O_ESC[1] - 45) & (Z < O_ESC[1] + 200)
ej, ei = np.nonzero(ew.any(1))[0], np.nonzero(ew.any(0))[0]
sl_ = (slice(ej[0], ej[-1] + 1), slice(ei[0], ei[-1] + 1))
Xe, Ze, Ne = X[sl_], Z[sl_], H[sl_]
He = ESC.face(Xe, Ze, Ne)
ue, ve = ESC.local(Xe, Ze)
vtop = ESC.VK[-1] + ESC.SH + ESC.wall
He = np.where(ve > vtop, np.maximum(Ne, Ne + (He - Ne) * (1 - smoothstep(vtop + 40, vtop + 90, ve))), He)
log(f'  escarpment: leg 0 at {ESC.y0:.0f} m, the plain under the legs {Ne[(np.abs(ve) < 4) & (ue > 0) & (ue < L_ESC)].mean():.0f} m, '
    f'the ground under the top leg {Ne[(np.abs(ve - ESC.VK[-1]) < 4) & (ue > 0) & (ue < L_ESC)].mean():.0f} m (its bed {ESC.y_top - 20:.0f} … {ESC.y_top:.0f}), grade {ESC.grade * 100:.1f} %')
H[sl_] = He
# the pass: from the top leg's end a quarter turn south, then straight through the gate
(tx, tz), _, _ = ESC.top_end()
arc = np.array([[tx - ESC.R * math.sin(t), tz + ESC.R - ESC.R * math.cos(t)] for t in np.linspace(math.pi / 2, 0, 12)])
PASSD = np.vstack([[[GATE['x'], z] for z in np.arange(2040.0, arc[0][1] + 1, -2.0)], arc])
Dp, _, _ = polyline_field(X, Z, PASSD, 16)
H = H + (ESC.y_top - H) * (1 - smoothstep(ESC.SH, ESC.SH + 8, Dp))
TRAILS.append(PASSD)
# the stair road down from the top (the bot and the map read it so), then on west off leg 0's foot to the plain
ESC_LINE = ESC.points(2.0)[::-1]
lead = np.array([[O_ESC[0] - 2.0 * k, O_ESC[1]] for k in range(1, 21)])
Dl, Sl, _ = polyline_field(X, Z, lead, 16)
H = H + (ESC.y0 + (ground_at(*lead[-1]) - ESC.y0) * np.clip(Sl / 40, 0, 1) - H) * (1 - smoothstep(TRAIL_HW + 0.5, TRAIL_HW + 7, Dl)) * (Dl < 16)
TRAILS.append(np.vstack([ESC_LINE, lead]))
log(f'  escarpment road {len(ESC_LINE) * 2} m, pass {len(PASSD) * 2} m')
# down the canyon's south wall (the plain → the floor by the lagoon)
carve_ramp([(-150, 790), (150, 760), (400, 660), (330, 520), (180, 470), (60, 400), (30, 310)], None, None)
# up the north wall to the plateau (the floor → the plain → the plateau)
carve_ramp([(-420, 30), (-760, -10), (-1050, -150), (-1120, -380), (-900, -540), (-760, -600)])
# the plateau down to the gorge's north rim
carve_ramp([(1440, -560), (1700, -360), (1560, -150), (1430, -20)])
# recompute what A* reads, after the shelves
C8 = 8.0
n8 = int(2 * HALF / C8) + 1
H8 = H[::4, ::4]
X8, Z8 = X[::4, ::4], Z[::4, ::4]
river8 = DrW[::4, ::4] < river_hw(Sr[::4, ::4]) * 1.3
lagoon8 = Lq[::4, ::4] < 1.15
block8 = lagoon8 | (MESAK[::4, ::4] > 0.15)
for (sx, sz, rr, _) in SPIRES: block8 |= np.hypot(X8 - sx, Z8 - sz) < rr + 10
Hl = H8.ravel(); blockf = block8.ravel(); fordf = river8.ravel()
# (off the routes' own lines a little dearer: the A* keeps to the corridors, where no bed steps across — 2026-11-04)
offc = smoothstep(25, 70, DC_ROUTES[::4, ::4]).ravel()
NB = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
def cell_of(x, z): return int(round((x + HALF) / C8)), int(round((z + HALF) / C8))
def astar(a, b, maxg=0.26):
    n = n8; s0 = a[1] * n + a[0]; g0 = b[1] * n + b[0]; gx_, gz_ = b
    g = {s0: 0.0}; came = {}; pq = [(0.0, s0)]; closed = set()
    while pq:
        _, u = heapq.heappop(pq)
        if u == g0: break
        if u in closed: continue
        closed.add(u)
        ux, uz = u % n, u // n; hu = Hl[u]; gu = g[u]
        for dx, dz, dl in NB:
            vx, vz = ux + dx, uz + dz
            if vx < 0 or vz < 0 or vx >= n or vz >= n: continue
            v = vz * n + vx
            if v in closed or blockf[v]: continue
            L = dl * C8; gr = abs(Hl[v] - hu) / L
            if gr > maxg: continue
            ng = gu + L * (1 + 30 * gr * gr + 1.5 * offc[v]) + (160.0 if fordf[v] else 0.0)
            if ng < g.get(v, 1e30):
                g[v] = ng; came[v] = u
                heapq.heappush(pq, (ng + math.hypot(vx - gx_, vz - gz_) * C8 * 0.5, v))
    if g0 not in came: return None
    p = [g0]
    while p[-1] != s0: p.append(came[p[-1]])
    return p[::-1]
gz8, gx8 = np.gradient(H8, C8)
flat8 = (np.hypot(gx8, gz8) < 0.12).ravel()
def snap(x, z):
    i, j = cell_of(x, z)
    # (a ledge road's end: kept — the cut's walls make it look steep; a cell with two drivable neighbours is a way on)
    u = j * n8 + i
    if not blockf[u] and not fordf[u] and sum(1 for dx, dz, dl in NB if 0 <= i + dx < n8 and 0 <= j + dz < n8 and abs(Hl[(j + dz) * n8 + i + dx] - Hl[u]) / (dl * C8) < 0.2) >= 2:
        return i, j
    for r_ in range(0, 30):
        best = None
        for jj in range(j - r_, j + r_ + 1):
            for ii in range(i - r_, i + r_ + 1):
                if 0 <= ii < n8 and 0 <= jj < n8 and flat8[jj * n8 + ii] and not blockf[jj * n8 + ii] and not fordf[jj * n8 + ii]:
                    d = (ii - i) ** 2 + (jj - j) ** 2
                    if best is None or d < best[0]: best = (d, ii, jj)
        if best: return best[1], best[2]
    return i, j
def route(points, maxg=0.26):
    out = []
    for a, b in zip(points[:-1], points[1:]):
        p = astar(snap(*a), snap(*b), maxg)
        # (a short steeper pitch, rather than no road: the canyon country's rims — the road's smoothing along its length
        #  takes most of it out; 2026-11-04)
        if p is None: p = astar(snap(*a), snap(*b), maxg * 1.3)
        if p is None:
            sa, sb = snap(*a), snap(*b)
            # (what's reachable from the start under the grade: the cells, and the reach's nearest to the goal)
            seen = {sa[1] * n8 + sa[0]}; fr = [sa[1] * n8 + sa[0]]
            while fr:
                u = fr.pop(); ux, uz = u % n8, u // n8
                for dx, dz, dl in NB:
                    vx, vz = ux + dx, uz + dz
                    if 0 <= vx < n8 and 0 <= vz < n8:
                        v = vz * n8 + vx
                        if v not in seen and not blockf[v] and abs(Hl[v] - Hl[u]) / (dl * C8) <= maxg: seen.add(v); fr.append(v)
            near = min(seen, key=lambda v: (v % n8 - sb[0]) ** 2 + (v // n8 - sb[1]) ** 2)
            log(f'  ! no route {a} → {b}: start {sa} h {Hl[sa[1] * n8 + sa[0]]:.1f}, goal {sb} h {Hl[sb[1] * n8 + sb[0]]:.1f}, reach {len(seen)} cells, nearest to the goal ({(near % n8) * C8 - HALF:.0f}, {(near // n8) * C8 - HALF:.0f})')
            continue
        seg = np.array([[(q % n8) * C8 - HALF, (q // n8) * C8 - HALF] for q in p], float)
        out.append(seg if not out else seg[1:])
    if not out: return None
    P = np.vstack(out)
    K = rdp(P, 9.0)
    T = resample(chaikin(spline(K, 6.0) if len(K) > 2 else K, 2), 2.0)
    return T if len(T) > 8 else None
for pts in [
    [(O_ESC[0] - 40, O_ESC[1]), (-60, 1100), (-150, 790)],                               # the plain, to the canyon's rim
    [(-1520, 130), (-1100, 120), (-760, 230), (-420, 30)],                               # the floor: the falls ← the north ramp
    [(-420, 30), (-150, 340), (30, 310), (560, 320), (840, 250)],                        # … the lagoon, the south ramp, the gorge's mouth
    [(-760, -600), (-1000, -800), (-1350, -1200), (-900, -1500), (-500, -1250), (-760, -600)],   # the spire field
    [(-500, -1250), (200, -1300), (800, -1000), (ARCH['x'] - 150, ARCH['z'])],          # east along the plateau to the arch
    [(ARCH['x'] + 150, ARCH['z']), (1440, -560)],                                         # off the arch to the gorge ramp
    [(GORGE_BRIDGE_X, 640), (1300, 900), (KSAR['x'], KSAR['z']), (600, 1150), (-60, 1100)],   # the gorge's south rim, the ksar, home
    [(-150, 790), (-600, 900), (-1100, 1050), (-1500, 900), (-1200, 700), (-700, 700), (-150, 790)],   # the dunes loop
]:
    T = route(pts)
    if T is not None: TRAILS.append(T)
# the ARCH's deck and the gorge's BRIDGE: straight pieces of road (the arch: Blender's mesh; the bridge: Bridges.ts)
TRAILS.append(np.array([[ARCH['x'] - 150 + k, ARCH['z']] for k in range(0, 301, 2)], float))
TRAILS.append(np.array([[GORGE_BRIDGE_X, -20 + k] for k in range(0, 661, 2)], float))
# carve the A* roads' beds: flat across, their heights smoothed along (the ledge roads are already cut) — not over
# the arch's slot nor the gorge (the deck, the bridge span them)
log('carving the roads')
Dt = np.full(H.shape, 1e9)
n_ledge = 5
Ds_ = polyline_field(X, Z, spline(SLOT, 8.0), 60)[0]
for ti, T in enumerate(TRAILS):
    # (the distance out to 90 m: the outcrops read it to keep off the roads — at 14 m it read 'far' 15 m from a road,
    #  and outcrops stood over roads in 25 m blocks; 2026-11-04. trail.bin keeps only its first 8 m)
    D, S, _ = polyline_field(X, Z, T, 90)
    Dt = np.minimum(Dt, D)
    if ti < n_ledge: continue
    hs = bilinear(H, HALF, T[:, 0], T[:, 1])
    k = 10
    sm = np.convolve(np.pad(hs, k, mode='edge'), np.ones(2 * k + 1) / (2 * k + 1), mode='same')[k:-k]
    ss = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(T, axis=0).T))])
    span = (bilinear(Ds_, HALF, T[:, 0], T[:, 1]) < 34) | (bilinear(Dr, HALF, T[:, 0], T[:, 1]) < floor_hw(np.interp(T[:, 0], RIVER[:, 0], _racc)) + 30) & (T[:, 0] > 1300)
    w = (1 - smoothstep(TRAIL_HW + 0.5, TRAIL_HW + 9, D)) * np.interp(S, ss, (~span).astype(float))
    H = H + (np.interp(S, ss, sm) - H) * w

# THE ARCH's deck (desert_rocks.py models it; its deck is a collider of structures.json): the road over the slot is
# levelled to one height for 30 m on each side of the gap, so the rock bridge meets it flush
ARCH_Y = round(float(np.median(bilinear(H, HALF, np.array([ARCH['x'] - 60, ARCH['x'] - 45, ARCH['x'] + 45, ARCH['x'] + 60.0]), np.full(4, ARCH['z'])))), 2)
au = np.abs(X - ARCH['x']); av = np.abs(Z - ARCH['z'])
lev = (1 - smoothstep(TRAIL_HW + 2, TRAIL_HW + 10, av)) * smoothstep(28, 34, au) * (1 - smoothstep(64, 90, au))
H = H + (ARCH_Y - H) * lev
log(f'  the arch: deck {ARCH_Y} m')
# the gorge's ROPE BRIDGE (Bridges.ts draws it): from rim to rim along the bridge road (its ends where the ground under
# it is high), hanging 3.5 m at its middle
BRIDGES = []
TB = TRAILS[-1]
gb = bilinear(H, HALF, TB[:, 0], TB[:, 1])
rim_y = min(gb[0], gb[-1])   # (the lower rim: with the land's relief the two differ — the higher one made every point
#  below it 'gorge', a 348 m bridge — 2026-11-04)
low = np.nonzero(gb < rim_y - 4)[0]
if len(low):
    a, b = TB[max(0, low[0] - 2)], TB[min(len(TB) - 1, low[-1] + 2)]
    ya, yb = ground_at(*a), ground_at(*b)
    BRIDGES.append({'x0': round(float(a[0]), 1), 'z0': round(float(a[1]), 1), 'x1': round(float(b[0]), 1), 'z1': round(float(b[1]), 1),
                    'y': round(max(ya, yb), 2), 'y0': round(ya, 2), 'y1': round(yb, 2), 'w': 4.2, 'kind': 'rope', 'sag': 3.5})
# (under a rope bridge the ground is notched to below its sagging deck: the rim's lips stood up through the planks)
for br in BRIDGES:
    if br.get('kind') != 'rope': continue
    bx, bz = br['x1'] - br['x0'], br['z1'] - br['z0']; bl2 = bx * bx + bz * bz
    t = np.clip(((X - br['x0']) * bx + (Z - br['z0']) * bz) / bl2, 0, 1)
    dx = np.abs((X - br['x0']) * bz - (Z - br['z0']) * bx) / math.sqrt(bl2)
    deck = br['y0'] + (br['y1'] - br['y0']) * t - br['sag'] * 4 * t * (1 - t)
    allowed = deck - 1.2 - 2.0 * np.maximum(dx - br['w'] / 2 - 1, 0)
    H = np.where((dx < br['w'] / 2 + 6) & (t > 0.01) & (t < 0.99), np.minimum(H, allowed), H)
log(f'  {len(TRAILS)} roads, bridges {BRIDGES}')

# ---------------------------------------------------------------------------------------------------------- outcrops
# OUTCROPS (2026-11-04, the desert fuller — DESERT_MATCH.md §12): tors and low stacked-slab outcrops, 9–33 m across
# the footprint, 1–3 flat-topped tiers, scattered over the plain, the plateaus and the erg's margins — what fills the
# open ground between the mesas. AFTER the roads (no road moves: trail.bin unchanged), well off them, out of the
# canyon, clear of the places, the mesas, the spires, the gate's climb and each other; terraced into beds like the
# walls (WALL, so desert_rocks.py skins them), and never "erg sand" (ERG_OPEN) — the mesas' lesson
log('outcrops')
orng = np.random.default_rng(SEED + 70)
OUTCROPS = []
OUTK = np.zeros_like(H)
gz0, gx0 = np.gradient(H, CELL)
SL0 = np.hypot(gx0, gz0)
keep_clear = [(LAGOON['cx'], LAGOON['cz'], 260), (FALL['x'], FALL['z'], 220), (ARCH['x'], ARCH['z'], 140), (GORGE_BRIDGE_X, 220, 160),
              (KSAR['x'], KSAR['z'], 180), (GATE['x'], GATE['z'], 450), (-1100, -1300, 160),
              ((AQUEDUCT['x0'] + AQUEDUCT['x1']) / 2, (AQUEDUCT['z0'] + AQUEDUCT['z1']) / 2, 300)]
def at2(A, x, z): return float(bilinear(A, HALF, np.array([x]), np.array([z]))[0])
tries = 0
# (ROCK GARDENS: most come in clusters — a centre, then outcrops within ~130 m of it — so the plain reads as groups of
#  rock with open ground between, not an even sprinkle; a few stand alone)
centre = None
while len(OUTCROPS) < 300 and tries < 30000:
    tries += 1
    if centre is None or orng.random() < 0.18:
        centre = (orng.uniform(-1880, 1880), orng.uniform(-1880, 1880))
    alone = orng.random() < 0.15
    if alone: ox, oz = orng.uniform(-1880, 1880), orng.uniform(-1880, 1880)
    else:
        a_, d_ = orng.random() * 2 * math.pi, 130 * orng.random() ** 0.7
        ox, oz = centre[0] + math.cos(a_) * d_, centre[1] + math.sin(a_) * d_
        if abs(ox) > 1880 or abs(oz) > 1880: continue
    R = 10 + 32 * orng.random() ** 1.8
    top = R * (0.4 + 0.5 * orng.random())
    if at2(Dt, ox, oz) < R * 1.35 + 16: continue                                  # (off the roads: their edge ≥ ~13 m from one)
    s_ = at2(Sr, ox, oz)
    if at2(Dr, ox, oz) < float(floor_hw(s_) + wall_w(s_)) + 40: continue          # (out of the canyon)
    if at2(SL0, ox, oz) > 0.22: continue                                          # (on open ground, not a wall)
    if any(math.hypot(ox - x, oz - z) < r + R for x, z, r in keep_clear): continue
    if any(math.hypot(ox - mx, oz - mz) < Rm * 1.6 + R + 30 for mx, mz, Rm, _ in MESAS): continue
    if any(math.hypot(ox - sx, oz - sz) < rs * 1.8 + R + 15 for sx, sz, rs, _ in SPIRES): continue
    if any(math.hypot(ox - x, oz - z) < R + r2 + 14 for x, z, r2, _ in OUTCROPS): continue
    OUTCROPS.append((ox, oz, R, top))
for i, (ox, oz, R, top) in enumerate(OUTCROPS):
    w = int((R * 1.7 + 8) / CELL)
    ci, cj = int(round((ox + HALF) / CELL)), int(round((oz + HALF) / CELL))
    win = (slice(max(cj - w, 0), min(cj + w + 1, N_IN)), slice(max(ci - w, 0), min(ci + w + 1, N_IN)))
    dx, dz = X[win] - ox, Z[win] - oz
    d = np.hypot(dx, dz) / blob_r(np.arctan2(dz, dx), R, i * 1.7)              # (1 at the rim, the outline never round)
    base = float(np.percentile(H[win][d < 1.15], 25))                              # (sat on the low side: never floating)
    tiers = 1 + int(orng.random() * 2.6)
    prof = np.zeros_like(d)
    for t in range(tiers):                                                          # (each tier a slab narrower than the one under it)
        rt = 1 - 0.27 * t
        prof = np.maximum(prof, top * (t + 1) / tiers * (1 - smoothstep(rt - 0.13, rt, d)))
    prof *= 0.97 + 0.03 * fbm(X[win] / 23, Z[win] / 23, SEED + 71 + i, 2)
    # (raised only within its own outline — max(H, base) over the whole window stood every outcrop on a square pad)
    H[win] = H[win] + np.maximum(base + prof - H[win], 0) * (1 - smoothstep(1.0, 1.3, d))
    OUTK[win] = np.maximum(OUTK[win], 1 - smoothstep(1.25, 1.6, d))
# their beds: the steep parts of the outcrops terraced like every wall, and in WALL for their skins
gz0, gx0 = np.gradient(H, CELL)
wall_o = smoothstep(0.45, 0.9, blur(np.hypot(gx0, gz0), 2)) * OUTK
# (never on a road: an outcrop's beds reach 1.6 radii out, and one beside the escarpment's top leg terraced the
#  shelf's steep edge into a 2 m pothole that flipped the car — 2026-11-04)
wall_o = wall_o * smoothstep(TRAIL_HW + 4, TRAIL_HW + 14, Dt)
H = H + (np.maximum(strata(H, PHASE), local_min(H, 5)) - H) * wall_o
WALL = np.maximum(WALL, wall_o)
ERG_OPEN = ERG_OPEN * (1 - smoothstep(0.05, 0.4, OUTK))
log(f'  {len(OUTCROPS)} outcrops ({tries} tries)')

# ---------------------------------------------------------------------------------------------------------- masks
log('masks (4 m)')
H4 = H[::2, ::2]; X4, Z4 = X[::2, ::2], Z[::2, ::2]
gz4, gx4 = np.gradient(H4, 4.0)
sl = np.hypot(gx4, gz4)
Dr4 = DrW[::2, ::2]; Sr4 = Sr[::2, ::2]; Lq4 = Lq[::2, ::2]; Dt4 = Dt[::2, ::2]; ERG4 = ERG_OPEN[::2, ::2]
rh4 = river_hw(Sr4)
water4 = (Dr4 < rh4) | (Lq4 < 1.0)
near_water = np.maximum(1 - smoothstep(rh4 + 8, rh4 + 70, Dr4), 1 - smoothstep(1.05, 1.6, Lq4))
canyon_floor = (Dr4 < floor_hw(Sr4) + 10) & (sl < 0.3)
# R ROCK: the walls' beds, the steep, the plateaus' slickrock, the spires, the mesas' sides
patch = fbm(X4 / 90, Z4 / 90, SEED + 50, 3)
patch = fbm(X4 / 260, Z4 / 260, SEED + 50, 3)
rock = np.clip(smoothstep(0.42, 1.0, sl) + 0.85 * smoothstep(0.3, 0.9, WALL[::2, ::2]) + smoothstep(0.2, 0.4, patch) * UPN[::2, ::2] * 0.6
               + smoothstep(0.45, 0.75, MASSK[::2, ::2]), 0, 1)   # (the rock masses' tops are rock — 2026-11-04)
# (soft: the sand banks — slopes under ~25° — sand, the rock's edge blurred over 8–16 m: no hard line where the colour
#  changes — 2026-11-04)
rock = blur(rock, 2)
rock = rock * (1 - smoothstep(TRAIL_HW + 10, TRAIL_HW + 3, Dt4)) * (1 - near_water * 0.8) * (1 - smoothstep(0.05, 0.3, ERG4))
# (the escarpment road's risers are rock right down to its shelves)
DE4 = polyline_field(X4, Z4, np.vstack([ESC_LINE, PASSD]), 40)[0]
rock = np.where(DE4 < 40, np.maximum(rock, smoothstep(0.5, 0.9, sl) * smoothstep(ESC.SH + 0.5, ESC.SH + 2.5, DE4)), rock)
# G LOOSE SAND: the dunes, the plain, drifts against the walls' feet; compact on the roads and the slickrock
# (2026-11-04 — the user: the ground "like a repeated texture". A real desert floor is never one sand: GRAVEL plains
#  (low G: darker, pebbly, no ripples) with loose SAND in sheets across them, in TAILS trailing downwind (the wind is
#  from the north-west, as the erg's) of every rock, mesa and outcrop, in DRIFTS against the walls' feet — all baked
#  here at 4 m, so nothing in it repeats)
wind_d = np.array([math.cos(0.6), math.sin(0.6)])
obst = np.clip(np.maximum.reduce([WALL[::2, ::2], OUTK[::2, ::2], MESAK[::2, ::2]]), 0, 1)
tails = np.zeros_like(obst)
for k in range(1, 15):
    sx_, sz_ = int(round(k * 2.0 * wind_d[0])), int(round(k * 2.0 * wind_d[1]))   # (8 m a step, in 4 m cells)
    tails = np.maximum(tails, np.roll(np.roll(obst, sz_, 0), sx_, 1) * (1 - k / 15) ** 0.7)
tails = blur(tails, 2) * (1 - obst)
sheets = smoothstep(-0.05, 0.3, fbm(X4 / 240, Z4 / 240, SEED + 51, 3) + 0.35 * fbm(X4 / 60, Z4 / 60, SEED + 53, 2))
drift = blur(smoothstep(0.35, 0.7, sl) * (1 - ERG4), 5) * smoothstep(0.35, 0.15, sl)
upland = np.maximum(UPN[::2, ::2], UPS[::2, ::2])
gravel = 0.12 + 0.18 * smoothstep(-0.3, 0.3, fbm(X4 / 90, Z4 / 90, SEED + 54, 2))
sand = np.maximum.reduce([gravel, sheets * (0.9 - 0.35 * upland), tails * 0.95, np.clip(drift * 1.6, 0, 0.9), ERG4])
sand = np.clip(sand - 0.6 * rock, 0, 1)
# B WET: open water (1), the damp banks and the oasis's soil
wetb = np.where(water4, 1.0, 0.8 * near_water * canyon_floor)
# A GROWTH: the oasis — palms and scrub along the river and round the lagoon, thinning away from the water; a few
# bushes on the plain
grow = near_water * canyon_floor * (0.6 + 0.4 * smoothstep(-0.2, 0.3, fbm(X4 / 120, Z4 / 120, SEED + 52, 2)))
grow = np.clip(grow * (1 - water4) * (1 - smoothstep(TRAIL_HW + 2, TRAIL_HW, Dt4)), 0, 1)

# ---------------------------------------------------------------------------------------------------------- places
s_lag = float(np.interp(LAGOON['cx'], RIVER[:, 0], _racc))
falls = [{'x': FALL['x'], 'z': FALL['z'] - 30, 'y': NORTH - 6, 'bx': FALL['x'] + 10, 'bz': FALL['z'] + 30,
          'by': float(river_surface(0.0)), 'hw': 9.0}]
gy = ground_at(GATE['x'], GATE['z'])
GATE['y'] = round(gy, 2)
def ground(x, z): return round(float(bilinear(H, HALF, np.array([x]), np.array([z]))[0]), 2)
LANDMARKS = [
    {'id': 1, 'kind': 'falls', 'name': 'Spring Falls', 'x': FALL['x'], 'z': FALL['z'] + 60, 'r': 40},
    {'id': 2, 'kind': 'oasis', 'name': 'The Lagoon', 'x': LAGOON['cx'], 'z': LAGOON['cz'], 'r': 160},
    {'id': 3, 'kind': 'aqueduct', 'name': 'Old Aqueduct', 'x': (AQUEDUCT['x0'] + AQUEDUCT['x1']) / 2, 'z': (AQUEDUCT['z0'] + AQUEDUCT['z1']) / 2, 'r': 60},
    {'id': 4, 'kind': 'arch', 'name': 'Sky Arch', 'x': ARCH['x'], 'z': ARCH['z'], 'r': 40},
    {'id': 5, 'kind': 'spires', 'name': 'Needle Forest', 'x': -1100, 'z': -1300, 'r': 120},
    {'id': 6, 'kind': 'gorge', 'name': 'Rope Bridge', 'x': GORGE_BRIDGE_X, 'z': 300, 'r': 50},
    {'id': 7, 'kind': 'ksar', 'name': 'The Ksar', 'x': KSAR['x'], 'z': KSAR['z'], 'r': 70},
    {'id': 8, 'kind': 'dunes', 'name': 'Red Erg', 'x': -1100, 'z': 1000, 'r': 150},
]
for l in LANDMARKS: l.update(y=ground(l['x'], l['z']), rot=0.0)
spawn = {'x': GATE['x'], 'z': GATE['z'] - 30, 'yaw': 0.0}

# ---------------------------------------------------------------------------------------------------------- write
k0 = int(round((FAR_HALF - HALF) / 16))
# THE SEAM (DESERT_MATCH.md §8): within 256 m outside the box the far world eases from the box's own heights at its
# edge (each far cell's nearest point on it) into its own — the 2 m heights and the 16 m ones meet without a step
dout = np.maximum(np.abs(XF), np.abs(ZF)) - HALF
edge = bilinear(H, HALF, np.clip(XF, -HALF, HALF), np.clip(ZF, -HALF, HALF))
HF = np.where(dout > 0, edge + (HF - edge) * smoothstep(0, 256, dout), HF)
HF[k0:k0 + 257, k0:k0 + 257] = H[::8, ::8]
os.makedirs(OUT, exist_ok=True)
def u16(A):
    lo, hi = float(A.min()), float(A.max())
    return np.round((A - lo) / (hi - lo) * 65535).astype('<u2'), lo, hi - lo
q_in, in_min, in_range = u16(H)
q_far, far_min, far_range = u16(HF)
q_in.tofile(os.path.join(OUT, 'height.bin'))
q_far.tofile(os.path.join(OUT, 'far.bin'))
mask = np.stack([rock, sand, wetb, grow], -1)
np.round(np.clip(mask, 0, 1) * 255).astype(np.uint8).tofile(os.path.join(OUT, 'mask.bin'))
np.round(np.clip(Dt / 8.0, 0, 1) * 255).astype(np.uint8).tofile(os.path.join(OUT, 'trail.bin'))
rv = RIVER[::3]; rs = _racc[::3]
meta = {
    'id': 'desert', 'name': 'The Desert', 'biome': 'desert',
    'inner': {'n': N_IN, 'step': 2.0, 'origin': -HALF, 'min': in_min, 'range': in_range},
    'far': {'n': N_FAR, 'step': 16.0, 'origin': -FAR_HALF, 'min': far_min, 'range': far_range},
    'mask': {'n': N_MID, 'step': 4.0, 'origin': -HALF},
    'water': {
        'lake': {'cx': LAGOON['cx'], 'cz': LAGOON['cz'], 'rx': LAGOON['rx'], 'rz': LAGOON['rz'], 'rot': LAGOON['rot'], 'level': LAGOON_LEVEL},
        'ponds': [],
        'river': {'x': [round(float(v), 2) for v in rv[:, 0]], 'z': [round(float(v), 2) for v in rv[:, 1]],
                  'y': [round(float(v), 3) for v in river_surface(rs)], 'hw': [round(float(v), 2) for v in river_hw(rs)]},
        'falls': falls,
        # the river on beyond the box (drawn only — Water.ts): downstream first, at the gorge's level
        'riverOut': {'x': [round(float(v), 2) for v in RIVER_OUT[::-3, 0]], 'z': [round(float(v), 2) for v in RIVER_OUT[::-3, 1]],
                     'y': [round(float(river_surface(RIVER_LEN)), 3)] * len(RIVER_OUT[::-3]), 'hw': [round(float(river_hw(RIVER_LEN)), 2)] * len(RIVER_OUT[::-3])},
    },
    'spawn': spawn,
    'gate': GATE,
    'bridges': BRIDGES,
    'landmarks': LANDMARKS,
    # (every 8 m; the pass and the escarpment road every 4 m — their hairpins)
    'trails': {'hw': TRAIL_HW, 'lines': [[[round(float(a), 1), round(float(b), 1)] for a, b in T[::(2 if ti < 2 else 4)]] for ti, T in enumerate(TRAILS)], 'rough': []},
}
with open(os.path.join(OUT, 'meta.json'), 'w') as f: json.dump(meta, f)
os.makedirs(CACHE, exist_ok=True)
# (the slabs' skins — desert_rocks.py — on the escarpment road's tall risers too, never within 10 m of it: a skin's
#  lip leans back over the bench above)
DEs = polyline_field(X, Z, np.vstack([ESC_LINE, PASSD]), 60)[0]
gzE, gxE = np.gradient(H, CELL)
WALL = np.where(DEs < 60, smoothstep(0.45, 0.9, blur(np.hypot(gxE, gzE), 2)) * smoothstep(10, 12, DEs), WALL)
np.savez_compressed(os.path.join(CACHE, 'desert.npz'), H=H.astype(np.float32), WALL=WALL.astype(np.float32), PHASE=PHASE.astype(np.float32), Dr=Dr.astype(np.float32),
                    arch=np.array([ARCH['x'], ARCH['z'], ARCH_Y], np.float32), aqueduct=np.array([AQUEDUCT['x0'], AQUEDUCT['z0'], AQUEDUCT['x1'], AQUEDUCT['z1']], np.float32),
                    ksar=np.array([KSAR['x'], KSAR['z']], np.float32), river=RIVER.astype(np.float32), lagoon=np.array([LAGOON['cx'], LAGOON['cz'], LAGOON['rx'], LAGOON['rz'], LAGOON['rot']], np.float32),
                    Dt=Dt.astype(np.float32), spires=np.array(SPIRES, np.float32), mesas=np.array(MESAS, np.float32),
                    layers=np.stack([LAYER_B, LAYER_T, LAYER_H, LAYER_C], 1).astype(np.float64))
log(f'wrote {OUT}: box {in_min:.1f}..{in_min + in_range:.1f} m, world {far_min:.1f}..{far_min + far_range:.1f} m')
log(f'  rock {rock.mean():.2f}  sand {sand.mean():.2f}  wet {wetb.mean():.3f}  growth {grow.mean():.3f}  spires {len(SPIRES)}  mesas {len(MESAS)}')

# ---------------------------------------------------------------------------------------------------------- preview
if PREVIEW:
    import bpy
    os.makedirs(PREVIEW, exist_ok=True)
    def shade(A, cell):
        gz_, gx_ = np.gradient(A, cell)
        L = np.array([-0.5, 0.6, -0.62]); L /= np.linalg.norm(L)
        return np.clip((-gx_ * L[0] + L[1] - gz_ * L[2]) / np.sqrt(gx_ * gx_ + 1 + gz_ * gz_), 0, 1)
    def save(name, rgb):
        n = rgb.shape[0]
        img = bpy.data.images.new(name, rgb.shape[1], n, alpha=False)
        px = np.concatenate([rgb[::-1], np.ones(rgb.shape[:2] + (1,))], -1).astype(np.float32)
        img.pixels.foreach_set(px.ravel())
        img.filepath_raw = os.path.join(PREVIEW, name + '.png'); img.file_format = 'PNG'; img.save()
    SAND = np.array([0.84, 0.62, 0.45]); ROCK = np.array([0.76, 0.42, 0.3]); GREEN = np.array([0.42, 0.55, 0.2]); WAT = np.array([0.3, 0.62, 0.72])
    col = SAND * (0.92 + 0.08 * sand[..., None])
    col = col + (ROCK - col) * rock[..., None]
    col = col + (GREEN - col) * (grow[..., None] * 0.8)
    col[water4] = WAT
    col[Dt4 < TRAIL_HW] = np.array([0.93, 0.78, 0.6])
    s4 = shade(H4, 4.0)[..., None]
    save('desert_top', np.clip(col * (0.35 + 0.75 * s4), 0, 1))
    np.save(os.path.join(CACHE, 'desert_col.npy'), col.astype(np.float32))
    log('preview written to', PREVIEW)
