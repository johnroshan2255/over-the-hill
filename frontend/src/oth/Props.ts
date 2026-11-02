import * as THREE from 'three'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import { Builder, woodMaterial } from './Bridges'
import type { Horizon } from './Horizon'
import { campKit, FIRE_LOCAL } from './Landmarks'
import type { Landmark } from './MapData'
import { PROP_KINDS, type Prop, type PropKind } from './Places'
import type { Tier } from './quality'
import type { TerrainShadow } from './TerrainShadow'

/**
 * THE VALLEY'S SMALL THINGS, DRAWN (Places.ts picks where): signposts, picnic tables, fences, log piles, cairns, the
 * logging trucks, the supply crates — and the FLAMES of every camp's fire, and the PLAYER'S OWN CAMP (pitched with C).
 *
 * Cheap by construction:
 *   ONE DRAW PER KIND: an InstancedMesh each, the one wood material (Bridges.ts: vertex colours, no textures, the night
 *     glow), every prop's matrix computed once at load and copied in.
 *   CULLED like the rocks: per 128 m cell — the kind's reach (× the tier's), the view (the cell's box against the
 *     frustum), the hills (Horizon), and per prop a SMALL-FEATURE cut (under ~2 px tall: not drawn). The lists are
 *     rebuilt only when the camera has moved 6 m or turned (or a crate was picked up), never per frame.
 *   CAMPFIRES (2026-11-02, the user: "a cheap fire effect that looks real, with light at night"): per fire three
 *     FLAME tongues (upright quads, their edges torn by the paint noise scrolling up, a white-hot core), SPARKS rising
 *     and fading (brighter at night), a thin SMOKE wisp drifting with the wind (by day), a warm halo at the base and
 *     the FIRE'S LIGHT on everything round it from dusk (Atmosphere `uFire`, painted in `headlight()`: the nearest
 *     fire's only) — 3 draws for every fire, moved in the vertex shaders, not drawn when no fire is within 160 m.
 *   CLEARINGS: the camps and the props stand in short grass — stamped into the rocks' footprint (the grass keeps off
 *     it, shortening toward it); the player's camp is stamped when pitched.
 *   EVENING LIGHTS (2026-11-02, the user: "lights only at evening, fireflies near them — painted, not real lights,
 *     low cost"): a soft HALO on every camp lantern and lit cabin window, and FIREFLIES drifting and blinking round
 *     the camps and cabins — all painted (additive quads, no light sources), moved and blinked in the vertex shader
 *     from a seed and the clock (no CPU per frame), one draw each, and not drawn at all by day (Atmosphere uLamps).
 *   COLLIDERS: boxes handed to the physics, which builds the ones near the car (Physics.ts `follow`).
 *   PICK-UPS and SIGNPOSTS: a spatial hash of 64 m cells, looked up 10× a second.
 */
type RGB = [number, number, number]
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1)
const box = (b: Builder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: RGB) => b.box(V(cx, cy, cz), X, Y, Z, hx, hy, hz, c)
const STONE: RGB = [0.24, 0.245, 0.26]

/** Each kind's model (local: on the ground, facing +z), how far it's drawn (m, before the tier's factor), its height
 *  (m, for the small-feature cut) and its collider (centre y, half sizes; none for the crate — you drive into it). */
/** `more`: extra collider boxes, off the centre ([x, y, z offset, then half sizes], local). */
const TIN: RGB = [0.4, 0.26, 0.17]
/** A ruin's broken foundation walls: [x0, x1, z0, z1, height] (local m; the chimney at the origin). */
const RUIN_WALLS: [number, number, number, number, number][] = [
  [0.4, 2.8, -2.5, -2.5, 1.0], [3.6, 6.0, -2.5, -2.5, 0.5], [0.4, 1.6, 2.5, 2.5, 0.4], [2.6, 6.0, 2.5, 2.5, 0.8],
  [6.0, 6.0, -2.5, -0.6, 0.7], [6.0, 6.0, 0.8, 2.5, 0.45], [0.4, 0.4, -2.5, -0.5, 0.9], [0.4, 0.4, 0.5, 2.5, 0.6],
]
/** A lean-to tin roof: from (y0 at z0) down to (y1 at z1), w half wide. */
function leanTo(b: Builder, w: number, z0: number, y0: number, z1: number, y1: number): void {
  const dir = V(0, y1 - y0, z1 - z0), len = dir.length(), wv = dir.clone().normalize(), up = new THREE.Vector3().crossVectors(X, wv).normalize()
  b.box(V(0, (y0 + y1) / 2, (z0 + z1) / 2), X, up, wv, w, 0.035, len / 2, TIN)
}

