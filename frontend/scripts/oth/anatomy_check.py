# OVERHILL — THE ANATOMY CHECK (2026-11-09): a character GLB measured against .claude/skills/human-anatomy/SKILL.md —
# its bind-pose joints, the torso's width and depth at each level, the limbs, the eyes, the crotch; renders (front, side,
# the head, a posed frame) with a stature / 8 grid.
#   blender -b --factory-startup --python scripts/oth/anatomy_check.py -- GLB=src/assets/models/human/character.glb OUT=<dir>
import bpy, sys, os, math, json
import numpy as np
from mathutils import Vector
kw = dict(a.split('=', 1) for a in sys.argv[sys.argv.index('--') + 1:] if '=' in a)
GLB = kw['GLB']; OUTD = kw['OUT']
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=GLB)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

body = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.vertex_groups))
rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
import re
def nm_(s): return re.sub(r'^mixamorig[:_]?', '', s)
B = {nm_(b.name):(rig.matrix_world @ b.head_local) for b in rig.data.bones}
me = body.data
P = np.array([(body.matrix_world @ v.co)[:] for v in me.vertices])
gn = {g.index: nm_(g.name) for g in body.vertex_groups}
W = {}
for v in me.vertices:
    for g in v.groups:
        W.setdefault(gn[g.group], np.zeros(len(me.vertices)))[v.index] = g.weight
def w(n): return W.get(n, np.zeros(len(P)))
x, y, z = P[:, 0], P[:, 1], P[:, 2]
r = {}
r['bones'] = list(B.keys())
r['n_verts'] = len(P); r['n_tris'] = sum(len(p.vertices) - 2 for p in me.polygons)
H = float(z.max() - z.min()); r['stature'] = H; r['zmin'] = float(z.min()); r['crown'] = float(z.max())
for k, v in B.items(): r['j_' + k] = [round(c, 4) for c in v]
armw = sum(w(s + n) for s in ('Left', 'Right') for n in ('Arm', 'ForeArm', 'Hand'))
legw_l = w('LeftUpLeg') + w('LeftLeg') + w('LeftFoot') + w('LeftToeBase')
def wd(z0, mask, dz=0.008):
    m = (np.abs(z - z0) < dz) & mask
    if m.sum() == 0: return None
    return dict(w=round(float(np.ptp(x[m])), 4), d=round(float(np.ptp(y[m])), 4), ymin=round(float(y[m].min()), 4), ymax=round(float(y[m].max()), 4))
torso = armw < 0.05
r['levels'] = {}
for nm, z0 in (('neck_mid', (B['Neck'].z + B['Head'].z) / 2), ('shoulder_jt', B['LeftArm'].z), ('spine2', B['Spine2'].z), ('chest', B['Spine2'].z - 0.03),
               ('spine1', B['Spine1'].z), ('waist', B['Spine'].z + 0.03), ('spine', B['Spine'].z), ('hips_jt', B['LeftUpLeg'].z), ('hips_low', B['LeftUpLeg'].z - 0.06),
               ('thigh_top', B['LeftUpLeg'].z - 0.15), ('knee', B['LeftLeg'].z), ('calf', B['LeftLeg'].z - 0.12), ('ankle', B['LeftFoot'].z + 0.04)):
    r['levels'][nm] = dict(z=round(float(z0), 4), all=wd(z0, torso), left_leg=wd(z0, torso & (x < 0) & (legw_l > 0.5)) if z0 < B['Hips'].z else None)
hm = w('Head') > 0.5
r['head_mesh'] = dict(top=float(z[hm].max()), bottom=float(z[hm].min()), w=float(np.ptp(x[hm])), d=float(np.ptp(y[hm])), ymin=float(y[hm].min()), ymax=float(y[hm].max()))
front = (np.abs(x) < 0.012) & (z > B['Neck'].z - 0.05)
prof = {}
for a, b in zip(z[front], y[front]):
    k = round(float(a), 2); prof[k] = max(prof.get(k, -9), round(float(b), 3))
r['front_profile_z_to_y'] = dict(sorted(prof.items()))
back = {}
for a, b in zip(z[front], y[front]):
    k = round(float(a), 2); back[k] = min(back.get(k, 9), round(float(b), 3))
r['back_profile_z_to_y'] = dict(sorted(back.items()))
for s in ('Left', 'Right'):
    hmask = sum((a for k, a in W.items() if k.startswith(s + 'Hand')), np.zeros(len(P))) > 0.5   # (the palm and its fingers' bones)
    fm = (w(s + 'Foot') + w(s + 'ToeBase')) > 0.5
    r[f'arm_{s}'] = dict(clav=float((B[s + 'Arm'] - B[s + 'Shoulder']).length), upper=float((B[s + 'ForeArm'] - B[s + 'Arm']).length), fore=float((B[s + 'Hand'] - B[s + 'ForeArm']).length),
                         hand_len=float(np.abs(x[hmask]).max() - abs(B[s + 'Hand'].x)), hand_w=float(np.ptp(y[hmask])), hand_thick=float(np.ptp(z[hmask])))
    r[f'leg_{s}'] = dict(thigh=float((B[s + 'Leg'] - B[s + 'UpLeg']).length), shank=float((B[s + 'Foot'] - B[s + 'Leg']).length), ankle_h=float(B[s + 'Foot'].z),
                         foot_len=float(np.ptp(y[fm])), foot_w=float(np.ptp(x[fm])), heel_y=float(y[fm].min()), toe_y=float(y[fm].max()), ankle_y=float(B[s + 'Foot'].y))
