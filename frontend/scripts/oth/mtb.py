# OVER THE HILL — the MOUNTAIN BIKE and its RIDER, modelled in Blender (2026-11-05, the user: "a mountain bike like the
# stunt bike in GTA 5 … each and every physics for the bike, the shock absorber and all"). Our own design: a modern
# full-suspension enduro bike, size L, 27.5-inch wheels, a single pivot; no brand, no decals.
#
#   blender -b --factory-startup --python scripts/oth/mtb.py -- [OUT=src/assets/models/vehicles/mtb.glb]
#           [PREVIEW=<dir>] [BLEND=scripts/oth/.cache/mtb.blend] [GEAR=7] [GEO=<mtb.geometry.json>]
#
# EVERY dimension and pivot comes from src/gameplay/vehicle/mtb.geometry.json (the physics, MtbSim.ts, and the
# renderer, Bike.ts, read the same file): the wheels, axles, steering axis, crown, head tube, fork, stem, bar and
# grips, BB, cranks, pedals, chainring, cassette, saddle, pivot, shock mounts and stroke, the rider's segments. The
# numbers written here are only the model's own design — tube sizes, the stays' and the down tube's bends, the tread
# — never one the JSON has. Built in GAME SPACE (+x right, +y up, +z backward; the bike faces −z) and written out as
# Blender (x, −z, y), so the glTF exporter's +Y up gives game space back.
#
# The GLB is a FLAT list of meshes (no parenting), each with its ORIGIN at its pivot and identity rotation / unit scale
# (Bike.ts poses every part itself — the steer group and the fork about the steering axis, the lowers and the front
# wheel up it, the swingarm, the rear wheel and the chain about the pivot, the shock's two halves aimed at each other,
# the cranks about the BB, the pedals level; the rider's 12 segments by IK). Materials are flat colours by NAME
# (`Paint` is the tint the game sets; Bike.ts merges every node by name and reads each material's base colour).
#
# PREVIEW renders (Workbench) the bike at rest from all round, close-ups, the rider beside it, the WORKED pose (the
# game's own transforms — Bike.ts posePartsFrom ported below — at full travel, full stroke, 30° of steer, the cranks
# at 90°) and the rider on the bike by the game's IK; the GLB is read back and every node checked against the JSON.
import sys, os, math, json, time, struct
import numpy as np
import bpy, bmesh
from mathutils import Matrix, Vector

T0 = time.time()
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
GEO_PATH = ARGS.get('GEO', os.path.join(FRONTEND, 'src', 'gameplay', 'vehicle', 'mtb.geometry.json'))
OUT = os.path.abspath(ARGS.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'vehicles', 'mtb.glb')))
PREVIEW = ARGS.get('PREVIEW')
BLEND = os.path.abspath(ARGS.get('BLEND', os.path.join(HERE, '.cache', 'mtb.blend')))
GEAR = int(ARGS.get('GEAR', 7))           # the gear the chain is built in (1 … 12, the smallest cog = 12)

# ===================================================================================================== the geometry
G = json.load(open(GEO_PATH, encoding='utf-8'))
def V(*a): return np.array(a[0] if len(a) == 1 else a, dtype=float)
def unit(v):
    v = np.asarray(v, float); n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v
X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)

WH = G['wheel']
R_TYRE, TYRE_W, RIM_R, RIM_W = WH['radius'], WH['tyreWidth'], WH['rimRadius'], WH['rimWidth']
HUB_F, HUB_R, DISC_R = WH['hubWidthFront'], WH['hubWidthRear'], WH['discRadius']
FA, RA = V(G['frontAxle']), V(G['rearAxle'])
ST = G['steer']
AX = unit(ST['axis'])
CROWN, HTB, HTT, STT = V(ST['crown']), V(ST['headTubeBottom']), V(ST['headTubeTop']), V(ST['steererTop'])
FWD = unit(V(0, AX[2], -AX[1]))           # perpendicular to the steering axis, forward, in the bike's plane
FK = G['fork']
TRAVEL, ATC, OFFSET = FK['travel'], FK['axleToCrown'], FK['offset']
STAN_R, STAN_HS, LOWERS_L = FK['stanchionDiameter'] / 2, FK['stanchionHalfSpacing'], FK['lowersLength']
BARCLAMP = V(G['stem']['barClamp'])
BAR = G['bar']
BAR_W, BACKSWEEP, UPSWEEP = BAR['width'], math.radians(BAR['backsweepDeg']), math.radians(BAR['upsweepDeg'])
GRIPS = [V(g) for g in BAR['grips']]      # [left, right]
BB = V(G['bb'])
CR = G['crank']
CRANK_L, PEDAL_X, PEDAL_SIZE = CR['length'], CR['pedalX'], CR['pedalSize']
RING_T, RING_R, CHAINLINE = CR['chainringTeeth'], CR['chainringRadius'], CR['chainlineX']
COG_T = sorted(G['cassette']['teeth'])
COG_RMAX = G['cassette']['largestRadius']
SEAT = G['seat']
STA = math.radians(SEAT['seatTubeAngleDeg'])
SADDLE_TOP, SADDLE_L, SADDLE_W = V(SEAT['saddleTop']), SEAT['saddleLength'], SEAT['saddleWidth']
RR = G['rear']
PIVOT, SFM, SSM = V(RR['pivot']), V(RR['shockFrameMount']), V(RR['shockSwingarmMount'])
EYE2EYE, STROKE, SWING_MAX, WHEEL_TRAVEL = RR['shockEyeToEye'], RR['shockStroke'], RR['swingarmMaxRotation'], RR['wheelTravel']
RD = G['rider']

