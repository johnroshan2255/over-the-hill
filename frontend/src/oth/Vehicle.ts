import * as GFX from './gfx'
const { mergeGeometries } = GFX
import { carDetailFor, driverDoor, loadVehicle, type CockpitPart, type TruckModel } from '../assets/loadModels'
import { VEHICLES, vehicleDef } from '../gameplay/vehicle/catalogue'
import { resolveSpec } from '../gameplay/vehicle/drivetrain/spec'
import { blendRoughness, Surf, type SurfaceMix } from '../gameplay/vehicle/drivetrain/tyre'
import { TruckSim } from '../gameplay/vehicle/VehicleSim'
import { ATMOS_GLSL, FRAG_OUT, LOOK, type Atmosphere } from './Atmosphere'
import { CockpitAnim, dialMaterial, dialTexture, type CockpitState } from './Cockpit'
import DAMAGE from '../../../proto/damage.json'
import { CarDamage, crackU, DAMAGE_ON } from './Damage'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { Tier } from './quality'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'
import type RAPIER from '@dimforge/rapier3d-compat'
import { group, Groups, STATIC_MESH_FILTER } from '../physics/PhysicsWorld'

/** A CRASH your car has just had (Vehicle.onCrash): the change of its velocity where it was hit (m/s), that point and
 *  the way the blow pushed (the world's), the other body (null: the ground, a rock, a tree). */
export interface Crash { dv: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; other: RAPIER.RigidBody | null }

/**
 * THE 4×4 — the game's vehicles on this map: the same models (assets/loadModels `loadVehicle`) and the same physics
 * (gameplay/vehicle TruckSim + the realistic drivetrain from each car's spec sheet, Simulation handling with full
 * aids and the off-road assist), drawn here with this world's light (ATMOS_GLSL `shade`, the terrain's baked sun
 * shadow) and a soft contact shadow on the ground. The tyres feel this map's surfaces: dirt on the tracks, grass on
 * the meadows, sand/gravel at the water, rock on rock.
 *
 * Controls — keys: W / S gas, brake → reverse, A / D steer, Space handbrake, Shift boost, R back on the wheels, 1 / 2 /
 * 3 the car. Touch: ◀ ▶ steer, GAS / BRAKE, ⟲. The mouse (just moved) or a finger drag orbits the chase camera.
 */
export class Vehicle {
  readonly root = new GFX.Group()
  sim!: TruckSim
  model!: TruckModel
  id = ''
  private readonly wheels: GFX.Object3D[] = []
  private wheelMesh: GFX.InstancedMesh | null = null
  private readonly prevP = new GFX.Vector3()
  private readonly curP = new GFX.Vector3()
  private readonly prevQ = new GFX.Quaternion()
  private readonly curQ = new GFX.Quaternion()
  readonly pos = new GFX.Vector3()
  private readonly uniforms: Record<string, GFX.IUniform>
  private readonly shadow: GFX.Mesh
  private readonly keys = new Set<string>()
  private pedal = 0
  /** THE AUTOPILOT's hand on the controls (main.ts → Autopilot.drive): true = it set them this step. */
  pilot: ((dt: number, sim: TruckSim, manual: boolean, up: number) => boolean) | null = null
  private steerK = 0
  private hold = 0
  /** Touch pedals / steering (−1 … 1), from the on-screen buttons. */
  readonly touch = { gas: 0, brake: 0, left: 0, right: 0 }
  private loading = false
  /** ?paint=rrggbb: the body colour (default: this world's own per car — warm, muted, like the OTH overlanders). */
  paint: string | null = null
  /** The GARAGE's driving settings (settings.ts), applied to every car taken. */
  driving: { manual: boolean; aids: 'off' | 'standard' | 'full'; offroadAssist: boolean } = { manual: false, aids: 'full', offroadAssist: true }
  /** Where the first car stands (a saved journey — save.ts); null: the valley's start. */
  spawnAt: { x: number; z: number; heading: number } | null = null
  private readonly shadowSize = new GFX.Vector3(1, 1, 1)
  private readonly shadowBase: Float32Array

