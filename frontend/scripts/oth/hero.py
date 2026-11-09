# OVERHILL — THE HERO (2026-11-09, the user: "a guy who has a good jaw line and perfect body … make sure he wears pants
# and a shirt … even with shirt and pants his body must show — his build, the aesthetic body"). Quaternius's Universal
# Base Characters, the Superhero male (CC0: quaternius.com — the free "Standard" pack), with the pack's beard, the
# "SimpleParted" hair and its eyebrows; DRESSED HERE, on his own body: a fitted short-sleeved shirt, jeans, a belt and
# boots — the garments are his skin pushed out a few millimetres and softened a little (the deepest grooves of the abs and
# thighs eased, the chest, shoulders and arms kept), so they move with him exactly and his build shows through. The cloth
# is ambientCG's (CC0) scans, box-projected and baked into his own UVs.
#
#   blender -b --factory-startup --python scripts/oth/hero.py -- [OUT=src/assets/models/human/character.glb]
#           [CLIPS=scripts/oth/.cache/mixamo] [PREVIEW=<dir>] [STAGE=look|all]
#
#   1. assemble: the body, eyes, eyebrows, beard and hair joined into one mesh on the body's skeleton; turned to face
#      the game's −z (Blender +y), in metres;
#   2. dress: each skin vertex labelled skin / shirt / jeans / belt / boots by its bones and height; the cloth pushed out
#      along the normals, the hems raised, the boots' soles flattened;
#   3. bake: the colour (skin from his own texture; the cloth from the scans, tinted) and the NORMAL map (his muscles'
#      own; the weave of the cloth) into his UVs; one atlas with the hair's and the eyes' textures beside — colour
#      and normals both;
#   4. the game's skeleton (Mixamo's 22 bones) on his joints, his weights folded onto it (fingers → hand, the toes'
#      leaf → the toe), the Mixamo clips retargeted (rocketbox.py's way);
#   5. out: the GLB (Draco) + character.webp (colour) + character_n.webp (normals).
import sys, os, math, json
import numpy as np
import bpy, bmesh
from mathutils import Matrix, Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
Q = os.path.join(HERE, '.cache', 'quaternius')
UBC = os.path.join(Q, 'Universal Base Characters[Standard]')
BODY = os.path.join(UBC, 'Base Characters', 'Godot - UE', 'Superhero_Male_FullBody.gltf')
HAIR = os.path.join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)')
ACG = os.path.join(HERE, '.cache', 'ambientcg')
CLIPS = kw.get('CLIPS', os.path.join(HERE, '.cache', 'mixamo'))
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'human', 'character.glb')))
PREVIEW = kw.get('PREVIEW')
STAGE = kw.get('STAGE', 'all')
PFX = 'mixamorig:'
SHOULDER_DROP = float(kw.get('SHOULDER_DROP', '9'))
SHOULDER_BACK = float(kw.get('SHOULDER_BACK', '15'))   # (degrees: the clavicles turned back — the shoulder on the ear's line)
def log(*a): print('[hero]', *a, flush=True)

# the look
HAIR_TINT = (0.20, 0.12, 0.07)              # dark brown (the pack's hair is grey, tinted by its shader in the paid version)
SHIRT = ('Fabric036', (0.20, 0.24, 0.16))   # a dark olive cotton
JEANS = ('Fabric069', (0.55, 0.62, 0.80))   # denim, its own blue a little deeper
BOOTS = ('Leather037', (0.85, 0.70, 0.55))
BELT = ('Leather030', (0.55, 0.45, 0.38))

sc = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
sc.render.fps = 30

# ===================================================================================================== 1. assemble
def imp(p):
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=p); return [o for o in bpy.data.objects if o not in before]
parts = imp(BODY)
arm0 = next(o for o in parts if o.type == 'ARMATURE')
JW = {b.name: (arm0.matrix_world @ b.head_local).copy() for b in arm0.data.bones}
JT = {b.name: (arm0.matrix_world @ b.tail_local).copy() for b in arm0.data.bones}
for h in ('Hair_Beard', 'Hair_SimpleParted'):
    parts += imp(os.path.join(HAIR, f'{h}.gltf'))
for o in [o for o in parts if o.type == 'MESH' and not o.vertex_groups]: parts.remove(o); bpy.data.objects.remove(o)   # (a helper Icosphere, no weights)
meshes = [o for o in parts if o.type == 'MESH']
for o in meshes:
    for m in list(o.modifiers):
        if m.type == 'ARMATURE': o.modifiers.remove(m)
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in [o for o in parts if o.type == 'ARMATURE']: bpy.data.objects.remove(o)
for o in meshes:
    for k, uv in enumerate(o.data.uv_layers): uv.name = 'UVMap' if k == 0 else f'UV{k}'   # (one UV map after the join)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
body = next(o for o in meshes if o.name.startswith('SuperHero'))
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
# the glTF's vertices split along every UV seam welded back (else the cloth, pushed out, opens cracks at the seams)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
try: bpy.ops.mesh.customdata_custom_splitnormals_clear()
except Exception: pass
bpy.ops.object.shade_smooth()
TURN = Matrix.Rotation(math.pi, 4, 'Z')    # (he faces Blender −y; the game's front is +y here)
me = body.data; me.transform(TURN); me.update()
J = {k: TURN @ v for k, v in JW.items()}
JTl = {k: TURN @ v for k, v in JT.items()}
zs = np.array([v.co.z for v in me.vertices])
log(f'assembled: {len(me.vertices)} vertices, {len(me.polygons)} faces, height {zs.max():.3f} m; materials {[m.name for m in me.materials]}')

for uv in [u for u in me.uv_layers if u.name != 'UVMap']: me.uv_layers.remove(uv)   # (the texture's map only)
me.uv_layers['UVMap'].active = True; me.uv_layers['UVMap'].active_render = True
log(f'UV maps {[u.name for u in me.uv_layers]}; joints: upperarm_l x {J["upperarm_l"].x:+.3f} (left is −x after the turn)')

