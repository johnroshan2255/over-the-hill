# OVERHILL — THE HERO (2026-11-09, the user: "a guy who has a good jaw line and perfect body … make sure he wears pants
# and a shirt … even with shirt and pants his body must show — his build, the aesthetic body"). Quaternius's Universal
# Base Characters, the Superhero male (CC0: quaternius.com — the free "Standard" pack), with the pack's beard, the
# "SimpleParted" hair and its eyebrows; DRESSED HERE, on his own body. Since 2026-11-11 (the user: "add a shirt and
# cargo-like pants, not leggings … make him like a perfect guy") on a man's frame (the legs in under narrower hips, the
# waist, the neck: 1b) in clothes that are CUT, not his skin pushed out (2): a brown leather jacket worn open over a
# T-shirt (the user, later that day: "change the shirt to something like a jacket … a cargo and a suitable jacket"),
# cargo trousers that fall straight to a hem over the boot, a belt, work boots on a last with an outsole.
# The cloth is ambientCG's (CC0) scans, box-projected and baked into his own UVs.
#
#   blender -b --factory-startup --python scripts/oth/hero.py -- [OUT=src/assets/models/human/character.glb]
#           [CLIPS=scripts/oth/.cache/mixamo] [PREVIEW=<dir>] [STAGE=look|all]
#
#   1. assemble: the body, eyes, eyebrows, beard and hair joined into one mesh on the body's skeleton; turned to face
#      the game's −z (Blender +y), in metres;
#   2. dress: each skin vertex labelled skin / top (the T-shirt, the jacket over it) / trousers / belt / boots by its
#      place on his rest pose; the jacket's edges cut into the mesh; the cloth shaped, the boots put on a last;
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
SHOULDER_DROP = float(kw.get('SHOULDER_DROP', '6'))   # (2026-11-11: 9 → 6 — with the arms brought in, 9° sloped his shoulders off the neck: a bottle's)
SHOULDER_BACK = float(kw.get('SHOULDER_BACK', '15'))   # (degrees: the clavicles turned back — the shoulder on the ear's line)
def log(*a, end='\n'): print(*((('[hero]',) if log.nl else ()) + a), flush=True, end=end); log.nl = end == '\n'
log.nl = True

# the look
HAIR_TINT = (0.20, 0.12, 0.07)              # dark brown (the pack's hair is grey, tinted by its shader in the paid version)

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
# (2026-11-11, the user: "his body structure … make him like a perfect guy": the arms and the neck had been eased as far
#  as the shoulders' caps and read thin on him — upper arm 0.42 → 0.30, forearm 0.30 → 0.16, neck 0.30 → 0.10, the chest
#  and lats 0.30 → 0.22; the shoulders' caps as the user set them)
R_OF = {'upperarm': 0.30, 'lowerarm': 0.16, 'clavicle': 0.45, 'spine_03': 0.22, 'spine_02': 0.22, 'spine_01': 0.12, 'pelvis': 0.06,
        'neck_01': 0.10, 'thigh': 0.18, 'calf': 0.12}
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
# A MAN'S FRAME (2026-11-11, the user: "his body structure all looks gay … make him like a perfect guy"). Measured
# (anatomy_check.py, .claude/skills/human-anatomy): the pack's hip joints are 23 cm apart (a man's 17–20) and its thighs
# 39 cm across at their top — WIDER than his chest (33) — over a waist pinched to 26: an hourglass. So:
#   LEGS IN   each leg (its bones and every vertex by its leg weights) LEG_DX toward the centre line: the hip joints
#             ±0.095; the inner thighs kept on their own side (they're under the trousers);
#   WAIST     WAIST_W wider, WAIST_D deeper about the torso's axis, a bell on its narrowest (hero_fit.py did this on
#             the dressed mesh: done here, so the shirt is cut on the body it covers).
LEG_DX = float(kw.get('LEG_DX', '0.019'))
WAIST_W, WAIST_D = float(kw.get('WAIST_W', '0.20')), float(kw.get('WAIST_D', '0.20'))
LEG_BONES = ('thigh', 'calf', 'foot', 'ball')
def is_leg(b): return b.startswith(LEG_BONES)
Pm = np.array([v.co[:] for v in me.vertices])
cm_ = (np.abs(Pm[:, 0]) < 0.012) & (Pm[:, 2] > 0.5) & (Pm[:, 2] < J['thigh_l'].z)
Z_CROTCH = float(Pm[cm_, 2].min())                        # (before the legs move in: the lowest of him on the centre line)
for i, w in enumerate(Wv):
    if not w: continue
    tot = sum(w.values())
    wl = sum(wt for b, wt in w.items() if is_leg(b) and b.endswith('_l')) / tot; wr_ = sum(wt for b, wt in w.items() if is_leg(b) and b.endswith('_r')) / tot
    if wl + wr_ <= 0: continue
    Pm[i][0] += LEG_DX * (wl - wr_)                       # (left is −x: its leg moves toward +x)
    sg = -1 if wl > wr_ else 1
    if max(wl, wr_) > 0.5 and sg * Pm[i][0] < 0.004: Pm[i][0] = sg * 0.004
for b in list(J):
    if is_leg(b):
        d_ = Vector((LEG_DX if b.endswith('_l') else -LEG_DX, 0, 0)); J[b] = J[b] + d_; JTl[b] = JTl[b] + d_
armw_ = np.array([sum(wt for b, wt in w.items() if is_arm(b)) / max(sum(w.values()), 1e-9) if w else 0.0 for w in Wv])
zw = J['spine_02'].z - 0.005
mw = (armw_ < 0.05) & (np.abs(Pm[:, 2] - zw) < 0.012)
ycw = float((Pm[mw, 1].max() + Pm[mw, 1].min()) / 2)
gw = np.exp(-0.5 * ((Pm[:, 2] - zw) / 0.06) ** 2) * (armw_ < 0.05)
log(f'frame: waist {np.ptp(Pm[mw, 0]):.3f} × {np.ptp(Pm[mw, 1]):.3f} m', end=' ')
Pm[:, 0] *= 1 + WAIST_W * gw
Pm[:, 1] = ycw + (Pm[:, 1] - ycw) * (1 + WAIST_D * gw)
log(f'→ {np.ptp(Pm[mw, 0]):.3f} × {np.ptp(Pm[mw, 1]):.3f}; hip joints ±{abs(J["thigh_l"].x):.3f} m; the crotch at {Z_CROTCH:.3f}')
#   NECK      NECK_K thicker about its own axis (by the neck's weights): 11 cm across under a 17 cm head read as a stalk
NECK_K = float(kw.get('NECK_K', '0.14'))
nw_ = np.array([w.get('neck_01', 0) / max(sum(w.values()), 1e-9) if w else 0.0 for w in Wv])
na, nb = np.array(J['neck_01'][:]), np.array(J['Head'][:])
for i in np.nonzero(nw_ > 0.01)[0]:
    c_ = closest(Pm[i], (na, nb)); d_ = Pm[i] - c_; d_[2] = 0
    Pm[i] += d_ * NECK_K * nw_[i]
me.vertices.foreach_set('co', Pm.ravel().astype(np.float32)); me.update()

# ===================================================================================================== 2. dress
# THE WARDROBE (2026-11-11, the user: "add a shirt and cargo-like pants, not leggings"): the first one — a T-shirt and
# jeans, his skin pushed out a few millimetres — followed every muscle of his legs and seat, stopped 9 cm over the boot
# and stood on slippers. Now the garments are CUT, not offset:
#   THE JACKET    a flight jacket's cut in brown leather, worn open over a crew-neck T-shirt (the first top was a field
#                 shirt, then a check one): a collar, a zip down each front, two flapped pockets, straps on the shoulders;
#                 it hangs from the chest and the lats (it can't draw in to the waist faster than leather falls) to a knit
#                 waistband over the belt; its sleeves are tubes wider than the arm, gathered into knit cuffs at the
#                 wrists. Where it ends on something else its edge is CUT into the mesh (two rings 3 mm apart: a wall as
#                 thick as the leather); the T-shirt in its opening lies on him, tucked in;
#   THE TROUSERS  cargo trousers: from the crotch down each leg is a straight TUBE about the leg (its section scaled to
#                 the cut's width and depth at each height — thigh, knee, hem — not the leg's own), a bellows pocket with
#                 a flap on the outside of each thigh, the hem over the boot's shaft;
#   THE BOOTS     work boots: the foot narrowed to a boot's last, a round toe box raised over the toes, a flat sole.
# The garments' edges are planes on his rest pose (the T-pose; arms along x) — the same rules shape the cloth and paint it.
mi_kind = []
for m in me.materials:
    n = m.name.lower()
    mi_kind.append('body' if 'superhero' in n else 'eyes' if 'eye' in n else 'hair')
sh, el = abs(J['upperarm_l'].x), abs(J['lowerarm_l'].x)
wr_x = abs(J['hand_l'].x)
X_SLEEVE = wr_x - 0.014                                   # the jacket's sleeves end at the wrist…
CUFF = 0.050                                              # …in a knit cuff this wide
Z_HIP = (J['thigh_l'].z + J['thigh_r'].z) / 2
Z_WAIST = Z_HIP + 0.115
Z_BELT = Z_WAIST - 0.042
Z_ANKLE = (J['foot_l'].z + J['foot_r'].z) / 2
Z_KNEE = (J['calf_l'].z + J['calf_r'].z) / 2
Z_HEM = Z_ANKLE + 0.045                                    # (rest) the trousers end here — their hem is then let down over the boot
Z_SOLE = 0.028
Y_MID = (J['thigh_l'].y + J['thigh_r'].y) / 2              # the plane through the hip joints: his front is +y of it
NECK = J['neck_01']
Z_JHEM = Z_BELT - 0.030                                    # the jacket's hem (rest): over the belt, on the hips…
BAND = 0.055                                               # …a knit waistband this high
Z_CREW = NECK.z - 0.050                                    # the T-shirt's crew neck comes down to here
R_NECK = 0.070                                             # the collar's ring: the neck's column inside it is skin
def ramp(a, w=0.0015): return np.clip(0.5 + a / w, 0, 1)
X_OPEN = 0.052                                             # the jacket hangs open: its fronts this far from his middle…
def open_w(z): return np.interp(z, [NECK.z - 0.10, NECK.z - 0.035], [X_OPEN, 0.074])   # …opening out to the collar (the opening's half-width at a height)
def z_crew(x): return Z_CREW + 0.021 * np.clip(np.abs(x) / 0.066, 0, 1.4) ** 2      # the crew neck's edge: a round scoop
def z_collar(y): return NECK.z + 0.016 - 0.045 * np.clip((y - NECK.y) / 0.06, 0, 1)   # the collar's stand: up the neck at the back
def z_ring(x, y):
    """the collar's top edge: z_collar on the neck's column, rising 1.5 : 1 outward of it — a cone: it crosses the neck's
    flare into the back and the traps squarely (a cylinder's wall grazed it: a ragged edge)"""
    return z_collar(y) + 1.5 * np.maximum(np.sqrt((x - NECK.x) ** 2 + (y - NECK.y) ** 2) - R_NECK, 0)
