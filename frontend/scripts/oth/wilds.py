# OVERHILL — THE WILDS: the outland given places worth the drive, and roads to all of them (2026-11-11, the user: "we
# unlocked the rest of the map but did not add anything there — add peaks and off-road places like in a real world, a
# small early-snow shader at some place, and a world tree; dig paths to all places and connect all"; "Dirt Rally like
# places … natural beautiful places … adventure and natural beauty mixed").
#
#   python3 scripts/oth/wilds.py [OUT=public/oth/valley] [PREVIEW=<dir>] [WRITE=0] [SEED=3]
#
# A post-process AFTER outland.py (which made the ranges, the gorges, the ranger towers and the gorge bridges). It
# always starts from the copy of the map's files in scripts/oth/.cache/valley-prewilds (made on the first run — delete
# it after re-running outland.py or anything else that rewrites far.bin / height.bin / meta.json), so it can be run
# again. What it does:
#   THE PLACES (meta.outland.places — drawn by src/oth/Wonders.ts; the land under each shaped here):
#     - WHITECROWN: the highest massif — its summit sharpened, the EARLY SNOW's country (meta.outland.snow: the ground
#       shader lowers the snow line round it), a PASS over the col beside it;
#     - THE WORLD TREE: a knoll with root ridges in the broadest quiet basin, a ring road round the trunk;
#     - THE SUNKEN MEADOW: a crater — a rim ridge round a flat floor, one breach the road comes in by;
#     - TABLE ROCK: a mesa — an 80 m cliff all round, a ramp road winding up its side to the top;
#     - the GIANT'S GATE: a stone arch the road runs THROUGH (placed on a road, after the roads are made);
#     - a VIEW on the shoulder of each great peak a road can climb to (the highest gentle ground the search reaches).
#     - (later the same day — "do the things in the Not done list") MORE PEAKS (a horn on each high crest that had none);
#       LAKES (meta.outland.lakes: a pool in the crater, three on the valleys' floors, a tarn under Whitecrown);
#       the HIGH LINES — a road to Whitecrown's PASS and to whatever else the search can't reach (a gorge bridge on
#       its plateau), each a grade line traced down from the place; the STAGES (meta.outland.stages: the roads worth a
#       run against the clock).
#   THE ROADS (meta.outland.trails — gravel roads, their half width `hw`): a cost-distance search over the land at 16 m
#     (32 headings; no step steeper than 17 % along the road; climbing and the hillside's lean cost; a hairpin costs
#     300 m of road and needs ground under 27° to turn on — see SWITCHBACKS below),
#     grown from the valley's own tracks out to every ranger tower, both ends of every gorge bridge and every place
#     above — the nearest first, each new road joining what is already there; then a few LOOPS closed where two
#     places stand near each other but far apart by road. Each line smoothed and resampled every 8 m.
#   THE GROUND UNDER THEM, "dug": each road's own profile (the ground's, smoothed, never steeper than G) and a level bed
#     — in the world's 8 m grid a bed 9 m to each side eased out by 26 m; inside the valley's box (its 2 m grid,
#     height.bin: the stretch from its tracks to its edge) 3 m to each side eased out by 9 m.
#   (2026-11-11, later — the user: "the map we unlocked does not have proper collision on grounds … check all and fix":
#   the roads DRIVEN by the bot, scripts/harness/trackdrive.mjs SET=outland / SET=bridges, and what it found put right:)
#     - every line retraced by a car that can't turn tighter than 9 m (`drivable`), a switchback's legs kept 30 m apart
#       (`spread_legs`), a level 18 m pad at each hairpin, the profile flat through it;
#     - the dig: each cell takes its NEAREST road point's height, a bed once dug is LOCKED (a later road's banks went
#       through an earlier road's bed), a road within 22 m of a dug bed takes its height, each end lands level and
#       exactly on what it meets (a bridge's deck, a tower's pad, the road it joins);
#     - the gorge BRIDGES carried 10 m onto the land at both ends, the ground under each deck kept under its planks,
#       no spur at a bridge's far end, a road of its own side to every far end the land gives a way from (else a pad);
#     - a traced high line stops at a gorge, joins a road only where it meets it level; loop roads laid beside a road
#       that is already there are left out; a road setting out from a tower starts at its pad's edge.
# Writes far.bin, height.bin and meta.json (`bridges`: the outland's, lengthened; `outland`: peaks with names, snow,
# places, lakes, stages, trails).
import sys, os, json, time, shutil, math
import numpy as np
from scipy import ndimage as nd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrainlib import gnoise, fbm, smoothstep, blur, bilinear, resample, polyline_field

ARGS = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a)
OUT = ARGS.get('OUT', 'public/oth/valley')
PREVIEW = ARGS.get('PREVIEW')
SEED = int(ARGS.get('SEED', 3))
WRITE = ARGS.get('WRITE', '1') != '0'
T0 = time.time()
def log(*a): print(f'[{time.time() - T0:5.1f}s]', *a, flush=True)

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', 'valley-prewilds')
os.makedirs(BASE, exist_ok=True)
for f in ('meta.json', 'far.bin', 'height.bin'):
    if not os.path.exists(os.path.join(BASE, f)):
        shutil.copyfile(os.path.join(OUT, f), os.path.join(BASE, f)); log(f'base copy of {f} saved to {BASE}')
meta = json.load(open(os.path.join(BASE, 'meta.json')))
gi, gf = meta['inner'], meta['far']
N, CELL, HALF = gi['n'], gi['step'], -gi['origin']
NF, CF, FAR_HALF = gf['n'], gf['step'], -gf['origin']
PLAY = meta['outland']['play']
HI = np.fromfile(os.path.join(BASE, 'height.bin'), '<u2').reshape(N, N).astype(np.float64) / 65535 * gi['range'] + gi['min']
H = np.fromfile(os.path.join(BASE, 'far.bin'), '<u2').reshape(NF, NF).astype(np.float64) / 65535 * gf['range'] + gf['min']
MASK = np.fromfile(os.path.join(OUT, 'mask.bin'), np.uint8).reshape(meta['mask']['n'], meta['mask']['n'], 4)
xs = np.linspace(-FAR_HALF, FAR_HALF, NF)
X, Z = np.meshgrid(xs, xs)
EDGE = np.maximum(np.abs(X), np.abs(Z))
rs = np.random.RandomState(SEED)
def cell(x, z): return int(round((z + FAR_HALF) / CF)), int(round((x + FAR_HALF) / CF))            # → j, i
def hat(x, z): return float(bilinear(H, FAR_HALF, np.array([x]), np.array([z]))[0])
TOWERS = [l for l in meta['landmarks'] if l.get('outland')]
BRIDGES = [dict(b) for b in meta.get('bridges', []) if b.get('outland')]
# THE GORGE BRIDGES REACH ONTO THE LAND (2026-11-11): outland.py ended each deck ON its gorge's rim — the world's 8 m
# cells can't hold a clean edge there: the rim stood 0.2 m over the planks at one mouth, fell away under the last metres
# of road at another, and the car (the first ever driven over them on real ground: scripts/harness/trackdrive.mjs
# SET=bridges) rode up on it and rolled, a different bridge every run. Each deck is carried BRIDGE_EXT m further at both
# ends, along its own line and slope, onto ground that is level bed all round its lip; the ground under the whole deck
# is then kept just under its planks (below).
BRIDGE_EXT = 10.0
for b in BRIDGES:
    Lb = math.hypot(b['x1'] - b['x0'], b['z1'] - b['z0']); ux, uz, sy = (b['x1'] - b['x0']) / Lb, (b['z1'] - b['z0']) / Lb, (b['y1'] - b['y0']) / Lb
    b['x0'], b['z0'], b['y0'] = round(b['x0'] - ux * BRIDGE_EXT, 2), round(b['z0'] - uz * BRIDGE_EXT, 2), round(b['y0'] - sy * BRIDGE_EXT, 2)
    b['x1'], b['z1'], b['y1'] = round(b['x1'] + ux * BRIDGE_EXT, 2), round(b['z1'] + uz * BRIDGE_EXT, 2), round(b['y1'] + sy * BRIDGE_EXT, 2)
    b['y'] = round(max(b['y0'], b['y1']), 2)
PEAKS = [dict(p) for p in meta['outland']['peaks']]
log(f'world {NF}² at {CF:.0f} m, {H.min():.0f}..{H.max():.0f} m; {len(TOWERS)} towers, {len(BRIDGES)} gorge bridges, {len(PEAKS)} peaks')

# ================================================================================================== 1. THE PLACES
PLACES = []
def clear_of(x, z, r, places=1200.0):
    """A site's ground is its own: off the towers, the bridges, the other places, inside the playable land, off the box."""
    e = max(abs(x), abs(z))
    if e < HALF + 600 + r or e > PLAY - 420 - r: return False
    if any(math.hypot(x - t['x'], z - t['z']) < r + 420 for t in TOWERS): return False
    if any(math.hypot(x - (b['x0'] + b['x1']) / 2, z - (b['z0'] + b['z1']) / 2) < r + 300 for b in BRIDGES): return False
    return all(math.hypot(x - p['x'], z - p['z']) > r + p['r'] + places for p in PLACES)
def window(x, z, r):
    j, i = cell(x, z); k = int(r / CF) + 2
    sl = (slice(max(0, j - k), min(NF, j + k + 1)), slice(max(0, i - k), min(NF, i + k + 1)))
    return sl, np.hypot(X[sl] - x, Z[sl] - z), np.arctan2(Z[sl] - z, X[sl] - x)
# the land as a site sees it (32 m cells): its relief within ~500 m, its mean slope
S4 = H[::4, ::4]; X4, Z4 = X[::4, ::4], Z[::4, ::4]
REL = nd.maximum_filter(S4, size=13) - nd.minimum_filter(S4, size=13)                # (±190 m: this land is never flat for longer — the places level their own ground)
gz_, gx_ = np.gradient(blur(H, 2), CF); SLOPE = np.hypot(gx_, gz_)

# ---- WHITECROWN: the highest massif, sharpened; the early snow's country; named peaks
top = PEAKS[0]
SNOW = {'x': round(float(np.mean([p['x'] for p in PEAKS if math.hypot(p['x'] - top['x'], p['z'] - top['z']) < 1600])), 1),
        'z': round(float(np.mean([p['z'] for p in PEAKS if math.hypot(p['x'] - top['x'], p['z'] - top['z']) < 1600])), 1), 'r': 2300.0, 'line': 450.0}
sl, d, _ = window(top['x'], top['z'], 520)
horn = 125 * np.clip(1 - d / 520, 0, 1) ** 1.7 * (1 + 0.18 * gnoise(X[sl] / 140, Z[sl] / 140, SEED + 5))
H[sl] += horn
top['h'] = round(float(H[sl].max()), 1)
# MORE PEAKS (the user: "add peaks"): a horn on every high crest that had none — the land's own tops (the highest point
# of the land smoothed over ~50 m within 240 m), over 400 m, 700 m clear of the other peaks, off the towers and the
# bridges; each 95–175 m of horn, never over Whitecrown
NAMED = {(p['x'], p['z']): nm for p, nm in zip(PEAKS, ['Whitecrown', 'The Sentinel', 'Old Grey', 'Storm King', 'Frostfang', 'Sunrise Horn', 'Raven Peak', 'The Anvil Head', 'Cloud Rest', 'Lone Wolf Peak', 'Thunderhead', 'Eagle Spire'])}
Hb6 = blur(H, 6)
cand = (Hb6 >= nd.maximum_filter(Hb6, size=61) - 1e-6) & (Hb6 > 400) & (EDGE > HALF + 700) & (EDGE < PLAY - 450)
NEW_PEAKS = []
for j, i in sorted(zip(*np.nonzero(cand)), key=lambda q: -Hb6[q]):
    x, z = float(xs[i]), float(xs[j])
    if any(math.hypot(x - q['x'], z - q['z']) < 700 for q in PEAKS + NEW_PEAKS): continue
    if any(math.hypot(x - t['x'], z - t['z']) < 560 for t in TOWERS) or any(math.hypot(x - (b['x0'] + b['x1']) / 2, z - (b['z0'] + b['z1']) / 2) < 520 for b in BRIDGES): continue
    hp, rp, sk = 95 + 80 * rs.rand(), 300 + 130 * rs.rand(), rs.rand() * math.pi
    hp = min(hp, top['h'] - 70 - float(H[j, i]))
    if hp < 60: continue
    sl, d, _ = window(x, z, rp * 1.35)
    dx, dz = X[sl] - x, Z[sl] - z; c_, s_ = math.cos(sk), math.sin(sk)
    dd = np.hypot((dx * c_ + dz * s_) * 0.8, (-dx * s_ + dz * c_) * 1.22) / rp
    dd = dd * (1 + 0.16 * gnoise(dx / 150 + x, dz / 150 + z, SEED + 61))
    H[sl] += hp * np.clip(1 - dd, 0, 1) ** 1.5
    NEW_PEAKS.append({'x': x, 'z': z, 'h': round(float(H[sl].max()), 1)})
    if len(NEW_PEAKS) >= int(ARGS.get('PEAKS', 8)): break
