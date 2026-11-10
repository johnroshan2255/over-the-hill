/**
 * THE GARAGE — every drivable vehicle, its model, its stock setup and the player's tuning ranges.
 * Models live in `src/assets/models/vehicles/<id>.lod0.glb` (credits: ASSET_LIST.md § Credits) and are baked at
 * load by `assets/loadModels.ts` (`bakeVehicle`) into the game's own materials. Tuning is per vehicle, saved in
 * Settings (`garage`), edited on the landing page and in Settings → Garage, and applied live (`Car.retune`).
 */
export interface VehicleTuning {
  /** Engine power (kW). */
  power: number
  /** Drive force cap on the flat (kN) — pull off the line and up hills. */
  force: number
  /** Boost power multiplier (Shift / BOOST). */
  boost: number
  /** Tyre grip (Rapier frictionSlip ≈ μ). */
  grip: number
  /** Suspension stiffness (spring rate per kg). */
  suspension: number
  /** Tyre size multiplier (render + physics radius; bigger tyres = more ground clearance, slower steering). */
  tyre: number
  /** Kerb mass (kg). */
  mass: number
  /** Paint colour (#rrggbb): tints the paint panels (masked per model). */
  paint: string
}

export interface TuneRange {
  key: keyof VehicleTuning
  label: string
  min: number
  max: number
  step: number
  unit: string
}

export const TUNE_RANGES: TuneRange[] = [
  { key: 'power', label: 'Engine power', min: 20, max: 400, step: 5, unit: 'kW' },
  { key: 'force', label: 'Pulling force', min: 6, max: 30, step: 0.5, unit: 'kN' },
  { key: 'boost', label: 'Boost', min: 1.2, max: 3, step: 0.1, unit: '×' },
  { key: 'grip', label: 'Tyre grip', min: 1.2, max: 4, step: 0.1, unit: 'μ' },
  { key: 'suspension', label: 'Suspension', min: 18, max: 70, step: 1, unit: '' },
  { key: 'tyre', label: 'Tyre size', min: 0.8, max: 1.4, step: 0.05, unit: '×' },
  { key: 'mass', label: 'Weight', min: 700, max: 3600, step: 50, unit: 'kg' },
]

export const PAINTS: { name: string; hex: string }[] = [
  { name: 'Stock', hex: '#ffffff' }, { name: 'Rally Red', hex: '#e83a2a' }, { name: 'Safari Orange', hex: '#e8a23a' },
  { name: 'Desert Yellow', hex: '#f2d838' }, { name: 'Lime', hex: '#c8d82a' }, { name: 'Forest Green', hex: '#3aa64a' },
  { name: 'Teal', hex: '#2aa6a0' }, { name: 'Sky Blue', hex: '#2a7ee8' }, { name: 'Navy', hex: '#1e3a78' },
  { name: 'Violet', hex: '#7a3ae8' }, { name: 'Midnight', hex: '#1b1d22' }, { name: 'Sand', hex: '#c8b28a' },
  { name: 'Mud Brown', hex: '#8a6a48' }, { name: 'Silver', hex: '#c8ccd2' }, { name: 'Gunmetal', hex: '#5a616c' }, { name: 'Cream', hex: '#f2ead8' },
]

