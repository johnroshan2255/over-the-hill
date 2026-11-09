# OVERHILL — THE HERO FITTED TO A MAN'S ANATOMY (2026-11-09, the user: "make our human char based on the new
# measurements … what is necessary to function in our game, for all animation … to grab things we may need finger
# bones"). hero.py's output (kept as scripts/oth/hero_base/character_base.glb: its sources, the Quaternius pack and the
# Mixamo clips, aren't in the repo) refitted against .claude/skills/human-anatomy (audit-hero-2026-11-09.md):
#
#   blender -b --factory-startup --python scripts/oth/hero_fit.py -- [IN=scripts/oth/hero_base/character_base.glb]
#           [OUT=src/assets/models/human/character.glb] [PREVIEW=<dir>]
#
#   THE ARMS     upper arm 0.290 → 0.31 m, forearm 0.232 → 0.25 (an average man's, joint to joint: the fingertips hang
#                at mid-thigh); along the T-pose's arm, each vertex by its arm weights;
#   THE HEAD     its pivot (the skull on the spine) up 4.5 cm, to the earlobe's level (it was 3.5 cm over the chin: the
#                head turned about the throat); the head 5 % smaller (it was 7.3 heads tall, a man is 7.5);
#   THE WAIST    3 cm wider and 2 cm deeper (it was pinched); THE SEAT 1.5 cm fuller (the jeans had flattened it);
#   THE BOOTS    the foot 18 % narrower (14.4 cm wide, a boot is 11–12);
#   THE LEGS     slimmer: each vertex 10 % (thigh) / 12 % (calf) nearer its bones' axis — the user: "his thighs and
#                calves are too big compared to his upper body" (thigh top 0.58 → 0.52 m round, calf 0.48 → 0.42, jeans on);
#   THE TORSO    upright: idle / walk / the turns leant 4–6° back (the head 7 cm behind the ankles standing) — each tipped
#                forward at the lowest spine bone to its mean TORSO_PITCH (the user: "he always leans a bit backwards");
#   THE HANDS    30 finger bones (Mixamo's names: LeftHandThumb1…3, …Index…, …Middle…, …Ring…, …Pinky…) on the
#                mesh's own fingers — straight in the bind pose, the thumb hanging below the palm — weighted along each
#                finger, the knuckles blended with the palm; the game curls them (Character.ts's hand poses);
#   THE LEGS     every clip's thighs turned in 2.5° about the pelvis's forward axis, the shins and feet kept as they
#                were: the knees and feet under the hips (they stood a hip-joint's width apart, legs like columns).
#   The bones keep their orientations (a joint moved moves its bone whole), so every clip plays as it did.
import sys, os, math, json
import numpy as np
import bpy
from mathutils import Matrix, Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
IN = os.path.abspath(kw.get('IN', os.path.join(HERE, 'hero_base', 'character_base.glb')))
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'human', 'character.glb')))
PREVIEW = kw.get('PREVIEW')
UPPER_ARM, FOREARM = float(kw.get('UPPER_ARM', '0.31')), float(kw.get('FOREARM', '0.25'))
HEAD_UP, HEAD_SCALE = float(kw.get('HEAD_UP', '0.045')), float(kw.get('HEAD_SCALE', '0.95'))
WAIST_W, WAIST_D, GLUTE = float(kw.get('WAIST_W', '0.11')), float(kw.get('WAIST_D', '0.10')), float(kw.get('GLUTE', '0.015'))
BOOT_W = float(kw.get('BOOT_W', '0.82'))
LEG_IN = math.radians(float(kw.get('LEG_IN', '2.5')))
TORSO_PITCH = {'idle': 1.0, 'walk': 2.5, 'turn_left': 1.0, 'turn_right': 1.0}   # (degrees forward, the clip's mean)
PFX = 'mixamorig:'
def log(*a): print('[fit]', *a, flush=True)