const KINDS: Record<PropKind, { build: (b: Builder) => void; reach: number; size: number; col: [number, number, number, number] | null; more?: [number, number, number, number, number, number][]; scale?: number }> = {
  sign: {
    reach: 380, size: 2.6, col: [1.2, 0.09, 1.2, 0.09],
    build(b) {
      b.log(V(0, -0.3, 0), V(0, 2.6, 0), 0.07, b.wood(0.8))
      ;[[0.5, 2.25], [-1.0, 1.9], [2.4, 1.55]].forEach(([a, y], i) => {
        const u = V(Math.cos(a), 0, Math.sin(a)), w = new THREE.Vector3().crossVectors(u, Y)
        const c: RGB = i === 0 ? [0.55, 0.36, 0.18] : b.wood(1.25)
        b.box(u.clone().multiplyScalar(0.5).setY(y), u, Y, w, 0.5, 0.1, 0.025, c)
        const tip = u.clone().multiplyScalar(1.12).setY(y), side = w.clone().multiplyScalar(0.03)
        b.tri(tip.clone().add(side), u.clone().multiplyScalar(0.98).setY(y + 0.15).add(side), u.clone().multiplyScalar(0.98).setY(y - 0.15).add(side), c)
      })
      box(b, 0, 2.62, 0, 0.12, 0.04, 0.12, b.wood(0.6))
    },
  },
  table: {
    reach: 380, size: 1.0, col: [0.45, 1.0, 0.45, 0.85],
    build(b) {
      for (const z of [-0.26, 0, 0.26]) box(b, 0, 0.76, z, 0.95, 0.035, 0.12, b.wood(1.1))
      for (const z of [-0.72, 0.72]) box(b, 0, 0.45, z, 0.95, 0.03, 0.15, b.wood(1.05))
      for (const x of [-0.7, 0.7]) {
        b.log(V(x, 0, -0.8), V(x, 0.74, 0.12), 0.04, b.wood(0.8))
        b.log(V(x, 0, 0.8), V(x, 0.74, -0.12), 0.04, b.wood(0.8))
      }
    },
  },
  fence: {
    reach: 320, size: 1.2, col: [0.6, 2.1, 0.6, 0.08],
    build(b) {
      for (const x of [-2, 0, 2]) b.log(V(x, -0.2, 0), V(x, 1.15, 0), 0.07, b.wood(0.75))
      b.log(V(-2.1, 0.86, 0), V(2.1, 0.9, 0), 0.05, b.wood(0.85))
      b.log(V(-2.1, 0.46, 0), V(2.1, 0.43, 0), 0.05, b.wood(0.85))
    },
  },
  logs: {
    reach: 420, size: 1.3, col: [0.5, 2.0, 0.5, 0.8],
    build(b) {
      const r = 0.22
      ;[[-0.46, 0, 0], [0, 0, 0], [0.46, 0, 0], [-0.23, 1, 0], [0.23, 1, 0], [0, 2, 0]].forEach(([z, row], i) => {
        const y = r + row * r * 1.7, dx = (i % 2) * 0.15
        b.log(V(-1.8 + dx, y, z), V(1.8 + dx, y, z), r, b.wood(1.0 + (i % 3) * 0.06))
      })
    },
  },
  cairn: {
    reach: 520, size: 1.4, col: [0.6, 0.6, 0.6, 0.6],
    build(b) {
      ;[[0.6, 0.18, 0.5, 0.18, 0], [0.45, 0.15, 0.38, 0.5, 0.4], [0.33, 0.13, 0.28, 0.78, 1.1], [0.2, 0.11, 0.18, 1.02, 0.5], [0.12, 0.07, 0.1, 1.2, 2.0]].forEach(([hx, hy, hz, y, a], i) => {
        const u = V(Math.cos(a), 0, Math.sin(a)), w = new THREE.Vector3().crossVectors(u, Y)
        b.box(V(0.03 * (i % 2), y, 0), u, Y, w, hx, hy, hz, [STONE[0] * (0.8 + 0.1 * i), STONE[1] * (0.8 + 0.1 * i), STONE[2] * (0.82 + 0.1 * i)])
      })
    },
  },
  truck: {
    // (×1.15: a real logging truck — 2.6 m wide, its cab 2.6 m tall — beside the real-size cars)
    reach: 800, size: 3.6, col: [1.3, 1.45, 1.3, 4.15], scale: 1.15,
    build(b) {
      const RUST: RGB = [0.36, 0.1, 0.05], DARK: RGB = [0.05, 0.05, 0.055], RUBBER: RGB = [0.035, 0.035, 0.04]
      box(b, 0, 0.78, -0.2, 1.05, 0.14, 3.4, DARK)
      box(b, 0, 1.55, 2.25, 1.15, 0.72, 0.85, RUST)
      box(b, 0, 1.15, 3.35, 1.0, 0.4, 0.55, [0.33, 0.09, 0.05])
      box(b, 0, 1.85, 3.08, 0.95, 0.3, 0.02, [0.06, 0.065, 0.075]) // (the windscreen)
      for (const sx of [-1, 1]) box(b, sx * 1.16, 1.85, 2.25, 0.02, 0.28, 0.55, [0.06, 0.065, 0.075])
      for (const sx of [-1, 1]) for (const z of [1.2, -0.4, -2.0, -3.3]) b.log(V(sx * 1.05, 0.9, z), V(sx * 1.05, 2.4, z), 0.06, b.wood(0.7))
      for (const [x, y] of [[-0.55, 1.2], [0, 1.2], [0.55, 1.2], [-0.28, 1.68], [0.28, 1.68]]) b.log(V(x, y, -3.6), V(x, y, 1.15), 0.27, b.wood(1.05))
      for (const z of [2.6, -1.5, -2.7]) for (const sx of [-1, 1]) b.log(V(sx * 1.2, 0.5, z), V(sx * 0.82, 0.5, z), 0.5, RUBBER)
    },
  },
  stones: {
    reach: 200, size: 0.4, col: null,
    build(b) {
      const G: RGB = [0.27, 0.27, 0.285]
      const u = V(Math.cos(0.4), 0.14, Math.sin(0.4)).normalize(), w = new THREE.Vector3().crossVectors(u, Y).normalize(), v = new THREE.Vector3().crossVectors(w, u).normalize()
      b.box(V(0, 0.12, 0), u, v, w, 0.3, 0.17, 0.22, G)
      b.box(V(0.1, 0.27, -0.04), w, Y, u, 0.14, 0.09, 0.12, [G[0] * 1.12, G[1] * 1.12, G[2] * 1.14])
    },
  },
  shed: {
    // a TOOL SHED: 2.8 × 2.2 m plank walls, a dark door, a small window, a rusty lean-to tin roof (2.45 → 2.05 m)
    reach: 600, size: 2.6, col: [1.2, 1.45, 1.2, 1.15],
    build(b) {
      const W = 1.4, D = 1.1
      for (let i = 0; i < 8; i++) {
        const x = -W + (i + 0.5) * ((2 * W) / 8)
        box(b, x, 1.2, D, W / 8 - 0.01, 1.2, 0.04, b.wood())
        box(b, x, 1.0, -D, W / 8 - 0.01, 1.0, 0.04, b.wood(0.95))
      }
      for (let i = 0; i < 6; i++) { const z = -D + (i + 0.5) * ((2 * D) / 6); for (const sx of [-1, 1]) box(b, sx * W, 1.08 + (z / D) * 0.1, z, 0.04, 1.08 + (z / D) * 0.1, D / 6 - 0.01, b.wood()) }
      box(b, 0.5, 0.95, D + 0.045, 0.42, 0.95, 0.02, [0.06, 0.05, 0.045])
      box(b, -0.75, 1.55, D + 0.045, 0.3, 0.22, 0.02, [0.06, 0.065, 0.075])
      leanTo(b, W + 0.25, D + 0.3, 2.48, -D - 0.3, 2.02)
    },
  },
  outhouse: {
    // an OUTHOUSE: 1.2 m square, 2.2 m tall, a door with its moon, a tin roof
    reach: 350, size: 2.3, col: [1.1, 0.65, 1.1, 0.65],
    build(b) {
      for (const [x, z, hx, hz] of [[0, 0.6, 0.6, 0.04], [0, -0.6, 0.6, 0.04], [0.6, 0, 0.04, 0.6], [-0.6, 0, 0.04, 0.6]]) box(b, x, 1.05, z, hx, 1.05, hz, b.wood(0.9))
      box(b, 0, 0.95, 0.645, 0.36, 0.9, 0.02, b.wood(0.7))
      box(b, 0, 1.68, 0.668, 0.06, 0.06, 0.01, [0.03, 0.03, 0.03])
      leanTo(b, 0.75, 0.8, 2.25, -0.8, 2.05)
    },
  },
  ruin: {
    // an old homestead's RUIN: its stone chimney (4.5 m, the fireplace's mouth) and the broken walls of a 6 × 5 m house
    reach: 700, size: 4.5, col: [2.2, 0.38, 2.2, 0.32],
    more: RUIN_WALLS.map(([x0, x1, z0, z1, h]) => [(x0 + x1) / 2, h / 2, (z0 + z1) / 2, Math.max(0.25, (x1 - x0) / 2), h / 2, Math.max(0.25, (z1 - z0) / 2)] as [number, number, number, number, number, number]),
    build(b) {
      const S1: RGB = [0.26, 0.25, 0.24], S2: RGB = [0.21, 0.2, 0.19]
      box(b, 0, 2.2, 0, 0.38, 2.2, 0.32, S1)
      box(b, 0, 4.45, 0, 0.3, 0.1, 0.26, S2)
      box(b, 0.39, 0.55, 0, 0.01, 0.4, 0.2, [0.03, 0.03, 0.03])
      RUIN_WALLS.forEach(([x0, x1, z0, z1, h], i) => box(b, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, Math.max(0.25, (x1 - x0) / 2), h / 2, Math.max(0.25, (z1 - z0) / 2), i % 2 ? S1 : S2))
      b.log(V(1.6, 0.15, 1.1), V(4.8, 0.32, -1.4), 0.13, b.wood(0.55))
    },
  },
  crate: {
    reach: 260, size: 0.7, col: null,
    build(b) {
      box(b, 0, 0.33, 0, 0.46, 0.3, 0.32, b.wood(1.15))
      for (const x of [-0.46, 0.46]) box(b, x, 0.33, 0, 0.02, 0.32, 0.34, b.wood(0.75))
      b.setGlow(0.2) // (the band catches the eye — and glows a little at night)
      box(b, 0, 0.36, 0, 0.475, 0.07, 0.335, [0.85, 0.5, 0.06])
      b.setGlow(0)
    },
  },
}