export interface VehicleDef {
  id: string
  name: string
  maker: string
  year: string
  blurb: string
  /** Model file (Vite URL), length after normalising (m) — chosen so the WHEELBASE matches the real vehicle
   *  (the off-roader 2.85 m — its file is in metres, nose to tail — · G500 4×4² 2.85 m · E30 2.57 m · kei van 1.84 m: the last two are already in metres, vehicle_prep.py); the
   *  human is a 1.78 m adult (CharacterModel). */
  url: string
  /** THE PHONES' file (a weak GPU, a phone, the LOW / MEDIUM tiers — loadModels `carDetail`): the same model with its
   *  painted texture at 1024², not 2048² — a quarter of the texture memory, a smaller download. Undefined: `url`. */
  urlSmall?: string
  length: number
  /** Which model axis points forward in the source file ('+z' = Sketchfab default; rotated to −Z in game). */
  forward: '+z' | '-z' | '+x' | '-x'
  /** Wheel meshes by node name (separate wheel parts); undefined = split wheels out of the body by shape. */
  wheelRegex?: RegExp
  /** Meshes whose material name matches take the paint colour; undefined = every body mesh — for textured models
   *  further limited per pixel to the body paint (loadModels buildPaintMap: the texture's dominant body hue). */
  paintRegex?: RegExp
  /** Look for an unnamed steering wheel to animate (a model without a `steering_wheel` part). */
  steering?: boolean
  /** Lamp lenses (car space, the RIGHT side; mirrored to the left), measured on the model: they WIN over the lamps
   *  found on the model at load (loadModels findLamps / findLampsInParts — a guess that put the G500's heads on its
   *  bumper), then a body-box guess. `head2`: a second headlamp per side (the E30's quad lamps); sizes are half
   *  extents (m). */
  lamps?: { head: [number, number, number]; tail: [number, number, number]; head2?: [number, number, number]; headSize?: [number, number]; tailSize?: [number, number] }
  /** The dash: 'twin' round speedo + tacho, 'single' speedo + lamp strip, 'screen' a wide twin screen (Cockpit). */
  dash: 'twin' | 'single' | 'screen'
  /** Paint mask for a WHITE (unsaturated) textured body: the bright neutral texels take the paint (buildPaintMap
   *  otherwise picks the body's dominant saturated hue). */
  whitePaint?: boolean
  /** Driver's cabin (measured in Blender, m): seated hip height, the roof's underside above the seat, and how far
   *  the hips sit behind the steering wheel's centre. The driver's seat x is the steering wheel's. */
  cabin: { hip: number; roof: number; behind: number }
  /** The car's own look (oth/Vehicle.ts): `smooth` — clean paint, none of the shared shader's grain; `glassTint` — how
   *  dark its windows are face-on (0.42 when unset; 1 = opaque). */
  smooth?: boolean
  glassTint?: number
  /** Its engine's voice (oth/engineSynth VOICES) when it has none under its own id: 'v8' | 'i6' | 'i4' | 'd4'. */
  voice?: string
  /** Draw live beam axles + diffs + driveshaft under the body (models without their own). */
  axles?: boolean
  /** Texture colour grade toward weathered real paint (loadModels gradeTexture): saturation and brightness factors. */
  grade?: { sat: number; gain: number }
  /** Engine voice (AudioSystem): pitch × the recorded loops (V8 low, small 4-cylinder high) and the automatic
   *  gearbox's shift speeds (m/s) — spaced to the car's own top speed so it never sits on the limiter. */
  engine: { pitch: number; gears: number[] }
  /** Exhaust tailpipe tip(s) in CAR space (m, as baked: −Z forward, +X right, ground y = 0, origin at the
   *  wheelbase centre) with each tip's HORIZONTAL outflow direction (normalised at load; the smoke rises by
   *  itself) — measured on the model where it has a pipe. The smoke puffs take turns between the tips (same total
   *  rate, so the same particle budget) and leave along `dir`. Undefined = one tip at the rear left under the
   *  bumper, blowing straight back. */
  exhaust?: { at: [number, number, number]; dir: [number, number, number] }[]
  stock: VehicleTuning
  /** The real machine (skills/realistic-vehicle-system §8.4): its public spec sheet, resolved at load against the
   *  model's measured wheelbase / track into the Simulation-handling drivetrain. The garage sliders scale it
   *  relative to `stock` (power, mass, grip, springs, tyre size). */
  spec: VehicleSpec
  /** Download size fallback for the progress bar (bytes). */
  bytes: number
}

import type { VehicleSpec } from './drivetrain/spec'
import { SPECS } from './specs'
import offroaderUrl from '../../assets/models/vehicles/offroader.glb?url'
import offroaderSmallUrl from '../../assets/models/vehicles/offroader.m.glb?url'
import CARS from './cars.json'
import g500Url from '../../assets/models/vehicles/mercedes_g500_4x4.lod0.glb?url'
import bmwUrl from '../../assets/models/vehicles/bmw_e30.lod0.glb?url'

/** THE KIT'S CARS (docs/VEHICLES.md — the garage of 21, 18 built): each OUR model of a real machine, made from its
 *  numbers by scripts/oth/cars.py + carkit.py (→ <id>.glb, its measures in cars.json), with its own physics
 *  (SPECS[id]). A row: id, name, year, the colour it wears here, its engine's voice (engineSynth VOICES), its sound's
 *  pitch, and a line about it. */