  constructor(private readonly map: MapData, private readonly physics: OthPhysics, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4) {
    this.uniforms = { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, uMap: { value: null }, uPaintMask: { value: null }, uPaint: { value: new GFX.Color(1, 1, 1) }, uSunHere: { value: 1 },
      uCoat: this.coatU, uCoatColor: { value: this.coatColor }, uCarBase: this.baseU, uChar: this.charU, uCrack: crackU }
    // PHONES AND WEAK GPUS: the cars' phone files and smaller textures (loadModels carDetail) — a phone-class chip, or
    // the LOW / MEDIUM tiers: the 1024² file; LOW: drawn at 512²
    carDetailFor(tier)
    // the contact shadow: a grid that follows the ground under the car, darkest under the body, soft at the edge
    const sg = new GFX.PlaneGeometry(1, 1, 14, 14).rotateX(-Math.PI / 2)
    this.shadow = new GFX.Mesh(sg, new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { uMist: atmos.uniforms.uMist },
      vertexShader: /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      // (fading in the crossing's mist with the car)
      fragmentShader: /* glsl */ `layout(location = 0) out highp vec4 outColor; in vec2 vUv; uniform float uMist;
        void main() { vec2 q = (vUv - 0.5) * 2.0; float d = length(q * vec2(1.0, 1.0)); outColor = vec4(0.06, 0.04, 0.05, 0.5 * (1.0 - smoothstep(0.35, 1.0, d)) * (1.0 - 0.75 * uMist * uMist)); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }))
    this.shadow.frustumCulled = false
    this.shadowBase = (sg.attributes.position.array as Float32Array).slice()
    this.shadow.renderOrder = 2
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code)
      if (e.code === 'KeyR' && !this.parked) this.reset()
      if (e.code === 'KeyP' && !e.repeat) this.wipers = !this.wipers
      if (e.code === 'KeyL') this.lightMode = this.lightMode === 'auto' ? 'off' : this.lightMode === 'off' ? 'on' : 'auto'
      const n = ['Digit1', 'Digit2'].indexOf(e.code)
      if (n >= 0 && VEHICLES[n]) void this.setCar(VEHICLES[n].id)
      // the MANUAL gearbox: X up, Z down
      const D = this.sim?.drivetrain
      if (D?.manual && !e.repeat) { if (e.code === 'KeyX') D.shiftUp(); else if (e.code === 'KeyZ') D.shiftDown() }
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  /** PARKED while the rider is on the bike (main.ts, B): the engine off, no keys, the body held where it stands — a
   *  fixed obstacle the bike can ride into (kinematic: the physics streams its ground round the bike now, the car
   *  must not fall through ground it unloaded). */
  parked = false
  /** The driver's door: 0 shut … 1 open (main.ts eases it as the character gets in or out). */
  doorOpen = 0
  private doorPivot: GFX.Group | null = null
  // THE COCKPIT (2026-11-05, the user: "the car needs its inside properly — the hands on the steering wheel — and P for
  // the wipers"): the model's own steering wheel, pedals, gear lever and wipers, drawn on their pivots (they were never
  // drawn) — the wipers always, the rest only near (the camera within 14 m, or inside: `inside`)
  private cockpit: GFX.Group | null = null
  private wheelPivot: GFX.Group | null = null
  private parts: { kind: string; g: GFX.Group; axis: GFX.Vector3; src?: CockpitPart }[] = []
  // THE COCKPIT THAT WORKS (2026-11-16, Cockpit.ts): the dials' drawn faces, their needles, the gear lever through its
  // gate, the range lever, the handbrake — and where the driver's hand goes for a shift (`shiftGrip`, main.ts)
  private anim: CockpitAnim | null = null
  /** The cockpit's FINE parts — the dials' faces, their needles, the range and handbrake levers: drawn from inside or
   *  within 6 m (`close`) only. From the chase camera they are under a pixel, and their nine draws were +0.06 ms a
   *  frame (abq, the Steppe at the spawn, 2026-11-16); the wheel, the pedals and the gear lever stay to 14 m. */
  private fine: GFX.Object3D[] = []
  close = true
  private dialTex: GFX.Texture | null = null
  private readonly ckState: CockpitState = { speed: 0, rpm: 0, gear: 1, gears: 4, selector: 'D', lowRange: false, handbrake: false }
  /** The gear lever's knob (car space) and how far the driver's right hand has gone to it (0 on the wheel … 1). */
  get shiftGrip(): { k: number; pos: GFX.Vector3 } | null { return this.anim?.grip ?? null }
  /** The camera is inside (first person): the whole cockpit drawn, whatever the distance; `near`: within 14 m. */
  inside = false
  near = true
  /** P: the wipers sweep. */
  wipers = false
  private wipeT = 0
  private clutchK = 0
  private lastT = 0
  /** The roof's height over the ground (m, car space): the driver and the first-person eye stay under it. */
  get roofY(): number {
    const g = this.model?.body
    if (!g) return 2
    if (!g.boundingBox) g.computeBoundingBox()
    return g.boundingBox!.max.y
  }
  /** The steering wheel's turn now (rad, + = clockwise to the driver) — the driver's hands follow it. */
  steerWheel = 0
  /** The steering wheel in car space: its hub, its column axis (away from the driver), its rim radius. */
  get wheelRim(): { hub: GFX.Vector3; axis: GFX.Vector3; r: number } | null {
    const m = this.model
    return m?.steeringWheel ? { hub: new GFX.Vector3(...m.steeringPivot), axis: new GFX.Vector3(...m.steeringAxis).normalize(), r: m.steeringRadius } : null
  }
  /** The driver's door in car space (hinge, its length back from it, bottom / top) and the driver's seat — where the
   *  character's hips sit (2026-11-05: getting in and out). */
  get driverDoor(): { hinge: GFX.Vector3; length: number; bottom: number; top: number; seat: GFX.Vector3 } | null {
    const d = this.model ? driverDoor(this.model) : null
    if (!d) return null
    const hinge = new GFX.Vector3(...d.hinge)
    // (the seat: inside the door's opening, a little behind its middle, just above its sill)
    const seat = new GFX.Vector3(hinge.x + 0.42, hinge.y + d.bottom + 0.42, hinge.z + d.length * 0.62)
    return { hinge, length: d.length, bottom: d.bottom, top: d.top, seat }
  }
  park(): void {
    if (!this.sim || this.parked) return
    this.parked = true
    this.keys.clear()
    // (2026-11-21, the user: "I get out of the car and it got stuck in the air" — just reset, set down from a metre up,
    //  knocked up by a ram: it was held the instant its driver left it, wherever it was. It is HELD only once it STANDS:
    //  till then it stays live — no gas, the brakes locked — for 4 s at the most, the driver climbing out as it lands.
    //  Never held on the spot: what its wheels touched and how it moved are the LAST step's — set down from a height
    //  a moment ago it still reads as standing; a third of a second of standing, stepped, is what holds it)
    this.settling = 4
    this.restT = 0
  }
  /** Parked but not yet standing (s left of it): the body live, braked (fixed). */
  private settling = 0
  private restT = 0
  /** On its wheels and still. */
  private atRest(): boolean {
    if (!this.sim) return true
    let n = 0
    for (const w of this.sim.wheels) if (w.contact) n++
    const v = this.sim.body.linvel(), a = this.sim.body.angvel()
    return n >= 3 && v.x * v.x + v.y * v.y + v.z * v.z < 0.12 && a.x * a.x + a.y * a.y + a.z * a.z < 0.12
  }
  /** Held where it stands: a fixed thing (the ground under it may unload once its driver walks off). */
  private holdStill(): void {
    this.settling = 0
    if (!this.sim) return
    const b = this.sim.body
    b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true)
    b.setBodyType(this.physics.pw.R.RigidBodyType.KinematicPositionBased, true)
    this.w0.on = false
  }
  /** (the harness) parked and still coming to rest. */
  get landing(): boolean { return this.parked && this.settling > 0 }
  /** STRUCK WHERE IT STANDS (parked — the enemy's car on it as he runs you down): held, it was a kinematic thing that
   *  another kinematic one passed through. Live again, braked, to take the blow about to be given it — its crash watch
   *  told it stood still before (so that blow is a blow, and the dent is made) — and held again once it stands. */
  knocked(): void {
    if (!this.sim || !this.parked) return
    const b = this.sim.body, R = this.physics.pw.R
    if (b.bodyType() !== R.RigidBodyType.Dynamic) {
      b.setBodyType(R.RigidBodyType.Dynamic, true)
      const s = this.w0, t = b.translation()
      s.vx = s.vy = s.vz = s.fx = s.fy = s.fz = s.wx = s.wy = s.wz = 0; s.px = t.x; s.py = t.y; s.pz = t.z
      s.on = !!this.damage
    }
    this.settling = 4
    this.restT = 0
  }
  /** Back in: the body live again (placed at (x, z, heading) first, when given — the car brought to the rider). */
  unpark(at?: { x: number; z: number; heading: number }): void {
    if (!this.sim || !this.parked) return
    this.parked = false
    this.settling = 0
    this.sim.body.setBodyType(this.physics.pw.R.RigidBodyType.Dynamic, true)
    this.w0.on = false
    if (at) this.placeAt(at.x, at.z, at.heading)
  }
  /** Stood at (x, z), facing heading, on what's under it (parked or not). */
  placeAt(x: number, z: number, heading: number): void {
    if (!this.sim) return
    this.w0.on = false
    this.physics.follow(x, z)
    this.sim.place(x, this.physics.surface(x, z, this.map.height(x, z)) + 0.6, z, heading)
    this.readPose(this.curP, this.curQ)
    this.prevP.copy(this.curP); this.prevQ.copy(this.curQ)
    this.onPlaced?.()
  }
  /** (main.ts) the car has just been put somewhere — in the air, to drop: what's hitched to it set down again once it
   *  stands (the trailer). */
  onPlaced?: () => void
  /** Its half width and half length (m): where a bike can stand beside it. */
  get half(): { x: number; z: number } { return this.model ? { x: this.model.half.x, z: this.model.half.z } : { x: 1, z: 2.2 } }
  /** ITS BODY'S OWN BOX in plan (car space: the middle's x and z from its root, the half width and length) — what
   *  another car's bumper meets (Companion.ts: the ram). The model's `half` about the root is not it: the body sits
   *  a little off its root, and a few centimetres there is a bumper that hit without touching. */
  get bodyBox(): { cx: number; cz: number; hx: number; hz: number } {
    const g = this.model?.body
    if (!g) return this.bodyBoxOut
    if (!g.boundingBox) g.computeBoundingBox()
    const bb = g.boundingBox!, o = this.bodyBoxOut
    o.cx = (bb.min.x + bb.max.x) / 2; o.cz = (bb.min.z + bb.max.z) / 2; o.hx = (bb.max.x - bb.min.x) / 2; o.hz = (bb.max.z - bb.min.z) / 2
    return o
  }
  private readonly bodyBoxOut = { cx: 0, cz: 0, hx: 1, hz: 2.2 }

  /** Called when a car replaces the one driving (not the first): the sound stops one engine, starts the next. */
  onCarChange?: () => void

  /** Load car `id` and put it where the old one was (or on the map's first track at the start). */
  async setCar(id: string): Promise<void> {
    if (this.loading || id === this.id) return
    this.loading = true
    if (this.sim) this.onCarChange?.()
    const def = vehicleDef(id)
    const truck = await loadVehicle(def.id)
    let at: { x: number; z: number; heading: number }
    if (this.sim) {
      const t = this.sim.body.translation()
      at = { x: t.x, z: t.z, heading: this.sim.heading }
      this.sim.dispose()
    } else if (this.spawnAt) {
      at = this.spawnAt
      this.spawnAt = null
    } else at = startOf(this.map)
    this.id = def.id
    this.model = truck
    this.sim = new TruckSim(this.physics.pw, truck, { ...def.stock })
    this.sim.setDrivetrain(resolveSpec(def.spec, { wheelPos: truck.wheelPos, half: truck.half }), { ...def.stock })
    this.sim.offroadAssist = this.driving.offroadAssist
    const D = this.sim.drivetrain
    if (D) { D.aids = this.driving.aids === 'standard' ? 'std' : this.driving.aids; D.manual = this.driving.manual }
    this.sim.surface = (x, z, out) => this.surfaceAt(x, z, out)
    this.buildMeshes(truck, this.paint ?? OTH_PAINT[def.id] ?? def.stock.paint)
    this.sim.damage = this.damage ? this.damage.sim : null
    this.w0.on = false
    this.physics.follow(at.x, at.z)
    this.sim.place(at.x, this.physics.surface(at.x, at.z, this.map.height(at.x, at.z)) + 0.6, at.z, at.heading)
    this.readPose(this.curP, this.curQ)
    this.prevP.copy(this.curP); this.prevQ.copy(this.curQ)
    this.loading = false
  }

  /** Moved by (dx, dy, dz) as it drives — the same speed, the same spin (the crossing: the same road in another world). */
  shift(dx: number, dy: number, dz: number): void {
    if (!this.sim) return
    const t = this.sim.body.translation()
    this.sim.body.setTranslation({ x: t.x + dx, y: t.y + dy, z: t.z + dz }, false)
    this.curP.x += dx; this.curP.y += dy; this.curP.z += dz
    this.prevP.x += dx; this.prevP.y += dy; this.prevP.z += dz
    this.physics.follow(t.x + dx, t.z + dz)
  }

  /** R: back on its wheels where it is, same heading. */
  reset(): void {
    if (!this.sim) return
    const t = this.sim.body.translation()
    this.w0.on = false
    this.physics.follow(t.x, t.z)
    // (on what's under it — a slab's top it rolled on, else the ground; never inside the rock)
    this.sim.place(t.x, this.physics.surface(t.x, t.z, Math.max(this.map.height(t.x, t.z), t.y - 1.5)) + 0.8, t.z, this.sim.heading)
  }

  /** How wet the land is (main.ts: the weather's uWet): the tyres lose grip (each surface's own `wet`), the tracks
   *  turn half to MUD in the rain. */
  wet = 0
  /** What the tyres are on: dirt on the tracks, sand / gravel at the water, rock on the rock mask, else grass. */
  private readonly mk: [number, number, number, number] = [0, 0, 0, 0]
  private surfaceAt(x: number, z: number, out: SurfaceMix): void {
    const w = out.w
    w.fill(0)
    out.wet = this.wet
    out.wash = 0
    // on a BRIDGE's planks (above the water under it): a hard, slightly rough surface
    const deck = this.map.bridgeAt(x, z)
    if (deck !== null && this.sim && this.sim.body.translation().y > deck - 0.5) {
      w[Surf.Asphalt] = 0.7; w[Surf.Dirt] = 0.3
      blendRoughness(out)
      return
    }
    const m = this.map.maskAt(x, z, this.mk)
    const track = Math.max(0, Math.min(1, (0.3 - this.map.wayEdge(x, z)) / 0.6))       // (a track of the valley's or a road of the outland's)
    const water = m[2] > 0.9 ? 1 : 0
    const rock = Math.min(1, m[0] * 1.5) * (1 - track)
    const rest = Math.max(0, 1 - track - water - rock)
    w[Surf.Dirt] = track * (1 - 0.5 * this.wet)
    w[Surf.Mud] = track * 0.5 * this.wet
    w[Surf.Sand] = water
    w[Surf.Asphalt] = rock * 0.6 // (bare rock grips like a hard surface; rougher, see below)
    w[Surf.Dirt] += rock * 0.4
    w[Surf.Grass] = rest
    // the MUD of the marsh, the mud holes and the banks (mud.bin): it takes over what's under it
    const mud = this.map.mudAt(x, z) * (1 - water)
    if (mud > 0.01) { for (let k = 0; k < w.length; k++) w[k] *= 1 - mud; w[Surf.Mud] += mud }
    blendRoughness(out)
    out.stones *= 1 + rock
  }

  private buildMeshes(truck: TruckModel, paint: string): void {
    for (const c of [...this.root.children]) this.root.remove(c)
    this.lampMesh = this.tailMesh = null
    this.wheels.length = 0
    const u = this.uniforms
    u.uMap.value = truck.map
    u.uPaintMask.value = truck.paintMap
    ;(u.uPaint.value as GFX.Color).set(paint)
    // (MIST_K: the crossing's cloud takes less of the car than of the land — Atmosphere.ts)
    // (a car's own look — catalogue `smooth` / `glassTint`: the off-roader's clean paint, no grain; its darker glass)
    const look = vehicleDef(truck.id)
    const defines: Record<string, string> = { OTH_SPEC: '', MIST_K: '0.45', ...(GRAIN_OFF || look.smooth ? { NO_GRAIN: '' } : {}) }
    const glassDef: Record<string, string> = look.glassTint ? { GLASS_A: look.glassTint.toFixed(2) } : {}
    if (truck.map) defines.USE_MAP_OTH = ''
    if (truck.paintMap) defines.USE_PAINTMAP = ''
    const vc = (g: GFX.BufferGeometry) => !!g.attributes.color
    // DAMAGE (Damage.ts): this car's shell is its own to crumple — the body's and the glass's shaders read its `dmg`
    const dm = (this.damage = DAMAGE_ON ? new CarDamage(truck, this.charU) : null)
    const dmgDef: Record<string, string> = dm ? { DAMAGE: '' } : {}
    this.lampRev = -1
    // THREE DRAWS for the whole car (2026-11-02: it was 11 — body, cabin, two door skins, four wheels, three glass
    // pieces): the body with the CABIN (dash, seats, console — seen through the windows) and the DOORS (cut out of
    // the body in the model — two on the E30, four on the off-roader — set at their hinges: they never open here) as one mesh, the windows as one, the four
    // wheels as one instanced mesh
    const atHinge = (geo: GFX.BufferGeometry, hinge: [number, number, number]) => geo.clone().translate(...hinge)
    // (the DRIVER'S DOOR its own two draws on a pivot at its hinge: it opens as the character gets in or out —
    //  2026-11-05; the other doors stay in the body)
    const driver = driverDoor(truck)
    const fixed = truck.doors.filter((d) => d !== driver)
    const bodyGeo = mergeParts([truck.body, ...(truck.cabin ? [truck.cabin] : []), ...fixed.map((d) => atHinge(d.body, d.hinge))])
    const glassGeo = mergeParts([truck.glass, ...fixed.flatMap((d) => (d.glass ? [atHinge(d.glass, d.hinge)] : []))])
    const body = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines: { ...defines, ...dmgDef }, vertexShader: VERT, fragmentShader: FRAG, vertexColors: vc(bodyGeo) })
    const glass = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines: { OTH_SPEC: '', GLASS: '', MIST_K: '0.45', ...glassDef, ...dmgDef }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, vertexColors: vc(glassGeo), side: GFX.DoubleSide, depthWrite: false })
    if (dm) { dm.attach(bodyGeo, false); dm.attach(glassGeo, true) }
    // (no depth written: the water — drawn after the glass, transparent too — showed nowhere through a window from
    //  inside; 2026-11-05)
    const b = new GFX.Mesh(bodyGeo, body)
    const g = new GFX.Mesh(glassGeo, glass)
    b.frustumCulled = g.frustumCulled = false
    g.renderOrder = 3 // (transparent: after the cabin behind it)
    this.root.add(b, g)
    this.doorPivot?.removeFromParent()
    this.doorPivot = null
    if (driver) {
      const pv = (this.doorPivot = new GFX.Group())
      pv.position.set(...driver.hinge)
      // (damage: the door's skin and pane this car's own copies — the model's are every car's)
      const dbGeo = dm ? driver.body.clone() : driver.body, dgGeo = driver.glass ? (dm ? driver.glass.clone() : driver.glass) : null
      if (dm) { dm.attach(dbGeo, false, driver.hinge); if (dgGeo) dm.attach(dgGeo, true, driver.hinge) }
      const db = new GFX.Mesh(dbGeo, body), dg = dgGeo ? new GFX.Mesh(dgGeo, glass) : null
      db.frustumCulled = false
      pv.add(db)
      if (dg) { dg.frustumCulled = false; dg.renderOrder = 3; pv.add(dg) }
      this.root.add(pv)
    }
    this.cockpit?.removeFromParent()
    for (const pt of this.parts) pt.g.removeFromParent()
    this.parts = []
    this.fine = []
    this.wheelPivot = null
    const ck = (this.cockpit = new GFX.Group())
    const partMesh = (geo: GFX.BufferGeometry) => {
      const m = new GFX.Mesh(geo, new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines, vertexShader: VERT, fragmentShader: FRAG, vertexColors: vc(geo) }))
      m.frustumCulled = false
      return m
    }
    if (truck.steeringWheel) {
      const g = (this.wheelPivot = new GFX.Group())
      g.position.set(...truck.steeringPivot)
      g.add(partMesh(truck.steeringWheel))
      ck.add(g)
    }
    for (const c of truck.controls) {
      const g = new GFX.Group()
      g.position.set(...c.pivot)
      g.add(partMesh(c.geo))
      ;(c.kind.startsWith('wiper') ? this.root : ck).add(g)
      this.parts.push({ kind: c.kind, g, axis: new GFX.Vector3(...c.axis).normalize(), src: c })
      if (c.kind.startsWith('needle_') || c.kind.startsWith('lever_')) this.fine.push(g)
    }
    // the dials' faces (their scales drawn for this car — Cockpit.ts) and what moves the needles and the levers
    this.dialTex?.dispose()
    this.dialTex = null
    const gauges = vehicleDef(this.id).gauges
    if (truck.dials && gauges?.length) {
      this.dialTex = dialTexture(gauges)
      const dm = new GFX.Mesh(truck.dials, dialMaterial(u, this.dialTex))
      dm.frustumCulled = false
      ck.add(dm)
      this.fine.push(dm)
    }
    this.anim = new CockpitAnim(this.parts)
    this.root.add(ck)
    const wheelMat = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines: { ...defines, WHEEL: '' }, vertexShader: VERT, fragmentShader: FRAG, vertexColors: vc(truck.wheel) })
    this.wheelMesh = new GFX.InstancedMesh(truck.wheel, wheelMat, 4)
    this.wheelMesh.frustumCulled = false
    this.wheelMesh.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
    this.root.add(this.wheelMesh)
    for (let k = 0; k < 4; k++) this.wheels.push(new GFX.Object3D()) // (each wheel's pose: update() → the instances)
    this.shadowSize.set(truck.half.x * 2 + 1.0, 1, truck.half.z * 2 + 1.2)
  }

  get shadowMesh(): GFX.Mesh { return this.shadow }

  /** On its wheels on the ground: two or more tyres touching, the roof up (a safe spot to save the journey at). */
  grounded(): boolean {
    if (!this.sim) return false
    let n = 0
    for (const w of this.sim.wheels) if (w.contact) n++
    return n >= 2 && this.up.set(0, 1, 0).applyQuaternion(this.root.quaternion).y > 0.6
  }
  private readonly up = new GFX.Vector3()

  private readonly viewSphere = new GFX.Sphere(new GFX.Vector3(), 15)
  /** Out of the view or behind the hills, the car isn't drawn (2026-11-02: every part skipped three's cull — the body
   *  pieces, glass, wheels, lamps, beams and the shadow cost ~0.2 ms a frame with the car off-screen): one test a frame
   *  for all of them, a sphere of 15 m (the beams reach 12 m ahead). Its light on the world (`lights`) stays. */
  cull(view: GFX.Frustum, horizon: Horizon): void {
    const p = this.root.position
    this.viewSphere.center.copy(p)
    this.root.visible = view.intersectsSphere(this.viewSphere) && !horizon.hidden(p.x - 15, p.z - 15, p.x + 15, p.z + 15, p.y + 4)
    this.shadow.visible &&= this.root.visible // (update() already hid it in the air)
  }

  /** Fixed step (60 Hz), before world.step(). */
  fixed(dt: number): void {
    if (!this.sim || this.loading) return
    if (this.parked) {
      // LEFT BEFORE IT STOOD (park): live till it stands on its wheels — nobody at the controls, the brakes locked —
      // then held; whatever it is doing after 4 s, held (the ground under it goes with its driver)
      if (this.settling <= 0) return
      const c = this.sim.controls, t0 = this.sim.body.translation()
      c.throttle = 0; c.steer = 0; c.brake = true; c.handbrake = true; c.boost = false; c.footBrake = 0; c.lift = 0; c.parked = true
      this.crashWatch(dt)
      this.readPose(this.prevP, this.prevQ)
      this.sim.step(dt)
      this.sim.keepAbove(this.map.height(t0.x, t0.z))
      this.watchEnd()
      this.restT = this.atRest() ? this.restT + dt : 0
      if ((this.settling -= dt) <= 0 || this.restT > 0.3) this.holdStill()
      return
    }
    const k = this.keys
    const t = this.sim.body.translation()
    this.physics.follow(t.x, t.z)
    this.crashWatch(dt)
    const up = k.has('KeyW') || k.has('ArrowUp'), down = k.has('KeyS') || k.has('ArrowDown')
    const w = (up ? 1 : 0) - (down ? 1 : 0) + this.touch.gas - this.touch.brake
    const ad = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touch.right - this.touch.left
    // keys as a foot and hands (as the game does it): the gas squeezes on over 0.6 s, the brake over 0.3 s, the
    // wheel winds on over 0.45 s and centres in 0.15 s
    if (w === 0 || Math.sign(w) !== Math.sign(this.pedal)) this.pedal = 0
    this.pedal = w > 0 ? Math.min(1, this.pedal + dt / 0.6) : w < 0 ? Math.max(-1, this.pedal - dt / 0.3) : 0
    const st = this.steerK
    if (ad === 0 || (st !== 0 && Math.sign(ad) !== Math.sign(st))) {
      const d = dt / 0.15
      this.steerK = Math.abs(st) <= d ? 0 : st - Math.sign(st) * d
      this.hold = 0
    } else {
      this.hold = Math.min(1, this.hold + dt / 0.45)
      this.steerK = Math.sign(ad) * Math.max(Math.abs(st), this.hold * this.hold * (3 - 2 * this.hold))
    }
    const c = this.sim.controls
    // THE AUTOPILOT (Autopilot.ts): it drives unless the player's hands are on the controls (then it lets go)
    const manual = w !== 0 || ad !== 0 || k.has('Space')
    const r = this.sim.body.rotation(), upY = 1 - 2 * (r.x * r.x + r.z * r.z)
    if (this.pilot?.(dt, this.sim, manual, upY)) { this.pedal = 0; this.steerK = 0; this.hold = 0 }
    else {
      c.throttle = this.pedal
      c.steer = this.steerK
      c.brake = down || this.touch.brake > 0
      c.handbrake = k.has('Space')
      c.boost = k.has('ShiftLeft') || k.has('ShiftRight')
      c.footBrake = 0
      c.lift = 0
      c.parked = false
    }
    // (a worn engine MISFIRES: it cuts out for a tenth of a second or two — the worse it is, the more often)
    const dm = this.damage
    if (dm) {
      if (!dm.misfires) this.misT = 0
      else if (this.misT > 0) this.misT -= dt
      else if (Math.random() < dt * (0.5 + 3.5 * (1 - dm.engine / DAMAGE.engine.misfireAt))) this.misT = 0.07 + Math.random() * 0.16
      this.sim.cut = this.misT > 0 ? 0.1 : 1
    }
    this.readPose(this.prevP, this.prevQ)
    this.sim.step(dt)
    this.sim.keepAbove(this.map.height(t.x, t.z))
    // FORDING (a river, a stream, a pond's edge): the water drags the car back by its depth (and holds it up a little
    // when it's deep) — a crossing is slow, a deep one a struggle
    const lvl = this.map.waterAt(t.x, t.z)
    if (lvl !== null) {
      const depth = lvl - this.map.height(t.x, t.z)
      if (depth > 0.15) {
        const b = this.sim.body, v = b.linvel(), m = b.mass(), k = Math.min(1.2, depth) * 0.9
        b.applyImpulse({ x: -v.x * m * k * dt, y: m * 3 * Math.max(0, Math.min(1, depth - 0.6)) * dt, z: -v.z * m * k * dt }, true)
      }
    }
    this.watchEnd()
  }

  // ------------------------------------------------------------------------------------------- damage (Damage.ts)
  /** This car's damage (null: the setting is off). */
  damage: CarDamage | null = null
  /** A crash it has just had — after its own damage is done (main.ts: the view's jolt, the other car's share). */
  onCrash: ((c: Crash) => void) | null = null
  private readonly charU = { value: 0 }
  private misT = 0
  private lampRev = -1
  /** The body as the last step left it, with the forces it had put on itself: the next step's change beyond those
   *  (and gravity) is a BLOW. */
  private readonly w0 = { on: false, vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0, wx: 0, wy: 0, wz: 0, px: 0, py: 0, pz: 0 }
  private readonly crash: Crash = { dv: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, other: null }
  /** WHERE A SHOVE IS ABOUT TO LAND (the companion's car rams: an impulse, no contact for the watch to find): the
   *  point (the world's) and whose body did it — the next blow found touching nothing is put there. */
  hitHint(x: number, y: number, z: number, other: RAPIER.RigidBody | null): void {
    const h = this.hint
    h.x = x; h.y = y; h.z = z; h.other = other; h.t = performance.now()
  }
  private readonly hint: { x: number; y: number; z: number; other: RAPIER.RigidBody | null; t: number } = { x: 0, y: 0, z: 0, other: null, t: -1e9 }
  /** (the harness) the biggest change of velocity a step has made that was not the car's own doing (m/s); the hardest
   *  a wheel has come down on its stops (m/s). */
  peakDv = 0
  peakLand = 0
  private readonly landPeak = [0, 0, 0, 0]
  private watchEnd(): void {
    if (!this.damage) return
    const b = this.sim.body, v = b.linvel(), f = b.userForce(), w = b.angvel(), s = this.w0
    const t = b.translation()
    s.vx = v.x; s.vy = v.y; s.vz = v.z; s.fx = f.x; s.fy = f.y; s.fz = f.z; s.wx = w.x; s.wy = w.y; s.wz = w.z; s.px = t.x; s.py = t.y; s.pz = t.z
    s.on = true
  }
  /** Before a step's own forces: what the LAST world step did to the body beyond its own forces and gravity — what
   *  it ran into did that. From `crash.minDv` m/s: a blow, where the contacts say it landed. And the wheels that came
   *  down on their stops. */
  private crashWatch(dt: number): void {
    const dm = this.damage, s = this.w0
    if (!dm || !s.on) return
    s.on = false
    // (a LANDING: a wheel down on its stops — one blow to its axle, of the hardest it came down in those steps)
    const hh = this.sim.hardHit, lp = this.landPeak
    for (let k = 0; k < 4; k++) {
      if (hh[k] > 0) { if (hh[k] > lp[k]) lp[k] = hh[k]; hh[k] = 0 }
      else if (lp[k] > 0) { if (lp[k] > this.peakLand) this.peakLand = lp[k]; dm.landing(k, lp[k]); lp[k] = 0 }
    }
    const b = this.sim.body, v = b.linvel(), m = b.mass()
    // (PUT somewhere else since — brought to the rider, set down at a camp, through the crossing: not where a step
    //  could have taken it. No blow in that)
    const at = b.translation()
    if (Math.hypot(at.x - s.px - s.vx * dt, at.y - s.py - s.vy * dt, at.z - s.pz - s.vz * dt) > 0.5) return
    const g = this.physics.pw.world.gravity.y * b.gravityScale()
    const dx = v.x - s.vx - (s.fx / m) * dt, dy = v.y - s.vy - (s.fy / m + g) * dt, dz = v.z - s.vz - (s.fz / m) * dt
    const d = Math.hypot(dx, dy, dz)
    if (d > this.peakDv) this.peakDv = d
    if (d < DAMAGE.crash.minDv * 0.8) return
    this.blow(dx, dy, dz)
  }
  private blowT = -1e9
  private blowDv = 0
  private readonly bq = new GFX.Quaternion()
  private readonly bp = new GFX.Vector3()
  private readonly bd = new GFX.Vector3()
  /** A BLOW that changed the body's velocity by (dx, dy, dz): where — what the body touches (nothing: the face of it
   *  the push came through) —, against whom, how hard there (the turn it gave the body counted), and what it did. */
  private blow(dx: number, dy: number, dz: number): void {
    const dm = this.damage!, pw = this.physics.pw, body = this.sim.body
    // WHERE: what the body TOUCHES now — every contact point of the narrow phase within a hand of touching, in the
    // body's own space, the deeper the heavier — and AGAINST WHOM: the nearest's body. (Not the solver's contacts and
    // their impulses: the body's CCD runs a hard step in pieces, and by its end those are of the last piece — all
    // zero, measured 2026-11-21: 2 127 manifolds against a wall, 607 with points, none with an impulse.)
    let sum = 0, lx = 0, ly = 0, lz = 0, near = 0.08, other: RAPIER.RigidBody | null = null
    for (let i = 0, n = body.numColliders(); i < n; i++) {
      const c1 = body.collider(i)
      // (the tyre guards — capsules set off from the body: their points are not in its space; they meet slabs only)
      if (c1.shapeType() === pw.R.ShapeType.Capsule) continue
      pw.world.contactPairsWith(c1, (c2) => {
        pw.world.contactPair(c1, c2, (mf, flipped) => {
          for (let k = 0, nc = mf.numContacts(); k < nc; k++) {
            const d = mf.contactDist(k)
            if (d > 0.08) continue
            const p = flipped ? mf.localContactPoint2(k) : mf.localContactPoint1(k)
            if (!p) continue
            const w = 0.1 - Math.max(-0.1, d)
            lx += p.x * w; ly += p.y * w; lz += p.z * w; sum += w
            if (d < near) { near = d; other = c2.parent() }
          }
        })
      })
    }
    const t = body.translation(), r = body.rotation(), q = this.bq.set(r.x, r.y, r.z, r.w), P = this.bp, D = this.bd
    if (sum === 0 && performance.now() - this.hint.t < 300) {
      // (nothing touching, and a ram has just been given: there, where his car met this one — and his is the other)
      const h = this.hint
      h.t = -1e9
      other = h.other
      D.set(dx, dy, dz).normalize().applyQuaternion(q.invert())
      P.set(h.x - t.x, h.y - t.y, h.z - t.z).applyQuaternion(q)
      q.invert()
    } else if (sum === 0) {
      // (nothing touched — a blast: the point of the body's box the push came through, from its middle, against the push)
      const bb = this.bodyBox, hy = this.model.half.y
      D.set(dx, dy, dz).normalize().applyQuaternion(q.invert())
      const k = Math.min(bb.hx / Math.max(1e-6, Math.abs(D.x)), hy / Math.max(1e-6, Math.abs(D.y)), bb.hz / Math.max(1e-6, Math.abs(D.z)))
      P.set(bb.cx - D.x * k, this.model.bottom + hy - D.y * k, bb.cz - D.z * k)
      q.invert()
    } else {
      // (the change of velocity AT the point: the body's turn counted — a corner clipped spins it more than it stops it)
      P.set(lx / sum, ly / sum, lz / sum)
      const w = body.angvel(), s = this.w0, com = body.worldCom(), W = this.bd.copy(P).applyQuaternion(q)
      const ax = w.x - s.wx, ay = w.y - s.wy, az = w.z - s.wz, rx = W.x + t.x - com.x, ry = W.y + t.y - com.y, rz = W.z + t.z - com.z
      dx += ay * rz - az * ry; dy += az * rx - ax * rz; dz += ax * ry - ay * rx
      D.set(dx, dy, dz).normalize().applyQuaternion(q.invert())
      q.invert()
    }
    const dv = Math.hypot(dx, dy, dz)
    if (dv < DAMAGE.crash.minDv) return
    // (ONE CRASH, ONE BLOW: for a third of a second the physics may still be settling it — the body pressed on, ground
    //  between two things, every step another change of velocity. Those are the same crash: only a HARDER one counts)
    const now = performance.now()
    if (now - this.blowT < 330 && dv <= this.blowDv) return
    this.blowT = now; this.blowDv = dv
    dm.doorShut = this.doorOpen < 0.05
    dm.hit(P.x, P.y, P.z, D.x, D.y, D.z, dv)
    if (!this.onCrash) return
    const c = this.crash
    c.dv = dv; c.other = other
    P.applyQuaternion(q)
    c.x = P.x + t.x; c.y = P.y + t.y; c.z = P.z + t.z
    c.dx = dx / dv; c.dy = dy / dv; c.dz = dz / dv
    this.onCrash(c)
  }
  /** A BULLET stops on the car at (x, y, z), flying along (dx, dy, dz) — the world's. */
  shot(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const dm = this.damage
    if (!dm) return
    const q = this.bq.copy(this.root.quaternion).invert()
    const P = this.bp.set(x, y, z).sub(this.root.position).applyQuaternion(q), D = this.bd.set(dx, dy, dz).applyQuaternion(q)
    dm.doorShut = this.doorOpen < 0.05
    dm.hit(P.x, P.y, P.z, D.x, D.y, D.z, 0, 'shot')
  }
  /** Its wheel's mesh (a torn-off one rolls away — DamageFx), its paint. */
  get wheelPart(): { geo: GFX.BufferGeometry; mat: GFX.Material; r: number } | null { return this.wheelMesh && this.model ? { geo: this.model.wheel, mat: this.wheelMesh.material as GFX.Material, r: this.model.wheelRadius } : null }
  get paintColor(): GFX.Color { return this.uniforms.uPaint.value as GFX.Color }

  private readPose(p: GFX.Vector3, q: GFX.Quaternion): void {
    const t = this.sim.body.translation(), r = this.sim.body.rotation()
    p.set(t.x, t.y, t.z)
    q.set(r.x, r.y, r.z, r.w)
  }

  private readonly e = new GFX.Euler()
  private frameDt = 0
  /** Render frame: the interpolated pose, the wheels, the contact shadow. */
  update(alpha: number): void {
    if (!this.sim || this.loading) return
    this.readPose(this.curP, this.curQ)
    this.pos.lerpVectors(this.prevP, this.curP, alpha)
    this.root.position.copy(this.pos)
    this.root.quaternion.slerpQuaternions(this.prevQ, this.curQ, alpha)
    // the driver's door: swung out about its hinge (its rear edge to −x — the driver's side)
    if (this.doorPivot) { const k = Math.min(1, Math.max(0, this.doorOpen)); this.doorPivot.rotation.set(0, -1.15 * k * k * (3 - 2 * k), 0) }
    const w = this.sim.wheels, tr = this.model
    // the cockpit: the steering wheel at 14 : 1 to the front wheels, the pedals pressed, the wipers sweeping (P)
    {
      const now = performance.now() / 1000, dt = Math.min(0.1, now - (this.lastT || now)); this.lastT = now
      this.frameDt = dt
      const c = this.sim.controls, steer = (w[0].steer + (w[1]?.steer ?? w[0].steer)) / 2
      this.steerWheel = Math.max(-2.6, Math.min(2.6, steer * 14))
      if (this.wheelPivot) this.wheelPivot.quaternion.setFromAxisAngle(new GFX.Vector3(...tr.steeringAxis).normalize(), this.steerWheel)
      if (this.wipers || this.wipeT % 1.1 > 0.02) this.wipeT += dt
      const sweep = (0.5 - 0.5 * Math.cos((this.wipeT / 1.1) * Math.PI * 2)) * 1.45
      const gas = Math.max(0, c.throttle), brk = c.brake || c.throttle < 0 ? 1 : 0
      // the CLUTCH pedal (a manual's): down as the drivetrain's clutch opens — pulling away, each shift — eased, a foot's speed
      const open = 1 - (this.sim.drivetrain?.clutch ?? 1)
      this.clutchK += Math.max(-dt * 7, Math.min(dt * 9, open - this.clutchK))
      for (const pt of this.parts) {
        if (pt.kind.startsWith('needle_') || pt.kind.startsWith('lever_') || pt.kind === 'gear_lever') continue // (Cockpit.ts moves them)
        const a = pt.kind === 'pedal_gas' ? gas * 0.32 : pt.kind === 'pedal_brake' ? brk * 0.3 : pt.kind === 'pedal_clutch' ? this.clutchK * 0.34 : pt.kind.startsWith('wiper') ? sweep : 0
        pt.g.quaternion.setFromAxisAngle(pt.axis, a)
      }
      if (this.cockpit) this.cockpit.visible = this.inside || (this.near && this.root.visible)
      { const fine = this.inside || this.close; for (let i = 0; i < this.fine.length; i++) this.fine[i].visible = fine }
      // the needles and the levers: what the car is doing now (only while the cockpit is drawn)
      if (this.anim && this.cockpit?.visible) {
        const D = this.sim.drivetrain, st = this.ckState
        st.speed = this.sim.speed
        st.rpm = D ? (D.we * 30) / Math.PI : 800 + Math.abs(this.sim.speed) * 90
        st.gear = D ? D.gearTarget : 1
        st.gears = D ? D.R.gearbox.ratios.length : 4
        st.selector = D ? D.selector : 'D'
        st.lowRange = !!D?.lowRange
        st.handbrake = !!c.handbrake || !!c.parked
        this.anim.update(dt, st)
      }
    }
    const dmg = this.damage
    if (dmg) { dmg.doorShut = this.doorOpen < 0.05; dmg.update(Math.min(0.1, this.frameDt)) }
    tr.wheelPos.forEach(([x, y, z], k) => {
      const right = k === 1 || k === 3
      const spin = -w[k].spin
      // (a BENT AXLE: the wheel leans, its top in toward the body; torn off: not there)
      const wd = dmg ? dmg.wheels[k] : null
      this.e.set(right ? -spin : spin, (right ? Math.PI : 0) - w[k].steer, wd ? -wd.bend : 0, 'YZX')
      const m = this.wheels[k]
      m.position.set(x, y + w[k].lift, z)
      m.quaternion.setFromEuler(this.e)
      m.scale.setScalar(wd && wd.off ? 1e-5 : 1)
      m.updateMatrix()
      this.wheelMesh!.setMatrixAt(k, m.matrix)
    })
    this.wheelMesh!.instanceMatrix.needsUpdate = true
    // the contact shadow: its grid laid on the ground under the body (world-space vertices, turned with the car)
    const sp = this.shadow.geometry.attributes.position as GFX.BufferAttribute
    const a = sp.array as Float32Array, base = this.shadowBase
    const h = this.sim.heading, cs = Math.cos(h), sn = Math.sin(h)
    for (let i = 0; i < sp.count; i++) {
      const lx = base[i * 3] * this.shadowSize.x, lz = base[i * 3 + 2] * this.shadowSize.z
      const x = this.pos.x + lx * cs + lz * sn, z = this.pos.z - lx * sn + lz * cs
      a[i * 3] = x; a[i * 3 + 1] = this.map.height(x, z) + 0.04; a[i * 3 + 2] = z
    }
    sp.needsUpdate = true
    this.shadow.visible = this.pos.y - this.map.height(this.pos.x, this.pos.z) < 3 // (none in the air)
  }

  /** L: headlights on / off / auto (auto = on from dusk). */
  private lightMode: 'auto' | 'on' | 'off' = 'auto'

  /** THE SAND COAT (2026-11-02, the user: "sands like in Over the Hill"): dust that builds up on the body — low down
   *  and on what faces up, in blotches — while it drives on loose sand (a minute or so to coat it), in a sandstorm,
   *  lightly on the valley's dirt tracks; washed off by a ford or the oasis's water (a few seconds) and slowly by
   *  rain. Its colour follows what it was picked up from. One sample of the ground a frame. */
  private readonly coatU = { value: 0 }
  private readonly coatColor = new GFX.Color(0.8, 0.6, 0.42)
  private readonly baseU = { value: 0 }
  private readonly coatTo = new GFX.Color()
  get coat(): number { return this.coatU.value }
  set coat(v: number) { this.coatU.value = Math.min(1, Math.max(0, v)) }
  weather(atmos: Atmosphere, dt: number): void {
    if (!this.sim) return
    const p = this.pos, u = atmos.uniforms, ground = this.map.height(p.x, p.z)
    this.baseU.value = ground
    const speed = Math.min(1, Math.abs(this.sim.speed) / 8)
    const lvl = this.map.waterAt(p.x, p.z)
    if (lvl !== null && lvl - ground > 0.2 && p.y < lvl + 0.6) { this.coat -= (dt / 3.5) * (0.3 + speed); return }
    const onGround = p.y - ground < 1.5
    const track = Math.max(0, Math.min(1, (0.3 - this.map.wayEdge(p.x, p.z)) / 0.6))
    const dirt = onGround ? track * 0.35 * (1 - u.uWet.value) : 0
    const gain = (dt / 70) * speed * dirt
    if (gain > 0) {
      this.coatTo.setRGB(0.55, 0.45, 0.33)
      this.coatColor.lerp(this.coatTo, Math.min(1, gain / Math.max(this.coat, 0.05)))
    }
    this.coat += gain - (dt / 80) * u.uRain.value
  }
  private lampMesh: GFX.InstancedMesh | null = null
  private tailMesh: GFX.InstancedMesh | null = null
  private beams: GFX.Mesh | null = null
  private readonly lampMat = glowMaterial(new GFX.Color(1, 0.9, 0.72))
  private readonly tailMat = glowMaterial(new GFX.Color(1, 0.07, 0.03))
  private readonly beamMat = beamMaterial()
  private brakeK = 0
  private readonly lampL = new GFX.Vector3()
  private readonly lampR = new GFX.Vector3()
  /** The car's lights (2026-10-27, the user: "the headlight comes from the centre of the front, not the headlamps; the
   *  back light should light when we brake; use a light like paint"): the shared uniforms put a painted BEAM from each
   *  lamp on every surface (Atmosphere `headlight()`) and the brake lights' red pool behind; the lenses GLOW (soft
   *  painted halos, above white: the bloom takes them), at night a faint painted cone of light in the air ahead. The
   *  BRAKE LIGHTS burn whenever the brake is on while rolling forward (S / BRAKE; S at a standstill is reverse) or the
   *  handbrake is pulled, day or night; with the headlights on the tail lamps glow dim. */
  lights(atmos: Atmosphere, dt = 1 / 60): void {
    if (!this.sim || !this.model) return
    // (on by themselves at night)
    // (the look, round 5 — the user's frames: in the golden hour the lamps are already on, their pool on the track
    //  and the tail lamps' red behind: on from the sun ~12° up, down through the dusk)
    const dusk = LOOK > 0 && atmos.sunY < 0.21
    const on = this.lightMode === 'on' || (this.lightMode === 'auto' && (atmos.uniforms.uNight.value > 0.25 || dusk))
    const u = atmos.uniforms, head = this.model.lamps.head, tail = this.model.lamps.tail, hz = this.model.half, q = this.root.quaternion
    const h = head ? head.c : [hz.x * 0.7, 0.9, -hz.z], t = tail ? tail.c : [hz.x * 0.75, 0.9, hz.z]
    this.lampL.set(-Math.abs(h[0]), h[1], h[2] - 0.05).applyQuaternion(q).add(this.root.position)
    this.lampR.set(Math.abs(h[0]), h[1], h[2] - 0.05).applyQuaternion(q).add(this.root.position)
    // (a BROKEN lamp — Damage.ts: no beam from it — its place put far under the ground —, no glow; both: dark)
    const out = this.damage ? this.damage.lamps : NO_LAMPS
    if (out[0]) this.lampL.y -= 1e4
    if (out[1]) this.lampR.y -= 1e4
    const beamOn = on && !(out[0] && out[1])
    u.uHeadL.value.set(this.lampL.x, this.lampL.y, this.lampL.z, beamOn ? 1 : 0)
    u.uHeadR.value.copy(this.lampR)
    u.uHeadDir.value.set(0, 0, -1).applyQuaternion(q)
    u.uHeadUp.value.set(0, 1, 0).applyQuaternion(q)
    const c = this.sim.controls, braking = (c.brake && this.sim.speed > 0.4) || c.handbrake
    this.brakeK = braking ? Math.min(1, this.brakeK + dt / 0.06) : Math.max(0, this.brakeK - dt / 0.12)
    const tc = new GFX.Vector3(0, t[1], t[2] + 0.1).applyQuaternion(q).add(this.root.position)
    const tailsLeft = (out[2] ? 0 : 0.5) + (out[3] ? 0 : 0.5)
    u.uTail.value.set(tc.x, tc.y, tc.z, Math.max(this.brakeK, on && LOOK ? 0.4 : 0) * tailsLeft)   // (the look: the lit tail lamps' own dim pool)
    if (!this.lampMesh) {
      const g = new GFX.PlaneGeometry(2, 2)
      this.lampMesh = new GFX.InstancedMesh(g, this.lampMat, 2)
      this.tailMesh = new GFX.InstancedMesh(g, this.tailMat, 2)
      this.lampMesh.frustumCulled = this.tailMesh.frustumCulled = false
      this.lampMesh.renderOrder = this.tailMesh.renderOrder = 2
      this.beams = new GFX.Mesh(beamGeometry(Math.abs(h[0]), h[1], h[2] - 0.05), this.beamMat)
      this.beams.frustumCulled = false
      this.beams.renderOrder = 3
      this.root.add(this.lampMesh, this.tailMesh, this.beams)
      this.lampRev = -1
    }
    // (the glows' places — set again when a lamp breaks or is mended: a broken one has no size)
    const rev = this.damage ? this.damage.sim.rev : 0
    if (rev !== this.lampRev) {
      this.lampRev = rev
      const m = new GFX.Matrix4(), back = new GFX.Quaternion().setFromAxisAngle(new GFX.Vector3(0, 1, 0), Math.PI)
      for (let k = 0; k < 2; k++) {
        const sx = k ? 1 : -1
        // (each glow 3× its lens: the lens a bright core, round it a soft halo)
        const hr = out[k] ? 0 : (head ? Math.max(0.06, Math.min(head.w, head.h)) : 0.1) * 3
        m.compose(new GFX.Vector3(Math.abs(h[0]) * sx, h[1], h[2] - 0.03), back, new GFX.Vector3(hr, hr, 1))
        this.lampMesh.setMatrixAt(k, m)
        const tr = out[2 + k] ? 0 : (tail ? Math.max(0.05, Math.min(tail.w, tail.h)) : 0.08) * 3
        m.compose(new GFX.Vector3(Math.abs(t[0]) * sx, t[1], t[2] + 0.03), new GFX.Quaternion(), new GFX.Vector3(tr, tr, 1))
        this.tailMesh!.setMatrixAt(k, m)
      }
      this.lampMesh.instanceMatrix.needsUpdate = true
      this.tailMesh!.instanceMatrix.needsUpdate = true
    }
    this.lampMesh.visible = beamOn
    this.lampMat.uniforms.uK.value = 5.5
    const tailK = Math.max(on ? 0.3 : 0, this.brakeK) * (tailsLeft > 0 ? 1 : 0)
    this.tailMesh!.visible = tailK > 0.01
    this.tailMat.uniforms.uK.value = 5.0 * tailK
    this.beams!.visible = on && !out[0] && !out[1] && (u.uNight.value > 0.05 || dusk)
    this.beamMat.uniforms.uK.value = Math.max(u.uNight.value, dusk ? 0.35 : 0)
  }

  get speedKmh(): number { return this.sim ? Math.abs(this.sim.speed) * 3.6 : 0 }
  get gear(): string { return this.sim?.real?.gearLabel ?? '' }
  /** The driving settings changed in play (the pause menu — main.ts): the gearbox, the aids, the off-road assist taken
   *  by the car being driven at once (a new car takes them when it's built). */
  /** The paint changed in play (the garage in the pause menu): the body's colour at once; null — this world's own. */
  setPaint(hex: string | null): void {
    this.paint = hex
    const def = VEHICLES.find((v) => v.id === this.id)
    ;(this.uniforms.uPaint.value as GFX.Color).set(hex ?? OTH_PAINT[this.id] ?? def?.stock.paint ?? '#b8452e')
  }
  setDriving(d: Vehicle['driving']): void {
    this.driving = { ...d }
    if (!this.sim) return
    this.sim.offroadAssist = d.offroadAssist
    const D = this.sim.drivetrain
    if (D) { D.aids = d.aids === 'standard' ? 'std' : d.aids; D.manual = d.manual }
  }
}

const NO_LAMPS: readonly boolean[] = [false, false, false, false]

/** Parts merged into one geometry: each given the attributes the others have, as floats (a missing colour → white,
 *  paint mask / uv → 0: what the shader read for it before — no USE_COLOR / an attribute's default), all indexed or
 *  none. */
function mergeParts(parts: GFX.BufferGeometry[]): GFX.BufferGeometry {
  const names = [...new Set(parts.flatMap((g) => Object.keys(g.attributes)))]
  const indexed = parts.every((g) => g.index)
  const ready = parts.map((g0) => {
    const g0b = indexed ? g0 : g0.index ? g0.toNonIndexed() : g0
    const g = new GFX.BufferGeometry()
    const n = g0b.attributes.position.count
    for (const name of names) {
      const a = g0b.attributes[name] as GFX.BufferAttribute | undefined
      const size = a?.itemSize ?? (parts.find((p) => p.attributes[name])!.attributes[name] as GFX.BufferAttribute).itemSize
      const out = new Float32Array(n * size)
      if (a) for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) out[i * size + c] = a.getComponent(i, c)
      else out.fill(name === 'color' ? 1 : 0)
      g.setAttribute(name, new GFX.BufferAttribute(out, size))
    }
    if (indexed) g.setIndex(Array.from(g0b.index!.array))
    return g
  })
  const merged = mergeGeometries(ready)
  if (!merged) throw new Error('the car parts would not merge')
  return merged
}

/** ?grain=0 (the cost A/B — scripts/harness/abgpu.mjs): the vehicles' paint grain off. */
export const GRAIN_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('grain') === '0'

/** Paint per car on this map: the off-roader in rust red (the shelved G500 too), the shelved E30 in cream. */
// (muted, a little faded — worn paint, not a toy's: 2026-11-10, the user: "too cartoonish")
// (the kit's cars: each its own colour — catalogue `stock.paint`)
const OTH_PAINT: Record<string, string> = { g500: '#b8452e', e30: '#efe4cc' }

const VERT = /* glsl */ `
in float paintMask;
#ifdef DAMAGE
in float dmg;
out float vDmg;
#endif
out vec3 vWorld;
out vec3 vLocal;
out vec3 vN;
out vec2 vUv;
out vec3 vCol;
out float vPaint;
void main() {
  mat4 M = modelMatrix;
#ifdef USE_INSTANCING
  M = modelMatrix * instanceMatrix; // (the four wheels: one draw)
#endif
  vec4 w = M * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vN = normalize(mat3(M) * normal);
  vUv = uv;
#ifdef USE_COLOR
  vCol = color;
#else
  vCol = vec3(1.0);
#endif
  vPaint = paintMask;
#ifdef DAMAGE
  vDmg = dmg;
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

/** The car's surface shader (the bike uses it too — Bike.ts): this world's light, the paint, the sand coat. */
export const VEHICLE_FRAG_SRC = () => FRAG
const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
uniform sampler2D uMap;
uniform sampler2D uPaintMask;
#ifdef USE_NORMALMAP_OTH
uniform sampler2D uNormalMap;
#endif
uniform vec3 uPaint;
uniform float uCoat;
uniform vec3 uCoatColor;
uniform float uCarBase;
#ifdef DAMAGE
// (Damage.ts) per vertex: 1 on a cracked pane of glass (the body's is not read). uChar: a burnt-out car's soot;
// uCrack: the cracks' pattern (scripts/oth/damage.py)
in float vDmg;
uniform float uChar;
uniform sampler2D uCrack;
#endif
in vec3 vWorld;
in vec3 vLocal;
in vec3 vN;
in vec2 vUv;
in vec3 vCol;
in float vPaint;
#ifndef NO_GRAIN
// the grain's height (0 … ~1) at p (the vehicle's space, m): GRAINS — a small dome round each of the cellular noise's
// points (the texture's A: the distance to the nearest, in cells; 16 cells a tile) — at TWO SIZES by the distance, both
// fixed on the surface: up close SAND (9.6 tiles a metre: a grain every ~6.5 mm, ~4.5 mm across — the user: "so small,
// like sand grains"; share t1), further off the coarser DOTS (3.2 / m: every ~2 cm, ~1 cm across; share t2 — sand
// grains are under a pixel past ~2 m, and the top of the car showed none); over a faint orange peel (×4.5 / m); along
// each axis the face takes (w); one written out per axis (no loop — docs/MIGRATION.md)
float vehGrain1(vec2 uv, float wi, float o, float t1, float t2) {
  if (wi < 0.03) return 0.0;
  float d1 = texture(uNoise, uv * 9.6 + o).a / 0.36, d2 = texture(uNoise, uv * 3.2 + o + 0.53).a / 0.28;
  return wi * (t1 * sqrt(max(0.0, 1.0 - d1 * d1)) + t2 * sqrt(max(0.0, 1.0 - d2 * d2)) + 0.2 * texture(uNoise, uv * 4.5 + o * 0.7 + 0.17).g);
}
float vehGrainH(vec3 p, vec3 w, float t1, float t2) { return vehGrain1(p.yz, w.x, 0.0, t1, t2) + vehGrain1(p.xz, w.y, 0.41, t1, t2) + vehGrain1(p.xy, w.z, 0.83, t1, t2); }
#endif
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
#ifdef USE_NORMALMAP_OTH
  // THE NORMAL MAP (the character's: his muscles, the cloth's weave — scripts/oth/hero.py; OpenGL's +y), its tangent
  // frame from the screen-space derivatives (no tangents in the mesh). (Checked lit at noon, 2026-11-09: y as stored —
  // negated, his face was lit from below.)
  {
    vec3 nm = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
    vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
    vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
    vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
    vec3 T = dp2p * du1.x + dp1p * du2.x, B = dp2p * du1.y + dp1p * du2.y;
    float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-24));
    N = normalize(T * (im * nm.x) + B * (im * nm.y) + N * nm.z);
  }
#endif
  vec3 V = normalize(uCamPos - vWorld);
  // (in the cave world: its dark — no sun under the hill, the light dimmed: Sites.caveUniforms)
  float ck = caveK(vWorld);
  float sun = sunVisibility(vWorld.xz) * (1.0 - ck);
#ifdef GLASS
#ifndef GLASS_A
#define GLASS_A 0.42
#endif
  // WINDOWS: lightly tinted glass — the cabin shows through, the sky reflects in it by Fresnel, the sun glints
  float F = 0.08 + 0.88 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  vec3 sky = skyColor(normalize(vec3(R.x, abs(R.y) + 0.05, R.z)));
  vec3 c = mix(vec3(0.05, 0.065, 0.075) * (ambient(N) + uSunColor * 0.25), sky * 0.85, F);
  c += uSunColor * sun * pow(max(dot(R, uSunDir), 0.0), 220.0) * 2.5;
  float ga = mix(gl_FrontFacing ? GLASS_A : 0.42, 0.95, F); // (a darker tint — GLASS_A — from OUTSIDE only: looking out through it, the pane's back, the view stays clear)
#ifdef DAMAGE
  if (vDmg > 0.5) {
    // A CRACKED PANE: the cracks' white lines over it — laid along the pane's own face —, the glass a little milky
    vec3 nl = abs(normalize(cross(dFdx(vLocal), dFdy(vLocal)) + 1e-7));
    vec2 cuv = nl.x > max(nl.y, nl.z) ? vLocal.zy : nl.z > nl.y ? vLocal.xy : vLocal.xz;
    float cr = texture(uCrack, cuv * 1.15 + 0.37).r;
    vec3 lit = ambient(N) + uSunColor * sun * 0.9;
    c = mix(mix(c, vec3(0.55, 0.6, 0.6) * lit, 0.12), vec3(0.86, 0.9, 0.89) * lit, cr * 0.9);
    ga = max(ga + 0.08, cr * 0.95);
  }
#endif
  gl_FragColor = vec4(applyAtmos(c, vWorld), ga);
#else
  vec3 albedo = vCol;
#ifdef USE_MAP_OTH
#ifdef FLAT_MAP
  // (Pieces.ts FLAT: a tiling scan read far down its mips — its mean colour, a broad soft tone left: flat paint, no photo grain)
  vec4 tex = texture(uMap, vUv, 7.0);
#else
  vec4 tex = texture(uMap, vUv);
#endif
#ifdef ALPHA_CUT
  if (tex.a < 0.5) discard;
#endif
  albedo *= tex.rgb;
#endif
  // the paint takes the panel's hue, keeps its shading; white = the model's own colours
  // (2 in the slot: a bike's unpainted BODYWORK — its plastics, its frame: the grain's dots, not the tint)
  float body = step(1.5, vPaint);
  float m = vPaint - 2.0 * body;
#ifdef USE_PAINTMAP
  m *= texture(uPaintMask, vUv).r;
#endif
  float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
  float isWhite = step(2.95, uPaint.r + uPaint.g + uPaint.b);
  albedo = mix(albedo, uPaint * (lum * 1.3 + 0.08), m * (1.0 - isWhite));
#ifdef DAMAGE
  // A BURNT-OUT car (Damage.ts) is soot all over. A DENT is the car's own colour — the light falls on it another way,
  // nothing more (the first cut scraped the paint to steel there; the user, 2026-11-21: "the crashed and broken thing
  // will have the same colour, the dent and all")
  if (uChar > 0.001) {
    float st = texture(uNoise, vec2(dot(vLocal, vec3(0.5, 0.12, 0.33)), dot(vLocal, vec3(0.2, 2.4, 0.6)))).g;
    float bl = texture(uNoise, vLocal.xz * 0.31 + vLocal.y * 0.23).r;
    albedo = mix(albedo, vec3(0.035, 0.032, 0.03) * (0.5 + bl), uChar * (0.82 + 0.18 * st));
    m *= 1.0 - uChar;
  }
#endif
#ifndef NO_GRAIN
  // GRAIN — RELIEF, not colour (2026-11-05, the user — after Over the Hill's cars: "ours are shiny, glossy"; then: "by
  // grains I mean the 3D grains, not the colour"; "tiny 3D dots — on red, small red dots; the dots take the colour of
  // what they're on"): tiny raised DOTS (vehGrainH) the light picks out — a lit top, a shaded foot — the colour the
  // panel's own, whatever it is. A height field in the vehicle's OWN space (fixed to it; projected along the face's own
  // axis — its normal there from the position's derivatives — so it never stretches, whichever way the vehicle turns),
  // sampled here and one pixel right and up: the slope, by Mikkelsen's surface gradient, bends the normal. It fades as
  // the dots shrink to a pixel (no shimmer) and is skipped beyond (~15 m at 1080p)
  float grainCav = 1.0, grainTop = 0.0;
  {
    vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld), dlx = dFdx(vLocal), dly = dFdy(vLocal);
    // (the pixel's footprint: the mean of its two sides — at a glance across the roof or the bonnet its long side
    //  stretches far, and the longest faded the grains off the whole top of the car)
    float px = sqrt(length(dpx) * length(dpy));
    float showT = 1.0 - smoothstep(0.0025, 0.006, px), showD = smoothstep(0.0025, 0.005, px) * (1.0 - smoothstep(0.014, 0.035, px));
    float showM = max(showT, showD);
    // (on the PAINTED BODY only — the panels, the bonnet, the roof, a bike's frame / plastics: the paint mask; the
    //  tyres, the trim, the chrome, the cabin smooth — the user: "the dots are on the body and the bonnet, not the tyres")
#ifdef WHEEL
    float gm = 0.0; // (never the wheels)
#else
    float gm = max(m, body);
#endif
    if (showM * gm > 0.01) {
      vec3 nl = abs(normalize(cross(dlx, dly) + 1e-7));
      vec3 tw = pow(nl, vec3(6.0));
      tw /= tw.x + tw.y + tw.z;
      float h0 = vehGrainH(vLocal, tw, showT, showD), hx = vehGrainH(vLocal + dlx, tw, showT, showD), hy = vehGrainH(vLocal + dly, tw, showT, showD);
      // (a sand grain ~1 mm high, a dot ~3 mm)
      vec2 dB = vec2(hx - h0, hy - h0) * (mix(0.0011, 0.003, showD / max(showT + showD, 1e-3)) * gm);
      vec3 R1 = cross(dpy, N), R2 = cross(N, dpx);
      float det = dot(dpx, R1);
      N = normalize(abs(det) * N - sign(det) * (dB.x * R1 + dB.y * R2));
      // (and the shade in the gaps between the grains — their occlusion: a face square to the sun — the bonnet, the
      //  roof under a high sun — hardly changes its light with a small tilt (the cosine is flat there), so the slope
      //  alone left the top of the car smooth; the gaps' shade shows them on every face, lit or not)
      grainCav = 1.0 - 0.16 * (1.0 - smoothstep(0.05, 0.55, h0)) * showM * gm;
      // (and the grains' tops catch a little of the sky and the sun whatever the colour under them: on black — the
      //  roof, the trim, an engine — the shade alone shows nothing; there they read as faint grey grains)
      grainTop = smoothstep(0.35, 0.85, h0) * showM * gm;
    }
  }
  albedo *= grainCav;
#endif
  // MATTE (the same: a powder-coat's paint, not a car's lacquer): rough everywhere — the shared lobe broad and faint
  float rough = 0.92;
  // THE SAND COAT (Vehicle.weather): thickest low down and on what faces up, in blotches (fixed to the car)
  float coatK = 0.0;
  if (uCoat > 0.002) {
    float blot = texture(uNoise, (vLocal.xz + vLocal.y * 0.7) * 0.45).r;
    float k = uCoat * (0.12 + 0.88 * (1.0 - smoothstep(0.3, 1.5, vWorld.y - uCarBase)) + 0.3 * max(N.y, 0.0));
    k = clamp(k * smoothstep(0.35, 0.8, blot + k * 0.4), 0.0, 0.8);
    albedo = mix(albedo, uCoatColor, k);
    rough = mix(rough, 0.95, k);
    coatK = k;
  }
  // (the paint's light wraps further round — a softer terminator, the stylised look; the rest as before)
  vec3 c = shade(albedo, N, V, rough, 0.02, 1.0, sun, mix(0.25, 0.55, m));
#ifndef WHEEL
  // THE PAINT: MATTE (2026-11-05 — no clear coat: no glint, no sky mirrored in it; was a satin lobe + a Schlick glint +
  // the sky at a glance): a very broad, faint sheen where the sun is, in the paint's own colour, and the soft glow of
  // the sky's light over it (their cars are bright and soft). Dust dulls it
  float paintK = m * (1.0 - coatK / 0.8);
  if (paintK > 0.01) {
    vec3 H = normalize(uSunDir + V);
    float NoH = max(dot(N, H), 0.0), NoL = max(dot(N, uSunDir), 0.0);
    vec3 sheen = uSunColor * sun * ggx(NoH, 0.9) * NoL * albedo * 0.35;
    vec3 glow = albedo * ambient(N) * 0.45;
    c += (sheen + glow) * paintK;
  }
#endif
#ifndef NO_GRAIN
  c += grainTop * 0.026 * (ambient(N) + uSunColor * sun * 0.6);
#endif
  // a little painted rim light so the car reads against the field (soft: a matte surface's)
  c += albedo * uSunColor * pow(1.0 - max(dot(N, V), 0.0), 3.0) * (0.08 + 0.06 * m) * sun;
  c *= 1.0 - 0.75 * ck;
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** A lamp's GLOW: a camera-side quad, a bright core (the lens) and a soft painted halo round it, added above white
 *  (the bloom spreads it). uK: brightness (0 = off). */
function glowMaterial(color: GFX.Color): GFX.ShaderMaterial {
  return new GFX.ShaderMaterial({
    uniforms: { uColor: { value: color }, uK: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uK;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.26, 0.34, d), halo = pow(max(1.0 - d, 0.0), 2.2) * 0.32;
        gl_FragColor = vec4(uColor * uK * (core + halo), 1.0);
      }`,
    blending: GFX.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
}

/** The headlights' BEAMS in the air: an open cone from each lamp (wide, low, 12 m), car space. Its `t` attribute: 0 at
 *  the lamp … 1 at the far rim. */
function beamGeometry(x: number, y: number, z: number): GFX.BufferGeometry {
  const pos: number[] = [], tt: number[] = [], idx: number[] = []
  const S = 14, R = 12, Lb = 12
  for (const sx of [-1, 1]) {
    const base = pos.length / 3
    for (let i = 0; i <= R; i++) {
      const f = i / R
      for (let k = 0; k < S; k++) {
        const a = (k / S) * Math.PI * 2, along = f * Lb
        pos.push(x * sx + Math.cos(a) * along * 0.4, y - along * 0.07 + Math.sin(a) * along * 0.17, z - along)
        tt.push(f)
      }
    }
    for (let i = 0; i < R; i++) for (let k = 0; k < S; k++) {
      const a0 = base + i * S + k, a1 = base + i * S + ((k + 1) % S), b0 = a0 + S, b1 = a1 + S
      idx.push(a0, b0, a1, a1, b0, b1)
    }
  }
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
  g.setAttribute('t', new GFX.Float32BufferAttribute(tt, 1))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** The beams' look: warm light painted in the air — strongest by the lamp, gone by 12 m, soft at the cone's silhouette
 *  (faces seen edge-on fade), only at night (uK = the night). */
function beamMaterial(): GFX.ShaderMaterial {
  return new GFX.ShaderMaterial({
    uniforms: { uK: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float t;
      varying float vT;
      varying float vFace;
      void main() {
        vT = t;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uK;
      varying float vT;
      varying float vFace;
      void main() {
        // (max: vT interpolates a hair past 1 at the rim — pow() of a negative is NaN, a dashed white ring in the bloom)
        float a = pow(max(1.0 - vT, 0.0), 2.0) * smoothstep(0.0, 0.08, vT) * smoothstep(0.1, 0.7, vFace);
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a * 0.035 * uK, 1.0);
      }`,
    blending: GFX.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    side: GFX.DoubleSide,
  })
}

