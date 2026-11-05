import * as GFX from './gfx'
import { MTB, type MtbSimApi, type MtbState } from '../gameplay/vehicle/mtbTypes'
import { blendRoughness, Surf, type SurfaceMix } from '../gameplay/vehicle/drivetrain/tyre'
import type { Atmosphere } from './Atmosphere'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import { VEHICLE_FRAG_SRC } from './Vehicle'

/**
 * THE MOUNTAIN BIKE (2026-11-05, the user: "a mountain bike like the stunt bike in GTA 5 … each and every physics for
 * the bike, the shock absorber and all"): the model (scripts/oth/mtb.py → mtb.glb, our own), the physics
 * (gameplay/vehicle/MtbSim.ts) and its RIDER, drawn here in this world's light with the car's own surface shader.
 *
 * ONE DRAW for the bike and the rider: every part of the model (frame, bars, fork lowers, wheels, swingarm, the shock's
 * two halves, cranks, pedals, chain, the rider's 12 segments) merged into one mesh whose vertices carry their part's
 * index; each frame the parts' poses (3 × 4 affine, bike space) go up as one uniform array, the vertex shader moves
 * each vertex by its own. The poses come from the physics state and mtb.geometry.json: the bars and the fork turn
 * about the steering axis, the lowers and the front wheel slide up it, the swingarm turns about its pivot carrying the
 * rear wheel and the chain, the shock's body and shaft aim at each other and telescope, the cranks turn with the
 * cadence (and stand still coasting), the pedals stay level. The RIDER by two-bone IK: hips on the saddle (or up out of
 * it), the torso leaning until the hands reach the grips, feet on the pedals, knees forward, elbows out; crouching to
 * load a hop, standing in the air, a foot down at a stop; thrown off in a crash (the physics' bail body).
 */

/** Part indices — the vertex attribute `aPart` and the pose array's order. */
const PARTS = ['frame', 'steer', 'fork_lowers', 'wheel_front', 'wheel_rear', 'swingarm', 'shock_body', 'shock_shaft', 'crank', 'pedal_r', 'pedal_l', 'chain',
  'r_torso', 'r_head', 'r_upperarm_l', 'r_upperarm_r', 'r_forearm_l', 'r_forearm_r', 'r_thigh_l', 'r_thigh_r', 'r_shin_l', 'r_shin_r', 'r_foot_l', 'r_foot_r'] as const
type Part = (typeof PARTS)[number]
const NP = PARTS.length
const PI = Object.fromEntries(PARTS.map((p, i) => [p, i])) as Record<Part, number>

// ------------------------------------------------------------------------------------------------- small affine math
/** A 3 × 4 affine pose: rotation rows r0..r2 (each [x, y, z]) and the translation t. */
type Pose = { r: Float64Array; t: Float64Array }
const pose = (): Pose => ({ r: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: new Float64Array(3) })
type V3 = [number, number, number]
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
/** p's rotation applied to v. */
const rot = (p: Pose, v: V3): V3 => [p.r[0] * v[0] + p.r[1] * v[1] + p.r[2] * v[2], p.r[3] * v[0] + p.r[4] * v[1] + p.r[5] * v[2], p.r[6] * v[0] + p.r[7] * v[1] + p.r[8] * v[2]]
const apply = (p: Pose, v: V3): V3 => add(rot(p, v), [p.t[0], p.t[1], p.t[2]])
function setT(p: Pose, t: V3): Pose { p.t[0] = t[0]; p.t[1] = t[1]; p.t[2] = t[2]; return p }
function ident(p: Pose): Pose { p.r.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); p.t.fill(0); return p }
/** Rotation about a unit axis (Rodrigues), as rows. */
function axisRot(p: Pose, a: V3, ang: number): Pose {
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, [x, y, z] = a
  p.r.set([t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c])
  return p
}
/** The geometry's R(a) (mtb.geometry.json `rotation`): (y, z) → (y cos a + z sin a, −y sin a + z cos a). */
function rX(p: Pose, a: number): Pose { const c = Math.cos(a), s = Math.sin(a); p.r.set([1, 0, 0, 0, c, s, 0, -s, c]); return p }
/** out = a · b. */
function mul(out: Pose, a: Pose, b: Pose): Pose {
  const A = a.r, B = b.r, r = new Float64Array(9)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]
  const t = apply(a, [b.t[0], b.t[1], b.t[2]])
  out.r.set(r); setT(out, t)
  return out
}
/** A basis whose local −y is `down` (normalised) and whose local −z leans toward `front` (made perpendicular). */
function boneBasis(p: Pose, down: V3, front: V3): Pose {
  const y = norm([-down[0], -down[1], -down[2]])
  let z = sub(front, [y[0] * dot(front, y), y[1] * dot(front, y), y[2] * dot(front, y)])
  if (len(z) < 1e-6) z = Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  z = norm([-z[0], -z[1], -z[2]]) // (the front is local −z)
  const x = cross(y, z)
  // rows of the rotation matrix whose COLUMNS are x, y, z
  p.r.set([x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]])
  return p
}
/** Two-bone IK: from the root a toward the target t, bones l1 and l2, the joint bending toward `pole`. The middle
 *  joint's place. */
