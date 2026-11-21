# THE CAR DAMAGE'S PIECES (2026-11-21 — docs/DAMAGE.md), made here in Blender:
#   debris.glb   what a crash throws off a car — two SHARDS of window glass, two SCRAPS of torn sheet metal (one side
#                painted, the other a darker shade of it), a strip of TRIM. Each its own mesh about its own middle, coloured by vertex:
#                the game tints the painted sides with the car's own colour (src/oth/Damage.ts).
#   crack.png    the CRACKS of a broken pane: impact stars — rays out of each, rings round it — and the long cracks
#                between them, white on black, 512², tiling (drawn over a cracked window before it falls out).
#
#   blender -b --factory-startup --python scripts/oth/damage.py -- [OUT=src/assets/models/damage] [PREVIEW=<dir>]
import bpy, bmesh, sys, os, math, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
kw = dict(a.split('=', 1) for a in argv if '=' in a)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = kw.get('OUT', os.path.join(ROOT, 'src', 'assets', 'models', 'damage'))
PREVIEW = kw.get('PREVIEW')
os.makedirs(OUT, exist_ok=True)

PAINT = (1.0, 1.0, 1.0)        # takes the car's colour whole
BARE = (0.34, 0.34, 0.36)      # the sheet's other side: bare steel (a grey of the car's colour — it reads as metal)
EDGE = (0.5, 0.5, 0.52)
GLASS = (0.72, 0.86, 0.84)     # toughened glass: pale, green at its edge
GLASS_E = (0.42, 0.66, 0.6)
TRIM = (0.8, 0.8, 0.82)        # a bumper's strip: the car's colour (the game tints it, as the torn metal)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def finish(bm, name, recalc=True):
    me = bpy.data.meshes.new(name)
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    if 'Col' in me.color_attributes:
        # (the colours the exporter writes as COLOR_0: the ACTIVE colour attribute — set, or none is written)
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = 0
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def new_bm():
    """(the colour layer FIRST: adding one after the faces are made leaves them pointing at the old data)"""
    bm = bmesh.new()
    bm.loops.layers.color.new('Col')
    return bm


def paint(bm, faces, col):
    layer = bm.loops.layers.color['Col']
    for f in faces:
        for l in f.loops: l[layer] = (*col, 1.0)


def slab(name, outline, thick, top, side):
    """A flat piece: its outline (x, y) in the ground plane, `thick` through — the two faces `top`, the rim `side`."""
    bm = new_bm()
    n = len(outline)
    cx = sum(p[0] for p in outline) / n; cy = sum(p[1] for p in outline) / n
    up = [bm.verts.new((x - cx, y - cy, thick / 2)) for x, y in outline]
    dn = [bm.verts.new((x - cx, y - cy, -thick / 2)) for x, y in outline]
    faces = [bm.faces.new(up), bm.faces.new(list(reversed(dn)))]
    paint(bm, faces, top)
    rim = [bm.faces.new((up[i], dn[i], dn[(i + 1) % n], up[(i + 1) % n])) for i in range(n)]
    paint(bm, rim, side)
    return finish(bm, name)


def sheet(name, w, h, nx, ny, height, tear, seed):
    """A SCRAP of sheet metal: a w × h piece, nx × ny quads, bent by `height(u, v)` (m), its edge torn (± tear);
    two skins back to back — the painted one up, the bare one down."""
    rnd = random.Random(seed)
    bm = new_bm()
    pts = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x, y = (u - 0.5) * w, (v - 0.5) * h
            if i in (0, nx) or j in (0, ny):
                x += (rnd.random() - 0.5) * tear; y += (rnd.random() - 0.5) * tear
            row.append(Vector((x, y, height(u, v))))
        pts.append(row)
    for skin, col, flip in ((0, PAINT, False), (1, BARE, True)):
        vs = [[bm.verts.new(p - Vector((0, 0, 0.0008 * skin))) for p in row] for row in pts]
        fs = []
        for j in range(ny):
            for i in range(nx):
                q = (vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i])
                fs.append(bm.faces.new(tuple(reversed(q)) if flip else q))
        paint(bm, fs, col)
    # (two open skins back to back: each face wound as made — the painted skin up, the bare one down)
    return finish(bm, name, recalc=False)


