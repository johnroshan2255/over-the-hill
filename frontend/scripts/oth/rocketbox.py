# (SUPERSEDED 2026-11-09 by scripts/oth/hero.py — the user wanted a younger, athletic look; kept for the record. The game
# now also reads character_n.webp, which this doesn't write.)
# OVERHILL — THE CHARACTER from a Microsoft Rocketbox avatar (2026-11-09, the user: "making our human a perfect playable
# char … even I don't like to use that char"). The Meshy-made Trail Warden (character.py) was a decimated scan painted
# by region, auto-weighted: ragged colour edges, mitten hands. Rocketbox's avatars (github.com/microsoft/Microsoft-
# Rocketbox, MIT) are made by hand by a games studio: clean topology, ~8 k triangles, painted 2 K textures, skinned by
# an artist. The first pick (Male_Adult_05) read as old and heavy (the user: "make it like a 30 year old with a
# normal body"; then "a white guy … natural"): now Male_Adult_08 — about 30, a normal build, a light blue shirt with
# its sleeves rolled, dark jeans (screenshots/character/candidates.jpg: those looked at). This takes one as it is and fits it to the game's
# skeleton and clips:
#
#   blender -b --factory-startup --python scripts/oth/rocketbox.py -- [AVATAR=Male_Adult_08]
#           [SRC=scripts/oth/.cache/rocketbox/<AVATAR>] [CLIPS=scripts/oth/.cache/mixamo]
#           [OUT=src/assets/models/human/character.glb] [TEX=1536] [PREVIEW=<dir>]
#
#   1. the mesh (the "hipoly" export: body, head and the hair's alpha cards) in its bind pose, turned to face the game's
#      −z, in metres; the hair cards doubled back to back (the game draws one side);
#   2. the game's SKELETON (Mixamo's 22 bones by name — Character.ts and the clips know them) put on the avatar's own
#      Biped joints; the avatar's 80 bones' WEIGHTS folded onto it: the fingers into the hand, the face's bones into the
#      head, everything else one to one — the artist's skinning kept, no bone heat;
#   3. its three textures packed into ONE atlas (one draw): the body 1024², the head and the hair 512² beside it — the
#      hair's alpha kept (the game cuts the cards out), its clear texels filled with the hair's colour (no fringe);
#   4. each Mixamo clip RETARGETED onto it (character.py's way: per bone, the source's turn from its rest applied to
#      ours from our rest; the hips' travel scaled by the legs);
#   5. out: the GLB (skinned mesh + UVs, Draco; the skeleton; the clips) and the atlas beside it as WebP.
import sys, os, math, json
import numpy as np
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
AVATAR = kw.get('AVATAR', 'Male_Adult_08')
SRC = os.path.abspath(kw.get('SRC', os.path.join(HERE, '.cache', 'rocketbox', AVATAR)))
CLIPS = kw.get('CLIPS', os.path.join(HERE, '.cache', 'mixamo'))
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'human', 'character.glb')))
OUT_TEX = OUT[:-4] + '.webp'
TEXW = int(kw.get('TEX', '1536'))          # the atlas: TEXW × TEXW·2/3 (body ⅔ of the width, head + hair the last ⅓)
PREVIEW = kw.get('PREVIEW')
PFX = 'mixamorig:'
def log(*a): print('[rocketbox]', *a, flush=True)

# ===================================================================================================== 1. the mesh
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.context.scene.render.fps = 30   # (Mixamo's clips are 30 fps)
col = bpy.context.scene.collection
fbx = os.path.join(SRC, f'{AVATAR}.fbx')
bpy.ops.import_scene.fbx(filepath=fbx)
src_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH')
# the Biped's joints (world, metres) before anything moves
JW = {b.name.replace('Bip01 ', ''): (src_arm.matrix_world @ b.head_local).copy() for b in src_arm.data.bones}
# the mesh freed from the Biped, its transform applied (cm → m), then turned 180° about z: Rocketbox faces Blender −y,
# the game's −z is Blender +y (export_yup)
for m in list(body.modifiers):
    if m.type == 'ARMATURE': body.modifiers.remove(m)
