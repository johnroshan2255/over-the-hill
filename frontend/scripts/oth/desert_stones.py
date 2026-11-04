# OVER THE HILL — the DESERT's loose stones, sculpted in Blender (2026-11-04, the user: "sculpt the hills and the rocks
# … the stones" — the boulders were chamfered boxes, dice on the sand).
#
#   blender -b --factory-startup --python scripts/oth/desert_stones.py -- [OUT=public/oth/desert/stones.glb] [PREVIEW=<dir>]
#
# Six sandstone stones, each from an icosphere: a ROUNDED BOX of its own proportions (a weathered block, a rounded
# boulder, two flat slabs, a broken chunk), cut by FRACTURE PLANES (the flat broken faces of a block split off a wall),
# BEDDED (a groove or two where the layers part, each layer a little out of line with the next, the way sandstone
# weathers), pitted and lumped by a 3D noise, its foot flattened into the sand. Then Blender's Decimate makes each one
# LOW-POLY twice — LOD 0 (≈ 256 triangles, near) and LOD 1 (≈ 61, far): chunky facets like the rest of the world.
# Unit size like Rocks.ts's shapes (x within ±0.5, centred), y up (glTF). Rocks.ts loads them for the desert in the
# boulders' place (stone_<v>_<lod>), the same v so no stone moves.
import sys, os, math
import numpy as np
import bpy, bmesh

ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/desert/stones.glb')
PREVIEW = ARGS.get('PREVIEW')
LODS = ((0.05, "near"), (0.012, "far"))   # (decimate ratios of the 5 120-face icosphere: ≈ 256 and 61 triangles)


def vnoise3(P, seed):
    """Smooth 3D value noise, 0..1 (P: n × 3)."""
    i = np.floor(P).astype(np.int64); f = P - i
    u = f * f * (3 - 2 * f)
    def h(dx, dy, dz):
        n = (i[:, 0] + dx) * 73856093 ^ (i[:, 1] + dy) * 19349663 ^ (i[:, 2] + dz) * 83492791 ^ (seed * 2654435761)
        n = (n ^ (n >> 13)) * 1274126177
        return ((n ^ (n >> 16)) & 0xffff) / 65535.0
    out = 0.0
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * h(dx, dy, dz)
    return out


def fbm3(P, seed, oct=3):
    t, a, n = 0.0, 1.0, 0.0
    for o in range(oct):
        t = t + a * vnoise3(P * (2.0 ** o), seed + o * 17); n += a; a *= 0.5
    return t / n


# kind: (half sizes x, y (across), z (up) ranges, roundness exponent, fracture planes, bedding grooves)
KINDS = [
    ('block', (0.5, (0.7, 0.9), (0.5, 0.7)), 3.6, 4, 2),
    ('block', (0.5, (0.75, 0.95), (0.45, 0.6)), 3.2, 5, 1),
    ('round', (0.5, (0.8, 0.95), (0.55, 0.72)), 2.4, 2, 1),
    ('slab', (0.5, (0.65, 0.85), (0.26, 0.36)), 4.2, 3, 1),
    ('slab', (0.5, (0.7, 0.9), (0.3, 0.42)), 3.8, 4, 2),
    ('chunk', (0.5, (0.6, 0.8), (0.5, 0.75)), 3.0, 6, 1),
]


