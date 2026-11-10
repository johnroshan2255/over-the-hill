# OVERHILL — THE OFF-ROADER (2026-11-10, the user: "make the car like this … match exactly" — the target
# docs/reference/offroad_truck_target.png): a lifted boxy 4×4, modelled — chunky simplified forms with thick chamfers,
# pale solid glass, trapezoid arches under thick flares, a bull bar, a snorkel up the right A-pillar, a roof rack with
# four lamps, five-spoke rims in chunky lugged tyres, coil springs showing in the arches. Plain colours (no textures).
#
#   blender -b --factory-startup --python scripts/oth/offroader.py -- [OUT=src/assets/models/vehicles/offroader.glb] [PREVIEW=<dir>] [EXPORT=0]
#
# Blender space: x right, +y FORWARD, z up; the origin on the ground at the wheelbase's centre.
# Parts (the garage's names — assets/loadModels.ts): 'body' (all that doesn't move), 'wheel_FL' / 'wheel_FR' /
# 'wheel_RL' / 'wheel_RR' (each at its hub). Materials: CarPaint (takes the garage's paint), trim, glass, rim, tyre,
# glas_light (lamp lenses), glows (tail lamps), Under (the chassis), marker (the wing-top indicators).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assetkit import FRONTEND, reset, new_bm, tube, apply_mods
import bpy, bmesh
from mathutils import Vector

kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'vehicles', 'offroader.glb')))
PREVIEW = kw.get('PREVIEW')
EXPORT = kw.get('EXPORT', '1') != '0'
def log(*a): print('[offroader]', *a, flush=True)

# ------------------------------------------------------------------------------------------- the dimensions (m)
WB = 2.85; AY = WB / 2                      # wheelbase; the axles at y = ±AY
R, RI, TW, TRK = 0.48, 0.268, 0.33, 0.82    # tyre radius, rim radius, tyre width, half track
K, LIFT = 0.92, 0.055                       # the body is modelled a size up and lower, then scaled K across and in height (not in length) and raised LIFT:
                                            # its numbers below are BEFORE that (fitted to the target with the first, larger wheels)
HW = 0.88                                   # the body's half width
SILL, CREASE, BELT, ROOF = 0.69, 0.94, 1.65, 2.34
STRIP = 1.23                                # the rub strip's height
FRONT, REAR = 1.99, -2.05                   # the grille's face, the back's
COWL, WS_TOP = 0.7, 0.46                   # the windscreen's foot and head (y)
ROOF_HW, REAR_TOP = 0.81, -1.91
AB, AT, ARCH = 0.47, 0.37, 1.13             # the arch: half width at the sill, at its top; its top
ARCH_PRE = ARCH
FEND_F = 1.42                               # the wing's top at the nose (BELT at the cowl)
log(f'dims: wheelbase {WB} track {TRK * 2} tyre r {R} w {TW} body {FRONT - REAR:.2f} × {HW * 2} × {ROOF}')

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
V = lambda *a: Vector(a)

# ------------------------------------------------------------------------------------------------ the materials
def srgb(r, g, b): return tuple(((c / 255) ** 2.2) for c in (r, g, b))
def mat(name, rgb, rough=0.75, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m

reset()
MATS = [mat('CarPaint', srgb(70, 71, 72), 0.7), mat('trim', srgb(58, 59, 53), 0.8), mat('glass', srgb(148, 146, 158), 0.45),
        mat('rim', srgb(128, 128, 125), 0.6), mat('tyre', srgb(51, 53, 47), 0.9), mat('glas_light', srgb(205, 208, 215), 0.3),
        mat('glows', srgb(176, 40, 30), 0.4), mat('Under', srgb(34, 36, 36), 0.9), mat('marker', srgb(170, 170, 166), 0.5)]
MATS += [mat('interior', srgb(196, 190, 176), 0.9), mat('seat', srgb(156, 152, 146), 0.85), mat('dash', srgb(58, 58, 60), 0.85), mat('lamp_lens', srgb(242, 242, 236), 0.3), mat('dialface', srgb(200, 198, 190), 0.5), mat('steel', srgb(120, 122, 124), 0.5),
         mat('can_red', srgb(178, 52, 40), 0.7), mat('can_green', srgb(84, 112, 62), 0.7), mat('canvas', srgb(176, 150, 104), 0.9), mat('plate', srgb(232, 232, 226), 0.6), mat('amber', srgb(214, 128, 36), 0.5), mat('teal', srgb(58, 128, 126), 0.7)]
PAINT, TRIM, GLASS, RIM, TYRE, _GL, GLOW, UNDER, MARK, INNER, SEAT, DASH, LENS, DIAL, STEEL, CAN_R, CAN_G, CANVAS, PLATE, AMBER, TEAL = range(21)
# (names the loader reads — assets/loadModels.ts: CarPaint takes the paint; 'glass' is drawn as the windows; 'interior'
#  the linings, darkened; 'lamp_lens' (pale, facing forward) and 'glows' (red, facing back) are where it finds the head
#  and tail lamps — opaque here: a 'glas…' name would be drawn as window glass.)
GAME = {0: (0.75, 0.75, 0.75), 1: srgb(62, 63, 66), 3: srgb(176, 172, 162), 4: srgb(52, 53, 55), 7: srgb(54, 56, 58)}   # as EXPORTED (the look above is the target's render): the paint's panels pale — the game's paint takes its brightness from them; the trim, the tyres, the underside lifted off black (the game's light is harder)
PAINT_GAME = GAME[0]             # the paint's panels as exported: pale — the game's paint takes its brightness from them

# ------------------------------------------------------------------------------------------------- the builders
def hexa(bm, c, m):
    """A six-faced solid: c = 4 corners round one end, then the 4 matching round the other."""
    vs = [bm.verts.new(p) for p in c]
    for q in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in q]).material_index = m

def bx(bm, c, half, m, u=X, v=Y, w=Z):
    c = Vector(c); hx, hy, hz = half
    P = lambda a, b, d: c + u * (a * hx) + v * (b * hy) + w * (d * hz)
    hexa(bm, [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], m)

def bar(bm, p0, p1, wd, ht, m, up=Z, ext=0.0):
    """A square bar from p0 to p1: wd across, ht along `up` (made square to the bar); ext: longer at each end."""
    p0, p1 = Vector(p0), Vector(p1); d = (p1 - p0).normalized()
    side = d.cross(up); side = side.normalized() if side.length > 1e-6 else X.copy()
    u2 = side.cross(d).normalized()
    bx(bm, (p0 + p1) / 2, (wd / 2, (p1 - p0).length / 2 + ext, ht / 2), m, side, d, u2)

def prism(bm, pts, x0, x1, m):
    """A (y, z) outline pushed across x."""
    a = [bm.verts.new((x0, y, z)) for y, z in pts]; b = [bm.verts.new((x1, y, z)) for y, z in pts]
    n = len(pts)
    fs = [bm.faces.new(a), bm.faces.new(list(reversed(b)))] + [bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n])) for i in range(n)]
    for f in fs: f.material_index = m

def chamfer(pts, c):
    """Each corner of a closed outline (3D points) cut by c."""
    out = []; n = len(pts)
    for i in range(n):
        p, a, b = Vector(pts[i]), Vector(pts[i - 1]), Vector(pts[(i + 1) % n])
        out += [p + (a - p).normalized() * c, p + (b - p).normalized() * c]
    return out

def slab(bm, pts, nrm, t0, t1, m):
    """A flat outline (3D points) thickened along nrm from t0 to t1 (a pane, a seam, a badge)."""
    nrm = Vector(nrm).normalized()
    a = [bm.verts.new(Vector(p) + nrm * t0) for p in pts]; b = [bm.verts.new(Vector(p) + nrm * t1) for p in pts]
    n = len(pts)
    fs = [bm.faces.new(a), bm.faces.new(list(reversed(b)))] + [bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n])) for i in range(n)]
    for f in fs: f.material_index = m

