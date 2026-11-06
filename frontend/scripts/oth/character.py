# OVER THE HILL — THE CHARACTER, rigged and animated (2026-11-05, the user: "add a skeleton and proper animation for walk,
# run, jump, grab … getting out of the car by opening the door, on and off the bikes — do it in Blender and use
# mixamo.com"). The source is the painted Trail Warden (rider.py's pass 1); the motion is Mixamo's (scripts/harness/
# mixamo.mjs: clips on Mixamo's own `mixamorig` skeleton, no skin).
#
#   blender -b --factory-startup --python scripts/oth/character.py -- [SRC=scripts/oth/.cache/rider_painted.glb]
#           [CLIPS=scripts/oth/.cache/mixamo] [OUT=src/assets/models/human/character.glb] [TRIS=12000] [PREVIEW=<dir>]
#
#   1. the mesh as rider.py makes it (1.80 m, facing −z, decimated with its colour borders kept, painted by region);
#   2. a SKELETON on its own joints (measured as rider.py measures them) with Mixamo's bone names (mixamorig:Hips …
#      — the clips map by name), the hands and toes single bones;
#   3. SKINNED by Blender's automatic (bone heat) weights, at most 4 bones a vertex;
#   4. each Mixamo clip RETARGETED onto it: per bone, the source's turn from its own rest (in the world) applied to
#      ours from our rest — the A-pose and the T-pose cancel out; the hips' travel scaled by the legs' length;
#   5. one GLB: the skinned mesh (Draco), the skeleton, every clip an animation (named as its file).
import sys, os, math, json
import numpy as np
import bpy
from mathutils import Matrix, Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
_kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
_kw.setdefault('SRC', os.path.join(HERE, '.cache', 'rider_painted.glb'))
CLIPS = _kw.pop('CLIPS', os.path.join(HERE, '.cache', 'mixamo'))
OUT_C = os.path.abspath(_kw.pop('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'human', 'character.glb')))
PREVIEW_C = _kw.pop('PREVIEW', None)
sys.argv = [sys.argv[0], '--'] + [f'{k}={v}' for k, v in _kw.items()]
# rider.py's first stage: the painted mesh decimated (P game space, F, SRC_MATS), its joints (J), the geometry (RD)
_src = open(os.path.join(HERE, 'rider.py'), encoding='utf-8').read()
exec(compile(_src[:_src.index('# the bones:')], os.path.join(HERE, 'rider.py'), 'exec'), globals())
def clog(*a): print('[character]', *a, flush=True)
def g2b(v): return Vector((float(v[0]), float(-v[2]), float(v[1])))

COL = {  # (as rider.py's — after refer/char.png)
    'Skin': ('#C08A66', 0.7), 'Hair': ('#3B2A1E', 0.8), 'Beard': ('#4A3526', 0.85), 'Stubble': ('#8A6450', 0.85), 'Eye': ('#2B211C', 0.3),
    'Brow': ('#3A2A1F', 0.85), 'Lips': ('#A2604D', 0.6), 'Shirt': ('#46593A', 0.85), 'Vest': ('#A4492B', 0.75),
    'VestTrim': ('#6E3420', 0.75), 'Belt': ('#24221F', 0.6), 'Pants': ('#4A4B4C', 0.85), 'Knee': ('#36373A', 0.85), 'Boots': ('#5C3B24', 0.75),
    'Sole': ('#2A2420', 0.85), 'Gloves': ('#4B3627', 0.8), 'Metal': ('#8E9196', 0.4),
}
def srgb_to_linear(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

# ===================================================================================================== the mesh
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.context.scene.render.fps = 30   # (Mixamo's clips are 30 fps: at Blender's 24 they'd export 25 % slow)
col = bpy.context.scene.collection
me = bpy.data.meshes.new('character')
me.from_pydata([g2b(p) for p in P], [], F.tolist())
names = list(COL)
for n in names:
    m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
    lin = srgb_to_linear(COL[n][0]); m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value = (*lin, 1); bs.inputs['Roughness'].default_value = COL[n][1]
    m.diffuse_color = (*lin, 1)
    me.materials.append(m)
me.polygons.foreach_set('material_index', [names.index(r if r in COL else 'Skin') for r in (SRC_MATS or ['Skin'] * len(F))])
me.update(); me.shade_smooth()
body = bpy.data.objects.new('character', me); col.objects.link(body)
clog(f'mesh: {len(F)} triangles, {len(P)} vertices')

# ===================================================================================================== the skeleton
pel, chest, neck, crown = J['pelvis'], J['chest'], J['neck'], J['crown']
def lerp(a, b, t): return a + (b - a) * t
ball = {s: np.array([J[f'ankle_{s}'][0], 0.035, lerp(J[f'ankle_{s}'], J[f'toe_{s}'], 0.62)[2]]) for s in 'lr'}
# (name, head, tail, parent) — game space
SK = [('Hips', pel, lerp(pel, neck, 0.12), None),
      ('Spine', lerp(pel, neck, 0.12), lerp(pel, neck, 0.36), 'Hips'),
      ('Spine1', lerp(pel, neck, 0.36), lerp(pel, neck, 0.62), 'Spine'),
      ('Spine2', lerp(pel, neck, 0.62), neck, 'Spine1'),
      ('Neck', neck, lerp(neck, crown, 0.3), 'Spine2'),
      ('Head', lerp(neck, crown, 0.3), crown, 'Neck')]
for s, Side in (('l', 'Left'), ('r', 'Right')):
    x = -1 if s == 'l' else 1
    clav = np.array([x * 0.035, neck[1] - 0.06, neck[2] + 0.01])
    SK += [(f'{Side}Shoulder', clav, J[f'shoulder_{s}'], 'Spine2'),
           (f'{Side}Arm', J[f'shoulder_{s}'], J[f'elbow_{s}'], f'{Side}Shoulder'),
           (f'{Side}ForeArm', J[f'elbow_{s}'], J[f'wrist_{s}'], f'{Side}Arm'),
           (f'{Side}Hand', J[f'wrist_{s}'], J[f'hand_{s}'] + (J[f'hand_{s}'] - J[f'wrist_{s}']) * 0.8, f'{Side}ForeArm'),
           (f'{Side}UpLeg', J[f'hip_{s}'], J[f'knee_{s}'], 'Hips'),
           (f'{Side}Leg', J[f'knee_{s}'], J[f'ankle_{s}'], f'{Side}UpLeg'),
           (f'{Side}Foot', J[f'ankle_{s}'], ball[s], f'{Side}Leg'),
           (f'{Side}ToeBase', ball[s], np.array([ball[s][0], 0.03, J[f'toe_{s}'][2]]), f'{Side}Foot')]
PFX = 'mixamorig:'
arm = bpy.data.armatures.new('skeleton'); rig = bpy.data.objects.new('skeleton', arm); col.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for n, h, t, par in SK:
    eb = arm.edit_bones.new(PFX + n); eb.head = g2b(h); eb.tail = g2b(t)
    # (the roll: the bone's z toward the body's front for the limbs and the trunk — Blender −y is the game's −z… front)
    eb.align_roll(Vector((0, 1, 0)) if abs((eb.tail - eb.head).normalized().y) < 0.9 else Vector((0, 0, 1)))
    if par: eb.parent = arm.edit_bones[PFX + par]; eb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
clog(f'skeleton: {len(SK)} bones')

# ===================================================================================================== the skin
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
vg_n = len(body.vertex_groups)
unweighted = sum(1 for v in body.data.vertices if sum(g.weight for g in v.groups) < 1e-4)
clog(f'automatic weights: {vg_n} groups, {unweighted} vertices unweighted')
if unweighted > len(body.data.vertices) * 0.02:
    # (bone heat failed on part of the mesh: those vertices take their nearest bone)
    heads = {n: (g2b(h), g2b(t)) for n, h, t, _ in SK}
    for v in body.data.vertices:
        if sum(g.weight for g in v.groups) >= 1e-4: continue
        best, bd = None, 9
        for n, (h, t) in heads.items():
            ab = t - h; tt = max(0, min(1, (v.co - h).dot(ab) / ab.length_squared)); d = (v.co - (h + ab * tt)).length
            if d < bd: best, bd = n, d
        body.vertex_groups[PFX + best].add([v.index], 1.0, 'REPLACE')
    clog('  filled the unweighted by their nearest bone')
# THE SEAT AND THE HIPS (2026-11-05, the user: "the butt is wiggling while walking"): bone heat let the thighs reach up
# over the buttocks and the belt — every stride swung them. Above the hip joints the thighs' share fades out (sooner
# at the back), handed to the hips.
hipY = float((J['hip_l'][1] + J['hip_r'][1]) / 2)
gHips = body.vertex_groups[PFX + 'Hips']
legs = [body.vertex_groups[PFX + n] for n in ('LeftUpLeg', 'RightUpLeg')]
moved = 0
for v in body.data.vertices:
    y, z = v.co.z, -v.co.y                        # (game y, game z: + = behind)
    lo = hipY - (0.2 if z > 0.02 else 0.1)        # (the buttocks: from 20 cm under the joint)
    hi = hipY + 0.02
    f = 1 - min(1, max(0, (y - lo) / (hi - lo))); f = f * f * (3 - 2 * f)
    if f >= 0.999: continue
    for g in legs:
        try: w = g.weight(v.index)
        except RuntimeError: continue
        if w <= 0: continue
        g.add([v.index], w * f, 'REPLACE')
        try: wh = gHips.weight(v.index)
        except RuntimeError: wh = 0
        gHips.add([v.index], wh + w * (1 - f), 'REPLACE'); moved += 1
clog(f'  the hips take the seat: {moved} vertices eased off the thighs')
# THE SHOULDERS (2026-11-05, the user: "from the back the shoulders are too big and rounded, like a watermelon"): bone
# heat gave the upper arms the whole shoulder cap — the arm swung down from its A-pose rest and pushed the cap out round.
# Along each arm from the shoulder joint, the arm's share fades in over the first 13 cm (the cap stays the clavicle's)
moved = 0
for side, Side in (('l', 'Left'), ('r', 'Right')):
    sh, el = g2b(J[f'shoulder_{side}']), g2b(J[f'elbow_{side}'])
    ax = (el - sh); L = ax.length; ax.normalize()
    gA, gS = body.vertex_groups[PFX + f'{Side}Arm'], body.vertex_groups[PFX + f'{Side}Shoulder']
    for v in body.data.vertices:
        t = (v.co - sh).dot(ax)
        if t > 0.13 or (v.co - sh).length > 0.3: continue
        try: w = gA.weight(v.index)
        except RuntimeError: continue
        if w <= 0: continue
        f = min(1, max(0, (t + 0.03) / 0.16)); f = f * f * (3 - 2 * f)
        gA.add([v.index], w * f, 'REPLACE')
        try: ws = gS.weight(v.index)
        except RuntimeError: ws = 0
        gS.add([v.index], ws + w * (1 - f), 'REPLACE'); moved += 1
clog(f'  the shoulder caps the clavicles\': {moved} vertices eased off the upper arms')
bpy.context.view_layer.objects.active = body
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

# AMBIENT OCCLUSION baked into the vertices (Cycles: the pockets, the folds, under the vest and the arms darker — the
# shading a texture would have), multiplied into the colours by the game
scn0 = bpy.context.scene
scn0.render.engine = 'CYCLES'; scn0.cycles.samples = 64; scn0.cycles.device = 'CPU'
ca = body.data.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
body.data.color_attributes.active_color = ca
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
scn0.world = scn0.world or bpy.data.worlds.new('w')
scn0.render.bake.target = 'VERTEX_COLORS'
bpy.ops.object.bake(type='AO')
ao = [d.color[0] for d in ca.data]
clog(f'  ambient occlusion baked: {min(ao):.2f} … {max(ao):.2f} (mean {sum(ao) / len(ao):.2f})')

# ===================================================================================================== the clips
def world_rot(obj, pb):
    return (obj.matrix_world @ pb.matrix).to_quaternion()
def rest_world(obj, bone):
    return (obj.matrix_world @ bone.matrix_local).to_quaternion()
ORDER = [PFX + n for n, *_ in SK]     # (parents before children)
leg_ours = float(np.linalg.norm(J['hip_r'] - J['knee_r']) + np.linalg.norm(J['knee_r'] - J['ankle_r']))
clips = sorted(f for f in os.listdir(CLIPS) if f.endswith('.fbx')) if os.path.isdir(CLIPS) else []
rig.animation_data_create()
CLIPINFO = {}
for f in clips:
    name = f[:-4]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(CLIPS, f), automatic_bone_orientation=False, ignore_leaf_bones=True)
    new = [o for o in bpy.data.objects if o not in before]
    srcA = next((o for o in new if o.type == 'ARMATURE'), None)
    if not srcA or not srcA.animation_data or not srcA.animation_data.action: clog(f'  {name}: no armature / action'); [bpy.data.objects.remove(o) for o in new]; continue
    act = srcA.animation_data.action
    f0, f1 = (int(round(x)) for x in act.frame_range)
    # (Mixamo's character faces the other way: turned round to face ours)
    srcA.rotation_euler.z += math.pi
    bpy.context.view_layer.update()
    sb = {b.name: b for b in srcA.data.bones}
    # the source's legs and hips at rest (world): the hips' travel scaled by the legs' ratio
    def wpos(obj, bone): return obj.matrix_world @ bone.head_local
    try:
        leg_src = (wpos(srcA, sb[PFX + 'RightUpLeg']) - wpos(srcA, sb[PFX + 'RightLeg'])).length + (wpos(srcA, sb[PFX + 'RightLeg']) - wpos(srcA, sb[PFX + 'RightFoot'])).length
    except KeyError:
        clog(f'  {name}: not a mixamorig skeleton'); [bpy.data.objects.remove(o) for o in new]; continue
    k_leg = leg_ours / max(1e-6, leg_src)
    src_rest = {n: rest_world(srcA, sb[n]) for n in ORDER if n in sb}
    # OUR rest made to point each bone as the source's rest does (their T-pose, our A-pose): the turn between the two
    # bones' axes, then our own frame — a bone then follows where the source's points, keeping its own twist
    def axis(obj, bone): return (obj.matrix_world.to_3x3() @ bone.matrix_local.to_3x3()).col[1].normalized()
    tgt_rest = {}
    for n in ORDER:
        q = rest_world(rig, rig.data.bones[n])
        if n in sb: q = axis(rig, rig.data.bones[n]).rotation_difference(axis(srcA, sb[n])) @ q
        tgt_rest[n] = q
    hips_src0 = wpos(srcA, sb[PFX + 'Hips']); hips_tgt0 = rig.matrix_world @ rig.data.bones[PFX + 'Hips'].head_local
    out = bpy.data.actions.new(name); rig.animation_data.action = out
    scn = bpy.context.scene
    # the hips' path first: a LOOP (walk, run …) has its travel taken out (its speed kept for the game — the feet
    # don't slide), the sway and bob kept; a one-off (jump, getting in the car …) keeps it
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
            if n in src_rest:
                d = world_rot(srcA, srcA.pose.bones[n]) @ src_rest[n].inverted()
                wq = d @ tgt_rest[n]
            else:
                wq = tgt_rest[n]
            M = rig.matrix_world.inverted().to_quaternion() @ wq
            mat = M.to_matrix().to_4x4()
            if n == PFX + 'Hips':
                hp = hips_path[fr - f0].copy()
                if LOOP: hp -= travel * ((fr - f0) / max(1, f1 - f0))
                mat.translation = rig.matrix_world.inverted() @ (hips_tgt0 + (hp - hips_src0) * k_leg)
            else:
                mat.translation = pb.matrix.translation     # (the parent's pose carries it)
            pb.matrix = mat
            bpy.context.view_layer.update()
            pb.keyframe_insert('rotation_quaternion', frame=fr - f0)
            if n == PFX + 'Hips': pb.keyframe_insert('location', frame=fr - f0)
    rig.animation_data.action = None
    trk = rig.animation_data.nla_tracks.new(); trk.name = name; trk.strips.new(name, 0, out)
    for o in new: bpy.data.objects.remove(o)
    clog(f'  {name}: {f1 - f0 + 1} frames (legs × {k_leg:.2f}){"  loop, " + str(CLIPINFO[name]["speed"]) + " m/s" if LOOP else ""}')
for pb in rig.pose.bones: pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
rig['clips'] = json.dumps(CLIPINFO)

# ===================================================================================================== out
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT_C), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_C, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=False,
                          export_materials='EXPORT', export_extras=True, export_vertex_color='ACTIVE', export_skins=True, export_all_influences=False, export_animations=True,
                          export_animation_mode='NLA_TRACKS' if clips else 'ACTIONS', export_force_sampling=True, export_frame_step=1,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                          export_draco_normal_quantization=10, export_draco_generic_quantization=12)