# upper arm / forearm cross sections (T-pose: along x)
for nm, bone, frac in (('biceps', 'LeftArm', 0.5), ('forearm', 'LeftForeArm', 0.3), ('wrist', 'LeftForeArm', 0.95)):
    a = B[bone]; b = B['LeftForeArm' if bone == 'LeftArm' else 'LeftHand']; x0 = a.x + (b.x - a.x) * frac
    m = (np.abs(x - x0) < 0.006) & (armw > 0.3) & (x < 0)
    r['sec_' + nm] = dict(h=float(np.ptp(z[m])), d=float(np.ptp(y[m]))) if m.any() else None
r['span'] = float(np.ptp(x))
cm = (np.abs(x) < 0.015) & (z > B['LeftLeg'].z) & (z < B['Hips'].z)
r['crotch_z'] = float(z[cm].min()) if cm.any() else None
uv = me.uv_layers.active.data; vu = np.zeros((len(P), 2))
for p in me.polygons:
    for li, vi in zip(p.loop_indices, p.vertices): vu[vi] = uv[li].uv
eye = (vu[:, 0] > 1024 / 1536) & (vu[:, 1] > 255 / 1024) & (vu[:, 1] < 513 / 1024)
if eye.any():
    el, er = eye & (x < 0), eye & (x > 0)
    r['eyes'] = dict(n=int(eye.sum()), z=float(z[eye].mean()), xl=float(x[el].mean()), xr=float(x[er].mean()), diam=float(np.ptp(z[el])), y_front=float(y[eye].max()))
nw = np.zeros(len(P))
for k, a in W.items(): nw += (a > 0.01)
r['max_influences'] = int(nw.max()); r['unweighted'] = int((nw == 0).sum())
json.dump(r, open(os.path.join(OUTD, 'measure.json'), 'w'), indent=1, default=float)
print('[anat] measured, stature', H, flush=True)
sc = bpy.context.scene
eng = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in eng else 'BLENDER_EEVEE'
wo = bpy.data.worlds.new('w'); sc.world = wo; wo.use_nodes = True; wo.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.62, 0.66, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(20)); sc.collection.objects.link(sun)
mat = bpy.data.materials.new('m'); mat.use_nodes = True; t = mat.node_tree; bs = t.nodes['Principled BSDF']
ti = t.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(GLB[:-4] + '.webp'); t.links.new(ti.outputs['Color'], bs.inputs['Base Color'])
body.data.materials.clear(); body.data.materials.append(mat)
lm = bpy.data.materials.new('line'); lm.use_nodes = True; lm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.1, 0.1, 1)
for i in range(9):
    zz = float(z.min()) + H * i / 8
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.5, zz)); c = bpy.context.object; c.scale = (3, 0.002, 0.003); c.data.materials.append(lm)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
def shot(tag, ang, zc, s, rx, ry):
    cam.data.ortho_scale = s; sc.render.resolution_x, sc.render.resolution_y = rx, ry
    a = math.radians(ang); cam.location = Vector((6 * math.sin(a), 6 * math.cos(a), zc)); cam.rotation_euler = (Vector((0, 0, zc)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUTD, f'{tag}.png'); bpy.ops.render.render(write_still=True)
shot('rest_front', 0, 0.95, 2.0, 900, 900); shot('rest_side', 90, 0.95, 2.0, 900, 900)
shot('head_front', 0, B['Head'].z + 0.07, 0.42, 600, 600); shot('head_side', 90, B['Head'].z + 0.07, 0.42, 600, 600)
for c in [o for o in bpy.data.objects if o.name.startswith('Cube')]: c.hide_render = True
rig.data.pose_position = 'POSE'
ad = rig.animation_data
if ad:
    for tr in ad.nla_tracks: tr.mute = True
    act = next((a for a in bpy.data.actions if a.name.startswith('idle')), None)
    if act: ad.action = act; print('[anat] posed:', act.name, flush=True)
sc.frame_set(10); bpy.context.view_layer.update()
shot('idle_front', 0, 0.95, 2.0, 900, 900); shot('idle_side', 90, 0.95, 2.0, 900, 900); shot('idle_34', 35, 0.95, 2.0, 900, 900)
print('[anat] rendered', [t.name for t in ad.nla_tracks] if ad else None, flush=True)
