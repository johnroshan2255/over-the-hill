# OVER THE HILL — the DESERT's sandstone, modelled in Blender over the terrain desert.py baked (2026-11-02, the user:
# "make this new map in Blender so you can sculpt the desert cliffs, rocks and all").
#
#   blender -b --factory-startup --python scripts/oth/desert_rocks.py -- [OUT=public/oth/desert] [PREVIEW=<dir>] [SKINS=1]
#
# Over the Hill's sandstone is STACKED SLABS: every bed a thick rounded band, bulging out of the wall, a lip over the
# ledge above, split into blocks by cracks, bed on bed up every wall, mesa and spire. The terrain already steps in
# those beds (desert.py terraces it: a 9 m riser, a ledge); here each riser gets its SKIN: for every bed, the contour
# at the riser's middle (marching squares on the 4 m grid of the beds' own height, the wobble taken out) where the
# ground is steep, and along it a profile swept — the riser's own lean plus a pillow bulge (~1.3 m), tucked in at its
# foot, a lip over the ledge — pinched in at a crack every 12–35 m. Smooth across the bulge, crisp at the lip.
# The meshes go out per 256 m CELL (the game culls them by cell and distance — Formations.ts) as formations.glb, Draco
# compressed. (They're skin: the terrain under them is the collider — they stand ≤ 1.3 m off it.)
# And the STRUCTURES (2026-11-02): the natural arch, the aqueduct, the ksar, the gorge's blocks — their own meshes in the
# same file, their colliders in structures.json.
import sys, os, math, time
import numpy as np
import bpy, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrainlib import fbm, smoothstep, blur

T0 = time.time()
ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/desert')
PREVIEW = ARGS.get('PREVIEW')
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache')
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)

HALF = 2048.0
BED = 9.0
CELL = 256.0
D = np.load(os.path.join(CACHE, 'desert.npz'))
H2 = D['H'].astype(np.float64)
PH2 = D['PHASE'].astype(np.float64)
# the 4 m grid: heights, the beds' height (the wobble taken out: a bed is a level of F), the slope
H = H2[::2, ::2]; F = H + PH2[::2, ::2]
N = H.shape[0]; C = 2 * HALF / (N - 1)
gz, gx = np.gradient(H, C)
SLOPE = np.hypot(gx, gz)
# (only the terraced rock — the walls, rims, mesas, spires: not a dune's slip face or a road's cut)
STEEP = (blur(SLOPE, 1) > 0.55) & (D['WALL'][::2, ::2] > 0.35)

def sample(A, x, z):
    fx = np.clip((x + HALF) / C, 0, N - 1.001); fz = np.clip((z + HALF) / C, 0, N - 1.001)
    i = fx.astype(int); j = fz.astype(int); tx = fx - i; tz = fz - j
    return (A[j, i] * (1 - tx) + A[j, i + 1] * tx) * (1 - tz) + (A[j + 1, i] * (1 - tx) + A[j + 1, i + 1] * tx) * tz

