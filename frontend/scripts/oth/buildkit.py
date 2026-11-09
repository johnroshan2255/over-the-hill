# OVERHILL — THE BUILDING KIT (docs/MULTIPLAYER.md §4 — the user: "what we build must look good … not boxes … good
# quality"): every piece of backend/src/catalog.rs MODELLED — log walls of real logs (each its own taper and roll, the
# corners notched and overhanging, the ends cut), walls of fieldstone in lime mortar with dressed corner stones,
# barn-board plank walls, windows (frame, sill, mullions, glass, shutters), board-and-batten doors on iron strap hinges,
# a garage door of corrugated steel, roofs of wooden shingles in courses (or corrugated tin) with fascia boards, eaves
# and a ridge cap, a fieldstone chimney, a stone foundation of dressed blocks, plank floors on joists, steps, a porch,
# a split-rail fence and its gate, a dry-stone wall, a jetty, a fire ring, a lamp post.
#
# THE LOOK: not one baked atlas (a 3 m wall would get a blur) but TILING scanned materials (ambientCG, CC0 — each at
# full 1 K across the surface: Bricks096, Bricks089, Bark014, WoodSiding013, CorrugatedSteel009, WoodSiding005,
# Planks037A, Planks023A, Metal055A, Rock028; the logs' end grain drawn here), UVs in metres; AMBIENT OCCLUSION baked
# into the vertices (Cycles: the corners, the gaps between logs, under the eaves); bevelled edges. The game draws a
# claim's pieces merged per material (Pieces.ts): a whole homestead in a handful of draws.
#
#   blender -b --factory-startup --python scripts/oth/buildkit.py -- [OUT=src/assets/models/kit/kit.glb] [PREVIEW=<dir>]
#           [TEX=src/assets/textures/kit]
#
# THE GRID (the game snaps to it): a CELL 3 m; walls 2.6 m high on a floor 0.45 m over the ground. Blender space, x
# right, y forward, z up (the game: x, −z, y). Each piece's origin:
#   foundation_*, floor_plank, porch_deck — the cell's centre, at the ground (their top at FLOOR);
#   wall_* — the middle of its bottom edge (on the floor), along x from −1.5 to 1.5, its faces ±y;
#   roof_* — the cell's centre at the walls' top (WALL_H over the floor): the ridge along x, the slopes down ±y;
#   the rest at its own foot (the ground or the floor it stands on).
import sys, os, math, json, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assetkit import *
import numpy as np
import bpy, bmesh
from mathutils import Vector, noise

kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'kit', 'kit.glb')))
TEXDIR = os.path.abspath(kw.get('TEX', os.path.join(FRONTEND, 'src', 'assets', 'textures', 'kit')))
PREVIEW = kw.get('PREVIEW')
def log(*a): print('[kit]', *a, flush=True)

CELL, FLOOR, WALL_H = 3.0, 0.45, 2.6
PITCH = math.radians(34)
EAVE = 0.35
rng = np.random.default_rng(11)
R = lambda a=0.0, b=1.0: float(rng.uniform(a, b))