NEW_NAMES = ['The Gendarme', 'Hollow Crown', 'Kite Peak', 'The Twins', 'Marmot Dome', 'Iron Tooth', 'Shepherd Peak', 'Last Light', 'The Capstan', 'Windbreak']
for q, nm in zip(NEW_PEAKS, NEW_NAMES): NAMED[(q['x'], q['z'])] = nm
PEAKS = sorted(PEAKS + NEW_PEAKS, key=lambda q: -q['h'])
for q in PEAKS:
    if (q['x'], q['z']) in NAMED: q['name'] = NAMED[(q['x'], q['z'])]
log(f'{len(NEW_PEAKS)} new peaks: ' + ', '.join(f"{q['name']} {q['h']:.0f} m" for q in NEW_PEAKS) + f'; {len(PEAKS)} in all')
PLACES.append({'kind': 'peak', 'name': 'Whitecrown', 'x': top['x'], 'z': top['z'], 'y': top['h'], 'r': 300})
log(f"Whitecrown {top['h']:.0f} m at {top['x']:.0f}, {top['z']:.0f}; the early snow round {SNOW['x']:.0f}, {SNOW['z']:.0f} (r {SNOW['r']:.0f} m, from {SNOW['line']:.0f} m up)")

def pick(score, ok, r, far_from=None, far=0.0):
    """The best-scoring 32 m cell that is clear (the highest score first)."""
    order = np.argsort(-np.where(ok, score, -1e9).ravel())
    for k in order[:4000]:
        j, i = divmod(int(k), S4.shape[1])
        if not ok[j, i]: break
        x, z = float(X4[j, i]), float(Z4[j, i])
        if far_from and math.hypot(x - far_from[0], z - far_from[1]) < far: continue
        if clear_of(x, z, r): return x, z
    return None

# ---- THE WORLD TREE: the broadest quiet basin, far from the snow — a knoll, root ridges running out from the trunk
E4 = np.maximum(np.abs(X4), np.abs(Z4))
site = pick(-REL - 0.15 * S4, (S4 < 380) & (REL < 100), 520, (SNOW['x'], SNOW['z']), 5200)
assert site, 'no site for the World Tree'
wx_, wz_ = site
# (2026-11-11, later — the user: "a world tree … like a wonder": TREE_H 150 → 320 m: a trunk 66 m through at its foot,
#  a crown 400 m across — everything of its ground by TK = TREE_H / 150, Wonders.ts the same)
TREE_H = float(ARGS.get('TREE_H', 320)); TK = TREE_H / 150
sl, d, a = window(wx_, wz_, 900)
h0 = float(H[sl][d < 400].mean())
H[sl] += (h0 - H[sl]) * 0.8 * (1 - smoothstep(380, 900, d))                                         # the basin's floor evened
knoll = 52 * (0.5 + 0.5 * np.cos(np.pi * np.clip(d / 620, 0, 1)))                                    # a 52 m rise, 620 m round
roots = 11.0 * np.maximum(np.cos(a * 7 + 2.0 * np.sin(d / (70 * TK)) + 0.6), 0) ** 3 * smoothstep(14 * TK, 40 * TK, d) * (1 - smoothstep(60 * TK, 190 * TK, d))   # seven roots, winding
H[sl] += knoll + roots
ty = hat(wx_, wz_)
RING = 78 * TK                                                              # the ring road: outside the roots' ends
PLACES.append({'kind': 'worldtree', 'name': 'The World Tree', 'x': round(wx_, 1), 'z': round(wz_, 1), 'y': round(ty, 2), 'r': round(210 * TK), 'h': TREE_H, 'seed': SEED})
log(f'The World Tree at {wx_:.0f}, {wz_:.0f} ({ty:.0f} m): the land within 190 m had {REL[int((wz_ + FAR_HALF) / 32), int((wx_ + FAR_HALF) / 32)]:.0f} m of relief')

# ---- THE SUNKEN MEADOW: a crater on the upland — a rim, a flat floor, one breach
site = pick(-REL, (S4 > 230) & (S4 < 460) & (REL < 130), 480)
assert site, 'no site for the crater'
cx_, cz_ = site
sl, d, a = window(cx_, cz_, 520)
h0 = float(H[sl][d < 330].mean())
ring = H[sl][(d > 380) & (d < 520)]; ang_ring = a[(d > 380) & (d < 520)]
# (the breach faces the lowest ground outside the rim)
bins = np.linspace(-np.pi, np.pi, 25); low = [ring[(ang_ring >= bins[k]) & (ang_ring < bins[k + 1])].mean() for k in range(24)]
breach = float((bins[int(np.argmin(low))] + bins[int(np.argmin(low)) + 1]) / 2)
da = np.abs((a - breach + np.pi) % (2 * np.pi) - np.pi)
crest = h0 + (30 + 9 * np.sin(a * 3 + 1.0) + 6 * np.sin(a * 7)) * smoothstep(0.16, 0.42, da) - 6 * (1 - smoothstep(0.16, 0.42, da))
floor_ = h0 - 34
prof = floor_ + (crest - floor_) * smoothstep(175, 300, d) ** 1.25
w = 1 - smoothstep(300, 470, d)
H[sl] = H[sl] * (1 - w) + prof * w
PLACES.append({'kind': 'crater', 'name': 'The Sunken Meadow', 'x': round(cx_, 1), 'z': round(cz_, 1), 'y': round(floor_, 2), 'r': 300, 'floor': 175, 'breach': round(breach, 3)})
log(f'The Sunken Meadow at {cx_:.0f}, {cz_:.0f}: floor {floor_:.0f} m, rim ~{h0 + 30:.0f} m, the breach toward {math.degrees(breach):.0f}°')

# ---- TABLE ROCK: a mesa — cliffs all round, a ramp winding up its side
site = pick(-REL + 0.1 * S4, (S4 > 230) & (S4 < 470) & (REL < 140), 300)
assert site, 'no site for the mesa'
mx_, mz_ = site
MESA_R, MESA_H, RAMP_R, RAMP_W, RAMP_A = 150.0, 80.0, 196.0, 17.0, 1.3 * math.pi
sl, d, a = window(mx_, mz_, 330)
h0 = float(H[sl][d < 260].mean())
H[sl] += (h0 - H[sl]) * (1 - smoothstep(230, 330, d))                                               # its footing level
ring = H[sl][(d > 250) & (d < 330)]; ang_ring = a[(d > 250) & (d < 330)]
low = [ring[(ang_ring >= bins[k]) & (ang_ring < bins[k + 1])].mean() for k in range(24)]
th0 = float(bins[int(np.argmin(low))])                                                              # the ramp starts toward the lowest ground
t = ((a - th0) % (2 * np.pi)) / RAMP_A                                                              # 0 at its foot … 1 at the top
on = (t <= 1.0)
ramp = h0 + MESA_H * np.clip(t, 0, 1)
top_h = h0 + MESA_H + 2.0 * fbm(X[sl] / 90, Z[sl] / 90, SEED + 9, 2)
g0 = H[sl].copy()
lvl = np.where(on, ramp, g0)                                                                        # the level at the ramp's radius: the ramp, or the ground where there is none
inner = smoothstep(MESA_R, RAMP_R - RAMP_W, d)                                                       # the cliff from the top down to that level
outer = smoothstep(RAMP_R + RAMP_W, RAMP_R + RAMP_W + 26, d)                                         # the fill from the ramp down to the ground
shape = top_h * (1 - inner) + lvl * inner
H[sl] = shape * (1 - outer) + g0 * outer
MESA = {'x': mx_, 'z': mz_, 'h0': h0, 'th0': th0}
PLACES.append({'kind': 'mesa', 'name': 'Table Rock', 'x': round(mx_, 1), 'z': round(mz_, 1), 'y': round(h0 + MESA_H, 2), 'r': 240, 'top': MESA_R})
log(f'Table Rock at {mx_:.0f}, {mz_:.0f}: top {h0 + MESA_H:.0f} m ({MESA_H:.0f} m over its foot), the ramp {RAMP_R * RAMP_A:.0f} m long at {MESA_H / (RAMP_R * RAMP_A) * 100:.0f} %')

# ---- LAKES (the user: "water out there"): a bowl each, its water level with the lower part of its shore — a bank
# raised where the ground fell away below it (no water standing over its own edge), the bed eased down to `depth` in
# the middle. One in the crater's floor, three on the valleys' floors, a tarn up under Whitecrown.
LAKES = []
def bowl(x, z, R, depth, name):
    sl, d, a = window(x, z, R * 2.3)
    t = d / (R * (1 + 0.2 * np.sin(2 * a + 1.3 * len(LAKES)) + 0.09 * np.sin(5 * a + 0.7)))        # (its outline: not a circle)
    h0 = float(np.percentile(H[sl][(t > 0.95) & (t < 1.3)], 35))
    level = h0 - 0.45
    g = H[sl].copy()
    bank = np.clip(g, h0 + 0.3, h0 + 4.0)
    g = g + (bank - g) * (1 - smoothstep(1.3, 2.1, t)) * (g < h0 + 0.3) + (bank - g) * (1 - smoothstep(1.0, 1.35, t)) * (g > h0 + 4.0)
    bed = h0 + 0.3 - (depth + 0.75) * np.clip(1 - t * t, 0, 1) ** 0.9
    g = np.where(t < 1, bed, g)
    H[sl] = g
    LAKES.append({'name': name, 'x': round(x, 1), 'z': round(z, 1), 'r': round(R * 1.32, 1), 'level': round(level, 2), 'depth': depth})
    PLACES.append({'kind': 'lake', 'name': name, 'x': round(x, 1), 'z': round(z, 1), 'y': round(level, 2), 'r': round(R * 1.32, 1)})
    log(f'{name}: a lake at {x:.0f}, {z:.0f}, ~{2 * R:.0f} m across, its water at {level:.0f} m, {depth:.0f} m deep')
bowl(cx_ - 30 * math.cos(breach), cz_ - 30 * math.sin(breach), 88, 5.0, 'Mirror Pool')
# (the ROOT SPRING: a pool between two of the World Tree's roots, under its crown)
ar_ = (2 * math.pi * 2.5 - 0.6 - 2 * math.sin(42 / 70)) / 7
bowl(wx_ + 42 * TK * math.cos(ar_), wz_ + 42 * TK * math.sin(ar_), 24, 2.4, 'The Root Spring'); LAKES[-1]['small'] = True
for nm, R_ in (('Stillwater', 165), ('Heron Lake', 130), ('Long Mere', 150)):
    site = pick(-REL - 0.25 * S4, (S4 < 260) & (REL < 60), 300)
    if site: bowl(site[0], site[1], R_, 6.0, nm)
dsn4 = np.hypot(X4 - SNOW['x'], Z4 - SNOW['z'])
site = pick(S4 - 2.0 * REL, (dsn4 < 2250) & (S4 > 400) & (REL < 190), 200, None, 0.0)
if site: bowl(site[0], site[1], 78, 4.5, 'Frost Tarn')

# ---- SKYFALL CANYON (2026-11-11, the user: "amazing cliff views … huge cliffs and bridges in between"): ONE canyon several
# times the gorges' depth, cut into the highest quiet upland — 1.7 km long, winding, ~240 m from rim to rim and ~175 m
# deep in two tiers (a cliff, a bench, a second cliff), box-ended; EMERALD NARROWS, still water on its floor; SKYFALL,
# one sheer fall from its rim to the water (the bench cut away there); the HIGH BRIDGE, a hanging bridge across its
# narrowest place; an OVERLOOK on the rim facing the fall. No road goes down into it.
CANYON = None
best = None
for jc in range(0, S4.shape[0], 5):
    for ic in range(0, S4.shape[1], 5):
        x0, z0 = float(X4[jc, ic]), float(Z4[jc, ic])
        if not (HALF + 1300 < max(abs(x0), abs(z0)) < PLAY - 1500) or not 300 < S4[jc, ic] < 560: continue
        if math.hypot(x0 - SNOW['x'], z0 - SNOW['z']) < 2600: continue
        for th in np.arange(0, math.pi, math.pi / 6):
            ss = np.linspace(-850, 850, 28); off = 150 * np.sin(2 * math.pi * ss / 1500 + 0.7)
            lx = x0 + math.cos(th) * ss - math.sin(th) * off; lz = z0 + math.sin(th) * ss + math.cos(th) * off
            if any(math.hypot(lx[k] - t_['x'], lz[k] - t_['z']) < 520 for t_ in TOWERS for k in range(0, 28, 3)): continue
            if any(math.hypot(lx[k] - (b['x0'] + b['x1']) / 2, lz[k] - (b['z0'] + b['z1']) / 2) < 420 for b in BRIDGES for k in range(0, 28, 3)): continue
            if any(math.hypot(lx[k] - q['x'], lz[k] - q['z']) < q['r'] + 520 for q in PLACES for k in range(0, 28, 3)): continue
            hh = bilinear(H, FAR_HALF, lx, lz)
            sc = -float(hh.std()) + 0.04 * float(hh.mean())
            if hh.min() > 290 and (best is None or sc > best[0]): best = (sc, x0, z0, th)