def lathe(bm, prof, S, m, away=None, toward=None):
    """A profile [(x, r)] turned round the x axis; each face turned to look away from the ring `away` = (x, r) at its
    own angle, or toward the point `toward`."""
    rings = [[bm.verts.new((x, math.cos(s / S * 2 * math.pi) * r, math.sin(s / S * 2 * math.pi) * r)) for x, r in prof] for s in range(S)]
    for s in range(S):
        for j in range(len(prof) - 1):
            q = [rings[s][j], rings[s][j + 1], rings[(s + 1) % S][j + 1], rings[(s + 1) % S][j]]
            q = [v for i, v in enumerate(q) if all((v.co - o.co).length > 1e-7 for o in q[:i])]
            if len(q) < 3: continue
            f = bm.faces.new(q); f.material_index = m; f.normal_update()
            c = f.calc_center_median()
            if away is not None:
                a = math.atan2(c.z, c.y); ref = c - Vector((away[0], math.cos(a) * away[1], math.sin(a) * away[1]))
            else: ref = Vector(toward) - c
            if f.normal.dot(ref) < 0: f.normal_flip()

def finish(bm, name, bev=0.0, seg=2, sharp=40, recalc=True):
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in MATS: me.materials.append(m)
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    if bev:
        md = o.modifiers.new('bev', 'BEVEL'); md.width = bev; md.segments = seg; md.limit_method = 'ANGLE'; md.angle_limit = math.radians(30)
        apply_mods(o)
    for p in o.data.polygons: p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(sharp))
    return o

def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name
    return objs[0]

side_x = lambda z: HW - (HW - ROOF_HW) * max(0.0, z - BELT) / (ROOF - BELT)        # the body's side at height z
a_pillar_y = lambda z: COWL - (COWL - WS_TOP) * (z - BELT) / (ROOF - BELT)        # the windscreen's edge at height z
rear_y = lambda z: REAR + (REAR_TOP - REAR) * (z - BELT) / (ROOF - BELT)          # the back's at height z
SIDE_N = lambda sx: V(sx * (ROOF - BELT), 0, HW - ROOF_HW).normalized()            # the cabin side's normal
def side_pts(sx, yz): return [V(sx * side_x(z), y, z) for y, z in yz]
TH = 0.045                                  # a panel's thickness
S0 = SILL + 0.07                            # the doors' foot = the floor's top
DF, DB, DR = COWL - 0.045, -0.28, -1.16     # the doors' edges: the front door's leading, between the two, the back door's trailing
STRIPE = STRIP + 0.2                        # the livery stripe's height
TOPZ = ROOF - 0.07                          # the doors' heads (the roof's slab above)
TT = (TOPZ - BELT) / (ROOF - BELT)
QF = -0.78                                  # where the back door's foot ends (the arch's flare takes over)
parts = []                                  # the fixed body's pieces
cab = []                                    # the cabin's (cab_interior: drawn, not collided with)

def panel(bm, pts, n_in, th, m_out, m_in=None):
    """A flat panel: its outer face on pts (3D), th thick toward n_in; the inner face its own material (the lining)."""
    n_in = Vector(n_in).normalized(); m_in = m_out if m_in is None else m_in
    a = [bm.verts.new(Vector(q)) for q in pts]; b = [bm.verts.new(Vector(q) + n_in * th) for q in pts]; n = len(pts)
    bm.faces.new(a).material_index = m_out; bm.faces.new(list(reversed(b))).material_index = m_in
    for i in range(n): bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n])).material_index = m_out

def ring(bm, outer, inner, n_in, th, m_out, m_in=None, m_rev=None):
    """A panel with a WINDOW in it: the outline `outer` round the opening `inner` (as many points, corner for corner)."""
    n_in = Vector(n_in).normalized(); m_in = m_out if m_in is None else m_in; n = len(outer)
    oa = [bm.verts.new(Vector(q)) for q in outer]; ia = [bm.verts.new(Vector(q)) for q in inner]
    ob = [bm.verts.new(Vector(q) + n_in * th) for q in outer]; ib = [bm.verts.new(Vector(q) + n_in * th) for q in inner]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((oa[i], oa[j], ia[j], ia[i])).material_index = m_out
        bm.faces.new((ob[j], ob[i], ib[i], ib[j])).material_index = m_in
        bm.faces.new((oa[j], oa[i], ob[i], ob[j])).material_index = m_out
        bm.faces.new((ia[i], ia[j], ib[j], ib[i])).material_index = m_out if m_rev is None else m_rev

def sheet(bm, pts, m, out):
    """One face (a pane of glass, a lining), looking toward `out`."""
    f = bm.faces.new([bm.verts.new(Vector(q)) for q in pts]); f.material_index = m; f.normal_update()
    if f.normal.dot(Vector(out)) < 0: f.normal_flip()

def tuck(bm):
    """The lower body tucks in under the crease."""
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, CREASE), plane_no=(0, 0, 1))
    for v in bm.verts:
        if v.co.z < CREASE - 0.01: v.co.x *= (HW - 0.045) / HW

# ============================================================================================ the body's shell
# (HOLLOW from the bulkhead back: the cabin is a room — panels with their linings, the doors cut out as their own parts)
bm, _ = new_bm()
# the nose: solid from the grille to the bulkhead (the engine's bay), the front arches through it
prism(bm, [(FRONT, SILL), (FRONT, FEND_F - 0.03), (FRONT - 0.05, FEND_F), (COWL, BELT), (DF, BELT), (DF, SILL),
           (AY - AB, SILL), (AY - AT, ARCH), (AY + AT, ARCH), (AY + AB, SILL)], -HW, HW, PAINT)
# the floor (the sills its edges): full width under the doors, narrow between the back wheels' tubs, full width behind
# (behind the tubs it stands INSIDE the quarters and the tail: two skins in one plane blink — each frame a different one
#  wins the depth test, and with the painted texture they no longer look the same)
for y0, y1, hx in ((DF, QF, HW), (QF, -AY - AB, 0.4), (-AY - AB, REAR + TH + 0.002, HW - TH - 0.002)):
    bx(bm, V(0, (y0 + y1) / 2, (SILL + 0.004 + S0) / 2), (hx, (y0 - y1) / 2, (S0 - SILL - 0.004) / 2), PAINT)
for sx in (-1, 1):
    # the back quarter's side: from the back door round the arch to the tail
    q = [(DR, BELT), (REAR, BELT), (REAR, SILL), (-AY - AB, SILL), (-AY - AT, ARCH), (-AY + AT, ARCH), (-AY + AB, SILL), (QF, SILL), (QF, S0), (-0.95, ARCH + 0.15), (DR, ARCH + 0.15)]
    panel(bm, [V(sx * HW, y, z) for y, z in q], (-sx, 0, 0), TH, PAINT, INNER)
panel(bm, [V(-HW + TH + 0.002, REAR, SILL), V(HW - TH - 0.002, REAR, SILL), V(HW - TH - 0.002, REAR, BELT), V(-HW + TH + 0.002, REAR, BELT)], (0, 1, 0), TH, PAINT, INNER)   # the tail's panel (between the quarters)
tuck(bm)
parts.append(finish(bm, 'shell', 0.016, 2))

# the back wheels' tubs: an arch of sheet over each tyre, closed toward the cabin
bm, _ = new_bm()
for sx in (-1, 1):
    yc = -AY
    e = 0.005                # (5 mm outside the body's arch: two skins in one plane blink — scripts/oth/coplanar.py)
    o = [(yc + AB + e, SILL), (yc + AT + e, ARCH + e), (yc - AT - e, ARCH + e), (yc - AB - e, SILL), (yc - AB - 0.04, SILL), (yc - AT - 0.03, ARCH + 0.04), (yc + AT + 0.03, ARCH + 0.04), (yc + AB + 0.04, SILL)]
    prism(bm, o, sx * 0.39, sx * (HW - 0.01), UNDER)
    prism(bm, [(yc + AB + 0.04, SILL), (yc + AT + 0.03, ARCH + 0.04), (yc - AT - 0.03, ARCH + 0.04), (yc - AB - 0.04, SILL)], sx * 0.36, sx * 0.39, UNDER)
parts.append(finish(bm, 'tubs', 0.0))

# the roof: a slab over the doors' heads
bm, _ = new_bm()
xs, yf, yr = side_x(TOPZ), a_pillar_y(TOPZ), rear_y(TOPZ)
hexa(bm, [V(-xs, yr, TOPZ), V(xs, yr, TOPZ), V(xs, yf, TOPZ), V(-xs, yf, TOPZ),
          V(-ROOF_HW, REAR_TOP, ROOF), V(ROOF_HW, REAR_TOP, ROOF), V(ROOF_HW, WS_TOP, ROOF), V(-ROOF_HW, WS_TOP, ROOF)], PAINT)
