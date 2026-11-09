# OVERHILL — THE TRAILER (docs/MULTIPLAYER.md step 2b — the user: "haul it with the jeep and a trailer"; "good looking
# quality things, not just squares"): a small off-road utility trailer, modelled — a steel frame (rails, cross-members,
# corner posts) in worn green paint with the rust coming through, a bed of bolted boards with board sides and a
# tailgate, an A-frame drawbar to a cast coupler, round fenders over chunky off-road tyres on steel rims, a jockey wheel
# with its crank, tail lights and reflectors. Scanned materials (ambientCG, CC0: PaintedMetal006, Planks040, Rubber001,
# Metal055A) baked into one atlas (assetkit.bake).
#
#   blender -b --factory-startup --python scripts/oth/trailer.py -- [OUT=src/assets/models/vehicles/trailer.glb] [PREVIEW=<dir>]
#
# Blender space: x right, +y FORWARD (the drawbar — the game's −z), z up; the origin on the ground under the axle.
# Parts: 'body' (all that doesn't move), 'wheel_l' / 'wheel_r' (each at its hub: the game spins them),
# 'jockey' (at its clamp: the game swings it up when hitched). The coupler's ball socket at (0, COUPLER_Y, COUPLER_Z).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assetkit import *
import bpy, bmesh
from mathutils import Vector, noise

kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'vehicles', 'trailer.glb')))
PREVIEW = kw.get('PREVIEW')
def log(*a): print('[trailer]', *a, flush=True)

# the dimensions (m) — Trailer.ts reads the same numbers
WHEEL_R, WHEEL_W, TRACK = 0.36, 0.22, 1.58
BED_L, BED_W, FLOOR_Z, SIDE_H = 1.9, 1.24, 0.66, 0.38
COUPLER_Y, COUPLER_Z = 2.32, 0.5
log(f'dims: wheel {WHEEL_R} track {TRACK} bed {BED_L}×{BED_W} floor {FLOOR_Z} coupler y {COUPLER_Y} z {COUPLER_Z}')

reset()
for a in ('PaintedMetal006', 'Planks040', 'Rubber001', 'Metal055A'): ensure_tex(a)
M_PAINT = pbr('paint', 'PaintedMetal006', 1.6, (0.78, 0.84, 0.66), 0.55, 0.3)
M_WOOD = pbr('boards', 'Planks040', 0.9, (0.95, 0.9, 0.85), 0.8)
M_RUBBER = pbr('rubber', 'Rubber001', 3.0, (0.55, 0.55, 0.57), 0.9)
M_STEEL = pbr('steel', 'Metal055A', 2.0, (0.8, 0.8, 0.82), 0.4, 0.9)
M_RED = flat('lens_red', (0.55, 0.03, 0.02), 0.25)
M_AMBER = flat('lens_amber', (0.8, 0.38, 0.02), 0.25)

# ===================================================================================================== the body
bm, uvl = new_bm()
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
fy, by = BED_L / 2, -BED_L / 2
# frame: two box rails under the bed, cross-members, the bed's perimeter channel
for sx in (-1, 1):
    box(bm, uvl, Vector((sx * 0.5, 0, FLOOR_Z - 0.09)), (0.04, BED_L / 2 + 0.02, 0.05), 0, 2)
for yy in (by + 0.04, -0.35, 0.35, fy - 0.04):
    box(bm, uvl, Vector((0, yy, FLOOR_Z - 0.07)), (BED_W / 2, 0.03, 0.035), 0, 2)
for sx in (-1, 1):
    box(bm, uvl, Vector((sx * (BED_W / 2 - 0.02), 0, FLOOR_Z - 0.02)), (0.025, BED_L / 2, 0.03), 0, 2)
# the floor: boards across (a little gap between them), bolted
n_boards = 9
for i in range(n_boards):
    y0 = by + (i + 0.5) * BED_L / n_boards
    box(bm, uvl, Vector((0, y0, FLOOR_Z + 0.012)), (BED_W / 2 - 0.03, BED_L / n_boards / 2 - 0.006, 0.014), 1, 1)
# the sides, the front board and the tailgate: three boards high, a gap between
for k in range(3):
    z0 = FLOOR_Z + 0.07 + k * 0.125
    for sx in (-1, 1):
        box(bm, uvl, Vector((sx * (BED_W / 2 - 0.012), 0, z0)), (0.014, BED_L / 2 - 0.04, 0.055), 1, 1)
    box(bm, uvl, Vector((0, fy - 0.012, z0)), (BED_W / 2 - 0.04, 0.014, 0.055), 1, 1)
    box(bm, uvl, Vector((0, by + 0.012, z0)), (BED_W / 2 - 0.04, 0.014, 0.055), 1, 1)
