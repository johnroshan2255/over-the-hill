# OVER THE HILL — GRADE THE TRACKS (2026-11-06, the user: "travel in the valley and check all routes are actually
# possible to drive … lot of routes are impossible to drive, make it drivable").
#
#   node scripts/harness/waterdump.mjs scripts/oth/.cache/valley-pregrade/water.bin   (once, from the un-graded map)
#   python3 scripts/oth/trackgrade.py [OUT=public/oth/valley] [WATER=<water.bin>] [G=0.22] [GR=0.28] [DEBUG=<npz>]
#
# A post-process over the valley's baked files (after terrain.py → scenery.mjs → valley_cliff.py). It always starts
# from the copy of them in scripts/oth/.cache/valley-pregrade (made on the first run), so it can be run again and again.
# Measured first (scripts/oth/trackscan.py + scripts/harness/trackdrive.mjs, a bot on the game's physics): of 33 km of
# track, ~5 km climbed > 30 %, leaned > 20 % across the car or stepped > 0.45 m in 2 m — the rock-crawl routes up to
# 200 % (walls), ordinary ones to 60 % with a 50 % side lean (the car rolled).
#
# THE LINES first (meta.trails.lines; the paint, trail.bin, redrawn from them — what was painted for no line, the decks
# and the pads, kept):
#   - a route that doubles back on itself (an out-and-back spike, a little loop — two legs a metre apart at different
#     heights) has the loop cut out;
#   - a track that crosses on a bridge but runs beside its axis (through the rail) or turns off its side mid-span is
#     snapped onto the axis, 9 m out past each end before it turns;
#   - every line RE-TRACED by a car that can't turn tighter than 7.5 m (pure pursuit): A*'s 8 m grid had left 257
#     hairpins / corners of 2–6 m radius — a hairpin swings out into a turnaround, a gentle bend barely moves; the
#     ends (the junctions) stay put, the bridges' approaches are kept as snapped;
#   - a REDUNDANT line (≥ 75 % on other tracks' beds, crossing between two at different heights — three routes in one
#     gap of a formation) is dropped: 10 of 78, ~140 m of track of their own (`trails.rough` re-indexed).
# Then the GROUND under each (ordinary tracks first, longest first, then the rock-crawl routes):
#   - its PROFILE along the line (1 m): the closest grade-limited one to the ground — the mean of the two Lipschitz
#     envelopes (the highest ≤ G profile under the ground and the lowest over it: as much cut as fill), smoothed
#     (a box filter keeps the bound) — ≤ G (22 %) on an ordinary track, ≤ GR (28 %) on a rock-crawl route (the bot
#     stalled from a standstill on 31–33 %; 26 % would cut 27 m deep); between two held points that need more, that
#     gap's grade spread evenly;
#   - where its bed touches one already graded (a junction, a shared stretch, two tracks side by side) it takes THAT
#     bed's height, the difference eased along it, then the grade re-clamped; a graded bed is LOCKED after;
#   - its CROSS-SECTION: level across the bed (the old 12 cm dip in the middle kept); past it the ground as it was,
#     shifted by the cut / fill and that shift fading out over max(3 m, 1.2 × it) — a hillside stays a hillside;
#   - left alone: the bridges (decks and ramp tops), water (fords, streams — the runtime's water, WATER=, from
#     scripts/harness/waterdump.mjs), the cliff's ledge road and its approach (valley_cliff.py made them ≤ 20 %).
# scenery.mjs's boulders that sit IN a track (its stream-road walls where two tracks cross) are taken off.
# Writes height.bin, far.bin (the box's 16 m cells by the same change), trail.bin and meta.json (the grids' ranges, the
# lines, `rough`, the boulders). Check: python3 scripts/oth/trackscan.py; node scripts/harness/trackdrive.mjs.
import sys, os, json, math, shutil, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrainlib import smoothstep, blur, polyline_field, resample
from scipy.ndimage import distance_transform_edt

T0 = time.time()
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)
ARGS = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/valley')
G = float(ARGS.get('G', 0.22))
GR = float(ARGS.get('GR', 0.28))
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'valley-pregrade')
FILES = ['meta.json', 'height.bin', 'far.bin', 'trail.bin']
WATER = ARGS.get('WATER', os.path.join(BASE, 'water.bin'))

