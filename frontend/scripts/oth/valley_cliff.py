# OVER THE HILL — the valley's GREAT CLIFF and its ledge road up to the CROSSING (2026-11-02, the user: "do the cliff
# and path, not a bridge — it will walk you through a fog, then gradually the old world will disappear").
#
#   blender -b --factory-startup --python scripts/oth/valley_cliff.py -- [OUT=public/oth/valley] [PREVIEW=<png>]
#
# A post-process over the valley's baked files (after terrain.py and scenery.mjs). It always starts from the copy of
# them in scripts/oth/.cache/valley-base (made on the first run, or whenever OUT has no gate — a fresh bake), so it can
# be run again and again.
#
# In the valley's north-east the ground already climbs east into the mountains; there a PLATEAU is raised (~490 m) out
# of them and on north out of the box (the far world's 16 m grid too), its WEST FACE a ~300 m cliff over the shelf at
# ~180–225 m. Up that face a LEDGE ROAD: 7 legs north ↔ south (420 m each, 26 m apart, a 9.5 % grade, gently bowed),
# joined by hairpins on benches at both ends — each leg a shelf cut into the rock, a low berm on its outer edge, the
# face between two legs a riser (a few metres where a hairpin joins them, ~85 m at the other end), layered in strata.
# From the top leg the PASS runs north over the plateau through the GATE (1102, −1990: the crossing to the desert —
# meta.gate, heading 0 = out to the north) and on to the box's edge. A new track joins the valley's network (track 64
# by the pond) to the cliff's foot (A* on the 8 m grid: ≤ 20 %, never through water). Writes height.bin, far.bin,
# mask.bin (rock on the faces, the plateau's grass and a few pines in the cloud), trail.bin and meta.json (trails,
# gate, the outcrops it buried gone).
import sys, os, math, json, time, heapq, shutil
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrainlib import fbm, smoothstep, blur, grid, bilinear, spline, polyline_field, chaikin, rdp, resample
from ledgeroad import LedgeRoad

T0 = time.time()
ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/valley')
PREVIEW = ARGS.get('PREVIEW')
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'valley-base')
FILES = ['meta.json', 'height.bin', 'far.bin', 'mask.bin', 'trail.bin']
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)

# ------------------------------------------------------------------------------------------------- the base copy
cur = json.load(open(os.path.join(OUT, 'meta.json')))
if 'gate' not in cur or not os.path.exists(os.path.join(BASE, 'meta.json')):
    if 'gate' in cur: raise SystemExit(f'{OUT} already has the cliff and there is no base copy at {BASE}: restore it first (git checkout {OUT})')
    os.makedirs(BASE, exist_ok=True)
    for f in FILES: shutil.copyfile(os.path.join(OUT, f), os.path.join(BASE, f))
    log(f'base copy saved to {BASE}')
meta = json.load(open(os.path.join(BASE, 'meta.json')))
gi, gf, gm = meta['inner'], meta['far'], meta['mask']
N, NF, NM = gi['n'], gf['n'], gm['n']
HALF, FAR_HALF = -gi['origin'], -gf['origin']
H0 = np.fromfile(os.path.join(BASE, 'height.bin'), '<u2').reshape(N, N).astype(np.float64) / 65535 * gi['range'] + gi['min']
HF0 = np.fromfile(os.path.join(BASE, 'far.bin'), '<u2').reshape(NF, NF).astype(np.float64) / 65535 * gf['range'] + gf['min']
MASK = np.fromfile(os.path.join(BASE, 'mask.bin'), np.uint8).reshape(NM, NM, 4).copy()
TRAIL = np.fromfile(os.path.join(BASE, 'trail.bin'), np.uint8).reshape(N, N).copy()
X, Z = grid(N, HALF)
CELL = 2 * HALF / (N - 1)
SEED = 31

# ------------------------------------------------------------------------------------------------- the design
XF, P, NL = 946.0, 26.0, 7          # leg 0's x, the legs' spacing, how many
ZS, ZN = -1510.0, -1930.0           # the legs' south and north ends
SH, BERM_W, BERM_H = 3.7, 1.6, 0.7  # the shelf's half width (the road's 2.8 m + a shoulder), the berm on its outer edge
DROP = 3.2                          # how steep the faces fall where nothing holds them (m per m)
X_TOP = XF + (NL - 1) * P + SH + 14.0   # the plateau's rim behind the top leg
def nat(x, z): return float(bilinear(H0, HALF, np.array([float(x)]), np.array([float(z)]))[0])
YS = round(nat(XF, ZS), 2)
def TOPP(x, z):
    """The plateau's top: rolling a little, rising slowly north in the far world."""
    return 490 + 6 * fbm(x / 260, z / 260, SEED + 10, 3) + 2 * fbm(x / 60, z / 60, SEED + 11, 2) + 0.05 * np.maximum(-2060 - z, 0)