STDIR = unit(V(0, math.sin(STA), math.cos(STA)))   # up the seat tube (and back)
def st_pt(t): return BB + STDIR * t
T_SADDLE = float((SADDLE_TOP - BB) @ STDIR)
CHAIN_PITCH = 2 * math.pi * RING_R / RING_T        # (12.7 mm: the ring's pitch radius over its teeth)
def cog_pitch_r(teeth): return COG_RMAX * teeth / max(COG_T)
GEAR_TEETH = COG_T[12 - GEAR] if len(COG_T) == 12 else COG_T[len(COG_T) // 2]

def Rx(a):
    """The geometry's R(a) (the JSON's `rotation`): (y, z) → (y cos a + z sin a, −y sin a + z cos a) — as a matrix."""
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, s], [0, -s, c]])
def axis_rot(a, ang):
    x, y, z = unit(a); c, s = math.cos(ang), math.sin(ang); t = 1 - c
    return np.array([[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
                     [t * x * z - s * y, t * y * z + s * x, t * z * z + c]])

# ---- the model's own design (not geometry the JSON has): sizes of things, in metres
ROTOR_INSET = 0.0156       # the rotor's plane inside the dropout face (the 6-bolt standard)
ROTOR_XF = -(HUB_F / 2 - ROTOR_INSET)
ROTOR_XR = -(HUB_R / 2 - ROTOR_INSET)
KNOB_H = 0.0045            # tread knob height: the carcass crown is R_TYRE − KNOB_H, the knob tops reach R_TYRE
GRIP_R = 0.0155            # the grips' radius (the rider's fist closes around it)
STAN_OVERLAP = 0.10        # the stanchions run this far into the lowers at full extension
SHAFT_L = 0.10             # the shock's shaft: from its eye this far into the body
COG_DX = 0.0039            # cassette cog to cog
CAS_X_OUT = HUB_R / 2 - 0.005   # the smallest cog's outer face
CAS_X = [CAS_X_OUT - 0.0009 - (len(COG_T) - 1 - i) * COG_DX for i in range(len(COG_T))]  # [largest … smallest]
COGS_DESC = sorted(COG_T, reverse=True)
GEAR_X = CAS_X[COGS_DESC.index(GEAR_TEETH)]
N_SPOKES = 24
RIDER_X = 1.2              # the rider stands this far right of the bike in the file (the game poses it)

# ===================================================================================================== materials
MATERIALS = {  # name: (sRGB, roughness)
    'Paint': ('#B4501E', 0.45),        # burnt orange (the game tints it)
    'Dark': ('#1D1E21', 0.5),          # anodised black hardware
    'Alloy': ('#B7BABE', 0.32),        # silver rotors, axles, bolts
    'Stanchion': ('#C9A15A', 0.3),     # "kashima" gold
    'Rubber': ('#2B2826', 0.9),        # tyres, grips: near-black warm grey
    'ShockAccent': ('#1FA39D', 0.4),   # teal: the shock's knobs and band
    'Saddle': ('#262423', 0.65),
    'Chain': ('#5B5D61', 0.45),
    'Jersey': ('#3C6D90', 0.85),       # steel blue: reads against green meadows and red rock
    'Shorts': ('#454937', 0.9),        # dark olive
    'Pads': ('#2A2B2E', 0.8),
    'Gloves': ('#BDB3A2', 0.85),       # sand
    'Skin': ('#C38E6B', 0.7),
    'Helmet': ('#DAD4C8', 0.5),        # warm off-white
    'Lens': ('#E08A2E', 0.15),         # amber mirror
    'Shoes': ('#36383C', 0.85),
}
def srgb_to_linear(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
MATS = {}
def make_materials():
    for name, (hexc, rough) in MATERIALS.items():
        m = bpy.data.materials.new(name)
        lin = srgb_to_linear(hexc)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*lin, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = 0.0
        m.diffuse_color = (*lin, 1)         # (Workbench's preview colour)
        m.roughness = rough
        MATS[name] = m

# ===================================================================================================== mesh tools
# Every generator returns (verts (n × 3, game space), faces (lists of indices)) with faces wound counter-clockwise seen
# from outside (glTF culls back faces).

def ring(c, U, W, ru, rw, m, expo=2.0, phase=0.0):
    """m points round c in the plane (U, W), counter-clockwise about U × W; a superellipse (expo 2: an ellipse)."""
    th = 2 * np.pi * (np.arange(m) + phase) / m
    co, si = np.cos(th), np.sin(th)
    if expo != 2.0:
        e = 2.0 / expo
        co, si = np.sign(co) * np.abs(co) ** e, np.sign(si) * np.abs(si) ** e
    return np.asarray(c, float) + np.outer(ru * co, U) + np.outer(rw * si, W)

def skin(rings, closed=False, cap0='flat', cap1='flat'):
    """Quads between consecutive rings (each counter-clockwise about the way the rings advance — then the quads face
    out). A ring may be a single point (a pole: a fan). cap0 / cap1: 'flat' closes an end ring with an n-gon."""
    verts, faces, idx = [], [], []
    for r in rings:
        r = np.asarray(r, float)
        if r.ndim == 1:
            idx.append(len(verts)); verts.append(r)
        else:
            idx.append(list(range(len(verts), len(verts) + len(r)))); verts.extend(r)
    n = len(rings)
    for i, j in [(i, i + 1) for i in range(n - 1)] + ([(n - 1, 0)] if closed else []):
        a, b = idx[i], idx[j]
        if isinstance(a, int) and isinstance(b, int): continue
        if isinstance(a, int):
            m = len(b); faces += [[a, b[(k + 1) % m], b[k]] for k in range(m)]
        elif isinstance(b, int):
            m = len(a); faces += [[a[k], a[(k + 1) % m], b] for k in range(m)]
        else:
            m = len(a); faces += [[a[k], a[(k + 1) % m], b[(k + 1) % m], b[k]] for k in range(m)]
    if not closed:
        if cap0 == 'flat' and not isinstance(idx[0], int): faces.append(idx[0][::-1])
        if cap1 == 'flat' and not isinstance(idx[-1], int): faces.append(list(idx[-1]))
    return np.array(verts), faces

def basis(D):
    """U, W perpendicular to D with U × W = D."""
    D = unit(D)
    a = X if abs(D[0]) < 0.9 else Y
    U = unit(np.cross(a, D))
    return U, np.cross(D, U)

def revolve(O, D, prof, m=16, phase=0.0, closed=False, cap0=None, cap1=None):
    """A lathe about the axis (O, D): prof = [(along, radius)], CLOCKWISE in (along → right, radius ↑) for an outward
    surface; a radius of 0 is a pole."""
    O = V(O); D = unit(D); U, W = basis(D)
    rings = [O + a * D if r < 1e-9 else ring(O + a * D, U, W, r, r, m, phase=phase) for a, r in prof]
    return skin(rings, closed, cap0 or 'none', cap1 or 'none')

def cyl(p0, p1, r, m=12, r1=None, caps=True, phase=0.0):
    p0, p1 = V(p0), V(p1)
    L = np.linalg.norm(p1 - p0)
    return revolve(p0, p1 - p0, [(0, r), (L, r if r1 is None else r1)], m, phase,
                   cap0='flat' if caps else None, cap1='flat' if caps else None)

def path_frames(P, side=None):
    """Tangents T and section axes A, B (A × B = T) along a path: A is `side` made perpendicular, or parallel-transported."""
    P = np.asarray(P, float); n = len(P)
    T = np.zeros_like(P)
    T[1:-1] = P[2:] - P[:-2]; T[0] = P[1] - P[0]; T[-1] = P[-1] - P[-2]
    T /= np.linalg.norm(T, axis=1)[:, None]
    A = np.zeros_like(P)
    if side is not None:
        s = V(side)
        for i in range(n): A[i] = unit(s - T[i] * (s @ T[i]))
    else:
        ref = X if abs(T[0][0]) < 0.9 else Y
        a = unit(ref - T[0] * (ref @ T[0]))
        for i in range(n):
            a = unit(a - T[i] * (a @ T[i])); A[i] = a
    return T, A, np.cross(T, A)

def sweep(P, ra, rb=None, m=12, side=None, expo=2.0, cap0='flat', cap1='flat', dome0=0.0, dome1=0.0, dk=2, phase=0.0, closed=False):
    """A tube along the path P, its section a superellipse of half sizes ra (along A) and rb (along B) per point;
    flat or domed ends."""
    P = np.asarray(P, float); n = len(P)
    ra = np.broadcast_to(np.asarray(ra, float), (n,)).astype(float)
    rb = ra.copy() if rb is None else np.broadcast_to(np.asarray(rb, float), (n,)).astype(float)
    T, A, B = path_frames(P, side)
    if closed:
        T = np.roll(P, -1, 0) - np.roll(P, 1, 0); T /= np.linalg.norm(T, axis=1)[:, None]
        s = V(side) if side is not None else X
        A = np.array([unit(s - t * (s @ t)) for t in T]); B = np.cross(T, A)
    rings = [ring(P[i], A[i], B[i], ra[i], rb[i], m, expo, phase) for i in range(n)]
    pre, post = [], []
    if dome0 > 0:
        pre.append(P[0] - T[0] * dome0)
        for j in range(dk, 0, -1):
            f = (math.pi / 2) * j / (dk + 1)
            pre.append(ring(P[0] - T[0] * dome0 * math.sin(f), A[0], B[0], ra[0] * math.cos(f), rb[0] * math.cos(f), m, expo, phase))
    if dome1 > 0:
        for j in range(1, dk + 1):
            f = (math.pi / 2) * j / (dk + 1)
            post.append(ring(P[-1] + T[-1] * dome1 * math.sin(f), A[-1], B[-1], ra[-1] * math.cos(f), rb[-1] * math.cos(f), m, expo, phase))
        post.append(P[-1] + T[-1] * dome1)
    return skin(pre + rings + post, closed, 'none' if dome0 > 0 else cap0, 'none' if dome1 > 0 else cap1)

def spline(C, n_per=6):
    """Catmull-Rom through the control points; also each sample's parameter (control index + t)."""
    C = np.asarray(C, float)
    P = np.vstack([2 * C[0] - C[1], C, 2 * C[-1] - C[-2]])
    pts, us = [], []
    for i in range(len(C) - 1):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        for t in np.linspace(0, 1, n_per, endpoint=False):
            pts.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            us.append(i + t)
    pts.append(C[-1]); us.append(len(C) - 1)
    return np.array(pts), np.array(us)

def along(us, vals): return np.interp(us, np.arange(len(vals)), vals)

def hull(points):
    """The convex hull of the points (bmesh), faces out."""
    bm = bmesh.new()
    for p in np.asarray(points, float): bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=list(bm.verts))
    loose = [v for v in bm.verts if not v.link_faces]
    if loose: bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.verts.index_update()
    verts = np.array([v.co[:] for v in bm.verts]); faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces

def ellipsoid(c, radii, R=None, m=12, n=8, expo=2.0):
    """An ellipsoid (or superellipsoid) at c, half sizes along its own x, y, z (R's columns), poles on its y."""
    prof = []
    for j in range(n + 1):
        th = math.pi * j / n          # from the bottom pole (−y) to the top (+y)
        prof.append((-math.cos(th), math.sin(th)))
    rings = []
    for a, r in prof:
        if r < 1e-9: rings.append(V(0, a, 0))
        else:
            rr = r ** (2.0 / expo) if expo != 2.0 else r
            aa = math.copysign(abs(a) ** (2.0 / expo), a) if expo != 2.0 else a
            rings.append(ring(V(0, aa, 0), Z, X, rr, rr, m, expo))   # (Z × X = Y: counter-clockwise about +y)
    v, f = skin(rings, cap0='none', cap1='none')
    v = v * np.asarray(radii, float)
    if R is not None: v = v @ np.asarray(R, float).T
    return v + np.asarray(c, float), f

def xf(mesh, R=None, t=None):
    v, f = mesh
    if R is not None: v = v @ np.asarray(R, float).T
    if t is not None: v = v + np.asarray(t, float)
    return v, f

def mirror_x(mesh):
    v, f = mesh
    return v * V(-1, 1, 1), [list(reversed(ff)) for ff in f]

# ===================================================================================================== parts
class Part:
    def __init__(self, name, origin):
        self.name, self.origin = name, V(origin)
        self.verts, self.faces, self.mats, self.nv = [], [], [], 0
    def add(self, mesh, mat):
        v, f = mesh
        v = np.asarray(v, float).reshape(-1, 3)
        b = self.nv
        self.verts.append(v); self.nv += len(v)
        self.faces += [[b + i for i in ff] for ff in f]
        self.mats += [mat] * len(f)
        return self
    def tris(self): return sum(len(f) - 2 for f in self.faces)

PARTS = {}
def part(name, origin):
    PARTS[name] = Part(name, origin)
    return PARTS[name]

# ----------------------------------------------------------------------------------------------------- FRAME
def build_frame():
    p = part('frame', (0, 0, 0))
    ht_len = float(np.linalg.norm(HTT - HTB))
    # the tapered head tube (1.5" below, 1 1/8" above) and its headset cups
    p.add(revolve(HTB, AX, [(-0.004, 0.0302), (0.014, 0.0303), (0.06, 0.0272), (ht_len + 0.0005, 0.0255)], 20, cap0='flat', cap1='flat'), 'Paint')
    p.add(revolve(HTB, AX, [(-0.012, 0.0318), (-0.0035, 0.0318)], 16, cap0='flat', cap1='flat'), 'Dark')
    p.add(revolve(HTB, AX, [(ht_len, 0.0268), (ht_len + 0.003, 0.0266)], 16, cap0='flat', cap1='flat'), 'Dark')
    # the TOP TUBE: from inside the head tube to the seat tube, sagging a little, hydroformed (a rounded square, taller
    # at the head tube)
    t0, t3 = HTB + AX * 0.072, st_pt(0.425)
    C = [t0, t0 + (t3 - t0) * 0.3 - Y * 0.006, t0 + (t3 - t0) * 0.68 - Y * 0.010, t3]
    P, u = spline(C, 3)
    p.add(sweep(P, along(u, [0.021, 0.020, 0.018, 0.0172]), along(u, [0.027, 0.022, 0.019, 0.019]), 12, X, 2.6), 'Paint')
    # the DOWN TUBE: from the head tube to the BB, sagging under the shock's frame mount (a chunky rounded box)
    d0 = HTB + AX * 0.018
    chord = BB - d0
    sagdir = unit(np.cross(X, chord))          # (perpendicular, in the plane: down and forward)
    if sagdir[1] > 0: sagdir = -sagdir
    C = [d0 + chord * f + sagdir * s for f, s in ((0, 0), (0.25, 0.020), (0.5, 0.034), (0.75, 0.024), (1.0, 0))]
    P, u = spline(C, 3)
    DT = (P, along(u, [0.029, 0.030, 0.031, 0.033, 0.034]), along(u, [0.032, 0.033, 0.032, 0.030, 0.026]))
    p.add(sweep(DT[0], DT[1], DT[2], 12, X, 2.8), 'Paint')
    # the SEAT TUBE: straight up the seat-tube angle from the BB to the collar
    ts = np.array([-0.005, 0.06, 0.13, 0.22, 0.34, 0.455])
    p.add(sweep([st_pt(t) for t in ts], [0.0215, 0.0205, 0.0192, 0.0186, 0.0186, 0.0186], None, 12, X), 'Paint')
    p.add(revolve(BB, STDIR, [(0.443, 0.0213), (0.462, 0.0213)], 14, cap0='flat', cap1='flat'), 'Dark')        # collar
    # the dropper post: its seal head, the stanchion, the head
    t_top = T_SADDLE - 0.05
    p.add(revolve(BB, STDIR, [(0.462, 0.0180), (0.476, 0.0172)], 12, cap0='flat', cap1='flat'), 'Dark')
    p.add(revolve(BB, STDIR, [(0.40, 0.0158), (t_top, 0.0158)], 14, cap0='flat', cap1='flat'), 'Dark')
    ph = st_pt(t_top)
    p.add(hull([ph + a * 0.017 * X + b * 0.014 * Z + c * Y for a in (-1, 1) for b in (-1, 1) for c in (-0.006, 0.010)]), 'Dark')
    # the SADDLE: lofted nose to tail, its top at saddleTop, level, centred on it lengthwise
    rail_y = SADDLE_TOP[1] - 0.046
    z0 = SADDLE_TOP[2] - SADDLE_L / 2
    secs = [  # (fraction along, half width (of saddleWidth/2), thickness)
        (0.0, 0.10, 0.012), (0.04, 0.17, 0.020), (0.15, 0.24, 0.026), (0.32, 0.30, 0.030), (0.48, 0.48, 0.034),
        (0.62, 0.78, 0.040), (0.75, 0.95, 0.044), (0.87, 1.0, 0.045), (0.96, 0.92, 0.042), (1.0, 0.70, 0.030)]
    rings_ = []
    for f, w, th in secs:
        z = z0 + SADDLE_L * f
        top = SADDLE_TOP[1] - 0.006 * max(0.0, (0.2 - f) / 0.2)       # (the nose dips a little)
        rings_.append(ring(V(0, top - th / 2, z), X, Y, SADDLE_W / 2 * w, th / 2, 12, 3.0))
    # (rings counter-clockwise about X × Y = +z: the loft runs nose → tail, along +z)
    p.add(skin(rings_), 'Saddle')
    for s in (-1, 1):
        C = [V(s * 0.020, SADDLE_TOP[1] - 0.024, z0 + 0.05), V(s * 0.022, rail_y, z0 + 0.10), V(s * 0.022, rail_y, z0 + 0.19),
             V(s * 0.030, SADDLE_TOP[1] - 0.030, z0 + 0.235)]
        P, u = spline(C, 2)
        p.add(sweep(P, 0.0035, None, 4, phase=0.5), 'Dark')
    p.add(hull([V(a * 0.028, rail_y + b, SADDLE_TOP[2] + c) for a in (-1, 1) for b in (-0.008, 0.006) for c in (-0.022, 0.022)]), 'Dark')
    # the BB shell and its cups
    p.add(cyl(BB - X * 0.0365, BB + X * 0.0365, 0.0235, 14), 'Paint')
    for s in (-1, 1): p.add(cyl(BB + X * s * 0.0365, BB + X * s * 0.041, 0.021, 14), 'Dark')
    # the PIVOT BOSS: a forged block over the BB, between the down tube and the seat tube, round the pivot
    pts = []
    for s in (-1, 1):
        pts += list(ring(PIVOT + X * s * 0.029, Y, Z, 0.022, 0.022, 14))
        pts += list(ring(BB + X * s * 0.029, Y, Z, 0.0225, 0.0225, 14))
        pts += list(ring(st_pt(0.17) + X * s * 0.018, Y, Z, 0.012, 0.012, 6))
    p.add(hull(pts), 'Paint')
    p.add(cyl(PIVOT - X * 0.052, PIVOT + X * 0.052, 0.008, 12), 'Alloy')
    for s in (-1, 1): p.add(cyl(PIVOT + X * s * 0.0475, PIVOT + X * s * 0.0525, 0.0115, 6, phase=0.5), 'Dark')
    # the SHOCK MOUNT gussets: two tabs up from the down tube to the frame eye, a bolt through
    for s in (-1, 1):
        tab = []
        for x in (0.0118, 0.018):
            tab += list(ring(SFM + X * s * x, Y, Z, 0.0155, 0.0155, 12))
            tab += [SFM + X * s * x + V(0, -0.068, -0.040), SFM + X * s * x + V(0, -0.062, 0.035)]
        p.add(hull(tab), 'Paint')
    p.add(cyl(SFM - X * 0.0215, SFM + X * 0.0215, 0.0055, 10), 'Alloy')
    for s in (-1, 1): p.add(cyl(SFM + X * s * 0.018, SFM + X * s * 0.0215, 0.0092, 6, phase=0.5), 'Dark')
    # a cable guide under the down tube near the BB
    k = int(len(DT[0]) * 0.72)
    T_, A_, B_ = path_frames(DT[0], X)
    g = DT[0][k] - B_[k] * (DT[2][k] + 0.002) if (B_[k] @ Y) > 0 else DT[0][k] + B_[k] * (DT[2][k] + 0.002)
    p.add(ellipsoid(g, (0.010, 0.004, 0.016), np.column_stack([X, unit(np.cross(T_[k], X)), T_[k]]), 6, 3), 'Dark')
    return p, DT

# ----------------------------------------------------------------------------------------------------- STEER
def leg_axis_top(s, side):
    """A point on a fork leg's axis: s along the steering axis from the CROWN's level, side = ±1."""
    return CROWN + FWD * OFFSET + AX * s + X * side * STAN_HS

def bar_path():
    """The riser bar's centreline, left end to right end: flat through the clamp, bending up and back into the
    sweep through each grip centre (the JSON's grips), to the bar's ends at ±width/2."""
    half = []
    gR = GRIPS[1]
    d = unit(V(1, math.tan(UPSWEEP), math.tan(BACKSWEEP)))
    tb = (gR[2] - BARCLAMP[2]) / d[2] if abs(d[2]) > 1e-6 else 0.25
    q = gR - d * (tb - 0.012)
    p1 = BARCLAMP + X * 0.04
    for xv in (0.0, 0.04): half.append(BARCLAMP + X * xv)
    L = np.linalg.norm(q - p1)
    for t in np.linspace(0, 1, 6)[1:]:
        h00, h10, h01, h11 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
        half.append(h00 * p1 + h10 * L * X + h01 * q + h11 * L * d)
    end_t = (BAR_W / 2 - gR[0]) / d[0]
    for t in (-0.07, end_t):       # (straight through the grip: its inner end, the bar's end)
        half.append(gR + d * t)
    half = np.array(half)
    left = (half[1:] * V(-1, 1, 1))[::-1]
    return np.vstack([left, half]), d

def build_steer():
    p = part('steer', CROWN)
    s_htb = float((HTB - CROWN) @ AX); s_htt = float((HTT - CROWN) @ AX); s_top = float((STT - CROWN) @ AX)
    s_bc = float((BARCLAMP - CROWN) @ AX)
    # the CROWN: a forged V from the steerer out to each stanchion
    for side in (-1, 1):
        pts = list(ring(CROWN + AX * -0.022, FWD, X, 0.024, 0.024, 14)) + list(ring(CROWN + AX * 0.010, FWD, X, 0.024, 0.024, 14))
        for s in (-0.030, 0.008): pts += list(ring(leg_axis_top(s, side), FWD, X, STAN_R + 0.008, STAN_R + 0.008, 14))
        p.add(hull(pts), 'Dark')
    p.add(revolve(CROWN, AX, [(0.008, 0.029), (s_htb - 0.0125, 0.028)], 14, cap0='flat', cap1='flat'), 'Dark')  # crown race
    p.add(revolve(CROWN, AX, [(0.0, 0.0143), (s_top, 0.0143)], 8, cap0='flat', cap1='flat'), 'Dark')          # steerer
    p.add(revolve(CROWN, AX, [(s_htt + 0.0035, 0.0256), (s_bc - 0.019, 0.0245)], 14, cap0='flat', cap1='flat'), 'Dark')  # top cover
    # the STANCHIONS (in the crown, down into the lowers)
    s_bot = -(ATC - LOWERS_L) - STAN_OVERLAP
    for side in (-1, 1):
        p.add(revolve(leg_axis_top(0, side), AX, [(s_bot, 0.0), (s_bot, STAN_R), (-0.004, STAN_R), (-0.004, 0.0)], 14), 'Stanchion')
    # the STEM: a short block from the steerer clamp to the bar clamp (stem.length ahead of the steerer)
    pts = list(ring(CROWN + AX * (s_bc - 0.019), FWD, X, 0.0195, 0.0195, 16)) + list(ring(CROWN + AX * (s_bc + 0.018), FWD, X, 0.0195, 0.0195, 16))
    for s in (-1, 1): pts += list(ring(BARCLAMP + X * s * 0.027, Y, Z, 0.0205, 0.0205, 12))
    p.add(hull(pts), 'Dark')
    p.add(revolve(CROWN, AX, [(s_top - 0.001, 0.0168), (s_top + 0.005, 0.0158)], 14, cap0='flat', cap1='flat'), 'Dark')  # top cap
    p.add(revolve(CROWN, AX, [(s_top + 0.005, 0.0050), (s_top + 0.0075, 0.0045)], 6, cap0='flat', cap1='flat'), 'Alloy')
    # the BAR
    P, d = bar_path()
    r = np.interp(np.abs(P[:, 0]), [0, 0.045, 0.14, 1], [0.0175, 0.0175, 0.0111, 0.0111])
    p.add(sweep(P, r, None, 10), 'Dark')
    # GRIPS (lock-on collars), BRAKE LEVERS, hoses; a shifter pod on the right, the dropper's remote on the left
    for side, g in ((-1, GRIPS[0]), (1, GRIPS[1])):
        ds = d * V(side, 1, 1)
        p.add(revolve(g, ds, [(-0.058, GRIP_R - 0.001), (-0.035, GRIP_R), (0.035, GRIP_R), (0.057, GRIP_R - 0.001)], 10), 'Rubber')
        for a0, a1 in ((-0.066, -0.058), (0.057, 0.065)):
            p.add(revolve(g, ds, [(a0, 0.0), (a0, 0.0168), (a1, 0.0168), (a1, 0.0)], 8), 'Dark')
        kc = g - ds * 0.077
        fw = -Z
        p.add(revolve(kc, ds, [(-0.007, 0.0), (-0.007, 0.0158), (0.007, 0.0158), (0.007, 0.0)], 10), 'Dark')
        mc = kc + fw * 0.024 + Y * 0.011
        pts = list(ring(kc, *basis(ds), 0.0158, 0.0158, 10)) + list(ring(mc - ds * 0.012, *basis(ds), 0.0095, 0.0095, 10)) + list(ring(mc + ds * 0.026, *basis(ds), 0.0095, 0.0095, 10))
        p.add(hull(pts), 'Dark')
        kp = kc + fw * 0.034 + Y * 0.004 + ds * 0.012
        C = [kp, kp + ds * 0.028 + fw * 0.016 - Y * 0.012, kp + ds * 0.066 + fw * 0.012 - Y * 0.028, kp + ds * 0.084 + fw * 0.008 - Y * 0.034]
        P2, u = spline(C, 2)
        p.add(sweep(P2, 0.0062, 0.0034, 6, Y, 3.0, dome1=0.004, dk=1), 'Alloy')
        h0 = kc + fw * 0.02 - Y * 0.008 - ds * 0.014
        C = [h0, h0 - ds * 0.03 - Y * 0.03 + fw * 0.02, h0 - ds * 0.085 - Y * 0.055 + fw * 0.03, h0 - ds * 0.14 - Y * 0.06 + fw * 0.012]
        P2, u = spline(C, 3)
        p.add(sweep(P2, 0.0028, None, 4), 'Dark')
        pod = kc - ds * 0.026 - Y * 0.019 + fw * 0.006
        sz = (0.012, 0.009, 0.014) if side > 0 else (0.008, 0.007, 0.010)
        p.add(hull([pod + ds * a * sz[0] + Y * b * sz[1] + fw * c * sz[2] for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)]), 'Dark')
    return p

