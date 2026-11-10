# OVER THE HILL — THE OUTLAND: the country round the valley, made to be driven (2026-11-10, the user: "make all playable,
# just restrict the last 2 km … 10 to 12 km"; "more peaks, lots of mountain ranges, like Over the Hill"; "bridges
# between big cliffs"; "ranger towers on the hills").
#
#   python3 scripts/oth/outland.py [OUT=public/oth/valley] [PREVIEW=<dir>] [SEED=7] [WRITE=0]
#
# A post-process over the valley's baked files (after terrain.py → valley_cliff.py → trackgrade.py …). It always starts
# from the copy of them in scripts/oth/.cache/valley-preoutland (made on the first run), so it can be run again.
# The 4 km box is NOT touched (its 2 m grid, tracks, places, caves, the server's ground edits). What changes is the
# WORLD's grid, far.bin — where `MapData.height()` answers outside the box:
#   - 16 m → 8 m (2049², the box's own size on disk): fine enough to drive on a smooth, low-poly land;
#   - re-shaped beyond the box (the old world kept for 250 m past the box's edge — the box's rim was blended to it —
#     then eased into the new one by 1.1 km): a rolling UPLAND cut by a net of open VALLEYS (the ways through), RANGES
#     standing between them — some low, some to ~1 500 m — sharp PEAKS along their crests, rock TERRACES on the steep
#     flanks, and a few narrow GORGES through the plateaus (what the bridges will span). The last 2 km (beyond ±6144,
#     MapData.play) sinks away into lower ranges, as before: the fog's country.
# Writes far.bin and meta.json (`far`, and `outland`: the peaks — x, z, height — and the gorges' lines, for the towers,
# the tracks and the bridges that follow).
import sys, os, json, time, shutil, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrainlib import gnoise, fbm, ridged, smoothstep, blur, bilinear

ARGS = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/valley')
PREVIEW = ARGS.get('PREVIEW')
SEED = int(ARGS.get('SEED', 7))
T0 = time.time()
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'valley-preoutland')
FILES = ['meta.json', 'far.bin']
os.makedirs(BASE, exist_ok=True)
for f in FILES:
    if not os.path.exists(os.path.join(BASE, f)):
        shutil.copyfile(os.path.join(OUT, f), os.path.join(BASE, f)); log(f'base copy of {f} saved to {BASE}')
meta = json.load(open(os.path.join(BASE, 'meta.json')))
gi, gf = meta['inner'], meta['far']
N, CELL, HALF = gi['n'], gi['step'], -gi['origin']
NF0, CF0, FAR_HALF = gf['n'], gf['step'], -gf['origin']
# (the box as the game has it NOW — graded tracks, ground edits baked since: the world's cells under it follow it)
gin = json.load(open(os.path.join(OUT, 'meta.json')))['inner']
HI = np.fromfile(os.path.join(OUT, 'height.bin'), '<u2').reshape(N, N).astype(np.float64) / 65535 * gin['range'] + gin['min']
HF0 = np.fromfile(os.path.join(BASE, 'far.bin'), '<u2').reshape(NF0, NF0).astype(np.float64) / 65535 * gf['range'] + gf['min']
PLAY = FAR_HALF - 2048.0                    # (MapData.play)
CF = 8.0; NF = int(round(2 * FAR_HALF / CF)) + 1
xs = np.linspace(-FAR_HALF, FAR_HALF, NF)
X, Z = np.meshgrid(xs, xs)
OLD = bilinear(HF0, FAR_HALF, X, Z)          # the old world at 8 m (bilinear: its 16 m facets smoothed below)
OLD = blur(OLD, 1)
log(f'world {NF}² at {CF:.0f} m; the old one {HF0.min():.0f}..{HF0.max():.0f} m')