parts.append(finish(bm, 'roof', 0.025, 2))

# the cabin's fixed frames, each round its window: the windscreen's, the back's, the two quarters'
wn = V(0, ROOF - BELT, COWL - WS_TOP).normalized()                                   # the windscreen's normal (out)
wp = lambda s, t: V(s * (HW - (HW - ROOF_HW) * t), COWL - (COWL - WS_TOP) * t, BELT + (ROOF - BELT) * t)
rn = V(0, -(ROOF - BELT), REAR_TOP - REAR).normalized()                              # the back's (out)
rp = lambda s, t: V(s * (HW - (HW - ROOF_HW) * t), REAR + (REAR_TOP - REAR) * t, BELT + (ROOF - BELT) * t)
WIN_Z0, WIN_Z1 = 1.71, 2.23
W_SCREEN = chamfer([wp(-0.86, 0.07), wp(0.86, 0.07), wp(0.84, 0.84), wp(-0.84, 0.84)], 0.035)
W_BACK = chamfer([rp(0.74, 0.1), rp(-0.74, 0.1), rp(-0.74, 0.84), rp(0.74, 0.84)], 0.035)
W_QUARTER = [(-1.24, WIN_Z0), (-1.87, WIN_Z0), (-1.79, WIN_Z1), (-1.24, WIN_Z1)]
bm, _ = new_bm()
ring(bm, chamfer([wp(-1, 0), wp(1, 0), wp(1, TT), wp(-1, TT)], 0.006), W_SCREEN, -wn, 0.04, TRIM, INNER)
ring(bm, chamfer([rp(1, 0), rp(-1, 0), rp(-1, TT), rp(1, TT)], 0.006), W_BACK, -rn, 0.04, PAINT, INNER, TRIM)
for sx in (-1, 1):
    ring(bm, chamfer(side_pts(sx, [(DR, BELT), (REAR, BELT), (rear_y(TOPZ), TOPZ), (DR, TOPZ)]), 0.006), chamfer(side_pts(sx, W_QUARTER), 0.05), -SIDE_N(sx), 0.04, PAINT, INNER, TRIM)
parts.append(finish(bm, 'frames', 0.01, 1))
GLASS_IN = 0.018                                                                     # the panes sit this deep in their frames
bm, _ = new_bm()
sheet(bm, [q - wn * GLASS_IN for q in W_SCREEN], GLASS, wn)
sheet(bm, [q - rn * GLASS_IN for q in W_BACK], GLASS, rn)
for sx in (-1, 1): sheet(bm, [q - SIDE_N(sx) * GLASS_IN for q in chamfer(side_pts(sx, W_QUARTER), 0.05)], GLASS, SIDE_N(sx))
parts.append(finish(bm, 'panes', 0.0, recalc=False))

# the bonnet: a raised centre, stepped in from the wings, a lip at its nose; a vent set in near the cowl
bm, _ = new_bm()
hz = lambda y: FEND_F + (BELT - FEND_F) * (FRONT - 0.05 - y) / (FRONT - 0.05 - COWL)   # the wing's top at y
y0, y1 = FRONT - 0.03, COWL + 0.03
hexa(bm, [V(-0.60, y0, hz(y0) - 0.03), V(0.60, y0, hz(y0) - 0.03), V(0.66, y1, hz(y1) - 0.03), V(-0.66, y1, hz(y1) - 0.03),
          V(-0.58, y0 - 0.02, hz(y0) + 0.05), V(0.58, y0 - 0.02, hz(y0) + 0.05), V(0.64, y1, hz(y1) + 0.045), V(-0.64, y1, hz(y1) + 0.045)], PAINT)
parts.append(finish(bm, 'bonnet', 0.014, 2))
bm, _ = new_bm()
hn = V(0, -(BELT - FEND_F), FRONT - 0.05 - COWL).normalized()
slab(bm, [V(-0.2, COWL + 0.44, hz(COWL + 0.44) + 0.045), V(0.2, COWL + 0.44, hz(COWL + 0.44) + 0.045), V(0.2, COWL + 0.26, hz(COWL + 0.26) + 0.045), V(-0.2, COWL + 0.26, hz(COWL + 0.26) + 0.045)], hn, -0.01, 0.004, TRIM)
for sx in (-1, 1):
    bar(bm, V(sx * 0.3, y0 - 0.06, hz(y0) + 0.05), V(sx * 0.34, COWL + 0.55, hz(COWL + 0.55) + 0.047), 0.02, 0.008, PAINT, hn)
parts.append(finish(bm, 'bonnet_trim', 0.0))

# ================================================================================================== the doors
def make_door(name, sx, lower, upper, win, handle_y, mirror):
    """A door, its own part (the game swings the driver's on its hinge): the skin below the belt, the frame round its
    window, the pane, its length of the rub strip, the handle, the lining and an armrest — and the mirror on a front one."""
    bm, _ = new_bm()
    panel(bm, [V(sx * HW, y, z) for y, z in lower], (-sx, 0, 0), TH, PAINT, INNER)
    tuck(bm)
    nu = SIDE_N(sx); wpts = chamfer(side_pts(sx, win), 0.05)
    ring(bm, chamfer(side_pts(sx, upper), 0.006), wpts, -nu, 0.04, PAINT, INNER, TRIM)
    objs = [finish(bm, name, 0.01, 1)]
    bm, _ = new_bm()
    ya, yb = max(q[0] for q in lower), min(q[0] for q in lower if q[1] > STRIP)
    bar(bm, V(sx * (HW + 0.008), ya - 0.012, STRIP), V(sx * (HW + 0.008), yb + 0.012, STRIP), 0.03, 0.04, TRIM)
    bx(bm, V(sx * (HW + 0.02), handle_y, STRIP + 0.015), (0.016, 0.06, 0.025), TRIM)
    bar(bm, V(sx * (HW + 0.002), ya - 0.004, STRIPE), V(sx * (HW + 0.002), yb + 0.004, STRIPE), 0.006, 0.07, PLATE)      # the livery's stripe
    for z in (1.08, 1.52): bx(bm, V(sx * (HW + 0.008), ya - 0.03, z), (0.01, 0.022, 0.035), TRIM)                 # the hinges
    bx(bm, V(sx * (HW - TH - 0.035), (ya + yb) / 2, 1.3), (0.035, (ya - yb) / 2 - 0.12, 0.03), DASH)        # the armrest
    if mirror:
        bar(bm, V(sx * (HW - 0.01), 0.52, 1.66), V(sx * (HW + 0.13), 0.54, 1.68), 0.05, 0.05, TRIM)
        bx(bm, V(sx * (HW + 0.22), 0.55, 1.71), (0.14, 0.075, 0.11), TRIM)
    objs.append(finish(bm, name + '_trim', 0.006, 1))
    bm, _ = new_bm()
    sheet(bm, [q - nu * GLASS_IN for q in wpts], GLASS, nu)
    objs.append(finish(bm, name + '_pane', 0.0, recalc=False))
    d = join(name, objs)
    d['hinge_pre'] = [sx * HW, ya, (S0 + BELT) / 2]
    return d

doors = []
for sx, sd in ((-1, 'L'), (1, 'R')):
    doors.append(make_door(f'door_F{sd}', sx, [(DF, S0), (DB, S0), (DB, BELT), (DF, BELT)],
                           [(a_pillar_y(BELT) - 0.045, BELT), (DB, BELT), (DB, TOPZ), (a_pillar_y(TOPZ) - 0.045, TOPZ)],
                           [(a_pillar_y(WIN_Z0) - 0.105, WIN_Z0), (-0.2, WIN_Z0), (-0.2, WIN_Z1), (a_pillar_y(WIN_Z1) - 0.105, WIN_Z1)], DB + 0.15, True))
    doors.append(make_door(f'door_R{sd}', sx, [(DB, S0), (QF, S0), (-0.95, ARCH + 0.15), (DR, ARCH + 0.15), (DR, BELT), (DB, BELT)],
                           [(DB, BELT), (DR, BELT), (DR, TOPZ), (DB, TOPZ)],
                           [(-0.36, WIN_Z0), (-1.07, WIN_Z0), (-1.07, WIN_Z1), (-0.36, WIN_Z1)], DR + 0.15, False))