mw = body.matrix_world.copy(); body.parent = None; body.matrix_world = mw
bpy.context.view_layer.objects.active = body; body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
TURN = Matrix.Rotation(math.pi, 4, 'Z')
body.data.transform(TURN); body.data.update()
J = {k: TURN @ v for k, v in JW.items()}
bpy.data.objects.remove(src_arm)
me = body.data
zs = [v.co.z for v in me.vertices]
log(f'{AVATAR}: {len(me.vertices)} vertices, {len(me.polygons)} faces, {min(zs):.3f} … {max(zs):.3f} m; materials {[m.name for m in me.materials]}')
crown_z = max(zs)

# which material is which: by the texture each one samples
def mat_kind(m):
    n = m.name.lower()
    return 'hair' if 'opacity' in n else 'head' if 'head' in n else 'body'
kinds = [mat_kind(m) for m in me.materials]

# ===================================================================================================== 2. the skeleton
def side(s): return ('L', 'Left') if s == 'l' else ('R', 'Right')
SK = [('Hips', J['Pelvis'], J['Spine'], None),
      ('Spine', J['Spine'], J['Spine1'], 'Hips'),
      ('Spine1', J['Spine1'], J['Spine2'], 'Spine'),
      ('Spine2', J['Spine2'], J['Neck'], 'Spine1'),
      ('Neck', J['Neck'], J['Head'], 'Spine2'),
      ('Head', J['Head'], Vector((J['Head'].x, J['Head'].y, crown_z)), 'Neck')]
for s in 'lr':
    b, Side = side(s)
    hand, mid = J[f'{b} Hand'], J[f'{b} Finger2']
    toe = J[f'{b} Toe0']
    fwd = Vector((0, 1, 0))                      # (the front, after the turn)
    SK += [(f'{Side}Shoulder', J[f'{b} Clavicle'], J[f'{b} UpperArm'], 'Spine2'),
           (f'{Side}Arm', J[f'{b} UpperArm'], J[f'{b} Forearm'], f'{Side}Shoulder'),
           (f'{Side}ForeArm', J[f'{b} Forearm'], hand, f'{Side}Arm'),
           (f'{Side}Hand', hand, hand + (mid - hand) * 1.8, f'{Side}ForeArm'),
           (f'{Side}UpLeg', J[f'{b} Thigh'], J[f'{b} Calf'], 'Hips'),
           (f'{Side}Leg', J[f'{b} Calf'], J[f'{b} Foot'], f'{Side}UpLeg'),
           (f'{Side}Foot', J[f'{b} Foot'], Vector((toe.x, toe.y, max(toe.z, 0.03))), f'{Side}Leg'),
           (f'{Side}ToeBase', Vector((toe.x, toe.y, max(toe.z, 0.03))), Vector((toe.x, toe.y, max(toe.z, 0.03))) + fwd * 0.08, f'{Side}Foot')]
# (Mixamo's order: the hips, the legs, the spine, the arms off the chest, the neck and head — parents before children)
NAMES = [n for n, *_ in SK]
arm = bpy.data.armatures.new('skeleton'); rig = bpy.data.objects.new('skeleton', arm); col.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for n, h, t, par in SK:
    eb = arm.edit_bones.new(PFX + n); eb.head = h; eb.tail = t
    # (the roll as character.py's: the bone's z toward the body's front for the limbs and the trunk)
    eb.align_roll(Vector((0, 1, 0)) if abs((eb.tail - eb.head).normalized().y) < 0.9 else Vector((0, 0, 1)))
    if par: eb.parent = arm.edit_bones[PFX + par]; eb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
log(f'skeleton: {len(SK)} bones')

