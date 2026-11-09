import * as GFX from './gfx'
import type RAPIER from '@dimforge/rapier3d-compat'
import { group, Groups } from '../physics/PhysicsWorld'
import type { Atmosphere } from './Atmosphere'
import { assetMaterial, loadParts, type Parts } from './assetMat'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import type { Vehicle } from './Vehicle'
import modelUrl from '../assets/models/vehicles/trailer.glb?url'
import texUrl from '../assets/models/vehicles/trailer.webp?url'
import texNUrl from '../assets/models/vehicles/trailer_n.webp?url'

/**
 * THE TRAILER (docs/MULTIPLAYER.md step 2b — "haul it with the jeep and a trailer"): a small off-road utility trailer
 * (scripts/oth/trailer.py: modelled, scanned materials baked) behind the jeep — ours with its physics, a friend's drawn
 * where they say it is (TrailerModel alone).
 *
 *   THE PHYSICS: a body of its own (its bed, its drawbar; 260 kg and what's in it) on two sprung wheels — Rapier's
 *     ray-cast vehicle, as the cars are (no engine; the brakes on while it stands unhitched) — at the car's real
 *     gravity; HITCHED by a ball joint at the car's tow ball (Rapier's spherical joint: it swings, it pitches over a
 *     crest, it jack-knifes reversing; the two bodies don't push on each other there).
 *   HITCHING: reverse onto it slowly — the coupler comes over the ball and it takes (GTA's way); or on foot at the
 *     coupler, E (the car close); E there again unhitches. Its JOCKEY WHEEL swings down when it's let go (and stands
 *     the drawbar on the ground: a little foot in the physics), up when it's taken.
 *   ITS LOAD: drawn on the bed (Gather.ts builds it — logs along the bed, stones heaped, the scrap); its weight added.
 *
 * Model space (the GLB's, the game's): the origin on the ground under the axle, the drawbar toward −z.
 */
export const TRAILER = { wheelR: 0.36, track: 1.58, bedL: 1.9, bedW: 1.24, floor: 0.66, coupler: new GFX.Vector3(0, 0.5, -2.32), jockey: new GFX.Vector3(0.12, 0.52, -1.77) }
const MASS = 260
const REST = 0.24, STIFF = 42, TRAVEL = 0.2
const G_REAL = 9.81, G_WORLD = 20
/** Reversing onto it: the coupler this close to the ball (m), the car this slow (m/s) → hitched. */
const SNAP = 0.45, SNAP_V = 2.2

let shared: Promise<{ parts: Parts; mat: GFX.ShaderMaterial }> | null = null
function assets(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4) {
  return (shared ??= Promise.all([loadParts(modelUrl), assetMaterial(atmos, shadow, farGrid, texUrl, texNUrl)]).then(([parts, mat]) => ({ parts, mat })))
}

/** The trailer drawn: its body, the wheels (they spin), the jockey wheel (it swings), the load on the bed. */
export class TrailerModel {
  readonly root = new GFX.Group()
  private readonly wheels: GFX.Group[] = []
  private readonly jockey = new GFX.Group()
  private loadMesh: GFX.Mesh | null = null
  private mat: GFX.ShaderMaterial | null = null
  private spinA = 0
  private jockeyK = 0
  ready = false

  async load(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4): Promise<void> {
    const { parts, mat } = await assets(atmos, shadow, farGrid)
    this.mat = mat
    const body = new GFX.Mesh(parts.placed('body')!, mat)
    this.root.add(body)
    for (const n of ['wheel_l', 'wheel_r']) {
      const g = new GFX.Group()
      g.position.setFromMatrixPosition(parts.at[n])
      g.add(new GFX.Mesh(parts.geo[n], mat))
      this.root.add(g)
      this.wheels.push(g)
    }
    this.jockey.position.setFromMatrixPosition(parts.at.jockey)
    this.jockey.add(new GFX.Mesh(parts.geo.jockey, mat))
    this.root.add(this.jockey)
    this.ready = true
  }

  /** The wheels turned on by `d` m of travel; the jockey wheel toward up (1) or down (0). */
  animate(d: number, up: boolean, dt: number): void {
    this.spinA += d / TRAILER.wheelR
    for (const w of this.wheels) w.rotation.x = this.spinA
    // (cranked up / let down: a second's swing, eased)
    this.jockeyK += Math.sign((up ? 1 : 0) - this.jockeyK) * Math.min(Math.abs((up ? 1 : 0) - this.jockeyK), dt * 1.2)
    const k = this.jockeyK * this.jockeyK * (3 - 2 * this.jockeyK)
    this.jockey.rotation.x = -k * Math.PI / 2
  }

