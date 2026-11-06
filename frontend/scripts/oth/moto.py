# OVER THE HILL — the MOTORBIKE and its RIDER, modelled in Blender (2026-11-05, the user: "it's a cycle, not a bike —
# leave the cycle there, we want a proper bike too, like the stunt bike in GTA 5"). Our own design: a 450 cm³
# four-stroke motocross / enduro bike — perimeter frame, a single-cylinder engine, upside-down fork, a mono-shock
# straight to the swingarm, 21 / 18-inch spoked wheels on knobbly tyres, white and blue plastics; no brand, no decals.
#
#   blender -b --factory-startup --python scripts/oth/moto.py -- [OUT=src/assets/models/vehicles/moto.glb]
#           [PREVIEW=<dir>] [BLEND=scripts/oth/.cache/moto.blend]
#
# EVERY dimension and pivot comes from src/gameplay/vehicle/moto.geometry.json (the physics — MotoSim.ts — and the
# renderer — Bike.ts — read the same file). The mesh tools, the RIDER, the GLB export and its read-back check are the
# mountain bike's (scripts/oth/mtb.py, run here up to its main with this geometry): one rider, dressed here in
# motocross kit (a full-face chin bar, long sleeves, pants, boots). The same contract as mtb.glb: a FLAT list of meshes
# named as Bike.ts's parts, each with its origin at its pivot, identity rotation, unit scale, flat colours by material
# name — the countershaft sprocket is the 'crank' (at bb), the footpegs the 'pedal_r' / 'pedal_l' (at pegs).
import sys, os, math, json

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.normpath(os.path.join(HERE, '..', '..'))
_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
_kw = dict(a.split('=', 1) for a in _argv if '=' in a)
_kw.setdefault('GEO', os.path.join(FRONTEND, 'src', 'gameplay', 'vehicle', 'moto.geometry.json'))
_kw.setdefault('OUT', os.path.join(FRONTEND, 'src', 'assets', 'models', 'vehicles', 'moto.glb'))
_kw.setdefault('BLEND', os.path.join(HERE, '.cache', 'moto.blend'))
sys.argv = [sys.argv[0], '--'] + [f'{k}={v}' for k, v in _kw.items()]

# the mountain bike's library (geometry constants from THIS geometry, mesh tools, the rider, export, verify, previews)
_src = open(os.path.join(HERE, 'mtb.py'), encoding='utf-8').read()
_src = _src[:_src.index('# ===================================================================================================== main')]
exec(compile(_src, os.path.join(HERE, 'mtb.py'), 'exec'), globals())

PEGS = V(G['pegs'])
WH = G['wheel']
R_F_RIM, R_R_RIM, TW_F, TW_R = WH['frontRimRadius'], WH['rearRimRadius'], WH['frontTyreWidth'], WH['rearTyreWidth']
OUTER_R, OUTER_L = G['fork']['outerDiameter'] / 2, G['fork']['outerLength']
SEAT_F, SEAT_B = V(G['seat']['front']), V(G['seat']['back'])
CL = CHAINLINE                       # (−0.095: the chain on the left)
REAR_SPROCKET_R = COG_RMAX
E_SH = unit(SSM - SFM)               # the shock's axis at rest (frame mount → swingarm mount)

MATERIALS.clear()
MATERIALS.update({  # name: (sRGB, roughness)
    'Paint': ('#2563B8', 0.4),          # the shrouds, the fork guards' stripe: deep blue (the game's tint is white)
    'Plastic': ('#ECE9E2', 0.45),       # fenders, side panels, number plates
    'Frame': ('#3C4652', 0.4),          # the perimeter frame: blue-grey
    'Dark': ('#1D1E21', 0.5),
    'Alloy': ('#B7BABE', 0.32),
    'Stanchion': ('#C9A15A', 0.3),      # the fork's outer tubes: gold anodising
    'Chrome': ('#DADDE0', 0.14),        # the fork's inner tubes, the shock shaft
    'Rubber': ('#2B2826', 0.9),
    'Engine': ('#45474B', 0.55),
    'Cover': ('#8C8F94', 0.4),          # the engine's cast covers
    'Pipe': ('#7A5D45', 0.45),          # the header: heat-blued steel
    'Exhaust': ('#B1ADA4', 0.3),        # the silencer: brushed
    'Radiator': ('#2E2F31', 0.7),
    'Saddle': ('#202022', 0.7),
    'Chain': ('#5B5D61', 0.45),
    'Spring': ('#E0B12A', 0.4),         # the shock's coil: yellow
    # the rider's kit (the mountain bike's rider builder's names)
    'Jersey': ('#D9472B', 0.85),        # flame red
    'Shorts': ('#2C3038', 0.85),        # the pants: charcoal
    'Pads': ('#1E1F22', 0.8),           # knee braces, the goggles' frame, the helmet's peak
    'Gloves': ('#D9472B', 0.85),
    'Skin': ('#C38E6B', 0.7),
    'Helmet': ('#F1EEE8', 0.4),
    'Lens': ('#3A8FD8', 0.15),          # blue mirror
    'Shoes': ('#E6E3DC', 0.6),          # white boots
})