# the LEDGE ROAD (ledgeroad.py): leg 0 from the foot of the face north, the legs stacked east up it, a 9.5 % grade
LR = LedgeRoad(O=(XF, ZS), eu=(0, -1), ev=(1, 0), NL=NL, L=ZS - ZN, y0=YS, top=TOPP, P=P, grade=0.095, SH=SH,
               berm=(BERM_W, BERM_H), wall=X_TOP - XF - (NL - 1) * P - SH, drop=DROP, seed=SEED)
XK_TOP = XF + (NL - 1) * P
YT = LR.y_top                       # the top leg's north end
GATE_Z = -1990.0
def y_pass(z): return YT + 0.04 * np.maximum(ZN - z, 0)
log(f'legs at x {XF:.0f}…{XK_TOP:.0f}, foot {YS:.1f} m, top leg {YT:.1f} m, gate {float(y_pass(GATE_Z)):.1f} m')
def bump(u): return LedgeRoad.bump(u)
def strata(h, lo, hi, x, z): return LR.strata(h, lo, hi, x, z)

# ------------------------------------------------------------------------------------------------- the face (2 m)
log('the face and the plateau (2 m)')
x0, x1, z0, z1 = 860.0, 1720.0, -HALF, -1380.0
i0, i1 = int((x0 + HALF) / CELL), int((x1 + HALF) / CELL) + 1
j0, j1 = int((z0 + HALF) / CELL), int((z1 + HALF) / CELL) + 1
Xw, Zw, Nw = X[j0:j1, i0:i1], Z[j0:j1, i0:i1], H0[j0:j1, i0:i1]
# the natural face north of the switchbacks (and on out of the box, below): foot → rim in ~185 m, 6 great steps
def XW(z): return 935 + 10 * np.sin(z / 230) + 6 * fbm(z / 90, z / 170, SEED + 5, 2) + 0.03 * np.maximum(-2048 - z, 0)
def mnat(x, z, nat_):
    foot = XW(z)
    t = (x - foot) / (X_TOP - 935.0)
    tp = TOPP(x, z)
    s6 = t * 6
    pr = (np.floor(s6) + smoothstep(0.5, 1.0, s6 - np.floor(s6))) / 6
    h = nat_ + (tp - nat_) * np.clip(pr, 0, 1)
    h = np.where(t >= 1, tp, h)
    return np.where(t > 0, np.maximum(nat_, h), nat_)
# the switchbacks' face; past their north end it becomes the plateau's natural west face
H = LR.face(Xw, Zw, Nw, beyond_hi=lambda x, z: mnat(x, z, Nw))
# THE PLATEAU east of the rim: its top, its south face (running north-east into the mountains), its east face, the
# mountains that stand above it kept
ZT = ZS + LR.R + SH + BERM_W + 1 - 0.62 * np.maximum(Xw - X_TOP, 0) + 14 * fbm(Xw / 120, Xw / 300, SEED + 6, 2) * smoothstep(X_TOP, X_TOP + 60, Xw)
XE = 1650 + 30 * fbm(Zw / 150, Zw / 400, SEED + 7, 2)
pl = TOPP(Xw, Zw) - DROP * np.maximum(Zw - ZT, 0) - DROP * np.maximum(Xw - XE, 0)
pl = np.maximum(Nw, pl)
H = np.where(Xw > X_TOP, pl, H)
# the faces' strata where they fall free (the plateau's south and east faces)
free = (Xw > X_TOP) & (pl > Nw + 2) & (pl < TOPP(Xw, Zw) - 1)
H = np.where(free, strata(H, Nw, TOPP(Xw, Zw), Xw, Zw), H)