# ----------------------------------------------------------------------------------------------------- FORK LOWERS
def build_lowers():
    p = part('fork_lowers', FA)
    for side in (-1, 1):
        o = FA + X * side * STAN_HS
        p.add(revolve(o, AX, [(0.030, 0.0), (0.036, 0.0185), (0.11, 0.0215), (LOWERS_L - 0.032, 0.0235),
                              (LOWERS_L - 0.029, 0.0258), (LOWERS_L - 0.004, 0.0258), (LOWERS_L, 0.0226), (LOWERS_L, 0.0183),
                              (LOWERS_L - 0.006, 0.0183), (LOWERS_L - 0.006, 0.0)], 12), 'Dark')
        # the dropout foot round the axle (its inner face on the hub's end)
        pts = []
        for x in (HUB_F / 2 + 0.0005, HUB_F / 2 + 0.022): pts += list(ring(FA + X * side * x, Y, Z, 0.0172, 0.0172, 14))
        pts += list(ring(o + AX * 0.046, FWD, X, 0.0205, 0.0205, 14))
        p.add(hull(pts), 'Dark')
    # the ARCH: in front of the legs, over the tyre (clear of it by 10 mm; clear of the crown at full travel)
    # (a broad brace: tall along the axis, flaring into the legs' fronts)
    arch_ra, arch_rb = 0.0155, 0.0105
    arch_f = 0.046
    arch_s = math.sqrt((R_TYRE + 0.010 + arch_ra) ** 2 - arch_f ** 2)
    C = [FA + AX * (LOWERS_L - 0.07) + FWD * 0.008 - X * STAN_HS,
         FA + AX * (LOWERS_L - 0.012) + FWD * 0.030 - X * 0.050,
         FA + AX * arch_s + FWD * arch_f,
         FA + AX * (LOWERS_L - 0.012) + FWD * 0.030 + X * 0.050,
         FA + AX * (LOWERS_L - 0.07) + FWD * 0.008 + X * STAN_HS]
    P, u = spline(C, 3)
    p.add(sweep(P, along(u, [0.026, 0.019, arch_ra, 0.019, 0.026]), along(u, [0.012, 0.011, arch_rb, 0.011, 0.012]), 10, AX, 2.6), 'Dark')
    # the front CALIPER (post mount behind the left leg) straddling the rotor
    e1, e2 = AX, -FWD
    beta = math.radians(60)
    dirc, tc = math.cos(beta) * e1 + math.sin(beta) * e2, -math.sin(beta) * e1 + math.cos(beta) * e2
    pts = []
    for x in (ROTOR_XF + 0.0085, ROTOR_XF - 0.0175):
        for rho, tau in ((0.076, -0.028), (0.076, 0.028), (0.107, -0.024), (0.107, 0.024), (0.092, -0.032), (0.092, 0.032)):
            pts.append(FA + X * x + dirc * rho + tc * tau)
    p.add(hull(pts), 'Dark')
    pts = []
    for x in (ROTOR_XF - 0.012, ROTOR_XF - 0.0185):
        for rho, tau in ((0.08, 0.03), (0.098, 0.03), (0.08, 0.0)):
            pts.append(FA + X * x + dirc * rho + tc * tau)
    for s in (0.05, 0.115):
        for x in (-STAN_HS + 0.010, -STAN_HS - 0.008):
            pts.append(FA + AX * s - FWD * 0.016 + X * x)
    p.add(hull(pts), 'Dark')
    hb = FA + X * (ROTOR_XF - 0.006) + dirc * 0.108 + tc * 0.012
    C = [hb, hb + AX * 0.03 - FWD * 0.006, hb + AX * 0.07 - FWD * 0.002]
    P, u = spline(C, 3)
    p.add(sweep(P, 0.0028, None, 4), 'Dark')
    # the thru-axle: its lever on the right, a nut on the left
    p.add(cyl(FA - X * (HUB_F / 2 + 0.026), FA + X * (HUB_F / 2 + 0.024), 0.0075, 10), 'Alloy')
    p.add(cyl(FA + X * (HUB_F / 2 + 0.022), FA + X * (HUB_F / 2 + 0.027), 0.012, 14), 'Dark')
    p.add(hull([FA + X * (HUB_F / 2 + 0.024 + a) + AX * b + (-FWD) * c for a in (0, 0.004) for b in (-0.006, 0.006) for c in (0.0, 0.05)]), 'Dark')
    p.add(cyl(FA - X * (HUB_F / 2 + 0.027), FA - X * (HUB_F / 2 + 0.022), 0.0105, 6, phase=0.5), 'Dark')
    return p, (arch_s, arch_f, arch_ra)

# ----------------------------------------------------------------------------------------------------- WHEELS
RC_T = None
def tyre_profile():
    """The carcass section: an ellipse from bead to bead, tyreWidth at its widest, its crown R_TYRE − KNOB_H."""
    a = TYRE_W / 2
    bead_x, bead_r = RIM_W / 2 - 0.002, RIM_R + 0.0035
    k = math.sqrt(1 - (bead_x / a) ** 2)
    b = ((R_TYRE - KNOB_H) - bead_r) / (1 + k)
    rc = (R_TYRE - KNOB_H) - b
    th_b = math.pi - math.asin(bead_x / a)
    return a, b, rc, th_b

def add_tyre(p, C, rear=False):
    a, b, rc, th_b = tyre_profile()
    ths = [-th_b, -2.1, -1.6, -1.05, -0.5, 0.0, 0.5, 1.05, 1.6, 2.1, th_b]   # (steps under the 40° crease angle)
    prof = [(a * math.sin(t), rc + b * math.cos(t)) for t in ths]
    m = 30
    p.add(revolve(C, X, prof, 28), 'Rubber')
    U, W = basis(X)
    def knob(phi, th, ht, hw, h=KNOB_H, taper=0.78, sink=0.004):
        # (sunk well into the faceted carcass: no knob floats over a flat between its vertices)
        x, r = a * math.sin(th), rc + b * math.cos(th)
        nx, nr = math.sin(th) / a, math.cos(th) / b
        nn = math.hypot(nx, nr); nx, nr = nx / nn, nr / nn
        er = math.cos(phi) * U + math.sin(phi) * W
        ep = -math.sin(phi) * U + math.cos(phi) * W
        N = nx * X + nr * er; T1 = ep; T2 = np.cross(N, T1)
        base = C + x * X + r * er - sink * N
        top = base + (h + sink) * N
        cs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        vs = [base + s1 * ht * T1 + s2 * hw * T2 for s1, s2 in cs] + [top + taper * (s1 * ht * T1 + s2 * hw * T2) for s1, s2 in cs]
        fs = [[4, 5, 6, 7]] + [[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i] for i in range(4)]
        p.add((np.array(vs), fs), 'Rubber')
    # the tread, repeat by repeat: shoulder knobs on every one (the silhouette from any side), the centre alternating
    # a pair and one wide block (a paddle on the rear)
    for k in range(m):
        phi = 2 * math.pi * k / m
        sh = 1.42 if k % 2 == 0 else 1.30
        for s in (-1, 1): knob(phi + 0.03, s * sh, 0.0062, 0.0060, KNOB_H + 0.0008)
        if k % 2 == 0:
            for s in (-1, 1): knob(phi, s * 0.32, 0.0060, 0.0055)
        elif rear: knob(phi, 0.0, 0.0048, 0.0150)
        else: knob(phi, 0.0, 0.0056, 0.0135)