os.makedirs(BASE, exist_ok=True)
for f in FILES:
    if not os.path.exists(os.path.join(BASE, f)):
        shutil.copyfile(os.path.join(OUT, f), os.path.join(BASE, f)); log(f'base copy of {f} saved to {BASE}')
meta = json.load(open(os.path.join(BASE, 'meta.json')))
gi, gf = meta['inner'], meta['far']
N, CELL, HALF = gi['n'], gi['step'], -gi['origin']
NF, CF, HF_HALF = gf['n'], gf['step'], -gf['origin']
H0 = np.fromfile(os.path.join(BASE, 'height.bin'), '<u2').reshape(N, N).astype(np.float64) / 65535 * gi['range'] + gi['min']
HF0 = np.fromfile(os.path.join(BASE, 'far.bin'), '<u2').reshape(NF, NF).astype(np.float64) / 65535 * gf['range'] + gf['min']
H = H0.copy()
xs = np.arange(N) * CELL - HALF
X, Z = np.meshgrid(xs, xs)
TR = meta['trails']
HW = TR['hw']
DECKS = [(np.array([b['x0'], b['z0']]), np.array([b['x1'], b['z1']])) for b in meta.get('bridges', [])]
def by_bridge(p):
    """Within 12 m of a bridge's deck (its axis + 9 m out past each end): the line's left as it is there (snapped)."""
    for A, B in DECKS:
        ab = B - A; L = float(np.hypot(*ab)); u = ab / L; t = float((p - A) @ u)
        if -9 - 12 < t < L + 9 + 12 and abs(float((p - A) @ np.array([-u[1], u[0]]))) < 12: return True
    return False
def despike(l):
    """A route that doubles back on itself (A*'s grid path smoothed into an out-and-back spike or a little loop: its
    two legs a metre or two apart at different heights — a wall between them): wherever the line comes back within a
    bed's width (5.6 m) of itself after > 14 m of arc, the loop between is cut out."""
    P = [p for k, p in enumerate(l) if k == 0 or math.hypot(p[0] - l[k - 1][0], p[1] - l[k - 1][1]) > 0.5]
    P = [tuple(p) for p in P]
    i = 0
    while i < len(P) - 2:
        arc = 0.0; cut = None
        for j in range(i + 1, len(P)):
            arc += math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1])
            if arc > 120: break
            if arc > 14 and math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]) < 2 * HW: cut = j
        if cut is not None and any(by_bridge(np.array(p)) for p in P[i:cut + 1]): cut = None  # (a deck's run-out: kept)
        if cut is not None:
            if i == 0: del P[:cut]  # (a loop off the line's very start: the line starts where the loop closes — no V)
            else: del P[i + 1:cut]
        i += 1
    return np.array(P, float)
def onto_bridges(l):
    """A track that crosses on a bridge but whose line runs beside its axis (4–8 m off: through the rail) or turns off
    its side mid-span: the stretch over the deck snapped onto the axis, out past the deck's ends 9 m before it turns."""
    q = np.asarray(l, float)
    P = [p for p in np.vstack([resample(q, 2.0), q[-1][None]])]  # (every 2 m: a line passing beside a deck between two vertices too)
    for b in meta.get('bridges', []):
        A = np.array([b['x0'], b['z0']]); ab = np.array([b['x1'], b['z1']]) - A; Lb = float(np.hypot(*ab)); u = ab / Lb
        n = np.array([-u[1], u[0]])
        on = [(-2 < (p - A) @ u < Lb + 2) and abs((p - A) @ n) < b['w'] / 2 + 5 for p in P]
        if sum(on) < 2 or all(abs((p - A) @ n) < 0.5 for p, o in zip(P, on) if o): continue  # (none, or its own axis)
        k0 = on.index(True); k1 = len(on) - 1 - on[::-1].index(True)
        ts = [float((P[k] - A) @ u) for k in range(k0, k1 + 1)]
        if min(ts) > 0.2 * Lb or max(ts) < 0.8 * Lb: continue  # (it doesn't cross along the deck: only passes by its end)
        t_in = 0.0 if ts[0] < ts[-1] else Lb; t_out = Lb - t_in; sgn = 1.0 if t_out > t_in else -1.0
        mid = [A + u * t_in - u * 9 * sgn] if k0 > 0 else []
        mid += [A + u * t_in, A + u * t_out] + ([A + u * t_out + u * 9 * sgn] if k1 < len(P) - 1 else [])
        P = P[:k0] + mid + P[k1 + 1:]
    return np.array(P)
