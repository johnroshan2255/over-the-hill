# THE FIGHT CLIPS (2026-11-19, the user: "make punching and kicking and a lot of animation in Blender and use it") — made
# here in Blender on the game's own skeleton (character.glb's 22 Mixamo body bones), keyframed pose by pose, and written
# to src/assets/models/human/fight.glb: animations only, the game's Character.loadClips reads them by bone name.
#
#   blender -b --factory-startup --python scripts/oth/fight.py -- [OUT=src/assets/models/human/fight.glb]
#           [PREVIEW=<dir>]   stills of every key pose (Workbench), <dir>/<clip>_<frame>.png
#           [BLEND=<file>]    also save the scene (the actions on the rig — open it, edit the keys)
#           [FROM=<file>]     export the actions of a .blend edited by hand instead of building them here
#
# HOW A POSE IS SET: in the rig's own space (metres; he faces +Y, his right is +X, up +Z) —
#   the hips: where they are (from standing) and how they're turned (yaw: + to his left; lean: + forward; roll: + to
#   his right); the spine's extra turn spread over its three bones; each HAND and each ANKLE put where it must be (two-
#   bone IK, the elbow / the knee toward a pole); each foot flat and pointing where it's told; the head level, looking
#   where it's told. Blender's curves ease between the key poses; every frame is then read back off the posed rig
#   (30 a second), its turn from the rest pose applied to the game's rest pose — so it does not matter how Blender
#   orients its bones — and written as each bone's own rotation (+ the hips' place).
#
# THE CLIPS (each starts and ends in the guard, so they chain): guard (loop), jab, cross, hook, uppercut, kick_front,
# kick_round, block, dodge, hit_head, hit_body, knockdown (ends on his back: the game's getup_back takes over), taunt.
# THE KATANA'S (docs/weapons/KATANA.md — each cut as long as its ticks): katana_idle (loop), katana_draw, cut1, cut2,
# cut3, cut_heavy, katana_wake — the sword in his right fist (`blade`), the left hand put under it by the game.
import bpy, sys, os, json, math, struct
from mathutils import Matrix, Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
kw = dict(a.split('=', 1) for a in argv if '=' in a)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'src', 'assets', 'models', 'human', 'character.glb')
OUT = kw.get('OUT', os.path.join(ROOT, 'src', 'assets', 'models', 'human', 'fight.glb'))
PREVIEW = kw.get('PREVIEW')
FPS = 30
PFX = 'mixamorig:'
BODY = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
        'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
        'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']

# ------------------------------------------------------------------------------------------------ the rig
if kw.get('FROM'):
    bpy.ops.wm.open_mainfile(filepath=kw['FROM'])
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, bone_heuristic='BLENDER')
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
scene = bpy.context.scene
scene.render.fps = FPS
bpy.context.view_layer.objects.active = arm
PB = {n: arm.pose.bones[PFX + n] for n in BODY}
for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
upd = bpy.context.view_layer.update


def Rz(d): return Matrix.Rotation(math.radians(d), 3, 'Z')
def Rx(d): return Matrix.Rotation(math.radians(d), 3, 'X')
def Ry(d): return Matrix.Rotation(math.radians(d), 3, 'Y')
def turn(yaw=0, lean=0, roll=0):
    """yaw + to his left, lean + forward, roll + to his right (rig space)."""
    return Rz(yaw) @ Rx(-lean) @ Ry(roll)


def rest3(n): return PB[n].bone.matrix_local.to_3x3()
REST_HEAD = {n: PB[n].bone.head_local.copy() for n in BODY}


def set_rot(n, R, loc=None):
    """Bone n's orientation in rig space = R × its rest orientation (its head where it is, or at loc)."""
    pb = PB[n]
    M = (R @ rest3(n)).to_4x4()
    M.translation = loc if loc is not None else pb.matrix.to_translation()
    pb.matrix = M
    upd()


def spin(n, R):
    """Bone n turned by R (rig space) about its own head, from where it is now."""
    pb = PB[n]
    M = (R @ pb.matrix.to_3x3()).to_4x4()
    M.translation = pb.matrix.to_translation()
    pb.matrix = M
    upd()


def aim(n, child, target):
    """Bone n turned (the shortest way) so that its child's joint lies toward `target`."""
    h, c = PB[n].matrix.to_translation(), PB[child].matrix.to_translation()
    d0, d1 = (c - h).normalized(), (Vector(target) - h).normalized()
    spin(n, d0.rotation_difference(d1).to_matrix())