if best:
    _, x0, z0, th = best
    ss = np.linspace(-850, 850, 86); off = 150 * np.sin(2 * math.pi * ss / 1500 + 0.7)
    CL = np.stack([x0 + math.cos(th) * ss - math.sin(th) * off, z0 + math.sin(th) * ss + math.cos(th) * off], 1)
    j, i = cell(x0, z0); r = 200
    sl = (slice(max(0, j - r), min(NF, j + r + 1)), slice(max(0, i - r), min(NF, i + r + 1)))
    D, Sa, Ltot = polyline_field(X[sl], Z[sl], CL, 700.0)
    S_BR, S_FALL = 0.62 * Ltot, 0.32 * Ltot                                   # where the bridge crosses; where the fall drops
    taper = np.sqrt(np.clip(1 - (np.clip(np.abs(Sa - Ltot / 2) - (Ltot / 2 - 230), 0, 230) / 230) ** 2, 0, 1))
    narrow = 1 - 0.36 * np.exp(-((Sa - S_BR) / 85.0) ** 2)
    wk = taper * narrow * (1 + 0.16 * fbm(X[sl] / 260, Z[sl] / 260, SEED + 71, 3))
    WF, CL1, BEN, CL2 = 46.0, 22.0, 34.0, 20.0
    near_fall = np.exp(-((Sa - S_FALL) / 60.0) ** 2)                           # (the bench cut away by the fall: one sheer wall)
    ben = BEN * (1 - 0.92 * near_fall)
    # (a TABLELAND first: the land within 300 m of its line brought most of the way to one height, eased out by 650 m —
    #  both rims level with each other: the first cut's rims stood 109 m apart in height, the bridge a 58 % ramp)
    hp = float(np.median(H[sl][D < 300]))
    H[sl] += (hp - H[sl]) * 0.9 * (1 - smoothstep(300, 650, D))
    g0 = H[sl].copy()
    h_ref = float(np.percentile(g0[D < 260], 12))
    floor_ = h_ref - 178.0; bench = h_ref - 80.0 + 7 * fbm(X[sl] / 180, Z[sl] / 180, SEED + 72, 2)
    rimtop = np.maximum(g0, bench + 26)
    t1 = smoothstep(WF * wk, (WF + CL1) * wk, D); t2 = smoothstep((WF + CL1) * wk + ben * wk, (WF + CL1 + CL2) * wk + ben * wk, D)
    cut = floor_ + (bench - floor_) * t1 + (rimtop - bench) * t2
    rimw = (WF + CL1 + CL2) * wk + ben * wk
    inside = (D < rimw) & (taper > 0.02)
    H[sl] = np.where(inside, np.minimum(cut, g0), g0)
    level = floor_ + 15.0
    # (the water is the canyon's: any other ground inside the lake's reach that lies under its level is banked up over it)
    # (a LONG lake: within RL of the chord between two points of its line — the canyon's own footprint and little else)
    ka, kb = int(0.14 * len(CL)), int(0.86 * len(CL)); PA, PB = CL[ka], CL[kb]
    ab = PB - PA; tt = np.clip(((CL - PA) @ ab) / (ab @ ab), 0, 1); dev = float(np.hypot(*(CL - PA - tt[:, None] * ab).T).max())
    RL = dev + float(rimw[inside].max()) + 20
    tg_ = np.clip(((X[sl] - PA[0]) * ab[0] + (Z[sl] - PA[1]) * ab[1]) / (ab @ ab), 0, 1)
    dC = np.hypot(X[sl] - PA[0] - tg_ * ab[0], Z[sl] - PA[1] - tg_ * ab[1])
    low = (~inside) & (dC < RL) & (H[sl] < level + 3)
    H[sl] = np.where(low, level + 3 + 2 * smoothstep(0, 40, D - rimw), H[sl])
    LAKES.append({'name': 'Emerald Narrows', 'x': round(float(PA[0]), 1), 'z': round(float(PA[1]), 1), 'x1': round(float(PB[0]), 1), 'z1': round(float(PB[1]), 1), 'r': round(RL, 1), 'level': round(level, 2), 'depth': 15.0, 'canyon': True})
    CANYON = {'sl': sl, 'water': inside & (D < (WF + 8) * wk), 'inside': D < rimw + 14}
    def rim_point(s_, side, out_):
        """A point `out_` m outside the rim at arc length s_, on `side`; and the unit normal toward that side."""
        k = int(np.argmin(np.abs(np.linspace(0, Ltot, len(CL)) - s_))); tg = CL[min(len(CL) - 1, k + 1)] - CL[max(0, k - 1)]; tg /= np.hypot(*tg)
        nrm = np.array([-tg[1], tg[0]]) * side; c = CL[k]
        for d_ in np.arange(20, 330, 2.0):
            q = c + nrm * d_; jj, ii = cell(q[0], q[1])
            if not (D[jj - sl[0].start, ii - sl[1].start] < rimw[jj - sl[0].start, ii - sl[1].start]): return c + nrm * (d_ + out_), nrm, c
        return c + nrm * 330, nrm, c
    # SKYFALL: from the rim straight to the water
    lipP, nF, cF = rim_point(S_FALL, 1, -3.0)
    footP = cF + nF * (WF * 0.9)
    FALL = {'x': round(float(lipP[0]), 1), 'z': round(float(lipP[1]), 1), 'y': round(hat(*(lipP + nF * 6)) - 0.5, 1), 'bx': round(float(footP[0]), 1), 'bz': round(float(footP[1]), 1), 'by': round(level, 1), 'hw': 16.0, 'outland': True}
    # the OVERLOOK: on the other rim, facing it
    ovP, nO, _ = rim_point(S_FALL, -1, 13.0)
    # the HIGH BRIDGE: rim to rim at the narrows, carried BRIDGE_EXT onto the land like the others, hanging 5 m
    A_, nA, _ = rim_point(S_BR, 1, 5.0); B_, nB, _ = rim_point(S_BR, -1, 5.0)
    u_ = (B_ - A_) / np.hypot(*(B_ - A_)); A_ = A_ - u_ * BRIDGE_EXT; B_ = B_ + u_ * BRIDGE_EXT
    ya, yb = hat(*A_), hat(*B_)
    HIGH_BRIDGE = {'x0': round(float(A_[0]), 2), 'z0': round(float(A_[1]), 2), 'x1': round(float(B_[0]), 2), 'z1': round(float(B_[1]), 2), 'y': round(max(ya, yb) + 0.3, 2), 'w': 6.6,
                   'y0': round(ya + 0.3, 2), 'y1': round(yb + 0.3, 2), 'outland': True, 'kind': 'rope', 'sag': 5.0, 'grand': True, 'drop': round(min(ya, yb) - level, 1)}
    BRIDGES.append(HIGH_BRIDGE)
    PLACES.append({'kind': 'canyon', 'name': 'Skyfall Canyon', 'x': round(x0, 1), 'z': round(z0, 1), 'y': round(level, 2), 'r': round(Ltot / 2, 1)})
    OVERLOOK = {'kind': 'view', 'name': 'Skyfall Overlook', 'x': round(float(ovP[0]), 1), 'z': round(float(ovP[1]), 1), 'r': 30, 'deck': True, 'rot': round(math.atan2(-nO[1], -nO[0]), 3)}
    log(f"Skyfall Canyon at {x0:.0f}, {z0:.0f}: {Ltot:.0f} m long, rim ~{h_ref:.0f} m, floor {floor_:.0f} m, the water at {level:.0f} m; the fall {FALL['y'] - level:.0f} m; the High Bridge {math.hypot(*(B_ - A_)):.0f} m long, {HIGH_BRIDGE['drop']:.0f} m over the water; {int(low.sum())} cells banked up round it")
else: log('no site for the canyon')

# ---- the land as the roads see it, after the places
gz_, gx_ = np.gradient(blur(H, 1), CF); SLOPE = np.hypot(gx_, gz_)

VIEWS = []          # (the high points: chosen below, from the ground a road can reach)

# ================================================================================================== 2. THE ROADS
# the search's grid: every second cell of the world's (16 m)
G2 = 2; S = H[::G2, ::G2].copy(); NS = S.shape[0]; CS = CF * G2      # (a copy: the land as the search saw it, before the dig)
XS, ZS = X[::G2, ::G2], Z[::G2, ::G2]; ES = np.maximum(np.abs(XS), np.abs(ZS))
SLS = nd.maximum_filter(SLOPE, size=3)[::G2, ::G2]
def node(x, z): return int(round((z + FAR_HALF) / CS)) * NS + int(round((x + FAR_HALF) / CS))
def nxz(k): return float(XS.flat[k]), float(ZS.flat[k])
ok = (ES < PLAY - 130) & (SLS < 2.2)                    # (a terrace's cliff can be traversed — at a price: a shelf road is dug along it; a gorge's wall can't)
# inside the valley's box: only its outer country, off its water, its places, its gate
inb = ES < HALF
mg = meta['mask']
mi = np.clip(np.round((XS - mg['origin']) / mg['step']).astype(int), 0, mg['n'] - 1); mj = np.clip(np.round((ZS - mg['origin']) / mg['step']).astype(int), 0, mg['n'] - 1)
wet = nd.maximum_filter((MASK[..., 2] > 70).astype(np.uint8), size=9)[mj, mi] > 0
ok &= ~(inb & (wet | (ES < 1350)))
for l in meta['landmarks']:
    if not l.get('outland'): ok &= ~(np.hypot(XS - l['x'], ZS - l['z']) < l.get('r', 20) + 45)
gate = meta.get('gate')
if gate: ok &= ~(np.hypot(XS - gate['x'], ZS - gate['z']) < 420)
for b in [b for b in meta.get('bridges', []) if not b.get('outland')]: ok &= ~(np.hypot(XS - (b['x0'] + b['x1']) / 2, ZS - (b['z0'] + b['z1']) / 2) < 60)
# the mesa: only its ramp is a road (laid by hand below); the crater's rim only by its breach
ok &= ~(np.hypot(XS - MESA['x'], ZS - MESA['z']) < RAMP_R + RAMP_W + 40)
for lk in LAKES:
    if not lk.get('canyon'): ok &= ~(np.hypot(XS - lk['x'], ZS - lk['z']) < lk['r'] * (1.12 if not lk.get('small') else 1.5))        # (a road goes round a lake)
if CANYON:                                                                     # (… and no road into the canyon)
    cm = np.zeros(H.shape, bool); cm[CANYON['sl']] = CANYON['inside']; ok &= ~cm[::G2, ::G2]
# the towers' pads and the bridges' ends are ground a road may stand on, whatever the rim's slope
for t_ in TOWERS: ok |= np.hypot(XS - t_['x'], ZS - t_['z']) < 26
# (a road meets a bridge at its deck's TOP, less LIP: outland.py set each deck 0.3 m over the rim — a 30 cm step onto the
#  planks, at speed a bounce into the rail: the bot rolled on a different pair of bridges every run)
LIP = 0.04
BR_NODES = []
for b in BRIDGES:
    ux, uz = b['x1'] - b['x0'], b['z1'] - b['z0']; L = math.hypot(ux, uz); ux /= L; uz /= L
    a_ = node(b['x0'] - ux * 20, b['z0'] - uz * 20); b_ = node(b['x1'] + ux * 20, b['z1'] + uz * 20)
    for k in (a_, b_): ok.flat[k] = True
    BR_NODES.append((a_, b_, L))
# (the mesa's ramp, by hand: from its foot round and up, then in onto the top)
ramp_pts = []
for k in range(int(RAMP_R * RAMP_A / 6) + 1):
    th = MESA['th0'] + (k * 6 / RAMP_R)
    if (k * 6 / RAMP_R) > RAMP_A * 0.985: break
    ramp_pts.append((MESA['x'] + RAMP_R * math.cos(th), MESA['z'] + RAMP_R * math.sin(th)))
th_end = MESA['th0'] + RAMP_A * 0.985
for k in range(1, 24):                                                         # in onto the top: a curve to the middle
    f = k / 23; r_ = RAMP_R * (1 - f) + 40 * f; th = th_end - 0.3 * f           # (turning in where the ramp has reached the top: past its end the cliff stands again)
    ramp_pts.append((MESA['x'] + r_ * math.cos(th), MESA['z'] + r_ * math.sin(th)))
