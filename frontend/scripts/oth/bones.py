# OVERHILL — BONES for the cave world (2026-11-07, the user: "put some low-poly skeletons, some head parts, some toes, at
# some random places — use Blender to make that").
#
#   blender -b --factory-startup --python scripts/oth/bones.py -- [OUT=public/oth/valley] [PREVIEW=screenshots/bones]
#
# Low-poly, made from simple pieces: every long bone a tapered shaft (6 sides) with knobbed ends; the skull a cranium,
# a face, a jaw, teeth, and its sockets and nose (a separate dark part — the game paints it near black). Pieces:
#   skel_lying   a whole skeleton on its back, arms out
#   skel_sitting one slumped against a wall, legs out, its head fallen to a side
#   skull        a skull with its jaw          ribs   a broken ribcage with a bit of spine
#   femur        a thigh bone                  hand   a hand (palm, five fingers)      foot   a foot and its toes
# Each object's bone part is named <piece>, its dark part <piece>_dark. Units: metres, the ground at z 0, +y forward.
import sys, os, math
import bpy, bmesh
from mathutils import Vector, Matrix

ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/valley')
PREVIEW = ARGS.get('PREVIEW', 'screenshots/bones')
for o in list(bpy.data.objects): bpy.data.objects.remove(o)

class Part:
    """Collects triangles for one object (bone or dark)."""
    def __init__(self): self.bm = bmesh.new()
    def add(self, bm2, mat=Matrix()):
        me = bpy.data.meshes.new('t'); bm2.transform(mat); bm2.to_mesh(me); bm2.free(); self.bm.from_mesh(me); bpy.data.meshes.remove(me)

def ico(r, sub=1):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r); return bm

def bone(part, a, b, r, knob=1.55, sides=6):
    """A long bone from a to b: a shaft r thick (thinner in its middle) and a knob at each end."""
    a, b = Vector(a), Vector(b); d = b - a; L = d.length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r, radius2=r * 0.8, depth=L)
    for v in bm.verts:  # (waisted: narrower at the middle)
        t = v.co.z / L + 0.5; k = 1 - 0.25 * math.sin(math.pi * t); v.co.x *= k; v.co.y *= k
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    part.add(bm, Matrix.Translation((a + b) / 2) @ rot)
    for p in (a, b):  # (the knobs low-poly: an icosahedron)
        k = ico(r * knob, 0); part.add(k, Matrix.Translation(p) @ Matrix.Diagonal((1.0, 0.8, 0.9, 1.0)))

def chain(part, pts, r):
    for p, q in zip(pts, pts[1:]): bone(part, p, q, r, knob=1.2, sides=5)