def ik(upper, lower, end, target, pole):
    """Two bones: the end joint put at `target`, the middle joint bent toward `pole` (a direction)."""
    S = PB[upper].matrix.to_translation()
    l1 = (REST_HEAD[lower] - REST_HEAD[upper]).length
    l2 = (REST_HEAD[end] - REST_HEAD[lower]).length
    T = Vector(target)
    d = T - S
    L = min(d.length, (l1 + l2) * 0.985)
    L = max(L, abs(l1 - l2) + 0.02)
    ax = d.normalized()
    T = S + ax * L
    a = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    h = math.sqrt(max(l1 * l1 - a * a, 0))
    p = Vector(pole)
    p = p - ax * p.dot(ax)
    p = p.normalized() if p.length > 1e-5 else ax.orthogonal().normalized()
    E = S + ax * a + p * h
    aim(upper, lower, E)
    aim(lower, end, T)


# THE GUARD (orthodox: his left side leads): the numbers every pose starts from
STAND_Z = REST_HEAD['Hips'].z
ANKLE_Z = REST_HEAD['LeftFoot'].z
G = dict(
    hips=(0.0, -0.02, -0.075), yaw=-24, lean=6, roll=0,          # hips: (dx, dy, dz) from standing; turned to his right
    spine=(-8, 6, 0),                                             # (yaw, lean, roll) more, over the three spine bones
    head=(0, 4),                                                  # (yaw, pitch down) — level, looking ahead
    lh=(-0.10, 0.33, 1.44), rh=(0.15, 0.17, 1.42),                # the fists (the wrists): the lead hand out, the rear by the jaw
    lpole=(-0.45, -0.1, -1), rpole=(0.5, -0.25, -1),              # the elbows down, a little out
    lf=(-0.15, 0.19, ANKLE_Z), rf=(0.17, -0.24, ANKLE_Z + 0.03),  # the ankles: the lead foot forward, the rear heel light
    lfyaw=-8, rfyaw=-42, lfpitch=0, rfpitch=10,                   # the feet: where they point (+ left), heel up (+)
    lknee=(-0.15, 1, 0.1), rknee=(0.45, 1, 0.1),
)


def pose(**o):
    """One whole pose: the guard with `o` over it."""
    P = dict(G); P.update(o)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0)
    upd()
    hx, hy, hz = P['hips']
    R = turn(P['yaw'], P['lean'], P['roll'])
    set_rot('Hips', R, REST_HEAD['Hips'] + Vector((hx, hy, hz)))
    sy, sl, sr = P['spine']
    for k, n in enumerate(['Spine', 'Spine1', 'Spine2']):
        f = (k + 1) / 3
        set_rot(n, turn(P['yaw'] + sy * f, P['lean'] + sl * f, P['roll'] + sr * f))
    # the legs: the ankles where they stand, the feet flat (or as told)
    for s, side in (('l', 'Left'), ('r', 'Right')):
        ik(side + 'UpLeg', side + 'Leg', side + 'Foot', P[s + 'f'], P[s + 'knee'])
        set_rot(side + 'Foot', Rz(P[s + 'fyaw']) @ Rx(-P[s + 'fpitch']))
        set_rot(side + 'ToeBase', Rz(P[s + 'fyaw']) @ Rx(-max(0.0, P[s + 'fpitch']) * 0.2))
    # the arms: the shoulders a little with the reach, the wrists where they must be
    for s, side in (('l', 'Left'), ('r', 'Right')):
        ik(side + 'Arm', side + 'ForeArm', side + 'Hand', P[s + 'h'], P[s + 'pole'])
        if (s + 'hand') in P: set_rot(side + 'Hand', P[s + 'hand'])
    # THE KATANA in his right fist (`blade`: the way it points, the way its edge goes): the hand turned to it — at rest
    # (the T-pose, the palm down) a held blade points forward (+Y) out of the thumb's side, its edge along the knuckles (+X)
    if 'blade' in P:
        d, e = blade_axes(*P['blade'])
        set_rot('RightHand', Matrix((e, d, e.cross(d))).transposed())
    hy_, hp = P['head']
    # (the neck half way between the chest and the head)
    set_rot('Neck', turn((P['yaw'] + sy + hy_) / 2, (P['lean'] + sl + hp) / 2, (P['roll'] + sr) / 2))
    set_rot('Head', turn(hy_, hp, P.get('headroll', 0)))


def blade_axes(d, m):
    """The blade's direction and its edge's (the way it moves, squared to the blade)."""
    d = Vector(d).normalized(); m = Vector(m)
    e = (m - d * m.dot(d)).normalized()
    return d, e


# the sword's grip in the right hand at rest (rig space): the palm's middle; its axes (see weapons.py: the blade +Y, the edge −Z)
GRIP = REST_HEAD['RightHand'] + Vector((0.085, 0.0, -0.025))
SWORD_REST = Matrix(((0, 0, -1), (0, 1, 0), (1, 0, 0)))   # the sword's (x, y, z) → the rig's (−z, y, x): its edge to +X