foot = (MESA['x'] + (RAMP_R + RAMP_W + 56) * math.cos(MESA['th0'] - 0.25), MESA['z'] + (RAMP_R + RAMP_W + 56) * math.sin(MESA['th0'] - 0.25))
ramp_pts = [foot] + ramp_pts
ok.flat[node(*foot)] = True
# the edges: 32 headings; the cost of a step = its length × (1 + climbing + the hillside's lean)
GMAX = 0.17                                                    # (under the dig's own limit: what the search finds, the profile can follow)
# SWITCHBACKS, not a sawtooth: up a hillside steeper than the road may climb, the cheapest way on a grid is a zigzag of
# 16 m legs — smoothed, a road straight up the fall line, then dug 50–100 m deep to hold its grade. So the ground is
# searched in TWO LAYERS, and the steps have a direction: on steep ground a step taken with the hill on its LEFT is in
# one layer, with the hill on its right in the other (so the same step taken the other way is in the other layer); to
# change layer on steep ground — to turn round on the hillside, a HAIRPIN — costs HAIRPIN metres of road, on gentle
# ground (a crest, a valley's floor) nothing. The legs come out as long as the hill allows.
HAIRPIN, NN = 300.0, NS * NS
gzs, gxs = np.gradient(blur(H, 2)[::G2, ::G2], CS)
rows, cols, costs = [], [], []
idx = np.arange(NS * NS).reshape(NS, NS)
for dj, di in ((0, 1), (1, 0), (1, 1), (1, -1), (1, 2), (2, 1), (1, -2), (2, -1), (1, 3), (3, 1), (1, -3), (3, -1), (2, 3), (3, 2), (2, -3), (3, -2)):
    j0, j1 = max(0, -dj), NS - max(0, dj); i0, i1 = max(0, -di), NS - max(0, di)
    A = (slice(j0, j1), slice(i0, i1)); B = (slice(j0 + dj, j1 + dj), slice(i0 + di, i1 + di))
    Lm = CS * math.hypot(dj, di)
    g = np.abs(S[B] - S[A]) / Lm; lean = 0.5 * (SLS[A] + SLS[B])
    good = ok[A] & ok[B] & (g < GMAX)
    for f in ((0.5,) if max(abs(dj), abs(di)) == 2 else (1 / 3, 2 / 3) if max(abs(dj), abs(di)) == 3 else ()):   # (a long step passes over cells between: ground too, and on the way up)
        for rj, ri in {(math.floor(dj * f), math.floor(di * f)), (math.ceil(dj * f), math.ceil(di * f))}:
            Mx = (slice(j0 + rj, j1 + rj), slice(i0 + ri, i1 + ri))
            good &= ok[Mx] & (np.abs(S[Mx] - (S[A] + (S[B] - S[A]) * f)) < 0.2 * Lm)
    c = Lm * (1 + (g / 0.085) ** 2 + 3.0 * (lean / 0.5) ** 2) * np.where(inb[A] | inb[B], 3.0, 1.0)   # (inside the valley's box a road costs three times: the shortest way out of it)
    gxm, gzm = 0.5 * (gxs[A] + gxs[B]), 0.5 * (gzs[A] + gzs[B])
    side = np.sign(gxm * dj - gzm * di)                                            # the hill on which hand, going A → B
    side = np.where(np.maximum(SLS[A], SLS[B]) < 0.22, 0, side)                   # (gentle ground: either)
    for layer, keep in ((0, side >= 0), (1, side <= 0)):
        k_ = good & keep
        rows.append(idx[A][k_] + layer * NN); cols.append(idx[B][k_] + layer * NN); costs.append(c[k_])                  # A → B in its layer…
        rows.append(idx[B][k_] + (1 - layer) * NN); cols.append(idx[A][k_] + (1 - layer) * NN); costs.append(c[k_])    # …B → A in the other
rows, cols, costs = np.concatenate(rows), np.concatenate(cols), np.concatenate(costs)
br_a = np.array([a for a, b, L in BR_NODES]); br_b = np.array([b for a, b, L in BR_NODES]); br_c = np.array([0.4 * L for a, b, L in BR_NODES])
okn = np.nonzero(ok.ravel() & (SLS.ravel() < 0.5))[0]                           # (no hairpin on a hillside steeper than 27°: nowhere to turn — a stack of 16 m legs up a steep nose is no road)
sw_c = np.where(SLS.ravel()[okn] < 0.22, 0.01, HAIRPIN)
GRAPH = coo_matrix((np.concatenate([costs, br_c, br_c, br_c, br_c, sw_c, sw_c]), (np.concatenate([rows, br_a, br_a + NN, br_b, br_b + NN, okn, okn + NN]), np.concatenate([cols, br_b, br_b + NN, br_a, br_a + NN, okn + NN, okn]))), shape=(2 * NN, 2 * NN)).tocsr()
def both(k): k = np.atleast_1d(k); return np.concatenate([k, k + NN])
def best_of(d, k): return int(k) if d[int(k)] <= d[int(k) + NN] else int(k) + NN
BR_PAIR = {}; NODE_END = {}
# (each bridge end's way OUT onto its land, along the bridge's own line — axis_in)
END_OUT = {}
for b in BRIDGES:
    l_ = math.hypot(b['x1'] - b['x0'], b['z1'] - b['z0']); u_ = ((b['x1'] - b['x0']) / l_, (b['z1'] - b['z0']) / l_)
    END_OUT[(round(b['x0']), round(b['z0']))] = (-u_[0], -u_[1]); END_OUT[(round(b['x1']), round(b['z1']))] = u_
for (a_, b_, L), b in zip(BR_NODES, BRIDGES): NODE_END[a_] = (b['x0'], b['z0'], b['y0'] - LIP); NODE_END[b_] = (b['x1'], b['z1'], b['y1'] - LIP)
for (a_, b_, L), b in zip(BR_NODES, BRIDGES): BR_PAIR[(a_, b_)] = b; BR_PAIR[(b_, a_)] = b
log(f'the search: {int(ok.sum())} cells of ground at {CS:.0f} m, {len(costs)} steps')

# what's already road: the valley's own tracks (their cells in the outer country)
net = np.zeros(NS * NS, bool)
for Ln in meta['trails']['lines']:
    for x, z in Ln[::3]:
        k = node(x, z)
        if ok.flat[k]: net[k] = True
log(f'the valley\'s tracks: {int(net.sum())} cells to start from')

# the targets
TARGETS = []
for t_ in TOWERS: TARGETS.append({'name': t_['name'], 'node': node(t_['x'], t_['z']), 'end': (t_['x'], t_['z']), 'trim': 11.0, 'y': t_['y']})
for (a_, b_, L), b in zip(BR_NODES, BRIDGES):
    TARGETS.append({'name': 'a bridge', 'node': a_, 'end': (b['x0'], b['z0']), 'trim': 0.0, 'y': b['y0'] - LIP})
    TARGETS.append({'name': 'a bridge', 'node': b_, 'end': (b['x1'], b['z1']), 'trim': 0.0, 'y': b['y1'] - LIP})
wt = next(p for p in PLACES if p['kind'] == 'worldtree'); TARGETS.append({'name': wt['name'], 'node': node(wt['x'] + RING, wt['z']), 'end': None, 'trim': 0.0})
cr = next(p for p in PLACES if p['kind'] == 'crater')
# (the crater: to the pool's shore on the breach's side; each lake: to its shore on the valley's side)
TARGETS.append({'name': cr['name'], 'node': node(cr['x'] + 105 * math.cos(cr['breach']), cr['z'] + 105 * math.sin(cr['breach'])), 'end': None, 'trim': 0.0})
for lk in [q for q in LAKES[1:] if not q.get('canyon') and not q.get('small')]:
    u_ = -np.array([lk['x'], lk['z']]) / math.hypot(lk['x'], lk['z'])
    cand_ = np.nonzero(ok.ravel() & (np.abs(np.hypot(XS - lk['x'], ZS - lk['z']).ravel() - lk['r'] * 1.3) < 20))[0]
    if len(cand_): TARGETS.append({'name': lk['name'], 'node': int(cand_[np.argmax((XS.flat[cand_] - lk['x']) * u_[0] + (ZS.flat[cand_] - lk['z']) * u_[1])]), 'end': None, 'trim': 0.0})
TARGETS.append({'name': 'Table Rock', 'node': node(*foot), 'end': foot, 'trim': 0.0})
# THE HIGH ROADS: on each great peak, the highest gentle ground a road can climb to (within 1.2 km of the top, for no
# more than BUDGET of the search's cost) — a VIEW on its shoulder
src = np.nonzero(net)[0]
dist0 = dijkstra(GRAPH, directed=True, indices=both(src), min_only=True); dist0 = np.minimum(dist0[:NN], dist0[NN:])
BUDGET = float(ARGS.get('BUDGET', 60000))
SLB = blur(SLOPE, 2)[::G2, ::G2]
for p in PEAKS[:9]:
    dd = np.hypot(XS - p['x'], ZS - p['z'])
    can = (dd < 1200) & (dist0.reshape(NS, NS) < BUDGET) & (SLB < 0.3) & ok
    can &= ~(np.hypot(XS - MESA['x'], ZS - MESA['z']) < 600)
    for v in VIEWS: can &= np.hypot(XS - v['x'], ZS - v['z']) > 1500
    if not can.any(): continue
    k = int(np.argmax(np.where(can, S, -1e9))); x, z = nxz(k)
    if S.flat[k] < 430 or S.flat[k] < 0.42 * p['h']: continue
    VIEWS.append({'kind': 'view', 'name': f"{p['name']} Shoulder", 'x': round(x, 1), 'z': round(z, 1), 'r': 40, 'peak': p['name']})
    TARGETS.append({'name': VIEWS[-1]['name'], 'node': k, 'end': None, 'trim': 0.0})
log(f'the ground a road can reach: up to {S.ravel()[np.isfinite(dist0)].max():.0f} m; {len(VIEWS)} views: ' + ', '.join(f"{v['name']} {hat(v['x'], v['z']):.0f} m" for v in VIEWS))


for nm, gx0, gz0 in (('the west road', -HALF - 260, 0), ('the east road', HALF + 260, 0), ('the south road', 0, HALF + 260), ('the north road', -300, -HALF - 260)):
    cand = np.nonzero(ok.ravel() & (np.hypot(XS - gx0, ZS - gz0).ravel() < 700) & (SLS.ravel() < 0.25))[0]
    if len(cand): k = cand[np.argmin(np.hypot(XS.flat[cand] - gx0, ZS.flat[cand] - gz0))]; TARGETS.append({'name': nm, 'node': int(k), 'end': None, 'trim': 0.0})
if CANYON:
    cand_ = np.nonzero(ok.ravel() & (np.hypot(XS - OVERLOOK['x'], ZS - OVERLOOK['z']).ravel() < 60))[0]
    if len(cand_): k_ = int(cand_[np.argmin(np.hypot(XS.flat[cand_] - OVERLOOK['x'], ZS.flat[cand_] - OVERLOOK['z']))]); TARGETS.append({'name': OVERLOOK['name'], 'node': k_, 'end': None, 'trim': 0.0}); VIEWS.append(OVERLOOK)
LINES = []          # each: {'pts': [(x, z) …], 'pin0': y | None, 'pin1': y | None, 'name': …}
def trace(pred, k):
    """The cells from the road it starts on to state k (the two layers' copies of a cell are one cell)."""
    out = [k % NN]
    while pred[k] >= 0:
        k = int(pred[k])
        if k % NN != out[-1]: out.append(k % NN)
    return out[::-1]
# UNDER THE BRIDGES no road digs (a road's level landing reached out under the deck it meets — where the deck falls
# toward its other end the ground stood up to 0.6 m ABOVE the planks); after the dig the ground under each deck is set
# just under its planks where the deck lies on the land, and kept under them over the gorge (below).
SPAN = np.zeros(H.shape, bool)
for b in BRIDGES:
    Lb = math.hypot(b['x1'] - b['x0'], b['z1'] - b['z0']); ux, uz = (b['x1'] - b['x0']) / Lb, (b['z1'] - b['z0']) / Lb
    sl, _, _ = window((b['x0'] + b['x1']) / 2, (b['z0'] + b['z1']) / 2, Lb / 2 + 16)
    tb = ((X[sl] - b['x0']) * ux + (Z[sl] - b['z0']) * uz) / Lb; lat = np.abs(-(X[sl] - b['x0']) * uz + (Z[sl] - b['z0']) * ux)
    SPAN[sl] |= (tb > 0.0) & (tb < 1.0) & (lat < b['w'] / 2 + 8)