def sculpt(v):
    kind, (hx, hy_r, hz_r), n, nplanes, ngroove = KINDS[v]
    rng = np.random.default_rng(1009 + v * 31)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=5, radius=1.0)
    D = np.array([vv.co[:] for vv in bm.verts], float)
    D /= np.linalg.norm(D, axis=1)[:, None]
    a, b, c = hx, 0.5 * rng.uniform(*hy_r), 0.5 * rng.uniform(*hz_r)
    # the rounded box (a superellipsoid: n ~ 2.4 a boulder … 4 a block)
    r = 1.0 / ((np.abs(D[:, 0]) / a) ** n + (np.abs(D[:, 1]) / b) ** n + (np.abs(D[:, 2]) / c) ** n) ** (1.0 / n)
    P = D * r[:, None]
    # the FRACTURES: planes that slice a cap off (its points pressed onto the plane: a flat broken face); the sides'
    # near-vertical, a top's tilted a little
    for k in range(nplanes):
        az = rng.uniform(0, 2 * math.pi)
        up = rng.uniform(0.55, 0.85) if (k == 0 and kind != 'round') else rng.uniform(-0.25, 0.35)
        nrm = np.array([math.cos(az) * math.sqrt(1 - up * up), math.sin(az) * math.sqrt(1 - up * up), up])
        proj = P @ nrm
        d = proj.max() * rng.uniform(0.62, 0.84)
        P = P - np.maximum(proj - d, 0.0)[:, None] * nrm[None, :]
    # the BEDDING: where two layers part, a groove round the stone; above it the layer a little out of line
    zs = np.sort(rng.uniform(-0.35, 0.45, ngroove)) * c
    for zg in zs:
        w = rng.uniform(0.025, 0.05); dep = rng.uniform(0.05, 0.1)
        g = np.exp(-((P[:, 2] - zg) / w) ** 2)
        P[:, :2] *= (1 - dep * g)[:, None]
        sh = rng.uniform(-0.04, 0.04, 2)
        above = 1 / (1 + np.exp(-(P[:, 2] - zg) / 0.015))
        P[:, :2] += above[:, None] * sh[None, :]
    # WEATHERING: lumps and pits along the surface (the 3D noise, out along the sphere's direction)
    lump = fbm3(P * 3.2 + v * 7.7, 11 + v, 3) - 0.5
    pits = np.maximum(0.0, 0.62 - fbm3(P * 9.0 + v * 3.1, 29 + v, 2)) ** 2
    P = P + D * (0.07 * lump - 0.18 * pits)[:, None]
    # the foot flattened into the sand
    zb = P[:, 2].min() + 0.22 * (P[:, 2].max() - P[:, 2].min())
    P[:, 2] = np.where(P[:, 2] < zb, zb + (P[:, 2] - zb) * 0.15, P[:, 2])
    # unit size: centred, x within ±0.5
    P -= (P.max(0) + P.min(0)) / 2
    P *= 1.0 / (P[:, 0].max() - P[:, 0].min())
    for vv, p in zip(bm.verts, P): vv.co = p
    return bm


for o in list(bpy.data.objects): bpy.data.objects.remove(o)
col = bpy.data.collections.new('stones'); bpy.context.scene.collection.children.link(col)
deps = bpy.context.evaluated_depsgraph_get()
objs = []
for v in range(len(KINDS)):
    for li, (ratio, _) in enumerate(LODS):
        bm = sculpt(v)
        me = bpy.data.meshes.new(f'stone_{v}_{li}')
        bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(f'stone_{v}_{li}', me)
        col.objects.link(ob)
        dm = ob.modifiers.new('decimate', 'DECIMATE'); dm.decimate_type = 'COLLAPSE'; dm.ratio = ratio
        tm = ob.modifiers.new('tri', 'TRIANGULATE')
        objs.append(ob)
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
for ob in objs:
    ev = ob.evaluated_get(deps)
    print(f'  {ob.name}: {len(ev.data.polygons)} triangles, {len(ev.data.vertices)} vertices')

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_normals=False,
                          export_texcoords=False, export_materials='NONE')
print(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.1f} kB')

if PREVIEW:
    # a contact sheet of the near LODs, lit from the south-west, for a look by eye
    os.makedirs(PREVIEW, exist_ok=True)
    scn = bpy.context.scene
    for i, ob in enumerate(o for o in objs if o.name.endswith('_0')):
        ob.location = ((i % 3) * 1.4 - 1.4, 0, 0.9 - (i // 3) * 1.0)
    for o in objs:
        if o.name.endswith('_1'): o.hide_render = True
    mat = bpy.data.materials.new('sandstone'); mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.42, 0.24, 0.13, 1)
    for o in objs:
        o.data.materials.append(mat)
        for p in o.data.polygons: p.use_smooth = False
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam)
    cam.location = (0, -6.5, 2.2); cam.rotation_euler = (math.radians(75), 0, 0); scn.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); col.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(-30), math.radians(-40)); sun.data.energy = 4
    scn.world = bpy.data.worlds.new('w'); scn.world.color = (0.35, 0.4, 0.5)
    scn.render.engine = 'BLENDER_WORKBENCH' if 'BLENDER_WORKBENCH' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else scn.render.engine
    scn.display.shading.light = 'STUDIO'; scn.display.shading.color_type = 'MATERIAL'
    scn.render.resolution_x, scn.render.resolution_y = 1200, 800
    scn.render.filepath = os.path.join(PREVIEW, 'stones.png')
    bpy.ops.render.render(write_still=True)
    print('preview', scn.render.filepath)
