# OVER THE HILL — the DESERT's sandstone, modelled in Blender over the terrain desert.py baked (2026-11-02, the user:
# "make this new map in Blender so you can sculpt the desert cliffs, rocks and all").
#
#   blender -b --factory-startup --python scripts/oth/desert_rocks.py -- [OUT=public/oth/desert] [PREVIEW=<dir>]
#
# Over the Hill's sandstone is STACKED SLABS: every bed a thick rounded band, bulging out of the wall, a lip over the
# ledge above, split into blocks by cracks, bed on bed up every wall, mesa and spire. The terrain already steps in
# those beds (desert.py terraces it: a 9 m riser, a ledge); here each riser gets its SKIN: for every bed, the contour
# at the riser's middle (marching squares on the 4 m grid of the beds' own height, the wobble taken out) where the
# ground is steep, and along it a profile swept — the riser's own lean plus a pillow bulge (~1.3 m), tucked in at its
# foot, a lip over the ledge — pinched in at a crack every 12–35 m. Smooth across the bulge, crisp at the lip.
# The meshes go out per 256 m CELL (the game culls them by cell and distance — Formations.ts) as formations.glb, Draco
# compressed. (They're skin: the terrain under them is the collider — they stand ≤ 1.3 m off it.)
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
def add_band(R, closed, level):
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
    cracks = np.cumsum(rng.uniform(12, 35, size=int(s[-1] / 12) + 2))
    dc = np.min(np.abs(s[:, None] - cracks[None, :]), axis=1)
    pinch = 0.25 + 0.75 * smoothstep(0.4, 1.6, dc)
    blk = np.interp(s, np.concatenate([[0], cracks]), rng.uniform(0.8, 1.25, size=len(cracks) + 1))
    # (an open line fades into the terrain at its ends)
    fade = np.ones(n) if closed else np.minimum(smoothstep(0, 6, s), smoothstep(0, 6, s[-1] - s))
    jit = rng.uniform(0.86, 1.14, size=(n, NP))   # (each vertex its own: irregular facets)
    k = (pinch * blk * fade)[:, None] * jit
    out = -PY[None, :] / sl[:, None] + PB[None, :] * k
    along = rng.uniform(-0.9, 0.9, size=(n, 1)) * fade[:, None]
    vx = R[:, 0][:, None] + nx[:, None] * out + tg[:, 0][:, None] * along
    vz = R[:, 1][:, None] + nz[:, None] * out + tg[:, 1][:, None] * along
    vy = ymid[:, None] + PY[None, :] + rng.uniform(-0.35, 0.35, size=(n, NP))
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

log('contours and bands')
lo, hi = math.floor(F[STEEP].min() / BED), math.ceil(F[STEEP].max() / BED)
nb = 0
for kb in range(lo, hi + 1):
    level = (kb + 0.5) * BED
    for P, closed in contours(level):
        R, t_ = resample_line(P, closed, 5.0)
        if R is None: continue
        # (a spire's tip — a loop under ~50 m round — and short open scraps make shards, not slabs: skipped)
        L_ = len(R) * 5.0
        if (closed and L_ < 50) or (not closed and L_ < 24): continue
        add_band(R, closed, level)
        nb += 1
log(f'  {nb} bands in {len(cells)} cells, {sum(c[2] for c in cells.values())} vertices')

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
log('meshes built')
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'formations.glb')
bpy.ops.object.select_all(action='DESELECT')
for o in col.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                          export_texcoords=False, export_materials='NONE', export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=7, export_draco_position_quantization=14, export_draco_normal_quantization=10)
log(f'wrote {path}: {os.path.getsize(path) / 1e6:.2f} MB')