function ik(a: V3, t: V3, l1: number, l2: number, pole: V3): V3 {
  const d0 = sub(t, a), dl = len(d0)
  const d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, dl))
  const u: V3 = dl > 1e-6 ? [d0[0] / dl, d0[1] / dl, d0[2] / dl] : [0, -1, 0]
  let w = sub(pole, [u[0] * dot(pole, u), u[1] * dot(pole, u), u[2] * dot(pole, u)])
  w = len(w) < 1e-6 ? norm(cross(u, [1, 0, 0])) : norm(w)
  const ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca))
  return add(a, add([u[0] * ca * l1, u[1] * ca * l1, u[2] * ca * l1], w, sa * l1))
}

// ------------------------------------------------------------------------------------------------- the geometry
const G = MTB
const AX = G.steer.axis as V3
const CROWN = G.steer.crown as V3
const FRONT = G.frontAxle as V3
const REAR = G.rearAxle as V3
const PIVOT = G.rear.pivot as V3
const SFM = G.rear.shockFrameMount as V3
const SSM = G.rear.shockSwingarmMount as V3
const BB = G.bb as V3
const RD = G.rider

/** The merged mesh's attributes from the model's parts (each part's vertices in its own frame, origin at its pivot). */
interface Built { pos: number[]; nor: number[]; col: number[]; paint: number[]; part: number[]; idx: number[] }

function fromGltf(scene: GFX.Object3D, out: Built): Set<Part> {
  const found = new Set<Part>()
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    const m = o as GFX.Mesh
    if (!m.isMesh) return
    // the part: the node's own name, or a primitive's (`name_0`, `name_1` …)
    const base = m.name.replace(/_\d+$/, '')
    const part = (PARTS as readonly string[]).includes(m.name) ? (m.name as Part) : (PARTS as readonly string[]).includes(base) ? (base as Part) : null
    if (part === null) return
    found.add(part)
    const g = m.geometry, P = g.attributes.position, N = g.attributes.normal
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as GFX.MeshStandardMaterial
    const c = mat?.color ?? new GFX.Color(1, 1, 1)
    const isPaint = /^Paint/i.test(mat?.name ?? '')
    // (vertices in the PART's frame: the mesh's own transform without the node's translation to its pivot — the model
    //  has identity rotations; a parent's transform (none expected) kept)
    const wm = m.matrixWorld.clone(), e = wm.elements
    e[12] = e[13] = e[14] = 0
    const base0 = out.pos.length / 3, v = new GFX.Vector3(), n = new GFX.Vector3()
    for (let i = 0; i < P.count; i++) {
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(wm)
      out.pos.push(v.x, v.y, v.z)
      if (N) { n.set(N.getX(i), N.getY(i), N.getZ(i)).transformDirection(wm); out.nor.push(n.x, n.y, n.z) } else out.nor.push(0, 1, 0)
      out.col.push(c.r, c.g, c.b)
      out.paint.push(isPaint ? 1 : 0)
      out.part.push(PI[part])
    }
    if (g.index) for (const k of g.index.array) out.idx.push(base0 + k)
    else for (let i = 0; i < P.count; i++) out.idx.push(base0 + i)
  })
  return found
}

/** Stand-ins for any part the model lacks (and the whole bike before mtb.glb exists): tubes and boxes from the
 *  geometry file, each in its part's frame. */