# ========================================================================= the trim: pillars, gutters, strips
bm, _ = new_bm()
for sx in (-1, 1):
    # the A-pillar's band and the roof's gutter down the side
    bar(bm, V(sx * (HW + 0.004), COWL + 0.01, BELT + 0.02), V(sx * (ROOF_HW + 0.004), WS_TOP + 0.01, ROOF - 0.02), 0.09, 0.1, TRIM, wn)
    bar(bm, V(sx * (ROOF_HW + 0.006), WS_TOP - 0.02, ROOF - 0.035), V(sx * (ROOF_HW + 0.006), REAR_TOP + 0.02, ROOF - 0.035), 0.04, 0.045, TRIM)
    # the rub strip on the wing and on the back quarter (the doors carry their own lengths of it)
    bar(bm, V(sx * (HW + 0.008), FRONT - 0.03, STRIP), V(sx * (HW + 0.008), DF + 0.012, STRIP), 0.03, 0.04, TRIM)
    bar(bm, V(sx * (HW + 0.008), DR - 0.012, STRIP), V(sx * (HW + 0.008), REAR + 0.03, STRIP), 0.03, 0.04, TRIM)
    # the livery's stripe on the wing and the back quarter
    bar(bm, V(sx * (HW + 0.002), FRONT - 0.2, STRIPE), V(sx * (HW + 0.002), DF + 0.004, STRIPE), 0.006, 0.07, PLATE)
    bar(bm, V(sx * (HW + 0.002), DR - 0.004, STRIPE), V(sx * (HW + 0.002), REAR + 0.03, STRIPE), 0.006, 0.07, PLATE)
    # the mud flaps behind the wheels
    for yc in (AY, -AY): bx(bm, V(sx * 0.8, yc - AB - 0.085, 0.64), (0.16, 0.008, 0.14), UNDER)
    # the sill's step between the arches
    bar(bm, V(sx * (HW - 0.05), AY - AB + 0.03, SILL - 0.005), V(sx * (HW - 0.05), -AY + AB - 0.03, SILL - 0.005), 0.1, 0.07, TRIM)
    # the wing's vent: a dark slanted badge ahead of the door
    slab(bm, [V(sx * HW, 0.88, 1.5), V(sx * HW, 1.2, 1.5), V(sx * HW, 1.16, 1.57), V(sx * HW, 0.93, 1.585)], V(sx, 0, 0), -0.01, 0.004, TRIM)
# the dark header over the windscreen, pillar to pillar (a visor's depth)
hexa(bm, [V(-ROOF_HW - 0.02, WS_TOP - 0.2, ROOF - 0.075), V(ROOF_HW + 0.02, WS_TOP - 0.2, ROOF - 0.075), V(ROOF_HW + 0.025, a_pillar_y(TOPZ) + 0.035, ROOF - 0.075), V(-ROOF_HW - 0.025, a_pillar_y(TOPZ) + 0.035, ROOF - 0.075),
          V(-ROOF_HW - 0.012, WS_TOP - 0.2, ROOF + 0.014), V(ROOF_HW + 0.012, WS_TOP - 0.2, ROOF + 0.014), V(ROOF_HW + 0.012, WS_TOP + 0.03, ROOF + 0.014), V(-ROOF_HW - 0.012, WS_TOP + 0.03, ROOF + 0.014)], TRIM)
# the dark band from the left pillar's foot down the wing to the strip
bar(bm, V(-HW - 0.012, COWL + 0.0, BELT + 0.03), V(-HW - 0.012, COWL + 0.36, STRIP + 0.07), 0.04, 0.085, TRIM, X)
# the aerial, on the left wing
bar(bm, V(-0.72, COWL + 0.12, BELT - 0.06), V(-0.72, COWL + 0.02, BELT + 0.95), 0.012, 0.012, UNDER, X)
# the back: the door's seams, the handle, the strip
for x in (-0.7, 0.7): bar(bm, V(x, REAR - 0.001, SILL + 0.05), V(x, REAR - 0.001, BELT), 0.006, 0.014, UNDER, X)
bx(bm, V(0.55, REAR - 0.02, STRIP), (0.07, 0.02, 0.03), TRIM)
bar(bm, V(-HW + 0.03, REAR - 0.008, STRIP), V(HW - 0.03, REAR - 0.008, STRIP), 0.04, 0.03, TRIM, Y)
parts.append(finish(bm, 'trim', 0.006, 1))
bm, _ = new_bm()
for sx in (-1, 1):
    bx(bm, V(sx * 0.79, REAR - 0.012, STRIP - 0.13), (0.065, 0.02, 0.09), GLOW)
    bx(bm, V(sx * 0.79, REAR - 0.012, STRIP - 0.255), (0.065, 0.02, 0.03), MARK)
parts.append(finish(bm, 'lights_tail_glows', 0.008, 1))

# ================================================================================================== the cabin
# (cab_interior — the game draws it with the body, seen through the glass; never collided with)
HUB = V(-0.4, 0.3, 1.6)                                                               # the steering wheel's hub
bm, _ = new_bm()
for sx in (-1, 1):
    # a front seat: the cushion, the back leaned 12°, the headrest
    c, s_ = math.cos(math.radians(12)), math.sin(math.radians(12))
    bx(bm, V(sx * 0.4, -0.12, 1.02), (0.24, 0.25, 0.08), SEAT)
    bx(bm, V(sx * 0.4, -0.42, 1.42), (0.24, 0.055, 0.34), SEAT, X, V(0, c, s_), V(0, -s_, c))
    bx(bm, V(sx * 0.4, -0.5, 1.86), (0.13, 0.045, 0.09), SEAT, X, V(0, c, s_), V(0, -s_, c))
# the back bench
bx(bm, V(0, -0.72, 1.02), (0.6, 0.21, 0.08), SEAT)
bx(bm, V(0, -0.99, 1.4), (0.6, 0.05, 0.32), SEAT, X, V(0, 0.985, 0.17), V(0, -0.17, 0.985))
cab.append(finish(bm, 'cab_seats', 0.03, 2))
bm, _ = new_bm()
bx(bm, V(0, 0.53, 1.47), (HW - 0.07, 0.16, 0.16), DASH)                                # the dash
bx(bm, V(-0.4, 0.4, 1.655), (0.17, 0.07, 0.05), DASH)                                 # the binnacle over the dials
bx(bm, V(0.38, 0.365, 1.44), (0.2, 0.012, 0.07), TRIM)                                # the glovebox's lid
bx(bm, V(0, 0.36, 1.46), (0.13, 0.014, 0.1), TRIM)                                    # the centre stack
bx(bm, V(0, 0.0, 0.92), (0.11, 0.42, 0.16), DASH)                                     # the console between the seats
bx(bm, V(0.035, -0.2, 1.1), (0.02, 0.1, 0.02), TRIM)                                  # the handbrake
cab.append(finish(bm, 'cab_dash', 0.02, 2))
bm, uvl = new_bm()
for x in (-0.47, -0.33):
    tube(bm, uvl, [V(x, 0.335, 1.655), V(x, 0.325, 1.655)], [(0.052, 0.052)] * 2, DIAL, 14)   # the two dials' faces
# the linings that are single faces: the floor's mats (three, round the tubs), the headliner, the bulkhead's
for ya, yb, hx in ((DF - 0.01, QF, 0.78), (QF, -AY - AB, 0.37), (-AY - AB, REAR + 0.05, 0.78)):
    sheet(bm, [V(-hx, ya, S0 + 0.004), V(hx, ya, S0 + 0.004), V(hx, yb, S0 + 0.004), V(-hx, yb, S0 + 0.004)], DASH, Z)
xh = side_x(TOPZ) - 0.045
sheet(bm, [V(-xh, yf - 0.04, TOPZ - 0.004), V(xh, yf - 0.04, TOPZ - 0.004), V(xh, yr + 0.04, TOPZ - 0.004), V(-xh, yr + 0.04, TOPZ - 0.004)], INNER, -Z)
sheet(bm, [V(-0.8, DF - 0.004, S0), V(0.8, DF - 0.004, S0), V(0.8, DF - 0.004, 1.36), V(-0.8, DF - 0.004, 1.36)], DASH, -Y)
cab.append(finish(bm, 'cab_linings', 0.0, recalc=False))