# ===================================================================================================== 1b. his build
# THE BUILD (2026-11-09, the user: "too much muscle … make it 60 %", then "the shoulders are too big and wide, not like a
# human"): the Superhero body made an athletic man's. 1 = as the pack made him, 0 = lean. Three moves, all before the
# skeleton is made (the bones follow, the clips don't care):
#   ARMS IN: the arms (their bones and every vertex by its arm weight) moved toward the body — narrower shoulders;
#   GIRTH: each vertex drawn toward its bones' axes (by its weights) — most on the shoulders' caps and the arms, then the
#          chest and back, a little on the waist and legs, nothing on the head, hands or feet;
#   TRAPS: the slope from the neck to the shoulder lowered (the pack's rises like a bodybuilder's).
BUILD = float(kw.get('BUILD', '0.35'))   # (0.35: the user's 'like a human' — 0.6 still read as a bodybuilder's shoulders)
HAND = float(kw.get('HAND', '0.83'))        # the hands' scale (see THE HANDS below)
UPPER_ARM, FOREARM = float(kw.get('UPPER_ARM', '0.29')), float(kw.get('FOREARM', '0.232'))   # (m: see THE ARMS below)
HAND_BONES = ('hand', 'index', 'middle', 'pinky', 'ring', 'thumb')
LEAN = 1 - BUILD
def _wmap(v, gn):
    return {gn[g_.group]: g_.weight for g_ in v.groups if g_.weight > 1e-4}
gn0 = {g_.index: g_.name for g_ in body.vertex_groups}
Wv = [_wmap(v, gn0) for v in me.vertices]
P0 = np.array([v.co[:] for v in me.vertices])
ARM_BONES = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'pinky', 'ring', 'thumb')
DX = 0.045 * LEAN                                   # (0.35 → 2.9 cm in on each side: shoulder joints ±0.183 m, from ±0.212)
def is_arm(b): return b.startswith(ARM_BONES)
# girth factor by bone (how much of the radius is taken at LEAN = 1)
R_OF = {'upperarm': 0.42, 'lowerarm': 0.30, 'clavicle': 0.45, 'spine_03': 0.30, 'spine_02': 0.22, 'spine_01': 0.12, 'pelvis': 0.06,
        'neck_01': 0.30, 'thigh': 0.18, 'calf': 0.12}
def r_of(b):
    for k_, r_ in R_OF.items():
        if b.startswith(k_): return r_
    return 0.0
def seg(b):
    a_ = J.get(b); t_ = JTl.get(b)
    return (np.array(a_[:]), np.array(t_[:])) if a_ is not None and t_ is not None else None
SEG = {b: seg(b) for b in J}
def closest(p, ab):
    a_, b_ = ab; d_ = b_ - a_; t_ = np.clip(np.dot(p - a_, d_) / max(np.dot(d_, d_), 1e-9), 0, 1); return a_ + d_ * t_
P1 = P0.copy()
for i, w in enumerate(Wv):
    if not w: continue
    tot = sum(w.values())
    # girth: toward the weighted axis point, by the weighted factor
    c = np.zeros(3); k_ = 0.0
    for b, wt in w.items():
        sg = SEG.get(b)
        if sg is None: continue
        c += closest(P0[i], sg) * wt; k_ += r_of(b) * wt
    c /= tot; k_ /= tot
    P1[i] = c + (P0[i] - c) * (1 - LEAN * k_)
    # arms in (the clavicle's share half)
    a_w = sum(wt for b, wt in w.items() if is_arm(b)) / tot + 0.5 * sum(wt for b, wt in w.items() if b.startswith('clavicle')) / tot
    if a_w > 0 and abs(P0[i][0]) > 0.04: P1[i][0] -= np.sign(P0[i][0]) * DX * a_w
# the traps: the slope above the collarbones lowered, between the neck and the shoulder
zc = (J['clavicle_l'].z + J['clavicle_r'].z) / 2
for i in range(len(P1)):
    x_, z_ = abs(P1[i][0]), P1[i][2]
    if 0.03 < x_ < 0.24 and zc - 0.02 < z_ < J['Head'].z and not Wv[i].get('Head', 0) > 0.5:
        f_ = np.clip((x_ - 0.03) / 0.05, 0, 1) * np.clip((0.24 - x_) / 0.06, 0, 1)
        P1[i][2] = z_ - (z_ - (zc - 0.02)) * 0.35 * LEAN * f_
me.vertices.foreach_set('co', P1.ravel().astype(np.float32)); me.update()
# THE HANDS (2026-11-09, the user: "his hands, especially the fingers, a bit bigger or stretched"): the pack's hands are
# a bodybuilder's, and they were left as they were when the arms were slimmed — scaled about the wrist, a little more
# along the fingers (the arm's own axis in the T-pose) than across
P2 = np.array([v.co[:] for v in me.vertices])
for i, w in enumerate(Wv):
    if not w: continue
    tot = sum(w.values()); h_w = sum(wt for b, wt in w.items() if b.startswith(HAND_BONES)) / tot
    if h_w <= 0: continue
    side = 'l' if P2[i][0] < 0 else 'r'
    wr = np.array((J[f'hand_{side}'] - Vector((math.copysign(DX, J[f'hand_{side}'].x), 0, 0)))[:])   # (the wrist, moved in with the arm)
    d_ = P2[i] - wr
    sc_ = np.array([HAND - 0.03, HAND, HAND])
    P2[i] = P2[i] + (wr + d_ * sc_ - P2[i]) * h_w