reset()
# ===================================================================================================== the materials
# name → (ambientCG set, texture repeats per metre, tint) — the game reads the same table (kit.json)
MATS = {
    'stone': ('Bricks096', 0.55, (1.1, 1.1, 1.08)),
    'block': ('Bricks089', 0.6, (1.12, 1.12, 1.1)),
    'bark': ('Bark014', 1.2, (1.3, 1.22, 1.12)),
    'shingle': ('WoodSiding013', 0.7, (1.15, 1.12, 1.08)),
    'tin': ('CorrugatedSteel009', 0.8, (1, 1, 1)),
    'barn': ('WoodSiding005', 0.6, (1.1, 1.05, 1.05)),
    'planks': ('Planks037A', 0.6, (1.2, 1.15, 1.1)),
    'door': ('Planks023A', 0.8, (1.2, 1.15, 1.1)),
    'iron': ('Metal055A', 1.5, (0.55, 0.55, 0.57)),
    'rock': ('Rock028', 1.2, (1, 1, 1)),
    'end': (None, 1.0, (1, 1, 1)),
    'glass': (None, 1.0, (0.06, 0.08, 0.09)),
    'lamp': (None, 1.0, (1.0, 0.82, 0.5)),
    # THE PLANTS (step 5 — PLANT): the soil of a bed, a birch's pale bark (Bark014 again, pale), the leaf atlas
    # (plant_atlas.py: cut-out cards — the game draws them ALPHA_CUT, swaying)
    'soil': ('Ground048', 0.7, (1.0, 0.95, 0.9)),
    'birch': ('Bark014', 1.6, (2.3, 2.25, 2.1)),
    'leaf': ('@leaf', 1.0, (1.0, 1.0, 1.0)),
}
M = {}
def atlas_mat(name, path):
    """The leaf atlas (plant_atlas.py's): its colour, its alpha cutting the cards out (the preview's look; the game's
    ALPHA_CUT), both sides."""
    m = bpy.data.materials.new(name); m.use_nodes = True; t = m.node_tree; b = t.nodes['Principled BSDF']
    c = t.nodes.new('ShaderNodeTexImage'); c.image = bpy.data.images.load(path); c.image.alpha_mode = 'STRAIGHT'
    uv = t.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'; t.links.new(uv.outputs['UV'], c.inputs['Vector'])
    t.links.new(c.outputs['Color'], b.inputs['Base Color']); t.links.new(c.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.7
    try: m.blend_method = 'CLIP'
    except Exception: pass
    m.use_backface_culling = False
    return m
for n, (asset, k, tint) in MATS.items():
    if asset and asset.startswith('@'):
        M[n] = atlas_mat(n, os.path.join(TEXDIR, asset[1:] + '.webp'))
    elif asset:
        ensure_tex(asset); M[n] = pbr(n, asset, 1.0, tint, 0.8)
    else:
        M[n] = flat(n, tint, 0.15 if n == 'glass' else 0.6)
ORDER = list(MATS)
KREP = {n: MATS[n][1] for n in MATS}

class Part:
    """One piece being built: a bmesh with its UV layer, its faces by material (index into ORDER)."""
    def __init__(self, name):
        self.name = name; self.bm, self.uvl = new_bm()
    def mi(self, mat): return ORDER.index(mat)
    def box(self, c, half, mat, u=Vector((1, 0, 0)), v=Vector((0, 1, 0)), w=Vector((0, 0, 1))):
        box(self.bm, self.uvl, Vector(c), half, self.mi(mat), KREP[mat], u, v, w)
    def tube(self, path, radii, mat, sides=10, caps=True):
        tube(self.bm, self.uvl, [Vector(p) for p in path], radii, self.mi(mat), sides, caps, KREP[mat])
    def done(self, bev=0.012, smooth=True):
        bm = self.bm
        bm.normal_update()
        o = obj(self.name, bm, [M[n] for n in ORDER], smooth)
        if bev: bevel(o, bev, 2, 32)
        return o

# ===================================================================================================== pieces
def log_run(P, x0, x1, z, y, r, rot_seed, end_l=True, end_r=True, along='x'):
    """One log from x0 to x1 at height z, its face line y; uneven, tapering a little; its cut ends end grain."""
    S = 12; n = max(3, int((x1 - x0) / 0.5))
    rings = []
    for k in range(n + 1):
        t = k / n; x = x0 + (x1 - x0) * t
        ring = []
        for s in range(S):
            a = s / S * 2 * math.pi
            nz = noise.noise(Vector((math.cos(a) * 1.6, math.sin(a) * 1.6, x * 0.9 + rot_seed)))
            rr = r * (1 + 0.06 * nz) * (1 - 0.04 * t)
            p = (x, y + math.cos(a) * rr, z + math.sin(a) * rr) if along == 'x' else (y + math.cos(a) * rr, x, z + math.sin(a) * rr)
            ring.append(P.bm.verts.new(p))
        rings.append(ring)
    circ = 2 * math.pi * r
    for k in range(n):
        for s in range(S):
            q = (rings[k][s], rings[k + 1][s], rings[k + 1][(s + 1) % S], rings[k][(s + 1) % S])
            f = P.bm.faces.new(q if along == 'x' else tuple(reversed(q))); f.material_index = P.mi('bark')
            for lp, (uu, vv) in zip(f.loops, ((k, s), (k + 1, s), (k + 1, s + 1), (k, s + 1))):
                lp[P.uvl].uv = (vv / S * circ * KREP['bark'] + rot_seed, (x0 + (x1 - x0) * uu / n) * KREP['bark'])   # (the bark's furrows along the log)
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        q = list(reversed(ring)) if (flip == (along == 'x')) else ring
        f = P.bm.faces.new(q); f.material_index = P.mi('end')
        cx = sum(v.co.x for v in ring) / S; cy = sum(v.co.y for v in ring) / S; cz = sum(v.co.z for v in ring) / S
        for lp in f.loops:
            d = lp.vert.co - Vector((cx, cy, cz))
            a1 = d.y if along == 'x' else d.x
            lp[P.uvl].uv = (0.5 + a1 / (2.1 * r), 0.5 + d.z / (2.1 * r))

def wall_log(name, opening=None):
    """A log wall: logs stacked (r 0.15, every 0.27 m), each wider than the cell by its notched corner's overhang,
    alternate courses a half-log higher (the corner's interlock); an opening (window / door) cut through with its
    frame."""
    P = Part(name)
    r, step = 0.15, 0.27
    n = int(WALL_H / step)
    for k in range(n):
        z = 0.14 + k * step
        over = 0.32 if k % 2 == 0 else 0.22
        x0, x1 = -CELL / 2 - over, CELL / 2 + over
        seed = R(0, 10)
        if opening and opening[2] < z < opening[3]:
            log_run(P, x0, opening[0], z, 0, r * (0.95 + 0.1 * R()), seed)
            log_run(P, opening[1], x1, z, 0, r * (0.95 + 0.1 * R()), seed + 3)
        else:
            log_run(P, x0, x1, z, 0, r * (0.95 + 0.1 * R()), seed)
    # the chinking between the logs (a mortar strip each side)
    for k in range(n - 1):
        z = 0.14 + k * step + step / 2
        for sy in (-1, 1):
            if opening and opening[2] - 0.05 < z < opening[3] + 0.05:
                for (a, b) in ((-CELL / 2, opening[0]), (opening[1], CELL / 2)):
                    P.box((( a + b) / 2, sy * 0.08, z), ((b - a) / 2, 0.03, 0.03), 'block')
            else:
                P.box((0, sy * 0.08, z), (CELL / 2, 0.03, 0.03), 'block')
    if opening: frame(P, opening, 0.34)
    return P.done(0.0)

def frame(P, op, depth, mat='planks'):
    """An opening's frame: jambs, head, a sill under a window."""
    x0, x1, z0, z1 = op[:4]
    t = 0.07
    for x in (x0 - t / 2, x1 + t / 2):
        P.box((x, 0, (z0 + z1) / 2), (t / 2, depth / 2, (z1 - z0) / 2 + t), mat)
    P.box(((x0 + x1) / 2, 0, z1 + t / 2), ((x1 - x0) / 2 + t, depth / 2, t / 2), mat)
    if op[4] == 'window':
        P.box(((x0 + x1) / 2, 0.04, z0 - 0.03), ((x1 - x0) / 2 + 0.12, depth / 2 + 0.06, 0.035), mat)
        window(P, op, depth)
    elif op[4] == 'door':
        door(P, op)

def window(P, op, depth):
    """Four panes: the glass set back, the sash and the mullions; board shutters swung open each side."""
    x0, x1, z0, z1 = op[:4]
    P.box(((x0 + x1) / 2, 0, (z0 + z1) / 2), ((x1 - x0) / 2, 0.012, (z1 - z0) / 2), 'glass')
    for sy in (-1, 1):
        y = sy * 0.03
        P.box(((x0 + x1) / 2, y, (z0 + z1) / 2), (0.022, 0.02, (z1 - z0) / 2), 'planks')
        P.box(((x0 + x1) / 2, y, (z0 + z1) / 2), ((x1 - x0) / 2, 0.02, 0.022), 'planks')
    # the shutters (outside, +y): boards, a Z of battens
    w = (x1 - x0) / 2 + 0.03
    for sx, xe in ((-1, x0), (1, x1)):
        cx = xe + sx * (w / 2 + 0.08)
        for b in range(3):
            P.box((cx - w / 2 + (b + 0.5) * w / 3, depth / 2 + 0.03, (z0 + z1) / 2), (w / 6 - 0.006, 0.014, (z1 - z0) / 2 + 0.05), 'door')
        for zz in (z0 + 0.1, z1 - 0.1):
            P.box((cx, depth / 2 + 0.05, zz), (w / 2 - 0.02, 0.012, 0.04), 'door')

def door(P, op):
    """Board-and-batten: vertical boards, three battens and a brace, iron strap hinges and a latch."""
    x0, x1, z0, z1 = op[:4]
    n = 5; w = (x1 - x0) / n
    for b in range(n):
        P.box((x0 + (b + 0.5) * w, 0.0, (z0 + z1) / 2), (w / 2 - 0.004, 0.025, (z1 - z0) / 2), 'door')
    for zz in (z0 + 0.25, (z0 + z1) / 2, z1 - 0.25):
        P.box(((x0 + x1) / 2, 0.04, zz), ((x1 - x0) / 2 - 0.04, 0.016, 0.06), 'door')
    for zz in (z0 + 0.25, z1 - 0.25):
        P.box((x0 + 0.22, 0.055, zz), (0.2, 0.006, 0.022), 'iron')
    P.box((x1 - 0.12, 0.06, (z0 + z1) / 2), (0.03, 0.012, 0.06), 'iron')

def stone_wall(name, opening=None, thick=0.42):
    """Fieldstone in lime mortar, a little uneven over its face; dressed corner stones (quoins) up each end; an opening
    with a stone lintel."""
    P = Part(name)
    segs = [(-CELL / 2, CELL / 2, 0, WALL_H)]
    if opening:
        x0, x1, z0, z1 = opening[:4]
        segs = [(-CELL / 2, x0, 0, WALL_H), (x1, CELL / 2, 0, WALL_H), (x0, x1, z1 + 0.18, WALL_H)]
        if z0 > 0.01: segs.append((x0, x1, 0, z0))
    for (a, b, c, d) in segs:
        P.box(((a + b) / 2, 0, (c + d) / 2), ((b - a) / 2, thick / 2, (d - c) / 2), 'stone')
    for sx in (-1, 1):
        for k in range(int(WALL_H / 0.36)):
            z = 0.18 + k * 0.36; L = 0.42 if k % 2 == 0 else 0.26
            P.box((sx * (CELL / 2 - L / 2 + 0.01), 0, z), (L / 2 + 0.01, thick / 2 + 0.012, 0.17), 'block')
    if opening:
        x0, x1, z0, z1 = opening[:4]
        P.box(((x0 + x1) / 2, 0, z1 + 0.09), ((x1 - x0) / 2 + 0.18, thick / 2 + 0.015, 0.09), 'block')
        frame(P, opening, thick - 0.06)
    return P.done(0.02)

def plank_wall(name, garage=False):
    """Barn boards on a timber frame (the studs and the girts behind, a corner post each end); a garage's: a wide
    opening, a sectional door of corrugated steel in a steel frame."""
    P = Part(name)
    n = 14; w = CELL / n
    gx0, gx1, gz1 = -1.15, 1.15, 2.2
    for b in range(n):
        x = -CELL / 2 + (b + 0.5) * w
        if garage and gx0 < x < gx1:
            P.box((x, 0.04, (gz1 + WALL_H) / 2), (w / 2 - 0.005, 0.012, (WALL_H - gz1) / 2), 'barn')
        else:
            P.box((x, 0.04, WALL_H / 2), (w / 2 - 0.005, 0.012, WALL_H / 2), 'barn')
    for b in range(n - 1):
        x = -CELL / 2 + (b + 1) * w
        if not (garage and gx0 < x < gx1):
            P.box((x, 0.058, WALL_H / 2), (0.022, 0.008, WALL_H / 2), 'barn')
    for sx in (-1, 1): P.box((sx * (CELL / 2 - 0.07), -0.04, WALL_H / 2), (0.07, 0.07, WALL_H / 2), 'planks')
    for zz in (0.08, WALL_H - 0.08): P.box((0, -0.04, zz), (CELL / 2, 0.06, 0.07), 'planks')
    if garage:
        for sx in (-1, 1): P.box((sx * (gx1 + 0.04), 0.05, gz1 / 2), (0.05, 0.05, gz1 / 2), 'iron')
        P.box((0, 0.05, gz1 + 0.04), (gx1 + 0.09, 0.05, 0.05), 'iron')
        for k in range(4):
            z = 0.05 + (k + 0.5) * (gz1 - 0.05) / 4
            P.box((0, 0.0, z), (gx1, 0.03, (gz1 - 0.05) / 8 - 0.01), 'tin')
        P.box((0.7, 0.04, 0.6), (0.12, 0.012, 0.02), 'iron')
    else:
        P.box((0, -0.04, WALL_H / 2), (CELL / 2 - 0.15, 0.05, 0.05), 'planks')
    return P.done(0.0)

def foundation(name, wood=False):
    """A cell's foundation, its top at FLOOR: dressed stone blocks in courses round its edge down into the ground, the
    middle filled; or timber: a sill frame on stone piers."""
    P = Part(name)
    h = CELL / 2
    if not wood:
        P.box((0, 0, FLOOR - 0.06), (h - 0.05, h - 0.05, 0.06), 'block')
        for k in range(3):
            z = FLOOR - 0.12 - k * 0.24
            off = 0.0 if k % 2 == 0 else 0.25
            for side in range(4):
                n = 6
                for i in range(n):
                    t = -h + off + (i + 0.5) * (CELL / n)
                    if t > h: t -= CELL
                    L = CELL / n / 2 - 0.01
                    x, y = (t, -h + 0.14) if side == 0 else (t, h - 0.14) if side == 1 else (-h + 0.14, t) if side == 2 else (h - 0.14, t)
                    half = (L, 0.14, 0.115) if side < 2 else (0.14, L, 0.115)
                    P.box((x, y, z), half, 'block')
        P.box((0, 0, FLOOR / 2 - 0.35), (h - 0.2, h - 0.2, FLOOR / 2 + 0.35), 'stone')
    else:
        for sx in (-1, 1):
            for sy in (-1, 1):
                P.box((sx * (h - 0.25), sy * (h - 0.25), -0.15), (0.22, 0.22, 0.32), 'block')
        for sy in (-1, 0, 1):
            P.box((0, sy * (h - 0.25), FLOOR - 0.12), (h, 0.1, 0.12), 'planks')
        for sx in (-1, 1):
            P.box((sx * (h - 0.25), 0, FLOOR - 0.12), (0.1, h, 0.12), 'planks')
        deck(P, h, FLOOR)
    return P.done(0.01)

def deck(P, h, top, n=14, along='x', hw=None):
    hw = hw or h
    w = 2 * hw / n
    for b in range(n):
        c = -hw + (b + 0.5) * w
        if along == 'x': P.box((0, c, top - 0.02), (h, w / 2 - 0.006, 0.02), 'planks')
        else: P.box((c, 0, top - 0.02), (w / 2 - 0.006, h, 0.02), 'planks')

def floor_plank(name):
    P = Part(name); h = CELL / 2
    for sy in (-1.2, -0.4, 0.4, 1.2):
        P.box((0, sy, FLOOR - 0.12), (h, 0.05, 0.1), 'planks')
    deck(P, h, FLOOR)
    return P.done(0.004)

def roof(name, tin=False):
    """A gabled module over a cell: two slopes (34°) from the ridge (along x) to the eaves, EAVE past the walls each way
    and at the gable ends; shingles in courses (each course its row of shingles, a little proud of the last) or
    corrugated tin; fascia boards along the eaves and up the verges; the gable ends boarded (barn boards)."""
    P = Part(name)
    h = CELL / 2
    run = h + EAVE; rise = run * math.tan(PITCH); slope = run / math.cos(PITCH)
    for sy in (-1, 1):
        n_rows = 1 if tin else int(slope / 0.24)
        for k in range(n_rows):
            t0 = k / n_rows; t1 = (k + 1) / n_rows
            # (a course: from t0 down the slope to t1 — its lower edge a little proud)
            mid = (t0 + t1) / 2
            y = sy * run * mid; z = rise * (1 - mid) - EAVE * math.tan(PITCH) + 0.06
            ang = -sy * PITCH
            u = Vector((1, 0, 0)); v = Vector((0, math.cos(ang), math.sin(ang))); w = v.cross(u) * -1
            if w.z < 0: w = -w
            if tin:
                P.box((0, y, z), (h + 0.12, slope / 2, 0.012), 'tin', u, v, w)
            else:
                # shingles: the course split into shingles of uneven width, each a hair thicker at its butt
                xs = -h - 0.12
                while xs < h + 0.12:
                    sw = min(R(0.16, 0.3), h + 0.12 - xs)
                    P.box((xs + sw / 2, y, z + 0.008 * k * 0 + 0.012), (sw / 2 - 0.004, slope / n_rows / 2 + 0.03, 0.012 + 0.004 * R()), 'shingle', u, v, w)
                    xs += sw
        # the roof deck under it
        y = sy * run / 2; z = rise / 2 - EAVE * math.tan(PITCH) + 0.03
        ang = -sy * PITCH; u = Vector((1, 0, 0)); v = Vector((0, math.cos(ang), math.sin(ang))); w = v.cross(u)
        if w.z < 0: w = -w
        P.box((0, y, z), (h + 0.12, slope / 2, 0.02), 'planks', u, v, w)
        # the fascia along the eave
        P.box((0, sy * run, -EAVE * math.tan(PITCH) - 0.05), (h + 0.14, 0.025, 0.09), 'planks')
    # the ridge cap
    P.box((0, 0, rise - EAVE * math.tan(PITCH) + 0.1), (h + 0.14, 0.12, 0.04), 'tin' if tin else 'planks')
    # the gable ends: boards in the triangle, each end
    for sx in (-1, 1):
        n = 10
        for b in range(n):
            y0 = -h + (b + 0.5) * CELL / n
            top = (h - abs(y0)) * math.tan(PITCH)
            if top > 0.05: P.box((sx * (h - 0.04), y0, top / 2), (0.015, CELL / n / 2 - 0.004, top / 2), 'barn')
    return P.done(0.0)

def ridge(name):
    P = Part(name); h = CELL / 2
    run = h + EAVE; rise = run * math.tan(PITCH)
    P.box((0, 0, rise - EAVE * math.tan(PITCH) + 0.12), (h + 0.14, 0.16, 0.05), 'planks')
    for x in (-h, 0, h): P.box((x, 0, rise - EAVE * math.tan(PITCH) + 0.18), (0.05, 0.05, 0.05), 'iron')
    return P.done(0.004)

def chimney(name):
    """Fieldstone, 0.9 m square from the floor to past the ridge, a dressed cap, a flue."""
    P = Part(name)
    H = WALL_H + 2.2
    P.box((0, 0, H / 2), (0.45, 0.45, H / 2), 'stone')
    P.box((0, 0, H + 0.06), (0.52, 0.52, 0.07), 'block')
    P.box((0, 0, H + 0.25), (0.16, 0.16, 0.14), 'block')
    P.box((0, 0, H + 0.4), (0.13, 0.13, 0.01), 'iron')
    return P.done(0.02)

def steps(name):
    P = Part(name)
    for k in range(3):
        P.box((0, -k * 0.32 - 0.16, FLOOR - (k + 1) * FLOOR / 3 + FLOOR / 6 - 0.15), (0.65, 0.17, FLOOR / 6 + 0.15), 'block')
    return P.done(0.012)

def porch_deck(name):
    """A porch: 3 × 2 m of boards on joists and posts down into the ground, at the floor's height."""
    P = Part(name)
    for sx in (-1.4, 1.4):
        for sy in (-0.9, 0.9):
            P.box((sx, sy, (FLOOR - 0.1) / 2 - 0.2), (0.08, 0.08, (FLOOR - 0.1) / 2 + 0.2), 'planks')
    for sy in (-0.9, 0, 0.9): P.box((0, sy, FLOOR - 0.1), (1.5, 0.05, 0.06), 'planks')
    deck(P, 1.0, FLOOR, 14, along='y', hw=1.5)
    # two steps down from its open side (Blender −y: the game's +z) — boards on blocks
    for k, (yy, top) in enumerate(((-1.17, FLOOR * 2 / 3), (-1.5, FLOOR / 3))):
        P.box((0, yy, top - 0.02), (0.75, 0.17, 0.025), 'planks')
        for sx in (-0.65, 0.65): P.box((sx, yy, (top - 0.04) / 2 - 0.1), (0.08, 0.14, (top - 0.04) / 2 + 0.1), 'block')
    return P.done(0.004)

def porch_roof(name):
    """The porch's roof — a lean-to over the deck (the same origin as porch_deck: its middle, on the ground; the house
    wall at +y 1.0): two posts from the ground (through the deck) to a beam, knee braces, rafters from a ledger on the
    wall out past the beam, a plank deck, shingles in courses at 10° and a fascia. Its top meets the wall just under
    the main roof's eave, which it runs over."""
    P = Part(name)
    pitch = math.radians(10); tn = math.tan(pitch)
    yw, yf, yb = 1.0, -1.3, -0.9  # the wall, the front eave, the beam
    zw = FLOOR + WALL_H - 0.04
    zt = lambda y: zw - (yw - y) * tn  # the rafters' top
    L = (yw - yf) / math.cos(pitch)
    u = Vector((1, 0, 0)); v = Vector((0, math.cos(pitch), math.sin(pitch))); w = v.cross(u)
    if w.z < 0: w = -w
    # rafters (5) and the ledger on the wall
    for x in (-1.55, -0.78, 0, 0.78, 1.55):
        P.box((x, (yw + yf) / 2, zt((yw + yf) / 2) - 0.06), (0.03, L / 2, 0.06), 'planks', u, v, w)
    P.box((0, yw - 0.02, zt(yw) - 0.14), (1.65, 0.03, 0.09), 'planks')
    # the roof deck and the shingles: courses from the wall down to the eave, each a hair proud of the last
    P.box((0, (yw + yf) / 2, zt((yw + yf) / 2) + 0.012), (1.7, L / 2, 0.012), 'planks', u, v, w)
    n = int(L / 0.24)
    for k in range(n):
        t = (k + 0.5) / n; y = yw - (yw - yf) * t
        xs = -1.72
        while xs < 1.72:
            sw = min(R(0.16, 0.3), 1.72 - xs)
            P.box((xs + sw / 2, y, zt(y) + 0.04), (sw / 2 - 0.004, L / n / 2 + 0.03, 0.012 + 0.004 * R()), 'shingle', u, v, w)
            xs += sw
    # the fascia along the eave, the verge boards
    P.box((0, yf - 0.02, zt(yf) - 0.04), (1.74, 0.025, 0.09), 'planks')
    for sx in (-1, 1): P.box((sx * 1.73, (yw + yf) / 2, zt((yw + yf) / 2) - 0.02), (0.02, L / 2, 0.08), 'planks', u, v, w)
    # the beam on the posts; the posts on stone pads; knee braces
    zb = zt(yb) - 0.12  # (the rafters' underside at the beam)
    P.box((0, yb, zb - 0.09), (1.68, 0.07, 0.09), 'planks')
    top = zb - 0.18
    for sx in (-1.4, 1.4):
        P.box((sx, yb, (top - 0.2) / 2), (0.08, 0.08, (top + 0.2) / 2), 'planks')
        P.box((sx, yb, 0.05), (0.13, 0.13, 0.05), 'block')
        s = -1 if sx > 0 else 1
        P.tube([(sx, yb, top - 0.5), (sx + s * 0.45, yb, top - 0.03)], [(0.035, 0.035)] * 2, 'planks', 4)
    log(f'porch roof: beam underside {top:.2f} m, {top - FLOOR:.2f} m over the deck')
    return P.done(0.004)

def porch_post(name):
    P = Part(name)
    P.box((0, 0, WALL_H / 2), (0.08, 0.08, WALL_H / 2), 'planks')
    for s in (-1, 1):
        P.tube([(0, 0, WALL_H - 0.55), (s * 0.45, 0, WALL_H - 0.06)], [(0.035, 0.035)] * 2, 'planks', 4)
    P.box((0, 0, 0.05), (0.13, 0.13, 0.05), 'block')
    return P.done(0.006)

def fence_rail(name):
    """A split-rail fence section: two posts (bark), three rails between them."""
    P = Part(name)
    for x in (-CELL / 2, CELL / 2):
        P.tube([(x, 0, -0.3), (x, 0, 1.25)], [(0.07, 0.07)] * 2, 'bark', 8)
    for z in (0.35, 0.7, 1.05):
        P.tube([(-CELL / 2 + 0.05, 0, z + R(-0.03, 0.03)), (CELL / 2 - 0.05, 0, z + R(-0.03, 0.03))], [(0.05, 0.04)] * 2, 'bark', 7)
    return P.done(0.0)

def fence_gate(name):
    P = Part(name)
    for x in (-CELL / 2, CELL / 2):
        P.tube([(x, 0, -0.3), (x, 0, 1.4)], [(0.09, 0.09)] * 2, 'bark', 8)
    gx0, gx1 = -CELL / 2 + 0.12, CELL / 2 - 0.12
    for x in (gx0, gx1): P.box((x, 0, 0.62), (0.05, 0.04, 0.55), 'door')
    for z in (0.15, 0.62, 1.1): P.box(((gx0 + gx1) / 2, 0, z), ((gx1 - gx0) / 2, 0.035, 0.06), 'door')
    L = math.hypot(gx1 - gx0, 0.95); a = math.atan2(0.95, gx1 - gx0)
    P.box(((gx0 + gx1) / 2, 0.04, 0.62), (L / 2, 0.02, 0.05), 'door', Vector((math.cos(a), 0, math.sin(a))), Vector((0, 1, 0)), Vector((-math.sin(a), 0, math.cos(a))))
    for x in (gx0 + 0.06, gx1 - 0.06):
        for z in (0.2, 1.05): P.box((x, 0.045, z), (0.12, 0.005, 0.02), 'iron')
    return P.done(0.0)

def stones(P, x0, x1, z0, z1, depth, sz=(0.22, 0.14), mat='rock', seed=0):
    """Dry stones in courses filling x0…x1 × z0…z1, depth deep (each a broken stone)."""
    z = z0
    k = 0
    while z < z1:
        h = sz[1] * R(0.8, 1.25)
        x = x0 + (0 if k % 2 == 0 else -sz[0] * 0.5)
        while x < x1:
            w = sz[0] * R(0.7, 1.4)
            a, b = max(x, x0), min(x + w, x1)
            if b - a > 0.05:
                bm = P.bm
                ico = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
                c = Vector(((a + b) / 2, 0, z + h / 2))
                off = Vector((R(0, 9), R(0, 9), seed))
                for v in ico['verts']:
                    p = v.co.normalized()
                    j = 1 + 0.18 * noise.noise(p * 2 + off)
                    v.co = c + Vector((p.x * (b - a) / 2 * j, p.y * depth / 2 * j, p.z * h / 2 * j))
                    for lp in v.link_loops: lp[P.uvl].uv = (v.co.x * KREP[mat] * 2, v.co.z * KREP[mat] * 2 + v.co.y)
                for f in {f for v in ico['verts'] for f in v.link_faces}: f.material_index = P.mi(mat); f.smooth = False
            x += w
        z += h * 0.92; k += 1

def wall_drystone(name):
    P = Part(name)
    stones(P, -CELL / 2, CELL / 2, -0.1, 0.85, 0.55, (0.3, 0.18), 'rock', 1)
    stones(P, -CELL / 2, CELL / 2, 0.85, 0.98, 0.42, (0.22, 0.13), 'rock', 2)
    return P.done(0.0, smooth=False)

def jetty(name):
    """3 m of jetty, 1.6 m wide: boards across stringers on posts running down 1.8 m into the water."""
    P = Part(name)
    for sx in (-1.35, 1.35):
        for sy in (-0.7, 0.7):
            P.tube([(sx, sy, -1.8), (sx, sy, 0.15)], [(0.09, 0.09)] * 2, 'bark', 8)
    for sy in (-0.65, 0.65): P.box((0, sy, -0.12), (1.5, 0.06, 0.08), 'planks')
    deck(P, 0.8, 0.0, 16, along='y', hw=1.5)
    return P.done(0.004)

def campfire(name):
    """A ring of stones round charred logs and ash."""
    P = Part(name)
    for i in range(10):
        a = i / 10 * 2 * math.pi + R(-0.1, 0.1)
        ico = bmesh.ops.create_icosphere(P.bm, subdivisions=1, radius=1.0)
        c = Vector((math.cos(a) * 0.62, math.sin(a) * 0.62, 0.06)); s = Vector((R(0.12, 0.17), R(0.1, 0.14), R(0.08, 0.12)))
        for v in ico['verts']:
            p = v.co.normalized(); j = 1 + 0.2 * noise.noise(p * 2 + Vector((i, 0, 0)))
            v.co = c + Vector((p.x * s.x * j, p.y * s.y * j, p.z * s.z * j))
            for lp in v.link_loops: lp[P.uvl].uv = (v.co.x * 3, v.co.y * 3 + v.co.z)
        for f in {f for v in ico['verts'] for f in v.link_faces}: f.material_index = P.mi('rock')
    P.box((0, 0, 0.01), (0.45, 0.45, 0.01), 'stone')
    for i in range(4):
        a = i / 4 * math.pi + 0.3
        P.tube([(math.cos(a) * 0.4, math.sin(a) * 0.4, 0.06), (-math.cos(a) * 0.15, -math.sin(a) * 0.15, 0.2)], [(0.045, 0.045)] * 2, 'bark', 7)
    return P.done(0.0)

def lamp_post(name):
    """A steel post on a stone foot, an arm, a lantern: its glass lit at night."""
    P = Part(name)
    P.box((0, 0, 0.12), (0.18, 0.18, 0.12), 'block')
    P.tube([(0, 0, 0.2), (0, 0, 2.7)], [(0.045, 0.045)] * 2, 'iron', 10)
    P.tube([(0, 0, 2.6), (0.35, 0, 2.75), (0.45, 0, 2.7)], [(0.018, 0.018)] * 3, 'iron', 6)
    P.box((0.45, 0, 2.48), (0.11, 0.11, 0.015), 'iron')
    P.box((0.45, 0, 2.3), (0.085, 0.085, 0.17), 'lamp')
    for sx in (-1, 1):
        for sy in (-1, 1): P.box((0.45 + sx * 0.09, sy * 0.09, 2.3), (0.012, 0.012, 0.19), 'iron')
    P.box((0.45, 0, 2.12), (0.1, 0.1, 0.012), 'iron')
    return P.done(0.004)


# ===================================================================================================== the plants
# (PLANT — step 5: each grows in when it's planted, sways in the wind: Pieces.ts. Foliage is CARDS of the leaf atlas
#  — plant_atlas.py's tiles, the same rects — their normals bent out from the plant's middle so it's lit as a mass)
TILES = {'broad': (0, .5, .5, 1), 'conifer': (.5, .5, 1, 1), 'grass': (0, 0, .25, .5), 'greens': (.25, 0, .5, .5),
         'daisy': (.5, .25, .75, .5), 'butter': (.75, .25, 1, .5), 'poppy': (.5, 0, .75, .25), 'aster': (.75, 0, 1, .25)}

def card(P, base, d, side, w, h, tile, bend=0.0, segs=2):
    """A foliage card from `base` along d (its length h), `side` across (w wide), bowed `bend` m toward its tip off its
    face; the tile's bottom middle at base."""
    u0, v0, u1, v1 = TILES[tile]
    d = Vector(d).normalized(); side = Vector(side).normalized(); nrm = d.cross(side).normalized()
    rows = []
    for k in range(segs + 1):
        t = k / segs; c = Vector(base) + d * h * t + nrm * bend * t * t
        rows.append((P.bm.verts.new(c - side * w / 2), P.bm.verts.new(c + side * w / 2), t))
    for k in range(segs):
        a, b, t0 = rows[k]; c2, d2, t1 = rows[k + 1]
        f = P.bm.faces.new((a, b, d2, c2)); f.material_index = P.mi('leaf')
        for lp, (uu, vv) in zip(f.loops, ((0, t0), (1, t0), (1, t1), (0, t1))):
            lp[P.uvl].uv = (u0 + (u1 - u0) * uu, v0 + (v1 - v0) * vv)

def head(P, c, n, r, tile):
    """A flower's head: a square card r across its middle at c, facing n."""
    u0, v0, u1, v1 = TILES[tile]
    n = Vector(n).normalized(); a = n.cross(Vector((0.3, 0.7, 0.1))).normalized(); b = n.cross(a)
    vs = [P.bm.verts.new(Vector(c) + (a * sx + b * sy) * r) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = P.bm.faces.new(vs); f.material_index = P.mi('leaf')
    for lp, (uu, vv) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): lp[P.uvl].uv = (u0 + (u1 - u0) * uu, v0 + (v1 - v0) * vv)

CORE_UV = (0.36, 0.2, 0.40, 0.3)   # (an opaque patch of the atlas's greens: a hedge's core, the flowers' stems)
def greened(P, before):
    """The faces made since `before` coloured the leaves' own green (their UVs into CORE_UV, the leaf material)."""
    u0, v0, u1, v1 = CORE_UV
    for f in set(P.bm.faces) - before:
        f.material_index = P.mi('leaf')
        for lp in f.loops: lp[P.uvl].uv = (u0 + (u1 - u0) * R(), v0 + (v1 - v0) * R())

def spin(a):
    return Vector((math.cos(a), math.sin(a), 0))

def foliage_done(P, centre_of, sway_h):
    """The plant made; its leaf cards' normals bent out from its middle (centre_of(v) — the point they're lit round),
    their sway weight (how far up the plant: 0 at the foot, 1 at sway_h) kept for the AO bake's alpha."""
    o = P.done(0.0)
    me = o.data
    leaf_i = ORDER.index('leaf')
    nl = []
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            if poly.material_index == leaf_i:
                d = v - centre_of(v); d.z = d.z * 0.7 + 0.35 * max(0.3, d.length)
                nl.append(d.normalized() if d.length > 1e-4 else Vector((0, 0, 1)))
            else:
                nl.append(poly.normal.copy() if not poly.use_smooth else me.vertices[me.loops[li].vertex_index].normal.copy())
    me.normals_split_custom_set(nl)
    o['sway_h'] = sway_h
    return o

def plant_pine(name):
    """A fir sapling, ~1.7 m: a tapering stem, whorls of sprigs splayed out and down, a leader at the top."""
    P = Part(name); H = 1.7
    P.tube([(0, 0, -0.05), (0.02, 0.01, H * 0.55), (0, 0.02, H)], [(0.045, 0.045), (0.03, 0.03), (0.008, 0.008)], 'bark', 7)
    for k, z in enumerate((0.32, 0.6, 0.86, 1.1, 1.32, 1.5)):
        f = z / H; n = 6 if f < 0.8 else 4; L = 0.75 * (1 - f) + 0.22
        for i in range(n):
            a = i / n * 2 * math.pi + k * 0.6 + R(-0.2, 0.2)
            d = spin(a) * 1.0 + Vector((0, 0, R(0.05, 0.35))); side = spin(a + math.pi / 2)
            card(P, (math.cos(a) * 0.03, math.sin(a) * 0.03, z), d, side + Vector((0, 0, R(-0.3, 0.3))), L * 0.85, L, 'conifer', -0.08 * L)
    for a in (0, math.pi / 2):
        card(P, (0, 0, H - 0.42), (0, 0, 1), spin(a), 0.36, 0.5, 'conifer')
    return foliage_done(P, lambda v: Vector((0, 0, max(0.2, min(H - 0.3, v.z)))), H)

def plant_birch(name):
    """A birch sapling, ~2.6 m: a pale stem, a few rising branches, a light crown of leaf sprays on them."""
    P = Part(name); H = 2.6
    P.tube([(0, 0, -0.05), (0.03, 0, 1.2), (-0.02, 0.03, H)], [(0.05, 0.05), (0.035, 0.035), (0.01, 0.01)], 'birch', 8)
    tips = []
    for i in range(6):
        a = i / 6 * 2 * math.pi + R(-0.3, 0.3); z0 = 1.0 + i * 0.22
        tip = Vector((math.cos(a) * R(0.45, 0.7), math.sin(a) * R(0.45, 0.7), z0 + R(0.35, 0.6)))
        P.tube([(0, 0, z0), ((tip.x) * 0.5, tip.y * 0.5, z0 + 0.25), tuple(tip)], [(0.018, 0.018), (0.012, 0.012), (0.005, 0.005)], 'birch', 5)
        tips.append(tip)
    tips.append(Vector((0, 0.03, H)))
    for tip in tips:
        for j in range(6):
            a = R(0, 2 * math.pi); up = R(-0.3, 0.8)
            d = (spin(a) + Vector((0, 0, up))).normalized()
            card(P, tip - d * 0.18, d, spin(a + math.pi / 2) + Vector((0, 0, R(-0.4, 0.4))), R(0.42, 0.55), R(0.5, 0.62), 'broad', -0.06)
    return foliage_done(P, lambda v: Vector((0, 0, 1.95)), H)

def plant_hedge(name):
    """3 m of clipped hedge, 1.15 m high and 0.8 deep: a dense leafy core, sprays thick over its faces and top (each
    lying along the face, leaning out a little — seen as leaves, not edge-on), a little ragged."""
    P = Part(name); L, H, D = CELL / 2, 1.15, 0.4
    # the core: the leaves' own green (an opaque patch of the atlas), shaded deep by the AO under the sprays
    before = set(P.bm.faces)
    P.box((0, 0, H * 0.47), (L - 0.1, D - 0.12, H * 0.45), 'leaf')
    greened(P, before)
    P.tube([(-1.0, 0, 0), (-1.0, 0, 0.3)], [(0.04, 0.04)] * 2, 'bark', 6); P.tube([(0.9, 0.05, 0), (0.9, 0.05, 0.25)], [(0.035, 0.035)] * 2, 'bark', 6)
    nx = 11
    for i in range(nx):
        x = -L + (i + 0.5) / nx * 2 * L
        for side in (-1, 1):
            for z in (0.0, 0.25, 0.5, 0.72):
                # (each spray turned its own way in the face's plane, leaning out — no rows of upright sprays)
                a = R(0.35, math.pi - 0.35)
                d = Vector((math.cos(a), side * R(0.12, 0.35), math.sin(a))).normalized()
                sv = d.cross(Vector((0, 1, 0))).normalized()
                card(P, (x + R(-0.12, 0.12) - d.x * 0.2, side * (D - 0.05), z + R(-0.06, 0.06)), d, sv, R(0.46, 0.6), R(0.46, 0.58), 'broad', side * 0.08)
        for j in range(3):
            a = R(0, math.pi)
            d = Vector((R(-0.5, 0.5), R(-0.5, 0.5), 1)).normalized()
            card(P, (x + R(-0.12, 0.12), R(-0.28, 0.28), H - 0.4), d, Vector((math.cos(a), math.sin(a), 0)), R(0.48, 0.58), R(0.5, 0.58), 'broad', 0.06)
    for sx in (-1, 1):   # (its ends closed)
        for z in (0.05, 0.45):
            for y in (-0.22, 0.22):
                d = Vector((sx * 0.3, 0, 1)).normalized()
                card(P, (sx * (L - 0.04), y, z), d, Vector((0, 1, 0)), 0.5, 0.55, 'broad', sx * 0.06)
    return foliage_done(P, lambda v: Vector((max(-L + 0.3, min(L - 0.3, v.x)), 0, 0.5)), H)

def bed(P, w, d, edge):
    """A raised bed w × d (its middle at the origin): a mound of soil, its edge of stones ('rock') or boards ('planks')."""
    bm = P.bm; nx, ny = 10, 6; vs = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = -w / 2 + w * i / nx; y = -d / 2 + d * j / ny
            e = min(i, nx - i, j, ny - j)
            z = 0.04 + (0.1 if e > 0 else 0.0) + (0.03 * noise.noise(Vector((x * 2, y * 2, 3))) if e > 0 else 0)
            vs[i, j] = bm.verts.new((x, y, z))
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1])); f.material_index = P.mi('soil')
            for lp in f.loops: lp[P.uvl].uv = (lp.vert.co.x * KREP['soil'], lp.vert.co.y * KREP['soil'])
    if edge == 'rock':
        k = 0
        per = 2 * (w + d); n = int(per / 0.26)
        for i in range(n):
            t = i / n * per
            if t < w: x, y = -w / 2 + t, -d / 2
            elif t < w + d: x, y = w / 2, -d / 2 + (t - w)
            elif t < 2 * w + d: x, y = w / 2 - (t - w - d), d / 2
            else: x, y = -w / 2, d / 2 - (t - 2 * w - d)
            ico = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            sz = Vector((R(0.11, 0.16), R(0.09, 0.13), R(0.07, 0.1))); off = Vector((i, 0, 0))
            for v in ico['verts']:
                p = v.co.normalized(); j = 1 + 0.2 * noise.noise(p * 2 + off)
                v.co = Vector((x, y, 0.05)) + Vector((p.x * sz.x * j, p.y * sz.y * j, p.z * sz.z * j))
                for lp in v.link_loops: lp[P.uvl].uv = (v.co.x * 3, v.co.y * 3 + v.co.z)
            for f in {f for v in ico['verts'] for f in v.link_faces}: f.material_index = P.mi('stone'); f.smooth = False
    else:
        for sy in (-1, 1): P.box((0, sy * (d / 2 + 0.03), 0.1), (w / 2 + 0.06, 0.03, 0.12), 'planks')
        for sx in (-1, 1): P.box((sx * (w / 2 + 0.03), 0, 0.1), (d / 2, 0.03, 0.12), 'planks', Vector((0, 1, 0)), Vector((1, 0, 0)))
        for sx in (-1, 1):
            for sy in (-1, 1): P.box((sx * (w / 2 + 0.03), sy * (d / 2 + 0.03), 0.12), (0.04, 0.04, 0.16), 'bark')