function placeholders(out: Built, missing: Set<Part>): void {
  const col: Record<string, V3> = { paint: [0.62, 0.22, 0.08], dark: [0.05, 0.05, 0.055], alloy: [0.6, 0.62, 0.64], gold: [0.75, 0.5, 0.18], rubber: [0.04, 0.035, 0.03], jersey: [0.08, 0.3, 0.42], shorts: [0.12, 0.13, 0.12], skin: [0.62, 0.42, 0.3], helmet: [0.85, 0.82, 0.74] }
  const tube = (part: Part, a: V3, b: V3, r: number, c: V3, paint = 0, sides = 8) => {
    const d = sub(b, a), L = len(d)
    if (L < 1e-5) return
    const u = norm(d), t0 = norm(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t1 = cross(u, t0)
    const base = out.pos.length / 3
    for (let k = 0; k <= sides; k++) {
      const ang = (k / sides) * Math.PI * 2, nx = add([t0[0] * Math.cos(ang), t0[1] * Math.cos(ang), t0[2] * Math.cos(ang)], t1, Math.sin(ang))
      for (const e of [a, b]) {
        out.pos.push(e[0] + nx[0] * r, e[1] + nx[1] * r, e[2] + nx[2] * r)
        out.nor.push(...nx); out.col.push(...c); out.paint.push(paint); out.part.push(PI[part])
      }
      if (k < sides) { const q = base + k * 2; out.idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3) }
    }
  }
  const ring = (part: Part, at: V3, R: number, r: number, c: V3, n = 20) => {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2
      tube(part, [at[0], at[1] + Math.cos(a0) * R, at[2] + Math.sin(a0) * R], [at[0], at[1] + Math.cos(a1) * R, at[2] + Math.sin(a1) * R], r, c, 0, 6)
    }
  }
  const o: V3 = [0, 0, 0]
  const want = (p: Part) => missing.has(p)
  if (want('frame')) {
    const seatTop = G.seat.saddleTop as V3, htB = G.steer.headTubeBottom as V3, htT = G.steer.headTubeTop as V3
    const seatJ = lerp3(BB, seatTop, 0.78)
    tube('frame', BB, htB, 0.024, col.paint, 1)
    tube('frame', seatJ, htT, 0.02, col.paint, 1)
    tube('frame', BB, seatTop, 0.017, col.paint, 1)
    tube('frame', htB, htT, 0.025, col.paint, 1)
    tube('frame', add(seatTop, [0, 0, -0.13]), add(seatTop, [0, 0.01, 0.14]), 0.035, col.dark)
  }
  if (want('steer')) {
    const c0 = sub(CROWN, CROWN), top = sub(G.steer.steererTop as V3, CROWN)
    tube('steer', c0, top, 0.016, col.dark)
    for (const sx of [-1, 1]) tube('steer', [sx * G.fork.stanchionHalfSpacing, 0, 0], add([sx * G.fork.stanchionHalfSpacing, 0, 0], AX, -0.2), 0.018, col.gold)
    const [gl, gr] = G.bar.grips as V3[]
    tube('steer', sub(gl, CROWN), sub(gr, CROWN), 0.012, col.dark)
    tube('steer', sub(add(gl, [-0.04, 0, 0]), CROWN), sub(add(gl, [0.07, 0, 0]), CROWN), 0.017, col.rubber)
    tube('steer', sub(add(gr, [0.04, 0, 0]), CROWN), sub(add(gr, [-0.07, 0, 0]), CROWN), 0.017, col.rubber)
  }
  if (want('fork_lowers')) for (const sx of [-1, 1]) tube('fork_lowers', [sx * G.fork.stanchionHalfSpacing, 0, 0], add([sx * G.fork.stanchionHalfSpacing, 0, 0], AX, G.fork.lowersLength), 0.024, col.dark)
  if (want('wheel_front')) { ring('wheel_front', o, G.wheel.radius - 0.03, 0.03, col.rubber); ring('wheel_front', o, G.wheel.rimRadius, 0.012, col.dark) }
  if (want('wheel_rear')) { ring('wheel_rear', o, G.wheel.radius - 0.03, 0.03, col.rubber); ring('wheel_rear', o, G.wheel.rimRadius, 0.012, col.dark) }
  if (want('swingarm')) {
    const ax = sub(REAR, PIVOT), sm = sub(SSM, PIVOT)
    for (const sx of [-1, 1]) { tube('swingarm', [sx * 0.05, 0, 0], [sx * 0.07, ax[1], ax[2]], 0.014, col.paint, 1); tube('swingarm', [sx * 0.04, sm[1], sm[2]], [sx * 0.07, ax[1], ax[2]], 0.012, col.paint, 1) }
  }
  if (want('shock_body')) tube('shock_body', o, [0, 0, 0.13], 0.024, col.dark)
  if (want('shock_shaft')) tube('shock_shaft', o, [0, 0, -0.12], 0.008, col.gold)
  if (want('crank')) { tube('crank', [0.07, 0, 0], [0.07, 0, -G.crank.length], 0.012, col.dark); tube('crank', [-0.07, 0, 0], [-0.07, 0, G.crank.length], 0.012, col.dark); ring('crank', o, G.crank.chainringRadius, 0.004, col.dark, 16) }
  for (const p of ['pedal_r', 'pedal_l'] as const) if (want(p)) tube(p, [-0.05, 0, 0], [0.05, 0, 0], 0.03, col.dark, 0, 4)
  if (want('chain')) tube('chain', [G.crank.chainlineX, G.crank.chainringRadius, 0], [G.crank.chainlineX, 0.05, REAR[2] - BB[2]], 0.004, col.dark, 0, 4)
  const limb = (p: Part, L: number, r0: number, r1: number, c: V3) => { tube(p, [0, r0 * 0.5, 0], [0, -L, 0], (r0 + r1) / 2, c) }
  if (want('r_torso')) { tube('r_torso', [0, -0.02, 0], [0, RD.spine, 0], 0.13, col.jersey); tube('r_torso', [-RD.shoulderHalfWidth, RD.spine - 0.02, 0], [RD.shoulderHalfWidth, RD.spine - 0.02, 0], 0.06, col.jersey) }
  if (want('r_head')) { tube('r_head', [0, 0, 0], [0, RD.head * 0.5, 0], 0.05, col.skin); tube('r_head', [0, RD.head * 0.45, 0.01], [0, RD.head, 0.01], 0.12, col.helmet) }
  for (const s of ['l', 'r'] as const) {
    if (want(`r_upperarm_${s}`)) limb(`r_upperarm_${s}`, RD.upperArm, 0.05, 0.045, col.jersey)
    if (want(`r_forearm_${s}`)) limb(`r_forearm_${s}`, RD.forearm + RD.handToGrip, 0.04, 0.035, col.skin)
    if (want(`r_thigh_${s}`)) limb(`r_thigh_${s}`, RD.thigh, 0.075, 0.06, col.shorts)
    if (want(`r_shin_${s}`)) limb(`r_shin_${s}`, RD.shin, 0.055, 0.045, col.dark)
    if (want(`r_foot_${s}`)) tube(`r_foot_${s}`, [0, -RD.ankleHeight * 0.5, 0.06], [0, -RD.ankleHeight * 0.5, -RD.footLength + 0.06], 0.045, col.dark, 0, 6)
  }
}

