import { buildBikeSim, MTB_TUNE, type SimTune } from './MtbSim'
import type { MtbGeometry } from './mtbTypes'
import GEO from './moto.geometry.json'

/**
 * THE MOTORBIKE (2026-11-05, the user: "it's a cycle, not a bike — leave the cycle, we want a proper bike too, like the
 * stunt bike in GTA 5"): a 450 cm³ four-stroke motocross / enduro bike, our own design (moto.geometry.json, the model
 * scripts/oth/moto.py). The SAME machine as the bicycle (MtbSim.ts buildBikeSim — the fork along the steering axis,
 * the single-pivot rear, the knobbly tyres' friction circles, the lean as a hard roll constraint, the rider's weight
 * moving the COM, wheelies held at the balance point, flips and spins, landings judged, crashes) with its own numbers
 * and an ENGINE for the legs:
 *
 *   ENGINE      ~49 N·m at 8500 rpm (~61 hp at 9500), idle 1700, the limiter at 11 800; five gears (2.00 … 0.95) ×
 *               2.6 primary × 50 / 13 final: ~75 km/h in first, ~150 flat out in fifth (drag-limited). An AUTOMATIC
 *               CLUTCH (slips under 3200 rpm: a launch held at up to 6000 on full throttle; off the throttle it idles)
 *               and an AUTOMATIC SHIFT (up at 10 400 rpm with a 0.12 s cut, down under 4800 / 6500 on the throttle),
 *               engine braking off it. In the air it revs on the clutch.
 *   THE WRIST   the drive held to 1.3 × what the rear tyre can hold (a little wheelspin, never a stall in the dirt)
 *               and — as the bicycle's legs — no harder than keeps the front down, UNLESS the rider leans back (↓):
 *               then the throttle lifts the front and the rider's balance holds the WHEELIE (throttle eased, a dab of
 *               rear brake past the balance point). Lean forward on the brakes: a STOPPIE.
 *   SUSPENSION  310 mm both ends, coil-sprung (the gas columns long: near-linear) with a firm bumper; sag 25 / 32 %.
 *   STUNTS      a smaller preloaded hop (a 187 kg machine: the rider pumps it off a lip), flips ~1.5 s a turn, spins
 *               ~1.3 s; landings soak ~12 m/s into the ground (310 mm of travel + the legs).
 */
export const MOTO = GEO as unknown as MtbGeometry & { pegs: [number, number, number]; rider: MtbGeometry['rider'] & { standHip: [number, number, number] } }

const DEG = Math.PI / 180
const TAU = Math.PI * 2

export const MOTO_TUNE: SimTune = {
  ...MTB_TUNE,
  // ---- suspension: coils (long gas columns — near-linear), firmer bottom-out ----
  sagFront: 0.25,
  sagRear: 0.32,
  forkGas: 3,
  shockGas: 1.2,
  zetaComp: 0.42,
  zetaReb: 0.8,
  knee: 1.0,
  high: 0.5,
  bumper: 3,
  // ---- brakes, aero ----
  brakeTotal: 1.2,
  brakeFront: 0.62,
  cdaSeated: 0.62,
  cdaTuck: 0.5,
  // ---- steering ----
  leanFull: 36 * DEG,
  leanMax: 52 * DEG,
  steerRate: 3,
  rollRate: 1.5,
  gripAsk: 0.8,
  washOut: 1.1,
  // ---- stunts ----
  hopUp1: 1.05,
  hopUp2: 1.1,
  hopPitch: 2,
  preload: 0.45,
  legs: 0.9,
  airPitch: TAU / 1.5,
  airSpin: TAU / 1.3,
  airAcc: 12,
  airControlAfter: 0.3,
  // CLIMB ASSIST (the user: "climb every wall and hill and explore all"): on a steep face the tyres grip ×2.2, the drive
  // ×2, and the bike is held into the slope with up to 0.9 g
  climbGrip: 2.2,
  climbTorque: 2,
  climbStick: 0.9,
  landSideMin: 8,
  pushFloor: 0.1,
  wheelieUp: 520,
  wheelieDown: 600,
  pull: 300,
  // ---- crashes ----
  impactDv: 9,
  hardLanding: 12,
  bottomDv: 9,
  // ---- the build ----
  frameHalf: [0.15, 0.24, 0.42],
  frameAt: [0, 0.7, -0.02],
  bikeBox: [0.16, 0.3, 0.75],
  riderBox: [0.22, 0.42, 0.3],
  hitPoints: [0, 1.2, -0.3, 0, 0.95, 0.25, 0, 1.82, -0.02],
  torsoLean: 25 * DEG,
  spinMax: 9,
  engine: {
    // (2026-11-05, the user: "more speed and power so it can climb every wall and hill": ~80 hp, a taller top gear)
    torque: [[1500, 30], [3000, 44], [5000, 55], [7000, 62], [8500, 64], [9500, 60], [10500, 52], [11800, 40]],
    idle: 1700,
    redline: 11800,
    gears: [2.0, 1.6, 1.32, 1.08, 0.86],
    primary: 2.6,
    final: 50 / 13,
    shiftUp: 10400,
    shiftDown: 4800,
    shiftDownLoaded: 6500,
    shiftTime: 0.12,
    clutchRpm: 3200,
    launchRpm: 6000,
    engineBrake: 9,
    traction: 1.3,
    frontKeep: 0.14,
  },
}

export const MotoSim = buildBikeSim(MOTO, MOTO_TUNE)
export type MotoSim = InstanceType<typeof MotoSim>