# ===================================================================================================== the bike
def plate(pts_outer, normal, th):
    """A plate: the outline points (a convex patch) and the same pushed in by th along −normal: its hull."""
    P = [V(p) for p in pts_outer]
    return hull(P + [p - unit(normal) * th for p in P])

def build_frame():
    p = part('frame', V(0, 0, 0))
    # HEAD TUBE
    p.add(cyl(HTB - AX * 0.012, HTT + AX * 0.012, 0.031, 16), 'Frame')
    for s in (-1, 1):
        # the SPARS: from the head tube back over the engine to the pivot plates (a tall box section)
        C = [HTT - AX * 0.05 + X * s * 0.025, V(s * 0.075, 0.985, -0.17), V(s * 0.088, 0.93, 0.02), V(s * 0.093, 0.80, 0.135), V(s * 0.095, 0.62, 0.15), V(s * 0.097, 0.47, 0.115)]
        P, u = spline(C, 5)
        p.add(sweep(P, along(u, [0.016, 0.017, 0.018, 0.018, 0.02, 0.022]), along(u, [0.026, 0.03, 0.03, 0.028, 0.034, 0.04]), 12, X, 3.0, dome1=0.01), 'Frame')
        # the DOWNTUBES and the CRADLE under the engine
        C = [HTB + X * s * 0.012 - AX * 0.01, V(s * 0.03, 0.70, -0.47), V(s * 0.062, 0.45, -0.34), V(s * 0.07, 0.335, -0.18), V(s * 0.072, 0.335, 0.0), V(s * 0.09, 0.42, 0.105)]
        P, u = spline(C, 5)
        p.add(sweep(P, 0.0145, 0.0165, 10, X, 2.0), 'Frame')
        # the SUBFRAME (alloy): two struts each side up and back under the seat
        p.add(sweep(spline([V(s * 0.088, 0.885, 0.11), V(s * 0.084, 0.90, 0.35), V(s * 0.078, 0.905, 0.62)], 4)[0], 0.011, 0.013, 8, X), 'Alloy')
        p.add(sweep(spline([V(s * 0.093, 0.66, 0.15), V(s * 0.088, 0.76, 0.35), V(s * 0.08, 0.89, 0.58)], 4)[0], 0.009, 0.009, 8, X), 'Alloy')
        # the PIVOT PLATE's boss
        p.add(cyl(PIVOT + X * s * 0.082, PIVOT + X * s * 0.112, 0.03, 14), 'Frame')
        # FOOTPEG BRACKETS
        pg = V(s * 0.13, PEGS[1], PEGS[2])
        p.add(hull([pg + V(0, -0.02, -0.03), pg + V(0, 0.03, -0.03), pg + V(0, -0.02, 0.03), pg + V(0, 0.03, 0.03),
                    V(s * 0.095, 0.47, 0.08), V(s * 0.095, 0.47, 0.15), V(s * 0.095, 0.40, 0.11)]), 'Dark')
    p.add(cyl(PIVOT - X * 0.118, PIVOT + X * 0.118, 0.011, 10), 'Alloy')
    # the shock's tower: a cross-member through the frame mount
    p.add(cyl(SFM - X * 0.09, SFM + X * 0.09, 0.016, 12), 'Frame')
    # ---- THE ENGINE: crankcases, the cylinder (leaning forward a little), its head, the covers, a skid plate ----
    cc = []
    for x in (-0.08, 0.08):
        cc += list(ring(V(x, 0.49, -0.10), Y, Z, 0.125, 0.165, 18, 2.6))
    p.add(hull(cc), 'Engine')
    lean = unit(V(0, 1, -0.22))
    ax_ = np.cross(lean, X)
    cyl_pts = []
    for t, hw, hd in ((0.0, 0.065, 0.075), (0.18, 0.06, 0.07), (0.27, 0.07, 0.085), (0.34, 0.062, 0.075)):
        c = V(0, 0.585, -0.165) + lean * t
        cyl_pts += [c + X * a * hw + ax_ * b * hd for a in (-1, 1) for b in (-1, 1)]
    p.add(hull(cyl_pts[:8]), 'Engine')
    p.add(hull(cyl_pts[8:]), 'Cover')
    # cooling fins on the cylinder
    for t in (0.04, 0.08, 0.12, 0.16):
        c = V(0, 0.585, -0.165) + lean * t
        p.add(hull([c + X * a * 0.07 + ax_ * b * 0.08 + lean * dz for a in (-1, 1) for b in (-1, 1) for dz in (-0.004, 0.004)]), 'Engine')
    p.add(ellipsoid(V(0.088, 0.47, -0.07), (0.028, 0.095, 0.115), None, 16, 8), 'Cover')      # the clutch cover (right)
    p.add(ellipsoid(V(-0.084, 0.47, -0.02), (0.024, 0.08, 0.09), None, 16, 8), 'Cover')      # the ignition cover (left)
    p.add(plate([V(-0.075, 0.34, -0.30), V(0.075, 0.34, -0.30), V(0.075, 0.325, 0.02), V(-0.075, 0.325, 0.02), V(-0.06, 0.40, -0.36), V(0.06, 0.40, -0.36)], Y, 0.006), 'Dark')
    # the carburettor / throttle body and the intake to the airbox
    p.add(cyl(V(0, 0.76, -0.12), V(0, 0.80, 0.08), 0.03, 12), 'Dark')
    # RADIATORS (either side of the downtubes)
    for s in (-1, 1):
        p.add(hull([V(s * x, y, z) for x in (0.065, 0.11) for y in (0.56, 0.85) for z in (-0.43, -0.29)]), 'Radiator')
    # ---- THE TANK, the SHROUDS over it and the radiators ----
    tk = []
    for z, y0, y1, hw in ((-0.33, 0.93, 1.06, 0.07), (-0.24, 0.90, 1.08, 0.12), (-0.08, 0.88, 1.035, 0.12), (0.02, 0.90, 0.99, 0.09)):
        tk += [V(a * hw, y, z) for a in (-1, 1) for y in (y0, y1)] + [V(0, y1 + 0.008, z)]
    p.add(hull(tk), 'Plastic')
    for s in (-1, 1):
        sh = [V(s * 0.125, 1.04, -0.28), V(s * 0.13, 1.0, -0.06), V(s * 0.155, 0.80, -0.08), V(s * 0.17, 0.62, -0.22), V(s * 0.165, 0.62, -0.42), V(s * 0.14, 0.86, -0.47), V(s * 0.12, 1.02, -0.36)]
        p.add(plate(sh, V(s, 0.25, 0), 0.012), 'Paint')
    # ---- THE SEAT: long and flat from the tank to the fender ----
    C = [SEAT_F, V(0, 0.975, 0.05), V(0, 0.958, 0.30), SEAT_B]
    P, u = spline(C, 6)
    p.add(sweep(P, along(u, [0.085, 0.11, 0.105, 0.075]), along(u, [0.03, 0.04, 0.04, 0.03]), 14, X, 3.4, dome0=0.02, dome1=0.02), 'Saddle')
    # the AIRBOX between the side panels, the SIDE PANELS (number boards)
    p.add(hull([V(a * 0.085, y, z) for a in (-1, 1) for y in (0.66, 0.9) for z in (0.06, 0.38)]), 'Dark')
    for s in (-1, 1):
        p.add(plate([V(s * 0.118, 0.93, 0.12), V(s * 0.115, 0.935, 0.52), V(s * 0.105, 0.80, 0.50), V(s * 0.11, 0.70, 0.30), V(s * 0.12, 0.72, 0.14)], V(s, 0, 0), 0.01), 'Plastic')
    # the REAR FENDER, up and out behind the seat; the tail light
    C = [V(0, 0.905, 0.34), V(0, 0.95, 0.60), V(0, 1.0, 0.82), V(0, 1.05, 0.99)]
    P, u = spline(C, 6)
    p.add(sweep(P, along(u, [0.11, 0.12, 0.105, 0.08]), 0.009, 12, X, 5.0), 'Plastic')
    p.add(hull([V(a * 0.03, y, z) for a in (-1, 1) for y in (1.0, 1.03) for z in (0.94, 0.985)]), 'Dark')
    # ---- THE EXHAUST: the header out of the head, down round the right and back to the silencer ----
    C = [V(0.0, 0.79, -0.27), V(0.04, 0.73, -0.35), V(0.11, 0.60, -0.31), V(0.135, 0.60, -0.12), V(0.14, 0.70, 0.07), V(0.145, 0.79, 0.24)]
    P, u = spline(C, 6)
    p.add(sweep(P, 0.021, 0.021, 10), 'Pipe')
    s0, s1 = V(0.148, 0.80, 0.24), V(0.152, 0.925, 0.71)
    p.add(revolve(s0, s1 - s0, [(0.0, 0.0), (0.0, 0.03), (0.05, 0.05), (np.linalg.norm(s1 - s0) - 0.03, 0.052), (np.linalg.norm(s1 - s0), 0.042), (np.linalg.norm(s1 - s0), 0.0)], 16), 'Exhaust')
    p.add(revolve(s1, s1 - s0, [(-0.002, 0.0), (-0.002, 0.044), (0.03, 0.04), (0.035, 0.022), (0.035, 0.0)], 14), 'Dark')
    # the levers by the pegs: the rear brake (right), the gear shifter (left)
    p.add(sweep(np.array([V(0.115, 0.43, 0.06), V(0.13, 0.40, -0.06), V(0.135, 0.41, -0.13)]), 0.008, 0.006, 6, X), 'Dark')
    p.add(sweep(np.array([V(-0.105, 0.47, -0.02), V(-0.13, 0.46, -0.10), V(-0.14, 0.465, -0.15)]), 0.007, 0.006, 6, X), 'Dark')
    return p

