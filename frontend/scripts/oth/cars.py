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
                 crown=0.015, arch_shape=0.5, tumble=0.05, rear_rake=0.05, wheel='cap', roof_mat=W2, top_mat=W2, seats='buckets', shifter='column', gearbox='manual', spare='rear'),
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
                    gearbox='manual', front_susp='coil', colours=dict(second=(198, 180, 146), rim=(196, 196, 198))),
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

# ---------------------------------------------------------------------------------------------------------------------
# THE INSIDE AND THE COLOUR, AS THE REAL ONE'S (2026-11-16 — the user: "in first person the cars have no gear parts, no
# gear change, no speedometer — check how each car is online, then make the inside like the original; and the default
# colour must be the car's own in real life"). docs/VEHICLES.md §6 has each one's notes and what was found online.
#   COCKPIT[id]: dash 'metal' (painted steel, the factory colour) | 'pad' | 'wood'; `cluster` where the instruments are
#   ('driver': ahead of him, seen through the wheel — or at='centre': the panel in the middle of the dash) and its rim;
#   `gauges` (kind, x, z from the cluster's middle, radius, its scale); the steering `wheel` (radius, rim, spokes in
#   degrees, a horn ring, ivory); `shift` the floor lever's length and crank; `transfer` the levers beside it (the first
#   is the range lever: it moves; knobs black / red / yellow / a T); `hand` the handbrake's lever (none: a foot pedal or
#   a pull under the dash); the dash's pull `knobs`, a `radio` stack, the `glovebox` (its x; 0: none), a `grab` handle.
#   PAINT[id]: the factory colour (sRGB), its name, a note.
def G(kind, x, z, r, **o): return (kind, x, z, r, o)
def pod5(unit, top, r=0.052, small=0.02, dx=0.088, dz=0.024):
    """One big speedometer between two pairs of small gauges (fuel, temperature | oil, charge): the 50s–70s trucks'."""
    return [G('speed', 0, 0, r, max=top, unit=unit), G('fuel', -dx, dz, small), G('temp', -dx, -dz, small), G('oil', dx, dz, small), G('volt', dx, -dz, small)]
TRUCK_WHEEL = dict(r=0.215, rim=0.013, spokes=(30, 150, 270), boss=0.04)                 # big, thin-rimmed, three spokes
V_WHEEL = dict(r=0.195, rim=0.015, spokes=(205, 335), boss=0.05)                         # two spokes in a shallow V
TWO_LEVERS = [dict(x=0.1, len=0.34, back=0.06), dict(x=0.17, len=0.34, back=0.06)]       # the range lever, the front axle's
SQUARE_BODY = dict(dash='pad', gauges=[G('volt', -0.135, 0, 0.02), G('speed', -0.062, 0, 0.048, max=85, unit='mph'), G('fuel', 0.062, 0, 0.048, a0=205, sweep=-230), G('oil', 0.135, 0.023, 0.02), G('temp', 0.135, -0.023, 0.02)],
                   wheel=dict(r=0.195, rim=0.017, spokes=(0, 180), spoke_w=0.07, boss=0.06), transfer=[dict(x=0.02, y=0.0, len=0.3, back=0.06)])
FORTY = dict(dash='metal', cluster=dict(bezel='chrome'), wheel=dict(r=0.205, rim=0.014, spokes=(205, 335), boss=0.045), shift=dict(len=0.52, back=0.15),
             transfer=[dict(x=0.1, y=-0.02, len=0.32, back=0.06)], knobs=4, radio=False, grab=True)