# ---------------------------------------------------------------------------------------------------------- contours
def contours(level):
    """Marching squares on F at `level`, only in steep cells: polylines of world (x, z)."""
    a = F[:-1, :-1] - level; b = F[:-1, 1:] - level; c = F[1:, 1:] - level; d = F[1:, :-1] - level
    code = (a > 0) * 1 + (b > 0) * 2 + (c > 0) * 4 + (d > 0) * 8
    live = (code > 0) & (code < 15) & (STEEP[:-1, :-1] | STEEP[1:, 1:])
    js, is_ = np.nonzero(live)
    # edges: 0 top (a-b), 1 right (b-c), 2 bottom (d-c), 3 left (a-d); each edge's crossing point
    def cross(j, i, e):
        if e == 0: f0, f1, p0, p1 = F[j, i], F[j, i + 1], (i, j), (i + 1, j)
        elif e == 1: f0, f1, p0, p1 = F[j, i + 1], F[j + 1, i + 1], (i + 1, j), (i + 1, j + 1)
        elif e == 2: f0, f1, p0, p1 = F[j + 1, i], F[j + 1, i + 1], (i, j + 1), (i + 1, j + 1)
        else: f0, f1, p0, p1 = F[j, i], F[j + 1, i], (i, j), (i, j + 1)
        t = (level - f0) / (f1 - f0)
        return (p0[0] + (p1[0] - p0[0]) * t) * C - HALF, (p0[1] + (p1[1] - p0[1]) * t) * C - HALF
    # (the edge's id, shared by the two cells on it)
    def eid(j, i, e):
        if e == 0: return ('h', j, i)
        if e == 2: return ('h', j + 1, i)
        if e == 1: return ('v', j, i + 1)
        return ('v', j, i)
    TABLE = {1: [(3, 0)], 2: [(0, 1)], 3: [(3, 1)], 4: [(1, 2)], 5: [(3, 0), (1, 2)], 6: [(0, 2)], 7: [(3, 2)],
             8: [(2, 3)], 9: [(2, 0)], 10: [(0, 1), (2, 3)], 11: [(2, 1)], 12: [(1, 3)], 13: [(1, 0)], 14: [(0, 3)]}
    nxt = {}; pts = {}
    for j, i in zip(js, is_):
        for e0, e1 in TABLE[int(code[j, i])]:
            k0, k1 = eid(j, i, e0), eid(j, i, e1)
            pts.setdefault(k0, cross(j, i, e0)); pts.setdefault(k1, cross(j, i, e1))
            nxt.setdefault(k0, []).append(k1); nxt.setdefault(k1, []).append(k0)
    lines = []; seen = set()
    for start in list(nxt):
        if start in seen or len(nxt[start]) != 1: continue  # (open lines from their ends first)
        line = [start]; seen.add(start); cur = start
        while True:
            nb = [k for k in nxt[cur] if k not in seen]
            if not nb: break
            cur = nb[0]; seen.add(cur); line.append(cur)
        lines.append((line, False))
    for start in list(nxt):  # (closed loops)
        if start in seen: continue
        line = [start]; seen.add(start); cur = start
        while True:
            nb = [k for k in nxt[cur] if k not in seen]
            if not nb: break
            cur = nb[0]; seen.add(cur); line.append(cur)
        lines.append((line, True))
    return [(np.array([pts[k] for k in L]), closed) for L, closed in lines if len(L) >= 4]

def resample_line(P, closed, step):
    Q = np.vstack([P, P[:1]]) if closed else P
    d = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(Q, axis=0).T))])
    if d[-1] < step * 3: return None, None
    n = max(4, int(d[-1] / step))
    t = np.linspace(0, d[-1], n, endpoint=not closed)
    R = np.stack([np.interp(t, d, Q[:, 0]), np.interp(t, d, Q[:, 1])], 1)
    # (smoothed: the grid's stair-steps out)
    for _ in range(4):
        if closed: R = (np.roll(R, 1, 0) + 2 * R + np.roll(R, -1, 0)) / 4
        else: R[1:-1] = (R[:-2] + 2 * R[1:-1] + R[2:]) / 4
    return R, t

# the PROFILE: (height above the riser's middle, bulge out of its lean) — tucked in at the foot, the pillow, a lip over
# the ledge above
# (LOW-POLY like the valley's rock — the user, 2026-11-02: "make sure the stones are low poly like in the valley": six
#  points, chunky flat facets, the rings jittered so no two facets match)
PY = np.array([-4.9, -2.7, 0.2, 2.9, 4.35, 4.55])
PB = np.array([-0.3, 0.95, 1.3, 0.9, -0.15, -2.4])
NP = len(PY)