def sword_matrix():
    """Where the sword is, the rig posed (the previews; the game does the same from the hand bone)."""
    pb = PB['RightHand']
    D = pb.matrix @ pb.bone.matrix_local.inverted()
    R = SWORD_REST.to_4x4(); R.translation = GRIP
    return D @ R


LAST = {}


def key(f):
    """The pose as it stands, keyed at frame f (each quaternion on the same side as its last key: no long way round)."""
    for n in BODY:
        pb = PB[n]
        q = pb.rotation_quaternion.copy()
        if n in LAST and LAST[n].dot(q) < 0: q.negate()
        pb.rotation_quaternion = q
        LAST[n] = q
        pb.keyframe_insert('rotation_quaternion', frame=f)
    PB['Hips'].keyframe_insert('location', frame=f)


CLIPS = {}


def clip(name, keys, loop=False, hit=None):
    """A clip: [(frame, pose overrides)] — a new action on the rig."""
    LAST.clear()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if not arm.animation_data: arm.animation_data_create()
    arm.animation_data.action = act
    for f, o in keys:
        pose(**o)
        key(f)
    CLIPS[name] = dict(frames=keys[-1][0], loop=loop, hit=hit, keys=[f for f, _ in keys])


def build():
    # GUARD: a light bounce on the balls of his feet, the fists moving a little
    up = dict(hips=(0.0, -0.02, -0.055), lh=(-0.10, 0.335, 1.46), rh=(0.15, 0.175, 1.44), rfpitch=14)
    dn = dict(hips=(0.0, -0.025, -0.09), lh=(-0.105, 0.325, 1.425), rh=(0.15, 0.165, 1.405), rfpitch=8)
    clip('guard', [(0, {}), (9, up), (18, {}), (27, dn), (36, {})], loop=True)

    # JAB: the lead fist straight out and back; the lead shoulder in behind it, a short step of the weight
    clip('jab', [
        (0, {}),
        (2, dict(lh=(-0.12, 0.26, 1.45), yaw=-28)),
        (6, dict(lh=(-0.04, 0.80, 1.47), lpole=(-0.6, 0, -1), yaw=-38, spine=(-14, 10, 0), hips=(0.0, 0.05, -0.085), rh=(0.14, 0.15, 1.44), lf=(-0.15, 0.24, ANKLE_Z))),
        (8, dict(lh=(-0.04, 0.79, 1.47), lpole=(-0.6, 0, -1), yaw=-38, spine=(-14, 10, 0), hips=(0.0, 0.05, -0.085), rh=(0.14, 0.15, 1.44), lf=(-0.15, 0.24, ANKLE_Z))),
        (13, {}),
    ], hit=6)

    # CROSS: the rear fist thrown across with the hips — they turn through, the rear heel comes up, the lead hand home
    clip('cross', [
        (0, {}),
        (4, dict(yaw=-34, rh=(0.19, 0.10, 1.40), spine=(-12, 4, 0), hips=(0.0, -0.04, -0.09))),
        (9, dict(yaw=22, spine=(26, 14, -3), hips=(-0.03, 0.09, -0.10), rh=(-0.05, 0.86, 1.45), rpole=(0.7, 0, -0.8), lh=(-0.16, 0.14, 1.42), lpole=(-0.5, -0.4, -1), rf=(0.16, -0.20, ANKLE_Z + 0.07), rfpitch=42, rfyaw=-8, rknee=(0.1, 1, 0.0), head=(0, 6))),
        (11, dict(yaw=22, spine=(26, 14, -3), hips=(-0.03, 0.09, -0.10), rh=(-0.05, 0.85, 1.45), rpole=(0.7, 0, -0.8), lh=(-0.16, 0.14, 1.42), lpole=(-0.5, -0.4, -1), rf=(0.16, -0.20, ANKLE_Z + 0.07), rfpitch=42, rfyaw=-8, rknee=(0.1, 1, 0.0), head=(0, 6))),
        (17, {}),
    ], hit=9)

    # HOOK: the lead arm bent square, swung round level with the hips' turn
    clip('hook', [
        (0, {}),
        (4, dict(yaw=-44, spine=(-18, 6, 0), lh=(-0.30, 0.16, 1.43), lpole=(-1, -0.3, -0.2), hips=(0.02, -0.03, -0.10))),
        (8, dict(yaw=4, spine=(34, 8, 0), lh=(0.10, 0.42, 1.47), lpole=(-1, 0.1, 0.05), hips=(-0.02, 0.04, -0.09), lf=(-0.15, 0.19, ANKLE_Z + 0.04), lfpitch=22, lfyaw=26, lknee=(0.3, 1, 0), rh=(0.16, 0.13, 1.43))),
        (10, dict(yaw=8, spine=(38, 8, 0), lh=(0.16, 0.36, 1.47), lpole=(-1, 0.1, 0.05), hips=(-0.02, 0.04, -0.09), lf=(-0.15, 0.19, ANKLE_Z + 0.04), lfpitch=22, lfyaw=26, lknee=(0.3, 1, 0), rh=(0.16, 0.13, 1.43))),
        (17, {}),
    ], hit=8)

    # UPPERCUT: a dip on the rear side, then the rear fist driven up the middle with the legs
    clip('uppercut', [
        (0, {}),
        (5, dict(hips=(0.03, -0.03, -0.17), yaw=-34, lean=12, spine=(-10, 10, 6), rh=(0.22, 0.14, 1.06), rpole=(0.6, -1, -0.2), head=(0, 2))),
        (9, dict(hips=(-0.02, 0.06, -0.04), yaw=10, lean=-2, spine=(20, -6, -2), rh=(0.0, 0.42, 1.62), rpole=(0.5, -0.3, -1), lh=(-0.15, 0.16, 1.43), rf=(0.16, -0.21, ANKLE_Z + 0.07), rfpitch=40, rfyaw=-12, rknee=(0.15, 1, 0), head=(0, -4))),
        (11, dict(hips=(-0.02, 0.06, -0.03), yaw=12, lean=-2, spine=(20, -6, -2), rh=(-0.01, 0.40, 1.66), rpole=(0.5, -0.3, -1), lh=(-0.15, 0.16, 1.43), rf=(0.16, -0.21, ANKLE_Z + 0.07), rfpitch=40, rfyaw=-12, rknee=(0.15, 1, 0), head=(0, -4))),
        (18, {}),
    ], hit=9)

    # FRONT KICK (a push kick): the rear knee up, the leg thrust straight out at the belly, the body leaning back
    cham = dict(hips=(-0.04, 0.0, -0.05), yaw=-8, lean=-6, spine=(-4, 4, 0), rf=(0.10, 0.20, 0.62), rknee=(0.15, 1, 1), rfpitch=-20, rfyaw=0, lh=(-0.14, 0.26, 1.40), rh=(0.20, 0.10, 1.34), lfyaw=18)
    out = dict(hips=(-0.05, 0.03, -0.04), yaw=-4, lean=-20, spine=(-2, 6, 0), rf=(0.07, 0.86, 1.02), rknee=(0.1, 0.3, 1), rfpitch=-28, rfyaw=0, lh=(-0.18, 0.22, 1.36), rh=(0.30, -0.02, 1.22), rpole=(0.6, -1, -0.3), lfyaw=24, head=(0, 8))
    clip('kick_front', [(0, {}), (6, cham), (10, out), (12, out), (16, cham), (23, {})], hit=10)

    # ROUNDHOUSE: the hips turned right over, the rear leg swung round level, the standing foot pivoting, the arms out
    cham2 = dict(hips=(-0.05, 0.0, -0.04), yaw=30, lean=-4, roll=-10, spine=(-16, 0, -6), rf=(0.42, -0.02, 0.80), rknee=(1, 0.5, 0.6), rfpitch=-30, rfyaw=40, lfyaw=50, lf=(-0.15, 0.17, ANKLE_Z), lh=(-0.20, 0.24, 1.42), rh=(0.34, 0.0, 1.30), rpole=(0.6, -1, -0.2))
    out2 = dict(hips=(-0.07, 0.03, -0.03), yaw=78, lean=-8, roll=-24, spine=(-34, 0, -12), rf=(-0.10, 0.80, 1.12), rknee=(0.8, 0.5, 0.8), rfpitch=-38, rfyaw=86, lfyaw=96, lf=(-0.15, 0.17, ANKLE_Z + 0.02), lfpitch=8, lknee=(-0.8, 0.6, 0), lh=(-0.22, 0.20, 1.44), rh=(0.36, -0.22, 1.16), rpole=(0.3, -1, 0.2), head=(8, 4))
    clip('kick_round', [(0, {}), (6, cham2), (11, out2), (13, out2), (18, cham2), (26, {})], hit=11)

    # BLOCK: both forearms up in front of the face, the chin down behind them
    blk = dict(lh=(-0.07, 0.25, 1.56), rh=(0.08, 0.22, 1.55), lpole=(-0.25, -0.2, -1), rpole=(0.28, -0.2, -1), spine=(-8, 14, 0), hips=(0.0, -0.04, -0.11), head=(0, 14))
    clip('block', [(0, {}), (4, blk), (13, blk), (18, {})])

    # DODGE: the weight thrown onto the rear leg, the body leant back out of reach
    dod = dict(hips=(0.03, -0.17, -0.12), lean=-16, spine=(-8, -14, 0), lh=(-0.12, 0.20, 1.38), rh=(0.17, 0.02, 1.36), head=(0, 6), rknee=(0.6, 1, 0.1))
    clip('dodge', [(0, {}), (4, dod), (9, dod), (15, {})])

    # HIT IN THE HEAD: the head snapped back and round, the guard broken open, a half step back
    hh = dict(hips=(0.03, -0.12, -0.06), lean=-12, spine=(10, -20, 6), head=(-34, -22), headroll=10, lh=(-0.26, 0.30, 1.30), rh=(0.30, 0.14, 1.26), lpole=(-0.8, -0.3, -1), rpole=(0.8, -0.3, -1), rf=(0.18, -0.34, ANKLE_Z), rfpitch=0)
    hh2 = dict(hips=(0.02, -0.10, -0.09), lean=-4, spine=(4, -6, 3), head=(-12, -4), lh=(-0.18, 0.30, 1.38), rh=(0.22, 0.16, 1.36), rf=(0.18, -0.34, ANKLE_Z), rfpitch=0)
    clip('hit_head', [(0, {}), (3, hh), (8, hh2), (16, {})])

    # HIT IN THE BODY: doubled over it, the arms in, the hips back
    hb = dict(hips=(0.0, -0.16, -0.14), lean=22, spine=(4, 40, 0), head=(0, 30), lh=(-0.10, 0.20, 1.02), rh=(0.12, 0.16, 1.00), lpole=(-1, -0.6, 0), rpole=(1, -0.6, 0))
    hb2 = dict(hips=(0.0, -0.13, -0.12), lean=14, spine=(2, 26, 0), head=(0, 16), lh=(-0.11, 0.24, 1.16), rh=(0.13, 0.18, 1.14), lpole=(-1, -0.6, -0.3), rpole=(1, -0.6, -0.3))
    clip('hit_body', [(0, {}), (4, hb), (9, hb), (13, hb2), (19, {})])

    # KNOCKDOWN: reeling, off his feet, down on his back — it ends lying there (the game's getup_back gets him up)
    reel = dict(hips=(0.02, -0.16, -0.05), lean=-22, spine=(6, -26, 4), head=(-20, -26), lh=(-0.42, 0.20, 1.44), rh=(0.46, 0.10, 1.40), lpole=(-1, -0.5, -0.4), rpole=(1, -0.5, -0.4), rf=(0.18, -0.42, ANKLE_Z), rfpitch=0, lf=(-0.15, 0.10, ANKLE_Z + 0.05), lfpitch=-14)
    fall = dict(hips=(0.0, -0.50, -0.42), yaw=-6, lean=-56, spine=(0, 10, 0), head=(0, 6), lh=(-0.50, -0.10, 1.04), rh=(0.52, -0.16, 1.00), lpole=(-1, 0.3, -0.5), rpole=(1, 0.3, -0.5), lf=(-0.16, 0.20, 0.34), rf=(0.17, 0.06, 0.24), lfpitch=-22, rfpitch=-18, lfyaw=-6, rfyaw=10, lknee=(-0.2, 0.2, 1), rknee=(0.2, 0.2, 1))
    hip_z = 0.125 - STAND_Z
    down = dict(hips=(0.0, -0.86, hip_z + 0.02), yaw=-3, lean=-88, spine=(0, 2, 0), head=(0, -80), lh=(-0.58, -1.16, 0.10), rh=(0.60, -1.12, 0.10), lpole=(-1, 0.4, 0.3), rpole=(1, 0.4, 0.3), lf=(-0.20, -0.04, 0.17), rf=(0.22, -0.02, 0.26), lfpitch=-60, rfpitch=-50, lfyaw=-18, rfyaw=22, lknee=(-0.3, 0, 1), rknee=(0.3, 0, 1))
    lie = dict(hips=(0.0, -0.88, hip_z), yaw=-3, lean=-90, spine=(0, 0, 0), head=(0, -86), lh=(-0.60, -1.14, 0.07), rh=(0.62, -1.10, 0.07), lpole=(-1, 0.4, 0.3), rpole=(1, 0.4, 0.3), lf=(-0.22, -0.03, 0.09), rf=(0.24, 0.0, 0.09), lfpitch=-70, rfpitch=-70, lfyaw=-24, rfyaw=26, lknee=(-0.4, 0, 1), rknee=(0.4, 0, 1))
    clip('knockdown', [(0, {}), (4, reel), (10, fall), (15, down), (19, lie), (30, lie)])

    # TAUNT: the arms thrown wide and low, the chest out — "come on, then"
    wide = dict(hips=(0.0, 0.02, -0.03), yaw=-8, lean=-4, spine=(4, -10, 0), head=(0, -8), lh=(-0.62, 0.22, 1.02), rh=(0.62, 0.20, 1.02), lpole=(-0.6, -1, 0.2), rpole=(0.6, -1, 0.2), rfpitch=0, rf=(0.20, -0.14, ANKLE_Z))
    wide2 = dict(wide, lh=(-0.60, 0.30, 1.10), rh=(0.60, 0.28, 1.10), hips=(0.0, 0.04, -0.02))
    clip('taunt', [(0, {}), (8, wide), (14, wide2), (20, wide), (26, wide2), (32, wide), (42, {})])


