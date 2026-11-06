import type RAPIER from '@dimforge/rapier3d-compat'
import type { SurfaceMix } from './drivetrain/tyre'
import GEO from './mtb.geometry.json'

/**
 * THE MOUNTAIN BIKE's public face — what the game (src/oth/Bike.ts: the input, the drawing, the rider, the camera,
 * the dust, the sound) reads and sets on the simulation (MtbSim.ts). The geometry is mtb.geometry.json (game space,
 * +z backward, suspension fully extended).
 */
export const MTB = GEO
export type MtbGeometry = typeof GEO

/** The rider's hands and feet, per fixed step (Bike.ts eases the keys into these). */
export interface MtbControls {
  /** 0 … 1: pedalling effort (W / GAS). */
  pedal: number
  /** 0 … 1: both brakes (S / BRAKE) — front-biased, as a rider squeezes them; held at a standstill: walk it back. */
  brake: number
  /** −1 … 1, + = right (D): the bars (lock eased with speed — a fast bike is steered by leaning). In the air: spin. */
  steer: number
  /** −1 … 1: the rider's weight, + = forward over the bars (↑), − = back over the rear wheel (↓) — wheelies and
   *  manuals on the ground, flips in the air. */
  lean: number
  /** Held: crouch and load the suspension; let go: BUNNY HOP (higher the longer it was loaded, up to ~0.4 s). */
  hop: boolean
  /** Out of the saddle, sprinting (Shift): more power, for a while. */
  sprint: boolean
}

export interface MtbWheelState {
  contact: boolean
  /** Accumulated roll (rad, + = rolling forward) and its rate (rad/s). */
  spin: number
  spinRate: number
  /** 0 … 1: how much the tyre is sliding (a locked rear, a drift, a spin-up) — the dust, the skid sound, the marks. */
  slip: number
  /** The tyre's contact point (world space) when on the ground. */
  ground: { x: number; y: number; z: number }
  /** What it's on (the game's surface callback), when on the ground. */
  surface: SurfaceMix | null
}

/** Everything the drawing needs, read after each step. */
export interface MtbState {
  /** Signed forward speed (m/s). */
  readonly speed: number
  /** Yaw (rad, 0 = facing −z, + turns left — the game's heading). */
  readonly heading: number
  /** The bars' turn about the steering axis (rad, + = right). */
  readonly steerAngle: number
  /** Fork: how far the lowers have slid up the steering axis (m, 0 … fork.travel). */
  readonly forkTravel: number
  /** Rear: the swingarm's turn about the pivot (rad, 0 … rear.swingarmMaxRotation) and the shock's eye-to-eye (m). */
  readonly swingarm: number
  readonly shockLength: number
  /** Cranks (rad, crank.about), cadence (rpm), gear (1 … 12, smallest cog = 12) and whether they're driven (false:
   *  coasting — the cranks stand still, the freewheel ticks). */
  readonly crankAngle: number
  readonly cadence: number
  readonly gear: number
  readonly pedalling: boolean
  /** The motorbike's engine revs (0 on the bicycle). */
  readonly rpm: number
  /** The rider's body as the physics placed it: crouch 0 … 1 (loading a hop, soaking a landing), fore / aft weight
   *  −1 … 1 (as `lean`, eased), standing out of the saddle 0 … 1 (sprinting, descending, in the air, landing). */
  readonly riderCrouch: number
  readonly riderShift: number
  readonly riderStand: number
  /** In the air (no wheel on the ground) and for how long (s). */
  readonly airborne: boolean
  readonly airTime: number
  /** Crashed: the rider is off (bail) — `bail` the thrown rider's pose (world) until remount(). */
  readonly crashed: boolean
  readonly bail: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } | null
  readonly front: MtbWheelState
  readonly rear: MtbWheelState
}

export interface MtbSimApi extends MtbState {
  readonly controls: MtbControls
  /** The bike + rider as one rigid body (world pose = the bike's frame, game space as in mtb.geometry.json). */
  readonly body: RAPIER.RigidBody
  /** What the ground is at (x, z) — the game sets it (the same mix the car's tyres read). */
  surface: ((x: number, z: number, out: SurfaceMix) => void) | null
  /** Stood up on its wheels at (x, ground y, z), facing `heading`, at rest, the rider on. */
  place(x: number, y: number, z: number, heading: number): void
  /** Moved by (dx, dy, dz) as it rides — the same speed (the crossing between worlds). */
  shift(dx: number, dy: number, dz: number): void
  /** One fixed step (1/60 s). */
  step(dt: number): void
  /** After a crash: the rider back on, the bike stood up where it lies (same heading). */
  remount(): void
  dispose(): void
}