def add_rim_hub_spokes(p, C, hw, fl_l, fl_r, rotor_x):
    # the RIM (hook beads under the tyre, the walls, the spoke bed)
    rw = RIM_W / 2
    prof = [(rw - 0.0025, RIM_R + 0.006), (rw, RIM_R + 0.0045), (rw, RIM_R - 0.008), (0.009, RIM_R - 0.0205),
            (-0.009, RIM_R - 0.0205), (-rw, RIM_R - 0.008), (-rw, RIM_R + 0.0045), (-rw + 0.0025, RIM_R + 0.006)]
    # (down the right wall, along the bed, up the left: clockwise in (x, r) — the surface faces out, the bed the hub)
    p.add(revolve(C, X, prof, 24), 'Dark')
    # the HUB: shell, flanges, the rotor mount
    prof = [(-hw, 0.0), (-hw, 0.0095), (rotor_x - 0.0045, 0.0095), (rotor_x - 0.0045, 0.0225), (rotor_x + 0.002, 0.016),
            (fl_l - 0.0016, 0.026), (fl_l + 0.0016, 0.026), (fl_l + 0.0035, 0.0165), (fl_r - 0.0035, 0.0165),
            (fl_r - 0.0016, 0.026), (fl_r + 0.0016, 0.026), (fl_r + 0.0035, 0.013), (hw, 0.0095), (hw, 0.0)]
    p.add(revolve(C, X, prof, 10), 'Dark')
    # SPOKES: 28, two-cross, triangular prisms
    U, W = basis(X)
    r_hub, r_rim = 0.0245, RIM_R - 0.019
    for i in range(N_SPOKES):
        phi = 2 * math.pi * i / N_SPOKES
        side = 1 if i % 2 == 0 else -1
        lead = 1 if (i // 2) % 2 == 0 else -1
        hphi = phi + lead * 2 * (4 * math.pi / N_SPOKES)
        hx = fl_r if side > 0 else fl_l
        h = C + X * hx + r_hub * (math.cos(hphi) * U + math.sin(hphi) * W)
        rr = C + X * side * 0.0025 + r_rim * (math.cos(phi) * U + math.sin(phi) * W)
        p.add(sweep([h, rr], 0.0012, None, 3, cap0='none', cap1='none'), 'Dark')
    # the ROTOR (left): the braking band, six curved arms to the hub
    rin = DISC_R - 0.022
    p.add(revolve(C + X * rotor_x, X, [(-0.0009, rin), (-0.0009, DISC_R), (0.0009, DISC_R), (0.0009, rin)], 24, closed=True), 'Alloy')
    for k in range(6):
        a0 = 2 * math.pi * k / 6; a1 = a0 + 0.30
        pts = []
        for x in (rotor_x - 0.0009, rotor_x + 0.0009):
            for rr, aa, w in ((0.019, a0, 0.0058), (rin + 0.006, a1, 0.0045)):
                er = math.cos(aa) * U + math.sin(aa) * W; et = -math.sin(aa) * U + math.cos(aa) * W
                pts += [C + X * x + er * rr + et * w, C + X * x + er * rr - et * w]
        p.add(hull(pts), 'Alloy')

def build_wheels():
    f = part('wheel_front', FA)
    add_tyre(f, FA)
    add_rim_hub_spokes(f, FA, HUB_F / 2, -0.0335, 0.0295, ROTOR_XF)
    r = part('wheel_rear', RA)
    add_tyre(r, RA, rear=True)
    add_rim_hub_spokes(r, RA, HUB_R / 2, -0.0375, 0.0195, ROTOR_XR)
    # the CASSETTE: twelve cogs as a stepped cone, largest inboard; a lockring
    prof = [(CAS_X[0] - 0.0009, 0.0), (CAS_X[0] - 0.0009, 0.018)]
    for i, t in enumerate(COGS_DESC):
        R = cog_pitch_r(t) + 0.003
        x0 = CAS_X[i] - 0.0009 if i == 0 else CAS_X[i - 1] + 0.0009
        prof += [(x0, R), (CAS_X[i] + 0.0009, R)]
    prof += [(CAS_X[-1] + 0.0009, 0.016), (CAS_X[-1] + 0.0035, 0.0145), (CAS_X[-1] + 0.0035, 0.0)]
    r.add(revolve(RA, X, prof, 12), 'Alloy')
    return f, r

# ----------------------------------------------------------------------------------------------------- SWINGARM
def chainstay_path(side):
    """The chainstays: from the pivot clevis, under the chain's top run (inboard of the chain while above it), out
    past the cassette and the rotor to the dropouts."""
    ends = RA + V(0, 0.002, -0.012)
    C, xs = [], [0.039, 0.037, 0.042, 0.062, 0.079, 0.081]
    for u_, dy in ((0.0, 0.0), (0.177, -0.012), (0.376, -0.021), (0.597, -0.015), (0.818, -0.007), (1.0, 0.0)):
        q = PIVOT + (ends - PIVOT) * u_ + V(0, dy, 0)
        C.append(q)
    C = [c + X * side * x for c, x in zip(C, xs)]
    return spline(C, 2)

def seatstay_path(side):
    jy = SSM + V(0, 0.015, 0.11)
    C = [RA + V(0, 0.005, -0.012), RA + V(0, 0.075, -0.0825), RA + V(0, 0.165, -0.1725), RA + V(0, 0.23, -0.2425), RA + V(0, 0.265, -0.3025), jy]
    xs = [0.082, 0.075, 0.064, 0.050, 0.040, 0.036]
    C = [c + X * side * x for c, x in zip(C, xs)]
    return spline(C, 2)

def yoke_path(side):
    jy = SSM + V(0, 0.015, 0.11)
    C = [jy, SSM + V(0, 0.008, 0.055), SSM + V(0, 0.002, 0.027)]
    xs = [0.036, 0.034, 0.027]
    C = [c + X * side * x for c, x in zip(C, xs)]
    return spline(C, 3)

def build_swingarm():
    p = part('swingarm', PIVOT)
    for s in (-1, 1):
        p.add(cyl(PIVOT + X * min(s * 0.031, s * 0.047), PIVOT + X * max(s * 0.031, s * 0.047), 0.021, 12), 'Paint')
        P, u = chainstay_path(s)
        p.add(sweep(P, along(u, [0.0095, 0.0095, 0.0095, 0.009, 0.0082, 0.0078]), along(u, [0.017, 0.0155, 0.0145, 0.0125, 0.011, 0.010]), 10, X, 2.6), 'Paint')
        P, u = seatstay_path(s)
        p.add(sweep(P, along(u, [0.0082, 0.0085, 0.0088, 0.009, 0.0095, 0.0095]), along(u, [0.0095, 0.010, 0.011, 0.012, 0.013, 0.013]), 10, X, 2.4), 'Paint')
        P, u = yoke_path(s)
        p.add(sweep(P, 0.0090, along(u, [0.013, 0.014, 0.014]), 10, X, 2.6, cap0='flat', dome1=0.006, dk=1), 'Paint')
        # the clevis tab round the shock's swingarm eye
        tab = []
        for x in (0.0118, 0.018):
            tab += list(ring(SSM + X * s * x, Y, Z, 0.0145, 0.0145, 12))
            tab += [SSM + X * s * x + V(0, 0.012, 0.026), SSM + X * s * x + V(0, -0.012, 0.026)]
        p.add(hull(tab), 'Paint')
        # the dropout
        pts = []
        for x in (HUB_R / 2, HUB_R / 2 + 0.011):
            pts += list(ring(RA + X * s * x, Y, Z, 0.019, 0.019, 10))
            pts += [RA + X * s * x + V(0, 0.004, -0.034), RA + X * s * x + V(0, 0.026, -0.024), RA + X * s * x + V(0, 0.034, -0.016)]
        p.add(hull(pts), 'Paint')
    # the yoke's BRIDGE in front of the seat tube (behind the shock eye)
    br = SSM + V(0, 0, 0.028)
    p.add(sweep([br - X * 0.033, br, br + X * 0.033], 0.013, 0.0105, 10, Y, 2.6, dome0=0.006, dome1=0.006, dk=1), 'Paint')
    # the chainstays' bridge behind the seat tube, ahead of the tyre
    cb = PIVOT + V(0, -0.028, 0.085)
    p.add(sweep([cb - X * 0.036, cb, cb + X * 0.036], 0.010, 0.0075, 10, Y, 2.6), 'Paint')
    # the thru-axle (lever left, nut and the derailleur hanger right)
    hw = HUB_R / 2
    p.add(cyl(RA - X * (hw + 0.016), RA + X * (hw + 0.016), 0.0075, 10), 'Alloy')
    p.add(cyl(RA - X * (hw + 0.017), RA - X * (hw + 0.011), 0.012, 14), 'Dark')
    p.add(hull([RA - X * (hw + 0.013 + a) + Y * b + Z * c for a in (0, 0.004) for b in (-0.006, 0.006) for c in (-0.05, 0.0)]), 'Dark')
    p.add(cyl(RA + X * (hw + 0.011), RA + X * (hw + 0.017), 0.0105, 6, phase=0.5), 'Dark')
    hb = RA + V(0, -0.026, 0.012)
    pts = list(ring(RA + X * (hw + 0.0115), Y, Z, 0.013, 0.013, 10)) + list(ring(RA + X * (hw + 0.0165), Y, Z, 0.013, 0.013, 10))
    pts += list(ring(hb + X * (hw + 0.0115), Y, Z, 0.009, 0.009, 8)) + list(ring(hb + X * (hw + 0.0165), Y, Z, 0.009, 0.009, 8))
    p.add(hull(pts), 'Dark')
    # the REAR CALIPER on the left chainstay, forward of the axle, straddling the rotor
    beta = math.radians(22)
    dirc, tc = V(0, math.sin(beta), -math.cos(beta)), V(0, math.cos(beta), math.sin(beta))
    pts = []
    for x in (ROTOR_XR + 0.0085, ROTOR_XR - 0.0175):
        for rho, tau in ((0.076, -0.028), (0.076, 0.028), (0.107, -0.024), (0.107, 0.024), (0.092, -0.032), (0.092, 0.032)):
            pts.append(RA + X * x + dirc * rho + tc * tau)
    p.add(hull(pts), 'Dark')
    P, u = chainstay_path(-1)
    pts = []
    for x in (ROTOR_XR - 0.012, ROTOR_XR - 0.0185):
        for rho, tau in ((0.08, -0.03), (0.08, 0.03), (0.07, 0.0)):
            pts.append(RA + X * x + dirc * rho + tc * tau)
    for k in (int(len(P) * 0.76), int(len(P) * 0.88)):
        pts += [P[k] + Y * 0.004 + X * dx for dx in (0.004, -0.004)]
    p.add(hull(pts), 'Dark')
    hb2 = RA + X * (ROTOR_XR - 0.006) + dirc * 0.104 + tc * 0.026
    P2, u = spline([hb2, hb2 + V(0, 0.012, -0.05), hb2 + V(0, 0.006, -0.12)], 3)
    p.add(sweep(P2, 0.0028, None, 4), 'Dark')
    # the REAR DERAILLEUR: B-knuckle on the hanger, the parallelogram, the cage and its two pulleys in the gear's plane
    up, lo = derailleur_pulleys()
    p.add(cyl(hb + X * (hw + 0.013), hb + X * (hw + 0.029), 0.0115, 12), 'Dark')
    pk = up + V(0, 0.010, 0.004)
    pts = list(ring(hb + X * (hw + 0.016), Y, Z, 0.010, 0.010, 10)) + list(ring(hb + X * (hw + 0.028), Y, Z, 0.010, 0.010, 10))
    pts += list(ring(pk + X * (GEAR_X + 0.012 - pk[0]), Y, Z, 0.011, 0.011, 10)) + list(ring(pk + X * (GEAR_X + 0.026 - pk[0]), Y, Z, 0.011, 0.011, 10))
    p.add(hull(pts), 'Dark')
    for x0, x1, ru, rl in ((GEAR_X + 0.0055, GEAR_X + 0.0080, 0.0165, 0.0195), (GEAR_X - 0.0080, GEAR_X - 0.0055, 0.013, 0.0185)):
        pts = []
        for x in (x0, x1):
            pts += list(ring(V(x, up[1], up[2]), Y, Z, ru, ru, 8)) + list(ring(V(x, lo[1], lo[2]), Y, Z, rl, rl, 8))
        p.add(hull(pts), 'Dark')
    for c in (up, lo):
        p.add(revolve(V(GEAR_X, c[1], c[2]), X, [(-0.0028, 0.0), (-0.0028, 0.0225), (-0.0012, 0.0246), (0.0012, 0.0246), (0.0028, 0.0225), (0.0028, 0.0)], 10), 'Dark')
        p.add(cyl(V(GEAR_X - 0.0058, c[1], c[2]), V(GEAR_X + 0.0085, c[1], c[2]), 0.0042, 6), 'Alloy')
    return p

def derailleur_pulleys():
    return RA + V(0, -0.072, 0.040), RA + V(0, -0.150, 0.020)

# ----------------------------------------------------------------------------------------------------- SHOCK
CAN_END = (EYE2EYE - STROKE) - 0.018 - 0.007   # the can stops short of the shaft's eyelet at full stroke
def build_shock():
    E = unit(SSM - SFM)
    UPp = unit(np.cross(E, X)) if (np.cross(E, X) @ Y) > 0 else -unit(np.cross(E, X))
    b = part('shock_body', SFM)
    b.add(cyl(SFM - X * 0.011, SFM + X * 0.011, 0.0115, 16), 'Dark')
    b.add(cyl(SFM - X * 0.0118, SFM + X * 0.0118, 0.0058, 10), 'Alloy')
    pts = list(ring(SFM - X * 0.009, Y, Z, 0.0115, 0.0115, 12)) + list(ring(SFM + X * 0.009, Y, Z, 0.0115, 0.0115, 12))
    pts += list(ring(SFM + E * 0.026, X, UPp, 0.0175, 0.0175, 14))
    b.add(hull(pts), 'Dark')
    b.add(revolve(SFM, E, [(0.020, 0.0), (0.020, 0.0175), (0.028, 0.0235), (0.034, 0.0255), (CAN_END - 0.008, 0.0255), (CAN_END - 0.002, 0.0228),
                           (CAN_END, 0.0172), (CAN_END - 0.004, 0.0166), (CAN_END - 0.004, 0.0)], 14), 'Dark')
    b.add(revolve(SFM, E, [(0.040, 0.0), (0.040, 0.0263), (0.047, 0.0263), (0.047, 0.0)], 16), 'ShockAccent')
    # the piggyback reservoir over the can, its bridge to the head, the knobs
    ro = SFM + UPp * 0.034
    b.add(revolve(ro, E, [(0.006, 0.0), (0.006, 0.0105), (0.010, 0.0115), (0.088, 0.0115), (0.094, 0.0105), (0.094, 0.0)], 12), 'Dark')
    pts = list(ring(ro + E * 0.008, X, UPp, 0.010, 0.010, 10)) + list(ring(ro + E * 0.030, X, UPp, 0.010, 0.010, 10))
    pts += list(ring(SFM + E * 0.016, X, UPp, 0.012, 0.012, 10)) + list(ring(SFM + E * 0.030, X, UPp, 0.012, 0.012, 10))
    b.add(hull(pts), 'Dark')
    b.add(revolve(ro, E, [(0.094, 0.0), (0.094, 0.0098), (0.101, 0.0098), (0.103, 0.006), (0.103, 0.0)], 12), 'ShockAccent')
    b.add(cyl(SFM + E * 0.022 + X * 0.014, SFM + E * 0.022 + X * 0.0205, 0.0075, 12), 'ShockAccent')
    s = part('shock_shaft', SSM)
    s.add(cyl(SSM - X * 0.011, SSM + X * 0.011, 0.0115, 16), 'Dark')
    s.add(cyl(SSM - X * 0.0118, SSM + X * 0.0118, 0.0058, 10), 'Alloy')
    pts = list(ring(SSM - X * 0.009, Y, Z, 0.0115, 0.0115, 12)) + list(ring(SSM + X * 0.009, Y, Z, 0.0115, 0.0115, 12))
    pts += list(ring(SSM - E * 0.018, X, UPp, 0.0175, 0.0175, 14))
    s.add(hull(pts), 'Dark')
    s.add(revolve(SSM, -E, [(0.012, 0.0), (0.012, 0.0160), (SHAFT_L, 0.0160), (SHAFT_L, 0.0)], 16), 'Stanchion')
    return b, s

# ----------------------------------------------------------------------------------------------------- CRANKS, PEDALS
def build_crank():
    p = part('crank', BB)
    p.add(cyl(BB - X * 0.068, BB + X * 0.068, 0.0145, 8), 'Dark')
    for side in (-1, 1):
        d = -Z * side                         # right arm forward (angle 0), the left back
        x0, x1 = 0.067, 0.078
        ts = [-0.06, 0.25, 0.55, 0.8, 1.0, 1.06]
        P = [BB + X * side * (x0 + (x1 - x0) * max(0.0, t) ** 2) + d * (t * CRANK_L) for t in ts]
        p.add(sweep(P, [0.0175, 0.016, 0.0145, 0.013, 0.0118, 0.0115], [0.0076, 0.0075, 0.0073, 0.0072, 0.007, 0.007], 10, Y, 3.0), 'Dark')
        p.add(cyl(BB + X * min(side * 0.059, side * 0.075), BB + X * max(side * 0.059, side * 0.075), 0.0195, 10), 'Dark')
        pe = BB + d * CRANK_L
        p.add(cyl(pe + X * min(side * 0.070, side * 0.086), pe + X * max(side * 0.070, side * 0.086), 0.0125, 10), 'Dark')
    # the CHAINRING (32 teeth on the chainline), the direct-mount carrier
    U, W = basis(X)
    T = RING_T
    rt, rr, ri = RING_R + 0.0035, RING_R - 0.0035, RING_R - 0.016
    verts, faces = [], []
    for x in (CHAINLINE - 0.0016, CHAINLINE + 0.0016):
        for j in range(2 * T):
            a = math.pi * j / T; r = rt if j % 2 == 0 else rr
            verts.append(BB + X * x + r * (math.cos(a) * U + math.sin(a) * W))
        for k in range(T):
            a = 2 * math.pi * (k + 0.5) / T
            verts.append(BB + X * x + ri * (math.cos(a) * U + math.sin(a) * W))
    nb = 3 * T
    def o(side, j): return side * nb + (j % (2 * T))
    def i_(side, k): return side * nb + 2 * T + (k % T)
    for k in range(T):
        # the pentagon between the valleys either side of tooth k (+x face counter-clockwise seen from +x)
        poly = [i_(1, k - 1), o(1, 2 * k - 1), o(1, 2 * k), o(1, 2 * k + 1), i_(1, k)]
        faces.append(poly)
        faces.append([i_(0, k), o(0, 2 * k + 1), o(0, 2 * k), o(0, 2 * k - 1), i_(0, k - 1)])
    for j in range(2 * T): faces.append([o(0, j), o(0, j + 1), o(1, j + 1), o(1, j)])
    for k in range(T): faces.append([i_(1, k), i_(1, k + 1), i_(0, k + 1), i_(0, k)])
    p.add((np.array(verts), faces), 'Dark')
    p.add(cyl(BB + X * (CHAINLINE + 0.0016), BB + X * 0.062, 0.026, 12), 'Dark')
    for k in range(4):
        a = 2 * math.pi * (k + 0.125) / 4
        er = math.cos(a) * U + math.sin(a) * W; et = -math.sin(a) * U + math.cos(a) * W
        p.add(hull([BB + X * x + er * r + et * w for x in (CHAINLINE + 0.0016, CHAINLINE + 0.0052) for r, ww in ((0.02, 0.008), (ri + 0.005, 0.0055)) for w in (ww, -ww)]), 'Dark')
    return p

def build_pedals():
    out = []
    hx, hy, hz = PEDAL_SIZE[0] / 2, PEDAL_SIZE[1] / 2, PEDAL_SIZE[2] / 2
    for name, side, o in (('pedal_r', 1, BB + V(PEDAL_X, 0, -CRANK_L)), ('pedal_l', -1, BB + V(-PEDAL_X, 0, CRANK_L))):
        p = part(name, o)
        rings_ = [ring(o + Y * (-hy + 0.004), Z, X, hz * 0.62, hx * 0.62, 12, 4.0, 0.5), ring(o - Y * hy, Z, X, hz, hx, 12, 4.0, 0.5),
                  ring(o + Y * hy, Z, X, hz, hx, 12, 4.0, 0.5), ring(o + Y * (hy - 0.004), Z, X, hz * 0.62, hx * 0.62, 12, 4.0, 0.5)]
        p.add(skin(rings_), 'Dark')
        x_crank = BB[0] + side * 0.086
        p.add(cyl(V(x_crank, o[1], o[2]), o + X * side * (-hx + 0.012), 0.0075, 10), 'Alloy')
        p.add(cyl(o + X * side * (-hx - 0.008), o + X * side * (-hx + 0.004), 0.0115, 12), 'Dark')
        # the pins: small cones along the front and back edges, top and bottom
        for xx in (-0.035, -0.012, 0.012, 0.035):
            for zz in (-(hz - 0.007), hz - 0.007):
                for yy in (1, -1):
                    c = o + X * xx * hx / 0.05 + Z * zz + Y * yy * (hy - 0.001)
                    base = ring(c, Z, X, 0.0026, 0.0026, 3) if yy > 0 else ring(c, X, Z, 0.0026, 0.0026, 3)
                    p.add(skin([base, c + Y * yy * 0.0045], cap0='none'), 'Alloy')
        out.append(p)
    return out

# ----------------------------------------------------------------------------------------------------- CHAIN
def tangent2(p1, r1, s1, p2, r2, s2):
    """The chain's run from circle 1 to circle 2 (2D; s = +1 clockwise, −1 anticlockwise in the travel sense)."""
    D = p2 - p1; d = np.linalg.norm(D)
    k = (r1 - s1 * s2 * r2) / d
    phi = math.atan2(D[1], D[0]); al = math.acos(max(-1, min(1, k)))
    for sg in (1, -1):
        a = phi + sg * al
        n1 = np.array([math.cos(a), math.sin(a)]); n2 = s1 * s2 * n1
        c1, c2 = p1 + r1 * n1, p2 + r2 * n2
        t1 = s1 * np.array([n1[1], -n1[0]])
        if (c2 - c1) @ t1 > 0: return n1, n2, c1, c2
    raise RuntimeError('no chain tangent')

def chain_path():
    """The chain's pitch line round the ring, the lower jockey, the upper jockey and the gear's cog (the derailleur's
    S), sampled one link per pitch: game-space points."""
    up, lo = derailleur_pulleys()
    r_pul = 12 * CHAIN_PITCH / (2 * math.pi)
    uv = lambda q: np.array([-q[2], q[1]])          # (forward, up)
    circles = [  # (centre (u, v), radius, sense, x)
        (uv(BB), RING_R, 1, CHAINLINE), (uv(lo), r_pul, 1, GEAR_X), (uv(up), r_pul, -1, GEAR_X), (uv(RA), cog_pitch_r(GEAR_TEETH), 1, GEAR_X)]
    n = len(circles)
    runs = [tangent2(circles[i][0], circles[i][1], circles[i][2], circles[(i + 1) % n][0], circles[(i + 1) % n][1], circles[(i + 1) % n][2]) for i in range(n)]
    pts = []
    for i in range(n):
        c, r, s, x = circles[i]
        n_in = runs[i - 1][1]; n_out = runs[i][0]
        a_in, a_out = math.atan2(n_in[1], n_in[0]), math.atan2(n_out[1], n_out[0])
        sw = ((a_in - a_out) * s) % (2 * math.pi)
        k = max(2, int(sw / math.radians(4)))
        for t in np.linspace(0, 1, k + 1):
            a = a_in - s * sw * t
            q = c + r * np.array([math.cos(a), math.sin(a)])
            pts.append((q[0], q[1], x))
        # the run to the next circle (x from this circle's to the next's)
        c1, c2 = runs[i][2], runs[i][3]; x2 = circles[(i + 1) % n][3]
        for t in np.linspace(0, 1, 12)[1:-1]:
            q = c1 + (c2 - c1) * t
            pts.append((q[0], q[1], x + (x2 - x) * t))
    P = np.array([[x, v, -u] for u, v, x in pts])
    seg = np.linalg.norm(np.roll(P, -1, 0) - P, axis=1)
    L = seg.sum()
    N = int(round(L / CHAIN_PITCH / 3)) * 2      # (a sample every 1.5 links: its waists suggest the links)
    cum = np.concatenate([[0], np.cumsum(seg)])
    Pc = np.vstack([P, P[:1]])
    s = np.linspace(0, L, N, endpoint=False)
    out = np.column_stack([np.interp(s, cum, Pc[:, k]) for k in range(3)])
    return out, L

def build_chain():
    p = part('chain', BB)
    P, L = chain_path()
    n = len(P)
    T = np.roll(P, -1, 0) - np.roll(P, 1, 0); T /= np.linalg.norm(T, axis=1)[:, None]
    rings_ = []
    for i in range(n):
        A = unit(X - T[i] * (X @ T[i])); B = np.cross(T[i], A)
        hw, hh = (0.0029, 0.0043) if i % 2 == 0 else (0.0026, 0.0033)
        rings_.append(np.array([P[i] + A * hw + B * hh, P[i] - A * hw + B * hh, P[i] - A * hw - B * hh, P[i] + A * hw - B * hh]))
    p.add(skin(rings_, closed=True), 'Chain')
    return p, P, L

# ----------------------------------------------------------------------------------------------------- THE RIDER
def rider_joints():
    """The rider standing beside the bike in the neutral pose (every segment as built): each joint, game space."""
    ank = RD['ankleHeight']; knee = ank + RD['shin']; hip = knee + RD['thigh']
    sh = hip + RD['spine']; nk = sh + RD['neck']
    J = {'r_torso': V(RIDER_X, hip, 0), 'r_head': V(RIDER_X, nk, 0)}
    for s, k in ((-1, 'l'), (1, 'r')):
        J[f'r_upperarm_{k}'] = V(RIDER_X + s * RD['shoulderHalfWidth'], sh, 0)
        J[f'r_forearm_{k}'] = V(RIDER_X + s * RD['shoulderHalfWidth'], sh - RD['upperArm'], 0)
        J[f'r_thigh_{k}'] = V(RIDER_X + s * RD['hipHalfWidth'], hip, 0)
        J[f'r_shin_{k}'] = V(RIDER_X + s * RD['hipHalfWidth'], knee, 0)
        J[f'r_foot_{k}'] = V(RIDER_X + s * RD['hipHalfWidth'], ank, 0)
    return J

def limb(o, secs, m=14, dome0=0.0, dome1=0.0, dk=2, cap0='flat', cap1='flat', expo=2.0):
    """A segment along −y from o: secs = [(y, rx, rz, cz)] (z the front/back offset); rounded (domed) ends make the
    joints' overlapping spheres."""
    rings_ = []
    y0, rx0, rz0, cz0 = secs[0]; yn, rxn, rzn, czn = secs[-1]
    if dome0 > 0:
        rings_.append(o + V(0, y0 + dome0, cz0))
        for j in range(dk, 0, -1):
            f = (math.pi / 2) * j / (dk + 1)
            rings_.append(ring(o + V(0, y0 + dome0 * math.sin(f), cz0), X, Z, rx0 * math.cos(f), rz0 * math.cos(f), m, expo))
    for y, rx, rz, cz in secs: rings_.append(ring(o + V(0, y, cz), X, Z, rx, rz, m, expo))   # (X × Z = −y)
    if dome1 > 0:
        for j in range(1, dk + 1):
            f = (math.pi / 2) * j / (dk + 1)
            rings_.append(ring(o + V(0, yn - dome1 * math.sin(f), czn), X, Z, rxn * math.cos(f), rzn * math.cos(f), m, expo))
        rings_.append(o + V(0, yn - dome1, czn))
    return skin(rings_, cap0='none' if dome0 > 0 else cap0, cap1='none' if dome1 > 0 else cap1)

def trunk(o, secs, m=18, pole0=None, pole1=None, cap0='flat', cap1='flat', expo=2.0):
    """Like limb but UP along +y (the torso, the neck): rings counter-clockwise about +y."""
    rings_ = [o + V(*pole0)] if pole0 is not None else []
    for y, rx, rz, cz in secs: rings_.append(ring(o + V(0, y, cz), Z, X, rz, rx, m, expo))   # (Z × X = +y)
    if pole1 is not None: rings_.append(o + V(*pole1))
    return skin(rings_, cap0='none' if pole0 is not None else cap0, cap1='none' if pole1 is not None else cap1)

def build_rider():
    J = rider_joints()
    thigh, shin, ua, fa = RD['thigh'], RD['shin'], RD['upperArm'], RD['forearm']
    # THE TORSO: pelvis in the shorts, the jersey over it, shoulders, the neck
    o = J['r_torso']
    p = part('r_torso', o)
    sp = RD['spine']
    p.add(trunk(o, [(-0.130, 0.075, 0.060, 0.018), (-0.105, 0.118, 0.085, 0.016), (-0.06, 0.158, 0.105, 0.018), (0.0, 0.172, 0.112, 0.012),
                    (0.07, 0.160, 0.104, 0.004), (0.12, 0.150, 0.099, 0.0)], 18, pole0=(0, -0.142, 0.018)), 'Shorts')
    p.add(trunk(o, [(0.05, 0.150, 0.098, 0.004), (0.055, 0.166, 0.110, 0.004), (0.12, 0.152, 0.104, 0.0), (0.22, 0.150, 0.105, -0.008),
                    (0.32, 0.160, 0.112, -0.006), (0.40, 0.163, 0.110, 0.0), (sp - 0.04, 0.156, 0.098, 0.008), (sp + 0.005, 0.128, 0.080, 0.014),
                    (sp + 0.035, 0.075, 0.058, 0.016), (sp + 0.048, 0.055, 0.050, 0.016)], 18), 'Jersey')
    for s in (-1, 1):
        p.add(ellipsoid(o + V(s * 0.140, sp - 0.035, 0.008), (0.040, 0.038, 0.048), None, 12, 8), 'Jersey')
    nk = sp + RD['neck']
    p.add(trunk(o, [(sp, 0.050, 0.050, 0.016), (nk - 0.01, 0.047, 0.048, 0.012), (nk + 0.02, 0.046, 0.047, 0.010)], 12, pole1=(0, nk + 0.05, 0.008)), 'Skin')
    # THE HEAD: neck, skull, jaw, nose; the trail helmet with its visor; goggles and their strap
    o = J['r_head']
    p = part('r_head', o)
    hd = RD['head']
    p.add(trunk(o, [(-0.05, 0.049, 0.050, 0.012), (0.02, 0.047, 0.048, 0.008), (0.08, 0.048, 0.052, 0.0)], 12), 'Skin')
    skull_c, skull_r = V(0, hd - 0.10, 0.0), V(0.077, 0.10, 0.096)
    p.add(ellipsoid(o + skull_c, skull_r, None, 16, 10), 'Skin')
    p.add(ellipsoid(o + V(0, hd * 0.31, -0.032), (0.057, 0.05, 0.058), None, 12, 8), 'Skin')
    p.add(hull([o + V(0, hd * 0.59, -0.092), o + V(0.009, hd * 0.46, -0.090), o + V(-0.009, hd * 0.46, -0.090), o + V(0, hd * 0.455, -0.111), o + V(0, hd * 0.5, -0.08)]), 'Skin')
    # the helmet shell: an ellipsoid over the skull, its rim low at the back, over the brows at the front
    hc, hr = o + V(0, hd - 0.096, 0.006), V(0.106, 0.119, 0.130)
    def y_rim(psi): return o[1] + (0.105 + 0.050 * math.cos(psi) + 0.013 * math.cos(2 * psi)) * hd / 0.23
    m = 20; ne = 6
    psis = [2 * math.pi * k / m for k in range(m)]
    def shell_pt(psi, t, scale=1.0):
        th_rim = math.acos(max(-1, min(1, (y_rim(psi) - hc[1]) / hr[1])))
        th = th_rim * t
        return hc + V(hr[0] * scale * math.sin(th) * math.sin(psi), hr[1] * (1 - (1 - scale) * 0.6) * math.cos(th), -hr[2] * scale * math.sin(th) * math.cos(psi))
    rings_ = [hc + V(0, hr[1], 0)]
    for j in range(1, ne + 1): rings_.append(np.array([shell_pt(ps, j / ne) for ps in psis]))
    rings_.append(np.array([shell_pt(ps, 1.0, 0.84) for ps in psis]))
    for j in range(ne - 1, 0, -2): rings_.append(np.array([shell_pt(ps, j / ne, 0.84) for ps in psis]))
    rings_.append(hc + V(0, hr[1] * 0.9, 0))
    p.add(skin(rings_), 'Helmet')
    # the visor: a plate out from the front rim, tipped up
    vs = []
    for ps in np.linspace(-0.95, 0.95, 11):
        rim = shell_pt(ps, 1.0, 1.0)
        outw = unit(V(math.sin(ps), 0, -math.cos(ps)))
        a0 = rim + Y * 0.004 - outw * 0.004; a1 = rim + outw * 0.048 + Y * 0.016 * (1.0 - 0.3 * abs(ps))
        vs.append(np.array([a0 + Y * 0.002, a1 + Y * 0.002, a1 - Y * 0.002, a0 - Y * 0.002]))
    p.add(skin(vs[::-1]), 'Pads')
    # vents: three grooves front to back over the crown
    for ps in (-0.42, 0.0, 0.42):
        P = np.array([shell_pt(ps, t, 1.0) for t in np.linspace(0.22, 0.72, 5)])
        p.add(sweep(P, 0.0055, 0.0055, 6, None, 2.0, dome0=0.004, dome1=0.004, dk=1), 'Pads')
    # the goggles: the frame (out from the face to the helmet's flanks, where the strap takes over), the lens, the
    # strap round the back of the helmet
    gy0, gy1 = o[1] + hd * 0.53, o[1] + hd * 0.69
    def band(psi0, psi1, n, rad, y0, y1, th):
        """A strip round the head from heights y0 to y1, th thick; rad(ψ) = (rx, rz, cz) of its outer face."""
        rs = []
        for ps in np.linspace(psi0, psi1, n):
            rx, rz, cz = rad(ps)
            out = o + V(rx * math.sin(ps), 0, -rz * math.cos(ps) + cz)
            inn = o + V((rx - th) * math.sin(ps), 0, -(rz - th) * math.cos(ps) + cz)
            rs.append(np.array([V(out[0], y1, out[2]), V(out[0], y0, out[2]), V(inn[0], y0, inn[2]), V(inn[0], y1, inn[2])]))
        return skin(rs[::-1])     # (each section runs clockwise about the way ψ grows: walked the other way, it faces out)
    face, flank = V(0.086, 0.106, 0.0), V(hr[0] + 0.004, hr[2] + 0.004, hc[2] - o[2])
    def goggle_r(ps):
        t = min(1.0, max(0.0, (abs(ps) - 0.75) / 0.6)); t = t * t * (3 - 2 * t)
        return face + (flank - face) * t
    p.add(band(-1.62, 1.62, 17, goggle_r, gy0 - 0.004, gy1 + 0.004, 0.010), 'Pads')
    p.add(band(-1.05, 1.05, 13, lambda ps: V(0.090, 0.111, 0.0), gy0 + 0.002, gy1 - 0.002, 0.006), 'Lens')
    p.add(band(1.5, 2 * math.pi - 1.5, 13, lambda ps: flank, gy0 + 0.006, gy1 - 0.006, 0.006), 'Jersey')
    # THE ARMS: the sleeve, the arm; the forearm, the glove's cuff, the fist round a grip (its axis along x)
    for s, k in ((-1, 'l'), (1, 'r')):
        o = J[f'r_upperarm_{k}']
        p = part(f'r_upperarm_{k}', o)
        p.add(limb(o, [(0.0, 0.051, 0.052, 0.0), (-0.05, 0.051, 0.053, 0.002), (-0.12, 0.048, 0.049, 0.002), (-0.17, 0.050, 0.051, 0.002),
                       (-0.175, 0.042, 0.043, 0.002)], 14, dome0=0.051), 'Jersey')
        p.add(limb(o, [(-0.14, 0.042, 0.043, 0.002), (-0.22, 0.040, 0.041, 0.003), (-(ua - 0.03), 0.038, 0.040, 0.006),
                       (-ua, 0.037, 0.037, 0.003)], 14, dome1=0.037), 'Skin')
        o = J[f'r_forearm_{k}']
        p = part(f'r_forearm_{k}', o)
        p.add(limb(o, [(0.0, 0.037, 0.037, 0.003), (-0.04, 0.042, 0.043, 0.004), (-0.10, 0.040, 0.038, 0.002), (-0.17, 0.033, 0.028, 0.0),
                       (-(fa - 0.025), 0.029, 0.022, 0.0)], 14, dome0=0.037), 'Skin')
        g = o + V(0, -(fa + RD['handToGrip']), 0)
        p.add(limb(o, [(-(fa - 0.035), 0.031, 0.025, 0.0), (-(fa - 0.005), 0.031, 0.025, -0.002), (-(fa + 0.03), 0.040, 0.027, -0.006)], 14), 'Gloves')
        p.add(ellipsoid(g + V(0, -0.004, -0.007), (0.044, 0.043, GRIP_R + 0.0155), None, 14, 8, 2.6), 'Gloves')
        th = -s                                  # the thumb on the inside (the right hand's on −x)
        C = [g + V(th * 0.030, 0.045, 0.004), g + V(th * 0.040, 0.012, 0.014), g + V(th * 0.036, -0.008, 0.024)]
        P, u = spline(C, 3)
        p.add(sweep(P, 0.0115, 0.0105, 10, None, 2.0, dome0=0.006, dome1=0.010, dk=1), 'Gloves')
    # THE LEGS: baggy shorts over the thigh, the knee; the shin with its knee pad; the flat-pedal shoe
    for s, k in ((-1, 'l'), (1, 'r')):
        o = J[f'r_thigh_{k}']
        p = part(f'r_thigh_{k}', o)
        p.add(limb(o, [(0.0, 0.086, 0.090, 0.004), (-0.06, 0.087, 0.092, 0.0), (-0.16, 0.083, 0.088, -0.002), (-0.28, 0.080, 0.084, -0.003),
                       (-(thigh - 0.08), 0.080, 0.083, -0.002), (-(thigh - 0.045), 0.081, 0.084, 0.0), (-(thigh - 0.040), 0.064, 0.066, 0.0)],
                   14, dome0=0.07), 'Shorts')
        p.add(limb(o, [(-(thigh - 0.08), 0.060, 0.062, 0.0), (-(thigh - 0.03), 0.057, 0.058, 0.0), (-thigh, 0.054, 0.054, 0.0)], 14, dome1=0.054), 'Skin')
        o = J[f'r_shin_{k}']
        p = part(f'r_shin_{k}', o)
        p.add(limb(o, [(0.0, 0.054, 0.054, 0.0), (-0.07, 0.050, 0.055, 0.006), (-0.15, 0.047, 0.054, 0.012), (-0.24, 0.042, 0.046, 0.008),
                       (-0.34, 0.035, 0.038, 0.003), (-(shin - 0.03), 0.031, 0.032, 0.0), (-shin, 0.033, 0.034, 0.0)], 14, dome0=0.054, dome1=0.034), 'Skin')
        # (the pad's shell stands proud at the front and sides; its back runs clearly inside the leg — no shimmer)
        p.add(limb(o, [(0.065, 0.052, 0.044, -0.008), (0.045, 0.063, 0.050, -0.014), (0.0, 0.065, 0.058, -0.016), (-0.05, 0.062, 0.058, -0.012),
                       (-0.11, 0.057, 0.058, -0.004), (-0.17, 0.052, 0.054, 0.002)], 14), 'Pads')
        o = J[f'r_foot_{k}']
        p = part(f'r_foot_{k}', o)
        ys = -RD['ankleHeight']
        heel = 0.06; toe = heel - RD['footLength']
        secs = [(heel, -0.03, 0.025), (heel - 0.008, 0.010, 0.036), (0.030, 0.042, 0.042), (0.0, 0.045, 0.044), (-0.040, 0.020, 0.046),
                (-0.090, -0.012, 0.050), (RD['ballOfFoot'][2], -0.020, 0.052), (-0.160, -0.030, 0.050), (toe + 0.015, -0.040, 0.042), (toe, -0.052, 0.028)]
        rs = []
        for z, yt, hw in secs:
            y0 = ys + 0.004
            rs.append(ring(o + V(0, (y0 + yt) / 2, z), Y, X, (yt - y0) / 2, hw, 14, 2.8))   # (Y × X = −z: toe-ward)
        p.add(skin(rs), 'Shoes')
        rs = [ring(o + V(0, ys + 0.006, z), Y, X, 0.006, hw + 0.003, 8, 4.0) for z, yt, hw in secs[1:]]
        rs = [ring(o + V(0, ys + 0.006, heel - 0.002), Y, X, 0.006, 0.028, 8, 4.0)] + rs + [ring(o + V(0, ys + 0.006, toe - 0.002), Y, X, 0.006, 0.026, 8, 4.0)]
        p.add(skin(rs), 'Pads')

# ===================================================================================================== build
def build_all():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    make_materials()
    _, DT = build_frame()
    build_steer()
    _, arch = build_lowers()
    build_wheels()
    build_swingarm()
    build_shock()
    build_crank()
    build_pedals()
    _, CHP, CHL = build_chain()
    build_rider()
    return DT, arch, CHP, CHL

def to_blender(p, col):
    v = np.vstack(p.verts) - p.origin
    vb = np.column_stack([v[:, 0], -v[:, 2], v[:, 1]])
    me = bpy.data.meshes.new(p.name)
    me.from_pydata(vb.tolist(), [], p.faces)
    order = []
    for m in p.mats:
        if m not in order: order.append(m)
    for m in order: me.materials.append(MATS[m])
    me.polygons.foreach_set('material_index', [order.index(m) for m in p.mats])
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(40))
    ob = bpy.data.objects.new(p.name, me)
    ob.location = (p.origin[0], -p.origin[2], p.origin[1])
    col.objects.link(ob)
    return ob

