import * as GFX from './gfx'
const { ConvexGeometry, mergeVertices, toCreasedNormals } = GFX
import type { Horizon } from './Horizon'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere, LOOK, LOOK_REACH } from './Atmosphere'
import type { MapData } from './MapData'
import type { Tier } from './quality'
import { gameParams } from '../settings'
import { wallStoneKept } from './mapPrep'
import { ROCK_RELIEF_GLSL } from './rockRelief'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'

/**
 * ROCKS — Over-the-Hill boulders: chunky low-poly blocks (the convex hull of a few points on a squashed, boxy blob:
 * big flat faces, chamfered edges), light neutral grey, flat-shaded, a soft darkening toward the ground. Placed once
 * at load from the map (deterministic): OUTCROPS of 3–8 blocks on the steeper slopes and ridges, lone boulders in the
 * meadows, a few in and along the river. One instanced draw per shape variant; the instances written are those
 * within the tier's reach, in view, not behind a hill and not too small to see (`update`).
 */
const VARIANTS = 12 // (2026-11-04: was 6 — the user: "the small rocks are all the same shape")
/** + the ROUNDED shapes (after the 6 blocks): the scenery's boulder walls (meta.scenery). */
const ROUND = 2
const CELL = 128
/** The desert's stacks: their variants come after the stones and the round ones; drawn out to STACK_REACH m. */
const STACK0 = 14 // (= VARIANTS + ROUND)
const STACK_REACH = 1800
/** The crags' cells (m): bigger than the stones' — they're drawn ~2.5 km out. */
const CRAG_CELL = 256

/** A seed of its own for a cell / an item at (a, b) (salt: which loop) — placement one change elsewhere can't move. */
export function cellSeed(a: number, b: number, salt: number): number {
  let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(salt, 83492791) ^ 0x2545f491) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export interface Inst { x: number; y: number; z: number; s: number; sy: number; rot: number; tilt: number; v: number; ax?: number; az?: number
  /** (the outland's crags and ledges: drawn on their own pass, farther — and ground to the wheels) */
  crag?: boolean }
/** The desert's stack library (Rocks.loadStacks): [kind][lod] meshes, real diameters, each kind's slabs' corners. */
export interface StackSet { geos: GFX.BufferGeometry[][]; diam: number[]; hulls: Float32Array[][] }

export class Rocks {
  readonly group = new GFX.Group()
  private readonly meshes: GFX.InstancedMesh[] = []
  private readonly grid = new Map<number, Inst[]>()
  private readonly m = new GFX.Matrix4()
  private readonly q = new GFX.Quaternion()
  private readonly e = new GFX.Euler()
  private readonly reach: number
  private rubbleK = 1
  private stoneFoot: [number, number][] | null = null
  /** The stacks (desert): their real diameters by kind, their near / far meshes, their instances (drawn on their own
   *  pass — big, seen from far: STACK_REACH, not the rocks' reach). */
  private stackDiam: number[] = []
  private readonly stackNear: GFX.InstancedMesh[] = []
  private readonly stackFar: GFX.InstancedMesh[] = []
  private stackList: Inst[] = []
  private readonly near: number
  /** The rounded shapes' far LOD (rockNear on): one mesh per ROUND variant. */
  private readonly farMeshes: GFX.InstancedMesh[] = []
  /** The desert's sculpted stones' far LOD (≈ 60 triangles, not 256): one mesh per block variant (stones.glb). */
  private readonly stoneFar: GFX.InstancedMesh[] = []
  count = 0
  /** The verges' stones, held back till settleVerge. */
  private verge: Inst[] = []
  /** Every rock (the physics builds colliders for the ones near the car) and each shape's vertices (unit size). */
  readonly all: Inst[]
  readonly shapes: Float32Array[] = []
  /** A STACK's slabs (by variant; unit size, like its shape): each its corners — the physics builds a hull per slab. */
  readonly slabs: Float32Array[][] = []
  /** Where the rocks stand (R8 on the box's 2 m grid, 255 = covered): the grass keeps out of them. */
  readonly footprint: GFX.DataTexture

  /** The desert's STONES (2026-11-04, the user: "sculpt … the rocks"): sculpted in Blender
   *  (scripts/oth/desert_stones.py → stones.glb) — weathered sandstone, bedded and broken — in the chamfered blocks'
   *  place; [variant][lod]. null if the file is missing (the blocks then). */
  static async loadStones(url: string): Promise<GFX.BufferGeometry[][] | null> {
    try {
      const gltf = await new GFX.GLTFLoader().loadAsync(url)
      const out: GFX.BufferGeometry[][] = []
      gltf.scene.traverse((o) => {
        const m = /^stone_(\d+)_(\d+)/.exec(o.name), mesh = o as GFX.Mesh
        if (!m || !mesh.isMesh) return
        mesh.updateWorldMatrix(true, false)
        const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
        g.deleteAttribute('normal')
        ;(out[+m[1]] ??= [])[+m[2]] = toCreasedNormals(g, Math.PI / 2.2) // (smooth, not faceted)
      })
      return out.length >= VARIANTS && out.slice(0, VARIANTS).every((l) => l?.[0] && l[1]) ? out : null
    } catch {
      return null
    }
  }

  /** The desert's STACKED ROCK (desert_stacks.py → stacks.json + stacks.bin — 2026-11-04, round 2: angular slabs, not
   *  pancakes): [kind][lod], each normalised to unit size across (its base at y −0.5, like the stones), with a per-slab
   *  TONE attribute; its real diameter; and each SLAB's corners (unit size) — the physics' convex hull per slab. */
  static async loadStacks(url: string): Promise<StackSet | null> {
    try {
      const [meta, bin] = await Promise.all([
        fetch(url).then((r) => r.json()) as Promise<{ kinds: { radius: number; lods: number[][]; slabs: number[][] }[] }>,
        fetch(url.replace(/\.json$/, '.bin')).then((r) => r.arrayBuffer()),
      ])
      const geos: GFX.BufferGeometry[][] = [], diam: number[] = [], hulls: Float32Array[][] = []
      for (const k of meta.kinds) {
        const d = 2 * k.radius, s = 1 / d
        geos.push(k.lods.map(([po, nv, io, ni]) => {
          const g = new GFX.BufferGeometry()
          g.setAttribute('position', new GFX.BufferAttribute(new Float32Array(bin, po, nv * 3).slice(), 3))
          g.setAttribute('tone', new GFX.BufferAttribute(new Float32Array(bin, po + nv * 12, nv).slice(), 1))
          g.setIndex(new GFX.BufferAttribute(new Uint32Array(bin, io, ni).slice(), 1))
          // (the creases in METRES — the hash welds within 1 cm: at unit size a chamfer would weld into its side.
          //  30°: a slab's corners, its chamfer and its top read as planes; a big slab's many corners round off)
          const c = toCreasedNormals(g, Math.PI / 6)
          return c.applyMatrix4(new GFX.Matrix4().makeScale(s, s, s)).applyMatrix4(new GFX.Matrix4().makeTranslation(0, -0.5, 0))
        }))
        diam.push(d)
        hulls.push(k.slabs.map((p) => {
          const a = new Float32Array(p)
          for (let i = 0; i < a.length; i += 3) { a[i] *= s; a[i + 1] = a[i + 1] * s - 0.5; a[i + 2] *= s }
          return a
        }))
      }
      return { geos, diam, hulls }
    } catch {
      return null
    }
  }