# THE PASS: from the top leg's north end over the plateau, straight north through the gate to the box's edge
PASS = np.array([[XK_TOP, ZN - 2.0 * k] for k in range(0, int((ZN + HALF) / 2) + 1)])
Dp, Sp, _ = polyline_field(Xw, Zw, PASS, 30)
yb = y_pass(ZN - Sp)
on = (Zw < ZN) & (Dp < SH + 7)
# (the shelf; on its west the berm, then the face below as it is; on its east a bank up to the plateau)
w = 1 - smoothstep(SH, SH + 7, Dp)
west = Xw < XK_TOP
H = np.where(on & (Dp <= SH), yb, H)
H = np.where(on & west & (Dp > SH) & (Dp < SH + BERM_W), yb + BERM_H * bump((Dp - SH) / BERM_W), H)
H = np.where(on & ~west & (Dp > SH), H * (1 - w) + yb * w, H)
Hbox = np.array(H0, copy=True)
Hbox[j0:j1, i0:i1] = H

# ------------------------------------------------------------------------------------------------- the approach
# A* on the 8 m grid from track 64's start (by the pond) to the cliff's foot: ≤ 20 %, never through water or a stream
log('the approach (A*)')
C8 = 8.0
n8 = int(2 * HALF / C8) + 1
H8 = Hbox[::4, ::4]
X8, Z8 = X[::4, ::4], Z[::4, ::4]
M8 = MASK[::2, ::2]
water8 = M8[..., 2] > 120
for s in meta['water'].get('streams', []):
    for x, z, hw in zip(s['x'], s['z'], s['hw']):
        water8 |= np.hypot(X8 - x, Z8 - z) < hw + 9