ORDER = ['frame', 'steer', 'fork_lowers', 'wheel_front', 'wheel_rear', 'swingarm', 'shock_body', 'shock_shaft', 'crank', 'pedal_r', 'pedal_l', 'chain',
         'r_torso', 'r_head', 'r_upperarm_l', 'r_upperarm_r', 'r_forearm_l', 'r_forearm_r', 'r_thigh_l', 'r_thigh_r', 'r_shin_l', 'r_shin_r', 'r_foot_l', 'r_foot_r']

# ===================================================================================================== checks
def checks(DT, arch, CHP, CHL):
    """The geometry's own consistency, and the clearances the model depends on (the report)."""
    out = []
    def say(s): out.append(s); log('  ' + s)
    log('geometry checks:')
    crown_from_axle = FA + AX * ATC - FWD * OFFSET
    say(f'crown = frontAxle + axleToCrown·axis − offset·perp: off by {np.linalg.norm(crown_from_axle - CROWN) * 1000:.2f} mm')
    for nm, q in (('headTubeBottom', HTB), ('headTubeTop', HTT), ('steererTop', STT), ('barClamp', BARCLAMP)):
        r = q - CROWN; s = r @ AX; perp = np.linalg.norm(r - AX * s)
        say(f'{nm}: {s * 1000:.1f} mm up the axis from the crown, {perp * 1000:.1f} mm off it')
    say(f'stem: the bar clamp {np.linalg.norm(BARCLAMP - (CROWN + AX * ((BARCLAMP - CROWN) @ AX))) * 1000:.1f} mm ahead of the steerer (stem.length {G["stem"]["length"] * 1000:.0f})')
    say(f'grips: {(GRIPS[1][1] - BARCLAMP[1]) * 1000:.1f} mm above the clamp (bar.rise {BAR["rise"] * 1000:.0f}), {(GRIPS[1][2] - BARCLAMP[2]) * 1000:.1f} mm behind; '
        f'grip centres {GRIPS[1][0] * 2 * 1000:.0f} mm apart, bar {BAR_W * 1000:.0f}')
    r = SADDLE_TOP - BB
    say(f'saddleTop: {np.linalg.norm(r - STDIR * (r @ STDIR)) * 1000:.2f} mm off the {SEAT["seatTubeAngleDeg"]}° seat line, {T_SADDLE * 1000:.0f} mm up it')
    say(f'shock: eye to eye {np.linalg.norm(SSM - SFM) * 1000:.1f} mm (JSON {EYE2EYE * 1000:.0f})')
    Rm = Rx(SWING_MAX)
    sm = PIVOT + Rm @ (SSM - PIVOT); ra = PIVOT + Rm @ (RA - PIVOT)
    say(f'at swingarmMaxRotation: shock {np.linalg.norm(sm - SFM) * 1000:.1f} mm (eye to eye − stroke = {(EYE2EYE - STROKE) * 1000:.1f}); '
        f'rear axle up {(ra[1] - RA[1]) * 1000:.1f} mm (wheelTravel {WHEEL_TRAVEL * 1000:.1f})')
    # fork
    s_bot = -(ATC - LOWERS_L) - STAN_OVERLAP
    say(f'fork: stanchions {STAN_OVERLAP * 1000:.0f} mm into the lowers extended, {(STAN_OVERLAP + TRAVEL) * 1000:.0f} mm at full travel; '
        f'their ends {(s_bot + ATC - TRAVEL - 0.044) * 1000:.0f} mm above the lowers\' foot then')
    s_cr_bottom = ATC - 0.030
    say(f'fork: exposed stanchion at full travel {(s_cr_bottom - LOWERS_L - TRAVEL) * 1000:.0f} mm; arch top {(arch[0] + arch[2] + TRAVEL) * 1000:.0f} mm '
        f'up the axis from the rest axle at full travel (crown underside {s_cr_bottom * 1000:.0f}, the arch {(arch[1] + OFFSET) * 1000:.0f} mm ahead of the axis)')
    fa_c = FA + AX * TRAVEL
    say(f'front tyre at full travel: {(np.linalg.norm(CROWN - fa_c) - R_TYRE) * 1000:.0f} mm from the crown point; '
        f'{min(np.linalg.norm(DT[0] - fa_c, axis=1) - DT[2] - R_TYRE) * 1000:.0f} mm from the down tube')
    # rear tyre vs seat tube over the travel
    worst = 9
    for a in np.linspace(0, SWING_MAX, 13):
        ra_ = PIVOT + Rx(a) @ (RA - PIVOT); r_ = ra_ - BB
        worst = min(worst, np.linalg.norm(r_ - STDIR * (r_ @ STDIR)) - R_TYRE - 0.0186)
    say(f'rear tyre to the seat tube, worst over the travel: {worst * 1000:.0f} mm')
    # the yoke vs the seat tube over the travel
    worst = 9
    for s in (-1, 1):
        P, u = yoke_path(s); Q, u2 = seatstay_path(s)
        pts = np.vstack([P, Q[-6:]])
        for a in np.linspace(0, SWING_MAX, 13):
            q = (pts - PIVOT) @ Rx(a).T + PIVOT
            t = (q - BB) @ STDIR
            for qi, ti in zip(q, t):
                if 0.2 < ti < 0.46:
                    d = qi - st_pt(ti)
                    worst = min(worst, abs(d[0]) - 0.009 - 0.0186 if np.hypot(d[1], d[2]) < 0.035 else 9)
    say(f'the yoke arms beside the seat tube, worst over the travel: {worst * 1000:.1f} mm')
    # shock overlap
    say(f'shock: the shaft {(SHAFT_L - (EYE2EYE - CAN_END)) * 1000:.0f} mm into the body extended, {(SHAFT_L - (EYE2EYE - STROKE - CAN_END)) * 1000:.0f} mm at full stroke; '
        f'its end {(EYE2EYE - STROKE - SHAFT_L - 0.020) * 1000:.0f} mm short of the body\'s head; the can {(EYE2EYE - STROKE - 0.018 - CAN_END) * 1000:.0f} mm short of the eyelet')
    # chain vs drive-side chainstay
    # (each chain link in the chainstay's own section frame: its distance out from the superellipse section)
    P, u = chainstay_path(1)
    rb = along(u, [0.017, 0.0155, 0.0145, 0.0125, 0.011, 0.010]); raa = along(u, [0.0095, 0.0095, 0.0095, 0.009, 0.0082, 0.0078])
    T_, A_, B_ = path_frames(P, X)
    worst = 9
    for q in CHP:
        i = int(np.argmin(np.linalg.norm(P - q, axis=1)))
        dq = q - P[i]
        if abs(dq @ T_[i]) > 0.012: continue
        a_, b_ = dq @ A_[i], dq @ B_[i]; rho = math.hypot(a_, b_)
        r_sec = 1 / ((abs(a_ / rho) / raa[i]) ** 2.6 + (abs(b_ / rho) / rb[i]) ** 2.6) ** (1 / 2.6)
        half = 0.0029 * abs(a_ / rho) + 0.0043 * abs(b_ / rho)      # (the chain's own half-size that way)
        worst = min(worst, rho - r_sec - half)
    say(f'chain ({GEAR_TEETH}T, gear {GEAR}, {CHL * 1000:.0f} mm, {len(CHP)} links) to the drive-side chainstay: {worst * 1000:.1f} mm at the closest')
    bbm = PIVOT + Rm @ (BB - PIVOT)
    say(f'the chain swung with the swingarm about the pivot: its wrap moves {np.linalg.norm(bbm - BB) * 1000:.0f} mm off the chainring at full travel')
    return out

