# OVER THE HILL — THE RIDER from the character model (2026-11-05, the user: "a proper GLB character … this is what we
# want" — refer/char.png, the off-road explorer: green shirt with rolled sleeves, a rust utility vest, grey cargo pants,
# brown boots). The source is src/assets/models/human/Meshy_AI_Trail_Warden_*.glb: a bare mesh (positions only — no
# rig, no UVs, no materials) in an A-pose, 1.89 units tall. This turns it into the game's rider:
#
#   blender -b --factory-startup --python scripts/oth/rider.py -- PAINT=scripts/oth/.cache/rider_painted.glb
#   blender -b --factory-startup --python scripts/oth/rider.py -- SRC=scripts/oth/.cache/rider_painted.glb
#           [OUT=src/assets/models/human/rider.glb] [TRIS=12000] [PREVIEW=<dir>]
#   (two passes: the first paints the full-resolution mesh face by face — fine colour borders — the second decimates
#    that, the faces keeping their colours, and builds the rider)
#
#   1. scaled to 1.80 m, feet on the ground, centred; DECIMATED to ~TRIS triangles (a ₹15k phone draws it);
#   2. cut into the rider's 12 SEGMENTS (Bike.ts's r_torso, r_head, r_upperarm_l/r, r_forearm_l/r, r_thigh_l/r,
#      r_shin_l/r, r_foot_l/r) — each vertex to the nearest bone (its distance less the bone's radius);
#   3. each segment STRAIGHTENED into the frame Bike.ts poses: from its proximal joint along local −y (the arms out of
#      the A-pose to hanging down), stretched along it to the geometry's bone length (mtb.geometry.json `rider`), its
#      origin at the joint's place in the standing pose (mtb.py rider_joints — the same contract as the old rider);
#   4. near a JOINT each vertex also carries its neighbour segment, its place in THAT segment's frame and a weight:
#      Bike.ts blends the two poses (smooth elbows, knees, hips, shoulders, neck) — custom glTF attributes _PART2,
#      _POS2, _NOR2, _W (game space: the exporter leaves custom attributes as they are);
#   5. PAINTED by region (no texture: flat colours by material name, as the bikes): skin, hair, beard, the shirt, the
#      vest, the belt, the pants, the boots, the gloves.
import sys, os, math, json, struct
import numpy as np
import bpy, bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
HUMAN = os.path.join(FRONTEND, 'src', 'assets', 'models', 'human')
SRC = ARGS.get('SRC') or os.path.join(HUMAN, next(f for f in sorted(os.listdir(HUMAN)) if f.startswith('Meshy_AI_Trail_Warden')))
OUT = os.path.abspath(ARGS.get('OUT', os.path.join(HUMAN, 'rider.glb')))
TRIS = int(ARGS.get('TRIS', 12000))
PREVIEW = ARGS.get('PREVIEW')
G = json.load(open(os.path.join(FRONTEND, 'src', 'gameplay', 'vehicle', 'mtb.geometry.json'), encoding='utf-8'))
RD = G['rider']
RIDER_X = 1.2   # (mtb.py: the rider stands this far right of the bike in the file)
def log(*a): print('[rider]', *a, flush=True)
def unit(v): v = np.asarray(v, float); n = np.linalg.norm(v); return v / n if n > 1e-12 else v