def build_steer():
    p = part('steer', CROWN)
    lo, hi = CROWN, STT - AX * 0.02
    for c, th in ((lo, 0.026), (hi, 0.02)):
        pts = []
        for s in (-1, 1):
            pts += list(ring(c + X * s * STAN_HS - AX * th / 2, X, FWD, OUTER_R + 0.012, OUTER_R + 0.012, 12)) + list(ring(c + X * s * STAN_HS + AX * th / 2, X, FWD, OUTER_R + 0.012, OUTER_R + 0.012, 12))
        pts += list(ring(c - FWD * 0.012, X, FWD, 0.035, 0.035, 8))
        p.add(hull(pts), 'Alloy')
    # the OUTER TUBES (held in the clamps), the caps
    bottom = STT - AX * OUTER_L
    for s in (-1, 1):
        p.add(cyl(bottom + X * s * STAN_HS, STT + X * s * STAN_HS + AX * 0.005, OUTER_R, 16), 'Stanchion')
        p.add(cyl(bottom + X * s * STAN_HS - AX * 0.002, bottom + X * s * STAN_HS + AX * 0.018, OUTER_R + 0.003, 16), 'Dark')
        p.add(cyl(STT + X * s * STAN_HS, STT + X * s * STAN_HS + AX * 0.02, OUTER_R - 0.004, 12), 'Dark')
    # the BAR clamps (risers), the BAR with its pad, the GRIPS, the LEVERS
    for s in (-1, 1):
        p.add(cyl(STT + X * s * 0.045, BARCLAMP + X * s * 0.045, 0.014, 10), 'Dark')
    gl, gr = GRIPS
    C = [gl + X * -0.04, gl + X * 0.06 + V(0, -0.004, -0.012), V(-0.17, BARCLAMP[1] + 0.012, BARCLAMP[2] + 0.02), V(0, BARCLAMP[1], BARCLAMP[2]),
         V(0.17, BARCLAMP[1] + 0.012, BARCLAMP[2] + 0.02), gr + X * -0.06 + V(0, -0.004, -0.012), gr + X * 0.04]
    P, u = spline(C, 5)
    p.add(sweep(P, along(u, [0.011, 0.011, 0.014, 0.014, 0.014, 0.011, 0.011]), None, 12), 'Alloy')
    p.add(cyl(BARCLAMP - X * 0.11 + Y * 0.012, BARCLAMP + X * 0.11 + Y * 0.012, 0.022, 12), 'Dark')       # the bar pad
    for g, s in ((gl, -1), (gr, 1)):
        p.add(cyl(g - X * s * 0.075, g + X * s * 0.045, 0.0165, 14), 'Rubber')
        perch = g - X * s * 0.095
        p.add(ellipsoid(perch, (0.02, 0.02, 0.024), None, 10, 6), 'Dark')
        C = [perch + V(0, 0, -0.015), perch + V(s * 0.05, -0.012, -0.065), perch + V(s * 0.12, -0.02, -0.075)]
        p.add(sweep(spline(C, 3)[0], 0.0065, 0.0045, 6, Y, dome1=0.004), 'Alloy')
    # the FRONT NUMBER PLATE over the clamps
    c = STT + FWD * 0.075 - AX * 0.08
    up = unit(AX - FWD * 0.35)
    np_ = [c + X * a * 0.13 + up * b * 0.12 for a, b in ((-1, -0.7), (1, -0.7), (1, 0.8), (0.6, 1.1), (-0.6, 1.1), (-1, 0.8))]
    p.add(plate(np_, FWD, 0.008), 'Plastic')
    # the FRONT FENDER, under the lower clamp, high over the tyre
    a0 = CROWN - AX * 0.065
    C = [a0 - FWD * 0.20 - AX * 0.03, a0 - FWD * 0.05, a0 + FWD * 0.15, a0 + FWD * 0.33 + AX * 0.02]
    P, u = spline(C, 6)
    p.add(sweep(P, along(u, [0.06, 0.075, 0.075, 0.06]), 0.008, 12, X, 5.0), 'Plastic')
    return p