  constructor(private readonly map: MapData, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4, stones: GFX.BufferGeometry[][] | null = null,
    stacks: StackSet | null = null) {
    this.stackDiam = stacks?.diam ?? []
    this.reach = tier.rockReach * (map.desert ? 1 : LOOK_REACH)   // (under the look's haze: Atmosphere LOOK_REACH)
    this.near = tier.rockNear
    const mk = (stack: boolean, crag = false) => new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, ...(crag ? { uCragSnow: { value: new GFX.Vector4(map.meta.outland?.snow?.x ?? 0, map.meta.outland?.snow?.z ?? 0, map.meta.outland?.snow?.r ?? 0, map.meta.outland?.snow?.line ?? 1e5) } } : {}) },
      defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.rockRelief ? { OTH_ROCK_RELIEF: '' } : {}), ...map.biomeDefines, ...(stack ? { OTH_STACK: '' } : {}), ...(crag ? { OTH_CRAG: '' } : {}) },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    const mat = mk(false)
    const stackMat = stacks ? mk(true) : mat
    // (LOW — the phones: the desert's small rubble 40 % as thick; the big blocks, what fills a view, all kept)
    this.rubbleK = tier.name === 'low' ? 0.4 : 1
    // (each sculpted stone's foot and height, unit size: [lowest y, highest − lowest] — place() stands them on it)
    this.stoneFoot = stones ? stones.slice(0, VARIANTS).map((l) => {
      const p = l[0].attributes.position.array as Float32Array
      let lo = Infinity, hi = -Infinity
      for (let i = 1; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]) }
      return [lo, hi - lo] as [number, number]
    }) : null
    const all = (this.all = this.place())
    for (let v = 0; v < VARIANTS + ROUND; v++) {
      const sculpted = v < VARIANTS ? stones?.[v] : undefined
      const geo = sculpted ? sculpted[0] : v < VARIANTS ? boulder(0x51ed + v * 977) : roundBoulder(0x7a3 + v * 131)
      // (the physics' hull: the sculpted stone's far shape — its hull is the near one's, near enough, from 32 points)
      this.shapes.push((sculpted ? sculpted[1] : geo).attributes.position.array as Float32Array)
      const n = all.filter((r) => r.v === v && !r.crag).length + this.verge.filter((r) => r.v === v).length // (+ the verges', settled later)
      const mesh = new GFX.InstancedMesh(geo, mat, Math.max(1, n))
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
      this.meshes.push(mesh)
      this.group.add(mesh)
      if (sculpted) {
        const far = new GFX.InstancedMesh(sculpted[1], mat, Math.max(1, n))
        far.count = 0
        far.frustumCulled = false
        far.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
        this.stoneFar[v] = far
        this.group.add(far)
      }
      if (v >= VARIANTS) {
        const far = new GFX.InstancedMesh(roundBoulder(0x7a3 + v * 131, 1), mat, Math.max(1, n))
        far.count = 0
        far.frustumCulled = false
        far.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
        this.farMeshes.push(far)
        this.group.add(far)
      }
    }
    // the STACKS' meshes: their near and far shapes, after the stones and the round ones
    for (const [k, l] of (stacks?.geos ?? []).entries()) {
      const v = STACK0 + k, n = all.filter((r) => r.v === v).length
      this.shapes[v] = l[1].attributes.position.array as Float32Array // (a hull round the whole: the GPS's obstacles)
      this.slabs[v] = stacks!.hulls[k] // (the physics: a hull per slab — the car drives on the slabs themselves)
      for (const [lod, geo] of l.entries()) {
        const mesh = new GFX.InstancedMesh(geo, stackMat, Math.max(1, n))
        mesh.count = 0; mesh.frustumCulled = false
        mesh.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
        ;(lod === 0 ? this.stackNear : this.stackFar)[k] = mesh
        this.group.add(mesh)
      }
    }
    const g = map.inner, fp = new Uint8Array(g.n * g.n)
    for (const r of all) this.stampRock(fp, r)
    this.footprint = new GFX.DataTexture(fp, g.n, g.n, GFX.RedFormat, GFX.UnsignedByteType)
    // (mipmapped: the grass reads it blurred too, shortening round a boulder — Grass.ts)
    this.footprint.minFilter = GFX.LinearMipmapLinearFilter
    this.footprint.magFilter = GFX.LinearFilter
    this.footprint.generateMipmaps = true
    this.footprint.unpackAlignment = 1
    this.footprint.needsUpdate = true
    // THE CRAGS' meshes: the blocks' shapes again, their own instances (drawn out to cragReach — update)
    this.cragReach = tier.rockReach * 2.8 * (tier.weakGpu ? 0.65 : 1) * (map.desert ? 1 : LOOK_REACH)   // (a weak GPU — the phones: a third nearer)
    // (their own material: GRASS CAPS — OTH_CRAG in FRAG; ?cragcaps=0: bare grey tops, the A/B)
    const cragMat = gameParams().get('cragcaps') === '0' ? mat : mk(false, true)
    for (let v = 0; v < VARIANTS; v++) {
      const n = all.filter((r) => r.crag && r.v === v).length
      const mesh = new GFX.InstancedMesh(this.meshes[v].geometry, cragMat, Math.max(1, n))
      mesh.count = 0; mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
      this.cragMeshes.push(mesh)
      this.group.add(mesh)
    }
    for (const r of all) if (r.crag) this.toCragGrid(r); else this.toGrid(r)
  }

  /** The crags by 256 m cell (their own pass). */
  private readonly cragGrid = new Map<number, Inst[]>()
  private readonly cragBox = new Map<number, [number, number]>()
  private readonly cragMeshes: GFX.InstancedMesh[] = []
  private cragReach = 2500
  /** Is (x, z) on a crag's footprint (+ pad m)? — the outland's trees and bushes keep off them. */
  onCrag(x: number, z: number, pad: number): boolean {
    const ci = Math.floor(x / CRAG_CELL), cj = Math.floor(z / CRAG_CELL)
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      for (const r of this.cragGrid.get(this.key(i, j)) ?? []) {
        const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot), s = Math.sin(r.rot)
        if (dx * dx + dz * dz > (r.s * 0.75 + pad) ** 2) continue
        if (Math.abs(dx * c - dz * s) < r.s * 0.5 + pad && Math.abs(dx * s + dz * c) < r.s * (r.az ?? 0.9) * 0.45 + pad) return true
      }
    }
    return false
  }

  private toCragGrid(r: Inst): void {
    const k = this.key(Math.floor(r.x / CRAG_CELL), Math.floor(r.z / CRAG_CELL))
    let list = this.cragGrid.get(k)
    if (!list) this.cragGrid.set(k, (list = []))
    list.push(r)
  }

  private toGrid(r: Inst): void {
    const k = this.key(Math.floor(r.x / CELL), Math.floor(r.z / CELL))
    let list = this.grid.get(k)
    if (!list) this.grid.set(k, (list = []))
    list.push(r)
  }

  private footBase: Uint8Array | null = null
  private readonly marks = new Map<string, [number, number, number]>()
  /**
   * A MARK on the footprint (Gather.ts: a pile, a stump, a stockpile — the ground there trodden, the grass kept off it,
   * so what lies there shows): a soft disc of radius r at (x, z) under `id`; r 0 takes it off (the cells back as the
   * placement left them). The grass re-bakes its field to see it (Grass.refresh).
   */
  mark(id: string, x: number, z: number, r: number): void {
    const fp = this.footprint.image.data as Uint8Array
    const base = (this.footBase ??= fp.slice())
    const old = this.marks.get(id)
    if (r > 0) this.marks.set(id, [x, z, r]); else if (!this.marks.delete(id)) return
    const g = this.map.inner
    const redo = (cx: number, cz: number, cr: number) => {
      const i0 = Math.max(0, Math.floor((cx - cr - g.origin) / g.step)), i1 = Math.min(g.n - 1, Math.ceil((cx + cr - g.origin) / g.step))
      const j0 = Math.max(0, Math.floor((cz - cr - g.origin) / g.step)), j1 = Math.min(g.n - 1, Math.ceil((cz + cr - g.origin) / g.step))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = g.origin + i * g.step, pz = g.origin + j * g.step, k = j * g.n + i
        let v = base[k]
        for (const [mx, mz, mr] of this.marks.values()) {
          const d = Math.hypot(px - mx, pz - mz) / mr
          if (d < 1.3) v = Math.max(v, Math.round(255 * Math.min(1, Math.max(0, (1.3 - d) / 0.35))))
        }
        fp[k] = v
      }
    }
    if (old) redo(old[0], old[1], old[2] + 2)
    if (r > 0) redo(x, z, r + 2)
    this.footprint.needsUpdate = true
  }

  /** A rock's footprint (the grass keeps out of it; the trees and bushes are placed off it): a soft disc, its size. */
  private stampRock(fp: Uint8Array, r: Inst): void {
    const g = this.map.inner
    const rad = r.s * 0.5, i0 = Math.max(0, Math.floor((r.x - rad - g.origin) / g.step)), i1 = Math.min(g.n - 1, Math.ceil((r.x + rad - g.origin) / g.step))
    const j0 = Math.max(0, Math.floor((r.z - rad - g.origin) / g.step)), j1 = Math.min(g.n - 1, Math.ceil((r.z + rad - g.origin) / g.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(g.origin + i * g.step - r.x, g.origin + j * g.step - r.z) / rad
      const v = Math.round(255 * Math.min(1, Math.max(0, (1.15 - d) / 0.3)))
      if (v > fp[j * g.n + i]) fp[j * g.n + i] = v
    }
  }

  /** THE VERGES' STONES (place: picked, held back) join the rocks once the trees and the small things stand (World.build):
   *  placed with the rest, they moved every tree and log pile after them — and with a log pile every supply crate's id
   *  (the journal keeps them). Each keeps clear of the trees (`treeData`, `stride` numbers a tree: x, y, z first) and of
   *  the props (x, z); the kept ones join `all`, the grid and the footprint. */
  settleVerge(treeData: Float32Array, stride: number, props: { x: number; z: number }[], keep: [number, number, number][] = []): void {
    this.verge = this.verge.filter((r) => keep.every(([x, z, rr]) => (r.x - x) ** 2 + (r.z - z) ** 2 > (rr + r.s * 0.5) ** 2))
    if (!this.verge.length) return
    const H = new Map<number, number[]>(), C = 8
    const put = (x: number, z: number, i: number) => { const k = this.key(Math.floor(x / C), Math.floor(z / C)); const l = H.get(k); if (l) l.push(i); else H.set(k, [i]) }
    const n = treeData.length / stride
    for (let i = 0; i < n; i++) put(treeData[i * stride], treeData[i * stride + 2], i)
    for (let i = 0; i < props.length; i++) put(props[i].x, props[i].z, n + i)
    const near = (x: number, z: number, r: number) => {
      for (let j = Math.floor((z - r - 3) / C); j <= Math.floor((z + r + 3) / C); j++) for (let i = Math.floor((x - r - 3) / C); i <= Math.floor((x + r + 3) / C); i++) {
        for (const q of H.get(this.key(i, j)) ?? []) {
          const [px, pz, clear] = q < n ? [treeData[q * stride], treeData[q * stride + 2], 1.0] : [props[q - n].x, props[q - n].z, 2.0]
          if ((px - x) ** 2 + (pz - z) ** 2 < (r + clear) ** 2) return true
        }
      }
      return false
    }
    const fp = this.footprint.image.data as Uint8Array
    for (const r of this.verge) {
      if (near(r.x, r.z, r.s * 0.55)) continue
      this.all.push(r)
      this.toGrid(r)
      this.stampRock(fp, r)
    }
    this.verge = []
    this.cellBox.clear()
    this.footprint.needsUpdate = true
  }

  private key(i: number, j: number): number { return (i + 512) * 1024 + (j + 512) }

  /** Take out the stones standing in these discs (x, z, r — the new places' ground, Sites.ts): from `all` and the grid
   *  (the footprint keeps their mark: the grass there is short anyway). After the places are placed — nothing moves. */
  removeWithin(keep: [number, number, number][]): void {
    if (!keep.length) return
    const out = (r: Inst) => keep.some(([x, z, rr]) => (r.x - x) ** 2 + (r.z - z) ** 2 < (rr + r.s * 0.4) ** 2) && r.v < STACK0
    const gone = new Set(this.all.filter(out))
    if (!gone.size) return
    const kept = this.all.filter((r) => !gone.has(r))
    this.all.length = 0
    this.all.push(...kept)
    for (const [k, list] of this.grid) this.grid.set(k, list.filter((r) => !gone.has(r)))
    // (… and the crags' own grid: a crag in a kept place — a hidden vale's ravine — was taken off the list, and drawn still)
    for (const [k, list] of this.cragGrid) this.cragGrid.set(k, list.filter((r) => !gone.has(r)))
    this.cragBox.clear()
    this.cellBox.clear()
  }

  /** Each stack's slabs in the world (lazily, for solidTop): per slab its outline (the convex hull of its corners, x z
   *  pairs, counter-clockwise), its underside and its top (m). */
  private readonly slabCache = new Map<Inst, { P: Float32Array; bot: number; top: number }[]>()
  private slabsOf(r: Inst): { P: Float32Array; bot: number; top: number }[] {
    let l = this.slabCache.get(r)
    if (l) return l
    l = []
    const m = this.matrixOf(r, new GFX.Matrix4()), v = new GFX.Vector3()
    for (const src of this.slabs[r.v] ?? []) {
      const pts: [number, number][] = []
      let bot = Infinity, top = -Infinity
      for (let i = 0; i < src.length; i += 3) {
        v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(m)
        pts.push([v.x, v.z]); bot = Math.min(bot, v.y); top = Math.max(top, v.y)
      }
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
      const lo: number[][] = [], hi: number[][] = []
      for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
      for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q) }
      const H = lo.slice(0, -1).concat(hi.slice(0, -1))
      l.push({ P: new Float32Array(H.flat()), bot, top })
    }
    this.slabCache.set(r, l)
    return l
  }

  /** The top of the SOLID at (x, z) from height y0 up (2026-11-04 — a reset or a spawn at the terrain's height put the car
   *  inside a slab where a stack stands on a slope): every slab whose outline holds (x, z), whose underside is within
   *  `room` m over y and whose top is over y, lifts y to its top — again till none does. From the slabs' own outlines
   *  (the physics' hulls), not a physics query: Rapier's queries miss colliders made since its last step. */
  solidTop(x: number, z: number, y0: number, room = 1.8): number {
    let y = y0
    const near: Inst[] = []
    for (const r of this.stackList) if ((r.x - x) ** 2 + (r.z - z) ** 2 < (r.s * 0.75) ** 2) near.push(r)
    for (let pass = 0; pass < 64; pass++) {
      let lifted = false
      for (const r of near) for (const sl of this.slabsOf(r)) {
        if (sl.top <= y + 0.01 || sl.bot > y + room) continue
        const P = sl.P, n = P.length / 2
        let inside = true
        for (let a = 0, b = n - 1; a < n; b = a++) {
          if ((P[a * 2] - P[b * 2]) * (z - P[b * 2 + 1]) - (P[a * 2 + 1] - P[b * 2 + 1]) * (x - P[b * 2]) < 0) { inside = false; break }
        }
        if (inside) { y = sl.top; lifted = true }
      }
      if (!lifted) break
    }
    return y
  }

  /** The STACKS as shadow casters (TerrainShadow.setOccluders): per slab [corner count, its top (m), its corners' x, z]
   *  in the world — the slabs' own corners under each stack's matrix. */
  occluders(): Float32Array {
    const out: number[] = [], m = new GFX.Matrix4(), v = new GFX.Vector3()
    for (const r of this.stackList) {
      const slabs = this.slabs[r.v]
      if (!slabs) continue
      this.matrixOf(r, m)
      for (const src of slabs) {
        const k = src.length / 3, at = out.length
        out.push(k, -Infinity)
        let top = -Infinity
        for (let i = 0; i < src.length; i += 3) {
          v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(m)
          out.push(v.x, v.z); top = Math.max(top, v.y)
        }
        out[at + 1] = top
      }
    }
    return new Float32Array(out)
  }

  /** Every rock (the GPS: the big ones are in an off-road leg's way — Nav.ts Obstacles). */
  each(f: (k: Inst) => void): void {
    for (const list of this.grid.values()) for (const k of list) f(k)
  }

  /** Rocks within r m of (x, z), biggest first (the shot harness). */
  candidates(x: number, z: number, r: number): Inst[] {
    const out: Inst[] = []
    for (const list of this.grid.values()) for (const k of list) if ((k.x - x) ** 2 + (k.z - z) ** 2 < r * r) out.push(k)
    return out.sort((a, b) => b.s - a.s).slice(0, 80)
  }

  /** The biggest rock within r m of (x, z) — the shot harness frames outcrops with it. */
  private idx: Map<Inst, number> | null = null
  /**
   * THE NEAREST BOULDER to work with a pick (Gather.ts — docs/MULTIPLAYER.md §1): a rock between minS and maxS in size
   * whose surface is within r of (x, z), and its index in `all` (the server's node "rock:<i>" — the placement is
   * deterministic, the same on every client). From the 128 m grid: cheap enough per frame.
   */
  nearestBoulder(x: number, z: number, r: number, minS = 0.45, maxS = 4): { i: number; rock: Inst } | null {
    let best: Inst | null = null, bd = Infinity
    for (let j = Math.floor((z - r - maxS) / CELL); j <= Math.floor((z + r + maxS) / CELL); j++) for (let i = Math.floor((x - r - maxS) / CELL); i <= Math.floor((x + r + maxS) / CELL); i++) {
      const list = this.grid.get(this.key(i, j))
      if (!list) continue
      for (const k of list) {
        if (k.s < minS || k.s > maxS) continue
        const d = Math.hypot(k.x - x, k.z - z) - k.s * 0.85
        if (d < r && d < bd) { bd = d; best = k }
      }
    }
    if (!best) return null
    if (!this.idx) { this.idx = new Map(); this.all.forEach((k, n) => this.idx!.set(k, n)) }
    const i = this.idx.get(best)
    return i === undefined ? null : { i, rock: best }
  }

  /** Every boulder a pick can work (nearestBoulder's sizes) within r of (x, z), with its index (the bot — Bot.ts). */
  bouldersNear(x: number, z: number, r: number, minS = 0.45, maxS = 4): { i: number; rock: Inst }[] {
    if (!this.idx) { this.idx = new Map(); this.all.forEach((k, n) => this.idx!.set(k, n)) }
    const out: { i: number; rock: Inst }[] = []
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      const list = this.grid.get(this.key(i, j))
      if (!list) continue
      for (const k of list) {
        if (k.s < minS || k.s > maxS || (k.x - x) ** 2 + (k.z - z) ** 2 > r * r) continue
        const n = this.idx.get(k)
        if (n !== undefined) out.push({ i: n, rock: k })
      }
    }
    return out
  }

  biggestNear(x: number, z: number, r: number): Inst | null {
    let best: Inst | null = null
    for (const list of this.grid.values()) for (const k of list) {
      if ((k.x - x) ** 2 + (k.z - z) ** 2 < r * r && (!best || k.s > best.s)) best = k
    }
    return best
  }

  /** Deterministic placement from the map's height + mask. */
  private place(): Inst[] {
    const out: Inst[] = []
    const map = this.map, half = map.half - 40
    let s = 0x2545f491
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    // (the DESERT draws each cell's / item's stones from its own seed: one stream for the whole map meant a mask change
    //  in one corner moved every stone after it — DESERT_MATCH round 6. The valley keeps its one stream: its layout
    //  stays as it is)
    const at = (a: number, b: number, salt: number) => { if (map.desert) s = cellSeed(a, b, salt) }
    const mk: [number, number, number, number] = [0, 0, 0, 0]
    const slope = (x: number, z: number) => {
      const dx = map.height(x + 3, z) - map.height(x - 3, z), dz = map.height(x, z + 3) - map.height(x, z - 3)
      return Math.hypot(dx, dz) / 6
    }
    // not in / at the water, never on a track
    const dry = (x: number, z: number) => map.maskAt(x, z, mk)[2] < 0.8 && map.trailDist(x, z) > map.meta.trails.hw + 2.5
    const add = (x: number, z: number, size: number, sink: number) => {
      // (sunk by the ground's fall across the rock, so its uphill side never floats)
      const r = size * 0.5
      const y = Math.min(map.height(x - r, z), map.height(x + r, z), map.height(x, z - r), map.height(x, z + r), map.height(x, z))
      // (the same draws in the same order as ever: no stone in the valley moves)
      const sy = size * (1.0 + 0.6 * rnd()), rot = rnd() * Math.PI * 2, tilt = (rnd() - 0.5) * 0.2, v = Math.floor(rnd() * VARIANTS)
      // (a SCULPTED stone stands by its own foot — 2026-11-04, the user: "some rocks are above the ground, in the air":
      //  the flat slabs' feet are higher than the old blocks', and the old lift left them hovering — its foot a fifth of
      //  its height into the ground, a big block's a quarter)
      const foot = this.stoneFoot?.[v]
      const yy = foot ? y - foot[0] * sy - (sink < 0 ? 0.25 : 0.2) * foot[1] * sy : y - sink * size * 0.3
      // (each its own proportions across — from a hash of where it stands: no draw, so nothing moves)
      const hh = cellSeed(Math.round(x * 4), Math.round(z * 4), 31)
      out.push({ x, y: yy, z, s: size, sy, rot, tilt, v, ax: 0.78 + 0.44 * ((hh & 1023) / 1023), az: 0.72 + 0.44 * (((hh >>> 10) & 1023) / 1023) })
    }
    const outcrop0 = out.length
    // OUTCROPS: a jittered 40 m grid; likelier on steep ground and the rock mask, never in water
    for (let gz = -half; gz < half; gz += 40) {
      for (let gx = -half; gx < half; gx += 40) {
        at(gx, gz, 1)
        const x = gx + rnd() * 40, z = gz + rnd() * 40
        const sl = slope(x, z)
        map.maskAt(x, z, mk)
        // (none ON the outcrops — they're terrain now; a few loose boulders round their edge)
        if (mk[0] > 0.55) continue
        const p = Math.min(0.6, Math.max(0, (sl - 0.22) * 1.6) + mk[0] * 1.2) * (dry(x, z) ? 1 : 0) * (1 - mk[3] * 0.5)
        if (rnd() > p) continue
        // (the desert's: stones, not house blocks — on its slickrock a car must crawl past them — 2026-11-04)
        const n = 4 + Math.floor(rnd() * 6), big = map.desert ? 1.5 + rnd() * 3 : 5 + rnd() * 9
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, d = rnd() * big * 1.4
          const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d
          if (!dry(px, pz)) continue
          add(px, pz, big * (0.35 + 0.65 * rnd()) * (i === 0 ? 1.3 : 1), 0.25)
        }
      }
    }
    // THE LOOK (2026-11-13, the user: "on the hills box-like rocks — remove them; the terrain itself sculpted, with the
    // rock texture"): the outcrops' blocks on a hillside (over ~17°) taken out after the draws — no other stone moves;
    // the ground is stepped into strata there instead (mapPrep.sculptCliffs) and painted rock. The meadows' keep theirs.
    if (LOOK && !map.desert) {
      const steep = (x: number, z: number) => Math.hypot(map.height(x + 4, z) - map.height(x - 4, z), map.height(x, z + 4) - map.height(x, z - 4)) / 8
      for (let i = out.length - 1; i >= outcrop0; i--) if (steep(out[i].x, out[i].z) > 0.3 || map.maskAt(out[i].x, out[i].z, mk)[0] > 0.35) out.splice(i, 1)
    }
    // (2026-11-06, the user: "lot of routes are impossible to drive" — a bot on every track, scripts/harness/
    //  trackdrive.mjs: an outcrop's block is kept off the track by its CENTRE only, and a big one (5–14 m) reached into
    //  the bed — 30 in the valley, the car stopped dead against them. Those taken out after the draws: no other stone
    //  moves. The desert's are small stones a car crawls past: kept)
    if (!map.desert) {
      // (the lines' segments bucketed by 32 m cell: each block checks the few near it — ~1 ms at load, not ~170)
      const hw = map.meta.trails.hw, C = 32, segs = new Map<number, number[]>()
      const ck = (i: number, j: number) => (i + 512) * 1024 + (j + 512)
      for (const P of map.meta.trails.lines) for (let k = 0; k + 1 < P.length; k++) {
        const i = Math.floor((P[k][0] + P[k + 1][0]) / 2 / C), j = Math.floor((P[k][1] + P[k + 1][1]) / 2 / C)
        let l = segs.get(ck(i, j)); if (!l) segs.set(ck(i, j), (l = []))
        l.push(P[k][0], P[k][1], P[k + 1][0], P[k + 1][1])
      }
      const fromTrack = (x: number, z: number) => {
        let best = 1e9
        const i0 = Math.floor(x / C), j0 = Math.floor(z / C)
        for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
          const l = segs.get(ck(i, j))
          if (l) for (let k = 0; k < l.length; k += 4) {
            const ax = l[k], az = l[k + 1], dx = l[k + 2] - ax, dz = l[k + 3] - az
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
            best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz))
          }
        }
        return best
      }
      for (let i = out.length - 1; i >= 0; i--) {
        const r = out[i], rad = 0.5 * r.s * Math.max(r.ax ?? 1, r.az ?? 0.9)
        if (map.trackDist(r.x, r.z) < rad + hw + 4 && fromTrack(r.x, r.z) - rad < hw) out.splice(i, 1)
      }
    }
    // round the SPAWN and along the TRACKS: a few boulders close by (the player's first view is never empty)
    const sp = map.meta.spawn
    for (let k = 0; k < 26; k++) {
      at(k, 0, 2)
      const a = rnd() * Math.PI * 2, d = 22 + rnd() * 160
      const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d
      if (dry(x, z)) add(x, z, 1.4 + rnd() * 3.2, 0.3)
    }
    for (const L of map.meta.trails.lines) for (let i = 0; i < L.length; i += 3) {
      at(Math.round(L[i][0]), Math.round(L[i][1]), 3)
      // (the desert: a few by the tracks — 2026-11-04, round 2: the open sand CLEAN, as in the user's reference frames;
      //  the stones lie in piles at the walls' feet and in the river's bed, not sprinkled over every metre)
      if (rnd() > (map.desert ? 0.07 : 0.12)) continue
      const [x0, z0] = L[i], side = rnd() < 0.5 ? -1 : 1, j = Math.min(L.length - 1, i + 1)
      const dx = L[j][0] - x0, dz = L[j][1] - z0, l = Math.hypot(dx, dz) || 1, off = map.meta.trails.hw + 3 + rnd() * 9
      const x = x0 - (dz / l) * off * side, z = z0 + (dx / l) * off * side
      if (dry(x, z)) add(x, z, 0.9 + rnd() * 2.4, 0.3)
      if (map.desert && rnd() < 0.2) for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
        const px = x + (rnd() - 0.5) * 6, pz = z + (rnd() - 0.5) * 6
        if (dry(px, pz) && map.trackDist(px, pz) > map.meta.trails.hw + 2.5) add(px, pz, 0.4 + rnd() * 1.2, 0.3)
      }
    }
    // LONE BOULDERS in the open
    for (let gz = -half; gz < half; gz += 70) {
      for (let gx = -half; gx < half; gx += 70) {
        at(gx, gz, 4)
        if (rnd() > (map.desert ? 0.03 : 0.22)) continue
        const x = gx + rnd() * 70, z = gz + rnd() * 70
        if (!dry(x, z)) continue
        add(x, z, 1.2 + rnd() * 2.6, 0.3)
      }
    }
    // BOULDER FIELDS (the desert, 2026-11-03 — the user: "how fuller it is, even if it's just a desert"): the open sand
    // strewn with chunky blocks — clusters of mixed sizes, now and then a big one — thick where a slow noise says, a
    // clearing between; and RUBBLE where gentle ground meets a wall (a cliff's foot). Never on a track (big ones keep
    // well off), in the water or on the oasis floor. ?fields=0: without them (the cost A/B)
    if (map.desert && new URLSearchParams(location.search).get('fields') !== '0') {
      const sm = GFX.MathUtils.smoothstep
      const vn = (x: number, z: number, cell: number, salt: number) => {
        const fx = x / cell, fz = z / cell, ix = Math.floor(fx), iz = Math.floor(fz), u = sm(fx - ix, 0, 1), w = sm(fz - iz, 0, 1)
        const h = (a: number, b: number) => cellSeed(a, b, salt) / 4294967296
        return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - w) + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * w
      }
      const hw = map.meta.trails.hw
      for (let gz = -half; gz < half; gz += 20) {
        for (let gx = -half; gx < half; gx += 20) {
          at(gx, gz, 6)
          const x = gx + rnd() * 20, z = gz + rnd() * 20
          if (!dry(x, z) || mk[0] > 0.5 || mk[3] > 0.25) continue // (dry() reads the mask into mk)
          // (2026-11-04, round 2: no open-sand fields — the clean sand of the reference frames; RUBBLE only where the
          //  ground meets a wall, in piles)
          const f = 0
          const h0 = map.height(x, z)
          const rise = Math.max(map.height(x + 24, z), map.height(x - 24, z), map.height(x, z + 24), map.height(x, z - 24)) - h0
          const foot = sm(rise, 8, 20) * (1 - sm(slope(x, z), 0.25, 0.45))
          if (foot < 0.25 || rnd() > 0.55 * foot * this.rubbleK) continue
          const n = 1 + Math.floor(rnd() * (1 + 6 * Math.max(f, foot)))
          for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2, d = 2 + rnd() * 12
            const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d
            if (!dry(px, pz)) continue
            const big = rnd() < 0.08 && map.trackDist(px, pz) > hw + 9
            add(px, pz, big ? 4 + rnd() * 5 : 0.7 + Math.pow(rnd(), 1.6) * 2.6, 0.3)
          }
        }
      }
      // BIG BLOCKS: house-sized chunks (6–16 m), alone or two or three leaning together, across the open ground — what
      // fills a view out to the haze (a small stone is culled past a few hundred metres); thicker in the fields, a few
      // even in the clearings; well off the tracks (by their own size too), the water and the oasis
      for (let gz = -half; gz < half; gz += 60) {
        for (let gx = -half; gx < half; gx += 60) {
          at(gx, gz, 8)
          const x = gx + rnd() * 60, z = gz + rnd() * 60
          if (!dry(x, z) || mk[0] > 0.5 || mk[3] > 0.15 || mk[2] > 0.3) continue
          const f = sm(0.65 * vn(x, z, 520, 11) + 0.35 * vn(x, z, 160, 12), 0.42, 0.72)
          if (rnd() > 0.03 + 0.06 * f) continue // (a few: the slab stacks fill the open ground now — 2026-11-04, round 2)
          const n = 1 + Math.floor(rnd() * 3.6)
          for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 5 + rnd() * 8
            const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, size = (i === 0 ? 9 : 6) + rnd() * 7
            if (!dry(px, pz) || map.trackDist(px, pz) < hw + 6 + size * 0.6 || slope(px, pz) > 0.35) continue
            add(px, pz, size, -0.9) // (standing on the sand, a quarter of it sunk — the fields' stones lie half buried)
          }
        }
      }
    }
    // the SCENERY's WALLS (scripts/oth/scenery.mjs): big rounded stones lining the stream roads on their uphill side
    // (2026-11-13, the user: "reduce this kind of rocks … instead use the rock texture": about one in five stands, the
    //  bank rock where the rest stood — mapPrep.wallsToRock. Each still draws its four numbers: no stone after moves)
    const allWalls = gameParams().get('walls') === '1'
    for (const [x, z, size] of map.meta.scenery?.boulders ?? []) {
      const r = size * 0.5
      const sy = size * (0.85 + 0.3 * rnd()), rot = rnd() * Math.PI * 2, tilt = (rnd() - 0.5) * 0.25, v = VARIANTS + (rnd() < 0.5 ? 0 : 1)
      if (!allWalls && !wallStoneKept(x, z, size)) continue
      const y = Math.min(map.height(x - r, z), map.height(x + r, z), map.height(x, z - r), map.height(x, z + r), map.height(x, z))
      out.push({ x, y: y - size * 0.1, z, s: size, sy, rot, tilt, v })
    }
    // the RIVER: stones in the shallows and on the banks
    const r = map.meta.water.river
    for (let i = 0; i < r.x.length; i += 2) {
      at(Math.round(r.x[i]), Math.round(r.z[i]), 5)
      if (rnd() > 0.35) continue
      const a = rnd() * Math.PI * 2, d = r.hw[i] * (0.6 + rnd() * 1.4)
      add(r.x[i] + Math.cos(a) * d, r.z[i] + Math.sin(a) * d, 0.6 + rnd() * 1.8, 0.35)
    }
    // THE OUTLAND'S ROCK (2026-11-11 — the playable land beyond the box; the user: "bushes and boulders out there"): no
    // mask out there — the slope says where. FALLS of 3–7 blocks on the steeper ground (the feet of the cliffs, the
    // gullies' sides: a hillside to pick a way through), a lone boulder now and then on the open floors; none over
    // 780 m (the high faces are the terrain's own rock), on a road or its verge, or in a lake. A 60 m grid, each cell
    // on its own seed, AFTER every stone of the valley's (its one random sequence is as it was). ?orocks=0: none.
    if (map.play > map.half + 100 && new URLSearchParams(location.search).get('orocks') !== '0') {
      const ho = map.play - 80, hb = map.half - 40
      for (let gz = -ho; gz < ho; gz += 60) for (let gx = -ho; gx < ho; gx += 60) {
        if (gx > -hb && gx < hb && gz > -hb && gz < hb) { gx = hb; continue }
        s = cellSeed(Math.round(gx), Math.round(gz), 71)
        const x = gx + rnd() * 60, z = gz + rnd() * 60, sl = slope(x, z)
        if (sl > 0.95 || rnd() > Math.min(0.4, Math.max(0, (sl - 0.22) * 1.2)) + 0.03) continue
        if (map.height(x, z) > 780) continue
        const fall = sl > 0.24, n = fall ? 3 + Math.floor(rnd() * 5) : 1, big = fall ? 2 + rnd() * 5 : 1.2 + rnd() * 3
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, d = fall ? rnd() * big * 1.7 : 0, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, size = big * (0.35 + 0.65 * rnd()) * (i === 0 ? 1.25 : 1)
          if (map.roadEdge(px, pz) < size * 0.6 + 1.6 || map.lakeAt(px, pz) !== null) { rnd(); rnd(); rnd(); rnd(); continue }
          add(px, pz, size, 0.25)
        }
      }
    }
    // THE BOULDER FIELD (meta.outland.zones `rocks` — the user: "offroad places"): a round of ground thick with stones,
    // boulders 1.3–3.4 m across with rubble between them, a 5 m grid's cells two in three filled at its middle — no line
    // through it: a way to be picked (its bed bare stone: Terrain.ts `stonyAt`; no tree stands in it: Trees.ts)
    if (map.play > map.half + 100 && new URLSearchParams(location.search).get('orocks') !== '0' && new URLSearchParams(location.search).get('zones') !== '0') {
      for (const Z of map.meta.outland?.zones ?? []) {
        if (Z.kind !== 'rocks') continue
        for (let gz = Z.z - Z.r; gz < Z.z + Z.r; gz += 5) for (let gx = Z.x - Z.r; gx < Z.x + Z.r; gx += 5) {
          s = cellSeed(Math.round(gx * 2), Math.round(gz * 2), 73)
          const x = gx + rnd() * 5, z = gz + rnd() * 5, d = Math.hypot(x - Z.x, z - Z.z) / Z.r
          if (d > 1 || rnd() > 0.68 * (1 - 0.55 * d * d)) continue
          const size = rnd() < 0.42 ? 2.0 + rnd() * 1.4 : rnd() < 0.5 ? 1.3 + rnd() * 0.7 : 0.5 + rnd() * 0.5
          if (map.roadEdge(x, z) < size * 0.6 + 1.2) { rnd(); rnd(); rnd(); rnd(); continue }
          add(x, z, size, 0.25)
        }
      }
    }
    // THE OUTLAND'S CRAGS AND LEDGES (2026-11-12, the user's screenshots: "just an empty place … we need naturality,
    // beauty like this" — a Genshin Impact valley: grey cliffs broken into bands and shelves, grass on every ledge):
    // a third of the outland is slope over 30°, and it was one smooth painted face. Now:
    //   CRAGS on the steep ground — a BAND of 2–4 big blocks side by side along the contour, each turned to face down
    //     the hill and sunk into it (only its face and its top show), a second band above it on the steepest: the face
    //     reads as stepped cliffs with grassy shelves between.
    //   LEDGES on the grassy slopes — 2–5 low, wide slabs along the contour, a metre or two of grey face showing:
    //     the shelves that break up a meadow.
    // A 56 m grid, each cell on its own seed (nothing else moves); clear of the roads and their banks, the lakes, the
    // box, the wilds' places and the bridges' ends. Drawn on their own pass out to `cragReach` (`update`). ?crags=0: none.
    if (map.play > map.half + 100 && gameParams().get('crags') !== '0') {
      const ho = map.play - 90, hb = map.half + 60, G = 64
      const keepOff: [number, number, number][] = [
        ...(map.meta.bridges ?? []).flatMap((b) => [[b.x0, b.z0, 30], [b.x1, b.z1, 30]] as [number, number, number][]),
        ...(map.meta.outland?.places ?? []).flatMap((q) => (q.kind === 'worldtree' ? [[q.x, q.z, 1.5 * (q.h ?? 150)]] : q.kind === 'arch' ? [[q.x, q.z, 70]] : q.kind === 'view' || q.kind === 'pass' ? [[q.x, q.z, 40]] : q.kind === 'crater' ? [[q.x, q.z, (q.floor ?? 170) * 0.8]] : []) as [number, number, number][]),
        ...(map.meta.landmarks ?? []).filter((l) => Math.abs(l.x) > map.half || Math.abs(l.z) > map.half).map((l) => [l.x, l.z, l.r + 30] as [number, number, number]),
      ]
      const grad = (x: number, z: number): [number, number] => [(map.height(x + 4, z) - map.height(x - 4, z)) / 8, (map.height(x, z + 4) - map.height(x, z - 4)) / 8]
      // THE STEEPEST FACES BY THE ROADS (2026-11-12, docs/NEXT_outland.md §2 — over ~37° only 0.42 of the cells took a
      // band: big faces still showed stretches of smooth painted rock): where such a face is within ~450 m of a road —
      // where it's LOOKED at — nearly every cell takes one (0.9), and its second band always. The far faces stay as
      // they were (their count, and their cost). The roads' reach: 128 m cells, widened four each way. ?cragsroad=0: off.
      const byRoad = new Set<number>()
      if (gameParams().get('cragsroad') !== '0') for (const L of map.meta.outland?.trails?.lines ?? []) for (let k = 0; k < L.length; k += 8) {
        const ci = Math.floor(L[k][0] / 128), cj = Math.floor(L[k][1] / 128)
        for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) if (i * i + j * j <= 14) byRoad.add((ci + i + 512) * 1024 + cj + j + 512)
      }
      /** A block set into the hill at (x, z), its face toward (dx, dz) (downhill): w wide along the contour, d deep, h of
       *  it standing over the ground at its face. */
      const block = (x: number, z: number, dx: number, dz: number, w: number, d: number, h: number, v: number, lean: number): boolean => {
        const ux = -dz, uz = dx                                         // (along the contour)
        if (keepOff.some(([kx, kz, kr]) => (x - kx) ** 2 + (z - kz) ** 2 < kr * kr)) return false
        // (no corner of it within 7.5 m of a road's edge — roadEdge reads 8 past that: the cut banks stay clear)
        for (const [a1, a2] of [[0, 0], [0.55, 0.3], [-0.55, 0.3], [0.55, -0.6], [-0.55, -0.6], [0, 0.4]]) {
          if (map.roadEdge(x + ux * w * a1 + dx * d * a2, z + uz * w * a1 + dz * d * a2) < 7.5) return false
        }
        const yF = Math.min(map.height(x, z), map.height(x + ux * w * 0.45, z + uz * w * 0.45), map.height(x - ux * w * 0.45, z - uz * w * 0.45))
        if (map.lakeShore(x, z, yF, 1.5)) return false
        // (the unit block: ±0.5 across, ~0.72 high, its middle at 0 — set back into the hill a third of its depth, its
        //  top h over the ground at its face, its foot h / 2 under it)
        const sy = h * 2.1, cx = x - dx * d * 0.32, cz = z - dz * d * 0.32
        out.push({ x: cx, y: yF + 0.25 * h, z: cz, s: w, sy, rot: Math.atan2(dx, dz), tilt: lean, v, ax: 1, az: d / w, crag: true })
        return true
      }
      // (the look: no crag bands or ledges — boxes set into the hills; the ground's own strata and rock instead)
      if (!LOOK) for (let gz = -ho; gz < ho; gz += G) for (let gx = -ho; gx < ho; gx += G) {
        if (gx > -hb && gx < hb && gz > -hb && gz < hb) { gx = hb; continue }
        s = cellSeed(Math.round(gx), Math.round(gz), 81)
        const x = gx + rnd() * G, z = gz + rnd() * G
        const [gxs, gzs] = grad(x, z), sl = Math.hypot(gxs, gzs)
        if (sl < 0.16 || sl > 2.6) continue
        const y = map.height(x, z)
        const dx = -gxs / sl, dz = -gzs / sl                           // (down the hill)
        const steep = sl > 0.52
        const seen = sl > 0.75 && byRoad.has((Math.floor(x / 128) + 512) * 1024 + Math.floor(z / 128) + 512)
        if (rnd() > (seen ? 0.9 : steep ? 0.42 : 0.12 + 0.24 * Math.min(1, (sl - 0.16) / 0.36))) continue
        if (!steep && y > 900) continue
        // (a band's size: the steep faces are 100–400 m tall — their blocks 18–42 m wide, 7–30 m of face showing)
        const n = steep ? 2 + Math.floor(rnd() * 3) : 2 + Math.floor(rnd() * 3), big = steep ? 18 + rnd() * 24 : 7 + rnd() * 9
        // the band: blocks side by side along the contour, overlapping, each its own size, a little in or out of the line
        let along = -((n - 1) / 2) * big * 0.72
        for (let i = 0; i < n; i++) {
          const w = big * (0.7 + 0.6 * rnd()), d = steep ? w * (0.5 + 0.3 * rnd()) : w * (0.6 + 0.35 * rnd())
          const h = steep ? Math.min(30, (5 + rnd() * 12) * Math.min(1.8, sl)) : 1.1 + rnd() * 1.8
          const off = (rnd() - 0.5) * (steep ? 8 : 3), v = Math.floor(rnd() * VARIANTS), lean = (rnd() - 0.5) * 0.12
          const bx = x - dz * along + dx * off, bz = z + dx * along + dz * off
          along += big * (0.6 + 0.25 * rnd())
          // (the contour bends: each block faces its own way down)
          const [ax, az] = grad(bx, bz), al = Math.hypot(ax, az)
          if (al < 0.12) continue
          block(bx, bz, -ax / al, -az / al, w, d, h, v, lean)
          // (the steepest: a second, smaller band above — the cliff in steps)
          if (steep && al > 0.85 && (rnd() < 0.55 || seen)) {
            const up = h / al * 0.9 + d * 0.4, ux = bx + (ax / al) * up, uz = bz + (az / al) * up
            const [bx2, bz2] = grad(ux, uz), bl = Math.hypot(bx2, bz2)
            if (bl > 0.6) block(ux, uz, -bx2 / bl, -bz2 / bl, w * (0.7 + 0.3 * rnd()), d * 0.8, h * (0.6 + 0.4 * rnd()), Math.floor(rnd() * VARIANTS), lean)
          }
        }
      }
      // THE STONE FORESTS (2026-11-12, the user: "Genshin-like landscapes, not a plain place"): out on the lowlands,
      // every ~600 m or so, a CLUSTER of 3–8 tall stone PILLARS — 12–26 m thick, 30–95 m high, the tallest in the
      // middle, each leaning a hair its own way, turf on their tops (the crags' material), a few fallen blocks at their
      // feet. The crags' blocks stood on end: the same draws, the same hulls (ground to the wheels — nothing climbs
      // them). Off the roads, the lakes, the courts and vales, what's placed. ?pillars=0: none.
      if (gameParams().get('pillars') !== '0') for (let gz = -ho; gz < ho; gz += 620) for (let gx = -ho; gx < ho; gx += 620) {
        if (gx > -hb - 200 && gx < hb + 200 && gz > -hb - 200 && gz < hb + 200) continue
        s = cellSeed(Math.round(gx), Math.round(gz), 83)
        if (rnd() > 0.62) continue
        for (let t = 0; t < 6; t++) {
          const cx = gx + 60 + rnd() * 500, cz = gz + 60 + rnd() * 500, cy = map.height(cx, cz)
          const [g0, g1] = grad(cx, cz)
          if (cy > 400 || Math.hypot(g0, g1) > 0.3 || Math.max(Math.abs(cx), Math.abs(cz)) > ho - 80) continue
          if (keepOff.some(([kx, kz, kr]) => (cx - kx) ** 2 + (cz - kz) ** 2 < (kr + 70) ** 2) || [...map.courts, ...map.vales].some((c) => (c.x - cx) ** 2 + (c.z - cz) ** 2 < 220 * 220)) continue
          const n = 3 + Math.floor(rnd() * 6)
          for (let i = 0; i < n; i++) {
            const a = rnd() * 6.2832, d = i === 0 ? 0 : 16 + rnd() * 46, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d
            const w = (i === 0 ? 19 : 12) + rnd() * 9, hgt = (i === 0 ? 62 : 30) + rnd() * (i === 0 ? 34 : 38), y = map.height(x, z)
            let road = false
            for (let q = 0; q < 8 && !road; q++) road = map.roadEdge(x + Math.cos(q * 0.785) * (w * 0.5 + 6), z + Math.sin(q * 0.785) * (w * 0.5 + 6)) < 7.9
            if (road || map.roadEdge(x, z) < 7.9 || map.lakeShore(x, z, y, 2)) continue
            out.push({ x, y: y + hgt * 0.5 - 4, z, s: w, sy: (hgt + 8) / 0.72, rot: rnd() * 6.2832, tilt: (rnd() - 0.5) * 0.08, v: Math.floor(rnd() * VARIANTS), ax: 1, az: 0.8 + rnd() * 0.35, crag: true })
            if (rnd() < 0.6) { const fa = rnd() * 6.2832, fx = x + Math.cos(fa) * (w * 0.5 + 5), fz = z + Math.sin(fa) * (w * 0.5 + 5), fs = 5 + rnd() * 6; if (map.roadEdge(fx, fz) >= 7.9) out.push({ x: fx, y: map.height(fx, fz) + fs * 0.1, z: fz, s: fs, sy: fs * 1.3, rot: rnd() * 6.2832, tilt: (rnd() - 0.5) * 0.5, v: Math.floor(rnd() * VARIANTS), ax: 1, az: 0.7 + rnd() * 0.5, crag: true }) }
          }
          break
        }
      }
    }
    // the desert's STACKED ROCK (meta.stacks — desert.py): each at its own scale and turn, its base on the lowest
    // ground under it (a little sunk: never floating)
    // (?skyline=0: without the stacks past the box — the cost A/B)
    const noSky = new URLSearchParams(location.search).get('skyline') === '0'
    for (const [x, z, sc, rot, k, foot, vs] of map.meta.stacks ?? []) {
      const D = (this.stackDiam[k] ?? 0) * sc
      if (!D) continue
      const skyI = Math.abs(x) > map.half || Math.abs(z) > map.half
      // (LOW — the phones: half the skyline)
      if (skyI && (noSky || (this.rubbleK < 1 && (Math.round(x) + Math.round(z)) % 2 !== 0))) continue
      // (two rings of 12 — a table on a dune's crest hung over its slip face when only 8 points at 0.3 D were read)
      // (its foot: desert.py's (meta's 6th value — fixed before it filled the gaps under the slabs, which would lift
      //  this reckoning), else the lowest ground under it — two rings of 12: a table on a dune's crest hung over its
      //  slip face when only 8 points at 0.3 D were read)
      let base = foot
      if (base === undefined || base === null) {
        let lo = map.height(x, z)
        for (const f of [0.18, 0.32, 0.44]) for (let a = 0; a < 12; a++) lo = Math.min(lo, map.height(x + Math.cos(a * 0.5236) * D * f, z + Math.sin(a * 0.5236) * D * f))
        base = lo - 0.4
      }
      // (vs: a stack fitted to a place stretched up — the escarpment's risers, desert.py)
      const sy = D * (vs ?? 1)
      const inst: Inst = { x, y: base + 0.5 * sy, z, s: D, sy, rot, tilt: 0, v: STACK0 + k, ax: 1, az: 1 }
      out.push(inst); this.stackList.push(inst)
    }
    // THE VERGES (2026-11-06, the user: "why does our world feel empty, especially the valley"): within 25 m of a track
    // stood ~1.8 rocks — the ring the chase camera looks at most. Stones in ones, twos and threes along both edges, now
    // and then a boulder set further back; each spot draws from its own seed (cellSeed), after everything else: no
    // stone above moves. ?verge=0: without them (the A/B)
    const v0 = out.length
    if (!map.desert && gameParams().get('verge') !== '0') {
      const hw = map.meta.trails.hw
      for (const L of map.meta.trails.lines) {
        let t = 0
        for (let i = 1; i < L.length; i++) {
          const [x0, z0] = L[i - 1], dx = L[i][0] - x0, dz = L[i][1] - z0, l = Math.hypot(dx, dz)
          if (l < 1e-3) continue
          const ux = dx / l, uz = dz / l
          for (; t < l; t += 9) {
            const cx = x0 + ux * t, cz = z0 + uz * t
            for (const side of [-1, 1]) {
              s = cellSeed(Math.round(cx), Math.round(cz), side > 0 ? 41 : 42)
              // (the grass stands ~1 m: a stone under that is lost in it — the verge's stones are 0.9–3 m, a boulder 3–5.5)
              if (rnd() > 0.32) continue
              const big = rnd() < 0.24
              const off = big ? hw + 6 + rnd() * 12 : hw + 2.8 + Math.pow(rnd(), 1.5) * 9, slide = (rnd() - 0.5) * 6
              const x = cx - uz * off * side + ux * slide, z = cz + ux * off * side + uz * slide
              if (!dry(x, z)) continue
              if (big) { add(x, z, 3 + rnd() * 2.5, 0.3); continue }
              for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
                const px = x + (rnd() - 0.5) * 3.5, pz = z + (rnd() - 0.5) * 3.5
                if (dry(px, pz)) add(px, pz, (k === 0 ? 1.5 : 0.9) + rnd() * (k === 0 ? 1.5 : 1.0), 0.3)
              }
            }
          }
          t -= l
        }
      }
    }
    this.verge = out.splice(v0)
    // (the outland's roads run a little way into the box, to its own tracks — scripts/oth/wilds.py: a stone of the
    //  valley's that stands in one is taken off, after every draw: no other stone moves. A 4.8 m block stood in the
    //  west connector — the bot stopped dead against it, scripts/harness/trackdrive.mjs SET=outland)
    return map.roadHalf > 1 ? out.filter((r) => r.crag || map.roadEdge(r.x, r.z) > r.s * 0.55 + 0.4) : out   // (the crags: their own corners asked — block())
  }

  /** Terrain occlusion (main.ts sets it): cells behind the hills are skipped. */
  horizon: Horizon | null = null
  /** Per 128 m cell: the lowest base and the highest top of its rocks (the culling's box). */
  private readonly cellBox = new Map<number, [number, number]>()
  private readonly lastPos = new GFX.Vector3(Number.NaN, 0, 0)
  private readonly lastDir = new GFX.Vector3()
  private readonly frustum = new GFX.Frustum()
  private readonly pv = new GFX.Matrix4()
  private readonly box = new GFX.Box3()
  private readonly dir = new GFX.Vector3()
  private readonly p = new GFX.Vector3()
  private readonly sc = new GFX.Vector3()
  /** Cells culled at the last rebuild: outside the view, hidden behind the ground (the HUD). */
  culled = { frustum: 0, occluded: 0, small: 0 }

  /** A rock's world matrix (the same one it is drawn with). */
  matrixOf(r: Inst, out: GFX.Matrix4): GFX.Matrix4 {
    this.q.setFromEuler(this.e.set(r.tilt, r.rot, r.tilt * 0.6))
    return out.compose(new GFX.Vector3(r.x, r.y, r.z), this.q, new GFX.Vector3(r.s * (r.ax ?? 1), r.sy, r.s * (r.az ?? 0.9)))
  }

  /**
   * Re-picks the rocks to draw when the camera has moved 4 m or turned (they never move). CULLING, per 128 m cell:
   * DISTANCE (the tier's reach), FRUSTUM (the cell's box against the view), OCCLUSION (the cell hidden behind the
   * hills: Horizon); per rock: DISTANCE again, and SMALL-FEATURE culling (a rock under ~2 px tall at its distance).
   */
  /** THE GROUND EDITED (GroundEdits.ts) over (x0, z0) … (x1, z1): each rock there moved with it by dy(x, z) — sat on
   *  the ground as it is now, not hanging over a dug pond. Returns the ones moved (Physics rebuilds their hulls). */
  reground(x0: number, z0: number, x1: number, z1: number, dy: (x: number, z: number) => number): number[] {
    const moved: number[] = []
    for (let i = 0; i < this.all.length; i++) {
      const r = this.all[i]
      if (r.x < x0 || r.x > x1 || r.z < z0 || r.z > z1) continue
      const v = dy(r.x, r.z)
      if (Math.abs(v) > 0.005) { r.y += v; moved.push(i) }
    }
    if (moved.length) this.lastPos.set(1e9, 0, 0)
    return moved
  }

  update(camera: GFX.PerspectiveCamera): void {
    camera.getWorldDirection(this.dir)
    if (camera.position.distanceToSquared(this.lastPos) < 16 && this.dir.dot(this.lastDir) > 0.9985) return
    this.lastPos.copy(camera.position); this.lastDir.copy(this.dir)
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    const cx = camera.position.x, cz = camera.position.z, R = this.reach
    // (a rock s m big at d m is s / d × this px tall: under 2 px it isn't drawn)
    const pxPerRad = (innerHeight * Math.min(devicePixelRatio, 2)) / (2 * Math.tan((camera.fov * Math.PI) / 360))
    const minRatio = 2 / pxPerRad
    for (const m of this.meshes) m.count = 0
    for (const m of this.farMeshes) m.count = 0
    for (const m of this.stoneFar) if (m) m.count = 0
    // (a sculpted stone under ~5 % of the view's height tall — sy / d < 0.06 at the 60° view: its 60-triangle shape)
    const lodRatio = 0.06
    const near2 = this.near * this.near
    this.culled.frustum = this.culled.occluded = this.culled.small = 0
    const i0 = Math.floor((cx - R) / CELL), i1 = Math.floor((cx + R) / CELL), j0 = Math.floor((cz - R) / CELL), j1 = Math.floor((cz + R) / CELL)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = this.key(i, j), list = this.grid.get(k)
      if (!list) continue
      const x0 = i * CELL, z0 = j * CELL
      const nx = Math.max(x0 - cx, 0, cx - x0 - CELL), nz = Math.max(z0 - cz, 0, cz - z0 - CELL)
      if (nx * nx + nz * nz > R * R) continue
      let yb = this.cellBox.get(k)
      if (!yb) {
        yb = [Infinity, -Infinity]
        for (const r of list) { yb[0] = Math.min(yb[0], r.y - r.s * 0.3); yb[1] = Math.max(yb[1], r.y + r.sy * 0.7) } // (the stacks: their own pass)
        this.cellBox.set(k, yb)
      }
      // (rocks hang over their cell's edge by up to half their size)
      this.box.min.set(x0 - 10, yb[0], z0 - 10)
      this.box.max.set(x0 + CELL + 10, yb[1], z0 + CELL + 10)
      if (!this.frustum.intersectsBox(this.box)) { this.culled.frustum++; continue }
      if (this.horizon?.hidden(x0 - 10, z0 - 10, x0 + CELL + 10, z0 + CELL + 10, yb[1])) { this.culled.occluded++; continue }
      for (const r of list) {
        if (r.v >= STACK0) continue // (the stacks: their own pass, below)
        const dx = r.x - cx, dz = r.z - cz, d2 = dx * dx + dz * dz
        if (d2 > R * R) continue
        if (r.sy * r.sy < minRatio * minRatio * d2) { this.culled.small++; continue }
        // (a rounded boulder past rockNear: its coarse shape — the fog softens it there)
        const mesh = r.v >= VARIANTS ? (d2 > near2 ? this.farMeshes[r.v - VARIANTS] : this.meshes[r.v])
          : this.stoneFar[r.v] && r.sy * r.sy < lodRatio * lodRatio * d2 ? this.stoneFar[r.v] : this.meshes[r.v]
        this.q.setFromEuler(this.e.set(r.tilt, r.rot, r.tilt * 0.6))
        this.m.compose(this.p.set(r.x, r.y, r.z), this.q, this.sc.set(r.s * (r.ax ?? 1), r.sy, r.s * (r.az ?? 0.9)))
        mesh.setMatrixAt(mesh.count++, this.m)
      }
    }
    // THE CRAGS: out to cragReach, per 256 m cell (in view, not behind the hills), the ones under ~4 px skipped
    for (const m of this.cragMeshes) m.count = 0
    {
      const CR = this.cragReach, c0 = Math.floor((cx - CR) / CRAG_CELL), c1 = Math.floor((cx + CR) / CRAG_CELL), r0 = Math.floor((cz - CR) / CRAG_CELL), r1 = Math.floor((cz + CR) / CRAG_CELL)
      for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
        const k = this.key(i, j), list = this.cragGrid.get(k)
        if (!list) continue
        const x0 = i * CRAG_CELL, z0 = j * CRAG_CELL
        const nx = Math.max(x0 - cx, 0, cx - x0 - CRAG_CELL), nz = Math.max(z0 - cz, 0, cz - z0 - CRAG_CELL)
        if (nx * nx + nz * nz > CR * CR) continue
        let yb = this.cragBox.get(k)
        if (!yb) {
          yb = [Infinity, -Infinity]
          for (const r of list) { yb[0] = Math.min(yb[0], r.y - r.sy * 0.4); yb[1] = Math.max(yb[1], r.y + r.sy * 0.4) }
          this.cragBox.set(k, yb)
        }
        this.box.min.set(x0 - 20, yb[0], z0 - 20)
        this.box.max.set(x0 + CRAG_CELL + 20, yb[1], z0 + CRAG_CELL + 20)
        if (!this.frustum.intersectsBox(this.box)) continue
        if (this.horizon?.hidden(x0 - 20, z0 - 20, x0 + CRAG_CELL + 20, z0 + CRAG_CELL + 20, yb[1])) continue
        for (const r of list) {
          const dx = r.x - cx, dz = r.z - cz, d2 = dx * dx + dz * dz
          if (d2 > CR * CR || r.sy * r.sy < minRatio * minRatio * d2 * 16) continue   // (under ~8 px: not drawn)
          const mesh = this.cragMeshes[r.v]
          this.q.setFromEuler(this.e.set(r.tilt, r.rot, r.tilt * 0.6))
          this.m.compose(this.p.set(r.x, r.y, r.z), this.q, this.sc.set(r.s * (r.ax ?? 1), r.sy, r.s * (r.az ?? 0.9)))
          mesh.setMatrixAt(mesh.count++, this.m)
        }
      }
    }
    // the STACKS: out to STACK_REACH, in view (a sphere round each), the far shape past ~8 % of the view's height
    for (const m of [...this.stackNear, ...this.stackFar]) if (m) m.count = 0
    const sph = new GFX.Sphere()
    for (const r of this.stackList) {
      const dx = r.x - cx, dz = r.z - cz, d2 = dx * dx + dz * dz
      // (the SKYLINE's stacks — out past the box, desert.py — stand 2–4 km off: drawn to 5.2 km, always their far shape;
      //  the box's to STACK_REACH)
      const sky = Math.abs(r.x) > this.map.half || Math.abs(r.z) > this.map.half
      const reach = sky ? 5200 : STACK_REACH
      if (d2 > reach * reach) continue
      sph.center.set(r.x, r.y + r.sy * 0.2, r.z); sph.radius = 0.9 * Math.max(r.s, r.sy) // (a stretched one — desert.py's fitted walls — taller than it is wide)
      if (!this.frustum.intersectsSphere(sph)) continue
      const k = r.v - STACK0, mesh = sky || r.sy * r.sy < 0.08 * 0.08 * d2 ? this.stackFar[k] : this.stackNear[k]
      if (!mesh) continue
      this.q.setFromEuler(this.e.set(0, r.rot, 0))
      this.m.compose(this.p.set(r.x, r.y, r.z), this.q, this.sc.set(r.s, r.sy, r.s))
      mesh.setMatrixAt(mesh.count++, this.m)
    }
    this.count = 0
    for (const m of [...this.meshes, ...this.cragMeshes, ...this.farMeshes, ...this.stoneFar.filter(Boolean), ...this.stackNear.filter(Boolean), ...this.stackFar.filter(Boolean)]) { m.instanceMatrix.needsUpdate = true; this.count += m.count }
  }
}