def build_katana():
    # THE KATANA'S STANCE (the middle guard): the right foot forward, both hands low in front, the point at the throat
    K = dict(hips=(0.0, 0.0, -0.06), yaw=14, lean=4, spine=(-6, 4, 0), head=(0, 3),
             lf=(-0.15, -0.22, ANKLE_Z + 0.03), rf=(0.13, 0.20, ANKLE_Z), lfyaw=34, rfyaw=4, lfpitch=10, rfpitch=0, lknee=(-0.45, 1, 0.1), rknee=(0.15, 1, 0.1),
             rh=(0.03, 0.30, 1.06), rpole=(0.6, -0.6, -1), lpole=(-0.6, -0.6, -1), blade=((0, 0.74, 0.67), (0, 0.67, -0.74)))

    def k(**o):
        P = dict(K); P.update(o)
        # (the left hand under the right on the grip — the game puts it there exactly: Character.hands)
        d = Vector(P['blade'][0]).normalized()
        if 'lh' not in o: P['lh'] = tuple(Vector(P['rh']) - d * 0.12 + Vector((-0.03, 0, 0)))
        return P
    T = 1.5   # frames a tick (30 a second, 20 ticks)
    sway = k(rh=(0.03, 0.305, 1.075), hips=(0.0, 0.0, -0.05))
    clip('katana_idle', [(0, k()), (18, sway), (36, k())], loop=True)
    # the DRAW: the hand to the left hip, out and up into the guard
    clip('katana_draw', [(0, k(rh=(-0.20, 0.10, 0.99), blade=((-0.25, -0.92, -0.30), (0, -0.3, 0.95)), yaw=24, spine=(14, 6, 0))),
                         (6, k(rh=(-0.06, 0.34, 1.10), blade=((-0.55, 0.30, 0.78), (0.6, 0.7, 0.2)), yaw=18)), (15, k())])
    # CUT 1 — rising from the left hip to the right shoulder
    w1 = k(rh=(-0.24, 0.14, 0.98), blade=((-0.50, -0.55, -0.67), (0.6, 0.5, 0.6)), yaw=40, spine=(22, 8, 4), hips=(0.0, -0.02, -0.10))
    e1 = k(rh=(0.10, 0.50, 1.30), blade=((0.25, 0.80, 0.55), (0.75, 0.2, 0.62)), yaw=4, spine=(-8, 6, 0), hips=(0.0, 0.06, -0.07))
    f1 = k(rh=(0.34, 0.36, 1.58), blade=((0.62, 0.20, 0.76), (0.6, -0.3, 0.3)), yaw=-22, spine=(-26, 0, -4), hips=(0.0, 0.07, -0.05))
    clip('cut1', [(0, k()), (2 * T, w1), (3 * T, e1), (4 * T, f1), (5.5 * T, f1), (8 * T, k())], hit=3 * T)
    # CUT 2 — back across, right to left, level
    w2 = k(rh=(0.36, 0.16, 1.38), blade=((0.72, -0.52, 0.46), (-0.3, 0.9, 0.0)), yaw=-30, spine=(-30, 2, 0), hips=(0.0, -0.01, -0.08))
    e2 = k(rh=(0.04, 0.54, 1.32), blade=((0.20, 0.97, 0.10), (-1, 0.2, 0)), yaw=6, spine=(4, 8, 0), hips=(0.0, 0.07, -0.08))
    f2 = k(rh=(-0.30, 0.34, 1.28), blade=((-0.80, 0.56, 0.20), (-0.6, -0.8, 0)), yaw=34, spine=(30, 8, 0), hips=(0.0, 0.08, -0.08))
    clip('cut2', [(0, k()), (2 * T, w2), (3 * T, e2), (4 * T, f2), (5.5 * T, f2), (8 * T, k())], hit=3 * T)
    # CUT 3 — down from overhead, a step in
    w3 = k(rh=(0.04, 0.06, 1.84), blade=((0, -0.62, 0.78), (0, 0.78, 0.62)), yaw=6, lean=-4, spine=(-2, -10, 0), hips=(0.0, -0.03, -0.04), head=(0, -2))
    e3 = k(rh=(0.03, 0.56, 1.42), blade=((0, 0.80, 0.60), (0, 0.6, -0.8)), yaw=8, lean=10, spine=(-2, 10, 0), hips=(0.0, 0.18, -0.10), rf=(0.13, 0.42, ANKLE_Z), lfpitch=26)
    f3 = k(rh=(0.03, 0.56, 0.98), blade=((0, 0.96, -0.28), (0, -0.28, -0.96)), yaw=8, lean=18, spine=(-2, 18, 0), hips=(0.0, 0.22, -0.17), rf=(0.13, 0.44, ANKLE_Z), lfpitch=32, head=(0, 8))
    clip('cut3', [(0, k()), (3 * T, w3), (4 * T, e3), (5 * T, f3), (7 * T, f3), (11 * T, k())], hit=4 * T)
    # THE HEAVY CUT — coiled to the right, a lunge and a level sweep right round to the left
    wh = k(rh=(0.38, -0.02, 1.22), blade=((0.50, -0.83, 0.24), (-0.8, -0.5, 0)), yaw=-56, spine=(-34, 6, 0), hips=(0.03, -0.08, -0.16), lean=8)
    eh = k(rh=(0.10, 0.62, 1.22), blade=((0.30, 0.95, 0.06), (-1, 0.3, 0)), yaw=0, spine=(6, 12, 0), hips=(0.0, 0.24, -0.16), lean=12, rf=(0.13, 0.50, ANKLE_Z), lfpitch=30)
    fh = k(rh=(-0.40, 0.28, 1.24), blade=((-0.90, -0.38, 0.20), (0.3, -0.95, 0)), yaw=62, spine=(40, 10, 0), hips=(-0.02, 0.26, -0.15), lean=10, rf=(0.13, 0.50, ANKLE_Z), lfpitch=30, lfyaw=60)
    clip('cut_heavy', [(0, k()), (5 * T, wh), (6.5 * T, eh), (8 * T, fh), (10 * T, fh), (16 * T, k())], hit=6.5 * T)
    # THE ABILITY woken: the blade stood upright before the face, held, back to the guard
    up = k(rh=(0.03, 0.26, 1.28), blade=((0, 0.04, 1.0), (0, 1, 0)), hips=(0.0, 0.0, -0.03), yaw=6, spine=(-2, 0, 0))
    clip('katana_wake', [(0, k()), (5, up), (13, up), (18, k())])


