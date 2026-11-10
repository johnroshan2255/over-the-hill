import type { VehicleSpec } from './drivetrain/spec'

/**
 * The real machines behind the garage cars (skills/realistic-vehicle-system §8.4): public spec sheets, resolved at
 * load against each model's measured wheelbase and track (drivetrain/spec.ts resolveSpec). Kept apart from the
 * catalogue so the Node tests can import them (the catalogue imports model URLs through Vite).
 */
// G500 4×4² (2015): M176 4.0 V8 biturbo 310 kW / 610 N·m (2250–4750), 7G-Tronic Plus (ratios verified),
// permanent 4MATIC 50:50 with three locking diffs, low range 2.1, portal axles, 325/55R22, 3021 kg, 0–100 7.4 s,
// 210 km/h (limited). Final drive 5.4 is derived (portal + axle reduction), not published.
const G500: VehicleSpec =
  {
    class: 'offroader',
    published: { zeroTo100: 7.4, topSpeed: 210, turningCircle: 13.6 },
    mass: { kerb: 3021, frontShare: 0.52, comHeight: 0.95 },
    power: { kind: 'turbo-petrol', peakPower: 310, powerRpm: 5250, peakTorque: 610, torqueRpm: [2250, 4750], redline: 6000, idle: 650, turbo: { from: 1800, lag: 0.4 } },
    transmission: { kind: 'auto', ratios: [4.377, 2.859, 1.921, 1.368, 1.0, 0.82, 0.728], reverse: 3.416, final: 5.4 },
    drive: { layout: 'AWD-permanent', centre: 'open', split: 0.5, low: 2.1, lockers: ['centre', 'rear', 'front'] },
    axles: [
      { suspension: 'portal', steered: true, tyre: '325/55R22', tyreKind: 'at', travel: 0.3 },
      { suspension: 'portal', tyre: '325/55R22', tyreKind: 'at', travel: 0.3 },
    ],
    brakes: { abs: true },
    aero: { cd: 0.54, frontalArea: 4.0 },
  }