SPAN_PRE = SPAN
ROADED = set()        # (the bridge ends a road arrives at or sets out from)
def axis_in(pts, end, at_start):
    """A road that reaches a bridge's end ACROSS the bridge's line (2026-11-11: the road down to the west gorge's bridge
    came in at 130° to it and hooked onto the deck inside 8 m, a metre under it — the bot rolled there, one way) comes
    round onto that line 30 m out and runs straight on to the deck: its cells within 44 m of the end dropped, two points
    on the bridge's own line in their place (the bend there rounded and levelled with the rest: `drivable`, the
    hairpins' pads). A road already arriving within 60° of the line is left as it is."""
    out = END_OUT.get((round(end[0]), round(end[1])))
    if not out: return pts
    body = (pts[1:])[::-1] if at_start else pts[:-1]                              # (the cells, ordered toward the end)
    if len(body) < 3: return pts
    hx, hz = body[-1][0] - body[-2][0], body[-1][1] - body[-2][1]; l_ = math.hypot(hx, hz) or 1.0
    if -(hx * out[0] + hz * out[1]) / l_ > 0.5: return pts
    n_ = next((k for k, q in enumerate(body) if math.hypot(q[0] - end[0], q[1] - end[1]) < 44), len(body))
    if n_ < 2: return pts
    log(f'  a road brought round onto its bridge\'s line at {end[0]:.0f}, {end[1]:.0f}')
    new = body[:n_] + [(end[0] + out[0] * 30, end[1] + out[1] * 30), (end[0] + out[0] * 14, end[1] + out[1] * 14), (end[0], end[1])]
    return new[::-1] if at_start else new

def lay(path, tgt):
    """A path of cells (from the road it joins to its target) → one line, or two with a bridge between them."""
    segs, cur = [], [path[0]]
    for a_, b_ in zip(path[:-1], path[1:]):
        if (a_, b_) in BR_PAIR:
            b = BR_PAIR[(a_, b_)]; ea, eb = ((b['x0'], b['z0'], b['y0']), (b['x1'], b['z1'], b['y1']))
            if math.hypot(nxz(a_)[0] - ea[0], nxz(a_)[1] - ea[1]) > math.hypot(nxz(a_)[0] - eb[0], nxz(a_)[1] - eb[1]): ea, eb = eb, ea
            segs.append((cur, None, (ea[0], ea[1], ea[2] - LIP))); cur = [b_]; segs.append(('bridge', (eb[0], eb[1], eb[2] - LIP)))
        else: cur.append(b_)
    segs.append((cur, 'tgt', None))
    # (a road that sets out from a bridge's own cell — the cell 20 m off its end, where a road that came over the
    #  bridge arrived — sets out from the bridge's END: one line off the deck, the corner at that cell rounded with the
    #  rest. Left to start at the cell it met the 20 m link at whatever angle it left by: the bot went off at each)
    start = NODE_END.get(path[0]) if len(path) > 1 and (path[0], path[1]) not in BR_PAIR else None
    for s_ in segs:
        if s_[0] == 'bridge': start = s_[1]; continue
        cells_, kind, endpt = s_
        pts = [nxz(k) for k in cells_]
        pin0 = pin1 = None
        # (… and the road whose target IS that cell has arrived when it is over the bridge: no 20 m spur out and back)
        if start and kind == 'tgt' and len(cells_) <= 1 and tgt.get('end') and math.hypot(start[0] - tgt['end'][0], start[1] - tgt['end'][1]) < 1: continue
        if start: ROADED.add((round(start[0]), round(start[1]))); pts = axis_in([(start[0], start[1])] + pts, start, True); pin0 = start[2]; start = None
        if endpt: ROADED.add((round(endpt[0]), round(endpt[1]))); pts = axis_in(pts + [(endpt[0], endpt[1])], endpt, False); pin1 = endpt[2]
        elif kind == 'tgt' and tgt.get('end'):
            ROADED.add((round(tgt['end'][0]), round(tgt['end'][1]))); pts = axis_in(pts + [tgt['end']], tgt['end'], False); pin1 = tgt.get('y')
        if len(pts) >= 2: LINES.append({'pts': pts, 'pin0': pin0, 'pin1': pin1, 'name': tgt['name'], 'trim': tgt.get('trim', 0.0) if kind == 'tgt' else 0.0})
    for k in path: net[k] = True

def connect(left):
    """Roads from what is already road to each target, the nearest first → the targets it could not reach."""
    left = list(left)
    while left:
        src = np.nonzero(net)[0]
        dist, pred, _ = dijkstra(GRAPH, directed=True, indices=both(src), min_only=True, return_predecessors=True)
        left.sort(key=lambda t_: min(dist[t_['node']], dist[t_['node'] + NN]))
        # every target this one search can serve: the nearest, then any other whose way doesn't come near a road laid in this round
        laid = np.zeros(NS * NS, bool); took = []
        for t_ in left:
            st = best_of(dist, t_['node'])
            if not np.isfinite(dist[st]): continue
            path = trace(pred, st)
            if took and any(laid[k] for k in path): continue
            if len(path) < 2: took.append(t_); continue                              # (already on a road)
            near_ = nd.binary_dilation(np.isin(np.arange(NS * NS), path).reshape(NS, NS), iterations=12).ravel()
            if took and (near_ & laid).any(): continue
            lay(path, t_); laid |= near_; took.append(t_)
        if not took: return left
        left = [t_ for t_ in left if t_ not in took]
    return []
MISSED = connect(TARGETS)
missed = [t_['name'] for t_ in MISSED]
log(f'roads to {len(TARGETS) - len(MISSED)} of {len(TARGETS)} targets' + (f'; the search can\'t reach: {", ".join(missed)}' if missed else ''))

# THE HIGH LINES — where the search can't go (a hillside too steep to turn on, all the way up): a GRADE LINE. From the
# place itself, DOWN, the hill kept on one hand, falling a steady GL the whole way — along the contour turned just
# enough downhill (sin = GL / the slope), straight down where the ground is gentler than that — round the mountain's
# shoulders and into its gullies, never turning back on itself, until it comes to ground the search does reach. No
# hairpin, so no stack of legs; the dig then benches it into the face. Whitecrown's PASS (the col beside the summit)
# and the gorge bridge on its cliff-ringed plateau get their roads this way.
HB = blur(H, 3); gzb_, gxb_ = np.gradient(HB, CF)
def grade_line(x0, z0, side, GL, max_len=11000.0, wall=2.6):
    reach_ = dijkstra(GRAPH, directed=True, indices=both(np.nonzero(net)[0]), min_only=True); reach_ = np.minimum(reach_[:NN], reach_[NN:])
    netk = np.nonzero(net)[0]; netx, netz = XS.flat[netk], ZS.flat[netk]
    pts = [(x0, z0)]; x, z, L = x0, z0, 0.0
    while L < max_len:
        gx = float(bilinear(gxb_, FAR_HALF, np.array([x]), np.array([z]))[0]); gz = float(bilinear(gzb_, FAR_HALF, np.array([x]), np.array([z]))[0])
        sl_ = math.hypot(gx, gz)
        if sl_ < 1e-4: WHY.append('flat'); return None
        ux, uz = gx / sl_, gz / sl_
        if sl_ <= GL: dx, dz = -ux, -uz
        else:
            sn = GL / sl_; cs = math.sqrt(1 - sn * sn)
            dx, dz = side * (-uz) * cs - ux * sn, side * ux * cs - uz * sn
        x += dx * 8; z += dz * 8; L += 8
        if max(abs(x), abs(z)) > PLAY - 150 or sl_ > wall: WHY.append(f'{"the edge" if sl_ <= wall else "a wall"} after {L:.0f} m at {HB[cell(x, z)]:.0f} m'); return None
        if len(pts) > 30 and min(math.hypot(x - px, z - pz) for px, pz in pts[:-24:3]) < 48: WHY.append(f'beside itself after {L:.0f} m at {HB[cell(x, z)]:.0f} m'); return None     # (it has come back beside itself)
        # (a GORGE under it — the smoothed land it reads its way from doesn't hold a 30 m cut: the first line to the
        #  plateau bridge ran straight across the gorge the bridge spans, and the dig dammed it)
        hb_ = float(bilinear(HB, FAR_HALF, np.array([x]), np.array([z]))[0])
        if hb_ < 620 and float(bilinear(H, FAR_HALF, np.array([x]), np.array([z]))[0]) < hb_ - 12.0: WHY.append(f'a gorge after {L:.0f} m'); return None     # (the gorges cut the plateaus under ~600 m: the ground metres UNDER its own smoothing there is one)
        pts.append((x, z))
        k = node(x, z)
        if L > 160:
            # (a road within 26 m AND within 4 m of its height: it has met it — it joins it there, its last point the
            #  road's own. One that only passes near it, metres above or below, goes on down: the search's way from
            #  that road up to a foot 30 m off it was 900 m of a second road beside the first)
            dn = np.hypot(netx - x, netz - z); q = int(np.argmin(dn))
            if dn[q] < 26 and abs(S.flat[netk[q]] - float(bilinear(H, FAR_HALF, np.array([x]), np.array([z]))[0])) < 4.0:
                pts.append((float(netx[q]), float(netz[q]))); JOINED.append(True); return pts
            if np.isfinite(reach_[k]) and ok.flat[k] and SLS.flat[k] < 0.3 and dn[q] > 120: JOINED.append(False); return pts
    WHY.append(f'{max_len / 1000:.0f} km and still at {HB[cell(x, z)]:.0f} m'); return None
WHY = []; JOINED = []
def high_line(x0, z0, name, pin=None, wall=2.6):
    """The shortest grade line down from (x0, z0), either hand, at 12 / 10 / 14 % → laid (its foot joined by the search)."""
    best = None
    for GL in (0.12, 0.10, 0.14):
        for side in (-1, 1):
            pts = grade_line(x0, z0, side, GL, wall=wall)
            if pts and (best is None or len(pts) < len(best[0])): best = (pts, GL, side)
        if best: break
    if not best: log(f'  no grade line down from {name} at {x0:.0f}, {z0:.0f}: ' + '; '.join(WHY[-6:])); return False
    pts, GL, side = best
    JOINED.clear(); pts = grade_line(x0, z0, side, GL, wall=wall)                # (again: whether it ended ON a road)
    if not JOINED[-1]:
        foot_ = {'name': name, 'node': node(*pts[-1]), 'end': None, 'trim': 0.0}
        ok.flat[foot_['node']] = True
        if connect([foot_]): log(f'  the foot of the line down from {name} is not reached'); return False
    HIGH.append({'P': np.array(pts[::-1]), 'pin0': None, 'pin1': pin, 'name': name})
    for q in pts: net[node(*q)] = True
    log(f'  a grade line to {name}: {len(pts) * 8 / 1000:.2f} km at {GL * 100:.0f} %, from {hat(*pts[-1]):.0f} m up to {hat(x0, z0):.0f} m')
    return True
HIGH = []
near = sorted((q for q in PEAKS[1:] if math.hypot(q['x'] - top['x'], q['z'] - top['z']) < 1700), key=lambda q: math.hypot(q['x'] - top['x'], q['z'] - top['z']))
if near:
    q = near[0]; tt = np.linspace(0.15, 0.85, 80)
    lx, lz = top['x'] + (q['x'] - top['x']) * tt, top['z'] + (q['z'] - top['z']) * tt
    k = int(np.argmin(bilinear(H, FAR_HALF, lx, lz))); px_, pz_ = float(lx[k]), float(lz[k])
    sl, d, _ = window(px_, pz_, 60)                                            # the col: a pad to stand on
    hc = float(H[sl][d < 18].mean()); H[sl] += (hc - H[sl]) * (1 - smoothstep(20, 52, d))
    HB = blur(H, 3); gzb_, gxb_ = np.gradient(HB, CF)
    if high_line(px_, pz_, 'Whitecrown Pass', wall=7.0): VIEWS.append(        # (a shelf across its cliffs: the dig benches it in)
        {'kind': 'pass', 'name': 'Whitecrown Pass', 'x': round(px_, 1), 'z': round(pz_, 1), 'r': 40})
for t_ in MISSED:
    if not connect([t_]): missed.remove(t_['name']); continue                # (a line just laid — to a bridge's other end — has opened the way)
    x0, z0 = nxz(t_['node'])
    if high_line(x0, z0, t_['name']):
        if t_.get('end'): HIGH[-1]['P'] = np.vstack([HIGH[-1]['P'], [t_['end']]]); HIGH[-1]['pin1'] = t_.get('y')
        missed.remove(t_['name'])
for t_ in MISSED:                                                            # (once more: a line laid since — to a bridge's other end — may have opened the way to one passed over)
    st_ = dijkstra(GRAPH, directed=True, indices=both(np.nonzero(net)[0]), min_only=True)
    if t_['name'] in missed and not net[t_['node']] and np.isfinite(min(st_[t_['node']], st_[t_['node'] + NN])) and not connect([t_]): missed.remove(t_['name'])