if kw.get('FROM'):
    meta = json.loads(arm.get('fight_clips', '{}'))
    CLIPS.update(meta)
else:
    build()
    build_katana()
    arm['fight_clips'] = json.dumps(CLIPS)
if kw.get('BLEND'):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(kw['BLEND']))

# ------------------------------------------------------------------------------------------------ read back, write
with open(SRC, 'rb') as f:
    d = f.read()
jl = struct.unpack('<I', d[12:16])[0]
J = json.loads(d[20:20 + jl])
node_of = {n['name']: i for i, n in enumerate(J['nodes']) if 'name' in n}
parent = {c: i for i, n in enumerate(J['nodes']) for c in n.get('children', [])}


def gq(v): return Quaternion((v[3], v[0], v[1], v[2]))   # glTF (x y z w) → mathutils (w x y z)


# the game's rest pose (glTF space): each body bone's own turn and its turn in the model
g_local = {n: gq(J['nodes'][node_of[PFX + n]].get('rotation', [0, 0, 0, 1])) for n in BODY}
g_parent = {}
for n in BODY:
    p = parent.get(node_of[PFX + n])
    pn = J['nodes'][p]['name'] if p is not None else ''
    g_parent[n] = pn[len(PFX):] if pn.startswith(PFX) and pn[len(PFX):] in BODY else None
