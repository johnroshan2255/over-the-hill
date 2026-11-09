# OVERHILL — THE VALLEY'S PLACES, MODELLED (docs/MULTIPLAYER.md step 4b — the user, 2026-11-09: "the houses, the broken
# house, the ghost / terror houses — they are all some boxes and look unreal; make those good quality"). The buildings
# Locations.ts used to stack from flat-shaded boxes, modelled here as the building kit is (buildkit.py): real geometry —
# lapped clapboard courses, board-and-batten, notched logs, shingles in courses, corrugated tin, framed windows with
# sills and shutters, board doors on strap hinges, fieldstone chimneys, stone plinths, porches on posts — in the kit's
# TILING scanned materials (ambientCG, shared textures) with ambient occlusion and the PAINT baked into the vertices
# (one pale clapboard scan, WoodSiding009, takes any colour: the red pond cabin, the slate birch one, the grey ghost
# house share a draw). Weathering is geometry too: a ruin's boards bare or gone, its roof sagging and holed to the
# rafters, its porch fallen; the stone house ruin's walls ragged, its gable alone, its chimney standing.
#
# Each building's GLASS is not here: places.json lists every pane (centre, facing, size, state) and the game draws them
# with the landmarks' material (a lit window glows from dusk, the ghost house's upstairs one gutters cold).
#
#   blender -b --factory-startup --python scripts/oth/places.py -- [OUT=src/assets/models/places/places.glb] [PREVIEW=<dir>] [ONLY=a,b]
#
# Blender space: x right, y forward, z up — the game's x, −z, y. Each building's origin is its middle on the ground (the
# place's own origin in Locations.ts), its FRONT toward −y (the game's +z).
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from assetkit import *
import numpy as np
import bpy, bmesh
from mathutils import Vector, noise

kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = os.path.abspath(kw.get('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'places', 'places.glb')))
TEXDIR = os.path.join(FRONTEND, 'src', 'assets', 'textures', 'kit')
PREVIEW = kw.get('PREVIEW')
ONLY = set(kw['ONLY'].split(',')) if kw.get('ONLY') else None
def log(*a): print('[places]', *a, flush=True)

rng = np.random.default_rng(23)
R = lambda a=0.0, b=1.0: float(rng.uniform(a, b))
Z = Vector((0, 0, 1))

reset()
# ===================================================================================================== the materials
# (the kit's, its textures shared — textures/kit/ — and the paintable clapboard)
KIT = json.load(open(os.path.join(FRONTEND, 'src', 'assets', 'models', 'kit', 'kit.json')))
MATS = {
    'stone': ('Bricks096', 0.55), 'block': ('Bricks089', 0.6), 'bark': ('Bark014', 1.2), 'shingle': ('WoodSiding013', 0.7),
    'tin': ('CorrugatedSteel009', 0.8), 'barn': ('WoodSiding005', 0.6), 'planks': ('Planks037A', 0.6), 'door': ('Planks023A', 0.8),
    'iron': ('Metal055A', 1.5), 'rock': ('Rock028', 1.2), 'end': (None, 1.0), 'siding': ('WoodSiding009', 1.0), 'dark': (None, 1.0),
    'paint': (None, 1.0),   # (painted sheet metal: white, its colour the vertices' — a truck's body, a drum)
}
ensure_tex('WoodSiding009')
M = {}
for n, (asset, k) in MATS.items():
    tint = tuple(KIT['materials'][n]['tint']) if n in KIT['materials'] else (1, 1, 1)
    if asset: ensure_tex(asset); M[n] = pbr(n, asset, 1.0, tint, 0.8)
    else: M[n] = flat(n, (0.02, 0.018, 0.016) if n == 'dark' else (1, 1, 1) if n == 'paint' else (0.7, 0.55, 0.38), 0.5 if n == 'paint' else 0.9)
ORDER = list(MATS)
KREP = {n: MATS[n][1] for n in MATS}
# the siding scan: 1024 × 512, eight boards a tile → a 0.18 m board, the tile 2.88 × 1.44 m
SID_H, SID_W = 0.18, 2.88

# ===================================================================================================== the paint
# (linear, as Locations.ts's PAINTS / Kit.ts's C — before the light; the siding scan is normalised to ~0.8 grey)
PAINT = {
    'red': (0.3, 0.075, 0.05), 'cream': (0.56, 0.5, 0.4), 'slate': (0.16, 0.22, 0.28), 'mustard': (0.48, 0.33, 0.1),
    'white': (0.62, 0.6, 0.55), 'green': (0.08, 0.17, 0.11), 'brown': (0.42, 0.28, 0.14), 'trim': (0.6, 0.56, 0.48),
    'ghost': (0.47, 0.46, 0.43), 'ghosttrim': (0.3, 0.29, 0.27), 'shutterdark': (0.12, 0.12, 0.11),
    'bare': (0.34, 0.31, 0.27), 'raw': (1, 1, 1), 'greenroof': (0.2, 0.32, 0.19), 'shgrey': (0.72, 0.7, 0.68),
    'shbrown': (1.0, 0.9, 0.82), 'rust': (0.75, 0.42, 0.25), 'tin': (1.0, 0.97, 0.94), 'barnred': (0.36, 0.1, 0.06),
}
def boost(c, k): return tuple(min(1.0, x * k) for x in c)
def mixc(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

class Part:
    """One building being built: a bmesh, its UVs, each face's material and PAINT (a colour baked into its vertices)."""
    def __init__(self, name):
        self.name = name; self.bm, self.uvl = new_bm()
        self.pcl = self.bm.faces.layers.int.new('pc')
        self.pal = [(1.0, 1.0, 1.0)]; self.cur = 0
        self.panes = []
    def paint(self, rgb=(1, 1, 1)):
        rgb = tuple(float(x) for x in rgb)
        if rgb not in self.pal: self.pal.append(rgb)
        self.cur = self.pal.index(rgb); return self
    def mi(self, mat): return ORDER.index(mat)
    def _mark(self, verts):
        for f in {f for v in verts for f in v.link_faces}: f[self.pcl] = self.cur
    def box(self, c, half, mat, u=Vector((1, 0, 0)), v=Vector((0, 1, 0)), w=Vector((0, 0, 1))):
        vs = box(self.bm, self.uvl, Vector(c), half, self.mi(mat), KREP[mat], u, v, w)
        self._mark(vs.values())
        if mat == 'siding':
            # (painted trim, posts, frames: the scan's grain along the piece, within one board — no laps across it)
            ax = [Vector(u).normalized(), Vector(v).normalized(), Vector(w).normalized()][int(np.argmax(half))]
            c0 = Vector(c); band = R(0, 7)
            for vv in vs.values():
                for lp in vv.link_loops:
                    q = vv.co - c0
                    lp[self.uvl].uv = (q.dot(ax) / SID_W, (band + 0.25 + 0.5 * (0.5 + 0.5 * math.tanh(q.length * 3))) * 0.125)
        return vs
    def tube(self, path, radii, mat, sides=10, caps=True):
        rings = tube(self.bm, self.uvl, [Vector(p) for p in path], radii, self.mi(mat), sides, caps, KREP[mat])
        self._mark([v for r in rings for v in r]); return rings
    def seg(self, a, b, w, h, mat, up=Z):
        """A beam from a to b, w wide, h deep (its depth along `up`)."""
        a, b = Vector(a), Vector(b); d = b - a; L = d.length; d.normalize()
        s = d.cross(up).normalized(); u2 = s.cross(d).normalized()
        return self.box((a + b) / 2, (L / 2, w / 2, h / 2), mat, d, s, u2)
    def pane(self, c, n, hw, hh, state):
        """A pane for the game to draw (Blender centre c, outward n) — stored in the game's frame."""
        self.panes.append([round(c.x, 3), round(c.z, 3), round(-c.y, 3), round(n.x, 3), round(-n.y, 3), round(hw, 3), round(hh, 3), state])
    def done(self, bev=0.0, smooth=True):
        self.bm.normal_update()
        o = obj(self.name, self.bm, [M[n] for n in ORDER], smooth)
        if bev: bevel(o, bev, 2, 32)
        o['pal'] = json.dumps(self.pal); o['panes'] = json.dumps(self.panes)
        return o

def siding_uv(P, vs, o, a, z0, k):
    """Lay the clapboard scan on a board: along the wall `a` from o, board k's height — one scan board a course."""
    for v in vs.values():
        for lp in v.link_loops:
            t = (v.co - o).dot(a); fr = min(1.0, max(0.0, (v.co.z - z0 - k * SID_H) / SID_H))
            lp[P.uvl].uv = (t / SID_W, ((k % 8) + fr) * 0.125 - 0.006)

def batten_uv(P, vs, o, a, z0, b, width):
    """A vertical board: the scan's board turned upright (its grain along the board)."""
    for v in vs.values():
        for lp in v.link_loops:
            t = (v.co - o).dot(a); fr = min(1.0, max(0.0, (t - b * width) / width))
            lp[P.uvl].uv = ((v.co.z - z0) / SID_W, ((b % 8) + fr) * 0.125 - 0.006)

# ===================================================================================================== walls
class Wall:
    """A wall's frame: o its outer face's start at the ground, a along it (L long), n out; openings (t0, t1, zb, zt)."""
    def __init__(self, o, a, n, L, ops=()):
        self.o, self.a, self.n, self.L, self.ops = Vector(o), Vector(a), Vector(n), L, list(ops)
    def p(self, t, z, off=0.0): return self.o + self.a * t + Z * z + self.n * off
    def free(self, z0, z1, t0=None, t1=None):
        """The runs along it clear of the openings over z0…z1."""
        t0 = 0.0 if t0 is None else t0; t1 = self.L if t1 is None else t1
        cuts = sorted((a, b) for (a, b, zb, zt) in self.ops if zb < z1 - 0.01 and zt > z0 + 0.01)
        out = []; x = t0
        for a, b in cuts:
            if a > x + 0.02: out.append((x, min(a, t1)))
            x = max(x, b)
        if t1 > x + 0.02: out.append((x, t1))
        return [(a, b) for a, b in out if b - a > 0.02]

def core(P, W, z0, z1, thick=0.14, mat='planks', paint=(0.55, 0.5, 0.45)):
    """The wall behind its cladding (the inside's face): slabs round the openings."""
    P.paint(paint)
    hs = [z0] + sorted({x for (_, _, zb, zt) in W.ops for x in (zb, zt) if z0 < x < z1}) + [z1]
    for i in range(len(hs) - 1):
        a, b = hs[i], hs[i + 1]
        for t0, t1 in W.free(a, b):
            P.box(W.p((t0 + t1) / 2, (a + b) / 2, -thick / 2 - 0.03), ((t1 - t0) / 2, thick / 2, (b - a) / 2), mat, W.a, W.n, Z)

def clapboard(P, W, z0, z1, paint, ruin=0.0, t0=None, t1=None, top=None):
    """Lapped clapboard: courses SID_H high, each tilted out at its foot, round the openings; a ruin's boards bare
    (weathered to grey) or gone. `top(t)` caps the courses (a gable's slope)."""
    k = 0; z = z0
    while z < z1 - 0.02:
        h = min(SID_H, z1 - z)
        for a, b in W.free(z, z + h, t0, t1):
            # (a long run in boards: the joints staggered)
            x = a
            while x < b - 0.01:
                L = min(b - x, R(2.2, 3.6))
                if top is not None:
                    tm = (x + x + L) / 2
                    if top(x) < z + 0.02 and top(x + L) < z + 0.02: x += L; continue
                if ruin and R() < ruin * 0.22 and z > z0 + 0.3: x += L; continue
                bare = ruin and R() < ruin * (0.9 - 0.5 * (z - z0) / max(0.1, z1 - z0))
                P.paint(mixc(paint, PAINT['bare'], R(0.55, 0.95)) if bare else boost(paint, R(0.92, 1.08)))
                tilt = 0.06
                w2 = (Z - W.n * tilt).normalized(); v2 = w2.cross(W.a).normalized()
                if v2.dot(W.n) < 0: v2 = -v2
                c = W.p(x + L / 2, z + h / 2, 0.012 + tilt * h / 2)
                if top is not None:
                    # (under the gable's slope: the board cut to it — a trapezoid would be truer; boards stepped short)
                    pass
                vs = P.box(c, (L / 2, 0.011, h / 2 + 0.012), 'siding', W.a, v2, w2)
                siding_uv(P, vs, W.o, W.a, z0, k)
                x += L
        z += SID_H; k += 1

def battens(P, W, z0, z1, paint, ruin=0.0, width=0.24, top=None, mat='siding'):
    """Board-and-batten: upright boards `width` wide, a batten over each joint; a ruin's boards bare or gone."""
    n = int(W.L / width + 0.5); width = W.L / n
    for b in range(n):
        t0, t1 = b * width, (b + 1) * width
        zt = z1 if top is None else top((t0 + t1) / 2)
        if zt <= z0 + 0.05: continue
        if ruin and R() < ruin * 0.18: continue
        bare = ruin and R() < ruin * 0.7
        col = mixc(paint, PAINT['bare'], R(0.5, 0.9)) if bare else boost(paint, R(0.9, 1.1))
        P.paint(col)
        # (the board, round any opening: split where an opening crosses it)
        zs = [z0, zt]
        for (a, bb, zb, zt2) in W.ops:
            if a < t1 and bb > t0: zs = [z0, zb, zt2, zt]
        for i in range(0, len(zs) - 1, 2):
            a, bb = zs[i], min(zs[i + 1], zt)
            if bb - a < 0.04: continue
            sag = (ruin and R() < 0.15) and R(-0.06, 0.06) or 0
            vs = P.box(W.p((t0 + t1) / 2, (a + bb) / 2, 0.016), (width / 2 - 0.004, 0.014, (bb - a) / 2), mat, W.a, W.n, Z if not sag else (Z + W.a * sag).normalized())
            if mat == 'siding': batten_uv(P, vs, W.o, W.a, z0, b, width)
        if b < n - 1:
            P.paint(boost(col, 0.9))
            zb2 = min(zt, top(t1) if top else zt)
            if zb2 > z0 + 0.1:
                for i in range(0, len(zs) - 1, 2):
                    a, bb = zs[i], min(zs[i + 1], zb2)
                    if bb - a > 0.05: P.box(W.p(t1, (a + bb) / 2, 0.04), (0.03, 0.012, (bb - a) / 2), mat, W.a, W.n, Z)

def log_course(P, W, z, r, t0, t1, seed, ends=(True, True)):
    """One log along a wall at height z (its axis on the wall's centre line, r behind the face), t0…t1."""
    S = 9; n = max(2, int((t1 - t0) / 1.1))
    rings = []
    for k in range(n + 1):
        t = t0 + (t1 - t0) * k / n
        ring = []
        for s in range(S):
            a = s / S * 2 * math.pi
            nz = noise.noise(Vector((math.cos(a) * 1.6, math.sin(a) * 1.6, t * 0.9 + seed)))
            rr = r * (1 + 0.06 * nz) * (1 - 0.03 * k / n)
            ring.append(P.bm.verts.new(W.p(t, z + math.sin(a) * rr, -r + math.cos(a) * rr)))
        rings.append(ring)
    circ = 2 * math.pi * r
    flip = W.a.cross(W.n).dot(Z) > 0
    for k in range(n):
        for s in range(S):
            q = (rings[k][s], rings[k + 1][s], rings[k + 1][(s + 1) % S], rings[k][(s + 1) % S])
            f = P.bm.faces.new(tuple(reversed(q)) if flip else q); f.material_index = P.mi('bark'); f[P.pcl] = 0
            for lp, (uu, vv) in zip(f.loops, ((k, s), (k + 1, s), (k + 1, s + 1), (k, s + 1))):
                lp[P.uvl].uv = (vv / S * circ * KREP['bark'] + seed, (t0 + (t1 - t0) * uu / n) * KREP['bark'])
    for ring, first in ((rings[0], True), (rings[-1], False)):
        f = P.bm.faces.new(list(reversed(ring)) if first != flip else ring); f.material_index = P.mi('end'); f[P.pcl] = 0
        c = sum((v.co for v in ring), Vector()) / S
        for lp in f.loops:
            d = lp.vert.co - c
            lp[P.uvl].uv = (0.5 + d.dot(W.n) / (2.1 * r), 0.5 + d.z / (2.1 * r))

# ===================================================================================================== openings
def window(P, W, t, zc, hw, hh, state, trim, shutters=None, mat='siding', depth=0.2):
    """A window in a wall: the frame proud of the cladding, a sill, the sash and mullions (unless boarded), shutters swung
    open flat against the wall; boards nailed across a boarded one. Its pane is the game's (P.pane)."""
    P.paint(trim)
    fw = 0.08
    for s in (-1, 1): P.box(W.p(t + s * (hw + fw / 2), zc, 0.05), (fw / 2, 0.035, hh + fw), mat, W.a, W.n, Z)
    P.box(W.p(t, zc + hh + fw / 2 + 0.01, 0.06), (hw + fw + 0.06, 0.045, fw / 2 + 0.01), mat, W.a, W.n, Z)
    P.box(W.p(t, zc - hh - 0.03, 0.08), (hw + fw + 0.1, 0.07, 0.03), mat, W.a, W.n, Z)
    # the reveal (the opening's sides through the wall)
    P.paint(boost(trim, 0.8))
    for s in (-1, 1): P.box(W.p(t + s * (hw + 0.005), zc, -depth / 2), (0.01, depth / 2, hh), mat, W.a, W.n, Z)
    for s in (-1, 1): P.box(W.p(t, zc + s * (hh + 0.005), -depth / 2), (hw, depth / 2, 0.01), mat, W.a, W.n, Z)
    if state != 'boarded':
        P.paint(trim)
        P.box(W.p(t, zc, -0.03), (0.022, 0.025, hh), mat, W.a, W.n, Z)
        P.box(W.p(t, zc, -0.03), (hw, 0.025, 0.022), mat, W.a, W.n, Z)
        for s in (-1, 1): P.box(W.p(t, zc + s * (hh - 0.02), -0.03), (hw, 0.026, 0.022), mat, W.a, W.n, Z)
    else:
        P.paint(PAINT['raw'])
        for y, ang in ((0.55, 0.08), (0.0, -0.05), (-0.5, 0.12)):
            up = Z * math.cos(ang) + W.a * math.sin(ang); al = W.a * math.cos(ang) - Z * math.sin(ang)
            P.box(W.p(t, zc + y * hh, 0.1), (hw + 0.16, 0.016, 0.085), 'planks', al, W.n, up)
    if shutters and state != 'boarded':
        P.paint(shutters)
        sw = hw * 0.95
        for s in (-1, 1):
            cx = t + s * (hw + fw + sw / 2 + 0.02)
            for b in range(3):
                vs = P.box(W.p(cx - sw / 2 + (b + 0.5) * sw / 3, zc, 0.05), (sw / 6 - 0.006, 0.014, hh + 0.04), mat, W.a, W.n, Z)
            P.paint(boost(shutters, 0.85))
            for zz in (zc - hh * 0.6, zc + hh * 0.6): P.box(W.p(cx, zz, 0.07), (sw / 2 - 0.03, 0.01, 0.045), mat, W.a, W.n, Z)
            P.paint(shutters)
    P.pane(W.p(t, zc, -0.05), W.n, hw, hh, state)

def door(P, W, t, z0, hw, h, open_=0.0, trim=PAINT['raw'], mat='siding', col=None):
    """A board-and-batten door on strap hinges in its frame, `open_` radians ajar (inward); the dark inside behind it."""
    P.paint(trim)
    for s in (-1, 1): P.box(W.p(t + s * (hw + 0.05), z0 + h / 2, 0.05), (0.05, 0.04, h / 2 + 0.05), mat, W.a, W.n, Z)
    P.box(W.p(t, z0 + h + 0.07, 0.06), (hw + 0.14, 0.05, 0.07), mat, W.a, W.n, Z)
    # the threshold, the inside dark (a room unlit, seen through the doorway)
    P.paint(PAINT['raw']); P.box(W.p(t, z0 + 0.02, -0.1), (hw, 0.12, 0.02), 'planks', W.a, W.n, Z)
    P.box(W.p(t, z0 + h / 2, -0.9), (hw + 0.1, 0.01, h / 2 + 0.1), 'dark', W.a, W.n, Z)
    # the leaf: hinged at its −a side, swung in
    hinge = W.p(t - hw, z0, -0.05)
    d = W.a * math.cos(open_) - W.n * math.sin(open_); nn = d.cross(Z).normalized()
    if nn.dot(W.n * math.cos(open_) + W.a * math.sin(open_)) < 0: nn = -nn
    P.paint(col or PAINT['raw'])
    n = 5; bw = 2 * hw / n
    for b in range(n): P.box(hinge + d * ((b + 0.5) * bw) + Z * (h / 2), (bw / 2 - 0.005, 0.022, h / 2 - 0.01), 'door', d, nn, Z)
    for zz in (0.25, h / 2, h - 0.25): P.box(hinge + d * hw + Z * zz + nn * 0.035, (hw - 0.05, 0.014, 0.06), 'door', d, nn, Z)
    P.paint(PAINT['raw'])
    for zz in (0.25, h - 0.25): P.box(hinge + d * 0.24 + Z * zz + nn * 0.05, (0.22, 0.006, 0.024), 'iron', d, nn, Z)
    P.box(hinge + d * (2 * hw - 0.12) + Z * (h * 0.48) + nn * 0.05, (0.03, 0.014, 0.06), 'iron', d, nn, Z)

# ===================================================================================================== the roof
def gable_roof(P, w, d, top, rise, over, kind, col, gable=None, sag=0.0, holes=0.0, cut=None, ridge_y=True):
    """A front-gabled roof: the ridge along y over the house, the slopes down to the eaves at ±x (`over` beyond the
    walls), shingles in courses (or tin sheets) on a plank deck on rafters; fascia, barge boards, a ridge cap. A sag
    bows the ridge down in its middle; `holes` skips patches of shingle and deck to the rafters. `cut(x, y)`: no roof
    there (a chimney through the eave)."""
    W2 = w / 2 + over; D2 = d / 2 + over
    slope = rise / (w / 2)
    zE = top - over * slope
    nseg = 10
    def sagz(y, s):  # (how far the roof is down at (y along the ridge, s 0 eave … 1 ridge))
        return sag * math.cos(y / D2 * math.pi / 2) * (0.25 + 0.75 * s)
    hole_at = lambda x, y: holes and noise.noise(Vector((x * 0.55, y * 0.55, 7.3))) > 0.62 - holes * 0.9
    run = W2; L = run * math.sqrt(1 + slope * slope)
    for sx in (-1, 1):
        dirv = Vector((-sx, 0, slope)).normalized()  # (up the slope)
        nrm = Vector((sx * slope, 0, 1)).normalized()
        def at(s, y, lift=0.0):  # (s 0 the eave … 1 the ridge)
            return Vector((sx * W2 * (1 - s), y, zE + (top + rise - zE) * s - sagz(y, s))) + nrm * lift
        # rafters every 0.6 m (under the deck)
        P.paint(PAINT['raw'])
        ny = int(2 * D2 / 0.6)
        for i in range(ny + 1):
            y = -D2 + 0.1 + i * (2 * D2 - 0.2) / ny
            P.seg(at(0, y, -0.1), at(1, y, -0.1), 0.06, 0.15, 'planks', Vector((0, 1, 0)).cross(dirv).normalized() * -1 if False else nrm)
        # the deck and the shingles: segments along y (each its own sag), courses up the slope
        rows = max(4, int(L / (0.9 if kind == 'tin' else 0.3)))
        for sg in range(nseg):
            y0 = -D2 + sg * 2 * D2 / nseg; y1 = y0 + 2 * D2 / nseg; yc = (y0 + y1) / 2
            for k in range(rows):
                s0 = k / rows; s1 = (k + 1) / rows
                if cut and cut(sx * W2 * (1 - (s0 + s1) / 2), yc): continue
                if hole_at(sx * W2 * (1 - (s0 + s1) / 2), yc) and 0 < k < rows - 1: continue
                a = at(s0, yc, 0.0); b = at(s1, yc, 0.0); dv = (b - a); Lr = dv.length; dv.normalize()
                # the deck board
                P.paint(PAINT['raw']); P.box((a + b) / 2 + nrm * -0.02, (Lr / 2 + 0.005, (y1 - y0) / 2, 0.012), 'planks', dv, Vector((0, 1, 0)), nrm)
                if kind == 'tin':
                    rusty = R() < (0.5 if sag else 0.15)
                    P.paint(mixc(col, PAINT['rust'], R(0.3, 0.7)) if rusty else boost(col, R(0.92, 1.08)))
                    P.box((a + b) / 2 + nrm * 0.015 + dv * 0.05, (Lr / 2 + 0.06, (y1 - y0) / 2 + 0.03, 0.01), 'tin', dv, Vector((0, 1, 0)), nrm)
                else:
                    # shingles of uneven width across the segment, each course a little proud of the one above
                    yy = y0
                    while yy < y1 - 0.01:
                        sw = min(R(0.3, 0.55), y1 - yy)
                        P.paint(boost(col, R(0.82, 1.15)))
                        c = (at(s0, yy + sw / 2, 0.0) + at(s1, yy + sw / 2, 0.0)) / 2 + nrm * (0.014 + 0.004 * R()) - dv * 0.03
                        P.box(c, (Lr / 2 + 0.035, sw / 2 - 0.004, 0.011 + 0.004 * R()), 'shingle', dv, Vector((0, 1, 0)), nrm)
                        yy += sw
            # the fascia along the eave (this segment)
            P.paint(gable or PAINT['raw'])
            e0 = at(0, y0, -0.05); e1 = at(0, y1, -0.05)
            P.seg(e0 + Vector((sx * 0.03, 0, 0)), e1 + Vector((sx * 0.03, 0, 0)), 0.05, 0.2, 'siding' if gable else 'planks', Vector((sx, 0, 0)))
        # the barge boards up both gables
        for sy in (-1, 1):
            P.paint(gable or PAINT['raw'])
            P.seg(at(0, sy * (D2 + 0.02), 0.02), at(1, sy * (D2 + 0.02), 0.02), 0.05, 0.22, 'siding' if gable else 'planks', nrm)
    # the ridge cap
    P.paint(boost(col, 0.85) if kind != 'tin' else col)
    for sg in range(nseg):
        y0 = -D2 + sg * 2 * D2 / nseg; y1 = y0 + 2 * D2 / nseg
        za = top + rise - sagz(y0, 1) + 0.06; zb = top + rise - sagz(y1, 1) + 0.06
        if hole_at(0, (y0 + y1) / 2) and holes: continue
        P.seg((0, y0, za), (0, y1, zb), 0.26, 0.05, 'tin' if kind == 'tin' else 'planks')
    return zE

def gable_top(w, top, rise):
    """The gable's line over a front / back wall (t along it from one corner): the roof's underside there."""
    return lambda t: top + rise * (1 - abs(t - w / 2) / (w / 2)) - 0.08

# ===================================================================================================== the parts round it
def plinth(P, w, d, floor, mat='block', depth=0.9):
    """A stone plinth under the walls, from below the ground to the floor: dressed blocks in courses; the floor's boards."""
    P.paint(PAINT['raw'])
    for side in range(4):
        L = w if side < 2 else d
        n = max(2, int(L / 0.5))
        for k in range(int((floor + depth) / 0.24) + 1):
            z = floor - 0.12 - k * 0.24
            off = 0.0 if k % 2 == 0 else 0.25
            for i in range(n + 1):
                t = -L / 2 + off + i * L / n
                a, b = max(-L / 2, t - L / n / 2), min(L / 2, t + L / n / 2)
                if b - a < 0.05: continue
                hl = (b - a) / 2 - 0.008; cc = (a + b) / 2
                if side < 2: P.box((cc, (-1 if side == 0 else 1) * (d / 2 - 0.12), z), (hl, 0.15, 0.113), mat)
                else: P.box(((-1 if side == 2 else 1) * (w / 2 - 0.12), cc, z), (0.15, hl, 0.113), mat)
    P.box((0, 0, floor - 0.05), (w / 2 - 0.2, d / 2 - 0.2, 0.04), 'planks')

def chimney(P, x, y, z0, z1, hw=0.5):
    """Fieldstone, tapering a little, a dressed cap, the flue."""
    P.paint(PAINT['raw'])
    P.box((x, y, (z0 + z1) / 2 - 0.4), (hw, hw, (z1 - z0) / 2 - 0.4), 'stone')
    P.box((x, y, z1 - 0.4), (hw * 0.82, hw * 0.82, 0.4), 'stone')
    for k in range(int((z1 - z0) / 0.36)):
        z = z0 + 0.18 + k * 0.36
        if z > z1 - 0.8: break
        for sx in (-1, 1):
            for sy in (-1, 1):
                L = 0.24 if k % 2 == 0 else 0.16
                P.box((x + sx * (hw - L / 2 + 0.01), y + sy * (hw - 0.12), z), (L / 2 + 0.015, 0.13, 0.165), 'block')
    P.box((x, y, z1 + 0.06), (hw * 0.95, hw * 0.95, 0.07), 'block')
    P.box((x, y, z1 + 0.25), (0.18, 0.18, 0.13), 'block')

def stovepipe(P, x, y, z0, z1):
    P.paint(PAINT['raw'])
    P.tube([(x, y, z0), (x, y, z1)], [(0.09, 0.09)] * 2, 'iron', 12)
    P.box((x, y, z0 + 0.05), (0.2, 0.2, 0.03), 'iron')
    P.tube([(x, y, z1 + 0.06), (x, y, z1 + 0.2)], [(0.2, 0.2), (0.04, 0.04)], 'iron', 12)

def porch(P, w, yf, depth, floor, eave_z, roof_col, roof_kind, door_x, trim=PAINT['raw'], mat='planks'):
    """A porch along the front (y from yf out to yf − depth): a deck on joists, posts with braces, a lean-to roof from
    under the eave, steps down at the door."""
    P.paint(PAINT['raw'])
    y0, y1 = yf, yf - depth
    for x in np.linspace(-w / 2 + 0.15, w / 2 - 0.15, 4):
        for y in (y0 - 0.1, y1 + 0.12): P.box((x, y, (floor - 0.08) / 2 - 0.25), (0.08, 0.08, (floor - 0.08) / 2 + 0.25), 'planks')
    for y in (y0 - 0.1, (y0 + y1) / 2, y1 + 0.12): P.box((0, y, floor - 0.1), (w / 2, 0.05, 0.06), 'planks')
    n = int(w / 0.14)
    for b in range(n):
        P.box((-w / 2 + (b + 0.5) * w / n, (y0 + y1) / 2, floor - 0.02), (w / n / 2 - 0.006, depth / 2, 0.02), 'planks')
    # the posts, braces; the roof (a lean-to: from the eave line down to the beam on the posts)
    zb = eave_z - 0.55
    for x in (-w / 2 + 0.15, -w / 6, w / 6, w / 2 - 0.15) if w > 6 else (-w / 2 + 0.15, w / 2 - 0.15):
        P.paint(trim); P.box((x, y1 + 0.12, (floor + zb) / 2), (0.075, 0.075, (zb - floor) / 2), 'siding' if trim != PAINT['raw'] else 'planks')
        for s in (-1, 1):
            if abs(x + s * 0.4) < w / 2: P.seg((x, y1 + 0.12, zb - 0.5), (x + s * 0.42, y1 + 0.12, zb - 0.05), 0.06, 0.06, 'planks', Vector((0, 1, 0)))
    P.paint(trim); P.box((0, y1 + 0.12, zb + 0.08), (w / 2 + 0.1, 0.07, 0.09), 'siding' if trim != PAINT['raw'] else 'planks')
    pitch = math.atan2(eave_z - (zb + 0.17), depth)
    L = math.hypot(depth + 0.35, eave_z - zb)
    dv = Vector((0, -math.cos(pitch), -math.sin(pitch))); nrm = Vector((0, -math.sin(pitch), math.cos(pitch)))
    a = Vector((0, y0, eave_z))
    P.paint(PAINT['raw'])
    for x in np.linspace(-w / 2, w / 2, int(w / 0.7) + 1): P.seg(a + Vector((x, 0, -0.08)), a + Vector((x, 0, -0.08)) + dv * L, 0.05, 0.12, 'planks', nrm)
    P.box(a + dv * (L / 2) + nrm * 0.01, (w / 2 + 0.15, L / 2, 0.012), 'planks', Vector((1, 0, 0)), dv, nrm)
    rows = int(L / (0.9 if roof_kind == 'tin' else 0.3))
    for k in range(rows):
        s0 = k / rows; c = a + dv * (L * (s0 + 0.5 / rows)) + nrm * 0.03
        if roof_kind == 'tin':
            P.paint(boost(roof_col, R(0.9, 1.08))); P.box(c, (w / 2 + 0.15, L / rows / 2 + 0.05, 0.01), 'tin', Vector((1, 0, 0)), dv, nrm)
        else:
            x = -w / 2 - 0.15
            while x < w / 2 + 0.15:
                sw = min(R(0.3, 0.55), w / 2 + 0.15 - x)
                P.paint(boost(roof_col, R(0.82, 1.15))); P.box(c + Vector((x + sw / 2, 0, 0)) + nrm * 0.004 * R(), (sw / 2 - 0.004, L / rows / 2 + 0.03, 0.012), 'shingle', Vector((1, 0, 0)), dv, nrm)
                x += sw
    P.paint(trim); P.box(a + dv * L + Vector((0, 0, -0.08)), (w / 2 + 0.17, 0.025, 0.09), 'siding' if trim != PAINT['raw'] else 'planks')
    # the steps at the door: three treads on stringers
    P.paint(PAINT['raw'])
    for k in range(3):
        z = floor - (k + 1) * floor / 3.2
        P.box((door_x, y1 - 0.17 - k * 0.3, z - 0.02), (0.75, 0.16, 0.03), 'planks')
    for s in (-1, 1): P.seg((door_x + s * 0.7, y1 + 0.05, floor - 0.05), (door_x + s * 0.7, y1 - 1.0, -0.1), 0.05, 0.2, 'planks', Vector((s, 0, 0)))

def porch_fallen(P, w, yf, floor):
    """A ruin's porch: its boards fallen askew to the ground, a post down, one still standing to nothing."""
    P.paint(PAINT['raw'])
    for i in range(14):
        x = -w / 2 + 0.3 + i * 0.58
        a = R(-0.4, 0.4); tilt = R(-0.25, 0.1)
        u = Vector((math.cos(a), math.sin(a), 0)); v = Vector((-math.sin(a), math.cos(a), 0))
        P.box((x, yf - 1.1 + R(-0.2, 0.2), floor * 0.5 + R(-0.15, 0.1)), (0.12, 0.95 + 0.3 * R(), 0.025), 'planks', u, (v + Z * tilt).normalized(), (Z - v * tilt).normalized())
    P.seg((-w / 2 + 0.2, yf - 2.1, 0.12), (-w / 2 + 2.2, yf - 2.7, 0.08), 0.15, 0.15, 'planks')
    P.box((w / 2 - 0.2, yf - 2.1, 1.7), (0.075, 0.075, 1.9), 'planks')
    for x in np.linspace(-w / 2 + 0.15, w / 2 - 0.15, 4):
        P.box((x, yf - 0.1, (floor - 0.08) / 2 - 0.25), (0.08, 0.08, (floor - 0.08) / 2 + 0.25), 'planks')

# ===================================================================================================== THE HOUSES
def house(name, walls, paint=None, trim=PAINT['trim'], roof='shingle', roof_col=PAINT['shbrown'], state='lived', w=8.5, d=6.5,
          storeys=1, chim='stone', porch_on=True, shutters=None, upper=None):
    """A cabin / house as Locations.ts's cabin(): walls ('log' | 'clap' | 'batten'), a front-gabled roof, the door
    front right of centre, a window left of it, one on each side and one at the back (two more up a second storey), a
    chimney up the left side (stone) or a stovepipe, a porch along the front (fallen in a ruin)."""
    P = Part(name)
    ruin = state == 'ruin'
    floor = 0.5; H = 3.3 * storeys
    top = floor + H + (0.2 if walls == 'log' else 0.0)
    rise = w * 0.3
    wst = lambda k: 'lit' if state == 'lived' else (('broken' if k % 2 else 'boarded') if ruin else ('broken' if k == 1 else 'dark'))
    up = upper or ['dark', 'dark', 'dark']
    ops = {  # (wall: [(t0, t1, zb, zt)], in wall-local t)
        'front': [(w / 2 - 2.2 - 0.62, w / 2 - 2.2 + 0.62, floor + 1.2, floor + 2.3), (w / 2 + 0.9 - 0.58, w / 2 + 0.9 + 0.58, floor, floor + 2.3)],
        'right': [(d / 2 + 0.6 - 0.55, d / 2 + 0.6 + 0.55, floor + 1.25, floor + 2.25)],
        'back': [(w / 2 - 1.6 - 0.5, w / 2 - 1.6 + 0.5, floor + 1.3, floor + 2.2)],
        'left': [(d / 2 - 0.6 - 0.55, d / 2 - 0.6 + 0.55, floor + 1.25, floor + 2.25)],
    }
    if storeys > 1:
        ops['front'] += [(w / 2 - 2.2 - 0.55, w / 2 - 2.2 + 0.55, floor + 4.4, floor + 5.6), (w / 2 + 1.4 - 0.55, w / 2 + 1.4 + 0.55, floor + 4.4, floor + 5.6)]
        ops['right'] += [(d / 2 - 0.6 - 0.5, d / 2 - 0.6 + 0.5, floor + 4.45, floor + 5.55)]
    th = 0.2 if walls == 'log' else 0.0  # (a log wall's face stands out past the plinth)
    Ws = {
        'front': Wall((-w / 2, -d / 2 - th, 0), (1, 0, 0), (0, -1, 0), w, ops['front']),
        'right': Wall((w / 2 + th, -d / 2, 0), (0, 1, 0), (1, 0, 0), d, ops['right']),
        'back': Wall((w / 2, d / 2 + th, 0), (-1, 0, 0), (0, 1, 0), w, ops['back']),
        'left': Wall((-w / 2 - th, d / 2, 0), (0, -1, 0), (-1, 0, 0), d, ops['left']),
    }
    plinth(P, w + 0.1, d + 0.1, floor)
    paintc = paint or PAINT['raw']
    for key, Wl in Ws.items():
        if walls != 'log': core(P, Wl, floor, floor + H)
        gt = gable_top(w, top, rise) if key in ('front', 'back') else None
        if walls == 'clap':
            clapboard(P, Wl, floor, floor + H, paintc, 0.7 if ruin else 0.08 if state == 'empty' else 0.0)
            if gt:
                # the gable's triangle: clapboard courses shortening up to the roof
                z = floor + H; k = int(H / SID_H)
                while z < top + rise - 0.1:
                    half = (w / 2) * (1 - (z + SID_H / 2 - top) / rise) - 0.05
                    if half > 0.1:
                        P.paint(boost(paintc, R(0.92, 1.08)) if not ruin or R() > 0.5 else mixc(paintc, PAINT['bare'], 0.7))
                        tilt = 0.06; w2 = (Z - Wl.n * tilt).normalized(); v2 = w2.cross(Wl.a).normalized()
                        if v2.dot(Wl.n) < 0: v2 = -v2
                        vs = P.box(Wl.p(w / 2, z + SID_H / 2, 0.012 + tilt * SID_H / 2), (half, 0.011, SID_H / 2 + 0.012), 'siding', Wl.a, v2, w2)
                        siding_uv(P, vs, Wl.o, Wl.a, floor, k)
                        P.paint((0.4, 0.37, 0.33)); P.box(Wl.p(w / 2, z + SID_H / 2, -0.06), (half, 0.05, SID_H / 2), 'planks', Wl.a, Wl.n, Z)
                    z += SID_H; k += 1
            # corner boards, the skirt
            P.paint(trim)
            for t in (0.0, Wl.L): P.box(Wl.p(t + (0.06 if t == 0 else -0.06), floor + H / 2, 0.035), (0.07, 0.03, H / 2 + 0.02), 'siding', Wl.a, Wl.n, Z)
            P.box(Wl.p(Wl.L / 2, floor + 0.08, 0.04), (Wl.L / 2, 0.03, 0.09), 'siding', Wl.a, Wl.n, Z)
            if storeys > 1: P.box(Wl.p(Wl.L / 2, floor + 3.35, 0.045), (Wl.L / 2 + 0.03, 0.035, 0.08), 'siding', Wl.a, Wl.n, Z)
        elif walls == 'batten':
            battens(P, Wl, floor, floor + H if not gt else top + rise, paintc, 0.65 if ruin else 0.0, top=(lambda t, gt=gt: min(gt(t), top + rise)) if gt else None)
            if gt:
                P.paint((0.4, 0.37, 0.33))
                for z in np.arange(floor + H, top + rise - 0.2, 0.3):
                    half = (w / 2) * (1 - (z + 0.15 - top) / rise) - 0.1
                    if half > 0.1: P.box(Wl.p(w / 2, z + 0.15, -0.06), (half, 0.05, 0.15), 'planks', Wl.a, Wl.n, Z)
            P.paint(trim)
            for t in (0.0, Wl.L): P.box(Wl.p(t + (0.06 if t == 0 else -0.06), floor + H / 2, 0.05), (0.07, 0.03, H / 2 + 0.02), 'siding', Wl.a, Wl.n, Z)
        else:  # log
            r, step = 0.19, 0.36
            off = 0.0 if key in ('front', 'back') else step / 2
            n = int((H + 0.2) / step)
            for k in range(n):
                z = floor + r + off + k * step
                if z > floor + H + 0.1: break
                seed = R(0, 10)
                for t0, t1 in Wl.free(z - r * 0.6, z + r * 0.6, -0.42, Wl.L + 0.42):
                    log_course(P, Wl, z, r * R(0.95, 1.05), t0, t1, seed); seed += 3
            # the chinking between the logs
            P.paint((0.55, 0.52, 0.47))
            for k in range(n - 1):
                z = floor + r + off + k * step + step / 2
                for t0, t1 in Wl.free(z - 0.03, z + 0.03, 0.05, Wl.L - 0.05):
                    P.box(Wl.p((t0 + t1) / 2, z, -0.06), ((t1 - t0) / 2, 0.04, 0.035), 'block', Wl.a, Wl.n, Z)
            if gt:
                # a log gable: the courses shortening up under the roof
                z = floor + H + 0.2
                while z < top + rise - 0.3:
                    half = (w / 2) * (1 - (z + 0.2 - top) / rise)
                    if half > 0.3: log_course(P, Wl, z, r * 0.9, w / 2 - half, w / 2 + half, R(0, 10))
                    z += step
    # the openings
    tr = trim if walls != 'log' else PAINT['raw']
    fm = 'siding' if walls != 'log' else 'planks'
    sh = shutters
    F = Ws['front']
    window(P, F, w / 2 - 2.2, floor + 1.75, 0.62, 0.55, wst(0), tr, sh, fm, 0.4 if walls == 'log' else 0.2)
    door(P, F, w / 2 + 0.9, floor, 0.58, 2.3, 0.9 if ruin else 0.25 if state == 'empty' else 0.0, tr, fm, (0.42, 0.36, 0.3) if walls == 'log' else boost(tr, 0.6))
    window(P, Ws['right'], d / 2 + 0.6, floor + 1.75, 0.55, 0.5, wst(1), tr, sh, fm, 0.4 if walls == 'log' else 0.2)
    window(P, Ws['left'], d / 2 - 0.6, floor + 1.75, 0.55, 0.5, wst(2), tr, sh, fm, 0.4 if walls == 'log' else 0.2)
    window(P, Ws['back'], w / 2 - 1.6, floor + 1.75, 0.5, 0.45, wst(3), tr, None, fm, 0.4 if walls == 'log' else 0.2)
    if storeys > 1:
        window(P, F, w / 2 - 2.2, floor + 5.0, 0.55, 0.6, up[0], tr, sh, fm)
        window(P, F, w / 2 + 1.4, floor + 5.0, 0.55, 0.6, up[1], tr, sh, fm)
        window(P, Ws['right'], d / 2 - 0.6, floor + 5.0, 0.5, 0.55, up[2], tr, None, fm)
    # the roof
    cx, cy = -w / 2 - 0.45, 0.8
    zE = gable_roof(P, w + 0.3, d + 0.3, top, rise, 0.55, roof, roof_col, gable=None if walls == 'log' else trim,
                    sag=0.45 if ruin else 0.12 if state == 'empty' else 0.0, holes=0.35 if ruin else 0.0,
                    cut=(lambda x, y: abs(x - cx) < 0.6 and abs(y - cy) < 0.6) if chim == 'stone' else None)
    if chim == 'stone': chimney(P, cx, cy, -0.3, top + rise + 0.8, 0.5)
    elif chim == 'pipe':
        x, y = -1.8, 1.0
        zr = top + rise * (1 - abs(x) / ((w + 0.3) / 2))
        stovepipe(P, x, y, zr - 0.1, zr + 1.2)
    # the porch
    if porch_on:
        if ruin: porch_fallen(P, w, -d / 2 - 0.05, floor)
        else: porch(P, w, -d / 2 - 0.05 - th, 2.2, floor, top - 0.15 if walls != 'log' else top - 0.05, roof_col, roof, 0.9, trim if walls != 'log' else PAINT['raw'])
    else:
        P.paint(PAINT['raw'])
        for k in range(3): P.box((0.9, -d / 2 - 0.2 - k * 0.28, floor - (k + 1) * floor / 3.2 - 0.02), (0.7, 0.15, 0.03), 'planks')
    o = P.done(0.0)
    log(f'{name}: {len(o.data.polygons)} faces, {len(P.panes)} panes')
    return o

def stone_ruin(name, big):
    """THE HOUSE RUIN: fieldstone walls standing to different heights (the courses falling away to a broken end), one
    gable end still up with its window hole, the roof gone but for rafters fallen across, the chimney standing alone,
    the doorway empty; rubble heaps."""
    P = Part(name)
    w, d = (10.0, 7.5) if big else (8.0, 6.5)
    th = 0.55
    def wall(x0, y0, x1, y1, h0, h1, gap=None):
        a = Vector((x1 - x0, y1 - y0, 0)); L = a.length; a.normalize(); n = Vector((a.y, -a.x, 0))
        cols = int(L / 0.5)
        tops = []
        for i in range(cols):
            tc = (i + 0.5) * L / cols
            tops.append(-1.0 if gap and gap[0] < tc < gap[1] else max(0.3, h0 + (h1 - h0) * tc / L + R(-0.3, 0.3)))
        o0 = Vector((x0, y0, 0))
        # ONE SOLID A SECTION: its skyline stepped to the courses (0.36 m), extruded through the wall — no joins inside
        # it for the occlusion bake to darken (stacked boxes banded every course)
        ck = 0.36
        q = [(-1.0 if tp < 0 else -0.25 + (int((tp + 0.25) / ck) + 1) * ck) for tp in tops]
        i = 0
        while i < cols:
            if q[i] < 0: i += 1; continue
            j = i
            while j < cols and q[j] >= 0: j += 1
            pts = [(i * L / cols, -0.5)]
            for c in range(i, j): pts += [(c * L / cols, q[c]), ((c + 1) * L / cols, q[c])]
            pts.append((j * L / cols, -0.5))
            pts = [p_ for k_, p_ in enumerate(pts) if k_ == 0 or (abs(p_[0] - pts[k_ - 1][0]) > 1e-4 or abs(p_[1] - pts[k_ - 1][1]) > 1e-4)]
            bm = P.bm
            Fv = [bm.verts.new(o0 + a * t + n * (th / 2) + Z * z) for t, z in pts]
            Bv = [bm.verts.new(o0 + a * t - n * (th / 2) + Z * z) for t, z in pts]
            fs = [bm.faces.new(Fv), bm.faces.new(list(reversed(Bv)))]
            m_ = len(pts)
            for k_ in range(m_):
                k2 = (k_ + 1) % m_
                fs.append(bm.faces.new((Fv[k2], Fv[k_], Bv[k_], Bv[k2])))
            bmesh.ops.recalc_face_normals(bm, faces=fs)
            for f in fs:
                f.material_index = P.mi('stone'); f[P.pcl] = 0; f.normal_update(); fn = f.normal
                for lp in f.loops:
                    qv = lp.vert.co - o0
                    if abs(fn.dot(n)) > 0.7: uv = (qv.dot(a), qv.z)
                    elif abs(fn.z) > 0.7: uv = (qv.dot(a), qv.dot(n))
                    else: uv = (qv.dot(n), qv.z)
                    lp[P.uvl].uv = (uv[0] * KREP['stone'], uv[1] * KREP['stone'])
            i = j
        # the ragged top: loose stones on it
        for i in range(cols):
            if tops[i] < 0: continue
            c = o0 + a * ((i + 0.5) * L / cols)
            for _ in range(2):
                if R() < 0.55:
                    P.box(c + a * R(-0.15, 0.15) + n * R(-0.1, 0.1) + Z * (q[i] + 0.06), (R(0.1, 0.2), R(0.1, 0.18), 0.09), 'rock', a, n, Z)
        # the quoins up each standing end
        for t, h in ((0.25, h0), (L - 0.25, h1)):
            for k in range(int(max(0.3, h) / 0.36)):
                L2 = 0.42 if k % 2 == 0 else 0.28
                P.box(Vector((x0, y0, 0)) + a * t + Z * (0.18 + k * 0.36 - 0.1), (L2 / 2, th / 2 + 0.015, 0.17), 'block', a, n, Z)
    wall(-w / 2, d / 2, w / 2, d / 2, 3.6, 2.0)
    wall(w / 2, d / 2, w / 2, -d / 2, 2.2, 0.6)
    wall(w / 2, -d / 2, -w / 2, -d / 2, 0.9, 3.0, (w / 2 - 1.6, w / 2 - 0.4))
    wall(-w / 2, -d / 2, -w / 2, d / 2, 3.4, 3.6)
    # the gable over the left wall, a window hole in it
    k = 0; z = 3.6
    while True:
        half = (d / 2) * (1 - k / 6)
        if half < 0.3: break
        y = -half
        while y < half:
            if not (k == 1 and abs(y + 0.27) < 0.5):
                P.box((-w / 2, y + 0.27, z + 0.18), (th / 2, 0.27, 0.17), 'stone' if R() < 0.7 else 'block')
            y += 0.55
        z += 0.36; k += 1
    # rafters fallen across, the ridge beam down at one end
    P.paint((0.7, 0.62, 0.55))
    P.seg((-w / 2, 0, 5.4), (w / 2 - 2, 0.4, 1.0), 0.26, 0.26, 'bark')
    for y, k in ((-2.2, 0), (-0.6, 1), (1.8, 2)):
        P.seg((-w / 2 + 0.3, -y, 3.6), (-w / 2 + 2.8 + k, -y - 0.6, 0.2), 0.12, 0.17, 'planks')
    # the chimney standing alone
    chimney(P, w / 2 - 0.8, d / 2 - 0.9, -0.3, 6.6, 0.55)
    # rubble: heaps of broken stones, a few dressed blocks fallen
    for i in range(9):
        x = R(-0.4, 0.4) * w; y = R(-0.4, 0.4) * d
        for j in range(int(R(6, 14))):
            c = Vector((x + R(-0.8, 0.8), y + R(-0.8, 0.8), R(0, 0.35)))
            bm = P.bm
            ico = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            s = Vector((R(0.12, 0.3), R(0.1, 0.25), R(0.08, 0.18))); off = Vector((R(0, 9), R(0, 9), i + j))
            for v in ico['verts']:
                p = v.co.normalized(); jj = 1 + 0.2 * noise.noise(p * 2 + off)
                v.co = c + Vector((p.x * s.x * jj, p.y * s.y * jj, p.z * s.z * jj))
                for lp in v.link_loops: lp[P.uvl].uv = (v.co.x * KREP['rock'] * 2, v.co.z * KREP['rock'] * 2 + v.co.y)
            for f in {f for v in ico['verts'] for f in v.link_faces}: f.material_index = P.mi('rock'); f.smooth = False; f[P.pcl] = 0
    o = P.done(0.0)
    log(f'{name}: {len(o.data.polygons)} faces')
    return o

def barn(name):
    """A BARN, its roof half gone (rafters bare to the sky), its big door hanging: red board-and-batten weathered to
    grey, a tin roof rusting and holed, a stone plinth."""
    P = Part(name)
    w, d, floor, H = 10.0, 13.0, 0.1, 4.8
    rise = 3.6
    paint = mixc(PAINT['barnred'], PAINT['bare'], 0.3)
    ops = {'front': [(w / 2 - 1.8, w / 2 + 1.8, floor, floor + 3.8)]}
    Ws = {
        'front': Wall((-w / 2, -d / 2, 0), (1, 0, 0), (0, -1, 0), w, ops['front']),
        'right': Wall((w / 2, -d / 2, 0), (0, 1, 0), (1, 0, 0), d, [(4.0, 5.2, floor + 2.2, floor + 3.0)]),
        'back': Wall((w / 2, d / 2, 0), (-1, 0, 0), (0, 1, 0), w),
        'left': Wall((-w / 2, d / 2, 0), (0, -1, 0), (-1, 0, 0), d, [(6.0, 7.2, floor + 2.2, floor + 3.0)]),
    }
    plinth(P, w + 0.1, d + 0.1, floor + 0.3, 'stone', 0.6)
    for key, Wl in Ws.items():
        gt = gable_top(w, floor + H, rise) if key in ('front', 'back') else None
        battens(P, Wl, floor + 0.3, floor + H if not gt else floor + H + rise, paint, 0.55, 0.3, top=(lambda t, gt=gt: gt(t)) if gt else None)
        P.paint(PAINT['raw'])
        for z in (floor + 0.4, floor + H / 2, floor + H - 0.1):
            for t0, t1 in Wl.free(z - 0.08, z + 0.08):
                P.box(Wl.p((t0 + t1) / 2, z, -0.06), ((t1 - t0) / 2, 0.05, 0.08), 'planks', Wl.a, Wl.n, Z)
        for t in (0.1, Wl.L - 0.1): P.box(Wl.p(t, floor + H / 2, -0.1), (0.1, 0.1, H / 2), 'planks', Wl.a, Wl.n, Z)
    for key, t, s in (('right', 4.6, 'broken'), ('left', 6.6, 'dark')):
        window(P, Ws[key], t, floor + 2.6, 0.6, 0.4, s, PAINT['raw'], None, 'planks')
    # the big doorway: the dark inside, one leaf hanging off its top hinge, the other gone; the hay door above
    F = Ws['front']
    P.paint(PAINT['raw']); P.box(F.p(w / 2, floor + 1.9, -3.0), (1.9, 0.01, 1.95), 'dark', F.a, F.n, Z)
    hinge = F.p(w / 2 - 1.8, floor, 0.06); dv = (F.a * math.cos(0.35) - F.n * math.sin(-0.35)).normalized(); dv = (dv + Z * -0.06).normalized()
    nn = dv.cross(Z).normalized()
    for i in range(6):
        P.paint(mixc(paint, PAINT['bare'], R(0.2, 0.8)))
        P.box(hinge + dv * (0.16 + i * 0.32) + Z * (floor + 1.85 - i * 0.04), (0.15, 0.022, 1.85), 'siding', dv, nn, Z)
    P.paint(PAINT['raw'])
    for zz in (0.5, 3.2): P.box(hinge + dv * 0.95 + Z * zz + nn * 0.04, (0.95, 0.014, 0.07), 'planks', dv, nn, Z)
    P.paint(PAINT['raw']); P.box(F.p(w / 2, floor + 4.0 + 0.8, -0.02), (0.75, 0.01, 0.6), 'dark', F.a, F.n, Z)
    P.box(F.p(w / 2, floor + 4.8 + 0.65, 0.06), (0.9, 0.06, 0.06), 'planks', F.a, F.n, Z)
    # the roof: tin, holed, its rafters bare where the sheets have gone (and a row of rafters past the end)
    gable_roof(P, w + 0.4, d + 0.4, floor + H, rise, 0.5, 'tin', PAINT['tin'], gable=paint, sag=0.3, holes=0.45)
    o = P.done(0.0)
    log(f'{name}: {len(o.data.polygons)} faces, {len(P.panes)} panes')
    return o

def garage(name):
    """A ROADSIDE GARAGE: a tall gabled workshop in red board-and-batten, a tin roof, its big doors swung open on the
    dark inside, a sign board over them, a window each side, a lean-to on its right over a workbench."""
    P = Part(name)
    w, d, floor, H, rise = 9.0, 8.0, 0.15, 4.2, 2.6
    paint = PAINT['red']
    Ws = {
        'front': Wall((-w / 2, -d / 2, 0), (1, 0, 0), (0, -1, 0), w, [(w / 2 - 2.2, w / 2 + 2.2, floor, floor + 3.4)]),
        'right': Wall((w / 2, -d / 2, 0), (0, 1, 0), (1, 0, 0), d, [(d / 2 - 0.7, d / 2 + 0.7, floor + 1.5, floor + 2.5)]),
        'back': Wall((w / 2, d / 2, 0), (-1, 0, 0), (0, 1, 0), w),
        'left': Wall((-w / 2, d / 2, 0), (0, -1, 0), (-1, 0, 0), d, [(d / 2 + 1 - 0.7, d / 2 + 1 + 0.7, floor + 1.5, floor + 2.5)]),
    }
    P.paint(PAINT['raw']); P.box((0, 0, floor - 0.25), (w / 2 + 0.05, d / 2 + 0.05, 0.4), 'block')
    for key, Wl in Ws.items():
        gt = gable_top(w, floor + H, rise) if key in ('front', 'back') else None
        core(P, Wl, floor, floor + H if not gt else floor + H, paint=(0.45, 0.4, 0.35))
        battens(P, Wl, floor, floor + H if not gt else floor + H + rise, paint, 0.06, 0.26, top=(lambda t, gt=gt: gt(t)) if gt else None)
        P.paint(PAINT['trim'])
        for t in (0.0, Wl.L): P.box(Wl.p(t + (0.06 if t == 0 else -0.06), floor + H / 2, 0.05), (0.07, 0.03, H / 2 + 0.02), 'siding', Wl.a, Wl.n, Z)
    window(P, Ws['right'], d / 2, floor + 2.0, 0.7, 0.5, 'dark', PAINT['trim'])
    window(P, Ws['left'], d / 2 + 1, floor + 2.0, 0.7, 0.5, 'broken', PAINT['trim'])
    F = Ws['front']
    P.paint(PAINT['raw']); P.box(F.p(w / 2, floor + 1.7, -2.5), (2.2, 0.01, 1.75), 'dark', F.a, F.n, Z)
    P.paint(PAINT['trim'])
    for s in (-1, 1): P.box(F.p(w / 2 + s * 2.27, floor + 1.7, 0.06), (0.07, 0.05, 1.75), 'siding', F.a, F.n, Z)
    P.box(F.p(w / 2, floor + 3.5, 0.08), (2.5, 0.06, 0.12), 'siding', F.a, F.n, Z)
    # the two leaves swung out ~110°: battens, a Z brace each
    for s in (-1, 1):
        hinge = F.p(w / 2 + s * 2.2, floor, 0.1)
        dv = (F.a * -s).normalized(); ang = s * 1.9
        dv = Vector((dv.x * math.cos(ang) - dv.y * math.sin(ang), dv.x * math.sin(ang) + dv.y * math.cos(ang), 0))
        nn = dv.cross(Z).normalized()
        for i in range(6):
            P.paint(boost(paint, R(0.85, 1.1)))
            vs = P.box(hinge + dv * (0.185 + i * 0.37) + Z * 1.7, (0.17, 0.035, 1.7), 'siding', dv, nn, Z)
            batten_uv(P, vs, hinge, dv, floor, i, 0.37)
        P.paint(PAINT['trim'])
        for zz in (0.4, 3.0): P.box(hinge + dv * 1.1 + Z * zz + nn * 0.05, (1.05, 0.016, 0.07), 'siding', dv, nn, Z)
        P.seg(hinge + dv * 0.15 + Z * 0.5 + nn * 0.05, hinge + dv * 2.05 + Z * 2.9 + nn * 0.05, 0.12, 0.03, 'siding', nn)
    # the sign board over the doors, its letters' panel
    P.paint(PAINT['cream']); P.box(F.p(w / 2, floor + 5.0, 0.2), (2.6, 0.05, 0.45), 'siding', F.a, F.n, Z)
    P.paint((0.35, 0.07, 0.04)); P.box(F.p(w / 2, floor + 5.0, 0.26), (2.3, 0.01, 0.18), 'siding', F.a, F.n, Z)
    gable_roof(P, w + 0.3, d + 0.3, floor + H, rise, 0.5, 'tin', PAINT['tin'], gable=PAINT['trim'])
    # the lean-to on the right: two posts, a tin roof from the wall
    P.paint(PAINT['raw'])
    for y in (3.2, -1.8): P.box((w / 2 + 2.6, y, (floor + 3.0) / 2 - 0.2), (0.08, 0.08, (floor + 3.0) / 2 + 0.2), 'planks')
    P.box((w / 2 + 2.6, 0.7, floor + 3.05), (0.08, 2.9, 0.09), 'planks')
    a = Vector((w / 2 + 0.05, 0.7, floor + 3.65)); b = Vector((w / 2 + 2.85, 0.7, floor + 3.0)); dv = (b - a); L = dv.length; dv.normalize()
    nrm = Vector((0, 1, 0)).cross(dv) * -1
    if nrm.z < 0: nrm = -nrm
    for y in np.linspace(-2.0, 3.4, 7): P.seg(a + Vector((0, y - 0.7, -0.1)), b + Vector((0, y - 0.7, -0.1)), 0.05, 0.1, 'planks', nrm)
    P.paint(PAINT['tin']); P.box((a + b) / 2 + nrm * 0.02, (L / 2 + 0.1, 2.9, 0.01), 'tin', dv, Vector((0, 1, 0)), nrm)
    o = P.done(0.0)
    log(f'{name}: {len(o.data.polygons)} faces, {len(P.panes)} panes')
    return o


# ===================================================================================================== the small buildings
# (2026-11-09 — the rest of the valley's code-built huts: their sizes, doors and roofs where Locations.ts had them, so
#  its colliders and clearings stand as they were. Game frame → Blender: x → x, z → −y.)
def lean_roof(P, x0, x1, y_hi, z_hi, y_lo, z_lo, kind, col, rafters=True):
    """A lean-to roof over x0…x1: its high edge at y_hi (z_hi up), sloping down to y_lo (z_lo): rafters, a plank deck,
    corrugated tin in sheets (rusty here and there) or shingles in courses; a fascia board at its low edge."""
    a = Vector((0, y_hi, z_hi)); b = Vector((0, y_lo, z_lo)); dv = (b - a); L = dv.length; dv.normalize()
    nrm = Vector((1, 0, 0)).cross(dv)
    if nrm.z < 0: nrm = -nrm
    W = x1 - x0
    if rafters:
        P.paint(PAINT['raw'])
        for x in np.linspace(x0 + 0.1, x1 - 0.1, max(3, int(W / 0.6) + 1)):
            P.seg(Vector((x, 0, 0)) + a - nrm * 0.1, Vector((x, 0, 0)) + b - nrm * 0.1, 0.06, 0.13, 'planks', nrm)
    rows = max(2, int(L / (0.9 if kind == 'tin' else 0.3)))
    for k in range(rows):
        s0, s1 = k / rows, (k + 1) / rows
        pa = a + (b - a) * s0; pb = a + (b - a) * s1
        P.paint(PAINT['raw']); P.box(Vector(((x0 + x1) / 2, 0, 0)) + (pa + pb) / 2 - nrm * 0.02, (W / 2 + 0.01, L / rows / 2 + 0.005, 0.012), 'planks', Vector((1, 0, 0)), dv, nrm)
        if kind == 'tin':
            nsh = max(1, int(W / 0.9))
            for i in range(nsh):
                sx0 = x0 + i * W / nsh; sx1 = sx0 + W / nsh
                P.paint(mixc(col, (0.5, 0.3, 0.2), R(0.3, 0.55)) if R() < 0.12 else boost(col, R(0.92, 1.08)))
                P.box(Vector(((sx0 + sx1) / 2, 0, 0)) + (pa + pb) / 2 + nrm * 0.015 + dv * 0.04, (W / nsh / 2 + 0.03, L / rows / 2 + 0.06, 0.01), 'tin', dv, Vector((1, 0, 0)), nrm)
        else:
            xx = x0
            while xx < x1 - 0.01:
                sw = min(R(0.3, 0.55), x1 - xx)
                P.paint(boost(col, R(0.82, 1.15)))
                P.box(Vector((xx + sw / 2, 0, 0)) + (pa + pb) / 2 + nrm * (0.014 + 0.004 * R()) - dv * 0.03, (L / rows / 2 + 0.035, sw / 2 - 0.004, 0.011), 'shingle', dv, Vector((1, 0, 0)), nrm)
                xx += sw
    P.paint(PAINT['raw'])
    P.seg(Vector((x0 - 0.02, 0, 0)) + b - Z * 0.1 + dv * 0.02, Vector((x1 + 0.02, 0, 0)) + b - Z * 0.1 + dv * 0.02, 0.04, 0.18, 'planks', Z)

def plank_box(P, w, d, z0, h_front, h_back, paint, ruin=0.0, door_wall=None, door=None):
    """Four board-and-batten walls round x ±w/2, y ±d/2 from z0: the front (−y) h_front high, the back h_back, the sides
    sloping between (a lean-to's walls). `door` (t, hw, h, open, wall): its opening."""
    ops = {k: [] for k in ('front', 'right', 'back', 'left')}
    if door: ops[door[4]].append((door[0] - door[1] - 0.05, door[0] + door[1] + 0.05, z0, z0 + door[2] + 0.1))
    Ws = {
        'front': Wall((-w / 2, -d / 2, 0), (1, 0, 0), (0, -1, 0), w, ops['front']),
        'right': Wall((w / 2, -d / 2, 0), (0, 1, 0), (1, 0, 0), d, ops['right']),
        'back': Wall((w / 2, d / 2, 0), (-1, 0, 0), (0, 1, 0), w, ops['back']),
        'left': Wall((-w / 2, d / 2, 0), (0, -1, 0), (-1, 0, 0), d, ops['left']),
    }
    hz = {'front': lambda t: z0 + h_front, 'back': lambda t: z0 + h_back,
          'right': lambda t: z0 + h_front + (h_back - h_front) * t / d, 'left': lambda t: z0 + h_back + (h_front - h_back) * t / d}
    for k, Wl in Ws.items():
        top = max(h_front, h_back) + z0
        # (the core behind the boards only to the wall's lowest top: under the roof, never through it)
        core(P, Wl, z0, z0 + (h_front if k == 'front' else h_back if k == 'back' else min(h_front, h_back)) - 0.05, 0.05, paint=(0.32, 0.28, 0.24))
        battens(P, Wl, z0, top, paint, ruin, 0.2, top=hz[k])
    return Ws

def outhouse(name):
    """An OUTHOUSE: a tall plank box 1.3 m square, a moon cut in its door (facing +x), a shingled lean roof."""
    P = Part(name); w = 1.3
    P.paint(PAINT['raw']); P.box((0, 0, 0.04), (w / 2 + 0.04, w / 2 + 0.04, 0.06), 'planks')
    Ws = plank_box(P, w, w, 0.08, 2.4, 2.1, mixc(PAINT['bare'], (0.4, 0.33, 0.24), 0.5), 0.05, door=(w / 2, 0.36, 1.95, 0.0, 'right'))
    door(P, Ws['right'], w / 2, 0.08, 0.36, 1.95, 0.0, PAINT['raw'], 'planks', (0.75, 0.68, 0.6))
    # the moon: a dark crescent in the door
    P.paint(PAINT['raw']); Wr = Ws['right']
    for i in range(5):
        a = -0.9 + i * 0.45
        P.box(Wr.p(w / 2 + math.sin(a) * 0.09, 1.72 + math.cos(a) * 0.09, 0.03), (0.022, 0.006, 0.03), 'dark', Wr.a, Wr.n, Z)
    lean_roof(P, -w / 2 - 0.25, w / 2 + 0.25, -w / 2 - 0.25, 2.62, w / 2 + 0.25, 2.25, 'shingle', PAINT['shgrey'], rafters=False)
    o = P.done(0.0); log(f'{name}: {len(o.data.polygons)} faces'); return o

def tool_shed(name):
    """The mine's TOOL SHED: 3.2 × 2.6 m of weathered planks, a tin lean-to high at its back, its door hanging open,
    a shovel and a pick leaning by it."""
    P = Part(name); w, d = 3.2, 2.6
    P.paint(PAINT['raw']); P.box((0, 0, 0.05), (w / 2 + 0.05, d / 2 + 0.05, 0.08), 'planks')
    Ws = plank_box(P, w, d, 0.1, 2.85, 2.3, mixc(PAINT['bare'], (0.38, 0.3, 0.22), 0.4), 0.2, door=(d / 2, 0.55, 2.1, 0.9, 'right'))
    door(P, Ws['right'], d / 2, 0.1, 0.55, 2.1, -0.9, PAINT['raw'], 'planks', (0.7, 0.62, 0.55))
    lean_roof(P, -w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.45, 3.05, d / 2 + 0.45, 2.45, 'tin', PAINT['tin'])
    P.paint(PAINT['raw'])
    for k, (x, y) in enumerate(((1.75, 0.9), (1.75, 1.2))):
        P.tube([(x, y, 0.0), (x + 0.12, y - 0.05, 1.55)], [(0.022, 0.022)] * 2, 'planks', 6)
    P.box((1.78, 0.92, 0.18), (0.012, 0.12, 0.16), 'iron'); P.seg((1.85, 1.0, 1.55), (1.85, 1.4, 1.5), 0.04, 0.05, 'iron')
    o = P.done(0.0); log(f'{name}: {len(o.data.polygons)} faces'); return o

def powder_house(name):
    """The POWDER HOUSE: thick fieldstone walls 2.4 m square (a stone for each course), a steel door in its front (+y in
    the game: Blender −y), a tin lean roof."""
    P = Part(name); h = 2.45
    P.paint(PAINT['raw'])
    for (x, y, hx, hy) in ((-1.2, 0, 0.22, 1.42), (1.2, 0, 0.22, 1.42), (0, 1.17, 1.0, 0.22), (-0.78, -1.17, 0.42, 0.22), (0.78, -1.17, 0.42, 0.22)):
        P.box((x, y, h / 2 - 0.1), (hx - 0.03, hy - 0.03, h / 2 + 0.1), 'stone')
        # dressed quoins at the corners and the door's jambs, a course a stone
        for k in range(6):
            z = 0.2 + k * 0.4
            for sx in ((-1, 1) if hx > hy else (0,)):
                for sy in ((-1, 1) if hy >= hx else (0,)):
                    L = 0.32 if k % 2 == 0 else 0.22
                    if hx > hy: P.box((x + sx * (hx - L / 2), y, z), (L / 2, hy + 0.01, 0.19), 'block')
                    else: P.box((x, y + sy * (hy - L / 2), z), (hx + 0.01, L / 2, 0.19), 'block')
    P.paint((0.2, 0.22, 0.2)); P.box((0, -1.22, 1.0), (0.34, 0.04, 1.0), 'iron')
    P.paint(PAINT['raw']); P.box((0, -1.24, 2.05), (0.5, 0.06, 0.08), 'block'); P.box((0.24, -1.27, 1.0), (0.03, 0.02, 0.08), 'iron')
    lean_roof(P, -1.6, 1.6, 1.6, 2.7, -1.6, 2.38, 'tin', mixc(PAINT['tin'], (0.6, 0.62, 0.62), 0.5))
    o = P.done(0.0); log(f'{name}: {len(o.data.polygons)} faces'); return o

def fishing_hut(name):
    """The lake's FISHING HUT: 4.4 × 3.6 m of sage board-and-batten gone grey, on a plinth 0.35 m up, a tin lean-to
    high at its back, its door (front, x 0.8) ajar, a lit window by it, a dark one on its right, a stovepipe."""
    P = Part(name); w, d, fl = 4.4, 3.6, 0.35
    plinth(P, w, d, fl, 'block', 0.5)
    paint = mixc((0.34, 0.42, 0.3), (0.5, 0.49, 0.45), 0.45)
    Ws = plank_box(P, w, d, fl, 2.25, 2.95, paint, 0.08, door=(w / 2 + 0.8, 0.55, 2.15, 0.15, 'front'))
    Ws['front'].ops.append((w / 2 - 1.1 - 0.5, w / 2 - 1.1 + 0.5, fl + 1.1, fl + 2.0)); Ws['right'].ops.append((d / 2 - 0.5, d / 2 + 0.5, fl + 1.1, fl + 2.0))
    door(P, Ws['front'], w / 2 + 0.8, fl, 0.55, 2.15, 0.15, PAINT['trim'], 'siding', (0.55, 0.52, 0.45))
    window(P, Ws['front'], w / 2 - 1.1, fl + 1.55, 0.45, 0.4, 'lit', PAINT['trim'])
    window(P, Ws['right'], d / 2, fl + 1.55, 0.45, 0.4, 'dark', PAINT['trim'])
    lean_roof(P, -w / 2 - 0.4, w / 2 + 0.4, d / 2 + 0.4, fl + 3.3, -d / 2 - 0.6, fl + 2.55, 'tin', PAINT['tin'])
    stovepipe(P, -1.4, 0.8, fl + 2.9, fl + 4.2)
    o = P.done(0.0); log(f'{name}: {len(o.data.polygons)} faces, {len(P.panes)} panes'); return o

def river_shelter(name):
    """A RIVER SHELTER: a three-sided lean-to of notched logs open to the water (+y in the game: Blender −y), its sides
    stepping down to the front, two posts, a shingled roof, a plank bench inside."""
    P = Part(name); w, d = 4.6, 3.2
    back = Wall((-w / 2 - 0.3, d / 2, 0), (1, 0, 0), (0, 1, 0), w + 0.6)
    for i in range(7): log_course(P, back, 0.2 + i * 0.34, 0.17, 0, w + 0.6, i * 1.7)
    for sx in (-1, 1):
        sd = Wall((sx * w / 2, d / 2 + 0.3, 0), (0, -1, 0), (sx, 0, 0), d + 0.5)
        for i in range(5): log_course(P, sd, 0.2 + i * 0.34, 0.16, 0, (d + 0.5) * (1 - i * 0.14), 3 + i + sx)
    P.paint(PAINT['raw'])
    for sx in (-1, 1): P.tube([(sx * w / 2, -d / 2, -0.2), (sx * w / 2, -d / 2, 1.9)], [(0.12, 0.12), (0.11, 0.11)], 'bark', 9)
    P.seg((-w / 2 - 0.2, -d / 2, 1.88), (w / 2 + 0.2, -d / 2, 1.88), 0.18, 0.2, 'bark')  # (the beam under the roof's front edge)
    lean_roof(P, -w / 2 - 0.5, w / 2 + 0.5, d / 2 + 0.5, 2.75, -d / 2 - 0.7, 2.0, 'shingle', PAINT['shbrown'])
    P.box((0, 0.5, 0.3), (w / 2 - 0.2, 1.1, 0.04), 'planks')
    for x in (-1.6, 0, 1.6): P.box((x, 0.5, 0.14), (0.06, 1.0, 0.14), 'planks')
    o = P.done(0.0); log(f'{name}: {len(o.data.polygons)} faces'); return o

# ===================================================================================================== the yards' props
# (painted parts in BODY — the game paints each placement its own colour: Buildings.ts, the vertex alpha marks them)
BODY = (0.7, 0.7, 0.7)

def barrel(name, steel=False):
    """A wooden BARREL of staves bulging at its middle, three iron hoops (or a STEEL DRUM, ribbed, painted)."""
    P = Part(name); r, h = 0.3, 0.9
    prof = [(0, 0.86), (0.18, 0.96), (0.5, 1.0), (0.82, 0.96), (1, 0.86)] if not steel else [(0, 0.98), (0.02, 1.0), (0.98, 1.0), (1, 0.98)]
    P.paint(BODY if steel else PAINT['raw'])
    P.tube([(0, 0, h * t) for t, _ in prof], [(r * k, r * k) for _, k in prof], 'paint' if steel else 'door', 18)
    P.paint(PAINT['raw'] if not steel else boost(BODY, 0.85))
    for t in ((0.12, 0.88, 0.5) if not steel else (0.33, 0.66)):
        k = [kk for tt, kk in prof]
        kk = np.interp(t, [tt for tt, _ in prof], k)
        P.tube([(0, 0, h * t - 0.025), (0, 0, h * t + 0.025)], [(r * kk + 0.012, r * kk + 0.012)] * 2, 'paint' if steel else 'iron', 18)
    o = P.done(0.0); return o

def woodpile(name):
    """A WOODPILE 2.8 m long, six rows of split billets (bark, their cut ends' grain) between two pairs of stakes."""
    P = Part(name); L = 2.8
    for row in range(6):
        n = int(L / 0.19)
        for i in range(n):
            x = -L / 2 + (i + 0.5) * L / n + (row % 2) * 0.05
            y0, y1 = -0.3 - 0.04 * R(), 0.3 + 0.04 * R()
            r = 0.08 + 0.015 * R(); z = 0.1 + row * 0.165
            log_course(P, Wall((x + r, y0, 0), (0, 1, 0), (1, 0, 0), y1 - y0), z, r, 0, y1 - y0, row * 3.1 + i)
    P.paint(PAINT['raw'])
    for sx in (-1, 1):
        for sy in (-1, 1): P.tube([(sx * (L / 2 + 0.1), sy * 0.22, -0.2), (sx * (L / 2 + 0.1), sy * 0.22, 1.15)], [(0.045, 0.045)] * 2, 'bark', 7)
    o = P.done(0.0); return o

def prism(P, prof, y0, y1, mat):
    """A solid from a side profile (x, z points, counter-clockwise) extruded across y0…y1."""
    bm = P.bm
    A = [bm.verts.new((x, y0, z)) for x, z in prof]; B = [bm.verts.new((x, y1, z)) for x, z in prof]
    fs = [bm.faces.new(list(reversed(A))), bm.faces.new(B)]
    n = len(prof)
    for i in range(n): fs.append(bm.faces.new((A[i], A[(i + 1) % n], B[(i + 1) % n], B[i])))
    for f in fs:
        f.material_index = P.mi(mat); f[P.pcl] = P.cur
        nn = f.normal if f.normal.length > 0 else Vector((0, 0, 1))
        bm.normal_update()
        for lp in f.loops:
            c = lp.vert.co; k = KREP[mat]
            ax = int(np.argmax([abs(f.normal.x), abs(f.normal.y), abs(f.normal.z)]))
            lp[P.uvl].uv = ((c.y, c.z) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y))
            lp[P.uvl].uv = (lp[P.uvl].uv[0] * k, lp[P.uvl].uv[1] * k)
    return fs

def pickup(name, wreck=False):
    """An old PICKUP (a '50s farm truck): a long hood between round-topped fenders, a chrome-barred grille, the cab
    with its slanted windscreen, a plank-floored bed, running boards, bumpers, four wheels. Its paint is BODY (each
    placement its own colour), worn through to rust at the edges. WRECKED: rust all over, the tyres flat (one wheel
    gone, the axle on a block), the hood up, the glass out, the tailgate down."""
    P = Part(name)
    rust = (0.3, 0.13, 0.06); body = (lambda: mixc(BODY, rust, R(0.5, 0.9)) if R() < (0.55 if wreck else 0.08) else BODY)
    WB, TR, WR = 1.6, 0.8, 0.4    # (wheels at x ±WB, y ±TR, radius WR)
    sink = 0.12 if wreck else 0.0
    zc = WR - sink
    # the frame
    P.paint(PAINT['raw'])
    for sy in (-1, 1): P.box((0, sy * 0.45, zc + 0.12), (2.5, 0.05, 0.07), 'iron')
    # the wheels: tyres (dark), hubs, the wreck's flat and one gone
    for sx in (-1, 1):
        for sy in (-1, 1):
            if wreck and sx < 0 and sy > 0:
                P.paint(PAINT['raw']); P.box((sx * WB, sy * 0.6, 0.15), (0.2, 0.15, 0.15), 'planks'); continue
            flat = wreck
            P.paint((0.06, 0.06, 0.06))
            rings = [(sy * (TR + 0.12), WR), (sy * (TR - 0.12), WR)]
            P.tube([(sx * WB, y, zc - (0.08 if flat else 0)) for y, _ in rings], [(rr, rr * (0.8 if flat else 1.0)) for _, rr in rings], 'dark', 16)
            P.paint(BODY if not wreck else rust); P.tube([(sx * WB, sy * (TR + 0.13), zc - (0.08 if flat else 0)), (sx * WB, sy * (TR + 0.16), zc - (0.08 if flat else 0))], [(0.2, 0.2), (0.12, 0.12)], 'paint', 12)
    # the fenders: sheets bent round the wheels (front: down to the running board; back: the bed's)
    for sx in (-1, 1):
        for sy in (-1, 1):
            for k in range(9):
                a0 = math.pi * k / 9; a1 = math.pi * (k + 1) / 9
                R0 = WR + 0.12
                p0 = Vector((sx * WB + math.cos(a0) * R0, sy * TR, zc + math.sin(a0) * R0)); p1 = Vector((sx * WB + math.cos(a1) * R0, sy * TR, zc + math.sin(a1) * R0))
                if sx < 0 and wreck and sy > 0 and k < 3: continue
                P.paint(body())
                P.seg(p0, p1, 0.34, 0.02, 'paint', Vector((0, 1, 0)).cross(p1 - p0).normalized() * -1)
    # running boards between the fenders
    P.paint(body())
    for sy in (-1, 1): P.box((0, sy * TR, zc + 0.02), (WB - R0 + 0.05, 0.17, 0.02), 'paint')
    # the hood (two halves along the middle), the grille, the headlamps on the fenders
    hz0, hz1 = zc + 0.45, zc + 0.95
    P.paint(body())
    if wreck:
        hinge = Vector((0.85, 0, hz1)); up = Vector((math.cos(1.2), 0, math.sin(1.2)))
        P.box(hinge + up * 0.7, (0.7, 0.6, 0.02), 'paint', up, Vector((0, 1, 0)), Vector((-math.sin(1.2), 0, math.cos(1.2))))
        P.paint(PAINT['raw']); P.box((1.6, 0, hz0 + 0.15), (0.5, 0.35, 0.22), 'iron')  # (the engine, open to the sky)
    else:
        for sy in (-1, 1): prism(P, [(0.85, hz0), (2.4, hz0), (2.45, hz1 - 0.12), (2.3, hz1 - 0.02), (0.85, hz1)], sy * 0.02, sy * 0.6, 'paint')
    P.paint(body())
    for sy in (-1, 1): prism(P, [(0.85, hz0 - 0.3), (2.4, hz0 - 0.3), (2.4, hz0), (0.85, hz0)], sy * 0.6, sy * 0.62, 'paint')
    P.paint((0.55, 0.55, 0.52) if not wreck else rust)
    P.box((2.47, 0, hz0 + 0.15), (0.04, 0.42, 0.3), 'paint')
    P.paint((0.05, 0.05, 0.05))
    for k in range(7): P.box((2.5, -0.33 + k * 0.11, hz0 + 0.15), (0.015, 0.02, 0.26), 'iron')
    for sy in (-1, 1):
        P.paint(body()); P.tube([(2.25, sy * 0.78, hz0 + 0.12), (2.42, sy * 0.78, hz0 + 0.12)], [(0.11, 0.11), (0.12, 0.12)], 'paint', 12)
        P.paint((0.9, 0.86, 0.7) if not wreck else (0.08, 0.08, 0.08)); P.box((2.43, sy * 0.78, hz0 + 0.12), (0.01, 0.08, 0.08), 'dark' if wreck else 'paint')
    # the cab: its body, the slanted windscreen, the roof; the glass (dark), the doors' seams
    cz0, cz1 = zc + 0.3, zc + 1.62
    P.paint(body())
    prism(P, [(-0.45, cz0), (0.85, cz0), (0.85, hz1), (0.62, cz1 - 0.05), (0.5, cz1), (-0.4, cz1), (-0.45, cz1 - 0.08)], -0.78, 0.78, 'paint')
    for sy in (-1, 1):
        P.paint((0.04, 0.05, 0.05) if not wreck else (0.02, 0.02, 0.02))
        prism(P, [(-0.3, hz1 + 0.06), (0.62, hz1 + 0.06), (0.52, cz1 - 0.1), (-0.3, cz1 - 0.1)], sy * 0.78, sy * 0.795, 'dark')
        P.paint(boost(BODY, 0.6) if not wreck else rust); P.box((0.25, sy * 0.79, (cz0 + hz1) / 2), (0.01, 0.006, (hz1 - cz0) / 2 - 0.05), 'paint')
    P.paint((0.04, 0.05, 0.05)); P.box((0.74, 0, cz1 - 0.3), (0.012, 0.66, 0.24), 'dark', Vector((math.cos(-0.5), 0, math.sin(-0.5))), Vector((0, 1, 0)), Vector((math.sin(0.5), 0, math.cos(0.5))))
    P.box((-0.46, 0, cz1 - 0.3), (0.012, 0.5, 0.18), 'dark')
    # the bed: a plank floor, its sides and front, the tailgate (down on the wreck)
    bz = zc + 0.42
    P.paint(PAINT['raw']); P.box((-1.5, 0, bz), (1.0, 0.72, 0.03), 'planks')
    P.paint(body())
    for sy in (-1, 1): P.box((-1.5, sy * 0.76, bz + 0.27), (1.02, 0.03, 0.28), 'paint')
    P.box((-0.5, 0, bz + 0.27), (0.03, 0.78, 0.28), 'paint')
    if wreck: P.box((-2.5 - 0.27, 0, bz - 0.02), (0.28, 0.76, 0.02), 'paint')
    else: P.box((-2.52, 0, bz + 0.27), (0.03, 0.78, 0.28), 'paint')
    for sy in (-1, 1): P.paint(PAINT['raw']); P.box((-1.5, sy * 0.76, bz + 0.57), (1.04, 0.045, 0.025), 'planks')
    # bumpers
    P.paint((0.5, 0.5, 0.48) if not wreck else rust)
    P.box((2.62, 0, zc + 0.2), (0.06, 0.95, 0.07), 'paint'); P.box((-2.62, 0, zc + 0.2), (0.05, 0.85, 0.06), 'paint')
    o = P.done(0.0); return o

# ===================================================================================================== build them
BUILD = {
    'cabin_trapper': lambda n: house(n, 'log', roof='shingle', roof_col=PAINT['shbrown'], state='lived', chim='stone'),
    'cabin_pond': lambda n: house(n, 'clap', PAINT['red'], PAINT['trim'], 'shingle', PAINT['shgrey'], 'lived', chim='pipe', shutters=PAINT['green']),
    'cabin_birch': lambda n: house(n, 'batten', PAINT['slate'], PAINT['white'], 'tin', PAINT['greenroof'], 'lived', chim='stone', shutters=PAINT['mustard']),
    'cabin_ruin': lambda n: house(n, 'clap', PAINT['mustard'], PAINT['trim'], 'shingle', PAINT['shgrey'], 'ruin', chim='stone'),
    'ranger': lambda n: house(n, 'clap', PAINT['brown'], (0.55, 0.52, 0.42), 'tin', PAINT['greenroof'], 'empty', 9.0, 7.0, chim='pipe', shutters=PAINT['green']),
    'ghost_house': lambda n: house(n, 'clap', PAINT['ghost'], PAINT['ghosttrim'], 'shingle', PAINT['shgrey'], 'ruin', 9.0, 7.0, 2, 'stone', True, PAINT['shutterdark'], ['eerie', 'broken', 'boarded']),
    'hamlet_cabin': lambda n: house(n, 'batten', PAINT['cream'], PAINT['trim'], 'shingle', PAINT['shgrey'], 'ruin', 7.5, 6.0, chim='pipe', porch_on=False),
    'house_ruin_big': lambda n: stone_ruin(n, True),
    'house_ruin_small': lambda n: stone_ruin(n, False),
    'barn': barn,
    'garage': garage,
    'outhouse': outhouse, 'tool_shed': tool_shed, 'powder_house': powder_house, 'fishing_hut': fishing_hut, 'river_shelter': river_shelter,
    'barrel': lambda n: barrel(n), 'drum': lambda n: barrel(n, True), 'woodpile': woodpile,
    'pickup': lambda n: pickup(n), 'pickup_wreck': lambda n: pickup(n, True),
}
parts = [f(n) for n, f in BUILD.items() if not ONLY or n in ONLY]
for o in parts: o.data.calc_loop_triangles()
log('triangles: ' + ', '.join(f'{o.name} {len(o.data.loop_triangles)}' for o in parts))

# ===================================================================================================== AO + paint into the vertices
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 24
sc.world = sc.world or bpy.data.worlds.new('w')
for o in parts:
    ca = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
    o.data.color_attributes.active_color = ca
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    sc.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO')
    # paint × the AO eased (the game takes the colour whole — Places.ts)
    pal = json.loads(o['pal']); pc = o.data.attributes['pc'].data; col = ca.data
    for poly in o.data.polygons:
        p = pal[pc[poly.index].value]
        for li in poly.loop_indices:
            a = col[li].color[0]
            k = 0.4 + 0.6 * a
            # (alpha: 1 where it's BODY paint — the game paints each placement its own colour there)
            col[li].color = (p[0] * k, p[1] * k, p[2] * k, 1.0 if tuple(p) == BODY else 0.0)
    log(f'{o.name}: AO baked, painted')

# ===================================================================================================== out
os.makedirs(TEXDIR, exist_ok=True)
def save_webp(img, path, q):
    sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.quality = q
    img.save_render(path, scene=sc)
sc.view_settings.view_transform = 'Standard'
# the clapboard scan into the kit's textures, normalised to a pale grey (the paint's in the vertices)
c = bpy.data.images.load(os.path.join(ACG, 'WoodSiding009', 'WoodSiding009_1K-JPG_Color.jpg'))
px = np.array(c.pixels[:]).reshape(-1, 4)[:, :3]; lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4); mean = lin.mean(0)  # (the shader's: linear)
save_webp(c, os.path.join(TEXDIR, 'siding.webp'), 88)
n = bpy.data.images.load(os.path.join(ACG, 'WoodSiding009', 'WoodSiding009_1K-JPG_NormalGL.jpg')); n.colorspace_settings.name = 'Non-Color'
save_webp(n, os.path.join(TEXDIR, 'siding_n.webp'), 90)
mats = {k: v for k, v in KIT['materials'].items() if k in MATS}
# (the places' stone a shade lighter than the kit's: whole walls of it in their own shadow read dark)
for k_, f_ in (('stone', 1.4), ('rock', 2.8), ('block', 1.15)):  # (the rock scan is dark: ~0.08 linear)
    mats[k_] = {**mats[k_], 'tint': [round(t * f_, 3) for t in mats[k_]['tint']]}
mats['siding'] = {'k': 1, 'tint': [round(float(0.9 / m), 3) for m in mean], 'tex': 'siding'}
mats['dark'] = {'k': 1, 'tint': [0.02, 0.018, 0.016], 'flat': [0.02, 0.018, 0.016]}
mats['paint'] = {'k': 1, 'tint': [1, 1, 1], 'flat': [1, 1, 1]}
meta = {'materials': mats, 'buildings': {o.name: {'panes': json.loads(o['panes'])} for o in parts}}
# THE FAR LOD (2026-11-09 — a cabin at 70 m+ is a few hundred pixels: 15–31 k triangles there were the cost): each
# building's copy, its small parts dropped, decimated to ~12 % (1.2 k … 4 k) — the game swaps it in past ~70 m
lods = [far_lod(o, int(min(4000, max(1200, len(o.data.loop_triangles) * 0.12))), 0.35) for o in parts]
log('far: ' + ', '.join(f'{o.name} {len(o.data.loop_triangles)}' for o in lods))
for o in lods: o.hide_render = True
os.makedirs(os.path.dirname(OUT), exist_ok=True)
if not ONLY:
    with open(OUT[:-4] + '.json', 'w') as f: json.dump(meta, f, indent=1)
log(f'the siding normalised (mean {mean.round(3)}); wrote {OUT[:-4]}.json')

if PREVIEW:
    sc.render.engine = next((e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE') if e in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]))
    vts = [v.identifier for v in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform = 'AgX' if 'AgX' in vts else 'Filmic'
    for m in M.values():
        if not m.use_nodes: continue
        t = m.node_tree; b = t.nodes['Principled BSDF']
        ca = t.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'AO'
        mx = t.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
        lk = b.inputs['Base Color'].links
        if lk: t.links.new(lk[0].from_socket, mx.inputs['A'])
        else: mx.inputs['A'].default_value = b.inputs['Base Color'].default_value
        t.links.new(ca.outputs['Color'], mx.inputs['B']); t.links.new(mx.outputs['Result'], b.inputs['Base Color'])
    # (the siding's scan made pale for the preview, as the game's tint does)
    sd = M['siding'].node_tree.nodes['Principled BSDF']
    col = bpy.context.scene.collection
    bpy.ops.mesh.primitive_plane_add(size=400); pl = bpy.context.object
    pm = bpy.data.materials.new('ground'); pm.use_nodes = True; pm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.13, 0.17, 0.08, 1); pl.data.materials.append(pm)
    w = bpy.data.worlds.new('w2'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.6; sun.rotation_euler = (math.radians(52), 0, math.radians(30)); col.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); col.objects.link(cam); sc.camera = cam; cam.data.lens = 30
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.image_settings.file_format = 'PNG'
    for o in parts: o.hide_render = True
    for o in parts:
        o.hide_render = False
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]; hi = max(v.z for v in bb); R_ = max(max(abs(v.x), abs(v.y)) for v in bb)
        loc = Vector((R_ * 1.25, -R_ * 2.0, hi * 0.75 + 1.5)); tgt = Vector((0, 0, hi * 0.38))
        cam.location = loc; cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'place_{o.name}.png'); bpy.ops.render.render(write_still=True)
        o.hide_render = True
    for o in parts: o.hide_render = False
    bpy.data.objects.remove(pl); bpy.data.objects.remove(sun); bpy.data.objects.remove(cam)
    log('preview rendered')

# the materials stripped to their names (the game has the textures): no images in the GLB
for m in bpy.data.materials:
    if m.use_nodes:
        t = m.node_tree
        for n_ in list(t.nodes):
            if n_.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'): t.nodes.remove(n_)
bpy.ops.object.select_all(action='DESELECT')
for o in parts + lods:
    for k in ('pal', 'panes'):
        if k in o: del o[k]
    if 'pc' in o.data.attributes: o.data.attributes.remove(o.data.attributes['pc'])
    o.select_set(True)
if not ONLY:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_normals=True, export_texcoords=True,
                              export_materials='EXPORT', export_vertex_color='ACTIVE', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_draco_color_quantization=10)
    log(f'wrote {OUT}: {os.path.getsize(OUT) // 1024} kB, {len(parts)} buildings, {sum(len(o.data.loop_triangles) for o in parts)} triangles (+ {sum(len(o.data.loop_triangles) for o in lods)} far)')