/**
 * A ROUNDED boulder (unit size) — the big smooth stones of the user's reference walling the stream roads: a squashed
 * icosphere lumped by a few soft waves, its bottom flattened into the ground, smooth normals (the relief does the rest).
 */
function roundBoulder(seed: number, detail = 3): GFX.BufferGeometry {
  let s = seed >>> 0
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const waves = Array.from({ length: 5 }, () => {
    const a = rnd() * Math.PI * 2, b = Math.acos(2 * rnd() - 1)
    return { d: new GFX.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)), f: 1.5 + 2.5 * rnd(), ph: rnd() * 6.28, amp: 0.03 + 0.04 * rnd() }
  })
  let g: GFX.BufferGeometry = new GFX.IcosahedronGeometry(0.5, detail) // (3: 1 280 triangles near; 1: 80 far)
  g.deleteAttribute('normal'); g.deleteAttribute('uv')
  g = mergeVertices(g)
  const p = g.attributes.position as GFX.BufferAttribute, v = new GFX.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    let r = 0.5
    for (const w of waves) r += 0.5 * w.amp * Math.sin(w.f * v.dot(w.d) * Math.PI + w.ph)
    v.multiplyScalar(r)
    v.y *= 0.74
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.25 // (the bottom flattened: it sits in the ground)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

