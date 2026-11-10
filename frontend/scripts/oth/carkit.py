# OVERHILL — THE CAR KIT (2026-11-10, docs/VEHICLES.md: the garage of 21): what every car script shares — the builders
# (boxes, bars, prisms, panels with their linings, window frames, panes, turned surfaces), the WHEEL, and `build(P)`:
# a whole car from its numbers (the real vehicle's dimensions), the way the off-roader (offroader.py) is made — a HOLLOW
# cabin (seats, dash, dials, linings: `cab_interior`), every DOOR its own part with its `hinge`, the steering wheel, the
# pedals, the gear lever and the wipers on their pivots (`pivot` / `axis`), the wheels at their hubs (`rim`), the axles,
# springs and dampers underneath — exported as the GLB the game's loader reads (assets/loadModels.ts).
#   Blender space: x right, +y FORWARD, z up; the origin on the ground at the wheelbase's centre. Metres.
import os, math
import bpy, bmesh
from mathutils import Vector, Matrix
from assetkit import FRONTEND, reset, new_bm, tube, apply_mods

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
V = lambda *a: Vector(a)

def srgb(r, g, b): return tuple(((c / 255) ** 2.2) for c in (r, g, b))
def mat(name, rgb, rough=0.75, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m

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
    N = min(26, int(2 * math.pi * (R - 0.085) / 0.072))        # (a small wheel: fewer lugs — 26 round it ran into one another, their faces in one plane)
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
    k = RI / 0.268
    if WHEEL == 'steel':
      for i in range(8):
        a = i / 8 * 2 * math.pi; c = V(0, math.cos(a), math.sin(a)) * 0.185 * k + X * (xo - s * 0.05)
        tube(bs, uvs, [c, c + X * s * 0.022], [(0.024 * k, 0.024 * k)] * 2, UNDER, 8)                        # a hole in the dish
    elif WHEEL == 'slot':
      for i in range(5):
        a = (i / 5 + 0.2) * 2 * math.pi; rad, tan = V(0, math.cos(a), math.sin(a)), V(0, -math.sin(a), math.cos(a))
        bx(bs, rad * 0.165 * k + X * (xo - s * 0.04), (0.012, 0.035 * k, 0.07 * k), UNDER, X, tan, rad)           # a slot between the spokes
    else:
        tube(bs, uvs, [V(xo - s * 0.03, 0, 0), V(xo + s * 0.01, 0, 0), V(xo + s * 0.035, 0, 0)], [(0.15 * k, 0.15 * k), (0.14 * k, 0.14 * k), (0.07 * k, 0.07 * k)], STEEL, 16)   # the domed cap
    for i in range(5):
        a = (i / 5 + 0.1) * 2 * math.pi; c = V(0, math.cos(a), math.sin(a)) * 0.062 + X * (xo - s * 0.005)
        tube(bs, uvs, [c, c + X * s * 0.02], [(0.011, 0.011)] * 2, UNDER, 6)                         # a wheel nut
    tube(bs, uvs, [V(xo - s * 0.01, 0, 0), V(xo + s * 0.03, 0, 0)], [(0.04, 0.04), (0.034, 0.034)], RIM, 12)   # the hub's cap
    return join(name, [finish(bm, name, 0.0, sharp=35, recalc=False), finish(bs, name + '_solids', 0.0, sharp=35)])



# ------------------------------------------------------------------------------------------------ the materials
# (names the loader reads — assets/loadModels.ts: CarPaint takes the paint; 'glass' is drawn as the windows; 'interior'
#  the linings, darkened; 'lamp_lens' (pale, facing forward) and 'glows' (red, facing back) are where it finds the lamps)
MATS = []
PAINT, TRIM, GLASS, RIM, TYRE, GLOW, UNDER, MARK, INNER, SEAT, DASH, LENS, DIAL, STEEL, PLATE, AMBER, PAINT2 = range(17)
R = RI = TW = 0.0
WHEEL = 'steel'       # the wheel's kind: 'steel' (a dished disc with holes), 'cap' (a plain disc under a bright domed cap), 'slot' (an alloy: five long slots)
def materials(P):
    """The car's materials, as the GAME takes them (the paint's panels pale: its paint takes its brightness from them)."""
    reset()
    c = P.get('colours', {})
    MATS[:] = [mat('CarPaint', (0.75, 0.75, 0.75), 0.7), mat('trim', srgb(*c.get('trim', (62, 63, 66))), 0.8), mat('glass', srgb(148, 146, 158), 0.45),
               mat('rim', srgb(*c.get('rim', (176, 172, 162))), 0.6), mat('tyre', srgb(52, 53, 55), 0.9), mat('glows', srgb(176, 40, 30), 0.4),
               mat('Under', srgb(54, 56, 58), 0.9), mat('marker', srgb(170, 170, 166), 0.5), mat('interior', srgb(196, 190, 176), 0.9),
               mat('seat', srgb(*c.get('seat', (150, 120, 92))), 0.85), mat('dash', srgb(58, 58, 60), 0.85), mat('lamp_lens', srgb(242, 242, 236), 0.3),
               mat('dialface', srgb(200, 198, 190), 0.5), mat('steel', srgb(*c.get('steel', (150, 152, 154))), 0.45), mat('plate', srgb(232, 232, 226), 0.6),
               mat('amber', srgb(214, 128, 36), 0.5), mat('second', srgb(*c.get('second', (226, 224, 214))), 0.7)]


def build(P, out, log=print):
    """A car from its numbers P (see cars.py) → out (.glb). Returns what the catalogue needs (the game's frame)."""
    global R, RI, TW
    materials(P)
    g = lambda k, d=None: P.get(k, d)
    WB, TRK = P['wheelbase'], P['track'] / 2; AY = WB / 2
    R, RI, TW = P['tyre_r'], P['rim_r'], P['tyre_w']
    HW, SILL, BELT, ROOF = P['width'] / 2, P['sill'], P['belt'], P['roof']
    FRONT, REAR, COWL, WS_TOP = P['front'], P['rear'], P['cowl'], P['ws_top']
    ROOF_HW = HW - g('tumble', 0.07); FEND_F = P['nose_top']
    CREASE = g('crease', SILL + 0.25); AB, AT, ARCH = P['arch']
    TH, S0, DF, TOPZ = 0.045, SILL + 0.07, COWL - 0.045, ROOF - 0.07
    DB = P['door_rear']; CABR = P['cab_rear']; BEDF, BEDZ = g('bed_floor'), g('bed_rail', BELT - 0.02)
    TT = (TOPZ - BELT) / (ROOF - BELT); WZ0, WZ1 = BELT + 0.06, TOPZ - 0.04; GLASS_IN = 0.018
    TUCK = g('tuck', 0.04)
    side_x = lambda z: HW - (HW - ROOF_HW) * max(0.0, z - BELT) / (ROOF - BELT)
    apy = lambda z: COWL - (COWL - WS_TOP) * (z - BELT) / (ROOF - BELT)
    SN = lambda sx: V(sx * (ROOF - BELT), 0, HW - ROOF_HW).normalized()
    spts = lambda sx, yz: [V(sx * side_x(z), y, z) for y, z in yz]
    def tuck(bm):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, CREASE), plane_no=(0, 0, 1))
        for v in bm.verts:
            if v.co.z < CREASE - 0.01: v.co.x *= (HW - TUCK) / HW
    parts, cab, doors, movers = [], [], [], []
    AEX = g('arch_shape', 0.62)                 # the arches: 1 a round arc (the 50s), 0.62 a rounded square, 0.4 nearly square
    SOFT = g('soft', 1.0)                       # how rounded its edges are (the 50s' pressings: 2; an 80s box: 1)
    global WHEEL
    WHEEL = g('wheel', 'steel')
    def arch(yc, grow=0.0, n=11):
        """The wheel arch's outline at axle yc, front foot → over the top → back foot: a rounded square (the real ones')."""
        out = []
        for i in range(n):
            t = math.pi * i / (n - 1); c, s_ = math.cos(t), math.sin(t)
            out.append((yc + (AB + grow) * math.copysign(abs(c) ** AEX, c), SILL + (ARCH + grow - SILL) * s_ ** AEX))
        return out
    BED_F = CABR - 0.05                                                               # (a pickup) the bed's front wall
    WAGON = g('kind', 'pickup') == 'wagon'                                            # a closed body to the tail (else: a cab + a bed)
    DR = g('door2_rear')                                                              # a back door's trailing edge (four doors)
    SIDE_END = DR if DR is not None else DB                                           # where the fixed side begins
    RB, RT = (REAR, REAR + g('rear_rake', 0.1)) if WAGON else (CABR, CABR)            # the cabin's back: its foot and head (y)
    rear_y = lambda z: RB + (RT - RB) * (z - BELT) / (ROOF - BELT)
    QF = -AY + AB + 0.1                                                               # (a wagon) the floor narrows here, between the tubs
    WD, HWC = g('wing_drop', 0.0), g('hood_w', 0.62) * HW                             # separate front wings, lower than the bonnet
    if WAGON: assert SIDE_END > -AY + AB + 0.02, 'the doors must end ahead of the back arch'

    # ---------------------------------------------------------------------------------------------- the shell
    bm, _ = new_bm()
    if WD:
        # the bonnet's block between two lower WINGS (each its own form, the arch through it), the scuttle behind them
        prism(bm, [(FRONT, SILL), (FRONT, FEND_F - 0.03), (FRONT - 0.05, FEND_F), (COWL, BELT), (DF, BELT), (DF, SILL)], -HWC, HWC, PAINT)
        wt = FEND_F - WD; fw = FRONT - g('wing_back', 0.06)
        WR = g('wing_round', 0.0)                                                                              # ROUND wings: a mudguard's thickness over the tyre
        for sx in (-1, 1):
            if WR:
                # a curved mudguard hugging the tyre (the bonnet's side showing behind it), a skirt down to the board
                prism(bm, arch(AY) + list(reversed(arch(AY, WR))), sx * (HWC - 0.01), sx * HW, PAINT)
                bx(bm, V(sx * (HWC + HW) / 2, (DF + COWL) / 2 + 0.02, (S0 + BELT) / 2), ((HW - HWC) / 2, (COWL - DF) / 2 + 0.02, (BELT - S0) / 2), PAINT)   # the cab's front corner
            else:
                prism(bm, [(fw, SILL), (fw, wt - 0.06), (fw - 0.1, wt), (DF, wt + 0.02), (DF, SILL), *reversed(arch(AY))], sx * (HWC - 0.01), sx * HW, PAINT)
                bx(bm, V(sx * (HWC + HW) / 2, (DF + COWL) / 2 + 0.02, (wt + BELT) / 2), ((HW - HWC) / 2, (COWL - DF) / 2 + 0.02, (BELT - wt) / 2), PAINT)
    else:
        prism(bm, [(FRONT, SILL), (FRONT, FEND_F - 0.03), (FRONT - 0.05, FEND_F), (COWL, BELT), (DF, BELT), (DF, SILL), *reversed(arch(AY))], -HW, HW, PAINT)   # the nose, solid
    if g('boards'):
        for sx in (-1, 1): bx(bm, V(sx * (HW + 0.02), 0.0, SILL + 0.01), (0.13, AY - AB + 0.02, 0.03), TRIM)                                    # the running boards
    if WAGON:
        # the floor, narrow between the tubs — INSIDE the side and tail panels where they stand (two skins in one plane
        # blink: each frame a different one wins the depth test)
        IN = HW - TH - 0.002
        for y0, y1, hx in ((DF, SIDE_END, HW), (SIDE_END, min(SIDE_END, QF), IN), (min(SIDE_END, QF), -AY - AB - 0.1, 0.44), (-AY - AB - 0.1, REAR + TH + 0.002, IN)):
            if y0 - y1 < 0.01: continue
            bx(bm, V(0, (y0 + y1) / 2, (SILL + 0.004 + S0) / 2), (hx, (y0 - y1) / 2, (S0 - SILL - 0.004) / 2), PAINT)       # (its underside 4 mm above the sills' feet — the same)
        for sx in (-1, 1):                                                                                       # the back quarter, round its arch
            panel(bm, [V(sx * HW, y, z) for y, z in [(SIDE_END, BELT), (REAR, BELT), (REAR, SILL), *reversed(arch(-AY)), (SIDE_END, SILL)]], (-sx, 0, 0), TH, PAINT, INNER)
        panel(bm, [V(-HW + TH + 0.002, REAR, SILL), V(HW - TH - 0.002, REAR, SILL), V(HW - TH - 0.002, REAR, BELT), V(-HW + TH + 0.002, REAR, BELT)], (0, 1, 0), TH, PAINT, INNER)       # the tail (between the sides)
    else:
        bx(bm, V(0, (DF + CABR) / 2, (SILL + 0.004 + S0) / 2), (HW, (DF - CABR) / 2, (S0 - SILL - 0.004) / 2), PAINT)              # the cab's floor
        panel(bm, [V(HW, CABR, S0), V(-HW, CABR, S0), V(-HW, CABR, BELT), V(HW, CABR, BELT)], (0, 1, 0), TH, PAINT, INNER)   # the cab's back
        # the bed: its sides round the back arches, its front wall, the tail, the floor over the axle
        for sx in (-1, 1):
            q = [(BED_F, SILL), (BED_F, BEDZ), (REAR, BEDZ), (REAR, SILL), *reversed(arch(-AY))]
            panel(bm, [V(sx * HW, y, z) for y, z in q], (-sx, 0, 0), TH, PAINT)
            bx(bm, V(sx * (HW - TH / 2), (BED_F + REAR) / 2, BEDZ + 0.012), (TH / 2 + 0.012, (BED_F - REAR) / 2, 0.014), PAINT)   # the rail's cap
            bx(bm, V(sx * (HW - 0.32), -AY, (BEDF - 0.01 + ARCH + 0.07) / 2), (0.27, AB + 0.07, (ARCH + 0.07 - BEDF + 0.01) / 2), PAINT)          # the wheel housing, in the bed
        IN = HW - TH - 0.002                                                                                    # (between the bed's sides: no two skins in one plane)
        panel(bm, [V(IN, BED_F, BEDF), V(-IN, BED_F, BEDF), V(-IN, BED_F, BEDZ), V(IN, BED_F, BEDZ)], (0, -1, 0), TH, PAINT)
        panel(bm, [V(-IN, REAR, SILL), V(IN, REAR, SILL), V(IN, REAR, BEDZ), V(-IN, REAR, BEDZ)], (0, 1, 0), TH, PAINT)             # the tailgate
        bx(bm, V(0, (BED_F - TH + REAR + TH) / 2, BEDF - 0.017), (IN, (BED_F - TH - REAR - TH) / 2 - 0.002, 0.017), PAINT)   # (its underside clear of the arches' liners)
    tuck(bm)
    parts.append(finish(bm, 'shell', 0.016 * SOFT, 2 if SOFT < 1.6 else 3))
    bm, _ = new_bm()
    FL = g('flares', False)
    for sx in (-1, 1):                                                                                       # the back arches' dark liners (a wagon's tubs)
        yc = -AY
        # (NO TWO SKINS IN ONE PLANE — scripts/oth/coplanar.py: the liner's arch stands 5 mm outside the body's, a lip's /
        #  flare's 5 mm inside it; drawn in the same plane they fought for the depth buffer and the arch blinked)
        prism(bm, arch(yc, 0.005) + list(reversed(arch(yc, 0.04))), sx * 0.45, sx * (HW - 0.012), UNDER)
        prism(bm, arch(yc, 0.04), sx * 0.42, sx * 0.45, UNDER)
        # round each opening: a slim rolled lip — or a wide dark FLARE
        for ya in (AY, -AY):
            if FL: prism(bm, arch(ya, -0.005) + list(reversed(arch(ya, 0.085))), sx * (HW - 0.03), sx * (HW + 0.07), TRIM)
            else: prism(bm, arch(ya, -0.005) + list(reversed(arch(ya, 0.03))), sx * (HW - 0.02), sx * (HW + 0.012), PAINT)
    if not WAGON:
        # the tailgate's seams and handle, the bed's ribs
        for x in (-HW + 0.07, HW - 0.07): bar(bm, V(x, REAR - 0.004, BEDF), V(x, REAR - 0.004, BEDZ), 0.024, 0.014, UNDER, X)
        bx(bm, V(0, REAR - 0.012, BEDZ - 0.1), (0.09, 0.012, 0.022), STEEL)
        for i in range(1, 6): bar(bm, V(-HW + TH + 0.02, BED_F + (REAR - BED_F) * i / 6, BEDF + 0.006), V(HW - TH - 0.02, BED_F + (REAR - BED_F) * i / 6, BEDF + 0.006), 0.03, 0.012, UNDER)
    else:
        for x in (-HW + 0.1, HW - 0.1): bar(bm, V(x, REAR - 0.004, SILL + 0.05), V(x, REAR - 0.004, BELT), 0.024, 0.014, UNDER, X)   # the back door's seams
        bx(bm, V(HW - 0.26, REAR - 0.014, BELT - 0.16), (0.06, 0.014, 0.022), STEEL)
    parts.append(finish(bm, 'liners', 0.0))
    # the roof
    bm, _ = new_bm()
    xs, yf, yr = side_x(TOPZ), apy(TOPZ), rear_y(TOPZ)
    hexa(bm, [V(-xs, yr, TOPZ), V(xs, yr, TOPZ), V(xs, yf, TOPZ), V(-xs, yf, TOPZ),
              V(-ROOF_HW, RT + 0.02, ROOF), V(ROOF_HW, RT + 0.02, ROOF), V(ROOF_HW, WS_TOP, ROOF), V(-ROOF_HW, WS_TOP, ROOF)], g('roof_mat', PAINT))
    parts.append(finish(bm, 'roof', 0.03 * SOFT, 2 if SOFT < 1.6 else 3))
    # the frames round the windscreen, the back window and (a wagon) the side windows behind the doors; their panes
    TOPM = g('top_mat', PAINT)
    wn = V(0, ROOF - BELT, COWL - WS_TOP).normalized()
    rn = V(0, -(ROOF - BELT), RT - RB).normalized()
    wp = lambda s, t: V(s * (HW - (HW - ROOF_HW) * t), COWL - (COWL - WS_TOP) * t, BELT + (ROOF - BELT) * t)
    rp = lambda s, t: V(s * (HW - (HW - ROOF_HW) * t), RB + (RT - RB) * t, BELT + (ROOF - BELT) * t)
    W_SCREEN = chamfer([wp(-0.88, 0.08), wp(0.88, 0.08), wp(0.86, 0.82), wp(-0.86, 0.82)], 0.04)
    W_BACK = chamfer([rp(0.72, 0.14), rp(-0.72, 0.14), rp(-0.72, 0.8), rp(0.72, 0.8)], 0.05)
    sidew = []
    if WAGON and SIDE_END - REAR > 0.5:
        sidew = [(SIDE_END - 0.09, WZ0), (rear_y(WZ0) + 0.11, WZ0), (rear_y(WZ1) + 0.11, WZ1), (SIDE_END - 0.09, WZ1)]
    bm, _ = new_bm()
    ring(bm, chamfer([wp(-1, 0), wp(1, 0), wp(1, TT), wp(-1, TT)], 0.006), W_SCREEN, -wn, 0.04, PAINT, INNER, TRIM)
    ring(bm, chamfer([rp(0.95, 0), rp(-0.95, 0), rp(-0.95, TT), rp(0.95, TT)], 0.006), W_BACK, -rn, 0.04, TOPM, INNER, TRIM)   # (between the sides' frames)
    if WAGON:
        for sx in (-1, 1):
            o = chamfer(spts(sx, [(SIDE_END, BELT), (REAR, BELT), (rear_y(TOPZ), TOPZ), (SIDE_END, TOPZ)]), 0.006)
            if sidew: ring(bm, o, chamfer(spts(sx, sidew), 0.05), -SN(sx), 0.04, TOPM, INNER, TRIM)
            else: panel(bm, o, -SN(sx), 0.04, TOPM, INNER)
    parts.append(finish(bm, 'frames', 0.01, 1))
    bm, _ = new_bm()
    sheet(bm, [q - wn * GLASS_IN for q in W_SCREEN], GLASS, wn)
    sheet(bm, [q - rn * GLASS_IN for q in W_BACK], GLASS, rn)
    if sidew:
        for sx in (-1, 1): sheet(bm, [q - SN(sx) * GLASS_IN for q in chamfer(spts(sx, sidew), 0.05)], GLASS, SN(sx))
    parts.append(finish(bm, 'panes', 0.0, recalc=False))
    # the bonnet: a raised centre (its height and how much narrower its top: a flat lid, a crowned one, a peaked 50s one)
    CR, CRW = max(g('crown', 0.035), 0.008), g('crown_w', 1.0)                                                # (never flush with the block under it: two skins in one plane blink)
    bm, _ = new_bm()
    hz = lambda y: FEND_F + (BELT - FEND_F) * (FRONT - 0.05 - y) / (FRONT - 0.05 - COWL)
    y0, y1 = FRONT - 0.03, COWL + 0.03
    a, b = (HWC - 0.04, HWC - 0.02) if WD else (0.66 * HW, 0.72 * HW)
    hexa(bm, [V(-a, y0, hz(y0) - 0.03), V(a, y0, hz(y0) - 0.03), V(b, y1, hz(y1) - 0.03), V(-b, y1, hz(y1) - 0.03),
              V(-a * CRW + 0.02, y0 - 0.02, hz(y0) + CR), V(a * CRW - 0.02, y0 - 0.02, hz(y0) + CR), V(b * CRW - 0.02, y1, hz(y1) + CR * 0.85), V(-b * CRW + 0.02, y1, hz(y1) + CR * 0.85)], PAINT)
    parts.append(finish(bm, 'bonnet', 0.014 * SOFT, 2 if SOFT < 1.6 else 3))

    # the two-tone: a band of the second colour along the side (round the arches)
    TT0, TT1 = g('band', (None, None))
    BW = 0.024                                  # (the band's thickness: half of it — 12 mm — stands off the panel; thinner fights it for depth on a phone)
    def band(bm, sx, ya, yb, x):
        if TT0 is None: return
        zc = ARCH + 0.05
        if TT1 > zc: bar(bm, V(x, ya, (max(TT0, zc) + TT1) / 2), V(x, yb, (max(TT0, zc) + TT1) / 2), BW, TT1 - max(TT0, zc), PAINT2)
        if TT0 < zc:
            cuts = sorted([(yc + AB + 0.05, yc - AB - 0.05) for yc in (AY, -AY)], reverse=True); y = ya
            for c0, c1 in cuts:
                if y > c0 and c0 > yb: bar(bm, V(x, y, (TT0 + min(TT1, zc)) / 2), V(x, max(c0, yb), (TT0 + min(TT1, zc)) / 2), BW, min(TT1, zc) - TT0, PAINT2)
                y = min(y, c1)
            if y > yb: bar(bm, V(x, y, (TT0 + min(TT1, zc)) / 2), V(x, yb, (TT0 + min(TT1, zc)) / 2), BW, min(TT1, zc) - TT0, PAINT2)

    # ---------------------------------------------------------------------------------------------- the doors
    HZ = g('handle_z', BELT - 0.14)
    DOORS = [('F', DF, DB, True)] + ([('R', DB, DR, False)] if DR is not None else [])
    for sx, sd in ((-1, 'L'), (1, 'R')):
      for ax, ya, yb, front in DOORS:
        name = f'door_{ax}{sd}'
        fa = (lambda z: apy(z) - 0.045) if front else (lambda z: ya)                                        # its leading edge above the belt
        bm, _ = new_bm()
        panel(bm, [V(sx * HW, y, z) for y, z in [(ya, S0), (yb, S0), (yb, BELT), (ya, BELT)]], (-sx, 0, 0), TH, PAINT, INNER)
        tuck(bm)
        nu = SN(sx)
        wpts = chamfer(spts(sx, [(fa(WZ0) - (0.06 if front else 0.09), WZ0), (yb + 0.09, WZ0), (yb + 0.09, WZ1), (fa(WZ1) - (0.06 if front else 0.09), WZ1)]), 0.05)
        ring(bm, chamfer(spts(sx, [(fa(BELT), BELT), (yb, BELT), (yb, TOPZ), (fa(TOPZ), TOPZ)]), 0.006), wpts, -nu, 0.04, TOPM if g('top_doors') else PAINT, INNER, TRIM)
        objs = [finish(bm, name, 0.01, 1)]
        bm, _ = new_bm()
        bx(bm, V(sx * (HW + 0.016), yb + 0.14, HZ), (0.014, 0.06, 0.022), STEEL)                              # the handle
        band(bm, sx, ya - 0.004, yb + 0.004, sx * (HW + 0.002))
        for z in (S0 + 0.3, BELT - 0.12): bx(bm, V(sx * (HW + 0.008), ya - 0.03, z), (0.01, 0.022, 0.035), TRIM)   # the hinges
        bx(bm, V(sx * (HW - TH - 0.035), (ya + yb) / 2, BELT - 0.3), (0.035, (ya - yb) / 2 - 0.14, 0.03), DASH)     # the armrest
        if front:
            my = apy(BELT) - 0.2                                                                            # the mirror: an arm, a flat head
            bar(bm, V(sx * (HW - 0.01), my, BELT + 0.04), V(sx * (HW + 0.17), my + 0.02, BELT + 0.08), 0.025, 0.025, STEEL)
            bx(bm, V(sx * (HW + 0.2), my + 0.02, BELT + 0.13), (0.05, 0.012, 0.085), STEEL)
        objs.append(finish(bm, name + '_trim', 0.005, 1))
        bm, _ = new_bm()
        sheet(bm, [q - nu * GLASS_IN for q in wpts], GLASS, nu)
        objs.append(finish(bm, name + '_pane', 0.0, recalc=False))
        d = join(name, objs); d['hinge'] = gl([sx * HW, ya, (S0 + BELT) / 2]); doors.append(d)

    # ---------------------------------------------------------------------------------------------- the trim
    bm, _ = new_bm()
    for sx in (-1, 1):
        bar(bm, V(sx * (ROOF_HW + 0.006), WS_TOP - 0.02, ROOF - 0.035), V(sx * (ROOF_HW + 0.006), RT + 0.04, ROOF - 0.035), 0.03, 0.035, STEEL)   # the gutter
        if not WD: band(bm, sx, FRONT - 0.03, DF + 0.004, sx * (HW + 0.002))
        band(bm, sx, (SIDE_END if WAGON else BED_F) - 0.004, REAR + 0.03, sx * (HW + 0.002))
        for yc in (AY, -AY): bx(bm, V(sx * min(TRK + 0.02, HW - 0.15), yc - AB - 0.06, SILL - 0.15), (0.14, 0.008, 0.13), UNDER)                               # the mud flaps
        if not g('wing_round'): bx(bm, V(sx * (HW + 0.004), FRONT - 0.16, FEND_F - WD - 0.14), (0.006, 0.05, 0.03), AMBER)                                                  # the side marker
    bar(bm, V(-0.74 * HW, COWL + 0.1, BELT - 0.03), V(-0.74 * HW, COWL + 0.02, BELT + 0.8), 0.01, 0.01, UNDER, X)                               # the aerial
    if g('ws_split'): bar(bm, wp(0, 0.03) + wn * 0.01, wp(0, 0.9) + wn * 0.01, 0.035, 0.03, PAINT, wn)                                          # a two-piece windscreen's post
    if g('canvas'):
        for i in range(1, 5):                                                                                                                    # a canvas top's bows
            y = WS_TOP + (RT - WS_TOP) * i / 5
            bar(bm, V(-ROOF_HW - 0.012, y, ROOF - 0.02), V(ROOF_HW + 0.012, y, ROOF - 0.02), 0.035, 0.06, g('roof_mat', PAINT))
    if g('waist'):
        for sx in (-1, 1): bar(bm, V(sx * (HW + 0.014), (FRONT - 0.1) if not WD else DF, BELT - 0.03), V(sx * (HW + 0.014), REAR + 0.02, BELT - 0.03), 0.04, 0.05, PAINT)   # the waist rail (a flat-sided body's)
    if g('wood') and TT0 is not None:
        for sx in (-1, 1):                                                                                                                       # a wooden body's frame: rails and posts over its panels
            y0_, y1_ = DF, REAR + 0.04
            for z in (TT0, TT1): bar(bm, V(sx * (HW + 0.01), y0_, z), V(sx * (HW + 0.01), y1_, z), 0.016, 0.05, MARK)
            for i in range(6): y = y0_ + (y1_ - y0_) * i / 5; bar(bm, V(sx * (HW + 0.007), y, TT0 + 0.004), V(sx * (HW + 0.007), y, TT1 - 0.004), 0.016, 0.05, MARK, Y)
    if g('rack'):
        rz = ROOF + 0.09
        for sx in (-1, 1):
            bar(bm, V(sx * (ROOF_HW - 0.06), WS_TOP - 0.2, rz), V(sx * (ROOF_HW - 0.06), RT + 0.15, rz), 0.03, 0.03, TRIM)
            for y in (WS_TOP - 0.3, (WS_TOP + RT) / 2, RT + 0.25): bar(bm, V(sx * (ROOF_HW - 0.06), y, ROOF - 0.01), V(sx * (ROOF_HW - 0.06), y, rz), 0.03, 0.03, TRIM, Y)
        for i in range(6): y = WS_TOP - 0.2 + (RT + 0.35 - WS_TOP) * i / 5; bar(bm, V(-ROOF_HW + 0.06, y, rz), V(ROOF_HW - 0.06, y, rz), 0.03, 0.025, TRIM)
    if g('bullbar'):
        uvb = bm.loops.layers.uv.verify(); by_ = FRONT + 0.2; bz = g('bumper_z', SILL + 0.16)
        for sx in (-1, 1): tube(bm, uvb, [V(sx * 0.4 * HW, by_, bz), V(sx * 0.4 * HW, by_, FEND_F + 0.02)], [(0.026, 0.026)] * 2, TRIM, 8)
        tube(bm, uvb, [V(-0.4 * HW, by_, FEND_F + 0.02), V(0.4 * HW, by_, FEND_F + 0.02)], [(0.026, 0.026)] * 2, TRIM, 8)
    parts.append(finish(bm, 'trim', 0.004, 1))
    # the tail lamps: tall, red over a pale foot, at the tail's corners
    TLZ = BELT - 0.02 if WAGON else BEDZ
    bm, _ = new_bm()
    for sx in (-1, 1):
        bx(bm, V(sx * (HW - 0.09), REAR - 0.012, TLZ - 0.2), (0.06, 0.019, 0.12), GLOW)
        bx(bm, V(sx * (HW - 0.09), REAR - 0.012, TLZ - 0.37), (0.06, 0.019, 0.04), MARK)
    parts.append(finish(bm, 'lights_tail_glows', 0.006, 1))

    # ---------------------------------------------------------------------------------------------- the cabin
    HUB = V(-0.44 * HW / 0.96, COWL - 0.4, S0 + 0.76)
    SEAT_Z = HUB.z - 0.46
    bm, _ = new_bm()
    c_, s_ = math.cos(math.radians(10)), math.sin(math.radians(10))
    if g('seats', 'bench') == 'bench':
        bx(bm, V(0, COWL - 0.86, SEAT_Z - 0.08), (HW - 0.14, 0.26, 0.08), SEAT)
        bx(bm, V(0, COWL - 1.17, SEAT_Z + 0.3), (HW - 0.14, 0.055, 0.32), SEAT, X, V(0, c_, s_), V(0, -s_, c_))
    else:
        for sx in (-1, 1):
            bx(bm, V(sx * 0.44, COWL - 0.86, SEAT_Z - 0.08), (0.25, 0.26, 0.08), SEAT)
            bx(bm, V(sx * 0.44, COWL - 1.17, SEAT_Z + 0.3), (0.25, 0.055, 0.32), SEAT, X, V(0, c_, s_), V(0, -s_, c_))
            bx(bm, V(sx * 0.44, COWL - 1.24, SEAT_Z + 0.72), (0.13, 0.045, 0.09), SEAT, X, V(0, c_, s_), V(0, -s_, c_))
    by = COWL - 1.66                                                                                        # a back bench, if there is room for one
    if WAGON and g('rear_seat', True) and by - 0.3 > REAR + 0.12:
        hw = HW - 0.16 if by - 0.21 > QF else 0.4
        bx(bm, V(0, by, SEAT_Z - 0.08), (hw, 0.2, 0.08), SEAT)
        bx(bm, V(0, by - 0.25, SEAT_Z + 0.26), (hw, 0.05, 0.28), SEAT, X, V(0, c_, s_), V(0, -s_, c_))
    cab.append(finish(bm, 'cab_seats', 0.03, 2))
    bm, uvl = new_bm()
    DT = BELT - 0.02
    bx(bm, V(0, COWL - 0.17, DT - 0.16), (HW - 0.07, 0.16, 0.16), DASH)                                     # the dash
    bx(bm, V(HUB.x, COWL - 0.3, DT + 0.03), (0.18, 0.07, 0.045), DASH)                                      # the binnacle
    bx(bm, V(0.42, COWL - 0.335, DT - 0.18), (0.22, 0.012, 0.07), TRIM)                                     # the glovebox
    bx(bm, V(0, COWL - 0.34, DT - 0.16), (0.14, 0.014, 0.09), TRIM)                                         # the radio's stack
    cab.append(finish(bm, 'cab_dash', 0.02, 2))
    bm, uvl = new_bm()
    for x in (HUB.x - 0.075, HUB.x + 0.075):
        tube(bm, uvl, [V(x, COWL - 0.365, DT + 0.03), V(x, COWL - 0.375, DT + 0.03)], [(0.05, 0.05)] * 2, DIAL, 14)
    for ya, yb, hx in (((DF - 0.01, QF, HW - 0.1), (QF, max(-AY - AB - 0.1, REAR + 0.05), 0.42), (-AY - AB - 0.1, REAR + 0.05, HW - 0.1)) if WAGON else ((DF - 0.01, CABR + 0.05, HW - 0.1),)):
        if ya - yb < 0.02: continue                                                                         # (a short tail: nothing behind the tubs)
        sheet(bm, [V(-hx, ya, S0 + 0.015), V(hx, ya, S0 + 0.015), V(hx, yb, S0 + 0.015), V(-hx, yb, S0 + 0.015)], DASH, Z)
    xh = side_x(TOPZ) - 0.045
    sheet(bm, [V(-xh, yf - 0.04, TOPZ - 0.012), V(xh, yf - 0.04, TOPZ - 0.012), V(xh, yr + 0.05, TOPZ - 0.012), V(-xh, yr + 0.05, TOPZ - 0.012)], INNER, -Z)
    sheet(bm, [V(-HW + 0.08, DF - 0.004, S0), V(HW - 0.08, DF - 0.004, S0), V(HW - 0.08, DF - 0.004, DT - 0.3), V(-HW + 0.08, DF - 0.004, DT - 0.3)], DASH, -Y)
    cab.append(finish(bm, 'cab_linings', 0.0, recalc=False))

    # ---------------------------------------------------------------------------------------------- the nose
    bm, uvl = new_bm()
    gz0, gz1 = P['grille']; GW = g('grille_w', 0.5) * HW
    FACE = dict(chrome=STEEL, pale=PLATE, body=PAINT, dark=TRIM)[g('face', 'chrome')]
    LAT = g('lamp_at', 'wing' if WD else 'panel')                                                            # the lamps: in the grille's panel, or on the wings
    PW = (HWC - 0.02) if WD else (HW - 0.04)                                                                 # the panel's half width
    if LAT == 'panel': GW = min(GW, PW - 0.2)
    elif WD: GW = min(GW, HWC - 0.09)
    gm, gh = (gz0 + gz1) / 2, (gz1 - gz0) / 2
    if g('face') != 'none': bx(bm, V(0, FRONT + 0.004, gm), (PW, 0.012, gh + 0.02), FACE)                    # the grille's surround
    bx(bm, V(0, FRONT + 0.012, gm), (GW, 0.012, gh), UNDER)                                                  # its dark field
    GS, GN = g('grille_style', 'bars'), g('grille_n', 4)
    BARM = STEEL if g('grille_bright', True) else TRIM
    if GS in ('bars', 'mesh'):
        for i in range(1, GN + 1): bx(bm, V(-GW + 2 * GW * i / (GN + 1), FRONT + 0.024, gm), (0.014, 0.008, gh), BARM)
    if GS in ('slats', 'mesh'):
        for i in range(1, GN + 1): bx(bm, V(0, FRONT + 0.027, gz0 + 2 * gh * i / (GN + 1)), (GW, 0.008, 0.012), BARM)   # (3 mm proud of the uprights)
    if GS == 'bars': bx(bm, V(0, FRONT + 0.027, gm), (GW, 0.008, 0.012), BARM)
    LR_ = g('lamp_r', 0.1)
    for sx in (-1, 1):
        lw = (PW - GW) / 2 - 0.02; lx = sx * (GW + (PW - GW) / 2)
        if LAT == 'wing': lx = sx * (HWC + HW) / 2; lw = (HW - HWC) / 2 - 0.02
        wr = g('wing_round', 0.0)
        if LAT == 'wing' and wr:
            # a lamp POD on the mudguard's shoulder
            c = V(lx, AY + (AB + wr) * 0.62, SILL + (ARCH + wr - SILL) * 0.86 + LR_ * 0.7)
            tube(bm, uvl, [c - Y * 0.16, c - Y * 0.05, c + Y * 0.02], [(0.03, 0.03), (LR_ + 0.012, LR_ + 0.012), (LR_ + 0.012, LR_ + 0.012)], PAINT, 16)
            tube(bm, uvl, [c + Y * 0.015, c + Y * 0.04], [(LR_, LR_), (LR_ - 0.01, LR_ - 0.01)], LENS, 16)
            bx(bm, V(lx, c.y - 0.02, c.z - LR_ - 0.03), (0.03, 0.03, 0.04), PAINT)
            ay = c.y; az = c.z - LR_ - 0.12
        else:
            fy = (FRONT - g('wing_back', 0.06)) if (LAT == 'wing' and WD) else FRONT
            zc = (FEND_F - WD - 0.16) if (LAT == 'wing' and WD) else gm
            if g('lamps', 'square2') == 'square2':
                for k in (0, 1):                                                                            # two square lamps, one over the other
                    bx(bm, V(lx, fy + 0.018, gz0 + 2 * gh * (0.27 + 0.46 * k)), (lw, 0.014, gh * 0.4), LENS if k else MARK)
            elif g('lamps') == 'square':
                bx(bm, V(lx, fy + 0.018, zc), (lw, 0.014, gh * 0.62), LENS)                                 # one wide square lamp
            else:
                c = V(lx, fy + 0.012, zc); r = min(lw, LR_)
                tube(bm, uvl, [c - Y * 0.01, c + Y * 0.03], [(r + 0.02,) * 2] * 2, STEEL if g('lamp_ring', True) else TRIM, 18)
                tube(bm, uvl, [c + Y * 0.02, c + Y * 0.045], [(r,) * 2] * 2, LENS, 18)
            ay = fy; az = (FEND_F - WD - 0.33) if (LAT == 'wing' and WD) else gz0 - 0.05
        if g('turn', 'under') == 'under': bx(bm, V(lx, ay + 0.016, az), (min(lw, 0.09), 0.012, 0.022), AMBER)   # the turn lamp under them
        else: bx(bm, V(sx * (HW - 0.14), FRONT - 0.2, FEND_F - WD + 0.03), (0.07, 0.045, 0.03), AMBER)          # … or on the wing's top
    BZ = g('bumper_z', SILL + 0.16)
    bx(bm, V(0, FRONT + 0.2, BZ + 0.01), (0.16, 0.008, 0.05), PLATE); bx(bm, V(0, REAR - 0.165, BZ + 0.01), (0.16, 0.008, 0.05), PLATE)
    parts.append(finish(bm, 'nose', 0.004, 1))
    # THE SPARE: a REAL wheel (the same tyre and rim as the four it stands in for — make_wheel), on the back or flat on
    # the bonnet. Its own object until the shading is baked (it would shadow the panel behind it into one dark patch).
    spares = []
    if g('spare'):
        sw = make_wheel('spare', 1)
        if g('spare') == 'bonnet':
            ym = (FRONT + COWL) / 2
            sw.data.transform(Matrix.Translation((0, ym, hz(ym) + CR + TW / 2 + 0.01)) @ Matrix.Rotation(-math.pi / 2, 4, 'Y'))        # its face up
        else:
            sw.data.transform(Matrix.Translation((g('spare_x', 0.0), REAR - TW / 2 - 0.05, BELT - 0.22)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))   # its face to the back
            bm, uvs_ = new_bm()
            tube(bm, uvs_, [V(g('spare_x', 0.0), REAR + 0.01, BELT - 0.22), V(g('spare_x', 0.0), REAR - 0.07, BELT - 0.22)], [(0.06, 0.06)] * 2, TRIM, 8)   # its carrier
            parts.append(finish(bm, 'spare_carrier', 0.0))
        spares.append(sw)
    # the bumpers: bright bars, their ends wrapped
    bm, _ = new_bm()
    BM = STEEL if g('bumper', 'chrome') == 'chrome' else TRIM
    for y, d in ((FRONT + 0.11, 1), (REAR - 0.08, -1)):
        hexa(bm, [V(-HW - 0.03, y - d * 0.14, BZ - 0.09), V(HW + 0.03, y - d * 0.14, BZ - 0.09), V(HW - 0.08, y + d * 0.09, BZ - 0.09), V(-HW + 0.08, y + d * 0.09, BZ - 0.09),
                  V(-HW - 0.03, y - d * 0.14, BZ + 0.09), V(HW + 0.03, y - d * 0.14, BZ + 0.09), V(HW - 0.08, y + d * 0.08, BZ + 0.09), V(-HW + 0.08, y + d * 0.08, BZ + 0.09)], BM)
    parts.append(finish(bm, 'bumpers', 0.02, 2))

    # ---------------------------------------------------------------------------------- underneath (as the real one)
    bm, uvl = new_bm()
    FZ = SILL - 0.12                                                                                        # the frame's rails
    bx(bm, V(0, AY, (R + ARCH) / 2 + 0.05), (0.412, min(AB + 0.02, FRONT - AY - 0.012), (ARCH - R) / 2), UNDER)                         # the front wells' inner wall
    for sx in (-1, 1): bx(bm, V(sx * 0.42, (FRONT + REAR) / 2, FZ), (0.04, (FRONT - REAR) / 2 - 0.12, 0.07), UNDER)
    for y in (FRONT - 0.3, 0.0, -AY + 0.6, REAR + 0.3): bx(bm, V(0, y, FZ), (0.42, 0.04, 0.05), UNDER)
    tube(bm, uvl, [V(-0.5, 0.2, FZ - 0.1), V(-0.5, REAR + 0.3, FZ - 0.1), V(-0.62, REAR - 0.05, FZ - 0.1)], [(0.04, 0.04)] * 3, STEEL, 10)   # the exhaust
    bx(bm, V(0.25, -0.3, FZ - 0.02), (0.2, 0.4, 0.1), UNDER)                                                 # the tank
    for yc, off, kind in ((AY, 0.22, g('front_susp', 'leaf')), (-AY, 0.0, g('rear_susp', 'leaf'))):
        tube(bm, uvl, [V(-TRK + 0.14, yc, R), V(TRK - 0.14, yc, R)], [(0.05, 0.05)] * 2, UNDER, 10)          # the axle
        tube(bm, uvl, [V(off - 0.13, yc, R), V(off - 0.07, yc, R), V(off + 0.07, yc, R), V(off + 0.13, yc, R)], [(0.07, 0.07), (0.14, 0.14), (0.14, 0.14), (0.07, 0.07)], UNDER, 10)
        tube(bm, uvl, [V(off, yc - math.copysign(0.14, yc), R), V(0.08, 0, FZ - 0.05)], [(0.03, 0.03)] * 2, UNDER, 8)   # the prop shaft
        for sx in (-1, 1):
            cx = sx * 0.5
            if kind == 'leaf':
                # a LEAF pack: four leaves, each shorter, arched from the front hanger to the shackle
                for k in range(4):
                    hl = 0.62 - 0.12 * k; n = 8
                    path = [V(cx, yc + hl * (2 * i / n - 1), R + 0.075 + 0.012 * k + 0.09 * (abs(2 * i / n - 1) ** 2) * (1 if k == 0 else (hl / 0.62) ** 2)) for i in range(n + 1)]
                    for i in range(n): bar(bm, path[i], path[i + 1], 0.06, 0.01, STEEL, Z, ext=0.004)
                for e in (-1, 1): bar(bm, V(cx, yc + e * 0.62, R + 0.165), V(cx, yc + e * 0.62, FZ - 0.02), 0.03, 0.03, UNDER, Y)   # hanger / shackle
            else:
                n = 55
                path = [V(cx + math.cos(i / 10 * 2 * math.pi) * 0.07, yc + math.sin(i / 10 * 2 * math.pi) * 0.07, R + 0.07 + (FZ - R - 0.07) * i / n) for i in range(n + 1)]
                tube(bm, uvl, path, [(0.016, 0.016)] * len(path), STEEL, 6)
            dy = yc - math.copysign(0.22, yc)
            tube(bm, uvl, [V(cx, dy, R + 0.02), V(cx - sx * 0.06, dy, FZ + 0.1)], [(0.026, 0.026)] * 2, TRIM, 8)   # the damper
    parts.append(finish(bm, 'under', 0.0))
    body = join('body', parts)

    # ---------------------------------------------------------------------------------- the cockpit's moving parts
    hub = HUB.copy()
    col = V(0, math.cos(math.radians(22)), -math.sin(math.radians(22)))
    e1, e2 = X.copy(), V(0, math.sin(math.radians(22)), math.cos(math.radians(22)))
    bm, uvl = new_bm()
    RIMR = 0.195
    tube(bm, uvl, [hub + (e1 * math.cos(i / 20 * 2 * math.pi) + e2 * math.sin(i / 20 * 2 * math.pi)) * RIMR for i in range(21)], [(0.016, 0.016)] * 21, DASH, 8, caps=False)
    for deg in (0, 180, 270):
        a_ = math.radians(deg); bar(bm, hub, hub + (e1 * math.cos(a_) + e2 * math.sin(a_)) * RIMR, 0.04, 0.016, DASH, col)
    tube(bm, uvl, [hub - col * 0.02, hub + col * 0.02], [(0.05, 0.05)] * 2, TRIM, 12)
    steer = finish(bm, 'steering_wheel', 0.0)
    bm, uvl = new_bm()
    tube(bm, uvl, [hub + col * 0.02, hub + col * 0.3], [(0.03, 0.03)] * 2, DASH, 8)
    cab.append(finish(bm, 'cab_column', 0.0))
    cabin = join('cab_interior', cab)
    def turned(v, axis, ang):
        q = Vector((v[0], v[2], -v[1])); return Matrix.Rotation(ang, 3, Vector(axis)) @ q
    def pedal(name, x, pad_w):
        piv, pad = V(x, DF - 0.045, S0 + 0.5), V(x, DF - 0.15, S0 + 0.2)
        bm, _ = new_bm()
        bar(bm, piv, pad, 0.02, 0.014, STEEL, X)
        d_ = (pad - piv).normalized()
        bx(bm, pad, (pad_w, 0.008, 0.045), STEEL, X, d_.cross(X).normalized(), d_)
        o = finish(bm, name, 0.0); o['pivot'] = gl(piv); o['axis'] = [1.0, 0.0, 0.0]
        assert turned(pad - piv, o['axis'], 0.3).z < -(pad - piv).y - 0.02, name
        movers.append(o)
    pedal('pedal_gas', HUB.x + 0.12, 0.03); pedal('pedal_brake', HUB.x - 0.04, 0.055)
    if g('gearbox', 'auto') == 'manual': pedal('pedal_clutch', HUB.x - 0.2, 0.04)
    bm, uvl = new_bm()
    if g('shifter', 'column') == 'column':
        g0 = hub + col * 0.12; g1 = g0 + V(0.2, -0.02, 0.07)                                                 # the column's lever, to the right
    else:
        g0, g1 = V(0, COWL - 0.62, S0 + 0.02), V(0, COWL - 0.66, S0 + 0.42)                                  # a floor lever
    tube(bm, uvl, [g0, g1], [(0.012, 0.012)] * 2, STEEL, 8); bx(bm, g1, (0.024, 0.024, 0.026), DASH)
    o = finish(bm, 'gear_lever', 0.0); o['pivot'] = gl(g0); o['axis'] = [1.0, 0.0, 0.0]; movers.append(o)
    wt = V(0, -(COWL - WS_TOP), ROOF - BELT).normalized(); wno = X.cross(wt).normalized()
    if wno.y < 0: wno = -wno
    scr = lambda x, t: V(x, COWL - (COWL - WS_TOP) * t, BELT + (ROOF - BELT) * t) + wno * 0.022
    WL = 0.5 * HW
    for name, xp in (('wiper_L', -0.46 * HW), ('wiper_R', 0.12 * HW)):
        piv, tip = scr(xp, 0.06), scr(xp + WL, 0.11)
        bm, uvl = new_bm()
        bar(bm, piv, tip, 0.016, 0.012, DASH, wno); bar(bm, piv + (tip - piv) * 0.12, tip, 0.03, 0.008, UNDER, wno)
        tube(bm, uvl, [piv - wno * 0.02, piv + wno * 0.012], [(0.02, 0.02)] * 2, DASH, 8)
        o = finish(bm, name, 0.0)
        ax = Vector((wno.x, wno.z, -wno.y))
        if turned(tip - piv, ax, 0.7).y < (tip - piv).z: ax = -ax
        assert turned(tip - piv, ax, 0.7).y > (tip - piv).z + 0.1
        o['pivot'] = gl(piv); o['axis'] = [round(c, 5) for c in ax]; movers.append(o)

    # ---------------------------------------------------------------------------------------------- the wheels
    wheels = []
    for name, sx, yc in (('wheel_FL', -1, AY), ('wheel_FR', 1, AY), ('wheel_RL', -1, -AY), ('wheel_RR', 1, -AY)):
        w = make_wheel(name, sx); w.location = (sx * TRK, yc, R); w['rim'] = round(RI / R, 3); wheels.append(w)
    allp = [body, cabin, steer] + movers + doors + wheels
    bpy.context.view_layer.update()
    def bounds(objs):
        lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
        for o in objs:
            for v in o.data.vertices:
                w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
        return lo, hi
    lo, hi = bounds([body] + doors + wheels + spares); blo, bhi = bounds([body] + doors + spares)
    weather([body] + doors, wheels + spares, SILL, log, late=spares)
    if spares: join('body', [body] + spares)
    # THE PAINTED TEXTURE over the paint's panels (chips, scratches, rust, mud), then the two files: the PC's (2048²) and
    # the phones' (1024²)
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'bake', os.path.basename(out)[:-4] + '_paint.png')
    img = paint_texture([body] + doors, MATS[PAINT], SILL, cache, 2048, log)
    bpy.ops.object.select_all(action='DESELECT')
    for o in allp: o.select_set(True)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    export(out, textured=True)
    img.scale(1024, 1024)
    export(out[:-4] + '.m.glb', textured=True)
    tot = 0
    for o in allp: o.data.calc_loop_triangles(); tot += len(o.data.loop_triangles)
    info = dict(triangles=tot, wheelRadius=R, bytes=os.path.getsize(out), bytesSmall=os.path.getsize(out[:-4] + '.m.glb'), length=round(hi.y - lo.y, 4), half=dict(x=round((bhi.x - blo.x) / 2, 3), y=round((bhi.z - blo.z) / 2, 3), z=round((bhi.y - blo.y) / 2, 3)),
                wheelPos=[[round(sx * TRK, 3), R, round(-yc, 4)] for sx, yc in ((-1, AY), (1, AY), (-1, -AY), (1, -AY))], hub=gl(hub),
                exhaust=[-0.62, round(FZ - 0.1, 3), round(-(REAR - 0.05), 3)], roofInner=round(TOPZ, 3), hip=round(HUB.z - 0.36, 3))
    log(f'{os.path.basename(out)}: {info}')
    return allp, info