cells = {}   # (ci, cj) → [verts list, faces list]
rng = np.random.default_rng(11)
def add_band(R, closed, level, sc=1.0):
    n = len(R)
    # downhill normal (from the ground's gradient), the riser's lean (its slope), the riser's middle in metres
    gxs, gzs = sample(gx, R[:, 0], R[:, 1]), sample(gz, R[:, 0], R[:, 1])
    # (the normal from the line itself — across its tangent, turned downhill — smooth where the gradient flips)
    tg = (np.roll(R, -1, 0) - np.roll(R, 1, 0)) if closed else np.gradient(R, axis=0)
    tg /= np.linalg.norm(tg, axis=1)[:, None] + 1e-9
    nx, nz = -tg[:, 1], tg[:, 0]
    flip = np.sign(np.sum(-(nx * gxs + nz * gzs)) + 1e-9)
    nx, nz = nx * flip, nz * flip
    sl = np.clip(sample(SLOPE, R[:, 0], R[:, 1]), 0.9, 6.0)
    ymid = level - sample(PH2[::2, ::2], R[:, 0], R[:, 1]) + BED * 0.0
    # the slab's bulge: a little different block to block, pinched in at the CRACKS
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(R, axis=0).T))])
    cracks = np.cumsum(rng.uniform(18, 45, size=int(s[-1] / 18) + 2))
    dc = np.min(np.abs(s[:, None] - cracks[None, :]), axis=1)
    pinch = 0.45 + 0.55 * smoothstep(0.6, 2.6, dc)
    blk = np.interp(s, np.concatenate([[0], cracks]), rng.uniform(0.8, 1.25, size=len(cracks) + 1))
    # (an open line fades into the terrain at its ends)
    fade = np.ones(n) if closed else np.minimum(smoothstep(0, 6, s), smoothstep(0, 6, s[-1] - s))
    jit = rng.uniform(0.95, 1.05, size=(n, NP))   # (each vertex a little its own: soft facets, never spikes — 2026-11-04)
    k = (pinch * blk * fade)[:, None] * jit
    py = PY * sc
    out = -py[None, :] / sl[:, None] + PB[None, :] * k * min(1.0, 0.45 + 0.55 * sc)
    along = rng.uniform(-0.35, 0.35, size=(n, 1)) * fade[:, None] * min(1.0, sc)
    vx = R[:, 0][:, None] + nx[:, None] * out + tg[:, 0][:, None] * along
    vz = R[:, 1][:, None] + nz[:, None] * out + tg[:, 1][:, None] * along
    vy = ymid[:, None] + py[None, :] + rng.uniform(-0.15, 0.15, size=(n, NP)) * min(1.0, sc)
    V = np.stack([vx, vy, vz], -1).reshape(-1, 3)
    # faces (quads) between consecutive rings
    m = n if closed else n - 1
    a = np.arange(m)[:, None] * NP + np.arange(NP - 1)[None, :]
    b = ((np.arange(m) + 1) % n)[:, None] * NP + np.arange(NP - 1)[None, :]
    Q = np.stack([a, b, b + 1, a + 1], -1).reshape(-1, 4)
    # into its cell (by the line's middle — a band spans a cell edge now and then: fine)
    mid = R[n // 2]
    key = (int((mid[0] + HALF) // CELL), int((mid[1] + HALF) // CELL))
    cv = cells.setdefault(key, [[], [], 0])
    cv[0].append(V); cv[1].append(Q + cv[2]); cv[2] += len(V)

def riser_runs(R, ok, closed):
    """The stretches of a contour line R where `ok` (its ground a riser): the whole line if it is all ok, else each
    run of ok points as an open line."""
    if ok.all():
        yield R, closed
        return
    if closed:   # (start at a gap: a run never wraps round the ends)
        k = int(np.argmin(ok)); R = np.roll(R, -k, 0); ok = np.roll(ok, -k)
    i, n = 0, len(R)
    while i < n:
        if not ok[i]: i += 1; continue
        j = i
        while j < n and ok[j]: j += 1
        yield R[i:j], False
        i = j

log('contours and bands')
SPIRES_ = D['spires'].astype(np.float64) if 'spires' in D.files else np.zeros((0, 4))
# (2026-11-04: the beds have their own thickness now — desert.py's strata — and only a HARD bed's riser is a cliff that
#  gets a skin, sized to that riser; a soft bed is a plain slope, left to the terrain)
LAYERS = D['layers'] if 'layers' in D.files else None
levels = []
if LAYERS is None:
    lo, hi = math.floor(F[STEEP].min() / BED), math.ceil(F[STEEP].max() / BED)
    levels = [((kb + 0.5) * BED, 1.0) for kb in range(lo, hi + 1)]
else:
    fmin, fmax = F[STEEP].min(), F[STEEP].max()
    for b, t, hd, c in LAYERS:
        rh = t * c * hd
        if hd < 0.5 or rh < 2.5 or b + t < fmin or b > fmax: continue
        levels.append((b + t * (1 - c / 2), rh / 9.45))
# (2026-11-04, the stylised look: the skins are OPT-IN — SKINS=1. Where a band met the terrain at a grazing angle it
#  poked in and out in triangles, a dark sawtooth along every wall; the clean look is the terrain's own planes and beds)
if ARGS.get('SKINS', '0') != '1': levels = []
nb = 0
for level, sc in levels:
    for P, closed in contours(level):
        R, t_ = resample_line(P, closed, 5.0)
        if R is None: continue
        # (only where the ground falls steeply ACROSS the line — a riser: where a contour turns across a narrow slot's
        #  or a cut's gentle floor, the 4 m gradient there is its walls', along the line, and the band stood up out of
        #  the floor as a 10 m plate — DESERT_MATCH.md §8)
        tg = (np.roll(R, -1, 0) - np.roll(R, 1, 0)) if closed else np.gradient(R, axis=0)
        tg /= np.linalg.norm(tg, axis=1)[:, None] + 1e-9
        across = np.abs(-sample(gx, R[:, 0], R[:, 1]) * tg[:, 1] + sample(gz, R[:, 0], R[:, 1]) * tg[:, 0])
        for R_, closed_ in riser_runs(R, across > 0.5, closed):
            # (a spire's tip — a loop under ~50 m round — and short open scraps make shards, not slabs: skipped)
            L_ = len(R_) * 5.0
            if (closed_ and L_ < 50) or (not closed_ and L_ < 24): continue
            # (none on the spires, 2026-11-04: a tower's wall is a cell or two wide on the 2 m grid — its ring stood out
            #  of it on one side and sank into it on the other, a lens-shaped plate half way up the tower)
            if len(SPIRES_) and (np.hypot(SPIRES_[:, 0] - R_[len(R_) // 2, 0], SPIRES_[:, 1] - R_[len(R_) // 2, 1]) < SPIRES_[:, 2] * 1.4 + 6).any(): continue
            add_band(R_, closed_, level, sc)
            nb += 1
log(f'  {nb} bands in {len(cells)} cells, {sum(c[2] for c in cells.values())} vertices')

# ---------------------------------------------------------------------------------------------------------- structures
# THE DESERT'S LANDMARKS in sandstone (NEXT.md 4; Over the Hill's Algeria): the natural ARCH the road crosses over the
# slot, the Roman AQUEDUCT on the plain behind the lagoon, the KSAR (a ruined fortified village the road runs through),
# the GORGE's huge fallen blocks. All of the one low-poly piece — a SLAB: a box whose top edges are chamfered (flat top,
# rounded shoulders), its corners jittered — stacked, the formations' sandstone colouring them. Their colliders (boxes:
# the arch's deck is ground, the rest walls) go to structures.json for the game's physics (Formations.ts).
import json
structs = {}
colliders = []
srng = np.random.default_rng(23)
def store(name):
    return structs.setdefault(name, [[], [], 0])
def put(name, P, faces):
    """Quads of the points P into mesh `name`, each turned to face away from P's middle (the game culls back faces)."""
    ctr = P.mean(0)
    out = []
    for f in faces:
        n = np.cross(P[f[1]] - P[f[0]], P[f[2]] - P[f[0]])
        out.append(f if np.dot(n, P[list(f)].mean(0) - ctr) > 0 else f[::-1])
    s = store(name)
    s[0].append(P); s[1].append(np.array(out) + s[2]); s[2] += len(P)
SLAB_FACES = [(0, 1, 2, 3)] + [(k, (k + 1) % 4, 4 + (k + 1) % 4, 4 + k) for k in range(4)] + \
             [(4 + k, 4 + (k + 1) % 4, 8 + (k + 1) % 4, 8 + k) for k in range(4)] + [(8, 9, 10, 11)]
def slab(name, c, a, hu, hh, hw, bev=0.6, jit=0.25, flat_top=False, top_drop=(0.0, 0.0)):
    """A slab centred at c (x, y, z), turned a about +y (its u axis (cos a, 0, sin a)), half sizes hu (along), hh (up),
    hw (across); bev: the chamfer of its top edges; jit: corner jitter; flat_top: its top exactly level (a deck);
    top_drop: how far its top sinks at its −u / +u ends (tucked under the ground)."""
    U = np.array([math.cos(a), 0.0, math.sin(a)]); W = np.array([-math.sin(a), 0.0, math.cos(a)]); Y = np.array([0.0, 1.0, 0.0])
    c = np.array(c, float)
    b = min(bev, hu * 0.45, hw * 0.45, hh * 0.9)
    pts = []
    for (ly, inset, bulge) in ((-hh, 0.0, 1.0), (hh - b, 0.0, 1.03), (hh, b, 1.0)):
        for (su, sw) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = c + U * su * (hu - inset) * bulge + W * sw * (hw - inset) * bulge + Y * ly
            j = srng.uniform(-jit, jit, 3)
            if flat_top and ly > -hh: j[1] = 0.0
            if ly > -hh: p = p - Y * (top_drop[0] if su < 0 else top_drop[1])
            pts.append(p + j)
    put(name, np.array(pts), SLAB_FACES)
def collide(c, a, hu, hh, hw, ground=False):
    t = -a
    colliders.append({'c': [round(float(v), 2) for v in c], 'h': [round(float(hu), 2), round(float(hh), 2), round(float(hw), 2)],
                      'q': [0.0, round(math.sin(t / 2), 5), 0.0, round(math.cos(t / 2), 5)], 'ground': ground})
def ground(x, z): return float(sample(H2[::2, ::2], np.array([x]), np.array([z]))[0])

# THE ARCH: a rock bridge over the slot, its deck the road (desert.py levels the road's ends to it); its underside an
# arch from the slot's walls, the body stacked beds ~3.3 m thick, each a little out of line with the next, wider lower
ax_, az_, ay_ = (float(v) for v in D['arch'])
floor_y = min(ground(ax_ + dx, az_) for dx in range(-12, 13, 2))
A_SPAN, CROWN = 27.0, 9.5               # the opening's half span at the floor, the rock over the crown
b_open = ay_ - CROWN - floor_y
def open_half(y): return A_SPAN * math.sqrt(max(0.0, 1 - ((y - floor_y) / b_open) ** 2)) if y < floor_y + b_open else 0.0
def wall_x(y, side):
    """Where the slot's wall reaches height y (x), searched outward from the arch's middle on `side` (−1 west, 1 east)."""
    for d in range(0, 70):
        if ground(ax_ + side * d, az_) >= y: return ax_ + side * d
    return ax_ + side * 70
DECK_HALF = 40.0
layers = []
y = ay_
while y > floor_y + 2: layers.append((y - 3.3, y)); y -= 3.3
for li, (y0, y1) in enumerate(layers):
    hh = (y1 - y0) / 2 * 1.02
    ym = (y0 + y1) / 2
    width = 10.0 + 0.16 * (ay_ - ym) + srng.uniform(-0.4, 0.4)
    zc = az_ + srng.uniform(-0.5, 0.5) * (li > 0)
    oh = open_half(ym)
    if li == 0:
        # the DECK: blocks along the span, their tops level with the road; the end ones tucked down under it
        xs = np.linspace(ax_ - DECK_HALF - 6, ax_ + DECK_HALF + 6, 10)
        for k in range(len(xs) - 1):
            xa, xb = xs[k] + 0.08, xs[k + 1] - 0.08
            drop = (0.4 if k == 0 else 0.0, 0.4 if k == len(xs) - 2 else 0.0)
            slab('arch', ((xa + xb) / 2, y1 - hh, zc), 0.0, (xb - xa) / 2, hh, width / 2, bev=0.9, jit=0.18, flat_top=True, top_drop=drop)
        # the LIPS along its edges (where the rails are)
        for sd in (-1, 1):
            x = ax_ - DECK_HALF + 4
            while x < ax_ + DECK_HALF - 4:
                L_ = srng.uniform(3.5, 6.5)
                slab('arch', (x + L_ / 2, y1 + 0.35, zc + sd * (width / 2 - 0.7)), srng.uniform(-0.05, 0.05), L_ / 2 - 0.1, 0.45, 0.6, bev=0.3, jit=0.12)
                x += L_ + srng.uniform(0.2, 1.4)
        continue
    pieces = [(ax_ - DECK_HALF - 4, ax_ + DECK_HALF + 4)] if oh <= 0 else [(min(wall_x(ym, -1) - 5, ax_ - oh - 1), ax_ - oh), (ax_ + oh, max(wall_x(ym, 1) + 5, ax_ + oh + 1))]
    for (xa, xb) in pieces:
        xa += srng.uniform(-0.6, 0.6); xb += srng.uniform(-0.6, 0.6)
        if xb - xa < 2: continue
        n = max(1, int((xb - xa) / srng.uniform(7, 11)))
        cuts = np.linspace(xa, xb, n + 1)
        for k in range(n):
            slab('arch', ((cuts[k] + cuts[k + 1]) / 2, ym, zc), srng.uniform(-0.02, 0.02), (cuts[k + 1] - cuts[k]) / 2 - 0.1, hh, width / 2, bev=1.1, jit=0.3)
deck_w = 10.0 - 2 * 1.3
collide((ax_, ay_ - 1.0, az_), 0.0, DECK_HALF + 2, 1.0, deck_w / 2, ground=True)
for sd in (-1, 1): collide((ax_, ay_ + 0.75, az_ + sd * (deck_w / 2 + 0.15)), 0.0, DECK_HALF, 0.75, 0.15)
log(f'  the arch: {len(layers)} beds, the deck at {ay_:.1f} m over the slot floor {floor_y:.1f} m')

# THE AQUEDUCT: piers every 12 m, a ring of voussoirs over each bay, the haunches filled, the channel's band and its two
# parapets on top — level all along (the ground falls away under it); three bays fallen, their stones on the ground
qx0, qz0, qx1, qz1 = (float(v) for v in D['aqueduct'])
qa = math.atan2(qz1 - qz0, qx1 - qx0)
QL = math.hypot(qx1 - qx0, qz1 - qz0)
QU = np.array([math.cos(qa), 0.0, math.sin(qa)]); QW = np.array([-math.sin(qa), 0.0, math.cos(qa)])
BAY, PIER_U, PIER_W = 12.0, 1.4, 1.9
nb_ = int(QL / BAY)
gs = [ground(qx0 + QU[0] * BAY * i, qz0 + QU[2] * BAY * i) for i in range(nb_ + 1)]
TOP = max(gs) + 15.0
RR = BAY / 2 - PIER_U                     # the arches' radius
CROWN_Y = TOP - 3.2
SPRING = CROWN_Y - RR
fallen = set(int(v) for v in srng.choice(np.arange(3, nb_ - 3), 3, replace=False))
def qp(s, y=0.0): return np.array([qx0 + QU[0] * s, y, qz0 + QU[2] * s])
for i in range(nb_ + 1):
    name = f'aqueduct_{i * 3 // (nb_ + 1)}'
    s = BAY * i
    g = gs[i] - 1.0
    if i in fallen and (i - 1) in fallen: continue
    # the pier: two courses, the upper set back a little
    hm = (SPRING - g) / 2
    slab(name, qp(s, g + hm / 2), qa, PIER_U, hm / 2 + 0.05, PIER_W + 0.15, bev=0.25, jit=0.12)
    slab(name, qp(s, g + hm * 1.5), qa, PIER_U * 0.94, hm / 2 + 0.05, PIER_W, bev=0.25, jit=0.1)
    collide(qp(s, (g + SPRING) / 2), qa, PIER_U, (SPRING - g) / 2, PIER_W)
    if i == nb_ or i in fallen: continue
    # the arch: 9 voussoirs round the semicircle to the next pier, the haunches filled, the band and parapets on top
    sc = s + BAY / 2
    for k in range(9):
        t = (k + 0.5) / 9 * math.pi
        P0 = qp(sc - math.cos(t) * (RR + 0.45), SPRING + math.sin(t) * (RR + 0.45))
        U2 = QU * math.sin(t) + np.array([0.0, 1.0, 0.0]) * math.cos(t)
        Y2 = np.cross(QW, U2); Y2 /= np.linalg.norm(Y2)
        hl = (math.pi * (RR + 0.45) / 9) / 2 - 0.06
        pts = [P0 + U2 * su * hl + QW * sw * PIER_W * 0.95 + Y2 * ly + srng.uniform(-0.05, 0.05, 3)
               for ly in (-0.5, 0.5) for (su, sw) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        put(name, np.array(pts), [(0, 1, 2, 3), (4, 5, 6, 7)] + [(k2, (k2 + 1) % 4, 4 + (k2 + 1) % 4, 4 + k2) for k2 in range(4)])
    for hs in (s + PIER_U + RR * 0.32, s + BAY - PIER_U - RR * 0.32):
        y_lo = SPRING + RR * 0.55
        slab(name, qp(hs, (y_lo + CROWN_Y + 0.4) / 2), qa, RR * 0.34, (CROWN_Y + 0.4 - y_lo) / 2, PIER_W * 0.97, bev=0.1, jit=0.06)
    slab(name, qp(sc, CROWN_Y + 1.25), qa, BAY / 2 - 0.05, 1.3, PIER_W + 0.05, bev=0.15, jit=0.08)
    for sd in (-1, 1):
        slab(name, qp(sc, TOP - 0.3) + QW * sd * (PIER_W - 0.25), qa, BAY / 2 - 0.08, 0.5, 0.25, bev=0.1, jit=0.05)
# the fallen bays' stones, tumbled on the ground under them
for i in fallen:
    for _ in range(9):
        p = qp(BAY * (i + srng.uniform(0.1, 0.9))) + QW * srng.uniform(-5, 5)
        g = ground(p[0], p[2])
        hu, hh, hw = srng.uniform(0.6, 1.4), srng.uniform(0.4, 0.8), srng.uniform(0.5, 1.1)
        slab('aqueduct_ruin', (p[0], g + hh * 0.6, p[2]), srng.uniform(0, math.pi), hu, hh, hw, bev=0.3, jit=0.15)
log(f'  the aqueduct: {nb_} bays over {QL:.0f} m, its channel at {TOP:.1f} m, bays {sorted(fallen)} fallen')

# THE KSAR: a walled village of mud-brick and sandstone, ruined — corner towers in two stages, the wall in blocks (some
# fallen, the tops ragged), houses inside on lanes; the road runs through it (a gate wherever it crosses the wall)
kx, kz = (float(v) for v in D['ksar'])
road = None
for L_ in json.load(open(os.path.join(OUT, 'meta.json')))['trails']['lines']:
    A_ = np.array(L_, float)
    if np.hypot(A_[:, 0] - kx, A_[:, 1] - kz).min() < 25: road = A_ if road is None else np.vstack([road, A_])
def road_dist(x, z):
    return 1e9 if road is None else float(np.min(np.hypot(road[:, 0] - x, road[:, 1] - z)))
near = road[np.hypot(road[:, 0] - kx, road[:, 1] - kz) < 70] if road is not None else np.zeros((0, 2))
ka = math.atan2(near[-1, 1] - near[0, 1], near[-1, 0] - near[0, 0]) if len(near) > 1 else 0.0
KU = np.array([math.cos(ka), 0.0, math.sin(ka)]); KW = np.array([-math.sin(ka), 0.0, math.cos(ka)])
KHU, KHW = 38.0, 30.0                      # the enclosure's half sizes along / across the road
def kp(u, w): return np.array([kx, 0.0, kz]) + KU * u + KW * w
def kslab(u, w, hu, hh, hw, a_off=0.0, bev=0.4, jit=0.2):
    p = kp(u, w)
    g = ground(p[0], p[2])
    slab('ksar', (p[0], g - 0.6 + hh, p[2]), ka + a_off, hu, hh, hw, bev=bev, jit=jit)
    collide((p[0], g - 0.6 + hh, p[2]), ka + a_off, hu, hh, hw)
    return g
for (u0, w0, u1, w1) in ((-KHU, -KHW, KHU, -KHW), (KHU, -KHW, KHU, KHW), (KHU, KHW, -KHU, KHW), (-KHU, KHW, -KHU, -KHW)):
    Lw = math.hypot(u1 - u0, w1 - w0)
    n = int(Lw / 6)
    along_u = abs(u1 - u0) > 1
    for k in range(n):
        t = (k + 0.5) / n
        u, w = u0 + (u1 - u0) * t, w0 + (w1 - w0) * t
        p = kp(u, w)
        if road_dist(p[0], p[2]) < 6.5 or srng.random() < 0.08: continue
        h = srng.uniform(5.2, 6.8) if srng.random() > 0.2 else srng.uniform(1.5, 3.5)
        kslab(u, w, (Lw / n) / 2 - 0.05 if along_u else 0.75, h / 2, 0.75 if along_u else (Lw / n) / 2 - 0.05, bev=0.3, jit=0.25)
for (u, w) in ((-KHU, -KHW), (KHU, -KHW), (KHU, KHW), (-KHU, KHW)):
    p = kp(u, w)
    if road_dist(p[0], p[2]) < 8: continue
    h1 = srng.uniform(7, 8.5)
    g = kslab(u, w, 3.6, h1 / 2, 3.6, bev=0.3, jit=0.15)
    slab('ksar', (p[0], g - 0.6 + h1 + 1.8, p[2]), ka, 3.0, 1.9, 3.0, bev=0.5, jit=0.2)
for gu in np.arange(-KHU + 9, KHU - 6, 11.0):
    for gw in np.arange(-KHW + 8, KHW - 5, 10.5):
        u, w = gu + srng.uniform(-1.5, 1.5), gw + srng.uniform(-1.5, 1.5)
        p = kp(u, w)
        if road_dist(p[0], p[2]) < 10 or srng.random() < 0.15: continue
        hu, hw = srng.uniform(3.0, 4.6), srng.uniform(2.8, 4.2)
        h = srng.uniform(3.8, 5.6) if srng.random() > 0.25 else srng.uniform(1.0, 2.2)
        g = kslab(u, w, hu, h / 2, hw, a_off=srng.uniform(-0.04, 0.04), bev=0.35, jit=0.2)
        if h > 3.5 and srng.random() < 0.4:
            slab('ksar', (p[0] + srng.uniform(-1, 1), g - 0.6 + h + 1.4, p[2] + srng.uniform(-1, 1)), ka, hu * 0.6, 1.5, hw * 0.6, bev=0.3, jit=0.15)
log(f'  the ksar at ({kx:.0f}, {kz:.0f}), turned {math.degrees(ka):.0f}° to its road')

# THE GORGE's huge blocks: fallen from its walls onto its floor and into the rapids
riv = D['river'].astype(np.float64)
gorge = riv[riv[:, 0] > 900]
nblk = 0
for _ in range(240):
    if nblk >= 46: break
    k = int(srng.integers(1, len(gorge) - 1))
    x, z = gorge[k]
    tx, tz = gorge[k + 1] - gorge[k - 1]
    tl = math.hypot(tx, tz) or 1.0
    off = float(srng.choice([-1, 1])) * srng.uniform(2, 20)
    bx, bz = x - tz / tl * off, z + tx / tl * off
    g = ground(bx, bz)
    s_ = srng.uniform(2.5, 7.0)
    slab('gorge', (bx, g + s_ * 0.45, bz), srng.uniform(0, math.pi), s_ * srng.uniform(0.8, 1.3), s_ * srng.uniform(0.5, 0.8), s_ * srng.uniform(0.7, 1.1), bev=s_ * 0.25, jit=s_ * 0.08)
    collide((bx, g + s_ * 0.3, bz), 0.0, s_ * 0.8, s_ * 0.6, s_ * 0.8)
    nblk += 1
log(f'  the gorge: {nblk} blocks; structures {sum(v[2] for v in structs.values())} vertices, {len(colliders)} colliders')
with open(os.path.join(OUT, 'structures.json'), 'w') as f: json.dump({'colliders': colliders}, f)

# ---------------------------------------------------------------------------------------------------------- Blender
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
col = bpy.data.collections.new('formations'); bpy.context.scene.collection.children.link(col)
mat = bpy.data.materials.new('sandstone')
for (ci, cj), (Vs, Qs, nv) in cells.items():
    V = np.vstack(Vs); Q = np.vstack(Qs)
    me = bpy.data.meshes.new(f'c_{ci}_{cj}')
    # (glTF is y-up like the game: Blender's z-up gets x, −z, y and the exporter turns it back)
    me.vertices.add(len(V)); me.vertices.foreach_set('co', np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1).astype(np.float32).ravel())
    me.loops.add(Q.size); me.loops.foreach_set('vertex_index', Q.astype(np.int32).ravel())
    me.polygons.add(len(Q)); me.polygons.foreach_set('loop_start', (np.arange(len(Q)) * 4).astype(np.int32)); me.polygons.foreach_set('loop_total', np.full(len(Q), 4, np.int32))
    me.update(calc_edges=True); me.validate()
    me.polygons.foreach_set('use_smooth', np.ones(len(Q), bool)) # (shared vertices: the game shades the facets flat itself)
    me.materials.append(mat)
    ob = bpy.data.objects.new(f'c_{ci}_{cj}', me)
    col.objects.link(ob)
# the structures: a mesh each (the aqueduct in three), quads
for name, (Vs, Qs, nv) in structs.items():
    V = np.vstack(Vs); Q = np.vstack(Qs)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V)); me.vertices.foreach_set('co', np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1).astype(np.float32).ravel())
    me.loops.add(Q.size); me.loops.foreach_set('vertex_index', Q.astype(np.int32).ravel())
    me.polygons.add(len(Q)); me.polygons.foreach_set('loop_start', (np.arange(len(Q)) * 4).astype(np.int32)); me.polygons.foreach_set('loop_total', np.full(len(Q), 4, np.int32))
    me.update(calc_edges=True); me.validate()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
log('meshes built')
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'formations.glb')
bpy.ops.object.select_all(action='DESELECT')
for o in col.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                          export_texcoords=False, export_materials='NONE', export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=7, export_draco_position_quantization=14, export_draco_normal_quantization=10)
log(f'wrote {path}: {os.path.getsize(path) / 1e6:.2f} MB')