const KIT_URL = import.meta.glob('../../assets/models/vehicles/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const KIT_ROWS: [id: keyof typeof CARS & keyof typeof SPECS, name: string, year: string, paint: string, voice: string, pitch: number, blurb: string][] = [
  ['sierra', 'Sierra K', '1984', '#7d9cb8', 'v8', 0.85, 'A square-bodied half-ton pickup: a lazy V8, three gears, leaf springs and an open bed. Light at the back.'],
  ['powerline', 'Powerline', '1946', '#a8483a', 'i6', 0.75, 'A one-ton with round wings and a flathead six: slow, heavy, geared to pull a house.'],
  ['fortyfive', 'Forty-Five', '1975', '#c9a94e', 'i6', 0.85, 'The long pickup: a big six, four gears, leaf springs, a bed for the lumber.'],
  ['squarebody', 'Squarebody', '1984', '#6f93b5', 'v8', 0.85, 'The pickup made a wagon: the same V8 on a shorter wheelbase, a pale top.'],
  ['bronc', 'Bronc', '1970', '#c4674a', 'v8', 0.95, 'Small, square and over-engined: a V8 in 3.9 metres. The liveliest thing here.'],
  ['scoutling', 'Scoutling', '1967', '#c0623c', 'i4', 0.95, 'Half a V8 in a light little box: three gears and not much else.'],
  ['steppe', 'Steppe', '1977', '#4d8a8c', 'i4', 1.15, 'The smallest: 1150 kg, permanent four-wheel drive, coils. It skips where the others plough.'],
  ['eightyeight', 'Eighty-Eight', '1965', '#4f6b45', 'i4', 0.95, 'Flat panels on leaf springs and narrow tyres: 72 horsepower and all the time in the world.'],
  ['guardian', 'Guardian', '1991', '#7fb7c9', 'd4', 0.9, 'The crawler: a turbo-diesel, coils, permanent four-wheel drive and the deepest low range.'],
  ['gelande', 'Gelände', '1982', '#d9d6cc', 'i6', 1.05, 'A short flat box with a twin-cam six and lockers front and rear.'],
  ['forty', 'Forty', '1978', '#c9634c', 'i6', 0.85, 'The short one with the white roof: a big lazy six on leaf springs.'],
  ['seventy', 'Seventy', '1985', '#4c5f8f', 'd4', 0.85, 'Square and plain: a slow diesel, five gears, leaf springs. It just keeps going.'],
  ['lynx', 'Lynx', '1980', '#c8b98c', 'i4', 1.15, 'Tiny and military: independent at both ends, a crawler first gear, a rear locker.'],
  ['wayfarer', 'Wayfarer', '1991', '#b04a52', 'v8', 1.0, 'The modern one: a V6, five gears, a softer ride — the quickest on a road.'],
  ['wagon63', 'Wagon 63', '1963', '#7fc4a8', 'i6', 0.9, 'A four-door wagon with an overhead-cam six: room for six and their luggage.'],
  ['grandwagon', 'Grand Wagon', '1986', '#3f6f9f', 'v8', 0.8, 'The same wagon twenty years on: a big V8, an automatic, a strip of wood down its side.'],
  ['boar', 'Boar', '1954', '#8a7a52', 'i6', 0.75, 'Two and a half tons of round-nosed command car on tall tyres. Unhurried.'],
  ['woodbox', 'Woodbox', '1953', '#b84a4a', 'i6', 0.8, 'A truck nose with a long wagon body in wood: the family hauler of 1953.'],
]
const KIT: VehicleDef[] = KIT_ROWS.map(([id, name, year, paint, voice, pitch, blurb]) => {
  const c = CARS[id], spec: VehicleSpec = SPECS[id], top = (spec.published?.topSpeed ?? 130) / 3.6, n = spec.transmission.ratios?.length ?? 4
  return {
    id, name, maker: 'Overhill', year, blurb,
    url: KIT_URL[`../../assets/models/vehicles/${id}.glb`], length: c.length, forward: '-z', wheelRegex: /wheel_(FL|FR|RL|RR)/i, paintRegex: /CarPaint/i, bytes: c.bytes, dash: 'twin',
    urlSmall: KIT_URL[`../../assets/models/vehicles/${id}.m.glb`], whitePaint: true, smooth: true,      // painted (chips, rust, mud — carkit.paint_texture): the phones' file its texture at 1024²
    glassTint: 0.9, voice,
    cabin: { hip: c.hip, roof: c.roofInner, behind: 0.5 },
    // (the sound's gear steps: spread to its own top speed)
    engine: { pitch, gears: [0, ...Array.from({ length: n - 1 }, (_, k) => (top * (k + 1)) / (n + 0.6)), 70] },
    exhaust: [{ at: c.exhaust as [number, number, number], dir: [0, 0, 1] }],
    stock: { power: spec.power.peakPower, force: Math.min(22, 8 + spec.mass.kerb / 300), boost: 2.0, grip: 2.4, suspension: 40, tyre: 1, mass: Math.min(3600, spec.mass.kerb), paint },
    spec,
  }
})