me.vertices.foreach_set('co', P2.ravel().astype(np.float32)); me.update()
# THE ARMS (2026-11-09, the user: "the arm is too long … check human anatomy"): measured, the pack's upper arm is short
# (0.251 m) and its forearm as long (0.244 m) — forearm / upper arm 0.97 where a man's is ~0.8 (Drillis & Contini;
# Winter): the ape's long-forearm look. Set to UPPER_ARM / FOREARM: the elbow comes down to the waist, the wrist to the
# hip, the fingertips to mid-thigh. Along the T-pose's arm (x), each arm vertex moved by its arm weights' share.
Pn = np.array([v.co[:] for v in me.vertices])
def remap_arm(ax, sh_, el_, wr_):
    """|x| along the arm → its new |x| (piecewise: the upper arm and the forearm rescaled, the hand carried)"""
    ua_, fa_ = el_ - sh_, wr_ - el_
    if ax <= sh_: return ax
    if ax <= el_: return sh_ + (ax - sh_) * UPPER_ARM / ua_
    if ax <= wr_: return sh_ + UPPER_ARM + (ax - el_) * FOREARM / fa_
    return sh_ + UPPER_ARM + FOREARM + (ax - wr_)
ARMJ = {}
for sd in 'lr':
    ARMJ[sd] = (abs(J[f'upperarm_{sd}'].x) - DX, abs(J[f'lowerarm_{sd}'].x) - DX, abs(J[f'hand_{sd}'].x) - DX)
for i, w in enumerate(Wv):
    if not w: continue
    tot = sum(w.values()); a_w = sum(wt for b, wt in w.items() if is_arm(b)) / tot
    if a_w <= 0: continue
    sd = 'l' if Pn[i][0] < 0 else 'r'
    ax = abs(Pn[i][0]); Pn[i][0] += np.sign(Pn[i][0]) * (remap_arm(ax, *ARMJ[sd]) - ax) * a_w
me.vertices.foreach_set('co', Pn.ravel().astype(np.float32)); me.update()
# the bones follow the mesh: moved in, the arm's lengths remapped, the fingers scaled about the new wrist
for b in list(J):
    if is_arm(b): J[b] = J[b] - Vector((math.copysign(DX, J[b].x), 0, 0)); JTl[b] = JTl[b] - Vector((math.copysign(DX, JTl[b].x), 0, 0))
for b in list(J):
    if is_arm(b):
        sd = b[-1]
        for D_ in (J, JTl):
            ax = abs(D_[b].x); D_[b] = Vector((math.copysign(remap_arm(ax, *ARMJ[sd]), D_[b].x), D_[b].y, D_[b].z))
for b in list(J):
    if b.startswith(HAND_BONES) and not b.startswith('hand'):
        wr_ = J[f'hand_{b[-1]}']
        for D_ in (J, JTl):
            d_ = D_[b] - wr_; D_[b] = wr_ + Vector((d_.x * (HAND - 0.03), d_.y * HAND, d_.z * HAND))
log(f'build {BUILD}: arms in {DX * 100:.1f} cm a side, girth eased, traps lowered; shoulder joints at ±{abs(J["upperarm_l"].x):.3f} m')

# ===================================================================================================== 2. dress
# the garments' edges: planes on his rest pose (the T-pose; arms along x) — the same rule shapes the cloth and paints it
mi_kind = []
for m in me.materials:
    n = m.name.lower()
    mi_kind.append('body' if 'superhero' in n else 'eyes' if 'eye' in n else 'hair')
NV = len(me.vertices)
P = np.array([v.co[:] for v in me.vertices])
Nn = np.array([v.normal[:] for v in me.vertices])
on_body = np.zeros(NV, bool)
for p in me.polygons:
    if mi_kind[p.material_index] == 'body':
        for vi in p.vertices: on_body[vi] = True
sh, el = abs(J['upperarm_l'].x), abs(J['lowerarm_l'].x)
X_SLEEVE = sh + 0.55 * (el - sh)                          # short sleeves: the biceps' lower half bare
Z_HIP = (J['thigh_l'].z + J['thigh_r'].z) / 2
Z_WAIST = Z_HIP + 0.115
Z_BELT = Z_WAIST - 0.042
Z_BOOT = (J['foot_l'].z + J['foot_r'].z) / 2 + 0.11
Z_SOLE = 0.028
NECK = J['neck_01']
def z_collar(y):                                           # a crew neck, dipping at the front
    return NECK.z - 0.012 - 0.035 * np.clip((y - NECK.y) / 0.07, 0, 1)
R_NECK = 0.078                                             # the collar's ring: the neck's column inside it is skin
def neck_skin(x, y, z):
    rho = np.sqrt((x - NECK.x) ** 2 + (y - NECK.y) ** 2)
    return np.maximum(ramp(z - z_collar(y)) * ramp(R_NECK - rho, 0.004), ramp(z - (NECK.z + 0.07), 0.01))
def ramp(a, w=0.0015): return np.clip(0.5 + a / w, 0, 1)
def masks(x, y, z):
    skin = np.maximum(neck_skin(x, y, z), ramp(np.abs(x) - X_SLEEVE) * ramp(z - Z_WAIST + 0.05, 0.01))
    shirt = (1 - skin) * ramp(z - Z_WAIST)
    rest = 1 - skin - shirt
    belt = rest * ramp(z - Z_BELT)
    rest2 = rest - belt
    jeans = rest2 * ramp(z - Z_BOOT)
    boots = rest2 - jeans
    return skin, shirt, jeans, belt, boots
SKIN, SHIRT_I, JEANS_I, BELT_I, BOOTS_I = range(5)
# THE FIT (2026-11-09, the user: "too much muscle showing — now it's 100 %, make it 60 %, a bit relaxed"): how much of his
# build the shirt shows, 1 skin-tight … 0 loose. It sets the shirt's ease, how it hangs below the chest, its sleeves'
# opening, how hard its grooves are smoothed and how much of his muscles' normal map is kept under it.
FIT = float(kw.get('FIT', '0.6'))
LOOSE = 1 - FIT
M = np.stack(masks(P[:, 0], P[:, 1], P[:, 2]), 1)
lab = np.where(on_body, M.argmax(1), -1).astype(np.int8)
log('labels: ' + ', '.join(f'{n} {int((lab == k).sum())}' for k, n in enumerate(('skin', 'shirt', 'jeans', 'belt', 'boots'))))
me.attributes.new('rest', 'FLOAT_VECTOR', 'POINT').data.foreach_set('vector', P.ravel().astype(np.float32))