# corner posts and the mid stake pockets (steel), the top rail's caps
for sx in (-1, 1):
    for yy in (by + 0.02, 0.0, fy - 0.02):
        box(bm, uvl, Vector((sx * (BED_W / 2 - 0.005), yy, FLOOR_Z + SIDE_H / 2 - 0.01)), (0.022, 0.022, SIDE_H / 2 + 0.03), 0, 2)
# the tailgate's hinges and latches
for sx in (-0.42, 0.42):
    box(bm, uvl, Vector((sx, by - 0.006, FLOOR_Z + 0.06)), (0.05, 0.012, 0.02), 3, 3)
    box(bm, uvl, Vector((sx, by - 0.006, FLOOR_Z + SIDE_H - 0.03)), (0.03, 0.014, 0.022), 3, 3)
# the axle beam and its spring hangers
box(bm, uvl, Vector((0, 0, WHEEL_R)), (TRACK / 2 - 0.08, 0.035, 0.035), 0, 2)
for sx in (-1, 1):
    tube(bm, uvl, [Vector((sx * 0.5, -0.45, FLOOR_Z - 0.15)), Vector((sx * 0.5, 0, WHEEL_R + 0.06)), Vector((sx * 0.5, 0.45, FLOOR_Z - 0.15))], [(0.03, 0.012)] * 3, 3, 6)
# the fenders: a round steel arch over each tyre, a lip down its outer edge
for sx in (-1, 1):
    x = sx * (TRACK / 2)
    # (a steel sheet 6 mm thick: its outer face and its inner, joined at the edges)
    outer, inner = [], []
    for i in range(13):
        a = math.radians(20 + 140 * i / 12)
        for lst, rr in ((outer, WHEEL_R + 0.075), (inner, WHEEL_R + 0.069)):
            p = Vector((x, math.cos(a) * rr, WHEEL_R + math.sin(a) * rr))
            lst.append([bm.verts.new(p + Vector((-0.14, 0, 0))), bm.verts.new(p + Vector((0.14, 0, 0)))])
    for i in range(12):
        for lst, flip in ((outer, False), (inner, True)):
            q = (lst[i][0], lst[i][1], lst[i + 1][1], lst[i + 1][0])
            f = bm.faces.new(tuple(reversed(q)) if flip else q); f.material_index = 0
            for lp in f.loops: lp[uvl].uv = ((lp.vert.co.x - x) * 2 + 0.5, math.atan2(lp.vert.co.z - WHEEL_R, lp.vert.co.y) * 0.4)
        for j, flip in ((0, True), (1, False)):
            q = (outer[i][j], outer[i + 1][j], inner[i + 1][j], inner[i][j])
            f = bm.faces.new(tuple(reversed(q)) if flip else q); f.material_index = 0
            for lp in f.loops: lp[uvl].uv = (lp.vert.co.y, lp.vert.co.z)
    # (its bracket to the bed's side)
    box(bm, uvl, Vector((sx * (BED_W / 2 + 0.04), 0, FLOOR_Z + 0.02)), (0.05, 0.3, 0.012), 0, 2)
# the drawbar: an A-frame from the bed's front corners to the tongue, the coupler on its end
tip = Vector((0, COUPLER_Y - 0.25, COUPLER_Z + 0.02))
for sx in (-1, 1):
    tube(bm, uvl, [Vector((sx * 0.5, fy - 0.1, FLOOR_Z - 0.09)), Vector((sx * 0.25, fy + 0.45, (FLOOR_Z - 0.09 + COUPLER_Z) / 2 + 0.01)), tip + Vector((sx * 0.03, 0, 0))],
         [(0.035, 0.035)] * 3, 0, 8)
box(bm, uvl, Vector((0, COUPLER_Y - 0.14, COUPLER_Z + 0.02)), (0.04, 0.14, 0.04), 0, 2)
# the coupler: a cast head over the ball, its lever on top
box(bm, uvl, Vector((0, COUPLER_Y - 0.01, COUPLER_Z + 0.02)), (0.048, 0.07, 0.05), 3, 3)
tube(bm, uvl, [Vector((0, COUPLER_Y - 0.08, COUPLER_Z + 0.075)), Vector((0, COUPLER_Y + 0.04, COUPLER_Z + 0.1))], [(0.012, 0.01)] * 2, 3, 6)
# safety chains: two loops of links hanging under the tongue
for sx in (-1, 1):
    for i in range(6):
        t = i / 5
        p = Vector((sx * (0.03 + 0.02 * t), COUPLER_Y - 0.12 - 0.05 * i, COUPLER_Z - 0.05 - 0.12 * math.sin(math.pi * t)))
        tube(bm, uvl, [p, p + Vector((0, 0.035, 0))], [(0.008, 0.008)] * 2, 3, 5)