# the weights: each Biped bone's folded onto ours
def target(bip):
    n = bip.replace('Bip01 ', '')
    one = {'Pelvis': 'Hips', 'Spine': 'Spine', 'Spine1': 'Spine1', 'Spine2': 'Spine2', 'Neck': 'Neck'}
    if n in one: return one[n]
    if n[:2] in ('L ', 'R '):
        Side = 'Left' if n[0] == 'L' else 'Right'; part = n[2:]
        if part.startswith('Finger') or part == 'Hand': return Side + 'Hand'
        return Side + {'Clavicle': 'Shoulder', 'UpperArm': 'Arm', 'Forearm': 'ForeArm', 'Thigh': 'UpLeg', 'Calf': 'Leg', 'Foot': 'Foot', 'Toe0': 'ToeBase'}[part]
    return 'Head'   # (the head, the eyes, the jaw, the lips, the brows …)
old = list(body.vertex_groups)
W = np.zeros((len(me.vertices), len(SK)), np.float32)
gi = {g.index: NAMES.index(target(g.name)) for g in old}
for v in me.vertices:
    for g in v.groups:
        if g.group in gi: W[v.index, gi[g.group]] += g.weight
for g in old: body.vertex_groups.remove(g)
groups = [body.vertex_groups.new(name=PFX + n) for n in NAMES]
s = W.sum(1); log(f'weights: {int((s < 1e-4).sum())} vertices unweighted, max bones a vertex {int((W > 1e-4).sum(1).max())}')
for k, g in enumerate(groups):
    idx = np.nonzero(W[:, k] > 1e-4)[0]
    for i in idx: g.add([int(i)], float(W[i, k] / max(s[i], 1e-6)), 'REPLACE')
body.parent = rig
mod = body.modifiers.new('skeleton', 'ARMATURE'); mod.object = rig

