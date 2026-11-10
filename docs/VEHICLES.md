# The garage to build — 21 vehicles, their real machines (2026-11-10)

The user: *"make all, for our game — doors, interior, wipers, everything; axles and physics based on each vehicle, not the
same for all; get each car's details online by its name; make the details as a note for all first."*

This is that note: the 21 machines **Over the Hill** (Funselektor, 2026) drives, each named for what it is based on —
**the real vehicle**, its public specs, and what our model of it needs (doors, interior, moving parts, look). We build
**our own** models of the real vehicles (as with the off-roader — `frontend/scripts/oth/offroader.py`): never their
designs, never their names. The working names in the first table are ours (rename freely).

Each spec becomes one `VehicleSpec` in `frontend/src/gameplay/vehicle/specs.ts` (`drivetrain/spec.ts`: the class, the
engine curve, the gearbox, the transfer case's low range, lockers, each axle's suspension / tyre / brakes, the published
0–100 and top speed that `tests/drivetrain.test.ts` checks the simulation against). **Physics differ per vehicle through
that data** — mass and centre of gravity, wheelbase and track (from the model), tyre size and kind, leaf vs coil vs
portal axles, part-time vs permanent 4WD, low range, lockers, torque curve, gearing.

**Sources.** Online first — Wikipedia, IGCD (the in-game list: igcd.net/game.php?id=1000019103), the makers' heritage
pages, spec databases (auto-data.net, cars-data.com, ultimatespecs, kfz-tech.de), period reviews and dealer listings.
Every figure is marked: **✓** found online (sources listed at the end), **~** online sources disagree (the value taken is
the best-supported), **e** not found online — a standard value for that model from its shop manual / its gearbox's
known ratios / its class (to confirm before tuning). Pre-1972 US engines are rated **gross** SAE; the sim takes the
figure given here as its peak (gross ≈ net × 1.3 — noted where it matters).

## 0. Status (what's built — 2026-11-10)

**18 of the 21 are in the garage**, each its own model, its own physics (`SPECS[id]`), its own colour and engine voice —
plus the Overlander 4×4 (ours, `scripts/oth/offroader.py`).

**All 19 are painted** (2026-11-10): `carkit.paint_texture` bakes one image over each car's paint — chips, scratches,
rust, mud — and the garage's colour goes through it (`whitePaint`). Two files a car: `<id>.glb` (PC, 2048²) and
`<id>.m.glb` (phones and LOW / MEDIUM, 1024²). The paint grain is off on them (`smooth`: its dots sparkled). Every
spare is a real wheel (`make_wheel`). After a rebuild run `scripts/oth/coplanar.py` on the files: no two skins in one
plane (they blink) — 17 of 19 clean; Steppe and Guardian keep ≤ 100 cm² under their sills.

| Built from the kit (`scripts/oth/cars.py` its numbers → `carkit.py` builds it → `<id>.glb` + `cars.json`) | ids |
|---|---|
| pickups (a 2-door cab + a bed) | `sierra`, `powerline`, `fortyfive` |
| short two-doors (a closed body, a back bench, side windows) | `squarebody`, `bronc`, `scoutling`, `steppe`, `eightyeight`, `guardian`, `gelande`, `forty`, `seventy`, `lynx` |
| wagons (four doors: `wayfarer`, `wagon63`, `grandwagon`, `boar`; two: `woodbox`) | |
| **not yet** — the three cab-overs (a body kind the kit lacks): Forward, Rust Ox, Mammoth | |