# ===================================================================================================== export + verify
def export(objs):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_normals=True, export_texcoords=False, export_tangents=False, export_materials='EXPORT',
                              export_vertex_color='NONE', export_attributes=False, export_cameras=False, export_lights=False, export_extras=False)
    log(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.1f} kB')

def expected_origins():
    E = {'frame': V(0, 0, 0), 'steer': CROWN, 'fork_lowers': FA, 'wheel_front': FA, 'wheel_rear': RA, 'swingarm': PIVOT, 'shock_body': SFM,
         'shock_shaft': SSM, 'crank': BB, 'pedal_r': BB + V(PEDAL_X, 0, -CRANK_L), 'pedal_l': BB + V(-PEDAL_X, 0, CRANK_L), 'chain': BB}
    E.update(rider_joints())
    return E

def verify():
    b = open(OUT, 'rb').read()
    _, _, length = struct.unpack_from('<III', b, 0)
    off, chunks = 12, {}
    while off < length:
        clen, ctype = struct.unpack_from('<II', b, off)
        chunks[ctype] = b[off + 8: off + 8 + clen]; off += 8 + clen
    J = json.loads(chunks[0x4E4F534A])
    E = expected_origins()
    log('GLB read back:')
    bad, tri_bike, tri_rider = [], 0, 0
    scene_nodes = set(J['scenes'][J.get('scene', 0)]['nodes'])
    lines = []
    for i, n in enumerate(J['nodes']):
        nm = n.get('name')
        t = V(n.get('translation', [0, 0, 0])); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
        mesh = J['meshes'][n['mesh']] if 'mesh' in n else None
        tris = sum(J['accessors'][pr['indices']]['count'] // 3 for pr in mesh['primitives']) if mesh else 0
        mats = [J['materials'][pr['material']]['name'] for pr in mesh['primitives']] if mesh else []
        lo = np.min([J['accessors'][pr['attributes']['POSITION']]['min'] for pr in mesh['primitives']], 0) if mesh else None
        hi = np.max([J['accessors'][pr['attributes']['POSITION']]['max'] for pr in mesh['primitives']], 0) if mesh else None
        err = np.linalg.norm(t - E[nm]) if nm in E else float('nan')
        rot_ok = np.allclose(q, [0, 0, 0, 1], atol=1e-6); sc_ok = np.allclose(s, [1, 1, 1], atol=1e-6)
        ok = nm in E and err < 1e-3 and rot_ok and sc_ok and 'children' not in n and i in scene_nodes and mesh and mesh['name'] == nm
        if not ok: bad.append(nm)
        if nm.startswith('r_'): tri_rider += tris
        else: tri_bike += tris
        line = (f'{nm:14s} t=({t[0]:+.4f}, {t[1]:+.4f}, {t[2]:+.4f}) Δ={err * 1000:.3f} mm  rot={"identity" if rot_ok else q}  scale={"1" if sc_ok else s}  '
                f'{tris:5d} tris  local x[{lo[0]:+.3f},{hi[0]:+.3f}] y[{lo[1]:+.3f},{hi[1]:+.3f}] z[{lo[2]:+.3f},{hi[2]:+.3f}]  {",".join(mats)}  {"OK" if ok else "** BAD **"}')
        lines.append(line); log('  ' + line)
    missing = [p for p in ORDER if p not in [n.get('name') for n in J['nodes']]]
    log(f'  {len(J["nodes"])} nodes (flat: {all("children" not in n for n in J["nodes"])}), bike {tri_bike} tris, rider {tri_rider} tris, '
        f'materials: {", ".join(m["name"] for m in J["materials"])}')
    log(f'  VERIFY {"PASSED" if not bad and not missing else "FAILED: " + ", ".join(bad + missing)}')
    for m in J['materials']:
        pbr = m.get('pbrMetallicRoughness', {})
        log(f'    {m["name"]:12s} base {[round(c, 4) for c in pbr.get("baseColorFactor", [1, 1, 1, 1])[:3]]} (linear)  roughness {pbr.get("roughnessFactor", 1):.2f}  metallic {pbr.get("metallicFactor", 1):.1f}')
    return not bad and not missing

# ===================================================================================================== the game's poses
# (Bike.ts posePartsFrom / poseRider, ported: the previews pose the parts exactly as the game will)
def bone_basis(down, front):
    y = unit(-np.asarray(down, float))
    z = np.asarray(front, float) - y * (np.asarray(front, float) @ y)
    if np.linalg.norm(z) < 1e-6: z = Z if abs(y[2]) < 0.9 else X
    z = unit(-z); x = np.cross(y, z)
    return np.column_stack([x, y, z])

def ik(a, t, l1, l2, pole):
    d0 = t - a; dl = np.linalg.norm(d0)
    d = min(l1 + l2 - 1e-4, max(abs(l1 - l2) + 1e-4, dl))
    u = d0 / dl if dl > 1e-6 else V(0, -1, 0)
    w = pole - u * (pole @ u)
    w = unit(np.cross(u, X)) if np.linalg.norm(w) < 1e-6 else unit(w)
    ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d); sa = math.sqrt(max(0, 1 - ca * ca))
    return a + u * ca * l1 + w * sa * l1