def plant_flowers(name):
    """A flower bed, 2.4 × 1.2 m in a ring of stones: leafy clumps, and daisies, buttercups, poppies, asters above them."""
    P = Part(name); w, d = 2.4, 1.2
    bed(P, w, d, 'rock')
    kinds = ['daisy', 'butter', 'poppy', 'aster']
    for c in range(16):
        cx, cy = R(-w / 2 + 0.25, w / 2 - 0.25), R(-d / 2 + 0.2, d / 2 - 0.2)
        kind = kinds[(c + int(cx * 2)) % 4]
        for a in (R(0, 3), R(0, 3) + math.pi / 2):
            card(P, (cx, cy, 0.12), (R(-0.2, 0.2), R(-0.2, 0.2), 1), spin(a), 0.26, R(0.22, 0.32), 'grass', 0.04)
        for k in range(4):
            a = R(0, 2 * math.pi); r = R(0.02, 0.12); h = R(0.3, 0.52)
            top = Vector((cx + math.cos(a) * r, cy + math.sin(a) * r, 0.12 + h))
            before = set(P.bm.faces)
            P.tube([(cx, cy, 0.12), tuple(top)], [(0.005, 0.005), (0.0035, 0.0035)], 'leaf', 3, caps=False)
            greened(P, before)
            head(P, top, (math.cos(a) * 0.4, math.sin(a) * 0.4, 1), R(0.045, 0.07) if kind != 'poppy' else R(0.06, 0.08), kind)
    return foliage_done(P, lambda v: Vector((v.x, v.y, 0.0)), 0.6)

