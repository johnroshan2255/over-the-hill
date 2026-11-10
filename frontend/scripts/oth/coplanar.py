# coplanar.py — TWO SKINS IN ONE PLANE (2026-11-10, the user: "some pixels or the car's body parts blink"): two faces that
# lie in the same plane, look the same way and overlap fight for the depth buffer — each frame a different one wins, and
# with a painted texture / baked shading on them they no longer look the same: the part BLINKS. This finds them in a
# built car: every triangle put in its plane's bucket (normal to 2°, distance to 1 mm), and a point inside each tested
# against the bucket's others. Prints, per car, the overlapping area by material pair and where the worst are (under 60 cm² — a
# sill's foot against the floor's edge, seen only from under the car — passes).
#   blender -b --factory-startup --python scripts/oth/coplanar.py -- src/assets/models/vehicles/sierra.glb [more.glb …] [TOP=14]
import bpy, sys, math, collections
from mathutils import Vector
from mathutils.geometry import intersect_point_tri_2d
files = [a for a in sys.argv[sys.argv.index('--') + 1:] if '=' not in a]; files_kw = [a for a in sys.argv[sys.argv.index('--') + 1:] if '=' in a]
bad = 0
for path in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    tris = []                                              # (a, b, c, normal, material, object)
    for o in bpy.context.scene.objects:
        if o.type != 'MESH': continue
        me = o.data; me.calc_loop_triangles(); mw = o.matrix_world
        for t in me.loop_triangles:
            p = [mw @ me.vertices[i].co for i in t.vertices]
            n = (p[1] - p[0]).cross(p[2] - p[0])
            if n.length < 2e-5: continue                   # (under 0.1 cm²: a sliver)
            tris.append((p[0], p[1], p[2], n.normalized(), me.materials[t.material_index].name if me.materials else '?', o.name, n.length / 2))
    buckets = collections.defaultdict(list)
    for k, t in enumerate(tris):
        n = t[3]; d = n.dot(t[0])
        buckets[(round(n.x * 30), round(n.y * 30), round(n.z * 30), round(d * 1000))].append(k)
    pairs = collections.Counter(); where = []
    for ks in buckets.values():
        if len(ks) < 2 or len(ks) > 400: continue
        n = tris[ks[0]][3]
        u = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized(); v = n.cross(u)
        flat = {k: [Vector((q.dot(u), q.dot(v))) for q in tris[k][:3]] for k in ks}
        for i in ks:
            a = flat[i]; c = (a[0] + a[1] + a[2]) / 3
            pts = [c] + [c + (q - c) * 0.6 for q in a]     # (points well inside it)
            for j in ks:
                if i == j: continue
                if abs(tris[i][3].dot(tris[j][0] - tris[i][0])) > 0.0008 or tris[i][3].dot(tris[j][3]) < 0.999: continue
                hit = sum(1 for q in pts if intersect_point_tri_2d(q, *flat[j]))
                if hit:
                    key = tuple(sorted((tris[i][4], tris[j][4]))); ar = tris[i][6] * hit / 4
                    pairs[key] += ar; where.append((ar, key, tuple(round(x, 2) for x in (tris[i][0] + tris[i][1] + tris[i][2]) / 3), tris[i][5], tuple(round(x, 1) for x in tris[i][3]) + (round(tris[i][3].dot(tris[i][0]), 2),)))
    tot = sum(pairs.values()) / 2
    name = path.split('/')[-1]
    print(f'[coplanar] {name}: {tot * 1e4:.0f} cm² of overlapping skins' + ('' if tot > 0.006 else '  ok'))
    if tot > 0.006:
        bad += 1
        for key, ar in pairs.most_common(6): print(f'[coplanar]    {key[0]} / {key[1]}: {ar / 2 * 1e4:.0f} cm²')
        # … and by plane: which way it looks, where it stands, the box round the overlaps (file space: z up, −y forward)
        planes = collections.defaultdict(lambda: [0.0, [1e9] * 3, [-1e9] * 3])
        for ar, key, c, ob, nn in where:
            e = planes[(key, nn)]; e[0] += ar; e[1] = [min(a_, b_) for a_, b_ in zip(e[1], c)]; e[2] = [max(a_, b_) for a_, b_ in zip(e[2], c)]
        for (key, nn), e in sorted(planes.items(), key=lambda kv: -kv[1][0])[:int(dict(a.split('=') for a in files_kw).get('TOP', 14))]:
            print(f'[coplanar]    {key[0]} / {key[1]}  looks {nn[:3]} at {nn[3]} m  from {tuple(e[1])} to {tuple(e[2])}: {e[0] / 2 * 1e4:.0f} cm²')
print(f'[coplanar] {len(files) - bad} of {len(files)} clean')
