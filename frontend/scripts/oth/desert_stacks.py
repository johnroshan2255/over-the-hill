# OVER THE HILL — the DESERT's STACKED ROCK: a library of slab stacks (numpy; plain python3 or Blender's python).
#
#   python3 scripts/oth/desert_stacks.py [OUT=public/oth/desert/stacks.bin]
#
# 2026-11-04, round 2 — the user: the stacks "look like pancakes stacked". They were: every slab a round pillow with a
# rolled lip, the same thickness, a little smaller than the one under it and centred on it. Real stacked sandstone (and
# the user's reference frames) is built of CHUNKY ANGULAR SLABS:
#   - each slab's OUTLINE a convex polygon of 6–18 corners (a broken tile, never a disc), its own turn;
#   - steep SIDES (a little battered, a little undercut at the foot), a CHAMFERED top edge, a FLAT top;
#   - thickness that VARIES a lot — thin plates between thick beds;
#   - set OFF-CENTRE on the one below, sometimes WIDER than it (an overhang, a hoodoo's cap);
#   - TERRACES: slabs that step back one way, benches a 4x4 crawls up; MASSIFS and WALLS: rocky hills and cliffs
#     built the same way, big enough that the rock is the ground.
# Kinds: table, terrace, mesa, tower, fin, hoodoo, massif, wall. Two LODs (the far one without the undercut and the
# chamfer). Real sizes (metres), y up. Writes:
#   stacks.bin   per kind and LOD: positions (f32 × 3), tone (f32: a per-slab tone 0..1), indices (u32)
#   stacks.json  {kinds: [{kind, radius, height, tris, lods: [[pos byte offset, vertex count, index byte offset,
#                index count] …], slabs: [[x, y, z, …] the slab's corners — its convex hull for the physics]}]}
# desert.py places them (meta.json 'stacks'); Rocks.ts draws them (instanced) and gives the near ones a convex collider
# PER SLAB (Physics.ts): the car drives on the slabs themselves — their tops, their edges — not on a hull round a stack.
import sys, os, math, json
import numpy as np