def plant_veg(name):
    """A vegetable patch, 2.8 × 1.6 m in a board edge: three rows of greens (each a rosette of crossed leaf cards),
    a row of onions (grass tufts), a stake at each end of the rows."""
    P = Part(name); w, d = 2.8, 1.6
    bed(P, w, d, 'planks')
    for row, y in enumerate((-0.5, -0.05, 0.4)):
        for i in range(6):
            x = -w / 2 + 0.3 + i * (w - 0.6) / 5 + R(-0.05, 0.05)
            if row == 2:
                for a in (0, math.pi / 2, math.pi / 4):
                    card(P, (x, y, 0.12), (R(-0.1, 0.1), R(-0.1, 0.1), 1), spin(a + R(-0.2, 0.2)), 0.22, R(0.3, 0.4), 'grass', 0.03)
                continue
            for k in range(5):
                a = k / 5 * 2 * math.pi + R(-0.3, 0.3)
                dd = (spin(a) * 0.8 + Vector((0, 0, 1.0))).normalized()
                card(P, (x, y, 0.13), dd, spin(a + math.pi / 2), R(0.2, 0.26), R(0.3, 0.4), 'greens', -0.06)
        for sx in (-1, 1):
            P.tube([(sx * (w / 2 - 0.12), y, 0.0), (sx * (w / 2 - 0.12), y, 0.55)], [(0.018, 0.018), (0.014, 0.014)], 'bark', 5)
    return foliage_done(P, lambda v: Vector((v.x, v.y, 0.0)), 0.45)