if missed: log('STILL without a road: ' + ', '.join(missed))

# EVERY BRIDGE A WAY THROUGH: the search reaches a bridge from one side, crosses it, and has arrived — the far end with
# no road beyond it (the bot found five such). Each far end gets a road of its own to the net ON ITS OWN SIDE (the
# search again, the bridges themselves closed) — the bridge then joins two roads. An end the land gives no way from
# (the plateau's) stays an end: a level pad to turn on.
nb = np.ones(GRAPH.nnz, bool)
coo_ = GRAPH.tocoo(); pair_ = set(BR_PAIR.keys())
nb = np.array([(int(r_) % NN, int(c_) % NN) not in pair_ for r_, c_ in zip(coo_.row[np.isin(coo_.row % NN, list(NODE_END))], coo_.col[np.isin(coo_.row % NN, list(NODE_END))])])
keep_ = np.ones(coo_.nnz, bool); keep_[np.nonzero(np.isin(coo_.row % NN, list(NODE_END)))[0]] = nb
GRAPH_NB = coo_matrix((coo_.data[keep_], (coo_.row[keep_], coo_.col[keep_])), shape=GRAPH.shape).tocsr()
through = pads = 0
for (a_, b_, L_), b in zip(BR_NODES, BRIDGES):
    for e_, (ex, ez, ey) in ((a_, (b['x0'], b['z0'], b['y0'])), (b_, (b['x1'], b['z1'], b['y1']))):
        if (round(ex), round(ez)) in ROADED: continue
        src = np.nonzero(net)[0]; src = src[(src != a_) & (src != b_)]
        dist, pred, _ = dijkstra(GRAPH_NB, directed=True, indices=both(src), min_only=True, return_predecessors=True)
        st = best_of(dist, e_)
        path = trace(pred, st) if np.isfinite(dist[st]) else None
        if path and 2 <= len(path) < 260:
            lay(path, {'name': 'a bridge', 'end': (ex, ez), 'y': ey - LIP, 'trim': 0.0}); through += 1
        else:
            sl, d, _ = window(ex, ez, 40); H[sl] += (ey - LIP - H[sl]) * (1 - smoothstep(14, 34, d)) * ~SPAN_PRE[sl]; pads += 1
log(f'{through} bridge ends given a road of their own side; {pads} left as an end with a pad to turn on')

# LOOPS: two road ends / places near each other as the crow flies but far apart by road get a road between them
def road_graph():
    """The roads as a graph over their own cells (for distances BY ROAD)."""
    r_, c_, w_ = [], [], []
    for Ln in LINES:
        ks = [node(x, z) for x, z in Ln['pts']]
        for a_, b_ in zip(ks[:-1], ks[1:]):
            if a_ != b_: r_.append(a_); c_.append(b_); w_.append(math.hypot(nxz(a_)[0] - nxz(b_)[0], nxz(a_)[1] - nxz(b_)[1]))
    for (a_, b_, L) in BR_NODES: r_.append(a_); c_.append(b_); w_.append(L + 40)
    return coo_matrix((w_, (r_, c_)), shape=(NS * NS, NS * NS)).tocsr()
hubs = [t_ for t_ in TARGETS if t_['name'] not in missed and t_['name'] != 'a bridge']
LOOPS = 0
for rnd in range(int(ARGS.get('LOOPS', 6))):
    RG = road_graph()
    hn = [t_['node'] for t_ in hubs]
    dr = dijkstra(RG, directed=False, indices=hn)
    best = None
    for a_ in range(len(hubs)):
        for b_ in range(a_ + 1, len(hubs)):
            xa, za = nxz(hn[a_]); xb, zb = nxz(hn[b_]); crow = math.hypot(xa - xb, za - zb)
            if not 700 < crow < 3200: continue
            byroad = dr[a_, hn[b_]]
            ratio = (byroad if np.isfinite(byroad) else 30000) / crow
            if ratio > 2.6 and (best is None or ratio > best[0]): best = (ratio, a_, b_)
    if not best: break
    _, a_, b_ = best
    # (a new way: the roads already there cost three times their length, but for the two ends' own neighbourhoods)
    w = GRAPH.copy(); pen = nd.binary_dilation(net.reshape(NS, NS), iterations=24).ravel()               # (… and the ground within 380 m of them)
    for k in (hn[a_], hn[b_]): pen &= ~(np.hypot(XS - nxz(k)[0], ZS - nxz(k)[1]) < 260).ravel()
    w.data = w.data * np.where(pen[w.indices % NN], 5.0, 1.0)
    dist, pred, _ = dijkstra(w, directed=True, indices=both(hn[a_]), min_only=True, return_predecessors=True)
    st = best_of(dist, hn[b_])
    if not np.isfinite(dist[st]): hubs.pop(b_); continue
    path = trace(pred, st)
    # (only its own stretches are new road: runs of cells not yet road, with one road cell at each end)
    new_len = sum(1 for k in path if not pen[k]) * CS
    if new_len < 0.5 * len(path) * CS: hubs.pop(b_); continue                # (mostly beside roads that are there: no loop)
    run = []
    for k in path:
        if net[k]:
            if len(run) > 6: run.append(k); lay(run, {'name': 'a loop', 'end': None}); LOOPS += 1
            run = [k]
        else: run.append(k)
log(f'{LOOPS} loop roads closed')

# ---- the lines smoothed: a road, not a staircase of cells
XI = np.linspace(-HALF, HALF, N)
def ground(P):
    """The ground under points: the box's 2 m grid inside it, the world's 8 m outside."""
    out = bilinear(H, FAR_HALF, P[:, 0], P[:, 1])
    ib = np.maximum(np.abs(P[:, 0]), np.abs(P[:, 1])) < HALF - CELL
    if ib.any(): out[ib] = bilinear(HI, HALF, P[ib, 0], P[ib, 1])
    return out, ib
def eased(P, g0, tol=3.0):
    """One smoothing pass that keeps every point on ITS OWN ground (within tol m of the height it stood at): on a steep
    hillside a point moved sideways is metres up or down the hill — a hairpin rounded off climbed 45 m in 100."""
    Q = P.copy(); Q[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
    f = np.ones(len(P))
    for _ in range(4):
        C = P + (Q - P) * f[:, None]
        bad = np.abs(ground(C)[0] - g0) > tol
        if not bad.any(): break
        f[bad] *= 0.5
    f[np.abs(ground(P + (Q - P) * f[:, None])[0] - g0) > tol] = 0
    return P + (Q - P) * f[:, None]
def smooth_line(P, trim):
    P = np.array(P, float)
    if len(P) > 4:
        g0 = ground(P)[0]
        for _ in range(3): P = eased(P, g0)
    seg = np.hypot(*np.diff(P, axis=0).T); s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1] - trim
    if L < 12: return None
    n = max(2, int(round(L / 8)) + 1); u = np.linspace(0, L, n)
    P = np.stack([np.interp(u, s, P[:, 0]), np.interp(u, s, P[:, 1])], 1)
    if len(P) > 4: P = eased(P, ground(P)[0], 1.5)
    return P
def drivable(l, R=9.0, Ld=8.0, ds=0.5):
    """A line a car can follow (trackgrade.py's): TRACED by a car that can't turn tighter than R (pure pursuit, Ld ahead,
    every ds) — a hairpin swings out into a turn it can take, a corner is rounded, a gentle bend barely moves; the ends
    stay where they were (the junctions). The search's hairpins turned on ~5 m: the bot left the road at every one."""
    l = np.asarray(l, float)
    P = resample(l, ds); P = np.vstack([P, l[-1][None]]); n = len(P)
    if n < 40: return l
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
    Q = resample(np.array(out), 8.0)
    if len(Q) < 3: return l
    return np.vstack([Q, P[-1][None]]) if math.hypot(*(Q[-1] - P[-1])) > 0.3 else Q
DROPPED = []
def spread_legs(P, dmin=30.0, far=95.0):
    """A switchback's two legs kept dmin apart (but for the turn itself — points less than `far` m of road from each
    other): the search lays them a cell (16 m) apart, smoothing brings them to 7 — at different heights, each then had
    half a bed with the other's bank in it (the bot rolled at both hairpins it met). 30 m: on the world's 8 m grid the
    bank between two beds takes a cell — at 20 m apart it still stood 3 m high 5 m from the middle. Each point pushed straight away
    from the other leg's nearest, a few passes, eased; the ends stay."""
    P = P.copy()
    for _ in range(8):
        s_ = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
        D = np.hypot(P[:, None, 0] - P[None, :, 0], P[:, None, 1] - P[None, :, 1])
        D[np.abs(s_[:, None] - s_[None, :]) < far] = 1e9
        j = D.argmin(1); d = D[np.arange(len(P)), j]
        close = d < dmin; close[0] = close[-1] = False
        if not close.any(): break
        u = (P - P[j]) / np.maximum(d, 1e-6)[:, None]
        P[close] += u[close] * ((dmin - d[close]) * 0.55)[:, None]
        Q = P.copy(); Q[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]; P = Q
    return P
ROADS = []
near2 = None
for Ln in LINES:
    P = smooth_line(Ln['pts'], Ln.get('trim', 0.0))
    if P is not None and len(P) > 6: P = spread_legs(drivable(P))
    # (a road that sets out FROM a tower — the tower's own cell is road, the next road leaves from it — starts at the
    #  pad's edge, not under the tower: the bot drove into its legs)
    if P is not None:
        for t_ in TOWERS:
            dT = np.hypot(P[:, 0] - t_['x'], P[:, 1] - t_['z'])
            if dT[0] < 13: P = P[int(np.argmax(dT >= 13)):] if (dT >= 13).any() else P
            dT = np.hypot(P[:, 0] - t_['x'], P[:, 1] - t_['z'])
            if dT[-1] < 11: P = P[:len(P) - int(np.argmax(dT[::-1] >= 11))] if (dT >= 11).any() else P
        if len(P) < 3: P = None
    # (a LOOP is new road: one laid beside a road that is already there — within 24 m of it for a third of its length —
    #  is a second bed in the same hillside: left out)
    if P is not None and Ln['name'] == 'a loop' and len(ROADS):
        E = np.vstack([r['P'] for r in ROADS]); mid = P[4:-4]
        if len(mid) and np.mean([np.hypot(E[:, 0] - x, E[:, 1] - z).min() < 24 for x, z in mid[::2]]) > 0.33: DROPPED.append(len(P) * 8); continue
    if P is not None: ROADS.append({'P': P, 'pin0': Ln['pin0'], 'pin1': Ln['pin1'], 'name': Ln['name']})
# the mesa's ramp (its ground is laid: only its last metres, onto the top, are graded) and the World Tree's ring road
ROADS.append({'P': smooth_line(ramp_pts, 0.0), 'pin0': None, 'pin1': None, 'name': 'Table Rock', 'laid': True})
if CANYON and OVERLOOK['name'] not in missed:
    fo = np.array([math.cos(OVERLOOK['rot']), math.sin(OVERLOOK['rot'])]); o0 = np.array([OVERLOOK['x'], OVERLOOK['z']])
    ROADS.append({'P': np.array([o0 - fo * 16, o0 - fo * 8, o0, o0 + fo * 5, o0 + fo * 9.5]), 'pin0': None, 'pin1': None, 'name': OVERLOOK['name'], 'laid': True})   # (to the brink: the deck's planks lie over it)
for Hn in HIGH: ROADS.append({**Hn, 'P': spread_legs(drivable(smooth_line(Hn['P'], 0.0))), 'high': True})
ring_pts = [(wt['x'] + RING * math.cos(k / 120 * 2 * math.pi), wt['z'] + RING * math.sin(k / 120 * 2 * math.pi)) for k in range(121)]
ROADS.append({'P': np.array(ring_pts), 'pin0': None, 'pin1': None, 'name': 'The World Tree', 'ring': True})
total = sum(float(np.hypot(*np.diff(r['P'], axis=0).T).sum()) for r in ROADS)
log(f'{len(ROADS)} roads, {total / 1000:.1f} km' + (f'; {len(DROPPED)} loop roads left out (beside a road already there: {sum(DROPPED) / 1000:.1f} km)' if DROPPED else ''))

# ================================================================================================== 3. THE GROUND, DUG
G_ROAD = float(ARGS.get('G', 0.20))
def lipschitz(p, s, G):
    """The closest profile to p no steeper than G: the mean of the highest such under it and the lowest over it."""
    lo, hi = p.copy(), p.copy()
    for k in range(1, len(p)): lo[k] = min(lo[k], lo[k - 1] + G * (s[k] - s[k - 1])); hi[k] = max(hi[k], hi[k - 1] - G * (s[k] - s[k - 1]))
    for k in range(len(p) - 2, -1, -1): lo[k] = min(lo[k], lo[k + 1] + G * (s[k + 1] - s[k])); hi[k] = max(hi[k], hi[k + 1] - G * (s[k + 1] - s[k]))
    return 0.5 * (lo + hi)
