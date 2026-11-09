# OVERHILL — GATHERING'S THINGS, modelled (2026-11-09, the user: "make sure all look realistic … not boxes … good quality
# and graphics"): what the valley's gathering puts on the ground and in his hands — LOGS (two, a little bent and
# uneven, fir bark, the cut ends' rings), STONES (three, broken and weathered), a STUMP (its roots flaring, rings on
# the cut), the AXE (a curved hickory handle, a forged head, its bit bright where it's sharpened), the PICK, SCRAP (a
# rusted bent sheet, a pipe) and a STAKE (the stockpile's frame). Each its own scanned material (ambientCG, CC0:
# Bark014, Rock028, Wood049, Metal055A, Rust009; the end grain drawn here), BAKED into one atlas — colour and normals —
# so the game draws them all with one material (the character's: the map, its normal map, the world's light).
#
#   blender -b --factory-startup --python scripts/oth/gather_assets.py -- [OUT=src/assets/models/props/gather.glb]
#           [TEX=1024] [PREVIEW=<dir>]
#
# Units: metres, Blender z up (the game's y). Each piece at the origin: a log along x (1.6 m, its middle at 0); a stone
# on its flat underside at z 0; the stump from z 0; the tools' handles along z from their grip end (0) to the head; the
# stake from z 0 to its point.
import sys, os, math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'props', 'gather.glb')))
TEX = int(kw.get('TEX', '1024'))
PREVIEW = kw.get('PREVIEW')
ACG = os.path.join(HERE, '.cache', 'ambientcg')
def log(*a): print('[gather]', *a, flush=True)

for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc = bpy.context.scene
col = sc.collection
rng = np.random.default_rng(7)

# ===================================================================================================== materials
def pbr(name, asset, scale=1.0, tint=(1, 1, 1), rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; t = m.node_tree
    b = t.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    uv = t.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
    mp = t.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale); t.links.new(uv.outputs['UV'], mp.inputs['Vector'])
    c = t.nodes.new('ShaderNodeTexImage'); c.image = bpy.data.images.load(os.path.join(ACG, asset, f'{asset}_1K-JPG_Color.jpg')); t.links.new(mp.outputs['Vector'], c.inputs['Vector'])
    mx = t.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
    t.links.new(c.outputs['Color'], mx.inputs['A']); mx.inputs['B'].default_value = (*tint, 1); t.links.new(mx.outputs['Result'], b.inputs['Base Color'])
    n = t.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(os.path.join(ACG, asset, f'{asset}_1K-JPG_NormalGL.jpg')); n.image.colorspace_settings.name = 'Non-Color'
    t.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    nm = t.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'; t.links.new(n.outputs['Color'], nm.inputs['Color']); t.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m