def build_lowers():
    p = part('fork_lowers', FA)
    for s in (-1, 1):
        b = FA + X * s * STAN_HS
        p.add(cyl(b + AX * 0.05, b + AX * LOWERS_L, STAN_R, 16), 'Chrome')
        # the AXLE LUG round the tube's foot and the axle
        pts = list(ring(b - AX * 0.035, AX, FWD, 0.03, 0.03, 12)) + list(ring(b + AX * 0.075, AX, FWD, STAN_R + 0.006, STAN_R + 0.006, 12))
        pts += list(ring(FA + X * s * 0.076, X, Y, 0.022, 0.022, 10))
        p.add(hull(pts), 'Dark')
        # the FORK GUARD over the front of the inner tube
        g0, g1 = b + AX * 0.06 + FWD * (STAN_R + 0.006), b + AX * 0.40 + FWD * (STAN_R + 0.006)
        p.add(plate([g0 + X * 0.03, g0 - X * 0.03, g1 - X * 0.03, g1 + X * 0.03, (g0 + g1) / 2 + FWD * 0.012], FWD, 0.022), 'Plastic')
    p.add(cyl(FA - X * 0.128, FA + X * 0.128, 0.011, 10), 'Alloy')
    # the CALIPER (left, behind the leg, astride the disc)
    d = unit(-FWD * 0.75 + AX * 0.66)
    c = FA + d * 0.115 + X * -0.058
    p.add(hull([c + d * a * 0.04 + np.cross(d, X) * b * 0.022 + X * e * 0.02 for a in (-1, 1) for b in (-1, 1) for e in (-1, 1)]), 'Dark')
    return p