# ===================================================================================================== the mesh
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=SRC)
src = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = src
src.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
n0 = sum(len(p.vertices) - 2 for p in src.data.polygons)
bm = bmesh.new(); bm.from_mesh(src.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(src.data); bm.free()
mod = src.modifiers.new('dec', 'DECIMATE'); mod.ratio = 1.0 if ARGS.get('PAINT') else min(1.0, TRIS / max(1, n0))
if src.material_slots and not ARGS.get('PAINT'):
    # (the colour borders kept: their vertices weighted so the collapse leaves them — else the decimated triangles
    #  straddle them and the borders saw-tooth)
    mi = np.zeros(len(src.data.polygons), int); src.data.polygons.foreach_get('material_index', mi)
    seen = {}
    for p_, m_ in zip(src.data.polygons, mi):
        for v in p_.vertices: seen.setdefault(v, set()).add(int(m_))
    vg = src.vertex_groups.new(name='keep')
    border = [v for v, ms in seen.items() if len(ms) > 1]
    vg.add([v for v in seen if v not in set(border)], 1.0, 'REPLACE')
    vg.add(border, 0.0, 'REPLACE')
    mod.vertex_group = 'keep'; mod.vertex_group_factor = 10.0
    log(f'  {len(border)} border vertices kept')
bpy.ops.object.modifier_apply(modifier='dec')
bm = bmesh.new(); bm.from_mesh(src.data); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(src.data); bm.free()
me = src.data
# (pass 2: the painted mesh's colours, face by face — decimation keeps each face's material)
SRC_MATS = [src.material_slots[p.material_index].name.split('.')[0] for p in me.polygons] if src.material_slots else None
B = np.array([v.co[:] for v in me.vertices])          # Blender space (z up, the face toward +y)
F = np.array([[v for v in p.vertices] for p in me.polygons])
log(f'{os.path.basename(SRC)}: {n0} → {len(F)} triangles, {len(B)} vertices')
# → GAME space (x right, y up, z back; facing −z): (x, z, −y), turned round; 1.80 m, feet on the ground, centred
P = np.column_stack([B[:, 0], B[:, 2], -B[:, 1]])
P[:, 0] *= -1; P[:, 2] *= -1   # (the model faces +z: turned round to face −z, the game's forward)
P[:, 1] -= P[:, 1].min()
k = RD['height'] / P[:, 1].max(); P *= k
P[:, 0] -= (P[:, 0].min() + P[:, 0].max()) / 2
P[:, 2] -= np.median(P[P[:, 1] > 1.0][:, 2])
# PROPORTIONS (2026-11-05, the user: "a normal human, nothing big, nothing small" — seen from the back the shoulders
# were big round domes): the upper torso and the shoulder caps narrowed up to 13 % (eased in from the chest up), the
# head 5 % larger about the neck (it read small over the vest)
_k = np.clip((P[:, 1] - 1.15) / 0.22, 0, 1); _k = _k * _k * (3 - 2 * _k)
P[:, 0] *= 1 - 0.13 * _k * (P[:, 1] < 1.56)
_neck = 1.55
_h = P[:, 1] > _neck
P[_h, 0] *= 1.05; P[_h, 2] = (P[_h, 2] - np.median(P[_h, 2])) * 1.05 + np.median(P[_h, 2]); P[_h, 1] = _neck + (P[_h, 1] - _neck) * 1.05
P[:, 1] *= RD['height'] / P[:, 1].max()

# ===================================================================================================== the joints
def near(c, r, sel=None):
    """The centroid of the vertices within r of c (x, y), refined twice — a joint's place inside the body."""
    c = np.asarray(c, float).copy()
    for _ in range(3):
        d = np.hypot(P[:, 0] - c[0], P[:, 1] - c[1])
        m = d < r if sel is None else (d < r) & sel
        if m.sum() < 5: break
        c = P[m].mean(0)
    return c
def slice_c(y0, xlo, xhi, h=0.012, zlo=-1.0, zhi=1.0):
    """The middle of the body's cross-section at height y0 between xlo and xhi (the bounding box's centre — not the
    centroid: pockets and the holster pull that off the bone)."""
    m = (np.abs(P[:, 1] - y0) < h) & (P[:, 0] > xlo) & (P[:, 0] < xhi) & (P[:, 2] > zlo) & (P[:, 2] < zhi)
    q = P[m]
    return np.array([(q[:, 0].min() + q[:, 0].max()) / 2, y0, (q[:, 2].min() + q[:, 2].max()) / 2])
R_ = {}   # the right side, then the left mirrored onto it and the two averaged (the model is near-symmetric)
for x in (1, -1):
    lo, hi = (0.0, 0.35) if x > 0 else (-0.35, 0.0)
    alo, ahi = (0.25, 0.65) if x > 0 else (-0.65, -0.25)
    sh_z = slice_c(1.43, -0.15, 0.15)[2]
    e = {'shoulder': np.array([x * 0.175, 1.43, sh_z]), 'wrist': slice_c(0.97, alo, ahi), 'hand': slice_c(0.89, alo, ahi)}
    e['elbow'] = slice_c(1.15, alo - x * 0.05, ahi)
    ank = slice_c(0.22, lo, hi); e['ankle'] = np.array([ank[0], 0.10, ank[2]])
    e['knee'] = slice_c(0.51, lo, hi)
    th = slice_c(0.80, lo, hi); e['hip'] = np.array([x * 0.095, 0.935, th[2]])
    toe = P[(P[:, 0] * x > 0) & (P[:, 1] < 0.12)]
    e['toe'] = toe[np.argmin(toe[:, 2])]
    for k, v in e.items():
        R_.setdefault(k, []).append(v * np.array([x, 1, 1]))
J = {}
for k, vs in R_.items():
    r = np.mean(vs, 0)
    J[f'{k}_r'] = r; J[f'{k}_l'] = r * np.array([-1, 1, 1])
J['pelvis'] = (J['hip_l'] + J['hip_r']) / 2
J['neck'] = slice_c(1.55, -0.12, 0.12) * np.array([0, 1, 1])
J['chest'] = (J['shoulder_l'] + J['shoulder_r']) / 2
J['crown'] = np.array([0, P[:, 1].max(), J['neck'][2]])
HEAD_Z = slice_c(1.68, -0.12, 0.12)[2]
# THE FACE's marks, from the nose: its tip the head's most forward point between the mouth and the brow
_f = P[(P[:, 1] > 1.6) & (P[:, 1] < 1.72) & (np.abs(P[:, 0]) < 0.025)]
NOSE = _f[np.argmin(_f[:, 2])] if len(_f) else np.array([0, 1.66, HEAD_Z - 0.1])
for n, v in J.items(): log(f'  joint {n:11s} ({v[0]:+.3f}, {v[1]:+.3f}, {v[2]:+.3f})')

# the bones: (segment, proximal, distal, radius, the length it must have, how it's straightened)
BONES = [('r_torso', J['pelvis'], J['chest'], 0.15, RD['spine'], 'up'), ('r_head', J['neck'], J['crown'], 0.1, None, 'up')]
for s in ('l', 'r'):
    hand_end = J[f'wrist_{s}'] + unit(J[f'hand_{s}'] - J[f'elbow_{s}']) * RD['handToGrip']
    BONES += [(f'r_upperarm_{s}', J[f'shoulder_{s}'], J[f'elbow_{s}'], 0.055, RD['upperArm'], 'down'),
              (f'r_forearm_{s}', J[f'elbow_{s}'], hand_end, 0.045, RD['forearm'] + RD['handToGrip'], 'down'),
              (f'r_thigh_{s}', J[f'hip_{s}'], J[f'knee_{s}'], 0.085, RD['thigh'], 'down'),
              (f'r_shin_{s}', J[f'knee_{s}'], J[f'ankle_{s}'], 0.06, RD['shin'], 'down'),
              (f'r_foot_{s}', J[f'ankle_{s}'], J[f'toe_{s}'], 0.05, None, 'keep')]
NAMES = [b[0] for b in BONES]
# (Bike.ts PARTS — the order the game indexes the parts by: _PART2 is an index into it)
GAME_PARTS = ['frame', 'steer', 'fork_lowers', 'wheel_front', 'wheel_rear', 'swingarm', 'shock_body', 'shock_shaft', 'crank', 'pedal_r', 'pedal_l', 'chain',
              'r_torso', 'r_head', 'r_upperarm_l', 'r_upperarm_r', 'r_forearm_l', 'r_forearm_r', 'r_thigh_l', 'r_thigh_r', 'r_shin_l', 'r_shin_r', 'r_foot_l', 'r_foot_r']
PARENT = {'r_head': 'r_torso', 'r_upperarm_l': 'r_torso', 'r_upperarm_r': 'r_torso', 'r_forearm_l': 'r_upperarm_l', 'r_forearm_r': 'r_upperarm_r',
          'r_thigh_l': 'r_torso', 'r_thigh_r': 'r_torso', 'r_shin_l': 'r_thigh_l', 'r_shin_r': 'r_thigh_r', 'r_foot_l': 'r_shin_l', 'r_foot_r': 'r_shin_r'}

# the canonical joints (mtb.py rider_joints: the old rider's standing pose — the GLB's node origins)
ank = RD['ankleHeight']; kneeY = ank + RD['shin']; hipY = kneeY + RD['thigh']; shY = hipY + RD['spine']; nkY = shY + RD['neck']
CAN = {'r_torso': np.array([RIDER_X, hipY, 0]), 'r_head': np.array([RIDER_X, nkY, 0])}
for s, x in (('l', -1), ('r', 1)):
    CAN[f'r_upperarm_{s}'] = np.array([RIDER_X + x * RD['shoulderHalfWidth'], shY, 0])
    CAN[f'r_forearm_{s}'] = np.array([RIDER_X + x * RD['shoulderHalfWidth'], shY - RD['upperArm'], 0])
    CAN[f'r_thigh_{s}'] = np.array([RIDER_X + x * RD['hipHalfWidth'], hipY, 0])
    CAN[f'r_shin_{s}'] = np.array([RIDER_X + x * RD['hipHalfWidth'], kneeY, 0])
    CAN[f'r_foot_{s}'] = np.array([RIDER_X + x * RD['hipHalfWidth'], ank, 0])

def rot_to(a, b):
    """The rotation taking unit a onto unit b (the shortest)."""
    a, b = unit(a), unit(b); v = np.cross(a, b); c = float(a @ b)
    if np.linalg.norm(v) < 1e-9: return np.eye(3) if c > 0 else np.diag([1, -1, -1])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))

