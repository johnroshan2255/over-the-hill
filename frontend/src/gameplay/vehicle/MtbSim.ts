import type RAPIER from '@dimforge/rapier3d-compat'
import { group, Groups, type PhysicsWorld } from '../../physics/PhysicsWorld'
import { grip as newGrip, gripFor, roughness, surfaceMix, type SurfaceMix, type TyreKindDef } from './drivetrain/tyre'
import { MTB, type MtbControls, type MtbGeometry, type MtbSimApi, type MtbWheelState } from './mtbTypes'

/**
 * THE MOUNTAIN BIKE'S PHYSICS (no rendering — tests/mtb.test.ts, Node + real Rapier). The bike + rider is ONE Rapier
 * dynamic body (its pose = the frame's, game space as in mtb.geometry.json); the wheels, the suspension, the tyres, the
 * legs and the rider are solved here at the VELOCITY level, before the world step, from ray casts:
 *
 *   SUSPENSION  The FORK slides along the steering axis (its ray runs down −axis through the tyre); the REAR is a
 *               single pivot (its ray down the frame's up through the axle; the axle's rise inverted to the swingarm
 *               angle, the shock's eye-to-eye from the mounts — tabulated over the arc). AIR SPRINGS ((V₀/V)^γ − 1:
 *               progressive, sized for 27 % / 30 % sag with this rider; the rear's on the shock stroke through the
 *               frame's leverage, 2.5 → 2.7), a bottom-out bumper over the last 10 %, then an inelastic HARD STOP.
 *               Dampers on each shaft's motion (the tyre's approach speed): compression ζ 0.45, digressive past
 *               0.6 m/s, rebound ζ 0.85, implicit. The TYRE is a torus (r, a crown of half its width) on the plane hit:
 *               leant, its axle drops as a real tyre's does. A tyre ENVELOPE (2 rays ahead of the hub) climbs kerbs
 *               on the spring; the tyre guards (balls on the axles, Static only) meet what it can't.
 *   TYRES       Knobbly (μ 1.05 × 1.25 off road: dirt 0.92, grass 0.79, sand 0.72, mud 0.59; rain takes its share)
 *               through the game's surface callback. Per contact a Coulomb friction CIRCLE solved as sequential
 *               impulses: the side grip holds the wheel's line until the circle is full, then it slides at the kinetic
 *               μ; the longitudinal is the drive less the brake + rolling resistance (Crr per surface: sand bogs, rock
 *               rolls), a brake that can stop the contact locks it (a rear skid). Massless wheels, spun by the ground.
 *   LEGS        375 W at full effort (+45 % on a 15° climb: the rider digs in), a 900 W sprint for ~8 s that fades and
 *               recovers (30 s), a leg-force cap (700 N seated, 1000 N standing), a torque pulse over the stroke,
 *               32T × 10–51T auto-shifted for 70–95 rpm (on the road speed — a spinning tyre doesn't fool it), a
 *               freewheel, legs that can't spin past 130 rpm.
 *   BALANCE     A HARD roll constraint while a wheel is down (as BikeSim — a torque PD on the roll inertia explodes at
 *               60 Hz): every impulse acts through the inverse inertia taken in the GROUND's frame with the roll locked
 *               (yaw about the normal, pitch about the ground's lateral axis), and the lean RATE is then set toward the
 *               lean of the asked turn, rotating about the contact line (+ its centripetal term). The bike leans first;
 *               the bars give the turn the lean holds. Rapier's gyroscopic term is undone while balanced. Past 50° of
 *               lean, or a front sliding for 0.45 s while leant: a wash-out.
 *   RIDER       Moves the COM (0.30 m back / 0.20 m forward at full lean, standing, crouching). Instincts: back and low
 *               under hard braking, forward (and standing) to keep the front down when pushing, the hips back off a
 *               drop, a wheelie / manual held at its balance point (a bounded couple + a dab of rear brake), a stoppie
 *               held by easing the front lever — but not at speed with the weight forward: over the bars. Bunny hop:
 *               crouch preloads, release pops the front, then the rear and levels it. Air: lean flips, steer spins,
 *               damped when let go, the roll levelled. The legs soak a landing (0.7 g for 0.3 s on top of the travel).
 *               A FOOT DOWN when slow with nothing pressed (a hill hold, latched until the pedals or the lever); the
 *               brake held 0.6 s at a standstill walks it back at ≤ 0.38 m/s.
 *   CRASHES     An impact (> 6 m/s of velocity change in a step at the axles / frame / head), a landing nose-in /
 *               nose-up / sideways / upside down / too hard (> 8.5 m/s), a bottom-out beyond the travel, a looped
 *               wheelie, over the bars, a wash-out: the RIDER BAILS (a 75 kg capsule thrown on, tumbling), and the bike
 *               (now 15.5 kg) falls and lies on its wheel discs. remount() puts it back.
 * Real gravity (9.81 by the gravity scale; the world's is 20). Cost: 6 ray casts, ~20 µs a step (Node, measured).
 */

type V3 = [number, number, number]
const v3 = (a: readonly number[]): V3 => [a[0], a[1], a[2]]
const G = 9.81
const DEG = Math.PI / 180
const TAU = Math.PI * 2
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)

/** Tunables (game-tuned, measured in tests/mtb.test.ts). */
export const MTB_TUNE = {
  // ---- the legs ----
  /** Seated pedalling power (W) at full effort, the sprint (W) and how long it lasts / takes to recover (s). */
  power: 375,
  sprintPower: 900,
  sprintTime: 8,
  sprintRecover: 30,
  /** Mean leg force on the pedals (N) seated / standing — caps the torque at low cadence (climbs, launches). */
  forceSeated: 700,
  forceStanding: 1000,
  /** Torque pulse over the stroke (± share, two strokes a turn). */
  pulse: 0.25,
  cadenceMax: 130,
  cadenceLo: 70,
  cadenceHi: 95,
  /** The rider digs in on a climb: power × (1 + climbDig) on a 15° (27 %) grade, in proportion below it (375 W alone
   *  climbs 15° at only ~5 km/h). */
  climbDig: 0.45,
  // ---- the suspension ----
  sagFront: 0.27,
  sagRear: 0.3,
  /** Air springs: gas column length (m) of the fork and of the shock (on its stroke), polytropic exponent. */
  forkGas: 0.4,
  shockGas: 0.12,
  gamma: 1.3,
  zetaComp: 0.45,
  zetaReb: 0.85,
  /** Digressive compression: the knee (m/s) and the slope past it (× the low-speed rate). */
  knee: 0.6,
  high: 0.45,
  /** Bottom-out bumper: × the design load at full travel, over the last 10 %. */
  bumper: 2.5,
  // ---- brakes ----
  /** Both levers' capacity (× m·g at the tyres) and the front's share. */
  brakeTotal: 1.25,
  brakeFront: 0.6,
  // ---- aero ----
  cdaSeated: 0.5,
  cdaTuck: 0.38,
  // ---- steering / balance ----
  /** The lean a full key asks for (the lock eases with speed for it), the lean that washes out. */
  leanFull: 32 * DEG,
  leanMax: 50 * DEG,
  /** Bars: max rate (rad/s). Roll servo: gain (1/s) and max roll rate (rad/s). */
  steerRate: 3.5,
  rollK: 5,
  rollRate: 1.6,
  /** The turn the bars give ahead of the lean (as a lean, rad): starts the turn; at walking pace the whole lock. */
  leanLead: 5 * DEG,
  /** The most of the tyres' grip the rider asks for in a turn. */
  gripAsk: 0.9,
  // ---- stunts ----
  /** Bunny hop: up-speed of the front pop and the rear pull (m/s), the pitch kick (rad/s), the crouch preload (× m·g). */
  hopUp1: 1.6,
  hopUp2: 1.65,
  hopPitch: 3.0,
  preload: 0.55,
  /** The rider's legs on a landing: the deceleration they add (× g) for 0.3 s. */
  legs: 0.7,
  /** Air: flip rate (rad/s, ~1.2 s a turn), spin rate (rad/s, ~1 s a turn), their angular acceleration and the
   *  damping once let go (1/s). */
  airPitch: TAU / 1.2,
  airSpin: TAU / 1.0,
  airAcc: 16,
  airDamp: 2.5,
  /** Wheelie / manual balance: the rider's couple nose-up / nose-down (N·m), the extra pull to lift the front
   *  (N·m, 0.5 s), how long a manual holds before it fades (s). */
  wheelieUp: 240,
  wheelieDown: 260,
  pull: 260,
  manualHold: 1.2,
  manualFade: 1.5,
  // ---- crashes ----
  impactDv: 6,
  /** Landing: the hardest touch-down (m/s into the ground) the travel + legs soak (~3.7 m to flat). */
  hardLanding: 8.5,
  bottomDv: 6.5,
  noseIn: 45 * DEG,
  noseUp: 55 * DEG,
  sideways: 40 * DEG,
  loopOut: 80 * DEG,
  overBars: 40 * DEG,
  // ---- the build (per machine: the bicycle's here, the motorbike's in MotoSim.ts) ----
  /** The frame's box collider: half sizes and centre (frame space). */
  frameHalf: [0.06, 0.27, 0.37] as number[],
  frameAt: [0, 0.69, -0.01] as number[],
  /** Inertia boxes (half sizes) round the bike's and the rider's COM. */
  bikeBox: [0.08, 0.3, 0.8] as number[],
  riderBox: [0.2, 0.42, 0.28] as number[],
  /** Where it meets things besides the axles (frame space, x y z …): the head tube, the saddle, the rider's head. */
  hitPoints: [0, 0.93, -0.3, 0, 1.03, 0.33, 0, 1.68, -0.02] as number[],
  /** The rider's torso collider leant this far forward (rad), and the bail capsule's lean. */
  torsoLean: 40 * DEG,
  /** The most rim speed a spinning rear tyre runs ahead of the ground (m/s). */
  spinMax: 3,
  /** Air control (flips, spins) only after this long in the air (s): a bump skipped at speed isn't a jump — the
   *  motorbike's; the bicycle's at once. */
  airControlAfter: 0,
  /** CLIMB ASSIST (the motorbike — GTA's: "climb every hill"): from climbFrom up to climbFull of slope it grows to
   *  full — the tyres' grip × climbGrip, the drive × climbTorque, and a pull into the slope (climbStick × g) that keeps
   *  the tyres loaded on a face; 0 / 1 / 1 / 0: none (the bicycle). */
  climbFrom: 12 * DEG,
  climbFull: 55 * DEG,
  climbGrip: 1,
  climbTorque: 1,
  climbStick: 0,
  /** A landing is judged SIDEWAYS only above this speed along the ground (m/s): slower it's a hop on a climb. */
  landSideMin: 3,
  /** A front sliding while leant this long (s) washes out. */
  washOut: 0.45,
  /** Pushing hard, the drive the rider lets through at the least (× the asked) when the front would lift. */
  pushFloor: 0.3,
  /** The ENGINE (null: pedalled — the legs above). */
  engine: null as EngineSpec | null,
}
export type SimTune = typeof MTB_TUNE

/** A motorbike's engine and gearbox (MotoSim.ts): torque curve, the ratios, the automatic clutch and shift. */
export interface EngineSpec {
  /** [rpm, N·m] pairs, rising rpm: the torque at full throttle. */
  torque: [number, number][]
  idle: number
  redline: number
  /** Gearbox ratios (1st …), the primary drive and the final drive (sprockets). */
  gears: number[]
  primary: number
  final: number
  /** The automatic shift: up past shiftUp (on the throttle), down under shiftDown (shiftDownLoaded on the throttle). */
  shiftUp: number
  shiftDown: number
  shiftDownLoaded: number
  /** A shift's torque cut (s). */
  shiftTime: number
  /** The clutch slips below clutchRpm (the engine held up to launchRpm on full throttle while the wheel catches up). */
  clutchRpm: number
  launchRpm: number
  /** Off the throttle: the engine's braking torque at the redline (N·m, less as the revs fall). */
  engineBrake: number
  /** The right wrist: the drive no more than traction × what the rear can hold (unless leaning back for a wheelie). */
  traction: number
  /** Wheelie control: the throttle eases once the front carries less than this share of the weight (not leaning back). */
  frontKeep: number
}

/** Build a bike's simulation from its geometry and tuning — the bicycle (MtbSim, below) and the motorbike (MotoSim.ts)
 *  are the same machine: suspension, tyres, balance, rider, stunts and crashes; only the drive differs. */
