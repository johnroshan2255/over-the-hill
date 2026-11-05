import * as GFX from './gfx'
import { vehicleDef } from '../gameplay/vehicle/catalogue'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { Tier } from './quality'
import type { Vehicle } from './Vehicle'

/**
 * DUST AND SMOKE — the car's: soft painterly puffs kicked up behind the tyres (thick orange-brown off the dirt tracks,
 * a little off the grass, grey off rock, pale off the gravel at the water — more the faster the car goes and the more
 * a tyre slips) and exhaust SMOKE from the tailpipes (the catalogue's tips: a thin haze at idle, a grey puff when the
 * gas goes down). One instanced draw of camera-facing quads fed from a ring of particles (160 LOW … 360 ULTRA), each
 * lit as a soft ball by the sun and the sky (and glowing when the low sun is behind it), fogged like everything
 * else, alpha-blended, no depth writes.
 * Cost: CPU ≈ 0.02–0.05 ms (the ring's update, one height lookup per live puff, two small attribute uploads);
 * GPU: the overdraw of the live puffs (~40–150 soft quads while driving on a track).
 */
const K = 14 // floats per particle: x y z  vx vy vz  age life  size0 size1  r g b  alpha0

export class Dust {
  readonly mesh: GFX.Mesh
  private readonly n: number
  private readonly st: Float32Array
  private readonly aP: GFX.InstancedBufferAttribute // x y z size
  private readonly aC: GFX.InstancedBufferAttribute // r g b alpha
  private next = 0
  private readonly acc = [0, 0, 0, 0, 0, 0, 0] // emission carried over per wheel + the exhaust (4) + the bike's two tyres (5, 6)
  private readonly mk: [number, number, number, number] = [0, 0, 0, 0]
  private readonly v = new GFX.Vector3()
  private readonly d = new GFX.Vector3()
  private carId = ''
  private tips: { at: GFX.Vector3; dir: GFX.Vector3 }[] = []
  private seed = 0x2545f491
  private live = 0
  /** Round the live puffs (each its size out): the view's and the hills' test (`cull`). */
  private readonly box = new GFX.Box3()