WIN = (-0.55, 0.55, 0.95, 1.95, 'window')
DOOR = (-0.5, 0.5, 0.0, 2.1, 'door')
parts = [
    foundation('foundation_stone'), foundation('foundation_wood', wood=True), floor_plank('floor_plank'), steps('steps_stone'),
    wall_log('wall_log'), wall_log('wall_log_window', WIN), wall_log('wall_log_door', DOOR),
    stone_wall('wall_stone'), stone_wall('wall_stone_window', WIN), stone_wall('wall_stone_door', DOOR),
    plank_wall('wall_plank'), plank_wall('wall_garage', garage=True),
    roof('roof_shingle'), ridge('roof_shingle_ridge'), roof('roof_tin', tin=True), chimney('chimney_stone'),
    porch_deck('porch_deck'), porch_roof('porch_roof'), porch_post('porch_post'), fence_rail('fence_rail'), fence_gate('fence_gate'),
    wall_drystone('wall_drystone'), jetty('jetty'), campfire('campfire'), lamp_post('lamp_post'),
    plant_pine('plant_pine'), plant_birch('plant_birch'), plant_hedge('plant_hedge'), plant_flowers('plant_flowers'), plant_veg('plant_veg'),
]
for o in parts: o.data.calc_loop_triangles()
log('pieces: ' + ', '.join(f'{o.name} {len(o.data.loop_triangles)}' for o in parts))

