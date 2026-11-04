# OVER THE HILL — the DESERT's STACKED ROCK, modelled in Blender (2026-11-04 — the user's gameplay frames: rocky hills
# and cliffs built of many rounded slabs stacked like pancakes, each a little offset; "what we have is a big single rock
# and hill … I want those"). A 2 m heightfield can't draw a slab's bulging lip, so these are MESHES:
#
#   blender -b --factory-startup --python scripts/oth/desert_stacks.py -- [OUT=public/oth/desert/stacks.glb] [PREVIEW=<dir>]
#
# A library of STACKS: TABLES (1–3 thin slabs: a car crawls onto them), MESAS (4–7 broad), TOWERS (6–12 narrow), FINS
# (long and narrow) and HOODOOS (a narrow column under a wide cap). Each SLAB a closed pillow — an irregular outline
# (a few sines: never round), rings up its side bulging out at the middle (a rounded lip above and below), a gently
# domed top — set on the one below a little offset, a little smaller. Two LODs (40 / 14 segments round). Real sizes
# (metres); y up (glTF). desert.py places them (meta.json 'stacks'); Stacks.ts draws them, instanced; the physics
# gives the near ones their exact mesh as a collider (Physics.ts) — the car crawls onto them.
import sys, os, math, json
import numpy as np
import bpy

ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/desert/stacks.glb')
PREVIEW = ARGS.get('PREVIEW')
# (height fraction up the slab's side, radius ×): the pillow — tucked in at the foot, full at the middle, a rounded lip
RINGS = [(0.0, 0.84), (0.2, 0.96), (0.5, 1.0), (0.8, 0.96), (1.0, 0.84)]