def skull(part, dark, at, yaw=0.0, pitch=0.0, roll=0.0, jaw=True, s=1.0):
    """A skull at `at` (its cranium's centre), facing +y turned by yaw, tipped by pitch / roll."""
    M = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y') @ Matrix.Scale(s, 4)
    c = ico(0.1, 2)  # the cranium: long front to back, a little narrow, flat-ish under
    for v in c.verts: v.co = Vector((v.co.x * 0.88, v.co.y * 1.12, v.co.z * (0.95 if v.co.z > 0 else 0.8)))
    part.add(c, M)
    face = ico(0.07, 1); part.add(face, M @ Matrix.Translation((0, 0.06, -0.055)) @ Matrix.Diagonal((0.95, 0.7, 0.8, 1.0)))
    brow = ico(0.06, 1); part.add(brow, M @ Matrix.Translation((0, 0.075, 0.0)) @ Matrix.Diagonal((1.15, 0.5, 0.35, 1.0)))
    for sx in (-1, 1):  # cheekbones
        ck = ico(0.026, 1); part.add(ck, M @ Matrix.Translation((sx * 0.055, 0.082, -0.045)))
    # the sockets and the nose: dark, SET INTO the face (just showing at its surface)
    for sx in (-1, 1):
        e = ico(0.026, 1); dark.add(e, M @ Matrix.Translation((sx * 0.034, 0.096, -0.025)) @ Matrix.Diagonal((1.0, 0.6, 1.0, 1.0)))
    n = ico(0.014, 1); dark.add(n, M @ Matrix.Translation((0, 0.1, -0.062)) @ Matrix.Diagonal((0.8, 0.6, 1.3, 1.0)))
    # the upper teeth
    for k in range(6):
        a = (k - 2.5) * 0.28; t = bmesh.new(); bmesh.ops.create_cube(t, size=1.0)
        part.add(t, M @ Matrix.Translation((math.sin(a) * 0.04, 0.075 + math.cos(a) * 0.03, -0.095)) @ Matrix.Diagonal((0.01, 0.008, 0.015, 1.0)))
    if jaw:  # the jaw: a U of bone, its teeth
        jm = M @ Matrix.Translation((0, 0.0, -0.11))
        pts = [(math.sin(a) * 0.055, 0.035 + math.cos(a) * 0.075, 0.0) for a in [-1.6, -1.0, -0.5, 0.0, 0.5, 1.0, 1.6]]
        jp = Part(); chain(jp, pts, 0.012)
        for sx in (-1, 1): bone(jp, (sx * 0.055, 0.035, 0.0), (sx * 0.058, 0.0, 0.05), 0.011)
        part.add(jp.bm, jm)
        for k in range(6):
            a = (k - 2.5) * 0.28; t = bmesh.new(); bmesh.ops.create_cube(t, size=1.0)
            part.add(t, jm @ Matrix.Translation((math.sin(a) * 0.045, 0.1 + math.cos(a) * 0.03, 0.017)) @ Matrix.Diagonal((0.01, 0.008, 0.014, 1.0)))

def ribcage(part, at, yaw=0.0, n=7, broken=0.0, up=True, upright=False):
    """Ribs on a spine: n pairs, each an arc; `broken` the share of ribs snapped short. up: the cage standing (lying: on its back).
    upright: the spine standing (the stack up +z, the ribs curving forward +y — a sitting one)."""
    M = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z') @ (Matrix.Rotation(-math.pi / 2, 4, 'X') if upright else Matrix())
    for k in range(n):
        y0 = -k * 0.045; w = 0.12 + 0.035 * math.sin(math.pi * (k + 1) / (n + 1)); h = 0.14 - 0.006 * k
        for sx in (-1, 1):
            m = 6 if (k * 7 + (sx + 1) * 3) % 10 / 10 >= broken else 3
            pts = []
            for i in range(m + 1):
                a = math.pi * i / 6
                pts.append((sx * w * math.sin(a), y0 - 0.01 * i, h * (1 - math.cos(a)) * (1 if up else 0.55)))
            rp = Part(); chain(rp, pts, 0.008); part.add(rp.bm, M)
    sp = Part(); chain(sp, [(0, 0.06 - k * 0.05, 0.0) for k in range(n + 3)], 0.017); part.add(sp.bm, M)

def hand(part, at, yaw=0.0, s=1.0):
    M = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Scale(s, 4)
    hp = Part()
    for f in range(5):
        a = (f - 2) * 0.22 + (0.35 if f == 0 else 0); L = 0.055 if f == 0 else 0.07
        p0 = Vector((math.sin(a) * 0.02, math.cos(a) * 0.02, 0)); p1 = p0 + Vector((math.sin(a) * L, math.cos(a) * L, 0))
        p2 = p1 + Vector((math.sin(a * 1.2) * L * 0.6, math.cos(a * 1.2) * L * 0.6, -0.006)); p3 = p2 + Vector((math.sin(a * 1.3) * L * 0.45, math.cos(a * 1.3) * L * 0.45, -0.01))
        chain(hp, [p0, p1, p2, p3], 0.0055)
    pb = ico(0.025, 1); hp.add(pb, Matrix.Diagonal((1.0, 0.7, 0.4, 1.0)))
    part.add(hp.bm, M)