export const SPECS = {
  // SIERRA K — the GMC K1500 short bed, 1984 (docs/VEHICLES.md #2; ✓ found online / e estimated there): 350 V8 4-bbl
  // ~165 hp net (123 kW) @ 3800, ~373 N·m from 1600; TH350 3-speed automatic 2.52 / 1.52 / 1.00, 3.73 axles; NP208
  // part-time transfer, low 2.61; leaf-sprung beam axles; front discs, rear drums, no ABS; 33×12.50R15 all-terrains (a mild lift);
  // ~1950 kg, 56 % on the front (an empty bed); a brick (Cd 0.5 × 3.2 m²). 0–100 ≈ 13 s, ≈ 160 km/h.
  sierra: {
    class: 'pickup',
    published: { zeroTo100: 13, topSpeed: 160, turningCircle: 13.4 },
    mass: { kerb: 1950, frontShare: 0.56, comHeight: 0.72 },
    power: { kind: 'petrol', peakPower: 123, powerRpm: 3800, peakTorque: 373, torqueRpm: [1600, 2800], redline: 4600, idle: 650 },
    transmission: { kind: 'auto', ratios: [2.52, 1.52, 1.0], reverse: 1.93, final: 3.73 },
    drive: { layout: 'part-time-4WD', low: 2.61 },
    axles: [
      { suspension: 'solid-leaf', steered: true, tyre: '33x12.50R15', tyreKind: 'at', brake: 'disc', travel: 0.2 },
      { suspension: 'solid-leaf', tyre: '33x12.50R15', tyreKind: 'at', brake: 'drum', travel: 0.22 },
    ],
    brakes: { abs: false },
    aero: { cd: 0.5, frontalArea: 3.2 },
    // (the real one had none; with 'off' the universal suite's floored 0–100 cooks its rear tyres — a light tail,
    //  rear-drive — and its 35° climb in 4L spins out: 'std' is what the suite passes. The player's setting still rules.)
    aids: 'std',
  },
  // THE OFF-ROADER (our own model — catalogue.ts): the G500 4×4²'s machine, the same sheet (the main car drives as it
  // always did); resolved against its own wheelbase and track
  offroader: G500,
  // (the G500 itself: shelved — catalogue.ts SHELVED — kept and tested)
  g500: G500,
  // BMW E30 M3 (1986, European): S14 2.3 L four, 147 kW at 6750 rpm, 240 N·m at 4750 rpm, 7250 redline; Getrag 265
  // close-ratio 5-speed (dogleg first) 3.72 / 2.40 / 1.77 / 1.26 / 1.00, R 4.23, final 3.25, a 25 % rear LSD;
  // MacPherson front, semi-trailing-arm rear (≈ multi-link here); discs all round with ABS; 205/55R15; 1200 kg;
  // 0–100 6.7 s, 235 km/h; Cd 0.33. TUNED (skills/realistic-vehicle-system §8.4, data only): C_dA 0.78 solved from
  // the 235 km/h top speed (Cd × A = 0.63 ran to 278 km/h: the sim's losses are lower than the real car's), quick
  // 0.28 s shifts, 50:50 with the driver, road tyres (the game's cars climb grass walls with the off-road assist;
  // performance rubber can't), and an OPEN rear diff — with the 25 % LSD the 123 W/kg car spun donuts on the
  // skidpad at a quarter throttle (1.45 g of 'lateral'); open, it still holds a drift (tests/drivetrain).
  // (shelved 2026-11-10 — catalogue.ts SHELVED — kept and tested)
  e30: {
    class: 'sports',
    published: { zeroTo100: 6.7, topSpeed: 235, turningCircle: 10.5 },
    mass: { kerb: 1200, frontShare: 0.5, comHeight: 0.48 },
    power: { kind: 'petrol', peakPower: 147, powerRpm: 6750, peakTorque: 240, torqueRpm: 4750, redline: 7250, idle: 900 },
    transmission: { kind: 'manual', ratios: [3.72, 2.4, 1.77, 1.26, 1.0], reverse: 4.23, final: 3.25, shift: 0.28, efficiency: 0.9 },
    drive: { layout: 'FR' },
    axles: [
      { suspension: 'macpherson', steered: true, tyre: '205/55R15', tyreKind: 'road', brake: 'disc', travel: 0.16 },
      { suspension: 'multi-link', tyre: '205/55R15', tyreKind: 'road', brake: 'disc', travel: 0.16 },
    ],
    brakes: { abs: true },
    aero: { cdA: 0.78 },
  },
  // ---- THE GARAGE'S REST (docs/VEHICLES.md §2–3: each one's real machine; the figures marked `e` there are estimates —
  // gear and axle ratios, some weights — to confirm; `published` only where a figure was found, so the universal
  // suite checks those and the general behaviour of the others). `aids: 'std'` as the Sierra K's: the real ones had none.
  // POWERLINE — Dodge WDX Power Wagon, 1946: 230 flathead six 94 hp @ 3200, 251 N·m low down; 4-speed, a 5.83 axle,
  // low 1.96; a 1-ton on 9.00-16s, leaf springs, drums; ~2470 kg. All gearing, no speed.
  powerline: {
    class: 'offroader', mass: { kerb: 2470, frontShare: 0.55, comHeight: 0.78 },
    power: { kind: 'petrol', peakPower: 70, powerRpm: 3200, peakTorque: 251, torqueRpm: [1200, 2000], redline: 3600, idle: 500 },
    transmission: { kind: 'manual', ratios: [6.4, 3.09, 1.69, 1.0], reverse: 7.82, final: 5.83 },
    drive: { layout: 'part-time-4WD', low: 1.96 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '9.00-16', tyreKind: 'mt', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '9.00-16', tyreKind: 'mt', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.65, frontalArea: 3.6 }, aids: 'std',
  },
  // FORTY-FIVE — Land Cruiser FJ45 pickup: the 2F 4.2 six (135 hp, 285 N·m @ 1800), 4-speed, 3.70 axles, low 2.31; ~1800 kg.
  fortyfive: {
    class: 'pickup', mass: { kerb: 1800, frontShare: 0.56, comHeight: 0.72 },
    power: { kind: 'petrol', peakPower: 99, powerRpm: 3600, peakTorque: 285, torqueRpm: [1800, 2400], redline: 4200, idle: 650, inertia: 0.4 },
    transmission: { kind: 'manual', ratios: [4.92, 2.64, 1.53, 1.0], reverse: 4.92, final: 3.7 },
    drive: { layout: 'part-time-4WD', low: 2.31 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '7.50-16', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.50-16', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.6, frontalArea: 2.9 }, aids: 'std',
  },
  // SQUAREBODY — Chevrolet K5 Blazer, 1984: the Sierra K's machine, a 4-speed overdrive automatic, a shorter wheelbase, ~2090 kg.
  squarebody: {
    class: 'offroader', mass: { kerb: 2090, frontShare: 0.54, comHeight: 0.74 },
    power: { kind: 'petrol', peakPower: 123, powerRpm: 3800, peakTorque: 360, torqueRpm: [1600, 2800], redline: 4600, idle: 650 },
    transmission: { kind: 'auto', ratios: [3.06, 1.63, 1.0, 0.7], reverse: 2.29, final: 3.73 },
    drive: { layout: 'part-time-4WD', low: 2.61 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '33x12.50R15', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '33x12.50R15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.52, frontalArea: 3.2 }, aids: 'std',
  },
  // BRONC — Ford Bronco, 1970: 302 V8 (205 gross ≈ 110 kW net, ~380 N·m), 3-speed, 4.11 axles, Dana 20 low 2.46; coils
  // (radius arms) in front, leaves behind; ~1600 kg on 2.34 m: the liveliest.
  bronc: {
    class: 'offroader', mass: { kerb: 1600, frontShare: 0.54, comHeight: 0.7 },
    power: { kind: 'petrol', peakPower: 110, powerRpm: 4400, peakTorque: 340, torqueRpm: [2200, 3000], redline: 5000, idle: 650 },
    transmission: { kind: 'manual', ratios: [2.99, 1.75, 1.0], reverse: 3.17, final: 4.11 },
    drive: { layout: 'part-time-4WD', low: 2.46 },
    axles: [{ suspension: 'solid-coil', steered: true, tyre: '7.50-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.50-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.55, frontalArea: 2.7 }, aids: 'std',
  },
  // SCOUTLING — International Scout 800, 1967: the 152 four (93 hp, ~194 N·m), 3-speed, 4.27 axles, Dana 18 low 2.46; ~1320 kg.
  scoutling: {
    class: 'offroader', mass: { kerb: 1320, frontShare: 0.54, comHeight: 0.68 },
    power: { kind: 'petrol', peakPower: 69, powerRpm: 4400, peakTorque: 194, torqueRpm: [2000, 2800], redline: 4800, idle: 650 },
    transmission: { kind: 'manual', ratios: [2.8, 1.55, 1.0], reverse: 3.8, final: 4.27 },
    drive: { layout: 'part-time-4WD', low: 2.46 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '7.00-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.00-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.56, frontalArea: 2.6 }, aids: 'std',
  },
  // STEPPE — Lada Niva VAZ-2121, 1977: 1.6 OHC 75 hp / 116 N·m, 4-speed, PERMANENT 4WD with a lockable centre, high 1.2 /
  // low 2.135, 4.3 axles; wishbones in front, a coil-sprung live axle behind; 1150 kg. ✓ 132 km/h.
  steppe: {
    class: 'offroader', published: { topSpeed: 132 }, mass: { kerb: 1150, frontShare: 0.56, comHeight: 0.62 },
    power: { kind: 'petrol', peakPower: 55, powerRpm: 5400, peakTorque: 116, torqueRpm: [3000, 3800], redline: 6000, idle: 800 },
    transmission: { kind: 'manual', ratios: [3.24, 1.99, 1.29, 1.0], reverse: 3.34, final: 4.3 * 1.2 },
    drive: { layout: 'AWD-permanent', centre: 'open', split: 0.5, low: 1.78, lockers: ['centre'] },
    axles: [{ suspension: 'double-wishbone', steered: true, tyre: '175/80R16', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-coil', tyre: '175/80R16', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.56, frontalArea: 2.2 }, aids: 'std',
  },
  // EIGHTY-EIGHT — Land Rover Series IIA 88": 2.25 petrol ~72 hp / 163 N·m, 4-speed, 4.7 axles, high 1.148 / low 2.35;
  // leaf springs, drums, narrow 7.00-16s; ~1350 kg.
  eightyeight: {
    class: 'offroader', mass: { kerb: 1350, frontShare: 0.53, comHeight: 0.7 },
    power: { kind: 'petrol', peakPower: 54, powerRpm: 4250, peakTorque: 163, torqueRpm: [1800, 2500], redline: 4800, idle: 650 },
    transmission: { kind: 'manual', ratios: [3.68, 2.22, 1.5, 1.0], reverse: 3.02, final: 4.7 * 1.148 },
    drive: { layout: 'part-time-4WD', low: 2.05 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '7.00-16', tyreKind: 'mt', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.00-16', tyreKind: 'mt', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.62, frontalArea: 2.6 }, aids: 'std',
  },
  // GUARDIAN — Land Rover Defender 90 200Tdi: 2.5 turbo-diesel 107 bhp / 265 N·m @ 1800, LT77 5-speed, LT230 PERMANENT 4WD
  // (lockable centre, high 1.211, low 3.32), 3.54 axles; coil-sprung beams; ~1700 kg. ✓ 137 km/h, 0–100 18.6 s.
  guardian: {
    class: 'offroader', published: { zeroTo100: 18.6, topSpeed: 137 }, mass: { kerb: 1700, frontShare: 0.5, comHeight: 0.6 },
    power: { kind: 'diesel', peakPower: 80, powerRpm: 3800, peakTorque: 265, torqueRpm: [1800, 2600], redline: 4400, idle: 750 },
    transmission: { kind: 'manual', ratios: [3.69, 2.13, 1.4, 1.0, 0.77], reverse: 3.54, final: 3.54 * 1.211 },
    drive: { layout: 'AWD-permanent', centre: 'open', split: 0.5, low: 2.74, lockers: ['centre'] },
    axles: [{ suspension: 'solid-coil', steered: true, tyre: '235/85R16', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-coil', tyre: '235/85R16', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.62, frontalArea: 2.9 }, aids: 'std',
  },
  // GELÄNDE — Mercedes W460 280 GE short: M110 2.8 six 156 PS / 226 N·m @ 4250, 4-speed, 5.33 axles, low 2.14, FRONT and
  // REAR lockers; coil-sprung beams; ~1880 kg. ✓ 155 km/h.
  gelande: {
    class: 'offroader', published: { topSpeed: 155 }, mass: { kerb: 1880, frontShare: 0.52, comHeight: 0.64 },
    power: { kind: 'petrol', peakPower: 115, powerRpm: 5250, peakTorque: 226, torqueRpm: [3800, 4600], redline: 6000, idle: 750 },
    transmission: { kind: 'manual', ratios: [3.9, 2.3, 1.41, 1.0], reverse: 3.7, final: 5.33 },
    drive: { layout: 'part-time-4WD', low: 2.14, lockers: ['rear', 'front'] },
    axles: [{ suspension: 'solid-coil', steered: true, tyre: '7.50-16', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-coil', tyre: '7.50-16', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.58, frontalArea: 2.8 }, aids: 'std',
  },
  // FORTY — Land Cruiser FJ40: the 2F six in a short 1600 kg body: 4-speed, 3.70 axles, low 2.31, leaves.
  forty: {
    class: 'offroader', mass: { kerb: 1600, frontShare: 0.54, comHeight: 0.7 },
    power: { kind: 'petrol', peakPower: 99, powerRpm: 3600, peakTorque: 285, torqueRpm: [1800, 2400], redline: 4200, idle: 650, inertia: 0.4 },
    transmission: { kind: 'manual', ratios: [4.92, 2.64, 1.53, 1.0], reverse: 4.92, final: 3.7 },
    drive: { layout: 'part-time-4WD', low: 2.31 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '7.50-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.50-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.6, frontalArea: 2.7 }, aids: 'std',
  },
  // SEVENTY — Land Cruiser BJ70: the 3B 3.4 diesel ~95 hp / 226 N·m @ 2200, 5-speed, 4.11 axles, low 2.28, leaves; ~1770 kg.
  seventy: {
    class: 'offroader', mass: { kerb: 1770, frontShare: 0.54, comHeight: 0.72 },
    power: { kind: 'diesel', peakPower: 70, powerRpm: 3500, peakTorque: 226, torqueRpm: [2000, 2600], redline: 4000, idle: 700 },
    transmission: { kind: 'manual', ratios: [4.93, 2.64, 1.52, 1.0, 0.86], reverse: 4.93, final: 4.11 },
    drive: { layout: 'part-time-4WD', low: 2.28 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '7.50-16', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.50-16', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.58, frontalArea: 2.8 }, aids: 'std',
  },
  // LYNX — Volkswagen Iltis: 1.7 four 75 PS / 135 N·m, 5-speed with a crawler first, the front axle selectable, a rear
  // locker; INDEPENDENT at both ends; 1300 kg on 2.02 m. ✓ 130 km/h.
  lynx: {
    class: 'offroader', published: { topSpeed: 130 }, mass: { kerb: 1300, frontShare: 0.54, comHeight: 0.66 },
    power: { kind: 'petrol', peakPower: 55, powerRpm: 5000, peakTorque: 135, torqueRpm: [2600, 3400], redline: 5600, idle: 800 },
    transmission: { kind: 'manual', ratios: [5.8, 3.32, 1.94, 1.24, 0.86], reverse: 5.6, final: 4.97 },
    drive: { layout: 'part-time-4WD', low: 1.5, lockers: ['rear'] },
    axles: [{ suspension: 'double-wishbone', steered: true, tyre: '6.50-16', tyreKind: 'mt', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'double-wishbone', tyre: '6.50-16', tyreKind: 'mt', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.6, frontalArea: 2.3 }, aids: 'std',
  },
  // WAYFARER — Ford Explorer, 1991: Cologne 4.0 V6 ~155 hp / 300 N·m @ 2400, 5-speed, part-time 4WD low 2.48, 3.73 axles;
  // twin I-beams on coils in front (independent), leaves behind; rear ABS; ~1820 kg. ✓ 0–60 9.2 s.
  wayfarer: {
    class: 'offroader', published: { zeroTo100: 10.2 }, mass: { kerb: 1820, frontShare: 0.54, comHeight: 0.68 },
    power: { kind: 'petrol', peakPower: 116, powerRpm: 4200, peakTorque: 300, torqueRpm: [2400, 3200], redline: 5000, idle: 700 },
    transmission: { kind: 'manual', ratios: [3.4, 2.05, 1.31, 1.0, 0.79], reverse: 3.4, final: 3.73 },
    drive: { layout: 'part-time-4WD', low: 2.48 },
    axles: [{ suspension: 'double-wishbone', steered: true, tyre: '235/75R15', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '235/75R15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.43, frontalArea: 2.6 }, aids: 'std',
  },
  // WAGON 63 — Jeep Wagoneer, 1963: Tornado 230 OHC six 140 hp / 285 N·m, 3-speed, 4.09 axles, Dana 20 low 2.03; leaves; ~1900 kg.
  wagon63: {
    class: 'offroader', mass: { kerb: 1900, frontShare: 0.54, comHeight: 0.7 },
    power: { kind: 'petrol', peakPower: 104, powerRpm: 4000, peakTorque: 285, torqueRpm: [1750, 2600], redline: 4600, idle: 650 },
    transmission: { kind: 'manual', ratios: [2.8, 1.55, 1.0], reverse: 3.8, final: 4.09 },
    drive: { layout: 'part-time-4WD', low: 2.03 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '7.00-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.00-15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.5, frontalArea: 2.9 }, aids: 'std',
  },
  // GRAND WAGON — Jeep Grand Wagoneer, 1986: AMC 360 V8 144 hp / 380 N·m @ 1500, 3-speed TorqueFlite, Selec-Trac
  // (full-time, an open centre), low 2.61, 3.31 axles; leaves; ~2045 kg.
  grandwagon: {
    class: 'offroader', mass: { kerb: 2045, frontShare: 0.55, comHeight: 0.64 },
    power: { kind: 'petrol', peakPower: 107, powerRpm: 3200, peakTorque: 380, torqueRpm: [1500, 2400], redline: 4400, idle: 650 },
    transmission: { kind: 'auto', ratios: [2.45, 1.45, 1.0], reverse: 2.2, final: 3.31 },
    drive: { layout: 'AWD-permanent', centre: 'open', split: 0.5, low: 2.61, lockers: ['centre'] },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '235/75R15', tyreKind: 'at', brake: 'disc', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '235/75R15', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.5, frontalArea: 2.9 }, aids: 'std',
  },
  // BOAR — Volvo TP21: Penta ED 3.7 side-valve six 90 bhp / 216 N·m, 4-speed, 5.86 axles, low 2.0; leaves, drums, 9.00-16s; 2575 kg.
  boar: {
    class: 'offroader', mass: { kerb: 2575, frontShare: 0.54, comHeight: 0.8 },
    power: { kind: 'petrol', peakPower: 67, powerRpm: 3600, peakTorque: 216, torqueRpm: [1400, 2200], redline: 4000, idle: 550 },
    transmission: { kind: 'manual', ratios: [6.07, 3.11, 1.64, 1.0], reverse: 6.0, final: 5.86 },
    drive: { layout: 'part-time-4WD', low: 2.0 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '9.00-16', tyreKind: 'mt', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '9.00-16', tyreKind: 'mt', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.65, frontalArea: 3.3 }, aids: 'std',
  },
  // WOODBOX — International R-140 Travelall 4×4: SD-240 six 107 hp / 264 N·m, 4-speed, 5.57 axles, low 1.94; leaves, drums; ~2100 kg.
  woodbox: {
    class: 'offroader', mass: { kerb: 2100, frontShare: 0.54, comHeight: 0.76 },
    power: { kind: 'petrol', peakPower: 80, powerRpm: 3800, peakTorque: 264, torqueRpm: [1600, 2400], redline: 4200, idle: 550 },
    transmission: { kind: 'manual', ratios: [7.06, 3.48, 1.71, 1.0], reverse: 7.0, final: 5.57 },
    drive: { layout: 'part-time-4WD', low: 1.94 },
    axles: [{ suspension: 'solid-leaf', steered: true, tyre: '7.50-16', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }, { suspension: 'solid-leaf', tyre: '7.50-16', tyreKind: 'at', brake: 'drum', travel: 0.28, springHz: 1.1 }],
    brakes: { abs: false }, aero: { cd: 0.6, frontalArea: 3.3 }, aids: 'std',
  },
} satisfies Record<string, VehicleSpec>
