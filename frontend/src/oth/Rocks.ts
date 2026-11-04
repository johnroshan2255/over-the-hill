import * as GFX from './gfx'
const { ConvexGeometry, mergeVertices, toCreasedNormals } = GFX
import type { Horizon } from './Horizon'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import type { Tier } from './quality'
import { ROCK_RELIEF_GLSL } from './rockRelief'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'

/**
 * ROCKS — Over-the-Hill boulders: chunky low-poly blocks (the convex hull of a few points on a squashed, boxy blob:
 * big flat faces, chamfered edges), light neutral grey, flat-shaded, a soft darkening toward the ground. Placed once
 * at load from the map (deterministic): OUTCROPS of 3–8 blocks on the steeper slopes and ridges, lone boulders in the
 * meadows, a few in and along the river. One instanced draw per shape variant; the instances written are those
 * within the tier's reach, in view, not behind a hill and not too small to see (`update`).
 */
const VARIANTS = 6
/** + the ROUNDED shapes (after the 6 blocks): the scenery's boulder walls (meta.scenery). */
const ROUND = 2
const CELL = 128

/** A seed of its own for a cell / an item at (a, b) (salt: which loop) — placement one change elsewhere can't move. */
export function cellSeed(a: number, b: number, salt: number): number {
  let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(salt, 83492791) ^ 0x2545f491) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export interface Inst { x: number; y: number; z: number; s: number; sy: number; rot: number; tilt: number; v: number }