const CELL = 128
/** The grass cleared round each kind (m; a fence: three spots along it). */
const CLEAR: Record<PropKind, number> = { sign: 0.9, table: 2.4, fence: 1.0, logs: 2.6, cairn: 1.3, truck: 5.2, crate: 1.8, stones: 0.9, shed: 3.0, outhouse: 1.4, ruin: 5.5 }

export interface PropCollider { x: number; y: number; z: number; rot: number; hx: number; hy: number; hz: number }

export class Props {
  readonly group = new THREE.Group()
  /** The hills' occlusion (main.ts). */
  horizon: Horizon | null = null
  /** Boxes for the physics (Physics.ts addPropColliders streams the ones near the car). */
  readonly colliders: PropCollider[] = []
  private readonly meshes = new Map<PropKind, THREE.InstancedMesh>()
  private readonly matrices: Float32Array
  private readonly cells = new Map<number, { idx: number[]; y0: number; y1: number }>()
  private readonly pick = new Map<number, number[]>()
  private readonly collected = new Set<number>()
  private readonly reachK: number
  private dirty = true
  /** How many of each kind the last rebuild uploaded. */
  private readonly drawn = new Map<THREE.InstancedMesh, number>()
  private readonly lastPos = new THREE.Vector3(Number.NaN, 0, 0)
  private readonly lastDir = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly frustum = new THREE.Frustum()
  private readonly pv = new THREE.Matrix4()
  private readonly cellBox = new THREE.Box3()
  // fires: the camps' (world) and the player's own (the last slot)
  private readonly fires: THREE.Vector3[] = []
  /** The fires' parts: flames, sparks, smoke (one draw each; the player's fire = each one's last `per` entries). */
  private readonly fireParts: { mesh: THREE.Mesh; attr: THREE.InstancedBufferAttribute; per: number }[] = []
  private readonly camp: THREE.Mesh
  private readonly fp: THREE.DataTexture
  private readonly fpBase: Uint8Array
  private readonly flies: THREE.Mesh
  private readonly halos: THREE.Mesh
  private readonly flyAttr: THREE.InstancedBufferAttribute
  private readonly haloAttr: THREE.InstancedBufferAttribute
  private pickT = 0

