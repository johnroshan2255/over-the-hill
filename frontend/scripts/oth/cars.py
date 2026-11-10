# OVERHILL — THE GARAGE'S CARS (docs/VEHICLES.md: 21 machines, each OUR model of the real vehicle): each car is its
# numbers here — the real one's size (length, width, wheelbase, track, tyres) and what kind of body it is — built by the
# kit (carkit.py `build`) into src/assets/models/vehicles/<id>.glb, and its measures written to
# src/gameplay/vehicle/cars.json (the catalogue and the tests read them). (The off-roader keeps its own script.)
#
#   blender -b --factory-startup --python scripts/oth/cars.py -- [CAR=sierra,forty | all] [PREVIEW=<dir>]
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import carkit
from carkit import FRONTEND

kw = dict(a.split('=', 1) for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) if '=' in a)


def car(L, W, WB, track, R, TW, kind='wagon', fo=0.75, doors=2, hood=None, rake=0.34, height=None, drop=0.05, **more):
    """A car's numbers from the real one's: L × W (m), wheelbase, track, tyre radius / width; `fo` the front overhang
    (axle → bumper's face); the rest follows — the sill over the tyres, a cabin a 1.78 m driver sits in (the belt, the
    roof), the doors between the arches, the arches round the tyres."""
    AY = WB / 2; AB = R + 0.11; sill = R + 0.16
    belt = sill + 0.78; roof = max(height or 0, sill + 1.42)
    front = AY + fo - 0.2; rear = -(L - fo - AY) + 0.17
    cowl = min(AY - AB + 0.02, front - (hood or 0.95))
    db = max(cowl - 1.3, -AY + AB + 0.06)
    P = dict(wheelbase=WB, track=track, tyre_r=R, rim_r=round(R * 0.5, 3), tyre_w=TW, width=W - 0.08, sill=sill, belt=belt, roof=roof,
             nose_top=belt - drop, front=front, rear=rear, cowl=cowl, ws_top=cowl - rake, door_rear=db, cab_rear=db - 0.12,
             bed_floor=2 * R + 0.07, arch=(AB, AB - 0.08, 2 * R + 0.17), grille=(belt - 0.36, belt - 0.11), kind=kind)
    if doors == 4: P['door2_rear'] = max(db - 0.86, -AY + AB + 0.06)
    P.update(more)
    return P