export function buildBikeSim(MTB: MtbGeometry, TN: SimTune) {
  const EN = TN.engine
  const torqueAt = (rpm: number): number => {
    const t = EN!.torque
    if (rpm <= t[0][0]) return t[0][1]
    for (let i = 1; i < t.length; i++) if (rpm <= t[i][0]) { const [a, ta] = t[i - 1], [b, tb] = t[i]; return ta + ((tb - ta) * (rpm - a)) / (b - a) }
    return t[t.length - 1][1]
  }

  // ---------------------------------------------------------------- the geometry (mtb.geometry.json)
  const R_W = MTB.wheel.radius
  /** The tyre's crown radius (half its width): the tyre is a torus, the contact rolls round it as the bike leans. */
  const RHO_T = MTB.wheel.tyreWidth / 2
  const FRONT = v3(MTB.frontAxle), REAR = v3(MTB.rearAxle)
  const AX = v3(MTB.steer.axis)
  const CROWN = v3(MTB.steer.crown)
  const FC: V3 = [FRONT[0] - CROWN[0], FRONT[1] - CROWN[1], FRONT[2] - CROWN[2]]
  const T_F = MTB.fork.travel, T_R = MTB.rear.wheelTravel
  const PIVOT = v3(MTB.rear.pivot), SFM = v3(MTB.rear.shockFrameMount), SSM = v3(MTB.rear.shockSwingarmMount)
  const EYE = MTB.rear.shockEyeToEye
  const WB = REAR[2] - FRONT[2]
  const TEETH = MTB.cassette.teeth
  const RING = MTB.crank.chainringTeeth
  const CRANK = MTB.crank.length
  const MAX_STEER = MTB.steer.maxSteerDeg * DEG
  const M_BIKE = MTB.mass.bike, M_RIDER = MTB.mass.rider, M_ALL = M_BIKE + M_RIDER
  const BIKE_COM = v3(MTB.mass.bikeCom), RIDER_COM = v3(MTB.mass.riderComSeated)
  /** Above the top of each wheel's travel the ray starts this much higher (m). */
  const MARGIN = 0.06
  /** The tyre envelope's samples ahead of the hub (× the tyre radius). */
  const ENV_S = [0.45, 0.8]

  // Swingarm: R(a) about the pivot (the geometry's rotation sense). The axle's rise inverted to the angle, the shock's
  // eye-to-eye from it, the frame's leverage (wheel / shock) — tabulated over the travel.
  const P0Y = REAR[1] - PIVOT[1], P0Z = REAR[2] - PIVOT[2]
  const RHO = Math.hypot(P0Y, P0Z), BETA = Math.atan2(P0Y, P0Z)
  const Q0Y = SSM[1] - PIVOT[1], Q0Z = SSM[2] - PIVOT[2]
  /** Swingarm angle (rad) for an axle rise (m): y(a) = y0 cos a + z0 sin a = ρ sin(a + β). */
  function swingOf(rise: number): number {
    return Math.asin(clamp((P0Y + rise) / RHO, -1, 1)) - BETA
  }
  /** Shock eye-to-eye (m) at a swingarm angle (rad). */
  function shockOf(a: number): number {
    const c = Math.cos(a), s = Math.sin(a)
    const my = PIVOT[1] + Q0Y * c + Q0Z * s, mz = PIVOT[2] - Q0Y * s + Q0Z * c
    return Math.hypot(my - SFM[1], mz - SFM[2])
  }
  const NT = 64
  const airSpring = (x: number, gas: number) => Math.pow(gas / (gas - Math.min(x, gas * 0.95)), TN.gamma) - 1
  const FORK_U = new Float64Array(NT + 1)
  const SWING_T = new Float64Array(NT + 1), SHOCK_T = new Float64Array(NT + 1), REAR_U = new Float64Array(NT + 1)
  for (let i = 0; i <= NT; i++) {
    FORK_U[i] = airSpring((i / NT) * T_F, TN.forkGas)
    SWING_T[i] = swingOf((i / NT) * T_R)
    SHOCK_T[i] = shockOf(SWING_T[i])
  }
  for (let i = 0; i <= NT; i++) {
    const a = Math.max(0, i - 1), b = Math.min(NT, i + 1)
    const lever = ((b - a) * (T_R / NT)) / Math.max(1e-6, SHOCK_T[a] - SHOCK_T[b]) // wheel travel per shock travel
    REAR_U[i] = airSpring(EYE - SHOCK_T[i], TN.shockGas) / lever
  }
  const lerpT = (tab: Float64Array, x: number, T: number) => {
    const f = clamp(x / T, 0, 1) * NT, i = Math.min(NT - 1, f | 0)
    return tab[i] + (tab[i + 1] - tab[i]) * (f - i)
  }
  const slopeT = (tab: Float64Array, x: number, T: number) => {
    const f = clamp(x / T, 0, 1) * NT, i = Math.min(NT - 1, f | 0)
    return ((tab[i + 1] - tab[i]) * NT) / T
  }

  // Mass: the bike a long slim box round its COM (wheels at the ends), the rider a box round theirs.
  function boxI(m: number, h: V3, at: V3, com: V3): V3 {
    const dx = at[0] - com[0], dy = at[1] - com[1], dz = at[2] - com[2]
    return [
      (m / 3) * (h[1] * h[1] + h[2] * h[2]) + m * (dy * dy + dz * dz),
      (m / 3) * (h[0] * h[0] + h[2] * h[2]) + m * (dx * dx + dz * dz),
      (m / 3) * (h[0] * h[0] + h[1] * h[1]) + m * (dx * dx + dy * dy),
    ]
  }
  const BIKE_BOX = v3(TN.bikeBox), RIDER_BOX = v3(TN.riderBox)
  const RIDE_COM: V3 = [0, (M_BIKE * BIKE_COM[1] + M_RIDER * RIDER_COM[1]) / M_ALL, (M_BIKE * BIKE_COM[2] + M_RIDER * RIDER_COM[2]) / M_ALL]
  const RIDE_I: V3 = (() => {
    const a = boxI(M_BIKE, BIKE_BOX, BIKE_COM, RIDE_COM), b = boxI(M_RIDER, RIDER_BOX, RIDER_COM, RIDE_COM)
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  })()
  const BIKE_I: V3 = boxI(M_BIKE, BIKE_BOX, BIKE_COM, BIKE_COM)

  /** The knobbly enduro tyre (a TyreKindDef for gripFor): grippy everywhere, more so off road. */
  const KNOBBLY: TyreKindDef = { mu: 1.05, peakAlpha: 9 * DEG, offroad: 1.25, snow: 1.1, ice: 1 }

  const RAY_GROUPS = group(0xffff, Groups.Terrain | Groups.Static)
  /** Where the bike meets things (frame space): the axles (the tyre guards), the head tube, the saddle, the rider's head. */
  const HIT_POINTS = [...FRONT, ...REAR, ...TN.hitPoints]
  const BODY_GROUPS = group(Groups.Vehicle, 0xffff & ~Groups.Player)
  /** TYRE GUARDS (as VehicleBase's): a ball of 0.65 × the tyre round each axle that meets only Static (rocks, trunks,
   *  walls, props, the slab stacks) — a wheel is a ray, so a face ahead of the tyre would otherwise come into the
   *  wheel until its ray started inside the rock. The ground is the rays' alone. */
  const GUARD_GROUPS = group(Groups.Vehicle, Groups.Static)
  /** (0.65 r: an edge the envelope can climb meets the tyre's spring first, the guard only what it can't) */
  const GUARD_R = 0.65 * R_W
  /** The thrown rider: everything but the bike (and the cars) and the player. */
  const BAIL_GROUPS = group(Groups.Vehicle, 0xffff & ~Groups.Player & ~Groups.Vehicle)

  /** Rotate (x, y, z) about AX by an angle with cos c, sin s (Rodrigues) into out. */
  function rotAx(x: number, y: number, z: number, c: number, s: number, out: number[]): void {
    const cx = AX[1] * z - AX[2] * y, cy = AX[2] * x - AX[0] * z, cz = AX[0] * y - AX[1] * x
    const d = (AX[0] * x + AX[1] * y + AX[2] * z) * (1 - c)
    out[0] = x * c + cx * s + AX[0] * d
    out[1] = y * c + cy * s + AX[1] * d
    out[2] = z * c + cz * s + AX[2] * d
  }

  class Wheel {
    readonly st: MtbWheelState = { contact: false, spin: 0, spinRate: 0, slip: 0, ground: { x: 0, y: 0, z: 0 }, surface: null }
    readonly mix = surfaceMix()
    readonly grip = newGrip()
    readonly ray: RAPIER.Ray
    readonly T: number
    contact = false
    /** Compression (fork: along the axis; rear: the axle's rise), unclamped; and as drawn (0 … T). */
    x = 0
    draw = 0
    /** The axle at full extension (world) and its direction (world, the wheel's right), the travel direction d (world),
     *  the contact point and normal, d·n. */
    ax = 0; ay = 0; az = 0
    alx = 1; aly = 0; alz = 0
    dx = 0; dy = 1; dz = 0
    cx = 0; cy = 0; cz = 0
    nx = 0; ny = 1; nz = 0
    dn = 1
    /** Ground roughness under the tyre (m) and its rate. */
    bump = 0
    bumpRate = 0
    /** The tyre envelope's lift this step (m, in bump). */
    env = 0
    /** Normal load (N) this step, its impulse and the body's effective mass along the normal; the fastest bottom-out
     *  this step (m/s). */
    N = 0
    jN = 0
    u0 = 0
    mN = 1
    bottom = 0
    /** Spin rate (rad/s), the extra rim speed of a spinning tyre (m/s). */
    omega = 0
    extra = 0
    // friction: contact frame (forward t, right l), effective masses, accumulated impulses, the wheel's own longitudinal
    // window (drive ± brake / rolling resistance), the grip used.
    tx = 0; ty = 0; tz = 0
    lx = 0; ly = 0; lz = 0
    mT = 0; mL = 0
    lamT = 0; lamL = 0
    jFree = 0; jRes = 0
    brake = 0
    sliding = false
    locked = false
    /** Springs: scale (N per unit table), the design load (N along the travel at sag), the bumper rate. Dampers on the
     *  approach speed along the normal (N·s/m), compression / rebound. */
    S = 0
    Fd = 0
    Kb = 0
    cComp = 0
    cReb = 0
    constructor(R: typeof RAPIER, readonly front: boolean) {
      this.T = front ? T_F : T_R
      this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
    }
    /** The spring's rate along the travel (N/m) at compression x, and at the design sag. */
    rate(x: number): number {
      const T = this.T, xc = clamp(x, 0, T), b = xc - 0.9 * T
      return this.S * slopeT(this.front ? FORK_U : REAR_U, xc, T) + (b > 0 ? 2 * this.Kb * b : 0)
    }
    rate0 = 1
    /** Spring + bumper force along the travel (N) at compression x. */
    spring(x: number): number {
      const T = this.T, xc = clamp(x, 0, T)
      let F = this.S * lerpT(this.front ? FORK_U : REAR_U, xc, T)
      const b = xc - 0.9 * T
      if (b > 0) F += this.Kb * b * b
      return F
    }
  }

  class Sim implements MtbSimApi {
    readonly controls: MtbControls = { pedal: 0, brake: 0, steer: 0, lean: 0, hop: false, sprint: false }
    readonly body: RAPIER.RigidBody
    surface: ((x: number, z: number, out: SurfaceMix) => void) | null = null
    speed = 0
    steerAngle = 0
    forkTravel = 0
    swingarm = 0
    shockLength = EYE
    crankAngle = 0
    cadence = 0
    gear = EN ? 1 : 2
    pedalling = false
    /** The engine's revs (the motorbike; 0 pedalled). */
    rpm = 0
    riderCrouch = 0
    riderShift = 0
    riderStand = 0
    airborne = false
    airTime = 0
    crashed = false
    readonly front: MtbWheelState
    readonly rear: MtbWheelState

    // ---- diagnostics (optional, not in MtbSimApi): what the HUD / tests / camera may like ----
    /** Why it crashed ('impact', 'nose-in', 'sideways', 'upside-down', 'hard', 'bottom-out', 'loop-out',
     *  'over-the-bars', 'wash-out', 'lean', 'fell'), '' while riding. */
    crashReason = ''
    /** Lean (rad, + = right side down) and pitch relative to the ground (rad, + = nose up). */
    roll = 0
    pitch = 0
    /** Front up on the rear wheel (a wheelie when pedalling, a manual when not); rear up on the front (a stoppie). */
    wheelie = false
    stoppie = false
    /** The sprint left (0 … 1). */
    sprintLeft = 1
    /** Compression of each end as a share of its travel (0 … 1). */
    get forkShare(): number { return this.fw.draw / T_F }
    get rearShare(): number { return this.rw.draw / T_R }

    private readonly R: typeof RAPIER
    private readonly physics: PhysicsWorld
    private readonly gScale: number
    /** Rapier substeps its solver (numSolverIterations, 4): a step moves the body by (v − k·g·dt)·dt with k = (n + 1) / 2n —
     *  the share of this step's gravity the springs and dampers must see as already acting (0.625). */
    private readonly gPos: number
    private readonly fw: Wheel
    private readonly rw: Wheel
    private readonly wheels: Wheel[]
    private readonly riderCols: RAPIER.Collider[] = []
    private readonly guardF: RAPIER.Collider
    private readonly guardR: RAPIER.Collider
    private readonly discF: RAPIER.Collider
    private readonly discR: RAPIER.Collider
    private bailBody: RAPIER.RigidBody | null = null
    private readonly bailOut = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    // mass properties in use
    private m = M_ALL
    private comL: V3 = RIDE_COM
    private iBody: V3 = RIDE_I
    /** Static: the sag drop of the frame's origin and its pitch at rest on the flat (place). */
    private readonly drop0: number
    private readonly pitch0: number
    // pose / velocity of this step (world): translation, axes (right r, up u, back b), COM, velocity, spin
    private tX = 0; private tY = 0; private tZ = 0
    private rx = 1; private ry = 0; private rz = 0
    private ux = 0; private uy = 1; private uz = 0
    private bx = 0; private by = 0; private bz = 1
    private cX = 0; private cY = 0; private cZ = 0
    private vX = 0; private vY = 0; private vZ = 0
    private wX = 0; private wY = 0; private wZ = 0
    /** World inverse inertia (symmetric) and inverse mass of this step (the roll locked while balancing). */
    private i00 = 0; private i01 = 0; private i02 = 0; private i11 = 0; private i12 = 0; private i22 = 0
    private invM = 1 / M_ALL
    /** The ground's lateral axis (pitch, + = nose up) while balancing — the rider's pitch moments act about it. */
    private glx = 1; private gly = 0; private glz = 0
    /** The velocity this sim left the body with (the next step's impact test), and whether it is valid. */
    private readonly endV = [0, 0, 0]
    private readonly endW = [0, 0, 0]
    private primed = false
    // control / rider state
    private steerT = 0
    private phiT = 0
    private tank = 1
    private shiftT = 0
    private hopLoad = 0
    private hopHeld = false
    private popT = 0
    private popK = 0
    private landCrouch = 0
    private landT = 0
    private manualT = 0
    private pullT = 0
    private walking = false
    private surfI = 0
    private readonly tmp = [0, 0, 0]
    private readonly tmp2 = [0, 0, 0]
    private readonly vOut = { x: 0, y: 0, z: 0 }
    private readonly wOut = { x: 0, y: 0, z: 0 }
    private readonly gOut = { x: 0, y: 0, z: 0 }
    private readonly gOut2 = { x: 0, y: 0, z: 0 }
    private gRay: RAPIER.Ray | null = null
    private envRay: RAPIER.Ray | null = null

    constructor(physics: PhysicsWorld) {
      this.physics = physics
      const R = (this.R = physics.R), world = physics.world
      this.gScale = G / Math.max(1, Math.abs(world.gravity.y))
      const nSub = Math.max(1, world.integrationParameters?.numSolverIterations ?? 4)
      this.gPos = (nSub + 1) / (2 * nSub)
      this.body = world.createRigidBody(
        R.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setLinearDamping(0).setAngularDamping(0.05).setGravityScale(this.gScale),
      )
      const mk = (d: RAPIER.ColliderDesc, groups: number, friction = 0.4) =>
        world.createCollider(d.setDensity(0).setFriction(friction).setRestitution(0.05).setCollisionGroups(groups), this.body)
      // FRAME: one box from the bottom bracket's height to the top tube, head tube to seat — above the wheels' rays (its
      // underside 0.42 m: still 0.28 m off flat ground with both ends bottomed out)
      mk(R.ColliderDesc.cuboid(TN.frameHalf[0], TN.frameHalf[1], TN.frameHalf[2]).setTranslation(TN.frameAt[0], TN.frameAt[1], TN.frameAt[2]), BODY_GROUPS)
      // RIDER: the torso (hip → shoulders, leant ~40° to the bars) and the head — they hit branches, walls, the ground
      const hip = MTB.rider.seatedHip, lean = TN.torsoLean, sp = MTB.rider.spine
      const sh: V3 = [0, hip[1] + Math.cos(lean) * sp, hip[2] - Math.sin(lean) * sp]
      const qT = { x: Math.sin(-lean / 2), y: 0, z: 0, w: Math.cos(lean / 2) }
      this.riderCols.push(mk(R.ColliderDesc.capsule(sp / 2 - 0.08, 0.16).setTranslation(0, (hip[1] + sh[1]) / 2, (hip[2] + sh[2]) / 2).setRotation(qT), BODY_GROUPS))
      this.riderCols.push(mk(R.ColliderDesc.ball(0.13).setTranslation(0, sh[1] + 0.2, sh[2] - 0.04), BODY_GROUPS))
      this.guardF = mk(R.ColliderDesc.ball(GUARD_R).setTranslation(...FRONT), GUARD_GROUPS, 0.3)
      this.guardR = mk(R.ColliderDesc.ball(GUARD_R).setTranslation(...REAR), GUARD_GROUPS, 0.3)
      // WHEEL DISCS: only once crashed (the bike lies on them, not through them); riding, the rays are the wheels
      const qX = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
      this.discF = mk(R.ColliderDesc.cylinder(0.03, 0.92 * R_W).setRotation(qX).setTranslation(...FRONT), BODY_GROUPS, 0.6)
      this.discR = mk(R.ColliderDesc.cylinder(0.035, 0.92 * R_W).setRotation(qX).setTranslation(...REAR), BODY_GROUPS, 0.6)
      this.discF.setEnabled(false)
      this.discR.setEnabled(false)
      this.setMass(true)
      this.fw = new Wheel(R, true)
      this.rw = new Wheel(R, false)
      this.wheels = [this.fw, this.rw]
      this.front = this.fw.st
      this.rear = this.rw.st
      // ---- the springs, sized for this rider at rest on the flat ----
      const xF = TN.sagFront * T_F, xR = TN.sagRear * T_R
      // contact z of each wheel at sag (the fork's axle slides back up the slanted axis) → the static loads
      const zF = FRONT[2] + AX[2] * xF, zR = REAR[2]
      const Nf = (M_ALL * G * (zR - RIDE_COM[2])) / (zR - zF), Nr = M_ALL * G - Nf
      const fw = this.fw, rw = this.rw
      fw.Fd = Nf * AX[1] // (the fork's spring takes the load's component along its axis)
      fw.S = fw.Fd / lerpT(FORK_U, xF, T_F)
      fw.Kb = (TN.bumper * fw.Fd) / (0.1 * T_F) ** 2
      rw.Fd = Nr
      rw.S = rw.Fd / lerpT(REAR_U, xR, T_R)
      rw.Kb = (TN.bumper * rw.Fd) / (0.1 * T_R) ** 2
      // dampers: ζ of the wheel's rate along the ground normal and the effective mass the body has there
      const damp = (w: Wheel, x: number, cz: number, dn: number) => {
        const k = (w.S * slopeT(w.front ? FORK_U : REAR_U, x, w.T)) / (dn * dn)
        const rz = cz - RIDE_COM[2] // (the contact's arm about the COM, normal = up: pure pitch)
        const mN = 1 / (1 / M_ALL + (rz * rz) / RIDE_I[0])
        w.cComp = 2 * TN.zetaComp * Math.sqrt(k * mN)
        w.cReb = 2 * TN.zetaReb * Math.sqrt(k * mN)
      }
      damp(fw, xF, zF, AX[1])
      damp(rw, xR, zR, 1)
      fw.rate0 = fw.rate(xF)
      rw.rate0 = rw.rate(xR)
      const dF = xF * AX[1], dR = xR
      this.drop0 = (dF + dR) / 2
      this.pitch0 = Math.atan2(dR - dF, WB)
      fw.x = fw.draw = xF
      rw.x = rw.draw = xR
      this.place(0, 0, 0, 0)
    }

    // ================================================================================================= the API
    get bail(): { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } | null {
      const b = this.bailBody
      if (!b) return null
      const t = b.translation(), q = b.rotation(), o = this.bailOut
      o.x = t.x; o.y = t.y; o.z = t.z; o.qx = q.x; o.qy = q.y; o.qz = q.z; o.qw = q.w
      return o
    }

    /** Yaw (game heading) from the frame's forward axis — from its right axis when it points up or down (a wheelie,
     *  a flip). */
    get heading(): number {
      const q = this.body.rotation()
      const x = q.x, y = q.y, z = q.z, w = q.w
      const fx = -2 * (x * z + w * y), fz = -(1 - 2 * (x * x + y * y))
      if (fx * fx + fz * fz > 0.25) return Math.atan2(-fx, -fz)
      const rx = 1 - 2 * (y * y + z * z), rz = 2 * (x * z - w * y)
      return Math.atan2(-rz, rx)
    }

    /** (`pitch`, optional: nose-up on a slope — the tests start on their ramps with it.) */
    place(x: number, y: number, z: number, heading: number, pitch = 0): void {
      this.clearBail()
      const b = this.body
      const p = this.pitch0 + pitch
      const cy = Math.cos(heading / 2), sy = Math.sin(heading / 2), cp = Math.cos(p / 2), sp = Math.sin(p / 2)
      b.setTranslation({ x, y: y - this.drop0 + 0.003, z }, true)
      b.setRotation({ x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp }, true)
      b.setLinvel({ x: 0, y: 0, z: 0 }, true)
      b.setAngvel({ x: 0, y: 0, z: 0 }, true)
      this.speed = 0
      this.steerAngle = this.steerT = 0
      this.phiT = 0
      this.tank = 1
      this.shiftT = 0
      this.gear = EN ? 1 : 2
      this.rpm = EN ? EN.idle : 0
      this.hopLoad = this.popT = this.landCrouch = this.landT = this.manualT = this.pullT = 0
      this.hopHeld = false
      this.otb = false
      this.walking = this.holding = false
      this.stillT = 0
      this.sincePop = 9
      this.legT = 0
      this.riderCrouch = this.riderShift = this.riderStand = 0
      this.airborne = false
      this.airTime = 0
      this.pedalling = false
      this.cadence = 0
      this.crashReason = ''
      this.roll = this.pitch = 0
      this.wheelie = this.stoppie = false
      for (const w of [this.fw, this.rw]) {
        w.omega = w.extra = 0
        w.lamT = w.lamL = 0
        w.bump = w.bumpRate = 0
        w.locked = w.sliding = false
        w.st.slip = 0
        w.st.spinRate = 0
      }
      this.fw.x = this.fw.draw = TN.sagFront * T_F
      this.rw.x = this.rw.draw = TN.sagRear * T_R
      this.primed = false
      this.writeOutputs(0)
    }

    shift(dx: number, dy: number, dz: number): void {
      const t = this.body.translation()
      this.body.setTranslation({ x: t.x + dx, y: t.y + dy, z: t.z + dz }, false)
      const b = this.bailBody
      if (b) {
        const s = b.translation()
        b.setTranslation({ x: s.x + dx, y: s.y + dy, z: s.z + dz }, false)
      }
    }

    remount(): void {
      const t = this.body.translation()
      const h = this.heading
      const g = this.groundBelow(t.x, t.y + 2.5, t.z, t.y)
      this.place(t.x, g, t.z, h)
    }

    /** Streaming guard (optional — as TruckSim.keepAbove): the ground's collider under a fast bike may not exist
     *  yet; below `ground` by 0.6 m it is put back on top. */
    keepAbove(ground: number): void {
      const t = this.body.translation()
      if (t.y < ground - 0.6) {
        this.body.setTranslation({ x: t.x, y: ground + 0.3, z: t.z }, true)
        const v = this.body.linvel()
        this.body.setLinvel({ x: v.x, y: Math.max(0, v.y), z: v.z }, true)
        this.primed = false
      }
    }

    dispose(): void {
      this.clearBail()
      this.physics.world.removeRigidBody(this.body)
    }

    // ================================================================================================= the step
    step(dt: number): void {
      if (!(dt > 0)) return
      this.read()
      // IMPACT: what the world's contacts did to the velocity this sim left (gravity taken out) — a wall, a tree, a
      // landing on the frame. (The suspension's own impulses are this sim's, not counted.)
      // (at the points that hit things — the axles' guards, the frame, the head — from the change in the COM's velocity
      // and in the spin: a wheel into a wall stops its axle dead while the COM, pitching over it, loses less than half)
      if (!this.crashed && this.primed) {
        const ex = this.vX - this.endV[0], ey = this.vY - this.endV[1] + G * dt, ez = this.vZ - this.endV[2]
        const ox = this.wX - this.endW[0], oy = this.wY - this.endW[1], oz = this.wZ - this.endW[2]
        let worst = ex * ex + ey * ey + ez * ez
        for (let k = 0; k < HIT_POINTS.length; k += 3) {
          const lx = HIT_POINTS[k], ly = HIT_POINTS[k + 1], lz = HIT_POINTS[k + 2]
          const px = this.rx * lx + this.ux * ly + this.bx * lz + this.tX - this.cX
          const py = this.ry * lx + this.uy * ly + this.by * lz + this.tY - this.cY
          const pz = this.rz * lx + this.uz * ly + this.bz * lz + this.tZ - this.cZ
          const dx = ex + oy * pz - oz * py, dy = ey + oz * px - ox * pz, dz = ez + ox * py - oy * px
          worst = Math.max(worst, dx * dx + dy * dy + dz * dz)
        }
        if (worst > TN.impactDv * TN.impactDv) this.crash('impact', this.endV[0], this.endV[1], this.endV[2])
      }
      // GYROSCOPIC DRIFT: Rapier's step turns ω by −I⁻¹(ω × Iω)·dt (a leant, anisotropic body yawing round a turn
      // precesses ~0.6 rad/s² — measured). Balanced on its wheels, the bike's yaw and lean are this sim's: undone here,
      // or the roll servo fought it every step and its kinematic correction pumped speed into every turn.
      if (!this.crashed && this.primed && this.balanced) {
        const I = this.iBody, w0 = this.endW
        const ar = w0[0] * this.rx + w0[1] * this.ry + w0[2] * this.rz
        const au = w0[0] * this.ux + w0[1] * this.uy + w0[2] * this.uz
        const ab = w0[0] * this.bx + w0[1] * this.by + w0[2] * this.bz
        const lr = I[0] * ar, lu = I[1] * au, lb = I[2] * ab
        const gr = ((au * lb - ab * lu) / I[0]) * dt, gu = ((ab * lr - ar * lb) / I[1]) * dt, gb = ((ar * lu - au * lr) / I[2]) * dt
        this.wX += this.rx * gr + this.ux * gu + this.bx * gb
        this.wY += this.ry * gr + this.uy * gu + this.by * gb
        this.wZ += this.rz * gr + this.uz * gu + this.bz * gb
      }
      this.primed = true
      if (this.crashed) {
        this.stepCrashed(dt)
        return
      }
      const c = this.controls, fw = this.fw, rw = this.rw
      const pedal = clamp(c.pedal, 0, 1), brake = clamp(c.brake, 0, 1), steer = clamp(c.steer, -1, 1), lean = clamp(c.lean, -1, 1)
      const fx = -this.bx, fy = -this.by, fz = -this.bz
      const v = (this.speed = this.vX * fx + this.vY * fy + this.vZ * fz)
      const av = Math.abs(v)

      // ---- STEERING: the key asks for a TURN — a curvature κ, the lock easing with speed so a full key asks for
      // leanFull (κ = g·tan φ / v², at most the bars' lock, at most gripAsk of the tyres' grip: on mud a full key runs
      // wide instead of falling). The bike LEANS FIRST: the asked turn sets the lean (balance) and the bars give only
      // the turn the lean has got to (+ a lead to start it; at walking pace the whole lock) — the tyres are never asked
      // for more side force than the lean balances. The bar angle is solved at the lean the bike has: leant, the head
      // angle turns a bar angle δ into a ground steer tan δ_g ≈ cos ε·tan δ / cos φ, so the bars come back as it goes down
      // (a fixed bar angle tightened the turn as it leant: lean → turn → lean, until the rear let go). A rear stepping
      // out takes some turn out of the bars — the reflex that catches it. ----
      const grounded0 = fw.contact || rw.contact
      const v2 = Math.max(1e-3, v * v)
      const muNow = Math.min(fw.contact ? fw.grip.mu : 9, rw.contact ? rw.grip.mu : 9)
      const kGrip = muNow < 9 ? (TN.gripAsk * muNow * G) / v2 : Infinity
      const kMax = Math.min((AX[1] * Math.tan(MAX_STEER)) / WB, (G * Math.tan(TN.leanFull)) / v2, kGrip)
      this.steerT += ((grounded0 ? steer * kMax : 0) - this.steerT) * Math.min(1, dt * 8)
      const phi0 = Math.asin(clamp(-this.ry, -1, 1))
      // (the lead only while the lean is still on its way: in the turn the bars give exactly what the lean balances)
      const lead = clamp(Math.abs(this.phiT) - Math.abs(phi0), 0, TN.leanLead)
      const kLean = (G * Math.tan(Math.min(Math.abs(phi0) + lead, TN.leanMax))) / v2 + (v2 < 9 ? (AX[1] * Math.tan(MAX_STEER)) / WB * (1 - v2 / 9) : 0)
      let kAct = Math.sign(this.steerT) * Math.min(Math.abs(this.steerT), kLean) * (1 - 0.5 * (rw.sliding ? rw.st.slip : 0))
      // (the turn asked is the COM's: leant, the COM rides s = h·sin φ inside the tyres — the tyres' circle is wider,
      // κ_tyres = κ / (1 + s·κ); steering the tyres onto κ put the COM on a ~15 % tighter turn than the lean balanced)
      kAct /= 1 + Math.abs(kAct) * (RIDE_COM[1] - 0.05) * Math.abs(Math.sin(phi0))
      const cosPhi = Math.max(0.3, Math.cos(phi0))
      const want = clamp(Math.atan((kAct * WB * cosPhi) / AX[1]), -MAX_STEER, MAX_STEER)
      this.steerAngle += clamp(want - this.steerAngle, -TN.steerRate * dt, TN.steerRate * dt)

      // ---- the wheels: rays → contacts ----
      this.cast(fw, dt)
      this.cast(rw, dt)
      const fC = fw.contact, rC = rw.contact, grounded = fC || rC
      this.sampleSurface()
      // the ground's normal (both contacts) and the pitch against it
      let gnx = 0, gny = 0, gnz = 0
      if (fC) (gnx += fw.nx), (gny += fw.ny), (gnz += fw.nz)
      if (rC) (gnx += rw.nx), (gny += rw.ny), (gnz += rw.nz)
      if (!grounded) gny = 1
      {
        const l = Math.hypot(gnx, gny, gnz) || 1
        gnx /= l; gny /= l; gnz /= l
      }
      // the CLIMB ASSIST's share: the slope under the wheels
      this.steep = grounded && TN.climbStick + TN.climbGrip + TN.climbTorque > 2 ? clamp((Math.acos(clamp(gny, -1, 1)) - TN.climbFrom) / (TN.climbFull - TN.climbFrom), 0, 1) : 0
      this.gripK = 1 + (TN.climbGrip - 1) * this.steep
      const pitch = (this.pitch = Math.asin(clamp(fx * gnx + fy * gny + fz * gnz, -1, 1)))
      const phi = (this.roll = Math.asin(clamp(-this.ry, -1, 1)))
      const pitchRate = this.wX * this.rx + this.wY * this.ry + this.wZ * this.rz // + = nose up

      // ---- air time, landings ----
      if (!grounded) {
        this.airborne = true
        this.airTime += dt
        if (this.faceT > 0) {
          this.faceT -= dt
          // (only the speed AWAY from the face is taken — never driven into it: that slammed it down on a small hop)
          const n = this.faceN, vn = this.vX * n[0] + this.vY * n[1] + this.vZ * n[2]
          const d = Math.min(Math.max(0, vn), 1.5 * TN.climbStick * G * this.faceSteep * dt)
          this.vX -= n[0] * d; this.vY -= n[1] * d; this.vZ -= n[2] * d
        }
      } else {
        if (this.steep === 0) this.faceT = 0
        if (this.airborne && this.airTime > 0.12) this.landing(gnx, gny, gnz, pitch, phi)
        this.airborne = false
        this.airTime = 0
      }
      if (this.crashed) return this.stepCrashed(dt)
      this.lockRoll(grounded, gnx, gny, gnz)

      // ---- the legs: cadence, gears, power (the bicycle — the motorbike's ENGINE below) ----
      // (from the ROAD speed, not the rear wheel's spin: a tyre spinning on wet grass read as a high cadence and the
      // auto-shift climbed to the small cogs on a climb; in the air the gear is kept)
      let cog = EN ? 1 : TEETH[12 - this.gear]
      const roadW = Math.max(0, v) / R_W
      if (!EN) {
        this.shiftT -= dt
        if (this.shiftT <= 0 && rC) {
          const cadR = ((roadW * cog) / RING) * (60 / TAU)
          if (cadR > TN.cadenceHi && this.gear < 12) (this.gear++, (this.shiftT = 0.22))
          else if (cadR < TN.cadenceLo && this.gear > 1) (this.gear--, (this.shiftT = 0.22))
          cog = TEETH[12 - this.gear]
        }
      }
      const crankW = EN ? 0 : (roadW * cog) / RING
      const cad = (crankW * 60) / TAU
      // A FOOT DOWN (hill hold): slow (< 1 m/s) with no pedal and no brake, the rider holds it on the brakes — until
      // the pedals or the lever, or it is pushed past 2 m/s (the frame rocking back on its rear spring as the brakes
      // bite on a slope moves the COM faster than a tight threshold: the hold let go and it rolled away).
      // WALKING IT BACK: the brake held at a standstill for 0.6 s, then slowly (≤ 0.38 m/s).
      const idle = grounded && pedal < 0.05 && brake < 0.05 && !c.hop
      // (out of a walk-back the foot goes straight down, whatever the slope gave it — the lever eases off over a tenth of a
      //  second, the bike walking back down a hillside passed 1 m/s in it and rolled away: the game's ride, 2026-11-05)
      const wasWalking = this.walking
      this.holding = idle && (this.holding || wasWalking ? av < 2 : av < 1)
      this.stillT = grounded && brake > (this.walking ? 0.05 : 0.25) && pedal < 0.05 && (av < 0.3 || this.walking) ? this.stillT + dt : 0
      this.walking = this.stillT >= 0.6 && !this.wheelie
      const hold = this.holding && !this.walking
      const sprinting = !EN && c.sprint && this.tank > 0.01
      const wantPedal = pedal > 0.02 && !this.walking
      this.pedalling = wantPedal && rC && (EN ? true : cad < TN.cadenceMax)
      let Fd = 0
      if (EN) Fd = this.walking ? 0 : this.engineDrive(dt, wantPedal ? pedal : 0, v, rC, lean)
      else if (this.pedalling) {
        // the climb under the rear tyre (rise per run along the heading)
        const hx = fx, hz = fz, hl = Math.hypot(hx, hz) || 1
        const grade = rC ? -(rw.nx * hx + rw.nz * hz) / hl / Math.max(0.2, rw.ny) : 0
        const dig = 1 + TN.climbDig * clamp(grade / 0.27, 0, 1)
        const sprintK = clamp(this.tank / 0.15, 0, 1)
        const P = pedal * TN.power * dig + (sprinting ? (TN.sprintPower - TN.power) * sprintK : 0)
        const Fleg = (sprinting ? TN.forceStanding : TN.forceSeated) * Math.max(pedal, sprinting ? 1 : 0)
        let Tc = Math.min(Fleg * CRANK, P / Math.max(crankW, 3))
        Tc *= 1 + TN.pulse * clamp((av - 1.5) / 4, 0, 1) * Math.cos(2 * this.crankAngle) // (smooth at a crawl: a climbing rider spins)
        Tc *= clamp((TN.cadenceMax - cad) / 18, 0, 1) // (the legs can't spin faster)
        if (this.shiftT > 0.12) Tc *= 0.4 // (the chain climbing onto the next cog)
        Fd = (Tc * cog) / RING / R_W
      }
      if (sprinting && this.pedalling) this.tank = Math.max(0, this.tank - dt / TN.sprintTime)
      else if (!c.sprint || EN) this.tank = Math.min(1, this.tank + dt / TN.sprintRecover)
      this.sprintLeft = this.tank

      // ---- geometry for the rider's balance: the COM relative to each contact ----
      const mg = this.m * G
      // gravity's moment about the rear contact (+ = nose up) and the COM's height above it
      let tauGr = 0, hR = 1
      if (rC) {
        const ex = this.cX - rw.cx, ey = this.cY - rw.cy, ez = this.cZ - rw.cz
        tauGr = mg * (ez * this.rx - ex * this.rz)
        hR = ex * rw.nx + ey * rw.ny + ez * rw.nz
      }
      const pitchR = rC ? Math.asin(clamp(fx * rw.nx + fy * rw.ny + fz * rw.nz, -1, 1)) : pitch
      const pitchF = fC ? Math.asin(clamp(fx * fw.nx + fy * fw.ny + fz * fw.nz, -1, 1)) : pitch
      const wheelie = (this.wheelie = rC && !fC && pitchR > 2 * DEG)
      const stoppie = (this.stoppie = fC && !rC && pitchF < -2 * DEG)
      if (rC) this.otb = false
      // off a ledge: the front has gone, the rear still rolls on — the nose is dropping
      const dropping = rC && !fC && !wheelie && av > 1.5

      // ---- the rider's weight fore / aft (it moves the COM: setCom) ----
      let sT = lean
      // braking hard: back and low, while it's moving (still back once stopped, the bike rocked onto its rear)
      if (brake > 0.4 && lean < 0.25 && !this.walking) sT = Math.min(sT, -brake * clamp((av - 0.5) / 1.5, 0, 1))
      if (dropping) sT = Math.min(sT, -0.85) // the hips back off a drop
      // a foot down on a steep climb: the weight over the bars (on 18° the front keeps ~10 % of the weight otherwise)
      if (this.holding && rC) {
        const hl = Math.hypot(fx, fz) || 1, grade = -(rw.nx * fx + rw.nz * fz) / hl / Math.max(0.2, rw.ny)
        sT = Math.max(sT, clamp(grade * 3, 0, 1))
      }
      // pushing hard (no wheelie asked): forward over the bars, enough to keep the front down (+ a margin), standing
      // on a steep climb; and no harder on the pedals than the weight that's left can hold down (a climb in the lowest
      // gear lifted the front at every stroke)
      if (lean > -0.35 && Fd > 0 && rC && !wheelie) {
        const shiftM = M_RIDER * G * 0.2
        sT = Math.max(sT, clamp((Fd * hR + tauGr) / shiftM + 0.25, 0, 1))
        // (… keeping ~6 % of the weight on the front: 15° asks 251 N, the front stays down to ~300 N)
        const fdMax = (-tauGr + shiftM * (1 - this.riderShift) * 0.75 + M_RIDER * G * 0.075 * (1 - this.riderStand) - 0.06 * mg * WB) / Math.max(0.5, hR)
        // (on a face the climb assist holds the bike into the slope: the rider lets the drive through)
        Fd = Math.min(Fd, Math.max((TN.pushFloor + (1 - TN.pushFloor) * this.steep) * Fd, fdMax))
      }
      if (lean > -0.35 && wheelie && !c.sprint && this.sincePop > 0.5) Fd *= 0.35 // (the front came up unasked: the rider eases off)
      if (this.airborne) sT = lean
      this.riderShift += (sT - this.riderShift) * Math.min(1, dt * 7)

      // ---- the hop: crouch (preload), release → pop the front, then the rear ----
      if (c.hop && grounded) this.hopLoad = Math.min(1, this.hopLoad + dt / 0.35)
      else if (!c.hop && this.hopHeld && this.hopLoad > 0.08 && grounded) {
        const k = (this.popK = this.hopLoad * (0.75 + 0.25 * clamp(av / 4, 0, 1)))
        // (up the ground's normal — the frame's up leans back as the nose lifts: its push had a backward share)
        const up = TN.hopUp1 * k, kick = TN.hopPitch * k
        this.vX += gnx * up; this.vY += gny * up; this.vZ += gnz * up
        this.wX += this.glx * kick; this.wY += this.gly * kick; this.wZ += this.glz * kick
        this.popT = 0.1
        this.sincePop = 0
        this.popN[0] = gnx; this.popN[1] = gny; this.popN[2] = gnz
        this.hopLoad = 0
        this.landT = 0.5
      } else this.hopLoad = Math.max(0, this.hopLoad - dt * 3)
      this.hopHeld = c.hop
      this.sincePop += dt
      if (this.popT > 0 && (this.popT -= dt) <= 0) {
        // the rear comes up and the bike levels: the pitch rate set to bring it back to the take-off ground in ~0.25 s
        // (cancelling the front's kick only, it flew nose-up and landed on its rear near bottom-out)
        const k = this.popK, up = TN.hopUp2 * k, n = this.popN
        this.vX += n[0] * up; this.vY += n[1] * up; this.vZ += n[2] * up
        const rel = Math.asin(clamp(-(this.bx * n[0] + this.by * n[1] + this.bz * n[2]), -1, 1))
        const kick = -rel / 0.25 - (this.wX * this.rx + this.wY * this.ry + this.wZ * this.rz)
        this.wX += this.rx * kick; this.wY += this.ry * kick; this.wZ += this.rz * kick
      }
      if (this.hopLoad > 0 && grounded) {
        const J = TN.preload * mg * this.hopLoad * dt
        this.vX -= this.ux * J * this.invM; this.vY -= this.uy * J * this.invM; this.vZ -= this.uz * J * this.invM
      }
      this.landCrouch = Math.max(0, this.landCrouch - dt * 2.2)
      this.landT = Math.max(0, this.landT - dt)
      this.riderCrouch += (Math.max(this.hopLoad, this.landCrouch) - this.riderCrouch) * Math.min(1, dt * 12)
      const steep = rC && this.pedalling && pedal > 0.5 && fy > 0.15 // (out of the saddle on a steep climb)
      const standT = (sprinting && this.pedalling) || steep ? 1 : this.airborne || this.landT > 0 ? 1 : av > 9 && fy < -0.07 ? 1 : 0
      this.riderStand += (standT - this.riderStand) * Math.min(1, dt * 5)

      // WHEELIE / MANUAL BALANCE (and the drop-off reflex): the rider holds the pitch at the BALANCE POINT — the COM
      // straight over the rear contact — a little under it for a light lean back, a little past it for a full one;
      // with a bounded couple (hips, arms: wheelieUp / wheelieDown) and, when that's not enough to bring the nose
      // down, a dab of rear brake (the real wheelie control). Sprinting the rider stomps the pedals and won't: it loops.
      // A manual (not pedalling) holds for manualHold, then fades. Let go of the lean: the front comes down.
      this.wheelieBrake = 0
      if (grounded) {
        const lifting = rC && fC && lean < -0.35 && av > 1.2 && brake < 0.2
        if (lifting) this.pullT += dt
        else if (lean > -0.3 || !grounded) this.pullT = 0
        // (a manual's clock runs until the lean is let go: the front touching down doesn't restart it)
        if (lean > -0.3 || this.pedalling) this.manualT = 0
        else if (wheelie) this.manualT += dt
        const pulling = lifting && this.pullT < 0.5
        // (not in the hop's moment: its pop lifts the front first — taken for an unasked wheelie, the balance fought it
        // and, past 20°, dabbed the rear brake: the hop scrubbed most of the speed)
        if ((wheelie || pulling || dropping) && this.sincePop > 0.5) {
          const ex = this.cX - rw.cx, ey = this.cY - rw.cy, ez = this.cZ - rw.cz
          // the balance point: this pitch + the angle of the COM ahead of the contact (along the heading, above it)
          const hl = Math.hypot(fx, fz) || 1, eh = (ex * fx + ez * fz) / hl
          const thBal = pitchR + Math.atan2(eh, Math.max(0.2, ey))
          const k = clamp((-lean - 0.15) / 0.85, 0, 1)
          const holdIt = lean < -0.15
          let thT = !holdIt ? 0 : clamp(thBal + (this.pedalling ? -6 + 9 * k : -5 + 3 * k) * DEG, 4 * DEG, 70 * DEG)
          const fade = wheelie && !this.pedalling ? clamp(1 - (this.manualT - TN.manualHold) / TN.manualFade, 0, 1) : 1
          thT *= fade
          const Ic = this.iBody[0] + this.m * (ex * ex + ey * ey + ez * ez)
          const kp = holdIt || dropping ? 14 : 6, kd = holdIt || dropping ? 6 : 4
          const req0 = Ic * (kp * (thT - pitchR) - kd * pitchRate) - tauGr
          let up = TN.wheelieUp + (pulling || dropping ? TN.pull : 0), dn = c.sprint && this.pedalling ? TN.wheelieDown * 0.45 : TN.wheelieDown
          if (fade < 1) {
            up *= fade
            dn = Math.max(dn * fade, 80)
          }
          // the rider pedals only as hard as the balance allows (eases off first, brakes after) — unless sprinting
          if (!c.sprint && Fd > 0) Fd = Math.min(Fd, Math.max(0, (req0 + 0.8 * dn) / Math.max(0.5, hR)))
          const req = req0 - Fd * hR
          const M = clamp(req, -dn, up) * dt
          this.angImpulse(this.glx * M, this.gly * M, this.glz * M)
          if (req < -dn && rC && !(c.sprint && this.pedalling) && (holdIt || pitchR > 35 * DEG)) this.wheelieBrake = Math.min((-dn - req) / Math.max(0.5, hR), 0.8 * mg)
        }
      }

      // ---- walking it back (brake held at a standstill) ----
      if (this.walking) {
        const tv = -0.38 * brake
        const dvw = clamp(tv - v, -2 * dt, 2 * dt)
        const hl = Math.hypot(fx, fz) || 1
        this.vX += (fx / hl) * dvw; this.vZ += (fz / hl) * dvw
      }

      // ---- aero drag ½ρ·CdA·v² ----
      {
        const sp = Math.hypot(this.vX, this.vY, this.vZ)
        if (sp > 0.1) {
          const cda = TN.cdaSeated + (TN.cdaTuck - TN.cdaSeated) * Math.max(this.riderCrouch, this.airborne ? this.riderStand : 0)
          const k = Math.min(0.5, 0.5 * 1.2 * cda * sp * dt * this.invM)
          this.vX -= this.vX * k; this.vY -= this.vY * k; this.vZ -= this.vZ * k
        }
      }

      // ---- the rider's LEGS soak a landing (riderCrouch): for 0.3 s after touching down they take up to ~0.7 g of the
      // COM's speed into the ground, on top of the suspension — the travel alone took a 45 cm hop to 90 % of the rear
      if (this.legT > 0) {
        this.legT -= dt
        const un = this.vX * gnx + this.vY * gny + this.vZ * gnz
        if (un < 0) {
          const d = Math.min(-un, TN.legs * G * dt)
          this.vX += gnx * d; this.vY += gny * d; this.vZ += gnz * d
        }
      }

      // ---- the climb assist's pull into the slope (the tyres kept loaded on a face) — and for a moment after a bump on
      // the face throws it off (a 46° face's crest at 29 km/h launched it 7 m out into the air and back down the hill) ----
      if (this.steep > 0) {
        const k = TN.climbStick * G * this.steep * dt
        this.vX -= gnx * k; this.vY -= gny * k; this.vZ -= gnz * k
        this.faceN[0] = gnx; this.faceN[1] = gny; this.faceN[2] = gnz; this.faceSteep = this.steep; this.faceT = 0.35
      }
      // ---- suspension ----
      this.suspension(dt, 1)
      if (fw.bottom > TN.bottomDv || rw.bottom > TN.bottomDv) return this.crashNow('bottom-out', dt)

      // ---- brakes: a hydraulic disc each end, the front modulated to its grip (the rider never locks it); a stoppie
      // held by the rider easing the front; at a standstill a foot down ----
      let Bf = 0, Br = 0
      // (a foot down: enough brake for the slope and a gentle stop, ~2.5 m/s² — grabbing 1.2 g at 1 m/s rocked the
      // bike back onto its rear on a steep climb)
      if (hold) Bf = Br = 0.5 * this.m * (1.4 * G * Math.sqrt(Math.max(0, 1 - gny * gny)) + 2.5)
      else if (!this.walking && brake > 0) {
        Bf = brake * TN.brakeTotal * mg * TN.brakeFront
        Br = brake * TN.brakeTotal * mg * (1 - TN.brakeFront)
        if (fC) Bf = Math.min(Bf, 0.95 * fw.grip.mu * fw.N)
        // (the motorbike's rear held to its grip too — ABS: a 187 kg machine with a locked rear on loose sand spun round
        //  on the spot, upright on its roll constraint; the bicycle's rear may still skid)
        if (EN && rC) Br = Math.min(Br, 0.9 * rw.grip.mu * rw.N)
        // the rear coming up: weight forward → a STOPPIE held at a pitch set by the lean (the rider eases the lever);
        // weight back (plain braking) → eased to keep it down; weight forward at speed → no saving it: over the bars
        // (the rear's LOAD says it's coming up — the frame's pitch also has the fork's dive in it)
        const pred = pitchF + pitchRate * 0.18
        if (stoppie && !this.otb && av > 7 && lean > 0.5) this.otb = true // weight over the bars at speed: no saving it
        if (lean > 0.2) {
          if (stoppie && !this.otb) Bf *= clamp(1 - (-(8 + 14 * clamp((lean - 0.2) / 0.8, 0, 1)) * DEG - pred) / (6 * DEG), 0, 1)
        } else if (fC && !this.otb) {
          this.frontEase += ((rC ? clamp(rw.N / (0.05 * mg), 0.35, 1) : 0.3) - this.frontEase) * Math.min(1, dt * 12)
          Bf *= this.frontEase
        }
      }
      if (this.wheelieBrake > 0) Br = Math.max(Br, this.wheelieBrake) // (the rider's dab of rear brake: the wheelie's control)

      // ---- tyres ----
      this.friction(dt, Fd, Bf, Br, hold)
      // (stopped on a foot: the velocity along the ground and the yaw cancelled after the tyres — as TruckSim's hill hold —
      // the normal part kept so the springs still settle; the brakes alone left ~1 cm/s of creep on rough wet grass)
      if (hold && av < 0.15) {
        // (… less the share of the step's gravity the substeps will still move it by: it stays where it is)
        const vn = this.vX * gnx + this.vY * gny + this.vZ * gnz, wn = this.wX * gnx + this.wY * gny + this.wZ * gnz
        const k = G * dt * this.gPos
        this.vX = gnx * vn - k * gnx * gny; this.vY = gny * vn - k * (gny * gny - 1); this.vZ = gnz * vn - k * gnz * gny
        this.wX -= gnx * wn; this.wY -= gny * wn; this.wZ -= gnz * wn
      }

      // ---- balance (on the ground) / air control ----
      this.balanced = grounded
      if (grounded) this.balance(dt, v, phi)
      else this.airControl(dt, lean, steer, this.sincePop < 1)
      // ON ONE WHEEL the rider holds the yaw (to the turn asked): on the front alone nothing else does, and up on the
      // rear past the balance point the contact leads the COM — a pushed caster, unstable in yaw
      if (stoppie || wheelie) {
        const k = Math.min(1, dt * 4), wn = this.wX * gnx + this.wY * gny + this.wZ * gnz, d = (-v * this.steerT - wn) * k
        this.wX += gnx * d; this.wY += gny * d; this.wZ += gnz * d
      }

      // ---- crash checks ----
      if (Math.abs(phi) > TN.leanMax) return this.crashNow('lean', dt)
      if (fw.sliding && fw.lamL !== 0 && Math.abs(phi) > 20 * DEG) this.washT += fw.st.slip > 0.25 ? dt : dt * 0.5
      else this.washT = Math.max(0, this.washT - dt * 2)
      if (this.washT > TN.washOut) return this.crashNow('wash-out', dt)
      if (rC && !fC && pitchR > TN.loopOut) return this.crashNow('loop-out', dt)
      // (up past ~72° the rear's ray runs along the ground and loses it: just off a wheelie that steep, it has looped)
      this.sinceWheelie = wheelie ? 0 : this.sinceWheelie + dt
      if (!grounded && this.sinceWheelie < 0.3 && pitch > TN.loopOut - 8 * DEG) return this.crashNow('loop-out', dt)
      if (fC && !rC && pitchF < -TN.overBars) return this.crashNow('over-the-bars', dt)
      // (fallen over: its up against the GROUND's — on a 70° face it stands up on the slope, far from the sky's up)
      if (grounded && !wheelie && !stoppie && this.ux * gnx + this.uy * gny + this.uz * gnz < 0.2) return this.crashNow('fell', dt)

      // ---- the drivetrain's outputs ----
      if (EN) {
        // (the countershaft sprocket — drawn as the 'crank' — turns with the rear wheel through the final drive)
        this.crankAngle = (this.crankAngle + Math.max(0, rw.omega) * EN.final * dt) % TAU
        this.cadence = this.rpm
      } else {
      const cogNow = TEETH[12 - this.gear]
      const cw = (Math.max(0, rw.omega) * cogNow) / RING
      if (this.pedalling) {
        this.crankAngle = (this.crankAngle + cw * dt) % TAU
        this.cadence = (cw * 60) / TAU
      } else this.cadence = 0
      }
      this.write()
      this.writeOutputs(dt)
      this.setCom()
    }
    private washT = 0
    /** The face last climbed (its normal, the assist there) and how long it still pulls once off it (s). */
    private readonly faceN = [0, 1, 0]
    private faceSteep = 0
    private faceT = 0
    /** The climb assist this step (0 … 1, by the slope under the wheels) and the grip it gives (× μ). */
    steep = 0
    private gripK = 1
    /** Over the bars: a stoppie begun at speed with the weight forward — the rider can't save it (until it ends). */
    private otb = false
    /** The rider easing the front lever to keep the rear down (plain hard braking), smoothed. */
    private frontEase = 1
    /** The rear brake the wheelie balance asks for this step (N). */
    private wheelieBrake = 0
    /** Time since the bike was last up on its rear wheel (s). */
    private sinceWheelie = 9
    /** Balanced on a wheel last step (the gyroscopic drift is undone). */
    private balanced = false
    /** The rider's legs soaking a landing (s left). */
    private legT = 0
    /** A foot down (hill hold) latched; the brake held at a standstill (s, → walking it back). */
    private holding = false
    private stillT = 0
    /** Since the hop's pop (s): the hop owns the pitch for a moment (no wheelie balance, no rear-brake dab). */
    private sincePop = 9
    private readonly popN = [0, 1, 0]

    /**
     * THE ENGINE (the motorbike): its revs from the rear wheel through the gearbox (a spinning tyre revs it); an
     * AUTOMATIC CLUTCH that slips below clutchRpm (a launch: the engine held up on the throttle while the wheel catches
     * up; off the throttle, idling), an AUTOMATIC SHIFT (a short torque cut), the REV LIMITER, ENGINE BRAKING off the
     * throttle. In the air it revs free on the clutch and spins the wheel. The drive force at the rear contact (N).
     */
    private engineDrive(dt: number, thr: number, v: number, rC: boolean, lean: number): number {
      const E = EN!, rw = this.rw
      const ratio = (g: number) => E.gears[g - 1] * E.primary * E.final
      const toRpm = 60 / TAU
      const wheelW = rC ? (Math.max(0, v) + rw.extra) / R_W : Math.max(0, rw.omega)
      this.shiftT -= dt
      if (rC && this.shiftT <= 0) {
        const r = wheelW * ratio(this.gear) * toRpm
        if (r > E.shiftUp && this.gear < E.gears.length && thr > 0.1) { this.gear++; this.shiftT = E.shiftTime }
        else if (r < (thr > 0.5 ? E.shiftDownLoaded : E.shiftDown) && this.gear > 1) { this.gear--; this.shiftT = E.shiftTime * 0.7 }
      }
      const locked = wheelW * ratio(this.gear) * toRpm
      const slip = locked < E.clutchRpm
      const target = !rC ? (thr > 0.05 ? E.idle + thr * (E.redline - E.idle) : Math.max(E.idle, locked)) : slip ? Math.max(locked, E.idle + thr * (E.launchRpm - E.idle)) : locked
      this.rpm += (target - this.rpm) * Math.min(1, dt * (slip || !rC ? 9 : 30))
      if (!rC) {
        // (revved in the air: the clutch in, the rear wheel spun up with it)
        if (thr > 0.05) rw.omega = Math.max(rw.omega, (this.rpm / toRpm / ratio(this.gear)) * 0.8)
        return 0
      }
      const rpm = Math.max(this.rpm, E.idle)
      let T = 0
      if (thr > 0.03) {
        T = torqueAt(rpm) * thr
        if (rpm >= E.redline) T = 0
        if (this.shiftT > E.shiftTime * 0.4) T *= 0.15
      } else if (!slip) T = -E.engineBrake * clamp((rpm - E.idle) / (E.redline - E.idle), 0.15, 1)
      let Fd = (T * ratio(this.gear)) / R_W
      if (Fd > 0) Fd *= 1 + (TN.climbTorque - 1) * this.steep
      if (Fd > 0 && lean > -0.35) {
        Fd = Math.min(Fd, E.traction * rw.grip.mu * this.gripK * Math.max(rw.N, 0.2 * this.m * G))
        // WHEELIE CONTROL (the wrist, as GTA's bikes): not leaning back, the throttle eases as the front loses its load
        // — full throttle squats the rear and lifts a light front; a one-wheeled bike at 80 km/h is steered by nothing
        const fw = this.fw, keep = E.frontKeep * (1 - 0.75 * this.steep) * this.m * G
        Fd *= clamp((fw.contact ? fw.N : 0) / keep, 0.15, 1)
      }
      return Fd
    }

    /** The rider's weight moves the bike + rider's centre of mass: 0.30 m back / 0.20 m forward at full shift (the hips
     *  over the rear tyre / over the bars), a little lower; standing puts it lower and over the BB, crouching lower
     *  still. (A moved COM — not a moment — so the contacts' lever arms change too: off a drop, the rear spring's
     *  push no longer pitches the nose down once the hips are back.) Mass properties are re-set only when it moves
     *  more than 3 mm. */
    private setCom(): void {
      const s = this.riderShift, k = M_RIDER / M_ALL
      const dz = (s < 0 ? -0.3 * s : -0.2 * s) - 0.09 * this.riderStand + 0.03 * this.riderCrouch
      const dy = -0.06 * Math.abs(s) - 0.09 * this.riderStand - 0.12 * this.riderCrouch
      const cy = RIDE_COM[1] + k * dy, cz = RIDE_COM[2] + k * dz
      if (Math.abs(cy - this.comL[1]) + Math.abs(cz - this.comL[2]) < 0.003) return
      this.comL = [0, cy, cz]
      this.body.setAdditionalMassProperties(this.m, { x: 0, y: cy, z: cz }, { x: RIDE_I[0], y: RIDE_I[1], z: RIDE_I[2] }, { x: 0, y: 0, z: 0, w: 1 }, true)
      this.body.recomputeMassPropertiesFromColliders()
    }

    // ================================================================================================= the parts
    /** Pose, COM, velocities of this step (world). */
    private read(): void {
      const b = this.body
      const t = b.translation(), q = b.rotation(), lv = b.linvel(), w = b.angvel()
      this.tX = t.x; this.tY = t.y; this.tZ = t.z
      const x = q.x, y = q.y, z = q.z, s = q.w
      this.rx = 1 - 2 * (y * y + z * z); this.ry = 2 * (x * y + s * z); this.rz = 2 * (x * z - s * y)
      this.ux = 2 * (x * y - s * z); this.uy = 1 - 2 * (x * x + z * z); this.uz = 2 * (y * z + s * x)
      this.bx = 2 * (x * z + s * y); this.by = 2 * (y * z - s * x); this.bz = 1 - 2 * (x * x + y * y)
      const cl = this.comL
      this.cX = t.x + this.rx * cl[0] + this.ux * cl[1] + this.bx * cl[2]
      this.cY = t.y + this.ry * cl[0] + this.uy * cl[1] + this.by * cl[2]
      this.cZ = t.z + this.rz * cl[0] + this.uz * cl[1] + this.bz * cl[2]
      this.vX = lv.x; this.vY = lv.y; this.vZ = lv.z
      this.wX = w.x; this.wY = w.y; this.wZ = w.z
      this.lockRoll(false)
    }

    /**
     * World inverse inertia, I⁻¹ = Σ a aᵀ / I_a over the body's axes. BALANCING (a wheel down, `n` the ground's normal),
     * it is taken in the GROUND's frame instead — yaw about the normal, pitch about the ground's lateral axis, the ROLL
     * locked (the rider holds it): leant, the frame's pitch (17.6 kg·m²) and yaw (6.8) axes are tilted, so a yaw torque
     * through the body's own I⁻¹ also pitched it against the ground — every turn-in dived the fork, lifted the rear
     * off its spring and spun it out.
     */
    private lockRoll(lock: boolean, nx = 0, ny = 1, nz = 0): void {
      const I = this.iBody
      this.invM = 1 / this.m
      const rx = this.rx, ry = this.ry, rz = this.rz, ux = this.ux, uy = this.uy, uz = this.uz, bx = this.bx, by = this.by, bz = this.bz
      if (!lock) {
        const a = 1 / I[0], b = 1 / I[1], c = 1 / I[2]
        this.i00 = a * rx * rx + b * ux * ux + c * bx * bx
        this.i01 = a * rx * ry + b * ux * uy + c * bx * by
        this.i02 = a * rx * rz + b * ux * uz + c * bx * bz
        this.i11 = a * ry * ry + b * uy * uy + c * by * by
        this.i12 = a * ry * rz + b * uy * uz + c * by * bz
        this.i22 = a * rz * rz + b * uz * uz + c * bz * bz
        return
      }
      // the ground's lateral axis: the frame's forward in the ground plane, × n
      const fx = -bx, fy = -by, fz = -bz, fn = fx * nx + fy * ny + fz * nz
      let hx = fx - nx * fn, hy = fy - ny * fn, hz = fz - nz * fn
      const hl = Math.hypot(hx, hy, hz) || 1
      hx /= hl; hy /= hl; hz /= hl
      const lx = hy * nz - hz * ny, ly = hz * nx - hx * nz, lz = hx * ny - hy * nx
      this.glx = lx; this.gly = ly; this.glz = lz
      // the body's inertia about each: Σ I_a (axis·a)²
      const along = (x: number, y: number, z: number) => {
        const pr = x * rx + y * ry + z * rz, pu = x * ux + y * uy + z * uz, pb = x * bx + y * by + z * bz
        return I[0] * pr * pr + I[1] * pu * pu + I[2] * pb * pb
      }
      const a = 1 / along(nx, ny, nz), b = 1 / along(lx, ly, lz)
      this.i00 = a * nx * nx + b * lx * lx
      this.i01 = a * nx * ny + b * lx * ly
      this.i02 = a * nx * nz + b * lx * lz
      this.i11 = a * ny * ny + b * ly * ly
      this.i12 = a * ny * nz + b * ly * lz
      this.i22 = a * nz * nz + b * lz * lz
    }

    private angImpulse(tx: number, ty: number, tz: number): void {
      this.wX += this.i00 * tx + this.i01 * ty + this.i02 * tz
      this.wY += this.i01 * tx + this.i11 * ty + this.i12 * tz
      this.wZ += this.i02 * tx + this.i12 * ty + this.i22 * tz
    }
    /** An impulse j at world point p (on this step's velocities). */
    private impulse(jx: number, jy: number, jz: number, px: number, py: number, pz: number): void {
      const im = this.invM
      this.vX += jx * im; this.vY += jy * im; this.vZ += jz * im
      const ex = px - this.cX, ey = py - this.cY, ez = pz - this.cZ
      this.angImpulse(ey * jz - ez * jy, ez * jx - ex * jz, ex * jy - ey * jx)
    }
    /** 1 / effective mass at world point p along unit d. */
    private invMassAt(px: number, py: number, pz: number, dx: number, dy: number, dz: number): number {
      const ex = px - this.cX, ey = py - this.cY, ez = pz - this.cZ
      const cx = ey * dz - ez * dy, cy = ez * dx - ex * dz, cz = ex * dy - ey * dx
      return this.invM + cx * (this.i00 * cx + this.i01 * cy + this.i02 * cz) + cy * (this.i01 * cx + this.i11 * cy + this.i12 * cz) + cz * (this.i02 * cx + this.i12 * cy + this.i22 * cz)
    }
    /** Velocity of world point p (this step's). */
    private velAt(px: number, py: number, pz: number, out: number[]): void {
      const ex = px - this.cX, ey = py - this.cY, ez = pz - this.cZ
      out[0] = this.vX + this.wY * ez - this.wZ * ey
      out[1] = this.vY + this.wZ * ex - this.wX * ez
      out[2] = this.vZ + this.wX * ey - this.wY * ex
    }

    /**
     * One wheel's ray: from the top of its travel down its travel direction (the fork: −steering axis, turned with the
     * bars; the rear: −frame up through the axle). The TYRE is a torus (the wheel's radius r, a crown of the tyre's half
     * width ρ) on the plane hit: leant by the camber, its axle stands (r − ρ)·cos(camber) + ρ off the ground, so the
     * axle at compression x touches when (A₀ + d·x − P)·n = (r − ρ)·e·n + ρ (+ the roughness bump), e the wheel plane's
     * direction toward the ground. (A sphere would put the axle a full r up at any lean: leaning about the contact line
     * then drove the axles into the ground, the springs threw the frame up and the rear unloaded and spun out.)
     */
    private cast(w: Wheel, dt: number): void {
      const o = this.tmp
      let lx: number, ly: number, lz: number, dlx: number, dly: number, dlz: number
      let alx = 1, aly = 0, alz = 0
      if (w.front) {
        const cs = Math.cos(this.steerAngle), sn = -Math.sin(this.steerAngle)
        rotAx(FC[0], FC[1], FC[2], cs, sn, o)
        lx = CROWN[0] + o[0]; ly = CROWN[1] + o[1]; lz = CROWN[2] + o[2]
        dlx = AX[0]; dly = AX[1]; dlz = AX[2]
        rotAx(1, 0, 0, cs, sn, o)
        alx = o[0]; aly = o[1]; alz = o[2]
      } else {
        lx = REAR[0]; ly = REAR[1]; lz = REAR[2]
        dlx = 0; dly = 1; dlz = 0
      }
      w.alx = this.rx * alx + this.ux * aly + this.bx * alz
      w.aly = this.ry * alx + this.uy * aly + this.by * alz
      w.alz = this.rz * alx + this.uz * aly + this.bz * alz
      const ax = (w.ax = this.tX + this.rx * lx + this.ux * ly + this.bx * lz)
      const ay = (w.ay = this.tY + this.ry * lx + this.uy * ly + this.by * lz)
      const az = (w.az = this.tZ + this.rz * lx + this.uz * ly + this.bz * lz)
      const dx = (w.dx = this.rx * dlx + this.ux * dly + this.bx * dlz)
      const dy = (w.dy = this.ry * dlx + this.uy * dly + this.by * dlz)
      const dz = (w.dz = this.rz * dlx + this.uz * dly + this.bz * dlz)
      const top = w.T + MARGIN
      const ray = w.ray
      ray.origin.x = ax + dx * top; ray.origin.y = ay + dy * top; ray.origin.z = az + dz * top
      // (the fork's ray runs down the axis through the tyre, not the axle: the contacts of a compressing fork lie on a
      // line along the axis below the axle — through the axle, the slanted ray met the ground ~17 cm ahead of the tyre
      // and took a kerb's top for the ground under it a step early: the fork slammed through its travel)
      if (w.front) {
        const k = 0.6 * R_W
        ray.origin.x -= this.ux * k; ray.origin.y -= this.uy * k; ray.origin.z -= this.uz * k
      }
      ray.dir.x = -dx; ray.dir.y = -dy; ray.dir.z = -dz
      // (long enough to reach the ground under a tilted frame: a steep wheelie, a steep slope)
      const reachL = Math.min(3, (top + 1.3 * R_W) / Math.max(0.3, dy))
      let hit = this.physics.world.castRayAndGetNormal(ray, reachL, true, undefined, RAY_GROUPS, undefined, this.body)
      // a FACE is not ground: the fork's slanted ray meets a kerb's or a rock's face ahead of the tyre (its normal still
      // passed d·n — the face taken for the ground pushed the fork 0.5 m past its travel) — the ground is looked for
      // straight down the frame through the axle instead (the envelope climbs the face)
      if (hit && w.front && hit.normal.x * this.ux + hit.normal.y * this.uy + hit.normal.z * this.uz < 0.55) {
        ray.origin.x = ax + this.ux * top; ray.origin.y = ay + this.uy * top; ray.origin.z = az + this.uz * top
        ray.dir.x = -this.ux; ray.dir.y = -this.uy; ray.dir.z = -this.uz
        hit = this.physics.world.castRayAndGetNormal(ray, Math.min(3, (top + 1.3 * R_W) / Math.max(0.3, this.uy)), true, undefined, RAY_GROUPS, undefined, this.body)
      }
      const was = w.contact
      w.contact = false
      w.bottom = 0
      if (!hit) return this.extend(w, dt)
      let nx = hit.normal.x, ny = hit.normal.y, nz = hit.normal.z
      const toi = hit.timeOfImpact
      const rdx = -ray.dir.x, rdy = -ray.dir.y, rdz = -ray.dir.z
      const nl = Math.hypot(nx, ny, nz)
      if (toi < 1e-4 || nl < 0.5) {
        // the ray started inside: full compression on the frame's up
        nx = this.ux; ny = this.uy; nz = this.uz
      } else (nx /= nl), (ny /= nl), (nz /= nl)
      const dn = dx * nx + dy * ny + dz * nz
      if (dn < 0.3 || nx * this.ux + ny * this.uy + nz * this.uz < 0.45) return this.extend(w, dt)
      const px = ray.origin.x - rdx * toi, py = ray.origin.y - rdy * toi, pz = ray.origin.z - rdz * toi
      // ground roughness (the surface's bumps and stones, ×0.6 — a bike tyre is narrower than the car's envelope),
      // rising at most 2 m/s (the tyre squeezes first)
      let h = 0
      if (w.mix.rough > 0) h = Math.min(0.6 * roughness(px, pz, w.mix), w.bump - w.env + 2 * dt)
      // TYRE ENVELOPE (as TruckSim's): a round tyre meets an edge ahead of its hub — two more rays, 0.45 r and 0.8 r
      // ahead along the wheel's line, lift it on its spring by what the circle needs there (h − (r − √(r² − s²))),
      // at most 0.55 r (taller is a face it hits: the guard), rising at most 3 m/s (the tyre squeezes first). Without it
      // the one ray saw a kerb only once the hub was over it, and the tyre's guard stopped the bike dead.
      let env = 0
      if (Math.abs(this.speed) > 0.3) {
        // the wheel's line on the ground: n × axle
        let tx = ny * w.alz - nz * w.aly, ty = nz * w.alx - nx * w.alz, tz = nx * w.aly - ny * w.alx
        const tl = Math.hypot(tx, ty, tz) || 1, sg = this.speed >= 0 ? 1 / tl : -1 / tl
        tx *= sg; ty *= sg; tz *= sg
        // (straight down the frame from above the axle's line: a step's top, not its face)
        const er = (this.envRay ??= new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }))
        er.dir.x = -this.ux; er.dir.y = -this.uy; er.dir.z = -this.uz
        const ox = ax + this.ux * top, oy = ay + this.uy * top, oz = az + this.uz * top
        const eL = Math.min(3, (top + 1.3 * R_W) / Math.max(0.3, this.uy))
        for (const k of ENV_S) {
          const s = k * R_W
          er.origin.x = ox + tx * s; er.origin.y = oy + ty * s; er.origin.z = oz + tz * s
          const eh = this.physics.world.castRay(er, eL, true, undefined, RAY_GROUPS, undefined, this.body)
          if (!eh || eh.timeOfImpact < 1e-4) continue
          const gh = (er.origin.x - this.ux * eh.timeOfImpact - px) * nx + (er.origin.y - this.uy * eh.timeOfImpact - py) * ny + (er.origin.z - this.uz * eh.timeOfImpact - pz) * nz
          env = Math.max(env, gh - (R_W - Math.sqrt(R_W * R_W - s * s)))
        }
        env = Math.min(env, 0.55 * R_W, w.env + 3 * dt)
      }
      w.env = env
      h += env
      w.bumpRate = was ? (h - w.bump) / dt : 0
      w.bump = h
      // the torus: e = the wheel plane's direction toward the ground (n without its part along the axle)
      const an = w.alx * nx + w.aly * ny + w.alz * nz
      let ex = nx - an * w.alx, ey = ny - an * w.aly, ez = nz - an * w.alz
      const en = Math.hypot(ex, ey, ez)
      if (en > 1e-3) (ex /= en), (ey /= en), (ez /= en)
      else (ex = nx), (ey = ny), (ez = nz)
      const rr = R_W - RHO_T, reach = rr * Math.max(en, 0) + RHO_T
      const x = (reach + h - ((ax - px) * nx + (ay - py) * ny + (az - pz) * nz)) / dn
      if (x < 0) return this.extend(w, dt)
      w.contact = true
      w.x = x
      w.nx = nx; w.ny = ny; w.nz = nz
      w.dn = dn
      const xc = Math.min(x, w.T), pen = (x - xc) * dn
      w.cx = ax + dx * xc - ex * rr - nx * (RHO_T - pen)
      w.cy = ay + dy * xc - ey * rr - ny * (RHO_T - pen)
      w.cz = az + dz * xc - ez * rr - nz * (RHO_T - pen)
      w.draw = xc
    }
    /** No ground under the wheel: the spring tops out (the rebound damper lets it extend at ~2.5 m/s). */
    private extend(w: Wheel, dt: number): void {
      w.draw = Math.max(0, w.draw - 2.5 * dt)
      w.x = w.draw
      w.env = 0
      w.N = 0
      w.bumpRate = 0
    }

    /** The surface under one wheel a step (alternating), its grip. */
    private sampleSurface(): void {
      this.surfI ^= 1
      const w = this.surfI ? this.fw : this.rw
      if (!w.contact) return
      if (this.surface) this.surface(w.cx, w.cz, w.mix)
      gripFor(KNOBBLY, w.mix, 1, w.grip)
    }

    /**
     * SUSPENSION this step, both wheels: (1) spring + bumper along each travel (as a load along the ground normal:
     * ÷ d·n); (2) the dampers on each tyre's approach speed as it will be at the END of the step (gravity's share of
     * the step included — else the damper fights the springs holding the weight up), implicit (J = −c·dt·u / (1 +
     * c·dt/m)), two passes so each sees the other's; a tyre only pushes; (3) past full travel an inelastic hard stop
     * takes the approach speed out (and nudges out of the ground).
     */
    private suspension(dt: number, scale: number): void {
      const ws = this.wheels
      const vel = this.tmp2
      const gdt = G * dt * this.gPos
      // the dampers act on each shaft's real motion: the tyre's approach speed as the step begins (+ the share of the
      // last step's gravity the solver hadn't moved the body by: at rest it reads −(1 − k)·g·dt) — not on the velocity
      // after this step's spring impulses: the rear spring pitching the frame within a step, caught every step by the
      // front's damper, held the front up on its damper at 2 mm of travel
      for (const w of ws) {
        w.N = 0
        if (!w.contact) continue
        w.mN = 1 / this.invMassAt(w.cx, w.cy, w.cz, w.nx, w.ny, w.nz)
        this.velAt(w.cx, w.cy, w.cz, vel)
        w.u0 = vel[0] * w.nx + vel[1] * w.ny + vel[2] * w.nz + (G * dt - gdt) * w.ny - w.bumpRate
      }
      for (const w of ws) {
        if (!w.contact) continue
        const u = w.u0
        // (the REBOUND holds its ζ across the travel, scaling with the spring's local rate — the air spring is ~5× stiffer
        // deep in its stroke: a fork fully down after a hard stop sprang back underdamped and threw the front up)
        let c = u < 0 ? w.cComp * scale : w.cReb * scale * Math.min(3, Math.sqrt(Math.max(1, w.rate(w.x) / w.rate0)))
        const au = Math.abs(u)
        if (u < 0 && au > TN.knee) c *= (TN.knee + TN.high * (au - TN.knee)) / au
        let J = ((w.spring(w.x) * scale) / w.dn) * dt - (c * dt * u) / (1 + (c * dt) / w.mN)
        if (J < 0) J = 0
        w.jN = J
        this.impulse(w.nx * J, w.ny * J, w.nz * J, w.cx, w.cy, w.cz)
      }
      for (const w of ws) {
        if (!w.contact) continue
        if (w.x >= w.T) {
          this.velAt(w.cx, w.cy, w.cz, vel)
          const u = vel[0] * w.nx + vel[1] * w.ny + vel[2] * w.nz - gdt * w.ny - w.bumpRate
          let dJ = 0
          if (u < 0) {
            dJ = -u * w.mN
            w.bottom = -u
          }
          dJ += w.mN * Math.min(0.3, (w.x - w.T) * w.dn) * (0.1 / dt)
          w.jN += dJ
          this.impulse(w.nx * dJ, w.ny * dJ, w.nz * dJ, w.cx, w.cy, w.cz)
        }
        w.N = w.jN / dt
      }
    }

    /**
     * TYRES: per contact, the wheel's forward t (perpendicular to its axle in the ground plane — a leant, steered
     * wheel rolls where its axle says) and right l; sequential impulses over both wheels: the longitudinal toward
     * stopping the contact but held to [drive − (brake + rolling), drive + (brake + rolling)], the lateral toward no
     * side slip, both inside the friction circle μ·N (past it: sliding at the kinetic μ, along the needed impulse).
     */
    private friction(dt: number, Fd: number, Bf: number, Br: number, hold: boolean): void {
      const ws = [this.fw, this.rw]
      const vel = this.tmp2
      for (let k = 0; k < 2; k++) {
        const w = ws[k]
        w.lamT = w.lamL = 0
        w.sliding = false
        // (the contact frame even with no load — a tyre touching down light still rolls with the ground: from a stale
        // frame its spin, and the cadence and the gear with it, went wild on rough grass and in a hop's pop)
        if (!w.contact) continue
        // the axle direction (cast: front turned about the steering axis by −δ, rear the frame's right) in the ground
        let ax = w.alx, ay = w.aly, az = w.alz
        const an = ax * w.nx + ay * w.ny + az * w.nz
        ax -= w.nx * an; ay -= w.ny * an; az -= w.nz * an
        const al = Math.hypot(ax, ay, az) || 1
        w.lx = ax / al; w.ly = ay / al; w.lz = az / al
        w.tx = w.ny * w.lz - w.nz * w.ly; w.ty = w.nz * w.lx - w.nx * w.lz; w.tz = w.nx * w.ly - w.ny * w.lx
        w.mT = 1 / this.invMassAt(w.cx, w.cy, w.cz, w.tx, w.ty, w.tz)
        w.mL = 1 / this.invMassAt(w.cx, w.cy, w.cz, w.lx, w.ly, w.lz)
        w.brake = w.front ? Bf : Br
        w.jFree = (w.front ? 0 : Fd) * dt
        w.jRes = (w.brake + w.grip.crr * w.N) * dt
      }
      // (the grip holds the tyre still at the END of the step: Rapier's substeps still move the body by k·g·dt² down a
      // slope after the impulses — a hill hold crept ~3 cm/s on 18° — so that share of gravity is in the target)
      const gk = G * dt * this.gPos
      for (let it = 0; it < 3; it++) {
        for (let k = 0; k < 2; k++) {
          const w = ws[k]
          if (!w.contact || w.N <= 0) continue
          this.velAt(w.cx, w.cy, w.cz, vel)
          const vt = vel[0] * w.tx + vel[1] * w.ty + vel[2] * w.tz - gk * w.ty
          const vl = vel[0] * w.lx + vel[1] * w.ly + vel[2] * w.lz - gk * w.ly
          let lt = clamp(w.lamT - vt * w.mT, w.jFree - w.jRes, w.jFree + w.jRes)
          let ll = w.lamL - vl * w.mL
          const mu = w.grip.mu * this.gripK, lim = mu * w.N * dt
          const mag = Math.hypot(lt, ll)
          if (mag > lim) {
            const kin = mu * (0.82 + 0.15 * w.grip.offroad) * w.N * dt
            lt *= kin / mag
            ll *= kin / mag
            w.sliding = true
          } else w.sliding = false
          const dT = lt - w.lamT, dL = ll - w.lamL
          w.lamT = lt; w.lamL = ll
          this.impulse(w.tx * dT + w.lx * dL, w.ty * dT + w.ly * dL, w.tz * dT + w.lz * dL, w.cx, w.cy, w.cz)
        }
      }
      // the wheels' spin and slip
      for (let k = 0; k < 2; k++) {
        const w = ws[k]
        if (!w.contact) {
          w.locked = false
          w.omega *= Math.max(0, 1 - dt * (0.15 + ((w.front ? Bf : Br) > 0 ? 20 : 0)))
          w.extra = 0
          w.st.slip = 0
          continue
        }
        this.velAt(w.cx, w.cy, w.cz, vel)
        const vt = vel[0] * w.tx + vel[1] * w.ty + vel[2] * w.tz
        const vl = vel[0] * w.lx + vel[1] * w.ly + vel[2] * w.lz
        const braking = w.brake * dt > Math.abs(w.lamT) * 0.9 && w.brake > 0 && !hold
        w.locked = w.sliding && braking && Math.abs(vt) > 0.3
        const spinning = w.sliding && !w.front && w.jFree > Math.abs(w.lamT) * 1.05
        if (spinning) w.extra = Math.min(TN.spinMax, w.extra + (w.jFree - Math.abs(w.lamT)) / 40) // (≤ 3 m/s of rim speed over the ground)
        else w.extra = Math.max(0, w.extra - dt * 10)
        w.omega = w.locked ? 0 : (vt + w.extra) / R_W
        const slide = w.locked ? Math.hypot(vt, vl) : w.sliding ? Math.max(Math.abs(vl), w.extra) : 0
        w.st.slip = clamp(slide / 1.5, 0, 1)
      }
    }

    /**
     * BALANCE (on the ground): the lean RATE set toward the lean of the turn asked (tan φ = v²·κ / g), as a rotation
     * about the frame's own forward axis f through the contact line — the COM swings, the tyres don't move. The lean is
     * φ = asin(−r_y), good at any pitch (a wheelie); turning about f by Δ changes φ̇ by Δ·(−(f × r)_y / cos φ). (About f
     * it leans the bike without turning its heading at any pitch — about the horizontal heading, a bike up on a wheelie
     * swung its nose sideways with every correction and the rear tyre fought it.)
     */
    private balance(dt: number, v: number, phi: number): void {
      const fx = -this.bx, fy = -this.by, fz = -this.bz
      // the lean of the turn asked: tan φ = v²·κ / g
      const raw = clamp(Math.atan((v * v * this.steerT) / G), -TN.leanMax + 2 * DEG, TN.leanMax - 2 * DEG)
      this.phiT += (raw - this.phiT) * Math.min(1, dt * 8)
      const cphi = Math.max(0.2, Math.cos(phi))
      const rate = -(this.wZ * this.rx - this.wX * this.rz) / cphi
      const gain = -(fz * this.rx - fx * this.rz) / cphi // (−(f × r)_y / cos φ: φ̇ per unit turn about f)
      if (Math.abs(gain) < 0.3) return
      const want = clamp((this.phiT - phi) * TN.rollK, -TN.rollRate, TN.rollRate)
      const d = (want - rate) / gain
      // the contact line: the contacts' midpoint
      const fw = this.fw, rw = this.rw
      // (through the tyres' crown centres, ρ above the contacts: the torus rolls on the ground as it leans)
      let px = 0, py = 0, pz = 0, n = 0
      if (fw.contact) (px += fw.cx + fw.nx * RHO_T), (py += fw.cy + fw.ny * RHO_T), (pz += fw.cz + fw.nz * RHO_T), n++
      if (rw.contact) (px += rw.cx + rw.nx * RHO_T), (py += rw.cy + rw.ny * RHO_T), (pz += rw.cz + rw.nz * RHO_T), n++
      px /= n; py /= n; pz /= n
      const ex = this.cX - px, ey = this.cY - py, ez = this.cZ - pz
      this.wX += fx * d; this.wY += fy * d; this.wZ += fz * d
      this.vX += d * (fy * ez - fz * ey); this.vY += d * (fz * ex - fx * ez); this.vZ += d * (fx * ey - fy * ex)
      // … and to second order: the COM's centripetal pull toward the contact line, ω²·e⊥ (Rapier turns the frame about
      // its COM and moves the COM straight — without this the tyres paid for the lean, sideways and in lost load)
      const ef = ex * fx + ey * fy + ez * fz, k = want * want * dt
      this.vX -= k * (ex - fx * ef); this.vY -= k * (ey - fy * ef); this.vZ -= k * (ez - fz * ef)
    }

    /** AIR: lean flips (about the frame's right), steer spins (about its up), both eased in; let go and they damp; the
     *  roll is levelled. */
    private airControl(dt: number, lean: number, steer: number, hopping: boolean): void {
      const fx = -this.bx, fy = -this.by, fz = -this.bz
      let wr = this.wX * this.rx + this.wY * this.ry + this.wZ * this.rz
      let wu = this.wX * this.ux + this.wY * this.uy + this.wZ * this.uz
      let wf = this.wX * fx + this.wY * fy + this.wZ * fz
      const acc = TN.airAcc * dt, damp = Math.min(1, TN.airDamp * dt)
      if (this.airTime < TN.airControlAfter) { lean = 0; steer = 0 }
      if (Math.abs(lean) > 0.08) wr += clamp(-lean * TN.airPitch - wr, -acc, acc)
      else if (hopping) {
        // (a hop, hands off: the rider keeps the bike level with the ground it left)
        const n = this.popN, rel = Math.asin(clamp(fx * n[0] + fy * n[1] + fz * n[2], -1, 1))
        wr += clamp(clamp(-rel * 4, -3, 3) - wr, -acc, acc)
      } else wr -= wr * damp
      if (Math.abs(steer) > 0.08) wu += clamp(-steer * TN.airSpin - wu, -acc, acc)
      else wu -= wu * damp
      wf += clamp(2.5 * this.ry - wf, -acc * 0.5, acc * 0.5)
      this.wX = this.rx * wr + this.ux * wu + fx * wf
      this.wY = this.ry * wr + this.uy * wu + fy * wf
      this.wZ = this.rz * wr + this.uz * wu + fz * wf
    }

    /** The first touch after a flight: soaked (the rider crouches into it), or a crash. */
    private landing(nx: number, ny: number, nz: number, pitch: number, phi: number): void {
      const vn = this.vX * nx + this.vY * ny + this.vZ * nz
      const px = this.vX - nx * vn, py = this.vY - ny * vn, pz = this.vZ - nz * vn
      const vp = Math.hypot(px, py, pz)
      const fx = -this.bx, fy = -this.by, fz = -this.bz
      const fn = fx * nx + fy * ny + fz * nz
      const tx = fx - nx * fn, ty = fy - ny * fn, tz = fz - nz * fn
      const tl = Math.hypot(tx, ty, tz) || 1
      const side = vp > TN.landSideMin ? Math.acos(clamp((px * tx + py * ty + pz * tz) / (vp * tl), -1, 1)) : 0
      const upn = this.ux * nx + this.uy * ny + this.uz * nz
      const v0x = this.vX, v0y = this.vY, v0z = this.vZ
      if (upn < 0.35) this.crash('upside-down', v0x, v0y, v0z)
      else if (pitch < -TN.noseIn) this.crash('nose-in', v0x, v0y, v0z)
      else if (pitch > TN.noseUp) this.crash('loop-out', v0x, v0y, v0z)
      else if (side > TN.sideways) this.crash('sideways', v0x, v0y, v0z)
      else if (Math.abs(phi) > 45 * DEG) this.crash('lean', v0x, v0y, v0z)
      else if (-vn > TN.hardLanding) this.crash('hard', v0x, v0y, v0z)
      else {
        this.landCrouch = Math.max(this.landCrouch, clamp(-vn / 5, 0.25, 1))
        this.landT = 0.6
        this.legT = 0.3
      }
    }

    private crashNow(reason: string, dt: number): void {
      this.crash(reason, this.vX, this.vY, this.vZ)
      this.stepCrashed(dt)
    }

    /** The rider BAILS: a 75 kg capsule where the rider was, thrown on with the bike's speed (and a little up), tumbling;
     *  the bike alone falls over. */
    private crash(reason: string, vx: number, vy: number, vz: number): void {
      if (this.crashed) return
      this.crashed = true
      this.crashReason = reason
      const R = this.R, world = this.physics.world
      const s = this.riderShift
      const lx = 0, ly = RIDER_COM[1] - 0.06 * Math.abs(s) - 0.09 * this.riderStand, lz = RIDER_COM[2] + (s < 0 ? -0.3 * s : -0.2 * s)
      const px = this.tX + this.rx * lx + this.ux * ly + this.bx * lz
      const py = this.tY + this.ry * lx + this.uy * ly + this.by * lz
      const pz = this.tZ + this.rz * lx + this.uz * ly + this.bz * lz
      const q = this.body.rotation()
      // the torso leant to the bars: q · rotX(−40°)
      const a = -TN.torsoLean / 2, ca = Math.cos(a), sa = Math.sin(a)
      const qb = { x: q.w * sa + q.x * ca, y: q.y * ca + q.z * sa, z: q.z * ca - q.y * sa, w: q.w * ca - q.x * sa }
      const fx = -this.bx, fy = -this.by, fz = -this.bz
      const spd = Math.hypot(vx, vy, vz)
      const fwd = 0.8 * clamp(spd / 5, 0, 1)
      const tumble = -4 - 0.25 * Math.min(12, spd)
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(px, py, pz)
        .setRotation(qb)
        .setLinvel(vx * 0.9 + fx * fwd, vy + 1.4 + fy * fwd, vz * 0.9 + fz * fwd)
        .setAngvel({ x: this.rx * tumble + this.ux * 0.6, y: this.ry * tumble + this.uy * 0.6, z: this.rz * tumble + this.uz * 0.6 })
        .setGravityScale(this.gScale)
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
      const bb = (this.bailBody = world.createRigidBody(desc))
      world.createCollider(R.ColliderDesc.capsule(0.55, 0.19).setMass(M_RIDER).setFriction(0.8).setRestitution(0.1).setCollisionGroups(BAIL_GROUPS), bb)
      for (const col of this.riderCols) col.setEnabled(false)
      this.discF.setEnabled(true)
      this.discR.setEnabled(true)
      this.setMass(false)
      // the balance lets go: it tips toward its lean
      const tip = (this.roll >= 0 ? 1 : -1) * 0.7
      this.wX += fx * tip; this.wY += fy * tip; this.wZ += fz * tip
      this.write()
      this.pedalling = false
      this.cadence = 0
      this.riderCrouch = this.riderStand = this.riderShift = 0
      this.wheelie = this.stoppie = false
    }

    /** Crashed: the bike alone (15.5 kg), its wheels on their springs (scaled to its weight) while it's up, rolling
     *  free; no balance, no rider. */
    private stepCrashed(dt: number): void {
      // (re-read: the mass and COM changed if the crash was this step)
      this.read()
      this.lockRoll(false)
      const fw = this.fw, rw = this.rw
      const fx = -this.bx, fy = -this.by, fz = -this.bz
      this.speed = this.vX * fx + this.vY * fy + this.vZ * fz
      this.steerAngle *= 1 - Math.min(1, dt * 2)
      if (this.uy > 0.45) {
        this.cast(fw, dt)
        this.cast(rw, dt)
      } else {
        fw.contact = rw.contact = false
        this.extend(fw, dt)
        this.extend(rw, dt)
      }
      this.sampleSurface()
      const scale = M_BIKE / M_ALL
      this.suspension(dt, scale)
      this.friction(dt, 0, 0.05 * M_BIKE * G, 0.05 * M_BIKE * G, false)
      this.airborne = !fw.contact && !rw.contact
      this.airTime = this.airborne ? this.airTime + dt : 0
      this.roll = Math.atan2(-this.ry, this.uy)
      this.riderCrouch = this.riderShift = this.riderStand = 0
      this.pedalling = false
      this.cadence = 0
      this.write()
      this.writeOutputs(dt)
    }

    /** This step's velocities back on the body (and kept for the next step's impact test). */
    private write(): void {
      const b = this.body
      if (!Number.isFinite(this.vX + this.vY + this.vZ + this.wX + this.wY + this.wZ)) {
        this.vX = this.vY = this.vZ = this.wX = this.wY = this.wZ = 0
      }
      const o = this.vOut, w = this.wOut
      o.x = this.vX; o.y = this.vY; o.z = this.vZ
      w.x = this.wX; w.y = this.wY; w.z = this.wZ
      b.setLinvel(o, true)
      b.setAngvel(w, true)
      this.endV[0] = this.vX; this.endV[1] = this.vY; this.endV[2] = this.vZ
      this.endW[0] = this.wX; this.endW[1] = this.wY; this.endW[2] = this.wZ
    }

    /** What the drawing reads: travel, swingarm, shock, wheels, the tyre guards following the axles. */
    private writeOutputs(dt: number): void {
      const fw = this.fw, rw = this.rw
      this.forkTravel = clamp(fw.draw, 0, T_F)
      const rise = clamp(rw.draw, 0, T_R)
      this.swingarm = lerpT(SWING_T, rise, T_R)
      this.shockLength = lerpT(SHOCK_T, rise, T_R)
      for (const w of [fw, rw]) {
        const st = w.st
        st.contact = w.contact
        st.spinRate = w.omega
        st.spin += w.omega * dt
        if (st.spin > 1e4 || st.spin < -1e4) st.spin %= TAU
        if (w.contact) {
          st.ground.x = w.cx; st.ground.y = w.cy; st.ground.z = w.cz
          st.surface = w.mix
        } else {
          st.surface = null
          st.slip = 0
        }
      }
      // the guards follow the axles (front: up the axis, turned with the bars; rear: up the swingarm's arc)
      const o = this.tmp
      rotAx(FC[0], FC[1], FC[2], Math.cos(this.steerAngle), -Math.sin(this.steerAngle), o)
      const g = this.gOut, g2 = this.gOut2
      g.x = CROWN[0] + o[0] + AX[0] * this.forkTravel; g.y = CROWN[1] + o[1] + AX[1] * this.forkTravel; g.z = CROWN[2] + o[2] + AX[2] * this.forkTravel
      this.guardF.setTranslationWrtParent(g)
      const a = this.swingarm, ca = Math.cos(a), sa = Math.sin(a)
      g2.x = REAR[0]; g2.y = PIVOT[1] + P0Y * ca + P0Z * sa; g2.z = PIVOT[2] - P0Y * sa + P0Z * ca
      this.guardR.setTranslationWrtParent(g2)
      if (this.crashed) {
        this.discF.setTranslationWrtParent(g)
        this.discR.setTranslationWrtParent(g2)
      }
    }

    private setMass(riding: boolean): void {
      this.m = riding ? M_ALL : M_BIKE
      this.comL = riding ? RIDE_COM : BIKE_COM
      this.iBody = riding ? RIDE_I : BIKE_I
      const c = this.comL, I = this.iBody
      this.body.setAdditionalMassProperties(this.m, { x: c[0], y: c[1], z: c[2] }, { x: I[0], y: I[1], z: I[2] }, { x: 0, y: 0, z: 0, w: 1 }, true)
      this.body.recomputeMassPropertiesFromColliders()
      this.invM = 1 / this.m
    }

    private clearBail(): void {
      if (this.bailBody) {
        this.physics.world.removeRigidBody(this.bailBody)
        this.bailBody = null
      }
      if (this.crashed) {
        this.crashed = false
        for (const col of this.riderCols) col.setEnabled(true)
        this.discF.setEnabled(false)
        this.discR.setEnabled(false)
        this.setMass(true)
      }
    }

    /** The solid ground under (x, z) from y down (the bike ignored), else `fallback`. */
    private groundBelow(x: number, y: number, z: number, fallback: number): number {
      const ray = (this.gRay ??= new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }))
      ray.origin.x = x; ray.origin.y = y; ray.origin.z = z
      const hit = this.physics.world.castRay(ray, 12, true, undefined, RAY_GROUPS, undefined, this.body)
      return hit ? y - hit.timeOfImpact : fallback
    }
  }
  return Sim
}

/** THE MOUNTAIN BIKE. */
export const MtbSim = buildBikeSim(MTB, MTB_TUNE)
export type MtbSim = InstanceType<typeof MtbSim>