export const VEHICLES: VehicleDef[] = [
  {
    // THE OFF-ROADER (2026-11-10, the user: "use the off-roader as main"): our own model, in the game's stylised look
    // (scripts/oth/offroader.py → offroader.glb, after docs/reference/offroad_truck_target.png) — a hollow cabin with
    // its seats and dash, four doors (the driver's swings), the steering wheel, pedals, gear lever and wipers on their
    // pivots, beam axles and coils underneath. Its machine is the G500 4×4²'s (SPECS.offroader: the same sheet) — it
    // drives as the main car always did. Every number below is the model's own (the script logs them).
    id: 'offroader',
    name: 'Overlander 4×4',
    maker: 'Overhill',
    year: '—',
    blurb: 'Lifted and boxy: a snorkel, a bull bar, a rack on the roof, a V8 under the bonnet. The mountain goat.',
    url: offroaderUrl, urlSmall: offroaderSmallUrl, length: 4.645, forward: '-z', wheelRegex: /wheel_(FL|FR|RL|RR)/i, paintRegex: /CarPaint/i, bytes: 2307212, dash: 'twin',
    // (2026-11-10: PAINTED — its texture carries the chips, the scratches, the mud, so the shared shader's grain is off
    //  (`smooth`): at a few metres its dots are one pixel each and SPARKLED as the car moved — the user: "some pixels
    //  blink"; and it is three height samples a pixel saved. The glass dark from outside.)
    smooth: true,
    glassTint: 0.9,
    // (its PAINTED TEXTURE — carkit.paint_texture: chips, scratches, rust, mud over a pale paint — the bright neutral
    //  texels take the garage's paint, the mud and the rust stay their own)
    whitePaint: true,
    cabin: { hip: 1.17, roof: 2.16, behind: 0.5 },
    // the round headlamps in the grille's dark boxes, the tail lamps at the back corners
    lamps: { head: [0.612, 1.205, -2.04], tail: [0.727, 1.07, 2.085], headSize: [0.1, 0.1], tailSize: [0.06, 0.083] },
    engine: { pitch: 0.8, gears: [0, 7, 14, 22, 31, 42, 70] },
    // one tailpipe under the back bumper, on the left
    exhaust: [{ at: [-0.45, 0.6, 2.15], dir: [0, 0, 1] }],
    stock: { power: 310, force: 18, boost: 2.0, grip: 2.8, suspension: 44, tyre: 1, mass: 3000, paint: '#5a5c5e' }, // (the reference's matte grey)
    spec: SPECS.offroader,
  },
  ...KIT,
]

/** SHELVED (2026-11-10, the user: "rename the G500 and keep it in our code; in the game use our new off-roader" — then
 *  the same for the BMW): kept whole — model, spec, voice — but out of the garage. `?car=g500` / `?car=e30` still load
 *  them (dev links, the A/B of the models' cost). Their old ids — `gwagen`, `bmw` — in a save or setting now give the
 *  off-roader. */