W2 = 16   # (the kit's material slots: PAINT2 — the second colour)
# EACH ITS OWN SHAPE (2026-11-10, the user: "give each car its own body shape"): what tells the real ones apart, in the
# kit's words — round mudguard wings with lamp pods and running boards (the 40s–50s trucks) or flat low wings (the Land
# Rovers) or one full-width nose; how the bonnet drops and crowns; the face (chrome, a pale bezel, body colour, a dark
# band) and its grille (bars, slats, mesh; wide or a narrow tall one); round, square or stacked lamps, in the panel or on
# the wings; the arches' roundness; how soft the pressings are; the screen's rake, a two-piece screen; the sides' lean;
# the tail's rake; a canvas top's bows, a waist rail, wood framing, a rack; the wheels (holed steel, a chrome cap, an alloy).
CARS = {
    # ---- the pickups
    # SIERRA K — GMC K1500 square body, 1984: crisp and square; a chrome face, stacked square lamps, a two-tone band.
    'sierra': car(5.0, 2.02, 2.985, 1.66, 0.42, 0.3, 'pickup', fo=0.91, hood=1.2, rake=0.4, band=(0.72, 1.12), lamps='square2', seats='bench', shifter='column',
                  face='chrome', grille_style='bars', grille_n=4, crown=0.03, colours=dict(seat=(120, 92, 70))),
    # POWERLINE — Dodge WDX Power Wagon, 1946: a tall narrow peaked bonnet between round mudguards, lamp pods on them,
    # running boards, a two-piece upright screen, a body-coloured mesh grille; everything rounded.
    'powerline': car(5.05, 1.99, 3.2, 1.64, 0.45, 0.26, 'pickup', fo=0.8, hood=1.3, rake=0.1, drop=0.02, wing_drop=0.3, hood_w=0.44, wing_round=0.14, boards=True,
                     lamp_at='wing', lamps='round', lamp_r=0.11, face='body', grille_style='mesh', grille_n=5, grille_bright=False, grille_w=0.3, crown=0.07, crown_w=0.6,
                     arch_shape=1.0, soft=2.2, tumble=0.04, ws_split=True, bumper='black', seats='bench', shifter='floor', gearbox='manual', colours=dict(seat=(92, 76, 60), rim=(60, 62, 64))),
    # FORTY-FIVE — Land Cruiser FJ45 pickup: the Forty's face — rounded mudguards, the lamps in a pale bezel round a dark mesh, turn lamps on the wings — and a long bed.
    'fortyfive': car(4.9, 1.7, 2.95, 1.41, 0.39, 0.24, 'pickup', fo=0.72, hood=0.95, rake=0.1, wing_drop=0.2, hood_w=0.56, wing_round=0.12, lamp_at='panel', lamps='round',
                     lamp_r=0.085, face='pale', grille_style='mesh', grille_n=4, grille_bright=False, turn='wing', arch_shape=0.9, soft=1.6, tumble=0.04, crown=0.045, crown_w=0.8,
                     bumper='black', roof_mat=W2, seats='bench', shifter='floor', gearbox='manual'),
    # ---- the short two-doors
    # SQUAREBODY — Chevrolet K5 Blazer, 1984: the Sierra's face, a pale lift-off top leaning in at the tail.
    'squarebody': car(4.69, 2.02, 2.705, 1.66, 0.42, 0.3, fo=0.91, hood=1.2, rake=0.4, lamps='square2', roof_mat=W2, top_mat=W2, rear_rake=0.3, seats='buckets', shifter='column',
                      face='chrome', grille_style='bars', grille_n=4, crown=0.03),
    # BRONC — Ford Bronco, 1970: a plain flat box: a body-coloured face with two bright slats between round lamps, slab sides, chrome caps, the spare behind.
    'bronc': car(3.87, 1.75, 2.337, 1.45, 0.38, 0.26, fo=0.66, hood=0.9, rake=0.16, drop=0.03, lamps='round', lamp_r=0.1, face='body', grille_style='slats', grille_n=2, grille_w=0.4,
                 crown=0.015, arch_shape=0.5, tumble=0.05, rear_rake=0.05, wheel='cap', roof_mat=W2, top_mat=W2, seats='buckets', shifter='floor', gearbox='manual', spare='rear'),
    # SCOUTLING — International Scout 800, 1967: a mesh grille the width of the nose in a body-coloured face, small round lamps at its ends, chrome caps.
    'scoutling': car(3.86, 1.72, 2.54, 1.4, 0.37, 0.24, fo=0.6, hood=0.9, rake=0.14, drop=0.03, lamps='round', lamp_r=0.085, face='body', grille_style='mesh', grille_n=6, grille_bright=False,
                     grille_w=0.5, crown=0.02, arch_shape=0.5, tumble=0.04, rear_rake=0.06, wheel='cap', roof_mat=W2, top_mat=W2, seats='buckets', shifter='floor', gearbox='manual'),
    # STEPPE — Lada Niva, 1977: small and soft: a sloping bonnet, a dark band of a face with round lamps and the turn lamps over them, a hatch leaning in, little wheels.
    'steppe': car(3.72, 1.68, 2.2, 1.42, 0.345, 0.2, fo=0.66, hood=0.85, rake=0.32, drop=0.13, lamps='round', lamp_r=0.095, face='dark', grille_style='slats', grille_n=3, grille_bright=False,
                  turn='wing', crown=0.02, arch_shape=0.8, soft=1.4, tumble=0.09, rear_rake=0.34, bumper='black', seats='buckets', shifter='floor', gearbox='manual', colours=dict(rim=(150, 150, 150))),
    # EIGHTY-EIGHT — Land Rover Series IIA 88": flat panels: low flat wings, the lamps set in the recessed panel between them, a waist rail, a two-piece upright screen, a canvas top on bows, the spare on the bonnet.
    'eightyeight': car(3.62, 1.68, 2.235, 1.31, 0.38, 0.2, fo=0.56, hood=0.85, rake=0.05, drop=0.03, wing_drop=0.1, hood_w=0.62, lamp_at='panel', lamps='round', lamp_r=0.075, face='body',
                       grille_style='mesh', grille_n=3, grille_bright=False, turn='wing', crown=0.0, arch_shape=0.45, soft=0.8, tumble=0.02, rear_rake=0.03, waist=True, ws_split=True,
                       canvas=True, spare='bonnet', roof_mat=W2, top_mat=W2, top_doors=True, seats='buckets', shifter='floor', gearbox='manual', colours=dict(second=(196, 180, 140))),
    # GUARDIAN — Land Rover Defender 90: the same bones — low wings with the lamps on their fronts, a dark slatted grille, the waist rail — on coils: flares, a raised bonnet, a rack, the spare on the back door.
    'guardian': car(3.88, 1.79, 2.36, 1.486, 0.4, 0.24, fo=0.62, hood=0.9, rake=0.08, drop=0.03, wing_drop=0.08, hood_w=0.66, lamp_at='wing', lamps='round', lamp_r=0.085, face='dark',
                    grille_style='slats', grille_n=4, grille_bright=False, lamp_ring=False, crown=0.04, crown_w=0.8, arch_shape=0.45, soft=0.8, tumble=0.02, rear_rake=0.03, waist=True,
                    flares=True, rack=True, bumper='black', roof_mat=W2, seats='buckets', shifter='floor', gearbox='manual', spare='rear', front_susp='coil', rear_susp='coil'),
    # GELÄNDE — Mercedes G-Class W460 short: a flat box with a full-width nose: a dark slatted face, round lamps, the turn lamps on the wings' tops, flares, the spare behind.
    'gelande': car(4.15, 1.7, 2.4, 1.425, 0.39, 0.23, fo=0.7, hood=0.95, rake=0.12, drop=0.04, lamps='round', lamp_r=0.1, face='dark', grille_style='slats', grille_n=3, grille_bright=False,
                   lamp_ring=False, turn='wing', crown=0.03, arch_shape=0.45, soft=0.9, tumble=0.03, rear_rake=0.04, flares=True, bumper='black', seats='buckets', shifter='floor', gearbox='manual',
                   spare='rear', front_susp='coil', rear_susp='coil'),
    # FORTY — Land Cruiser FJ40: rounded mudguards beside a narrow bonnet, the lamps in a pale bezel, turn lamps on the wings, a white roof, the spare behind.
    'forty': car(3.84, 1.67, 2.285, 1.4, 0.38, 0.23, fo=0.62, hood=0.9, rake=0.1, wing_drop=0.2, hood_w=0.56, wing_round=0.12, lamp_at='panel', lamps='round', lamp_r=0.085, face='pale',
                 grille_style='mesh', grille_n=4, grille_bright=False, turn='wing', arch_shape=0.9, soft=1.6, tumble=0.04, rear_rake=0.04, crown=0.045, crown_w=0.8, bumper='black',
                 roof_mat=W2, top_mat=W2, seats='buckets', shifter='floor', gearbox='manual', spare='rear'),
    # SEVENTY — Land Cruiser BJ70: the square successor: one wide square lamp each side of bright slats, a flat bonnet, flares.
    'seventy': car(3.98, 1.69, 2.31, 1.41, 0.39, 0.23, fo=0.72, hood=1.0, rake=0.22, drop=0.07, lamps='square', face='chrome', grille_style='slats', grille_n=3, grille_w=0.42, crown=0.035,
                   crown_w=0.7, arch_shape=0.55, soft=1.1, tumble=0.06, rear_rake=0.06, flares=True, seats='buckets', shifter='floor', gearbox='manual', spare='rear'),
    # LYNX — Volkswagen Iltis: tiny, flat and military: a body-coloured slatted face, small lamps, an upright screen, a canvas top on bows.
    'lynx': car(3.89, 1.52, 2.017, 1.25, 0.36, 0.2, fo=0.9, hood=1.0, rake=0.06, drop=0.1, lamps='round', lamp_r=0.08, face='body', grille_style='slats', grille_n=5, grille_bright=False,
                lamp_ring=False, crown=0.0, arch_shape=0.5, soft=0.8, tumble=0.02, rear_rake=0.03, canvas=True, bumper='black', roof_mat=W2, top_mat=W2, top_doors=True, seats='buckets',
                shifter='floor', gearbox='manual', front_susp='coil', rear_susp='coil', colours=dict(second=(150, 146, 120), rim=(120, 122, 110))),
    # ---- the wagons
    # WAYFARER — Ford Explorer, 1991: the modern one: soft edges, a dropping bonnet and a fast screen, wide square lamps beside bright slats, alloy wheels, a rack, a lower band.
    'wayfarer': car(4.67, 1.78, 2.842, 1.49, 0.37, 0.25, doors=4, fo=0.8, hood=1.1, rake=0.52, drop=0.13, lamps='square', face='chrome', grille_style='slats', grille_n=4, grille_w=0.4,
                    crown=0.02, arch_shape=0.7, soft=1.6, tumble=0.1, rear_rake=0.22, wheel='slot', rack=True, band=(0.55, 0.78), bumper='black', seats='buckets', shifter='floor',
                    gearbox='manual', front_susp='coil', colours=dict(second=(206, 204, 198), rim=(196, 196, 198))),
    # WAGON 63 — Jeep Wagoneer, 1963: a narrow tall grille standing in a body-coloured face, round lamps wide apart, chrome caps, soft pressings.
    'wagon63': car(4.73, 1.9, 2.794, 1.45, 0.37, 0.22, doors=4, fo=0.72, hood=1.15, rake=0.34, drop=0.03, lamps='round', lamp_r=0.105, face='body', grille_style='bars', grille_n=6, grille_w=0.2,
                   crown=0.02, arch_shape=0.8, soft=1.6, tumble=0.07, rear_rake=0.12, wheel='cap', seats='bench', shifter='column', gearbox='manual'),
    # GRAND WAGON — Jeep Grand Wagoneer, 1986: the same body with a full-width chrome grille of many bars, a strip of wood down the side, a rack.
    'grandwagon': car(4.74, 1.9, 2.761, 1.48, 0.38, 0.24, doors=4, fo=0.74, hood=1.15, rake=0.34, drop=0.03, lamps='round', lamp_r=0.095, face='chrome', grille_style='bars', grille_n=11,
                      grille_w=0.5, crown=0.02, arch_shape=0.8, soft=1.5, tumble=0.07, rear_rake=0.12, wheel='cap', rack=True, band=(0.95, 1.13), seats='bench', shifter='column',
                      colours=dict(second=(142, 86, 48))),
    # BOAR — Volvo TP21: a round-nosed command car: a tall narrow peaked bonnet with a barred grille, fat round mudguards with lamp pods, running boards, a two-piece screen, big tyres.
    'boar': car(4.68, 1.9, 2.73, 1.51, 0.45, 0.26, doors=4, fo=0.86, hood=1.3, rake=0.16, drop=0.02, wing_drop=0.3, hood_w=0.42, wing_round=0.16, boards=True, lamp_at='wing', lamps='round',
                lamp_r=0.1, face='body', grille_style='bars', grille_n=7, grille_bright=False, grille_w=0.26, crown=0.07, crown_w=0.55, arch_shape=1.0, soft=2.4, tumble=0.06, rear_rake=0.22,
                ws_split=True, bumper='black', seats='bench', shifter='floor', gearbox='manual', colours=dict(rim=(110, 104, 78))),
    # WOODBOX — International R-140 Travelall: a round truck nose — mudguards, lamp pods, bright slats, a crowned bonnet, a two-piece screen — and a long body framed in wood, red wheels with chrome caps.
    'woodbox': car(4.95, 1.93, 2.921, 1.54, 0.4, 0.22, fo=0.8, hood=1.25, rake=0.2, drop=0.02, wing_drop=0.22, hood_w=0.54, wing_round=0.13, boards=True, lamp_at='wing', lamps='round', lamp_r=0.1,
                   face='chrome', grille_style='slats', grille_n=3, grille_w=0.4, crown=0.06, crown_w=0.7, arch_shape=1.0, soft=2.2, tumble=0.05, rear_rake=0.1, ws_split=True, wheel='cap',
                   band=(0.82, 1.3), wood=True, seats='bench', shifter='floor', gearbox='manual', colours=dict(second=(150, 96, 56), rim=(170, 52, 48))),
}

def log(*a): print('[cars]', *a, flush=True)
JS = os.path.join(FRONTEND, 'src', 'gameplay', 'vehicle', 'cars.json')
data = json.load(open(JS)) if os.path.exists(JS) else {}
for name in (CARS if kw.get('CAR', 'all') == 'all' else kw['CAR'].split(',')):
    out = os.path.join(FRONTEND, 'src', 'assets', 'models', 'vehicles', f'{name}.glb')
    parts, info = carkit.build(CARS[name], out, log)
    data[name] = info
    if kw.get('PREVIEW'): carkit.look(parts, kw['PREVIEW'], name)
json.dump(data, open(JS, 'w'), indent=1, sort_keys=True)
log('wrote', JS)