// ------------------------------------------------------------------------------------------------- the shader
const VERT = /* glsl */ `
in float paintMask;
in float aPart;
// the parts' poses: 3 rows (vec4: rotation | translation) each, bike space
uniform vec4 uParts[${NP * 3}];
out vec3 vWorld;
out vec3 vLocal;
out vec3 vN;
out vec2 vUv;
out vec3 vCol;
out float vPaint;
void main() {
  int k = int(aPart + 0.5) * 3;
  vec4 r0 = uParts[k], r1 = uParts[k + 1], r2 = uParts[k + 2];
  vec3 b = vec3(dot(r0.xyz, position) + r0.w, dot(r1.xyz, position) + r1.w, dot(r2.xyz, position) + r2.w);
  vec3 bn = vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal));
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
  vPaint = paintMask;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

/** The ground's surface mix for the tyres (the car's own reading of the map — Vehicle.surfaceAt — kept in step). */
export function surfaceOf(map: MapData, wet: number, x: number, z: number, out: SurfaceMix, mk: [number, number, number, number]): void {
  const w = out.w
  w.fill(0)
  out.wet = wet
  out.wash = 0
  if (map.bridgeAt(x, z) !== null) { w[Surf.Asphalt] = 0.7; w[Surf.Dirt] = 0.3; blendRoughness(out); return }
  const m = map.maskAt(x, z, mk)
  const track = Math.max(0, Math.min(1, (map.meta.trails.hw + 0.3 - map.trailDist(x, z)) / 0.6))
  const water = m[2] > 0.9 ? 1 : 0
  const rock = Math.min(1, m[0] * 1.5) * (1 - track)
  const loose = map.desert ? Math.max(0, m[1] - 0.4) / 0.6 * (1 - track) * (1 - rock) : 0 // (the desert's loose sand: mask G)
  const rest = Math.max(0, 1 - track - water - rock - loose)
  w[Surf.Dirt] = track * (1 - 0.5 * wet) + rock * 0.4
  w[Surf.Mud] = track * 0.5 * wet
  w[Surf.Sand] = water + loose
  w[Surf.Asphalt] = rock * 0.6
  w[Surf.Grass] = rest
  const mud = map.mudAt(x, z) * (1 - water)
  if (mud > 0.01) { for (let k = 0; k < w.length; k++) w[k] *= 1 - mud; w[Surf.Mud] += mud }
  blendRoughness(out)
  out.stones *= 1 + rock
}

export class Bike {
  readonly root = new GFX.Group()
  sim: MtbSimApi | null = null
  readonly pos = new GFX.Vector3()
  /** Touch controls (main.ts's pads): −1 … 1 / 0 … 1. */
  readonly touch = { gas: 0, brake: 0, left: 0, right: 0, hop: 0, lean: 0 }
  /** How wet the land is (the weather): the tyres' grip. */
  wet = 0
  private mesh: GFX.Mesh | null = null
  private readonly uniforms: Record<string, GFX.IUniform>
  private readonly partsU: Float32Array = new Float32Array(NP * 12)
  private readonly poses: Pose[] = PARTS.map(() => pose())
  private readonly shadow: GFX.Mesh
  private readonly shadowBase: Float32Array
  private readonly keys = new Set<string>()
  private readonly mk: [number, number, number, number] = [0, 0, 0, 0]
  private readonly prevP = new GFX.Vector3()
  private readonly curP = new GFX.Vector3()
  private readonly prevQ = new GFX.Quaternion()
  private readonly curQ = new GFX.Quaternion()
  /** The last two steps' drawn state (interpolated like the pose). */
  private prevS: Snap = snap()
  private curS: Snap = snap()
  private pedalK = 0
  private brakeK = 0
  private steerK = 0
  private steerHold = 0
  private leanK = 0
  /** 0 … 1: a foot down at a stop (eased). */
  private dab = 0
  /** Made the sim (MtbSim, given by main.ts — the physics module loads with the game). */
  makeSim: ((physics: OthPhysics) => MtbSimApi) | null = null

  constructor(private readonly map: MapData, private readonly physics: OthPhysics, atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4) {
    this.uniforms = {
      ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, uMap: { value: null }, uPaintMask: { value: null },
      uPaint: { value: new GFX.Color(1, 1, 1) }, uSunHere: { value: 1 }, uCoat: { value: 0 }, uCoatColor: { value: new GFX.Color(0.8, 0.6, 0.42) }, uCarBase: { value: 0 },
      'uParts[0]': { value: this.partsU },
    }
    // the contact shadow: a grid laid on the ground under the bike, darkest under it, soft at the edge
    const sg = new GFX.PlaneGeometry(1, 1, 6, 12).rotateX(-Math.PI / 2)
    this.shadow = new GFX.Mesh(sg, new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { uMist: atmos.uniforms.uMist },
      vertexShader: /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `layout(location = 0) out highp vec4 outColor; in vec2 vUv; uniform float uMist;
        void main() { vec2 q = (vUv - 0.5) * 2.0; float d = length(q); outColor = vec4(0.06, 0.04, 0.05, 0.55 * (1.0 - smoothstep(0.3, 1.0, d)) * (1.0 - 0.75 * uMist * uMist)); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }))
    this.shadow.frustumCulled = false
    this.shadow.renderOrder = 2
    this.shadowBase = (sg.attributes.position.array as Float32Array).slice()
    this.root.visible = this.shadow.visible = false
    window.addEventListener('keydown', (e) => { this.keys.add(e.code) })
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code) })
    window.addEventListener('blur', () => this.keys.clear())
  }

  get shadowMesh(): GFX.Mesh { return this.shadow }

  /** The model (mtb.glb), merged into the one mesh; parts it lacks stand in as tubes (and the whole bike while the
   *  model isn't there). */
  async load(url: string | null): Promise<void> {
    const out: Built = { pos: [], nor: [], col: [], paint: [], part: [], idx: [] }
    let found = new Set<Part>()
    if (url) {
      try { found = fromGltf((await new GFX.GLTFLoader().loadAsync(url)).scene, out) } catch (e) { console.warn('[bike] the model failed to load — stand-ins', e) }
    }
    placeholders(out, new Set(PARTS.filter((p) => !found.has(p))))
    const g = new GFX.BufferGeometry()
    g.setAttribute('position', new GFX.Float32BufferAttribute(out.pos, 3))
    g.setAttribute('normal', new GFX.Float32BufferAttribute(out.nor, 3))
    g.setAttribute('color', new GFX.Float32BufferAttribute(out.col, 3))
    g.setAttribute('paintMask', new GFX.Float32BufferAttribute(out.paint, 1))
    g.setAttribute('aPart', new GFX.Float32BufferAttribute(out.part, 1))
    g.setIndex(out.idx)
    g.computeBoundingSphere()
    const mat = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: this.uniforms, defines: { OTH_SPEC: '', MIST_K: '0.45' }, vertexShader: VERT, fragmentShader: VEHICLE_FRAG_SRC(), vertexColors: true })
    this.mesh = new GFX.Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.root.add(this.mesh)
    this.restPose()
  }

  /** Take the bike out at (x, z), facing `heading`: the physics made, the rider on. */
  mount(x: number, z: number, heading: number): void {
    if (!this.makeSim) return
    this.sim?.dispose()
    const sim = (this.sim = this.makeSim(this.physics))
    sim.surface = (px, pz, out) => surfaceOf(this.map, this.wet, px, pz, out, this.mk)
    this.physics.follow(x, z)
    sim.place(x, this.physics.surface(x, z, this.map.height(x, z)), z, heading)
    this.readPose(this.curP, this.curQ)
    this.prevP.copy(this.curP); this.prevQ.copy(this.curQ)
    this.curS = this.prevS = read(sim)
    this.root.visible = true
  }

  /** Put the bike away (on the car): the physics gone. */
  dismount(): void {
    this.sim?.dispose()
    this.sim = null
    this.root.visible = this.shadow.visible = false
  }

  /** Moved by (dx, dy, dz) as it rides (the crossing). */
  shift(dx: number, dy: number, dz: number): void {
    if (!this.sim) return
    this.sim.shift(dx, dy, dz)
    for (const p of [this.curP, this.prevP]) { p.x += dx; p.y += dy; p.z += dz }
    this.physics.follow(this.sim.body.translation().x, this.sim.body.translation().z)
  }

  /** R: back on (after a crash), or stood up where it is. */
  reset(): void {
    if (!this.sim) return
    if (this.sim.crashed) { this.sim.remount(); return }
    const t = this.sim.body.translation()
    this.sim.place(t.x, this.physics.surface(t.x, t.z, Math.max(this.map.height(t.x, t.z), t.y - 1.5)), t.z, this.sim.heading)
  }

  /** Fixed step (60 Hz): the keys eased into the rider's hands and feet, the physics, the water. */
  fixed(dt: number): void {
    const sim = this.sim
    if (!sim) return
    const k = this.keys, T = this.touch
    const t = sim.body.translation()
    this.physics.follow(t.x, t.z)
    const gas = Math.max(k.has('KeyW') ? 1 : 0, T.gas), brk = Math.max(k.has('KeyS') ? 1 : 0, T.brake)
    // (as a foot and a hand: the pedal comes on over 0.35 s, the brake lever over 0.2 s)
    this.pedalK = gas > 0 ? Math.min(gas, this.pedalK + dt / 0.35) : Math.max(0, this.pedalK - dt / 0.15)
    this.brakeK = brk > 0 ? Math.min(brk, this.brakeK + dt / 0.2) : Math.max(0, this.brakeK - dt / 0.1)
    const ad = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + T.right - T.left
    const st = this.steerK
    if (ad === 0 || (st !== 0 && Math.sign(ad) !== Math.sign(st))) {
      const d = dt / 0.14
      this.steerK = Math.abs(st) <= d ? 0 : st - Math.sign(st) * d
      this.steerHold = 0
    } else {
      this.steerHold = Math.min(1, this.steerHold + dt / 0.35)
      this.steerK = Math.sign(ad) * Math.max(Math.abs(st), this.steerHold * this.steerHold * (3 - 2 * this.steerHold))
    }
    const lean = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0) + T.lean
    this.leanK += (Math.max(-1, Math.min(1, lean)) - this.leanK) * Math.min(1, dt / 0.12)
    const c = sim.controls
    c.pedal = this.pedalK
    c.brake = this.brakeK
    c.steer = this.steerK
    c.lean = this.leanK
    c.hop = k.has('Space') || T.hop > 0
    c.sprint = k.has('ShiftLeft') || k.has('ShiftRight')
    this.readPose(this.prevP, this.prevQ)
    this.prevS = this.curS
    sim.step(dt)
    // (never under the ground — a fast bike can outrun the physics' streamed ground: MtbSim.keepAbove, as the car's)
    ;(sim as { keepAbove?: (y: number) => void }).keepAbove?.(this.map.height(t.x, t.z))
    this.curS = read(sim)
    // FORDING: the water drags the bike back by its depth (and the rider stops pedalling through a deep one)
    const lvl = this.map.waterAt(t.x, t.z)
    if (lvl !== null) {
      const depth = lvl - this.map.height(t.x, t.z)
      if (depth > 0.12) {
        const b = sim.body, v = b.linvel(), m = b.mass(), kk = Math.min(1, depth) * 1.6
        b.applyImpulse({ x: -v.x * m * kk * dt, y: 0, z: -v.z * m * kk * dt }, true)
      }
    }
  }

  private readPose(p: GFX.Vector3, q: GFX.Quaternion): void {
    const b = this.sim!.body, t = b.translation(), r = b.rotation()
    p.set(t.x, t.y, t.z)
    q.set(r.x, r.y, r.z, r.w)
  }

  /** On its wheels, not crashed (a safe spot to save the journey at). */
  grounded(): boolean {
    const s = this.sim
    return !!s && !s.crashed && s.front.contact && s.rear.contact
  }

  get speedKmh(): number { return this.sim ? Math.abs(this.sim.speed) * 3.6 : 0 }
  get gear(): string { return this.sim ? `G${this.sim.gear}` : '' }
  get heading(): number { return this.sim?.heading ?? 0 }

  private readonly viewSphere = new GFX.Sphere(new GFX.Vector3(), 4)
  /** (?bikedraw=0: never drawn — the cost harness) */
  hidden = false
  /** Out of the view or behind the hills, it isn't drawn. */
  cull(view: GFX.Frustum, horizon: Horizon): void {
    if (!this.sim) return
    if (this.hidden) { this.root.visible = this.shadow.visible = false; return }
    const p = this.root.position
    this.viewSphere.center.copy(p)
    if (this.sim.bail) this.viewSphere.radius = 4 + Math.hypot(this.sim.bail.x - p.x, this.sim.bail.z - p.z)
    this.root.visible = view.intersectsSphere(this.viewSphere) && !horizon.hidden(p.x - 4, p.z - 4, p.x + 4, p.z + 4, p.y + 3)
    this.shadow.visible &&= this.root.visible
  }

  /** Render frame: the interpolated pose, every part's pose and the rider, the contact shadow. */
  update(alpha: number, dt: number): void {
    const sim = this.sim
    if (!sim || !this.mesh) return
    this.readPose(this.curP, this.curQ)
    this.pos.lerpVectors(this.prevP, this.curP, alpha)
    this.root.position.copy(this.pos)
    this.root.quaternion.slerpQuaternions(this.prevQ, this.curQ, alpha)
    this.root.updateMatrixWorld(true)
    const S = lerpSnap(this.prevS, this.curS, alpha)
    // a FOOT DOWN at a stop (not pedalling, on the ground, slower than walking)
    const stopped = !sim.crashed && !sim.airborne && Math.abs(sim.speed) < 0.45 && !sim.pedalling && sim.controls.pedal < 0.05
    this.dab += ((stopped ? 1 : 0) - this.dab) * Math.min(1, dt * (stopped ? 4 : 8))
    this.posePartsFrom(S, sim)
    this.writePoses()
    // the contact shadow: laid on the ground under the bike, turned with it
    const sp = this.shadow.geometry.attributes.position as GFX.BufferAttribute
    const a = sp.array as Float32Array, base = this.shadowBase
    const h = sim.heading, cs = Math.cos(h), sn = Math.sin(h)
    for (let i = 0; i < sp.count; i++) {
      const lx = base[i * 3] * 0.9, lz = base[i * 3 + 2] * 2.1
      const x = this.pos.x + lx * cs + lz * sn, z = this.pos.z - lx * sn + lz * cs
      a[i * 3] = x; a[i * 3 + 1] = this.map.height(x, z) + 0.03; a[i * 3 + 2] = z
    }
    sp.needsUpdate = true
    this.shadow.visible = this.root.visible && this.pos.y - this.map.height(this.pos.x, this.pos.z) < 2.5
  }

  /** Every part at rest (the model as built): the stand-in before the physics is there. */
  private restPose(): void {
    const s = snap()
    this.posePartsFrom(s, null)
    this.writePoses()
  }

  // ---------------------------------------------------------------------------------------------- the poses
  private posePartsFrom(S: Snap, sim: MtbState | null): void {
    const P = this.poses, tmp = pose()
    // FRAME: as built
    ident(P[PI.frame])
    // STEER: the bars, stem, crown, stanchions turn about the steering axis (through the crown)
    const steer = axisRot(pose(), AX, -S.steer) // (+ = right: a turn clockwise seen from above, about the up-pointing axis)
    const aboutCrown = (p: Pose) => { setT(p, sub(CROWN, rot(p, CROWN))); return p }
    aboutCrown(steer)
    mul(P[PI.steer], steer, setT(ident(tmp), CROWN))
    // FORK LOWERS + FRONT WHEEL: slid up the axis by the fork's travel, turned with the bars
    const axle = add(FRONT, AX, S.fork)
    mul(P[PI.fork_lowers], steer, setT(ident(tmp), axle))
    mul(P[PI.wheel_front], steer, setT(rX(tmp, S.spinF), axle))
    // SWINGARM (+ the chain, the rear wheel): R(a) about the pivot
    const swing = setT(rX(pose(), S.swing), PIVOT)
    mul(P[PI.swingarm], swing, ident(tmp))
    const rearAxle = apply(swing, sub(REAR, PIVOT))
    // CHAIN: from the BB aimed at the rear axle where the swingarm carries it, and stretched to reach it (the BB → axle
    // distance grows 435 → 462 mm through the travel: swung rigidly about the pivot its front left the chainring)
    {
      const v0 = sub(REAR, BB), v1 = sub(rearAxle, BB)
      const phi = Math.atan2(v1[1], v1[2]) - Math.atan2(v0[1], v0[2]), k = Math.hypot(v1[1], v1[2]) / Math.hypot(v0[1], v0[2])
      const d = norm([0, v0[1], v0[2]]), stretch = pose()
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) stretch.r[i * 3 + j] = (i === j ? 1 : 0) + (k - 1) * d[i] * d[j]
      mul(P[PI.chain], setT(rX(tmp, phi), BB), stretch)
    }
    setT(rX(P[PI.wheel_rear], S.spinR), rearAxle)
    // SHOCK: the body from the frame mount aimed at the swingarm mount (where the swingarm carries it), the shaft from
    // there aimed back — collinear, telescoping
    const sm = apply(swing, sub(SSM, PIVOT)), dir = sub(sm, SFM)
    const ang = Math.atan2(dir[1], dir[2]) // (the rest direction is +z: (y, z) = (0, 1))
    setT(rX(P[PI.shock_body], ang), SFM) // (R(a) takes +z to (y, z) = (sin a, cos a))
    setT(rX(P[PI.shock_shaft], ang), sm)
    // CRANKS (R(θ) about the BB) and the PEDALS (level, at the arms' ends)
    setT(rX(P[PI.crank], S.crank), BB)
    const armR = rot(rX(tmp, S.crank), [0, 0, -G.crank.length])
    const pedR = add(BB, [G.crank.pedalX + armR[0], armR[1], armR[2]])
    const pedL = add(BB, [-G.crank.pedalX - armR[0], -armR[1], -armR[2]])
    setT(ident(P[PI.pedal_r]), pedR)
    setT(ident(P[PI.pedal_l]), pedL)
    // THE RIDER
    if (sim?.bail) this.poseBail(sim)
    else this.poseRider(S, steer, pedR, pedL)
  }

  private poseRider(S: Snap, steer: Pose, pedR: V3, pedL: V3): void {
    const P = this.poses, tmp = pose()
    const seated = RD.seatedHip as V3
    // standing out of the saddle: the hips up and back over the BB, the knees bent (the attack position)
    const standHip: V3 = [0, BB[1] + 0.64, BB[2] + 0.06]
    let hip = lerp3(seated, standHip, S.stand)
    hip = add(hip, [0, -0.17 * S.crouch, 0.04 * S.crouch])
    hip = add(hip, [0, -0.02 * Math.abs(S.shift), -0.11 * S.shift]) // (+ = weight forward)
    // a foot down at a stop: off the saddle's nose a little, sat lower
    hip = add(hip, [0, -0.03 * this.dab, -0.05 * this.dab])
    // the grips, turned with the bars
    const grips = (G.bar.grips as V3[]).map((g) => apply(steer, g))
    const gripMid = lerp3(grips[0], grips[1], 0.5)
    // THE TORSO: leant forward until the hands reach — the shoulder line at 86 % of the arm's reach from the grips
    const reach = (RD.upperArm + RD.forearm + RD.handToGrip) * (0.86 - 0.08 * S.crouch)
    const shoulderAt = (a: number): V3 => add(hip, [0, Math.cos(a), -Math.sin(a)], RD.spine)
    let lo = 0.05, hi = 1.45
    for (let i = 0; i < 16; i++) {
      const m = (lo + hi) / 2, s = shoulderAt(m), d = Math.hypot(len(sub(s, gripMid)), Math.abs(grips[1][0]) - RD.shoulderHalfWidth)
      if (d > reach) lo = m; else hi = m
    }
    const lean = (lo + hi) / 2
    const torso = setT(rX(P[PI.r_torso], 0), hip)
    // (local +y → (0, cos, −sin): R about +x by −lean in the geometry's sense is (y, z) → (y cos + z sin, −y sin + z cos))
    rX(torso, lean)
    const up: V3 = [0, Math.cos(lean), -Math.sin(lean)]
    // THE HEAD: on the neck, looking ahead (the torso's lean mostly taken back), turned a little into the bars
    const neck = add(hip, up, RD.spine + RD.neck)
    const head = P[PI.r_head]
    mul(head, axisRot(pose(), [0, 1, 0], -S.steer * 0.35), rX(tmp, lean * 0.35))
    setT(head, neck)
    // THE ARMS: shoulder → elbow (out and back) → the grip
    const sides: { s: 'l' | 'r'; x: number; g: V3; ped: V3 }[] = [{ s: 'l', x: -1, g: grips[0], ped: pedL }, { s: 'r', x: 1, g: grips[1], ped: pedR }]
    for (const { s, x, g, ped } of sides) {
      const sh = add(apply(torso, [x * RD.shoulderHalfWidth, RD.spine, 0]), [0, 0, 0])
      const el = ik(sh, g, RD.upperArm, RD.forearm + RD.handToGrip, [x * 0.45, -0.45, 0.75]) // (elbows a little out, mostly back and down)
      const ua = P[PI[`r_upperarm_${s}`]], fa = P[PI[`r_forearm_${s}`]]
      setT(boneBasis(ua, sub(el, sh), [-x * 0.5, 0, -1]), sh) // (the elbow — the segment's +z — out and back: its −z forward, in)
      setT(boneBasis(fa, sub(g, el), [0, 1, -0.3]), el) // (the knuckles — the hand's −z — up and forward over the grip)
      // THE LEGS: hip → knee (forward, a little out) → the ankle above the pedal; the foot level on it, the heel
      // dropping on the downstroke (ankling). A foot down (left) at a stop.
      const hj = add(hip, [x * RD.hipHalfWidth, 0, 0])
      let ball = add(ped, [0, G.crank.pedalSize[1] * 0.5 + 0.004, 0])
      const crankSide = S.crank + (x > 0 ? 0 : Math.PI)
      let heel = -0.12 * Math.sin(crankSide) - 0.05 // (rad: + toes up)
      if (s === 'l' && this.dab > 0.01) {
        const ground: V3 = [-0.33, 0.012 + 0.02 * (1 - this.dab), BB[2] - 0.12]
        ball = lerp3(ball, ground, this.dab)
        heel = heel * (1 - this.dab)
      }
      const foot = rX(P[PI[`r_foot_${s}`]], -heel)
      const ankle = sub(ball, rot(foot, RD.ballOfFoot as V3))
      setT(foot, ankle)
      const knee = ik(hj, ankle, RD.thigh, RD.shin, [x * 0.18, 0.25, -1])
      setT(boneBasis(P[PI[`r_thigh_${s}`]], sub(knee, hj), [x * 0.15, 0.2, -1]), hj)
      setT(boneBasis(P[PI[`r_shin_${s}`]], sub(ankle, knee), [x * 0.1, -0.1, -1]), knee)
    }
  }

  /** Thrown off: the rider tumbling with the physics' bail body — a loose, sprawled pose in its frame, carried into
   *  the bike's frame (the parts are drawn in bike space). */
  private poseBail(sim: MtbState): void {
    const b = sim.bail!, P = this.poses
    const inv = this.root.matrixWorld.clone().invert()
    const q = new GFX.Quaternion(b.qx, b.qy, b.qz, b.qw)
    const world = new GFX.Matrix4().makeRotationFromQuaternion(q).setPosition(b.x, b.y, b.z)
    const m = new GFX.Matrix4().multiplyMatrices(inv, world).elements
    const B: Pose = { r: new Float64Array([m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]), t: new Float64Array([m[12], m[13], m[14]]) }
    const local = pose()
    const place = (part: Part, at: V3, down: V3, front: V3) => { mul(P[PI[part]], B, setT(boneBasis(local, down, front), at)) }
    const hip: V3 = [0, -0.05, 0]
    // torso up the body's axis, head on it; arms flung out and up, legs bent
    mul(P[PI.r_torso], B, setT(ident(local), hip))
    mul(P[PI.r_head], B, setT(rX(local, -0.4), [0, RD.spine + RD.neck - 0.05, 0]))
    for (const x of [-1, 1]) {
      const s = x < 0 ? 'l' : 'r'
      const sh: V3 = [x * RD.shoulderHalfWidth, RD.spine - 0.03, 0]
      const el = add(sh, norm([x * 0.8, 0.45, 0.2]), RD.upperArm)
      place(`r_upperarm_${s}`, sh, sub(el, sh), [0, 0, 1])
      place(`r_forearm_${s}`, el, norm([x * 0.3, 0.9, -0.2]), [0, 0, -1])
      const hj: V3 = [x * RD.hipHalfWidth, -0.05, 0]
      const kn = add(hj, norm([x * 0.2, -0.55, -0.8]), RD.thigh)
      const an = add(kn, norm([0, -0.9, 0.4]), RD.shin)
      place(`r_thigh_${s}`, hj, sub(kn, hj), [0, 0.3, -1])
      place(`r_shin_${s}`, kn, sub(an, kn), [0, -0.2, -1])
      mul(P[PI[`r_foot_${s}`]], B, setT(rX(local, 0.5), an))
    }
  }

  private writePoses(): void {
    const u = this.partsU
    this.poses.forEach((p, i) => {
      const o = i * 12, r = p.r, t = p.t
      u[o] = r[0]; u[o + 1] = r[1]; u[o + 2] = r[2]; u[o + 3] = t[0]
      u[o + 4] = r[3]; u[o + 5] = r[4]; u[o + 6] = r[5]; u[o + 7] = t[1]
      u[o + 8] = r[6]; u[o + 9] = r[7]; u[o + 10] = r[8]; u[o + 11] = t[2]
    })
  }

  /** (harness) the bike standing at (x, z), heading h, every part at rest — no physics. */
  showAt(x: number, z: number, h: number): void {
    this.root.position.set(x, this.map.height(x, z), z)
    this.root.quaternion.setFromAxisAngle(new GFX.Vector3(0, 1, 0), h)
    this.root.updateMatrixWorld(true)
    this.root.visible = true
    this.restPose()
  }
}

/** The drawn state of one step. */
interface Snap { steer: number; fork: number; swing: number; crank: number; spinF: number; spinR: number; crouch: number; shift: number; stand: number }
function snap(): Snap { return { steer: 0, fork: 0, swing: 0, crank: 0, spinF: 0, spinR: 0, crouch: 0, shift: 0, stand: 0 } }
function read(s: MtbState): Snap {
  return { steer: s.steerAngle, fork: s.forkTravel, swing: s.swingarm, crank: s.crankAngle, spinF: s.front.spin, spinR: s.rear.spin, crouch: s.riderCrouch, shift: s.riderShift, stand: s.riderStand }
}
function lerpSnap(a: Snap, b: Snap, t: number): Snap {
  const o = snap()
  for (const k of Object.keys(o) as (keyof Snap)[]) o[k] = a[k] + (b[k] - a[k]) * t
  return o
}