**Each its own shape** (2026-11-10, the user: "give each car its own body shape" — `cars.py` says each one's in a
line): ROUND mudguard wings beside a narrow peaked bonnet, lamp pods on them, running boards, a two-piece screen
(Powerline, Boar, Woodbox — the Woodbox's body framed in wood, red wheels under chrome caps); rounded mudguards with the
lamps in a pale bezel and turn lamps on the wings (Forty, Forty-Five); flat low wings, the lamps in the recessed panel
between them, a waist rail, a canvas top on bows, the spare on the bonnet (Eighty-Eight) — the same bones on coils with
lamps on the wings' fronts, flares and a rack (Guardian); full-width noses each with its face: chrome with stacked
square lamps (Sierra K, Squarebody), body colour with two bright slats (Bronc) or a wide mesh (Scoutling), a dark band
under a sloping bonnet with a hatch leaning in (Steppe), a dark slatted box with turn lamps on the wings (Gelände),
wide square lamps beside bright slats (Seventy; the Wayfarer's on a soft, fast-screened 90s body with alloys), a narrow
tall grille (Wagon 63), a full-width one of many bars over a wood strip (Grand Wagon), small lamps and a canvas top
(Lynx). Still the kit's panels: no compound curves — a real Forty's bonnet, a Steppe's flanks are rounder than these.

**Every one has** the off-roader's set: a hollow cabin (seats, dash, dials, linings), each door its own part with a
hinge (the driver's swings in play), the steering wheel, the pedals — the CLUTCH too, on the manuals: down as the
drivetrain's clutch opens (pulling away, each shift) —, the gear lever, the wipers, wheels at their hubs, axles / springs /
dampers, baked soft shadow and road dust in its vertex colours, dark glass. ~25–29 k triangles, ~1.2 MB each; only the
one you drive is loaded.

**Co-op:** each player's car is told to the others (the wire's `ride` — proto/wire.json intent 26 / event 55: on a
change, and again to whoever joins), and drawn as that car (Remotes.ts; the main car until they've said).

**The suspension's travel** in §3 was an estimate (0.18–0.26 m) and wrong for the game: the suite's stone — 0.55 × the
wheel's radius tall, ~21 cm, at 10 km/h — needs more travel than its height or the body is thrown (the G500 has 0.30).
Every kit car has 0.28 m and a 1.1 Hz ride; §3's column is superseded.

**The universal suite** (`tests/drivetrain.test.ts`, 745 checks, all pass) was written for a 600 N·m G-Class and a
sports car; three of its checks assumed their power, and now ask what a driver would do in each car instead — the
reason is the cars' real machines, not a tolerance loosened: (1) the 35° climb in low range used 60 % throttle — at
60 % the Steppe's 116 N·m makes 5.1 kN at the tyres in first-low and the slope takes 6.5: it is floored, as its driver
would (1.5 × what the slope takes, capped at full); (2) a truck geared to pull a house (a first gear past 5.5 : 1 on a
5.8 axle — Powerline, Boar, Woodbox) spins all four at 60 %: it takes 1.26 × what the slope needs, and has 30 s, not
12 (2 m/s is all first-low gives); (3) the brake-stand burnout and tyre-fire checks run only for cars whose first gear
can spin a tyre fast (≥ 9 m/s at the rim, flat out): a crawler's cannot — the suite prints SKIP for Powerline, Seventy,
Lynx, Boar, Woodbox. Every other check is as it was for every car.

**Checked:** `scripts/harness/fleetshot.mjs` loads each in the game (all 18: no errors, doors / controls / cabin / lamps
found); `carshot.mjs <dir> <id>` looks one over (inside, wipers, door, five paints, out and in).

---

## 1. The 21 — what each is

| # | Our working name | Real vehicle (generation) | In Over the Hill | Body | Doors that open | Seats |
|---|---|---|---|---|---|---|
| 1 | **Powerline** | Dodge WDX Power Wagon, 1946–68 | The Blast Wagon | 1-ton **pickup**, round fenders, spare on the bed side | 2 + bed tailgate | 3 (bench) |
| 2 | **Sierra K** | GMC K1500 Sierra (square body), 1981–87 | The Cumbre | ½-ton **pickup**, short bed, two-tone | 2 + tailgate | 3 (bench) |
| 3 | **Squarebody** | Chevrolet K5 Blazer, 1981–91 | The Trail Burner | full-size 2-door SUV, removable top | 2 + tailgate (window drops) | 5 |
| 4 | **Bronc** | Ford Bronco (1st gen), 1966–77 | The Bull V1 | small 2-door wagon | 2 + tailgate | 4 |
| 5 | **Wayfarer** | Ford Explorer (1st gen, 4-door), 1991–94 | The Roamer | mid-size 4-door SUV | 4 + liftgate | 5 |
| 6 | **Woodbox** | International Harvester R-140 Travelall (4×4), 1953–55 | The Timberbox | wagon on a truck nose, wood panels | 2 + rear barn doors | 6 |
| 7 | **Scoutling** | International Scout 800, 1965–71 | The Trailrat | small 2-door, roof can come off | 2 + tailgate | 4 |
| 8 | **Wagon 63** | Jeep Wagoneer (SJ, first years), 1963–65 | The Woodman | 4-door wagon, tall grille | 4 + tailgate | 6 |
| 9 | **Grand Wagon** | Jeep Grand Wagoneer (SJ), 1984–91 | The Grand Woodman | 4-door wagon, wood-grain strip | 4 + tailgate | 6 |
| 10 | **Steppe** | Lada Niva VAZ-2121, 1977–94 | The Polyana | small 3-door SUV | 2 + hatch | 4 |
| 11 | **Eighty-Eight** | Land Rover Series IIA 88", 1961–71 | The Tinny | short utility, canvas tilt | 2 + tailgate | 2 + 4 (benches) |
| 12 | **Guardian** | Land Rover Defender 90 200Tdi, 1990–94 | The Protector | short station wagon | 2 + side-hinged rear door | 4–7 |
| 13 | **Forward** | Land Rover 101 Forward Control, 1972–78 | The Marshal | cab-over 1-ton, box body | 2 + rear doors | 2 + cargo |
| 14 | **Gelände** | Mercedes-Benz W460 280 GE (short), 1979–91 | Das Wombat | short 3-door box | 2 + side-hinged rear door | 4 |
| 15 | **Rust Ox** | Mercedes-Benz T2 L 406 D ("Düdo"), 1967–86 | Das Rust OX | cab-over van / camper | 2 + sliding side + rear doors | 3 + camper |
| 16 | **Mammoth** | Mercedes-Benz Unimog 406 (U 84), 1963–89 | Das Mammoth | cab-over truck, drop-side flatbed | 2 + bed sides / tailgate | 2 |
| 17 | **Forty** | Toyota Land Cruiser FJ40 hardtop, 1960–84 | The Ding | short 2-door, white roof | 2 + rear barn doors | 4 |
| 18 | **Forty-Five** | Toyota Land Cruiser FJ45 **pickup**, 1960–84 | The Burro | long-wheelbase **pickup** | 2 + bed tailgate | 3 |
| 19 | **Seventy** | Toyota Land Cruiser BJ70 (3B diesel), 1984–90 | The Brick | short 3-door | 2 + rear barn doors | 4 |
| 20 | **Lynx** | Volkswagen Iltis (Type 183), 1978–88 | Das Lynx | light military 2-door, soft top | 2 | 4 |
| 21 | **Boar** | Volvo TP21 "Sugga", 1953–58 | The Boar | heavy 4-door command car | 4 | 5 |

(Already in the game: **Overlander 4×4** — our own, the G500 4×4²'s machine. Shelved: the G500 and the E30.)

**Pickups: 3** — Powerline, Sierra K, Forty-Five (and the Mammoth's flatbed). **Short 2-doors: 7** — Squarebody, Bronc,
Scoutling, Steppe, Eighty-Eight, Guardian, Gelände, Forty, Seventy, Lynx (the shortest: the Lynx, 2017 mm; the Steppe,
2200 mm). **Wagons: 5** — Wayfarer, Woodbox, Wagon 63, Grand Wagon, Boar. **Heavy: 3** — Forward, Rust Ox, Mammoth.

---

## 2. Engine and gearbox

| # | Engine | Power | Torque | Gearbox (ratios) | Transfer case, low range | Axle ratio |
|---|---|---|---|---|---|---|
| 1 Powerline | 230 cu in (3.8 L) flathead I6, petrol | ✓~ 94 hp (70 kW) @ 3200 (92–96 by source) | ✓ 185 lb·ft (251 N·m) @ 1200 | ✓ 4-speed manual; e 6.40 / 3.09 / 1.69 / 1.00, R 7.82 | ✓ 2-speed, **low 1.96** | e 5.83 |
| 2 Sierra K | 350 (5.7 L) V8, 4-bbl | ~ 165 hp (123 kW) @ 3800 | e 275 lb·ft (373 N·m) @ 1600 | ~ TH350 / TH400 3-speed auto; e 2.52 / 1.52 / 1.00, R 1.93 | e NP208 part-time, low 2.61 | e 3.73 |
| 3 Squarebody | 350 (5.7 L) V8 | ~ 160–167 hp (123 kW) @ 3800 | ~ 260–275 lb·ft (360 N·m) @ 1600 | ~ 4-speed auto (700R4) per listings; e 3.06 / 1.63 / 1.00 / 0.70, R 2.29 | e NP208, low 2.61 | e 3.73 |
| 4 Bronc | 302 (5.0 L) V8, 2-bbl | ✓ 205 hp **gross** (153 kW) @ 4600 — ≈ 150 net | ~ 300 lb·ft gross @ 2600 (one source: 220) → e 380 N·m | ✓ 3-speed manual, all-synchro; ~ 2.99 / 1.75 / 1.00, R 3.17 | e Dana 20, low 2.46 | e 4.11 |
| 5 Wayfarer | Cologne 4.0 L V6, EFI | ~ 155–160 hp (116 kW) @ 4200 | ✓ 220–225 lb·ft (300 N·m) @ 2400 | ✓ 5-speed manual (M5OD); e 3.40 / 2.05 / 1.31 / 1.00 / 0.79, R 3.40 | e BW 1354 part-time, low 2.48 | e 3.73 |
| 6 Woodbox | SD-240 (3.9 L) OHV I6 "Silver Diamond" | ✓ 107 hp (80 kW) @ 3800 e | e 195 lb·ft (264 N·m) @ 2000 | e 4-speed manual 7.06 / 3.48 / 1.71 / 1.00 | e 2-speed, low 1.94 | e 5.57 |
| 7 Scoutling | Comanche 152 (2.5 L) I4 (½ a 304 V8) | ✓ 93 hp (69 kW) @ 4400 | e 143 lb·ft (194 N·m) @ 2400 | ✓~ 3-speed manual (Warner T90); e 2.80 / 1.55 / 1.00, R 3.80 | e Dana 18, low 2.46 | e 4.27 |
| 8 Wagon 63 | Tornado 230 (3.8 L) **OHC** I6 | ✓ 140 hp (104 kW) @ 4000 | ✓~ 210 lb·ft (285 N·m) @ 1750 | ✓ 3-speed manual (column) / opt. 3-speed auto; e 2.80 / 1.55 / 1.00 | e Dana 20, low 2.03 | e 4.09 |
| 9 Grand Wagon | AMC 360 (5.9 L) V8 | ✓~ 144 hp (107 kW) @ 3200 (140 by one) | ~ 280 lb·ft (380 N·m) @ 1500 | ✓ 3-speed auto TorqueFlite 727; e 2.45 / 1.45 / 1.00, R 2.20 | ✓ Selec-Trac (full-time, open centre — a 2WD position), e low 2.61 | e 3.31 |
| 10 Steppe | VAZ-2121 1.6 L OHC I4 | ✓~ 75 hp (55 kW) @ 5400 (79 / 80 for later 1.7s) | ✓ 116 N·m @ 3400 | e 4-speed manual 3.24 / 1.99 / 1.29 / 1.00, R 3.34 | e permanent 4WD, **lockable centre**, high 1.20, low 2.135 | e 4.30 |
| 11 Eighty-Eight | 2.25 L OHV I4, petrol | ~ 70–77 hp (54 kW) @ 4250 | ✓~ 120 lb·ft (163 N·m) @ 2000 | ✓ 4-speed manual; e 3.68 / 2.22 / 1.50 / 1.00, R 3.02 | ✓ 2-speed, selectable 4WD (rear-drive on road); e high 1.148, low 2.35 | ✓ 4.70 |
| 12 Guardian | 200Tdi 2.5 L turbo-diesel I4 | ~ 107 bhp (80 kW) @ 3800 (113 by one) | ✓ 265 N·m @ 1800 | e LT77 5-speed 3.69 / 2.13 / 1.40 / 1.00 / 0.77, R 3.54 | e LT230 **permanent 4WD**, lockable centre, high 1.211, low 3.32 | e 3.54 |
| 13 Forward | Rover 3.5 L V8, petrol | ✓ 128 bhp (95 kW) @ 5000 | ✓ 185 lb·ft (251 N·m) @ 2500 | ✓ LT95 4-speed; e 4.07 / 2.13 / 1.38 / 1.00 | ✓ permanent 4WD, e lockable centre, high 1.174, low 3.32 | e 5.57 |
| 14 Gelände | M110 2.8 L DOHC I6, petrol | ✓ 156 PS (115 kW) @ 5250 | ✓ 226 N·m @ 4250 | e 4-speed manual 3.90 / 2.30 / 1.41 / 1.00, R 3.70 | e part-time, low 2.14; front + rear **lockers** | e 5.33 |
| 15 Rust Ox | OM 314 3.8 L diesel I4 | e 80 PS (59 kW) @ 2800 | e 235 N·m @ 1800 | e 4-speed manual 5.90 / 3.12 / 1.75 / 1.00 | — (the T2 was **rear-drive**; 4×4s were conversions) → e a part-time conversion, low 1.9 | e 5.29 |
| 16 Mammoth | OM 352 5.7 L diesel I6 | ✓ 84 PS (62 kW) @ 2550 | ✓ 262 N·m @ 1800 | ~ 6-speed synchro (+ creeper ranges on some: up to 20) ; e 10.8 / 6.0 / 3.6 / 2.1 / 1.25 / 0.79 | ✓ part-time, front + rear **lockers** | **portal** hubs, e overall 6.2 |
| 17 Forty | 2F 4.2 L OHV I6, petrol | ✓ 135 hp (99 kW) @ 3600 | ✓~ 210 lb·ft (271–285 N·m) @ 1800 | ✓ 4-speed manual; e 4.92 / 2.64 / 1.53 / 1.00, R 4.92 | ✓ 2-speed part-time, e low 2.31 | e 3.70 |
| 18 Forty-Five | 2F 4.2 L I6 | ✓~ 121–135 hp (96 kW) @ 3600 | ✓ 210 lb·ft (285 N·m) @ 1800 | e 4-speed manual as the Forty | e part-time, low 2.31 | e 3.70 |
| 19 Seventy | 3B 3.4 L diesel I4 | ~ 90–98 hp (70 kW) @ 3500 | ✓ 226 N·m @ 2200 | ✓ 5-speed manual; e 4.93 / 2.64 / 1.52 / 1.00 / 0.86, R 4.93 | ✓ 2-speed part-time, e low 2.28 | e 4.11 |
| 20 Lynx | 1.7 L OHC I4 (from the Passat), petrol | ✓ 75 PS (55 kW) @ 5000 | ✓~ 135 N·m @ 2800 | ✓~ 5-speed (its 1st an off-road crawler "G"); e 5.80 / 3.32 / 1.94 / 1.24 / 0.86 | e part-time (front axle selectable), rear **locker** | e 4.97 |
| 21 Boar | Penta ED 3.67 L side-valve I6 | ✓ 90 bhp (67 kW) @ 3600 | ✓ 159 lb·ft (216 N·m) | ✓ Volvo E9 4-speed; e 6.07 / 3.11 / 1.64 / 1.00 | e 2-speed part-time, low 2.0 | e 5.86 |

## 3. Chassis — the physics

| # | Kerb mass | Wheelbase | Track f / r | Length × width × height | Front / rear suspension | Tyres | Brakes | Top speed, 0–100 |
|---|---|---|---|---|---|---|---|---|
| 1 Powerline | e 2470 kg | ✓ 3200 mm (126 in) | e 1640 / 1640 | ✓ 5055 (199 in) × 1990 × 2040 | solid **leaf** / solid **leaf** | ✓ **9.00-16** bias (8-ply) | drum / drum | e 90 km/h, — |
| 2 Sierra K | e 1950 kg | e 2985 mm (117.5 in) | e 1690 / 1640 | e 4900 × 2020 × 1870 | solid leaf / solid leaf | e P235/75R15 | disc / drum | e 160, e 13 s |
| 3 Squarebody | e 2090 kg | e 2705 mm (106.5 in) | e 1690 / 1630 | e 4690 × 2020 × 1880 | solid leaf / solid leaf | e P235/75R15 | disc / drum | e 155, ~ 13–14 s |
| 4 Bronc | ~ 1600 kg (3200–3600 lb) | ~ 2337 mm (92 in — one source: 90) | e 1450 / 1450 | e 3870 × 1750 × 1810 | solid **coil** (radius arms) / solid leaf | ✓ 6.50-15 (e 7.35-15) | drum / drum | e 140, — |
| 5 Wayfarer | ~ 1820 kg (one source 2345 — a gross figure) | e 2842 mm (111.9 in) | e 1490 / 1490 | ✓ 4673 × 1778 × e 1730 | **twin I-beam** coil (independent) / solid leaf | e P235/75R15 | disc / drum (ABS rear) | e 170, ✓ 0–60 9.2 s → e 10 s |
| 6 Woodbox | e 2100 kg | ✓ 2921 mm (115 in) | e 1540 / 1540 | e 4950 × 1930 × 2000 | solid leaf / solid leaf | e 6.50-16 | drum / drum | e 100, — |
| 7 Scoutling | e 1320 kg | e 2540 mm (100 in) | e 1400 / 1400 | e 3860 × 1720 × 1720 | solid leaf / solid leaf | e 7.35-15 | drum / drum | e 120, — |
| 8 Wagon 63 | ✓~ 1900 kg (4200 lb) | ✓ 2794 mm (110 in) | e 1450 / 1450 | e 4730 × 1900 × 1680 | solid leaf (opt. independent) / solid leaf | e 7.75-15 | drum / drum | e 140, — |
| 9 Grand Wagon | ✓~ 2045 kg (4510 lb) | ✓~ 2761 mm (108.7 in) | e 1500 / 1470 | e 4740 × 1900 × 1700 | solid leaf / solid leaf | e P235/75R15 | disc / drum | e 160, e 14 s |
| 10 Steppe | ✓ 1150 kg | ✓ 2200 mm | e 1430 / 1400 | ✓ 3720 × e 1680 × 1640 | **double wishbone** coil / solid **coil** (5-link) | e 175/80R16 (6.95-16) | disc / drum | ✓ 132 km/h, ✓~ 19–23 s |
| 11 Eighty-Eight | e 1350 kg | ✓ 2235 mm (88 in) | e 1310 / 1310 | e 3620 × 1680 × 1950 | solid leaf / solid leaf | e 6.00-16 (7.50-16 opt.) | drum / drum | e 105, — |
| 12 Guardian | e 1700 kg | e 2360 mm | e 1486 / 1486 | e 3880 × 1790 × 2000 | solid **coil** / solid **coil** | e 205R16 (7.50R16) | disc / drum | ✓ 137 km/h, ✓ 18.6 s |
| 13 Forward | e 1920 kg | ✓ 2565 mm (101 in) | e 1520 / 1550 | e 4130 × 1840 × 2140 | solid leaf / solid leaf | e **9.00-16** | drum / drum | e 120, — |
| 14 Gelände | e 1880 kg | e 2400 mm | e 1425 / 1425 | e 4150 × 1700 × 1960 | solid **coil** / solid **coil** | e 205R16 | disc / drum | ✓ 155 km/h (the cabrio's), e 14 s |
| 15 Rust Ox | e 2400 kg | ✓~ 2950 mm (the T2's shortest) | e 1650 / 1600 | e 5200 × 2050 × 2500 | solid leaf / solid leaf | e 7.50R16 | drum / drum | e 95, — |
| 16 Mammoth | ✓~ 3600 kg (U 84) | ✓ 2380 mm | e 1630 / 1630 | e 4800 × 2140 × 2600 | **portal**, coil / **portal**, coil | e 10.5-20 | drum / drum | ✓~ 65–70 km/h, — |
| 17 Forty | ~ 1600 kg (a '74 hardtop: 1710) | ✓ 2285 mm (90 in) | e 1405 / 1400 | e 3840 × 1665 × 1950 | solid leaf / solid leaf | e 7.00-15 | drum (disc from '76) / drum | e 135, — |
| 18 Forty-Five | e 1800 kg | ~ 2950 mm (the long wheelbase) | e 1405 / 1400 | e 4900 × 1665 × 1950 | solid leaf / solid leaf | e 7.50-16 | disc / drum | e 130, — |
| 19 Seventy | ✓~ 1770 kg | ✓ 2310 mm | e 1415 / 1400 | e 3975 × 1690 × 1920 | solid leaf / solid leaf | e 7.50-16 | disc / drum | e 130, — |
| 20 Lynx | ✓~ 1300 kg | ✓ 2017–2020 mm | e 1230 / 1260 | e 3890 × 1520 × 1840 | **independent**, transverse leaf / **independent**, transverse leaf | e 6.50R16 | disc / drum | ✓~ 130 km/h, — |
| 21 Boar | ✓ 2575 kg (5676 lb, with driver + radio) | ✓ 2730 mm (107.5 in) | e 1510 / 1510 | e 4680 × 1900 × 1980 | solid leaf / solid leaf | e 9.00-16 | drum / drum | e 100, — |

### What makes each one drive differently (the `VehicleSpec` choices)

- **Leaf vs coil vs portal.** Leaf-sprung beam axles (most) — stiff, little articulation, the body rolls on them; the
  coil-sprung ones (Bronc's front, Guardian, Gelände, Steppe's rear) flex further; the Mammoth's **portal** axles lift
  its diffs high (the most clearance) and coil-spring them; the Lynx and the Wayfarer's front are **independent**.
- **4WD kind.** **Permanent** with a lockable centre: Steppe, Guardian, Forward (and Grand Wagon's Selec-Trac, open
  centre). **Part-time** (rear-drive until 4WD is selected — the rear steps out in the wet): all the rest.
- **Lockers.** Front + rear: Gelände, Mammoth. Rear: Lynx. None: the rest (they spin a wheel in the air).
- **Low range.** Deepest: Guardian / Forward 3.32 — crawlers. Shallowest: Powerline 1.96, Wagon 63 2.03.
- **Weight and height.** Lightest: Steppe 1150 kg, Lynx 1300, Scoutling 1320 — they bounce and skip. Heaviest: Mammoth
  3600, Boar 2575, Powerline 2470, Rust Ox 2400 — they plough, and tip at the tall cab-overs (the Rust Ox, the Forward).
- **Power-to-weight.** Most: Bronc (~96 kW/t gross), Gelände (61), Squarebody / Sierra (≈ 60), Wagon 63 (55). Least:
  Mammoth (17), Rust Ox (25), Boar (26), Powerline (28) — gearing, not speed.
- **Tyres.** Bias-ply on tall narrow rims (9.00-16, 7.50-16): the old ones — less road grip, good in mud; radials
  (P235/75R15, 205R16): the 80s ones; the Mammoth's 10.5-20: the biggest.
- **Driving aids (the real car's).** None for all but the Wayfarer (rear ABS). The game's aids setting still applies.

---

## 4. What each model needs (doors, interior, moving parts, look)

Every model gets the off-roader's set (its loader: `assets/loadModels.ts`): a **hollow cabin** with seats, dash, dials and
linings (`cab_*`); **every door cut** as its own part with a `hinge` (the driver's swings in play); the **steering wheel**,
the **pedals** (+ a **clutch** on the manuals), the **gear lever** and the **wipers** on their pivots; **four wheels**
each at its hub, its `rim` ratio; the **beam axles, diffs, springs and dampers** underneath (leaf packs where it has leaves,
coils where coils, the Mammoth's portal boxes); lamp lenses named for the loader; the paint panels on `CarPaint`. Its
look: the Over the Hill feel the user asked for (its cars — not its designs) — crisp edges, the paint's grain, dark glass,
pale steel wheels, a little worn.

| # | Moving parts beyond the set | Its own details |
|---|---|---|
| 1 Powerline | bed tailgate; 1-piece windscreen wipers hung from the top | round fenders and running boards, the spare on the bed's side, a front winch drum, split-rim steel wheels, a tall flat grille |
| 2 Sierra K | tailgate | two-tone paint, square quad lamps, chrome bumpers, a bench, a column shifter (auto: no clutch) |
| 3 Squarebody | tailgate (its glass winds down) | removable roof seam, chrome bumpers, the auto's column shifter |
| 4 Bronc | tailgate with the spare | tiny and square, round lamps, the "ROADSTER"-flat roof, a bench in the back |
| 5 Wayfarer | 4 doors, liftgate | 90s: flush glass, a roof rack, alloy-look wheels, an auto or 5-speed (manual: clutch) |
| 6 Woodbox | rear barn doors | the wood panels, the round 50s nose, a split windscreen |
| 7 Scoutling | tailgate; the roof as a separate part | a fold-down windscreen frame, the grille between round lamps |
| 8 Wagon 63 | 4 doors, tailgate | the tall slotted grille, chrome, a column shifter |
| 9 Grand Wagon | 4 doors, tailgate | the wood-grain strip, a chrome grille, a luxury bench interior |
| 10 Steppe | hatch | compact, a Fiat-like dash, a second (transfer) lever and the centre-lock lever in the cabin |
| 11 Eighty-Eight | tailgate; the canvas tilt | sliding side windows, the headlamps in the grille panel, the spare on the bonnet, fold-flat windscreen |
| 12 Guardian | side-hinged rear door with the spare | the flat panels, the bulkhead vents, the transfer and diff-lock levers |
| 13 Forward | rear box doors | cab-over: the driver above the front wheels, the box body, high mirrors |
| 14 Gelände | side-hinged rear door with the spare | the flat box, the indicators on the wings, the lockers' switches on the dash |
| 15 Rust Ox | sliding side door, rear doors | cab-over van, a camper's pop-top / interior, two-tone |
| 16 Mammoth | the bed's drop sides and tailgate | cab-over, portal axles, a big grille, a tilting cab look, the work lamps |
| 17 Forty | rear barn doors | the white roof, the "TOYOTA"-free grille, round lamps, the bench in the back |
| 18 Forty-Five | bed tailgate | the Forty's front, the long bed, a cab with the rear window |
| 19 Seventy | rear barn doors | square lamps in a grille, the 80s square body, a diesel's dash |
| 20 Lynx | the soft top | military: flat panels, a fold-down windscreen, jerry cans, simple seats |
| 21 Boar | 4 doors | the round 50s body, a big vertical grille, military fittings, a spare on the side |

---

## 5. To decide before building

1. **Order.** 21 models at the off-roader's level is many days of work. Suggested batches: (a) the 3 pickups — Sierra K,
   Powerline, Forty-Five; (b) the short 2-doors — Forty, Bronc, Steppe, Seventy, Guardian, Gelände, Lynx, Scoutling,
   Eighty-Eight, Squarebody; (c) the wagons — Wayfarer, Wagon 63, Grand Wagon, Woodbox, Boar; (d) the heavies — Forward,
   Rust Ox, Mammoth.
2. **Which doors open in play.** Today only the driver's swings (as the character gets in); the others are cut but
   still. Opening the rest needs a control.
3. **Unlocking.** All in the garage from the start, or earned (coins, places found — as the paints are)?
4. **The new parts the loader doesn't yet move:** tailgates, barn / sliding doors, a clutch pedal, a second gear lever
   (the transfer case), the canvas tilt and removable roofs — each a small addition to `assets/loadModels.ts` +
   `oth/Vehicle.ts`.
5. **Cost.** Each model's draws and triangles measured as the off-roader's were (`abq.mjs "car=offroader|car=<id>"`).
   ~25–30 k triangles each keeps them level with it; only the car you drive is loaded (plus co-op players' cars).

---

## Sources

- In-game list (each name ↔ its real vehicle): [IGCD — over the hill](https://www.igcd.net/game.php?id=1000019103);
  [OverTake — the complete vehicle list](https://www.overtake.gg/news/from-4x4s-to-unimogs-the-complete-over-the-hill-vehicle-list.5007/);
  [GameBrief — all 21 vehicles](https://www.gamebrief.net/blog/over-the-hill-car-list-all-vehicles-2026);
  [Over the Hill on Steam](https://store.steampowered.com/app/2929250/over_the_hill)
- Powerline: [Wikipedia — Dodge Power Wagon](https://en.wikipedia.org/wiki/Dodge_Power_Wagon);
  [Restore an Old Car — Power Wagon history](https://www.restore-an-old-car.com/dodge-power-wagon-history.html);
  [Vintage Power Wagons — Type D](https://vintagepowerwagons.com/pages/vehicle-type-d)
- Sierra K: [Streetside Classics — 1984 GMC K1500](https://streetsideclassics.com/vehicles/2925-phx/1984-gmc-k1500-4x4);
  [ClassicCars — 1984 Sierra K1500](https://classiccars.com/listings/view/2119274/1984-gmc-sierra-for-sale-in-homer-city-pennsylvania-15748)
- Squarebody: [CK5 — K5 Blazer specifications 1980–1991](https://ck5.com/forums/resources/k5-blazer-specifications-1980-1991.8/updates);
  [UltimateSpecs — Blazer 1985](https://www.ultimatespecs.com/fr/car-specs/Chevrolet/M11268/Blazer-1985);
  [Exotic Car Trader — 1984 K5 review](https://www.exoticcartrader.com/blog/chevrolet-k5-blazer-1984-review)
- Bronc: [Over-Drive — 1970 Bronco fact sheet](https://over-drive-magazine.com/2023/06/22/1970-ford-bronco-fact-sheet);
  [Bronco Graveyard — 1970 retrospective](https://broncograveyard.com/n-4683-retrospective.html);
  [CJ Pony Parts — 1977 Bronco specs](https://www.cjponyparts.com/resources/1977-ford-bronco-specs)
- Wayfarer: [auto-data — Explorer I 4.0 V6](https://www.auto-data.net/en/ford-explorer-i-4.0-v6-160hp-7878);
  [carspecs.us — 1991 Explorer](https://www.carspecs.us/cars/1991/ford/explorer/37310)
- Woodbox: [Wikipedia — International Travelall](https://en.wikipedia.org/wiki/International_Travelall);
  [Consumer Guide — 1954 R-140](https://blog.consumerguide.com/1954-international-model-r-140/)
- Scoutling: [Off Road Xtreme — Scout 1961–71](https://www.offroadxtreme.com/features/history/vintage-monday-1961-to-1971-international-harvester-scout/);
  [Silodrome — Scout buying guide](https://silodrome.com/buying-guide-international-harvester-scout)
- Wagon 63: [Curbside Classic — 1963 Wagoneer review](https://www.curbsideclassic.com/vintage-reviews/vintage-review-1963-jeep-wagoneer-jeeps-i-f-s-road-to-nowhere);
  [Metro — 1964 Wagoneer catalog](https://metrommp.com/Classic-Car-Guides-Ratings-Features/Jeep/1964-Jeep-Wagoneer-Catalog);
  [Wikipedia — Jeep Wagoneer (SJ)](https://en.Wikipedia.com/wiki/Jeep_Wagoneer_(SJ))
- Grand Wagon: [Wagoneer World — specs](https://www.wagoneerworld.com/specs.php);
  [Offroaders — Grand Wagoneer](https://www.offroaders.com/tech/jeep/Jeep-Grand-Wagoneer.htm)
- Steppe: [auto.ru — VAZ-2121](https://auto.ru/catalog/cars/vaz/2121/specifications/);
  [auto-abc — Niva 2121](https://www.auto-abc.eu/Lada-NIVA-2121/v7461-1977); [Wikipedia — VAZ-2121](https://wikipedia.com/wiki/VAZ-2121)
- Eighty-Eight: [Rovers North — Series engine specifications](https://www.roversnorth.com/files/Images/misc/land-rover-series-engine-specifications.pdf);
  [Goodwood — Series II buyer's guide](https://insurance.goodwood.com/buyers-guide/land-rover-series-ii/);
  [Allisons — Series IIA](https://www.allisons.org/ll/4/LandRover/S2A)
- Guardian: [Commercial Motor — 1991 range changes](https://archive.commercialmotor.com/article/13th-september-1990/12/lr-range-changes);
  [cars-data — Defender 90 Tdi](https://cars-data.com/en/land-rover/defender/1991-suv-5244/90-tdi--12856/specs)
- Forward: [Wikipedia — Land Rover 101 Forward Control](https://en.wikipedia.org/wiki/Land_Rover_101_Forward_Control);
  [Land Rover Monthly — Forward Controls](https://www.pressreader.com/uk/land-rover-monthly/20170201/282737701508827)
- Gelände: [cars-data — 280 GE](https://cars-data.com/en/mercedes-benz/g-class/1982-suv-5772/280-ge-estate-short--404/specs);
  [ADAC — 280 GE Station-Wagen kurz](https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/g-klasse/460/262307/)
- Rust Ox: [Wikipedia — Mercedes-Benz T2](https://en.wikipedia.com/wiki/T2_Transporter);
  [kfz-tech — Mercedes L 406](https://www.kfz-tech.de/Engl\Hersteller/Mercedes/MercedesL406.htm)
- Mammoth: [Wikipedia — Unimog 406](https://Www.Wikipedia.org/wiki/Unimog_406);
  [Endres Berlin — U 84 data sheet](https://endres-berlin.de/images/pdf/346cfb5f4f737554@5e25c571d83b2@5719.pdf);
  [Konedata — Unimog U 34 – U 84](https://koneviesti.fi/en/konedata/traktorit/mb-trac-unimog/unimog-u-34-u-84-agrar);
  [Trucksplanet — Unimog 406](https://www.trucksplanet.com/catalog/model.php?id=864)
- Forty / Forty-Five: [auto-data — Land Cruiser J40 4.2](https://www.auto-data.net/en/toyota-land-cruiser-j40-hard-top-4.2-125hp-4wd-3751);
  [Concept Carz — FJ40](https://www.conceptcarz.com/s23641/toyota-land-cruiser-fj-40.aspx);
  [TLC — FJ45](https://tlc4x4.com/vehicles/fj45/); [Silodrome — FJ45 pickup](https://silodrome.com/toyota-fj45-land-cruiser-pick-up-truck)
- Seventy: [Toyota — Land Cruiser 70 lineage](https://www.toyota-global.com/company/history_of_toyota/75years/vehicle_lineage/car/id60012612/);
  [auto-data — J70 3.4 D](https://www.auto-data.net/en/toyota-land-cruiser-j70-j73-3.4-d-bj70-98hp-4wd-3741)
- Lynx: [Volkswagen Newsroom — Iltis 1978–1988](https://volkswagen-newsroom.com/en/iltis-19781988-19697);
  [kfz-tech — VW Iltis](https://kfz-tech.de/Engl/Herstellerdaten/VW/VW_1982_Iltis.htm);
  [Maple Leaf Up — 183 technical](https://www.mapleleafup.nl/newjeep/vw183/183tech.htm)
- Boar: [Off Road Xtreme — Volvo TP21](https://www.offroadxtreme.com/?p=9730); [Remember Road — 1958 TP21](https://rememberroad.com/?p=8271)