  /** What's on the bed (in model space; null: empty). */
  setLoad(geo: GFX.BufferGeometry | null): void {
    if (this.loadMesh) { this.root.remove(this.loadMesh); this.loadMesh.geometry.dispose(); this.loadMesh = null }
    if (geo && this.mat) { this.loadMesh = new GFX.Mesh(geo, this.mat); this.root.add(this.loadMesh) }
  }
}

export class Trailer {
  readonly model = new TrailerModel()
  body: RAPIER.RigidBody | null = null
  private vc: RAPIER.DynamicRayCastVehicleController | null = null
  private foot: RAPIER.Collider | null = null
  private loadCol: RAPIER.Collider | null = null
  private joint: RAPIER.ImpulseJoint | null = null
  private jointCar: number | null = null
  private ballLocal: { x: number; y: number; z: number } | null = null
  private ballCar = ''
  private lastCar = new GFX.Vector3(NaN, 0, 0)
  private readonly lastP = new GFX.Vector3()
  private readonly q = new GFX.Quaternion()
  private readonly v = new GFX.Vector3()
  hitched = false
  /** Reversing onto it hitches only once the coupler has been clear of the ball (not the moment it's let go). */
  private snapArmed = false
  /** Its load's weight (kg) — Gather.ts sets it with the load. */
  private loadKg = 0
  onMessage: ((m: string) => void) | null = null

  constructor(private readonly physics: OthPhysics, private readonly map: () => MapData, private readonly car: Vehicle) {}

  async load(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4): Promise<void> {
    await this.model.load(atmos, shadow, farGrid)
    const pw = this.physics.pw, R = pw.R
    const body = (this.body = pw.world.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(true).setAngularDamping(0.5).setLinearDamping(0.04).setCcdEnabled(true).setGravityScale(G_REAL / G_WORLD)))
    const g = group(Groups.Vehicle, 0xffff)
    pw.world.createCollider(R.ColliderDesc.cuboid(TRAILER.bedW / 2, 0.2, TRAILER.bedL / 2).setTranslation(0, TRAILER.floor + 0.1, 0).setMass(MASS * 0.85).setFriction(0.4).setCollisionGroups(g), body)
    pw.world.createCollider(R.ColliderDesc.cuboid(0.12, 0.05, 0.62).setTranslation(0, 0.55, -1.62).setMass(MASS * 0.15).setFriction(0.4).setCollisionGroups(g), body)
    this.foot = pw.world.createCollider(R.ColliderDesc.ball(0.08).setTranslation(TRAILER.jockey.x, 0.08, TRAILER.jockey.z).setDensity(0).setFriction(0.9).setCollisionGroups(group(Groups.Vehicle, Groups.Terrain | Groups.Static)), body)
    const vc = (this.vc = pw.world.createVehicleController(body))
    vc.indexUpAxis = 1
    ;(vc as unknown as { setIndexForwardAxis: number }).setIndexForwardAxis = 2
    const sag = G_REAL / (2 * STIFF)
    for (const sx of [-1, 1]) {
      vc.addWheel({ x: sx * TRAILER.track / 2, y: TRAILER.wheelR + REST - sag, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, REST, TRAILER.wheelR)
    }
    for (let i = 0; i < 2; i++) {
      vc.setWheelSuspensionStiffness(i, STIFF); vc.setWheelSuspensionCompression(i, 2.4); vc.setWheelSuspensionRelaxation(i, 3.4)
      vc.setWheelMaxSuspensionTravel(i, TRAVEL); vc.setWheelMaxSuspensionForce(i, MASS * 4 * G_REAL * 3)
      vc.setWheelFrictionSlip(i, 2.4); vc.setWheelSideFrictionStiffness(i, 0.9)
    }
  }