# ================================================================================================ the flares
bm, _ = new_bm()
for yc in (-AY, AY):
    z0 = SILL - 0.05
    e = 0.005                # (5 mm inside the body's arch — the same)
    o = [(yc + AB - e, z0), (yc + AT - e, ARCH - e), (yc - AT + e, ARCH - e), (yc - AB + e, z0),
         (yc - AB - 0.15, z0), (yc - AT - 0.09, ARCH + 0.13), (yc + AT + 0.09, ARCH + 0.13), (yc + AB + 0.15, z0)]
    for sx in (-1, 1): prism(bm, o, sx * (HW - 0.06), sx * (HW + 0.085), TRIM)
parts.append(finish(bm, 'flares', 0.018, 2))

# ============================================================================================ the nose: grille, lamps
bm, _ = new_bm()
gz0, gz1 = 1.12, 1.36
bx(bm, V(0, FRONT + 0.004, (gz0 + gz1) / 2), (0.44, 0.012, (gz1 - gz0) / 2), TRIM)                 # the grille's panel
for i in range(4):
    z = gz0 + 0.05 + i * (gz1 - gz0 - 0.1) / 3
    bx(bm, V(0, FRONT + 0.02, z), (0.4, 0.012, 0.016), STEEL)                                      # its slats
bx(bm, V(0, FRONT + 0.225, 0.915), (0.2, 0.008, 0.06), PLATE)                                     # the number plate, on the bumper
bx(bm, V(0, REAR - 0.145, 0.84), (0.17, 0.008, 0.055), PLATE)                                      # … and the back one
for sx in (-1, 1):
    bx(bm, V(sx * 0.655, FRONT + 0.006, (gz0 + gz1) / 2), (0.175, 0.016, (gz1 - gz0) / 2), TRIM)    # the lamp's dark box
    bx(bm, V(sx * 0.7, FRONT + 0.2, 0.915), (0.06, 0.012, 0.03), AMBER)                            # the indicator in the bumper
    # the wing-top marker: a pale wedge
    y = FRONT - 0.22
    hexa(bm, [V(sx * 0.82, y + 0.1, hz(y + 0.1)), V(sx * 0.66, y + 0.1, hz(y + 0.1)), V(sx * 0.66, y - 0.1, hz(y - 0.1)), V(sx * 0.82, y - 0.1, hz(y - 0.1)),
              V(sx * 0.80, y + 0.07, hz(y) + 0.04), V(sx * 0.68, y + 0.07, hz(y) + 0.04), V(sx * 0.68, y - 0.05, hz(y) + 0.06), V(sx * 0.80, y - 0.05, hz(y) + 0.06)], MARK)
parts.append(finish(bm, 'nose', 0.008, 1))
bm, uvl = new_bm()
for sx in (-1, 1):
    c = V(sx * 0.665, FRONT + 0.02, 1.25)
    tube(bm, uvl, [c, c + Y * 0.035], [(0.1, 0.1), (0.096, 0.096)], LENS, 20)                      # the lamp: a flat white lens
parts.append(finish(bm, 'head_lamps', 0.0))

# ===================================================================================== the bumpers and the bull bar
bm, _ = new_bm()
# the front bumper: an upper bar, its ends swept back; a faceted lower valance tucked under
hexa(bm, [V(-0.96, FRONT - 0.1, 0.82), V(0.96, FRONT - 0.1, 0.82), V(0.8, FRONT + 0.22, 0.82), V(-0.8, FRONT + 0.22, 0.82),
          V(-0.96, FRONT - 0.1, 1.01), V(0.96, FRONT - 0.1, 1.01), V(0.8, FRONT + 0.18, 1.01), V(-0.8, FRONT + 0.18, 1.01)], TRIM)
hexa(bm, [V(-0.9, FRONT - 0.16, 0.64), V(0.9, FRONT - 0.16, 0.64), V(0.7, FRONT + 0.06, 0.64), V(-0.7, FRONT + 0.06, 0.64),
          V(-0.95, FRONT - 0.16, 0.84), V(0.95, FRONT - 0.16, 0.84), V(0.78, FRONT + 0.17, 0.84), V(-0.78, FRONT + 0.17, 0.84)], TRIM)
# the back bumper: a bar, its corners wrapped
hexa(bm, [V(-0.94, REAR + 0.12, 0.74), V(0.94, REAR + 0.12, 0.74), V(0.84, REAR - 0.14, 0.74), V(-0.84, REAR - 0.14, 0.74),
          V(-0.94, REAR + 0.12, 0.94), V(0.94, REAR + 0.12, 0.94), V(0.84, REAR - 0.13, 0.94), V(-0.84, REAR - 0.13, 0.94)][::-1], TRIM)
parts.append(finish(bm, 'bumpers', 0.022, 2))
# the bull bar: a hoop off the bumper over the grille (two uprights, a top and a mid rail)
bm, _ = new_bm()
by_, T = FRONT + 0.2, 0.06
uvb = bm.loops.layers.uv.verify()
for sx in (-1, 1):
    tube(bm, uvb, [V(sx * 0.44, by_, 0.82), V(sx * 0.44, by_, 1.36), V(sx * 0.4, by_ - 0.01, 1.4)], [(0.028, 0.028)] * 3, TRIM, 8)
    tube(bm, uvb, [V(sx * 0.44, by_, 1.12), V(sx * 0.86, by_ - 0.02, 1.12), V(sx * 0.92, by_ - 0.12, 1.12)], [(0.024, 0.024)] * 3, TRIM, 8)   # the lamp guards
    tube(bm, uvb, [V(sx * 0.44, by_, 1.34), V(sx * 0.86, by_ - 0.02, 1.34), V(sx * 0.92, by_ - 0.12, 1.34)], [(0.024, 0.024)] * 3, TRIM, 8)
for z in (1.4, 1.12): tube(bm, uvb, [V(-0.42, by_ - 0.01, z), V(0.42, by_ - 0.01, z)], [(0.028, 0.028)] * 2, TRIM, 8)
parts.append(finish(bm, 'bullbar', 0.0))

# ================================================================================================ the snorkel
bm, _ = new_bm()
sxr = HW + 0.075
bx(bm, V(HW + 0.03, COWL + 0.2, BELT - 0.16), (0.045, 0.13, 0.055), TRIM)                                         # its foot on the wing
p0, p1 = V(sxr + 0.02, COWL + 0.14, BELT - 0.1), V(ROOF_HW + 0.11, WS_TOP + 0.2, ROOF - 0.06)
bar(bm, p0, p1, 0.065, 0.07, TRIM, wn, ext=0.03)                                                     # up the pillar
p2 = p1 + V(0, 0.0, 0.07)
hexa(bm, [p2 + V(-0.045, -0.05, -0.05), p2 + V(0.045, -0.05, -0.05), p2 + V(0.045, -0.05, 0.06), p2 + V(-0.045, -0.05, 0.06),
          p2 + V(-0.055, 0.15, -0.055), p2 + V(0.055, 0.15, -0.055), p2 + V(0.055, 0.15, 0.07), p2 + V(-0.055, 0.15, 0.07)], TRIM)   # the head, its mouth forward
parts.append(finish(bm, 'snorkel', 0.016, 2))
bm, _ = new_bm()
bx(bm, p2 + V(0, 0.152, 0.008), (0.04, 0.004, 0.045), UNDER)                                       # its mouth
parts.append(finish(bm, 'snorkel_mouth', 0.0))

# =============================================================================================== the roof rack
bm, _ = new_bm()
RX, RY0, RY1, RZ0, RZ1, RT = 0.76, WS_TOP - 0.15, REAR_TOP + 0.12, ROOF + 0.08, ROOF + 0.17, 0.035
for z in (RZ0, RZ1):
    for sx in (-1, 1): bar(bm, V(sx * RX, RY0, z), V(sx * RX, RY1, z), RT, RT, TRIM, ext=RT / 2)
    for y in (RY0, RY1): bar(bm, V(-RX, y, z), V(RX, y, z), RT, RT, TRIM)
legs = [0.0, -0.54, -1.08, -1.58]
for sx in (-1, 1):
    for y in legs:
        bar(bm, V(sx * (ROOF_HW - 0.02), y - 0.09, ROOF - 0.01), V(sx * RX, y, RZ0), 0.05, 0.06, TRIM, Y)   # the legs, splayed
        bar(bm, V(sx * RX, y, RZ0), V(sx * RX, y, RZ1), RT, RT, TRIM, Y)                             # the posts
        bx(bm, V(sx * (ROOF_HW - 0.03), y - 0.09, ROOF + 0.004), (0.05, 0.05, 0.016), TRIM)                # the feet
    for y in (RY0, RY1): bar(bm, V(sx * RX, y, RZ0), V(sx * RX, y, RZ1), RT, RT, TRIM, Y)
