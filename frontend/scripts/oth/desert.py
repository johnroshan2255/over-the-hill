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

def terrace(h, cliff=0.38, phase=None):
    """The sandstone's beds: a flat bench, then a steep riser to the next — h in m (phase: a slow wobble of the beds)."""
    p = 0 if phase is None else phase
    t = (h + p) / BED
    f = t - np.floor(t)
    return (np.floor(t) + smoothstep(1 - cliff, 1.0, f)) * BED - p

def landforms(X, Z, inner=True):
    """The big shapes: the plain, the north plateau, the high south plateau, mesas, spires, dunes (no canyon yet)."""
    n1 = fbm(X / 900, Z / 900, SEED + 1, 3)
    H = PLAIN + 14 * n1 + 6 * fbm(X / 230, Z / 230, SEED + 2, 3)
    # the NORTH PLATEAU: its rim a ragged line (bays and promontories); the plateau's top slopes gently, slickrock
    rim = Z + 340 + 160 * fbm(X / 700, Z / 700, SEED + 3, 3) + 60 * fbm(X / 180, Z / 180, SEED + 4, 2)
    up = 1 - smoothstep(-60, 30, rim)
    top = NORTH + 10 * fbm(X / 600, Z / 600, SEED + 5, 2) + 5 * fbm(X / 120, Z / 120, SEED + 6, 2)
    H = H + (top - H) * up ** 0.8
    # the HIGH PLATEAU in the south (the pass): the escarpment's foot ~ z 1430, its rim ~ z 1600
    rim2 = Z - 1520 - 90 * fbm(X / 600, Z / 600, SEED + 7, 3) - 40 * fbm(X / 150, Z / 150, SEED + 8, 2)
    up2 = smoothstep(-80, 40, rim2)
    H = H + (HIGH + 8 * fbm(X / 500, Z / 500, SEED + 9, 2) - H) * up2 ** 0.75
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
for c in range(9):
    cx = -1700 + rng.random() * 1500; cz = -1850 + rng.random() * 1050
    for k in range(int(4 + rng.random() * 7)):
        sx, sz = cx + rng.normal() * 90, cz + rng.normal() * 90
        if any(math.hypot(sx - a, sz - b) < 26 for a, b, _, _ in SPIRES): continue
        hgt = 28 + rng.random() * 58; r = hgt * (0.22 + rng.random() * 0.14)
        SPIRES.append((sx, sz, r, hgt))
for (sx, sz, r, hgt) in SPIRES:
    dx, dz = X - sx, Z - sz
    m = (np.abs(dx) < r + 4) & (np.abs(dz) < r + 4)
    if not m.any(): continue
    d = np.hypot(dx[m], dz[m]) / r
    base = bilinear(H, HALF, np.array([sx]), np.array([sz]))[0]
    cone = base + hgt * np.clip(1 - d, 0, 1) ** 1.25
    H[m] = np.maximum(H[m], cone)

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

# THE BEDS: wherever the ground is steep (the canyon's walls, the plateaus' rims, the mesas, the spires, the slot), it
# steps in benches — flat ledges and steep risers, the beds wobbling a little in height
gz, gx = np.gradient(H, CELL)
slope = np.hypot(gx, gz)
wall = smoothstep(0.45, 0.9, blur(slope, 2)) * (1 - smoothstep(0.05, 0.3, ERG))  # (a dune's slip face is sand: never beds)
phase = 2.5 * fbm(X / 500, Z / 500, SEED + 30, 2)
H = H + (terrace(H, 0.4, phase) - H) * wall
PHASE = phase
WALL = wall

# the head's waterfall cliff: a sheer amphitheatre wall where the river begins
fd = np.hypot(X - FALL['x'], Z - FALL['z'])
log('far world (16 m)')
XF, ZF = grid(N_FAR, FAR_HALF)
HF, _, _, _ = landforms(XF, ZF, inner=False)
# the far world: a ring of high mesas and plateaus round the box, dune seas between
ring = smoothstep(2300, 3400, np.maximum(np.abs(XF), np.abs(ZF)))
mes = smoothstep(0.05, 0.2, fbm(XF / 1400, ZF / 1400, SEED + 40, 3))
HF = HF + ring * mes * (120 + 140 * smoothstep(0, 0.5, fbm(XF / 2600, ZF / 2600, SEED + 41, 2)))
# the RIVER'S GORGE goes on out of the box, east to the world's edge (RIVER_OUT): the same canyon, its channel wide and
# deep enough for 16 m cells to hold the water (meta water.riverOut draws it)
HF, _, _, _, _ = carve_canyon(XF, ZF, HF, RIVER_FAR, chan=(16.0, 30.0), chan_depth=4.0)
gzf, gxf = np.gradient(HF, 16.0)
HF = HF + (terrace(HF, 0.4) - HF) * smoothstep(0.3, 0.7, np.hypot(gxf, gzf))

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
                y_top=HIGH + 2, SH=TRAIL_HW + 0.7, seed=SEED + 61)
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
            ng = gu + L * (1 + 30 * gr * gr) + (160.0 if fordf[v] else 0.0)
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
    D, S, _ = polyline_field(X, Z, T, 14)
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
rim_y = max(gb[0], gb[-1])
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

# ---------------------------------------------------------------------------------------------------------- masks
log('masks (4 m)')
H4 = H[::2, ::2]; X4, Z4 = X[::2, ::2], Z[::2, ::2]
gz4, gx4 = np.gradient(H4, 4.0)
sl = np.hypot(gx4, gz4)
Dr4 = DrW[::2, ::2]; Sr4 = Sr[::2, ::2]; Lq4 = Lq[::2, ::2]; Dt4 = Dt[::2, ::2]; ERG4 = ERG[::2, ::2]
rh4 = river_hw(Sr4)
water4 = (Dr4 < rh4) | (Lq4 < 1.0)
near_water = np.maximum(1 - smoothstep(rh4 + 8, rh4 + 70, Dr4), 1 - smoothstep(1.05, 1.6, Lq4))
canyon_floor = (Dr4 < floor_hw(Sr4) + 10) & (sl < 0.3)
# R ROCK: the walls' beds, the steep, the plateaus' slickrock, the spires, the mesas' sides
patch = fbm(X4 / 90, Z4 / 90, SEED + 50, 3)
patch = fbm(X4 / 260, Z4 / 260, SEED + 50, 3)
rock = np.clip(smoothstep(0.38, 0.65, sl) + WALL[::2, ::2] + smoothstep(0.2, 0.4, patch) * UPN[::2, ::2] * 0.6, 0, 1)
rock = rock * (1 - smoothstep(TRAIL_HW + 10, TRAIL_HW + 3, Dt4)) * (1 - near_water * 0.8) * (1 - smoothstep(0.05, 0.3, ERG4))
# (the escarpment road's risers are rock right down to its shelves)
DE4 = polyline_field(X4, Z4, np.vstack([ESC_LINE, PASSD]), 40)[0]
rock = np.where(DE4 < 40, np.maximum(rock, smoothstep(0.5, 0.9, sl) * smoothstep(ESC.SH + 0.5, ESC.SH + 2.5, DE4)), rock)
# G LOOSE SAND: the dunes, the plain, drifts against the walls' feet; compact on the roads and the slickrock
sand = np.clip(0.55 + 0.45 * ERG4 + 0.25 * fbm(X4 / 300, Z4 / 300, SEED + 51, 2) - 0.6 * rock, 0, 1)
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
                    Dt=Dt.astype(np.float32), spires=np.array(SPIRES, np.float32), mesas=np.array(MESAS, np.float32))
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