export const SHELVED: VehicleDef[] = [
  {
    id: 'g500',
    name: 'G500 4×4²',
    maker: 'Mercedes-Benz',
    year: '2015',
    blurb: 'Portal axles, twin-turbo V8, 45 cm of ground clearance. The mountain goat.',
    url: g500Url, length: 4.68, forward: '+z', wheelRegex: /wheel_(FL|FR|RL|RR)/i, paintRegex: /CarPaint/i, bytes: 1_977_452, dash: 'screen',
    cabin: { hip: 1.35, roof: 2.2, behind: 0.49 },
    // its two round headlamps in the wings (the lens parts `glas_light`, measured) and the tail lamps at the back
    // corners — the old fallback [0.66, 1.08, −2.44] floated 30 cm ahead of the grille, at bumper height
    lamps: { head: [0.597, 1.206, -2.13], tail: [0.7, 1.0, 2.29], headSize: [0.088, 0.088], tailSize: [0.07, 0.12] },
    engine: { pitch: 0.8, gears: [0, 7, 14, 22, 31, 42, 70] },
    // Side exits, as on the real 4×4²: twin tips each side under the sill just ahead of the rear wheels, angled
    // out and back (the model's own pipes; tip mouths measured, sides alternating).
    exhaust: [
      { at: [-0.84, 0.55, 0.58], dir: [-0.88, 0, 0.47] }, { at: [0.84, 0.55, 0.58], dir: [0.88, 0, 0.47] },
      { at: [-0.84, 0.56, 0.7], dir: [-0.88, 0, 0.47] }, { at: [0.84, 0.56, 0.7], dir: [0.88, 0, 0.47] },
    ],
    stock: { power: 310, force: 18, boost: 2.0, grip: 2.8, suspension: 44, tyre: 1, mass: 3000, paint: '#c8d82a' }, // (its original lime — the key art's truck; was olive #55604a)
    spec: SPECS.g500,
  },
  {
    id: 'e30',
    name: 'E30 M3',
    maker: 'BMW',
    year: '1986',
    blurb: 'The touring-car homologation special: a 2.3 L four that revs to 7250, a limited-slip rear and a box-flared body.',
    url: bmwUrl, length: 4.3185, forward: '+z', wheelRegex: /wheel_(FL|FR|RL|RR)/i, steering: true, bytes: 1_324_664, dash: 'twin',
    whitePaint: true,
    cabin: { hip: 0.42, roof: 1.3, behind: 0.42 },
    // quad round headlamps (outer + inner per side), the wide tail lamps (scripts/blender/vehicle_prep.py measure)
    lamps: { head: [0.586, 0.606, -1.99], head2: [0.41, 0.606, -1.99], headSize: [0.072, 0.072], tail: [0.51, 0.655, 2.22], tailSize: [0.148, 0.075] },
    engine: { pitch: 1.3, gears: [0, 13, 21, 30, 41, 54, 72] },
    // twin tips under the rear bumper on the left (the model's own pipes), blowing straight back
    exhaust: [{ at: [-0.4, 0.24, 2.16], dir: [0, 0, 1] }, { at: [-0.46, 0.24, 2.16], dir: [0, 0, 1] }],
    stock: { power: 147, force: 11, boost: 2.0, grip: 2.6, suspension: 40, tyre: 1, mass: 1200, paint: '#ffffff' },
    spec: SPECS.e30,
  },
]

export const DEFAULT_VEHICLE = 'offroader'

/** The car `id` — a garage car, a shelved one, else the main car (an id no longer there: an old save's `gwagen`). */
export function vehicleDef(id: string): VehicleDef {
  return VEHICLES.find((v) => v.id === id) ?? SHELVED.find((v) => v.id === id) ?? VEHICLES[0]
}

/** Stock setup with the player's saved overrides on top (clamped to the tuning ranges). */
export function tuningFor(id: string, saved?: Partial<VehicleTuning>): VehicleTuning {
  const t = { ...vehicleDef(id).stock, ...(saved ?? {}) }
  for (const r of TUNE_RANGES) (t as unknown as Record<string, number>)[r.key] = Math.min(r.max, Math.max(r.min, t[r.key] as number))
  return t
}

/** 0..1 stat bars for the cards (power-to-weight, pull, grip, tyres). */
export function vehicleStats(t: VehicleTuning): { label: string; value: number }[] {
  return [
    { label: 'Speed', value: Math.min(1, (t.power / t.mass) * 9) },
    { label: 'Torque', value: Math.min(1, t.force / 30) },
    { label: 'Grip', value: Math.min(1, (t.grip - 1) / 3) },
    { label: 'Tyres', value: Math.min(1, (t.tyre - 0.7) / 0.7) },
  ]
}

/** Overall rating 0..100 for the cards (weighted stats). */
export function vehicleRating(t: VehicleTuning): number {
  const st = vehicleStats(t)
  return Math.round((st[0].value * 0.35 + st[1].value * 0.3 + st[2].value * 0.2 + st[3].value * 0.15) * 100)
}

/** Class label for the cards. */
export function vehicleClass(t: VehicleTuning): string {
  const r = vehicleRating(t)
  return r >= 70 ? 'CLASS A' : r >= 45 ? 'CLASS B' : 'CLASS C'
}