# the cloth pushed out, the hems lifted (lips over what's under them), softened
x, y, z = P[:, 0], P[:, 1], P[:, 2]
OFF = np.array([0.0, 0.006 + 0.004 * LOOSE, 0.016 + 0.004 * LOOSE, 0.013 + 0.004 * LOOSE, 0.017])
off = np.where(lab >= 0, OFF[np.maximum(lab, 0)], 0.0)
g = lambda d, w: np.exp(-(np.maximum(d, 0) / w) ** 2)
off += np.where(lab == SHIRT_I, 0.005 * g(z - Z_WAIST, 0.012) + 0.004 * g(X_SLEEVE - np.abs(x), 0.01) + 0.003 * g(z_collar(y) - z, 0.008) * (np.sqrt((x - NECK.x) ** 2 + (y - NECK.y) ** 2) < R_NECK + 0.02), 0)
off += np.where(lab == JEANS_I, 0.004 * g(z - Z_BOOT, 0.015), 0)
Z_KNEE = (J['calf_l'].z + J['calf_r'].z) / 2
# the shirt hangs from the chest instead of following him in to the waist; its sleeves open a little
Z_CHEST = J['spine_03'].z
off += np.where(lab == SHIRT_I, 0.012 * LOOSE * np.clip((Z_CHEST - z) / (Z_CHEST - Z_WAIST), 0, 1) ** 1.3, 0)
off += np.where(lab == SHIRT_I, 0.006 * LOOSE * g(X_SLEEVE - np.abs(x), 0.05), 0)
off += np.where(lab == JEANS_I, 0.003 + 0.006 * np.clip((Z_KNEE + 0.05 - z) / (Z_KNEE + 0.05 - Z_BOOT), 0, 1), 0)   # (looser; straight from the knee)
nbr = [[] for _ in range(NV)]
for e in me.edges:
    a, b = e.vertices; nbr[a].append(b); nbr[b].append(a)
cloth = lab > 0
edge = np.array([cloth[i] and any(lab[j] != lab[i] for j in nbr[i]) for i in range(NV)])
gname = {gi.index: gi.name for gi in body.vertex_groups}
def dominant(v):
    best, bw = '', 0
    for gg in v.groups:
        if gg.weight > bw: best, bw = gname[gg.group], gg.weight
    return best
dom = [dominant(v) for v in me.vertices]
soft = np.zeros(NV)
for i in np.nonzero(cloth)[0]:
    d, l = dom[i], lab[i]
    soft[i] = min(0.95, (0.55 if d in ('spine_01', 'pelvis') else 0.35 if d == 'spine_02' else 0.15 if d in ('spine_03', 'clavicle_l', 'clavicle_r', 'neck_01') else 0.10) + 0.75 * LOOSE) if l == SHIRT_I \
        else 0.6 if l == JEANS_I else 0.8 if l == BOOTS_I else 0.3
Q2 = P + Nn * off[:, None]
idx = [i for i in np.nonzero(soft > 0)[0] if not edge[i] and nbr[i]]
# (Taubin's smoothing — a shrink step then an inflate step: grooves ease, a thin ankle or wrist keeps its girth)
def lap_step(Qa, k):
    R = Qa.copy()
    for i in idx: R[i] = Qa[i] + (Qa[nbr[i]].mean(0) - Qa[i]) * soft[i] * k
    return R
for it in range(6): Q2 = lap_step(lap_step(Q2, 0.55), -0.58)
# the jeans and the boots again, harder (cloth hangs: the thighs' and calves' cuts gone, their mass kept)
idx_all = idx
idx = [i for i in idx_all if lab[i] in (JEANS_I, BOOTS_I)]
soft_keep = soft.copy(); soft[:] = np.where((lab == JEANS_I) | (lab == BOOTS_I), 0.9, 0)
for it in range(18): Q2 = lap_step(lap_step(Q2, 0.6), -0.63)
# the shirt again, by the fit (its hems held: they're the edges)
idx = [i for i in idx_all if lab[i] == SHIRT_I]
soft[:] = np.where(lab == SHIRT_I, soft_keep, 0)
for it in range(int(round(14 * LOOSE))): Q2 = lap_step(lap_step(Q2, 0.6), -0.63)
idx = idx_all; soft = soft_keep
# the boots' soles: flat, a touch proud of the upper
for i in np.nonzero((lab == BOOTS_I) & (z < Z_SOLE + 0.01))[0]:
    c = J['foot_l'] if x[i] < 0 else J['foot_r']
    h = Vector((Q2[i][0] - c.x, Q2[i][1] - c.y, 0))
    if h.length > 1e-6: h.normalize(); Q2[i][0] += h.x * 0.005; Q2[i][1] += h.y * 0.005
    Q2[i][2] = max(0.0, Q2[i][2] - 0.008)
me.vertices.foreach_set('co', Q2.ravel().astype(np.float32)); me.update()

# ===================================================================================================== 3. bake + paint
TEX = 2048
BASE = os.path.join(UBC, 'Base Characters', 'Godot - UE')
def load_px(path, linear=False):
    im = bpy.data.images.load(path); im.colorspace_settings.name = 'Non-Color' if linear else 'sRGB'
    w, h = im.size
    return np.array(im.pixels[:], np.float32).reshape(h, w, 4)
def resize_px(a, w, h):
    im = bpy.data.images.new('tmp', a.shape[1], a.shape[0], alpha=True, float_buffer=True); im.pixels = a.ravel(); im.scale(w, h)
    out = np.array(im.pixels[:], np.float32).reshape(h, w, 4); bpy.data.images.remove(im); return out