def foot(part, at, yaw=0.0, s=1.0):
    M = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Scale(s, 4)
    fp = Part()
    heel = ico(0.026, 1); fp.add(heel, Matrix.Translation((0, -0.05, 0.015)) @ Matrix.Diagonal((0.8, 1.2, 0.8, 1.0)))
    for t in range(5):  # the TOES (the user)
        x = (t - 2) * 0.017 + (0.004 if t == 0 else 0); L = 0.075 - abs(t - 1) * 0.006
        chain(fp, [(x * 0.6, -0.02, 0.012), (x, 0.03 + 0.0 * t, 0.006), (x * 1.05, 0.03 + L * 0.55, 0.004), (x * 1.1, 0.03 + L * 0.85, 0.0)], 0.0065 if t == 0 else 0.005)
    part.add(fp.bm, M)

def limb(part, a, b, c, r):
    bone(part, a, b, r); bone(part, b, c, r * 0.8)
    bone(part, Vector(b) + Vector((0.02, 0, 0)), Vector(c) + Vector((0.02, 0, 0)), r * 0.45)  # (the second, thinner bone)

def pelvis(part, at, yaw=0.0, tilt=0.0):
    M = Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X')
    for sx in (-1, 1):
        w = ico(0.06, 1); part.add(w, M @ Matrix.Translation((sx * 0.07, 0, 0.03)) @ Matrix.Diagonal((1.0, 0.45, 1.15, 1.0)))
    sa = ico(0.04, 1); part.add(sa, M @ Matrix.Translation((0, -0.02, 0.0)) @ Matrix.Diagonal((0.9, 0.6, 1.1, 1.0)))

PIECES = {}
def piece(name, build):
    b, d = Part(), Part(); build(b, d); PIECES[name] = (b, d)

def skel_lying(b, d):
    # on its back, along +y (the head at +y), arms out a little, one leg bent
    skull(b, d, (0.02, 0.86, 0.1), yaw=0.25, pitch=-1.35, roll=0.3)
    ribcage(b, (0, 0.6, 0.02), n=7, broken=0.25, up=False)
    pelvis(b, (0, 0.12, 0.05), tilt=1.4)
    for sx in (-1, 1):
        sh = (sx * 0.17, 0.58, 0.04)
        el = (sx * 0.32, 0.36 + (0.05 if sx > 0 else 0), 0.03); wr = (sx * 0.4, 0.13 + (0.08 if sx > 0 else -0.04), 0.03)
        limb(b, sh, el, wr, 0.016); hand(b, Vector(wr) + Vector((sx * 0.01, -0.03, 0)), yaw=math.pi + sx * 0.4)
        hip = (sx * 0.09, 0.08, 0.04)
        kn = (sx * 0.13, -0.32, 0.04 + (0.16 if sx > 0 else 0)); an = (sx * 0.15, -0.72 + (0.1 if sx > 0 else 0), 0.03)
        limb(b, hip, kn, an, 0.022); foot(b, Vector(an) + Vector((0, -0.04, 0)), yaw=math.pi + sx * 0.3)

def skel_sitting(b, d):
    # slumped against a wall (behind it, at −y): the spine up, the ribs forward, its head fallen forward and to a side,
    # the arms down at its sides, the hands on the ground, the legs out along +y, one knee up
    ribcage(b, (0, -0.06, 0.2), n=7, broken=0.15, up=True, upright=True)  # (stacked up from just over the pelvis)
    pelvis(b, (0, -0.02, 0.07), tilt=0.15)
    skull(b, d, (0.07, 0.02, 0.76), yaw=0.35, pitch=0.55, roll=0.45)
    for sx in (-1, 1):
        sh = (sx * 0.16, -0.04, 0.56); el = (sx * 0.22, 0.04, 0.3); wr = (sx * 0.24, 0.16, 0.05)
        limb(b, sh, el, wr, 0.015); hand(b, Vector(wr) + Vector((0, 0.05, -0.04)), yaw=sx * 0.25)
        hip = (sx * 0.09, 0.0, 0.07); kn = (sx * 0.13, 0.4, 0.28 if sx > 0 else 0.06); an = (sx * 0.15, 0.78 if sx < 0 else 0.62, 0.03)
        limb(b, hip, kn, an, 0.021); foot(b, Vector(an) + Vector((0, 0.05, 0)), yaw=sx * 0.2)

