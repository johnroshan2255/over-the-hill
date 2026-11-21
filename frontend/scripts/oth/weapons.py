# THE WEAPONS' MODELS (2026-11-19 — docs/WEAPONS.md, docs/weapons/*.md: each one's real size), made here in Blender:
# the 9 mm pistol, the AK-47, the bolt-action sniper rifle. (A katana of two kinds was made here too, till 2026-11-21:
# taken out at the user's word.)
# Low-poly, flat-shaded, coloured by vertex (no textures) — the game's flat look; a few hundred to ~2 k triangles each.
#
#   blender -b --factory-startup --python scripts/oth/weapons.py -- [OUT=src/assets/models/weapons] [PREVIEW=<dir>]
#
# Each is built in Blender's space as the game holds it: the RIGHT HAND's grip at the origin, the muzzle / the point
# toward +Y (the game's −z, forward), up +Z; exported y-up to <OUT>/<id>.glb (one mesh, COLOR_0). The points the game
# needs (the muzzle, the left hand's place, the scope's eye) go to <OUT>/weapons.meta.json, in the game's space.
import bpy, bmesh, sys, os, json, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
kw = dict(a.split('=', 1) for a in argv if '=' in a)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = kw.get('OUT', os.path.join(ROOT, 'src', 'assets', 'models', 'weapons'))
PREVIEW = kw.get('PREVIEW')
os.makedirs(OUT, exist_ok=True)

STEEL = (0.105, 0.108, 0.118)      # blued / parkerised steel
STEEL_L = (0.20, 0.205, 0.22)      # worn edges, bare steel
POLY = (0.058, 0.060, 0.066)       # black polymer
WOOD = (0.36, 0.165, 0.065)        # the AK's laminate
WOOD_D = (0.25, 0.105, 0.04)
OLIVE = (0.215, 0.245, 0.155)      # the sniper's stock
OLIVE_D = (0.15, 0.17, 0.11)
GLASS = (0.10, 0.20, 0.32)
BRASS = (0.72, 0.52, 0.17)


class Build:
    """A mesh in the making: boxes, tubes, side profiles pushed across — each with its colour."""
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')

    def _paint(self, faces, col):
        for f in faces:
            f.smooth = False
            for l in f.loops: l[self.col] = (col[0], col[1], col[2], 1.0)

    def box(self, lo, hi, col, taper=None):
        """An axis-aligned box lo → hi; taper (kx, kz): its +Y end scaled about its middle."""
        x0, y0, z0 = lo; x1, y1, z1 = hi
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        kx, kz = taper or (1, 1)
        P = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]
        Q = [(cx + (x - cx) * kx, y1, cz + (z - cz) * kz) for x, _, z in P]
        v = [self.bm.verts.new(p) for p in P + Q]
        fs = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        self._paint([self.bm.faces.new([v[i] for i in f]) for f in fs], col)

    def tube(self, a, b, r, col, seg=10, r2=None, caps=True):
        """A round bar from a to b (radius r, r2 at b)."""
        a, b = Vector(a), Vector(b)
        ax = (b - a).normalized()
        u = ax.orthogonal().normalized(); w = ax.cross(u)
        r2 = r if r2 is None else r2
        A = [self.bm.verts.new(a + (u * math.cos(t) + w * math.sin(t)) * r) for t in (2 * math.pi * k / seg for k in range(seg))]
        B = [self.bm.verts.new(b + (u * math.cos(t) + w * math.sin(t)) * r2) for t in (2 * math.pi * k / seg for k in range(seg))]
        fs = [self.bm.faces.new([A[k], A[(k + 1) % seg], B[(k + 1) % seg], B[k]]) for k in range(seg)]
        if caps: fs += [self.bm.faces.new(list(reversed(A))), self.bm.faces.new(B)]
        self._paint(fs, col)

    def plate(self, prof, w, col, x=0.0, w2=None):
        """A side profile [(y, z)…] (counter-clockwise seen from +X) pushed across: half width w (w2 at its −X face)."""
        w2 = w if w2 is None else w2
        R = [self.bm.verts.new((x + w, y, z)) for y, z in prof]
        L = [self.bm.verts.new((x - w2, y, z)) for y, z in prof]
        n = len(prof)
        fs = [self.bm.faces.new(R), self.bm.faces.new(list(reversed(L)))]
        fs += [self.bm.faces.new([R[(k + 1) % n], R[k], L[k], L[(k + 1) % n]]) for k in range(n)]
        self._paint(fs, col)

    def finish(self, name):
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:])
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for p in me.polygons: p.use_smooth = False
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        # (a material that shows the colours — the previews; the exporter writes COLOR_0 whatever it is)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        me.materials.append(mat)
        return ob