# (a) his rest position at every texel of his skin's UVs (Cycles: an emission bake of the 'rest' attribute)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
dup = body.copy(); dup.data = body.data.copy(); sc.collection.objects.link(dup)
bm = bmesh.new(); bm.from_mesh(dup.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if mi_kind[f.material_index] != 'body'], context='FACES'); bm.to_mesh(dup.data); bm.free()
pimg = bpy.data.images.new('restpos', TEX, TEX, alpha=True, float_buffer=True)
pimg.colorspace_settings.name = 'Non-Color'
pimg.pixels = np.tile(np.array([0, 0, -9, 0], np.float32), TEX * TEX)
bm_ = bpy.data.materials.new('bakepos'); bm_.use_nodes = True; t = bm_.node_tree
for n in list(t.nodes): t.nodes.remove(n)
at = t.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'rest'; at.attribute_type = 'GEOMETRY'
em = t.nodes.new('ShaderNodeEmission'); oo = t.nodes.new('ShaderNodeOutputMaterial'); tn = t.nodes.new('ShaderNodeTexImage'); tn.image = pimg
t.links.new(at.outputs['Vector'], em.inputs['Color']); t.links.new(em.outputs['Emission'], oo.inputs['Surface']); t.nodes.active = tn
dup.data.materials.clear(); dup.data.materials.append(bm_)
for m in list(dup.modifiers): dup.modifiers.remove(m)
bpy.ops.object.select_all(action='DESELECT'); dup.select_set(True); bpy.context.view_layer.objects.active = dup
sc.render.bake.margin = 2; sc.render.bake.use_clear = False
bpy.ops.object.bake(type="EMIT", margin=2, use_clear=False)
RP = np.array(pimg.pixels[:], np.float32).reshape(TEX, TEX, 4)
bpy.data.objects.remove(dup)
covered = RP[..., 2] > -8
log(f'rest positions baked: {covered.mean() * 100:.0f} % of the skin texture covered')

# (b) the garments painted per texel
X, Y, Z = RP[..., 0], RP[..., 1], RP[..., 2]
m_skin, m_shirt, m_jeans, m_belt, m_boots = masks(X, Y, Z)
m_skin = np.where(covered, m_skin, 1.0)
for a in (m_shirt, m_jeans, m_belt, m_boots): a[~covered] = 0
skin_c = load_px(os.path.join(BASE, 'T_Superhero_Male_Dark.png'))
skin_n = load_px(os.path.join(BASE, 'T_Superhero_Male_Normal.png'), True)
if skin_c.shape[0] != TEX: skin_c = resize_px(skin_c, TEX, TEX); skin_n = resize_px(skin_n, TEX, TEX)
u = (np.arange(TEX) + 0.5) / TEX
UU, VV = np.meshgrid(u, u)
def tiled(asset, kind, k, linear=False):
    a = load_px(os.path.join(ACG, asset, f'{asset}_1K-JPG_{kind}.jpg'), linear)
    h, w = a.shape[:2]
    return a[((VV * k) % 1 * h).astype(int) % h, ((UU * k) % 1 * w).astype(int) % w]
def pattern(asset, k, contrast):
    c = tiled(asset, 'Color', k)[..., :3]
    l = c @ np.array([0.3, 0.59, 0.11], np.float32); l = l / l.mean()
    return 1 + (l - 1) * contrast
# the colours (sRGB): a dark olive shirt, dark indigo jeans, a dark belt with a steel buckle, tan leather boots
SH_C, JE_C, BE_C, BO_C, SOLE_C, BUCKLE_C = (0.30, 0.34, 0.24), (0.16, 0.21, 0.33), (0.17, 0.11, 0.08), (0.42, 0.27, 0.16), (0.07, 0.06, 0.06), (0.58, 0.58, 0.56)
col = skin_c[..., :3].copy()
cl = {}
cl['shirt'] = np.array(SH_C) * pattern('Fabric036', 7, 0.5)[..., None]
cl['jeans'] = np.array(JE_C) * pattern('Fabric069', 6, 0.8)[..., None]
cl['belt'] = np.array(BE_C) * pattern('Leather030', 5, 0.6)[..., None]
buckle = (np.abs(X) < 0.028) & (Y > 0)
cl['belt'][buckle & (m_belt > 0.5)] = BUCKLE_C
bo = np.array(BO_C) * pattern('Leather037', 4, 0.7)[..., None]
cl['boots'] = np.where((Z < Z_SOLE)[..., None], np.array(SOLE_C), bo)
# shadows where one layer meets another: under the shirt's hem, under the jeans' cuff, the arm under the sleeve, the neck
# under the collar
sh_ = lambda d, w, k: 1 - k * np.exp(-np.maximum(d, 0) / w)
dark = np.ones_like(X)
dark *= np.where(Z < Z_WAIST, sh_(Z_WAIST - Z, 0.012, 0.45), 1)
dark *= np.where(Z < Z_BOOT, sh_(Z_BOOT - Z, 0.014, 0.45), 1)
dark *= np.where((np.abs(X) > X_SLEEVE) & (Z > Z_WAIST), sh_(np.abs(X) - X_SLEEVE, 0.012, 0.35), 1)
dark *= np.where(neck_skin(X, Y, Z) > 0.5, sh_(Z - z_collar(Y), 0.010, 0.25), 1)
out = col * m_skin[..., None]
for k_, m_ in (('shirt', m_shirt), ('jeans', m_jeans), ('belt', m_belt), ('boots', m_boots)): out += cl[k_] * m_[..., None]
out *= np.where(covered, dark, 1)[..., None]
def dilate(a, mask, n=24):
    a = a.copy(); m = mask.copy()
    for _ in range(n):
        acc = np.zeros_like(a); cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            mm = np.roll(m, (dy, dx), (0, 1)); acc += np.roll(a, (dy, dx), (0, 1)) * mm[..., None]; cnt += mm
        grow = (~m) & (cnt > 0)
        a[grow] = acc[grow] / cnt[grow][..., None]; m = m | grow
    return a