# the hair cards doubled back to back (the game draws front faces; a card seen from behind would vanish)
import bmesh
bm = bmesh.new(); bm.from_mesh(me)
hair_mi = [i for i, k in enumerate(kinds) if k == 'hair']
hf = [f for f in bm.faces if f.material_index in hair_mi]
if hf:
    dup = bmesh.ops.duplicate(bm, geom=hf)
    back = [g for g in dup['geom'] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(bm, faces=back)
    bm.to_mesh(me); me.update()
    log(f'hair: {len(hf)} cards doubled')
bm.free()

# ===================================================================================================== 3. the atlas
TW, TH = TEXW, TEXW * 2 // 3
B = TW * 2 // 3           # the body's square
Hs = TH // 2               # the head's and the hair's squares
REGION = {'body': (0, 0, B, B), 'head': (B, Hs, Hs, Hs), 'hair': (B, 0, Hs, Hs)}   # x, y (from the bottom), w, h — pixels
def tex_of(kind):
    t = os.path.join(SRC, 'Textures')
    f = next(f for f in os.listdir(t) if f.endswith(('opacity_color.tga' if kind == 'hair' else f'{kind}_color.tga')))
    return os.path.join(t, f)
atlas = np.zeros((TH, TW, 4), np.float32); atlas[..., 3] = 1
for kind, (x, y, w, h) in REGION.items():
    if kind not in kinds: continue    # (an avatar in a cap has no hair cards)
    im = bpy.data.images.load(tex_of(kind)); im.scale(w, h)
    px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    if kind == 'hair':
        a = px[..., 3]
        solid = a > 0.5
        mean = px[solid][:, :3].mean(0) if solid.any() else np.array([0.1, 0.08, 0.06])
        # (the clear texels take the hair's colour, the edge texels pulled toward it: no fringe when filtered)
        px[..., :3] = px[..., :3] * a[..., None] + mean * (1 - a[..., None])
    else:
        px[..., 3] = 1
    atlas[y:y + h, x:x + w] = px
    log(f'atlas: {kind} {w}×{h} at {x},{y}')
# the UVs moved into their regions (per face, by its material)
uv = me.uv_layers.active.data
for p in me.polygons:
    x, y, w, h = REGION[kinds[p.material_index]]
    for li in p.loop_indices:
        u, v = uv[li].uv
        u = min(max(u, 0.0), 1.0); v = min(max(v, 0.0), 1.0)
        uv[li].uv = ((x + u * w) / TW, (y + v * h) / TH)
img = bpy.data.images.new('atlas', TW, TH, alpha=True)
img.pixels = atlas.ravel()
sc = bpy.context.scene
sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.image_settings.quality = 88
os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save_render(OUT_TEX, scene=sc)
log(f'wrote {OUT_TEX}: {os.path.getsize(OUT_TEX) / 1e3:.0f} kB ({TW}×{TH})')
# one material (the preview's; the game reads only the UVs)
for i in range(len(me.materials)): me.materials.pop(index=0)
mat = bpy.data.materials.new('character'); mat.use_nodes = True
nt = mat.node_tree; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img
bs = nt.nodes['Principled BSDF']; nt.links.new(tn.outputs['Color'], bs.inputs['Base Color']); nt.links.new(tn.outputs['Alpha'], bs.inputs['Alpha'])
bs.inputs['Roughness'].default_value = 0.8
try: mat.blend_method = 'CLIP'
except Exception: pass
me.materials.append(mat)

# ===================================================================================================== 4. the clips
def world_rot(obj, pb): return (obj.matrix_world @ pb.matrix).to_quaternion()
def rest_world(obj, bone): return (obj.matrix_world @ bone.matrix_local).to_quaternion()
ORDER = [PFX + n for n in NAMES]
leg_ours = (J['R Thigh'] - J['R Calf']).length + (J['R Calf'] - J['R Foot']).length
clips = sorted(f for f in os.listdir(CLIPS) if f.endswith('.fbx')) if os.path.isdir(CLIPS) else []
rig.animation_data_create()
CLIPINFO = {}
for f in clips:
    name = f[:-4]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(CLIPS, f), automatic_bone_orientation=False, ignore_leaf_bones=True)
    new = [o for o in bpy.data.objects if o not in before]
    srcA = next((o for o in new if o.type == 'ARMATURE'), None)
    if not srcA or not srcA.animation_data or not srcA.animation_data.action:
        log(f'  {name}: no armature / action'); [bpy.data.objects.remove(o) for o in new]; continue
    act = srcA.animation_data.action
    f0, f1 = (int(round(x)) for x in act.frame_range)
    srcA.rotation_euler.z += math.pi     # (Mixamo's character faces the other way)
    bpy.context.view_layer.update()
    sb = {b.name: b for b in srcA.data.bones}
    def wpos(obj, bone): return obj.matrix_world @ bone.head_local
    leg_src = (wpos(srcA, sb[PFX + 'RightUpLeg']) - wpos(srcA, sb[PFX + 'RightLeg'])).length + (wpos(srcA, sb[PFX + 'RightLeg']) - wpos(srcA, sb[PFX + 'RightFoot'])).length
    k_leg = leg_ours / max(1e-6, leg_src)
    src_rest = {n: rest_world(srcA, sb[n]) for n in ORDER if n in sb}
    def axis(obj, bone): return (obj.matrix_world.to_3x3() @ bone.matrix_local.to_3x3()).col[1].normalized()
    tgt_rest = {}
    for n in ORDER:
        q = rest_world(rig, rig.data.bones[n])
        if n in sb: q = axis(rig, rig.data.bones[n]).rotation_difference(axis(srcA, sb[n])) @ q
        tgt_rest[n] = q
    hips_src0 = wpos(srcA, sb[PFX + 'Hips']); hips_tgt0 = rig.matrix_world @ rig.data.bones[PFX + 'Hips'].head_local
    out = bpy.data.actions.new(name); rig.animation_data.action = out
    scn = bpy.context.scene
    LOOP = name in ('idle', 'walk', 'run', 'sprint', 'fall', 'grab_ledge', 'sit_drive')
    hips_path = []
    for fr in range(f0, f1 + 1):
        scn.frame_set(fr); hips_path.append((srcA.matrix_world @ srcA.pose.bones[PFX + 'Hips'].head).copy())
    travel = hips_path[-1] - hips_path[0]; travel.z = 0
    dur = max(1, f1 - f0) / 30
    CLIPINFO[name] = {'loop': LOOP, 'speed': round(travel.length * k_leg / dur, 3) if LOOP else 0, 'frames': f1 - f0 + 1}
    for fr in range(f0, f1 + 1):
        scn.frame_set(fr)
        for n in ORDER:
            pb = rig.pose.bones[n]
            wq = world_rot(srcA, srcA.pose.bones[n]) @ src_rest[n].inverted() @ tgt_rest[n] if n in src_rest else tgt_rest[n]
            mat4 = (rig.matrix_world.inverted().to_quaternion() @ wq).to_matrix().to_4x4()
            if n == PFX + 'Hips':
                hp = hips_path[fr - f0].copy()
                if LOOP: hp -= travel * ((fr - f0) / max(1, f1 - f0))
                mat4.translation = rig.matrix_world.inverted() @ (hips_tgt0 + (hp - hips_src0) * k_leg)
            else:
                mat4.translation = pb.matrix.translation
            pb.matrix = mat4
            bpy.context.view_layer.update()
            pb.keyframe_insert('rotation_quaternion', frame=fr - f0)
            if n == PFX + 'Hips': pb.keyframe_insert('location', frame=fr - f0)
    rig.animation_data.action = None
    trk = rig.animation_data.nla_tracks.new(); trk.name = name; trk.strips.new(name, 0, out)
    for o in new: bpy.data.objects.remove(o)
    log(f'  {name}: {f1 - f0 + 1} frames (legs × {k_leg:.2f}){"  loop, " + str(CLIPINFO[name]["speed"]) + " m/s" if LOOP else ""}')
