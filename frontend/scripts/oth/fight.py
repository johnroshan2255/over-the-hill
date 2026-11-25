# THE FIGHT CLIPS (2026-11-19, the user: "make punching and kicking and a lot of animation in Blender and use it") — made
# here in Blender on the game's own skeleton (character.glb's 22 Mixamo body bones), keyframed pose by pose, and written
# to src/assets/models/human/fight.glb: animations only, the game's Character.loadClips reads them by bone name.
#
#   blender -b --factory-startup --python scripts/oth/fight.py -- [OUT=src/assets/models/human/fight.glb]
#           [PREVIEW=<dir>]   a film strip of every clip (Workbench), <dir>/<clip>.png — [ONLY=jab,cross] those only,
#                             [VIEW=side] from his right, square on
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
# SET=rope (2026-11-25): THE TOW ROPE's clips instead, to src/assets/models/human/rope.glb — standing, not the guard:
#   hook_take (the winch's hook taken off your own bumper and the line drawn out), hook_attach (down on a knee at another
#   car's recovery point, the hook clipped on, a tug to try it, up again), hook_detach (the same, unclipped and taken
#   back), hook_stow (hung back on your own winch). Each ends where the next begins: CARRY (the hook in the right
#   hand before the hip) or STAND. `build_rope`, below.
#
# THE CLIPS (each starts and ends in the guard, so they chain): guard (loop); the punches — jab, cross, hook,
# uppercut, body_hook; the legs — knee, kick_front, kick_round, kick_low; the defence — block, block_hit, dodge, duck;
# a blow taken — hit_head, hit_head_l, hit_head_r, hit_body, hit_leg, stagger; down — knockdown (ends on his back: the
# game's getup_back takes over), die_back, die_fwd (ends on his face); taunt. How they MOVE: "the motion", below.
import bpy, sys, os, json, math, struct
from mathutils import Matrix, Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
kw = dict(a.split('=', 1) for a in argv if '=' in a)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'src', 'assets', 'models', 'human', 'character.glb')
ROPE = kw.get('SET') == 'rope'
OUT = kw.get('OUT', os.path.join(ROOT, 'src', 'assets', 'models', 'human', 'rope.glb' if ROPE else 'fight.glb'))
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
    hy_, hp = P['head']
    # (the neck half way between the chest and the head)
    set_rot('Neck', turn((P['yaw'] + sy + hy_) / 2, (P['lean'] + sl + hp) / 2, (P['roll'] + sr) / 2))
    set_rot('Head', turn(hy_, hp, P.get('headroll', 0)))


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

# ------------------------------------------------------------------------------------------------ the motion
# (2026-11-21, the user: "the action and animation need more, it must feel real … make it custom using Blender".
#  The first clips were four or five poses a move with Blender's own ease between them: everything started and
#  stopped together, the fist no faster at the jaw than leaving the guard — and the hook swung against the body's
#  turn. A move is still WRITTEN as a few poses; what is made of them is this:)
#
#   EVERY FRAME is worked out and keyed — nothing is left to a curve.
#   THE BODY LEADS THE HAND (`LAG`): each part of the pose is read a little ahead of or behind the clip's clock —
#     the feet and the hips first, the spine after them, the fist on the clock, the head last. A punch is thrown from
#     the floor; a blow TAKEN runs the other way (`REACT`: the head first, the feet last).
#   HOW A POSE IS COME TO (its third value): 'in' — gathering speed all the way, fastest as it gets there (a strike
#     arriving); 'out' — away fast, eased to rest (a recovery, a body thrown back); 'spring' — past it and back (a
#     guard snapping home); 's' — eased both ends; 'lin'.
#   HANDS, FEET AND HIPS TRAVEL ON CURVES through the poses either side (a strike's own leg, 'in', goes straight).
#   A GUARD BREATHES (`breath`): the loops rise and fall, sway and turn a little, on whole cycles.
EASE = {
    's': lambda u: u * u * (3 - 2 * u),
    'in': lambda u: u ** 2.3,
    'out': lambda u: 1 - (1 - u) ** 2.6,
    'lin': lambda u: u,
    'spring': lambda u: (1 - math.exp(-5.5 * u) * math.cos(8.5 * u)) / (1 - math.exp(-5.5) * math.cos(8.5)),
}
CURVED = ('lh', 'rh', 'lf', 'rf', 'hips')
LEGS = ('lf', 'rf', 'lfyaw', 'rfyaw', 'lfpitch', 'rfpitch', 'lknee', 'rknee')
# (frames each part runs ahead (−) of / behind (+) the clock)
LAG = dict({k: -1.0 for k in LEGS}, hips=-0.8, yaw=-0.8, lean=-0.5, roll=-0.5, spine=-0.3, head=0.7, headroll=0.7)
REACT = dict({k: 0.8 for k in LEGS}, head=-1.0, headroll=-1.0, spine=-0.5, lean=-0.2, roll=-0.2, hips=0.2, yaw=0.2, lh=0.9, rh=0.9, lpole=0.9, rpole=0.9)
NOLAG = {}


def flat(v):
    """A pose value as a flat list of numbers (a number, a vector, a pair of vectors)."""
    if isinstance(v, (int, float)): return [float(v)]
    out = []
    for x in v: out += flat(x)
    return out


def shaped(like, a):
    """`a` (a flat list) back in the shape of `like`."""
    if isinstance(like, (int, float)): return a[0]
    if isinstance(like[0], (int, float)): return tuple(a)
    n = len(flat(like[0]))
    return tuple(tuple(a[i * n:(i + 1) * n]) for i in range(len(like)))