sc = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc.render.fps = 30   # (before the import: the clips' 30 fps keys land on whole frames)
bpy.ops.import_scene.gltf(filepath=IN)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.vertex_groups))
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o is not body]: bpy.data.objects.remove(o)   # (a stray Icosphere)
CLIPS = rig.get('clips')
rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
Mr, Mb = rig.matrix_world.copy(), body.matrix_world.copy()
me = body.data
NV = len(me.vertices)
P = np.array([(Mb @ v.co)[:] for v in me.vertices])
def short(n): return n[len(PFX):] if n.startswith(PFX) else n
gi = {g.index: short(g.name) for g in body.vertex_groups}
W = {short(g.name): np.zeros(NV) for g in body.vertex_groups}
for v in me.vertices:
    for g in v.groups: W[gi[g.group]][v.index] = g.weight
tot = sum(W.values()); tot[tot < 1e-9] = 1
for k in W: W[k] = W[k] / tot
def w(n): return W.get(n, np.zeros(NV))
J = {short(b.name): Mr @ b.head_local for b in rig.data.bones}
x, y, z = P[:, 0], P[:, 1], P[:, 2]
def band_w(z0, mask, dz=0.012): m = (np.abs(z - z0) < dz) & mask; return (float(np.ptp(x[m])), float(np.ptp(y[m]))) if m.any() else (0, 0)
ARM = sum(w(s + n) for s in ('Left', 'Right') for n in ('Arm', 'ForeArm', 'Hand'))
torso = ARM < 0.05
log(f'in: {NV} vertices, stature {z.max():.3f}; waist {band_w(J["Spine1"].z, torso)}; boot (left) {band_w(0.03, (x < 0) & torso)}, shaft {band_w(0.15, (x < 0) & torso)}')

# ===================================================================================================== the mesh
# THE ARMS: |x| along the T-pose's arm remapped (the upper arm and the forearm to their lengths, the hand carried)
ARMJ = {}
for s, sg in (('Left', -1), ('Right', 1)):
    sh, el, wr = abs(J[s + 'Arm'].x), abs(J[s + 'ForeArm'].x), abs(J[s + 'Hand'].x)
    ARMJ[s] = (sh, el, wr)
    def remap(ax, sh=sh, el=el, wr=wr):
        if ax <= sh: return ax
        if ax <= el: return sh + (ax - sh) * UPPER_ARM / (el - sh)
        if ax <= wr: return sh + UPPER_ARM + (ax - el) * FOREARM / (wr - el)
        return sh + UPPER_ARM + FOREARM + (ax - wr)
    aw = w(s + 'Arm') + w(s + 'ForeArm') + w(s + 'Hand')
    for i in np.nonzero((aw > 0) & (np.sign(x) == sg))[0]:
        ax = abs(P[i, 0]); P[i, 0] += sg * (remap(ax) - ax) * aw[i]
    log(f'{s} arm: upper {el - sh:.3f} → {UPPER_ARM}, forearm {wr - el:.3f} → {FOREARM}')
# THE HEAD: smaller, about its new pivot (by the head's weight: the neck's blend stays smooth)
HEAD_PIVOT = J['Head'] + Vector((0, 0, HEAD_UP))
hp = np.array(HEAD_PIVOT[:]); wh = w('Head')[:, None]
P += ((hp + (P - hp) * HEAD_SCALE) - P) * wh
# THE WAIST: wider and deeper about the torso's axis, a bell around the narrowest (just under Spine1)
zc = J['Spine1'].z - 0.005
m_ = torso & (np.abs(z - zc) < 0.012)
yc = float((P[m_, 1].max() + P[m_, 1].min()) / 2)
g = np.exp(-0.5 * ((P[:, 2] - zc) / 0.055) ** 2) * torso
P[:, 0] *= 1 + WAIST_W * g
P[:, 1] = yc + (P[:, 1] - yc) * (1 + WAIST_D * g)
# THE SEAT: the buttocks' back pushed out (their fullest band, each side of the cleft)
zg = J['LeftUpLeg'].z - 0.09
gb = GLUTE * np.exp(-0.5 * ((P[:, 2] - zg) / 0.05) ** 2) * np.exp(-0.5 * ((np.abs(P[:, 0]) - 0.07) / 0.05) ** 2) * np.clip((yc - 0.06 - P[:, 1]) / 0.05, 0, 1) * torso
P[:, 1] -= gb
# THE BOOTS: narrower about each foot's own centre line, the foot full, eased out by the ankle
for sg in (-1, 1):
    side = (np.sign(P[:, 0]) == sg) & torso & (P[:, 2] < 0.13)
    cx = float(np.median(P[side & (P[:, 2] < 0.03), 0]))
    t = np.clip((P[:, 2] - 0.06) / 0.06, 0, 1); s_ = BOOT_W + (1 - BOOT_W) * t * t * (3 - 2 * t)
    P[side, 0] = cx + (P[side, 0] - cx) * s_[side]