# tail lights (red lenses in steel housings), amber side reflectors, the plate's bracket
for sx in (-1, 1):
    box(bm, uvl, Vector((sx * (BED_W / 2 - 0.09), by - 0.03, FLOOR_Z - 0.06)), (0.07, 0.025, 0.04), 3, 3)
    box(bm, uvl, Vector((sx * (BED_W / 2 - 0.09), by - 0.056, FLOOR_Z - 0.06)), (0.06, 0.004, 0.032), 4, 3)
    box(bm, uvl, Vector((sx * (BED_W / 2 + 0.003), fy - 0.12, FLOOR_Z + 0.1)), (0.004, 0.03, 0.02), 5, 3)
box(bm, uvl, Vector((0, by - 0.035, FLOOR_Z - 0.08)), (0.16, 0.006, 0.07), 0, 2)
bm.normal_update()
body = obj('body', bm, [M_PAINT, M_WOOD, M_RUBBER, M_STEEL, M_RED, M_AMBER])
bevel(body, 0.006, 2, 35)

# ===================================================================================================== the wheels
def make_wheel(name, side):
    """An off-road tyre (its shoulders rounded, chunky staggered lugs across the tread) on a steel rim (a dished centre,
    six studs and a cap) — at its hub, its axis along x, its outer face toward `side`."""
    bm, uvl = new_bm()
    S = 48
    R, Ri, W = WHEEL_R, 0.215, WHEEL_W
    # the tyre's cross-section (x across, r out): the bead, the sidewall, the shoulder, the tread, back down
    prof = [(-W / 2 + 0.02, Ri), (-W / 2, Ri + 0.04), (-W / 2 - 0.006, R - 0.07), (-W / 2 + 0.01, R - 0.025), (-W / 2 + 0.035, R - 0.004),
            (0.0, R), (W / 2 - 0.035, R - 0.004), (W / 2 - 0.01, R - 0.025), (W / 2 + 0.006, R - 0.07), (W / 2, Ri + 0.04), (W / 2 - 0.02, Ri)]
    rings = []
    for s in range(S):
        a = s / S * 2 * math.pi
        ring = []
        for j, (x, r) in enumerate(prof):
            # the lugs: the tread raised in blocks — staggered across (left and right of the centre a half step apart)
            lug = 0.0
            if 3 <= j <= 7:
                ph = s + (0.5 if x > 0 else 0)
                lug = 0.016 if (int(ph) % 2 == 0) else 0.0
                if j in (3, 7): lug *= 0.6
            rr = r + lug
            ring.append(bm.verts.new((x * side, math.cos(a) * rr, math.sin(a) * rr)))
        rings.append(ring)
    for s in range(S):
        for j in range(len(prof) - 1):
            a, b, c, d = rings[s][j], rings[s][j + 1], rings[(s + 1) % S][j + 1], rings[(s + 1) % S][j]
            f = bm.faces.new((a, b, c, d) if side > 0 else (d, c, b, a)); f.material_index = 0
            for lp in f.loops:
                vv = math.atan2(lp.vert.co.z, lp.vert.co.y) / (2 * math.pi) * 2 * math.pi * R
                lp[uvl].uv = (lp.vert.co.x * 3 + j * 0.02, vv)
    # the rim: the barrel inside the bead, the dished disc, studs, the cap — on the outer side
    S2 = 24
    rimr = Ri - 0.004
    rim = []
    for xr in (-W / 2 + 0.03, W / 2 - 0.03):
        rim.append([bm.verts.new((xr * side, math.cos(s / S2 * 2 * math.pi) * rimr, math.sin(s / S2 * 2 * math.pi) * rimr)) for s in range(S2)])
    for s in range(S2):
        f = bm.faces.new((rim[0][s], rim[0][(s + 1) % S2], rim[1][(s + 1) % S2], rim[1][s]) if side < 0 else (rim[1][s], rim[1][(s + 1) % S2], rim[0][(s + 1) % S2], rim[0][s])); f.material_index = 1
        for lp in f.loops: lp[uvl].uv = (lp.vert.co.x * 4, math.atan2(lp.vert.co.z, lp.vert.co.y) * 0.3)
    disc = []
    for rr, xo in ((rimr, W / 2 - 0.03), (0.15, W / 2 - 0.06), (0.07, W / 2 - 0.05)):
        disc.append([bm.verts.new((xo * side, math.cos(s / S2 * 2 * math.pi) * rr, math.sin(s / S2 * 2 * math.pi) * rr)) for s in range(S2)])
    for k in range(len(disc) - 1):
        for s in range(S2):
            q = (disc[k][s], disc[k + 1][s], disc[k + 1][(s + 1) % S2], disc[k][(s + 1) % S2])
            f = bm.faces.new(q if side > 0 else tuple(reversed(q))); f.material_index = 1
            for lp in f.loops: lp[uvl].uv = (lp.vert.co.y * 2 + 0.5, lp.vert.co.z * 2 + 0.5)
    cap = bm.verts.new(((W / 2 - 0.03) * side, 0, 0))
    for s in range(S2):
        q = (disc[-1][s], disc[-1][(s + 1) % S2], cap)
        f = bm.faces.new(q if side > 0 else tuple(reversed(q))); f.material_index = 1
        for lp in f.loops: lp[uvl].uv = (lp.vert.co.y * 2 + 0.5, lp.vert.co.z * 2 + 0.5)
    for i in range(6):
        a = i / 6 * 2 * math.pi
        c = Vector(((W / 2 - 0.045) * side, math.cos(a) * 0.1, math.sin(a) * 0.1))
        tube(bm, uvl, [c, c + Vector((0.02 * side, 0, 0))], [(0.011, 0.011)] * 2, 1, 6)
    bm.normal_update()
    return obj(name, bm, [M_RUBBER, M_STEEL])