  // ============================================================================================ where things are
  /** The car's tow ball, in the world (its rear, a hand's height above its bumper's bottom). */
  private ballWorld(out: GFX.Vector3): GFX.Vector3 | null {
    const b = this.car.sim?.body
    if (!b) return null
    this.ensureBall()
    const l = this.ballLocal!, t = b.translation(), r = b.rotation()
    return out.set(l.x, l.y, l.z).applyQuaternion(this.q.set(r.x, r.y, r.z, r.w)).add(this.v.set(t.x, t.y, t.z))
  }
  /** The tow ball in the car body's frame — found once per car: behind its rear, 0.5 m over the ground under it. */
  private ensureBall(): void {
    const id = this.car.id
    if (this.ballLocal && this.ballCar === id) return
    const b = this.car.sim!.body, t = b.translation(), r = b.rotation()
    const q = new GFX.Quaternion(r.x, r.y, r.z, r.w), h = this.car.sim!.heading
    const back = new GFX.Vector3(Math.sin(h), 0, Math.cos(h)) // (the car faces −z at heading 0: its rear +z)
    const W = new GFX.Vector3(t.x, t.y, t.z).addScaledVector(back, this.car.half.z + 0.12)
    W.y = this.map().height(W.x, W.z) + 0.5
    const L = W.sub(new GFX.Vector3(t.x, t.y, t.z)).applyQuaternion(q.invert())
    this.ballLocal = { x: 0, y: L.y, z: L.z }
    this.ballCar = id
  }
  /** The coupler, in the world. */
  couplerWorld(out: GFX.Vector3): GFX.Vector3 {
    return out.copy(TRAILER.coupler).applyMatrix4(this.model.root.matrixWorld)
  }
  /** Where the bed's middle is, in the world (the load's place — Gather.ts). */
  bedWorld(out: GFX.Vector3): GFX.Vector3 {
    return out.set(0, TRAILER.floor, 0).applyMatrix4(this.model.root.matrixWorld)
  }