clog(f'wrote {OUT_C}: {os.path.getsize(OUT_C) / 1e3:.1f} kB, {len(clips)} clips')

STRIP = os.environ.get('STRIP')
if PREVIEW_C and STRIP:
    # FILMSTRIPS (choosing a clip): every clip, 7 frames from the side
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'; sh = scn.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'
    scn.render.resolution_x, scn.render.resolution_y = 300, 420
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); scn.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.8
    for a in [x for x in bpy.data.actions if x.users and x.name in [f[:-4] for f in clips]]:
        rig.animation_data.action = a
        f0, f1 = a.frame_range
        for k in range(7):
            scn.frame_set(int(f0 + (f1 - f0) * k / 6))
            hp = rig.matrix_world @ rig.pose.bones[PFX + 'Hips'].head
            cam.location = Vector((hp.x + 5, hp.y, 1.1)); cam.rotation_euler = (Vector((hp.x, hp.y, 1.1)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            scn.render.filepath = os.path.join(PREVIEW_C, f'strip_{a.name}_{k}.png'); bpy.ops.render.render(write_still=True)
    sys.exit(0)
if PREVIEW_C:
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'; sh = scn.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True
    scn.render.resolution_x, scn.render.resolution_y = 700, 800
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); scn.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.4
    # frames of the clips, from the side (the retarget's check)
    for name, t in (('walk', 0.25), ('walk', 0.75), ('run', 0.3), ('jump', 0.45), ('car_enter', 0.5), ('pickup', 0.5), ('climb_ledge', 0.5)):
        a = bpy.data.actions.get(name)
        if not a: continue
        rig.animation_data.action = a
        f0, f1 = a.frame_range
        scn.frame_set(int(f0 + (f1 - f0) * t))
        cam.location = Vector((5, 0, 1.0)); cam.rotation_euler = (Vector((0, 0, 1.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(PREVIEW_C, f'clip_{name}_{int(t * 100)}.png'); bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None
    for pb in rig.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    # a test pose: the arms down and one bent, a knee up — the weights' check
    scn = bpy.context.scene
    def turn(n, axis, deg):
        pb = rig.pose.bones[PFX + n]; pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion(axis, math.radians(deg)) @ pb.rotation_quaternion
    turn('LeftArm', (0, 0, 1), 0); turn('LeftArm', (1, 0, 0), 0)
    rig.pose.bones[PFX + 'LeftUpLeg'].rotation_mode = 'QUATERNION'
    bpy.context.view_layer.update()
    # (world-space turns: about the game's x for the leg, the body's front for the arm)
    def wturn(n, axis_b, deg):
        pb = rig.pose.bones[PFX + n]
        R = Quaternion(axis_b, math.radians(deg)).to_matrix().to_4x4()
        h = pb.matrix.translation.copy(); m = R @ pb.matrix; m.translation = h; pb.matrix = m; bpy.context.view_layer.update()
    wturn('RightArm', (0, 1, 0), 40)
    wturn('RightForeArm', (1, 0, 0), -80)
    wturn('LeftArm', (0, 1, 0), -45)
    wturn('LeftUpLeg', (1, 0, 0), 70)
    wturn('LeftLeg', (1, 0, 0), -90)
    wturn('Spine1', (1, 0, 0), 15)
    scn.render.engine = 'BLENDER_WORKBENCH'; sh = scn.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True
    scn.render.resolution_x, scn.render.resolution_y = 900, 1100
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); scn.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.1
    for nm, loc in (('char_front', (0.0, 5, 0.95)), ('char_side', (5, 0, 0.95)), ('char_34', (3.5, 3.5, 1.4))):
        cam.location = Vector(loc); cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(PREVIEW_C, nm + '.png'); bpy.ops.render.render(write_still=True)