def drivable(l, R=7.5, Ld=7.0, ds=0.5):
    """A line a car can follow: A*'s 8 m grid zig-zags up a hillside into switchbacks whose hairpins turn on a 2–3 m
    radius (legs 4 m apart) — the car's tightest is ~7 m. The line is TRACED by a car that can't turn tighter than R
    (pure pursuit, Ld ahead, every ds): a hairpin swings out into a turnaround it can take, a corner is rounded, a
    gentle bend barely moves. The ends stay exactly where they were (the junctions)."""
    P = resample(np.asarray(l, float), ds)
    P = np.vstack([P, np.asarray(l[-1], float)[None]])
    n = len(P)
    if n < 6: return np.asarray(l, float)
    pos = P[0].copy(); d0 = P[min(8, n - 1)] - P[0]; hd = math.atan2(d0[1], d0[0])
    out = [pos.copy()]; i = 0; look = int(Ld / ds)
    for _ in range(6 * n):
        w = P[i:i + 40]; i += int(np.argmin(np.hypot(*(w - pos).T)))
        if i >= n - 3 or math.hypot(*(P[-1] - pos)) < Ld * 0.8: break
        tx, tz = P[min(n - 1, i + look)]
        a = math.atan2(tz - pos[1], tx - pos[0]) - hd; a = math.atan2(math.sin(a), math.cos(a))
        k = max(-1 / R, min(1 / R, 2 * math.sin(a) / Ld))
        hd += k * ds; pos = pos + ds * np.array([math.cos(hd), math.sin(hd)])
        out.append(pos.copy())
    out.append(P[-1])
    Q = resample(np.array(out), 4.0)
    return np.vstack([Q, P[-1][None]]) if math.hypot(*(Q[-1] - P[-1])) > 0.3 else Q
SMOOTH = ARGS.get('SMOOTH', '1') != '0'
def drivable_away(q):
    """drivable() on the stretches away from the bridges; the bridges' approaches kept (a traced corner never swings
    onto a deck's corner, through its rail)."""
    P = resample(q, 2.0); P = np.vstack([P, q[-1][None]])
    near = np.array([by_bridge(p) for p in P])
    if not near.any(): return drivable(q)
    out = []; k = 0
    while k < len(P):
        e = k
        while e + 1 < len(P) and near[e + 1] == near[k]: e += 1
        seg = P[k:e + 2] if e + 1 < len(P) else P[k:e + 1]  # (each piece shares its end with the next)
        piece = seg if near[k] or len(seg) < 4 else drivable(seg)
        out.extend(piece if not out else piece[1:])
        k = e + 1
    return np.array(out)
LINES = []
for li, l in enumerate(TR['lines']):
    if len(l) <= 2: LINES.append(np.array(l, float)); continue
    q = despike(onto_bridges(l))
    if SMOOTH and not ('gate' in meta and li >= len(TR['lines']) - 2): q = drivable_away(q)
    LINES.append(despike(q))
log(f'lines: {sum(1 for a, b in zip(TR["lines"], LINES) if len(a) != len(b) or np.abs(np.array(a, float) - b).max() > 0.5)} of {len(LINES)} re-traced')
ROUGH = set(TR.get('rough', []))
NL = len(LINES)
CLIFF = {NL - 1, NL - 2} if 'gate' in meta else set()  # (valley_cliff.py's approach + ledge road: the last two)

# FROZEN cells: water (fords, streams, the lake's edge), the bridges' decks (+ 3 m), the ledge road's shelf
FROZEN = np.zeros((N, N), bool)
if os.path.exists(WATER):
    W = np.fromfile(WATER, np.uint8).reshape(N, N)
    FROZEN |= W == 1
    FROZEN |= blur((W == 2).astype(float), 2) > 0.01
    log(f'water {int((W == 1).sum())} cells, bridges {int((W == 2).sum())}')