# ------------------------------------------------------------------------------------------------- the new land
# (warped coordinates: nothing runs straight)
wx = X + 520 * fbm(X / 3900, Z / 3900, SEED + 11, 3) + 110 * fbm(X / 800, Z / 800, SEED + 13, 2)
wz = Z + 520 * fbm(X / 3900 + 5.2, Z / 3900 + 1.3, SEED + 12, 3) + 110 * fbm(X / 800 + 2.7, Z / 800, SEED + 14, 2)
# the UPLAND: rolling, 170–330 m
up = 240 + 80 * fbm(wx / 1900, wz / 1900, SEED + 1, 3, gain=0.45) + 22 * fbm(wx / 520, wz / 520, SEED + 2, 2, gain=0.4)
# the VALLEYS: where two slow noises cross zero — a connected net of open floors ~350–500 m wide, the ways through
v1 = np.abs(gnoise(wx / 3300, wz / 3300, SEED + 21)); v2 = np.abs(gnoise(wx / 2500 + 9.1, wz / 2500 - 4.3, SEED + 22))
vnet = np.minimum(v1, v2 * 1.25)
vnet = np.clip(vnet * (1 + 0.45 * fbm(wx / 900, wz / 900, SEED + 23, 3)) + 0.03 * fbm(wx / 420, wz / 420, SEED + 24, 2), 0, None)   # (the flanks uneven: spurs and side valleys, not one even ramp round each massif)
floor = 1 - smoothstep(0.03, 0.2, vnet)                       # 1 on a valley's floor
flank = smoothstep(0.03, 0.7, vnet) ** 1.25                   # 0 in the valley → 1 where the ranges may stand (a long rise: foothills, not a wall)
# the RANGES: ridged crests between the valleys; how tall, a slow field — low wooded ranges here, giants there
rid = ridged(wx / 2300, wz / 2300, SEED + 3, 5) ** 1.5
amp = 520 + 1000 * smoothstep(-0.35, 0.45, fbm(wx / 5600 + 2.2, wz / 5600 - 0.7, SEED + 5, 2))
rng = flank * amp * (0.08 + 0.92 * rid)
# the PEAKS: horns along the crests — one a ~1.1 km cell, jittered, only where a range stands
rs = np.random.RandomState(SEED)
peaks = np.zeros_like(X); PEAKS = []
PC = 820.0
for cj in range(int(-FAR_HALF // PC), int(FAR_HALF // PC) + 1):
    for ci in range(int(-FAR_HALF // PC), int(FAR_HALF // PC) + 1):
        px, pz = (ci + 0.15 + 0.7 * rs.rand()) * PC, (cj + 0.15 + 0.7 * rs.rand()) * PC
        hp, rp, sk = 110 + 300 * rs.rand() ** 1.6, 260 + 300 * rs.rand(), rs.rand() * math.pi
        if max(abs(px), abs(pz)) < HALF + 700 or max(abs(px), abs(pz)) > FAR_HALF - 300: continue
        i, j = int(round((px + FAR_HALF) / CF)), int(round((pz + FAR_HALF) / CF))
        if rng[j, i] < 150: continue                                         # (no range under it: no horn)
        r = int(rp / CF) + 2
        i0, i1, j0, j1 = max(0, i - r), min(NF, i + r + 1), max(0, j - r), min(NF, j + r + 1)
        dx, dz = X[j0:j1, i0:i1] - px, Z[j0:j1, i0:i1] - pz
        # (a horn is not a cone: longer one way than the other, its flanks a little ribbed)
        c, s = math.cos(sk), math.sin(sk)
        d = np.hypot((dx * c + dz * s) * 0.78, (-dx * s + dz * c) * 1.25) / rp
        d = d * (1 + 0.16 * gnoise(dx / 170 + px, dz / 170 + pz, SEED + 31))
        peaks[j0:j1, i0:i1] = np.maximum(peaks[j0:j1, i0:i1], hp * np.clip(1 - d, 0, 1) ** 1.45)
        PEAKS.append((px, pz))
new = up * (1 - 0.45 * floor) + rng + peaks * smoothstep(0.1, 0.5, vnet)
new = new + 14 * fbm(wx / 300, wz / 300, SEED + 4, 2) * smoothstep(250, 500, rng)       # (a little life on the high flanks)
# rock TERRACES on the steep high flanks: the slope gathered into bands — cliffs with benches between (what the eye
# reads as rock strata, and what a track can run along)
gz, gx = np.gradient(new, CF); sl = np.hypot(gx, gz)
ter = smoothstep(0.5, 0.85, sl) * smoothstep(380, 560, new)
STEP = 46.0
q = new / STEP; f = q - np.floor(q)
band = (np.floor(q) + smoothstep(0.28, 0.72, f)) * STEP
new = new + (band - new) * 0.4 * blur(ter, 3)
# the GORGES: narrow cuts through the plateaus (not the high ranges, not the valley floors) — steep-sided, 35–70 m deep
g0 = gnoise(wx / 2300 + 31.7, wz / 2300 + 12.9, SEED + 41)
ggz, ggx = np.gradient(g0, CF)
# (its distance from the gorge's centre line, in METRES — the noise over its own slope: walls of the same width everywhere)
gd = np.abs(g0) / np.maximum(np.hypot(ggx, ggz), 2e-5)
gmask = smoothstep(260, 320, new) * (1 - smoothstep(470, 600, new)) * (1 - floor)
gdepth = (38 + 34 * (0.5 + 0.5 * fbm(wx / 1500, wz / 1500, SEED + 42, 2))) * gmask
# CLIFFS, not a soft V (the first cut — a smoothstep of the noise, then the land's smoothing — came out a grassy 45°
# valley): a flat floor 26 m wide, walls that fall their 40–70 m in 10 m (as steep as an 8 m grid holds), cut AFTER
# the smoothing
gorge = (1 - smoothstep(13, 23, gd)) * gdepth
new = blur(new, 1)                                                        # (smooth: no single-cell kinks under a wheel)
new = new - gorge
# beyond the playable land: settle into lower ranges (no wall at the world's edge)
edge = np.maximum(np.abs(X), np.abs(Z))
new = new - 420 * smoothstep(PLAY + 60, FAR_HALF, edge)
log(f'new land {new.min():.0f}..{new.max():.0f} m, {len(PEAKS)} horns')

# ------------------------------------------------------------------------------------------- joined to the valley
# the old world for 250 m past the box's edge (the box's rim was blended to it), eased into the new by 1.1 km
w = smoothstep(HALF + 250, HALF + 1100, edge)
H = OLD * (1 - w) + new * w
# … and the box's own cells: the box's heights (as the game has them now)
k = int(round(CF / CELL)); i0 = int(round((FAR_HALF - HALF) / CF)); sub = HI[::k, ::k]
H[i0:i0 + sub.shape[0], i0:i0 + sub.shape[1]] = sub

# what the land is, inside the playable part and outside the box
play = (edge < PLAY) & (edge > HALF)
gz, gx = np.gradient(H, CF); sl = np.degrees(np.arctan(np.hypot(gx, gz)))
log(f'the outland (the playable land outside the box, {play.sum() * CF * CF / 1e6:.0f} km²): {H[play].min():.0f}..{H[play].max():.0f} m; steeper than 30°: {(sl[play] > 30).mean() * 100:.0f} %, than 40°: {(sl[play] > 40).mean() * 100:.0f} %; under 15°: {(sl[play] < 15).mean() * 100:.0f} %')

# the peaks as they stand (the top within 200 m of each horn), the highest first; the gorges' cells (for the bridges)
tops = []
for px, pz in PEAKS:
    if max(abs(px), abs(pz)) > PLAY - 250: continue
    i, j = int(round((px + FAR_HALF) / CF)), int(round((pz + FAR_HALF) / CF)); r = 25
    win = H[j - r:j + r + 1, i - r:i + r + 1]; jj, ii = np.unravel_index(np.argmax(win), win.shape)
    tops.append((round(float(xs[i - r + ii]), 1), round(float(xs[j - r + jj]), 1), round(float(win.max()), 1)))
tops = sorted(set(tops), key=lambda t: -t[2])
log(f'{len(tops)} peaks in the playable land, the highest {tops[0][2]:.0f} m; over 1 000 m: {sum(1 for t in tops if t[2] > 1000)}')

# ------------------------------------------------------------------------------------------- RANGER TOWERS
# (the user: "also add some ranger tower in hills") on hilltops a car can reach: a top of the land smoothed over 40 m
# that stands ≥ 25 m over its surroundings, 280–820 m up, its summit gentle, joined to the valleys by ground no
# steeper than 24° (flooded from the largest such piece of the land); the most prominent first, ≥ 1.4 km apart.
from scipy import ndimage as nd
Hs = blur(H, 5)
okr = (sl[::2, ::2] <= 27) & (edge[::2, ::2] < PLAY - 60)
lab, _ = nd.label(okr); big = np.argmax(np.bincount(lab.ravel())[1:]) + 1
reach = nd.binary_dilation(lab == big, iterations=3)                       # (16 m cells; 48 m of grace round it)
prom = Hs - blur(Hs, 40)
top = (Hs >= nd.maximum_filter(Hs, size=61) - 1e-6) & (prom > 16) & (Hs > 280) & (Hs < 820) & (edge > HALF + 300) & (edge < PLAY - 220)
sl_s = blur(sl, 3)
cands = []
for j, i in zip(*np.nonzero(top)):
    if not reach[j // 2, i // 2] or sl_s[j, i] > 17: continue
    cands.append((float(prom[j, i]), i, j))
NAMES = ['Granite Watch', 'Windy Gap Tower', 'Stag Ridge Lookout', 'Far Country Tower', 'Hawk\'s Rest', 'Cinder Top Lookout', 'Lonesome Tower', 'High Meadow Watch',
         'Thunder Knob Tower', 'Three Valleys Lookout', 'Bear Shoulder Tower', 'Sundown Watch', 'Old Burn Lookout', 'Kestrel Tower']
TOWERS = []
for pr, i, j in sorted(cands, reverse=True):
    x, z = float(xs[i]), float(xs[j])
    if any(math.hypot(x - t['x'], z - t['z']) < 1400 for t in TOWERS) or len(TOWERS) >= len(NAMES): continue
    # its pad: level for 20 m round it, eased out by 44 m
    r = 7; win = (slice(j - r, j + r + 1), slice(i - r, i + r + 1))
    d = np.hypot(X[win] - x, Z[win] - z); hc = float(H[win][d < 16].mean())
    H[win] = H[win] + (hc - H[win]) * (1 - smoothstep(20, 44, d))
    TOWERS.append({'id': 300 + len(TOWERS), 'kind': 'tower', 'name': NAMES[len(TOWERS)], 'x': round(x, 1), 'z': round(z, 1), 'y': round(hc, 2),
                   'rot': round(math.atan2(-x, -z), 3), 'r': 6, 'outland': True})
log(f'{len(TOWERS)} ranger towers (of {len(cands)} reachable tops): ' + ', '.join(f"{t['name']} {t['y']:.0f} m" for t in TOWERS))

# ------------------------------------------------------------------------------------------- BRIDGES OVER THE GORGES
# (the user: "bridges between big cliffs at some random places, not just over water") where a gorge is narrow and its
# two rims level with each other: from a cell on the gorge's centre line, out both ways across it (the cut's own
# gradient) to where the cut ends; a span of 24–90 m, the rims within 12 % of it of each other, ≥ 15 m of air under
# the middle, the ground beyond each end no steeper than 20°. ≥ 900 m apart.
cut = gorge * w                                                             # (the cut as it stands in the joined land)
line = (gd < 5) & (cut > 30) & (edge < PLAY - 200) & (edge > HALF + 400)
hat = lambda x, z: float(bilinear(H, FAR_HALF, np.array([x]), np.array([z]))[0])
cat = lambda x, z: float(bilinear(cut, FAR_HALF, np.array([x]), np.array([z]))[0])
BRIDGES = []
cells = list(zip(*np.nonzero(line))); rs.shuffle(cells)
for j, i in cells:
    if len(BRIDGES) >= 12: break
    x, z = float(xs[i]), float(xs[j]); g = np.array([ggx[j, i], ggz[j, i]]); n = float(np.hypot(*g))
    if n < 1e-9 or any(math.hypot(x - (b['x0'] + b['x1']) / 2, z - (b['z0'] + b['z1']) / 2) < 900 for b in BRIDGES): continue
    u = g / n; ends = []
    for sg in (-1, 1):
        t = 4.0
        while t < 70 and cat(x + sg * u[0] * t, z + sg * u[1] * t) > 0.8: t += 2.0
        ends.append(t + 5.0)                                                # (5 m onto the rim)
    L = ends[0] + ends[1]
    if not 24 <= L <= 90 or max(ends) >= 74: continue
    A = (x - u[0] * ends[0], z - u[1] * ends[0]); B = (x + u[0] * ends[1], z + u[1] * ends[1])
    ya, yb = hat(*A), hat(*B)
    if abs(ya - yb) > 0.12 * L: continue
    under = min(hat(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t) for t in (0.35, 0.5, 0.65))
    if min(ya, yb) - under < 15: continue
    if abs(hat(A[0] - u[0] * 20, A[1] - u[1] * 20) - ya) > 7.3 or abs(hat(B[0] + u[0] * 20, B[1] + u[1] * 20) - yb) > 7.3: continue
    BRIDGES.append({'x0': round(A[0], 2), 'z0': round(A[1], 2), 'x1': round(B[0], 2), 'z1': round(B[1], 2), 'y': round((ya + yb) / 2 + 0.3, 2), 'w': 6.6,
                    'y0': round(ya + 0.3, 2), 'y1': round(yb + 0.3, 2), 'outland': True, 'drop': round(min(ya, yb) - under, 1)})
log(f'{len(BRIDGES)} gorge bridges (of {len(cells)} centre-line cells): ' + ', '.join(f"{math.hypot(b['x1'] - b['x0'], b['z1'] - b['z0']):.0f} m over {b['drop']:.0f} m" for b in BRIDGES))

def u16(A):
    lo, hi = float(A.min()), float(A.max())
    return np.round((A - lo) / (hi - lo) * 65535).astype('<u2'), lo, hi - lo
qf, mn, rg = u16(H)
if ARGS.get('WRITE', '1') == '0': log('WRITE=0: nothing written')
else: qf.tofile(os.path.join(OUT, 'far.bin'))
m = json.load(open(os.path.join(OUT, 'meta.json')))
m['far'] = {'n': NF, 'step': CF, 'origin': -FAR_HALF, 'min': mn, 'range': rg}
m['outland'] = {'play': PLAY, 'peaks': [{'x': x, 'z': z, 'h': h} for x, z, h in tops]}
m['landmarks'] = [l for l in m['landmarks'] if not l.get('outland')] + TOWERS
# THE SPAWN (the user: "change where we spawn — the place must look more rocky"): on the track by EAGLE POINT, the rock
# hill in the box's north-east (its ledges round you, the valley below, the new ranges beyond) — the nearest point of a
# track 45–200 m from the view point, facing along it toward the view. The first spawn kept as `spawn0`.
ep = next(l for l in m['landmarks'] if l['name'] == 'Eagle Point')
best = None
for T in m['trails']['lines']:
    for k in range(1, len(T) - 1):
        d = math.hypot(T[k][0] - ep['x'], T[k][1] - ep['z'])
        if 45 < d < 200 and (best is None or d < best[0]):
            a_, b_ = (T[k], T[k + 1]) if math.hypot(T[k + 1][0] - ep['x'], T[k + 1][1] - ep['z']) < d else (T[k], T[k - 1])
            best = (d, T[k][0], T[k][1], math.atan2(-(b_[0] - a_[0]), -(b_[1] - a_[1])))
m.setdefault('spawn0', m['spawn'])
if best: m['spawn'] = {'x': best[1], 'z': best[2], 'yaw': round(best[3], 3)}; log(f"spawn: {m['spawn']} ({best[0]:.0f} m from Eagle Point); was {m['spawn0']}")
m['bridges'] = [b for b in m.get('bridges', []) if not b.get('outland')] + BRIDGES
if ARGS.get('WRITE', '1') != '0': json.dump(m, open(os.path.join(OUT, 'meta.json'), 'w'), separators=(',', ':'))
if ARGS.get('WRITE', '1') != '0': log(f'wrote {OUT}/far.bin ({NF}², {os.path.getsize(os.path.join(OUT, "far.bin")) / 1e6:.1f} MB) and meta.json')

if PREVIEW:
    from PIL import Image
    os.makedirs(PREVIEW, exist_ok=True)
    S = H[::2, ::2]; gz, gx = np.gradient(S, CF * 2)
    n = np.stack([-gx, np.ones_like(S), -gz], -1); n /= np.linalg.norm(n, axis=-1)[..., None]
    L = np.array([-0.5, 0.62, -0.6]); L = L / np.linalg.norm(L)
    sh = np.clip(n @ L, 0, 1) ** 0.8
    t = np.clip((S - 30) / 1400, 0, 1)[..., None]
    col = (np.array([0.42, 0.55, 0.3]) * (1 - t) + np.array([0.86, 0.84, 0.8]) * t)
    steep = smoothstep(0.55, 0.9, np.hypot(gx, gz))[..., None]
    col = col * (1 - steep) + np.array([0.5, 0.5, 0.52]) * steep
    img = (np.clip(col * (0.35 + 0.85 * sh[..., None]), 0, 1) * 255).astype(np.uint8)
    e2 = np.maximum(np.abs(X[::2, ::2]), np.abs(Z[::2, ::2]))
    for hv, c in ((HALF, (255, 255, 255)), (PLAY, (255, 80, 60))):
        img[np.abs(e2 - hv) < 14] = c
    for x, z, h in tops:
        i, j = int((x + FAR_HALF) / (CF * 2)), int((z + FAR_HALF) / (CF * 2)); img[j - 3:j + 4, i - 3:i + 4] = (255, 220, 40) if h > 1000 else (40, 40, 40)
    Image.fromarray(img).save(os.path.join(PREVIEW, 'outland.png')); log('preview written')