export class Rocks {
  readonly group = new GFX.Group()
  private readonly meshes: GFX.InstancedMesh[] = []
  private readonly grid = new Map<number, Inst[]>()
  private readonly m = new GFX.Matrix4()
  private readonly q = new GFX.Quaternion()
  private readonly e = new GFX.Euler()
  private readonly reach: number
  private rubbleK = 1
  private readonly near: number
  /** The rounded shapes' far LOD (rockNear on): one mesh per ROUND variant. */
  private readonly farMeshes: GFX.InstancedMesh[] = []
  /** The desert's sculpted stones' far LOD (≈ 60 triangles, not 256): one mesh per block variant (stones.glb). */
  private readonly stoneFar: GFX.InstancedMesh[] = []
  count = 0
  /** Every rock (the physics builds colliders for the ones near the car) and each shape's vertices (unit size). */
  readonly all: Inst[]
  readonly shapes: Float32Array[] = []
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
        ;(out[+m[1]] ??= [])[+m[2]] = toCreasedNormals(g, Math.PI / 5)
      })
      return out.length >= VARIANTS && out.slice(0, VARIANTS).every((l) => l?.[0] && l[1]) ? out : null
    } catch {
      return null
    }
  }

  constructor(private readonly map: MapData, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4, stones: GFX.BufferGeometry[][] | null = null) {
    this.reach = tier.rockReach
    this.near = tier.rockNear
    const mat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid } },
      defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.rockRelief ? { OTH_ROCK_RELIEF: '' } : {}), ...map.biomeDefines },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    // (LOW — the phones: the desert's small rubble 40 % as thick; the big blocks, what fills a view, all kept)
    this.rubbleK = tier.name === 'low' ? 0.4 : 1
    const all = (this.all = this.place())
    for (let v = 0; v < VARIANTS + ROUND; v++) {
      const sculpted = v < VARIANTS ? stones?.[v] : undefined
      const geo = sculpted ? sculpted[0] : v < VARIANTS ? boulder(0x51ed + v * 977) : roundBoulder(0x7a3 + v * 131)
      // (the physics' hull: the sculpted stone's far shape — its hull is the near one's, near enough, from 32 points)
      this.shapes.push((sculpted ? sculpted[1] : geo).attributes.position.array as Float32Array)
      const n = all.filter((r) => r.v === v).length
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
    const g = map.inner, fp = new Uint8Array(g.n * g.n)
    for (const r of all) {
      const rad = r.s * 0.5, i0 = Math.max(0, Math.floor((r.x - rad - g.origin) / g.step)), i1 = Math.min(g.n - 1, Math.ceil((r.x + rad - g.origin) / g.step))
      const j0 = Math.max(0, Math.floor((r.z - rad - g.origin) / g.step)), j1 = Math.min(g.n - 1, Math.ceil((r.z + rad - g.origin) / g.step))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(g.origin + i * g.step - r.x, g.origin + j * g.step - r.z) / rad
        const v = Math.round(255 * Math.min(1, Math.max(0, (1.15 - d) / 0.3)))
        if (v > fp[j * g.n + i]) fp[j * g.n + i] = v
      }
    }
    this.footprint = new GFX.DataTexture(fp, g.n, g.n, GFX.RedFormat, GFX.UnsignedByteType)
    // (mipmapped: the grass reads it blurred too, shortening round a boulder — Grass.ts)
    this.footprint.minFilter = GFX.LinearMipmapLinearFilter
    this.footprint.magFilter = GFX.LinearFilter
    this.footprint.generateMipmaps = true
    this.footprint.unpackAlignment = 1
    this.footprint.needsUpdate = true
    for (const r of all) {
      const k = this.key(Math.floor(r.x / CELL), Math.floor(r.z / CELL))
      let list = this.grid.get(k)
      if (!list) this.grid.set(k, (list = []))
      list.push(r)
    }
  }

  private key(i: number, j: number): number { return (i + 512) * 1024 + (j + 512) }

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
      out.push({ x, y: y - sink * size * 0.3, z, s: size, sy: size * (1.0 + 0.6 * rnd()), rot: rnd() * Math.PI * 2, tilt: (rnd() - 0.5) * 0.2, v: Math.floor(rnd() * VARIANTS) })
    }
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
        const n = 4 + Math.floor(rnd() * 6), big = 5 + rnd() * 9
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, d = rnd() * big * 1.4
          const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d
          if (!dry(px, pz)) continue
          add(px, pz, big * (0.35 + 0.65 * rnd()) * (i === 0 ? 1.3 : 1), 0.25)
        }
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
      // (the desert, 2026-11-04 — "fuller": a drive between the rock gardens still opened wide — twice as many by the
      //  tracks, now and then a few together)
      if (rnd() > (map.desert ? 0.26 : 0.12)) continue
      const [x0, z0] = L[i], side = rnd() < 0.5 ? -1 : 1, j = Math.min(L.length - 1, i + 1)
      const dx = L[j][0] - x0, dz = L[j][1] - z0, l = Math.hypot(dx, dz) || 1, off = map.meta.trails.hw + 3 + rnd() * 9
      const x = x0 - (dz / l) * off * side, z = z0 + (dx / l) * off * side
      if (dry(x, z)) add(x, z, 0.9 + rnd() * 2.4, 0.3)
      if (map.desert && rnd() < 0.35) for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
        const px = x + (rnd() - 0.5) * 6, pz = z + (rnd() - 0.5) * 6
        if (dry(px, pz) && map.trackDist(px, pz) > map.meta.trails.hw + 2.5) add(px, pz, 0.4 + rnd() * 1.2, 0.3)
      }
    }
    // LONE BOULDERS in the open
    for (let gz = -half; gz < half; gz += 70) {
      for (let gx = -half; gx < half; gx += 70) {
        at(gx, gz, 4)
        if (rnd() > 0.22) continue
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
          const f = sm(0.65 * vn(x, z, 520, 11) + 0.35 * vn(x, z, 160, 12), 0.42, 0.72)
          const h0 = map.height(x, z)
          const rise = Math.max(map.height(x + 24, z), map.height(x - 24, z), map.height(x, z + 24), map.height(x, z - 24)) - h0
          const foot = sm(rise, 6, 18) * (1 - sm(slope(x, z), 0.25, 0.45))
          if (rnd() > (0.04 + 0.5 * f + 0.8 * foot) * this.rubbleK) continue
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
          if (rnd() > 0.25 + 0.55 * f) continue
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
    for (const [x, z, size] of map.meta.scenery?.boulders ?? []) {
      const r = size * 0.5
      const y = Math.min(map.height(x - r, z), map.height(x + r, z), map.height(x, z - r), map.height(x, z + r), map.height(x, z))
      out.push({ x, y: y - size * 0.1, z, s: size, sy: size * (0.85 + 0.3 * rnd()), rot: rnd() * Math.PI * 2, tilt: (rnd() - 0.5) * 0.25, v: VARIANTS + (rnd() < 0.5 ? 0 : 1) })
    }
    // the RIVER: stones in the shallows and on the banks
    const r = map.meta.water.river
    for (let i = 0; i < r.x.length; i += 2) {
      at(Math.round(r.x[i]), Math.round(r.z[i]), 5)
      if (rnd() > 0.35) continue
      const a = rnd() * Math.PI * 2, d = r.hw[i] * (0.6 + rnd() * 1.4)
      add(r.x[i] + Math.cos(a) * d, r.z[i] + Math.sin(a) * d, 0.6 + rnd() * 1.8, 0.35)
    }
    return out
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
    return out.compose(new GFX.Vector3(r.x, r.y, r.z), this.q, new GFX.Vector3(r.s, r.sy, r.s * 0.9))
  }

  /**
   * Re-picks the rocks to draw when the camera has moved 4 m or turned (they never move). CULLING, per 128 m cell:
   * DISTANCE (the tier's reach), FRUSTUM (the cell's box against the view), OCCLUSION (the cell hidden behind the
   * hills: Horizon); per rock: DISTANCE again, and SMALL-FEATURE culling (a rock under ~2 px tall at its distance).
   */
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
        const mesh = r.v >= VARIANTS ? (d2 > near2 ? this.farMeshes[r.v - VARIANTS] : this.meshes[r.v])
          : this.stoneFar[r.v] && r.sy * r.sy < lodRatio * lodRatio * d2 ? this.stoneFar[r.v] : this.meshes[r.v]
        this.q.setFromEuler(this.e.set(r.tilt, r.rot, r.tilt * 0.6))
        this.m.compose(this.p.set(r.x, r.y, r.z), this.q, this.sc.set(r.s, r.sy, r.s * 0.9))
        mesh.setMatrixAt(mesh.count++, this.m)
      }
    }
    this.count = 0
    for (const m of [...this.meshes, ...this.farMeshes, ...this.stoneFar.filter(Boolean)]) { m.instanceMatrix.needsUpdate = true; this.count += m.count }
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
  const g = toCreasedNormals(new ConvexGeometry(pts), Math.PI / 4.5)
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
#ifdef OTH_DESERT
const vec3 STONE = vec3(0.5, 0.165, 0.09); // (the sandstone: paint.ts's STONE — keep in step)
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
  vec3 albedo = STONE * mix(1.0, 0.94 + 0.12 * fhash(N), paintK) * mix(0.72, 1.0, smoothstep(0.0, 0.45, vUp)) * (1.0 + 0.06 * N.y);
  // HIGH / ULTRA on PCs: the crumpled 3D relief over every face (the light only: the colour above is the face's own)
  float cav = 1.0;
#ifdef OTH_ROCK_RELIEF
#ifndef OTH_DESERT
  N = rockRelief(vWorld, N, 1.0, dFdx(vWorld), dFdy(vWorld), cav);
#endif
#endif
  float sun = sunVisibility(vWorld.xz);
  vec3 c = shade(albedo, N, V, 0.75, 0.04, mix(0.6, 1.0, smoothstep(0.0, 0.5, vUp)) * cav, sun, 0.05);
  c += rockFill(albedo, N) * mix(0.6, 1.0, smoothstep(0.0, 0.5, vUp));
  c += headlight(albedo, N, vWorld);
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