piece('skel_lying', skel_lying)
piece('skel_sitting', skel_sitting)
piece('skull', lambda b, d: skull(b, d, (0, 0, 0.1), pitch=-0.15))
piece('ribs', lambda b, d: ribcage(b, (0, 0.15, 0.02), n=6, broken=0.5, up=False))
piece('femur', lambda b, d: bone(b, (0, -0.22, 0.025), (0.02, 0.22, 0.025), 0.022))
piece('hand', lambda b, d: hand(b, (0, 0, 0.008), s=1.3))
piece('foot', lambda b, d: foot(b, (0, 0, 0.008), s=1.3))

col = bpy.data.collections.new('bones'); bpy.context.scene.collection.children.link(col)
objs = []
for name, (b, d) in PIECES.items():
    for part, suffix in ((b, ''), (d, '_dark')):
        if not part.bm.faces: continue
        bmesh.ops.remove_doubles(part.bm, verts=part.bm.verts, dist=0.0005)
        bmesh.ops.triangulate(part.bm, faces=part.bm.faces[:])
        me = bpy.data.meshes.new(name + suffix); part.bm.to_mesh(me); part.bm.free()
        for f in me.polygons: f.use_smooth = False
        ob = bpy.data.objects.new(name + suffix, me); col.objects.link(ob); objs.append(ob)
        print(f'{name + suffix}: {len(me.polygons)} triangles')

os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
path = os.path.join(OUT, 'bones.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                          export_texcoords=False, export_materials='NONE', export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=7, export_draco_position_quantization=14, export_draco_normal_quantization=10)
print(f'wrote {path}: {os.path.getsize(path) / 1e3:.0f} KB')

# PREVIEW: the pieces laid out on a dark floor
if PREVIEW != 'none':
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 1600; sc.render.resolution_y = 900
    sc.view_settings.view_transform = 'Standard'
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.37, 0.4, 1)
    def mat(n, c):
        m = bpy.data.materials.new(n); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1); return m
    bm_, dm_ = mat('bone', (0.62, 0.57, 0.46)), mat('dark', (0.03, 0.025, 0.02))
    xs = {'skel_lying': (-1.2, 0), 'skel_sitting': (0.3, 0.3), 'skull': (1.2, 0.6), 'ribs': (1.2, -0.3), 'femur': (-0.1, -0.9), 'hand': (0.6, -0.9), 'foot': (0.9, -0.9)}
    for o in objs:
        base = o.name.replace('_dark', ''); o.location = (*xs[base], 0)
        o.data.materials.append(dm_ if o.name.endswith('_dark') else bm_)
    bpy.ops.mesh.primitive_plane_add(size=8); bpy.context.active_object.data.materials.append(mat('floor', (0.18, 0.16, 0.12)))
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4; sun.rotation_euler = (0.7, 0.2, 0.6); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.lens = 35; sc.collection.objects.link(cam); sc.camera = cam
    aim = bpy.data.objects.new('aim', None); sc.collection.objects.link(aim)
    c = cam.constraints.new('TRACK_TO'); c.target = aim; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
    for name, frm, to in [('all', (0.2, -3.2, 2.2), (0.1, 0, 0.1)), ('skull', (1.5, 0.95, 0.35), (1.2, 0.6, 0.1)), ('sitting', (0.6, 1.6, 0.9), (0.3, 0.3, 0.4)), ('foot_hand', (0.75, -1.35, 0.45), (0.75, -0.9, 0.0))]:
        cam.location = frm; aim.location = to
        sc.render.filepath = os.path.abspath(os.path.join(PREVIEW, f'bones_{name}.png')); bpy.ops.render.render(write_still=True)