/**
 * One boulder shape (unit size): a CHAMFERED BLOCK — each corner of a box of random proportions (jittered) cut by
 * three chamfer points, a few faces bulged a little — then hulled: big flat faces, soft bevelled edges, flat-shaded.
 */
function boulder(seed: number): GFX.BufferGeometry {
  let s = seed >>> 0
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const ex = 0.5, ey = 0.5 * (0.55 + 0.35 * rnd()), ez = 0.5 * (0.65 + 0.35 * rnd())
  const pts: GFX.Vector3[] = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    // the top a little smaller than the base, every corner its own
    const k = sy > 0 ? 0.9 + 0.08 * rnd() : 1
    const cx = sx * ex * k * (0.85 + 0.15 * rnd()), cy = sy * ey * (0.85 + 0.15 * rnd()), cz = sz * ez * k * (0.85 + 0.15 * rnd())
    const c = 0.1 + 0.08 * rnd()
    pts.push(new GFX.Vector3(cx - sx * c, cy, cz), new GFX.Vector3(cx, cy - sy * c, cz), new GFX.Vector3(cx, cy, cz - sz * c))
  }
  // bulged sides (a facet or two more); the top stays flat
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2
    pts.push(new GFX.Vector3(Math.cos(a) * ex * 1.06, (rnd() - 0.3) * ey, Math.sin(a) * ez * 1.06))
  }
  // flat faces, the chamfer bands between them smoothed (creased normals): big planes with soft rounded edges
  // (2026-11-04: smooth across all but the sharpest edges — the user wants smoothness, not facets)
  const g = toCreasedNormals(new ConvexGeometry(pts), Math.PI / 2.2)
  g.deleteAttribute('uv')
  return g
}