# ===================================================================================================== ambient occlusion
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 32
sc.world = sc.world or bpy.data.worlds.new('w')
for o in parts:
    ca = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
    o.data.color_attributes.active_color = ca
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    sc.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO')
# (the plants: their SWAY in the AO's alpha — 0 at the foot, 1 at the plant's height: Pieces.ts SWAY bends them)
for o in parts:
    if 'sway_h' not in o: continue
    me = o.data; ca = me.color_attributes['AO']; H = o['sway_h']; leaf_i = ORDER.index('leaf')
    for poly in me.polygons:
        for li in poly.loop_indices:
            z = me.vertices[me.loops[li].vertex_index].co.z
            c = ca.data[li].color
            w = min(1.0, max(0.0, z / H)) ** 1.5 if poly.material_index == leaf_i else 0.0
            # (cards lit through: the AO they baked as solid quads eased)
            if poly.material_index == leaf_i: c = [0.6 + 0.4 * c[0], 0.6 + 0.4 * c[1], 0.6 + 0.4 * c[2], 1]
            ca.data[li].color = (c[0], c[1], c[2], w)
log('ambient occlusion baked into the vertices')
# THE FAR LOD (2026-11-09 — a homestead seen from 60 m+: the pieces' small parts dropped, decimated to ~15 %; the
# plants kept whole — a few hundred triangles each already): Pieces.ts draws a claim's far set past ~45 m off it
lods = [far_lod(o, int(max(48, len(o.data.loop_triangles) * 0.15)), 0.15) for o in parts if 'sway_h' not in o]
for o in lods: o.hide_render = True
log('far: ' + ', '.join(f'{o.name} {len(o.data.loop_triangles)}' for o in lods))