def d_ring(x, y, z): return np.maximum(z_ring(x, y) - z, 0) / 1.6     # ~metres along him from that edge
def tee_w(x, y, z, pad=0.0):
    """1 in the jacket's opening (the T-shirt shows; under it the belt and the trousers), 0 on the jacket"""
    return ramp(open_w(z) - pad - np.abs(x)) * ramp(y - np.interp(z, [NECK.z - 0.10, NECK.z - 0.04], [Y_MID, NECK.y + 0.035]), 0.004)
def neck_skin(x, y, z):
    rho = np.sqrt((x - NECK.x) ** 2 + (y - NECK.y) ** 2)
    ring = ramp(z - z_ring(x, y)) * ramp(0.13 - rho, 0.004)
    crew = ramp(z - z_crew(x)) * ramp(0.072 - np.abs(x)) * ramp(y - (NECK.y + 0.04), 0.004) * ramp(NECK.z + 0.03 - z)
    return np.maximum(np.maximum(ring, crew), ramp(z - (NECK.z + 0.07), 0.01))
def masks(x, y, z, pad=0.0):
    """(pad: the jacket's edges this much further out — the paint's, so the walls cut into the mesh at them are leather)"""
    skin = np.maximum(neck_skin(x, y, z), ramp(np.abs(x) - X_SLEEVE - pad) * ramp(z - Z_WAIST + 0.05, 0.01))
    tee = tee_w(x, y, z, pad)
    shirt = (1 - skin) * ramp(z - (Z_JHEM - pad + (Z_WAIST - Z_JHEM + pad) * tee))   # (the top: the T-shirt tucked in at the waist, the jacket to its hem)
    rest = 1 - skin - shirt
    belt = rest * ramp(z - Z_BELT)
    rest2 = rest - belt
    pants = rest2 * ramp(z - Z_HEM)
    boots = rest2 - pants
    return skin, shirt, pants, belt, boots
SKIN, SHIRT_I, JEANS_I, BELT_I, BOOTS_I = range(5)         # (SHIRT_I: the top — the T-shirt and the jacket over it; JEANS_I: the cargo trousers)
# THE JACKET'S EDGES ARE CUT INTO THE MESH: where it ends on something else — its hem on the trousers, its two fronts on
# the T-shirt, its cuffs on the wrists — the body's skin gets two rings of vertices 3 mm apart, exactly on the edge (a
# plane each: the mesh's own rings slope across them, and a garment's edge that follows those is ragged). The ring on the
# jacket's side goes out with the leather, the other stays under it: a wall as thick as the jacket, not a slope across a
# whole quad. ~240 vertices.
EDGE = 0.0015
bm = bmesh.new(); bm.from_mesh(me)
dl_ = bm.verts.layers.deform.verify()
g_arm = {g_.index for g_ in body.vertex_groups if is_arm(g_.name)}
def arm_share(v):
    d_ = v[dl_]; t_ = sum(d_.values())
    return sum(w_ for g_, w_ in d_.items() if g_ in g_arm) / t_ if t_ else 0.0
def cut(co, no, pick):
    fs = [f for f in bm.faces if mi_kind[f.material_index] == 'body' and pick(f, f.calc_center_median())]
    geom = list({v for f in fs for v in f.verts}) + list({e for f in fs for e in f.edges}) + fs
    r_ = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no, clear_inner=False, clear_outer=False)
    return sum(isinstance(g_, bmesh.types.BMVert) for g_ in r_['geom_cut'])
n_cut = 0
for dz_ in (-EDGE, EDGE):                                  # the hem, round the trunk
    n_cut += cut((0, 0, Z_JHEM + dz_), (0, 0, 1), lambda f, c: abs(c.z - Z_JHEM) < 0.08 and all(arm_share(v) < 0.05 for v in f.verts))
for sg in (-1, 1):
    for dx_ in (-EDGE, EDGE):
        n_cut += cut((sg * (X_OPEN + dx_), 0, 0), (1, 0, 0), lambda f, c: c.y > Y_MID + 0.02 and Z_JHEM < c.z < NECK.z - 0.10 and abs(c.x) < 0.12)   # a front
        n_cut += cut((sg * (X_SLEEVE + dx_), 0, 0), (1, 0, 0), lambda f, c: abs(abs(c.x) - X_SLEEVE) < 0.04 and c.x * sg > 0 and c.z > Z_WAIST)      # a cuff
bm.to_mesh(me); bm.free(); me.update()
Wv = [_wmap(v, gn0) for v in me.vertices]
log(f'the jacket\'s edges cut in: {n_cut} vertices')
NV = len(me.vertices)
P = np.array([v.co[:] for v in me.vertices])
Nn = np.array([v.normal[:] for v in me.vertices])
on_body = np.zeros(NV, bool)
for p in me.polygons:
    if mi_kind[p.material_index] == 'body':
        for vi in p.vertices: on_body[vi] = True
def wsum(pred): return np.array([sum(wt for b, wt in w.items() if pred(b)) / max(sum(w.values()), 1e-9) if w else 0.0 for w in Wv])
armw = wsum(is_arm); uaw = wsum(lambda b: b.startswith('upperarm'))
# THE FIT (2026-11-09, the user: "too much muscle showing — now it's 100 %, make it 60 %, a bit relaxed"): how much of his
# build the shirt shows, 1 skin-tight … 0 loose. It sets the shirt's ease, how hard its grooves are smoothed and how
# much of his muscles' normal map is kept under it.
FIT = float(kw.get('FIT', '0.5'))
LOOSE = 1 - FIT
M = np.stack(masks(P[:, 0], P[:, 1], P[:, 2]), 1)
lab = np.where(on_body, M.argmax(1), -1).astype(np.int8)
log('labels: ' + ', '.join(f'{n} {int((lab == k).sum())}' for k, n in enumerate(('skin', 'top', 'trousers', 'belt', 'boots'))))
me.attributes.new('rest', 'FLOAT_VECTOR', 'POINT').data.foreach_set('vector', P.ravel().astype(np.float32))