/** WHAT IS SOLID OF A CAR NOT OURS (the enemy's — Companion.ts —, another player's — Remotes.ts): ITS OWN SHAPE, not the
 *  box round everything on it (its mirrors, its bars, its spare wheel: an invisible layer a hand or two off its panels —
 *  the user, 2026-11-21: "the collision must hit the car, not an invisible outer layer"). The exact body as a triangle
 *  mesh — our car's inner hulls, a walker, a bullet meet it — and its own inner solid, which our car's exact mesh meets
 *  (two triangle meshes do not meet each other): the inner pieces, a few dozen of a hand's size, joined into SECTIONS
 *  along the car, 0.6 m each, each wrapped (our car's mesh is a thin shell: coming at it, it slipped between small
 *  pieces, a quarter of a metre in, measured; a few big solid ones stop it). Metal on metal either way. */
export function carSolid(R: typeof RAPIER, shape: { mesh: Float32Array; hulls: Float32Array[]; front: number; rear: number }, friction = 0.6): RAPIER.ColliderDesc[] {
  const out: RAPIER.ColliderDesc[] = []
  const idx = new Uint32Array(shape.mesh.length / 3)
  for (let i = 0; i < idx.length; i++) idx[i] = i
  out.push(R.ColliderDesc.trimesh(shape.mesh, idx).setCollisionGroups(group(Groups.Static | Groups.StaticMesh, STATIC_MESH_FILTER)).setFriction(friction))
  const all: number[] = []
  for (const h of shape.hulls) for (let i = 0; i < h.length; i++) all.push(h[i])
  const L = 0.6, nSec = Math.max(1, Math.ceil((shape.rear - shape.front) / L))
  for (let k = 0; k < nSec; k++) {
    const z0 = shape.front + k * L - 0.04, z1 = shape.front + (k + 1) * L + 0.04, pts: number[] = []
    for (let i = 0; i < all.length; i += 3) if (all[i + 2] >= z0 && all[i + 2] <= z1) pts.push(all[i], all[i + 1], all[i + 2])
    const d = pts.length >= 12 ? R.ColliderDesc.convexHull(new Float32Array(pts)) : null
    if (d) out.push(d.setCollisionGroups(group(Groups.Static, Groups.VehicleMesh)).setFriction(friction))
  }
  return out
}