for pb in rig.pose.bones: pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
rig['clips'] = json.dumps(CLIPINFO)

# ===================================================================================================== 5. out
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=True,
                          export_materials='NONE', export_extras=True, export_skins=True, export_all_influences=False, export_animations=True,
                          export_animation_mode='NLA_TRACKS' if clips else 'ACTIONS', export_force_sampling=True, export_frame_step=1,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                          export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
me.calc_loop_triangles()
log(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.1f} kB, {len(me.loop_triangles)} triangles, {len(clips)} clips')

if PREVIEW:
    # the look (Eevee, the atlas): front, three-quarter, side, back — and frames of the clips from the side
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.engine = next((e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]))
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'
    sc.render.resolution_x, sc.render.resolution_y = 600, 1000
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.66, 0.72, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(55), 0, math.radians(200)); col.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
    def shoot(path, ang, z=0.92, d=6):
        a = math.radians(ang)
        cam.location = Vector((d * math.sin(a), d * math.cos(a), z))
        cam.rotation_euler = (Vector((0, 0, z)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    for ang in (0, 35, 90, 180):
        shoot(os.path.join(PREVIEW, f'look_{ang:03d}.png'), ang)
    cam.data.ortho_scale = 0.5
    shoot(os.path.join(PREVIEW, 'look_face.png'), 15, z=1.66)
    cam.data.ortho_scale = 2.2
    for name, t in (('walk', 0.25), ('run', 0.3), ('jump', 0.45), ('pickup', 0.5), ('sit_drive', 0.5), ('idle', 0.3)):
        a = bpy.data.actions.get(name)
        if not a: continue
        rig.animation_data.action = a
        f0, f1 = a.frame_range
        sc.frame_set(int(f0 + (f1 - f0) * t))
        shoot(os.path.join(PREVIEW, f'clip_{name}.png'), 60)
    log(f'previews in {PREVIEW}')