const VERT = /* glsl */ `
${ATMOS_GLSL}
out vec3 vWorld;
out vec3 vN;
out float vUp;
#ifdef OTH_STACK
in float tone;
out float vTone;
out float vUpM;
#endif
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vUp = position.y + 0.5; // 0 at the base … 1 on top
#ifdef OTH_STACK
  vTone = tone;
  vUpM = vUp * length(instanceMatrix[1].xyz); // (metres above the stack's foot)
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
${ROCK_RELIEF_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
in vec3 vWorld;
in vec3 vN;
in float vUp;
#ifdef OTH_CRAG
uniform vec4 uCragSnow; // the early snow: x, z, radius, the line's height
#endif
#ifdef OTH_STACK
in float vTone;
in float vUpM;
#endif
#ifdef OTH_DESERT
const vec3 STONE = vec3(0.5, 0.165, 0.09); // (the sandstone: paint.ts's STONE — keep in step)
// (the stacks' sandstone: paint.ts's SAND × ≈ (0.86, 0.68, 0.7) — the reference frames' rock / sand ratio, linear)
const vec3 STACK_A = vec3(0.4, 0.168, 0.098);
const vec3 STACK_B = vec3(0.47, 0.205, 0.118);
const vec3 STACK_SAND = vec3(0.5, 0.28, 0.155);
#else
const vec3 STONE = vec3(0.2, 0.205, 0.23);
#endif
float fhash(vec3 n) { return fract(sin(dot(floor(n * 300.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  // light grey, each face a touch different, the tops lighter, a soft darkening into the ground (where the relief
  // shows the faces are one plain grey: the relief is their detail)
  float paintK = 1.0;
#ifdef OTH_ROCK_RELIEF
  paintK = 1.0 - reliefShow(max(length(dFdx(vWorld)), length(dFdy(vWorld))));
#endif
#ifdef OTH_STACK
  // THE SLAB STACKS (2026-11-04, round 2 — the user: "like pancakes stacked"): the sand's own family, a little deeper
  // and redder (the user's reference frames: rock in sun ≈ sRGB 222 152 120 against sand 238 180 140 — the rock read by
  // its light and shade, not by a darker paint), each slab its own tone, the flat tops dusted with sand, the first metre
  // sandy where it's half buried. No darkening up a stack's height: a 40 m massif is one rock top to bottom
  vec3 albedo = mix(STACK_A, STACK_B, vTone);
  albedo = mix(albedo, STACK_SAND, smoothstep(0.8, 0.97, N.y) * 0.32);
  albedo = mix(albedo, STACK_SAND, (1.0 - smoothstep(0.1, 0.7, vUpM)) * 0.4);
  float ao = mix(0.78, 1.0, smoothstep(0.0, 1.2, vUpM));
#else
  vec3 albedo = STONE * mix(0.72, 1.0, smoothstep(0.0, 0.45, vUp)) * mix(0.86, 1.1, smoothstep(0.2, 0.9, N.y)); // (no per-face tone: smooth; a slab's top lighter than its side)
  float ao = mix(0.6, 1.0, smoothstep(0.0, 0.5, vUp));
#endif
#ifdef OTH_CRAG
  // GRASS CAPS (2026-11-12, docs/NEXT_outland.md §2 — the references' cliffs wear grass on every top; ours were grey
  // blocks): what faces UP on a crag is turf — the hillside's own gold, green where the paint's slow noise says (as the
  // meadows' patches), ragged at its rim (the noise breaks the line where the top turns to the face), a little moss
  // creeping down the face under it. Two reads of the paint noise; the faces keep their grey.
  {
    vec4 cn = texture(uNoise, vWorld.xz * (1.0 / 37.0) + vec2(0.31, 0.77));
    vec4 cf = texture(uNoise, vWorld.xz * (1.0 / 5.3) + vWorld.y * vec2(0.11, 0.07));
    // (the FACE's own normal, from the surface itself: a crag is a block stretched wide and squashed flat, and the
    //  vertex normal — turned by the instance's matrix, not its inverse — leans a top face over toward its side)
    float upK = abs(normalize(cross(dFdx(vWorld), dFdy(vWorld))).y);
    float cap = smoothstep(0.62, 0.84, upK + (cf.g - 0.5) * 0.3);
    vec3 turf = mix(vec3(0.3, 0.176, 0.05), vec3(0.047, 0.11, 0.038), smoothstep(0.52, 0.7, cn.r)) * (0.82 + 0.36 * cf.b);
    // (… under the early snow — the white peaks' country, above its line — the caps are SNOW)
    float sk = uCragSnow.z > 1.0 ? smoothstep(uCragSnow.w - 25.0, uCragSnow.w + 45.0, vWorld.y + (cn.g - 0.5) * 40.0) * (1.0 - smoothstep(0.8, 1.0, distance(vWorld.xz, uCragSnow.xy) / uCragSnow.z)) : 0.0;
    turf = mix(turf, vec3(0.74, 0.78, 0.86), sk);
    albedo = mix(albedo, turf, cap * 0.92);
    albedo = mix(albedo, vec3(0.06, 0.1, 0.045), (1.0 - cap) * smoothstep(0.25, 0.6, upK) * smoothstep(0.45, 0.7, cf.r) * 0.45);
    paintK *= 1.0 - cap;
  }
#endif
  // HIGH / ULTRA on PCs: the crumpled 3D relief over every face (the light only: the colour above is the face's own)
  float cav = 1.0;
#ifdef OTH_ROCK_RELIEF
#ifdef OTH_STACK
  N = rockRelief(vWorld, N, 0.45, dFdx(vWorld), dFdy(vWorld), cav); // (the slabs' planes stay planes: a faint grain)
#else
  N = rockRelief(vWorld, N, 1.0, dFdx(vWorld), dFdy(vWorld), cav);
#endif
#endif
#ifdef OTH_STACK
  // (the stacks are in the shadow bake — TerrainShadow.setOccluders: a face reads the shade a little out in front of it
  //  — its own slab's top would shade its side — the top its own cell)
  vec2 outN = vN.xz / max(length(vN.xz), 1e-3);
  float sun = sunVisibility(vWorld.xz + outN * 2.5 * smoothstep(0.2, 0.6, 1.0 - abs(vN.y)));
#else
  float sun = sunVisibility(vWorld.xz);
#endif
  vec3 c = shade(albedo, N, V, 0.75, 0.04, ao * cav, sun, 0.05);
  c += rockFill(albedo, N) * ao;
  c += headlight(albedo, N, vWorld);
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