# ===================================================================================================== out
# the end grain image (the logs' cut ends) — as gather_assets.py draws it
def end_grain_img(N=512):
    y, x = np.mgrid[0:N, 0:N] / N - 0.5
    r = np.hypot(x, y) * 2; a = np.arctan2(y, x)
    rr = r + (0.03 * np.sin(a * 3 + 1.3) + 0.02 * np.sin(a * 7 + 0.4)) * r
    late = (0.5 + 0.5 * np.sin(rr * 2 * np.pi * 14 + 2.5 * np.sin(rr * 9))) ** 6
    c = np.array([0.80, 0.64, 0.43])[None, None] * (1 - late[..., None] * 0.55) + np.array([0.55, 0.38, 0.22])[None, None] * late[..., None] * 0.55
    bark = np.clip((rr - 0.9) / 0.05, 0, 1)[..., None]; c = c * (1 - bark) + np.array([0.18, 0.12, 0.08]) * bark
    h = late * 0.4
    gy, gx = np.gradient(h); nrm = np.dstack([-gx * 6, -gy * 6, np.ones_like(h)]); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    return np.clip(c, 0, 1), nrm * 0.5 + 0.5
os.makedirs(TEXDIR, exist_ok=True)
def save_webp(img, path, q):
    sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.quality = q
    img.save_render(path, scene=sc)