def mx_tyre(p, C, R, rim_r, width, knob, rear):
    """A motocross tyre: the carcass from bead to bead, tall square knobs in staggered rows."""
    a = width / 2
    crown = R - knob
    b = (crown - (rim_r + 0.012)) / 1.6
    rc = crown - b
    ths = [-2.25, -1.85, -1.3, -0.75, -0.3, 0.0, 0.3, 0.75, 1.3, 1.85, 2.25]
    prof = [(a * math.sin(t), rc + b * math.cos(t)) for t in ths]
    p.add(revolve(C, X, prof, 36), 'Rubber')
    U, W = basis(X)
    def blk(phi, th, ht, hw):
        x, r = a * math.sin(th), rc + b * math.cos(th)
        nx, nr = math.sin(th) / a, math.cos(th) / b
        nn = math.hypot(nx, nr); nx, nr = nx / nn, nr / nn
        er = math.cos(phi) * U + math.sin(phi) * W; ep = -math.sin(phi) * U + math.cos(phi) * W
        N = nx * X + nr * er; T1 = ep; T2 = np.cross(N, T1)
        base = C + x * X + r * er - 0.006 * N; top = base + (knob + 0.006) * N
        p.add(hull([base + s1 * ht * T1 + s2 * hw * T2 for s1 in (-1, 1) for s2 in (-1, 1)] + [top + 0.8 * (s1 * ht * T1 + s2 * hw * T2) for s1 in (-1, 1) for s2 in (-1, 1)]), 'Rubber')
    n = 26 if rear else 30
    for k in range(n):
        phi = 2 * math.pi * k / n
        for s in (-1, 1): blk(phi + (0.04 if k % 2 else 0.0), s * 1.5, 0.011, 0.01)
        if k % 2 == 0:
            for s in (-1, 1): blk(phi, s * 0.62, 0.012, 0.011)
        else:
            blk(phi, 0.0, 0.011, 0.02 if rear else 0.014)