block = water8.ravel()
rockc = (M8[..., 0].astype(np.float64) / 255).ravel()
Hl = H8.ravel()
NB = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
def cell_of(x, z): return int(round((x + HALF) / C8)), int(round((z + HALF) / C8))
def astar(a, b, maxg=0.2):
    s0 = a[1] * n8 + a[0]; g0 = b[1] * n8 + b[0]
    g = {s0: 0.0}; came = {}; pq = [(0.0, s0)]; closed = set()
    while pq:
        _, u = heapq.heappop(pq)
        if u == g0: break
        if u in closed: continue
        closed.add(u)
        ux, uz = u % n8, u // n8
        for dx, dz, dl in NB:
            vx, vz = ux + dx, uz + dz
            if vx < 0 or vz < 0 or vx >= n8 or vz >= n8: continue
            v = vz * n8 + vx
            if v in closed or (block[v] and v != g0): continue
            L = dl * C8; gr = abs(Hl[v] - Hl[u]) / L
            if gr > maxg: continue
            ng = g[u] + L * (1 + 30 * gr * gr) * (1 + 2 * rockc[v])
            if ng < g.get(v, 1e30):
                g[v] = ng; came[v] = u
                heapq.heappush(pq, (ng + math.hypot(vx - b[0], vz - b[1]) * C8, v))
    if g0 not in came:
        near = min(closed, key=lambda v: (v % n8 - b[0]) ** 2 + (v // n8 - b[1]) ** 2)
        raise SystemExit(f'approach: no route — start {a} blocked {block[s0]}, reached {len(closed)} cells, nearest to the goal ({(near % n8) * C8 - HALF:.0f}, {(near // n8) * C8 - HALF:.0f})')
    p = [g0]
    while p[-1] != s0: p.append(came[p[-1]])
    return np.array([[(q % n8) * C8 - HALF, (q // n8) * C8 - HALF] for q in p[::-1]], float)
# (it leaves track 64 — from the pond's shore out into the valley — at its point nearest the cliff that's dry and
#  clear of the streams)
T64 = meta['trails']['lines'][64]
ok = [p for p in T64 if not block[cell_of(*p)[1] * n8 + cell_of(*p)[0]]]
start = tuple(min(ok, key=lambda p: math.hypot(p[0] - XF, p[1] - ZS)))
log(f'  from track 64 at {start}')
path = astar(cell_of(*start), cell_of(XF, ZS + 60))
K = rdp(np.vstack([[start], path[1:-1], [[XF, ZS + 60], [XF, ZS + 30], [XF, ZS]]]), 8.0)
APP = resample(chaikin(spline(K, 6.0), 2), 2.0)
APP[-1] = [XF, ZS]
sa = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(APP, axis=0).T))])
ha = bilinear(Hbox, HALF, APP[:, 0], APP[:, 1])
kk = 12
sm = np.convolve(np.pad(ha, kk, mode='edge'), np.ones(2 * kk + 1) / (2 * kk + 1), mode='same')[kk:-kk]
# (its ends: the track it leaves, the foot of leg 0)
sm += (ha[0] - sm[0]) * np.clip(1 - sa / 40, 0, 1) + (YS - sm[-1]) * np.clip(1 - (sa[-1] - sa) / 80, 0, 1)
D, S, _ = polyline_field(X, Z, APP, 16)
wa = 1 - smoothstep(2.8 + 0.5, 2.8 + 7, D)
Hbox = Hbox + (np.interp(S, sa, sm) - Hbox) * wa
grades = np.abs(np.diff(sm)) / np.maximum(np.diff(sa), 1e-6)
log(f'  approach {sa[-1]:.0f} m, {ha[0]:.0f} → {YS:.0f} m, steepest {grades.max() * 100:.0f} % (mean {np.mean(grades) * 100:.1f} %)')

# ------------------------------------------------------------------------------------------------- the ledge road's line
ROAD = np.vstack([LR.points(2.0), PASS[1:]])
log(f'  ledge road + pass {np.hypot(*np.diff(ROAD, axis=0).T).sum():.0f} m')

# ------------------------------------------------------------------------------------------------- far world (16 m)
log('the far world (16 m)')
XF16, ZF16 = grid(NF, FAR_HALF)
HF = np.array(HF0, copy=True)
k0 = int(round((FAR_HALF - HALF) / 16))
outside = ~((np.abs(XF16) <= HALF) & (np.abs(ZF16) <= HALF))
reg = outside & (XF16 > 700) & (XF16 < 2000) & (ZF16 < -1900) & (ZF16 > -4600)
xr, zr, nr = XF16[reg], ZF16[reg], HF0[reg]
fm = mnat(xr, zr, nr)
XEr = 1650 + 30 * fbm(zr / 150, zr / 400, SEED + 7, 2)
fp = np.maximum(nr, TOPP(xr, zr) - DROP * np.maximum(xr - XEr, 0))
fh = np.where(xr > X_TOP, fp, fm)
# (the pass road on north a little way in the far grid: a level line through the cloud)
fh = np.where((np.abs(xr - XK_TOP) < 10) & (zr > -2400), np.minimum(fh, y_pass(zr) + 0.5), fh)
# (fading into the far world's own ground toward the region's edges)
fade = smoothstep(4600, 4200, -zr) * smoothstep(2000, 1850, xr)
HF[reg] = nr + (fh - nr) * fade
HF[k0:k0 + 257, k0:k0 + 257] = Hbox[::8, ::8]

# ------------------------------------------------------------------------------------------------- masks, trails
log('masks (4 m), the track field (2 m)')
Hm = Hbox[::2, ::2]
gz4, gx4 = np.gradient(Hm, 4.0)
sl = np.hypot(gx4, gz4)
X4, Z4 = X[::2, ::2], Z[::2, ::2]
# (the cliff and the plateau only: the approach keeps the valley's own ground and plants beside it)
changed = (blur((np.abs(Hbox - H0) > 0.4).astype(np.float64)[::2, ::2], 2) > 0.02) & (X4 > XF - SH - 34) & (Z4 < ZS + 140)
DT4 = np.minimum(polyline_field(X4, Z4, ROAD, 24)[0], polyline_field(X4, Z4, APP, 24)[0])
top = changed & (sl < 0.35)
rock = np.clip(smoothstep(0.42, 0.85, sl) + 0.55 * top * smoothstep(0.05, 0.35, fbm(X4 / 70, Z4 / 70, SEED + 20, 3)), 0, 1)
rock = np.where(DT4 < SH + 1.5, np.maximum(rock * 0.5, 0.0), rock)   # (the road itself: no slab paint under the track)
forest = top * np.clip(smoothstep(0.1, 0.45, fbm(X4 / 160, Z4 / 160, SEED + 21, 3)) * 0.6, 0, 1) * smoothstep(SH + 8, SH + 18, DT4) * (rock < 0.4)
dry = np.where(top, 0.75 + 0.2 * fbm(X4 / 90, Z4 / 90, SEED + 22, 2), MASK[..., 1] / 255)
M = MASK.astype(np.float64) / 255
for c, v in enumerate([rock, dry, np.zeros_like(rock), forest]):
    M[..., c] = np.where(changed, v, M[..., c])
# the approach is a track: no rock slab, no forest on it
DA = polyline_field(X4, Z4, APP, 16)[0]
M[..., 0] = np.where(DA < 6, M[..., 0] * 0.3, M[..., 0])
M[..., 3] = np.where(DA < 6, 0, M[..., 3])
MASK = np.round(np.clip(M, 0, 1) * 255).astype(np.uint8)
DT2 = np.minimum(polyline_field(X, Z, ROAD, 10)[0], polyline_field(X, Z, APP, 10)[0])
TRAIL = np.minimum(TRAIL, np.round(np.clip(DT2 / 8, 0, 1) * 255).astype(np.uint8))

# ------------------------------------------------------------------------------------------------- write
def u16(A):
    lo, hi = float(A.min()), float(A.max())
    return np.round((A - lo) / (hi - lo) * 65535).astype('<u2'), lo, hi - lo
q, mn, rg = u16(Hbox)
q.tofile(os.path.join(OUT, 'height.bin'))
meta['inner'].update(min=mn, range=rg)
qf, mnf, rgf = u16(HF)
qf.tofile(os.path.join(OUT, 'far.bin'))
meta['far'].update(min=mnf, range=rgf)
MASK.tofile(os.path.join(OUT, 'mask.bin'))
TRAIL.tofile(os.path.join(OUT, 'trail.bin'))
def line(T, every): return [[round(float(a), 1), round(float(b), 1)] for a, b in T[::every]] + ([[round(float(T[-1][0]), 1), round(float(T[-1][1]), 1)]] if (len(T) - 1) % every else [])
meta['trails']['lines'] = meta['trails']['lines'] + [line(APP, 4), line(ROAD, 2)]
meta['gate'] = {'x': float(XK_TOP), 'z': GATE_Z, 'y': round(float(y_pass(GATE_Z)), 2), 'heading': 0.0,
                'mist': {'y0': 300.0, 'y1': round(float(YT) - 12, 1), 'r': 520.0}}
gone = [r_ for r_ in meta.get('rocks', []) if abs(bilinear(Hbox - H0, HALF, np.array([r_[0]]), np.array([r_[1]]))[0]) > 3]
meta['rocks'] = [r_ for r_ in meta.get('rocks', []) if r_ not in gone]
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'))
log(f'wrote {OUT}: box {mn:.1f}..{mn + rg:.1f} m; gate {meta["gate"]}; outcrops buried {len(gone)}')

# ------------------------------------------------------------------------------------------------- preview
if PREVIEW:
    import bpy
    px0, px1, pz0, pz1 = 450.0, 1750.0, -HALF, -950.0
    a0, a1 = int((px0 + HALF) / CELL), int((px1 + HALF) / CELL)
    b0, b1 = int((pz0 + HALF) / CELL), int((pz1 + HALF) / CELL)
    A = Hbox[b0:b1, a0:a1]
    gz_, gx_ = np.gradient(A, CELL)
    L = np.array([-0.5, 0.6, -0.62]); L /= np.linalg.norm(L)
    sh = np.clip((-gx_ * L[0] + L[1] - gz_ * L[2]) / np.sqrt(gx_ * gx_ + 1 + gz_ * gz_), 0, 1)
    hn = (A - A.min()) / (A.max() - A.min())
    col = np.stack([0.35 + 0.5 * hn, 0.45 + 0.35 * hn, 0.3 + 0.2 * hn], -1) * (0.3 + 0.8 * sh[..., None])
    rk = np.repeat(np.repeat(MASK[..., 0] / 255.0, 2, 0), 2, 1)[:N, :N][b0:b1, a0:a1]
    col = col * (1 - 0.4 * rk[..., None]) + np.array([0.6, 0.6, 0.66]) * 0.4 * rk[..., None]
    tr = (TRAIL[b0:b1, a0:a1] / 255.0 * 8) < 2.8
    col[tr] = [0.95, 0.35, 0.2]
    img = bpy.data.images.new('cliff', A.shape[1], A.shape[0], alpha=False)
    img.pixels.foreach_set(np.concatenate([np.clip(col[::-1], 0, 1), np.ones(A.shape + (1,))], -1).astype(np.float32).ravel())
    img.filepath_raw = PREVIEW; img.file_format = 'PNG'; img.save()
    log('preview', PREVIEW)