def end_grain():
    """The cut end: growth rings round the pith (warped a little, never perfect circles), the pale sapwood, the bark's
    rim, a few checks (drying cracks) out from the middle — drawn here, colour and its relief."""
    N = 512
    y, x = np.mgrid[0:N, 0:N] / N - 0.5
    r = np.hypot(x, y) * 2; a = np.arctan2(y, x)
    warp = 0.03 * np.sin(a * 3 + 1.3) + 0.02 * np.sin(a * 7 + 0.4) + 0.012 * np.sin(a * 13)
    rr = r + warp * r
    rings = 0.5 + 0.5 * np.sin(rr * 2 * np.pi * 16 + 2.5 * np.sin(rr * 9))
    late = rings ** 6
    light = np.array([0.80, 0.64, 0.43]); dark = np.array([0.55, 0.38, 0.22])
    c = light[None, None] * (1 - late[..., None] * 0.55) + dark[None, None] * late[..., None] * 0.55
    sap = np.clip((rr - 0.78) / 0.06, 0, 1)[..., None]; c = c * (1 - sap * 0.0) + np.array([0.86, 0.72, 0.52]) * sap * 0.25 + c * 0
    bark = np.clip((rr - 0.92) / 0.04, 0, 1)[..., None]; c = c * (1 - bark) + np.array([0.18, 0.12, 0.08]) * bark
    pith = np.exp(-(r / 0.04) ** 2)[..., None]; c = c * (1 - pith * 0.6) + np.array([0.35, 0.22, 0.12]) * pith * 0.6
    h = late * 0.4
    for k, (ca, L, w) in enumerate(((0.7, 0.62, 0.007), (2.9, 0.34, 0.005))):
        da = np.angle(np.exp(1j * (a - ca - 0.18 * np.sin(rr * 11 + k) - 0.05 * np.sin(rr * 37))))
        crack = np.exp(-(da * rr / (w * (1.2 - rr / L))) ** 2) * (rr < L) * (rr > 0.04)
        c = c * (1 - crack[..., None] * 0.7); h = h - crack * 1.2
    g = np.random.default_rng(3).normal(0, 1, (N, N)); c *= (0.94 + 0.04 * g)[..., None]
    img = bpy.data.images.new('endgrain', N, N); img.pixels = np.dstack([np.clip(c, 0, 1), np.ones((N, N))]).astype(np.float32).ravel()
    gy, gx = np.gradient(h)
    nrm = np.dstack([-gx * 6, -gy * 6, np.ones_like(h)]); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    nimg = bpy.data.images.new('endgrain_n', N, N); nimg.colorspace_settings.name = 'Non-Color'
    nimg.pixels = np.dstack([nrm * 0.5 + 0.5, np.ones((N, N))]).astype(np.float32).ravel()
    m = bpy.data.materials.new('end'); m.use_nodes = True; t = m.node_tree; b = t.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 0.85
    uv = t.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'
    ti = t.nodes.new('ShaderNodeTexImage'); ti.image = img; t.links.new(uv.outputs['UV'], ti.inputs['Vector']); t.links.new(ti.outputs['Color'], b.inputs['Base Color'])
    tn = t.nodes.new('ShaderNodeTexImage'); tn.image = nimg; t.links.new(uv.outputs['UV'], tn.inputs['Vector'])
    nm = t.nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'; t.links.new(tn.outputs['Color'], nm.inputs['Color']); t.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m

M_BARK = pbr('bark', 'Bark014', 1.0, (0.92, 0.88, 0.85))
M_END = end_grain()
M_ROCK = pbr('rock', 'Rock028', 2.0, (0.95, 0.95, 0.95))
M_HANDLE = pbr('handle', 'Wood049', 1.0, (1.0, 0.86, 0.66))
M_IRON = pbr('iron', 'Metal055A', 2.0, (0.72, 0.72, 0.74), 0.45, 0.9)
M_EDGE = pbr('edge', 'Metal055A', 3.0, (2.1, 2.1, 2.15), 0.3, 1.0)
M_RUST = pbr('rust', 'Rust009', 1.5, (1, 1, 1), 0.9, 0.3)

