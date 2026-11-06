# trackscan.py — every track of a world, read off its baked ground (height.bin, trail.bin): along each centre line
# every 2 m, the GRADE over the car's length (6 m), the SIDE SLOPE across the car (±1.4 m), the 2 m STEP, and how far
# the carved track (trail.bin) sits from the line. Prints the lines with spots over the limits, worst first.
#   python3 scripts/oth/trackscan.py [public/oth/valley] [--json out.json] [--all]
import sys, json, math
import numpy as np

D = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'public/oth/valley'
# (--grade 0.3 --side 0.2 --step 0.45: the limits; --spots: each spot listed)
meta = json.load(open(f'{D}/meta.json'))
g = meta['inner']
N, STEP, ORG = g['n'], g['step'], g['origin']
raw = np.fromfile(f'{D}/height.bin', dtype=np.uint16)
H = (raw[-N * N:].reshape(N, N).astype(np.float64) / 65535.0) * g['range'] + g['min']
trail = np.fromfile(f'{D}/trail.bin', dtype=np.uint8)[-N * N:].reshape(N, N) / 255.0 * 8

def hs(x, z):
    fx = (np.asarray(x) - ORG) / STEP; fz = (np.asarray(z) - ORG) / STEP
    i = np.clip(np.floor(fx).astype(int), 0, N - 2); j = np.clip(np.floor(fz).astype(int), 0, N - 2)
    u = fx - i; v = fz - j
    return (H[j, i] * (1 - u) + H[j, i + 1] * u) * (1 - v) + (H[j + 1, i] * (1 - u) + H[j + 1, i + 1] * u) * v

def td(x, z):
    i = np.clip(np.round((np.asarray(x) - ORG) / STEP).astype(int), 0, N - 1); j = np.clip(np.round((np.asarray(z) - ORG) / STEP).astype(int), 0, N - 1)
    return trail[j, i]

def dense(line):
    pts = []
    for k in range(len(line) - 1):
        (x0, z0), (x1, z1) = line[k], line[k + 1]
        n = max(1, round(math.hypot(x1 - x0, z1 - z0) / 2))
        for t in range(n): pts.append((x0 + (x1 - x0) * t / n, z0 + (z1 - z0) * t / n))
    pts.append(tuple(line[-1]))
    return np.array(pts)

def bridged(x, z):
    out = np.zeros(len(x), bool)
    for b in meta.get('bridges', []):
        dx, dz = b['x1'] - b['x0'], b['z1'] - b['z0']; L2 = dx * dx + dz * dz
        t = ((x - b['x0']) * dx + (z - b['z0']) * dz) / L2
        ox, oz = x - b['x0'] - t * dx, z - b['z0'] - t * dz
        out |= (t > -0.1) & (t < 1.1) & (ox * ox + oz * oz < (b['w'] * 0.5 + 1) ** 2)
    return out

def arg(k, d): return float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
GRADE, SIDE, STEP2 = arg('--grade', 0.30), arg('--side', 0.20), arg('--step', 0.45)
rough = set(meta['trails'].get('rough', []))
gate = meta.get('gate')
rows = []
for li, line in enumerate(meta['trails']['lines']):
    P = dense(line)
    if len(P) < 5: continue
    x, z = P[:, 0], P[:, 1]
    tx = np.gradient(x); tz = np.gradient(z); L = np.hypot(tx, tz) + 1e-9; tx /= L; tz /= L
    nx, nz = -tz, tx
    h = hs(x, z)
    grade = (hs(x + 3 * tx, z + 3 * tz) - hs(x - 3 * tx, z - 3 * tz)) / 6
    side = (hs(x + 1.4 * nx, z + 1.4 * nz) - hs(x - 1.4 * nx, z - 1.4 * nz)) / 2.8
    step = np.abs(np.diff(h, prepend=h[0])) / 2
    off = td(x, z)
    skip = bridged(x, z)
    if gate: skip |= np.hypot(x - gate['x'], z - gate['z']) < 180
    bad = (~skip) & ((np.abs(grade) > GRADE) | (np.abs(side) > SIDE) | (step > STEP2))
    # runs of bad stations → spots
    spots = []
    k = 0
    while k < len(bad):
        if bad[k]:
            e = k
            while e + 1 < len(bad) and (bad[e + 1] or (e + 2 < len(bad) and bad[e + 2])): e += 1
            seg = slice(k, e + 1)
            spots.append({'i': int(k), 'len': int((e - k + 1) * 2), 'x': round(float(x[k:e + 1].mean())), 'z': round(float(z[k:e + 1].mean())),
                          'grade': round(float(np.abs(grade[seg]).max()), 2), 'side': round(float(np.abs(side[seg]).max()), 2), 'step': round(float(step[seg].max()), 2)})
            k = e + 1
        else: k += 1
    rows.append({'line': li, 'rough': li in rough, 'm': int(len(P) * 2), 'maxGrade': round(float(np.abs(grade[~skip]).max()), 2), 'maxSide': round(float(np.abs(side[~skip]).max()), 2),
                 'maxStep': round(float(step[~skip].max()), 2), 'offTrail': round(float(off.max()), 1), 'badM': int(bad.sum() * 2), 'spots': spots})

rows.sort(key=lambda r: -r['badM'])
tot = sum(r['m'] for r in rows); badm = sum(r['badM'] for r in rows)
print(f'{len(rows)} lines, {tot / 1000:.1f} km; over the limits (grade > {GRADE}, side > {SIDE}, 2 m step > {STEP2}): {badm} m in {sum(len(r["spots"]) for r in rows)} spots, {sum(1 for r in rows if r["badM"])} lines')
for r in rows:
    if r['badM'] or '--all' in sys.argv:
        if '--spots' in sys.argv:
            for sp in r['spots']: print('      ', sp)
        print(f"line {r['line']:2d}{' R' if r['rough'] else '  '} {r['m']:5d} m  grade {r['maxGrade']:.2f}  side {r['maxSide']:.2f}  step {r['maxStep']:.2f}  off-trail {r['offTrail']:.1f}  bad {r['badM']} m in {len(r['spots'])}")
if '--json' in sys.argv: json.dump(rows, open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1)