def spoked(p, C, rim_r, rim_w, hub_hw, n_spokes=36):
    rw = rim_w / 2
    p.add(revolve(C, X, [(rw - 0.003, rim_r + 0.012), (rw, rim_r + 0.008), (rw, rim_r - 0.006), (0.012, rim_r - 0.016), (-0.012, rim_r - 0.016), (-rw, rim_r - 0.006), (-rw, rim_r + 0.008), (-rw + 0.003, rim_r + 0.012)], 36), 'Dark')
    p.add(revolve(C, X, [(-hub_hw, 0.0), (-hub_hw, 0.02), (-hub_hw + 0.012, 0.042), (-hub_hw + 0.02, 0.044), (-0.03, 0.03), (0.03, 0.03), (hub_hw - 0.02, 0.044), (hub_hw - 0.012, 0.042), (hub_hw, 0.02), (hub_hw, 0.0)], 14), 'Alloy')
    U, W = basis(X)
    for i in range(n_spokes):
        phi = 2 * math.pi * i / n_spokes
        side = 1 if i % 2 == 0 else -1
        lead = 1 if (i // 2) % 2 == 0 else -1
        hphi = phi + lead * 3 * (2 * math.pi / n_spokes)
        h = C + X * side * (hub_hw - 0.016) + 0.04 * (math.cos(hphi) * U + math.sin(hphi) * W)
        r = C + X * side * 0.006 + (rim_r - 0.015) * (math.cos(phi) * U + math.sin(phi) * W)
        p.add(sweep([h, r], 0.0019, None, 3, cap0='none', cap1='none'), 'Alloy')

def disc(p, C, x, R, r_in):
    p.add(revolve(C + X * x, X, [(-0.002, r_in), (-0.002, R), (0.002, R), (0.002, r_in)], 32, closed=True), 'Alloy')
    U, W = basis(X)
    for k in range(6):
        a0 = 2 * math.pi * k / 6
        er = math.cos(a0) * U + math.sin(a0) * W; et = -math.sin(a0) * U + math.cos(a0) * W
        p.add(hull([C + X * (x + dx) + er * rr + et * w for dx in (-0.002, 0.002) for rr, w in ((0.035, 0.008), (r_in + 0.004, 0.006)) for w in (w, -w)]), 'Dark')

def sprocket(p, C, x, R, teeth, mat='Alloy'):
    U, W = basis(X)
    verts, faces = [], []
    rt, rr = R + 0.006, R - 0.003
    for xx in (x - 0.003, x + 0.003):
        verts.append(C + X * xx)
        for j in range(2 * teeth):
            a = math.pi * j / teeth
            verts.append(C + X * xx + (rt if j % 2 == 0 else rr) * (math.cos(a) * U + math.sin(a) * W))
    m = 2 * teeth
    for j in range(m):
        faces.append([0, 1 + (j + 1) % m, 1 + j][::-1])
        faces.append([m + 1, m + 2 + j, m + 2 + (j + 1) % m][::-1])
        faces.append([1 + j, 1 + (j + 1) % m, m + 2 + (j + 1) % m, m + 2 + j])
    p.add((np.array(verts), faces), mat)

def build_wheels():
    f = part('wheel_front', FA)
    mx_tyre(f, FA, R_TYRE, R_F_RIM, TW_F, 0.014, False)
    spoked(f, FA, R_F_RIM, 0.042, HUB_F / 2)
    disc(f, FA, -0.058, DISC_R, DISC_R - 0.03)
    r = part('wheel_rear', RA)
    mx_tyre(r, RA, R_TYRE, R_R_RIM, TW_R, 0.016, True)
    spoked(r, RA, R_R_RIM, 0.055, HUB_R / 2)
    disc(r, RA, 0.07, 0.11, 0.085)
    sprocket(r, RA, CL, REAR_SPROCKET_R, 50)
    return f, r

def build_swingarm():
    p = part('swingarm', PIVOT)
    for s in (-1, 1):
        C = [PIVOT + X * s * 0.078, V(s * 0.094, PIVOT[1] - 0.005, PIVOT[2] + 0.12), V(s * 0.108, RA[1] + 0.035, RA[2] - 0.25), V(s * 0.116, RA[1] + 0.008, RA[2] - 0.03)]
        P, u = spline(C, 5)
        p.add(sweep(P, along(u, [0.022, 0.02, 0.017, 0.016]), along(u, [0.04, 0.038, 0.03, 0.026]), 12, X, 3.4), 'Alloy')
        p.add(hull([RA + X * s * xx + V(0, dy, dz) for xx in (0.104, 0.13) for dy in (-0.03, 0.03) for dz in (-0.05, 0.035)]), 'Alloy')   # the axle block
    p.add(cyl(PIVOT - X * 0.105, PIVOT + X * 0.105, 0.026, 14), 'Alloy')
    # the cross-member behind the tyre's front and the SHOCK MOUNT on it
    q = PIVOT + V(0, -0.005, 0.18)
    p.add(sweep(np.array([q + X * -0.09, q + V(0, 0.03, 0.02), q + X * 0.09]), 0.022, 0.03, 10, Z), 'Alloy')
    p.add(hull([SSM + X * a * 0.022 + V(0, dy, dz) for a in (-1, 1) for dy in (-0.03, 0.02) for dz in (-0.05, 0.03)] + [q + X * a * 0.03 for a in (-1, 1)]), 'Alloy')
    p.add(cyl(SSM - X * 0.024, SSM + X * 0.024, 0.008, 8), 'Dark')
    # the CHAIN SLIDER over the left arm, the CHAIN GUIDE under it at the back, the rear CALIPER (right) and the axle
    p.add(sweep(np.array([PIVOT + V(-0.088, 0.03, 0.0), PIVOT + V(-0.092, 0.02, 0.22)]), 0.012, 0.012, 8, X), 'Dark')
    g = RA + V(CL, -0.11, -0.22)
    p.add(hull([g + V(dx, dy, dz) for dx in (-0.012, 0.012) for dy in (-0.035, 0.03) for dz in (-0.05, 0.05)] + [RA + V(-0.11, -0.03, -0.21), RA + V(-0.11, -0.03, -0.27)]), 'Dark')
    c = RA + V(0.088, 0.075, 0.045)
    p.add(hull([c + V(dx, dy, dz) for dx in (-0.018, 0.018) for dy in (-0.04, 0.04) for dz in (-0.025, 0.025)]), 'Dark')
    p.add(cyl(RA - X * 0.135, RA + X * 0.135, 0.011, 10), 'Alloy')
    return p

def helix(c, axis, r, a0, a1, turns, wire, m=6, per=14):
    U, W = basis(axis)
    n = max(8, int(turns * per))
    pts = [c + axis * (a0 + (a1 - a0) * i / n) + r * (math.cos(2 * math.pi * turns * i / n) * U + math.sin(2 * math.pi * turns * i / n) * W) for i in range(n + 1)]
    return sweep(np.array(pts), wire, None, m, cap0='flat', cap1='flat')

def build_shock():
    E = E_SH
    b = part('shock_body', SFM)
    b.add(cyl(SFM - X * 0.016, SFM + X * 0.016, 0.017, 14), 'Dark')
    b.add(revolve(SFM, E, [(0.015, 0.0), (0.015, 0.022), (0.03, 0.03), (0.05, 0.032), (0.06, 0.03), (0.30, 0.027), (0.30, 0.0)], 16), 'Dark')
    b.add(revolve(SFM, E, [(0.045, 0.0), (0.045, 0.046), (0.055, 0.046), (0.055, 0.0)], 16), 'Alloy')          # the spring's top perch
    up = unit(np.cross(E, X)) if (np.cross(E, X) @ Y) > 0 else -unit(np.cross(E, X))
    ro = SFM + up * 0.0 + X * 0.05
    b.add(cyl(ro + E * 0.02, ro + E * 0.20, 0.022, 12), 'Dark')                                                # the reservoir (right)
    b.add(helix(SFM, E, 0.038, 0.06, 0.27, 5.0, 0.0065), 'Spring')
    s = part('shock_shaft', SSM)
    s.add(cyl(SSM - X * 0.016, SSM + X * 0.016, 0.016, 14), 'Dark')
    s.add(revolve(SSM, -E, [(0.012, 0.0), (0.012, 0.02), (0.035, 0.02), (0.035, 0.0)], 12), 'Dark')
    s.add(cyl(SSM - E * 0.03, SSM - E * 0.26, 0.009, 10), 'Chrome')
    s.add(revolve(SSM, -E, [(0.05, 0.0), (0.05, 0.047), (0.06, 0.047), (0.06, 0.0)], 16), 'Alloy')            # the spring's lower perch
    s.add(helix(SSM, -E, 0.041, 0.065, 0.26, 4.6, 0.0065), 'Spring')
    return b, s

def build_crank():
    p = part('crank', BB)
    sprocket(p, BB, CL, RING_R, RING_T, 'Dark')
    p.add(cyl(BB + X * (CL - 0.006), BB + X * (CL + 0.02), 0.016, 10), 'Dark')
    return p

def build_pegs():
    out = []
    for name, sx in (('pedal_r', 1), ('pedal_l', -1)):
        o = V(sx * PEGS[0], PEGS[1], PEGS[2])
        p = part(name, o)
        hx, hy, hz = PEDAL_SIZE[0] / 2, PEDAL_SIZE[1] / 2, PEDAL_SIZE[2] / 2
        p.add(hull([o + V(a * hx, b * hy, c * hz) for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)]), 'Alloy')
        for k in range(5):
            x = o[0] + (k - 2) * hx * 0.42
            for zz in (-hz, hz):
                p.add(hull([V(x + dx, o[1] + hy + dy, o[2] + zz * 0.85 + dz) for dx in (-0.006, 0.006) for dy in (-0.004, 0.008) for dz in (-0.005, 0.005)]), 'Alloy')
        out.append(p)
    return out