META = {}


def pistol():
    b = Build()
    # the slide (steel): its top flats, the sights, the ejection port's bare barrel
    b.plate([(-0.066, 0.036), (0.120, 0.036), (0.124, 0.040), (0.124, 0.058), (0.120, 0.062), (-0.060, 0.062), (-0.066, 0.056)], 0.0125, STEEL)
    b.box((-0.0085, 0.020, 0.0605), (0.0085, 0.062, 0.0628), STEEL_L)                 # the port: the barrel's hood
    b.box((-0.002, 0.108, 0.062), (0.002, 0.116, 0.067), STEEL)                       # the front sight
    b.box((-0.0085, -0.058, 0.062), (-0.003, -0.050, 0.067), STEEL); b.box((0.003, -0.058, 0.062), (0.0085, -0.050, 0.067), STEEL)
    for k in range(5): b.box((-0.0128, -0.058 + k * 0.007, 0.040), (0.0128, -0.055 + k * 0.007, 0.058), STEEL_L)  # the grasping grooves
    b.tube((0, 0.118, 0.049), (0, 0.127, 0.049), 0.0068, STEEL_L, 8)                  # the muzzle
    # the frame (polymer): the dust cover and its rail, the trigger guard, the grip, the magazine's floor
    b.plate([(-0.062, 0.016), (0.118, 0.016), (0.120, 0.020), (0.120, 0.036), (-0.066, 0.036)], 0.0118, POLY)
    b.box((-0.009, 0.060, 0.008), (0.009, 0.112, 0.016), POLY)                        # the rail
    b.plate([(0.004, 0.016), (0.008, -0.012), (0.012, -0.018), (0.050, -0.018), (0.056, -0.012), (0.060, 0.016), (0.054, 0.016), (0.050, -0.010), (0.046, -0.013), (0.016, -0.013), (0.012, -0.010), (0.010, 0.016)], 0.0065, POLY)
    b.plate([(0.028, 0.014), (0.034, 0.014), (0.031, -0.008), (0.027, -0.006)], 0.003, STEEL)   # the trigger
    b.plate([(-0.064, 0.024), (-0.010, 0.016), (-0.022, -0.090), (-0.070, -0.082), (-0.066, -0.030)], 0.0135, POLY)
    for k in range(6): b.box((-0.0142, -0.062 + k * 0.001, -0.070 + k * 0.013), (0.0142, -0.020 - k * 0.001, -0.066 + k * 0.013), (0.085, 0.087, 0.094))  # the grip's bands
    b.plate([(-0.072, -0.084), (-0.020, -0.092), (-0.021, -0.098), (-0.073, -0.090)], 0.0128, STEEL)   # the magazine's floor plate
    b.box((-0.0135, -0.030, 0.026), (-0.0118, 0.004, 0.031), STEEL_L)                 # the slide stop
    META['pistol'] = dict(muzzle=(0, 0.127, 0.049), left=(0.0, -0.030, -0.045), sight=(0, -0.054, 0.0665))
    return b.finish('pistol')