# each segment's map from the model's space into its own frame: rotate about the proximal joint so the bone runs along
# −y (limbs) / +y (torso, head), stretch along it to the bone's length — then the frame's origin is the joint
XF = {}
for name, a, b, r, L, how in BONES:
    d = b - a; Lm = np.linalg.norm(d)
    R = rot_to(d, [0, -1, 0]) if how == 'down' else rot_to(d, [0, 1, 0]) if how == 'up' else np.eye(3)
    s = (L / Lm) if L else 1.0
    S = np.diag([1, s, 1]) if how != 'keep' else np.eye(3)
    XF[name] = (a, S @ R)
    log(f'  {name:13s} bone {Lm:.3f} m → {L or Lm:.3f} (× {s:.2f}), turned {math.degrees(math.acos(max(-1, min(1, float(unit(d) @ ([0, -1, 0] if how == "down" else [0, 1, 0]))))) if how != "keep" else 0):.0f}°')

def local(name, X):
    a, M = XF[name]
    return (X - a) @ M.T

# ===================================================================================================== segments
def seg_dist(X, a, b):
    ab = b - a; t = np.clip(((X - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(X - (a + np.outer(t, ab)), axis=1), t
D = np.zeros((len(P), len(BONES))); T = np.zeros_like(D)
for i, (name, a, b, r, L, how) in enumerate(BONES):
    D[:, i], T[:, i] = seg_dist(P, a, b)
    D[:, i] -= r
# (the hands stay with the forearms, the soles with the feet, the head above the neck with the head)
prim = np.argmin(D, 1)
iH = NAMES.index('r_head'); iT = NAMES.index('r_torso')
prim[(P[:, 1] > J['neck'][1] + 0.02) & (np.abs(P[:, 0]) < 0.13)] = iH
for s in ('l', 'r'):
    iF = NAMES.index(f'r_foot_{s}'); x = -1 if s == 'l' else 1
    prim[(P[:, 1] < J[f'ankle_{s}'][1] - 0.01) & (P[:, 0] * x > 0)] = iF

# the blend at the joints: within BAND of a joint (along the bone), the neighbour segment's pose mixed in (½ at the
# joint, nothing BAND away)
BAND = {'r_head': 0.06, 'r_upperarm_l': 0.07, 'r_upperarm_r': 0.07, 'r_forearm_l': 0.06, 'r_forearm_r': 0.06, 'r_thigh_l': 0.09, 'r_thigh_r': 0.09,
        'r_shin_l': 0.07, 'r_shin_r': 0.07, 'r_foot_l': 0.04, 'r_foot_r': 0.04}
part2 = prim.copy(); w2 = np.zeros(len(P))
for child, par in PARENT.items():
    ic, ip = NAMES.index(child), NAMES.index(par)
    j = XF[child][0]
    _, _, _, _, _, how = BONES[ic]
    axis = unit(BONES[ic][2] - BONES[ic][1])
    s_ = (P - j) @ axis   # + into the child, − into the parent
    band = BAND[child]
    for i in np.where(((prim == ic) | (prim == ip)) & (np.abs(s_) < band) & (np.linalg.norm(P - j, axis=1) < band + 0.16))[0]:
        f = 0.5 * (1 - s_[i] / band) if prim[i] == ic else 0.5 * (1 + s_[i] / band)   # the OTHER segment's share
        f = max(0.0, min(0.5, f))
        if f > w2[i]:
            part2[i] = ip if prim[i] == ic else ic
            w2[i] = f
log(f'  blended vertices: {(w2 > 0.01).sum()} of {len(P)}')

# ===================================================================================================== the paint
COL = {  # name: (sRGB, roughness) — after refer/char.png
    'Skin': ('#C08A66', 0.7), 'Hair': ('#3B2A1E', 0.8), 'Beard': ('#4A3526', 0.85), 'Stubble': ('#8A6450', 0.85), 'Eye': ('#2B211C', 0.3),
    'Brow': ('#3A2A1F', 0.85), 'Lips': ('#A2604D', 0.6), 'Shirt': ('#46593A', 0.85), 'Vest': ('#A4492B', 0.75),
    'VestTrim': ('#6E3420', 0.75), 'Belt': ('#24221F', 0.6), 'Pants': ('#4A4B4C', 0.85), 'Knee': ('#36373A', 0.85), 'Boots': ('#5C3B24', 0.75),
    'Sole': ('#2A2420', 0.85), 'Gloves': ('#4B3627', 0.8), 'Metal': ('#8E9196', 0.4),
}
def region_at(pt, si):
    x, y, z = pt; seg = NAMES[si]
    if seg.startswith('r_foot'): return 'Sole' if y < 0.03 else 'Boots'
    if seg.startswith('r_shin'):
        if y < 0.24: return 'Boots'
        return 'Knee' if (0.43 < y < 0.56 and z < -0.02) else 'Pants'
    if seg.startswith('r_thigh'): return 'Pants'
    if seg.startswith('r_upperarm'): return 'Shirt'
    if seg.startswith('r_forearm'):
        t = -local(seg, np.asarray(pt)[None])[0][1] / (RD['forearm'] + RD['handToGrip'])
        # (the hands bare — 2026-11-05, the user: "remove the black / brown from the hands": the reference's fingerless
        #  gloves, painted by distance along the arm, came out as patches across the curled fingers)
        return 'Skin' if t > 0.42 else 'Shirt'
    if seg == 'r_head':
        ny, nz = NOSE[1], NOSE[2]
        front = z < nz + 0.075                                    # (the face's front, not its sides)
        if y > ny + 0.105 or (y > ny - 0.05 and z > HEAD_Z + 0.025): return 'Hair'
        if front:
            # the EYES (two dark ovals 3.3 cm either side, 3.8 cm over the tip), the BROWS above them
            for sx in (-1, 1):
                ex, ey = sx * 0.033, ny + 0.038
                if ((x - ex) / 0.014) ** 2 + ((y - ey) / 0.0075) ** 2 < 1: return 'Eye'
                if ((x - sx * 0.035) / 0.022) ** 2 + ((y - (ey + 0.019)) / 0.0045) ** 2 < 1: return 'Brow'
            # the LIPS, the MOUSTACHE over them, the STUBBLE along the jaw and the chin
            if (x / 0.024) ** 2 + ((y - (ny - 0.052)) / 0.0065) ** 2 < 1: return 'Lips'
            if (x / 0.03) ** 2 + ((y - (ny - 0.036)) / 0.0055) ** 2 < 1: return 'Beard'
            if y < ny - 0.06 and y > ny - 0.12: return 'Stubble'
        if ny - 0.115 < y < ny - 0.02 and abs(x) > 0.045 and z < HEAD_Z + 0.02: return 'Stubble'
        return 'Skin'
    # the torso: the pants to the belt, the belt, the vest (open at the front over the shirt), the shirt's collar
    if y < J['pelvis'][1] + 0.01: return 'Pants'
    if y < J['pelvis'][1] + 0.06: return 'Belt'
    if y > J['chest'][1] + 0.06: return 'Shirt' if abs(x) < 0.09 else 'Vest'
    return 'Vest'
REG = [region_at(P[i], prim[i]) for i in range(len(P))]
log('  regions: ' + ', '.join(f'{k} {REG.count(k)}' for k in COL if REG.count(k)))

# ===================================================================================================== the GLB
def srgb_to_linear(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
MATS = {}
for name, (hexc, rough) in COL.items():
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); lin = srgb_to_linear(hexc)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value = (*lin, 1); bs.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*lin, 1); MATS[name] = m

# vertex normals of the model (game space), for _NOR2
vn = np.zeros_like(P)
for f in F:
    a, b, c = P[f[0]], P[f[1]], P[f[2]]
    n = np.cross(b - a, c - a)
    vn[f] += n
vn = vn / np.maximum(1e-12, np.linalg.norm(vn, axis=1))[:, None]

col = bpy.context.scene.collection
bpy.data.objects.remove(src)
objs = []
tri_seg = np.array([np.bincount(prim[f], minlength=len(NAMES)).argmax() for f in F])   # a face to its majority segment
# a face's colour: the region at its centre (painted as if a vertex there of the face's segment — smoother borders
# than a vote of its corners)
FREG = [region_at(P[F[fi]].mean(0), tri_seg[fi]) for fi in range(len(F))]
if SRC_MATS and all(m in COL for m in SRC_MATS): FREG = SRC_MATS
if ARGS.get('PAINT'):
    # PASS 1: the full-resolution mesh painted face by face (fine borders), written for pass 2 to decimate
    mp = bpy.data.meshes.new('painted'); mp.from_pydata(B.tolist(), [], F.tolist())
    names = list(COL)
    for n in names: mp.materials.append(MATS[n])
    mp.polygons.foreach_set('material_index', [names.index(r) for r in FREG])
    mp.update()
    ob = bpy.data.objects.new('painted', mp); col.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=ARGS['PAINT'], export_format='GLB', use_selection=True, export_normals=False, export_texcoords=False, export_materials='EXPORT')
    log(f'pass 1: painted {len(F)} faces → {ARGS["PAINT"]}')
    sys.exit(0)
for i, name in enumerate(NAMES):
    faces = F[tri_seg == i]
    if not len(faces): log(f'  ** {name}: no faces'); continue
    vids = np.unique(faces)
    remap = {v: k for k, v in enumerate(vids)}
    a, M = XF[name]
    Lp = local(name, P[vids])                        # its own frame (origin the joint)
    # the neighbour's frame for each vertex (its own frame where it has none): where that segment's pose takes it
    p2 = part2[vids]; w = w2[vids].copy()
    w[prim[vids] != i] = np.where(part2[vids][prim[vids] != i] == i, w[prim[vids] != i], 0)   # (a face's stray vertex)
    P2 = np.array([local(NAMES[p2[k]], P[vids[k]:vids[k] + 1])[0] if w[k] > 0 else Lp[k] for k in range(len(vids))])
    N2 = np.array([unit(XF[NAMES[p2[k]]][1] @ vn[vids[k]]) if w[k] > 0 else unit(M @ vn[vids[k]]) for k in range(len(vids))])
    # (the neighbour's frame is relative to ITS joint; Bike.ts adds that segment's pose — origin included — to it)
    me = bpy.data.meshes.new(name)
    vb = np.column_stack([Lp[:, 0], -Lp[:, 2], Lp[:, 1]])     # game → Blender
    me.from_pydata(vb.tolist(), [], [[remap[v] for v in f] for f in faces])
    fr = [FREG[fi] for fi in np.where(tri_seg == i)[0]]
    order = list(dict.fromkeys(fr))
    for r in order: me.materials.append(MATS[r])
    me.polygons.foreach_set('material_index', [order.index(r) for r in fr])
    for attr, data, kind in (('_POS2', P2, 'FLOAT_VECTOR'), ('_NOR2', N2, 'FLOAT_VECTOR'), ('_PART2', None, 'FLOAT'), ('_W', None, 'FLOAT')):
        at = me.attributes.new(attr, kind, 'POINT')
        if attr == '_PART2': at.data.foreach_set('value', [float(GAME_PARTS.index(NAMES[p2[k]] if w[k] > 0 else name)) for k in range(len(vids))])
        elif attr == '_W': at.data.foreach_set('value', w.astype(float).tolist())
        else: at.data.foreach_set('vector', data.astype(float).ravel().tolist())
    me.update(); me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    c = CAN[name]; ob.location = (c[0], -c[2], c[1])
    col.objects.link(ob); objs.append(ob)
    log(f'  {name:13s} {len(faces):5d} tris  {", ".join(order)}')

bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_normals=True,
                          export_texcoords=False, export_tangents=False, export_materials='EXPORT', export_vertex_color='NONE',
                          export_attributes=True, export_cameras=False, export_lights=False, export_extras=False,
                          # DRACO (the user, 2026-11-05): the geometry compressed, the custom attributes with it (generic, 12 bits:
                          # _POS2 to ¼ mm, _PART2 / _W well inside their rounding) — DRACO=0 writes it plain
                          **(dict(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                                  export_draco_normal_quantization=10, export_draco_generic_quantization=12) if ARGS.get('DRACO', '1') != '0' else {}))