g_world = {}
for n in BODY: g_world[n] = (g_world[g_parent[n]] @ g_local[n]) if g_parent[n] else g_local[n]


def b2g(q): return Quaternion((q.w, q.x, q.z, -q.y))     # a turn in Blender's space (z up) → glTF's (y up)


def set_action(name):
    arm.animation_data.action = bpy.data.actions[name]
    ad = arm.animation_data
    # (Blender 4.4+: an action's slot must be picked for it to drive the rig)
    if hasattr(ad, 'action_suitable_slots') and ad.action_suitable_slots: ad.action_slot = ad.action_suitable_slots[0]


def sample(name):
    set_action(name)
    n_f = int(math.ceil(CLIPS[name]['frames'])) + 1
    rot = {n: [] for n in BODY}
    hips = []
    last = {}
    for f in range(n_f):
        scene.frame_set(f)
        upd()
        W = {}
        for n in BODY:
            pb = PB[n]
            D = (pb.matrix.to_3x3() @ rest3(n).inverted()).to_quaternion()   # its turn from rest, rig space
            W[n] = b2g(D) @ g_world[n]
            q = (W[g_parent[n]].inverted() @ W[n]) if g_parent[n] else W[n]
            q.normalize()
            if n in last and last[n].dot(q) < 0: q.negate()
            last[n] = q.copy()
            rot[n] += [q.x, q.y, q.z, q.w]
        h = PB['Hips'].matrix.to_translation()
        hips += [h.x, h.z, -h.y]
    return n_f, rot, hips