INBOX = EDGE < HALF - 1e-6
FAST = {lk['name'] for lk in LAKES} | {'The World Tree', 'The Sunken Meadow'}
DM = np.full(H.shape, 1e9, np.float32); PM = np.zeros(H.shape, np.float32); LOCK = np.zeros(H.shape, bool)
DMI = np.full(HI.shape, 1e9, np.float32); PMI = np.zeros(HI.shape, np.float32); LOCKI = np.zeros(HI.shape, bool)
cut_max = 0.0; box_m = 0.0
for R in sorted(ROADS, key=lambda r: -len(r['P'])):
    P = R['P']
    # (every 4 m along it)
    seg = np.hypot(*np.diff(P, axis=0).T); s0 = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(s0[-1] / 4) + 1); s = np.linspace(0, s0[-1], n)
    Q = np.stack([np.interp(s, s0, P[:, 0]), np.interp(s, s0, P[:, 1])], 1)
    g, ib = ground(Q)
    p = nd.gaussian_filter1d(g, 5.0, mode='nearest') if not R.get('laid') else g.copy()
    for pin, k in ((R['pin0'], 0), (R['pin1'], n - 1)):
        hold = pin if pin is not None else g[k]                                # (an end on a road already dug, a bridge's deck, a tower's pad: held)
        p += (hold - p[k]) * np.exp(-np.abs(s - s[k]) / 45.0)
    # BESIDE A BED ALREADY DUG (within 22 m of it: a junction's first metres, two roads sharing a shelf): that bed's
    # height — one level surface until they part (the bed is locked: a road at another height 10 m off it had half a bed)
    beside = np.zeros(n, bool)
    for k in range(n):
        x, z = Q[k]; j, i = cell(x, z)
        sl = (slice(max(0, j - 3), min(NF, j + 4)), slice(max(0, i - 3), min(NF, i + 4)))
        if not LOCK[sl].any(): continue
        d = np.where(LOCK[sl], np.hypot(X[sl] - x, Z[sl] - z), 1e9)
        if d.min() < 22: p[k] = H[sl].flat[int(np.argmin(d))]; beside[k] = True
    # THE HAIRPINS (the road turns back more than ~110° within 50 m): level for 20 m each way — a place to turn, not a
    # ramp folded on itself; the dig gives each a round pad (below)
    hd = np.arctan2(*np.gradient(Q, axis=0).T[::-1])
    turn = np.zeros(n)
    for k in range(6, n - 6): turn[k] = abs((math.atan2(Q[k + 6][1] - Q[k][1], Q[k + 6][0] - Q[k][0]) - math.atan2(Q[k][1] - Q[k - 6][1], Q[k][0] - Q[k - 6][0]) + math.pi) % (2 * math.pi) - math.pi)
    HP = [k for k in range(6, n - 6) if turn[k] > 1.9 and turn[k] >= turn[max(0, k - 10):k + 11].max()]
    for k in HP: p[max(0, k - 5):k + 6] = p[k]
    p = lipschitz(p, s, G_ROAD)
    p = nd.gaussian_filter1d(p, 1.5, mode='nearest')
    # CRESTS (the user: "Dirt Rally like": a road to take off from): on the long valley runs — to the lakes, the World
    # Tree, the crater — two brows, 1.5 m high and ~30 m long, each on a straight, near-level stretch well clear of the
    # road's ends and of each other; the game stands a caution board before each
    R['crests'] = []
    if (R['name'] in FAST) and s[-1] > 1200 and not R.get('laid'):
        last_ = -1e9
        for k in range(int(170 / 4), n - int(170 / 4), 5):
            if s[k] - last_ < 420 or len(R['crests']) >= 2: continue
            a0 = math.atan2(Q[k][1] - Q[k - 10][1], Q[k][0] - Q[k - 10][0]); a1 = math.atan2(Q[k + 10][1] - Q[k][1], Q[k + 10][0] - Q[k][0])
            if abs((a1 - a0 + math.pi) % (2 * math.pi) - math.pi) > 0.1 or abs(p[k + 6] - p[k - 6]) / 48 > 0.05 or beside[max(0, k - 12):k + 13].any(): continue
            p += 1.5 * np.exp(-((s - s[k]) / 8.0) ** 2); R['crests'].append([round(float(Q[k][0]), 1), round(float(Q[k][1]), 1)]); last_ = s[k]
    # THE ENDS, EXACTLY: a bridge's deck, a tower's pad, the road it joins — the profile kept inside the cone of grade
    # G from each (the nearest grade-limited profile to the ground splits its difference with a held point: the roads
    # met their bridges up to 1.8 m off the deck — 9 m under it at the plateau's — and the bot stopped at the step)
    for pin, k in ((R['pin0'], 0), (R['pin1'], n - 1)):
        hold = pin if pin is not None else g[k]
        ds_ = np.maximum(np.abs(s - s[k]) - 12.0, 0)                           # (a level landing: its last 12 m at the end's own height)
        p = np.clip(p, hold - G_ROAD * ds_, hold + G_ROAD * ds_)
    R['Q'], R['y'], R['hp'] = Q, p, len(HP)
    cut_max = max(cut_max, float(np.abs(p - g).max())); R['cut'] = float(np.abs(p - g).max()); R['cut_at'] = Q[int(np.argmax(np.abs(p - g)))]
    # the world's grid: a bed 9 m to each side, eased out by 26 m (not the box's own cells). Each cell takes the height
    # of the road's NEAREST point (one pass over the road, then one write: no sample's easing drags another's bed), and
    # a bed once dug is LOCKED — a road dug after it, passing 20 m off at another height (a switchback's next leg, a
    # road joining at an angle), eased ITS banks through the first one's bed: a 17 m step in 30 m of the Raven Peak
    # climb, the car on its roof (scripts/harness/trackdrive.mjs SET=outland)
    j0 = i0 = 10 ** 9; j1 = i1 = -1
    for k in range(n):
        x, z = Q[k]
        if ib[k] and max(abs(x), abs(z)) < HALF - 30: continue
        j, i = cell(x, z); r = 4
        sl = (slice(max(0, j - r), min(NF, j + r + 1)), slice(max(0, i - r), min(NF, i + r + 1)))
        d = np.hypot(X[sl] - x, Z[sl] - z)
        nearer = d < DM[sl]
        DM[sl] = np.where(nearer, d, DM[sl]); PM[sl] = np.where(nearer, p[k], PM[sl])
        j0, j1, i0, i1 = min(j0, sl[0].start), max(j1, sl[0].stop), min(i0, sl[1].start), max(i1, sl[1].stop)
    for k in HP:                                                               # a hairpin's PAD: level for 18 m round its apex
        x, z = Q[k]
        if max(abs(x), abs(z)) < HALF - 30: continue
        j, i = cell(x, z); r = 6
        sl = (slice(max(0, j - r), min(NF, j + r + 1)), slice(max(0, i - r), min(NF, i + r + 1)))
        d = np.maximum(np.hypot(X[sl] - x, Z[sl] - z) - 9.0, 0)
        nearer = d < DM[sl]
        DM[sl] = np.where(nearer, d, DM[sl]); PM[sl] = np.where(nearer, p[k], PM[sl])
        j0, j1, i0, i1 = min(j0, sl[0].start), max(j1, sl[0].stop), min(i0, sl[1].start), max(i1, sl[1].stop)
    if j1 > 0:
        bb = (slice(j0, j1), slice(i0, i1))
        H[bb] += (PM[bb] - H[bb]) * (1 - smoothstep(9.0, 26.0, DM[bb])) * ~INBOX[bb] * ~LOCK[bb] * ~SPAN[bb]
        LOCK[bb] |= DM[bb] < 10.5
        DM[bb] = 1e9
    # the box's grid: a bed 3 m to each side, eased out by 9 m — the same way
    j0 = i0 = 10 ** 9; j1 = i1 = -1
    for k in np.nonzero(np.maximum(np.abs(Q[:, 0]), np.abs(Q[:, 1])) < HALF + 9)[0]:
        x, z = Q[k]; j, i = int(round((z + HALF) / CELL)), int(round((x + HALF) / CELL)); r = 5
        sl = (slice(max(0, j - r), min(N, j + r + 1)), slice(max(0, i - r), min(N, i + r + 1)))
        if sl[0].stop <= sl[0].start or sl[1].stop <= sl[1].start: continue
        d = np.hypot(XI[sl[1]][None, :] - x, XI[sl[0]][:, None] - z)
        nearer = d < DMI[sl]
        DMI[sl] = np.where(nearer, d, DMI[sl]); PMI[sl] = np.where(nearer, p[k], PMI[sl])
        j0, j1, i0, i1 = min(j0, sl[0].start), max(j1, sl[0].stop), min(i0, sl[1].start), max(i1, sl[1].stop)
    if j1 > 0:
        bb = (slice(j0, j1), slice(i0, i1))
        HI[bb] += (PMI[bb] - HI[bb]) * (1 - smoothstep(3.0, 9.0, DMI[bb])) * ~LOCKI[bb]
        LOCKI[bb] |= DMI[bb] < 3.6
        DMI[bb] = 1e9
    box_m += float(np.hypot(*np.diff(Q[ib], axis=0).T).sum()) if ib.sum() > 1 else 0.0
for b in BRIDGES:
    Lb = math.hypot(b['x1'] - b['x0'], b['z1'] - b['z0']); ux, uz = (b['x1'] - b['x0']) / Lb, (b['z1'] - b['z0']) / Lb
    sl, _, _ = window((b['x0'] + b['x1']) / 2, (b['z0'] + b['z1']) / 2, Lb / 2 + 16)
    along = (X[sl] - b['x0']) * ux + (Z[sl] - b['z0']) * uz; lat = np.abs(-(X[sl] - b['x0']) * uz + (Z[sl] - b['z0']) * ux)
    under = (along > 0) & (along < Lb) & (lat < b['w'] / 2 + 8)
    deck = b['y0'] + (b['y1'] - b['y0']) * along / Lb - b.get('sag', 0) * 4 * (along / Lb) * (1 - along / Lb) - 0.06
    on_land = np.minimum(along, Lb - along) < BRIDGE_EXT + 2                    # (the deck's first and last metres: on the land)
    H[sl] = np.where(under, np.where(on_land, deck, np.minimum(H[sl], deck)), H[sl])
# the world's cells under the box follow the box (as outland.py left them)
k_ = int(round(CF / CELL)); i0 = int(round((FAR_HALF - HALF) / CF)); sub = HI[::k_, ::k_]
H[i0:i0 + sub.shape[0], i0:i0 + sub.shape[1]] = sub
log(f'{sum(r.get("hp", 0) for r in ROADS)} hairpins, each given a level pad')
log(f'dug: no road steeper than {G_ROAD * 100:.0f} %; the deepest cut / fill {cut_max:.1f} m; {box_m / 1000:.2f} km of it inside the valley\'s box')
for R in sorted(ROADS, key=lambda r: -r['cut'])[:5]: log(f"  the deepest: {R['cut']:.1f} m on the road to {R['name']} at {R['cut_at'][0]:.0f}, {R['cut_at'][1]:.0f}")
grades = np.concatenate([np.abs(np.diff(r['y'])) / 4.0 for r in ROADS if len(r['y']) > 1])
log(f'grades along the roads: mean {grades.mean() * 100:.1f} %, steeper than 12 %: {(grades > 0.12).mean() * 100:.0f} % of their length, the steepest {grades.max() * 100:.0f} %')

# ---- the GIANT'S GATE: a stone arch over a road — a straight, level stretch far from everything else
best = None; ARCH_ROAD = None
for R in ROADS:
    if R['name'] in ('Table Rock', 'The World Tree') or R.get('high') or len(R['Q']) < 80: continue
    Q = R['Q']
    for k in range(30, len(Q) - 30, 6):
        x, z = Q[k]
        if not clear_of(x, z, 60, 900) or math.hypot(x - SNOW['x'], z - SNOW['z']) < SNOW['r']: continue
        a0 = math.atan2(*(Q[k] - Q[k - 20])[::-1]); a1 = math.atan2(*(Q[k + 20] - Q[k])[::-1])
        bend = abs((a1 - a0 + math.pi) % (2 * math.pi) - math.pi)
        lean = float(SLOPE[cell(x, z)])
        sc = bend * 3 + lean * 4 - 0.00012 * max(abs(x), abs(z))
        if bend < 0.2 and lean < 0.16 and (best is None or sc < best[0]): best = (sc, x, z, a1, float(R['y'][k])); ARCH_ROAD = R