sc.view_settings.view_transform = 'Standard'
meta = {'cell': CELL, 'floor': FLOOR, 'wallH': WALL_H, 'pitch': PITCH, 'eave': EAVE, 'materials': {}, 'pieces': [o.name for o in parts]}
written = {}
for n, (asset, k, tint) in MATS.items():
    if asset and asset.startswith('@'):
        meta['materials'][n] = {'k': 1, 'tint': tint, 'tex': asset[1:], 'clamp': True, 'cut': True, 'sway': True}
    elif asset and asset in written:
        meta['materials'][n] = {'k': k, 'tint': tint, 'tex': written[asset]}
    elif asset:
        written[asset] = n
        for kind, suffix, q in (('Color', '', 88), ('NormalGL', '_n', 90)):
            im = bpy.data.images.load(os.path.join(ACG, asset, f'{asset}_1K-JPG_{kind}.jpg'))
            if kind == 'NormalGL': im.colorspace_settings.name = 'Non-Color'
            save_webp(im, os.path.join(TEXDIR, f'{n}{suffix}.webp'), q)
        meta['materials'][n] = {'k': k, 'tint': tint, 'tex': n}
    elif n == 'end':
        c, nm = end_grain_img()
        for arr, suffix in ((c, ''), (nm, '_n')):
            im = bpy.data.images.new(f'end{suffix}', arr.shape[1], arr.shape[0]); im.pixels = np.dstack([arr, np.ones(arr.shape[:2])]).astype(np.float32).ravel()
            if suffix: im.colorspace_settings.name = 'Non-Color'
            save_webp(im, os.path.join(TEXDIR, f'end{suffix}.webp'), 90)
        meta['materials'][n] = {'k': 1, 'tint': tint, 'tex': 'end', 'clamp': True}
    else:
        meta['materials'][n] = {'k': 1, 'tint': tint, 'flat': list(tint), 'emit': n == 'lamp'}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT[:-4] + '.json', 'w') as f: json.dump(meta, f, indent=1)
log(f'wrote the textures to {TEXDIR}, the table to {OUT[:-4]}.json')

if PREVIEW:
    # A HOMESTEAD of the kit's pieces: a log cabin two cells long (a door, windows, a chimney, its porch and steps), a
    # stone shed with a tin roof, a barn-board garage, a fence and its gate, a dry-stone wall, a fire ring, a lamp
    sc.render.engine = next((e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]))
    vts = [v.identifier for v in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform = 'AgX' if 'AgX' in vts else 'Filmic'
    for o in parts:
        # (the vertex AO multiplied in, for the look)
        for m in o.data.materials:
            if not m or not m.use_nodes: continue
            t = m.node_tree; b = t.nodes['Principled BSDF']
            if t.nodes.get('AOMUL'): continue
            ca = t.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'AO'
            mx = t.nodes.new('ShaderNodeMix'); mx.name = 'AOMUL'; mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 0.85
            lk = b.inputs['Base Color'].links
            if lk: t.links.new(lk[0].from_socket, mx.inputs['A'])
            else: mx.inputs['A'].default_value = b.inputs['Base Color'].default_value
            t.links.new(ca.outputs['Color'], mx.inputs['B']); t.links.new(mx.outputs['Result'], b.inputs['Base Color'])
    c, nm = end_grain_img()
    eimg = bpy.data.images.new('endprev', c.shape[1], c.shape[0]); eimg.pixels = np.dstack([c, np.ones(c.shape[:2])]).astype(np.float32).ravel()
    t = M['end'].node_tree; ti = t.nodes.new('ShaderNodeTexImage'); ti.image = eimg
    uvn = t.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'; t.links.new(uvn.outputs['UV'], ti.inputs['Vector'])
    t.links.new(ti.outputs['Color'], t.nodes['AOMUL'].inputs['A'] if t.nodes.get('AOMUL') else t.nodes['Principled BSDF'].inputs['Base Color'])
    lib = {o.name: o for o in parts}
    for o in parts: o.hide_render = True
    col = sc.collection
    def put(name, x, y, z=0.0, rot=0.0):
        src = lib[name]; o = src.copy(); o.hide_render = False; col.objects.link(o)
        o.location = (x, y, z); o.rotation_euler = (0, 0, rot); return o
    C, F, W = CELL, FLOOR, WALL_H
    # the cabin: cells at x 0 and 3, y 0
    for x in (0, C): put('foundation_stone', x, 0)
    put('wall_log_door', 0, -C / 2, F); put('wall_log_window', C, -C / 2, F)
    put('wall_log_window', 0, C / 2, F, math.pi); put('wall_log', C, C / 2, F, math.pi)
    put('wall_log', -C / 2, 0, F, -math.pi / 2); put('wall_log_window', C * 1.5, 0, F, math.pi / 2)
    for x in (0, C): put('roof_shingle', x, 0, F + W)
    put('chimney_stone', C * 1.5 + 0.45, 0.8, 0)
    put('porch_deck', 0, -C / 2 - 1.0); put('porch_roof', 0, -C / 2 - 1.0)
    # the shed: stone walls, a tin roof — beside it
    sx = -6.5
    put('foundation_stone', sx, 0)
    put('wall_stone_door', sx, -C / 2, F); put('wall_stone_window', sx, C / 2, F, math.pi)
    put('wall_stone', sx - C / 2, 0, F, -math.pi / 2); put('wall_stone', sx + C / 2, 0, F, math.pi / 2)
    put('roof_tin', sx, 0, F + W)
    # the garage: barn boards, its door
    gx = 9.5
    put('foundation_wood', gx, 0)
    put('wall_garage', gx, -C / 2, F); put('wall_plank', gx, C / 2, F, math.pi)
    put('wall_plank', gx - C / 2, 0, F, -math.pi / 2); put('wall_plank', gx + C / 2, 0, F, math.pi / 2)
    put('roof_shingle', gx, 0, F + W, 0)
    # the yard
    for k in range(4): put('fence_rail', -7 + k * C, -8.5)
    put('fence_gate', -7 + 4 * C, -8.5)
    put('fence_rail', -7 + 5 * C, -8.5)
    for k in range(3): put('wall_drystone', -9.5, -5 + k * C, 0, math.pi / 2)
    put('campfire', 4.5, -5.5); put('lamp_post', -2.5, -4.6)
    # the garden: a hedge along the front, a flower bed, the vegetable patch, saplings
    for k in range(3): put('plant_hedge', 14 + k * C, -6)
    put('plant_flowers', 16, -9.5); put('plant_veg', 20.5, -9.5)
    put('plant_pine', 13.5, -11); put('plant_birch', 24, -7.5); put('plant_pine', 24.5, -11.5, 0, 1.0)
    bpy.ops.mesh.primitive_plane_add(size=80); pl = bpy.context.object
    pm = bpy.data.materials.new('ground'); pm.use_nodes = True; pm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.13, 0.17, 0.08, 1); pl.data.materials.append(pm)
    w = bpy.data.worlds.new('w2'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.6; sun.rotation_euler = (math.radians(52), 0, math.radians(30)); col.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); sc.camera = cam; cam.data.lens = 32
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    for tag, loc, tgt in (('homestead', (11, -24, 9), (1.5, -2, 1.5)), ('cabin', (6, -11, 3.2), (1.5, 0, 2.2)), ('detail', (2.6, -5.2, 1.6), (0.6, -1.5, 1.4)), ('shed', (-3.5, -9, 2.4), (-6.5, 0, 1.6)), ('garden', (18.5, -17, 3.0), (18.5, -8.5, 0.6)), ('flowers', (16.5, -11.6, 1.2), (16.2, -9.4, 0.2))):
        cam.location = loc; cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'kit_{tag}.png'); bpy.ops.render.render(write_still=True)
    log('preview rendered')
    for o in [o for o in bpy.data.objects if o.name not in lib and o.type == 'MESH']: bpy.data.objects.remove(o)
    for o in parts: o.hide_render = False

# the materials stripped to their names (the game has the textures): no images in the GLB
for m in bpy.data.materials:
    if m.use_nodes:
        t = m.node_tree
        for n in list(t.nodes):
            if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'): t.nodes.remove(n)
bpy.ops.object.select_all(action='DESELECT')
for o in parts + lods: o.select_set(True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=True,
                          export_materials='EXPORT', export_vertex_color='ACTIVE', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_draco_color_quantization=10)
n = sum(len(o.data.loop_triangles) for o in parts)
log(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.0f} kB, {len(parts)} pieces, {n} triangles')