def ak47():
    b = Build()
    # the receiver (stamped steel), its dust cover, the rear sight block
    b.plate([(-0.105, 0.018), (0.125, 0.018), (0.125, 0.062), (-0.105, 0.062)], 0.0165, STEEL)
    b.plate([(-0.100, 0.062), (0.090, 0.062), (0.090, 0.078), (0.070, 0.084), (-0.085, 0.084), (-0.100, 0.076)], 0.0150, (0.125, 0.128, 0.138))
    for k in range(4): b.box((-0.0152, -0.070 + k * 0.036, 0.0835), (0.0152, -0.064 + k * 0.036, 0.0855), STEEL)   # the cover's ribs
    b.box((-0.012, 0.090, 0.062), (0.012, 0.128, 0.090), STEEL); b.box((-0.007, 0.094, 0.090), (0.007, 0.150, 0.096), STEEL_L)
    b.tube((0.0165, 0.030, 0.066), (0.034, 0.030, 0.066), 0.004, STEEL_L, 6)          # the charging handle
    b.box((0.0165, -0.060, 0.030), (0.0185, 0.020, 0.036), STEEL_L)                   # the selector lever
    # the stock, the pistol grip, the handguards (wood)
    b.plate([(-0.105, 0.022), (-0.105, 0.064), (-0.345, 0.040), (-0.365, 0.030), (-0.365, -0.078), (-0.340, -0.082)], 0.0185, WOOD, w2=0.0185)
    b.plate([(-0.365, 0.034), (-0.365, -0.080), (-0.372, -0.078), (-0.372, 0.031)], 0.0185, STEEL)      # the butt plate
    b.plate([(-0.030, 0.018), (0.012, 0.018), (-0.004, -0.085), (-0.050, -0.078)], 0.0140, WOOD_D)
    b.plate([(0.125, 0.014), (0.335, 0.020), (0.335, 0.054), (0.125, 0.054)], 0.0200, WOOD)
    b.plate([(0.140, 0.062), (0.305, 0.062), (0.305, 0.088), (0.295, 0.092), (0.150, 0.092), (0.140, 0.088)], 0.0155, WOOD)
    for k in range(3): b.box((-0.0204, 0.170 + k * 0.045, 0.030), (0.0204, 0.196 + k * 0.045, 0.036), WOOD_D)   # the cooling slots
    # the barrel, the gas tube and its block, the front sight, the muzzle's slant
    b.tube((0, 0.125, 0.044), (0, 0.520, 0.044), 0.0078, STEEL, 10)
    b.tube((0, 0.305, 0.076), (0, 0.372, 0.076), 0.0068, STEEL, 8)
    b.box((-0.010, 0.360, 0.036), (0.010, 0.392, 0.084), STEEL)
    b.box((-0.009, 0.462, 0.036), (0.009, 0.486, 0.060), STEEL); b.plate([(0.464, 0.060), (0.484, 0.060), (0.484, 0.098), (0.464, 0.098)], 0.0018, STEEL, x=0.0085); b.plate([(0.464, 0.060), (0.484, 0.060), (0.484, 0.098), (0.464, 0.098)], 0.0018, STEEL, x=-0.0085)
    b.box((-0.0012, 0.471, 0.060), (0.0012, 0.477, 0.092), STEEL_L)                   # the post
    b.tube((0, 0.520, 0.044), (0, 0.545, 0.044), 0.0105, STEEL, 10)
    b.tube((0, 0.150, 0.026), (0, 0.500, 0.026), 0.0030, STEEL_L, 6)                  # the cleaning rod
    # the magazine: the curve of thirty 7.62 × 39 mm
    arc_f = [(0.092 + 0.070 * (1 - math.cos(t)), 0.018 - 0.205 * math.sin(t) / math.sin(1.05)) for t in [1.05 * k / 6 for k in range(7)]]
    arc_b = [(0.022 + 0.095 * (1 - math.cos(t)), 0.018 - 0.180 * math.sin(t) / math.sin(1.05)) for t in [1.05 * k / 6 for k in range(7)]]
    b.plate(list(reversed(arc_f)) + arc_b, 0.0125, (0.14, 0.142, 0.15))
    for k in range(1, 6): b.box((-0.0132, arc_b[k][0] + 0.004, arc_b[k][1] - 0.002), (0.0132, arc_f[k][0] - 0.004, arc_b[k][1] + 0.003), STEEL)   # its ribs
    # the trigger and its guard
    b.plate([(0.012, 0.018), (0.016, -0.016), (0.022, -0.022), (0.078, -0.022), (0.084, 0.018), (0.080, 0.018), (0.075, -0.018), (0.024, -0.018), (0.019, -0.013), (0.016, 0.018)], 0.008, STEEL)
    b.plate([(0.040, 0.016), (0.046, 0.016), (0.043, -0.010), (0.038, -0.008)], 0.003, STEEL_L)
    META['ak47'] = dict(muzzle=(0, 0.545, 0.044), left=(0, 0.235, 0.022), sight=(0, 0.100, 0.097))
    return b.finish('ak47')