ARGS = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]) if '=' in a)
OUT = ARGS.get('OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'oth', 'desert', 'stacks.bin'))


def hull2(P):
    """The convex hull of 2D points (monotone chain), counter-clockwise."""
    pts = sorted(set((round(float(x), 4), round(float(z), 4)) for x, z in P))
    if len(pts) < 3: return np.array(pts)
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0: hi.pop()
        hi.append(p)
    return np.array(lo[:-1] + hi[:-1])


def outline(rng, R, ex, rot):
    """A slab's outline: a polygon of 6–18 corners spread round (jittered), each at its own radius — now and then a
    deep NOTCH (a broken-off block) — R across, stretched ex along its own axis (rot). Star-shaped round its middle (the
    top's fan and the insets work from there); the physics takes its convex hull."""
    nc = int(np.clip(round(5 + R * (1 + ex) / 5.5), 6, 18))
    a = (np.arange(nc) + rng.uniform(-0.3, 0.3, nc)) * 2 * math.pi / nc + rng.uniform(0, 2 * math.pi)
    r = R * rng.uniform(0.74, 1.0, nc)
    notch = rng.random(nc) < 0.12
    r = np.where(notch, r * rng.uniform(0.6, 0.78, nc), r)
    lx, lz = np.cos(a) * r * ex, np.sin(a) * r
    c, s = math.cos(rot), math.sin(rot)
    # counter-clockwise in (x, z) (the angles rise): the faces' winding follows it
    return np.stack([lx * c - lz * s, lx * s + lz * c], 1)


def inset(P, d):
    """P pulled in by about d metres toward its centroid (a convex polygon: each corner along its own spoke)."""
    c = P.mean(0)
    v = P - c
    l = np.maximum(np.hypot(v[:, 0], v[:, 1]), 1e-6)
    return c + v * np.maximum(0.15, 1 - d / l)[:, None]


def slab(G, P, y0, t, tone, lod, batter, under, cham):
    """One slab into G (verts, tone, tris): outline P (n, 2) at the foot of its side, y0 .. y0 + t."""
    V, T, F = G
    n = len(P)
    ch = min(cham * t, 0.22 * float(np.min(np.hypot(*(P - P.mean(0)).T))))   # (the chamfer's inset, never past the middle)
    if lod == 0:
        rings = [(0.0, under * t), (0.2, under * t * 0.25), (0.25, 0.0), (1 - min(0.35, cham), batter * t), (1.0, batter * t + ch)]
    else:
        rings = [(0.0, under * t * 0.25), (1.0, batter * t + ch * 0.6)]
    base = len(V)
    for f, d in rings:
        Q = inset(P, d) if d > 0 else P
        for x, z in Q: V.append((x, y0 + f * t, z)); T.append(tone)
    for ri in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            p0, p1, q0, q1 = base + ri * n + i, base + ri * n + j, base + (ri + 1) * n + i, base + (ri + 1) * n + j
            F.append((p0, q0, p1)); F.append((p1, q0, q1))
    # the flat top (a fan from its middle, a hair raised), the bottom closed
    top = base + (len(rings) - 1) * n
    Q = inset(P, rings[-1][1])
    mid = len(V); V.append((float(Q[:, 0].mean()), y0 + t * 1.01, float(Q[:, 1].mean()))); T.append(tone)
    for i in range(n):
        j = (i + 1) % n
        F.append((top + i, mid, top + j))
    bm = len(V); V.append((float(P[:, 0].mean()), y0, float(P[:, 1].mean()))); T.append(tone)
    for i in range(n):
        j = (i + 1) % n
        F.append((base + j, bm, base + i))
    return [(x, y0, z) for x, z in P] + [(x, y0 + t, z) for x, z in inset(P, rings[-1][1])]


# each kind: (slabs, base radius, thickness range, shrink range, offset (× R), elongation, overhang chance, pieces per
# layer along its length — a wall's beds broken at joints)
KIND = {
    'table':   dict(n=(1, 3),  R=(7, 18),  t=(1.2, 3.0), shrink=(0.6, 0.86),  off=0.22, ex=(1.0, 1.6), over=0.0),
    'terrace': dict(n=(4, 8),  R=(16, 30), t=(0.7, 1.4), shrink=(0.74, 0.88), off=0.0,  ex=(1.0, 1.5), over=0.0),
    'mesa':    dict(n=(3, 6),  R=(16, 30), t=(3.0, 8.0), shrink=(0.72, 0.95), off=0.18, ex=(1.0, 1.5), over=0.15),
    'tower':   dict(n=(4, 8),  R=(4.5, 8), t=(3.0, 7.0), shrink=(0.85, 1.06), off=0.22, ex=(1.0, 1.35), over=0.25),
    'fin':     dict(n=(3, 5),  R=(7, 12),  t=(3.0, 6.0), shrink=(0.8, 0.96),  off=0.15, ex=(1.8, 2.6), over=0.15),
    'hoodoo':  dict(n=(3, 6),  R=(2.6, 4.5), t=(2.0, 3.6), shrink=(0.9, 1.04), off=0.16, ex=(1.0, 1.25), over=0.0),
    'massif':  dict(n=(5, 9),  R=(34, 52), t=(4.0, 10.0), shrink=(0.7, 0.9),  off=0.18, ex=(1.0, 1.5), over=0.1),
    'wall':    dict(n=(5, 9),  R=(12, 18), t=(4.5, 10.0), shrink=(0.97, 1.0),  off=0.0,  ex=(2.2, 3.0), over=0.0, pieces=(2, 3)),
}


def stack(kind, rng, lod):
    K = KIND[kind]
    G = ([], [], [])
    hulls = []
    n = int(rng.integers(K['n'][0], K['n'][1] + 1))
    R = rng.uniform(*K['R'])
    ex = rng.uniform(*K['ex'])
    rot0 = 0.0 if kind == 'wall' else rng.uniform(0, math.pi)   # (a wall's long axis along x: desert.py turns it along its cliff)
    lean = rng.uniform(0, 2 * math.pi)                            # (a terrace steps back this way: its benches)
    cx = cz = y = 0.0
    for k in range(n):
        # thickness: most beds in the kind's range, now and then a thin plate or a thick bed
        u = rng.random()
        th = rng.uniform(*K['t']) * (0.45 if u < 0.15 else 1.4 if u > 0.88 else 1.0)
        if kind == 'terrace': th = min(th, 1.5)                   # (every step crawlable: thin, its side a slope)
        batter = rng.uniform(0.0, 0.14) if kind not in ('tower', 'hoodoo') else rng.uniform(0.0, 0.06)
        if kind == 'terrace' or (kind == 'table' and rng.random() < 0.5): batter = rng.uniform(0.9, 1.6)   # (a sloped rim ~35–45°: a 4x4 crawls it)
        under = rng.uniform(0.0, 0.08)
        cham = rng.uniform(0.25, 0.5)
        # a WALL's bed in 2–3 blocks along its length (joints): each its own outline, a little thinner or thicker
        m = int(rng.integers(K['pieces'][0], K['pieces'][1] + 1)) if 'pieces' in K else 1
        for pi in range(m):
            rot = rot0 + (rng.uniform(-0.12, 0.12) if kind in ('wall', 'fin') else rng.uniform(-0.6, 0.6))
            if m > 1:
                L = 2 * R * ex
                px = (-(m - 1) / 2 + pi) * L / m * 0.85 + rng.uniform(-0.05, 0.05) * L / m
                # (the blocks of one bed overlap end to end — a joint, never a gap; the front edge a little in or out)
                P = outline(rng, R * rng.uniform(0.9, 1.05), ex / m * 1.45, rot) + np.array([cx + px, cz + rng.uniform(-0.08, 0.08) * R])
                tp = th * (1.0 if pi == 0 else rng.uniform(0.82, 1.0))
            else:
                P = outline(rng, R, ex, rot) + np.array([cx, cz]); tp = th
            hulls.append(slab(G, P, y, tp, float(rng.random()), lod, batter, under, cham))
        y += th
        # the next slab: smaller (or now and then wider — an overhang), off-centre
        R0 = R
        R *= rng.uniform(*K['shrink'])
        if K['over'] and rng.random() < K['over'] and k < n - 1: R = R0 * rng.uniform(1.02, 1.1)
        if kind == 'wall':
            # a CLIFF: each bed set back into the slope (local +z — desert.py turns +z uphill) by 1.5–5 m: the face
            # steps back as it rises, every bed's lip over the one below in view, nothing hanging over the air
            cz += rng.uniform(0.1, 0.3) * R; cx += rng.uniform(-0.05, 0.05) * R * ex
        elif kind == 'terrace':
            # step back toward the lean: one side's edges near in line (a cliff), the other's a bench each
            step = (R0 - R) * 0.9
            cx += math.cos(lean) * step; cz += math.sin(lean) * step
        elif kind == 'tower':
            cx += rng.uniform(-1, 1) * K['off'] * R; cz += rng.uniform(-1, 1) * K['off'] * R
            R = max(R, 2.6)
        else:
            a = rng.uniform(0, 2 * math.pi); d = rng.uniform(0.3, 1.0) * K['off'] * R
            cx += math.cos(a) * d * (ex if kind in ('wall', 'fin') else 1); cz += math.sin(a) * d * (0.4 if kind == 'wall' else 1)
    if kind == 'hoodoo':                                            # the wide CAP on its column
        th = rng.uniform(1.8, 3.0)
        P = outline(rng, R * rng.uniform(1.9, 2.5), 1.15, rng.uniform(0, math.pi)) + np.array([cx, cz])
        hulls.append(slab(G, P, y, th, float(rng.random()), lod, 0.02, 0.12, 0.4))
        y += th
    if kind == 'tower' and rng.random() < 0.7:                      # a block or two perched on top
        for _ in range(1 + int(rng.random() < 0.4)):
            th = rng.uniform(1.6, 3.2)
            P = outline(rng, R * rng.uniform(0.45, 0.8), 1.2, rng.uniform(0, math.pi)) + np.array([cx + rng.uniform(-1, 1), cz + rng.uniform(-1, 1)])
            hulls.append(slab(G, P, y, th, float(rng.random()), lod, 0.04, 0.06, 0.45))
            y += th
    V, T, F = G
    return np.array(V, np.float32), np.array(T, np.float32), np.array(F, np.uint32), y, hulls


KINDS = ['table'] * 6 + ['terrace'] * 5 + ['mesa'] * 5 + ['tower'] * 6 + ['fin'] * 3 + ['hoodoo'] * 3 + ['massif'] * 4 + ['wall'] * 4
blob = bytearray()
info = []
for vi, kind in enumerate(KINDS):
    entry = {'kind': kind, 'lods': []}
    for lod in (0, 1):
        rng = np.random.default_rng(9001 + vi * 37)                 # (the same seed for both LODs: the same stack)
        V, T, F, hgt, hulls = stack(kind, rng, lod)
        # (the stack's foot centred: its slabs' middle over the origin)
        if lod == 0:
            c = V[:, [0, 2]].mean(0)
            r = float(np.max(np.hypot(V[:, 0] - c[0], V[:, 2] - c[1])))
            entry.update(radius=round(r, 2), height=round(float(hgt), 2), tris=int(len(F)), cx=float(c[0]), cz=float(c[1]))
            entry['slabs'] = [[round(v, 3) for p in h for v in (p[0] - c[0], p[1], p[2] - c[1])] for h in hulls]
        V = V.copy(); V[:, 0] -= entry['cx']; V[:, 2] -= entry['cz']
        po = len(blob); blob += V.tobytes()
        blob += T.tobytes()
        io = len(blob); blob += F.ravel().tobytes()
        entry['lods'].append([po, len(V), io, int(F.size)])
    del entry['cx'], entry['cz']
    info.append(entry)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
open(OUT, 'wb').write(bytes(blob))
with open(OUT.replace('.bin', '.json'), 'w') as f: json.dump({'kinds': info}, f, separators=(',', ':'))
print(f'wrote {OUT}: {len(blob) / 1e3:.0f} kB, {len(KINDS)} stacks; tris LOD0 {sum(i["tris"] for i in info)}')
for i, k in enumerate(info): print(f'  {i:2d} {k["kind"]:8s} r {k["radius"]:5.1f} h {k["height"]:5.1f} tris {k["tris"]:5d} slabs {len(k["slabs"])}')
