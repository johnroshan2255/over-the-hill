import * as GFX from './gfx'
import { group, Groups } from '../physics/PhysicsWorld'
import type { Atmosphere } from './Atmosphere'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import { VEHICLE_FRAG_SRC } from './Vehicle'

/**
 * THE CHARACTER ON FOOT (2026-11-05, the user: "a skeleton and proper animation for walk, run, jump, grab … getting out
 * of the car by opening the door, on and off the bikes"): the Trail Warden (refer/char.png) rigged and animated in
 * Blender from Mixamo's clips (scripts/oth/character.py → assets/models/human/character.glb).
 *
 *   DRAWN     ONE draw: the skinned mesh, 4 bones a vertex, the bones' poses (3 × 4, model space × the inverse bind)
 *             one uniform array — the car's and the bikes' surface shader, the world's light.
 *   ANIMATED  the clips sampled on the CPU (22 bones, linear / slerp) and CROSS-FADED (0.2 s); a loop's playback rate
 *             follows the speed it's moved at (the feet don't slide); a one-off's travel (getting in or out of the car,
 *             climbing) is the hips' — at its end it's handed to the character's place and heading.
 *   MOVED     a capsule through Rapier's KINEMATIC CHARACTER CONTROLLER (steps up 0.4 m, snaps to the ground, slopes
 *             to 50°): W A S D toward the camera's view, run by default, Shift sprints, Ctrl walks; Space jumps
 *             (a standing or a running jump), in the air it falls, a landing hard enough shows; E picks up / grabs.
 */
/** Riding: the torso this much further forward than the bike's rider model leans (rad) — the arms' reach to the bars. */
const RIDE_LEAN = 0
/** …and in first person (none of him seen but his arms): sat up this much from it (rad) — a leant rider's eye is over the
 *  bars, and a screen's lens is narrower than an eye: the bars would be under the view. */
const FPP_SIT_UP = -0.4

export type ClipName = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'jump_run' | 'fall' | 'land' | 'pickup' | 'grab_ledge' | 'climb_ledge' | 'open_door' | 'car_enter' | 'car_exit' | 'sit_drive' | 'turn_left' | 'turn_right' | 'getup_back' | 'getup_front'

interface Channel { bone: number; path: 'translation' | 'rotation'; times: Float32Array; values: Float32Array }
interface Clip { name: string; dur: number; loop: boolean; speed: number; channels: Channel[] }
interface Bone { name: string; parent: number; t: Float32Array; r: Float32Array; ibm: Float32Array }