def game_poses(steer=0.0, fork=0.0, swing=0.0, crank=0.0, crouch=0.0, shift=0.0, stand=0.0, rider=True):
    P = {}
    Rs = axis_rot(AX, -steer); ts = CROWN - Rs @ CROWN
    ap = lambda R, t, v: R @ v + t
    P['frame'] = (np.eye(3), V(0, 0, 0))
    P['steer'] = (Rs, ap(Rs, ts, CROWN))
    axle = FA + AX * fork
    P['fork_lowers'] = (Rs, ap(Rs, ts, axle)); P['wheel_front'] = (Rs, ap(Rs, ts, axle))
    Rw = Rx(swing)
    P['swingarm'] = (Rw, PIVOT); P['chain'] = (Rw, PIVOT + Rw @ (BB - PIVOT)); P['wheel_rear'] = (np.eye(3), PIVOT + Rw @ (RA - PIVOT))
    sm = PIVOT + Rw @ (SSM - PIVOT); d = sm - SFM; ang = math.atan2(d[1], d[2])
    P['shock_body'] = (Rx(ang), SFM); P['shock_shaft'] = (Rx(ang), sm)
    Rc = Rx(crank); P['crank'] = (Rc, BB)
    arm = Rc @ V(0, 0, -CRANK_L)
    pedR = BB + V(PEDAL_X + arm[0], arm[1], arm[2]); pedL = BB + V(-PEDAL_X - arm[0], -arm[1], -arm[2])
    P['pedal_r'] = (np.eye(3), pedR); P['pedal_l'] = (np.eye(3), pedL)
    info = {}
    if rider:
        hip = V(RD['seatedHip'])
        standHip = V(0, BB[1] + 0.64, BB[2] + 0.06)
        hip = hip + (standHip - hip) * stand + V(0, -0.17 * crouch, 0.04 * crouch) + V(0, -0.02 * abs(shift), -0.11 * shift)
        grips = [Rs @ g + ts for g in GRIPS]; gm = (grips[0] + grips[1]) / 2
        reach = (RD['upperArm'] + RD['forearm'] + RD['handToGrip']) * (0.86 - 0.08 * crouch)
        sat = lambda a: hip + V(0, math.cos(a), -math.sin(a)) * RD['spine']
        lo, hi = 0.05, 1.45
        for _ in range(16):
            mm = (lo + hi) / 2; sh = sat(mm)
            dd = math.hypot(np.linalg.norm(sh - gm), abs(grips[1][0]) - RD['shoulderHalfWidth'])
            if dd > reach: lo = mm
            else: hi = mm
        lean = (lo + hi) / 2
        Rt = Rx(lean); P['r_torso'] = (Rt, hip)
        up = V(0, math.cos(lean), -math.sin(lean))
        P['r_head'] = (axis_rot(Y, -steer * 0.35) @ Rx(lean * 0.35), hip + up * (RD['spine'] + RD['neck']))
        info['lean'] = math.degrees(lean)
        for k, x, g, ped in (('l', -1, grips[0], pedL), ('r', 1, grips[1], pedR)):
            sh = Rt @ V(x * RD['shoulderHalfWidth'], RD['spine'], 0) + hip
            el = ik(sh, g, RD['upperArm'], RD['forearm'] + RD['handToGrip'], V(x * 0.8, -0.35, 0.6))
            P[f'r_upperarm_{k}'] = (bone_basis(el - sh, V(-x * 0.5, 0, -1)), sh)
            P[f'r_forearm_{k}'] = (bone_basis(g - el, V(0, 1, -0.3)), el)
            hj = hip + V(x * RD['hipHalfWidth'], 0, 0)
            ball = ped + V(0, PEDAL_SIZE[1] * 0.5 + 0.004, 0)
            cs = crank + (0 if x > 0 else math.pi)
            heel = -0.12 * math.sin(cs) - 0.05
            Rf = Rx(-heel)
            ankle = ball - Rf @ V(RD['ballOfFoot'])
            P[f'r_foot_{k}'] = (Rf, ankle)
            knee = ik(hj, ankle, RD['thigh'], RD['shin'], V(x * 0.18, 0.25, -1))
            P[f'r_thigh_{k}'] = (bone_basis(knee - hj, V(x * 0.15, 0.2, -1)), hj)
            P[f'r_shin_{k}'] = (bone_basis(ankle - knee, V(x * 0.1, -0.1, -1)), knee)
            dl = np.linalg.norm(ankle - hj); da = np.linalg.norm(g - sh)
            kneeang = math.degrees(math.acos(max(-1, min(1, (RD['thigh'] ** 2 + RD['shin'] ** 2 - dl * dl) / (2 * RD['thigh'] * RD['shin'])))))
            info[k] = (dl / (RD['thigh'] + RD['shin']), kneeang, da / (RD['upperArm'] + RD['forearm'] + RD['handToGrip']))
    return P, info