wl, wr = make_wheel('wheel_l', -1), make_wheel('wheel_r', 1)

# ===================================================================================================== the jockey wheel
bm, uvl = new_bm()
# (at its clamp on the drawbar's right rail: the post down, the little wheel in its fork, the crank on top)
tube(bm, uvl, [Vector((0, 0, 0.18)), Vector((0, 0, -0.32))], [(0.03, 0.03)] * 2, 0, 10)
box(bm, uvl, Vector((0, 0, 0.0)), (0.05, 0.05, 0.05), 0, 2)
tube(bm, uvl, [Vector((0, 0, 0.18)), Vector((0, 0, 0.24)), Vector((0.12, 0, 0.26))], [(0.01, 0.01)] * 3, 3, 6)
tube(bm, uvl, [Vector((0.12, 0, 0.26)), Vector((0.12, 0, 0.32))], [(0.016, 0.016)] * 2, 2, 6)
for sx in (-1, 1): box(bm, uvl, Vector((sx * 0.04, 0, -0.37)), (0.006, 0.04, 0.05), 0, 2)
jr = 0.08
ring = []
for s in range(16):
    a = s / 16 * 2 * math.pi
    ring.append([bm.verts.new((x, math.cos(a) * jr, -0.39 + math.sin(a) * jr)) for x in (-0.03, 0.03)])
for s in range(16):
    f = bm.faces.new((ring[s][0], ring[(s + 1) % 16][0], ring[(s + 1) % 16][1], ring[s][1])); f.material_index = 1
    for lp in f.loops: lp[uvl].uv = (lp.vert.co.x * 4, s / 16)
for x, idx in ((-0.03, 0), (0.03, 1)):
    c = bm.verts.new((x, 0, -0.39))
    for s in range(16):
        q = (ring[s][idx], ring[(s + 1) % 16][idx], c) if x > 0 else (ring[(s + 1) % 16][idx], ring[s][idx], c)
        f = bm.faces.new(q); f.material_index = 1
        for lp in f.loops: lp[uvl].uv = (lp.vert.co.y * 3 + 0.5, lp.vert.co.z * 3 + 0.5)
bm.normal_update()
jockey = obj('jockey', bm, [M_PAINT, M_RUBBER, M_STEEL, M_STEEL])

# place for the bake's look (the game sets them): the wheels at their hubs, the jockey at its clamp
wl.location = (-TRACK / 2, 0, WHEEL_R); wr.location = (TRACK / 2, 0, WHEEL_R)
jockey.location = (0.12, COUPLER_Y - 0.55, COUPLER_Z + 0.02)
parts = [body, wl, wr, jockey]
img_c, img_n = bake(parts, OUT, 1024, {'body': 1.0, 'wheel_l': 1.4, 'wheel_r': 1.4, 'jockey': 1.6}, log)
if PREVIEW:
    preview(parts, img_c, img_n, PREVIEW, [('trailer_34', (3.2, -3.0, 1.8), (0, 0.3, 0.5)), ('trailer_front', (-2.2, 4.4, 1.6), (0, 0.6, 0.5)), ('trailer_wheel', (1.8, -0.9, 0.7), (0.8, 0, 0.4))])
    log('preview rendered')