gl = lambda v: [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]                      # a point in the file's space (glTF: y up, −z forward)


def look(parts, path, name, target=(0, 0, 1.0), dist=11.0):
    """Preview renders (Cycles, a grey world): three-quarter front, side, three-quarter back, above."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.7, 0.7, 0.7, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 2.0; sun.rotation_euler = (math.radians(30), math.radians(-18), 0); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 55
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    pb = MATS[PAINT].node_tree.nodes['Principled BSDF'].inputs['Base Color']; pb.default_value = (*srgb(70, 120, 170), 1)
    os.makedirs(path, exist_ok=True)
    for nm, az, el in (('front34', 35, 12), ('back34', -145, 16)):
        a, e = math.radians(az), math.radians(el)
        d = V(-math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))
        cam.location = Vector(target) + d * dist; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(path, f'{name}_{nm}.png'); bpy.ops.render.render(write_still=True)


def weather(bodies, wheels, sill, log=print, grid=0.28, late=()):
    """WORN, NOT A TOY (2026-11-10, the user: "too cartoonish … like Over the Hill's"): what a flat-coloured model lacks is
    the soft dark where parts meet and the road's dust low on its flanks. Both go into the VERTEX COLOURS, which the game's
    loader multiplies into each part's colour (the scene's `vertex_ao` extra — assets/loadModels.ts): AMBIENT OCCLUSION
    baked per corner (Cycles, every part in place — under the arches, behind the bumpers, in the door gaps, between the
    bed and the cab), and DUST: the lower body a little darker and duller, fading out half a metre up. The big panels are
    cut on a grid first so the shading has corners to live on."""
    sc = bpy.context.scene
    for o in bodies:
        bm = bmesh.new(); bm.from_mesh(o.data)
        lo = Vector((min(v.co[i] for v in bm.verts) for i in range(3))); hi = Vector((max(v.co[i] for v in bm.verts) for i in range(3)))
        for ax in range(3):
            n = Vector((0, 0, 0)); n[ax] = 1; k = math.floor(lo[ax] / grid) + 1
            while k * grid < hi[ax]:
                c = Vector((0, 0, 0)); c[ax] = k * grid + 0.013
                # (only the BIG faces — the panels: the racks, bars and trim have corners enough, and cutting them
                #  all took the off-roader from 30 k to 48 k triangles, +0.13 ms)
                big = [f for f in bm.faces if f.calc_area() > 0.06]
                geom = list({e for f in big for e in f.edges}) + list({v for f in big for v in f.verts}) + big
                if geom: bmesh.ops.bisect_plane(bm, geom=geom, plane_co=c, plane_no=n)
                k += 1
        bm.to_mesh(o.data); bm.free()
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48
    if sc.world is None: sc.world = bpy.data.worlds.new('ao')
    sc.world.light_settings.distance = 0.5
    sc.render.bake.target = 'VERTEX_COLORS'
    for o in bodies + wheels:
        if 'Col' not in o.data.color_attributes: o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        o.data.color_attributes.active_color = o.data.color_attributes['Col']; o.data.color_attributes.render_color_index = o.data.color_attributes.find('Col')
    # (`late` — a spare wheel: hidden while the bodies bake, or the panel behind it goes dark in one patch — the
    #  shading has only the panel's few corners to live on; then shown, and baked itself)
    for o in late: o.hide_render = True
    for o in bodies + [w for w in wheels if w not in late] + list(late):
        if o in late:
            for q in late: q.hide_render = False
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.bake(type='AO')
    for o in bodies + wheels:
        col = o.data.color_attributes['Col'].data; me = o.data; mw = o.matrix_world; body = o in bodies
        for li, lp in enumerate(me.loops):
            a = col[li].color[0]
            a = 0.5 + 0.5 * min(1.0, a * 1.15) ** 1.3                      # (kept soft: the game's own light does the rest)
            if body:
                z = (mw @ me.vertices[lp.vertex_index].co).z
                t = max(0.0, min(1.0, (z - sill) / 0.55)); a *= 0.8 + 0.2 * t * t * (3 - 2 * t)      # the dust
            col[li].color = (a, a, a, 1.0)
    sc['vertex_ao'] = 1
    log('weathered: AO + dust in the vertex colours')


def paint_texture(objs, paint_mat, sill, path, size=2048, log=print):
    """THE PAINTED TEXTURE (2026-11-10, the user: "paint our off-roader" — what Over the Hill's cars have and flat colours
    don't): one image over the PAINT's panels — the paint itself pale and near-neutral, a little uneven (the game's
    paint takes its colour's brightness from it, and its mask the bright neutral texels: catalogue `whitePaint`), then
    what a working truck collects, each where it would be: CHIPS to bare metal along the edges (the mesh's pointiness),
    fine SCRATCHES along its length, small RUST spots, and MUD thrown up its lower flanks, thinning out half a metre up
    (coloured: the mask leaves it mud whatever the paint). Painted by rules from the model itself (a Cycles emission
    bake, its position and edges), so every car gets its own. Returns the image; the paint material ends wired to it."""
    sc = bpy.context.scene
    # the paint's faces unwrapped into one atlas (only they sample the image)
    slot = {o.name: [i for i, m in enumerate(o.data.materials) if m == paint_mat][0] for o in objs}
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        if 'UVMap' not in o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers['UVMap'].active = True; o.data.uv_layers['UVMap'].active_render = True
        for f in o.data.polygons: f.select = f.material_index == slot[o.name]
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, scale_to_bounds=False, correct_aspect=True)
    bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new('paint', size, size, alpha=False)
    # (the ground between the islands: the paint's own pale, not black — a 4 cm window frame is a few texels wide, and
    #  the mips bled the black in: the frames went dark)
    img.generated_color = (*srgb(232, 232, 232), 1)
    t = paint_mat.node_tree; N = t.nodes; L = t.links
    out = next(n for n in N if n.type == 'OUTPUT_MATERIAL'); bsdf = N['Principled BSDF']
    geo = N.new('ShaderNodeNewGeometry'); xyz = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Position'], xyz.inputs[0])
    def noise(scale, detail=3.0, stretch=None):
        n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        if stretch:
            mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = stretch; L.new(geo.outputs['Position'], mp.inputs['Vector']); L.new(mp.outputs[0], n.inputs['Vector'])
        else: L.new(geo.outputs['Position'], n.inputs['Vector'])
        return n.outputs[0]
    def ramp(src, a, b):
        r = N.new('ShaderNodeMapRange'); r.clamp = True; r.inputs['From Min'].default_value = a; r.inputs['From Max'].default_value = b; L.new(src, r.inputs['Value']); return r.outputs[0]
    def mul(a, b):
        m = N.new('ShaderNodeMath'); m.operation = 'MULTIPLY'; m.use_clamp = True
        for k, v in enumerate((a, b)):
            if isinstance(v, (int, float)): m.inputs[k].default_value = v
            else: L.new(v, m.inputs[k])
        return m.outputs[0]
    def add(a, b):
        m = N.new('ShaderNodeMath'); m.operation = 'ADD'
        for k, v in enumerate((a, b)):
            if isinstance(v, (int, float)): m.inputs[k].default_value = v
            else: L.new(v, m.inputs[k])
        return m.outputs[0]
    def mix(fac, a, b):
        m = N.new('ShaderNodeMix'); m.data_type = 'RGBA'; m.clamp_factor = True
        L.new(fac, m.inputs['Factor'])
        for key, v in (('A', a), ('B', b)):
            if isinstance(v, tuple): m.inputs[key].default_value = (*v, 1)
            else: L.new(v, m.inputs[key])
        return m.outputs['Result']
    # the paint: pale, a little uneven in tone (a faded panel, a newer one)
    tone = N.new('ShaderNodeMapRange'); tone.inputs['To Min'].default_value = srgb(214, 214, 214)[0]; tone.inputs['To Max'].default_value = srgb(246, 246, 246)[0]
    L.new(noise(1.6, 2.0), tone.inputs['Value'])
    c = N.new('ShaderNodeCombineColor')
    for k in range(3): L.new(tone.outputs[0], c.inputs[k])
    col = c.outputs[0]
    # fine scratches along the car, a dulling film in patches
    col = mix(mul(ramp(noise(9.0, 4.0, (5.0, 0.35, 5.0)), 0.66, 0.7), 0.55), col, srgb(176, 176, 178))
    # chips to bare metal along the edges, breaking up
    chip = mul(ramp(geo.outputs['Pointiness'], 0.56, 0.66), ramp(noise(26.0, 3.0), 0.52, 0.62))
    col = mix(chip, col, srgb(98, 98, 102))
    # rust: small spots, more of them low down and at the chips
    low = ramp(xyz.outputs['Z'], sill + 0.7, sill - 0.05)
    rust = mul(ramp(noise(30.0, 4.0), 0.66, 0.71), add(mul(low, 0.8), chip))
    col = mix(rust, col, srgb(120, 62, 30))
    # mud thrown up the flanks: thick at the sills, speckled higher, gone by ~half a metre
    mud = ramp(add(ramp(xyz.outputs['Z'], sill + 0.42, sill - 0.1), mul(add(noise(9.0, 8.0), -0.5), 1.5)), 0.6, 0.78)
    col = mix(mul(mud, 0.92), col, mix(noise(40.0, 2.0), srgb(104, 84, 56), srgb(132, 110, 78)))
    em = N.new('ShaderNodeEmission'); L.new(col, em.inputs['Color'])
    L.new(em.outputs[0], out.inputs['Surface'])
    for m in bpy.data.materials:                                                                     # (every material: where the bake writes)
        if not m.use_nodes: continue
        n = m.node_tree.nodes.get('BAKE') or m.node_tree.nodes.new('ShaderNodeTexImage'); n.name = 'BAKE'; n.image = img; m.node_tree.nodes.active = n
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 8
    sc.render.bake.target = 'IMAGE_TEXTURES'; sc.render.bake.margin = 8; sc.render.bake.use_clear = False
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='EMIT', margin=8, use_clear=False)
    # (whatever the bake left BLACK — the atlas between the islands, where it cleared its tiles for all that — goes the
    #  paint's pale: black there bled into the islands' edges through the mips, and the car wore it as black, unpainted
    #  patches — the off-roader's back, round its window)
    import numpy as np
    px = np.empty(size * size * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
    dark = px[:, :3].max(axis=1) < 0.06
    px[dark, :3] = 232 / 255; px[:, 3] = 1.0
    img.pixels.foreach_set(px.ravel()); img.update()
    log(f'paint: {dark.mean() * 100:.1f}% of the atlas was left black, now pale')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    # as the game takes it: the image the paint's base colour (white under it)
    L.new(bsdf.outputs[0], out.inputs['Surface'])
    for m in bpy.data.materials:
        if m.use_nodes and m != paint_mat and m.node_tree.nodes.get('BAKE'): m.node_tree.nodes.remove(m.node_tree.nodes['BAKE'])
    tex = paint_mat.node_tree.nodes['BAKE']; uvn = N.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'; L.new(uvn.outputs[0], tex.inputs['Vector'])
    L.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    log(f'painted: {path} ({size}²)')
    return img


def export(out, textured=False):
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=textured,
                              export_materials='EXPORT', export_apply=True, export_extras=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
                              **(dict(export_image_format='JPEG', export_jpeg_quality=86) if textured else {}))