def obj(name, bm, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    o = bpy.data.objects.new(name, me); col.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    return o

def ring_uv(bm, uvl, f, u0, v0, ku, kv):
    for lp in f.loops: lp[uvl].uv = (u0 + lp.vert.co.x * ku, v0 + lp.vert.co.y * kv)

# ===================================================================================================== logs
def make_log(name, seed, L=1.6, R=0.12):
    """A log along x: 16 sides, 10 rings; its radius uneven round it and along it, a slight bend, a taper; its ends cut
    (end grain), the cut a little off square."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    S, K = 16, 10
    rings = []
    for k in range(K + 1):
        t = k / K; x = (t - 0.5) * L
        ring = []
        for s in range(S):
            a = s / S * 2 * math.pi
            n = noise.noise(Vector((math.cos(a) * 1.7, math.sin(a) * 1.7, x * 1.3 + seed)))
            r = R * (1.0 - 0.07 * t) * (1 + 0.07 * n + 0.025 * math.sin(a * 5 + seed))
            bend = 0.025 * math.sin(math.pi * t) * (1 if seed % 2 else -1)
            ring.append(bm.verts.new((x + (0.012 * math.cos(a) if k in (0, K) else 0), math.cos(a) * r + bend, math.sin(a) * r)))
        rings.append(ring)
    circ = 2 * math.pi * R
    for k in range(K):
        for s in range(S):
            a, b, c, d = rings[k][s], rings[k + 1][s], rings[k + 1][(s + 1) % S], rings[k][(s + 1) % S]
            f = bm.faces.new((a, b, c, d)); f.material_index = 0
            for lp, (uu, vv) in zip(f.loops, ((s, k), (s, k + 1), (s + 1, k + 1), (s + 1, k))):
                lp[uvl].uv = (uu / S * circ / 0.6, (vv / K) * L / 0.6)
    for end, sign in ((0, -1), (K, 1)):
        ring = rings[end] if sign > 0 else list(reversed(rings[end]))
        f = bm.faces.new(ring); f.material_index = 1
        for lp in f.loops: lp[uvl].uv = (0.5 + lp.vert.co.y / (2.05 * R), 0.5 + lp.vert.co.z / (2.05 * R))
    bm.normal_update()
    return obj(name, bm, [M_BARK, M_END])

# ===================================================================================================== stones
def make_stone(name, seed, R=0.12, sq=(1.25, 1.0, 0.78)):
    """A stone: an icosphere broken by noise (two scales: its shape, its facets), squashed, flat underneath."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=R)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in bm.verts:
        p = v.co.normalized()
        n1 = noise.noise(p * 1.6 + off); n2 = noise.noise(p * 4.5 + off * 2)
        cut = max(0.0, noise.noise(p * 2.2 - off)) * 0.25   # (broken faces: flatter where the noise is high)
        v.co = p * R * (1 + 0.28 * n1 + 0.07 * n2 - cut)
        v.co.x *= sq[0]; v.co.y *= sq[1]; v.co.z *= sq[2]
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        if v.co.z < zmin * 0.55: v.co.z = zmin * 0.55 + (v.co.z - zmin * 0.55) * 0.25
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts: v.co.z -= zmin
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    o = obj(name, bm, [M_ROCK])
    dm = o.modifiers.new('dec', 'DECIMATE'); dm.ratio = 0.45
    bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.object.modifier_apply(modifier='dec')
    # (its own unwrap for the rock's scan: the icosphere comes without UVs)
    o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT'); o.select_set(False)
    return o

# ===================================================================================================== the stump
def make_stump(name, R=0.33, H=0.42):
    """A stump: its sides bark, its roots flaring into the ground (five), the cut top rings, a little sloped."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    S, K = 24, 8
    rings = []
    for k in range(K + 1):
        t = k / K; z = -0.06 + t * (H + 0.06)
        ring = []
        for s in range(S):
            a = s / S * 2 * math.pi
            flare = 0.55 * math.exp(-(z + 0.06) / 0.12) * max(0.0, math.cos(5 * a + 0.7)) ** 3 + 0.12 * math.exp(-(z + 0.06) / 0.2)
            r = R * (1 + flare + 0.05 * noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, z * 3))))
            zz = z + (0.03 * math.cos(a) if k == K else 0)
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, zz)))
        rings.append(ring)
    circ = 2 * math.pi * R
    for k in range(K):
        for s in range(S):
            f = bm.faces.new((rings[k][s], rings[k][(s + 1) % S], rings[k + 1][(s + 1) % S], rings[k + 1][s])); f.material_index = 0
            for lp, (uu, vv) in zip(f.loops, ((s, k), (s + 1, k), (s + 1, k + 1), (s, k + 1))):
                lp[uvl].uv = (uu / S * circ / 0.7, vv / K * (H + 0.06) / 0.7)
    f = bm.faces.new(rings[K]); f.material_index = 1
    for lp in f.loops: lp[uvl].uv = (0.5 + lp.vert.co.x / (2.1 * R), 0.5 + lp.vert.co.y / (2.1 * R))
    bm.normal_update()
    return obj(name, bm, [M_BARK, M_END])

# ===================================================================================================== tools
def tube(bm, uvl, path, radii, mat, sides=10, ov=0.0):
    """A tube along `path` (points), its cross-section an ellipse (radii[i] = (a, b)), its UVs along it."""
    rings = []
    for i, p in enumerate(path):
        d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        side = d.cross(Vector((0, 1, 0))).normalized() if abs(d.y) < 0.9 else d.cross(Vector((1, 0, 0))).normalized()
        up = side.cross(d).normalized()
        a, b = radii[i]
        rings.append([bm.verts.new(p + side * math.cos(s / sides * 2 * math.pi) * a + up * math.sin(s / sides * 2 * math.pi) * b) for s in range(sides)])
    L = sum((path[i + 1] - path[i]).length for i in range(len(path) - 1)); acc = [0.0]
    for i in range(len(path) - 1): acc.append(acc[-1] + (path[i + 1] - path[i]).length)
    for i in range(len(path) - 1):
        for s in range(sides):
            f = bm.faces.new((rings[i][s], rings[i][(s + 1) % sides], rings[i + 1][(s + 1) % sides], rings[i + 1][s])); f.material_index = mat
            for lp, (uu, vv) in zip(f.loops, ((s, acc[i]), (s + 1, acc[i]), (s + 1, acc[i + 1]), (s, acc[i + 1]))):
                lp[uvl].uv = (vv / max(L, 1e-3) * 0.9 + ov, uu / sides * 0.12)   # (the grain along it)
    f = bm.faces.new(list(reversed(rings[0]))); f.material_index = mat
    f = bm.faces.new(rings[-1]); f.material_index = mat
    return rings

def handle_path(L, curve):
    pts = []
    for i in range(13):
        t = i / 12
        pts.append(Vector((curve * math.sin(math.pi * t) * (1 - t * 0.4), 0, t * L)))
    return pts

def make_axe(name):
    """The axe: a hickory handle (an S of a curve, oval, swelling to a knob at the grip), a forged head — the eye round the
    handle's top, the cheeks narrowing to the bit, the bit flaring and bright where it's sharpened."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    L = 0.74
    path = handle_path(L, 0.022)
    radii = [((0.021 if i == 0 else 0.016 + 0.003 * math.exp(-i)) * (1.0 - 0.1 * i / 12), (0.013 if i == 0 else 0.0105) ) for i in range(13)]
    tube(bm, uvl, path, radii, 0)
    # the head: a lofted section from the poll (back) through the eye to the bit (front, +x)
    top = L - 0.02
    sections = [  # (x, half-height, half-thickness)
        (-0.045, 0.030, 0.016), (-0.025, 0.034, 0.022), (0.0, 0.034, 0.024), (0.025, 0.032, 0.018),
        (0.06, 0.034, 0.009), (0.095, 0.045, 0.004), (0.118, 0.058, 0.0012)]
    rings = []
    for (x, hh, ht) in sections:
        ring = []
        for (yy, zz) in ((-ht, -hh), (ht, -hh), (ht, hh), (-ht, hh)):
            curve = 0.012 * (x / 0.118) ** 2 if x > 0 else 0
            ring.append(bm.verts.new((x, yy, top + zz + (curve if zz > 0 else -curve * 0.6))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(4):
            f = bm.faces.new((rings[i][s], rings[i][(s + 1) % 4], rings[i + 1][(s + 1) % 4], rings[i + 1][s]))
            f.material_index = 2 if i >= len(rings) - 2 else 1
            for lp in f.loops: lp[uvl].uv = (0.5 + lp.vert.co.x * 3, 0.5 + (lp.vert.co.z - top) * 3)
    f = bm.faces.new(list(reversed(rings[0]))); f.material_index = 1
    f = bm.faces.new(rings[-1]); f.material_index = 2
    for lp in f.loops: lp[uvl].uv = (0.5, 0.5 + (lp.vert.co.z - top) * 3)
    bm.normal_update()
    o = obj(name, bm, [M_HANDLE, M_IRON, M_EDGE])
    bev = o.modifiers.new('bev', 'BEVEL'); bev.width = 0.0025; bev.segments = 2; bev.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.object.modifier_apply(modifier='bev'); o.select_set(False)
    return o

def make_pick(name):
    """The pick: a longer handle; the head a bar through the eye, curving down to a point one side and a chisel the
    other."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    L = 0.86
    path = handle_path(L, 0.012)
    tube(bm, uvl, path, [((0.02 if i == 0 else 0.017) * (1 - 0.06 * i / 12), 0.0125) for i in range(13)], 0)
    top = L - 0.025
    pts, rad = [], []
    for i in range(15):
        t = i / 14 * 2 - 1
        x = t * 0.29
        z = top + 0.02 - 0.075 * t * t
        pts.append(Vector((x, 0, z)))
        w = 0.022 * (1 - abs(t) ** 1.6) + 0.004
        rad.append((w * (1.4 if t > 0.6 else 1.0), w * (0.35 if t > 0.6 else 1.0)))
    tube(bm, uvl, pts, rad, 1, sides=8, ov=0.5)
    bm.normal_update()
    o = obj(name, bm, [M_HANDLE, M_IRON])
    return o

# ===================================================================================================== scrap, the stake
def make_sheet(name):
    """A rusted sheet of steel, bent and dented."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_grid(bm, x_segments=8, y_segments=6, size=0.2)
    for v in bm.verts:
        v.co.y *= 0.75
        v.co.z = 0.06 * math.sin(v.co.x * 9) * max(0, v.co.x) + 0.02 * noise.noise(v.co * 8)
    for f in bm.faces:
        for lp in f.loops: lp[uvl].uv = (lp.vert.co.x + 0.5, lp.vert.co.y + 0.5)
    for v in bm.verts: v.co.z += 0.012
    o = obj(name, bm, [M_RUST])
    s = o.modifiers.new('sol', 'SOLIDIFY'); s.thickness = 0.004
    bpy.context.view_layer.objects.active = o; o.select_set(True); bpy.ops.object.modifier_apply(modifier='sol'); o.select_set(False)
    return o

def make_pipe(name):
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    pts = [Vector((-0.25 + 0.5 * t / 6, 0, 0.035 + 0.01 * math.sin(t))) for t in range(7)]
    tube(bm, uvl, pts, [(0.034, 0.034)] * 7, 0, sides=12)
    bm.normal_update()
    return obj(name, bm, [M_RUST])

def make_stake(name, H=1.15, R=0.045):
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    pts = [Vector((0.006 * math.sin(i), 0, -0.25 + i / 8 * (H + 0.25 - 0.12))) for i in range(9)]
    rings = tube(bm, uvl, pts, [(R * (1 - 0.1 * i / 8), R * (1 - 0.1 * i / 8)) for i in range(9)], 0, sides=8)
    tip = bm.verts.new((0, 0, H))
    top = rings[-1]
    for f in [f for f in bm.faces if set(f.verts) == set(top)]: bm.faces.remove(f)
    for s in range(len(top)):
        f = bm.faces.new((top[s], top[(s + 1) % len(top)], tip)); f.material_index = 1
        for lp in f.loops: lp[uvl].uv = (0.5 + lp.vert.co.x / (2.2 * R), 0.5 + lp.vert.co.y / (2.2 * R))
    bm.normal_update()
    return obj(name, bm, [M_BARK, M_END])

parts = [make_log('log_a', 1), make_log('log_b', 2), make_stone('stone_a', 1), make_stone('stone_b', 2, sq=(1.1, 0.95, 0.9)),
         make_stone('stone_c', 3, sq=(1.35, 0.9, 0.7)), make_stump('stump'), make_axe('axe'), make_pick('pick'),
         make_sheet('scrap_sheet'), make_pipe('scrap_pipe'), make_stake('stake')]
for o in parts:
    me = o.data; me.calc_loop_triangles()
log('made: ' + ', '.join(f'{o.name} {len(o.data.loop_triangles)}' for o in parts))

# ===================================================================================================== the atlas
for o in parts:
    o.data.uv_layers.new(name='atlas')
    o.data.uv_layers['atlas'].active = True
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
# (texel density by what's seen close: the logs and the stump in your arms and at your feet, the tools in your hand)
weight = {'log_a': 1.4, 'log_b': 1.4, 'stump': 1.1, 'axe': 2.2, 'pick': 2.0, 'stake': 0.8}
for o in parts:
    s = weight.get(o.name, 1.0)
    o.scale = (s, s, s)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.012, scale_to_bounds=False, correct_aspect=True)
bpy.ops.uv.pack_islands(margin=0.006)
bpy.ops.object.mode_set(mode='OBJECT')
for o in parts: o.scale = (1, 1, 1)
img_c = bpy.data.images.new('gather_c', TEX, TEX, alpha=False)
img_n = bpy.data.images.new('gather_n', TEX, TEX, alpha=False, float_buffer=False); img_n.colorspace_settings.name = 'Non-Color'
def target(img):
    for m in bpy.data.materials:
        if not m.use_nodes: continue
        t = m.node_tree
        n = t.nodes.get('BAKE') or t.nodes.new('ShaderNodeTexImage'); n.name = 'BAKE'; n.image = img
        t.nodes.active = n
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4
sc.render.bake.margin = 6; sc.render.bake.use_clear = True
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
target(img_c)
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=6)
target(img_n)
bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=6)
log(f'baked {TEX}² colour + normals')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
def save(img, path, q):
    sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.quality = q
    img.save_render(path, scene=sc)