for x in (-0.37, 0.0, 0.37):
    for y in (RY0, RY1): bar(bm, V(x, y, RZ0), V(x, y, RZ1), RT, RT, TRIM, Y)
n_cross = 6
for i in range(1, n_cross):
    y = RY0 + (RY1 - RY0) * i / n_cross
    bar(bm, V(-RX, y, RZ0), V(RX, y, RZ0), 0.04, 0.03, TRIM)                                      # the floor's slats
for x in (-0.25, 0.25): bar(bm, V(x, RY0, RZ0), V(x, RY1, RZ0), 0.03, 0.022, TRIM)                 # … and two along
parts.append(finish(bm, 'rack', 0.008, 1))
# its load: two jerry cans (green, red), a teal box, two strapped bags; three white lamps on its front rail
bm, _ = new_bm()
cz = RZ0 + 0.02
for x, y, m in ((-0.42, 0.02, CAN_G), (-0.42, -0.34, CAN_R)):
    bx(bm, V(x, y, cz + 0.21), (0.19, 0.085, 0.21), m)                                             # a can, across
    bx(bm, V(x + 0.1, y, cz + 0.44), (0.03, 0.03, 0.025), m)                                       # its spout
    bar(bm, V(x - 0.1, y, cz + 0.45), V(x + 0.03, y, cz + 0.45), 0.025, 0.02, m)                   # its handle
bx(bm, V(-0.35, -1.25, cz + 0.13), (0.2, 0.2, 0.13), TEAL)                                          # the box
for x, hx, hy, hz_ in ((0.3, 0.34, 0.25, 0.16), (-0.02, 0.13, 0.215, 0.135)):                       # (each its own size: no two faces in one plane)
    bx(bm, V(x, -1.3, cz + hz_ + (0.004 if hx < 0.2 else 0)), (hx, hy, hz_), CANVAS)                                    # the bags
bx(bm, V(0.25, -1.3, cz + 0.16), (0.36, 0.04, 0.165), CAN_R)                                        # their strap
parts.append(finish(bm, 'rack_load', 0.03, 2))
bm, _ = new_bm()
for x in (-0.55, 0.0, 0.55):
    bx(bm, V(x, RY0 + 0.02, RZ1 + 0.03), (0.07, 0.045, 0.05), PLATE)                                # a lamp
# the SPARE's bracket on the back door (the spare itself is a REAL wheel — make_wheel, below, with the other four)
sp = V(0.18, REAR - 0.17, 1.3)
uvs_ = bm.loops.layers.uv.verify()
tube(bm, uvs_, [sp + Y * 0.17, sp + Y * 0.05], [(0.05, 0.05)] * 2, TRIM, 8)                        # the bracket
bx(bm, V(0.1, -0.7, cz + 0.11), (0.42, 0.2, 0.11), CANVAS)                                        # (on the rack, where the picture had its spare: a canvas roll)
parts.append(finish(bm, 'rack_spare', 0.0))

from mathutils import Matrix
FIT_M = Matrix.Translation((0, 0, LIFT)) @ Matrix.Diagonal((K, 1, K, 1))
for o in parts + cab + doors: o.data.transform(FIT_M)
ARCH = ARCH * K + LIFT
Tp = lambda v: V(v[0] * K, v[1], v[2] * K + LIFT)                                     # a point modelled before the fit, after it
gl = lambda v: [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]                      # … in the file's space (glTF: y up, −z forward)
for d in doors: d['hinge'] = gl(Tp(d['hinge_pre'])); del d['hinge_pre']

# ====================================================================== underneath: chassis, axles, springs, dampers
bm, uvl = new_bm()
bx(bm, V(0, AY, (0.62 + ARCH) / 2), (0.372, AB + 0.02, (ARCH - 0.62) / 2 + 0.01), UNDER)              # the front wells' inner wall (the back ones: the tubs)
tube(bm, uvl, [V(-0.45, REAR + 0.5, 0.6), V(-0.45, REAR - 0.1, 0.6)], [(0.04, 0.04)] * 2, STEEL, 10)   # the tailpipe
for sx in (-1, 1): bx(bm, V(sx * 0.33, -0.02, 0.56), (0.05, 1.85, 0.07), UNDER)                      # the ladder's rails
for yc, off in ((AY, 0.2), (-AY, -0.05)):
    tube(bm, uvl, [V(-TRK + 0.12, yc, R), V(TRK - 0.12, yc, R)], [(0.055, 0.055)] * 2, UNDER, 10)  # the axle
    tube(bm, uvl, [V(off - 0.13, yc, R), V(off - 0.07, yc, R), V(off + 0.07, yc, R), V(off + 0.13, yc, R)], [(0.07, 0.07), (0.15, 0.15), (0.15, 0.15), (0.07, 0.07)], UNDER, 10)
    tube(bm, uvl, [V(off, yc - math.copysign(0.14, yc), R), V(0.05, 0, 0.58)], [(0.035, 0.035)] * 2, UNDER, 8)   # the prop shaft
    for sx in (-1, 1):
        # the coil: a helix from the axle's perch to the well's roof; the damper beside it
        cx, turns, r0, zb, zt = sx * 0.47, 5.5, 0.07, R + 0.07, ARCH - 0.02
        n = int(turns * 10)
        path = [V(cx + math.cos(i / 10 * 2 * math.pi) * r0, yc + math.sin(i / 10 * 2 * math.pi) * r0, zb + (zt - zb) * i / n) for i in range(n + 1)]
        tube(bm, uvl, path, [(0.017, 0.017)] * len(path), STEEL, 6)
        tube(bm, uvl, [V(cx, yc, zb - 0.03), V(cx, yc, zb + 0.02)], [(0.095, 0.095)] * 2, UNDER, 10)
        dy = yc - math.copysign(0.2, yc)
        tube(bm, uvl, [V(cx, dy, R + 0.02), V(cx, dy, ARCH - 0.02)], [(0.028, 0.028)] * 2, TRIM, 8)
        tube(bm, uvl, [V(cx - sx * 0.1, yc, R), V(sx * 0.33, yc - math.copysign(0.75, yc), 0.58)], [(0.03, 0.03)] * 2, UNDER, 6)   # the radius arm
parts.append(finish(bm, 'under', 0.0))

body = join('body', parts)

# =========================================================================== the cockpit's moving parts (after the fit)
# Each its own part with what the game needs to move it (assets/loadModels.ts): the steering wheel (found by its ring),
# the pedals / the gear lever / the wipers with `pivot` and `axis` (the file's space; a + turn about `axis` presses the
# pedal, sweeps the wiper up the screen — checked below).
hub = Tp(HUB)
col = V(0, math.cos(math.radians(22)), -math.sin(math.radians(22)))                   # the column: forward and down
e1, e2 = X.copy(), V(0, math.sin(math.radians(22)), math.cos(math.radians(22)))       # the rim's plane
bm, uvl = new_bm()
RIMR = 0.185
tube(bm, uvl, [hub + (e1 * math.cos(i / 20 * 2 * math.pi) + e2 * math.sin(i / 20 * 2 * math.pi)) * RIMR for i in range(21)], [(0.017, 0.017)] * 21, DASH, 8, caps=False)
for deg in (0, 180, 270):
    a = math.radians(deg); bar(bm, hub, hub + (e1 * math.cos(a) + e2 * math.sin(a)) * RIMR, 0.04, 0.016, DASH, col)
tube(bm, uvl, [hub - col * 0.02, hub + col * 0.02], [(0.05, 0.05)] * 2, TRIM, 12)
steer = finish(bm, 'steering_wheel', 0.0)
bm, uvl = new_bm()
tube(bm, uvl, [hub + col * 0.02, hub + col * 0.3], [(0.03, 0.03)] * 2, DASH, 8)       # the column, into the dash
cab.append(finish(bm, 'cab_column', 0.0))
cabin = join('cab_interior', cab)