/** THE START: the map's first track where it passes nearest the spawn, along it (the desert's is its pass road — which
 *  runs on out over the crossing's gate line: not from its end). Where a new game puts the car. */
function startOf(map: MapData): { x: number; z: number; heading: number } {
  const L = map.meta.trails.lines[0], sp = map.meta.spawn
  let k = 0
  for (let i = 1; i + 4 < L.length; i++) if ((L[i][0] - sp.x) ** 2 + (L[i][1] - sp.z) ** 2 < (L[k][0] - sp.x) ** 2 + (L[k][1] - sp.z) ** 2) k = i
  const [x, z] = L[k], [x2, z2] = L[k + 4]
  return { x, z, heading: Math.atan2(-(x2 - x), -(z2 - z)) }
}

/**
 * (co-op) ANOTHER PLAYER'S CAR — the same model and the same paint shader as ours (this file's VERT / FRAG), posed from
 * the network (net/Session's smoothing — Remotes.ts); no physics, no keys. Their paint is their colour. The wheels roll
 * by the distance it moves and steer by how fast it turns; its contact shadow and, at night, its lamps' glow. Three
 * draws (body, glass, the wheels instanced) + the shadow, culled with its sphere and the hills.
 */
export class RemoteCar {
  readonly root = new GFX.Group()
  readonly shadow: GFX.Mesh
  id = ''
  private readonly uniforms: Record<string, GFX.IUniform>
  private wheelMesh: GFX.InstancedMesh | null = null
  private model: TruckModel | null = null
  private readonly wheel = new GFX.Object3D()
  private readonly e = new GFX.Euler()
  private readonly shadowBase: Float32Array
  private readonly shadowSize = new GFX.Vector3(2, 1, 4.5)
  private spin = 0
  private steer = 0
  private lastYaw = NaN
  private lamps: GFX.InstancedMesh | null = null
  private readonly lampMat = glowMaterial(new GFX.Color(1, 0.9, 0.72))
  private readonly viewSphere = new GFX.Sphere(new GFX.Vector3(), 6)
  private readonly v = new GFX.Vector3()
  /** The body's box in car space (centre, half size) — null until its model is in. */
  box: { c: GFX.Vector3; h: GFX.Vector3 } | null = null
  /** DAMAGE (Damage.ts): set `damageOn` before its car is given — the companion's car takes blows; another player's
   *  (co-op) takes the blows their own game tells of (the `dent` event — Remotes.dent). */
  damageOn = false
  damage: CarDamage | null = null
  private readonly charU = { value: 0 }
  private lampRev = -1
  private lampR = 0.3
  private readonly lampAt = [0, 0, 0]
  /** Its wheel's mesh (a torn-off one rolls away — DamageFx), its paint. */
  get wheelPart(): { geo: GFX.BufferGeometry; mat: GFX.Material; r: number } | null { return this.wheelMesh && this.model ? { geo: this.model.wheel, mat: this.wheelMesh.material as GFX.Material, r: this.model.wheelRadius } : null }
  get paintColor(): GFX.Color { return this.uniforms.uPaint.value as GFX.Color }
  /** ITS OWN SHAPE for the physics (the companion's car — Companion.ts): the body as a triangle soup, its inner
   *  convex pieces, its nose and tail (z, car space); null until its model is in. */
  get shape(): { mesh: Float32Array; hulls: Float32Array[]; front: number; rear: number } | null {
    const m = this.model
    return m ? { mesh: m.mesh, hulls: m.hulls, front: m.front, rear: m.rear } : null
  }
  /** Its half width and half length (m). */
  get half(): { x: number; z: number } { return this.model ? { x: this.model.half.x, z: this.model.half.z } : { x: 1, z: 2.2 } }
  /** (the companion — Companion.ts) the driver's seat (where the hips sit) and the spot outside the driver's door, car
   *  space — as Vehicle.driverDoor; null until the model is in. */
  get driverSeat(): { hips: GFX.Vector3; door: GFX.Vector3 } | null {
    const d = this.model ? driverDoor(this.model) : null
    if (!d) return null
    const [hx, hy, hz] = d.hinge
    return { hips: new GFX.Vector3(hx + 0.42, hy + d.bottom + 0.42, hz + d.length * 0.62), door: new GFX.Vector3(hx - 0.5, hy, hz + d.length * 0.5) }
  }