def preview(name):
    """Stills of the clip's key poses."""
    os.makedirs(PREVIEW, exist_ok=True)
    set_action(name)
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = 420; scene.render.resolution_y = 480
    scene.render.film_transparent = False
    if not scene.camera:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        scene.collection.objects.link(cam)
        scene.camera = cam
        cam.data.lens = 50
    cam = scene.camera
    cam.location = (3.4, 3.0, 1.25)   # (from his front right)
    look = Vector((0, 0.1, 0.95)) - Vector(cam.location)
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    sword = bpy.data.objects.get('katana_fire')
    if sword is None and os.path.exists(os.path.join(ROOT, 'src', 'assets', 'models', 'weapons', 'katana_fire.glb')):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'src', 'assets', 'models', 'weapons', 'katana_fire.glb'))
        for o in set(bpy.data.objects) - before:
            if o.name.startswith('glow'): o.hide_render = True
            else: sword = o; o.name = 'katana_fire'
        bpy.context.view_layer.objects.active = arm
    if sword: sword.hide_render = not (name.startswith('cut') or name.startswith('katana'))
    keys = CLIPS[name]['keys']
    for f in (keys[:-1] if (name.startswith('cut') or name.startswith('katana')) else (keys[1:-1] or keys[:1])):
        scene.frame_set(int(f), subframe=f - int(f)); upd()
        if sword and not sword.hide_render: sword.matrix_world = sword_matrix()
        scene.render.filepath = os.path.join(PREVIEW, f'{name}_{int(f * 10):03d}.png')
        bpy.ops.render.render(write_still=True)