C_G2B = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)
def to_bl_matrix(R, t):
    Rb = C_G2B @ R @ C_G2B.T; tb = C_G2B @ t
    M = Matrix.Identity(4)
    for i in range(3):
        for j in range(3): M[i][j] = Rb[i, j]
        M[i][3] = tb[i]
    return M

# ===================================================================================================== previews
def setup_scene(scn):
    scn.render.engine = 'BLENDER_WORKBENCH'
    sh = scn.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'
    sh.show_shadows = True; sh.shadow_intensity = 0.45
    sh.show_cavity = True; sh.cavity_type = 'WORLD'
    sh.show_backface_culling = True
    sh.show_object_outline = False
    scn.display.light_direction = (0.45, -0.55, 0.70)
    scn.display.render_aa = '8'
    scn.view_settings.view_transform = 'Standard'
    scn.render.resolution_x, scn.render.resolution_y = 1600, 1000
    if scn.world is None: scn.world = bpy.data.worlds.new('w_' + scn.name)
    scn.world.color = (0.55, 0.6, 0.66)
    g = bpy.data.materials.get('Ground') or bpy.data.materials.new('Ground')
    g.diffuse_color = (*srgb_to_linear('#9C9789'), 1)
    me = bpy.data.meshes.new('ground_' + scn.name)
    me.from_pydata([(-8, -8, 0), (8, -8, 0), (8, 8, 0), (-8, 8, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(g)
    ob = bpy.data.objects.new('ground_' + scn.name, me); scn.collection.objects.link(ob)
    cam = bpy.data.objects.new('cam_' + scn.name, bpy.data.cameras.new('cam_' + scn.name)); scn.collection.objects.link(cam)
    scn.camera = cam
    return cam

def shoot(scn, cam, name, loc, target, lens=50, ortho=None, size=(1600, 1000)):
    """loc / target in GAME space."""
    lb, tb = Vector(C_G2B @ V(loc)), Vector(C_G2B @ V(target))
    cam.location = lb
    cam.rotation_euler = (tb - lb).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    else:
        cam.data.type = 'PERSP'; cam.data.lens = lens
    cam.data.clip_start = 0.01
    scn.render.resolution_x, scn.render.resolution_y = size
    scn.render.filepath = os.path.join(PREVIEW, name + '.png')
    bpy.ops.render.render(write_still=True, scene=scn.name)
    log('  preview', scn.render.filepath)

def posed_scene(name, objs, poses):
    scn = bpy.data.scenes.new(name)
    cam = setup_scene(scn)
    for o in objs:
        if o.name not in poses: continue
        c = o.copy(); c.name = f'{o.name}.{name}'
        scn.collection.objects.link(c)
        R, t = poses[o.name]
        c.matrix_world = to_bl_matrix(R, t)
    return scn, cam

def previews(objs):
    os.makedirs(PREVIEW, exist_ok=True)
    scn = bpy.context.scene
    cam = setup_scene(scn)
    riders = [o for o in objs if o.name.startswith('r_')]
    for o in riders: o.hide_render = True        # (the bike alone first)
    shoot(scn, cam, '01_side_right', (4.0, 0.62, 0.0), (0, 0.62, 0.0), ortho=2.35)
    shoot(scn, cam, '02_side_left', (-4.0, 0.62, 0.0), (0, 0.62, 0.0), ortho=2.35)
    shoot(scn, cam, '03_threequarter_front', (2.5, 1.45, -2.9), (0, 0.55, -0.05), 50)
    shoot(scn, cam, '04_threequarter_rear', (2.3, 1.5, 3.0), (0, 0.5, 0.05), 50)
    shoot(scn, cam, '05_top', (0.0, 4.0, 0.01), (0, 0, 0), ortho=2.4)
    shoot(scn, cam, '06_front', (0.0, 0.75, -4.0), (0, 0.6, 0), ortho=1.5, size=(1000, 1000))
    shoot(scn, cam, '07_close_fork', (-0.75, 0.95, -1.35), (0, 0.62, -0.45), 50)
    shoot(scn, cam, '08_close_shock_swingarm', (0.95, 0.95, 0.55), (0.0, 0.52, 0.18), 50)
    shoot(scn, cam, '09_close_drivetrain', (0.95, 0.42, 0.75), (0.0, 0.34, 0.42), 45)
    shoot(scn, cam, '10_close_cockpit', (0.55, 1.45, 0.35), (0.0, 1.0, -0.27), 45)
    for o in riders: o.hide_render = False
    shoot(scn, cam, '11_bike_and_rider', (3.6, 1.6, -3.6), (0.65, 0.8, 0), 45)
    shoot(scn, cam, '12_rider_front', (RIDER_X, 1.05, -3.2), (RIDER_X, 0.95, 0), 50, size=(1000, 1200))
    shoot(scn, cam, '13_rider_side', (RIDER_X + 3.2, 1.0, 0.0), (RIDER_X, 0.95, 0), 50, size=(1000, 1200))
    # THE WORKED POSE: full fork travel, full rear travel (the shock at full stroke), 30° of steer, the cranks at 90°
    P, _ = game_poses(steer=math.radians(30), fork=TRAVEL, swing=SWING_MAX, crank=math.pi / 2, rider=False)
    ws, wc = posed_scene('worked', [o for o in objs if not o.name.startswith('r_')], P)
    shoot(ws, wc, '20_worked_side_right', (4.0, 0.62, 0.0), (0, 0.62, 0.0), ortho=2.35)
    shoot(ws, wc, '21_worked_side_left', (-4.0, 0.62, 0.0), (0, 0.62, 0.0), ortho=2.35)
    shoot(ws, wc, '22_worked_threequarter', (2.5, 1.45, -2.9), (0, 0.55, -0.05), 50)
    shoot(ws, wc, '23_worked_shock', (0.95, 0.95, 0.55), (0.0, 0.52, 0.18), 50)
    shoot(ws, wc, '24_worked_fork', (-0.75, 0.95, -1.35), (0, 0.62, -0.45), 50)
    shoot(ws, wc, '25_worked_top', (0.0, 4.0, 0.01), (0, 0, 0), ortho=2.4)
    shoot(ws, wc, '26_worked_drivetrain', (0.95, 0.42, 0.75), (0.0, 0.34, 0.42), 45)
    # THE RIDER ON THE BIKE, posed by the game's IK
    P, info = game_poses(crank=0.6)
    log(f'  riding: torso lean {info["lean"]:.0f}° from upright; legs reach (l, r) {info["l"][0]:.2f}, {info["r"][0]:.2f} of their length '
        f'(knees {info["l"][1]:.0f}°, {info["r"][1]:.0f}°); arms {info["l"][2]:.2f}, {info["r"][2]:.2f}')
    for th in (0.0, math.pi / 2, math.pi, 1.5 * math.pi):
        _, inf = game_poses(crank=th)
        log(f'    crank {math.degrees(th):3.0f}°: right leg {inf["r"][0]:.2f} of its length (knee {inf["r"][1]:.0f}°), left {inf["l"][0]:.2f} ({inf["l"][1]:.0f}°)')
    rs, rc = posed_scene('riding', objs, P)
    shoot(rs, rc, '30_riding_side_right', (4.0, 0.95, 0.0), (0, 0.95, 0.0), ortho=2.6)
    shoot(rs, rc, '31_riding_threequarter', (2.6, 1.8, -2.8), (0, 0.85, 0.0), 45)
    shoot(rs, rc, '32_riding_rear', (1.8, 1.9, 3.0), (0, 0.9, 0.0), 45)
    shoot(rs, rc, '33_riding_chase', (0.0, 2.3, 5.2), (0, 0.9, -0.5), 40)
    shoot(rs, rc, '36_riding_hands', (0.75, 1.35, -0.75), (0.15, 1.05, -0.27), 50)
    shoot(rs, rc, '37_riding_head', (0.9, 1.65, -1.0), (0.0, 1.55, -0.05), 50)
    P, info = game_poses(steer=math.radians(25), fork=TRAVEL * 0.7, swing=SWING_MAX * 0.7, crank=2.2, crouch=0.6, stand=1.0, shift=0.3)
    rs2, rc2 = posed_scene('riding_worked', objs, P)
    shoot(rs2, rc2, '34_riding_attack_threequarter', (2.6, 1.6, -2.8), (0, 0.85, 0.0), 45)
    shoot(rs2, rc2, '35_riding_attack_side', (-4.0, 0.95, 0.0), (0, 0.95, 0.0), ortho=2.6)

# ===================================================================================================== main
DT, ARCH, CHP, CHL = build_all()
col = bpy.context.scene.collection
objs = [to_blender(PARTS[n], col) for n in ORDER]
log('parts:')
tb = tr = 0
for n in ORDER:
    p = PARTS[n]; t = p.tris()
    if n.startswith('r_'): tr += t
    else: tb += t
    o = p.origin
    log(f'  {n:14s} {t:6d} tris  origin ({o[0]:+.4f}, {o[1]:+.4f}, {o[2]:+.4f})  {", ".join(dict.fromkeys(p.mats))}')
log(f'  bike {tb} tris, rider {tr} tris')
checks(DT, ARCH, CHP, CHL)
export(objs)
ok = verify()
if PREVIEW: previews(objs)
os.makedirs(os.path.dirname(BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND, check_existing=False, compress=True)
log(f'saved {BLEND}')
if not ok: sys.exit(1)