# THE LEGS (2026-11-09, the user: "his thighs and calves are too big compared to his upper body"): each leg vertex drawn
# toward its bones' axis (hip → knee, knee → ankle, by its weights) — THIGH / CALF of its distance taken; nothing at the
# hip joint (the seat and the pelvis kept), full 12 cm under it; nothing in the boot, full above its top (the boots kept)
THIGH, CALF = float(kw.get('THIGH', '0.10')), float(kw.get('CALF', '0.12'))
def hull_len(pts):
    pts = sorted(map(tuple, pts))
    if len(pts) < 3: return 0.0
    def half(seq):
        h = []
        for p_ in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p_[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p_[0] - h[-2][0]) <= 0: h.pop()
            h.append(p_)
        return h
    h = half(pts)[:-1] + half(pts[::-1])[:-1]
    return float(sum(math.dist(h[i], h[(i + 1) % len(h)]) for i in range(len(h))))
LEG_LEVELS = (('thigh top', J['LeftUpLeg'].z - 0.17), ('mid-thigh', J['LeftUpLeg'].z - 0.27), ('knee', J['LeftLeg'].z), ('calf', J['LeftLeg'].z - 0.12), ('above the boot', 0.26))
def leg_girths():
    lw_ = w('LeftUpLeg') + w('LeftLeg')
    return ', '.join(f'{n} {hull_len(P[(np.abs(P[:, 2] - z0) < 0.006) & (P[:, 0] < 0) & torso & (lw_ > 0.3)][:, :2]):.3f}' for n, z0 in LEG_LEVELS)
log('leg girths (left, with the jeans) before: ' + leg_girths())
def closest_v(p, a_, b_):
    d_ = np.array(b_[:]) - np.array(a_[:]); t_ = np.clip(((p - np.array(a_[:])) @ d_) / (d_ @ d_), 0, 1); return np.array(a_[:]) + t_[:, None] * d_
for s, sg in (('Left', -1), ('Right', 1)):
    wu, wl = w(s + 'UpLeg'), w(s + 'Leg')
    lw_ = wu + wl
    m = (lw_ > 0.01) & torso
    if not m.any(): continue
    Pm = P[m]
    c = (closest_v(Pm, J[s + 'UpLeg'], J[s + 'Leg']) * wu[m, None] + closest_v(Pm, J[s + 'Leg'], J[s + 'Foot']) * wl[m, None]) / lw_[m, None]
    k = (THIGH * wu[m] + CALF * wl[m]) / lw_[m] * np.minimum(1, lw_[m])
    k *= np.clip((J[s + 'UpLeg'].z - 0.05 - Pm[:, 2]) / 0.12, 0, 1) * np.clip((Pm[:, 2] - 0.20) / 0.08, 0, 1)
    P[m] = c + (Pm - c) * (1 - k[:, None])
log('leg girths (left, with the jeans) after: ' + leg_girths())
x, y, z = P[:, 0], P[:, 1], P[:, 2]
log(f'out: stature {z.max():.3f}; waist {band_w(zc, torso)}; boot (left) {band_w(0.03, (x < 0) & torso)}')