def chain_loop():
    """The chain's pitch line: the outer tangents between the two sprockets and the arcs round them (a 2D hull)."""
    pts = []
    for c, r in ((BB, RING_R), (RA, REAR_SPROCKET_R)):
        for k in range(72):
            a = 2 * math.pi * k / 72
            pts.append((c[2] + r * math.cos(a), c[1] + r * math.sin(a)))
    pts = sorted(set(pts))
    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0: h.pop()
            h.append(q)
        return h
    lo, hi = half(pts), half(pts[::-1])
    loop = lo[:-1] + hi[:-1]
    P = np.array([[CL, y, z] for z, y in loop])
    seg = np.linalg.norm(np.roll(P, -1, 0) - P, axis=1); L = seg.sum()
    N = int(L / 0.0159) // 2 * 2
    cum = np.concatenate([[0], np.cumsum(seg)]); Pc = np.vstack([P, P[:1]])
    s = np.linspace(0, L, N, endpoint=False)
    return np.column_stack([np.interp(s, cum, Pc[:, k]) for k in range(3)]), L

def build_chain():
    p = part('chain', BB)
    P, L = chain_loop()
    n = len(P)
    T = np.roll(P, -1, 0) - np.roll(P, 1, 0); T /= np.linalg.norm(T, axis=1)[:, None]
    rs = []
    for i in range(n):
        A = unit(X - T[i] * (X @ T[i])); B = np.cross(T[i], A)
        hw, hh = (0.0045, 0.0062) if i % 2 == 0 else (0.004, 0.005)
        rs.append(np.array([P[i] + A * hw + B * hh, P[i] - A * hw + B * hh, P[i] - A * hw - B * hh, P[i] + A * hw - B * hh]))
    p.add(skin(rs, closed=True), 'Chain')
    log(f'  chain: {n} samples, {L:.3f} m round')
    return p

def mx_kit():
    """The mountain bike's rider in motocross kit: a chin bar (a full-face helmet), long sleeves, pants, boots."""
    J = rider_joints()
    hd, fa, shin = RD['head'], RD['forearm'], RD['shin']
    o = J['r_head']; p = PARTS['r_head']
    # the CHIN BAR: round the jaw from cheek to cheek, out in front of the mouth, joined to the shell's flanks
    C = [o + V(-0.098, hd * 0.47, 0.02), o + V(-0.095, hd * 0.30, -0.045), o + V(-0.05, hd * 0.24, -0.125), o + V(0, hd * 0.23, -0.14),
         o + V(0.05, hd * 0.24, -0.125), o + V(0.095, hd * 0.30, -0.045), o + V(0.098, hd * 0.47, 0.02)]
    P, u = spline(C, 4)
    p.add(sweep(P, along(u, [0.02, 0.026, 0.03, 0.032, 0.03, 0.026, 0.02]), along(u, [0.045, 0.04, 0.035, 0.035, 0.035, 0.04, 0.045]), 12, None, 2.4, dome0=0.01, dome1=0.01), 'Helmet')
    p.add(hull([o + V(a * 0.1, hd * y, z) for a in (-1, 1) for y, z in ((0.44, 0.04), (0.6, 0.06), (0.36, 0.09), (0.55, 0.11))]), 'Helmet')   # the shell's flanks down to the bar
    for s, k in ((-1, 'l'), (1, 'r')):
        o = J[f'r_forearm_{k}']
        PARTS[f'r_forearm_{k}'].add(limb(o, [(0.0, 0.045, 0.046, 0.003), (-0.06, 0.047, 0.047, 0.004), (-0.14, 0.042, 0.04, 0.002), (-(fa - 0.045), 0.036, 0.031, 0.0)], 14, dome0=0.045), 'Jersey')
        o = J[f'r_shin_{k}']
        sp = PARTS[f'r_shin_{k}']
        sp.add(limb(o, [(0.0, 0.06, 0.06, 0.0), (-0.08, 0.057, 0.06, 0.006), (-0.13, 0.054, 0.058, 0.008)], 14, dome0=0.058), 'Shorts')
        sp.add(limb(o, [(-0.12, 0.058, 0.064, 0.01), (-0.2, 0.054, 0.062, 0.008), (-0.3, 0.05, 0.056, 0.004), (-(shin - 0.02), 0.048, 0.054, 0.0), (-shin - 0.01, 0.05, 0.056, 0.0)], 14), 'Shoes')
        sp.add(limb(o, [(-0.13, 0.06, 0.066, 0.01), (-0.145, 0.06, 0.066, 0.01)], 14), 'Pads')       # the boot's top strap
        fo = J[f'r_foot_{k}']
        PARTS[f'r_foot_{k}'].add(limb(fo, [(0.012, 0.052, 0.058, 0.004), (-0.03, 0.052, 0.06, 0.0)], 12), 'Shoes')   # the ankle