def debris():
    clear()
    obs = [
        # the glass: thick enough to catch the light on its rim — a three-cornered piece, a long splinter
        slab('shard_a', [(0, 0), (0.085, 0.012), (0.07, 0.06), (0.03, 0.082), (-0.012, 0.045)], 0.006, GLASS, GLASS_E),
        slab('shard_b', [(0, 0), (0.12, -0.008), (0.135, 0.02), (0.05, 0.04), (0.005, 0.03)], 0.006, GLASS, GLASS_E),
        # a wing's corner: folded along a crease a third of the way across, its far corner curled up
        sheet('scrap_a', 0.24, 0.15, 5, 3, lambda u, v: 0.05 * max(0.0, u - 0.62) / 0.38 + 0.018 * math.sin(v * 3.0) * u + 0.03 * max(0.0, u + v - 1.45), 0.022, 3),
        # a smaller piece: rolled into a shallow gutter
        sheet('scrap_b', 0.14, 0.1, 4, 3, lambda u, v: 0.035 * (2 * v - 1) ** 2 + 0.012 * math.sin(u * 5.0), 0.018, 11),
    ]
    # the trim: a bumper's strip, bowed, snapped short at one end
    bm = new_bm()
    L, W, T, n = 0.52, 0.055, 0.012, 8
    rings = []
    for i in range(n + 1):
        u = i / n
        x = (u - 0.5) * L; bow = 0.05 * (1 - (2 * u - 1) ** 2); tw = 0.25 * (u - 0.5)
        c, s = math.cos(tw), math.sin(tw)
        ring = [bm.verts.new((x, y * c - z * s + bow, y * s + z * c)) for y, z in ((-W / 2, -T / 2), (W / 2, -T / 2), (W / 2, T / 2), (-W / 2, T / 2))]
        rings.append(ring)
    fs = []
    for i in range(n):
        a, b = rings[i], rings[i + 1]
        for k in range(4): fs.append(bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k])))
    fs.append(bm.faces.new(list(reversed(rings[0])))); fs.append(bm.faces.new(rings[n]))
    paint(bm, fs, TRIM)
    obs.append(finish(bm, 'trim'))
    for o in obs:
        for p in o.data.polygons: p.use_smooth = False
        o.data.update()
    for o in bpy.data.objects: o.select_set(o in obs)
    bpy.context.view_layer.objects.active = obs[0]
    path = os.path.join(OUT, 'debris.glb')
    args = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_materials='NONE', export_normals=True, export_texcoords=False, export_animations=False)
    try: bpy.ops.export_scene.gltf(**args, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    except TypeError: bpy.ops.export_scene.gltf(**args, export_colors=True)
    print(f'  debris.glb  {", ".join(f"{o.name} {len(o.data.polygons)}" for o in obs)} faces  {os.path.getsize(path) / 1024:.1f} kB')
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        x = 0.0
        for o in obs:
            o.location = (x, 0, 0); x += 0.3 if o.name != 'trim' else 0.0
        obs[-1].location = (0.45, 0.28, 0)
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'; sc.display.shading.show_cavity = True
        sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.color = (0.16, 0.17, 0.2)
        sc.view_settings.view_transform = 'Standard'
        sc.render.resolution_x = 1100; sc.render.resolution_y = 520
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.25
        mid = Vector((0.45, 0.1, 0.0))
        cam.location = mid + Vector((0.5, -1.2, 1.1))
        cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, 'debris.png')
        bpy.ops.render.render(write_still=True)