# ===================================================================================================== the fingers
# (each side measured on the mesh: the four fingers are apart past the web (u > 0.105 m from the wrist, the pinky's
#  from 0.095), the thumb hangs under the palm; their joints placed by the phalanges' share of each finger — proximal
#  0.45, middle 0.29, distal 0.26 — the knuckles (MCP) a quarter of the finger back from the web)
FINGERS = ('Index', 'Middle', 'Ring', 'Pinky')
FJ = {}            # bone name → (head, tail) world
FW = {}            # bone name → weights (NV)
for s, sg in (('Left', -1), ('Right', 1)):
    hand = w(s + 'Hand')
    wr = np.array([sg * (ARMJ[s][0] + UPPER_ARM + FOREARM), J[s + 'Hand'].y, J[s + 'Hand'].z])
    u = sg * (P[:, 0] - wr[0])
    H = hand > 0.01
    # the four fingers: past the web, split by y (1-D k-means)
    fm = H & (u > 0.105) & (P[:, 2] > wr[2] - 0.03)
    ys = P[fm, 1]; c = np.quantile(ys, [0.1, 0.37, 0.63, 0.9])
    for _ in range(30):
        lab = np.argmin(np.abs(ys[:, None] - c[None, :]), 1); c = np.array([ys[lab == k].mean() for k in range(4)])
    order = np.argsort(-c)                      # index (front, +y) … pinky (back)
    fidx = np.nonzero(fm)[0]
    lines = {}
    for k, nm in enumerate(FINGERS):
        vs = fidx[lab == order[k]]
        tip_u = float(u[vs].max()); web = 0.095 if nm == 'Pinky' else 0.105
        L = (tip_u - web) / 0.75; um = tip_u - L
        def at(uu, vs=vs):
            sel = vs[np.abs(u[vs] - uu) < 0.006]
            if len(sel) < 3: sel = vs[np.argsort(np.abs(u[vs] - uu))[:8]]
            return np.array([P[sel, 1].mean(), (P[sel, 2].max() + P[sel, 2].min()) / 2])
        yf = at(web + 0.01)[0]
        mm = H & (np.abs(u - um) < 0.006) & (np.abs(P[:, 1] - yf) < 0.008)
        mcp = np.array([wr[0] + sg * um, yf, (P[mm, 2].max() + P[mm, 2].min()) / 2 if mm.any() else wr[2]])
        pts = [mcp]
        for f_ in (0.45, 0.74, 1.0):
            yz = at(um + L * f_ if f_ < 1 else tip_u - 0.004)
            pts.append(np.array([wr[0] + sg * (um + L * f_), yz[0], yz[1]]))
        lines[nm] = pts
        for j in range(3): FJ[f'{s}Hand{nm}{j + 1}'] = (Vector(pts[j]), Vector(pts[j + 1]))
        log(f'{s} {nm}: knuckle u {um:.3f}, length {L:.3f}, y {yf:+.3f}')
    # the thumb: under the palm; its axis by PCA, the tip its far end; distal 0.028, proximal 0.032, metacarpal 0.045
    tm = H & (P[:, 2] < wr[2] - 0.03) & (u > 0.03)
    T = P[tm]; c0 = T.mean(0); _, _, vt = np.linalg.svd(T - c0); a = vt[0]
    if a[2] > 0: a = -a                          # (toward the tip: down)
    tip = c0 + a * float(((T - c0) @ a).max())
    ip = tip - a * 0.026; mcp_t = ip - a * 0.032; cmc = mcp_t - a * 0.045
    lines['Thumb'] = [cmc, mcp_t, ip, tip]
    for j in range(3): FJ[f'{s}HandThumb{j + 1}'] = (Vector(lines['Thumb'][j]), Vector(lines['Thumb'][j + 1]))
    log(f'{s} Thumb: axis {np.round(a, 2)}, cmc {np.round(cmc, 3)} (wrist {np.round(wr, 3)}), tip {np.round(tip, 3)}')
    # WEIGHTS: each hand vertex to the nearest digit's polyline; along it by its joints (blended ±5 mm), the knuckles
    # blended with the palm; the thumb's metacarpal also carries the palm's ball under it (the thenar)
    def seg_d(p, a_, b_):
        d_ = b_ - a_; t_ = np.clip(((p - a_) @ d_) / (d_ @ d_), 0, 1); return np.linalg.norm(p - (a_ + t_[:, None] * d_), axis=1), t_
    hv = np.nonzero(H)[0]; Ph = P[hv]
    dist = {}; param = {}
    for nm, pts in lines.items():
        ext = [pts[0] - (pts[1] - pts[0]) / np.linalg.norm(pts[1] - pts[0]) * 0.02] + pts if nm != 'Thumb' else pts
        best = np.full(len(hv), 9.0); s_along = np.zeros(len(hv)); acc = 0.0
        for j in range(len(ext) - 1):
            d_, t_ = seg_d(Ph, ext[j], ext[j + 1]); ln = float(np.linalg.norm(ext[j + 1] - ext[j]))
            b_ = d_ < best; best[b_] = d_[b_]; s_along[b_] = acc + t_[b_] * ln; acc += ln
        dist[nm] = best; param[nm] = s_along - (0.02 if nm != 'Thumb' else 0.0)   # (0 at the knuckle / the CMC)
    names = list(lines)
    D = np.stack([dist[n] for n in names], 1); near = np.argmin(D, 1); dmin = D[np.arange(len(hv)), near]
    for nm in names:
        for j in range(3): FW[f'{s}Hand{nm}{j + 1}'] = np.zeros(NV)
    def ramp(v, a_, b_): return np.clip((v - a_) / (b_ - a_), 0, 1)
    for k, nm in enumerate(names):
        pts = lines[nm]; L1 = float(np.linalg.norm(pts[1] - pts[0])); L2 = L1 + float(np.linalg.norm(pts[2] - pts[1]))
        sel = near == k
        sp = param[nm][sel]
        if nm == 'Thumb':
            on = (dmin[sel] < 0.017).astype(float)
            # the metacarpal: its own vertices, and the thenar's flesh around it (falling off to 3 cm)
            thenar = np.clip((0.03 - dmin[sel]) / 0.018, 0, 1) * (sp < L1)
            base = np.maximum(on * ramp(sp, -0.005, 0.012), thenar)
        else:
            on = (dmin[sel] < 0.016).astype(float)
            base = on * ramp(sp, -0.015, 0.008)                          # (the knuckle: the palm → the finger)
        w2 = ramp(sp, L1 - 0.005, L1 + 0.005); w3 = ramp(sp, L2 - 0.005, L2 + 0.005)
        b1, b2, b3 = base * (1 - w2), base * (w2 - w3), base * w3
        hw_ = hand[hv[sel]]
        FW[f'{s}Hand{nm}1'][hv[sel]] = b1 * hw_; FW[f'{s}Hand{nm}2'][hv[sel]] = b2 * hw_; FW[f'{s}Hand{nm}3'][hv[sel]] = b3 * hw_
    moved = sum(FW[f'{s}Hand{nm}{j + 1}'] for nm in names for j in range(3))
    W[s + 'Hand'] = np.maximum(0, hand - moved)
    log(f'{s} hand: {int((moved > 0.01).sum())} of {len(hv)} hand vertices on the digits')