log(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.1f} kB')

# ---- read back: the nodes at the joints, the custom attributes there, _POS2 = POSITION where unblended
b = open(OUT, 'rb').read(); _, _, length = struct.unpack_from('<III', b, 0); off, ch = 12, {}
while off < length:
    cl, ct = struct.unpack_from('<II', b, off); ch[ct] = b[off + 8: off + 8 + cl]; off += 8 + cl
JS = json.loads(ch[0x4E4F534A]); BIN = ch[0x004E4942]
def acc(i):
    a = JS['accessors'][i]; bv = JS['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC3': 3}[a['type']]
    return np.frombuffer(BIN, np.float32, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, n)
ok = True; tris = 0
for nd in JS['nodes']:
    nm = nd['name']; t = np.array(nd.get('translation', [0, 0, 0]))
    if np.linalg.norm(t - CAN[nm]) > 1e-3: ok = False; log(f'  ** {nm} at {t}')
    for pr in JS['meshes'][nd['mesh']]['primitives']:
        at = pr['attributes']; tris += JS['accessors'][pr['indices']]['count'] // 3
        dr = pr.get('extensions', {}).get('KHR_draco_mesh_compression')
        if not all(k in at and (not dr or k in dr['attributes']) for k in ('_POS2', '_NOR2', '_PART2', '_W')): ok = False; log(f'  ** {nm}: attributes {list(at)} draco {list(dr["attributes"]) if dr else None}'); continue
        if dr: continue   # (compressed: its values are checked plain — DRACO=0)
        pos, p2, wt = acc(at['POSITION']), acc(at['_POS2']), acc(at['_W'])[:, 0]
        m = wt < 1e-6
        if m.any() and np.abs(pos[m] - p2[m]).max() > 1e-4: ok = False; log(f'  ** {nm}: _POS2 ≠ POSITION unblended (max {np.abs(pos[m] - p2[m]).max():.4f})')
log(f'  read back: {len(JS["nodes"])} nodes, {tris} tris — {"OK" if ok else "FAILED"}')

if PREVIEW:
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'; sh = scn.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True
    scn.render.resolution_x, scn.render.resolution_y = 900, 1100
    from mathutils import Vector
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam); scn.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.1
    for nm, loc in (('rider_front', (RIDER_X, -5, 0.95)), ('rider_side', (RIDER_X + 5, 0, 0.95)), ('rider_back', (RIDER_X, 5, 0.95))):
        cam.location = Vector(loc); cam.rotation_euler = (Vector((RIDER_X, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(PREVIEW, nm + '.png'); bpy.ops.render.render(write_still=True)
if not ok: sys.exit(1)