else:
    log(f'NO WATER MASK at {WATER} — run scripts/harness/waterdump.mjs first'); sys.exit(1)
for b in meta.get('bridges', []):
    Db, Sb, Lb = polyline_field(X, Z, np.array([[b['x0'], b['z0']], [b['x1'], b['z1']]]), 12)
    FROZEN |= (Db < b['w'] / 2 + 3) & (Sb > -3) & (Sb < Lb + 3)
for li in CLIFF:
    FROZEN |= polyline_field(X, Z, LINES[li], 20)[0] < HW + 14
FROZEN = blur(FROZEN.astype(float), 1) > 0.01  # (a cell's margin)

def hs(A, x, z):
    fx = (x + HALF) / CELL; fz = (z + HALF) / CELL
    i = np.clip(np.floor(fx).astype(int), 0, N - 2); j = np.clip(np.floor(fz).astype(int), 0, N - 2)
    u = fx - i; v = fz - j
    return (A[j, i] * (1 - u) + A[j, i + 1] * u) * (1 - v) + (A[j + 1, i] * (1 - u) + A[j + 1, i + 1] * u) * v
def near(M, x, z):
    i = np.clip(np.round((x + HALF) / CELL).astype(int), 0, N - 1); j = np.clip(np.round((z + HALF) / CELL).astype(int), 0, N - 1)
    return M[j, i]

def box(a, r):
    if r < 1 or len(a) < 3: return a
    k = np.ones(2 * r + 1) / (2 * r + 1)
    return np.convolve(np.pad(a, r, mode='edge'), k, mode='same')[r:-r]

def clamp_grade(p, g, fixed):
    """Forward and back: no step steeper than g (m per 1 m), the fixed points kept. Between two fixed points that need
    more (a bridge's ramp top and another track's bed 70 m on, 28 m higher) that gap's limit is the grade it needs —
    spread evenly, never a jump at one end."""
    ga = np.full(len(p), g)
    idx = np.nonzero(fixed)[0]
    for a, b in zip(idx[:-1], idx[1:]):
        if b > a + 1: ga[a + 1:b + 1] = max(g, abs(p[b] - p[a]) / (b - a) * 1.02)
    for _ in range(3):
        for k in range(1, len(p)):
            if not fixed[k]: p[k] = min(max(p[k], p[k - 1] - ga[k]), p[k - 1] + ga[k])
        for k in range(len(p) - 2, -1, -1):
            if not fixed[k]: p[k] = min(max(p[k], p[k + 1] - ga[k + 1]), p[k + 1] + ga[k + 1])
    return p

def profile(h, g, pin, pinv):
    """The grade-limited profile closest to h (1 m samples): the mean of the two Lipschitz envelopes, smoothed; the
    pinned samples (a junction's bed) held, their difference eased along, the grade re-clamped."""
    hp = np.where(pin, pinv, h)
    U = hp.copy(); L = hp.copy()
    for k in range(1, len(h)): U[k] = min(U[k], U[k - 1] + g); L[k] = max(L[k], L[k - 1] - g)
    for k in range(len(h) - 2, -1, -1): U[k] = min(U[k], U[k + 1] + g); L[k] = max(L[k], L[k + 1] - g)
    p = box(box((U + L) / 2, 5), 5)
    if pin.any():
        idx = np.nonzero(pin)[0]
        c = pinv[idx] - p[idx]
        s = np.arange(len(h), dtype=float)
        corr = np.interp(s, idx, c)
        # (past the first / last pin the difference fades out at half the grade budget, ≥ 15 m)
        a, b = idx[0], idx[-1]
        La = max(15.0, abs(c[0]) / (0.5 * g)); Lb = max(15.0, abs(c[-1]) / (0.5 * g))
        corr[:a] = c[0] * np.clip(1 - (a - s[:a]) / La, 0, 1)
        corr[b + 1:] = c[-1] * np.clip(1 - (s[b + 1:] - b) / Lb, 0, 1)
        p = p + corr
    return clamp_grade(p, g, pin)