W.update(FW)

# write the mesh and the weights
Mbi = Mb.inverted()
for i, v in enumerate(me.vertices): v.co = Mbi @ Vector(P[i])
for g_ in list(body.vertex_groups): body.vertex_groups.remove(g_)
for nm, arr in W.items():
    grp = body.vertex_groups.new(name=PFX + nm)
    for i in np.nonzero(arr > 1e-4)[0]: grp.add([int(i)], float(arr[i]), 'REPLACE')
me.update()

# ===================================================================================================== the bones
# (moved WHOLE — head and tail together, so each keeps its orientation and every clip its meaning)
Mri = Mr.inverted()
bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
def move(name, d):
    b_ = eb[PFX + name]; b_.head += d; b_.tail += d
for s, sg in (('Left', -1), ('Right', 1)):
    sh, el, wr = ARMJ[s]
    d_el = Vector((sg * (sh + UPPER_ARM - el), 0, 0)); d_wr = Vector((sg * (sh + UPPER_ARM + FOREARM - wr), 0, 0))
    a_ = eb[PFX + s + 'Arm']; dir_ = (a_.tail - a_.head).normalized(); a_.tail = a_.head + dir_ * (UPPER_ARM / abs(dir_.x))
    move(s + 'ForeArm', Mri.to_3x3() @ d_el)
    f_ = eb[PFX + s + 'ForeArm']; dir_ = (f_.tail - f_.head).normalized(); f_.tail = f_.head + dir_ * (FOREARM / abs(dir_.x))
    move(s + 'Hand', Mri.to_3x3() @ d_wr)