inside = covered
out = dilate(np.clip(out, 0, 1), inside)
BODY_C = np.concatenate([out, np.ones_like(X)[..., None]], -1).astype(np.float32)
# normals: his muscles' own under the shirt (eased), barely under the jeans; the weave on top
dec = lambda a: a[..., :3] * 2 - 1
sn = dec(skin_n)
def cloth_n(asset, k, keep, weave):
    fnm = dec(tiled(asset, 'NormalGL', k, True))
    xy = sn[..., :2] * keep + fnm[..., :2] * weave
    return np.concatenate([xy, np.sqrt(np.clip(1 - (xy ** 2).sum(-1, keepdims=True), 0.05, 1))], -1)
nrm = sn * m_skin[..., None]
for (asset, k, keep, weave), m_ in ((('Fabric036', 7, 0.35 * FIT ** 1.5, 0.6), m_shirt), (('Fabric069', 6, 0.12, 0.8), m_jeans), (('Leather030', 5, 0, 0.8), m_belt), (('Leather037', 4, 0, 0.9), m_boots)):
    nrm += cloth_n(asset, k, keep, weave) * m_[..., None]
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-6
nrm = dilate(nrm, inside)
BODY_N = np.concatenate([nrm * 0.5 + 0.5, np.ones_like(X)[..., None]], -1).astype(np.float32)
log('painted: shirt, jeans, belt, boots (colour + normals)')
if kw.get('DEBUG'):
    for nm_, arr in (('dbg_body_c', BODY_C), ('dbg_covered', np.dstack([covered.astype(np.float32)] * 3 + [np.ones_like(X)])), ('dbg_skin', skin_c)):
        im_ = bpy.data.images.new(nm_, TEX, TEX); im_.pixels = arr.ravel(); im_.filepath_raw = os.path.join(kw['DEBUG'], nm_ + '.png'); im_.file_format = 'PNG'; im_.save()

# (c) one atlas: the body 1024², the hair (beard, hair, brows share one texture) 512², the eyes 256²
AW, AH = 1536, 1024
REG = {'body': (0, 0, 1024, 1024), 'hair': (1024, 512, 512, 512), 'eyes': (1024, 256, 256, 256)}
hair_c = load_px(os.path.join(HAIR, 'T_Hair_1_BaseColor.png')); hair_c[..., :3] *= np.array(HAIR_TINT) / 0.35
hair_n = load_px(os.path.join(HAIR, 'T_Hair_1_Normal.png'), True)
eye_c = load_px(os.path.join(BASE, 'T_Eye_Brown.png')); eye_n = load_px(os.path.join(BASE, 'T_Eye_Normal.png'), True)
src = {'body': (BODY_C, BODY_N), 'hair': (hair_c, hair_n), 'eyes': (eye_c, eye_n)}
AC = np.zeros((AH, AW, 4), np.float32); AC[..., 3] = 1
AN = np.zeros((AH, AW, 4), np.float32); AN[..., :] = (0.5, 0.5, 1, 1)
for k_, (x0, y0, w, h) in REG.items():
    c_, n_ = src[k_]
    AC[y0:y0 + h, x0:x0 + w] = resize_px(c_, w, h); AN[y0:y0 + h, x0:x0 + w] = resize_px(n_, w, h)
AC[..., 3] = 1; AN[..., 3] = 1
AC[..., :3] = np.clip(AC[..., :3], 0, 1)
uvl = me.uv_layers['UVMap'].data
rng = {}
for p in me.polygons:
    kd = mi_kind[p.material_index]; x0, y0, w, h = REG[kd]
    for li in p.loop_indices:
        uu, vv = uvl[li].uv
        r = rng.setdefault(kd, [9, -9, 9, -9]); r[0] = min(r[0], uu); r[1] = max(r[1], uu); r[2] = min(r[2], vv); r[3] = max(r[3], vv)
        uvl[li].uv = ((x0 + min(max(uu, 0), 1) * w) / AW, (y0 + min(max(vv, 0), 1) * h) / AH)
if kw.get('DEBUG'):
    vuv = {}
    for p_ in me.polygons:
        for li, vi in zip(p_.loop_indices, p_.vertices): vuv[vi] = (uvl[li].uv[0], uvl[li].uv[1], mi_kind[p_.material_index])
    band = [i for i in range(NV) if on_body[i] and 0.035 < P[i][2] < 0.085 and P[i][0] < 0][:12]
    for i in band:
        uu, vv, kd = vuv.get(i, (0, 0, '?'))
        cx, cy = int(uu * AW), int(vv * AH)
        log(f'  dbg v{i} z {P[i][2]:.3f} lab {lab[i]} kind {kd} uv {uu:.3f},{vv:.3f} atlas {AC[min(cy, AH - 1), min(cx, AW - 1), :3].round(2)} offs {np.linalg.norm(Q2[i] - P[i]):.3f}')
log('UV ranges (before the atlas): ' + ', '.join(f'{k}: u {r[0]:.2f}…{r[1]:.2f} v {r[2]:.2f}…{r[3]:.2f}' for k, r in rng.items()))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
def save_webp(a, path, q):
    im = bpy.data.images.new(os.path.basename(path), AW, AH, alpha=False); im.pixels = a.ravel()
    sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.quality = q
    im.save_render(path, scene=sc); return im
OUT_C, OUT_N = OUT[:-4] + '.webp', OUT[:-4] + '_n.webp'
aimg = save_webp(AC, OUT_C, 90)
nimg = save_webp(AN, OUT_N, 92)
log(f'wrote {OUT_C} ({os.path.getsize(OUT_C) / 1e3:.0f} kB) and {OUT_N} ({os.path.getsize(OUT_N) / 1e3:.0f} kB), {AW}×{AH}')
# one material (the preview's; the game reads the UVs and the two textures)
for i in range(len(me.materials)): me.materials.pop(index=0)
mat = bpy.data.materials.new('character'); mat.use_nodes = True; t = mat.node_tree; b = t.nodes['Principled BSDF']
ti = t.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(OUT_C); t.links.new(ti.outputs['Color'], b.inputs['Base Color'])
tn2 = t.nodes.new('ShaderNodeTexImage'); tn2.image = bpy.data.images.load(OUT_N); tn2.image.colorspace_settings.name = 'Non-Color'
nm_ = t.nodes.new('ShaderNodeNormalMap'); t.links.new(tn2.outputs['Color'], nm_.inputs['Color']); t.links.new(nm_.outputs['Normal'], b.inputs['Normal'])
b.inputs['Roughness'].default_value = 0.75
me.materials.append(mat)