def cracks():
    """crack.png: strips of white on black, seen from above — every line drawn in the tile and in its eight
    neighbours' places, so the edges meet."""
    clear()
    rnd = random.Random(20261121)
    bm = bmesh.new()

    def strip(pts, w0, w1):
        """A line through pts (x, y), its width going from w0 to w1 — nine times over (the tile and round it)."""
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                prev = None
                for i, (x, y) in enumerate(pts):
                    a = pts[min(i + 1, len(pts) - 1)]; b = pts[max(i - 1, 0)]
                    dx, dy = a[0] - b[0], a[1] - b[1]
                    l = math.hypot(dx, dy) or 1.0
                    w = (w0 + (w1 - w0) * i / max(1, len(pts) - 1)) / 2
                    nx, ny = -dy / l * w, dx / l * w
                    cur = (bm.verts.new((x + ox + nx, y + oy + ny, 0)), bm.verts.new((x + ox - nx, y + oy - ny, 0)))
                    if prev: bm.faces.new((prev[0], prev[1], cur[1], cur[0]))
                    prev = cur

    stars = [(0.27, 0.31), (0.74, 0.66), (0.2, 0.83), (0.83, 0.17)]
    for sx, sy in stars:
        n = rnd.randint(9, 13)
        angs = sorted(rnd.random() * math.tau for _ in range(n))
        reach = [0.12 + rnd.random() * 0.26 for _ in range(n)]
        rays = []
        for a, r in zip(angs, reach):
            pts = []; aa = a
            for k in range(8):
                t = k / 7
                aa += (rnd.random() - 0.5) * 0.16
                pts.append((sx + math.cos(aa) * r * t, sy + math.sin(aa) * r * t))
            rays.append(pts)
            strip(pts, 0.0065, 0.0012)
        # the rings: from ray to ray at a few distances out, each a broken arc
        for rr in (0.035, 0.075, 0.13, 0.19):
            for i in range(n):
                if rnd.random() < 0.3: continue
                a, b = rays[i], rays[(i + 1) % n]
                ka = min(7, max(1, round(rr / reach[i] * 7))); kb = min(7, max(1, round(rr / reach[(i + 1) % n] * 7)))
                if rr > reach[i] or rr > reach[(i + 1) % n]: continue
                pa, pb = a[ka], b[kb]
                mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
                # (bowed out a little from the star, as a ring's piece is)
                ox, oy = mx - sx, my - sy; ol = math.hypot(ox, oy) or 1.0
                strip([pa, (mx + ox / ol * 0.006, my + oy / ol * 0.006), pb], 0.0028, 0.0028)
        # the crushed middle: a knot of short lines
        for _ in range(14):
            a = rnd.random() * math.tau; r0 = rnd.random() * 0.02; r1 = r0 + 0.01 + rnd.random() * 0.02; a2 = a + (rnd.random() - 0.5) * 1.4
            strip([(sx + math.cos(a) * r0, sy + math.sin(a) * r0), (sx + math.cos(a2) * r1, sy + math.sin(a2) * r1)], 0.004, 0.003)
    # the long cracks: wandering from one star toward the next
    for i in range(len(stars)):
        a = stars[i]; b = stars[(i + 1) % len(stars)]
        pts = []
        for k in range(15):
            t = k / 14
            j = 0.035 * math.sin(t * math.pi)
            pts.append((a[0] + (b[0] - a[0]) * t + (rnd.random() - 0.5) * j, a[1] + (b[1] - a[1]) * t + (rnd.random() - 0.5) * j))
        strip(pts, 0.0026, 0.0026)
    ob = finish(bm, 'cracks')
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'SINGLE'; sc.display.shading.single_color = (1, 1, 1)
    sc.display.shading.show_backface_culling = False
    sc.display.render_aa = '16'
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0, 0, 0)
    sc.view_settings.view_transform = 'Standard'
    sc.render.film_transparent = False
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'BW'; sc.render.image_settings.compression = 100
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.0
    cam.location = (0.5, 0.5, 2.0)
    path = os.path.join(OUT, 'crack.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'  crack.png  {len(ob.data.polygons)} strips\' quads  {os.path.getsize(path) / 1024:.1f} kB')
    if PREVIEW:
        import shutil
        os.makedirs(PREVIEW, exist_ok=True)
        shutil.copy(path, os.path.join(PREVIEW, 'crack.png'))


print('DAMAGE:')
debris()
cracks()