  // ============================================================================================ hitching
  /** Behind the car on the ground, its coupler on the ball, hitched (the start; after the car was moved far). */
  spawnBehind(): void {
    const b = this.car.sim?.body
    if (!b || !this.body) return
    const h = this.car.sim!.heading
    const B = this.ballWorld(new GFX.Vector3())!
    const fwd = new GFX.Vector3(-Math.sin(h), 0, -Math.cos(h))
    // (the axle behind the ball by the drawbar's length; the trailer level, facing as the car does)
    const ax = B.clone().addScaledVector(fwd, -Math.abs(TRAILER.coupler.z))
    const y = this.physics.surface(ax.x, ax.z, this.map().height(ax.x, ax.z))
    this.unhitch(true)
    this.body.setTranslation({ x: ax.x, y: y + 0.03, z: ax.z }, true)
    this.body.setRotation(this.q.setFromAxisAngle(this.v.set(0, 1, 0), h), true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.syncModel()
    this.hitch(true)
  }

  /** Hitch: the coupler brought onto the ball (a small move), the joint made. */
  hitch(quiet = false): boolean {
    const b = this.car.sim?.body
    if (!b || !this.body || this.hitched) return false
    const B = this.ballWorld(new GFX.Vector3())!
    this.syncModel()
    const C = this.couplerWorld(new GFX.Vector3())
    const d = B.clone().sub(C)
    if (d.length() > 4) return false
    const t = this.body.translation()
    this.body.setTranslation({ x: t.x + d.x, y: t.y + d.y, z: t.z + d.z }, true)
    const R = this.physics.pw.R
    const data = R.JointData.spherical({ ...this.ballLocal! }, { x: TRAILER.coupler.x, y: TRAILER.coupler.y, z: TRAILER.coupler.z })
    this.joint = this.physics.pw.world.createImpulseJoint(data, b, this.body, true)
    this.joint.setContactsEnabled(false)
    this.jointCar = b.handle
    this.hitched = true
    this.foot?.setEnabled(false)
    for (let i = 0; i < 2; i++) this.vc?.setWheelBrake(i, 0)
    if (!quiet) this.onMessage?.('Trailer hitched')
    return true
  }

  unhitch(quiet = false): void {
    if (this.joint) {
      try { this.physics.pw.world.removeImpulseJoint(this.joint, true) } catch { /* (its car's body already gone) */ }
      this.joint = null
    }
    if (!this.hitched) return
    this.hitched = false
    this.jointCar = null
    this.foot?.setEnabled(true)
    this.snapArmed = false
    if (!quiet) this.onMessage?.('Trailer unhitched')
  }

  /** On foot (E — Gather.ts): what's to do at the coupler (null: nothing here). */
  footAction(x: number, z: number): { label: string; run: () => void } | null {
    if (!this.body || !this.model.ready) return null
    const C = this.couplerWorld(new GFX.Vector3())
    if (Math.hypot(C.x - x, C.z - z) > 1.8) return null
    if (this.hitched) return { label: 'Unhitch the trailer', run: () => this.unhitch() }
    const B = this.ballWorld(new GFX.Vector3())
    if (!B || B.distanceTo(C) > 3.2) return { label: 'Bring the car to hitch it', run: () => this.onMessage?.('Back the car up to the trailer first') }
    return { label: 'Hitch the trailer', run: () => { this.hitch() } }
  }

  /** What's in it weighs this much (kg): its weight on the wheels. */
  setLoadMass(kg: number): void {
    if (!this.body || Math.abs(kg - this.loadKg) < 1) return
    this.loadKg = kg
    const pw = this.physics.pw, R = pw.R
    if (this.loadCol) { pw.world.removeCollider(this.loadCol, true); this.loadCol = null }
    if (kg > 0) this.loadCol = pw.world.createCollider(R.ColliderDesc.cuboid(TRAILER.bedW / 2 - 0.1, 0.15, TRAILER.bedL / 2 - 0.1).setTranslation(0, TRAILER.floor + 0.2, 0).setMass(kg).setSensor(true), this.body)
    this.body.wakeUp()
  }

  // ============================================================================================ per step, per frame
  fixed(dt: number): void {
    if (!this.body || !this.vc) return
    // (the car's body changed — another car from the garage: the joint went with the old one)
    const b = this.car.sim?.body
    if (this.hitched && (!b || b.handle !== this.jointCar)) { this.unhitch(true); this.ballLocal = null; if (b) { this.syncModel(); this.hitch(true) } }
    if (!this.hitched) for (let i = 0; i < 2; i++) this.vc.setWheelBrake(i, 18)
    this.vc.updateVehicle(dt, undefined, group(0xffff, Groups.Terrain | Groups.Static), (c) => c.parent()?.handle !== this.body!.handle && c.parent()?.handle !== b?.handle)
  }

  update(dt: number): void {
    if (!this.body || !this.model.ready) return
    const b = this.car.sim?.body
    // the car moved far at once (a reset, a camp, the crossing): the trailer comes with it
    if (b) {
      const t = b.translation()
      if (!Number.isNaN(this.lastCar.x) && this.hitched && Math.hypot(t.x - this.lastCar.x, t.z - this.lastCar.z) > 6) this.spawnBehind()
      this.lastCar.set(t.x, t.y, t.z)
    }
    // (fallen through — a tile unloaded under it far away: set back on the ground)
    const p = this.body.translation()
    if (p.y < this.map().height(p.x, p.z) - 3) { const y = this.physics.surface(p.x, p.z, this.map().height(p.x, p.z)); this.body.setTranslation({ x: p.x, y: y + 0.1, z: p.z }, true); this.body.setLinvel({ x: 0, y: 0, z: 0 }, true) }
    // reversing onto it: hitched as the coupler comes over the ball
    if (!this.hitched && b && this.car.speedKmh / 3.6 < SNAP_V) {
      const B = this.ballWorld(new GFX.Vector3())!, C = this.couplerWorld(new GFX.Vector3())
      const d = Math.hypot(B.x - C.x, B.z - C.z)
      if (d > 1.0) this.snapArmed = true
      else if (this.snapArmed && d < SNAP && Math.abs(B.y - C.y) < 0.35) this.hitch()
    }
    const before = this.lastP.clone()
    this.syncModel()
    const fwd = this.v.set(0, 0, -1).applyQuaternion(this.model.root.quaternion)
    const moved = this.model.root.position.clone().sub(before)
    this.model.animate(Number.isFinite(before.x) ? moved.dot(fwd) : 0, this.hitched, dt)
  }

  private syncModel(): void {
    if (!this.body) return
    const t = this.body.translation(), r = this.body.rotation()
    this.model.root.position.set(t.x, t.y, t.z)
    this.model.root.quaternion.set(r.x, r.y, r.z, r.w)
    this.model.root.updateMatrixWorld(true)
    this.lastP.set(t.x, t.y, t.z)
  }

  /** Its pose (co-op: pose slot 2). */
  pose(): { p: GFX.Vector3; q: GFX.Quaternion; hitched: boolean } | null {
    return this.body && this.model.ready ? { p: this.model.root.position, q: this.model.root.quaternion, hitched: this.hitched } : null
  }

  dispose(): void {
    this.unhitch(true)
    if (this.body) this.physics.pw.world.removeRigidBody(this.body)
    this.body = null
    this.model.root.removeFromParent()
  }
}