# the order: ordinary tracks first (longest first), then the rock-crawl routes; the cliff's two left as they are
order = sorted([i for i in range(NL) if i not in CLIFF and i not in ROUGH], key=lambda i: -len(LINES[i])) + \
        sorted([i for i in ROUGH if i not in CLIFF], key=lambda i: -len(LINES[i]))
BED = np.zeros((N, N), bool)    # (graded beds: LOCKED — a later track's banks never tilt them; it joins them level)
report = []
DBG = {}
DROP = set()
for li in order:
    T = resample(LINES[li], 1.0)
    if len(T) < 6: continue
    g = GR if li in ROUGH else G
    h = hs(H, T[:, 0], T[:, 1])
    fz = near(FROZEN, T[:, 0], T[:, 1])
    # pins: a frozen stretch keeps its ground; where this bed TOUCHES one already graded (a junction, a shared stretch,
    # two tracks side by side a few metres apart — else a ledge between them) it takes that bed's height
    i0 = max(0, int((T[:, 0].min() + HALF) / CELL) - 8); i1 = min(N, int((T[:, 0].max() + HALF) / CELL) + 9)
    j0 = max(0, int((T[:, 1].min() + HALF) / CELL) - 8); j1 = min(N, int((T[:, 1].max() + HALF) / CELL) + 9)
    sub = BED[j0:j1, i0:i1]
    pinv = h.copy()
    onbed = np.zeros(len(T), bool)
    if sub.any():
        dist, (jj, ii) = distance_transform_edt(~sub, return_indices=True)
        ci = np.clip(np.round((T[:, 0] + HALF) / CELL).astype(int) - i0, 0, i1 - i0 - 1)
        cj = np.clip(np.round((T[:, 1] + HALF) / CELL).astype(int) - j0, 0, j1 - j0 - 1)
        onbed = dist[cj, ci] * CELL < HW + 0.5
        pinv = np.where(onbed, H[j0 + jj[cj, ci], i0 + ii[cj, ci]], h)
    pin = fz | onbed
    # a REDUNDANT line — lying on other tracks' beds for most of its length and crossing between two of them at
    # different heights (a ledge no profile can take: inside a formation, three routes in one gap) — dropped
    jump = float(np.abs(np.diff(pinv[onbed])).max()) if onbed.sum() > 1 else 0.0
    if onbed.mean() > 0.75 and (jump > 0.6 or pin.all()) and li not in CLIFF:
        DROP.add(li); continue
    if pin.all(): continue
    p = profile(h, g, pin, pinv)
    cut = float(np.abs(p - h).max())
    # the cross-section, over the cells within reach
    reach = HW + 14
    D, S, Ltot = polyline_field(X, Z, T, reach)
    m = D < reach
    ss = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(T, axis=0).T))])  # (the arc length polyline_field measures S in)
    P = np.interp(S[m], ss, p)
    dl = np.interp(S[m], ss, p - h)  # (the profile's change at the centre line: the cut (< 0) or the fill)
    Hm = H[m]
    Dm = D[m]
    # the bed level across (the old 12 cm dip in the middle kept); past its edge the ground as it was, SHIFTED by the
    # cut / fill and that shift fading out over max(3 m, 1.2 × it) — a hillside beside the road stays a hillside,
    # the bank between the bed and it eased over 3 m
    shifted = Hm + dl * (1 - smoothstep(HW, HW + np.clip(1.2 * np.abs(dl), 3, 12), Dm))
    level = P - 0.12 * (1 - smoothstep(0, HW, Dm))
    target = level + (shifted - level) * smoothstep(HW + 0.3, HW + 3.3, Dm)
    w = np.where(FROZEN[m] | BED[m], 0.0, 1.0)  # (another track's graded bed: locked; water, bridges: never)
    Hn = Hm + (target - Hm) * w
    H[m] = Hn
    bed = np.zeros((N, N), bool); bed[m] = (Dm < HW + 0.5) & (w > 0.5)
    BED |= bed
    report.append((li, li in ROUGH, len(T), round(cut, 1), int(pin.sum())))
    if 'DEBUG' in ARGS: DBG[f'l{li}'] = np.stack([T[:, 0], T[:, 1], h, p, pin.astype(float), fz.astype(float)])