const NB_MAX = 32
const VERT = /* glsl */ `
in vec4 aJoints;
in vec4 aWeights;
uniform vec4 uBones[${NB_MAX * 3}];
out vec3 vWorld;
out vec3 vLocal;
out vec3 vN;
out vec2 vUv;
out vec3 vCol;
out float vPaint;
vec3 bonePos(int j, vec3 p) { int k = j * 3; return vec3(dot(uBones[k].xyz, p) + uBones[k].w, dot(uBones[k + 1].xyz, p) + uBones[k + 1].w, dot(uBones[k + 2].xyz, p) + uBones[k + 2].w); }
vec3 boneDir(int j, vec3 n) { int k = j * 3; return vec3(dot(uBones[k].xyz, n), dot(uBones[k + 1].xyz, n), dot(uBones[k + 2].xyz, n)); }
void main() {
  ivec4 j = ivec4(aJoints + 0.5);
  vec3 b = bonePos(j.x, position) * aWeights.x + bonePos(j.y, position) * aWeights.y + bonePos(j.z, position) * aWeights.z + bonePos(j.w, position) * aWeights.w;
  vec3 bn = boneDir(j.x, normal) * aWeights.x + boneDir(j.y, normal) * aWeights.y + boneDir(j.z, normal) * aWeights.z + boneDir(j.w, normal) * aWeights.w;
  vec4 w = modelMatrix * vec4(b, 1.0);
  vWorld = w.xyz;
  vLocal = b;
  vN = normalize(mat3(modelMatrix) * bn);
  vUv = vec2(0.0);
#ifdef USE_COLOR
  vCol = color;
#else
  vCol = vec3(1.0);
#endif
  vPaint = 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

// ------------------------------------------------------------------------------------------------- small math
type Q = Float32Array | number[]
// (2026-11-07, docs/PERF.md "the garbage": the quaternions and matrices read at an OFFSET into their arrays and the
//  scratch kept — a subarray view, a destructured array or a new matrix per bone per frame was ~28 KB of garbage a
//  frame, a garbage collection's hitch every few hundred frames; the arithmetic is unchanged)
/** Quaternion a (at ao) to b (at bo) by t, into out at o (out may be a or b). */
function slerp(a: Q, ao: number, b: Q, bo: number, t: number, out: Float32Array, o = 0): void {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3]
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3]
  let d = ax * bx + ay * by + az * bz + aw * bw
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw }
  let k0 = 1 - t, k1 = t
  if (d < 0.9995) { const th = Math.acos(d), s = Math.sin(th); k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s }
  const x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1
  const n = Math.hypot(x, y, z, w) || 1
  out[o] = x / n; out[o + 1] = y / n; out[o + 2] = z / n; out[o + 3] = w / n
}
/** Column-major 4 × 4 from a translation (t at to) and a quaternion (q at qo). */
function compose(t: Q, to: number, q: Q, qo: number, out: Float32Array): void {
  const x = q[qo], y = q[qo + 1], z = q[qo + 2], w = q[qo + 3]
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2
  out[0] = 1 - (yy + zz); out[1] = xy + wz; out[2] = xz - wy; out[3] = 0
  out[4] = xy - wz; out[5] = 1 - (xx + zz); out[6] = yz + wx; out[7] = 0
  out[8] = xz + wy; out[9] = yz - wx; out[10] = 1 - (xx + yy); out[11] = 0
  out[12] = t[to]; out[13] = t[to + 1]; out[14] = t[to + 2]; out[15] = 1
}
const _mul = new Float32Array(16), _fk = new Float32Array(16)
function mul4(a: Float32Array, b: Float32Array, out: Float32Array): void {
  const r = _mul
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3]
  out.set(r)
}
function qmul(a: Q, b: Q): [number, number, number, number] {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
}
function qaxis(x: number, y: number, z: number, ang: number): [number, number, number, number] { const s = Math.sin(ang / 2); return [x * s, y * s, z * s, Math.cos(ang / 2)] }
/** The shortest turn taking direction a onto direction b. */
function qfromTo(a: number[], b: number[]): [number, number, number, number] {
  const la = Math.hypot(a[0], a[1], a[2]) || 1, lb = Math.hypot(b[0], b[1], b[2]) || 1
  const ax = a[0] / la, ay = a[1] / la, az = a[2] / la, bx = b[0] / lb, by = b[1] / lb, bz = b[2] / lb
  const d = ax * bx + ay * by + az * bz
  if (d > 0.999999) return [0, 0, 0, 1]
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, w = 1 + d
  const n = Math.hypot(cx, cy, cz, w) || 1
  return [cx / n, cy / n, cz / n, w / n]
}
/** Turn a 4 × 4's rotation by q (pre-multiplied: a turn in model space), its origin kept. */
function turnMat(m: Float32Array, q: Q): void {
  const x = q[0], y = q[1], z = q[2], w = q[3]
  const r0 = 1 - 2 * (y * y + z * z), r1 = 2 * (x * y + w * z), r2 = 2 * (x * z - w * y), r3 = 2 * (x * y - w * z), r4 = 1 - 2 * (x * x + z * z), r5 = 2 * (y * z + w * x), r6 = 2 * (x * z + w * y), r7 = 2 * (y * z - w * x), r8 = 1 - 2 * (x * x + y * y)
  for (let c = 0; c < 3; c++) {
    const a = m[c * 4], b = m[c * 4 + 1], e = m[c * 4 + 2]
    m[c * 4] = r0 * a + r3 * b + r6 * e; m[c * 4 + 1] = r1 * a + r4 * b + r7 * e; m[c * 4 + 2] = r2 * a + r5 * b + r8 * e
  }
}
function rotV(q: Q, v: number[]): number[] {
  const [x, y, z, w] = [q[0], q[1], q[2], q[3]], [vx, vy, vz] = v
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
}

/** The yaw (about +y) a quaternion turns the forward axis (−z) by. */
function yawOf(q: Q, o = 0): number {
  const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3]
  const fx = -(2 * (x * z + w * y)), fz = -(1 - 2 * (x * x + y * y))
  return Math.atan2(-fx, -fz)
}

// ------------------------------------------------------------------------------------------------- the GLB's skin + clips
async function readGlb(url: string): Promise<{ json: any; bin: ArrayBuffer }> {
  const buf = await (await fetch(url)).arrayBuffer()
  const dv = new DataView(buf)
  let o = 12, json: any = null, bin: ArrayBuffer | null = null
  while (o < dv.getUint32(8, true)) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, len)))
    else if (type === 0x004e4942) bin = buf.slice(o + 8, o + 8 + len)
    o += 8 + len
  }
  return { json, bin: bin! }
}
function floats(json: any, bin: ArrayBuffer, i: number): Float32Array {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type]
  return new Float32Array(bin.slice((bv.byteOffset ?? 0) + (a.byteOffset ?? 0), (bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * n * 4))
}

type State = 'move' | 'jump' | 'air' | 'land' | 'action' | 'hidden' | 'seated'

export class Character {
  readonly root = new GFX.Group()
  /** Where the feet are (world) and the heading (rad, 0 = facing −z, + turns left — the game's). */
  readonly pos = new GFX.Vector3()
  heading = 0
  /** Touch controls (main.ts's pads). */
  readonly touch = { gas: 0, brake: 0, left: 0, right: 0, hop: 0, lean: 0, mx: 0, my: 0, sprint: 0 }
  /** The camera's yaw (main.ts): W walks away from it. */
  camYaw = 0
  /** Free to move (false: the game holds it — getting in or out, a cut). */
  control = true
  state: State = 'hidden'
  /** Ground speed (m/s) and vertical (m/s). */
  speed = 0
  private vy = 0
  private grounded = true
  private airT = 0
  // the skeleton, the clips, the playing
  private bones: Bone[] = []
  private clips = new Map<string, Clip>()
  private cur: { clip: Clip; t: number; rate: number } | null = null
  private prev: { clip: Clip; t: number; rate: number } | null = null
  private fade = 1
  private fadeT = 0.2
  private onEnd: (() => void) | null = null
  /** An UPPER-BODY layer (the jumps: their legs, the run's / the idle's arms — the clip's own fling their arms out:
   *  "like Superman"): the clip whose spine and arms are mixed in, and how much. */
  private upper: { clip: Clip; t: number; w: number } | null = null
  private upperBones: number[] = []
  private readonly upT = new Float32Array(NB_MAX * 3)
  private readonly upR = new Float32Array(NB_MAX * 4)
  private readonly lt: Float32Array = new Float32Array(NB_MAX * 3)
  private readonly lr: Float32Array = new Float32Array(NB_MAX * 4)
  private readonly tmpT = new Float32Array(NB_MAX * 3)
  private readonly tmpR = new Float32Array(NB_MAX * 4)
  private readonly world: Float32Array[] = []
  private readonly bonesU = new Float32Array(NB_MAX * 12)
  private mesh: GFX.Mesh | null = null
  private readonly uniforms: Record<string, GFX.IUniform>
  private readonly shadow: GFX.Mesh
  private readonly shadowBase: Float32Array
  // the controller
  private body: any = null
  private col: any = null
  private cc: any = null
  private readonly keys = new Set<string>()
  private hipsRest: Float32Array = new Float32Array(3)
  /** A jump's take-off still to come (s: the standing jump's crouch) and the key held since the last (no repeats). */
  private takeoff = 0
  private jumpHeld = false
  // GTA-STYLE LOCOMOTION (2026-11-05, the user: "how walking and jumping work in GTA 4 and 5 — that much realism"):
  /** One stride phase (0 … 1) shared by walk / run / sprint, each clip lined up on it (its left foot forward at 0). */
  private phase = 0
  private idleT = 0
  private readonly locoOff = new Map<string, number>()
  private readonly stride = new Map<string, number>()
  /** Turn rate (rad/s), acceleration (m/s²) — the lean into a turn, forward on a start — and the eased lean. */
  private turnRate = 0
  private accel = 0
  private leanR = 0
  private leanP = 0
  /** The head toward where the camera looks (rad, eased). */
  private look = 0
  /** SEATED in a car (2026-11-05: the driver seen through the windows, and in first person): the car's root, where
   *  the character's feet-origin sits in car space, and where the hands go on the rim (car space) — null: free. */
  private seat: { car: GFX.Object3D; at: GFX.Vector3; hands: () => [GFX.Vector3, GFX.Vector3] | null } | null = null
  /** ON A BIKE (2026-11-05: the skinned character rides — the segment rider cracked at the hips and the wrists): the
   *  bike's root and its rider targets (Bike.riderT, bike space), and its thrown rider's body in a crash. */
  private ride: { root: GFX.Object3D; t: { hip: number[]; lean: number; grips: number[][]; ankles: number[][] }; bail: () => { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } | null } | null = null
  /** First person: the head shrunk away (the camera is in it). */
  hideHead = false
  /** Foot IK: its weight (0 … 1), the pelvis drop (m), eased. */
  private ikW = 0
  private pelvis = 0
  private readonly post: ([number, number, number, number] | null)[] = []
  private readonly lt2 = new Float32Array(NB_MAX * 3)
  private readonly lr2 = new Float32Array(NB_MAX * 4)
  private readonly lt3 = new Float32Array(NB_MAX * 3)
  private readonly lr3 = new Float32Array(NB_MAX * 4)
  private bi: Record<string, number> = {}
  /** Each jump clip's air (take-off, touch-down: s), from its hips. */
  private readonly air = new Map<string, [number, number]>()
  private hipsIndex = 0
  /** THE EYES (first person's camera): between them, just behind their surface, in the head bone's frame — found on the
   *  mesh at load (the nose's tip, the eyes 3.8 cm over it: rider.py's face marks). */
  private readonly eyeLocal = new Float32Array([0, 0.1, -0.08])

  constructor(private readonly map: MapData, private readonly physics: OthPhysics, atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4) {
    this.uniforms = {
      ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, uMap: { value: null }, uPaintMask: { value: null },
      uPaint: { value: new GFX.Color(1, 1, 1) }, uSunHere: { value: 1 }, uCoat: { value: 0 }, uCoatColor: { value: new GFX.Color(0.8, 0.6, 0.42) }, uCarBase: { value: 0 },
      'uBones[0]': { value: this.bonesU },
    }
    const sg = new GFX.PlaneGeometry(1, 1, 4, 4).rotateX(-Math.PI / 2)
    this.shadow = new GFX.Mesh(sg, new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { uMist: atmos.uniforms.uMist },
      vertexShader: /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `layout(location = 0) out highp vec4 outColor; in vec2 vUv; uniform float uMist;
        void main() { vec2 q = (vUv - 0.5) * 2.0; float d = length(q); outColor = vec4(0.06, 0.04, 0.05, 0.5 * (1.0 - smoothstep(0.25, 1.0, d)) * (1.0 - 0.75 * uMist * uMist)); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }))
    this.shadow.frustumCulled = false
    this.shadow.renderOrder = 2
    this.shadowBase = (sg.attributes.position.array as Float32Array).slice()
    this.root.visible = this.shadow.visible = false
    window.addEventListener('keydown', (e) => this.keys.add(e.code))
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  get shadowMesh(): GFX.Mesh { return this.shadow }
  /** Its model loaded (else the bikes keep their own segment rider). */
  get loaded(): boolean { return !!this.mesh }
  get visible(): boolean { return this.state !== 'hidden' }

  /** The mesh (Draco, via the game's loader) and the skin + clips (read here: the loader keeps neither). */
  async load(url: string): Promise<void> {
    const [{ json, bin }, gltf] = await Promise.all([readGlb(url), new GFX.GLTFLoader().setDRACOLoader(new GFX.DRACOLoader().setDecoderPath('/draco/')).loadAsync(url)])
    const skin = json.skins[0], joints: number[] = skin.joints
    const ibm = floats(json, bin, skin.inverseBindMatrices)
    const nodeToBone = new Map<number, number>(joints.map((n, i) => [n, i]))
    const parentOf = new Map<number, number>()
    json.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => parentOf.set(c, i)))
    this.bones = joints.map((n, i) => {
      const nd = json.nodes[n]
      const p = parentOf.get(n)
      return { name: nd.name, parent: p !== undefined && nodeToBone.has(p) ? nodeToBone.get(p)! : -1, t: new Float32Array(nd.translation ?? [0, 0, 0]), r: new Float32Array(nd.rotation ?? [0, 0, 1, 0].map((_, k) => (k === 3 ? 1 : 0))), ibm: ibm.slice(i * 16, i * 16 + 16) }
    })
    for (let i = 0; i < this.bones.length; i++) this.world.push(new Float32Array(16))
    this.hipsIndex = this.bones.findIndex((b) => /Hips$/.test(b.name))
    // (the ARMS only: a jump keeps its own legs and body, its arms mostly the run's / the idle's — closer to the sides)
    this.upperBones = this.bones.map((b, i) => (/(Shoulder|Arm|ForeArm|Hand)$/.test(b.name) ? i : -1)).filter((i) => i >= 0)
    this.hipsRest = this.bones[this.hipsIndex].t.slice()
    const skel = json.nodes.find((n: any) => n.extras?.clips)
    const info: Record<string, { loop: boolean; speed: number }> = skel ? JSON.parse(skel.extras.clips) : {}
    for (const a of json.animations ?? []) {
      const channels: Channel[] = []
      let dur = 0
      for (const c of a.channels) {
        const b = nodeToBone.get(c.target.node)
        if (b === undefined || (c.target.path !== 'rotation' && c.target.path !== 'translation')) continue
        if (c.target.path === 'translation' && b !== this.hipsIndex) continue // (only the hips travel)
        const s = a.samplers[c.sampler], times = floats(json, bin, s.input), values = floats(json, bin, s.output)
        dur = Math.max(dur, times[times.length - 1])
        channels.push({ bone: b, path: c.target.path, times, values })
      }
      // the JUMPS and the landing are played where the controller puts the body: their hips' own travel and rise taken
      // out (the clip's 0.56 m on top of the physics' — the user: "the jump is like Superman"), their crouch kept
      if (a.name === 'jump' || a.name === 'jump_run' || a.name === 'land') {
        const h = channels.find((c) => c.bone === this.hipsIndex && c.path === 'translation')
        // (the jumps' AIR: when the hips rise back through where they started after the crouch, and come down through it
        //  again — the game times the take-off and plays the air over the physics' — 2026-11-05: GTA-like clips now)
        if (h && a.name !== 'land') {
          const n = h.times.length, y = (i: number) => h.values[i * 3 + 1], y0 = y(0)
          let lo = 0
          for (let i = 0; i < n / 2; i++) if (y(i) < y(lo)) lo = i
          let up = lo
          while (up < n - 1 && y(up) < y0 + 0.02) up++
          let dn = up
          while (dn < n - 1 && y(dn) > y0) dn++
          this.air.set(a.name, [h.times[up], h.times[Math.max(dn, up + 1)]])
        }
        if (h) for (let i = 0; i < h.values.length / 3; i++) { h.values[i * 3] = this.hipsRest[0]; h.values[i * 3 + 2] = this.hipsRest[2]; h.values[i * 3 + 1] = Math.min(h.values[i * 3 + 1], this.hipsRest[1]) }
      }
      this.clips.set(a.name, { name: a.name, dur, loop: info[a.name]?.loop ?? false, speed: info[a.name]?.speed ?? 0, channels })
    }
    // THE LOCOMOTION BLEND: a clip of its own ('loco', sampled from walk / run / sprint / idle by the speed)
    this.clips.set('loco', { name: 'loco', dur: 1, loop: true, speed: 0, channels: [] })
    this.bones.forEach((b, i) => { this.bi[b.name.replace(/^.*:/, '')] = i; this.post.push(null) })
    for (const n of ['walk', 'run', 'sprint']) {
      const c = this.clips.get(n)
      if (!c) continue
      // (each cycle's start put where its LEFT FOOT is furthest forward: the clips step together)
      let best = 0, bz = 9
      for (let k = 0; k < 24; k++) {
        const t = (k / 24) * c.dur
        this.sample({ clip: c, t }, this.lt2, this.lr2)
        this.fk(this.lt2, this.lr2)
        const z = this.world[this.bi.LeftFoot][14]
        if (z < bz) { bz = z; best = k / 24 }
      }
      this.locoOff.set(n, best)
      this.stride.set(n, Math.max(0.8, c.speed * c.dur))
    }
    // (Mixamo's fast run travels less than it runs: its stride at least a sprinter's)
    this.stride.set('sprint', Math.max(this.stride.get('sprint') ?? 0, (this.stride.get('run') ?? 3.5) * 1.25))
    // the mesh: every primitive merged, its material's colour per vertex, joints / weights as floats
    const pos: number[] = [], nor: number[] = [], colr: number[] = [], jn: number[] = [], wt: number[] = [], idx: number[] = []
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((o: GFX.Object3D) => {
      const m = o as GFX.Mesh
      if (!m.isMesh) return
      const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, Jn = g.attributes.joints_0, W = g.attributes.weights_0, AO = g.attributes.color
      if (!Jn || !W) return
      const c = ((Array.isArray(m.material) ? m.material[0] : m.material) as GFX.MeshStandardMaterial)?.color ?? new GFX.Color(1, 1, 1)
      const base = pos.length / 3
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i))
        nor.push(N.getX(i), N.getY(i), N.getZ(i))
        // (the baked ambient occlusion, softened: the folds and pockets darker, never black)
        const ao = AO ? 0.4 + 0.6 * AO.getX(i) : 1
        colr.push(c.r * ao, c.g * ao, c.b * ao)
        jn.push(Jn.getX(i), Jn.getY(i), Jn.getZ(i), Jn.getW(i))
        const s = W.getX(i) + W.getY(i) + W.getZ(i) + W.getW(i) || 1
        wt.push(W.getX(i) / s, W.getY(i) / s, W.getZ(i) / s, W.getW(i) / s)
      }
      if (g.index) for (const k of g.index.array) idx.push(base + k)
    })
    this.findEyes(pos, jn, wt)
    const geo = new GFX.BufferGeometry()
    geo.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
    geo.setAttribute('normal', new GFX.Float32BufferAttribute(nor, 3))
    geo.setAttribute('color', new GFX.Float32BufferAttribute(colr, 3))
    geo.setAttribute('aJoints', new GFX.Float32BufferAttribute(jn, 4))
    geo.setAttribute('aWeights', new GFX.Float32BufferAttribute(wt, 4))
    geo.setIndex(idx)
    geo.computeBoundingSphere()
    const mat = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: this.uniforms, defines: { OTH_SPEC: '', MIST_K: '0.45', NO_GRAIN: '' }, vertexShader: VERT, fragmentShader: VEHICLE_FRAG_SRC(), vertexColors: true })
    this.mesh = new GFX.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.root.add(this.mesh)
    this.play('idle')
    this.pose(0)
  }

  // ============================================================================================ the clips
  has(name: ClipName): boolean { return this.clips.has(name) }
  clipLength(name: ClipName): number { return this.clips.get(name)?.dur ?? 0 }

  /** Play a clip (cross-faded from what's playing). A one-off calls `then` at its end. */
  play(name: ClipName, opts: { fade?: number; rate?: number; then?: () => void; restart?: boolean; at?: number } = {}): void {
    const clip = this.clips.get(name)
    if (!clip) { opts.then?.(); return }
    if (this.cur?.clip === clip && !opts.restart) { this.cur.rate = opts.rate ?? this.cur.rate; return }
    this.prev = this.cur
    this.cur = { clip, t: opts.at ?? 0, rate: opts.rate ?? 1 }
    this.fadeT = opts.fade ?? 0.2
    this.fade = this.prev ? 0 : 1
    this.onEnd = opts.then ?? null
  }
  get playing(): ClipName | null { return (this.cur?.clip.name as ClipName) ?? null }
  /** 0 … 1 through the clip playing. */
  get progress(): number { return this.cur ? Math.min(1, this.cur.t / Math.max(1e-3, this.cur.clip.dur)) : 0 }

  /** The hips' place in the clip playing, now (model space) — a one-off's travel. */
  hipsNow(out: GFX.Vector3): GFX.Vector3 {
    const i = this.hipsIndex
    return out.set(this.lt[i * 3], this.lt[i * 3 + 1], this.lt[i * 3 + 2])
  }

  /** A one-off's TRAVEL so far: the hips' move off their rest (model space, along the ground) and the turn they've
   *  made — at the clip's end main.ts hands it to the character's place and heading (getting out of the car: 1.9 m to
   *  the left, turned). */
  travel(): { dx: number; dz: number; yaw: number } {
    const i = this.hipsIndex
    return { dx: this.lt[i * 3] - this.hipsRest[0], dz: this.lt[i * 3 + 2] - this.hipsRest[2], yaw: yawOf(this.lr, i * 4) - yawOf(this.bones[i].r) }
  }
  /** The hips' place at the start of clip `name` (model space): to line a one-off up with where it must start. */
  hipsAt(name: ClipName, t: number): [number, number, number] {
    const c = this.clips.get(name), ch = c?.channels.find((q) => q.bone === this.hipsIndex && q.path === 'translation')
    if (!ch) return [this.hipsRest[0], this.hipsRest[1], this.hipsRest[2]]
    const n = ch.times.length, i = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))
    return [ch.values[i * 3], ch.values[i * 3 + 1], ch.values[i * 3 + 2]]
  }

  /** How clip `name` LIES at time `t` (s) — the get-ups: the hips (model space) and the way the head points from them
   *  (the game's heading of that direction) — to lay it where a thrown rider came to rest, his head where it is. */
  lieOf(name: ClipName, t: number): { hips: [number, number, number]; headYaw: number } {
    const c = this.clips.get(name)
    if (!c) return { hips: [0, 0, 0], headYaw: 0 }
    this.sample({ clip: c, t }, this.lt2, this.lr2)
    this.fk(this.lt2, this.lr2)
    const hp = this.world[this.hipsIndex], hd = this.world[this.bi.Head]
    return { hips: [hp[12], hp[13], hp[14]], headYaw: Math.atan2(-(hd[12] - hp[12]), -(hd[14] - hp[14])) }
  }

  /** Locomotion speed → the clips' weights (idle → walk → run → sprint, each over the last). */
  private locoW(s: number): { walk: number; run: number; sprint: number } {
    const sm = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k) }
    return { walk: sm((s - 0.25) / 0.7), run: sm((s - 2.0) / 2.2), sprint: sm((s - 5.0) / 2.0) }
  }
  private locoSpeed(): number { return Math.max(this.speed, Math.min(1.1, Math.abs(this.turnRate) * 0.45)) }
  private sampleLoco(T: Float32Array, R: Float32Array): void {
    const idle = this.clips.get('idle')!
    this.sample({ clip: idle, t: this.idleT % idle.dur }, T, R)
    const w = this.locoW(this.locoSpeed())
    const mixIn = (name: string, k: number) => {
      const c = this.clips.get(name)
      if (!c || k <= 0) return
      this.sample({ clip: c, t: (((this.phase + (this.locoOff.get(name) ?? 0)) % 1) + 1) % 1 * c.dur }, this.lt3, this.lr3)
      for (let b = 0; b < this.bones.length; b++) {
        for (let q = 0; q < 3; q++) T[b * 3 + q] += (this.lt3[b * 3 + q] - T[b * 3 + q]) * k
        slerp(R, b * 4, this.lr3, b * 4, k, R, b * 4)
      }
    }
    mixIn('walk', w.walk); mixIn('run', w.run); mixIn('sprint', w.sprint)
  }

  private sample(c: { clip: Clip; t: number }, T: Float32Array, R: Float32Array): void {
    if (c.clip.name === 'loco') { this.sampleLoco(T, R); return }
    for (let b = 0; b < this.bones.length; b++) { T.set(this.bones[b].t, b * 3); R.set(this.bones[b].r, b * 4) }
    const t = c.t
    for (const ch of c.clip.channels) {
      const tm = ch.times, n = tm.length
      let i = 0
      if (t >= tm[n - 1]) i = n - 1
      else { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tm[m] <= t) lo = m; else hi = m }; i = lo }
      const j = Math.min(n - 1, i + 1), f = j > i ? Math.min(1, Math.max(0, (t - tm[i]) / (tm[j] - tm[i]))) : 0
      if (ch.path === 'rotation') slerp(ch.values, i * 4, ch.values, j * 4, f, R, ch.bone * 4)
      else for (let k = 0; k < 3; k++) T[ch.bone * 3 + k] = ch.values[i * 3 + k] + (ch.values[j * 3 + k] - ch.values[i * 3 + k]) * f
    }
  }

  /** Advance the clips and set every bone (render frame). */
  private pose(dt: number): void {
    const cur = this.cur
    if (!cur) return
    // (the stride phase: a cycle per stride length at the speed moved — the feet don't slide)
    {
      const w = this.locoW(this.locoSpeed()), st = (n: string) => this.stride.get(n) ?? 2
      const L = st('walk') + (st('run') - st('walk')) * w.run + (st('sprint') - st('run')) * w.sprint * w.run
      this.phase = (this.phase + (Math.max(this.locoSpeed(), 0.6 * w.walk) * dt) / L) % 1
      this.idleT += dt
    }
    cur.t += dt * cur.rate
    if (cur.t >= cur.clip.dur) {
      if (cur.clip.loop) cur.t %= Math.max(1e-3, cur.clip.dur)
      else {
        cur.t = cur.clip.dur
        if (this.onEnd) { const f = this.onEnd; this.onEnd = null; f() }
      }
    }
    this.sample(this.cur!, this.lt, this.lr)
    if (this.prev && this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / Math.max(1e-3, this.fadeT))
      const p = this.prev
      p.t += dt * p.rate
      if (p.clip.loop) p.t %= Math.max(1e-3, p.clip.dur)
      else p.t = Math.min(p.t, p.clip.dur)
      this.sample(p, this.tmpT, this.tmpR)
      const w = this.fade * this.fade * (3 - 2 * this.fade)
      for (let b = 0; b < this.bones.length; b++) {
        for (let k = 0; k < 3; k++) this.lt[b * 3 + k] = this.tmpT[b * 3 + k] + (this.lt[b * 3 + k] - this.tmpT[b * 3 + k]) * w
        slerp(this.tmpR, b * 4, this.lr, b * 4, w, this.lr, b * 4)
      }
      if (this.fade >= 1) this.prev = null
    }
    const up = this.upper
    if (up) {
      up.t = (up.t + dt) % Math.max(1e-3, up.clip.dur)
      this.sample(up, this.upT, this.upR)
      for (const b of this.upperBones) slerp(this.lr, b * 4, this.upR, b * 4, up.w, this.lr, b * 4)
    }
    this.skin()
  }

  /** Forward kinematics: every bone's model-space matrix from local poses, each with its post-turn (model space,
   *  about its own origin) — the lean, the head, the legs' IK. */
  private fk(T: Float32Array, R: Float32Array, posts = false): void {
    const m = _fk
    for (let b = 0; b < this.bones.length; b++) {
      compose(T, b * 3, R, b * 4, m)
      const p = this.bones[b].parent
      if (p >= 0) mul4(this.world[p], m, this.world[b]); else this.world[b].set(m)
      const q = posts ? this.post[b] : null
      if (q) turnMat(this.world[b], q)
    }
  }
  private wpos(b: number): number[] { const w = this.world[b]; return [w[12], w[13], w[14]] }
  /** The ground's height under a model-space point (world: the root's place and heading). */
  ground: ((x: number, z: number, y0: number) => number) | null = null
  private groundAt(mx: number, mz: number): number {
    const c = Math.cos(this.heading), s = Math.sin(this.heading)
    const x = this.pos.x + mx * c + mz * s, z = this.pos.z - mx * s + mz * c
    return this.ground ? this.ground(x, z, this.pos.y + 0.6) : this.map.height(x, z)
  }

  private skin(): void {
    const B = this.bi
    for (let b = 0; b < this.bones.length; b++) this.post[b] = null
    const free = this.state === 'move' || this.state === 'land'
    // THE LEAN (GTA's banking): into a turn by its rate × the speed, forward with a start, back on a stop — the whole
    // body about the feet (the hips' turn about the ground under them)
    const roll = free ? Math.max(-0.22, Math.min(0.22, this.turnRate * this.speed * 0.03)) : 0
    const pitch = free ? -Math.max(-0.1, Math.min(0.12, this.accel * 0.018)) : 0
    this.leanR += (roll - this.leanR) * 0.15; this.leanP += (pitch - this.leanP) * 0.12
    // THE HEAD toward where the camera looks (standing and walking; most of it the head, some the neck)
    let lk = 0
    if (free && this.speed < 3) { let d = this.camYaw - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); lk = Math.abs(d) < 2.2 ? Math.max(-1.0, Math.min(1.0, d)) : 0 }
    this.look += (lk - this.look) * 0.06
    // FOOT IK (on uneven ground): each foot's ground under it against the root's; the pelvis down for the lower one
    const legs = [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']].map((l) => l.map((n) => B[n]))
    this.ikW += ((free && this.grounded ? 1 : 0) - this.ikW) * 0.2
    this.fk(this.lt, this.lr)
    const d: number[] = [0, 0]
    if (this.ikW > 0.01) legs.forEach(([, , f], i) => { const a = this.wpos(f); d[i] = Math.max(-0.45, Math.min(0.35, this.groundAt(a[0], a[2]) - this.pos.y)) * this.ikW })
    this.pelvis += (Math.min(0, d[0], d[1]) - this.pelvis) * 0.25
    const h = B.Hips
    this.lt[h * 3 + 1] += this.pelvis
    // the turns, in model space: the lean about the root (the hips' post: x z about the feet — a roll about +z
    // leans the head toward −x, a pitch about +x the head back), the head
    const lean = qmul(qaxis(0, 0, 1, this.leanR), qaxis(1, 0, 0, this.leanP))
    this.post[h] = lean
    if (Math.abs(this.look) > 0.01) { this.post[B.Neck] = qaxis(0, 1, 0, this.look * 0.35); this.post[B.Head] = qaxis(0, 1, 0, this.look * 0.45) }
    this.fk(this.lt, this.lr, true)
    // (the lean turned the hips about their own origin: put the body back over the feet — the root's floor)
    if (Math.abs(this.leanR) + Math.abs(this.leanP) > 1e-4) {
      const hp = this.wpos(h), r = rotV(lean, [hp[0], hp[1] - this.pelvis, hp[2]])
      this.lt[h * 3] += r[0] - hp[0]; this.lt[h * 3 + 2] += r[2] - hp[2]; this.lt[h * 3 + 1] += r[1] - (hp[1] - this.pelvis)
      this.fk(this.lt, this.lr, true)
    }
    if (this.ikW > 0.01) {
      legs.forEach(([u, l, f], i) => {
        const A = this.wpos(f)
        const T = [A[0], A[1] + d[i] - this.pelvis, A[2]]
        if (Math.abs(T[1] - A[1]) < 0.005) return
        this.twoBone(u, l, f, T, true)
      })
      this.fk(this.lt, this.lr, true)
    }
    this.skinRest()
  }

  /** TWO-BONE IK (model space): the chain u → l → f's end brought to T, bending in the plane it bends in now; its
   *  turns written as the bones' posts (the end's own turn kept when `keepEnd`). */
  private twoBone(u: number, l: number, f: number, T: number[], keepEnd: boolean): void {
    {
      {
        const H = this.wpos(u), K = this.wpos(l), A = this.wpos(f)
        const l1 = Math.hypot(K[0] - H[0], K[1] - H[1], K[2] - H[2]), l2 = Math.hypot(A[0] - K[0], A[1] - K[1], A[2] - K[2])
        const HT = [T[0] - H[0], T[1] - H[1], T[2] - H[2]]
        const dd = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, Math.hypot(HT[0], HT[1], HT[2])))
        const dir = HT.map((v) => v / (Math.hypot(HT[0], HT[1], HT[2]) || 1))
        // the bend plane: as the leg bends now (the knee forward)
        const HK = [K[0] - H[0], K[1] - H[1], K[2] - H[2]], HA = [A[0] - H[0], A[1] - H[1], A[2] - H[2]]
        let n = [HK[1] * HA[2] - HK[2] * HA[1], HK[2] * HA[0] - HK[0] * HA[2], HK[0] * HA[1] - HK[1] * HA[0]]
        if (Math.hypot(n[0], n[1], n[2]) < 1e-5) n = [1, 0, 0]
        let pp = [n[1] * dir[2] - n[2] * dir[1], n[2] * dir[0] - n[0] * dir[2], n[0] * dir[1] - n[1] * dir[0]]
        const pl = Math.hypot(pp[0], pp[1], pp[2]) || 1; pp = pp.map((v) => v / pl)
        if (pp[0] * HK[0] + pp[1] * HK[1] + pp[2] * HK[2] < 0) pp = pp.map((v) => -v)
        const ca = Math.max(-1, Math.min(1, (l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd))), sa = Math.sqrt(1 - ca * ca)
        const K2 = [H[0] + l1 * (dir[0] * ca + pp[0] * sa), H[1] + l1 * (dir[1] * ca + pp[1] * sa), H[2] + l1 * (dir[2] * ca + pp[2] * sa)]
        const q1 = qfromTo(HK, [K2[0] - H[0], K2[1] - H[1], K2[2] - H[2]])
        const KA1 = rotV(q1, [A[0] - K[0], A[1] - K[1], A[2] - K[2]])
        const q2 = qfromTo(KA1, [T[0] - K2[0], T[1] - K2[1], T[2] - K2[2]])
        this.post[u] = this.post[u] ? qmul(q1, this.post[u]!) : q1
        this.post[l] = this.post[l] ? qmul(q2, this.post[l]!) : q2
        // (the end keeps its own turn — the foot flat as it was)
        if (keepEnd) { const q12 = qmul(q2, q1); this.post[f] = [-q12[0], -q12[1], -q12[2], q12[3]] }
      }
    }
  }

  /** The pelvis back, the hands on the wheel (seated), the skin's matrices. */
  private skinRest(): void {
    const s = new Float32Array(16), B = this.bi, h = B.Hips
    this.lt[h * 3 + 1] -= this.pelvis
    // RIDING: the hips on the bike's, the body leant as its rider leans (from the seated clip's near-upright), the
    // arms to the grips, the legs to the ankles' places on the pedals / pegs (the feet keep their turn)
    if (this.ride && !this.ride.bail()) {
      const R = this.ride.t
      this.lt[h * 3] = R.hip[0]; this.lt[h * 3 + 1] = R.hip[1]; this.lt[h * 3 + 2] = R.hip[2]
      // (the torso — hips to neck — tipped to the rider's lean from upright, measured off the seated clip, whose car-seat
      //  recline left him bolt upright on the bike: the eye over the hips, the bars out of first person's view)
      this.post[h] = null
      this.fk(this.lt, this.lr, true)
      const hw = this.world[h], nw = this.world[B.Neck]
      const lean0 = Math.atan2(-(nw[14] - hw[14]), nw[13] - hw[13])
      this.post[h] = qaxis(1, 0, 0, -(R.lean + (this.hideHead ? FPP_SIT_UP : RIDE_LEAN) - lean0))
      this.fk(this.lt, this.lr, true)
      const limbs: [string, string, string, number[], boolean][] = [
        ['LeftArm', 'LeftForeArm', 'LeftHand', R.grips[0], false], ['RightArm', 'RightForeArm', 'RightHand', R.grips[1], false],
        ['LeftUpLeg', 'LeftLeg', 'LeftFoot', R.ankles[0], true], ['RightUpLeg', 'RightLeg', 'RightFoot', R.ankles[1], true]]
      for (const [un, ln, fn, T0, keep] of limbs) {
        const u = B[un], l = B[ln], f = B[fn]
        let T = T0
        if (!keep) {
          // (the grip is the palm's middle: the wrist ~8 cm back from it, toward the elbow)
          const A0 = this.wpos(f), K0 = this.wpos(l), bk = [K0[0] - A0[0], K0[1] - A0[1], K0[2] - A0[2]], bl = Math.hypot(bk[0], bk[1], bk[2]) || 1
          T = [T0[0] + (bk[0] / bl) * 0.08, T0[1] + (bk[1] / bl) * 0.08, T0[2] + (bk[2] / bl) * 0.08]
        }
        this.twoBone(u, l, f, T, keep)
      }
      this.fk(this.lt, this.lr, true)
    }
    // THE HANDS ON THE WHEEL (seated): each arm's two bones to its grip on the rim
    const hands = this.seat?.hands()
    if (hands) {
      const at = this.seat!.at
      const arms = [['LeftArm', 'LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm', 'RightHand']].map((l) => l.map((n) => B[n]))
      arms.forEach(([u, l, f], i) => {
        const T = [hands[i].x - at.x, hands[i].y - at.y, hands[i].z - at.z]
        // (the grip is the palm's middle: the wrist sits ~8 cm back from it, toward the elbow)
        const A0 = this.wpos(f), K0 = this.wpos(l), back = [K0[0] - A0[0], K0[1] - A0[1], K0[2] - A0[2]], bl = Math.hypot(back[0], back[1], back[2]) || 1
        const Tw = [T[0] + (back[0] / bl) * 0.08, T[1] + (back[1] / bl) * 0.08, T[2] + (back[2] / bl) * 0.08]
        this.twoBone(u, l, f, Tw, false)
      })
      this.fk(this.lt, this.lr, true)
    }
    for (let b = 0; b < this.bones.length; b++) {
      mul4(this.world[b], this.bones[b].ibm, s)
      // (first person: the head shrunk to its neck — the camera is inside it)
      if (this.hideHead && b === B.Head) { const w = this.world[b]; s.fill(0); s[12] = w[12]; s[13] = w[13]; s[14] = w[14]; s[15] = 1 }
      const o = b * 12
      // rows of the 3 × 4 (column-major s)
      this.bonesU[o] = s[0]; this.bonesU[o + 1] = s[4]; this.bonesU[o + 2] = s[8]; this.bonesU[o + 3] = s[12]
      this.bonesU[o + 4] = s[1]; this.bonesU[o + 5] = s[5]; this.bonesU[o + 6] = s[9]; this.bonesU[o + 7] = s[13]
      this.bonesU[o + 8] = s[2]; this.bonesU[o + 9] = s[6]; this.bonesU[o + 10] = s[10]; this.bonesU[o + 11] = s[14]
    }
  }

  // ============================================================================================ on foot
  /** Stand at (x, z) facing `heading`, on foot (a capsule in the world). */
  appear(x: number, z: number, heading: number, y?: number, from?: number): void {
    this.ride = null
    this.seat = null
    const R = this.physics.pw.R, world = this.physics.pw.world
    this.physics.follow(x, z)
    const gy = y ?? this.physics.surface(x, z, this.map.height(x, z), from)
    if (!this.body) {
      this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, gy + 0.9, z))
      // (the player meets the ground, the rocks, the trees, the props and the cars — never a bike: they skip Player)
      this.col = world.createCollider(R.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(group(Groups.Player, Groups.Terrain | Groups.Static | Groups.Vehicle | Groups.VehicleMesh)), this.body)
      this.cc = world.createCharacterController(0.03)
      this.cc.enableAutostep(0.45, 0.25, false)
      this.cc.enableSnapToGround(0.45)
      this.cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
      this.cc.setMinSlopeSlideAngle((55 * Math.PI) / 180)
      this.cc.setSlideEnabled(true)
    } else this.body.setTranslation({ x, y: gy + 0.9, z }, true)
    this.pos.set(x, gy, z)
    this.heading = heading
    this.vy = 0
    this.speed = 0
    this.grounded = true
    this.state = 'move'
    this.control = true
    this.root.visible = true
    this.play('idle', { fade: 0 })
  }

  /** In the DRIVER'S SEAT: the seated clip, the hips put on `hips` (car space), the hands on the rim (`hands`, car space,
   *  turning with the wheel). Moved with the car each frame. */
  sitIn(car: GFX.Object3D, hips: GFX.Vector3, hands: () => [GFX.Vector3, GFX.Vector3] | null): void {
    if (this.body) { this.physics.pw.world.removeRigidBody(this.body); this.body = null; this.col = null }
    this.ride = null
    const h = this.hipsAt('sit_drive', 0)
    this.seat = { car, at: new GFX.Vector3(hips.x - h[0], hips.y - h[1], hips.z - h[2]), hands }
    this.state = 'seated'
    this.control = false
    this.speed = 0
    this.root.visible = true
    this.play('sit_drive', { fade: 0 })
  }
  get seated(): boolean { return this.state === 'seated' && !this.ride }
  /** ON THE BIKE `b` (its root, its rider targets, its crash's thrown body): the seated clip as the base, the hips on
   *  the bike's, the body leant as the bike's rider leans, the arms to the grips and the legs to the pedals / pegs. */
  rideOn(b: { root: GFX.Object3D; riderT: { hip: number[]; lean: number; grips: number[][]; ankles: number[][] }; sim: { bail: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } | null } | null }): void {
    if (this.body) { this.physics.pw.world.removeRigidBody(this.body); this.body = null; this.col = null }
    this.seat = null
    this.ride = { root: b.root, t: b.riderT, bail: () => b.sim?.bail ?? null }
    this.state = 'seated'
    this.control = false
    this.speed = 0
    this.root.visible = true
    this.play('sit_drive', { fade: 0 })
  }
  ridingOn(root: GFX.Object3D): boolean { return this.ride?.root === root }
  /** Out of the seat (a scripted moment follows — stage / appear). */
  unseat(): void { this.seat = null }
  /** Where his EYES are (model space, the bind pose: the head's vertices — the nose the furthest forward, the eyes
   *  3.8 cm over its tip, their surface the furthest forward there) → the head bone's frame (its inverse bind). */
  private findEyes(pos: number[], _jn: number[], _wt: number[]): void {
    const H = this.bi.Head
    if (H === undefined) return
    const m = this.bones[H].ibm
    // (the head bone's place at bind: −its inverse bind's translation, turned back — its rotation is a pure turn)
    const hy = -(m[1] * m[12] + m[5] * m[13] + m[9] * m[14])
    // the NOSE's tip: the furthest forward on the centre line between the head bone and 12 cm over it (by place, not by
    // weight — the face's lower half is shared with the neck)
    let nose = -1
    for (let i = 0; i < pos.length / 3; i++) {
      const y = pos[i * 3 + 1]
      if (Math.abs(pos[i * 3]) < 0.015 && y > hy - 0.02 && y < hy + 0.12 && (nose < 0 || pos[i * 3 + 2] < pos[nose * 3 + 2])) nose = i
    }
    if (nose < 0) return
    const ey = pos[nose * 3 + 1] + 0.038
    let ez = pos[nose * 3 + 2] + 0.03
    for (let i = 0; i < pos.length / 3; i++) {
      const x = Math.abs(pos[i * 3]), y = pos[i * 3 + 1]
      if (x > 0.02 && x < 0.05 && Math.abs(y - ey) < 0.012) ez = Math.min(ez, pos[i * 3 + 2])
    }
    // (the camera 1.5 cm behind the eyes' surface, between them)
    const x = 0, y = ey, z = ez + 0.015
    this.eyeLocal[0] = m[0] * x + m[4] * y + m[8] * z + m[12]
    this.eyeLocal[1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    this.eyeLocal[2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  }
  /** His eyes' place in the world (first person's camera): on the head bone — it turns and leans with the head. */
  headWorld(out: GFX.Vector3): GFX.Vector3 {
    const w = this.world[this.bi.Head], e = this.eyeLocal
    out.set(w[0] * e[0] + w[4] * e[1] + w[8] * e[2] + w[12], w[1] * e[0] + w[5] * e[1] + w[9] * e[2] + w[13], w[2] * e[0] + w[6] * e[1] + w[10] * e[2] + w[14])
    return out.applyMatrix4(this.root.matrixWorld)
  }
  /** His eyes in model space (the harness: the camera's check). */
  get eyeModel(): number[] { const o = new GFX.Vector3(); this.headWorld(o); o.applyMatrix4(this.root.matrixWorld.clone().invert()); return [o.x, o.y, o.z] }

  /** Off the screen (in a vehicle): the capsule out of the world. */
  hide(): void {
    this.seat = null
    this.ride = null
    this.state = 'hidden'
    this.root.visible = this.shadow.visible = false
    if (this.body) { this.physics.pw.world.removeRigidBody(this.body); this.body = null; this.col = null }
  }

  /** (co-op) ANOTHER PLAYER'S WALKER, posed from the network (net/Session's smoothing — Remotes.ts): no controller,
   *  no keys, no body in the physics; the locomotion blend by the speed they move at, turning as they turn. */
  puppet(x: number, y: number, z: number, heading: number, speed: number, dt: number): void {
    if (this.body) { this.physics.pw.world.removeRigidBody(this.body); this.body = null; this.col = null }
    this.seat = null
    this.ride = null
    this.control = false
    const turn = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading))
    this.heading = heading
    const k = Math.min(1, dt * 10)
    this.turnRate += (turn / Math.max(dt, 1e-3) - this.turnRate) * k
    this.speed += (Math.min(9, speed) - this.speed) * Math.min(1, dt * 8)
    this.pos.set(x, y, z)
    this.grounded = true
    if (this.state !== 'move') { this.state = 'move'; this.root.visible = true; this.play('loco' as ClipName, { fade: 0.2 }) }
  }

  /** Shown at a place without the controller (a scripted moment: getting in or out — main.ts moves it). */
  stage(x: number, y: number, z: number, heading: number): void {
    this.seat = null
    this.ride = null
    if (this.body) { this.physics.pw.world.removeRigidBody(this.body); this.body = null; this.col = null }
    this.pos.set(x, y, z)
    this.heading = heading
    this.state = 'action'
    this.control = false
    this.root.visible = true
  }

  get moving(): boolean { return this.speed > 0.3 }
  /** Moved by (dx, dy, dz) (the crossing between worlds). */
  shift(dx: number, dy: number, dz: number): void {
    this.pos.x += dx; this.pos.y += dy; this.pos.z += dz
    if (this.body) { const t = this.body.translation(); this.body.setTranslation({ x: t.x + dx, y: t.y + dy, z: t.z + dz }, true) }
  }
  /** What the chase camera and the HUD read (as a vehicle's sim): heading, ground speed. */
  get sim(): { heading: number; speed: number } | null { return this.state === 'hidden' ? null : { heading: this.heading, speed: this.speed } }
  /** On the ground and free (a safe spot to save at). */
  isGrounded(): boolean { return this.grounded && this.state === 'move' }
  get rigid(): unknown { return this.body }

  /** Fixed step (60 Hz): the keys, the controller, gravity, the jump. */
  fixed(dt: number): void {
    if (this.state === 'hidden' || this.state === 'action' || !this.body) return
    this.physics.follow(this.pos.x, this.pos.z)
    const k = this.keys, T = this.touch
    let ix = 0, iz = 0
    if (this.control) {
      iz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + T.my
      ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + T.mx
    }
    const mag = Math.min(1, Math.hypot(ix, iz))
    const stick = Math.hypot(T.mx, T.my)
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || T.sprint > 0 || stick > 0.96, walk = k.has('ControlLeft') || k.has('ControlRight') || (stick > 0.05 && stick < 0.5)
    // (the stick: a little = walk, most of the way = run, pushed to its edge = sprint)
    const target = mag < 0.05 ? 0 : walk ? 1.7 : sprint ? 7.2 : 4.6
    // the way the keys point, from the camera's view; the body turns toward it
    // WEIGHT (GTA's): the body turns toward the way the keys point — quickly standing, slower the faster it goes (a
    // sprint swings wide) — and gets up to speed / stops with momentum, slower uphill
    const h0 = this.heading
    if (mag > 0.05) {
      const want = this.camYaw + Math.atan2(-ix, iz)
      let d = want - this.heading
      d = Math.atan2(Math.sin(d), Math.cos(d))
      const rate = 11 - 6 * Math.min(1, Math.max(0, (this.speed - 2) / 5))
      this.heading += Math.max(-dt * rate, Math.min(dt * rate, d * Math.min(1, dt * 12)))
    }
    this.turnRate += ((Math.atan2(Math.sin(this.heading - h0), Math.cos(this.heading - h0)) / dt) - this.turnRate) * Math.min(1, dt * 10)
    let goal = target
    if (goal > 0 && this.grounded) {
      const ax = this.pos.x - Math.sin(this.heading) * 0.6, az = this.pos.z - Math.cos(this.heading) * 0.6
      const grade = (this.map.height(ax, az) - this.map.height(this.pos.x, this.pos.z)) / 0.6
      if (grade > 0.08) goal *= Math.max(0.55, 1 - (grade - 0.08) * 0.9)
    }
    const acc = !this.grounded ? 3 : goal > this.speed ? 9 : 13
    const sp0 = this.speed
    this.speed += Math.max(-acc * dt, Math.min(acc * dt, goal - this.speed))
    this.accel += ((this.speed - sp0) / dt - this.accel) * Math.min(1, dt * 8)
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading)
    // JUMP (Space / JUMP): ~0.65 m, in step with its clip — standing, the crouch first (the clip from its knees bending
    // at 0.25 s, the feet leaving at its 0.5 s); running, at once (its feet off at 0.05 s). The clip's air time
    // played over the physics' (2·v₀/g = 0.53 s).
    const wantJump = this.control && (k.has('Space') || T.hop > 0)
    if (wantJump && this.grounded && this.state === 'move' && !this.jumpHeld) {
      this.state = 'jump'
      // (the clip from a moment before its feet leave — a short crouch standing, none running — its air played over the
      //  physics' 2·v₀/g = 0.53 s)
      const name: ClipName = this.speed > 2.5 ? 'jump_run' : 'jump'
      const [up, dn] = this.air.get(name) ?? [0.3, 0.9]
      const rate = Math.max(0.6, Math.min(2.2, (dn - up) / 0.53)), lead = name === 'jump' ? 0.18 : 0.06
      this.play(name, { fade: 0.1, rate, at: Math.max(0, up - lead * rate) })
      this.layer(name === 'jump' ? 'idle' : 'run', 0.65)
      this.takeoff = Math.max(0.001, lead)
    }
    this.jumpHeld = wantJump
    if (this.takeoff > 0 && (this.takeoff -= dt) <= 0) { this.takeoff = 0; this.vy = 4.8; this.grounded = false }
    this.vy -= 18 * dt
    if (this.grounded && this.vy < 0) this.vy = -2
    const t = this.body.translation()
    const desired = { x: fx * this.speed * dt, y: this.vy * dt, z: fz * this.speed * dt }
    this.cc.computeColliderMovement(this.col, desired, undefined, group(Groups.Player, Groups.Terrain | Groups.Static | Groups.Vehicle | Groups.VehicleMesh))
    const mv = this.cc.computedMovement()
    const was = this.grounded
    this.grounded = this.cc.computedGrounded()
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z }
    // (never under the ground: the terrain streams in ahead of the physics)
    const gh = this.map.height(next.x, next.z)
    if (next.y - 0.9 < gh - 0.3) { next.y = gh + 0.9; this.vy = 0; this.grounded = true }
    this.body.setNextKinematicTranslation(next)
    this.pos.set(next.x, next.y - 0.85, next.z)
    // FALLING (off a ledge, or a jump that goes on): the jump's tucked pose held — no flailing skydive
    if (!this.grounded) {
      this.airT += dt
      // (a fall: the jump's top held)
      if (this.airT > 0.75 && this.state !== 'air') { this.state = 'air'; const [up, dn] = this.air.get('jump') ?? [0.5, 1.1]; this.play('jump', { fade: 0.3, rate: 0, at: (up + dn) / 2 }) }
    }
    else {
      if (!was && this.airT > 0.12) {
        this.vy = 0
        // a real drop lands into a crouch; a jump just runs on (its clip has its own landing)
        if (this.airT > 0.9) { this.state = 'land'; this.speed *= 0.4; this.play('land', { fade: 0.1, rate: 1.7, at: 0.25, then: () => { this.state = 'move' } }) }
        else if (this.state === 'jump' || this.state === 'air') this.state = mag > 0.05 ? 'move' : 'jump'
      }
      this.airT = 0
      // (the standing jump's landing played out, unless moving off)
      if (this.state === 'jump' && this.takeoff === 0 && this.grounded && (mag > 0.05 || this.progress > 0.88)) this.state = 'move'
    }
    // LOCOMOTION: the clip by the speed, played as fast as the feet must go
    if (this.state === 'move' && this.upper) this.layer(null)
    // LOCOMOTION: the one blend (idle / walk / run / sprint by the speed, on one stride phase — Character.sampleLoco)
    if (this.state === 'move') this.play('loco' as ClipName, { fade: 0.25 })
  }

  /** The upper-body layer on (a clip, its weight) or off. */
  private layer(name: ClipName | null, w = 0.7): void {
    const c = name ? this.clips.get(name) : null
    this.upper = c ? { clip: c, t: this.upper?.clip === c ? this.upper.t : 0, w } : null
  }

  /** A one-off (picking something up, a grab): the controller still, the clip played, then free again. */
  act(name: ClipName, rate = 1, then?: () => void): void {
    if (this.state !== 'move') return
    this.state = 'land'
    this.speed = 0
    this.play(name, { fade: 0.15, rate, then: () => { this.state = 'move'; then?.() } })
  }

  private readonly viewSphere = new GFX.Sphere(new GFX.Vector3(), 1.5)
  cull(view: GFX.Frustum, horizon: Horizon): void {
    if (this.state === 'hidden') return
    if (this.seat) { this.root.visible = (this.seat.car as GFX.Object3D).visible; return }
    if (this.ride) { this.root.visible = this.ride.root.visible || !!this.ride.bail(); return }
    const p = this.pos
    this.viewSphere.center.set(p.x, p.y + 0.9, p.z)
    this.root.visible = view.intersectsSphere(this.viewSphere) && !horizon.hidden(p.x - 2, p.z - 2, p.x + 2, p.z + 2, p.y + 2)
  }

  /** Render frame: the clips advanced, the bones, the place, the contact shadow. */
  update(dt: number): void {
    if (this.state === 'hidden' || !this.mesh) return
    this.pose(dt)
    if (this.ride) {
      const bl = this.ride.bail()
      if (bl) {
        // (thrown off: carried by the crash's body — its middle 0.9 m over the feet — falling)
        if (this.playing !== 'fall') this.play('fall', { fade: 0.15 })
        this.root.quaternion.set(bl.qx, bl.qy, bl.qz, bl.qw)
        this.root.position.set(0, -0.9, 0).applyQuaternion(this.root.quaternion).add(new GFX.Vector3(bl.x, bl.y, bl.z))
      } else {
        if (this.playing !== 'sit_drive') this.play('sit_drive', { fade: 0.2 })
        this.root.quaternion.copy(this.ride.root.quaternion)
        this.root.position.copy(this.ride.root.position)
      }
      this.pos.copy(this.root.position)
      this.root.updateMatrixWorld(true)
      this.shadow.visible = false
      return
    }
    if (this.seat) {
      // (seated: carried by the car — its turn, its place)
      const c = this.seat.car
      this.root.quaternion.copy(c.quaternion)
      this.root.position.copy(this.seat.at).applyQuaternion(c.quaternion).add(c.position)
      this.pos.copy(this.root.position)
      this.root.updateMatrixWorld(true)
      this.shadow.visible = false
      return
    }
    this.root.position.copy(this.pos)
    this.root.quaternion.setFromAxisAngle(new GFX.Vector3(0, 1, 0), this.heading)
    this.root.updateMatrixWorld(true)
    const sp = this.shadow.geometry.attributes.position as GFX.BufferAttribute
    const a = sp.array as Float32Array, base = this.shadowBase
    for (let i = 0; i < sp.count; i++) {
      const x = this.pos.x + base[i * 3] * 0.9, z = this.pos.z + base[i * 3 + 2] * 0.9
      a[i * 3] = x; a[i * 3 + 1] = this.map.height(x, z) + 0.03; a[i * 3 + 2] = z
    }
    sp.needsUpdate = true
    this.shadow.visible = this.root.visible && this.pos.y - this.map.height(this.pos.x, this.pos.z) < 2
  }
}