def turned(v, axis, ang):
    """v turned by ang about axis — in the GAME's frame (x right, y up, z back), as it turns the part."""
    g = lambda q: Vector((q[0], q[2], -q[1]))
    return Matrix.Rotation(ang, 3, Vector(axis)) @ g(v)

movers = []
def pedal(name, x, pad_w):
    piv, pad = Tp((x, 0.61, 1.24)), Tp((x, 0.5, 0.95))
    bm, _ = new_bm()
    bar(bm, piv, pad, 0.02, 0.014, STEEL, X)
    d = (pad - piv).normalized()
    bx(bm, pad, (pad_w, 0.008, 0.045), STEEL, X, d.cross(X).normalized(), d)
    o = finish(bm, name, 0.0)
    o['pivot'] = gl(piv); o['axis'] = [1.0, 0.0, 0.0]
    t = turned(pad - piv, o['axis'], 0.3)
    assert t.z < -(pad - piv).y - 0.02, f'{name}: pressed, the pad must go FORWARD'       # (game z: back)
    movers.append(o)
pedal('pedal_gas', -0.3, 0.03); pedal('pedal_brake', -0.46, 0.05)
bm, uvl = new_bm()
g0, g1 = Tp((0, 0.12, 1.08)), Tp((0, 0.1, 1.27))
tube(bm, uvl, [g0, g1], [(0.014, 0.014)] * 2, STEEL, 8)
bx(bm, g1, (0.028, 0.028, 0.03), DASH)
o = finish(bm, 'gear_lever', 0.0); o['pivot'] = gl(g0); o['axis'] = [1.0, 0.0, 0.0]; movers.append(o)
# the wipers: parked along the screen's foot, each pivot at its left end; they sweep up the glass
wt = V(0, -(COWL - WS_TOP), (ROOF - BELT) * K).normalized()                           # up the screen (after the fit)
wno = X.cross(wt).normalized()                                                        # out of it
if wno.y < 0: wno = -wno
scr = lambda x, t: Tp((x / K, COWL - (COWL - WS_TOP) * t, BELT + (ROOF - BELT) * t)) + wno * 0.022
for name, xp in (('wiper_L', -0.4), ('wiper_R', 0.12)):
    piv, tip = scr(xp, 0.05), scr(xp + 0.47, 0.1)
    bm, uvl = new_bm()
    bar(bm, piv, tip, 0.016, 0.012, DASH, wno)
    bar(bm, piv + (tip - piv) * 0.12, tip, 0.03, 0.008, UNDER, wno)
    tube(bm, uvl, [piv - wno * 0.02, piv + wno * 0.012], [(0.02, 0.02)] * 2, DASH, 8)
    o = finish(bm, name, 0.0)
    ax = Vector((wno.x, wno.z, -wno.y))                                               # (the game's frame)
    if turned(tip - piv, ax, 0.7).y < (tip - piv).z: ax = -ax                         # … whichever way lifts the blade
    assert turned(tip - piv, ax, 0.7).y > (tip - piv).z + 0.1
    o['pivot'] = gl(piv); o['axis'] = [round(c, 5) for c in ax]
    movers.append(o)
log('steering hub (game)', gl(hub), 'wiper axis', movers[-1]['axis'])

# ================================================================================================== the wheels
def make_wheel(name, s):
    """A chunky lugged tyre (staggered tread blocks, shoulder blocks down the sidewall) on a five-spoke rim — at its
    hub, its axis along x, its outer face toward s."""
    bm, uvl = new_bm()        # the turned surfaces (each face set to look out as it is made)
    bs, uvs = new_bm()        # the closed solids — lugs, spokes, hub (their faces set right together)
    W = TW
    prof = [(-W / 2 + 0.035, RI), (-W / 2 + 0.004, RI + 0.03), (-W / 2 - 0.012, RI + 0.09), (-W / 2 - 0.006, R - 0.075), (-W / 2 + 0.03, R - 0.03),
            (-W / 2 + 0.075, R - 0.014), (0, R - 0.012), (W / 2 - 0.075, R - 0.014), (W / 2 - 0.03, R - 0.03), (W / 2 + 0.006, R - 0.075),
            (W / 2 + 0.012, RI + 0.09), (W / 2 - 0.004, RI + 0.03), (W / 2 - 0.035, RI)]
    lathe(bm, prof, 40, TYRE, away=(0, (R + RI) / 2))
    N = 26
    for sd in (-1, 1):
        for i in range(N):
            a = (i + (0.5 if sd > 0 else 0)) / N * 2 * math.pi
            rad, tan = V(0, math.cos(a), math.sin(a)), V(0, -math.sin(a), math.cos(a))
            # the tread block (a little skewed: the chevron), then the shoulder block down the sidewall
            sk = tan * 0.02 * sd
            c0, c1 = rad * (R - 0.012), rad * (R - 0.03)
            hexa(bs, [c0 + X * sd * 0.012 - tan * 0.036 - rad * 0.03, c0 + X * sd * 0.012 + tan * 0.036 - rad * 0.03,
                      c1 + X * sd * (W / 2 - 0.02) + tan * 0.04 + sk - rad * 0.03, c1 + X * sd * (W / 2 - 0.02) - tan * 0.04 + sk - rad * 0.03,
                      c0 + X * sd * 0.02 - tan * 0.03 + rad * 0.012, c0 + X * sd * 0.02 + tan * 0.03 + rad * 0.012,
                      c1 + X * sd * (W / 2 - 0.035) + tan * 0.034 + sk + rad * 0.012, c1 + X * sd * (W / 2 - 0.035) - tan * 0.034 + sk + rad * 0.012], TYRE)
            cs = rad * (R - 0.085) + X * sd * (W / 2 - 0.014) + sk
            bx(bs, cs, (0.02, 0.034, 0.05), TYRE, X, tan, rad)
    # the rim: its lip, the barrel down to a closed back, five thick spokes, the hub and its cap
    xo = s * (W / 2 - 0.03)
    lathe(bm, [(s * (W / 2 - 0.045), RI + 0.012), (xo + s * 0.012, RI + 0.008), (xo + s * 0.012, RI - 0.022), (xo, RI - 0.03), (xo - s * 0.045, RI - 0.07), (xo - s * 0.02, 0.14), (xo + s * 0.004, 0.085), (xo + s * 0.01, 0.0)], 30, RIM, toward=V(s * 3, 0, 0))
    lathe(bm, [(-s * (W / 2 - 0.045), RI + 0.012), (-s * (W / 2 - 0.035), RI - 0.02), (-s * 0.02, RI - 0.045), (-s * 0.02, 0.0)], 20, UNDER, toward=V(-s * 3, 0, 0))
    for i in range(8):
        a = i / 8 * 2 * math.pi; c = V(0, math.cos(a), math.sin(a)) * 0.185 + X * (xo - s * 0.05)
        tube(bs, uvs, [c, c + X * s * 0.022], [(0.024, 0.024)] * 2, UNDER, 8)                        # a hole in the dish
    for i in range(5):
        a = (i / 5 + 0.1) * 2 * math.pi; c = V(0, math.cos(a), math.sin(a)) * 0.062 + X * (xo - s * 0.005)
        tube(bs, uvs, [c, c + X * s * 0.02], [(0.011, 0.011)] * 2, UNDER, 6)                         # a wheel nut
    tube(bs, uvs, [V(xo - s * 0.01, 0, 0), V(xo + s * 0.03, 0, 0)], [(0.04, 0.04), (0.034, 0.034)], RIM, 12)   # the hub's cap
    return join(name, [finish(bm, name, 0.0, sharp=35, recalc=False), finish(bs, name + '_solids', 0.0, sharp=35)])

wheels = []
for name, sx, yc in (('wheel_FL', -1, AY), ('wheel_FR', 1, AY), ('wheel_RL', -1, -AY), ('wheel_RR', 1, -AY)):
    w = make_wheel(name, sx); w.location = (sx * TRK, yc, R); w['rim'] = round(RI / R, 3); wheels.append(w)
# THE SPARE: a fifth wheel like the four, its face to the back, on the back door's bracket. Its own object until the
# shading is baked (carkit.weather: it would shadow the door behind it into one dark patch), then part of the body.
spare = make_wheel('spare', 1)
spare.data.transform(Matrix.Translation((0.18 * K, REAR - TW / 2 - 0.03, 1.3 * K + LIFT)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))
allp = [body, cabin, steer] + movers + doors + wheels
tot = 0
for o in allp + [spare]:
    o.data.calc_loop_triangles(); tot += len(o.data.loop_triangles); log(f'{o.name}: {len(o.data.loop_triangles)} triangles')