log(f'graded {len(report)} tracks; the deepest cut / fill per track (m): ' + ', '.join(f'{li}{"R" if r else ""}:{c}' for li, r, n, c, _ in report if c > 1.5))

log(f'ground moved: {int((np.abs(H - H0) > 0.05).sum() * CELL * CELL / 1e4)} ha, the most {np.abs(H - H0).max():.1f} m')

# far.bin: the box's 16 m cells moved by the same amount
HF = HF0.copy()
k = int(round(CF / CELL))
i0 = int(round((HF_HALF - HALF) / CF))
dF = (H - H0)[::k, ::k]
HF[i0:i0 + dF.shape[0], i0:i0 + dF.shape[1]] += dF

def u16(A):
    lo, hi = float(A.min()), float(A.max())
    return np.round((A - lo) / (hi - lo) * 65535).astype('<u2'), lo, hi - lo
q, mn, rg = u16(H)
q.tofile(os.path.join(OUT, 'height.bin'))
# trail.bin (the paint: distance to the nearest centre line, 0..8 m) from the new lines; what was painted but belongs to
# no line (the bridges' decks, the landmarks' pads) kept as it was
TB = np.fromfile(os.path.join(BASE, 'trail.bin'), np.uint8).reshape(N, N)
Dold = np.full((N, N), 99.0); Dnew = np.full((N, N), 99.0)
for l in TR['lines']:
    if len(l) > 1: Dold = np.minimum(Dold, polyline_field(X, Z, np.array(l, float), 9)[0])
for i, l in enumerate(LINES):
    if len(l) > 1 and i not in DROP: Dnew = np.minimum(Dnew, polyline_field(X, Z, l, 9)[0])
other = (TB < 255) & (TB / 255 * 8 + 1.0 < Dold)
TRAIL = np.where(other, TB, np.round(np.clip(Dnew / 8, 0, 1) * 255)).astype(np.uint8)
TRAIL.tofile(os.path.join(OUT, 'trail.bin'))
log(f'trail.bin: {int((np.abs(TRAIL.astype(int) - TB) > 8).sum() * CELL * CELL / 1e4 * 100) / 100} ha repainted')
qf, mnf, rgf = u16(HF)
qf.tofile(os.path.join(OUT, 'far.bin'))
out = json.load(open(os.path.join(OUT, 'meta.json')))
out['inner'].update(min=mn, range=rg)
out['far'].update(min=mnf, range=rgf)
keep_i = [i for i in range(NL) if i not in DROP]
out['trails']['lines'] = [[[round(float(a), 1), round(float(b), 1)] for a, b in LINES[i]] for i in keep_i]
out['trails']['rough'] = [keep_i.index(i) for i in sorted(ROUGH) if i in keep_i]
log(f'redundant lines dropped: {sorted(DROP)}')
# scenery.mjs's stream-road WALLS: a boulder that landed IN another track (where two cross: its bulk — ~0.2 of its
# size past its centre — inside the bed) goes; the walls lining a road's edge stay
segs = np.concatenate([np.stack([l[:-1], l[1:]], 1) for i, l in enumerate(LINES) if len(l) > 1 and i not in DROP])
def line_dist(x, z):
    a, b = segs[:, 0], segs[:, 1]; ab = b - a; l2 = (ab * ab).sum(1) + 1e-9
    t = np.clip(((x - a[:, 0]) * ab[:, 0] + (z - a[:, 1]) * ab[:, 1]) / l2, 0, 1)
    return float(np.hypot(x - a[:, 0] - t * ab[:, 0], z - a[:, 1] - t * ab[:, 1]).min())
bo = meta.get('scenery', {}).get('boulders', [])  # (the base copy's: run after run the same)
keep = [b for b in bo if line_dist(b[0], b[1]) > HW + 0.3 * b[2]]
if bo: out['scenery']['boulders'] = keep
log(f'boulders on a track: {len(bo) - len(keep)} taken off')
json.dump(out, open(os.path.join(OUT, 'meta.json'), 'w'))
log(f'wrote {OUT}')
if 'DEBUG' in ARGS: np.savez(ARGS['DEBUG'], **DBG)