if best:
    _, ax_, az_, ah, ay = best
    PLACES.append({'kind': 'arch', 'name': "The Giant's Gate", 'x': round(float(ax_), 1), 'z': round(float(az_), 1), 'y': round(ay, 2), 'r': 60, 'rot': round(ah, 3), 'seed': SEED + 1})
    log(f"The Giant's Gate over the road at {ax_:.0f}, {az_:.0f}")
# ---- OFF-ROAD PLACES (the user: "offroad places"), each by a road, on low gentle ground, 700 m from any other place:
#   THE BOULDER FIELD  a 75 m round of ground thick with boulders (Rocks.ts): a way to be picked through it;
#   BLACKWATER BOG     an 85 m hollow of mud (the ground's paint, the tyres' sink: MapData.mudAt), 1.8 m sunk;
#   THE SHALLOWS       a FORD: the road itself dips through 26 m of water half a metre deep (a lake of its own).
ZONES = []
def by_road(R_zone, want_on_road):
    cands = []
    for R in ROADS:
        if R.get('high') or R.get('laid') or len(R['Q']) < 200 or R['name'] in ('a loop', 'The World Tree'): continue
        Q = R['Q']
        for k in range(60, len(Q) - 60, 9):
            x, z = Q[k]
            if max(abs(x), abs(z)) < HALF + 500 or hat(x, z) > 360: continue
            if any(math.hypot(x - q['x'], z - q['z']) < q['r'] + 700 for q in PLACES + ZONES) or any(math.hypot(x - t_['x'], z - t_['z']) < 500 for t_ in TOWERS): continue
            if any(math.hypot(x - (b['x0'] + b['x1']) / 2, z - (b['z0'] + b['z1']) / 2) < 400 for b in BRIDGES): continue
            tg = Q[k + 6] - Q[k - 6]; tg /= np.hypot(*tg); a0 = math.atan2(*(Q[k] - Q[k - 14])[::-1]); a1 = math.atan2(*(Q[k + 14] - Q[k])[::-1])
            bend = abs((a1 - a0 + math.pi) % (2 * math.pi) - math.pi)
            if want_on_road:
                if bend < 0.12 and float(SLOPE[cell(x, z)]) < 0.07 and abs(R['y'][k + 8] - R['y'][k - 8]) < 1.5: cands.append((hat(x, z), x, z, math.atan2(tg[1], tg[0]), float(R['y'][k])))
                continue
            for sd in (-1, 1):
                c = np.array([x, z]) + np.array([-tg[1], tg[0]]) * sd * (R_zone + 16)
                sl, d, _ = window(c[0], c[1], R_zone)
                if d.shape[0] < 4 or LOCK[sl][d < R_zone + 6].any() or float(SLOPE[sl][d < R_zone].max()) > 0.16: continue
                cands.append((float(np.ptp(H[sl][d < R_zone])), float(c[0]), float(c[1]), 0.0, 0.0))
    return min(cands) if cands else None
c_ = by_road(75, False)
if c_: ZONES.append({'kind': 'rocks', 'name': 'The Boulder Field', 'x': round(c_[1], 1), 'z': round(c_[2], 1), 'r': 75})
c_ = by_road(85, False)
if c_:
    sl, d, _ = window(c_[1], c_[2], 110)
    hb_ = float(np.percentile(H[sl][d < 85], 20))
    H[sl] += ((hb_ - 1.8 * np.clip(1 - (d / 85) ** 2, 0, 1)) - H[sl]) * (1 - smoothstep(70, 105, d)) * ~LOCK[sl]
    ZONES.append({'kind': 'bog', 'name': 'Blackwater Bog', 'x': round(c_[1], 1), 'z': round(c_[2], 1), 'r': 85})
c_ = by_road(30, True)
if c_:
    _, fx_, fz_, fa_, fy_ = c_
    sl, d, _ = window(fx_, fz_, 40)
    H[sl] -= 1.0 * np.clip(1 - (d / 28) ** 2, 0, 1)
    LAKES.append({'name': 'The Shallows', 'x': round(fx_, 1), 'z': round(fz_, 1), 'r': 34.0, 'level': round(fy_ - 0.42, 2), 'depth': 0.6, 'ford': True})
    ZONES.append({'kind': 'ford', 'name': 'The Shallows', 'x': round(fx_, 1), 'z': round(fz_, 1), 'r': 34})
for zn in ZONES: PLACES.append({**zn, 'y': round(hat(zn['x'], zn['z']), 2)})
log(f'{len(ZONES)} off-road places: ' + ', '.join(f"{zn['name']} at {zn['x']:.0f}, {zn['z']:.0f}" for zn in ZONES))
MEADOWS = [{'x': wt['x'], 'z': wt['z'], 'r': round(215 * TK)}, {'x': cr['x'], 'z': cr['z'], 'r': 185}] + [{'x': lk['x'], 'z': lk['z'], 'r': round(lk['r'] * 2.1)} for lk in LAKES if lk['name'] == 'Heron Lake']
for v in VIEWS:
    if v['name'] not in missed: PLACES.append({**v, 'y': round(hat(v['x'], v['z']), 2)})        # (the views a road came to)
for p in PLACES: p['y'] = round(hat(p['x'], p['z']), 2) if p['kind'] in ('worldtree',) else p['y']
for i_, p in enumerate(PLACES): p['id'] = 400 + i_

# ---- THE STAGES (the user: "Dirt Rally like places"): the roads worth a run against the clock — each ONE road of
# the net, from where it leaves the others to its end: the pass, the climbs to the views, the mesa's ramp, the run to
# the World Tree, the road through the Giant's Gate, the lakes' roads, the two longest tower roads. The game stands a
# start gate and a finish gate on each, marker posts along it, boards on its bends (Wonders.ts), and names it on the map.
def road_len(R): return float(np.hypot(*np.diff(R['Q'], axis=0).T).sum())
STAGES = []
towers_ = sorted((R for R in ROADS if any(R['name'] == t_['name'] for t_ in TOWERS)), key=lambda R: -road_len(R))[:2]
for i_, R in enumerate(ROADS):
    nm = R['name']; L_ = road_len(R)
    if L_ < 700: continue
    title = ('Whitecrown Pass' if R.get('high') and nm == 'Whitecrown Pass' else f"{nm[:-9]} Climb" if nm.endswith(' Shoulder') else 'Table Rock Hillclimb' if nm == 'Table Rock' and R.get('laid')
             else 'World Tree Run' if nm == 'The World Tree' and not R.get('ring') else "Giant's Gate Sprint" if R is ARCH_ROAD else f'{nm} Run' if any(nm == lk['name'] for lk in LAKES) or nm == 'The Sunken Meadow'
             else f"{nm.replace(' Tower', '').replace(' Lookout', '').replace(' Watch', '')} Stage" if any(R is t_ for t_ in towers_) else None)
    if title: STAGES.append({'name': title, 'line': i_, 'km': round(L_ / 1000, 2), 'climb': round(float(R['y'][-1] - R['y'][0])), 'crests': R.get('crests', [])})
log(f'{len(STAGES)} stages: ' + ', '.join(f"{s_['name']} {s_['km']:.1f} km ({s_['climb']:+d} m)" for s_ in STAGES))

# ================================================================================================== 4. OUT
def u16(A, lo, rg): return np.round(np.clip((A - lo) / rg, 0, 1) * 65535).astype('<u2')
lo, hi = float(H.min()), float(H.max())
m = json.load(open(os.path.join(OUT, 'meta.json')))
m['far'] = {'n': NF, 'step': CF, 'origin': -FAR_HALF, 'min': lo, 'range': hi - lo}
m['inner'] = dict(gi)                                                           # (the box's range as it was: its dug stretches stay inside it)
m['bridges'] = [b for b in m.get('bridges', []) if not b.get('outland')] + BRIDGES
m['water']['falls'] = [f for f in m['water'].get('falls', []) if not f.get('outland')] + ([FALL] if CANYON else [])
m['outland'] = {'play': PLAY, 'peaks': PEAKS, 'snow': SNOW, 'places': PLACES, 'lakes': LAKES, 'stages': STAGES, 'zones': ZONES, 'meadows': MEADOWS,
                'trails': {'hw': 3.3, 'lines': [[[round(float(x), 1), round(float(z), 1)] for x, z in r['Q'][::2].tolist() + ([r['Q'][-1].tolist()] if (len(r['Q']) - 1) % 2 else [])] for r in ROADS]}}
if WRITE:
    u16(H, lo, hi - lo).tofile(os.path.join(OUT, 'far.bin'))
    u16(HI, gi['min'], gi['range']).tofile(os.path.join(OUT, 'height.bin'))
    json.dump(m, open(os.path.join(OUT, 'meta.json'), 'w'), separators=(',', ':'))
    log(f'wrote {OUT}/far.bin, height.bin, meta.json ({sum(len(l) for l in m["outland"]["trails"]["lines"])} road points, {len(PLACES)} places)')
else: log('WRITE=0: nothing written')

if PREVIEW:
    from PIL import Image, ImageDraw
    os.makedirs(PREVIEW, exist_ok=True)
    K = 2; Sx = H[::K, ::K]; gz, gx = np.gradient(Sx, CF * K)
    nrm = np.stack([-gx, np.ones_like(Sx), -gz], -1); nrm /= np.linalg.norm(nrm, axis=-1)[..., None]
    Lg = np.array([-0.5, 0.62, -0.6]); Lg /= np.linalg.norm(Lg)
    sh = np.clip(nrm @ Lg, 0, 1) ** 0.8
    t = np.clip((Sx - 30) / 1400, 0, 1)[..., None]
    col = np.array([0.42, 0.55, 0.3]) * (1 - t) + np.array([0.7, 0.68, 0.6]) * t
    steep = smoothstep(0.55, 0.9, np.hypot(gx, gz))[..., None]
    col = col * (1 - steep) + np.array([0.5, 0.5, 0.52]) * steep
    dsn = np.hypot(X[::K, ::K] - SNOW['x'], Z[::K, ::K] - SNOW['z'])
    line = 900 - (900 - SNOW['line']) * (1 - smoothstep(0.45 * SNOW['r'], SNOW['r'], dsn))
    snow = (smoothstep(line, line + 90, Sx) * (1 - smoothstep(0.5, 0.8, np.hypot(gx, gz))))[..., None]
    col = col * (1 - snow) + np.array([0.95, 0.96, 1.0]) * snow
    img = Image.fromarray((np.clip(col * (0.35 + 0.85 * sh[..., None]), 0, 1) * 255).astype(np.uint8))
    dr = ImageDraw.Draw(img); px = lambda x, z: ((x + FAR_HALF) / (CF * K), (z + FAR_HALF) / (CF * K))
    for hv, c in ((HALF, (255, 255, 255)), (PLAY, (255, 80, 60))): dr.rectangle([*px(-hv, -hv), *px(hv, hv)], outline=c)
    for Ln in meta['trails']['lines']: dr.line([px(x, z) for x, z in Ln], fill=(90, 60, 30), width=1)
    for R in ROADS: dr.line([px(x, z) for x, z in R['Q']], fill=(250, 225, 150) if R['name'] != 'a loop' else (255, 170, 90), width=2)
    for t_ in TOWERS: x, z = px(t_['x'], t_['z']); dr.rectangle([x - 4, z - 4, x + 4, z + 4], fill=(200, 40, 40))
    for b in BRIDGES: dr.line([px(b['x0'], b['z0']), px(b['x1'], b['z1'])], fill=(40, 200, 255), width=4)
    for lk in LAKES:
        if lk.get('canyon'): continue
        x, z = px(lk['x'], lk['z']); r_ = lk['r'] / 1.32 / (CF * K); dr.ellipse([x - r_, z - r_, x + r_, z + r_], fill=(70, 150, 220))
    for p in PLACES:
        x, z = px(p['x'], p['z']); c = {'worldtree': (40, 255, 120), 'crater': (255, 120, 220), 'mesa': (255, 160, 40), 'arch': (255, 255, 60), 'peak': (255, 255, 255)}.get(p['kind'], (120, 200, 255))
        dr.ellipse([x - 6, z - 6, x + 6, z + 6], outline=c, width=3); dr.text((x + 9, z - 6), p['name'], fill=(255, 255, 255))
    img.save(os.path.join(PREVIEW, 'wilds.png'))
    for p in PLACES:
        if p['kind'] in ('worldtree', 'crater', 'mesa', 'arch', 'canyon'):
            x, z = px(p['x'], p['z']); img.crop((int(x - 90), int(z - 90), int(x + 90), int(z + 90))).resize((540, 540), Image.LANCZOS).save(os.path.join(PREVIEW, f"{p['kind']}.png"))
    log('preview written')


