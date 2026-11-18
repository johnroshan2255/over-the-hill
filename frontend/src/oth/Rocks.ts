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
import { OBARE_T } from './Terrain'

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

export class Rocks {
  readonly group = new GFX.Group()
  private readonly meshes: GFX.InstancedMesh[] = []
  private readonly grid = new Map<number, Inst[]>()
  private readonly m = new GFX.Matrix4()
  private readonly q = new GFX.Quaternion()
  private readonly e = new GFX.Euler()
  private readonly reach: number
  private readonly near: number
  /** The rounded shapes' far LOD (rockNear on): one mesh per ROUND variant. */
  private readonly farMeshes: GFX.InstancedMesh[] = []
  count = 0
  /** The verges' stones, held back till settleVerge. */
  private verge: Inst[] = []
  /** Every rock (the physics builds colliders for the ones near the car) and each shape's vertices (unit size). */
  readonly all: Inst[]
  readonly shapes: Float32Array[] = []
  /** Where the rocks stand (R8 on the box's 2 m grid, 255 = covered): the grass keeps out of them. */
  readonly footprint: GFX.DataTexture

  constructor(private readonly map: MapData, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4) {
    this.reach = tier.rockReach * LOOK_REACH   // (under the look's haze: Atmosphere LOOK_REACH)
    this.near = tier.rockNear
    const mk = (crag: boolean) => new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, ...(crag ? { uCragSnow: { value: new GFX.Vector4(map.meta.outland?.snow?.x ?? 0, map.meta.outland?.snow?.z ?? 0, map.meta.outland?.snow?.r ?? 0, map.meta.outland?.snow?.line ?? 1e5) } } : {}) },
      defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.rockRelief ? { OTH_ROCK_RELIEF: '' } : {}), ...(crag ? { OTH_CRAG: '' } : {}) },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    const mat = mk(false)
    const all = (this.all = this.place())
    for (let v = 0; v < VARIANTS + ROUND; v++) {
      const geo = v < VARIANTS ? boulder(0x51ed + v * 977) : roundBoulder(0x7a3 + v * 131)
      // (the physics' hull)
      this.shapes.push(geo.attributes.position.array as Float32Array)
      const n = all.filter((r) => r.v === v && !r.crag).length + this.verge.filter((r) => r.v === v).length // (+ the verges', settled later)
      const mesh = new GFX.InstancedMesh(geo, mat, Math.max(1, n))
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
      this.meshes.push(mesh)
      this.group.add(mesh)
      if (v >= VARIANTS) {
        const far = new GFX.InstancedMesh(roundBoulder(0x7a3 + v * 131, 1), mat, Math.max(1, n))
        far.count = 0
        far.frustumCulled = false
        far.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
        this.farMeshes.push(far)
        this.group.add(far)
      }
    }
    // (the rocks' stamps go on in `stampFootprint`, a slice a frame — World.build)
    const g = map.inner, fp = new Uint8Array(g.n * g.n)
    this.footprint = new GFX.DataTexture(fp, g.n, g.n, GFX.RedFormat, GFX.UnsignedByteType)
    // (mipmapped: the grass reads it blurred too, shortening round a boulder — Grass.ts)
    this.footprint.minFilter = GFX.LinearMipmapLinearFilter
    this.footprint.magFilter = GFX.LinearFilter
    this.footprint.generateMipmaps = true
    this.footprint.unpackAlignment = 1
    this.footprint.needsUpdate = true
    // THE CRAGS' meshes: the blocks' shapes again, their own instances (drawn out to cragReach — update)
    this.cragReach = tier.rockReach * 2.8 * (tier.weakGpu ? 0.65 : 1) * LOOK_REACH   // (a weak GPU — the phones: a third nearer)
    // (their own material: GRASS CAPS — OTH_CRAG in FRAG; ?cragcaps=0: bare grey tops, the A/B)
    const cragMat = gameParams().get('cragcaps') === '0' ? mat : mk(true)
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

  /** THE FOOTPRINT STAMPED — every rock's disc, a slice at a time (World.build's `sliced`, 2026-11-18): done in the
   *  constructor it was the desert's 12 k big stones' millions of cells in one frame — 31 ms of the crossing's build's
   *  123 ms frame (hitchprof.mjs). The same bytes (a max over the rocks: the order is nothing to it). Before the grass,
   *  the trees and the bushes read it. */
  *stampFootprint(): Generator<void, void, void> {
    const fp = this.footprint.image.data as Uint8Array, all = this.all
    for (let i = 0; i < all.length; i++) { this.stampRock(fp, all[i]); if ((i & 63) === 63) yield }
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
    // (the kept discs by 64 m cell — 2026-11-17, the load: the Wardens' thousands of discs asked by each of ~40 k stones
    //  was a second of the load; the same answers)
    {
      const KC = 64, kh = new Map<number, [number, number, number][]>()
      for (const k of keep) {
        const rr = k[2] + 12   // (+ the biggest stone's half: ≤ ~10 m)
        for (let j = Math.floor((k[1] - rr) / KC); j <= Math.floor((k[1] + rr) / KC); j++) for (let i = Math.floor((k[0] - rr) / KC); i <= Math.floor((k[0] + rr) / KC); i++) { const q = this.key(i, j); const l = kh.get(q); if (l) l.push(k); else kh.set(q, [k]) }
      }
      this.verge = this.verge.filter((r) => (kh.get(this.key(Math.floor(r.x / KC), Math.floor(r.z / KC))) ?? []).every(([x, z, rr]) => (r.x - x) ** 2 + (r.z - z) ** 2 > (rr + r.s * 0.5) ** 2))
    }
    if (!this.verge.length) return
    const H = new Map<number, number[]>(), C = 8
    // (only the cells a verge stone asks — 2026-11-17, the load: every tree of the world (~300 k) was hashed for ~40 k
    //  stones, 1 s at load; the same answers)
    const want = new Set<number>()
    for (const r of this.verge) {
      const rr = r.s * 0.55 + 3
      for (let j = Math.floor((r.z - rr) / C); j <= Math.floor((r.z + rr) / C); j++) for (let i = Math.floor((r.x - rr) / C); i <= Math.floor((r.x + rr) / C); i++) want.add(this.key(i, j))
    }
    const put = (x: number, z: number, i: number) => { const k = this.key(Math.floor(x / C), Math.floor(z / C)); if (!want.has(k)) return; const l = H.get(k); if (l) l.push(i); else H.set(k, [i]) }
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
    // (the discs by 64 m cell — 2026-11-17, the load: ~40 k stones each asking the Wardens' thousands of discs was 4 s of
    //  it; the same stones go)
    const KC = 64, kh = new Map<number, [number, number, number][]>()
    for (const k of keep) {
      const rr = k[2] + 24   // (+ a stone's 0.4 × its size up to 24 m; a bigger one — a crag — asks every disc, as before)
      for (let j = Math.floor((k[1] - rr) / KC); j <= Math.floor((k[1] + rr) / KC); j++) for (let i = Math.floor((k[0] - rr) / KC); i <= Math.floor((k[0] + rr) / KC); i++) { const q = this.key(i, j); const l = kh.get(q); if (l) l.push(k); else kh.set(q, [k]) }
    }
    const cands = (r: Inst) => (r.s * 0.4 <= 24 ? kh.get(this.key(Math.floor(r.x / KC), Math.floor(r.z / KC))) ?? [] : keep)
    const out = (r: Inst) => cands(r).some(([x, z, rr]) => (r.x - x) ** 2 + (r.z - z) ** 2 < (rr + r.s * 0.4) ** 2)
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
      const yy = y - sink * size * 0.3
      // (each its own proportions across — from a hash of where it stands: no draw, so nothing moves)
      const hh = cellSeed(Math.round(x * 4), Math.round(z * 4), 31)
      out.push({ x, y: yy, z, s: size, sy, rot, tilt, v, ax: 0.78 + 0.44 * ((hh & 1023) / 1023), az: 0.72 + 0.44 * (((hh >>> 10) & 1023) / 1023) })
    }
    const outcrop0 = out.length
    // OUTCROPS: a jittered 40 m grid; likelier on steep ground and the rock mask, never in water
    for (let gz = -half; gz < half; gz += 40) {
      for (let gx = -half; gx < half; gx += 40) {
        const x = gx + rnd() * 40, z = gz + rnd() * 40
        const sl = slope(x, z)
        map.maskAt(x, z, mk)
        // (none ON the outcrops — they're terrain now; a few loose boulders round their edge)
        if (mk[0] > 0.55) continue
        const p = Math.min(0.6, Math.max(0, (sl - 0.22) * 1.6) + mk[0] * 1.2) * (dry(x, z) ? 1 : 0) * (1 - mk[3] * 0.5)
        if (rnd() > p) continue
        // (the desert's: stones, not house blocks — on its slickrock a car must crawl past them — 2026-11-04)
        const n = 4 + Math.floor(rnd() * 6), big = 5 + rnd() * 9
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
    if (LOOK) {
      const steep = (x: number, z: number) => Math.hypot(map.height(x + 4, z) - map.height(x - 4, z), map.height(x, z + 4) - map.height(x, z - 4)) / 8
      for (let i = out.length - 1; i >= outcrop0; i--) if (steep(out[i].x, out[i].z) > 0.3 || map.maskAt(out[i].x, out[i].z, mk)[0] > 0.35) out.splice(i, 1)
    }
    // (2026-11-06, the user: "lot of routes are impossible to drive" — a bot on every track, scripts/harness/
    //  trackdrive.mjs: an outcrop's block is kept off the track by its CENTRE only, and a big one (5–14 m) reached into
    //  the bed — 30 in the valley, the car stopped dead against them. Those taken out after the draws: no other stone
    //  moves)
    {
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
      const a = rnd() * Math.PI * 2, d = 22 + rnd() * 160
      const x = sp.x + Math.cos(a) * d, z = sp.z + Math.sin(a) * d
      if (dry(x, z)) add(x, z, 1.4 + rnd() * 3.2, 0.3)
    }
    for (const L of map.meta.trails.lines) for (let i = 0; i < L.length; i += 3) {
      // (the desert: a few by the tracks — 2026-11-04, round 2: the open sand CLEAN, as in the user's reference frames;
      //  the stones lie in piles at the walls' feet and in the river's bed, not sprinkled over every metre)
      if (rnd() > 0.12) continue
      const [x0, z0] = L[i], side = rnd() < 0.5 ? -1 : 1, j = Math.min(L.length - 1, i + 1)
      const dx = L[j][0] - x0, dz = L[j][1] - z0, l = Math.hypot(dx, dz) || 1, off = map.meta.trails.hw + 3 + rnd() * 9
      const x = x0 - (dz / l) * off * side, z = z0 + (dx / l) * off * side
      if (dry(x, z)) add(x, z, 0.9 + rnd() * 2.4, 0.3)
    }
    // LONE BOULDERS in the open
    for (let gz = -half; gz < half; gz += 70) {
      for (let gx = -half; gx < half; gx += 70) {
        if (rnd() > 0.22) continue
        const x = gx + rnd() * 70, z = gz + rnd() * 70
        if (!dry(x, z)) continue
        add(x, z, 1.2 + rnd() * 2.6, 0.3)
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
    // THE VERGES (2026-11-06, the user: "why does our world feel empty, especially the valley"): within 25 m of a track
    // stood ~1.8 rocks — the ring the chase camera looks at most. Stones in ones, twos and threes along both edges, now
    // and then a boulder set further back; each spot draws from its own seed (cellSeed), after everything else: no
    // stone above moves. ?verge=0: without them (the A/B)
    const v0 = out.length
    if (gameParams().get('verge') !== '0') {
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
    // THE OUTLAND AS THE VALLEY (2026-11-17, the user: "some places look boring — make them look like the main valley"):
    // measured against the box, the outland's open country had 60 % of its big rocks / km² (and those on the slopes —
    // the falls above), none in its meadows (its lone boulders it has: the falls' loop). The valley's own two, out there — each cell its own seed, on the verge
    // list (after every stone above, so no stone's index moves; kept clear of the trees, the props and the Wardens'
    // places by settleVerge):
    //   OUTCROPS   a 40 m grid, likelier by the ground's bare rock (MapData.outlandMaskAt — the patches the ground
    //              paints): 4–9 blocks 2–14 m, none on a patch's middle or a hillside (the look's rule above)
    //   THE VERGES along the outland's roads — stones in ones, twos and threes, a boulder set back now and then
    // ?orock2=0: none (the A/B).
    if (map.play > map.half + 100 && gameParams().get('orock2') !== '0') {
      const smoothRise = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k) }
      const ho = map.play - 80, hb = map.half - 40, hwR = map.roadHW
      const om: [number, number, number, number] = [0, 0, 0, 0]
      const steep4 = (x: number, z: number) => Math.hypot(map.height(x + 4, z) - map.height(x - 4, z), map.height(x, z + 4) - map.height(x, z - 4)) / 8
      // (the road field reads 8 m out at most: a big block asks its own edges too)
      const oDry = (x: number, z: number, size: number) => {
        const r = size * 0.55
        if (Math.max(Math.abs(x), Math.abs(z)) > ho || (Math.abs(x) < hb && Math.abs(z) < hb) || map.roadEdge(x, z) < Math.min(7.5, r + 1.6)) return false
        if (r > 5.5 && (map.roadEdge(x + r, z) < 1.5 || map.roadEdge(x - r, z) < 1.5 || map.roadEdge(x, z + r) < 1.5 || map.roadEdge(x, z - r) < 1.5)) return false
        const y = map.height(x, z)
        return y < 780 && map.lakeAt(x, z) === null && !map.lakeShore(x, z, y, 0.6)
      }
      for (let gz = -ho; gz < ho; gz += 40) for (let gx = -ho; gx < ho; gx += 40) {
        if (gx > -hb && gx < hb && gz > -hb && gz < hb) { gx = hb; continue }
        s = cellSeed(Math.round(gx), Math.round(gz), 77)
        const x = gx + rnd() * 40, z = gz + rnd() * 40
        map.outlandMaskAt(x, z, om)
        // (by a cap: its field from 0.24 under the paint's edge to just over it — the valley's mask is blurred, its
        //  patches' edges ~12 m wide; the paint's here are 2–3 m)
        const edge = map.bareRaw > OBARE_T + 0.06 ? 0 : smoothRise(OBARE_T - 0.24, OBARE_T - 0.04, map.bareRaw)
        // (… and the valley's slope term: its outcrops stand on the shoulders too — the look's rule takes the steep ones)
        const pSl = Math.max(0, (steep4(x, z) - 0.22) * 1.6)
        if (om[0] > 0.6 || (edge <= 0 && pSl <= 0)) continue
        if (rnd() > Math.min(0.85, edge * 1.15 + pSl) * (1 - om[3] * 0.5)) continue
        const n = 4 + Math.floor(rnd() * 6), big = 5 + rnd() * 9
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, d = rnd() * big * 1.4, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, size = big * (0.35 + 0.65 * rnd()) * (i === 0 ? 1.3 : 1)
          if (!oDry(px, pz, size) || steep4(px, pz) > 0.3 || map.outlandMaskAt(px, pz, om)[0] > 0.35) { rnd(); rnd(); rnd(); rnd(); continue }
          add(px, pz, size, 0.25)
        }
      }
      for (const L of map.meta.outland?.trails?.lines ?? []) {
        let t = 0
        for (let i = 1; i < L.length; i++) {
          const [x0, z0] = L[i - 1], dx = L[i][0] - x0, dz = L[i][1] - z0, l = Math.hypot(dx, dz)
          if (l < 1e-3) continue
          const ux = dx / l, uz = dz / l
          for (; t < l; t += 9) {
            const cx = x0 + ux * t, cz = z0 + uz * t
            for (const side of [-1, 1]) {
              s = cellSeed(Math.round(cx), Math.round(cz), side > 0 ? 43 : 44)
              if (rnd() > 0.24) continue   // (the valley's 0.32: the outland has its slopes' falls besides)
              const big = rnd() < 0.24
              const off = big ? hwR + 6 + rnd() * 12 : hwR + 2.8 + Math.pow(rnd(), 1.5) * 9, slide = (rnd() - 0.5) * 6
              const x = cx - uz * off * side + ux * slide, z = cz + ux * off * side + uz * slide
              if (big) { const size = 3 + rnd() * 2.5; if (oDry(x, z, size)) add(x, z, size, 0.3); continue }
              for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
                const px = x + (rnd() - 0.5) * 3.5, pz = z + (rnd() - 0.5) * 3.5, size = (k === 0 ? 1.5 : 0.9) + rnd() * (k === 0 ? 1.5 : 1.0)
                if (oDry(px, pz, size)) add(px, pz, size, 0.3)
              }
            }
          }
          t -= l
        }
      }
    }
    this.verge = out.splice(v0)
    // (… and none in a NARROW WAY — paths.ts: a stone or a crag standing in one is taken off, after every draw)
    if (map.meta.paths?.lines.length) { const clear = (r: Inst) => map.pathEdge(r.x, r.z) > r.s * 0.55 + (r.crag ? 1.5 : 0.4); this.verge = this.verge.filter(clear); let w = 0; for (const r of out) if (clear(r)) out[w++] = r; out.length = w }
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
        for (const r of list) { yb[0] = Math.min(yb[0], r.y - r.s * 0.3); yb[1] = Math.max(yb[1], r.y + r.sy * 0.7) }
        this.cellBox.set(k, yb)
      }
      // (rocks hang over their cell's edge by up to half their size)
      this.box.min.set(x0 - 10, yb[0], z0 - 10)
      this.box.max.set(x0 + CELL + 10, yb[1], z0 + CELL + 10)
      if (!this.frustum.intersectsBox(this.box)) { this.culled.frustum++; continue }
      if (this.horizon?.hidden(x0 - 10, z0 - 10, x0 + CELL + 10, z0 + CELL + 10, yb[1])) { this.culled.occluded++; continue }
      for (const r of list) {
        const dx = r.x - cx, dz = r.z - cz, d2 = dx * dx + dz * dz
        if (d2 > R * R) continue
        if (r.sy * r.sy < minRatio * minRatio * d2) { this.culled.small++; continue }
        // (a rounded boulder past rockNear: its coarse shape — the fog softens it there)
        const mesh = r.v >= VARIANTS && d2 > near2 ? this.farMeshes[r.v - VARIANTS] : this.meshes[r.v]
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
    this.count = 0
    for (const m of [...this.meshes, ...this.cragMeshes, ...this.farMeshes]) { m.instanceMatrix.needsUpdate = true; this.count += m.count }
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
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vUp = position.y + 0.5; // 0 at the base … 1 on top
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
const vec3 STONE = vec3(0.2, 0.205, 0.23);
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
  vec3 albedo = STONE * mix(0.72, 1.0, smoothstep(0.0, 0.45, vUp)) * mix(0.86, 1.1, smoothstep(0.2, 0.9, N.y)); // (no per-face tone: smooth; a slab's top lighter than its side)
  float ao = mix(0.6, 1.0, smoothstep(0.0, 0.5, vUp));
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
  N = rockRelief(vWorld, N, 1.0, dFdx(vWorld), dFdy(vWorld), cav);
#endif
  float sun = sunVisibility(vWorld.xz);
  vec3 c = shade(albedo, N, V, 0.75, 0.04, ao * cav, sun, 0.05);
  c += rockFill(albedo, N) * ao;
  c += headlight(albedo, N, vWorld);
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