  constructor(private readonly map: MapData, atmos: Atmosphere, tier: Tier) {
    this.n = tier.name === 'low' ? 160 : tier.name === 'medium' ? 220 : tier.name === 'high' ? 290 : 360
    this.st = new Float32Array(this.n * K)
    const quad = new GFX.PlaneGeometry(1, 1)
    const g = new GFX.InstancedBufferGeometry()
    g.index = quad.index
    g.setAttribute('position', quad.attributes.position)
    this.aP = new GFX.InstancedBufferAttribute(new Float32Array(this.n * 4), 4).setUsage(GFX.DynamicDrawUsage)
    this.aC = new GFX.InstancedBufferAttribute(new Float32Array(this.n * 4), 4).setUsage(GFX.DynamicDrawUsage)
    g.setAttribute('aP', this.aP)
    g.setAttribute('aC', this.aC)
    g.instanceCount = this.n
    const mat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...atmos.uniforms },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    })
    this.mesh = new GFX.Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6 // (after the water)
  }

  /** Live puffs (the HUD). */
  get count(): number { return this.live }

  private rnd(): number {
    let s = this.seed
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0
    this.seed = s
    return s / 4294967296
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number): void {
    const o = this.next * K, st = this.st
    this.next = (this.next + 1) % this.n // (the ring: the oldest puff gives way)
    st[o] = x; st[o + 1] = y; st[o + 2] = z
    st[o + 3] = vx; st[o + 4] = vy; st[o + 5] = vz
    st[o + 6] = 0; st[o + 7] = life
    st[o + 8] = s0; st[o + 9] = s1
    st[o + 10] = r; st[o + 11] = g; st[o + 12] = b; st[o + 13] = a
  }

  /** One frame: the car's tyres and tailpipes emit, every puff drifts, grows and fades. */
  update(dt: number, car: Vehicle): void {
    if (dt <= 0) return
    if (car.sim && car.model && !car.parked) this.emit(dt, car)
    const st = this.st, P = this.aP.array as Float32Array, C = this.aC.array as Float32Array
    const drag = Math.exp(-dt * 1.6)
    let live = 0
    const box = this.box.makeEmpty()
    for (let i = 0; i < this.n; i++) {
      const o = i * K, life = st[o + 7]
      if (life <= 0) { P[i * 4 + 3] = 0; continue }
      const age = st[o + 6] + dt
      if (age >= life) { st[o + 7] = 0; P[i * 4 + 3] = 0; continue }
      live++
      st[o + 6] = age
      // air drag, and a slow rise (warm air; the dust settles less than it rises in the painterly look)
      st[o + 3] *= drag; st[o + 5] *= drag
      st[o + 4] = st[o + 4] * drag + dt * 0.22
      st[o] += st[o + 3] * dt; st[o + 1] += st[o + 4] * dt; st[o + 2] += st[o + 5] * dt
      const t = age / life, size = st[o + 8] + (st[o + 9] - st[o + 8]) * (1 - (1 - t) * (1 - t))
      // (never into the ground: the puff's middle stays a third of its size above it)
      const deck = this.map.bridgeAt(st[o], st[o + 2])
      const floor = Math.max(this.map.height(st[o], st[o + 2]), deck ?? -1e9) + size * 0.3
      if (st[o + 1] < floor) { st[o + 1] = floor; st[o + 4] = Math.max(0, st[o + 4]) }
      P[i * 4] = st[o]; P[i * 4 + 1] = st[o + 1]; P[i * 4 + 2] = st[o + 2]; P[i * 4 + 3] = size
      box.min.set(Math.min(box.min.x, st[o] - size), Math.min(box.min.y, st[o + 1] - size), Math.min(box.min.z, st[o + 2] - size))
      box.max.set(Math.max(box.max.x, st[o] + size), Math.max(box.max.y, st[o + 1] + size), Math.max(box.max.z, st[o + 2] + size))
      C[i * 4] = st[o + 10]; C[i * 4 + 1] = st[o + 11]; C[i * 4 + 2] = st[o + 12]
      C[i * 4 + 3] = st[o + 13] * Math.min(1, t * 8) * Math.pow(1 - t, 1.6) // (a quick swell, a long fade)
    }
    this.live = live
  }

  /** Every puff moved by (dx, dy, dz) — the crossing moves the car into another world, its dust goes with it. */
  shift(dx: number, dy: number, dz: number): void {
    const st = this.st
    for (let i = 0; i < this.n; i++) { const o = i * K; st[o] += dx; st[o + 1] += dy; st[o + 2] += dz }
  }

  /** Draw (and upload) the puffs only when some are alive, in view and not behind the hills (2026-11-02: the whole
   *  pool was drawn and uploaded every frame — the idling car's exhaust off-screen, or nothing at all). */
  cull(view: GFX.Frustum, horizon: Horizon): void {
    this.mesh.visible = this.live > 0 && view.intersectsBox(this.box) && !horizon.hiddenBox(this.box)
    if (this.mesh.visible) { this.aP.needsUpdate = true; this.aC.needsUpdate = true }
  }

  /** How wet the land is (main.ts): the rain lays the dust. */
  wet = 0

  private emit(dt: number, car: Vehicle): void {
    const sim = car.sim, model = car.model, q = car.root.quaternion, p = car.root.position
    if (car.id !== this.carId) {
      this.carId = car.id
      const def = vehicleDef(car.id)
      const tips = def.exhaust?.length ? def.exhaust : [{ at: [-0.42, 0.3, model.half.z * 0.96] as [number, number, number], dir: [0, 0, 1] as [number, number, number] }]
      this.tips = tips.map((e) => ({ at: new GFX.Vector3(...e.at), dir: new GFX.Vector3(...e.dir).normalize() }))
    }
    const lv = sim.body.linvel()
    const speed = Math.hypot(lv.x, lv.z)
    const go = Math.max(0, Math.min(1, (speed - 1.5) / 12))
    // TYRES: dust from each wheel on the ground, by what it rolls on
    for (let k = 0; k < 4; k++) {
      const wk = sim.wheels[k]
      if (!wk.contact) { this.acc[k] = 0; continue }
      const [hx, hy, hz] = model.wheelPos[k]
      const c = this.v.set(hx, hy + wk.lift - model.wheelRadius * 0.85, hz).applyQuaternion(q).add(p)
      this.tyre(dt, k, c, lv, speed, go, sim.wheelSlip[k] ?? 0, 1)
    }
    // EXHAUST: a thin haze at idle, a grey puff on the gas, from every tip
    const thr = Math.min(1, Math.abs(sim.controls.throttle))
    this.acc[4] += (6 + 30 * thr) * dt
    while (this.acc[4] >= 1) {
      this.acc[4] -= 1
      const tip = this.tips[Math.floor(this.rnd() * this.tips.length)]
      const at = this.v.copy(tip.at).applyQuaternion(q).add(p), dir = this.d.copy(tip.dir).applyQuaternion(q)
      const out = 1.2 + 2.6 * thr, sh = 0.62 - 0.3 * thr
      this.spawn(at.x, at.y, at.z,
        dir.x * out + lv.x * 0.85 + (this.rnd() - 0.5) * 0.3, dir.y * out + lv.y * 0.85 + 0.25 + this.rnd() * 0.3, dir.z * out + lv.z * 0.85 + (this.rnd() - 0.5) * 0.3,
        0.9 + this.rnd() * 0.9, 0.12, 0.8 + 0.9 * thr + this.rnd() * 0.3,
        sh, sh + 0.01, sh + 0.04, 0.1 + 0.22 * thr)
    }
  }
  /** One tyre on the ground at c (world): splashes in water, none on planks, else dust by what it rolls on — k its
   *  emission carried over (acc), lv the vehicle's velocity, go 0 … 1 with speed, slip 0 … 1, size the tyre (1 a car's;
   *  the bike's ~0.35: fewer, smaller puffs). */
  private tyre(dt: number, k: number, c: GFX.Vector3, lv: { x: number; y: number; z: number }, speed: number, go: number, slip: number, size: number): void {
    const hw = this.map.meta.trails.hw
    const deck = this.map.bridgeAt(c.x, c.z)
    if (deck !== null && c.y > deck - 0.6) { this.acc[k] = 0; return } // (planks: no dust)
    // WATER (a ford, a pond's edge): SPLASHES — white spray thrown up and out, more with speed and depth; no dust
    const lvl = this.map.waterAt(c.x, c.z), ground = this.map.height(c.x, c.z)
    if (lvl !== null && lvl > ground + 0.05) {
      const depth = Math.min(1, lvl - ground)
      this.acc[k] += (go * 24 + 4 * Math.min(1, speed / 2)) * (0.4 + depth) * dt * size
      while (this.acc[k] >= 1) {
        this.acc[k] -= 1
        const jx = (this.rnd() - 0.5) * 0.6, jz = (this.rnd() - 0.5) * 0.6
        this.spawn(c.x + jx, lvl + 0.05, c.z + jz,
          lv.x * 0.35 + jx * 5 + (this.rnd() - 0.5) * 2, 1.0 + this.rnd() * 1.8 * (0.5 + go), lv.z * 0.35 + jz * 5 + (this.rnd() - 0.5) * 2,
          0.35 + this.rnd() * 0.4, 0.18 + 0.2 * go, (0.5 + this.rnd() * 0.7) * (0.6 + go),
          0.86, 0.91, 0.95, Math.min(0.42, 0.2 + 0.22 * go))
      }
      return
    }
    const m = this.map.maskAt(c.x, c.z, this.mk)
    const track = Math.max(0, Math.min(1, (hw + 0.8 - this.map.trailDist(c.x, c.z)) / 1.2))
    const bank = m[2] > 0.75 ? 1 - track : 0
    const rock = Math.min(1, m[0] * 1.6) * (1 - track) * (1 - bank)
    // (the desert: what isn't track, rock or bank is SAND — loose (its mask's G) throws big pale plumes; the valley's
    //  is grass)
    const rest = Math.max(0, 1 - track - bank - rock)
    const desert = this.map.desert
    const sand = desert ? rest : 0, grass = desert ? 0 : rest, loose = desert ? m[1] : 0
    // MUD (mud.bin; and the tracks in the rain): dark wet clods, low and short — the wet lays the dust
    const wet = this.wet
    const mud = Math.max(this.map.mudAt(c.x, c.z), track * wet * 0.7)
    const amt = (track * 1.0 + bank * 0.55 + rock * 0.3 + grass * 0.16 + sand * (0.45 + 0.85 * loose)) * (1 - 0.75 * wet) * (1 - mud) + mud * 1.3
    this.acc[k] += amt * (go * 20 + slip * 42) * dt * size
    if (this.acc[k] < 1) return
    // the colour: track dust (the dirt's orange-brown, paler), gravel, rock grey (the desert's: sandstone), dry
    // grass-earth, the desert's pale orange sand — or the mud's
    const dry = 1 - mud
    const rr = desert ? 0.72 : 0.56, rg = desert ? 0.5 : 0.54, rb = desert ? 0.38 : 0.5
    const r = (track * 0.68 + bank * 0.72 + rock * rr + grass * 0.5 + sand * 0.82) * dry + 0.2 * mud
    const g = (track * 0.47 + bank * 0.67 + rock * rg + grass * 0.45 + sand * 0.63) * dry + 0.14 * mud
    const b = (track * 0.32 + bank * 0.58 + rock * rb + grass * 0.32 + sand * 0.45) * dry + 0.09 * mud
    const big = (0.7 + 0.6 * go + 0.5 * slip) * (1 - 0.5 * mud) * (1 + 0.35 * sand * loose) * (0.35 + 0.65 * size)
    while (this.acc[k] >= 1) {
      this.acc[k] -= 1
      const jx = (this.rnd() - 0.5) * 0.5, jz = (this.rnd() - 0.5) * 0.5
      // thrown back and out from the tyre, carried a little with the car, lifting (mud: lower, shorter lived)
      this.spawn(c.x + jx, c.y + 0.1 + this.rnd() * 0.2, c.z + jz,
        lv.x * 0.25 + jx * 3 + (this.rnd() - 0.5) * 1.2, (0.4 + this.rnd() * 1.1 + slip * 0.8) * (1 - 0.5 * mud), lv.z * 0.25 + jz * 3 + (this.rnd() - 0.5) * 1.2,
        (1.6 + this.rnd() * 1.8) * (1 - 0.55 * mud), (0.5 + this.rnd() * 0.4) * big, (2.2 + this.rnd() * 2.0) * big,
        r, g, b, Math.min(0.55, 0.3 * amt + 0.12 * slip) + 0.25 * mud)
    }
  }

  /** The BIKE's two tyres (main.ts while riding): each contact point, how much it slides; lv its velocity. */
  bikeTyres(dt: number, wheels: { contact: boolean; slip: number; ground: { x: number; y: number; z: number } }[], lv: { x: number; y: number; z: number }): void {
    const speed = Math.hypot(lv.x, lv.z), go = Math.max(0, Math.min(1, (speed - 1.5) / 10))
    wheels.forEach((w, i) => {
      const k = 5 + i
      if (!w.contact) { this.acc[k] = 0; return }
      this.tyre(dt, k, this.v.set(w.ground.x, w.ground.y + 0.04, w.ground.z), lv, speed, go, w.slip, 0.35)
    })
  }
}