  constructor(readonly props: Prop[], landmarks: Landmark[], wild: [number, number, number][], atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: THREE.Vector4, collected: number[],
    footprint: THREE.DataTexture, private readonly grid: { n: number; step: number; origin: number }) {
    const camps = landmarks.filter((l) => l.kind === 'camp'), cabins = landmarks.filter((l) => l.kind === 'cabin')
    for (const id of collected) this.collected.add(id)
    this.reachK = tier.rockReach / 900
    const mat = woodMaterial(atmos, shadow, tier, farGrid)
    // the models, one InstancedMesh per kind
    for (const kind of PROP_KINDS) {
      const n = props.filter((p) => p.kind === kind).length
      if (!n) continue
      const b = new Builder(0x5eed + kind.length * 131)
      KINDS[kind].build(b)
      const mesh = new THREE.InstancedMesh(b.geometry(), mat, n)
      mesh.count = 0
      mesh.frustumCulled = false // (culled per cell in update)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.meshes.set(kind, mesh)
      this.group.add(mesh)
    }
    // every prop's matrix, once; its cell; its collider; the crates' pick-up hash
    this.matrices = new Float32Array(props.length * 16)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion()
    props.forEach((p, i) => {
      const sc = (KINDS[p.kind].scale ?? 1) * (p.s ?? 1)
      m.compose(V(p.x, p.y - 0.06, p.z), q.setFromAxisAngle(Y, p.rot), V(sc, sc, sc)).toArray(this.matrices, i * 16)
      const k = this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL))
      let c = this.cells.get(k)
      if (!c) this.cells.set(k, (c = { idx: [], y0: Infinity, y1: -Infinity }))
      c.idx.push(i)
      c.y0 = Math.min(c.y0, p.y - 1)
      c.y1 = Math.max(c.y1, p.y + KINDS[p.kind].size * (p.s ?? 1) + 1)
      const col = KINDS[p.kind].col
      if (col) this.colliders.push({ x: p.x, y: p.y + col[0], z: p.z, rot: p.rot, hx: col[1], hy: col[2], hz: col[3] })
      const cs = Math.cos(p.rot), sn = Math.sin(p.rot)
      for (const [ox, oy, oz, hx, hy, hz] of KINDS[p.kind].more ?? []) this.colliders.push({ x: p.x + ox * cs + oz * sn, y: p.y + oy, z: p.z - ox * sn + oz * cs, rot: p.rot, hx, hy, hz })
      if (p.kind === 'crate') {
        const pk = this.key(Math.floor(p.x / 64), Math.floor(p.z / 64))
        const l = this.pick.get(pk)
        if (l) l.push(i)
        else this.pick.set(pk, [i])
      }
    })
    // the camps' fires, then a slot for the player's
    for (const c of camps) {
      const cs = Math.cos(c.rot), sn = Math.sin(c.rot)
      this.fires.push(V(c.x + FIRE_LOCAL.x * cs + FIRE_LOCAL.z * sn, c.y + FIRE_LOCAL.y, c.z - FIRE_LOCAL.x * sn + FIRE_LOCAL.z * cs))
    }
    this.fires.push(V(0, -1e5, 0))
    for (const [per, mat] of [[3, fireMaterial(atmos, FLAME_GLSL, FLAME_FRAG, true)], [14, glowMaterial(atmos, SPARK_GLSL)], [7, fireMaterial(atmos, SMOKE_GLSL, SMOKE_FRAG, false)]] as [number, THREE.ShaderMaterial][]) {
      const a = new Float32Array(this.fires.length * per * 4)
      this.fires.forEach((f, i) => { for (let k = 0; k < per; k++) a.set([f.x, f.y, f.z, i * 7.13 + k * 0.371], (i * per + k) * 4) })
      const attr = new THREE.InstancedBufferAttribute(a, 4)
      const mesh = quads(attr, 'aFire', mat)
      mesh.renderOrder = per === 7 ? 10 : 8
      this.fireParts.push({ mesh, attr, per })
      this.group.add(mesh)
    }
    // the player's camp: the camps' kit, one mesh, hidden until pitched
    const kb = new Builder(0xca4b)
    campKit(kb)
    this.camp = new THREE.Mesh(kb.geometry(), mat)
    this.camp.visible = false
    this.group.add(this.camp)
    // the CLEARINGS: short grass round the camps and the props (the rocks' footprint; the base kept for the player's camp)
    this.fp = footprint
    const spots: [number, number, number][] = camps.map((c) => [c.x, c.z, 7.5])
    for (const p of props) {
      if (p.kind === 'fence') for (const t of [-1.8, 0, 1.8]) spots.push([p.x + Math.cos(p.rot) * t, p.z - Math.sin(p.rot) * t, CLEAR.fence])
      else spots.push([p.x, p.z, CLEAR[p.kind] * (p.s ?? 1)])
    }
    for (const [x, z, r] of spots) this.stamp(footprint.image.data as Uint8Array, x, z, r)
    this.fpBase = (footprint.image.data as Uint8Array).slice()
    footprint.needsUpdate = true
    // the evening lights: a halo on each lantern / lit window, a swarm of fireflies round each camp and cabin (the
    // player's camp: the last of each, moved when it's pitched)
    const at = (l: { x: number; y: number; z: number; rot: number }, lx: number, ly: number, lz: number, S = 1): [number, number, number] => {
      const c = Math.cos(l.rot), sn = Math.sin(l.rot)
      return [l.x + (lx * c + lz * sn) * S, l.y + ly * S, l.z + (-lx * sn + lz * c) * S]
    }
    const halos: number[] = [], flies: number[] = []
    const swarm = (x: number, y: number, z: number, seed: number) => { for (let k = 0; k < FLIES; k++) flies.push(x, y, z, seed * 0.618 + k * 0.1319) }
    camps.forEach((c, i) => {
      halos.push(...at(c, LANTERN.x, LANTERN.y, LANTERN.z), 1.0)
      halos.push(...at(c, FIRE_LOCAL.x, FIRE_HALO_Y, FIRE_LOCAL.z), -1.7) // (the fire's own glow: w < 0)
      swarm(...at(c, FIRE_LOCAL.x, 0, FIRE_LOCAL.z), i + 1)
    })
    cabins.forEach((c, i) => {
      for (const [lx, lz] of [[-1.2, 2.27], [2.77, 0]]) halos.push(...at(c, lx, 1.35, lz, 1.3), 1.6)
      swarm(...at(c, 0, 0, 5.5, 1.3), 50 + i)
    })
    wild.forEach(([x, y, z], i) => swarm(x, y, z, 200 + i)) // (the wild ones: by the trees, the water, the meadows)
    halos.push(0, -1e5, 0, 1.0, 0, -1e5, 0, -1.7) // (the player's camp: its lantern, its fire)
    swarm(0, -1e5, 0, 99)
    this.haloAttr = new THREE.InstancedBufferAttribute(new Float32Array(halos), 4)
    this.flyAttr = new THREE.InstancedBufferAttribute(new Float32Array(flies), 4)
    this.halos = quads(this.haloAttr, 'aLamp', glowMaterial(atmos, HALO_GLSL))
    this.flies = quads(this.flyAttr, 'aFly', glowMaterial(atmos, FLY_GLSL))
    this.group.add(this.halos, this.flies)
  }

  private key(i: number, j: number): number { return (i + 4096) * 8192 + (j + 4096) }

  get crateCount(): number { return this.props.filter((p) => p.kind === 'crate').length }

  /** Re-pick what's drawn when the camera has moved 6 m or turned (or something changed). */
  update(camera: THREE.PerspectiveCamera): void {
    camera.getWorldDirection(this.dir)
    if (!this.dirty && camera.position.distanceToSquared(this.lastPos) < 36 && this.dir.dot(this.lastDir) > 0.9985) return
    this.dirty = false
    this.lastPos.copy(camera.position); this.lastDir.copy(this.dir)
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, THREE.WebGLCoordinateSystem, camera.reversedDepth)
    const cx = camera.position.x, cz = camera.position.z, R = 800 * this.reachK
    // (a thing s m tall at d m is s / d × this px: under 2 px it isn't drawn)
    const minRatio = 2 / ((innerHeight * Math.min(devicePixelRatio, 2)) / (2 * Math.tan((camera.fov * Math.PI) / 360)))
    for (const mesh of this.meshes.values()) mesh.count = 0
    const i0 = Math.floor((cx - R) / CELL), i1 = Math.floor((cx + R) / CELL), j0 = Math.floor((cz - R) / CELL), j1 = Math.floor((cz + R) / CELL)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = this.cells.get(this.key(i, j))
      if (!c) continue
      const x0 = i * CELL, z0 = j * CELL
      this.cellBox.min.set(x0 - 8, c.y0, z0 - 8)
      this.cellBox.max.set(x0 + CELL + 8, c.y1, z0 + CELL + 8)
      if (!this.frustum.intersectsBox(this.cellBox)) continue
      if (this.horizon?.hiddenBox(this.cellBox)) continue
      for (const k of c.idx) {
        const p = this.props[k], K = KINDS[p.kind]
        if (p.kind === 'crate' && this.collected.has(p.id)) continue
        const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2, reach = K.reach * this.reachK, size = K.size * (p.s ?? 1)
        if (d2 > reach * reach || size * size < minRatio * minRatio * d2) continue
        const mesh = this.meshes.get(p.kind)!
        ;(mesh.instanceMatrix.array as Float32Array).set(this.matrices.subarray(k * 16, k * 16 + 16), mesh.count * 16)
        mesh.count++
      }
    }
    // (upload only the matrices in use — none when a kind had none and still has none)
    for (const mesh of this.meshes.values()) {
      const im = mesh.instanceMatrix, was = this.drawn.get(mesh) ?? -1
      if (mesh.count === 0 && was === 0) continue
      this.drawn.set(mesh, mesh.count)
      im.clearUpdateRanges()
      if (mesh.count) im.addUpdateRange(0, mesh.count * 16)
      im.needsUpdate = mesh.count > 0
    }
  }

  /** Grass cleared round (x, z) to radius r (m): the rocks' footprint's soft disc (Rocks.ts: the same edge). */
  private stamp(data: Uint8Array, x: number, z: number, r: number): void {
    const g = this.grid
    const i0 = Math.max(0, Math.floor((x - r - g.origin) / g.step)), i1 = Math.min(g.n - 1, Math.ceil((x + r - g.origin) / g.step))
    const j0 = Math.max(0, Math.floor((z - r - g.origin) / g.step)), j1 = Math.min(g.n - 1, Math.ceil((z + r - g.origin) / g.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(g.origin + i * g.step - x, g.origin + j * g.step - z) / r
      const v = Math.round(255 * Math.min(1, Math.max(0, (1.15 - d) / 0.3)))
      if (v > data[j * g.n + i]) data[j * g.n + i] = v
    }
  }

  /** Crates the car (x, y, z) has reached since the last call (checked 10× a second): their ids. */
  pickUp(dt: number, x: number, y: number, z: number): number[] {
    if ((this.pickT -= dt) > 0) return EMPTY
    this.pickT = 0.1
    let got: number[] | null = null
    const i0 = Math.floor((x - 6) / 64), i1 = Math.floor((x + 6) / 64), j0 = Math.floor((z - 6) / 64), j1 = Math.floor((z + 6) / 64)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (const k of this.pick.get(this.key(i, j)) ?? EMPTY) {
        const p = this.props[k]
        if (this.collected.has(p.id) || (p.x - x) ** 2 + (p.z - z) ** 2 > 4.5 * 4.5 || Math.abs(p.y - y) > 4) continue
        this.collected.add(p.id)
        ;(got ??= []).push(p.id)
        this.dirty = true
      }
    }
    return got ?? EMPTY
  }

  /** The signpost within r m of (x, z), if any (the HUD reads its boards). */
  signNear(x: number, z: number, r: number): Prop | null {
    let best: Prop | null = null, bd = r * r
    for (const p of this.props) {
      if (p.kind !== 'sign') continue
      const d = (p.x - x) ** 2 + (p.z - z) ** 2
      if (d < bd) { bd = d; best = p }
    }
    return best
  }

  /** Pitch the player's camp at (x, z) facing `rot` (its ground height y), or strike it (null). */
  pitch(at: { x: number; y: number; z: number; rot: number } | null): void {
    const last = this.fires.length - 1
    if (!at) {
      this.camp.visible = false
      this.fires[last].set(0, -1e5, 0)
    } else {
      this.camp.visible = true
      this.camp.position.set(at.x, at.y - 0.05, at.z)
      this.camp.rotation.set(0, at.rot, 0)
      const c = Math.cos(at.rot), s = Math.sin(at.rot)
      this.fires[last].set(at.x + FIRE_LOCAL.x * c + FIRE_LOCAL.z * s, at.y + FIRE_LOCAL.y, at.z - FIRE_LOCAL.x * s + FIRE_LOCAL.z * c)
    }
    // its lantern's and its fire's halos and its fireflies follow it
    const hl = this.haloAttr.count - 2, f0 = this.flyAttr.count - FLIES
    const c = Math.cos(at?.rot ?? 0), s = Math.sin(at?.rot ?? 0)
    if (at) this.haloAttr.setXYZ(hl, at.x + LANTERN.x * c + LANTERN.z * s, at.y + LANTERN.y, at.z - LANTERN.x * s + LANTERN.z * c)
    else this.haloAttr.setXYZ(hl, 0, -1e5, 0)
    this.haloAttr.setXYZ(hl + 1, this.fires[last].x, at ? at.y + FIRE_HALO_Y : -1e5, this.fires[last].z)
    for (let k = 0; k < FLIES; k++) this.flyAttr.setXYZ(f0 + k, this.fires[last].x, at ? at.y : -1e5, this.fires[last].z)
    this.haloAttr.needsUpdate = this.flyAttr.needsUpdate = true
    const f = this.fires[last]
    for (const part of this.fireParts) {
      for (let k = 0; k < part.per; k++) part.attr.setXYZ(part.attr.count - part.per + k, f.x, f.y, f.z)
      part.attr.needsUpdate = true
    }
    // its clearing (from the base: a struck camp's grass grows back)
    const data = this.fp.image.data as Uint8Array
    data.set(this.fpBase)
    if (at) this.stamp(data, at.x, at.z, 7.5)
    this.fp.needsUpdate = true
  }

  /** The nearest fire within 60 m of the camera lights its surroundings (Atmosphere uFire), flickering — from dusk
   *  only (`lamps`: Atmosphere uLamps; by day the flames burn, nothing is lit). */
  fireLight(cam: THREE.Vector3, t: number, lamps: number, out: THREE.Vector4): void {
    const night = lamps
    let best = -1, bd = 60 * 60
    for (let i = 0; i < this.fires.length; i++) {
      const f = this.fires[i], d = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2
      if (d < bd) { bd = d; best = i }
    }
    // (the evening lights: not drawn at all by day; the fires' parts only with a fire within 160 m)
    this.halos.visible = this.flies.visible = night > 0.01
    let near = Infinity
    for (const f of this.fires) near = Math.min(near, (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2)
    for (const part of this.fireParts) part.mesh.visible = near < 160 * 160
    if (best < 0) { out.w = 0; return }
    const f = this.fires[best], flick = 1 + 0.16 * Math.sin(t * 13.1) + 0.09 * Math.sin(t * 29.7 + 1.3) + 0.05 * Math.sin(t * 51.3)
    out.set(f.x, f.y + 0.4, f.z, 1.6 * night * flick)
  }
}