def anim(name, base, keys, loop=False, hit=None, lag=LAG, breath=0.0):
    """A clip: keys [(frame, pose overrides, how it's come to)] over the pose `base` — every frame worked out, posed
    and keyed. `breath`: the loop's rise and fall (m)."""
    LAST.clear()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if not arm.animation_data: arm.animation_data_create()
    arm.animation_data.action = act
    K = []
    for k in keys:
        P = dict(base); P.update(k[1])
        K.append((float(k[0]), P, k[2] if len(k) > 2 else 's'))
    F = int(math.ceil(K[-1][0]))
    chans = list(K[0][1].keys())
    V = {c: [flat(P[c]) for _, P, _ in K] for c in chans}
    T = [t for t, _, _ in K]

    def at(c, t):
        t = max(T[0], min(T[-1], t))
        i = max(0, min(len(T) - 2, max(k for k in range(len(T)) if T[k] <= t)))
        t0, t1 = T[i], T[i + 1]
        how = K[i + 1][2]
        u = EASE[how]((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
        a, b = V[c][i], V[c][i + 1]
        if c in CURVED and how in ('s', 'lin') and len(T) > 2:
            # (a curve through the poses either side: each end's way taken from its neighbours, by the time between)
            p0 = V[c][max(0, i - 1)]; p3 = V[c][min(len(T) - 1, i + 2)]
            ta = T[max(0, i - 1)]; tb = T[min(len(T) - 1, i + 2)]
            m0 = [(b[k] - p0[k]) / max(1e-6, t1 - ta) * (t1 - t0) * 0.5 for k in range(len(a))] if i > 0 else [b[k] - a[k] for k in range(len(a))]
            m1 = [(p3[k] - a[k]) / max(1e-6, tb - t0) * (t1 - t0) * 0.5 for k in range(len(a))] if i + 2 < len(T) else [b[k] - a[k] for k in range(len(a))]
            h00 = 2 * u ** 3 - 3 * u ** 2 + 1; h10 = u ** 3 - 2 * u ** 2 + u; h01 = -2 * u ** 3 + 3 * u ** 2; h11 = u ** 3 - u ** 2
            return [h00 * a[k] + h10 * m0[k] + h01 * b[k] + h11 * m1[k] for k in range(len(a))]
        return [a[k] + (b[k] - a[k]) * u for k in range(len(a))]

    for f in range(F + 1):
        # (the lead and the lag die away at the clip's two ends: it starts and ends on its poses exactly)
        w = 0.0 if loop else max(0.0, min(1.0, f / 3.0, (F - f) / 3.0))
        P = {c: shaped(K[0][1][c], at(c, f - lag.get(c, 0.0) * w)) for c in chans}
        if breath:
            ph = 2 * math.pi * f / F
            hx, hy, hz = P['hips']
            P['hips'] = (hx + 0.004 * math.sin(ph), hy + 0.003 * math.sin(ph * 2 + 1.0), hz + breath * math.sin(ph * 2))
            sy, sl, sr = P['spine']
            P['spine'] = (sy + 1.2 * math.sin(ph + 0.6), sl + 1.4 * math.sin(ph * 2 + 0.4), sr)
        pose(**P)
        key(f)
    CLIPS[name] = dict(frames=F, loop=loop, hit=hit, keys=[t for t in T])


G['headroll'] = 0
A = ANKLE_Z


def build():
    # THE GUARD (orthodox, on the balls of his feet): the lead fist out before the chin, the rear by the cheek, the
    # elbows in, the chin down
    G.update(hips=(0.0, -0.02, -0.09), lh=(-0.10, 0.33, 1.47), rh=(0.15, 0.17, 1.46), head=(0, 6), spine=(-8, 8, 0), rfpitch=12)
    up = dict(hips=(0.004, -0.018, -0.07), lh=(-0.098, 0.338, 1.485), rh=(0.150, 0.176, 1.475), rfpitch=17, lfpitch=3)
    dn = dict(hips=(-0.004, -0.024, -0.105), lh=(-0.104, 0.324, 1.455), rh=(0.152, 0.166, 1.448), rfpitch=9)
    anim('guard', G, [(0, {}), (9, up), (18, {}), (27, dn), (36, {})], loop=True, lag=NOLAG, breath=0.0)

    # ---- THE PUNCHES -------------------------------------------------------------------------------------------
    # JAB: off the rear foot — a short step of the lead, the lead shoulder rolled up in behind the fist, the fist
    # turned over as it lands; back quicker than it went
    jl = dict(lh=(-0.112, 0.30, 1.465), yaw=-27, hips=(0.006, -0.03, -0.095), lpole=(-0.45, -0.2, -1))
    jx = dict(lh=(-0.03, 0.865, 1.50), lpole=(-0.75, 0.0, -0.62), yaw=-43, spine=(-17, 9, -3), hips=(-0.012, 0.085, -0.105),
              rh=(0.135, 0.16, 1.475), lf=(-0.15, 0.29, A), rf=(0.17, -0.235, A + 0.035), rfpitch=24, head=(5, 9), lknee=(-0.1, 1, 0.1))
    jr = dict(lh=(-0.10, 0.38, 1.47), yaw=-28, spine=(-10, 8, 0), hips=(0.0, 0.0, -0.085), lf=(-0.15, 0.215, A))
    anim('jab', G, [(0, {}), (2, jl, 'out'), (5, jx, 'in'), (6, dict(jx, lh=(-0.03, 0.875, 1.50)), 'lin'), (10, jr, 'out'), (14, {}, 'spring')], hit=5)

    # CROSS: the rear fist thrown with the whole right side — the rear heel turns out and up, the knee and the hip go
    # through, the shoulders past them; the weight lands on the lead leg, the lead hand home on the chin
    cl = dict(yaw=-35, hips=(0.02, -0.05, -0.10), rh=(0.185, 0.12, 1.45), spine=(-9, 5, 2), rfpitch=6)
    cx = dict(yaw=24, spine=(31, 13, -4), hips=(-0.04, 0.115, -0.125), rh=(-0.06, 0.905, 1.50), rpole=(0.78, 0.05, -0.6),
              lh=(-0.145, 0.135, 1.465), lpole=(-0.5, -0.5, -1), rf=(0.15, -0.19, A + 0.075), rfpitch=47, rfyaw=-3, rknee=(0.02, 1, -0.15),
              lknee=(-0.2, 1, 0.1), head=(-3, 9))
    cr = dict(yaw=-8, spine=(6, 9, -1), hips=(-0.012, 0.03, -0.095), rh=(0.10, 0.37, 1.47), rf=(0.17, -0.225, A + 0.04), rfpitch=26, rfyaw=-28, lh=(-0.12, 0.26, 1.465))
    anim('cross', G, [(0, {}), (3, cl, 'out'), (7, cx, 'in'), (8, dict(cx, rh=(-0.065, 0.92, 1.50)), 'lin'), (13, cr, 'out'), (18, {}, 'spring')], hit=7)

    # HOOK (the lead hand): opened a little to the left with the weight on the lead leg — then the lead foot's heel
    # turned out, the hips and the shoulders whipped to the RIGHT, the arm held square and level behind them
    hl = dict(yaw=-9, hips=(-0.03, 0.02, -0.115), spine=(9, 5, -3), lh=(-0.285, 0.225, 1.43), lpole=(-1, -0.15, -0.35))
    hx = dict(yaw=-62, spine=(-31, 6, 2), hips=(0.03, 0.0, -0.105), lh=(0.10, 0.465, 1.50), lpole=(-0.9, 0.5, 0.3),
              lf=(-0.15, 0.19, A + 0.035), lfyaw=-58, lfpitch=20, lknee=(0.35, 1, 0), rh=(0.16, 0.14, 1.475), head=(9, 7))
    hf = dict(hx, yaw=-70, lh=(0.185, 0.40, 1.49), spine=(-36, 6, 2))
    hr = dict(yaw=-36, spine=(-14, 8, 0), hips=(0.01, -0.01, -0.095), lh=(-0.05, 0.31, 1.47), lfyaw=-24, lfpitch=8, lf=(-0.15, 0.19, A + 0.01))
    anim('hook', G, [(0, {}), (3, hl, 'out'), (7, hx, 'in'), (8, hf, 'lin'), (13, hr, 'out'), (18, {}, 'spring')], hit=7)

    # UPPERCUT (the rear hand): a dip on the rear side, the fist dropped palm-up by the ribs — then driven up the
    # middle by the legs and the hip, the heel coming off the ground
    ul = dict(hips=(0.03, -0.02, -0.205), yaw=-37, lean=11, roll=8, spine=(-8, 10, 8), rh=(0.20, 0.165, 1.10), rpole=(0.5, -1, 0.15), head=(0, 5), lh=(-0.11, 0.30, 1.42))
    ux = dict(hips=(-0.03, 0.075, -0.03), yaw=7, lean=-4, roll=-2, spine=(23, -8, -2), rh=(-0.02, 0.445, 1.59), rpole=(0.5, -0.5, -1),
              lh=(-0.15, 0.15, 1.46), rf=(0.16, -0.20, A + 0.08), rfpitch=45, rfyaw=-10, rknee=(0.1, 1, -0.1), head=(0, -3))
    uf = dict(ux, rh=(-0.03, 0.40, 1.70), hips=(-0.03, 0.08, -0.015))
    ur = dict(hips=(-0.01, 0.02, -0.08), yaw=-12, spine=(4, 4, 0), rh=(0.11, 0.30, 1.50), rf=(0.17, -0.225, A + 0.04), rfpitch=24)
    anim('uppercut', G, [(0, {}), (4, ul, 'out'), (8, ux, 'in'), (9, uf, 'lin'), (14, ur, 'out'), (19, {}, 'spring')], hit=8)

    # BODY HOOK (the lead hand to the ribs): the hook, a level lower — the knees bent, the fist round under the elbow
    bl = dict(yaw=-10, hips=(-0.03, 0.02, -0.21), lean=8, spine=(8, 10, -6), lh=(-0.29, 0.20, 1.12), lpole=(-1, -0.4, -0.2), head=(0, 4))
    bx = dict(yaw=-60, hips=(0.03, 0.03, -0.20), lean=8, spine=(-30, 10, 4), lh=(0.08, 0.46, 1.14), lpole=(-0.9, 0.3, -0.1),
              lf=(-0.15, 0.19, A + 0.03), lfyaw=-52, lfpitch=18, lknee=(0.3, 1, 0), rh=(0.16, 0.14, 1.47), head=(8, 10))
    br = dict(yaw=-34, hips=(0.01, 0.0, -0.13), spine=(-12, 9, 0), lh=(-0.06, 0.30, 1.38), lfyaw=-22, lfpitch=6)
    anim('body_hook', G, [(0, {}), (4, bl, 'out'), (8, bx, 'in'), (9, dict(bx, lh=(0.15, 0.42, 1.14)), 'lin'), (14, br, 'out'), (19, {}, 'spring')], hit=8)

    # ---- THE LEGS ----------------------------------------------------------------------------------------------
    # KNEE: both hands out to take the head, pulled down onto the rear knee as the hips drive it up
    kg = dict(lh=(-0.11, 0.56, 1.54), rh=(0.11, 0.54, 1.54), lpole=(-0.5, -0.3, -1), rpole=(0.5, -0.3, -1), hips=(0.0, 0.06, -0.07), yaw=-10, spine=(-2, 6, 0))
    kx = dict(lh=(-0.09, 0.36, 1.28), rh=(0.10, 0.34, 1.28), lpole=(-0.7, -0.4, -0.6), rpole=(0.7, -0.4, -0.6), hips=(-0.04, 0.19, -0.03), yaw=-2, lean=-16, spine=(0, 14, 0),
              rf=(0.07, 0.28, 0.80), rknee=(0.08, 1, 0.75), rfpitch=-38, rfyaw=0, lfpitch=14, lf=(-0.15, 0.19, A + 0.03), lfyaw=10, head=(0, 12))
    kr = dict(hips=(-0.02, 0.04, -0.07), rf=(0.13, 0.02, 0.36), rknee=(0.2, 1, 0.5), rfpitch=-10, rfyaw=-20, lh=(-0.11, 0.32, 1.44), rh=(0.14, 0.20, 1.44))
    anim('knee', G, [(0, {}), (3, kg, 'out'), (8, kx, 'in'), (10, kx, 'lin'), (15, kr, 'out'), (21, {}, 's')], hit=8)

    # FRONT KICK (a push kick, the rear leg): the knee brought up high, the hips thrown in behind the heel, the body
    # back to balance it; the leg folded again before it comes down
    fc = dict(hips=(-0.055, 0.02, -0.04), yaw=-8, lean=-7, spine=(-4, 6, 0), rf=(0.10, 0.22, 0.72), rknee=(0.1, 1, 0.9), rfpitch=-12, rfyaw=0,
              lh=(-0.14, 0.28, 1.45), rh=(0.22, 0.08, 1.38), lfyaw=18, lfpitch=4)
    fx = dict(hips=(-0.065, 0.11, -0.03), yaw=-4, lean=-23, spine=(-2, 9, 0), rf=(0.06, 0.93, 1.06), rknee=(0.1, 0.4, 1), rfpitch=-26, rfyaw=0,
              lh=(-0.18, 0.24, 1.40), rh=(0.31, -0.06, 1.20), rpole=(0.6, -1, -0.3), lfyaw=24, lfpitch=8, head=(0, 11))
    anim('kick_front', G, [(0, {}), (4, fc, 'out'), (8, fx, 'in'), (9, dict(fx, rf=(0.06, 0.95, 1.06)), 'lin'), (13, dict(fc, rf=(0.10, 0.30, 0.74)), 'out'), (18, dict(rf=(0.17, -0.20, A + 0.10), hips=(-0.02, 0.0, -0.07)), 's'), (23, {}, 's')], hit=8)

    # ROUNDHOUSE (the rear leg, to the ribs): the standing foot turned out, the knee swung up and round outside the
    # hip, the hip rolled over and the shin thrown through level — the arm on that side flung back and down against
    # it, the body leaning away
    r1 = dict(hips=(-0.04, 0.02, -0.055), yaw=2, lfyaw=38, rh=(0.20, 0.12, 1.42), rf=(0.20, -0.18, A + 0.09), rfpitch=30)
    rc = dict(hips=(-0.065, 0.04, -0.03), yaw=42, lean=-4, roll=-12, spine=(-20, 0, -8), rf=(0.46, 0.05, 0.86), rknee=(1, 0.6, 0.5), rfpitch=-30, rfyaw=52,
              lfyaw=82, lf=(-0.15, 0.17, A + 0.02), lfpitch=8, lh=(-0.20, 0.26, 1.47), rh=(0.32, 0.02, 1.32), rpole=(0.6, -1, -0.2), head=(6, 5))
    rx = dict(hips=(-0.085, 0.065, -0.02), yaw=90, lean=-8, roll=-27, spine=(-41, 0, -14), rf=(-0.13, 0.87, 1.18), rknee=(0.8, 0.6, 0.8), rfpitch=-40, rfyaw=96,
              lfyaw=112, lf=(-0.15, 0.17, A + 0.03), lfpitch=11, lknee=(-0.8, 0.6, 0), lh=(-0.21, 0.22, 1.49), rh=(0.39, -0.27, 1.12), rpole=(0.2, -1, 0.3), head=(13, 5))
    rd = dict(hips=(-0.03, 0.0, -0.07), yaw=14, lfyaw=30, rf=(0.21, -0.14, A + 0.12), rfpitch=20, rfyaw=-10, rh=(0.20, 0.10, 1.42))
    anim('kick_round', G, [(0, {}), (3, r1, 'out'), (7, rc, 's'), (10, rx, 'in'), (11, dict(rx, rf=(-0.22, 0.82, 1.16), yaw=96), 'lin'), (15, rc, 'out'), (20, rd, 's'), (26, {}, 's')], hit=10)

    # LOW KICK (the rear shin into the thigh): the same turn, kept low and quick — no chamber to speak of
    lc = dict(hips=(-0.05, 0.03, -0.07), yaw=28, roll=-6, spine=(-14, 2, -4), rf=(0.36, -0.02, 0.36), rknee=(1, 0.7, 0.2), rfpitch=-16, rfyaw=40, lfyaw=60, lfpitch=6, rh=(0.28, 0.06, 1.36), lh=(-0.18, 0.28, 1.47))
    lx = dict(hips=(-0.07, 0.06, -0.085), yaw=70, roll=-14, spine=(-30, 4, -8), rf=(-0.08, 0.74, 0.50), rknee=(0.9, 0.7, 0.3), rfpitch=-28, rfyaw=84, lfyaw=92, lfpitch=9,
              lknee=(-0.6, 0.8, 0), rh=(0.36, -0.16, 1.22), rpole=(0.3, -1, 0.2), lh=(-0.19, 0.24, 1.48), head=(10, 8))
    anim('kick_low', G, [(0, {}), (4, lc, 'out'), (7, lx, 'in'), (8, dict(lx, rf=(-0.16, 0.70, 0.49)), 'lin'), (12, lc, 'out'), (16, rd, 's'), (21, {}, 's')], hit=7)

    # ---- THE DEFENCE -------------------------------------------------------------------------------------------
    # BLOCK: both forearms up before the face, the chin down behind them, the weight sunk
    blk = dict(lh=(-0.07, 0.25, 1.585), rh=(0.08, 0.225, 1.575), lpole=(-0.25, -0.2, -1), rpole=(0.28, -0.2, -1), spine=(-8, 15, 0), hips=(0.0, -0.045, -0.125), head=(0, 15))
    anim('block', G, [(0, {}), (3, blk, 'out'), (12, dict(blk, hips=(0.0, -0.05, -0.13)), 's'), (18, {}, 's')], lag=NOLAG)
    # … and a blow TAKEN on it: knocked back into his own arms, a shuffle of the rear foot, out again
    bh = dict(blk, lh=(-0.07, 0.19, 1.565), rh=(0.08, 0.17, 1.555), hips=(0.0, -0.13, -0.135), lean=-7, spine=(-6, 6, 0), head=(0, 6), rf=(0.18, -0.33, A), rfpitch=0)
    anim('block_hit', G, [(0, blk), (2, bh, 'out'), (7, dict(blk, hips=(0.0, -0.08, -0.13), rf=(0.18, -0.30, A)), 's'), (14, {}, 's')], lag=REACT)
    # DODGE: the weight thrown onto the rear leg, the head and the chest pulled back out of reach, the chin kept down
    dod = dict(hips=(0.03, -0.19, -0.13), lean=-17, spine=(-8, -15, 0), lh=(-0.12, 0.22, 1.42), rh=(0.17, 0.04, 1.40), head=(0, 9), rknee=(0.6, 1, 0.1), lf=(-0.15, 0.17, A + 0.02), lfpitch=-8)
    anim('dodge', G, [(0, {}), (3, dod, 'out'), (8, dict(dod, hips=(0.03, -0.18, -0.135)), 's'), (15, {}, 's')], lag=dict(REACT, head=-1.2))
    # DUCK: under it — the knees folded, the back kept straight, a roll of the head out to the side and up
    dk = dict(hips=(0.05, 0.0, -0.36), lean=20, spine=(-6, 16, 8), head=(0, -6), lh=(-0.10, 0.30, 1.22), rh=(0.15, 0.18, 1.20), lknee=(-0.3, 1, 0), rknee=(0.5, 1, 0))
    dk2 = dict(hips=(-0.06, 0.02, -0.30), lean=16, spine=(8, 12, -8), head=(0, -4), lh=(-0.12, 0.30, 1.28), rh=(0.13, 0.18, 1.26), lknee=(-0.3, 1, 0), rknee=(0.5, 1, 0))
    anim('duck', G, [(0, {}), (3, dk, 'out'), (7, dk2, 's'), (13, {}, 's')], lag=dict(REACT, head=-1.2))

    # ---- A BLOW TAKEN (the head goes first, the body after it, the feet last) -------------------------------------
    # IN THE FACE: the head snapped back, the guard knocked open, the weight thrown onto the heels — a step to catch it
    hh = dict(hips=(0.01, -0.07, -0.075), lean=-8, spine=(4, -17, 2), head=(-6, -33), lh=(-0.22, 0.34, 1.42), rh=(0.26, 0.17, 1.38), lpole=(-0.8, -0.3, -1), rpole=(0.8, -0.3, -1))
    hh2 = dict(hips=(0.02, -0.16, -0.085), lean=-13, spine=(8, -20, 5), head=(-14, -16), headroll=6, lh=(-0.27, 0.28, 1.34), rh=(0.31, 0.12, 1.30), lpole=(-0.8, -0.3, -1), rpole=(0.8, -0.3, -1),
               rf=(0.18, -0.39, A), rfpitch=0, lf=(-0.15, 0.15, A + 0.03), lfpitch=-12)
    hh3 = dict(hips=(0.015, -0.11, -0.10), lean=-3, spine=(2, -2, 2), head=(-4, 6), lh=(-0.16, 0.30, 1.42), rh=(0.20, 0.16, 1.40), rf=(0.18, -0.33, A), rfpitch=4)
    anim('hit_head', G, [(0, {}), (2, hh, 'out'), (6, hh2, 'out'), (12, hh3, 's'), (19, {}, 's')], lag=REACT)
    # ON THE LEFT OF THE HEAD (a right hook): whipped round to his right, the shoulders dragged after it, a stumble that way
    hl1 = dict(hips=(0.05, -0.03, -0.08), roll=7, spine=(-20, -4, 10), head=(-52, -6), headroll=18, lh=(-0.20, 0.30, 1.40), rh=(0.28, 0.14, 1.36))
    hl2 = dict(hips=(0.11, -0.07, -0.10), yaw=-34, roll=10, spine=(-26, 4, 12), head=(-40, 8), headroll=12, lh=(-0.18, 0.26, 1.32), rh=(0.34, 0.10, 1.28),
               rf=(0.31, -0.25, A), rfpitch=0, rfyaw=-50, lf=(-0.12, 0.17, A + 0.03), lfpitch=-6)
    hl3 = dict(hips=(0.06, -0.05, -0.10), yaw=-28, spine=(-12, 6, 4), head=(-10, 8), lh=(-0.13, 0.30, 1.42), rh=(0.20, 0.15, 1.40), rf=(0.25, -0.25, A), rfpitch=4)
    anim('hit_head_l', G, [(0, {}), (2, hl1, 'out'), (6, hl2, 'out'), (12, hl3, 's'), (19, {}, 's')], lag=REACT)
    # ON THE RIGHT OF THE HEAD (a lead hook): the other way
    hr1 = dict(hips=(-0.05, -0.02, -0.08), roll=-7, spine=(22, -4, -10), head=(50, -6), headroll=-18, lh=(-0.24, 0.30, 1.38), rh=(0.22, 0.16, 1.40))
    hr2 = dict(hips=(-0.11, -0.05, -0.10), yaw=-12, roll=-10, spine=(28, 4, -12), head=(40, 8), headroll=-12, lh=(-0.32, 0.26, 1.30), rh=(0.20, 0.14, 1.34),
               lf=(-0.29, 0.14, A), lfyaw=18, rf=(0.15, -0.25, A + 0.03), rfpitch=18)
    hr3 = dict(hips=(-0.06, -0.03, -0.10), yaw=-20, spine=(10, 6, -4), head=(10, 8), lh=(-0.16, 0.30, 1.42), rh=(0.17, 0.16, 1.42), lf=(-0.23, 0.17, A))
    anim('hit_head_r', G, [(0, {}), (2, hr1, 'out'), (6, hr2, 'out'), (12, hr3, 's'), (19, {}, 's')], lag=REACT)
    # IN THE BODY: folded over it — the hips shot back, the arms in over the belly, the head down; held, then a breath
    # dragged back in and up
    hb = dict(hips=(0.0, -0.19, -0.15), lean=27, spine=(4, 45, 0), head=(0, 36), lh=(-0.09, 0.22, 1.02), rh=(0.11, 0.18, 1.00), lpole=(-1, -0.6, 0), rpole=(1, -0.6, 0), rf=(0.18, -0.34, A), rfpitch=0)
    hb2 = dict(hb, hips=(0.0, -0.21, -0.17), spine=(2, 48, 0), head=(0, 40))
    hb3 = dict(hips=(0.0, -0.14, -0.13), lean=15, spine=(2, 27, 0), head=(0, 17), lh=(-0.11, 0.25, 1.18), rh=(0.13, 0.19, 1.16), lpole=(-1, -0.6, -0.3), rpole=(1, -0.6, -0.3), rf=(0.18, -0.31, A), rfpitch=3)
    anim('hit_body', G, [(0, {}), (3, hb, 'out'), (8, hb2, 's'), (15, hb3, 's'), (23, {}, 's')], lag=dict(REACT, head=0.6, spine=-0.6, hips=-1.0, lean=-0.8))
    # IN THE LEG (a low kick on the lead thigh): the knee knocked in and from under him, the hip dropped, hopped back onto it
    hg = dict(hips=(0.05, -0.02, -0.19), roll=-11, yaw=-16, spine=(-4, 12, 8), lf=(-0.06, 0.15, A + 0.02), lknee=(0.7, 1, 0), lfyaw=-26, lfpitch=14, head=(0, 12), lh=(-0.16, 0.30, 1.36), rh=(0.20, 0.14, 1.38))
    hg2 = dict(hips=(0.04, -0.06, -0.12), roll=-5, lf=(-0.13, 0.12, A + 0.07), lknee=(0.2, 1, 0.2), lfpitch=10, head=(0, 8))
    anim('hit_leg', G, [(0, {}), (3, hg, 'out'), (9, hg2, 's'), (17, {}, 's')], lag=dict(LAG, head=1.0))
    # STAGGERED (a heavy one): thrown back off balance, the arms out to catch it, two short steps to stay up
    s1 = dict(hips=(0.02, -0.12, -0.06), lean=-17, spine=(8, -24, 4), head=(-10, -30), lh=(-0.40, 0.24, 1.40), rh=(0.44, 0.10, 1.36), lpole=(-1, -0.4, -0.5), rpole=(1, -0.4, -0.5))
    s2 = dict(hips=(0.04, -0.24, -0.10), lean=-19, spine=(10, -20, 6), head=(-12, -10), lh=(-0.48, 0.14, 1.30), rh=(0.50, 0.02, 1.24), lpole=(-1, -0.4, -0.3), rpole=(1, -0.4, -0.3),
              rf=(0.20, -0.47, A), rfpitch=0, lf=(-0.15, 0.10, A + 0.06), lfpitch=-16)
    s3 = dict(hips=(0.0, -0.22, -0.13), lean=-6, spine=(4, -4, 2), head=(-4, 6), lh=(-0.36, 0.14, 1.26), rh=(0.38, 0.06, 1.24), rf=(0.20, -0.47, A), rfpitch=0, lf=(-0.16, -0.06, A), lfpitch=0)
    s4 = dict(hips=(0.0, -0.10, -0.11), lean=2, spine=(-4, 10, 0), head=(0, 10), lh=(-0.18, 0.28, 1.40), rh=(0.22, 0.14, 1.38), rf=(0.18, -0.32, A), lf=(-0.15, 0.10, A + 0.04))
    anim('stagger', G, [(0, {}), (2, s1, 'out'), (7, s2, 'out'), (13, s3, 's'), (20, s4, 's'), (27, {}, 's')], lag=REACT)

    # ---- DOWN --------------------------------------------------------------------------------------------------
    # KNOCKED DOWN: reeling, the legs gone, off his feet onto his back — the hips land first, the shoulders and the
    # head after them, the arms flung out and the last to lie still. It ends lying (the game's getup_back gets him up)
    hip_z = 0.125 - STAND_Z
    reel = dict(hips=(0.02, -0.17, -0.05), lean=-23, spine=(6, -27, 4), head=(-20, -28), lh=(-0.43, 0.20, 1.44), rh=(0.47, 0.10, 1.40), lpole=(-1, -0.5, -0.4), rpole=(1, -0.5, -0.4),
                rf=(0.18, -0.43, A), rfpitch=0, lf=(-0.15, 0.10, A + 0.05), lfpitch=-14)
    fall = dict(hips=(0.0, -0.52, -0.44), yaw=-6, lean=-57, spine=(0, 12, 0), head=(0, 10), lh=(-0.50, -0.08, 1.06), rh=(0.52, -0.14, 1.02), lpole=(-1, 0.3, -0.5), rpole=(1, 0.3, -0.5),
                lf=(-0.16, 0.20, 0.34), rf=(0.17, 0.06, 0.24), lfpitch=-22, rfpitch=-18, lfyaw=-6, rfyaw=10, lknee=(-0.2, 0.2, 1), rknee=(0.2, 0.2, 1))
    land = dict(hips=(0.0, -0.84, hip_z), yaw=-3, lean=-80, spine=(0, 16, 0), head=(0, -40), lh=(-0.56, -0.86, 0.42), rh=(0.58, -0.84, 0.40), lpole=(-1, 0.4, 0.3), rpole=(1, 0.4, 0.3),
                lf=(-0.19, -0.02, 0.36), rf=(0.21, 0.0, 0.42), lfpitch=-50, rfpitch=-44, lfyaw=-14, rfyaw=18, lknee=(-0.3, 0, 1), rknee=(0.3, 0, 1))
    boun = dict(hips=(0.0, -0.87, hip_z + 0.035), yaw=-3, lean=-86, spine=(0, 6, 0), head=(0, -74), lh=(-0.59, -1.12, 0.16), rh=(0.61, -1.08, 0.18), lpole=(-1, 0.4, 0.3), rpole=(1, 0.4, 0.3),
                lf=(-0.21, -0.03, 0.20), rf=(0.23, -0.01, 0.28), lfpitch=-62, rfpitch=-56, lfyaw=-20, rfyaw=23, lknee=(-0.35, 0, 1), rknee=(0.35, 0, 1))
    lie = dict(hips=(0.0, -0.88, hip_z), yaw=-3, lean=-90, spine=(0, 0, 0), head=(0, -86), lh=(-0.60, -1.14, 0.07), rh=(0.62, -1.10, 0.07), lpole=(-1, 0.4, 0.3), rpole=(1, 0.4, 0.3),
               lf=(-0.22, -0.03, 0.09), rf=(0.24, 0.0, 0.09), lfpitch=-70, rfpitch=-70, lfyaw=-24, rfyaw=26, lknee=(-0.4, 0, 1), rknee=(0.4, 0, 1))
    DOWN = dict(hips=0.0, yaw=0.0, lean=0.0, roll=0.0, spine=0.6, head=1.4, headroll=1.4, lh=1.6, rh=2.0, lpole=1.6, rpole=2.0, lf=1.0, rf=1.3, lfpitch=1.0, rfpitch=1.3, lfyaw=1.0, rfyaw=1.3, lknee=1.0, rknee=1.3)
    anim('knockdown', G, [(0, {}), (4, reel, 'out'), (10, fall, 'in'), (14, land, 'in'), (17, boun, 'out'), (22, lie, 's'), (32, lie, 'lin')], lag=DOWN)
    # KILLED, FALLING BACK (shot from the front): no reeling — the knees simply go, he drops and tips back, limp
    k1 = dict(hips=(0.0, -0.05, -0.20), lean=-6, spine=(2, 10, 2), head=(0, 22), lh=(-0.20, 0.22, 1.16), rh=(0.24, 0.12, 1.12), lpole=(-0.8, -0.6, -0.3), rpole=(0.8, -0.6, -0.3), lknee=(-0.3, 1, 0), rknee=(0.45, 1, 0))
    k2 = dict(hips=(0.03, -0.30, -0.52), yaw=-12, lean=-40, roll=6, spine=(4, 20, 4), head=(6, 30), lh=(-0.34, 0.02, 0.86), rh=(0.40, -0.10, 0.78), lpole=(-1, 0.2, -0.4), rpole=(1, 0.2, -0.4),
              lf=(-0.16, 0.16, A + 0.02), rf=(0.19, -0.10, A + 0.02), lfpitch=-10, rfpitch=-6, lknee=(-0.5, 1, 0.3), rknee=(0.6, 1, 0.3))
    anim('die_back', G, [(0, {}), (4, k1, 'in'), (10, k2, 'in'), (14, land, 'in'), (17, boun, 'out'), (23, lie, 's'), (34, lie, 'lin')], lag=DOWN)
    # KILLED, FALLING FORWARD: onto his knees, then down on his face, one arm under him
    f1 = dict(hips=(0.0, 0.04, -0.20), lean=12, spine=(0, 14, 0), head=(0, 26), lh=(-0.18, 0.26, 1.10), rh=(0.20, 0.20, 1.08), lpole=(-0.8, -0.6, -0.2), rpole=(0.8, -0.6, -0.2))
    knees = dict(hips=(0.0, 0.16, -0.47), lean=20, spine=(4, 22, 2), head=(0, 34), lh=(-0.22, 0.34, 0.74), rh=(0.24, 0.30, 0.70), lpole=(-0.8, -0.6, 0.2), rpole=(0.8, -0.6, 0.2),
                 lf=(-0.15, -0.24, 0.16), rf=(0.17, -0.42, 0.16), lfpitch=62, rfpitch=62, lfyaw=-4, rfyaw=-12, lknee=(-0.1, 1, -0.4), rknee=(0.1, 1, -0.4))
    face = dict(hips=(0.02, 0.56, 0.115 - STAND_Z), yaw=6, lean=84, spine=(4, -4, 0), head=(38, 74), lh=(-0.30, 1.16, 0.10), rh=(0.20, 0.72, 0.09), lpole=(-1, 0.2, 0.3), rpole=(1, -0.3, 0.2),
                lf=(-0.17, -0.22, 0.10), rf=(0.20, -0.30, 0.10), lfpitch=84, rfpitch=84, lfyaw=-14, rfyaw=16, lknee=(-0.2, 0.2, -1), rknee=(0.2, 0.2, -1))
    facb = dict(face, hips=(0.02, 0.55, 0.15 - STAND_Z), lean=80, head=(30, 60), lh=(-0.30, 1.10, 0.20), rh=(0.20, 0.70, 0.16))
    anim('die_fwd', G, [(0, {}), (4, f1, 'in'), (10, knees, 'in'), (13, knees, 'lin'), (19, facb, 'in'), (22, face, 'out'), (34, face, 'lin')], lag=dict(DOWN, lh=1.2, rh=1.5))

    # TAUNT: the arms thrown wide and low, the chest out, a beckon of the hands — "come on, then"
    wide = dict(hips=(0.0, 0.02, -0.04), yaw=-8, lean=-5, spine=(4, -11, 0), head=(0, -9), lh=(-0.62, 0.22, 1.04), rh=(0.62, 0.20, 1.04), lpole=(-0.6, -1, 0.2), rpole=(0.6, -1, 0.2), rfpitch=0, rf=(0.20, -0.14, A))
    wide2 = dict(wide, lh=(-0.58, 0.32, 1.14), rh=(0.58, 0.30, 1.14), hips=(0.0, 0.045, -0.025), head=(0, -13))
    anim('taunt', G, [(0, {}), (7, wide, 'out'), (13, wide2, 's'), (19, wide, 's'), (25, wide2, 's'), (31, wide, 's'), (41, {}, 's')], lag=dict(LAG, lh=0.8, rh=0.8))


def build_rope():
    # STANDING (not the guard): the weight on both feet, a little apart and turned out, the arms hanging, the chin level
    S = dict(hips=(0.0, 0.0, -0.012), yaw=0, lean=3, roll=0, spine=(0, 2, 0), head=(0, 5), headroll=0,
             lh=(-0.235, -0.045, 0.905), rh=(0.235, -0.045, 0.905), lpole=(-0.25, -1, -0.15), rpole=(0.25, -1, -0.15),
             lf=(-0.105, 0.0, A), rf=(0.105, 0.0, A), lfyaw=7, rfyaw=-7, lfpitch=0, rfpitch=0, lknee=(-0.05, 1, 0.05), rknee=(0.05, 1, 0.05))
    # CARRYING THE HOOK (made again 2026-11-25 — the user: "the hook carried looks really bad, it must be like real
    # life"): its eye in the right fist, the arm hanging at his side a little bent with its weight, the hook hanging by
    # his thigh; the left arm hangs. The game bends his arm to this same hold as he walks (Winch.ts carryHold)
    C = dict(S, rh=(0.215, 0.045, 0.915), rpole=(0.25, -1, -0.1), spine=(0, 3, 0), head=(0, 6))
    # (the hook on your own bumper: 0.55 m before your feet, at 0.75 m — the game stands you there)
    # TAKE IT: a lean in from the hips, the knees giving — both hands on the hook, a pull to free it, a step back
    # drawing the line out against the drum's drag, the hook turned up into the right hand, the left lets go of it
    reach = dict(hips=(0.0, -0.09, -0.05), lean=27, spine=(0, 10, 0), head=(0, 16), lknee=(-0.05, 1, 0.05), rknee=(0.05, 1, 0.05),
                 rh=(0.07, 0.52, 0.775), lh=(-0.07, 0.505, 0.79), rpole=(0.8, -0.4, -0.5), lpole=(-0.8, -0.4, -0.5))
    grip = dict(reach, rh=(0.055, 0.50, 0.76), lh=(-0.085, 0.49, 0.775), hips=(0.0, -0.10, -0.06), lean=28)
    free = dict(grip, rh=(0.08, 0.40, 0.81), lh=(-0.06, 0.39, 0.825), hips=(0.0, -0.13, -0.05), lean=20, spine=(0, 8, 0))
    back = dict(S, hips=(0.0, -0.19, -0.06), lean=6, spine=(0, 4, 0), head=(0, 10), rf=(0.13, -0.27, A), rfpitch=0, lf=(-0.105, 0.02, A + 0.01), lfpitch=-4,
                rh=(0.15, 0.24, 0.93), lh=(-0.03, 0.30, 0.92), rpole=(0.6, -0.8, -0.4), lpole=(-0.7, -0.6, -0.4))
    turnup = dict(back, rh=(0.21, 0.10, 0.93), lh=(-0.22, -0.02, 0.91), lpole=(-0.25, -1, -0.15), rpole=(0.3, -1, -0.15), hips=(0.0, -0.21, -0.03), lean=3, head=(0, 6))
    anim('hook_take', S, [(0, {}), (9, reach, 'out'), (14, grip, 's'), (19, free, 'in'), (29, back, 'out'), (37, turnup, 's'), (46, dict(C, hips=(0.0, -0.21, -0.012)), 's')], lag=LAG)

    # CLIP IT ON (the recovery point 0.6 m before your feet, at 0.5–0.6 m — the game stands you there): a step in on
    # the left foot, down onto the right knee; the hook brought in with both hands, its throat pushed over the point,
    # the latch thumbed; a tug back to try it; the hands off, up again off the front leg
    stepin = dict(C, hips=(0.0, 0.07, -0.16), lean=14, spine=(0, 8, 0), head=(0, 14), lf=(-0.13, 0.30, A), lfyaw=4, rf=(0.12, -0.18, A + 0.05), rfpitch=22, lknee=(-0.05, 1, 0.3),
                  rh=(0.17, 0.30, 0.86), lh=(-0.12, 0.26, 0.86), lpole=(-0.6, -0.8, -0.4))
    kneel = dict(hips=(0.02, 0.0, -0.475), lean=17, roll=0, spine=(0, 14, 0), head=(0, 24), lf=(-0.14, 0.30, A), lfyaw=4, lfpitch=0, lknee=(-0.05, 1, 0.6),
                 rf=(0.13, -0.47, 0.105), rfpitch=72, rfyaw=-4, rknee=(0.1, 1, -0.2),
                 rh=(0.06, 0.53, 0.575), lh=(-0.07, 0.51, 0.595), rpole=(0.8, -0.3, -0.5), lpole=(-0.8, -0.3, -0.5))
    push = dict(kneel, rh=(0.035, 0.585, 0.55), lh=(-0.08, 0.57, 0.575), lean=21, spine=(0, 17, 0), head=(0, 30))
    latch = dict(push, rh=(0.03, 0.595, 0.545), lh=(-0.045, 0.58, 0.565), head=(-4, 32))
    tug = dict(kneel, rh=(0.05, 0.47, 0.565), lh=(-0.08, 0.46, 0.585), lean=11, spine=(0, 9, 0), hips=(0.02, -0.04, -0.47), head=(0, 22))
    off = dict(tug, rh=(0.20, 0.36, 0.66), lh=(-0.19, 0.35, 0.67), rpole=(0.4, -1, -0.3), lpole=(-0.4, -1, -0.3), head=(0, 16))
    rise = dict(stepin, rh=(0.235, 0.05, 0.89), lh=(-0.235, 0.05, 0.89), rpole=(0.25, -1, -0.15), lpole=(-0.25, -1, -0.15), hips=(0.0, 0.05, -0.14), lean=10)
    anim('hook_attach', C, [(0, {}), (8, stepin, 'out'), (18, kneel, 's'), (25, push, 'in'), (30, latch, 's'), (37, tug, 'out'), (43, tug, 's'), (49, off, 's'), (60, rise, 's'), (70, S, 's')], lag=LAG)
    # TAKE IT OFF: down the same way, the latch thumbed open, the hook worked off the point, up with it in the hand
    anim('hook_detach', S, [(0, {}), (10, dict(stepin, rh=(0.20, 0.25, 0.84), lh=(-0.16, 0.24, 0.85)), 'out'), (20, dict(off, rh=(0.08, 0.50, 0.60), lh=(-0.09, 0.49, 0.61)), 's'),
                            (27, latch, 'in'), (33, push, 's'), (40, dict(tug, rh=(0.07, 0.44, 0.58), lh=(-0.10, 0.43, 0.60)), 'out'), (49, dict(rise, rh=(0.20, 0.22, 0.88), lh=(-0.18, 0.12, 0.88)), 's'), (60, C, 's')], lag=LAG)
    # HUNG BACK ON YOUR WINCH: the lean in, both hands lay the hook on the fairlead, the right hand lets go, up
    lay = dict(grip, rh=(0.06, 0.52, 0.765), lh=(-0.08, 0.50, 0.78))
    anim('hook_stow', C, [(0, {}), (10, dict(free, rh=(0.12, 0.40, 0.84), lh=(-0.10, 0.38, 0.85)), 'out'), (18, lay, 's'), (24, dict(lay, rh=(0.06, 0.53, 0.755)), 'in'),
                          (31, dict(reach, rh=(0.16, 0.40, 0.80), lh=(-0.16, 0.39, 0.81)), 'out'), (42, S, 's')], lag=LAG)


if kw.get('FROM'):
    meta = json.loads(arm.get('fight_clips', '{}'))
    CLIPS.update(meta)
elif ROPE:
    build_rope()
else:
    build()
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
    """A FILM STRIP of the clip — every frame of a short one, every second of a long one, left to right, seen from
    his front right — <PREVIEW>/<name>.png: the motion read at a glance (the arcs, what leads, where it is fast)."""
    import numpy as np
    os.makedirs(PREVIEW, exist_ok=True)
    set_action(name)
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    TW, TH = 230, 300
    scene.render.resolution_x = TW; scene.render.resolution_y = TH
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    if not scene.camera:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        scene.collection.objects.link(cam)
        scene.camera = cam
    cam = scene.camera
    # (a long lens on a man standing; wider for one who goes down)
    cam.data.lens = 46 if name in ('knockdown', 'die_back', 'die_fwd') else 78
    if not scene.world: scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.42, 0.44, 0.47)
    side = kw.get('VIEW') == 'side'
    cam.location = (4.6, 0.1, 1.15) if side else (3.5, 3.3, 1.3)   # (from his right, square on / from his front right)
    look = Vector((0, -0.05 if side else 0.0, 0.92)) - Vector(cam.location)
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    F = int(CLIPS[name]['frames'])
    step = 1 if F <= 12 else 2 if F <= 26 else 3
    frames = list(range(0, F + 1, step))
    hit = CLIPS[name].get('hit')
    at_hit = min(frames, key=lambda f: abs(f - hit)) if hit is not None else -1
    tiles = []
    tmp = os.path.join(PREVIEW, '_tile.png')
    for f in frames:
        scene.frame_set(f); upd()
        scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        a = np.array(img.pixels[:], dtype=np.float32).reshape(TH, TW, 4)
        # (the frame of the blow: a bar under it)
        if f == at_hit: a[:7, :, :] = (1.0, 0.55, 0.1, 1.0)
        tiles.append(a)
        bpy.data.images.remove(img)
    strip = np.concatenate(tiles, axis=1)
    out = bpy.data.images.new('strip', strip.shape[1], strip.shape[0])
    out.pixels = strip.ravel().tolist()
    out.filepath_raw = os.path.join(PREVIEW, f'{name}.png'); out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    if os.path.exists(tmp): os.remove(tmp)


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


ONLY = kw.get('ONLY', '').split(',') if kw.get('ONLY') else None
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
    if PREVIEW and (not ONLY or name in ONLY): preview(name)

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
print('ROPE CLIPS:' if ROPE else 'FIGHT CLIPS:', ', '.join(f"{n} {info[n]['frames'] / FPS:.2f}s" for n in info), '->', OUT, f'({(20 + len(js) + 8 + len(blob)) / 1024:.0f} kB)')