def slab(V, F, cx, cz, y0, t, R, ex, rot, ph, seg):
    """One slab into V (vertices) / F (triangles): its outline R × (1 + sines), stretched ex along its own axis (rot)."""
    a = np.linspace(0, 2 * math.pi, seg, endpoint=False)
    r = R * (1 + 0.12 * np.sin(2 * a + ph[0]) + 0.08 * np.sin(3 * a + ph[1]) + 0.05 * np.sin(5 * a + ph[2]) + 0.025 * np.sin(8 * a + ph[3]))
    lx, lz = np.cos(a) * r * ex, np.sin(a) * r
    c, s = math.cos(rot), math.sin(rot)
    ox, oz = lx * c - lz * s, lx * s + lz * c
    base = len(V)
    for (f, k) in RINGS:
        for i in range(seg): V.append((cx + ox[i] * k, y0 + f * t, cz + oz[i] * k))
    for ri in range(len(RINGS) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            p0, p1, q0, q1 = base + ri * seg + i, base + ri * seg + j, base + (ri + 1) * seg + i, base + (ri + 1) * seg + j
            F.append((p0, q0, p1)); F.append((p1, q0, q1))
    # the top: an inner ring a little raised (a gentle dome), then a fan to the middle
    top = base + (len(RINGS) - 1) * seg
    inner = len(V)
    for i in range(seg): V.append((cx + ox[i] * 0.5, y0 + t + 0.06 * t, cz + oz[i] * 0.5))
    mid = len(V); V.append((cx, y0 + t + 0.1 * t, cz))
    for i in range(seg):
        j = (i + 1) % seg
        F.append((top + i, inner + i, top + j)); F.append((top + j, inner + i, inner + j))
        F.append((inner + i, mid, inner + j))
    # the bottom: closed (a slab on the sand is never hollow from below)
    bmid = len(V); V.append((cx, y0, cz))
    for i in range(seg):
        j = (i + 1) % seg
        F.append((base + j, bmid, base + i))


def stack(kind, rng, seg):
    V, F = [], []
    y, cx, cz = 0.0, 0.0, 0.0
    if kind == 'table':
        n, R, t, shrink, ex = rng.integers(1, 4), rng.uniform(8, 20), (1.2, 2.4), (0.72, 0.92), rng.uniform(1.0, 1.6)
    elif kind == 'mesa':
        n, R, t, shrink, ex = rng.integers(4, 8), rng.uniform(16, 30), (2.2, 4.5), (0.86, 0.97), rng.uniform(1.0, 1.5)
    elif kind == 'tower':
        n, R, t, shrink, ex = rng.integers(6, 13), rng.uniform(5, 9), (2.4, 4.2), (0.93, 1.0), rng.uniform(1.0, 1.35)
    elif kind == 'fin':
        n, R, t, shrink, ex = rng.integers(3, 7), rng.uniform(7, 12), (2.0, 3.8), (0.85, 0.96), rng.uniform(2.2, 3.4)
    else:  # hoodoo
        n, R, t, shrink, ex = rng.integers(4, 8), rng.uniform(3, 5), (2.2, 3.6), (0.95, 1.02), rng.uniform(1.0, 1.25)
    rot = rng.uniform(0, math.pi)
    for k in range(n):
        th = rng.uniform(*t)
        ph = rng.uniform(0, 2 * math.pi, 4)
        slab(V, F, cx, cz, y, th, R, ex, rot + rng.uniform(-0.25, 0.25), ph, seg)
        y += th - 0.12 * th                                        # (each slab sits a little into the one below)
        R *= rng.uniform(*shrink)
        cx += rng.uniform(-0.15, 0.15) * R; cz += rng.uniform(-0.15, 0.15) * R
    if kind == 'hoodoo':                                            # (the wide CAP on its column)
        th = rng.uniform(2.0, 3.0)
        slab(V, F, cx, cz, y, th, R * rng.uniform(1.8, 2.4), 1.15, rot, rng.uniform(0, 2 * math.pi, 4), seg)
        y += th
    return np.array(V, np.float32), np.array(F, np.int32), y


KINDS = ['table'] * 7 + ['mesa'] * 5 + ['tower'] * 6 + ['fin'] * 4 + ['hoodoo'] * 3
LODS = (40, 14)
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
col = bpy.data.collections.new('stacks'); bpy.context.scene.collection.children.link(col)
info = []
objs = []
for vi, kind in enumerate(KINDS):
    for li, seg in enumerate(LODS):
        rng = np.random.default_rng(4001 + vi * 37)                 # (the same seed for both LODs: the same stack)
        V, F, hgt = stack(kind, rng, seg)
        me = bpy.data.meshes.new(f'stack_{vi}_{li}')
        me.vertices.add(len(V)); me.vertices.foreach_set('co', np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1).ravel())
        me.loops.add(F.size); me.loops.foreach_set('vertex_index', F.ravel())
        me.polygons.add(len(F)); me.polygons.foreach_set('loop_start', (np.arange(len(F)) * 3).astype(np.int32)); me.polygons.foreach_set('loop_total', np.full(len(F), 3, np.int32))
        me.update(calc_edges=True); me.validate()
        me.polygons.foreach_set('use_smooth', np.ones(len(F), bool))
        ob = bpy.data.objects.new(me.name, me); col.objects.link(ob); objs.append(ob)
        if li == 0:
            r = float(np.max(np.hypot(V[:, 0], V[:, 2])))
            info.append({'kind': kind, 'radius': round(r, 2), 'height': round(float(hgt), 2), 'tris': int(len(F))})
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                          export_texcoords=False, export_materials='NONE')
with open(OUT.replace('.glb', '.json'), 'w') as f: json.dump({'kinds': info}, f)
print(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.0f} kB, {len(KINDS)} stacks; tris LOD0 {sum(i["tris"] for i in info)}')
for i, k in enumerate(info): print(f'  {i:2d} {k["kind"]:7s} r {k["radius"]:5.1f} h {k["height"]:5.1f} tris {k["tris"]}')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scn = bpy.context.scene
    for o in objs:
        if o.name.endswith('_1'): o.hide_render = True
    lod0 = [o for o in objs if o.name.endswith('_0')]
    for i, o in enumerate(lod0): o.location = ((i % 7) * 70 - 210, 0, -(i // 7) * 70)
    mat = bpy.data.materials.new('sandstone'); mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.75, 0.33, 0.2, 1)
    for o in lod0: o.data.materials.append(mat)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam)
    cam.location = (0, -330, 170); cam.rotation_euler = (math.radians(62), 0, 0); scn.camera = cam; cam.data.lens = 30
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); col.objects.link(sun)
    sun.rotation_euler = (math.radians(45), math.radians(-25), math.radians(-35)); sun.data.energy = 4
    scn.world = bpy.data.worlds.new('w'); scn.world.color = (0.5, 0.55, 0.6)
    scn.render.engine = 'BLENDER_WORKBENCH'
    scn.display.shading.light = 'STUDIO'; scn.display.shading.color_type = 'MATERIAL'
    scn.render.resolution_x, scn.render.resolution_y = 1600, 900
    scn.render.filepath = os.path.join(PREVIEW, 'stacks.png')
    bpy.ops.render.render(write_still=True)
    print('preview', scn.render.filepath)