  constructor(private readonly map: MapData, private readonly atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4) {
    this.uniforms = { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, uMap: { value: null }, uPaintMask: { value: null }, uPaint: { value: new GFX.Color(1, 1, 1) }, uSunHere: { value: 1 },
      uCoat: { value: 0 }, uCoatColor: { value: new GFX.Color(0.55, 0.45, 0.33) }, uCarBase: { value: 0 }, uChar: this.charU, uCrack: crackU }
    const sg = new GFX.PlaneGeometry(1, 1, 8, 8).rotateX(-Math.PI / 2)
    this.shadow = new GFX.Mesh(sg, new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { uMist: atmos.uniforms.uMist },
      vertexShader: /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `layout(location = 0) out highp vec4 outColor; in vec2 vUv; uniform float uMist;
        void main() { vec2 q = (vUv - 0.5) * 2.0; float d = length(q); outColor = vec4(0.06, 0.04, 0.05, 0.5 * (1.0 - smoothstep(0.35, 1.0, d)) * (1.0 - 0.75 * uMist * uMist)); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }))
    this.shadow.frustumCulled = false
    this.shadow.renderOrder = 2
    this.shadowBase = (sg.attributes.position.array as Float32Array).slice()
    this.root.visible = this.shadow.visible = false
  }

  /** Car `id` (the catalogue's: offroader; a shelved one's: g500, e30) in `paint` — its model loaded once (loadModels caches it). */
  async setCar(id: string, paint: string): Promise<void> {
    if (id === this.id) { (this.uniforms.uPaint.value as GFX.Color).set(paint); return }
    this.id = id
    const def = vehicleDef(id)
    const truck = await loadVehicle(def.id)
    if (this.id !== id) return
    this.model = truck
    for (const c of [...this.root.children]) this.root.remove(c)
    const u = this.uniforms
    u.uMap.value = truck.map
    u.uPaintMask.value = truck.paintMap
    ;(u.uPaint.value as GFX.Color).set(paint)
    // (a car's own look — catalogue `smooth` / `glassTint`: the off-roader's clean paint, no grain; its darker glass)
    const look = vehicleDef(truck.id)
    const defines: Record<string, string> = { OTH_SPEC: '', MIST_K: '0.45', ...(GRAIN_OFF || look.smooth ? { NO_GRAIN: '' } : {}) }
    const glassDef: Record<string, string> = look.glassTint ? { GLASS_A: look.glassTint.toFixed(2) } : {}
    if (truck.map) defines.USE_MAP_OTH = ''
    if (truck.paintMap) defines.USE_PAINTMAP = ''
    const vc = (g: GFX.BufferGeometry) => !!g.attributes.color
    const at = (geo: GFX.BufferGeometry, h: [number, number, number]) => geo.clone().translate(...h)
    const bodyGeo = mergeParts([truck.body, ...(truck.cabin ? [truck.cabin] : []), ...truck.doors.map((d) => at(d.body, d.hinge))])
    const glassGeo = mergeParts([truck.glass, ...truck.doors.flatMap((d) => (d.glass ? [at(d.glass, d.hinge)] : []))])
    const dm = (this.damage = this.damageOn ? new CarDamage(truck, this.charU) : null)
    const dmgDef: Record<string, string> = dm ? { DAMAGE: '' } : {}
    if (dm) { dm.attach(bodyGeo, false); dm.attach(glassGeo, true) }
    this.lampRev = -1
    const body = new GFX.Mesh(bodyGeo, new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines: { ...defines, ...dmgDef }, vertexShader: VERT, fragmentShader: FRAG, vertexColors: vc(bodyGeo) }))
    const glass = new GFX.Mesh(glassGeo, new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines: { OTH_SPEC: '', GLASS: '', MIST_K: '0.45', ...glassDef, ...dmgDef }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, vertexColors: vc(glassGeo), side: GFX.DoubleSide, depthWrite: false }))
    body.frustumCulled = glass.frustumCulled = false
    glass.renderOrder = 3
    this.wheelMesh = new GFX.InstancedMesh(truck.wheel, new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines: { ...defines, WHEEL: '' }, vertexShader: VERT, fragmentShader: FRAG, vertexColors: vc(truck.wheel) }), 4)
    this.wheelMesh.frustumCulled = false
    this.wheelMesh.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
    // (the headlamps' glow — at night)
    const head = truck.lamps.head, hz = truck.half
    const h = head ? head.c : [hz.x * 0.7, 0.9, -hz.z]
    this.lamps = new GFX.InstancedMesh(new GFX.PlaneGeometry(2, 2), this.lampMat, 2)
    this.lamps.frustumCulled = false
    this.lamps.renderOrder = 2
    this.lampR = (head ? Math.max(0.06, Math.min(head.w, head.h)) : 0.1) * 3
    this.lampAt[0] = Math.abs(h[0]); this.lampAt[1] = h[1]; this.lampAt[2] = h[2] - 0.03
    this.placeLamps()
    this.root.add(body, glass, this.wheelMesh, this.lamps)
    this.shadowSize.set(truck.half.x * 2 + 1.0, 1, truck.half.z * 2 + 1.2)
    this.viewSphere.radius = Math.hypot(truck.half.x, truck.half.z) + 1.5
    // (its solid box for the others' physics — Remotes.ts: the body's bounds, car space)
    bodyGeo.computeBoundingBox()
    const bb = bodyGeo.boundingBox!
    this.box = { c: bb.getCenter(new GFX.Vector3()), h: bb.getSize(new GFX.Vector3()).multiplyScalar(0.5) }
  }

  /** The headlamps' glows at their lenses (a broken one — Damage.ts — has no size). */
  private placeLamps(): void {
    if (!this.lamps) return
    const m = new GFX.Matrix4(), back = new GFX.Quaternion().setFromAxisAngle(new GFX.Vector3(0, 1, 0), Math.PI), L = this.lampAt
    for (let k = 0; k < 2; k++) {
      const hr = this.damage && this.damage.lamps[k] ? 0 : this.lampR
      m.compose(new GFX.Vector3(L[0] * (k ? 1 : -1), L[1], L[2]), back, new GFX.Vector3(hr, hr, 1))
      this.lamps.setMatrixAt(k, m)
    }
    this.lamps.instanceMatrix.needsUpdate = true
  }

  /** Posed at p, turned q (y up), moving at `speed` m/s; dt this frame. */
  pose(p: readonly number[], q: readonly number[], speed: number, dt: number): void {
    const tr = this.model
    this.root.position.set(p[0], p[1], p[2])
    this.root.quaternion.set(q[0], q[1], q[2], q[3])
    if (!tr || !this.wheelMesh) return
    // (which way it's going: forward is -z)
    this.v.set(0, 0, -1).applyQuaternion(this.root.quaternion)
    const yaw = Math.atan2(-this.v.x, -this.v.z)
    const turn = Number.isNaN(this.lastYaw) ? 0 : Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw))
    this.lastYaw = yaw
    const wb = Math.max(1.5, Math.abs(tr.wheelPos[0][2] - tr.wheelPos[2][2]))
    // (the front wheels' angle from the turn rate and the speed — the bicycle model: tan d = L w / v)
    const want = speed > 0.5 && dt > 0 ? Math.max(-0.6, Math.min(0.6, Math.atan((wb * (turn / dt)) / speed))) : this.steer * 0.9
    this.steer += (want - this.steer) * Math.min(1, dt * 6)
    const r = Math.max(0.25, tr.wheelPos[0][1])
    this.spin += (speed * dt) / r
    const dm = this.damage
    if (dm) {
      dm.update(Math.min(0.1, dt))
      if (dm.sim.rev !== this.lampRev) { this.lampRev = dm.sim.rev; this.placeLamps() }
    }
    tr.wheelPos.forEach(([x, y, z], k) => {
      const right = k === 1 || k === 3, front = k < 2
      // (damage: a bent axle's wheel leans and points out of line, a jammed one doesn't turn, a flat one sits on its
      //  rim, one torn off isn't there)
      const wd = dm ? dm.wheels[k] : null
      const spin = wd && (wd.jam || wd.off) ? 0 : this.spin
      this.e.set(right ? spin : -spin, (right ? Math.PI : 0) - (front ? this.steer : 0) - (dm ? dm.sim.toe[k] : 0), wd ? -wd.bend : 0, 'YZX')
      this.wheel.position.set(x, y - (wd && wd.flat ? r * 0.18 : 0), z)
      this.wheel.quaternion.setFromEuler(this.e)
      this.wheel.scale.setScalar(wd && wd.off ? 1e-5 : 1)
      this.wheel.updateMatrix()
      this.wheelMesh!.setMatrixAt(k, this.wheel.matrix)
    })
    this.wheelMesh.instanceMatrix.needsUpdate = true
    this.uniforms.uCarBase.value = this.map.height(p[0], p[2])
    const night = this.atmos.uniforms.uNight.value
    if (this.lamps) { this.lamps.visible = night > 0.25; this.lampMat.uniforms.uK.value = 5.5 }
    // the contact shadow, laid on the ground under it (only while it's seen — last frame's cull)
    if (!this.root.visible) return
    const sp = this.shadow.geometry.attributes.position as GFX.BufferAttribute
    const a = sp.array as Float32Array, base = this.shadowBase, cs = Math.cos(yaw), sn = Math.sin(yaw)
    for (let i = 0; i < sp.count; i++) {
      const lx = base[i * 3] * this.shadowSize.x, lz = base[i * 3 + 2] * this.shadowSize.z
      const x = p[0] + lx * cs + lz * sn, z = p[2] - lx * sn + lz * cs
      a[i * 3] = x; a[i * 3 + 1] = this.map.height(x, z) + 0.04; a[i * 3 + 2] = z
    }
    sp.needsUpdate = true
  }

  /** Drawn only in view and not behind the hills (as ours). */
  cull(view: GFX.Frustum, horizon: Horizon, on: boolean): void {
    const p = this.root.position
    this.viewSphere.center.copy(p)
    this.root.visible = on && !!this.model && view.intersectsSphere(this.viewSphere) && !horizon.hidden(p.x - 6, p.z - 6, p.x + 6, p.z + 6, p.y + 3)
    this.shadow.visible = this.root.visible && p.y - this.map.height(p.x, p.z) < 3
  }

  dispose(): void {
    this.root.removeFromParent()
    this.shadow.removeFromParent()
    this.shadow.geometry.dispose()
  }
}