const VERT = /* glsl */ `
in vec4 aP;
in vec4 aC;
out vec2 vQ;
out vec2 vR;
out vec4 vC;
out vec3 vWorld;
out vec3 vRight;
out vec3 vUp;
out float vSeed;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // each puff turned its own way (the noise in it differs)
  float a = float(gl_InstanceID) * 2.39996;
  vec2 q = position.xy * 2.0;
  vec2 r = vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
  vec3 w = aP.xyz + (right * q.x + up * q.y) * aP.w * 0.5;
  vQ = q;
  vR = r;
  vSeed = fract(float(gl_InstanceID) * 0.618034);
  vC = aC;
  vWorld = w;
  vRight = right;
  vUp = up;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  if (aP.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // (a dead puff: off screen)
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec2 vQ;
in vec2 vR;
in vec4 vC;
in vec3 vWorld;
in vec3 vRight;
in vec3 vUp;
in float vSeed;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  // a soft ball with a ragged, brushy edge (the paint noise, its own patch per puff)
  float nz = texture(uNoise, vR * 0.18 + vec2(vSeed, vSeed * 1.7) + uTime * 0.01).r;
  float edge = 1.0 - smoothstep(0.3, 1.0, r + (nz - 0.5) * 0.55);
  float a = vC.a * edge;
  if (a < 0.004) discard;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 N = normalize(vRight * vQ.x + vUp * vQ.y + V * sqrt(max(0.0, 1.0 - r * r)));
  float diff = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = vC.rgb * (uSunColor * (0.2 + 0.55 * diff) + ambient(N));
  // the low sun behind it: the dust glows (forward scattering)
  col += vC.rgb * uSunColor * pow(max(dot(-V, uSunDir), 0.0), 6.0) * 0.7;
  gl_FragColor = vec4(applyAtmos(col, vWorld), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