def sniper():
    b = Build()
    # the stock (polymer, olive): the butt with its thumbhole and cheek piece, the grip, the fore-end
    b.plate([(-0.420, -0.070), (-0.420, 0.055), (-0.395, 0.072), (-0.150, 0.072), (-0.130, 0.058), (-0.130, 0.030), (-0.070, 0.022), (-0.250, -0.010), (-0.330, -0.078)], 0.0220, OLIVE)
    b.plate([(-0.330, 0.072), (-0.170, 0.072), (-0.176, 0.094), (-0.322, 0.094)], 0.0190, OLIVE_D)        # the cheek piece
    b.box((-0.0225, -0.432, -0.068), (0.0225, -0.420, 0.054), (0.06, 0.06, 0.065))                        # the recoil pad
    b.plate([(-0.060, 0.026), (0.010, 0.026), (-0.012, -0.090), (-0.062, -0.080), (-0.048, -0.020)], 0.0170, OLIVE_D)
    b.plate([(-0.130, 0.024), (0.420, 0.030), (0.440, 0.046), (0.440, 0.062), (-0.130, 0.062)], 0.0235, OLIVE)
    for k in range(5): b.box((-0.0242, 0.200 + k * 0.040, 0.040), (0.0242, 0.222 + k * 0.040, 0.052), OLIVE_D)     # the fore-end's vents
    # the action (steel): the receiver, the bolt and its handle, the magazine
    b.tube((0, -0.135, 0.078), (0, 0.150, 0.078), 0.0165, STEEL, 12)
    b.box((-0.0170, -0.070, 0.078), (0.0170, 0.020, 0.096), STEEL)                                        # the port's bridge
    b.tube((0, -0.160, 0.078), (0, -0.135, 0.078), 0.0120, STEEL_L, 10)                                   # the bolt's shroud
    b.tube((0.014, -0.085, 0.078), (0.050, -0.092, 0.050), 0.0048, STEEL_L, 6); b.tube((0.050, -0.092, 0.050), (0.058, -0.094, 0.043), 0.0105, (0.05, 0.05, 0.055), 8)
    b.box((-0.0130, -0.005, -0.050), (0.0130, 0.085, 0.026), STEEL)
    b.plate([(-0.058, 0.026), (-0.052, -0.004), (-0.046, -0.010), (-0.010, -0.010), (-0.004, 0.026), (-0.008, 0.026), (-0.013, -0.006), (-0.044, -0.006), (-0.049, 0.000), (-0.054, 0.026)], 0.007, STEEL)
    b.plate([(-0.034, 0.024), (-0.028, 0.024), (-0.031, 0.000), (-0.036, 0.002)], 0.003, STEEL_L)
    # the barrel: heavy, fluted, its brake
    b.tube((0, 0.150, 0.078), (0, 0.745, 0.078), 0.0125, STEEL, 12, r2=0.0105)
    for k in range(6):
        t = 2 * math.pi * k / 6
        b.box((math.cos(t) * 0.0118 - 0.0014, 0.260, 0.078 + math.sin(t) * 0.0118 - 0.0014), (math.cos(t) * 0.0118 + 0.0014, 0.640, 0.078 + math.sin(t) * 0.0118 + 0.0014), (0.07, 0.072, 0.08))
    b.tube((0, 0.745, 0.078), (0, 0.810, 0.078), 0.0160, STEEL, 10)
    for k in range(3): b.box((-0.0175, 0.756 + k * 0.017, 0.072), (0.0175, 0.764 + k * 0.017, 0.084), (0.03, 0.03, 0.034))   # the brake's ports
    # the telescopic sight on its rail and rings
    b.box((-0.0100, -0.090, 0.094), (0.0100, 0.190, 0.102), STEEL)
    Z = 0.142
    b.tube((0, -0.060, Z), (0, 0.170, Z), 0.0150, POLY, 12)
    b.tube((0, 0.170, Z), (0, 0.215, Z), 0.0150, POLY, 12, r2=0.0280); b.tube((0, 0.215, Z), (0, 0.290, Z), 0.0280, POLY, 12)
    b.tube((0, -0.060, Z), (0, -0.085, Z), 0.0150, POLY, 12, r2=0.0215); b.tube((0, -0.085, Z), (0, -0.150, Z), 0.0215, POLY, 12)
    b.tube((0, 0.2895, Z), (0, 0.2905, Z), 0.0255, GLASS, 12); b.tube((0, -0.1505, Z), (0, -0.1495, Z), 0.0190, GLASS, 12)
    b.tube((0, 0.060, Z), (0, 0.060, Z + 0.034), 0.0105, POLY, 8); b.tube((0, 0.060, Z), (0.034, 0.060, Z), 0.0105, POLY, 8)   # the turrets
    for y in (-0.030, 0.130): b.box((-0.0185, y - 0.009, 0.102), (0.0185, y + 0.009, Z + 0.0185), STEEL)                 # the rings
    # the bipod, folded forward under the fore-end
    for sx in (-1, 1):
        b.tube((sx * 0.016, 0.395, 0.030), (sx * 0.024, 0.650, 0.034), 0.0050, STEEL, 6)
        b.tube((sx * 0.024, 0.650, 0.034), (sx * 0.024, 0.672, 0.034), 0.0075, (0.05, 0.05, 0.055), 6)
    b.box((-0.020, 0.380, 0.020), (0.020, 0.410, 0.032), STEEL)
    META['sniper'] = dict(muzzle=(0, 0.810, 0.078), left=(0, 0.250, 0.022), sight=(0, -0.150, Z), scope=(0, -0.20, Z))
    return b.finish('sniper')


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(name, obs):
    for o in bpy.data.objects: o.select_set(o in obs)
    bpy.context.view_layer.objects.active = obs[0]
    path = os.path.join(OUT, name + '.glb')
    args = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_materials='NONE', export_normals=True, export_texcoords=False, export_animations=False)
    try: bpy.ops.export_scene.gltf(**args, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    except TypeError: bpy.ops.export_scene.gltf(**args, export_colors=True)
    tris = sum(len(o.data.polygons) for o in obs)
    print(f'  {name}.glb  {tris} triangles  {os.path.getsize(path) / 1024:.1f} kB')


def preview(name, obs, length):
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'VERTEX'
    sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.55, 0.55)
    sc.view_settings.view_transform = 'Standard'
    sc.display.shading.show_cavity = True
    sc.render.resolution_x = 900; sc.render.resolution_y = 420
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in obs:
        for v in o.data.vertices:
            for i in range(3): lo[i] = min(lo[i], v.co[i]); hi[i] = max(hi[i], v.co[i])
    mid = (lo + hi) / 2
    cam.data.ortho_scale = max(hi.y - lo.y, (hi.z - lo.z) * 900 / 420) * 1.15
    for tag, off in (('side', Vector((2.0, 0.0, 0.0))), ('three', Vector((1.4, -1.2, 0.8)))):
        cam.location = mid + off
        cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'{name}_{tag}.png')
        bpy.ops.render.render(write_still=True)


def game(p): return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]   # Blender (x, y, z) → the game's (x, z, −y)


print('WEAPONS:')
for name, make in (('pistol', pistol), ('ak47', ak47), ('sniper', sniper)):
    clear()
    r = make()
    obs = list(r) if isinstance(r, tuple) else [r]
    export(name, obs)
    if PREVIEW: preview(name, obs, 1)
with open(os.path.join(OUT, 'weapons.meta.json'), 'w') as f:
    json.dump({k: {n: game(p) for n, p in v.items()} for k, v in META.items()}, f, indent=2); f.write('\n')
print('  weapons.meta.json')
