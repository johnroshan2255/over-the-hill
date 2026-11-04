import * as GFX from './gfx'
const { mergeGeometries } = GFX
import { loadVehicle, type TruckModel } from '../assets/loadModels'
import { VEHICLES, vehicleDef } from '../gameplay/vehicle/catalogue'
import { resolveSpec } from '../gameplay/vehicle/drivetrain/spec'
import { blendRoughness, Surf, type SurfaceMix } from '../gameplay/vehicle/drivetrain/tyre'
import { TruckSim } from '../gameplay/vehicle/VehicleSim'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { Tier } from './quality'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'

/**
 * THE 4×4 — the game's vehicles on this map: the same models (assets/loadModels `loadVehicle`) and the same physics
 * (gameplay/vehicle TruckSim + the realistic drivetrain from each car's spec sheet, Simulation handling with full
 * aids and the off-road assist), drawn here with this world's light (ATMOS_GLSL `shade`, the terrain's baked sun
 * shadow) and a soft contact shadow on the ground. The tyres feel this map's surfaces: dirt on the tracks, grass on
 * the meadows, sand/gravel at the water, rock on rock.
 *
 * Controls — keys: W / S gas, brake → reverse, A / D steer, Space handbrake, Shift boost, R back on the wheels, 1 / 2 /
 * 3 the car. Touch: ◀ ▶ steer, GAS / BRAKE, ⟲. Mouse / finger drag on the view orbits the chase camera.
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
      uCoat: this.coatU, uCoatColor: { value: this.coatColor }, uCarBase: this.baseU }
    void tier
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
      if (e.code === 'KeyR') this.reset()
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
    } else {
      // the start: the map's first track where it passes nearest the spawn, along it (the desert's is its pass road —
      // which runs on out over the crossing's gate line: not from its end)
      const L = this.map.meta.trails.lines[0], sp = this.map.meta.spawn
      let k = 0
      for (let i = 1; i + 4 < L.length; i++) if ((L[i][0] - sp.x) ** 2 + (L[i][1] - sp.z) ** 2 < (L[k][0] - sp.x) ** 2 + (L[k][1] - sp.z) ** 2) k = i
      const [x, z] = L[k], [x2, z2] = L[k + 4]
      at = { x, z, heading: Math.atan2(-(x2 - x), -(z2 - z)) }
    }
    this.id = def.id
    this.model = truck
    this.sim = new TruckSim(this.physics.pw, truck, { ...def.stock })
    this.sim.setDrivetrain(resolveSpec(def.spec, { wheelPos: truck.wheelPos, half: truck.half }), { ...def.stock })
    this.sim.offroadAssist = this.driving.offroadAssist
    const D = this.sim.drivetrain
    if (D) { D.aids = this.driving.aids === 'standard' ? 'std' : this.driving.aids; D.manual = this.driving.manual }
    this.sim.surface = (x, z, out) => this.surfaceAt(x, z, out)
    this.buildMeshes(truck, this.paint ?? OTH_PAINT[def.id] ?? def.stock.paint)
    this.physics.follow(at.x, at.z)
    this.sim.place(at.x, this.map.height(at.x, at.z) + 0.6, at.z, at.heading)
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
    this.physics.follow(t.x, t.z)
    this.sim.place(t.x, this.map.height(t.x, t.z) + 0.8, t.z, this.sim.heading)
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
    const track = Math.max(0, Math.min(1, (this.map.meta.trails.hw + 0.3 - this.map.trailDist(x, z)) / 0.6))
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
    const defines: Record<string, string> = { OTH_SPEC: '', MIST_K: '0.45' }
    if (truck.map) defines.USE_MAP_OTH = ''
    if (truck.paintMap) defines.USE_PAINTMAP = ''
    const vc = (g: GFX.BufferGeometry) => !!g.attributes.color
    // THREE DRAWS for the whole car (2026-11-02: it was 11 — body, cabin, two door skins, four wheels, three glass
    // pieces): the body with the CABIN (dash, seats, console — seen through the windows) and the FRONT DOORS (cut out
    // of the body in the model, set at their hinges: they never open here) as one mesh, the windows as one, the four
    // wheels as one instanced mesh
    const atHinge = (geo: GFX.BufferGeometry, hinge: [number, number, number]) => geo.clone().translate(...hinge)
    const bodyGeo = mergeParts([truck.body, ...(truck.cabin ? [truck.cabin] : []), ...truck.doors.map((d) => atHinge(d.body, d.hinge))])
    const glassGeo = mergeParts([truck.glass, ...truck.doors.flatMap((d) => (d.glass ? [atHinge(d.glass, d.hinge)] : []))])
    const body = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines, vertexShader: VERT, fragmentShader: FRAG, vertexColors: vc(bodyGeo) })
    const glass = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: u, defines: { OTH_SPEC: '', GLASS: '', MIST_K: '0.45' }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, vertexColors: vc(glassGeo), side: GFX.DoubleSide })
    const b = new GFX.Mesh(bodyGeo, body)
    const g = new GFX.Mesh(glassGeo, glass)
    b.frustumCulled = g.frustumCulled = false
    g.renderOrder = 3 // (transparent: after the cabin behind it)
    this.root.add(b, g)
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
    const k = this.keys
    const t = this.sim.body.translation()
    this.physics.follow(t.x, t.z)
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
    c.throttle = this.pedal
    c.steer = this.steerK
    c.brake = down || this.touch.brake > 0
    c.handbrake = k.has('Space')
    c.boost = k.has('ShiftLeft') || k.has('ShiftRight')
    c.footBrake = 0
    c.lift = 0
    c.parked = false
    this.readPose(this.prevP, this.prevQ)
    this.sim.step(dt)
    this.sim.keepAbove(this.map.height(t.x, t.z))
    // FORDING (a river, a stream, a pond's edge): the water drags the car back by its depth (and holds it up a little
    // when it's deep) — a crossing is slow, a deep one a struggle
    const lvl = this.map.waterLevel(t.x, t.z)
    if (lvl !== null) {
      const depth = lvl - this.map.height(t.x, t.z)
      if (depth > 0.15) {
        const b = this.sim.body, v = b.linvel(), m = b.mass(), k = Math.min(1.2, depth) * 0.9
        b.applyImpulse({ x: -v.x * m * k * dt, y: m * 3 * Math.max(0, Math.min(1, depth - 0.6)) * dt, z: -v.z * m * k * dt }, true)
      }
    }
  }

  private readPose(p: GFX.Vector3, q: GFX.Quaternion): void {
    const t = this.sim.body.translation(), r = this.sim.body.rotation()
    p.set(t.x, t.y, t.z)
    q.set(r.x, r.y, r.z, r.w)
  }

  private readonly e = new GFX.Euler()
  /** Render frame: the interpolated pose, the wheels, the contact shadow. */
  update(alpha: number): void {
    if (!this.sim || this.loading) return
    this.readPose(this.curP, this.curQ)
    this.pos.lerpVectors(this.prevP, this.curP, alpha)
    this.root.position.copy(this.pos)
    this.root.quaternion.slerpQuaternions(this.prevQ, this.curQ, alpha)
    const w = this.sim.wheels, tr = this.model
    tr.wheelPos.forEach(([x, y, z], k) => {
      const right = k === 1 || k === 3
      const spin = -w[k].spin
      this.e.set(right ? -spin : spin, (right ? Math.PI : 0) - w[k].steer, 0, 'YXZ')
      const m = this.wheels[k]
      m.position.set(x, y + w[k].lift, z)
      m.quaternion.setFromEuler(this.e)
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
    const lvl = this.map.waterLevel(p.x, p.z)
    if (lvl !== null && lvl - ground > 0.2 && p.y < lvl + 0.6) { this.coat -= (dt / 3.5) * (0.3 + speed); return }
    const m = this.map.maskAt(p.x, p.z, this.mk), onGround = p.y - ground < 1.5
    const track = Math.max(0, Math.min(1, (this.map.meta.trails.hw + 0.3 - this.map.trailDist(p.x, p.z)) / 0.6))
    const desert = this.map.desert
    const sand = desert && onGround ? m[1] * (1 - Math.min(1, m[0] * 2)) * (1 - 0.6 * track) : 0
    const dirt = onGround ? track * (desert ? 0.5 : 0.35) * (1 - u.uWet.value) : 0
    const gain = (dt / 70) * speed * (sand + dirt) + (dt / 90) * u.uDust.value
    if (gain > 0) {
      this.coatTo.setRGB(desert ? 0.8 : 0.55, desert ? 0.6 : 0.45, desert ? 0.42 : 0.33)
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
    // (on by themselves at night and in a sandstorm)
    const on = this.lightMode === 'on' || (this.lightMode === 'auto' && (atmos.uniforms.uNight.value > 0.25 || atmos.uniforms.uDust.value > 0.45))
    const u = atmos.uniforms, head = this.model.lamps.head, tail = this.model.lamps.tail, hz = this.model.half, q = this.root.quaternion
    const h = head ? head.c : [hz.x * 0.7, 0.9, -hz.z], t = tail ? tail.c : [hz.x * 0.75, 0.9, hz.z]
    this.lampL.set(-Math.abs(h[0]), h[1], h[2] - 0.05).applyQuaternion(q).add(this.root.position)
    this.lampR.set(Math.abs(h[0]), h[1], h[2] - 0.05).applyQuaternion(q).add(this.root.position)
    u.uHeadL.value.set(this.lampL.x, this.lampL.y, this.lampL.z, on ? 1 : 0)
    u.uHeadR.value.copy(this.lampR)
    u.uHeadDir.value.set(0, 0, -1).applyQuaternion(q)
    u.uHeadUp.value.set(0, 1, 0).applyQuaternion(q)
    const c = this.sim.controls, braking = (c.brake && this.sim.speed > 0.4) || c.handbrake
    this.brakeK = braking ? Math.min(1, this.brakeK + dt / 0.06) : Math.max(0, this.brakeK - dt / 0.12)
    const tc = new GFX.Vector3(0, t[1], t[2] + 0.1).applyQuaternion(q).add(this.root.position)
    u.uTail.value.set(tc.x, tc.y, tc.z, this.brakeK)
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
      const m = new GFX.Matrix4(), back = new GFX.Quaternion().setFromAxisAngle(new GFX.Vector3(0, 1, 0), Math.PI)
      for (let k = 0; k < 2; k++) {
        const sx = k ? 1 : -1
        // (each glow 3× its lens: the lens a bright core, round it a soft halo)
        const hr = (head ? Math.max(0.06, Math.min(head.w, head.h)) : 0.1) * 3
        m.compose(new GFX.Vector3(Math.abs(h[0]) * sx, h[1], h[2] - 0.03), back, new GFX.Vector3(hr, hr, 1))
        this.lampMesh.setMatrixAt(k, m)
        const tr = (tail ? Math.max(0.05, Math.min(tail.w, tail.h)) : 0.08) * 3
        m.compose(new GFX.Vector3(Math.abs(t[0]) * sx, t[1], t[2] + 0.03), new GFX.Quaternion(), new GFX.Vector3(tr, tr, 1))
        this.tailMesh!.setMatrixAt(k, m)
      }
    }
    this.lampMesh.visible = on
    this.lampMat.uniforms.uK.value = 5.5
    const tailK = Math.max(on ? 0.3 : 0, this.brakeK)
    this.tailMesh!.visible = tailK > 0.01
    this.tailMat.uniforms.uK.value = 5.0 * tailK
    this.beams!.visible = on && u.uNight.value > 0.05
    this.beamMat.uniforms.uK.value = u.uNight.value
  }

  get speedKmh(): number { return this.sim ? Math.abs(this.sim.speed) * 3.6 : 0 }
  get gear(): string { return this.sim?.real?.gearLabel ?? '' }
}

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

/** Paint per car on this map: the G500 in rust red, the E30 in cream. */
const OTH_PAINT: Record<string, string> = { gwagen: '#b8452e', bmw: '#efe4cc' }

const VERT = /* glsl */ `
in float paintMask;
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
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
uniform sampler2D uMap;
uniform sampler2D uPaintMask;
uniform vec3 uPaint;
uniform float uCoat;
uniform vec3 uCoatColor;
uniform float uCarBase;
in vec3 vWorld;
in vec3 vLocal;
in vec3 vN;
in vec2 vUv;
in vec3 vCol;
in float vPaint;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorld);
  float sun = sunVisibility(vWorld.xz);
#ifdef GLASS
  // WINDOWS: lightly tinted glass — the cabin shows through, the sky reflects in it by Fresnel, the sun glints
  float F = 0.08 + 0.88 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  vec3 sky = skyColor(normalize(vec3(R.x, abs(R.y) + 0.05, R.z)));
  vec3 c = mix(vec3(0.05, 0.065, 0.075) * (ambient(N) + uSunColor * 0.25), sky * 0.85, F);
  c += uSunColor * sun * pow(max(dot(R, uSunDir), 0.0), 220.0) * 2.5;
  gl_FragColor = vec4(applyAtmos(c, vWorld), mix(0.42, 0.95, F));
#else
  vec3 albedo = vCol;
#ifdef USE_MAP_OTH
  albedo *= texture(uMap, vUv).rgb;
#endif
  // the paint takes the panel's hue, keeps its shading; white = the model's own colours
  float m = vPaint;
#ifdef USE_PAINTMAP
  m *= texture(uPaintMask, vUv).r;
#endif
  float lum = dot(albedo, vec3(0.3, 0.59, 0.11));
  float isWhite = step(2.95, uPaint.r + uPaint.g + uPaint.b);
  albedo = mix(albedo, uPaint * (lum * 1.3 + 0.08), m * (1.0 - isWhite));
#ifdef WHEEL
  float rough = 0.8;
#else
  // (the paint's highlights are its own, below: the shared lobe kept broad and faint under them)
  float rough = mix(0.75, 0.62, m);
#endif
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
  vec3 c = shade(albedo, N, V, rough, 0.05, 1.0, sun, mix(0.25, 0.55, m));
#ifndef WHEEL
  // THE PAINT: SATIN under a CLEAR COAT, its own light (2026-11-04 — a broad, gentle highlight that rolls across the
  // panels; the shared shade()'s lobe was faint, × 0.25): the SATIN a wide soft lobe off the rough paint, half the
  // paint's own colour; the CLEAR COAT a sharper glint (Schlick, f0 0.04) and the sky in it at a glance. Dust dulls both
  float paintK = m * (1.0 - coatK / 0.8);
  if (paintK > 0.01) {
    vec3 H = normalize(uSunDir + V);
    float NoH = max(dot(N, H), 0.0), NoL = max(dot(N, uSunDir), 0.0), NoV = max(dot(N, V), 0.0), VoH = max(dot(V, H), 0.0);
    vec3 satin = uSunColor * sun * ggx(NoH, 0.65) * NoL * mix(vec3(1.0), albedo * 2.2, 0.5) * 0.36;
    float Fc = 0.04 + 0.96 * pow(1.0 - VoH, 5.0);
    vec3 glint = uSunColor * sun * ggx(NoH, 0.2) * Fc * NoL * 0.25;
    vec3 R = reflect(-V, N);
    float Fv = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
    vec3 env = skyColor(normalize(vec3(R.x, abs(R.y) + 0.05, R.z))) * Fv * 0.16;
    // (2026-11-04 — the user: "like theirs, not so shiny, glowless": their cars are BRIGHT and SOFT — a gentle glow of
    //  the sky's light over the whole paint, lighter shade; a soft clear coat, never a mirror)
    vec3 glow = albedo * ambient(N) * 0.45;
    c += (satin + glint + env + glow) * paintK;
  }
#endif
  // a little painted rim light so the car reads against the field
  c += albedo * uSunColor * pow(1.0 - max(dot(N, V), 0.0), 3.0) * (0.12 + 0.12 * m) * sun;
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