const EMPTY: number[] = []
/** Fireflies per swarm; a camp lantern's place (campKit). */
const FLIES = 36
const LANTERN = { x: -0.6, y: 1.72, z: 1.42 } as const
/** A fire's halo: round the middle of its flames (not its base — the ground would cut it). */
const FIRE_HALO_Y = 0.7

/** Camera-facing quads, one per instance of `attr` (its xyz the centre, w its own number) — one draw. */
function quads(attr: THREE.InstancedBufferAttribute, name: string, mat: THREE.ShaderMaterial): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.attributes.position)
  g.setAttribute(name, attr)
  g.instanceCount = attr.count
  const m = new THREE.Mesh(g, mat)
  m.frustumCulled = false
  m.renderOrder = 9
  m.visible = false
  return m
}

/** An additive glow material; `body` = the vertex shader's main (the centre, the size, the strength vA). */
function glowMaterial(atmos: Atmosphere, body: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...atmos.uniforms },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
${ATMOS_GLSL}
out vec2 vQ;
out float vA;
out vec3 vTint;
${body}`,
    fragmentShader: /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec2 vQ;
in float vA;
in vec3 vTint;
void main() {
  float r2 = dot(vQ, vQ) * 4.0;
  // (the falloff reaches exactly 0 inside the quad: no square edge, even against a black night)
  float a = (exp(-r2 * 26.0) * 1.5 + exp(-r2 * 4.0) * 0.32) * (1.0 - smoothstep(0.55, 0.98, sqrt(r2))) * vA;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vTint * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  })
}

/** A camera-facing quad of `size` m round c, its strength vA (0 → off the screen); `pull` (0–1) of its radius moved
 *  toward the camera at the same size on the screen, so what's close round it (the ground, a fire ring) can't cut it
 *  with a hard edge. */
const BILLBOARD = /* glsl */ `
void place(vec3 c, float size, float pull) {
  vec3 v = uCamPos - c;
  float d = length(v);
  vec3 toCam = v / max(d, 1e-4);
  float m = min(size * 0.5 * pull, d * 0.5);
  c += toCam * m;
  size *= (d - m) / max(d, 1e-4);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  vQ = position.xy;
  vec3 p = c + (right * position.x + up * position.y) * size;
  gl_Position = vA < 0.004 ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`

/** A LANTERN's / a lit window's halo: a warm core and a soft bloom, on from dusk, fading into the haze. */
const HALO_GLSL = /* glsl */ `
in vec4 aLamp;
${BILLBOARD}
void main() {
  // (w < 0: a campfire's — deeper orange, flickering with its flames)
  bool fire = aLamp.w < 0.0;
  float flick = fire ? 0.82 + 0.12 * sin(uTime * 13.1) + 0.06 * sin(uTime * 29.7 + 1.3) : 0.94 + 0.06 * sin(uTime * 7.3 + aLamp.x);
  vA = uLamps * flick * (1.0 - fogAmount(aLamp.xyz)) * step(length(aLamp.xyz - uCamPos), 900.0);
  vTint = fire ? vec3(1.0, 0.42, 0.1) * 1.5 : vec3(1.0, 0.66, 0.3) * 2.0;
  place(aLamp.xyz, abs(aLamp.w) * (1.0 + 0.3 * uNight), 1.0);
}`

/** A FIREFLY: drifting slowly round its swarm's centre (two wandering sines on each axis, 0.3–2.4 m up), blinking on
 *  ~35 % of the time with its own rhythm (a soft pulse, then dark), yellow-green — from dusk, near the camera only. */
const FLY_GLSL = /* glsl */ `
in vec4 aFly;
${BILLBOARD}
void main() {
  float s = aFly.w;
  float t = uTime * (0.22 + 0.18 * fract(s * 7.13));
  vec3 c = aFly.xyz + vec3(
    sin(t + s * 12.9) * 4.2 + sin(t * 2.3 + s * 3.1) * 1.1,
    1.3 + sin(t * 0.9 + s * 5.7) * 0.8 + sin(t * 2.9 + s) * 0.25,
    cos(t * 0.8 + s * 7.7) * 4.2 + sin(t * 1.9 + s * 1.7) * 1.1);
  float ph = fract(uTime * (0.18 + 0.16 * fract(s * 3.71)) + fract(s * 9.17));
  float blink = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.22, 0.38, ph));
  float d = length(c - uCamPos);
  vA = blink * uLamps * (1.0 - smoothstep(60.0, 110.0, d)) * smoothstep(0.8, 2.6, d) * 1.8;
  vTint = vec3(0.72, 1.0, 0.32);
  place(c, 0.12 + 0.005 * d, 0.0);
}`


/** A fire part's material: its own vertex and fragment bodies (additive flames, or the smoke blended over). */
function fireMaterial(atmos: Atmosphere, vert: string, frag: string, additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...atmos.uniforms },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
${ATMOS_GLSL}
in vec4 aFire;
out vec2 vQ;
out float vA;
out float vS;
${vert}`,
    fragmentShader: /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec2 vQ;