# what the catalogue and the tests need (the game's frame: x right, y up, −z forward)
bpy.context.view_layer.update()
def bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi
lo, hi = bounds([body] + doors + wheels + [spare])
blo, bhi = bounds([body] + doors + [spare])
log(f'TOTAL {tot} triangles; catalogue length (nose to tail) {hi.y - lo.y:.4f} m; body half x {(bhi.x - blo.x) / 2:.3f} y {(bhi.z - blo.z) / 2:.3f} z {(bhi.y - blo.y) / 2:.3f}; front z {-bhi.y:.3f} rear z {-blo.y:.3f}')
log('lamps (game): head', [round(0.665 * K, 3), round(1.25 * K + LIFT, 3), round(-(FRONT + 0.05), 3)], 'tail', [round(0.79 * K, 3), round((STRIP - 0.16) * K + LIFT, 3), round(-(REAR - 0.035), 3)], 'exhaust', [-0.45, 0.6, round(-(REAR - 0.1), 3)])

# ================================================================================================== the export
if EXPORT:
    bpy.ops.object.select_all(action='DESELECT')
    for o in allp: o.select_set(True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    look = {}
    for i, c in GAME.items():
        pb = MATS[i].node_tree.nodes['Principled BSDF'].inputs['Base Color']; look[i] = tuple(pb.default_value); pb.default_value = (*c, 1)
    import carkit
    carkit.weather([body] + doors, wheels + [spare], SILL * K + LIFT, log, late=[spare]); carkit.join('body', [body, spare])         # (soft shadow where parts meet + road dust, in the vertex colours)
    # THE PAINTED TEXTURE over the paint's panels: chips, scratches, rust, mud (carkit.paint_texture)
    carkit.paint_texture([body] + doors, MATS[PAINT], SILL * K + LIFT, os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'bake', 'offroader_paint.png'), 2048, log)
    bpy.ops.object.select_all(action='DESELECT')
    for o in allp: o.select_set(True)
    carkit.export(OUT, textured=True)
    # … and THE PHONES' file: the same car, its painted texture at 1024² (a quarter of the memory, a smaller download)
    bpy.data.images['paint'].scale(1024, 1024)
    carkit.export(OUT[:-4] + '.m.glb', textured=True)
    log(f'wrote {OUT[:-4]}.m.glb: {os.path.getsize(OUT[:-4] + ".m.glb") / 1e3:.1f} kB')
    for i, c in look.items(): MATS[i].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = c
    log(f'wrote {OUT}: {os.path.getsize(OUT) / 1e3:.1f} kB')

# ================================================================================================== the look
if PREVIEW:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = int(kw.get('SAMPLES', 96)); sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; g = (219 / 255) ** 2.2; bg.inputs[0].default_value = (g, g, g, 1); bg.inputs[1].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = float(kw.get('SUN', 1.6)); sun.data.angle = math.radians(12)
    sun.rotation_euler = (math.radians(22), math.radians(-14), 0); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    os.makedirs(PREVIEW, exist_ok=True)
    def shot(name, az, el, dist, lens, tgt, res=(1522, 854), shift=(0, 0)):
        """az: degrees round from the car's left side toward its nose; el: degrees up."""
        a, e = math.radians(az), math.radians(el)
        d = V(-math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))
        cam.location = Vector(tgt) + d * dist; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = lens; cam.data.shift_x, cam.data.shift_y = shift
        sc.render.resolution_x, sc.render.resolution_y = res
        if name == 'ref':
            # (the target's key points, in its 761 × 427 pixels: where this camera puts ours)
            from bpy_extras.object_utils import world_to_camera_view
            bpy.context.view_layer.update()
            B = lambda x, y, z: (x * K, y, z * K + LIFT)
            pts = {'wheel F near': (-TRK - TW / 2, AY, R), 'wheel R near': (-TRK - TW / 2, -AY, R), 'wheel F far': (TRK - TW / 2, AY, R), 'wheel F near top': (-TRK - TW / 2, AY, 2 * R), 'wheel F near bottom': (-TRK - TW / 2, AY, 0),
                   'wheel R near top': (-TRK - TW / 2, -AY, 2 * R), 'wheel R near bottom': (-TRK - TW / 2, -AY, 0),
                   'nose near top': B(-HW, FRONT, FEND_F), 'nose far top': B(HW, FRONT, FEND_F), 'cowl near': B(-HW, COWL, BELT), 'cowl far': B(HW, COWL, BELT),
                   'roof front near': B(-ROOF_HW, WS_TOP, ROOF), 'roof front far': B(ROOF_HW, WS_TOP, ROOF), 'roof rear near': B(-ROOF_HW, REAR_TOP, ROOF),
                   'belt rear near': B(-HW, REAR, BELT), 'sill front door': B(-HW, 0.9, SILL), 'sill rear': B(-HW, -AY + AB, SILL), 'nose near bottom': B(-HW, FRONT, SILL),
                   'arch F top': B(-HW, AY, ARCH_PRE), 'strip': B(-HW, 0.9, STRIP)}
            TGT = {'wheel F near': (320, 319), 'wheel R near': (577, 283), 'wheel F near top': (320, 258), 'wheel F near bottom': (321, 382), 'wheel R near top': (578, 232), 'wheel R near bottom': (576, 330),
                   'nose near top': (243, 212), 'nose far top': (172, 196), 'cowl near': (385, 175), 'roof front near': (405, 102), 'roof front far': (318, 103), 'roof rear near': (600, 101), 'arch F top': (320, 240)}
            def err():
                bpy.context.view_layer.update(); e = 0.0
                for k_, t_ in TGT.items():
                    c_ = world_to_camera_view(sc, cam, Vector(pts[k_])); wgt = 3.0 if k_.startswith('wheel') else 1.0
                    e += wgt * ((c_.x * 761 - t_[0]) ** 2 + ((1 - c_.y) * 427 - t_[1]) ** 2)
                return e
            if kw.get('FIT'):
                # (the camera fitted to the target's key points: coordinate descent over its seven numbers)
                P = [az, el, dist, lens, tgt[1], tgt[2], 0.0]; step = [2, 1, 0.5, 2, 0.1, 0.05, 0.02]
                def put(P):
                    a, e = math.radians(P[0]), math.radians(P[1]); d = V(-math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))
                    t = V(tgt[0], P[4], P[5]); cam.location = t + d * P[2]; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = P[3]; cam.data.shift_x = P[6]
                put(P); best = err()
                for it in range(60):
                    for i in range(7):
                        for sg in (-1, 1):
                            Q = list(P); Q[i] += sg * step[i]; put(Q); e = err()
                            if e < best: best, P = e, Q
                    step = [x * 0.85 for x in step]
                put(P); log('  FIT: AZ=%.2f EL=%.2f DIST=%.2f LENS=%.2f TY=%.3f TZ=%.3f SHIFT=%.4f  rms %.1f px' % (*P, (best / len(TGT)) ** 0.5))
            for k_, p_ in pts.items():
                c_ = world_to_camera_view(sc, cam, Vector(p_)); t_ = TGT.get(k_)
                log(f'  {k_}: ({c_.x * 761:.0f}, {(1 - c_.y) * 427:.0f})' + (f'   target {t_}  off ({c_.x * 761 - t_[0]:+.0f}, {(1 - c_.y) * 427 - t_[1]:+.0f})' if t_ else ''))
        sc.render.filepath = os.path.join(PREVIEW, f'{name}.png'); bpy.ops.render.render(write_still=True)
    views = kw.get('VIEWS', 'ref').split(',')
    if 'ref' in views: shot('ref', float(kw.get('AZ', 33)), float(kw.get('EL', 6.3)), float(kw.get('DIST', 7.24)), float(kw.get('LENS', 35.5)), (0.05, 0.2, 1.146))
    if 'side' in views: shot('side', 0, 4, 16, 80, (0, 0, 1.2))
    if 'front' in views: shot('front', 80, 8, 14, 80, (0, 0, 1.2))
    if 'rear' in views: shot('rear', -140, 14, 13, 58, (0, 0, 1.2))
    if 'top' in views: shot('top', 30, 55, 13, 58, (0, 0, 1.2))
    log('preview rendered')