x, y, z = P[:, 0], P[:, 1], P[:, 2]
g = lambda d, w: np.exp(-(np.maximum(d, 0) / w) ** 2)
def sstep(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
def profile(zv, val, z0, z1, n, how, win=0.045):
    """val's `how` (max / min) at n heights, each over the vertices within ±win of it (the mesh's rings are up to 7 cm
    apart and not level: a thin slice sees half a ring), the empty ones filled, smoothed → (heights, values)"""
    zc_ = z0 + (np.arange(n) + 0.5) * (z1 - z0) / n; out = np.full(n, np.nan)
    for k in range(n):
        m_ = np.abs(zv - zc_[k]) < win
        if m_.sum() >= 4: out[k] = how(val[m_])
    ii = np.arange(n); ok = ~np.isnan(out); out = np.interp(ii, ii[ok], out[ok])
    ker = np.array([1, 2, 3, 2, 1.]); ker /= ker.sum(); out = np.convolve(np.pad(out, 2, mode='edge'), ker, mode='valid')
    return zc_, out

# (1) the cloth off the skin
OFF = np.array([0.0, 0.004, 0.013, 0.015, 0.011])          # (the top's: the T-shirt's; the jacket's below)
off = np.where(lab >= 0, OFF[np.maximum(lab, 0)], 0.0)
jk_v = np.where(lab == SHIRT_I, 1 - tee_w(x, y, z), 0.0)   # on the jacket (1) / on the T-shirt in its opening (0)
is_jk = jk_v > 0.5
off += jk_v * (0.011 + 0.011 * sstep((Z_WAIST + 0.04 - z) / 0.06))   # leather, lined: 15 mm off him, 26 over the belt and the trousers' top
rho_c = np.sqrt((x - NECK.x) ** 2 + (y - NECK.y) ** 2)
near_neck = 0.12 + 0.88 * sstep(d_ring(x, y, z) / 0.04)
off *= np.where(jk_v > 0, near_neck, 1)                   # (the collar lies ON the neck's base: no step in the mesh there — its edge is the relief's)
rho_n = np.sqrt((x - NECK.x) ** 2 + (y - NECK.y) ** 2)
Q2 = P + Nn * off[:, None]
# (2) THE SHIRT hangs: its half-width, its front and its back at each height from the armpit down may not come in faster
# than cloth falls from what's above (the lats, the chest, the shoulder blades) — the body under it tapers to the waist
Z_PIT = J['upperarm_l'].z - 0.075
tm = (lab == SHIRT_I) & (armw < 0.05) & (z < Z_PIT + 0.02)
zb, hw_ = profile(z[tm], np.abs(Q2[tm, 0]), Z_JHEM, Z_PIT + 0.02, 26, np.max)
_, yf_ = profile(z[tm], Q2[tm, 1], Z_JHEM, Z_PIT + 0.02, 26, np.max)
_, yb_ = profile(z[tm], Q2[tm, 1], Z_JHEM, Z_PIT + 0.02, 26, np.min)
A_, F_, B_ = hw_.copy(), yf_.copy(), yb_.copy()
for k in range(len(zb) - 2, -1, -1):
    dz = zb[k + 1] - zb[k]
    A_[k] = max(A_[k], A_[k + 1] - 0.10 * dz); F_[k] = max(F_[k], F_[k + 1] - 0.16 * dz); B_[k] = min(B_[k], B_[k + 1] + 0.08 * dz)
log(f'jacket: at the hem {2 * hw_[0]:.3f} × {yf_[0] - yb_[0]:.3f} m → {2 * A_[0]:.3f} × {F_[0] - B_[0]:.3f}; at the chest {2 * hw_[-4]:.3f} × {yf_[-4] - yb_[-4]:.3f}')
ts = np.nonzero((lab == SHIRT_I) & (z < Z_PIT + 0.02))[0]
zi = z[ts]; a_t, f_t, b_t = np.interp(zi, zb, A_), np.interp(zi, zb, F_), np.interp(zi, zb, B_)
a_b, f_b, b_b = np.interp(zi, zb, hw_), np.interp(zi, zb, yf_), np.interp(zi, zb, yb_)
gather = 1 - 0.035 * sstep((Z_JHEM + BAND + 0.015 - zi) / 0.03)       # (the waistband draws the hem in a little: the body blouses over it)
yc_ = (f_b + b_b) / 2; a_t *= gather; f_t = yc_ + (f_t - yc_) * gather; b_t = yc_ + (b_t - yc_) * gather
tw_ = (1 - np.clip(armw[ts] / 0.3, 0, 1)) * sstep((Z_PIT + 0.02 - zi) / 0.04) * jk_v[ts]   # (the jacket hangs; the T-shirt in its opening lies on him)
Q2[ts, 0] += (Q2[ts, 0] * (a_t / a_b) - Q2[ts, 0]) * tw_
dy_ = Q2[ts, 1] - yc_
Q2[ts, 1] += (yc_ + dy_ * np.where(dy_ > 0, (f_t - yc_) / (f_b - yc_), (b_t - yc_) / (b_b - yc_)) - Q2[ts, 1]) * tw_
# …and its SLEEVES are tubes about the arm's line (shoulder → elbow → wrist): each section R_SLEEVE(x) round, keeping
# SLEEVE_RELIEF of the arm's own shape (the biceps, the forearm) — cloth, not skin; the roll at the end proud of it
SLEEVE_X = [sh + 0.03, sh + 0.11, el - 0.03, el + 0.03, X_SLEEVE - CUFF - 0.04, X_SLEEVE - CUFF - 0.004, X_SLEEVE - CUFF + 0.008, X_SLEEVE]
SLEEVE_R = [0.068, 0.069, 0.066, 0.063, 0.057, 0.053, 0.041, 0.040]   # (a leather sleeve: full to the wrist, gathered into the cuff)
SLEEVE_RELIEF = 0.3
YC_TORSO = float(np.mean((yf_ + yb_) / 2))
def arm_axis(ax_, sd):
    """the arm's line at a distance out along it (rest, the T-pose) → y, z"""
    js = [J[f'upperarm_{sd}'], J[f'lowerarm_{sd}'], J[f'hand_{sd}']]
    return np.interp(ax_, [abs(j.x) for j in js], [j.y for j in js]), np.interp(ax_, [abs(j.x) for j in js], [j.z for j in js])
for sd, sg in (('l', -1), ('r', 1)):
    sv = np.nonzero((lab == SHIRT_I) & (np.sign(x) == sg) & (armw > 0.05) & (np.abs(x) > sh))[0]
    ax_ = np.abs(x[sv]); ya, za = arm_axis(ax_, sd)
    d_ = Q2[sv][:, 1:] - np.stack([ya, za], 1); r_ = np.linalg.norm(d_, axis=1)
    xs_, rm_ = profile(ax_, r_, sh, X_SLEEVE + 0.02, 30, np.mean, 0.03)
    r_new = np.interp(ax_, SLEEVE_X, SLEEVE_R) * (r_ / np.maximum(np.interp(ax_, xs_, rm_), 1e-4)) ** SLEEVE_RELIEF
    k_ = np.clip(armw[sv] / 0.6, 0, 1) * sstep((ax_ - (sh + 0.005)) / 0.07)
    Q2[sv, 1:] = np.stack([ya, za], 1) + d_ * ((r_ + (r_new - r_) * k_) / np.maximum(r_, 1e-6))[:, None]
    log(f'sleeve ({sd}): the arm {2 * np.interp(sh + 0.14, xs_, rm_):.3f} / {2 * np.interp(el, xs_, rm_):.3f} / {2 * np.interp(X_SLEEVE - 0.03, xs_, rm_):.3f} m thick (biceps / elbow / forearm) → the sleeve {2 * SLEEVE_R[1]:.3f} / {2 * SLEEVE_R[3]:.3f} / {2 * SLEEVE_R[4]:.3f}; the wrist {2 * np.interp(X_SLEEVE - 0.01, xs_, rm_):.3f} → the cuff {2 * SLEEVE_R[-1]:.3f}')
# (3) THE TROUSERS: each leg a tube from the crotch down. At each height the leg's own section (its box: the middle,
# half-width, half-depth) is scaled to the CUT's — a(z) across, b(z) deep: relaxed at the thigh, straight from the knee
# to the hem — about a centre line that keeps the legs apart at the inseam and falls straight, not round the calf
CUT_Z = [Z_HEM - 0.03, Z_KNEE - 0.16, Z_KNEE, Z_CROTCH + 0.01]
CUT_A = [0.074, 0.074, 0.078, 0.090]
CUT_B = [0.082, 0.082, 0.086, 0.106]
LEGC = {}                                                  # side → (heights, the REST leg's centre x (outward +), y, half-width, half-depth)
for sd, sg in (('l', -1), ('r', 1)):
    lv = np.nonzero(on_body & (np.sign(x) == sg) & (z < Z_CROTCH + 0.10) & (z > Z_HEM - 0.05) & (armw < 0.05))[0]
    z0, z1 = Z_HEM - 0.05, Z_CROTCH + 0.10
    zl, x0_ = profile(z[lv], sg * P[lv, 0], z0, z1, 40, np.min); _, x1_ = profile(z[lv], sg * P[lv, 0], z0, z1, 40, np.max)
    _, y0_ = profile(z[lv], P[lv, 1], z0, z1, 40, np.min); _, y1_ = profile(z[lv], P[lv, 1], z0, z1, 40, np.max)
    LEGC[sd] = (zl, (x0_ + x1_) / 2, (y0_ + y1_) / 2, (x1_ - x0_) / 2, (y1_ - y0_) / 2)
    pv = np.nonzero((lab == JEANS_I) & (np.sign(x) == sg) & (z < Z_CROTCH + 0.09))[0]
    zi = z[pv]
    zq, qx0 = profile(zi, sg * Q2[pv, 0], z0, z1, 40, np.min); _, qx1 = profile(zi, sg * Q2[pv, 0], z0, z1, 40, np.max)
    _, qy0 = profile(zi, Q2[pv, 1], z0, z1, 40, np.min); _, qy1 = profile(zi, Q2[pv, 1], z0, z1, 40, np.max)
    cx, cy, rx, ry = (np.interp(zi, zq, v_) for v_ in ((qx0 + qx1) / 2, (qy0 + qy1) / 2, (qx1 - qx0) / 2, (qy1 - qy0) / 2))
    a_t, b_t = np.interp(zi, CUT_Z, CUT_A), np.interp(zi, CUT_Z, CUT_B)
    cy_top, cy_bot = float(np.interp(Z_CROTCH, zq, (qy0 + qy1) / 2)), float(np.interp(Z_HEM, zq, (qy0 + qy1) / 2))
    cy_line = cy_bot + (cy_top - cy_bot) * np.clip((zi - Z_HEM) / (Z_CROTCH - Z_HEM), 0, 1)
    cx_t = np.maximum(cx, a_t + 0.006); cy_t = 0.35 * cy + 0.65 * cy_line
    t_ = sstep((Z_CROTCH + 0.07 - zi) / 0.07)
    Q2[pv, 0] += (sg * (cx_t + (sg * Q2[pv, 0] - cx) * a_t / np.maximum(rx, 1e-4)) - Q2[pv, 0]) * t_
    Q2[pv, 1] += (cy_t + (Q2[pv, 1] - cy) * b_t / np.maximum(ry, 1e-4) - Q2[pv, 1]) * t_
    log(f'trousers ({sd}): the leg {2 * np.interp(Z_CROTCH - 0.02, zq, (qx1 - qx0) / 2):.3f} / {2 * np.interp(Z_KNEE, zq, (qx1 - qx0) / 2):.3f} / {2 * np.interp(Z_KNEE - 0.12, zq, (qx1 - qx0) / 2):.3f} / {2 * np.interp(Z_HEM + 0.03, zq, (qx1 - qx0) / 2):.3f} m across (thigh / knee / calf / ankle) → the cut {2 * CUT_A[3]:.3f} / {2 * CUT_A[2]:.3f} / {2 * CUT_A[1]:.3f} / {2 * CUT_A[0]:.3f}')
# (4) softened: the cloth doesn't keep his muscles' grooves (Taubin: a shrink step then an inflate step — nothing shrinks)
nbr = [[] for _ in range(NV)]
for e in me.edges:
    a, b = e.vertices; nbr[a].append(b); nbr[b].append(a)
cloth = lab > 0
edge = np.array([cloth[i] and any(lab[j] != lab[i] or is_jk[j] != is_jk[i] for j in nbr[i]) for i in range(NV)])   # (the garments' edges — the jacket's fronts on the T-shirt too — are held)
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
    soft[i] = min(0.95, (0.55 if d in ('spine_01', 'pelvis') else 0.35 if d == 'spine_02' else 0.15 if d in ('spine_03', 'clavicle_l', 'clavicle_r', 'neck_01') else 0.10) + 0.75 * (0.85 if is_jk[i] else LOOSE)) if l == SHIRT_I \
        else 0.6 if l == JEANS_I else 0.5 if l == BOOTS_I else 0.3
# (the jacket's cut edges — and the T-shirt's ring under its fronts — are eased WITH their own side of the cloth, not held:
#  held, each stayed where its normal put it while the leather beside it settled — a zip and a row of stitching drawn
#  along the edge came out a zigzag)
cls = lab.astype(int) * 2 + is_jk
nbr_s = [[j for j in nbr[i] if cls[j] == cls[i]] for i in range(NV)]
free = np.array([bool(edge[i]) and lab[i] == SHIRT_I and not any(lab[j] == SKIN and z[j] > NECK.z - 0.09 for j in nbr[i]) for i in range(NV)])
nb_of = [nbr_s[i] if free[i] else nbr[i] for i in range(NV)]
idx = [i for i in np.nonzero(soft > 0)[0] if (free[i] or not edge[i]) and nb_of[i]]
def lap_step(Qa, k):
    R = Qa.copy()
    for i in idx: R[i] = Qa[i] + (Qa[nb_of[i]].mean(0) - Qa[i]) * soft[i] * k
    return R
for it in range(6): Q2 = lap_step(lap_step(Q2, 0.55), -0.58)
idx_all = idx
idx = [i for i in idx_all if lab[i] == JEANS_I]            # the trousers again, harder (the seat's and the knees' cuts gone)
soft_keep = soft.copy(); soft[:] = np.where(lab == JEANS_I, 0.9, 0)
for it in range(14): Q2 = lap_step(lap_step(Q2, 0.6), -0.63)
idx = [i for i in idx_all if lab[i] == SHIRT_I]            # the shirt again, by the fit (its hems held: they're the edges)
soft[:] = np.where(lab == SHIRT_I, soft_keep, 0)
for it in range(int(round(14 * LOOSE))): Q2 = lap_step(lap_step(Q2, 0.6), -0.63)
idx = idx_all; soft = soft_keep
# (5) THE CARGO POCKETS: a bellows pocket on the outside of each thigh, proud of the leg, its flap prouder — placed on
# the REST leg (the angle round its centre line, 0 = straight out to the side, + toward the front): the paint uses the same
POCKET_Z0, POCKET_Z1 = Z_KNEE + 0.055, Z_KNEE + 0.245
POCKET_PHI, POCKET_FLAP = math.radians(52), 0.052
def leg_phi(x_, y_, z_):
    """the angle round the rest leg's centre line (by side), and which side (−1 left, +1 right)"""
    sg_ = np.where(x_ < 0, -1.0, 1.0)
    cxl, cyl = np.interp(z_, LEGC['l'][0], LEGC['l'][1]), np.interp(z_, LEGC['l'][0], LEGC['l'][2])
    cxr, cyr = np.interp(z_, LEGC['r'][0], LEGC['r'][1]), np.interp(z_, LEGC['r'][0], LEGC['r'][2])
    cx_, cy_ = np.where(x_ < 0, cxl, cxr), np.where(x_ < 0, cyl, cyr)
    return np.arctan2(y_ - cy_, sg_ * x_ - cx_), sg_
def sbox(v, a_, b_, w_): return sstep((v - a_) / w_ + 0.5) * sstep((b_ - v) / w_ + 0.5)
phi_v, sg_v = leg_phi(x, y, z)
pk = sbox(z, POCKET_Z0, POCKET_Z1, 0.02) * sbox(phi_v, -POCKET_PHI, POCKET_PHI, 0.25) * (lab == JEANS_I)
pk *= 0.011 + 0.004 * sstep((z - (POCKET_Z1 - POCKET_FLAP)) / 0.01 + 0.5)
Q2[:, 0] += sg_v * np.cos(phi_v) * pk; Q2[:, 1] += np.sin(phi_v) * pk
# (6) THE COLLAR: its leaf lies on the shirt round the neck's opening — a little proud
def collar(x_, y_, z_):
    """1 on the collar's leaf: within 4 cm of the neck's opening (its ring) at the back and the sides, two points down
    the opening at the front"""
    rho = np.sqrt((x_ - NECK.x) ** 2 + (y_ - NECK.y) ** 2)
    band = ramp(0.042 - d_ring(x_, y_, z_), 0.003) * ramp(NECK.y + 0.045 - y_, 0.01)
    d_ = np.abs(x_) - open_w(z_)
    wing = ramp(0.046 - d_, 0.003) * ramp(d_ + 0.002) * ramp(z_ - (NECK.z - 0.050 - 0.95 * d_), 0.003) * ramp(y_ - (NECK.y + 0.02), 0.004) * ramp(NECK.z + 0.02 - z_)
    return np.maximum(band, wing)
Q2 += Nn * (0.006 * collar(x, y, z) * jk_v * near_neck)[:, None]
# (6b) THE JACKET'S HEM: its last ring level, proud of the trousers; the ring under it lifted inside — a ledge, in shadow
below = (lab == JEANS_I) | (lab == BELT_I)
below &= tee_w(x, y, np.full(NV, Z_JHEM)) < 0.5            # (not the belt and the trousers in the opening: beside the fronts, not under the hem)
hemj = np.array([bool(is_jk[i]) and any(below[j] for j in nbr[i]) for i in range(NV)])
underj = np.array([bool(below[i]) and any(hemj[j] for j in nbr[i]) for i in range(NV)])
Q2[underj, 2] = np.maximum(Q2[underj, 2], Z_JHEM + 0.005)
# …the T-shirt's ring under each front a little outward under it, the wrist's ring up inside the cuff
under_f = np.array([lab[i] == SHIRT_I and not is_jk[i] and z[i] > Z_JHEM and any(is_jk[j] for j in nbr[i]) for i in range(NV)])
Q2[under_f, 0] += np.sign(x[under_f]) * 0.005
under_c = np.array([lab[i] == SKIN and abs(x[i]) > X_SLEEVE - 0.01 and any(is_jk[j] for j in nbr[i]) for i in range(NV)])
Q2[under_c, 0] -= np.sign(x[under_c]) * 0.006
# …and those tucked rings eased ALONG themselves (each vertex sits on one of the old mesh's edges, pushed along its own
# normal: wavy) — what the cloth moved them, averaged with the ring's neighbours'
for ring_ in (underj, under_f, under_c):
    ri = np.nonzero(ring_)[0]; rn = {int(i): [j for j in nbr[i] if ring_[j]] for i in ri}
    D_ = Q2 - P
    for _ in range(12):
        Dn = D_.copy()
        for i in ri:
            if rn[int(i)]: Dn[i] = 0.5 * D_[i] + 0.5 * D_[rn[int(i)]].mean(0)
        D_ = Dn
    Q2[ri] = P[ri] + D_[ri]
# …and each front's own edge moves as the leather beside it does (the mean of its inner neighbours' move, eased along the
# edge): the first row of faces isn't stretched, so the zip drawn along the edge keeps its width
edge_f = np.array([bool(is_jk[i]) and any(under_f[j] for j in nbr[i]) for i in range(NV)])
D_ = Q2 - P; ri = np.nonzero(edge_f)[0]
for i in ri:
    inn = [j for j in nbr[i] if is_jk[j] and not edge_f[j]]
    if inn: D_[i] = D_[inn].mean(0)
rn = {int(i): [j for j in nbr[i] if edge_f[j]] for i in ri}
for _ in range(4):
    Dn = D_.copy()
    for i in ri:
        if rn[int(i)]: Dn[i] = 0.5 * D_[i] + 0.5 * D_[rn[int(i)]].mean(0)
    D_ = Dn
Q2[ri] = P[ri] + D_[ri]
log(f'jacket edges: the hem {int(hemj.sum())} vertices (z {z[hemj].min():.4f}…{z[hemj].max():.4f}), under it {int(underj.sum())}; the fronts\' {int(under_f.sum())}; the cuffs\' {int(under_c.sum())}')
# (7) THE HEM: the trousers' last ring let down over the boot (level, just over the ankle's bone); the boot's ring under
# it lifted inside — the hem's underside is a ledge, in shadow
hem = np.array([lab[i] == JEANS_I and any(lab[j] == BOOTS_I for j in nbr[i]) for i in range(NV)])
Z_HEM_GEO = Z_ANKLE + 0.008
Q2[hem, 2] = Z_HEM_GEO
under = np.array([lab[i] == BOOTS_I and any(hem[j] for j in nbr[i]) for i in range(NV)])
Q2[under, 2] = Z_HEM_GEO - 0.004
log(f'hem: {int(hem.sum())} vertices let down from z {z[hem].min():.3f}…{z[hem].max():.3f} to {Z_HEM_GEO:.3f}; the boot\'s ring under it {z[under].min():.3f}…{z[under].max():.3f}')
# (8) THE BOOTS: on each foot's own line (heel → toe, s = 0 … 1). The pack's foot is bare — five toes, each its own
# mesh: forward of the instep every vertex is put on a boot's LAST instead — inside a round-toed outline, its top on a
# toe box's dome (so the toes' sides and the webs between them fold flat into one skin), its underside on the ground;
# the foot narrowed to a boot's width; the sole's edge a touch proud of the upper
BOOT_W, TOE_BOX, SOLE_H = float(kw.get('BOOT_W', '0.84')), 0.060, 0.017
DOME_N, SOLES = {}, {}
for sd, sg in (('l', -1), ('r', 1)):
    bv = np.nonzero((lab == BOOTS_I) & (np.sign(x) == sg) & ~under)[0]
    low = bv[z[bv] < 0.03]
    cxf = float(np.median(Q2[low, 0])); y_h, y_t = float(Q2[bv, 1].min()), float(Q2[bv, 1].max()); Lf = y_t - y_h
    s_ = (Q2[bv, 1] - y_h) / Lf
    ez = sstep((Q2[bv, 2] - 0.06) / 0.06); Q2[bv, 0] = cxf + (Q2[bv, 0] - cxf) * (BOOT_W + (1 - BOOT_W) * ez)      # narrowed (the foot whole, eased out by the ankle)
    sb_, x0b = profile(s_, Q2[bv, 0], 0, 1, 25, np.min, 0.05); _, x1b = profile(s_, Q2[bv, 0], 0, 1, 25, np.max, 0.05)
    _, top = profile(s_, Q2[bv, 2], 0, 1, 25, np.max, 0.05)
    cball = float(np.interp(0.66, sb_, (x0b + x1b) / 2)); W_ball = float(np.interp(0.66, sb_, (x1b - x0b) / 2))
    sc_ = np.minimum(s_, 0.995)
    wo = W_ball * np.sqrt(np.clip(1 - (np.clip(sc_ - 0.70, 0, 1) / 0.30) ** 2.6, 1e-4, 1))                          # the outline: a round toe
    crown = np.interp(sc_, [0.50, 0.72, 0.90, 1.0], [float(np.interp(0.50, sb_, top)), TOE_BOX, TOE_BOX - 0.004, 0.036])
    u_ = np.clip(Q2[bv, 0] - cball, -wo, wo)
    dome = SOLE_H + (crown - SOLE_H) * np.clip(1 - np.abs(u_ / wo) ** 2.6, 0, 1) ** (1 / 2.6)
    under_ = (Nn[bv, 2] < -0.35) & (z[bv] < 0.02)
    fw_ = sstep((s_ - 0.52) / 0.14)
    Q2[bv, 0] += (cball + u_ - Q2[bv, 0]) * fw_
    Q2[bv, 2] += (np.where(under_, dome - 0.006, dome) - Q2[bv, 2]) * fw_     # (the toes' undersides folded up INSIDE the dome: the outsole below closes the boot)
    Q2[bv, 2] = np.maximum(Q2[bv, 2], 0.003)
    # the dome's own normals (the toes' sides lie on it as slivers: the mesh's would streak) — by differences
    def dome_at(xa, ya):
        sa = np.minimum((ya - y_h) / Lf, 0.995)
        wa = W_ball * np.sqrt(np.clip(1 - (np.clip(sa - 0.70, 0, 1) / 0.30) ** 2.6, 1e-4, 1))
        ca = np.interp(sa, [0.50, 0.72, 0.90, 1.0], [float(np.interp(0.50, sb_, top)), TOE_BOX, TOE_BOX - 0.004, 0.036])
        return SOLE_H + (ca - SOLE_H) * np.clip(1 - np.abs(np.clip(xa - cball, -wa, wa) / wa) ** 2.6, 0, 1) ** (1 / 2.6)
    e_ = 0.002; xa, ya = Q2[bv, 0], Q2[bv, 1]
    gx = (dome_at(xa + e_, ya) - dome_at(xa - e_, ya)) / (2 * e_); gy = (dome_at(xa, ya + e_) - dome_at(xa, ya - e_)) / (2 * e_)
    nn_ = np.stack([-np.clip(gx, -6, 6), -np.clip(gy, -6, 6), np.ones_like(gx)], 1); nn_ /= np.linalg.norm(nn_, axis=1, keepdims=True)
    for k_ in np.nonzero(fw_ > 0.6)[0]: DOME_N[int(bv[k_])] = nn_[k_]
    # the OUTSOLE's outline (heel → toe up the outside, back down the inside), 4 mm proud of the upper: built below
    so_ = np.linspace(0.0, 1.0, 13)
    hw_o = np.where(so_ < 0.66, np.interp(so_, sb_, (x1b - x0b) / 2), W_ball * np.sqrt(np.clip(1 - (np.clip(so_ - 0.70, 0, 1) / 0.30) ** 2.6, 0, 1)))
    hw_o = hw_o * np.sqrt(np.clip(1 - (np.clip(0.10 - so_, 0, 1) / 0.10) ** 2, 0, 1)) + 0.004                         # (a round heel)
    cx_o = np.where(so_ < 0.66, np.interp(so_, sb_, (x0b + x1b) / 2), cball)
    yo_ = y_h - 0.004 + so_ * (Lf + 0.008)
    hw_o[0] = hw_o[-1] = 0.0
    SOLES[sd] = (so_, cx_o, hw_o, yo_)
    bb = Q2[bv]; lo_ = bb[bb[:, 2] < 0.05]
    log(f'boot ({sd}): {np.ptp(lo_[:, 1]):.3f} long, {np.ptp(lo_[:, 0]):.3f} wide, the toe box {bb[(s_ > 0.75) & (s_ < 0.9), 2].max():.3f} high')
me.attributes.new('dress', 'FLOAT_VECTOR', 'POINT').data.foreach_set('vector', Q2.ravel().astype(np.float32))
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
bm_ = bpy.data.materials.new('bakepos'); bm_.use_nodes = True; t = bm_.node_tree
for n in list(t.nodes): t.nodes.remove(n)
at = t.nodes.new('ShaderNodeAttribute'); at.attribute_type = 'GEOMETRY'
em = t.nodes.new('ShaderNodeEmission'); oo = t.nodes.new('ShaderNodeOutputMaterial'); tn = t.nodes.new('ShaderNodeTexImage')
t.links.new(at.outputs['Vector'], em.inputs['Color']); t.links.new(em.outputs['Emission'], oo.inputs['Surface']); t.nodes.active = tn
dup.data.materials.clear(); dup.data.materials.append(bm_)
for m in list(dup.modifiers): dup.modifiers.remove(m)
bpy.ops.object.select_all(action='DESELECT'); dup.select_set(True); bpy.context.view_layer.objects.active = dup
sc.render.bake.margin = 2; sc.render.bake.use_clear = False
def bake_attr(name):
    pimg = bpy.data.images.new(name + 'pos', TEX, TEX, alpha=True, float_buffer=True)
    pimg.colorspace_settings.name = 'Non-Color'
    pimg.pixels = np.tile(np.array([0, 0, -9, 0], np.float32), TEX * TEX)
    at.attribute_name = name; tn.image = pimg
    bpy.ops.object.bake(type="EMIT", margin=2, use_clear=False)
    return np.array(pimg.pixels[:], np.float32).reshape(TEX, TEX, 4)
RP = bake_attr('rest')
DP = bake_attr('dress')                                    # (where the cloth ended up: the boots are painted on their last)
bpy.data.objects.remove(dup)
covered = RP[..., 2] > -8
log(f'rest positions baked: {covered.mean() * 100:.0f} % of the skin texture covered')

# (b) the garments painted per texel
X, Y, Z = RP[..., 0], RP[..., 1], RP[..., 2]
PAD = 0.002
m_skin, m_shirt, m_jeans, m_belt, m_boots = masks(X, Y, Z, PAD)
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
# the colours (sRGB): a brown leather jacket (its knit a shade darker, brass on its zip and snaps) over a light grey
# T-shirt, khaki cargo trousers, a dark belt with a steel buckle, dark brown boots
JK_C, KNIT_C, BRASS_C, TEE_C = (0.31, 0.185, 0.105), (0.17, 0.115, 0.08), (0.56, 0.46, 0.27), (0.68, 0.67, 0.64)
JE_C, BE_C, BO_C, SOLE_C, BUCKLE_C = (0.37, 0.32, 0.23), (0.13, 0.09, 0.07), (0.25, 0.155, 0.09), (0.06, 0.055, 0.05), (0.58, 0.58, 0.56)
col = skin_c[..., :3].copy()
cl = {}
# THE DETAILS, drawn on his rest pose (each texel's place on him): stitched seams as dark lines, panels a shade apart
FRONT, BACK = Y > Y_MID + 0.02, Y < Y_MID - 0.02
def line(d, w=0.0022): return np.clip(1 - np.abs(d) / w, 0, 1)             # 1 on a seam, ~4 mm wide
def boxd(u, v, u0, u1, v0, v1): return np.maximum(np.maximum(u0 - u, u - u1), np.maximum(v0 - v, v - v1))   # < 0 inside
def disc(u, v, r): return np.clip((r - np.sqrt(u * u + v * v)) / 0.0015 + 0.5, 0, 1)
# -- THE JACKET (2026-11-11, the user: "change the shirt to something like a jacket … make him look good, a cargo and a
#    suitable jacket"): a flight jacket's cut in brown leather, worn open over a T-shirt — a collar, a zip down each
#    front, two flapped pockets, straps on the shoulders, a yoke; knit at the waist and the wrists. H is its RELIEF
#    (metres proud of what's under it): the normal map gets its slopes, so every edge catches the light at a texel's
#    sharpness — the mesh alone steps from the T-shirt to the leather over a whole quad.
JK = 1 - tee_w(X, Y, Z, PAD)                                               # the jacket (1) / the T-shirt in its opening (0)
D_OPEN = np.abs(X) - open_w(Z)                                             # metres out from the opening's edge
ARM = (np.abs(X) > sh - 0.012) & (Z > Z_PIT - 0.045)                       # on a sleeve
RHO = np.sqrt((X - NECK.x) ** 2 + (Y - NECK.y) ** 2)
jk_tone = np.ones_like(X); jk_seam = np.zeros_like(X); jk_btn = np.zeros_like(X)
H = 0.005 * JK * m_shirt * sstep((Z - (NECK.z - 0.16)) / 0.08)             # (the hem, the fronts and the cuffs are cut into the mesh: the relief is the collar's on the neck, and the details')
co_ = collar(X, Y, Z) * JK
jk_tone *= 1 + 0.07 * co_
jk_seam = np.maximum(jk_seam, np.clip(4.5 * co_ * (1 - co_), 0, 1) * 0.9)                                    # the leaf's edge and its shadow
H += 0.004 * co_
fronts = FRONT & ~ARM & (Z < NECK.z - 0.125) & (Z > Z_JHEM)
zipm = ramp(0.0050 - D_OPEN, 0.001) * ramp(D_OPEN - 0.0022, 0.001) * fronts                                  # the zip's teeth by each edge…
jk_seam = np.maximum(jk_seam, 0.5 * line(D_OPEN - 0.017) * fronts)                                           # …and the stitching beside
jk_tone *= 1 + 0.05 * (fronts & (D_OPEN > 0) & (D_OPEN < 0.017))
# the knit: the waistband and the cuffs (ribs up the band, along the wrist)
ya_l, za_l = arm_axis(np.abs(X), 'l'); ya_r, za_r = arm_axis(np.abs(X), 'r')
th_t = np.arctan2(np.abs(X), Y - YC_TORSO)                                                                   # round the trunk from the front's middle
th_s = np.arctan2(Z - np.where(X < 0, za_l, za_r), Y - np.where(X < 0, ya_l, ya_r))                         # round the sleeve
m_band = (Z < Z_JHEM + BAND) & ~ARM
m_cuff = ARM & (np.abs(X) > X_SLEEVE - CUFF)
knit = (m_band | m_cuff).astype(np.float32)
rib = np.where(m_cuff, np.cos(th_s * 40), np.cos(th_t * 140))
jk_seam = np.maximum(jk_seam, 0.75 * line(Z - (Z_JHEM + BAND), 0.003) * ~ARM)
jk_seam = np.maximum(jk_seam, 0.75 * line(np.abs(X) - (X_SLEEVE - CUFF), 0.003) * ARM)
H += 0.0006 * rib * knit - 0.0015 * knit
# two flapped pockets low on the fronts, a snap on each flap
JP_X0, JP_X1 = 0.074, 0.142
JP_Z0 = Z_JHEM + BAND + 0.012; JP_Z1 = JP_Z0 + 0.125; JP_FLAP = 0.042
djp = boxd(np.abs(X), Z, JP_X0, JP_X1, JP_Z0, JP_Z1)
on_fr = FRONT & ~ARM
jk_seam = np.maximum(jk_seam, 0.65 * line(djp) * on_fr)
jflap = JP_Z1 - JP_FLAP - 0.012 * (1 - np.abs(np.abs(X) - (JP_X0 + JP_X1) / 2) / ((JP_X1 - JP_X0) / 2))    # the flap's edge: a shallow point
in_jp = (djp < 0) & on_fr
jk_tone *= 1 + 0.05 * in_jp
jk_seam = np.maximum(jk_seam, 0.8 * line(Z - jflap, 0.003) * in_jp)
jk_btn = np.maximum(jk_btn, disc(np.abs(X) - (JP_X0 + JP_X1) / 2, Z - (JP_Z1 - JP_FLAP - 0.002), 0.0058) * on_fr)
H += (0.0022 * ramp(-djp, 0.002) + 0.0018 * ramp(-djp, 0.002) * ramp(Z - jflap, 0.002)) * on_fr
# the shoulders' straps (along the shoulder's ridge, buttoned by the collar), the yoke, the armholes, the side seams,
# the sleeves' back seam
y_r = np.interp(np.abs(X), [0.08, sh], [NECK.y - 0.004, J['upperarm_l'].y])
ep = ramp(0.019 - np.abs(Y - y_r), 0.002) * ramp(np.abs(X) - 0.092, 0.002) * ramp(sh - 0.016 - np.abs(X), 0.002) * (Z > J['upperarm_l'].z + 0.012)
jk_tone *= 1 + 0.06 * ep
jk_seam = np.maximum(jk_seam, np.clip(4.5 * ep * (1 - ep), 0, 1) * 0.8)
jk_btn = np.maximum(jk_btn, disc(np.abs(X) - 0.104, Y - y_r, 0.0055) * (Z > J['upperarm_l'].z + 0.012))
H += 0.0025 * ep
jk_seam = np.maximum(jk_seam, 0.5 * line(Z - (NECK.z - 0.105)) * BACK * (np.abs(X) < sh - 0.01) * (Z > Z_WAIST))    # the yoke
jk_seam = np.maximum(jk_seam, 0.5 * line(np.abs(X) - (sh - 0.012), 0.003) * (Z > Z_PIT - 0.045))                   # the armholes
jk_seam = np.maximum(jk_seam, 0.4 * line(Y - YC_TORSO) * ~ARM * (np.abs(X) > 0.10) * (Z < Z_PIT - 0.05))           # the side seams
jk_seam = np.maximum(jk_seam, 0.4 * line((np.abs(th_s + 0.75 * np.pi)) * 0.06) * ARM * (np.abs(X) > sh + 0.02))     # the sleeves' back seam
leather = pattern('Leather037', 5, 0.55) * pattern('Leather037', 1.5, 0.30)                                  # the grain, and the hide's cloudiness
jkc = np.array(JK_C) * (leather * jk_tone * (1 - 0.55 * jk_seam))[..., None]
knc = np.array(KNIT_C) * (pattern('Fabric036', 7, 0.3) * (1 + 0.16 * rib) * (1 - 0.55 * jk_seam))[..., None]
jkc = jkc * (1 - knit[..., None]) + knc * knit[..., None]
brass = np.clip(np.maximum(zipm, jk_btn), 0, 1)[..., None]
jkc = jkc * (1 - brass) + np.array(BRASS_C) * brass
# -- the T-shirt in the jacket's opening: its neck's rib
zc_ = z_crew(X)
te_rib = FRONT & (Z > zc_ - 0.014) & (Z > Z_WAIST)
tec = np.array(TEE_C) * (pattern('Fabric036', 7, 0.22) * (1 - 0.06 * te_rib) * (1 - 0.35 * line(Z - (zc_ - 0.014)) * FRONT))[..., None]
cl['shirt'] = tec * (1 - JK[..., None]) + jkc * JK[..., None]
# -- the trousers: the cargo pockets (a bellows panel, a flap, a button), the side seams and the inseams, the fly, the
#    slant pockets, two flapped seat pockets, the hems' stitching
pa_tone = np.ones_like(X); pa_seam = np.zeros_like(X); pa_btn = np.zeros_like(X)
PHI, SG = leg_phi(X, Y, Z)
legs = Z < Z_CROTCH + 0.02
ARC = PHI * 0.085                                                           # metres round the leg from its outside
dcp = boxd(ARC, Z, -POCKET_PHI * 0.085, POCKET_PHI * 0.085, POCKET_Z0, POCKET_Z1)
in_cp = dcp < 0
pa_tone *= 1 + 0.07 * in_cp
pa_seam = np.maximum(pa_seam, 0.8 * line(dcp, 0.003))
pa_seam = np.maximum(pa_seam, 0.35 * line(dcp + 0.012) * (Z < POCKET_Z1 - POCKET_FLAP))                        # the bellows' fold
cflap = POCKET_Z1 - POCKET_FLAP
pa_tone *= 1 - 0.08 * (in_cp & (Z > cflap))
pa_seam = np.maximum(pa_seam, 0.9 * line(Z - cflap, 0.0035) * in_cp)
pa_btn = np.maximum(pa_btn, disc(np.abs(ARC) - 0.045, Z - (cflap + 0.014), 0.006) * in_cp)
pa_seam = np.maximum(pa_seam, 0.5 * line(ARC) * ~in_cp * (Z < Z_HIP - 0.02) * (np.abs(PHI) < 1))                # the side seam
pa_seam = np.maximum(pa_seam, 0.4 * line((np.pi - np.abs(PHI)) * 0.085) * legs)                                 # the inseam
pa_seam = np.maximum(pa_seam, 0.5 * line(Z - (Z_HEM + 0.022)))                                                 # the hem's stitching
pa_seam = np.maximum(pa_seam, 0.35 * line(Z - (Z_KNEE + 0.045)) * (PHI > 0.3) * (PHI < 2.6) * legs)             # the knee's panel
pa_seam = np.maximum(pa_seam, 0.35 * line(Z - (Z_KNEE - 0.085)) * (PHI > 0.3) * (PHI < 2.6) * legs)
up_ = Z > Z_CROTCH + 0.03
pa_seam = np.maximum(pa_seam, 0.5 * line(X) * up_ * (FRONT | BACK))                                             # the rise's seam
fly_x = 0.020 * np.sqrt(np.clip((Z - (Z_BELT - 0.14)) / 0.05, 0, 1))
pa_seam = np.maximum(pa_seam, 0.55 * line(X - fly_x) * FRONT * (Z > Z_BELT - 0.14))                             # the fly's stitch
sl = np.abs(X) - (0.070 + (Z_BELT - Z) * 0.62)
pa_seam = np.maximum(pa_seam, 0.6 * line(sl, 0.003) * FRONT * (Z > Z_BELT - 0.135))                             # the slant pockets
SP_X0, SP_X1, SP_Z1 = 0.030, 0.128, Z_BELT - 0.055; SP_Z0 = SP_Z1 - 0.125
dsp = boxd(np.abs(X), Z, SP_X0, SP_X1, SP_Z0, SP_Z1)
pa_seam = np.maximum(pa_seam, 0.6 * line(dsp) * BACK)
pa_seam = np.maximum(pa_seam, 0.75 * line(Z - (SP_Z1 - 0.04), 0.003) * (dsp < 0) * BACK)
pa_tone *= 1 - 0.07 * ((dsp < 0) & BACK & (Z > SP_Z1 - 0.04))
pa_btn = np.maximum(pa_btn, disc(np.abs(X) - (SP_X0 + SP_X1) / 2, Z - (SP_Z1 - 0.03), 0.0055) * BACK)
pac = np.array(JE_C) * (pattern('Fabric069', 6, 0.45) * pa_tone * (1 - 0.5 * pa_seam))[..., None]
cl['jeans'] = pac * (1 - pa_btn[..., None]) + np.array(JE_C) * 0.45 * pa_btn[..., None]
# -- the belt: its buckle, the trousers' loops over it
cl['belt'] = np.array(BE_C) * pattern('Leather030', 5, 0.6)[..., None]
ZB_ = (Z_WAIST + Z_BELT) / 2
buckle = (np.abs(X) < 0.024) & FRONT & ~((np.abs(X) < 0.015) & (np.abs(Z - ZB_) < 0.010) & (np.abs(X) > 0.002))   # a frame and its prong
cl['belt'][buckle & (m_belt > 0.5)] = BUCKLE_C
loops = ((np.abs(np.abs(X) - 0.085) < 0.008) & (FRONT | BACK)) | ((np.abs(X) < 0.008) & BACK) | ((np.abs(Y - Y_MID + 0.01) < 0.008) & (np.abs(X) > 0.1))
cl['belt'][loops] = (np.array(JE_C) * 0.92 * pattern('Fabric069', 6, 0.45)[..., None])[loops]
# -- the boots (on their last: the DRESSED positions): the leather, a toe cap's seam, the laces up the instep, the
#    sole and its heel
DX_, DY_, DZ_ = DP[..., 0], DP[..., 1], DP[..., 2]
bo_seam = np.zeros_like(X)
FOOT_Y = (J['foot_l'].y + J['foot_r'].y) / 2
bo_seam = np.maximum(bo_seam, 0.65 * line(DY_ - (FOOT_Y + 0.148), 0.003) * (DZ_ > SOLE_H))                      # the toe cap
FX = np.abs(np.abs(DX_) - abs(J['foot_l'].x) + 0.004)
tongue = (FX < 0.017) & (DY_ > FOOT_Y + 0.03) & (DY_ < FOOT_Y + 0.135) & (DZ_ > 0.045)
bo_seam = np.maximum(bo_seam, 0.55 * line(FX - 0.017, 0.003) * (DY_ > FOOT_Y + 0.03) * (DY_ < FOOT_Y + 0.135) * (DZ_ > 0.045))
lace = tongue & (np.abs(((DY_ - FOOT_Y) % 0.022) - 0.011) < 0.0035)
bo = np.array(BO_C) * (pattern('Leather037', 4, 0.7) * (1 - 0.6 * bo_seam) * (1 - 0.25 * tongue))[..., None]
bo[lace] = np.array((0.46, 0.38, 0.25))
cl['boots'] = np.where((DZ_ < SOLE_H - 0.002)[..., None], np.array(SOLE_C), bo)
# shadows where one layer meets another: under the shirt's blouse, under the trousers' hem, the arm under the sleeve, the
# neck inside the collar
sh_ = lambda d, w, k: 1 - k * np.exp(-np.maximum(d, 0) / w)
dark = np.ones_like(X)
Z_TOP = Z_JHEM + (Z_WAIST - Z_JHEM) * (1 - JK)                                 # the top's lower edge: the T-shirt's at the waist, the jacket's hem
dark *= np.where(Z < Z_TOP, sh_(Z_TOP - Z, 0.014, 0.5), 1)
dark *= np.where(Z < Z_HEM, sh_(Z_HEM - Z, 0.02, 0.6), 1)
dark *= np.where((np.abs(X) > X_SLEEVE) & (Z > Z_WAIST), sh_(np.abs(X) - X_SLEEVE, 0.014, 0.4), 1)
dark *= np.where((JK < 0.5) & FRONT & (Z > Z_JHEM), sh_(-D_OPEN, 0.011, 0.42), 1)          # the jacket's fronts on the T-shirt (and on the belt)
ns_ = neck_skin(X, Y, Z) > 0.5
dark *= np.where(ns_ & (RHO < 0.13), sh_(Z - np.where(FRONT & (np.abs(X) < 0.072), np.maximum(zc_, z_ring(X, Y)), z_ring(X, Y)), 0.008, 0.28), 1)
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
# normals: his muscles' own under the shirt (eased), none under the trousers; the weave on top
dec = lambda a: a[..., :3] * 2 - 1
sn = dec(skin_n)
def cloth_n(asset, k, keep, weave):
    fnm = dec(tiled(asset, 'NormalGL', k, True))
    xy = sn[..., :2] * keep + fnm[..., :2] * weave
    return np.concatenate([xy, np.sqrt(np.clip(1 - (xy ** 2).sum(-1, keepdims=True), 0.05, 1))], -1)
nrm = sn * m_skin[..., None]
for (asset, k, keep, weave), m_ in ((('Fabric036', 7, 0.45 * FIT ** 1.5, 0.5), m_shirt * (1 - JK)), (('Leather037', 5, 0, 0.55), m_shirt * JK * (1 - knit)), (('Fabric036', 9, 0, 0.6), m_shirt * JK * knit),
                                    (('Fabric069', 6, 0, 0.7), m_jeans), (('Leather030', 5, 0, 0.8), m_belt), (('Leather037', 4, 0, 0.9), m_boots)):
    nrm += cloth_n(asset, k, keep, weave) * m_[..., None]
# the jacket's relief: H's slopes (a height's tangent-space normal is −its gradient along u and v: metres a texel there,
# over the texel's own size on him) — not across the UV islands' borders
Hb = H.copy()
for _ in range(2): Hb = (Hb + np.roll(Hb, 1, 0) + np.roll(Hb, -1, 0) + np.roll(Hb, 1, 1) + np.roll(Hb, -1, 1)) / 5
P3 = RP[..., :3]
du_ = np.linalg.norm(np.roll(P3, -1, 1) - np.roll(P3, 1, 1), axis=-1) / 2; dv_ = np.linalg.norm(np.roll(P3, -1, 0) - np.roll(P3, 1, 0), axis=-1) / 2
okr = covered.copy()
for _ in range(3): okr = okr & np.roll(okr, 1, 0) & np.roll(okr, -1, 0) & np.roll(okr, 1, 1) & np.roll(okr, -1, 1)
okr &= (du_ < 0.008) & (dv_ < 0.008)
gu_ = (np.roll(Hb, -1, 1) - np.roll(Hb, 1, 1)) / 2 / np.clip(du_, 4e-4, None); gv_ = (np.roll(Hb, -1, 0) - np.roll(Hb, 1, 0)) / 2 / np.clip(dv_, 4e-4, None)
nrm[..., 0] -= np.clip(gu_, -1.3, 1.3) * okr; nrm[..., 1] -= np.clip(gv_, -1.3, 1.3) * okr
log(f'relief: a texel is {np.median(du_[okr]) * 1e3:.1f} × {np.median(dv_[okr]) * 1e3:.1f} mm on him; slopes over 0.3 on {((np.hypot(gu_, gv_) > 0.3) & okr).mean() * 100:.1f} % of the texture')
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-6
nrm = dilate(nrm, inside)
BODY_N = np.concatenate([nrm * 0.5 + 0.5, np.ones_like(X)[..., None]], -1).astype(np.float32)
log('painted: the jacket, the T-shirt, trousers, belt, boots (colour + normals)')
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
SWATCH = (1024, 0, 64, 64)                                 # the outsoles' rubber (their own geometry: one flat colour)
AC[SWATCH[1]:SWATCH[1] + SWATCH[3], SWATCH[0]:SWATCH[0] + SWATCH[2], :3] = SOLE_C
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
    for tag, ang, z_, s_, rx, ry in (('front', 0, 0.95, 2.1, 560, 1000), ('three', 35, 0.95, 2.1, 560, 1000), ('side', 90, 0.95, 2.1, 560, 1000), ('back', 180, 0.95, 2.1, 560, 1000), ('face', 15, 1.64, 0.45, 560, 560), ('boots', 20, 0.25, 0.7, 560, 560),
                                     ('chest', 20, 1.27, 0.72, 900, 900), ('chestb', 200, 1.27, 0.72, 900, 900), ('cuff', 60, 1.42, 0.5, 700, 700)):
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
# (the trousers hang from the shin: their hem — and the boot's ring tucked under it — don't turn with the foot)
for s_, Side in (('l', 'Left'), ('r', 'Right')):
    kl, kf, kt = NAMES.index(Side + 'Leg'), NAMES.index(Side + 'Foot'), NAMES.index(Side + 'ToeBase')
    hv = np.nonzero((lab == JEANS_I) | under)[0]
    Wt[hv, kl] += Wt[hv, kf] + Wt[hv, kt]; Wt[hv, kf] = 0; Wt[hv, kt] = 0
for g_ in old: body.vertex_groups.remove(g_)
grp = [body.vertex_groups.new(name=PFX + n) for n in NAMES]
sw = Wt.sum(1); log(f'weights: {int((sw < 1e-4).sum())} vertices unweighted')
for k, g_ in enumerate(grp):
    for i in np.nonzero(Wt[:, k] > 1e-4)[0]: g_.add([int(i)], float(Wt[i, k] / max(sw[i], 1e-6)), 'REPLACE')
# THE OUTSOLES: a rubber slab under each boot — its outline the boot's (a round toe, a round heel), a heel block, the arch
# cut under the shank; hard edges (its wall, its tread and its welt are separate faces). ~100 triangles a boot. It bends
# with the toes at the ball.
vn = np.array([v.normal[:] for v in me.vertices])
for i, n_ in DOME_N.items(): vn[i] = n_
new_n = []
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
uvl_ = bm.loops.layers.uv.verify(); dl_ = bm.verts.layers.deform.verify()
SW_UV = ((SWATCH[0] + SWATCH[2] / 2) / AW, (SWATCH[1] + SWATCH[3] / 2) / AH)
for s_, Side in (('l', 'Left'), ('r', 'Right')):
    so_, cx_o, hw_o, yo_ = SOLES[s_]
    kf, kt = grp[NAMES.index(Side + 'Foot')].index, grp[NAMES.index(Side + 'ToeBase')].index
    s_ball = (J[f'ball_{s_}'].y - yo_[0]) / (yo_[-1] - yo_[0])
    ring = [(cx_o[k] + hw_o[k], yo_[k], so_[k]) for k in range(len(so_))] + [(cx_o[k] - hw_o[k], yo_[k], so_[k]) for k in range(len(so_) - 2, 0, -1)]
    area = sum(ring[k][0] * ring[(k + 1) % len(ring)][1] - ring[(k + 1) % len(ring)][0] * ring[k][1] for k in range(len(ring)))
    if area < 0: ring = ring[::-1]                           # (counter-clockwise seen from above, either foot)
    zt = lambda sv: SOLE_H + 0.012 * (1 - sstep((sv - 0.24) / 0.05))          # the heel block
    zb = lambda sv: 0.007 * sbox(sv, 0.31, 0.56, 0.08)                         # the arch
    def vert(x_, y_, z_, sv, n_):
        v = bm.verts.new((x_, y_, z_)); t_ = sstep((sv - (s_ball - 0.05)) / 0.10)
        if t_ < 1: v[dl_][kf] = 1 - t_
        if t_ > 0: v[dl_][kt] = t_
        new_n.append(n_); return v
    def face(vs):
        f = bm.faces.new(vs); f.smooth = True
        for l in f.loops: l[uvl_].uv = SW_UV
    N = len(ring)
    outn = []
    for k in range(N):
        a_, b_ = ring[(k - 1) % N], ring[(k + 1) % N]; t_ = Vector((b_[0] - a_[0], b_[1] - a_[1], 0)); outn.append(Vector((t_.y, -t_.x, 0)).normalized())
    wt = [vert(r_[0], r_[1], zt(r_[2]), r_[2], outn[k][:]) for k, r_ in enumerate(ring)]
    wb = [vert(r_[0], r_[1], zb(r_[2]), r_[2], outn[k][:]) for k, r_ in enumerate(ring)]
    for k in range(N): face([wb[k], wb[(k + 1) % N], wt[(k + 1) % N], wt[k]])
    for zf, n_, flip in ((zb, (0, 0, -1), True), (zt, (0, 0, 1), False)):
        rv = [vert(r_[0], r_[1], zf(r_[2]), r_[2], n_) for r_ in ring]
        # (strips across the foot: each station's outside ↔ inside vertex, a triangle at the heel's and the toe's tip)
        st = {}
        for j, r_ in enumerate(ring): st.setdefault(round(float(r_[2]), 4), []).append(j)
        keys = sorted(st)
        for a_, b_ in zip(keys[:-1], keys[1:]):
            qa, qb = st[a_], st[b_]
            vs = [rv[j] for j in qa] + [rv[j] for j in qb]
            # order the 3 or 4 vertices round their middle (counter-clockwise from above), flipped for the tread
            cxm = sum(v.co.x for v in vs) / len(vs); cym = sum(v.co.y for v in vs) / len(vs)
            vs.sort(key=lambda v: math.atan2(v.co.y - cym, v.co.x - cxm))
            if flip: vs = vs[::-1]
            face(vs)
bm.to_mesh(me); bm.free(); me.update()
vn = np.concatenate([vn, np.array(new_n, np.float32).reshape(-1, 3)]) if new_n else vn
me.normals_split_custom_set_from_vertices([tuple(float(c) for c in n_) for n_ in vn])
me.calc_loop_triangles()
log(f'outsoles: {len(new_n)} vertices; the mesh {len(me.vertices)} vertices, {len(me.loop_triangles)} triangles')
body.parent = rig
mod = body.modifiers.new('skeleton', 'ARMATURE'); mod.object = rig

def world_rot(obj, pb): return (obj.matrix_world @ pb.matrix).to_quaternion()
def rest_world(obj, bone): return (obj.matrix_world @ bone.matrix_local).to_quaternion()
ORDER = [PFX + n for n in NAMES]
# THE ARMS' CARRIAGE (2026-11-11, the user: "him walking … looks gay"): measured (the clips on him, the elbows' and the
# wrists' places): Mixamo's clips were made on a broad dummy — standing and walking they hold his elbows 28–31 cm from the
# centre line (a man's hang at ~21: .claude/skills/human-anatomy §3d), 17–21° out from the shoulder, the wrists cocked
# 12–21° with the hands turned out — on his slimmer trunk the arms float off the body. In the clips where the arms hang
# (ARMS_IN: the share of the spread kept), each frame's upper arm is brought in about the body's forward axis — the angle
# out from straight down beyond ARM_A0 scaled, by how far down the arm points (a reach, a climb, a swing overhead stay as
# they are) — the forearm and the hand with it; and the wrist is straightened WRIST of the way to the forearm's line.
ARMS_IN = {'idle': 0.3, 'walk': 0.3, 'turn_left': 0.3, 'turn_right': 0.3, 'run': 0.45, 'sprint': 0.45, 'jump': 0.45, 'jump_run': 0.45, 'land': 0.45}
ARM_A0, WRIST = math.radians(float(kw.get('ARM_A0', '9'))), float(kw.get('WRIST', '0.55'))
# THE SHOULDERS LEVEL, THE ARMS' GAPS THE SAME (2026-11-11, the user: "while running / walking his shoulder goes a bit
# down and in idle it goes up — I want it in between … one side has more gap from the body and the other has no gap").
# Measured in the chest's own frame: the clips hold the clavicles at different lifts — idle −8 / −14° (right / left: the
# shoulder joints 5–6.5 cm under the neck's base), run −14°, the walk −26° (10 cm under) — and the arms at different
# spreads (the walk: left 12°, right 8°). So in the ARMS_IN clips each side's clavicle is turned by a constant so its
# MEAN lift over the clip is SHOULDER_LIFT (the joint ~8 cm under the neck's base: a man's — and between the idle's and
# the walk's) and its mean sweep back the two sides' average; and each arm's spread is shifted so both sides' means are
# their average. Each clip's own movement about those means is kept.
SHOULDER_LIFT = math.radians(float(kw.get('SHOULDER_LIFT', '-18')))
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
    k_arm = ARMS_IN.get(name)
    def chest_axes(q): d_ = q @ tgt_rest[PFX + 'Spine2'].inverted(); return d_ @ Vector((1, 0, 0)), d_ @ Vector((0, 1, 0)), d_ @ Vector((0, 0, 1))
    def spread_of(q, sg, ax):
        """an upper arm's angle out from straight down, in the chest's frame, and how far down it points (0 … 1)"""
        d_ = q @ Vector((0, 1, 0)); dn = -d_.dot(ax[2]); hang = min(1.0, max(0.0, (dn - 0.3) / 0.4))
        return math.atan2(sg * d_.dot(ax[0]), max(dn, 1e-6)), hang * hang * (3 - 2 * hang)
    def arm_map(a_): return a_ if a_ < ARM_A0 else ARM_A0 + (a_ - ARM_A0) * k_arm
    fix = None
    if k_arm is not None:
        # (a first pass over the clip: each side's mean clavicle lift and sweep, and its mean spread once brought in)
        acc = {S_: {'lift': [], 'back': [], 'a': [], 'h': [], 'fore': []} for S_ in ('Left', 'Right')}
        for fr in range(f0, f1 + 1):
            sc.frame_set(fr)
            def wq_of(sn): return world_rot(srcA, srcA.pose.bones[PFX + sn]) @ src_rest[PFX + sn].inverted() @ tgt_rest[PFX + sn]
            ax = chest_axes(wq_of('Spine2'))
            for S_, sg in (('Left', -1), ('Right', 1)):
                d_ = wq_of(S_ + 'Shoulder') @ Vector((0, 1, 0))
                acc[S_]['lift'].append(math.atan2(d_.dot(ax[2]), sg * d_.dot(ax[0]))); acc[S_]['back'].append(math.atan2(-d_.dot(ax[1]), sg * d_.dot(ax[0])))
                a_, h_ = spread_of(wq_of(S_ + 'Arm'), sg, ax); acc[S_]['a'].append(arm_map(a_)); acc[S_]['h'].append(h_)
                acc[S_]['fore'].append((a_, h_, wq_of(S_ + 'ForeArm'), ax))
        mean = lambda v: sum(v) / len(v)
        ma = {S_: sum(a_ * h_ for a_, h_ in zip(acc[S_]['a'], acc[S_]['h'])) / max(1e-6, sum(acc[S_]['h'])) for S_ in acc}
        mb = mean([mean(acc[S_]['back']) for S_ in acc]); mm = mean(list(ma.values()))
        fix = {S_: {'lift': SHOULDER_LIFT - mean(acc[S_]['lift']), 'back': mb - mean(acc[S_]['back']), 'spread': mm - ma[S_]} for S_ in acc}
        # …and the FOREARMS (they hang at their own angles: the walk's right wrist 4 cm further out than its left): each
        # side's mean angle out, with its upper arm already brought in, shifted to the two sides' average
        mf = {}
        for S_, sg in (('Left', -1), ('Right', 1)):
            num = den = 0.0
            for a0_, h0_, qf_, ax in acc[S_]['fore']:
                q_ = Quaternion(ax[1], sg * (a0_ - arm_map(a0_) - fix[S_]['spread']) * h0_) @ qf_
                b_, hb_ = spread_of(q_, sg, ax); num += b_ * hb_; den += hb_
            mf[S_] = num / max(den, 1e-6)
        for S_ in acc: fix[S_]['fore'] = mean(list(mf.values())) - mf[S_]
        log(f'  {name}: clavicles ' + ', '.join(f'{S_[0]} {math.degrees(mean(acc[S_]["lift"])):+.1f}° → {math.degrees(SHOULDER_LIFT):+.1f}°' for S_ in acc)
            + '; spread ' + ', '.join(f'{S_[0]} {math.degrees(ma[S_]):.1f}°' for S_ in acc) + f' → {math.degrees(mm):.1f}° both'
            + '; forearms ' + ', '.join(f'{S_[0]} {math.degrees(mf[S_]):+.1f}°' for S_ in acc) + f' → {math.degrees(mean(list(mf.values()))):+.1f}° both')
    for fr in range(f0, f1 + 1):
        sc.frame_set(fr)
        WQ = {}; radd = {}; rfore = {}
        for n in ORDER:
            pb = rig.pose.bones[n]
            wq = world_rot(srcA, srcA.pose.bones[n]) @ src_rest[n].inverted() @ tgt_rest[n] if n in src_rest else tgt_rest[n]
            sn_ = n[len(PFX):]
            if fix and sn_.endswith(('Shoulder', 'Arm', 'Hand')):
                Side = 'Left' if sn_.startswith('Left') else 'Right'; sg = -1 if Side == 'Left' else 1
                ax = chest_axes(WQ[PFX + 'Spine2'])
                if sn_ == Side + 'Shoulder':
                    wq = Quaternion(ax[2], -sg * fix[Side]['back']) @ Quaternion(ax[1], -sg * fix[Side]['lift']) @ wq
                else:
                    if sn_ == Side + 'Arm':
                        a_, h_ = spread_of(wq, sg, ax)
                        radd[Side] = Quaternion(ax[1], sg * (a_ - arm_map(a_) - fix[Side]['spread']) * h_)
                    wq = radd[Side] @ wq
                    if sn_ == Side + 'ForeArm':
                        b_, hb_ = spread_of(wq, sg, ax); rfore[Side] = Quaternion(ax[1], -sg * fix[Side]['fore'] * hb_)
                    if sn_ != Side + 'Arm': wq = rfore[Side] @ wq
                    if sn_ == Side + 'Hand':
                        fa = PFX + Side + 'ForeArm'
                        wq = wq.slerp((WQ[fa] @ tgt_rest[fa].inverted()) @ tgt_rest[n], WRIST)
            WQ[n] = wq
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