in float vA;
in float vS;
${frag}`,
  })
}

/** A FLAME tongue: an upright quad (turned to the camera round the vertical) at the fire, its own height and pace. */
const FLAME_GLSL = /* glsl */ `
void main() {
  float s = aFire.w, k = fract(s * 3.17);
  vec3 c = aFire.xyz + vec3(cos(s * 12.0), 0.0, sin(s * 12.0)) * 0.16 * k - vec3(0.0, 0.15, 0.0);
  float h = (0.7 + 0.5 * fract(s * 7.31)) * (0.88 + 0.12 * sin(uTime * (6.0 + 5.0 * k) + s * 9.0));
  vec3 toCam = normalize(vec3(uCamPos.x - c.x, 0.0, uCamPos.z - c.z) + 1e-5);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vQ = vec2(position.x, position.y + 0.5);
  vS = s;
  vA = (0.65 + 0.7 * uLamps) * (1.0 - smoothstep(110.0, 160.0, length(c - uCamPos))) * (1.0 - fogAmount(c));
  vec3 p = c + right * position.x * (0.42 + 0.12 * k) + vec3(0.0, vQ.y * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`
const FLAME_FRAG = /* glsl */ `
void main() {
  float y = vQ.y;
  vec2 nuv = vec2(vQ.x * 0.35 + vS, y * 0.45 - uTime * (0.8 + 0.4 * fract(vS * 5.0)));
  float n = texture(uNoise, nuv).r - 0.5;
  float x = vQ.x + n * 0.4 * y; // (the tongue licks sideways more toward its tip)
  float w = 0.46 * pow(1.0 - y, 0.75) * (0.85 + 0.35 * (texture(uNoise, nuv * 1.7 + 0.3).g - 0.5));
  float a = (1.0 - smoothstep(w * 0.4, w, abs(x))) * smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.62, 1.0, y + n * 0.35));
  if (a < 0.01) discard;
  float core = 1.0 - smoothstep(0.0, w * 0.55, abs(x));
  vec3 col = mix(vec3(0.9, 0.2, 0.02), vec3(1.0, 0.72, 0.26), core * (1.0 - y * 0.85));
  col = mix(col, vec3(1.0, 0.94, 0.72), core * core * (1.0 - y) * 0.65);
  gl_FragColor = vec4(col * a * vA, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
/** SPARKS: rising from the fire, drifting, cooling from yellow to deep orange; some in the air at any time. */
const SPARK_GLSL = /* glsl */ `
in vec4 aFire;
${BILLBOARD}
void main() {
  float s = aFire.w;
  float t = fract(uTime * (0.35 + 0.3 * fract(s * 5.3)) + fract(s * 9.7));
  vec3 c = aFire.xyz + vec3(sin(t * 6.0 + s * 11.0) * 0.3 * t + cos(s * 7.0) * 0.14, 0.15 + t * (1.4 + 1.6 * fract(s * 2.9)), cos(t * 5.0 + s * 3.0) * 0.3 * t + sin(s * 5.0) * 0.14);
  c.xz += uWind * 0.12 * t * t;
  float d = length(c - uCamPos);
  vA = (1.0 - t) * smoothstep(0.0, 0.06, t) * (0.35 + 1.8 * uLamps) * (1.0 - smoothstep(50.0, 90.0, d)) * step(0.35, fract(s * 13.7 + floor(uTime * 0.4 + s) * 0.37));
  vTint = mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.3, 0.05), t) * 1.6;
  place(c, 0.06 + 0.0018 * d, 0.0);
}`
/** SMOKE: soft puffs rising and widening, carried by the wind, lit by the sky — a wisp by day, near nothing at night. */
const SMOKE_GLSL = /* glsl */ `
void main() {
  float s = aFire.w;
  float t = fract(uTime * (0.05 + 0.03 * fract(s * 4.1)) + fract(s * 7.7));
  vec3 c = aFire.xyz + vec3(sin(s * 9.0) * 0.2, 0.7 + t * 5.5, cos(s * 5.0) * 0.2);
  c.xz += uWind * (0.9 * t * t * 6.0);
  float size = 0.45 + t * 2.6;
  vec3 toCam = normalize(uCamPos - c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  vQ = position.xy;
  vS = s;
  vA = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.35, 1.0, t)) * 0.3 * (1.0 - 0.8 * uNight) * (1.0 - smoothstep(90.0, 150.0, length(c - uCamPos))) * (1.0 - fogAmount(c));
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * size, 1.0);
}`
const SMOKE_FRAG = /* glsl */ `
void main() {
  float r2 = dot(vQ, vQ) * 4.0;
  float a = exp(-r2 * 2.6) * (1.0 - smoothstep(0.6, 0.98, sqrt(r2))) * vA * (0.7 + 0.6 * texture(uNoise, vQ * 0.35 + vec2(vS, uTime * 0.02)).r);
  if (a < 0.004) discard;
  vec3 col = vec3(0.62, 0.6, 0.58) * (uAmbSky * 1.4 + uSunColor * 0.35);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