def build_all():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    make_materials()
    build_frame(); build_steer(); build_lowers(); build_wheels(); build_swingarm(); build_shock(); build_crank(); build_pegs(); build_chain()
    build_rider()   # (the mountain bike's rider, a stand-in: a proper character GLB comes later — the user, 2026-11-05)

def expected_origins():
    E = {'frame': V(0, 0, 0), 'steer': CROWN, 'fork_lowers': FA, 'wheel_front': FA, 'wheel_rear': RA, 'swingarm': PIVOT, 'shock_body': SFM,
         'shock_shaft': SSM, 'crank': BB, 'pedal_r': V(PEGS[0], PEGS[1], PEGS[2]), 'pedal_l': V(-PEGS[0], PEGS[1], PEGS[2]), 'chain': BB}
    E.update(rider_joints())
    return E

def moto_checks():
    """What the model depends on: the tyres clear the fenders at full travel, the fork's lowers clear its outer tubes'
    feet, the swingarm clears the tyre."""
    tyre_top_f = FA + AX * TRAVEL + Y * R_TYRE
    fender_y = (CROWN - AX * 0.065)[1]
    log(f'  front tyre top at full travel y {tyre_top_f[1]:.3f} (z {tyre_top_f[2]:.3f}); the fender\'s root y {fender_y:.3f}')
    lug_top = FA + AX * (0.075 + TRAVEL); outer_foot = STT - AX * OUTER_L
    log(f'  fork: the lug\'s top at full travel {np.linalg.norm(lug_top - FA):.3f} m up the axis; the outer tubes\' feet at {np.linalg.norm(outer_foot - FA):.3f} m — clear by {(outer_foot - lug_top) @ AX * 1000:.0f} mm')
    log(f'  shock: eye to eye {EYE2EYE * 1000:.0f} mm, stroke {STROKE * 1000:.0f} mm, swing {math.degrees(SWING_MAX):.1f}° for {WHEEL_TRAVEL * 1000:.0f} mm')

def previews_moto(objs):
    scn = bpy.context.scene
    cam = setup_scene(scn)
    shoot(scn, cam, '01_side_right', (4.0, 0.75, 0.0), (0, 0.75, 0.0), ortho=2.4)
    shoot(scn, cam, '02_side_left', (-4.0, 0.75, 0.0), (0, 0.75, 0.0), ortho=2.4)
    shoot(scn, cam, '03_threequarter_front', (2.4, 1.6, -2.8), (0, 0.65, 0.0), 40)
    shoot(scn, cam, '04_threequarter_rear', (-2.2, 1.6, 2.8), (0, 0.65, 0.0), 40)
    shoot(scn, cam, '05_front', (0.0, 1.0, -4.0), (0, 0.8, 0.0), ortho=1.6)
    shoot(scn, cam, '06_top', (0.0, 4.0, 0.001), (0, 0.0, 0.0), ortho=2.4)
    shoot(scn, cam, '07_rider', (RIDER_X + 2.4, 1.2, -2.0), (RIDER_X, 1.0, 0.0), 45)
    shoot(scn, cam, '08_engine_right', (1.3, 0.7, -0.3), (0, 0.6, -0.1), 45)

# ===================================================================================================== main
build_all()
col = bpy.context.scene.collection
objs = [to_blender(PARTS[n], col) for n in ORDER]
tb = tr = 0
for n in ORDER:
    p = PARTS[n]; t = p.tris()
    if n.startswith('r_'): tr += t
    else: tb += t
    log(f'  {n:14s} {t:6d} tris  {", ".join(dict.fromkeys(p.mats))}')
log(f'  bike {tb} tris, rider {tr} tris')
moto_checks()
export(objs)
ok = verify()
if PREVIEW: previews_moto(objs)
os.makedirs(os.path.dirname(BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND, check_existing=False, compress=True)
log(f'saved {BLEND}')
if not ok: sys.exit(1)