OUT_C, OUT_N = OUT[:-4] + '.webp', OUT[:-4] + '_n.webp'
save(img_c, OUT_C, 90)
# (the normal map saved as it is — no view transform)
sc.view_settings.view_transform = 'Standard'
save(img_n, OUT_N, 92)
log(f'wrote {OUT_C} ({os.path.getsize(OUT_C) / 1e3:.0f} kB), {OUT_N} ({os.path.getsize(OUT_N) / 1e3:.0f} kB)')

# ===================================================================================================== out
for o in parts:
    me = o.data
    me.uv_layers.remove(me.uv_layers['UVMap'])
    me.uv_layers['atlas'].name = 'UVMap'
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=True,
                          export_materials='NONE', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
log(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.1f} kB')

if PREVIEW:
    # the look: every piece on a ground plate, with the atlas (Eevee)
    os.makedirs(PREVIEW, exist_ok=True)
    mat = bpy.data.materials.new('atlas'); mat.use_nodes = True; t = mat.node_tree; b = t.nodes['Principled BSDF']
    ti = t.nodes.new('ShaderNodeTexImage'); ti.image = img_c; t.links.new(ti.outputs['Color'], b.inputs['Base Color'])
    tn = t.nodes.new('ShaderNodeTexImage'); tn.image = img_n
    nm = t.nodes.new('ShaderNodeNormalMap'); t.links.new(tn.outputs['Color'], nm.inputs['Color']); t.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.75
    layout = {'log_a': (0, 0, 0, 0), 'log_b': (0, 0.3, 0, 0.2), 'stone_a': (-1.1, -0.6, 0, 0), 'stone_b': (-0.8, -0.7, 0, 1), 'stone_c': (-0.95, -0.35, 0, 2),
              'stump': (1.2, -0.6, 0, 0), 'axe': (0.4, -0.7, 0.03, 0), 'pick': (0.9, 0.5, 0.03, 0), 'scrap_sheet': (-1.2, 0.5, 0, 0), 'scrap_pipe': (-0.6, 0.6, 0, 0.5), 'stake': (1.6, 0.4, 0, 0)}
    for o in parts:
        o.data.materials.clear(); o.data.materials.append(mat)
        x, y, z, rz = layout[o.name]
        o.location = (x, y, z + (0.12 if o.name.startswith('log') else 0)); o.rotation_euler = (0, 0, rz)
        if o.name in ('axe', 'pick'): o.rotation_euler = (math.radians(90), 0, math.radians(20))
    bpy.ops.mesh.primitive_plane_add(size=6); pl = bpy.context.object
    pm = bpy.data.materials.new('ground'); pm.use_nodes = True; pm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.2, 0.1, 1); pl.data.materials.append(pm)
    sc.render.engine = next((e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]))
    sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [v.identifier for v in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'AgX'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(35)); col.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); sc.camera = cam; cam.data.lens = 40
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    # (and the tools stood up beside the stump, for the close look)
    bpy.data.objects['axe'].location = (0.55, -1.0, 0); bpy.data.objects['axe'].rotation_euler = (0, 0, math.radians(-30))
    bpy.data.objects['pick'].location = (0.95, -1.05, 0); bpy.data.objects['pick'].rotation_euler = (0, 0, math.radians(15))
    for tag, loc, tgt in (('all', (0.6, -3.4, 2.0), (0.1, -0.05, 0.1)), ('close', (0.6, -1.6, 0.6), (0.5, -0.5, 0.1)), ('tools', (0.75, -2.05, 0.75), (0.75, -1.0, 0.55))):
        cam.location = loc; cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'gather_{tag}.png'); bpy.ops.render.render(write_still=True)
    log('preview rendered')