COCKPIT = {
    # Power Wagon: a steel dash, one round speedometer between four small gauges; a long floor lever, the transfer
    # case's two levers and the handbrake's beside it; a big thin three-spoke wheel
    'powerline': dict(dash='metal', cluster=dict(bezel='chrome'), gauges=pod5('mph', 80, r=0.05), wheel=TRUCK_WHEEL, shift=dict(len=0.56, back=0.16), transfer=TWO_LEVERS,
                      hand=dict(kind='tall', x=0.26, len=0.5), knobs=4, radio=False),
    # the square-body GMs (1973–87): a padded dash; the speedometer (85 mph) in the left pod, the fuel gauge in the right,
    # small gauges beside them; an automatic on the COLUMN; one transfer lever on the floor; the parking brake a pedal
    'sierra': SQUARE_BODY, 'squarebody': SQUARE_BODY,
    # Bronco (1966–77): a steel dash in the body's colour, the speedometer in a chrome-rimmed pod with the small gauges;
    # three speeds on the COLUMN; the Dana 20's T-handle on the floor
    'bronc': dict(dash='metal', cluster=dict(bezel='chrome'), gauges=pod5('mph', 100), wheel=dict(r=0.205, rim=0.014, spokes=(30, 150, 270), boss=0.045),
                  transfer=[dict(x=0.0, y=0.0, len=0.3, back=0.05, knob_kind='T')], knobs=3, radio=False),
    # Scout 800: a steel dash, its instruments in the CENTRE (an 80 mph speedometer between the small gauges); a floor
    # lever and one transfer lever
    'scoutling': dict(dash='metal', cluster=dict(at='centre', bezel='chrome'), gauges=pod5('mph', 80, r=0.05), wheel=dict(r=0.205, rim=0.013, spokes=(0, 180), boss=0.04),
                      shift=dict(len=0.47, back=0.12), transfer=[dict(x=0.1, len=0.3, back=0.05)], hand=dict(kind='floor', y=-1.02), knobs=4, radio=False),
    # Niva: black plastic; a speedometer (180 km/h) and a rev counter side by side, small gauges either side; THREE levers
    # in the tunnel — the gears, and behind it the range and the centre lock; the handbrake between the seats
    'steppe': dict(dash='pad', gauges=[G('temp', -0.132, 0.023, 0.02), G('fuel', -0.132, -0.023, 0.02), G('speed', -0.056, 0, 0.046, max=180, unit='kmh'), G('rpm', 0.056, 0, 0.046, max=8000, red=6000),
                                         G('oil', 0.132, 0.023, 0.02), G('volt', 0.132, -0.023, 0.02)],
                   wheel=V_WHEEL, shift=dict(len=0.4, back=0.1), transfer=[dict(x=-0.035, y=-0.13, len=0.2, back=0.02), dict(x=0.035, y=-0.13, len=0.2, back=0.02)], hand=dict(kind='floor', y=-1.02)),
    # Series IIA: the bare steel bulkhead, a black panel in its CENTRE with two dials (the speedometer, the fuel / charge
    # one) and warning lamps; a long cranked gear lever, the RED knob (high / low) and the YELLOW one (four-wheel drive);
    # the handbrake's lever by the driver's leg; a big thin three-spoke wheel; no glovebox — an open shelf
    'eightyeight': dict(dash='metal', cluster=dict(at='centre', x=0.02, lamps=3), gauges=[G('fuel', -0.068, 0, 0.042, a0=200, sweep=-220), G('speed', 0.068, 0, 0.05, max=90, unit='mph')],
                        wheel=dict(r=0.215, rim=0.012, spokes=(30, 150, 270), spoke_w=0.03, boss=0.04), shift=dict(len=0.52, back=0.16),
                        transfer=[dict(x=0.13, y=0.02, len=0.3, back=0.05, knob='red'), dict(x=0.07, y=0.1, len=0.22, back=0.0, knob='yellow')],
                        hand=dict(kind='tall', x=-0.12, y=-0.2, len=0.3), radio=False, glovebox=0),
    # Defender 90: a black binnacle ahead — the speedometer, the fuel and temperature gauges, a block of warning lamps;
    # a long gear lever, the short transfer lever ahead of it; a four-spoke wheel; the grab handle
    'guardian': dict(dash='pad', cluster=dict(lamps=4), gauges=[G('speed', -0.04, 0, 0.05, max=100, unit='mph'), G('fuel', 0.045, 0.024, 0.021), G('temp', 0.045, -0.024, 0.021)],
                     wheel=dict(r=0.205, rim=0.016, spokes=(20, 160, 200, 340), spoke_w=0.035), shift=dict(len=0.46, back=0.13), transfer=[dict(x=-0.07, y=0.1, len=0.2, back=0.0)],
                     hand=dict(kind='floor', y=-1.0), grab=True),
    # G-Class W460: a big speedometer (180 km/h) between the fuel gauge and the rev counter; the gear lever, the transfer
    # lever and the two differential locks' pulls in the tunnel; a thick-rimmed four-spoke wheel
    'gelande': dict(dash='pad', gauges=[G('fuel', -0.098, 0, 0.034, a0=200, sweep=-220), G('speed', 0, 0, 0.052, max=180, unit='kmh'), G('rpm', 0.098, 0, 0.034, max=7000, red=6200)],
                    wheel=dict(r=0.205, rim=0.018, spokes=(10, 170, 235, 305), spoke_w=0.04, boss=0.065), shift=dict(len=0.4, back=0.1),
                    transfer=[dict(x=0.08, y=-0.04, len=0.24), dict(x=-0.15, y=-0.16, len=0.1, back=0.0, knob_kind='T'), dict(x=-0.04, y=-0.16, len=0.1, back=0.0, knob_kind='T')],
                    hand=dict(kind='floor', y=-1.02), grab=True),
    # FJ40 / FJ45: a steel dash in the body's colour, the round speedometer ahead with its small gauges, a row of pull
    # knobs, the grab handle; a long gear lever and the transfer lever; the parking brake a pull under the dash
    'forty': dict(FORTY, gauges=pod5('mph', 100, r=0.055)), 'fortyfive': dict(FORTY, gauges=pod5('kmh', 160, r=0.055)),
    # BJ70: grey plastic, a speedometer (180 km/h) and four small gauges in a binnacle; five gears on the floor
    'seventy': dict(dash='pad', gauges=[G('speed', -0.05, 0, 0.05, max=180, unit='kmh'), G('fuel', 0.04, 0.024, 0.021), G('temp', 0.04, -0.024, 0.021), G('oil', 0.088, 0.024, 0.021), G('volt', 0.088, -0.024, 0.021)],
                    wheel=dict(V_WHEEL, boss=0.055), shift=dict(len=0.43, back=0.12), transfer=[dict(x=0.08, y=-0.04, len=0.26)], hand=dict(kind='floor', y=-1.0), grab=True),
    # Iltis: an olive steel dash, one speedometer and a fuel gauge, a row of lamps; the gear lever and the front axle's
    'lynx': dict(dash='metal', cluster=dict(lamps=4), gauges=[G('speed', 0, 0, 0.046, max=160, unit='kmh'), G('fuel', 0.078, 0, 0.022)], wheel=V_WHEEL, shift=dict(len=0.42, back=0.12),
                 transfer=[dict(x=0.08, y=-0.03, len=0.26)], hand=dict(kind='floor', y=-1.0), radio=False, glovebox=0, knobs=3),
    # Explorer (1991): a soft modern dash — the rev counter, the speedometer (85 mph), four small gauges; five gears on a
    # short floor lever; four-wheel drive by push-button, the parking brake a pedal
    'wayfarer': dict(dash='pad', cluster=dict(x=-0.01), gauges=[G('rpm', -0.1, 0, 0.042, max=6000, red=5000), G('speed', 0, 0, 0.05, max=85, unit='mph'), G('fuel', 0.085, 0.023, 0.02), G('temp', 0.085, -0.023, 0.02),
                                                                  G('oil', 0.13, 0.023, 0.02), G('volt', 0.13, -0.023, 0.02)],
                     wheel=dict(r=0.19, rim=0.019, spokes=(15, 165, 200, 340), spoke_w=0.045, boss=0.07), shift=dict(len=0.3, back=0.06)),
    # Wagoneer (1963): a steel dash, a rectangular chrome-rimmed cluster — the speedometer between the fuel and the
    # temperature gauges; an ivory two-spoke wheel with a chrome horn ring; three speeds on the COLUMN
    'wagon63': dict(dash='metal', cluster=dict(bezel='chrome'), gauges=[G('fuel', -0.082, 0, 0.026), G('speed', 0, 0, 0.046, max=110, unit='mph'), G('temp', 0.082, 0, 0.026)],
                    wheel=dict(r=0.21, rim=0.013, spokes=(0, 180), ring=True, ivory=True, boss=0.04), transfer=[dict(x=0.0, y=0.0, len=0.3, back=0.05)], knobs=4, radio=False),
    # Grand Wagoneer (1986): a wood fascia, the speedometer (85 mph) and four gauges; an automatic on the COLUMN; the
    # low range's small lever by the seat
    'grandwagon': dict(dash='wood', gauges=[G('speed', -0.055, 0, 0.048, max=85, unit='mph'), G('fuel', 0.03, 0.024, 0.021), G('temp', 0.03, -0.024, 0.021), G('oil', 0.08, 0.024, 0.021), G('volt', 0.08, -0.024, 0.021)],
                       wheel=dict(r=0.19, rim=0.019, spokes=(0, 180), spoke_w=0.06, boss=0.065), transfer=[dict(x=-0.16, y=0.0, len=0.16, back=0.0)]),
    # TP21: a green steel dash, the speedometer (120 km/h) and its gauges; a long lever and two more
    'boar': dict(dash='metal', gauges=pod5('kmh', 120, r=0.05), wheel=dict(TRUCK_WHEEL, r=0.225), shift=dict(len=0.56, back=0.16), transfer=TWO_LEVERS, hand=dict(kind='tall', x=0.26, len=0.5),
                 knobs=3, radio=False, glovebox=0),
    # R-140 Travelall: a steel dash, two round dials in bright rings — the speedometer, and the four gauges; a long lever
    'woodbox': dict(dash='metal', cluster=dict(bezel='chrome', rings=True), gauges=[G('speed', -0.06, 0, 0.05, max=100, unit='mph'), G('fuel', 0.036, 0.025, 0.021), G('temp', 0.086, 0.025, 0.021),
                                                                                     G('oil', 0.036, -0.025, 0.021), G('volt', 0.086, -0.025, 0.021)],
                    wheel=dict(TRUCK_WHEEL, r=0.22), shift=dict(len=0.56, back=0.16), transfer=TWO_LEVERS, hand=dict(kind='tall', x=0.26, len=0.5), knobs=4, radio=False),
}
PAINT = {
    'powerline': ((76, 95, 82), 'Seawolf Submarine Green', "the Power Wagon's standard colour from 1946"),
    'sierra': ((168, 50, 43), 'Apple Red', 'over a Frost White band: the square-body two-tone'),
    'fortyfive': ((203, 183, 140), 'Dune Beige', "Toyota's 416, under a white cab roof"),
    'squarebody': ((43, 65, 105), 'Midnight Blue', 'under a white top'),
    'bronc': ((147, 187, 216), 'Sky View Blue', "a 1970 Bronco colour, under a white top"),
    'scoutling': ((191, 148, 64), 'Apache Gold', "a Scout 800 colour, under a white top"),
    'steppe': ((216, 118, 44), 'Orange', 'the bright Soviet orange of the first Nivas'),
    'eightyeight': ((51, 80, 59), 'Bronze Green', "Land Rover's own deep green, a sand canvas tilt"),
    'guardian': ((79, 131, 179), 'Arles Blue', 'a 1991 Defender colour, under a white roof'),
    'gelande': ((226, 220, 203), 'Cream White', 'the early G-Class in its pale cream'),
    'forty': ((181, 58, 46), 'Freeborn Red', "Toyota's 309, under a white roof"),
    'seventy': ((236, 234, 226), 'White', "Toyota's plain white, the 70 series' commonest"),
    'lynx': ((85, 78, 54), 'Gelboliv', "the Bundeswehr's RAL 6014 yellow-olive"),
    'wayfarer': ((31, 77, 60), 'Deep Jewel Green', 'a 1991 Explorer colour, over a sandalwood band'),
    'wagon63': ((125, 191, 166), 'Spruce Tip Green', 'a pale 1963 Wagoneer green'),
    'grandwagon': ((107, 39, 49), 'Garnet', 'dark red over the wood-grain strip'),
    'boar': ((86, 96, 75), 'Army Green', "the Swedish army's grey-green"),
    'woodbox': ((154, 47, 41), 'Harvester Red', "International's own red, the body framed in wood"),
}
for k_ in CARS: CARS[k_].update(cockpit=COCKPIT[k_], paint=PAINT[k_][0], paint_name=PAINT[k_][1], paint_note=PAINT[k_][2])

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