move('Head', Mri.to_3x3() @ Vector((0, 0, HEAD_UP)))
for s in ('Left', 'Right'):
    for nm in ('Thumb',) + FINGERS:
        for j in range(3):
            n = f'{s}Hand{nm}{j + 1}'; h_, t_ = FJ[n]
            b_ = eb.new(PFX + n); b_.head = Mri @ h_; b_.tail = Mri @ t_
            b_.align_roll(Mri.to_3x3() @ Vector((0, 0, 1)))
            b_.parent = eb[PFX + (s + 'Hand' if j == 0 else f'{s}Hand{nm}{j}')]; b_.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
for pb in rig.pose.bones: pb.rotation_mode = 'QUATERNION'
log(f'bones: {len(rig.data.bones)} (22 + {len(rig.data.bones) - 22} finger bones)')

# ===================================================================================================== the clips
# THE THIGHS IN: every frame of every clip, each thigh turned LEG_IN about the pelvis's own forward axis (through the
# hip joint), its shin and foot given back the world turns they had — the knee and the foot come in under the hip
rig.data.pose_position = 'POSE'   # (the clips evaluate only in POSE: in REST every frame reads as the rest pose)
ad = rig.animation_data
tracks = list(ad.nla_tracks) if ad else []
for tr in tracks: tr.mute = True
hips = rig.pose.bones[PFX + 'Hips']
hips_rest = (Mr @ hips.bone.matrix_local).to_quaternion()
n_keys = 0
for tr in tracks:
    for st in tr.strips:
        act = st.action
        ad.action = act     # (its slot picked by Blender, as the import made it)
        f0, f1 = (int(round(v_)) for v_ in act.frame_range)
        # (a guard: the clip must be PLAYING while it's baked — else the rest pose would be keyed over it)
        probe = []
        for fr in (f0, (f0 + f1) // 2, f1):
            sc.frame_set(fr); probe.append((Mr @ rig.pose.bones[PFX + 'LeftUpLeg'].matrix).to_quaternion())
        if all(abs(q.dot(probe[0])) > 0.99999 for q in probe) and act.name not in ('sit_drive',):
            log(f'  {act.name}: WARNING its thigh doesn\'t move — is it playing?')
        # THE TORSO UPRIGHT (2026-11-09, the user: "he always leans a bit backwards"): the clip's mean torso pitch (hips →
        # neck, side on) measured; the standing / walking ones tipped forward at the lowest spine bone to TORSO_PITCH (a
        # man stands upright to a few degrees forward, his head over his feet) — the pelvis and the legs as they were
        tip = 0.0
        if act.name in TORSO_PITCH:
            ps = []
            for fr in range(f0, f1 + 1, max(1, (f1 - f0) // 40)):
                sc.frame_set(fr)
                h_, n_ = Mr @ hips.head, Mr @ rig.pose.bones[PFX + 'Neck'].head
                fw_ = ((Mr @ hips.matrix).to_quaternion() @ hips_rest.inverted()) @ Vector((0, 1, 0)); fw_.z = 0; fw_.normalize()
                d_ = n_ - h_; ps.append(math.degrees(math.atan2(d_.dot(fw_), d_.z)))
            tip = math.radians(TORSO_PITCH[act.name] - sum(ps) / len(ps))
            log(f'  {act.name}: torso {sum(ps) / len(ps):+.1f}° → {TORSO_PITCH[act.name]:+.1f}°')
        spine = rig.pose.bones[PFX + 'Spine']
        for fr in range(f0, f1 + 1):
            sc.frame_set(fr)
            fwd = ((Mr @ hips.matrix).to_quaternion() @ hips_rest.inverted()) @ Vector((0, 1, 0))
            if tip:
                rt = ((Mr @ hips.matrix).to_quaternion() @ hips_rest.inverted()) @ Vector((1, 0, 0))   # (his right)
                Ms = Mr @ spine.matrix; hd_ = Ms.translation.copy()
                spine.matrix = Mri @ (Matrix.Translation(hd_) @ Quaternion(rt, -tip).to_matrix().to_4x4() @ Matrix.Translation(-hd_) @ Ms)
                bpy.context.view_layer.update()
                spine.keyframe_insert('rotation_quaternion', frame=fr)
            for s, sg in (('Left', -1), ('Right', 1)):
                up, lg, ft = (rig.pose.bones[PFX + s + n] for n in ('UpLeg', 'Leg', 'Foot'))
                keep = {b_: (Mr @ b_.matrix).to_quaternion() for b_ in (lg, ft)}
                R = Quaternion(fwd, sg * LEG_IN).to_matrix().to_4x4()
                Mu = Mr @ up.matrix; hd = Mu.translation.copy()
                up.matrix = Mri @ (Matrix.Translation(hd) @ R @ Matrix.Translation(-hd) @ Mu)
                bpy.context.view_layer.update()
                for b_ in (lg, ft):
                    cur = Mr @ b_.matrix
                    b_.matrix = Mri @ Matrix.LocRotScale(cur.translation, keep[b_], None)
                    bpy.context.view_layer.update()
                for b_ in (up, lg, ft): b_.keyframe_insert('rotation_quaternion', frame=fr); n_keys += 1
        log(f'  {act.name}: frames {f0}…{f1}, thighs in {math.degrees(LEG_IN):.1f}°')
ad.action = None
for tr in tracks: tr.mute = False
for pb in rig.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
if CLIPS: rig['clips'] = CLIPS

# ===================================================================================================== out
rig.data.pose_position = 'POSE'
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=True,
                          export_materials='NONE', export_extras=True, export_skins=True, export_all_influences=False, export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_draco_position_quantization=14,
                          export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_draco_generic_quantization=12)
log(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.1f} kB')

# THE CHANNELS PRUNED (the exporter writes every bone's translation, rotation and scale in every clip: 3 × 52 × 22; the
# game reads the rotations and the hips' travel only, and poses the fingers itself) — the unused accessors and their
# bytes dropped, the buffer compacted
import struct
def prune_glb(path):
    b = open(path, 'rb').read(); o = 12; js = bn = None
    while o < len(b):
        ln, ty = struct.unpack_from('<II', b, o)
        if ty == 0x4E4F534A: js = json.loads(b[o + 8:o + 8 + ln])
        elif ty == 0x004E4942: bn = b[o + 8:o + 8 + ln]
        o += 8 + ln
    nodes = js['nodes']
    def keep(ch):
        nm = short(nodes[ch['target']['node']].get('name', ''))
        if nm.startswith(('LeftHand', 'RightHand')) and nm[-1].isdigit(): return False
        return ch['target']['path'] == 'rotation' or (ch['target']['path'] == 'translation' and nm == 'Hips')
    for a in js['animations']:
        chs = [c for c in a['channels'] if keep(c)]
        smap = {}; samplers = []
        for c in chs:
            if c['sampler'] not in smap: smap[c['sampler']] = len(samplers); samplers.append(a['samplers'][c['sampler']])
            c['sampler'] = smap[c['sampler']]
        a['channels'], a['samplers'] = chs, samplers
    used = set()
    for m in js['meshes']:
        for pr in m['primitives']:
            used.update(pr['attributes'].values())
            if 'indices' in pr: used.add(pr['indices'])
    for s in js.get('skins', []):
        if 'inverseBindMatrices' in s: used.add(s['inverseBindMatrices'])
    for a in js['animations']:
        for s in a['samplers']: used.update((s['input'], s['output']))
    amap = {old: new for new, old in enumerate(sorted(used))}
    js['accessors'] = [js['accessors'][i] for i in sorted(used)]
    def remap_acc(i): return amap[i]
    for m in js['meshes']:
        for pr in m['primitives']:
            pr['attributes'] = {k: remap_acc(v) for k, v in pr['attributes'].items()}
            if 'indices' in pr: pr['indices'] = remap_acc(pr['indices'])
    for s in js.get('skins', []):
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = remap_acc(s['inverseBindMatrices'])
    for a in js['animations']:
        for s in a['samplers']: s['input'], s['output'] = remap_acc(s['input']), remap_acc(s['output'])
    used_bv = {a['bufferView'] for a in js['accessors'] if 'bufferView' in a}
    for m in js['meshes']:
        for pr in m['primitives']:
            d_ = pr.get('extensions', {}).get('KHR_draco_mesh_compression')
            if d_: used_bv.add(d_['bufferView'])
    for im in js.get('images', []):
        if 'bufferView' in im: used_bv.add(im['bufferView'])
    bmap = {}; out = bytearray(); views = []
    for old in sorted(used_bv):
        v = dict(js['bufferViews'][old]); off = v.get('byteOffset', 0)
        while len(out) % 4: out.append(0)
        data = bn[off:off + v['byteLength']]; v['byteOffset'] = len(out); out += data
        bmap[old] = len(views); views.append(v)
    js['bufferViews'] = views
    for a in js['accessors']:
        if 'bufferView' in a: a['bufferView'] = bmap[a['bufferView']]
    for m in js['meshes']:
        for pr in m['primitives']:
            d_ = pr.get('extensions', {}).get('KHR_draco_mesh_compression')
            if d_: d_['bufferView'] = bmap[d_['bufferView']]
    for im in js.get('images', []):
        if 'bufferView' in im: im['bufferView'] = bmap[im['bufferView']]
    while len(out) % 4: out.append(0)
    js['buffers'][0]['byteLength'] = len(out)
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)
prune_glb(OUT)
log(f'pruned to the channels the game reads: {os.path.getsize(OUT) / 1e3:.1f} kB')

# ===================================================================================================== preview
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    eng = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in eng else 'BLENDER_EEVEE'
    wo = bpy.data.worlds.new('w'); sc.world = wo; wo.use_nodes = True; wo.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.62, 0.66, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(40), 0, math.radians(20)); sc.collection.objects.link(sun)
    mat = bpy.data.materials.new('m'); mat.use_nodes = True; t = mat.node_tree; bs = t.nodes['Principled BSDF']
    ti = t.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(OUT[:-4] + '.webp'); t.links.new(ti.outputs['Color'], bs.inputs['Base Color'])
    me.materials.clear(); me.materials.append(mat)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
    def shot(tag, loc, tgt, s_, rx=600, ry=600, up='Y'):
        cam.data.ortho_scale = s_; sc.render.resolution_x, sc.render.resolution_y = rx, ry
        cam.location = Vector(loc); cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat('-Z', up).to_euler()
        sc.render.filepath = os.path.join(PREVIEW, tag + '.png'); bpy.ops.render.render(write_still=True)
    # a GRIP on the fingers (as the game curls them: about d × palm-normal, the palm facing down in the T-pose)
    for tr in tracks: tr.mute = True
    ad.action = None
    for pb in rig.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    log(f'preview: left hand at {tuple(round(c, 3) for c in (Mr @ rig.pose.bones[PFX + "LeftHand"].head))}')
    def curl(deg_f, deg_t):
        for s in ('Left', 'Right'):
            for nm in ('Thumb',) + FINGERS:
                for j in range(3):
                    pb = rig.pose.bones[PFX + f'{s}Hand{nm}{j + 1}']
                    d_ = (pb.bone.tail_local - pb.bone.head_local).normalized()
                    n_ = Vector((0, 1, 0)) if nm == 'Thumb' else Vector((0, 0, -1))
                    if nm == 'Thumb': n_ = Vector((0, -1, -0.6)).normalized()
                    ax = d_.cross(n_).normalized()
                    ang = math.radians((deg_t if nm == 'Thumb' else deg_f)[j])
                    loc_ax = pb.bone.matrix_local.to_3x3().inverted() @ ax
                    pb.rotation_quaternion = Quaternion(loc_ax, ang)
        bpy.context.view_layer.update()
    lh = Mr @ rig.data.bones[PFX + 'LeftHand'].head_local; c_ = (lh.x - 0.08, lh.y, lh.z - 0.02)
    for tag, cf, ct in (('open', (0, 0, 0), (0, 0, 0)), ('grip', (60, 75, 45), (20, 30, 25)), ('fist', (88, 100, 65), (25, 40, 35))):
        curl(cf, ct)
        shot(f'hand_{tag}_front', (c_[0], c_[1] + 3, c_[2]), c_, 0.26)
        shot(f'hand_{tag}_end', (c_[0] - 3, c_[1], c_[2]), c_, 0.26, up='Z')
    curl((0, 0, 0), (0, 0, 0))
    for tr in tracks: tr.mute = tr.name != 'idle'
    sc.frame_set(10)
    shot('front', (0, 6, 0.95), (0, 0, 0.95), 2.0, 700, 900); shot('side', (6, 0, 0.95), (0, 0, 0.95), 2.0, 700, 900)
    log('preview rendered')