def look(prefix):
    sc.render.engine = next((e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]))
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'
    w_ = bpy.data.worlds.get('w') or bpy.data.worlds.new('w'); sc.world = w_; w_.use_nodes = True
    w_.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.66, 0.72, 1)
    if not bpy.data.objects.get('sun'):
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.2; sun.rotation_euler = (math.radians(55), 0, math.radians(200)); sc.collection.objects.link(sun)
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    sc.camera = cam; cam.data.type = 'ORTHO'
    for tag, ang, z_, s_, rx, ry in (('front', 0, 0.95, 2.1, 560, 1000), ('three', 35, 0.95, 2.1, 560, 1000), ('side', 90, 0.95, 2.1, 560, 1000), ('back', 180, 0.95, 2.1, 560, 1000), ('face', 15, 1.64, 0.45, 560, 560), ('boots', 20, 0.25, 0.7, 560, 560)):
        cam.data.ortho_scale = s_; sc.render.resolution_x, sc.render.resolution_y = rx, ry
        a = math.radians(ang); cam.location = Vector((6 * math.sin(a), 6 * math.cos(a), z_))
        cam.rotation_euler = (Vector((0, 0, z_)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{prefix}_{tag}.png'; bpy.ops.render.render(write_still=True)
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True); look(os.path.join(PREVIEW, 'dressed')); log('look rendered')
    if kw.get('FLAT'):
        # (a check: the colour alone, unlit — then lit without the normal map)
        t.links.new(ti.outputs['Color'], t.nodes.new('ShaderNodeEmission').inputs['Color'])
        em_ = [n for n in t.nodes if n.type == 'EMISSION'][0]; t.links.new(ti.outputs['Color'], em_.inputs['Color'])
        t.links.new(em_.outputs['Emission'], t.nodes['Material Output'].inputs['Surface']); look(os.path.join(PREVIEW, 'flat'))
        t.links.new(b.outputs['BSDF'], t.nodes['Material Output'].inputs['Surface'])
        for l_ in list(b.inputs['Normal'].links): t.links.remove(l_)
        look(os.path.join(PREVIEW, 'nonormal'))
if STAGE == 'look': sys.exit(0)

# ===================================================================================================== 4. skeleton + clips
crown = max(P[i][2] for i in range(NV) if on_body[i])
def jv(n): return J[n].copy()
SK = [('Hips', jv('pelvis'), jv('spine_01'), None), ('Spine', jv('spine_01'), jv('spine_02'), 'Hips'), ('Spine1', jv('spine_02'), jv('spine_03'), 'Spine'),
      ('Spine2', jv('spine_03'), jv('neck_01'), 'Spine1'), ('Neck', jv('neck_01'), jv('Head'), 'Spine2'),
      ('Head', jv('Head'), Vector((J['Head'].x, J['Head'].y, crown)), 'Neck')]
for s_, Side in (('l', 'Left'), ('r', 'Right')):
    hand, mid = jv(f'hand_{s_}'), jv(f'middle_01_{s_}')
    ball = jv(f'ball_{s_}'); toe = JTl[f'ball_{s_}'].copy()
    if (toe - ball).length < 0.03: toe = ball + Vector((0, 0.07, 0))
    SK += [(f'{Side}Shoulder', jv(f'clavicle_{s_}'), jv(f'upperarm_{s_}'), 'Spine2'), (f'{Side}Arm', jv(f'upperarm_{s_}'), jv(f'lowerarm_{s_}'), f'{Side}Shoulder'),
           (f'{Side}ForeArm', jv(f'lowerarm_{s_}'), hand, f'{Side}Arm'), (f'{Side}Hand', hand, hand + (mid - hand) * 1.8, f'{Side}ForeArm'),
           (f'{Side}UpLeg', jv(f'thigh_{s_}'), jv(f'calf_{s_}'), 'Hips'), (f'{Side}Leg', jv(f'calf_{s_}'), jv(f'foot_{s_}'), f'{Side}UpLeg'),
           (f'{Side}Foot', jv(f'foot_{s_}'), ball, f'{Side}Leg'), (f'{Side}ToeBase', ball, toe, f'{Side}Foot')]
NAMES = [n for n, *_ in SK]
arm = bpy.data.armatures.new('skeleton'); rig = bpy.data.objects.new('skeleton', arm); sc.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for n, h, t_, par in SK:
    eb = arm.edit_bones.new(PFX + n); eb.head = h; eb.tail = t_
    eb.align_roll(Vector((0, 1, 0)) if abs((eb.tail - eb.head).normalized().y) < 0.9 else Vector((0, 0, 1)))
    if par: eb.parent = arm.edit_bones[PFX + par]; eb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
def target(b):
    one = {'root': 'Hips', 'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2', 'neck_01': 'Neck', 'Head': 'Head'}
    if b in one: return one[b]
    s_ = b[-1]; Side = 'Left' if s_ == 'l' else 'Right'; part = b[:-2]
    if part.startswith(('index', 'middle', 'pinky', 'ring', 'thumb')) or part == 'hand': return Side + 'Hand'
    return Side + {'clavicle': 'Shoulder', 'upperarm': 'Arm', 'lowerarm': 'ForeArm', 'thigh': 'UpLeg', 'calf': 'Leg', 'foot': 'Foot', 'ball': 'ToeBase', 'ball_leaf': 'ToeBase'}[part]
old = list(body.vertex_groups)
Wt = np.zeros((NV, len(SK)), np.float32)
gi_ = {g_.index: NAMES.index(target(g_.name)) for g_ in old}
for v in me.vertices:
    for gg in v.groups:
        if gg.group in gi_: Wt[v.index, gi_[gg.group]] += gg.weight
for g_ in old: body.vertex_groups.remove(g_)
grp = [body.vertex_groups.new(name=PFX + n) for n in NAMES]
sw = Wt.sum(1); log(f'weights: {int((sw < 1e-4).sum())} vertices unweighted')
for k, g_ in enumerate(grp):
    for i in np.nonzero(Wt[:, k] > 1e-4)[0]: g_.add([int(i)], float(Wt[i, k] / max(sw[i], 1e-6)), 'REPLACE')
body.parent = rig
mod = body.modifiers.new('skeleton', 'ARMATURE'); mod.object = rig

def world_rot(obj, pb): return (obj.matrix_world @ pb.matrix).to_quaternion()
def rest_world(obj, bone): return (obj.matrix_world @ bone.matrix_local).to_quaternion()
ORDER = [PFX + n for n in NAMES]
leg_ours = (J['thigh_r'] - J['calf_r']).length + (J['calf_r'] - J['foot_r']).length
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
    f0, f1 = (int(round(v_)) for v_ in srcA.animation_data.action.frame_range)
    srcA.rotation_euler.z += math.pi
    bpy.context.view_layer.update()
    sb = {b_.name: b_ for b_ in srcA.data.bones}
    def wpos(obj, bone): return obj.matrix_world @ bone.head_local
    leg_src = (wpos(srcA, sb[PFX + 'RightUpLeg']) - wpos(srcA, sb[PFX + 'RightLeg'])).length + (wpos(srcA, sb[PFX + 'RightLeg']) - wpos(srcA, sb[PFX + 'RightFoot'])).length
    k_leg = leg_ours / max(1e-6, leg_src)
    src_rest = {n: rest_world(srcA, sb[n]) for n in ORDER if n in sb}
    def axis(obj, bone): return (obj.matrix_world.to_3x3() @ bone.matrix_local.to_3x3()).col[1].normalized()
    tgt_rest = {}
    for n in ORDER:
        q = rest_world(rig, rig.data.bones[n])
        if n in sb: q = axis(rig, rig.data.bones[n]).rotation_difference(axis(srcA, sb[n])) @ q
        # THE SHOULDERS LOWERED (2026-11-09, the user: "his shoulders always look a bit lifted — if it's 10, make it 8"):
        # each clavicle points as Mixamo's does, tipped down SHOULDER_DROP° (about the body's front axis) — the
        # shoulder joint ~2 cm lower in every clip, the arm's own motion unchanged
        if n.endswith('Shoulder'):
            sgn = 1 if n.endswith('RightShoulder') else -1
            q = Quaternion((0, 0, 1), -sgn * math.radians(SHOULDER_BACK)) @ Quaternion((0, 1, 0), sgn * math.radians(SHOULDER_DROP)) @ q
        tgt_rest[n] = q
    hips_src0 = wpos(srcA, sb[PFX + 'Hips']); hips_tgt0 = rig.matrix_world @ rig.data.bones[PFX + 'Hips'].head_local
    out_a = bpy.data.actions.new(name); rig.animation_data.action = out_a
    LOOP = name in ('idle', 'walk', 'run', 'sprint', 'fall', 'grab_ledge', 'sit_drive', 'carry')
    hips_path = []
    for fr in range(f0, f1 + 1):
        sc.frame_set(fr); hips_path.append((srcA.matrix_world @ srcA.pose.bones[PFX + 'Hips'].head).copy())
    travel = hips_path[-1] - hips_path[0]; travel.z = 0
    dur = max(1, f1 - f0) / 30
    CLIPINFO[name] = {'loop': LOOP, 'speed': round(travel.length * k_leg / dur, 3) if LOOP else 0, 'frames': f1 - f0 + 1}
    for fr in range(f0, f1 + 1):
        sc.frame_set(fr)
        for n in ORDER:
            pb = rig.pose.bones[n]
            wq = world_rot(srcA, srcA.pose.bones[n]) @ src_rest[n].inverted() @ tgt_rest[n] if n in src_rest else tgt_rest[n]
            m4 = (rig.matrix_world.inverted().to_quaternion() @ wq).to_matrix().to_4x4()
            if n == PFX + 'Hips':
                hp = hips_path[fr - f0].copy()
                if LOOP: hp -= travel * ((fr - f0) / max(1, f1 - f0))
                m4.translation = rig.matrix_world.inverted() @ (hips_tgt0 + (hp - hips_src0) * k_leg)
            else:
                m4.translation = pb.matrix.translation
            pb.matrix = m4
            bpy.context.view_layer.update()
            pb.keyframe_insert('rotation_quaternion', frame=fr - f0)
            if n == PFX + 'Hips': pb.keyframe_insert('location', frame=fr - f0)
    rig.animation_data.action = None
    trk = rig.animation_data.nla_tracks.new(); trk.name = name; trk.strips.new(name, 0, out_a)
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
    sc.render.engine = next((e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]))
    cam = bpy.data.objects['cam']; cam.data.ortho_scale = 2.2; sc.render.resolution_x, sc.render.resolution_y = 560, 1000
    for name, tt in (('idle', 0.3), ('walk', 0.25), ('run', 0.3), ('jump', 0.45), ('sit_drive', 0.5), ('pickup', 0.5), ('chop', 0.3), ('chop', 0.55), ('mine', 0.3), ('mine', 0.55), ('carry', 0.5)):
        a = bpy.data.actions.get(name)
        if not a: continue
        rig.animation_data.action = a; f0, f1 = a.frame_range; sc.frame_set(int(f0 + (f1 - f0) * tt))
        an = math.radians(50); cam.location = Vector((6 * math.sin(an), 6 * math.cos(an), 0.95))
        cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'clip_{name}_{int(tt * 100)}.png'); bpy.ops.render.render(write_still=True)
    log('clip frames rendered')