nodes = [{'name': PFX + n} for n in BODY]
info = {}
accessors, views, blob, anims = [], [], bytearray(), []


def add(arr, typ, minmax=False):
    b = struct.pack(f'<{len(arr)}f', *arr)
    views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(b)})
    blob.extend(b)
    n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[typ]
    a = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': len(arr) // n, 'type': typ}
    if minmax: a['min'] = [min(arr)]; a['max'] = [max(arr)]
    accessors.append(a)
    return len(accessors) - 1


for name in CLIPS:
    if name not in bpy.data.actions: continue
    n_f, rot, hips = sample(name)
    t = add([f / FPS for f in range(n_f)], 'SCALAR', True)
    samplers, channels = [], []
    for k, n in enumerate(BODY):
        samplers.append({'input': t, 'output': add(rot[n], 'VEC4'), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': k, 'path': 'rotation'}})
    samplers.append({'input': t, 'output': add(hips, 'VEC3'), 'interpolation': 'LINEAR'})
    channels.append({'sampler': len(samplers) - 1, 'target': {'node': 0, 'path': 'translation'}})
    anims.append({'name': name, 'samplers': samplers, 'channels': channels})
    c = CLIPS[name]
    info[name] = {'loop': bool(c['loop']), 'speed': 0, 'frames': n_f, **({'hit': round(c['hit'] / FPS, 4)} if c.get('hit') else {})}
    if PREVIEW: preview(name)

nodes.append({'name': 'skeleton', 'children': list(range(len(BODY))), 'extras': {'clips': json.dumps(info)}})
gltf = {'asset': {'version': '2.0', 'generator': 'overhill scripts/oth/fight.py (Blender %s)' % bpy.app.version_string},
        'scene': 0, 'scenes': [{'nodes': [len(nodes) - 1]}], 'nodes': nodes, 'animations': anims,
        'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
while len(blob) % 4: blob.append(0)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(bytes(blob))
print('FIGHT CLIPS:', ', '.join(f"{n} {info[n]['frames'] / FPS:.2f}s" for n in info), '->', OUT, f'({(20 + len(js) + 8 + len(blob)) / 1024:.0f} kB)')
