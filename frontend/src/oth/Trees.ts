import { grovesOf } from './Groves'
import * as GFX from './gfx'
import type { Horizon } from './Horizon'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import type { Tier } from './quality'
import { gameParams } from '../settings'
import { cellSeed, type Rocks } from './Rocks'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'
import { createFrondTexture, createLeafTexture, FROND_GLSL, LEAF_GLSL } from './leafTexture'
import { PLANT_VALUE_GLSL } from './paint'
import { broadleafGeometry, palmGeometry, CROWN, spruceGeometry } from './treeGeometry'

/**
 * THE FORESTS — Over-the-Hill woods, four trees in five a green spruce (the stylized conifer); the rest in small groves:
 * golden larch, white-trunked birches and red-orange aspens (the broadleaf, treeGeometry.ts), a few bare snags; lone
 * trees on the meadows. Placed once at load, deterministic, from
 * the map's forest mask (a jittered ~6.5 m grid), never on a track, in water, on rock or a boulder.
 *
 * Drawn in 5 instanced draws: per shape family a near LOD (`tier.treeNear`; conifer ~2 000 vertices, broadleaf ~1 150) and
 * a mid LOD (to `treeMid`), and for every species together
 * beyond, IMPOSTORS to `treeReach`: at load each species is rendered (its near LOD) from 12 directions × 3 heights
 * into an image atlas — albedo × AO and the tree-space normal (two render targets at once) — and a far tree is one
 * camera-facing quad showing the baked view nearest its own, relit with the sun from the normal image: 2 triangles,
 * the full plume detail, the same light. Its alpha test is corrected by the mip level (no shrinking or shimmer far
 * away). Beyond `treeFar` only a share of the impostors is drawn (rank cull), each a little bigger. The lists are
 * rebuilt from 64 m tiles (frustum- and distance-culled) when the camera has moved a few metres or turned.
 *
 * SHADOWS: every tree stamps a soft shadow (offset away from the sun by its height) into the terrain shadow's tree
 * texture (2 m) — the ground, the grass, the water, the rocks and the car darken under the forest; a tree's lower
 * crown also takes the shade it stands in.
 */
const TILE = 64
/** Values per tree in `data`: x, y, z, height, rotation, species, seed, rank.
 *  Species: 0 spruce, 1 larch, 2 snag (the conifer shape) · 3 birch (gold), 4 aspen (red / orange), 5 green broadleaf
 *  (the broadleaf shape, white trunks) — OTH's mixed autumn woods. */
export const TREE_STRIDE = 8
/** The shape family of a species: 0 conifer, 1 broadleaf. */
const family = (sp: number) => (sp >= 3 ? 1 : 0)
/** The species with impostors, in atlas row order (a snag is a pixel there). */
const IMP_SPECIES = [0, 1, 3, 4, 5]

export class Trees {
  readonly group = new GFX.Group()
  /** Every tree (TREE_STRIDE floats each). */
  readonly data: Float32Array
  readonly count: number
  private readonly tiles = new Map<number, number[]>()
  private readonly tileMaxH = new Map<number, number>()
  private readonly lods: { geo: GFX.InstancedBufferGeometry; a0: GFX.InstancedBufferAttribute; a1: GFX.InstancedBufferAttribute; max: number; n: number }[] = []
  private readonly frustum = new GFX.Frustum()
  private readonly pv = new GFX.Matrix4()
  private readonly box = new GFX.Box3()
  private readonly lastPos = new GFX.Vector3(1e9, 0, 0)
  /** (update's scratch: per LOD slot the trees picked — distance, data offset, growth — and a sort order) */
  private readonly pick: number[][] = [[], [], [], [], []]
  private readonly ord: number[] = []
  private readonly lastDir = new GFX.Vector3()
  private readonly ranges: number[]
  drawn = [0, 0, 0, 0, 0]
  private readonly impMat: GFX.ShaderMaterial
  /** ?treemid=geo: the conifers' mid LOD mesh (A/B) — else their impostors start at the near ring. */
  private readonly midGeo = gameParams().get('treemid') === 'geo'
  /** THE SEE-THROUGH (seeThrough): what the camera follows (x, y, z) and its radius (m); 0: off. */
  private readonly see = { value: new GFX.Vector4() }
  /** (its cone from the camera, per frame — update: the unit direction to it + its distance L; the cone's slope, where the
   *  cut ends and where its fade starts along it) */
  private readonly seeD = { value: new GFX.Vector4() }
  private readonly seeK = { value: new GFX.Vector4() }
  private readonly noiseU: GFX.IUniform
  private readonly leafU: GFX.IUniform
  private readonly frondU: GFX.IUniform
  /** The leaf texture (the bushes are built of the same leaf cards). */
  get leafTexture(): GFX.Texture { return this.leafU.value }

  /** shade: hand the trees' shade to the terrain shadow now (not when built behind another world — World.adopt). */
  /** placed: the trees already placed (placeTrees, a row a step — World.build); else placed here. */
  constructor(private readonly map: MapData, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, rocks: Rocks, shade = true, placed?: Float32Array) {
    this.noiseU = atmos.uniforms.uNoise
    this.ranges = [tier.treeNear, tier.treeMid, tier.treeFar, tier.treeReach]
    if (!placed) { const out: number[] = []; for (const _ of placeTrees(map, rocks, out)); placed = new Float32Array(out) }
    this.data = placed
    this.count = this.data.length / TREE_STRIDE
    for (let i = 0; i < this.count; i++) {
      const o = i * TREE_STRIDE, k = this.key(Math.floor(this.data[o] / TILE), Math.floor(this.data[o + 2] / TILE))
      let l = this.tiles.get(k)
      if (!l) this.tiles.set(k, (l = []))
      l.push(i)
      this.tileMaxH.set(k, Math.max(this.tileMaxH.get(k) ?? 0, this.data[o + 1] + this.data[o + 3]))
    }
    // the forests' shade: stamped by the terrain shadow's worker at every sun position (off the main thread — at a low
    // sun every shadow is long: stamping 25 000 of them froze the game 100–180 ms each time, all evening and night)
    const sh = (this.shade = new Float32Array(this.count * 4))
    for (let i = 0; i < this.count; i++) { const o = i * TREE_STRIDE; sh.set([this.data[o], this.data[o + 2], this.data[o + 3], this.data[o + 5]], i * 4) }
    if (shade) shadow.setTrees(sh, CROWN)
    this.leafU = { value: createLeafTexture() }
    this.frondU = { value: createFrondTexture() }
    // THE LEAVES' DEPTH PRE-PASS (2026-11-06, docs/PERF.md — the near trees were 0.85 ms of the spawn's frame): a leaf
    // card's cut-out needs a discard, and a shader that may discard turns the early depth test off — every card in a
    // crown was shaded, the hidden ones too. Now a first pass writes only the depth, the cut-out and nothing else (one
    // texture read; MSAA: its alpha-to-coverage, so the edges keep their soft coverage per sample); then the shading
    // pass, depth test EQUAL, no discard: only the leaf the pre-pass kept, at each sample, is shaded — once. The two
    // passes run the same vertex shader (the same depth, bit for bit). ?treepre=0: the one pass, as before.
    const pre = gameParams().get('treepre') !== '0'
    const leafMat = (pass: 'one' | 'depth' | 'shade', extraDefs: Record<string, string> = {}, extraUni: Record<string, GFX.IUniform> = {}) => new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: new GFX.Vector4(map.far.n, map.far.step, map.far.origin, 0) }, uLeafTex: this.leafU, uFrondTex: this.frondU, uSee: this.see, uSeeD: this.seeD, uSeeK: this.seeK, ...extraUni },
      vertexColors: true,
      defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.msaa ? { A2C: '' } : {}), ...map.biomeDefines, ...(pass === 'depth' ? { TREE_DEPTH: '' } : pass === 'shade' ? { TREE_SHADE: '' } : {}), ...extraDefs },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: GFX.DoubleSide,
      // MSAA tiers: the leaf cards' gaps resolve to soft coverage (no hard, shimmering cut-out) — in the pass that cuts
      alphaToCoverage: tier.msaa && pass !== 'shade',
      colorWrite: pass !== 'depth',
      depthWrite: pass !== 'shade',
      depthEqual: pass === 'shade',
    })
    this.leafMat = (defs, uni) => leafMat('one', defs, uni)
    const mat = leafMat(pre ? 'shade' : 'one')
    const depthMat = pre ? leafMat('depth') : null
    this.impMat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: {
        ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: new GFX.Vector4(map.far.n, map.far.step, map.far.origin, 0) },
        uImpAlb: { value: null }, uImpNor: { value: null }, uImpSize: { value: new GFX.Vector2(IMP.cols * IMP.fw, IMP.rows * IMP.fh) },
      },
      defines: { ...map.biomeDefines, ...(tier.spec ? { OTH_SPEC: '' } : {}), IMP_NA: IMP.cols.toFixed(1), IMP_ROWS: IMP.rows.toFixed(1), IMP_FW: IMP.FW.toFixed(3), IMP_FH: IMP.FH.toFixed(3), IMP_CY: IMP.CY.toFixed(3), IMP_E1: ((IMP.elev[0] + IMP.elev[1]) / 2).toFixed(3), IMP_E2: ((IMP.elev[1] + IMP.elev[2]) / 2).toFixed(3) },
      vertexShader: IMP_VERT,
      fragmentShader: IMP_FRAG,
      // MSAA tiers: the alpha edge resolves to smooth coverage (no hard, shimmering cut-out); LOW keeps the test
      alphaToCoverage: tier.msaa,
    })
    // capacities: the most trees a LOD can hold in view (its ring's area × the densest forest), capped
    // draws: 0 conifer near, 1 conifer mid, 2 broadleaf near, 3 broadleaf mid, 4 impostors (every species)
    const dens = 1 / 30
    const ring = [[0, this.ranges[0]], [this.ranges[0], this.ranges[1]], [0, this.ranges[0]], [this.ranges[0], this.ranges[1]], [this.ranges[1], this.ranges[3]]]
    for (let l = 0; l < 5; l++) {
      const [r0, r1] = ring[l]
      const max = Math.min(l === 4 ? 60000 : 30000, Math.ceil(Math.PI * (r1 * r1 - r0 * r0) * dens * 0.6) + 64)
      // (the desert: its palms in the broadleaf family's place — their LODs, their impostors)
      const src = l === 4 ? impostorQuad() : l < 2 ? spruceGeometry(l) : map.desert ? palmGeometry(l - 2) : broadleafGeometry(l - 2)
      const geo = new GFX.InstancedBufferGeometry()
      for (const n of l < 4 ? ['position', 'normal', 'color', 'leaf'] : ['position']) geo.setAttribute(n, src.getAttribute(n))
      geo.setIndex(src.getIndex()) // (indexed: the near tree is 947 shared vertices)
      const a0 = new GFX.InstancedBufferAttribute(new Float32Array(max * 4), 4), a1 = new GFX.InstancedBufferAttribute(new Float32Array(max * 4), 4)
      a0.setUsage(GFX.DynamicDrawUsage); a1.setUsage(GFX.DynamicDrawUsage)
      geo.setAttribute('aT0', a0); geo.setAttribute('aT1', a1)
      geo.instanceCount = 0
      const mesh = new GFX.Mesh(geo, l < 4 ? mat : this.impMat)
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      if (l === 4) mesh.visible = false // (until the atlas is baked)
      this.group.add(mesh)
      this.lods.push({ geo, a0, a1, max, n: 0 })
    }
    // the pre-pass: the same instances, first of all the opaque things (children 5–8; the impostors stay child 4)
    if (depthMat) for (let l = 0; l < 4; l++) {
      const m = new GFX.Mesh(this.lods[l].geo, depthMat)
      m.frustumCulled = false
      m.matrixAutoUpdate = false
      m.renderOrder = -40
      this.group.add(m)
    }
  }

  private key(i: number, j: number): number { return (i + 512) * 1024 + (j + 512) }

  // ============================================================================================ felling (co-op)
  /** FELLED (docs/MULTIPLAYER.md §1 — Gather.ts): these trees aren't drawn and have no trunk (Physics skips them). */
  readonly gone = new Set<number>()
  private leafMat!: (defs: Record<string, string>, uni: Record<string, GFX.IUniform>) => GFX.ShaderMaterial
  private readonly fallers: { mesh: GFX.Mesh; geo: GFX.InstancedBufferGeometry; u: { value: GFX.Vector4 }; t: number; dx: number; dz: number; landed: boolean; onLand?: () => void }[] = []
  fell(i: number): void { if (!this.gone.has(i)) { this.gone.add(i); this.lastPos.set(1e9, 0, 0) } }
  restore(i: number): void { if (this.gone.delete(i)) this.lastPos.set(1e9, 0, 0) }
  /** THE GROUND EDITED (GroundEdits.ts) over (x0, z0) … (x1, z1): each tree there moved up / down by dy(x, z) — it
   *  stays standing in the ground, not floating over a dug pond or buried in a raised yard. Returns the ones moved. */
  reground(x0: number, z0: number, x1: number, z1: number, dy: (x: number, z: number) => number): number[] {
    const d = this.data, moved: number[] = []
    for (let j = Math.floor(z0 / TILE); j <= Math.floor(z1 / TILE); j++) for (let i = Math.floor(x0 / TILE); i <= Math.floor(x1 / TILE); i++) {
      for (const t of this.tiles.get(this.key(i, j)) ?? []) {
        const o = t * TREE_STRIDE, x = d[o], z = d[o + 2]
        if (x < x0 || x > x1 || z < z0 || z > z1) continue
        const v = dy(x, z)
        if (Math.abs(v) > 0.005) { d[o + 1] += v; moved.push(t) }
      }
    }
    if (moved.length) this.lastPos.set(1e9, 0, 0)
    return moved
  }
  /** Tree i: where it stands, how tall, its species. */
  treeAt(i: number): { x: number; y: number; z: number; h: number; species: number } {
    const o = i * TREE_STRIDE, d = this.data
    return { x: d[o], y: d[o + 1], z: d[o + 2], h: d[o + 3], species: d[o + 5] }
  }
  /** The nearest STANDING tree to (x, z) within r (its index; −1 none) — from the 64 m tiles, cheap enough per frame. */
  nearestIndex(x: number, z: number, r: number, minH = 2): number {
    let best = -1, bd = r * r
    const d = this.data
    for (let j = Math.floor((z - r) / TILE); j <= Math.floor((z + r) / TILE); j++) for (let i = Math.floor((x - r) / TILE); i <= Math.floor((x + r) / TILE); i++) {
      const list = this.tiles.get(this.key(i, j))
      if (!list) continue
      for (const t of list) {
        if (this.gone.has(t)) continue
        const o = t * TREE_STRIDE
        if (d[o + 3] < minH) continue
        const q = (d[o] - x) ** 2 + (d[o + 2] - z) ** 2
        if (q < bd) { bd = q; best = t }
      }
    }
    return best
  }
  /** Every STANDING tree within r of (x, z), at least minH tall: their indices (the bot's woods — Bot.ts). */
  standingNear(x: number, z: number, r: number, minH = 4): number[] {
    const out: number[] = [], d = this.data
    for (let j = Math.floor((z - r) / TILE); j <= Math.floor((z + r) / TILE); j++) for (let i = Math.floor((x - r) / TILE); i <= Math.floor((x + r) / TILE); i++) {
      const list = this.tiles.get(this.key(i, j))
      if (!list) continue
      for (const t of list) {
        if (this.gone.has(t)) continue
        const o = t * TREE_STRIDE
        if (d[o + 3] >= minH && (d[o] - x) ** 2 + (d[o + 2] - z) ** 2 < r * r) out.push(t)
      }
    }
    return out
  }
  /**
   * A TREE FALLS (2026-11-09): drawn on its own while it goes — its near LOD and the trees' own shader (TREE_FALL: the
   * whole tree turned about its foot, toward (dx, dz)), the way a cut trunk goes: slowly at first, then all at once
   * (the angle ∝ t^2.2 over 2.4 s), a bounce where the crown hits, a moment on the ground, then gone (shrunk into
   * its foot in 0.4 s) — `onLand` when it lands (the logs, the dust). Its standing self is hidden at once.
   */
  fall(i: number, dx: number, dz: number, onLand?: () => void): void {
    const o = i * TREE_STRIDE, d = this.data, sp = d[o + 5]
    this.fell(i)
    const L = Math.hypot(dx, dz) || 1
    const src = this.lods[family(sp) * 2].geo
    const geo = new GFX.InstancedBufferGeometry()
    for (const n of ['position', 'normal', 'color', 'leaf']) geo.setAttribute(n, src.getAttribute(n))
    geo.setIndex(src.getIndex())
    const a0 = new GFX.InstancedBufferAttribute(new Float32Array([d[o], d[o + 1], d[o + 2], d[o + 3]]), 4)
    const a1 = new GFX.InstancedBufferAttribute(new Float32Array([d[o + 4], sp, d[o + 6], 1]), 4)
    geo.setAttribute('aT0', a0); geo.setAttribute('aT1', a1)
    geo.instanceCount = 1
    const u = { value: new GFX.Vector4(dx / L, dz / L, 0, 1) }
    const mat = this.leafMat({ TREE_FALL: '' }, { uFall: u })
    const mesh = new GFX.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    this.group.add(mesh)
    this.fallers.push({ mesh, geo, u, t: 0, dx: dx / L, dz: dz / L, landed: false, onLand })
  }
  /** Once a frame: the falling trees. */
  updateFalls(dt: number): void {
    const T = 2.4, A = Math.PI / 2 - 0.06
    for (let k = this.fallers.length - 1; k >= 0; k--) {
      const f = this.fallers[k]
      f.t += dt
      const t = f.t
      let ang = A, scale = 1
      if (t < T) ang = A * Math.pow(t / T, 2.2)
      else if (t < T + 0.5) { const v = (t - T) / 0.5; ang = A - 0.09 * Math.sin(Math.PI * v) * (1 - v) }
      if (t >= T && !f.landed) { f.landed = true; f.onLand?.() }
      if (t > T + 1.6) scale = Math.max(0, 1 - (t - T - 1.6) / 0.4)
      f.u.value.z = ang; f.u.value.w = scale
      if (scale <= 0) {
        this.group.remove(f.mesh)
        f.geo.deleteAttribute('aT0'); f.geo.deleteAttribute('aT1')
        ;(f.mesh.material as GFX.ShaderMaterial).dispose()
        this.fallers.splice(k, 1)
      }
    }
  }


  /**
   * THE SEE-THROUGH (2026-11-06, the user: "from above the trees block our camera to see the car" — Over the Hill's
   * way): the leaves between the camera and the car cut away in a circle round the car — a CONE from the camera to it,
   * so on screen a disc ~1.6 × the car's own size wherever along the way a crown stands; only in front of the car
   * (the trees behind it and beside it stay), only the foliage (the trunks stay: a thin line, and the tree still
   * stands there), its rim dithered (MSAA: alpha-to-coverage; LOW: a screen-space dither). It is part of the leaves'
   * own cut-out — the depth pre-pass drops those pixels and the shading pass never sees them: nothing drawn twice, a
   * hidden car's leaves not shaded at all. r = 0: off (first person, the map, the free camera).
   */
  seeThrough(p: GFX.Vector3, r: number): void { this.see.value.set(p.x, p.y + 0.25 * r, p.z, this.seeOff ? 0 : r) }
  /** ?see=0: never (A/B). */
  private readonly seeOff = gameParams().get('see') === '0'

  /** The nearest tree of `species` (−1 any) to (x, z) within r — the shot harness frames trees with it. */
  nearest(x: number, z: number, r: number, species = -1, minH = 0): { x: number; y: number; z: number; h: number } | null {
    let best = -1, bd = r * r
    for (let i = 0; i < this.count; i++) {
      const o = i * TREE_STRIDE
      if (species >= 0 && this.data[o + 5] !== species) continue
      if (this.data[o + 3] < minH) continue
      const d = (this.data[o] - x) ** 2 + (this.data[o + 2] - z) ** 2
      if (d < bd) { bd = d; best = o }
    }
    return best < 0 ? null : { x: this.data[best], y: this.data[best + 1], z: this.data[best + 2], h: this.data[best + 3] }
  }

  /** No tree crown within `clear` m of the segment (ax, az) → (bx, bz) (the shot harness). */
  clearLine(ax: number, az: number, bx: number, bz: number, clear: number): boolean {
    const d = this.data, vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1
    for (let i = 0; i < this.count; i++) {
      const o = i * TREE_STRIDE, px = d[o] - ax, pz = d[o + 2] - az
      const t = Math.max(0, Math.min(1, (px * vx + pz * vz) / L2))
      if ((px - t * vx) ** 2 + (pz - t * vz) ** 2 < clear * clear) return false
    }
    return true
  }

  /** For the shot harness: the nearest tree of `species` ≥ minH tall to (x, z) that a camera `dist` × its height away
   *  (on the yaw side) sees in the open — no other tree's crown within 9 m of the camera or of the sight line. */
  clearShot(x: number, z: number, species: number, minH: number, dist: number, yaw: number): { x: number; y: number; z: number; h: number; cx: number; cz: number } | null {
    const d = this.data, c: number[] = []
    for (let i = 0; i < this.count; i++) {
      const o = i * TREE_STRIDE
      if ((species >= 0 && d[o + 5] !== species) || d[o + 3] < minH) continue
      c.push(o)
    }
    c.sort((a, b) => ((d[a] - x) ** 2 + (d[a + 2] - z) ** 2) - ((d[b] - x) ** 2 + (d[b + 2] - z) ** 2))
    for (const o of c.slice(0, 400)) {
      const D = d[o + 3] * dist, cx = d[o] + Math.sin(yaw) * D, cz = d[o + 2] + Math.cos(yaw) * D
      let blocked = false
      for (let i = 0; i < this.count && !blocked; i++) {
        const p = i * TREE_STRIDE
        if (p === o) continue
        const px = d[p] - cx, pz = d[p + 2] - cz
        if (px * px + pz * pz > (D + 20) ** 2) continue
        // distance from the segment camera → tree
        const ax = d[o] - cx, az = d[o + 2] - cz, L2 = ax * ax + az * az
        const t = Math.max(0, Math.min(1, (px * ax + pz * az) / L2))
        if ((px - t * ax) ** 2 + (pz - t * az) ** 2 < 9 * 9 && t < 0.92) blocked = true
      }
      if (!blocked) return { x: d[o], y: d[o + 1], z: d[o + 2], h: d[o + 3], cx, cz }
    }
    return null
  }

  /** Terrain occlusion (main.ts sets it): tiles behind the hills are skipped. */
  horizon: Horizon | null = null
  /** Tiles skipped as hidden at the last rebuild (the HUD). */
  occluded = 0

  update(camera: GFX.PerspectiveCamera): void {
    // the see-through's cone, every frame (before the lists' early out: the car moves when the camera doesn't)
    const se = this.see.value
    if (se.w > 0) {
      const dx = se.x - camera.position.x, dy = se.y - camera.position.y, dz = se.z - camera.position.z, L = Math.max(0.01, Math.hypot(dx, dy, dz))
      this.seeD.value.set(dx / L, dy / L, dz / L, L)
      this.seeK.value.set((1.6 * se.w) / L, L - 0.35 * se.w, L - 0.9 * se.w, 0)
    }
    const dir = camera.getWorldDirection(new GFX.Vector3())
    if (camera.position.distanceToSquared(this.lastPos) < 16 && dir.dot(this.lastDir) > 0.9985) return
    this.lastPos.copy(camera.position)
    this.lastDir.copy(dir)
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    const cx = camera.position.x, cz = camera.position.z, R = this.ranges
    const reach = R[3]
    const pick = this.pick
    for (const P of pick) P.length = 0
    this.occluded = 0
    const i0 = Math.floor((cx - reach) / TILE), i1 = Math.floor((cx + reach) / TILE), j0 = Math.floor((cz - reach) / TILE), j1 = Math.floor((cz + reach) / TILE)
    const d = this.data
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = this.key(i, j), list = this.tiles.get(k)
      if (!list) continue
      const x0 = i * TILE, z0 = j * TILE
      const nx = Math.max(x0 - cx, 0, cx - x0 - TILE), nz = Math.max(z0 - cz, 0, cz - z0 - TILE)
      if (nx * nx + nz * nz > reach * reach) continue
      this.box.min.set(x0 - 6, this.map.height(x0 + TILE / 2, z0 + TILE / 2) - 60, z0 - 6)
      this.box.max.set(x0 + TILE + 6, (this.tileMaxH.get(k) ?? 0) + 2, z0 + TILE + 6)
      if (!this.frustum.intersectsBox(this.box)) continue
      if (this.horizon?.hidden(x0 - 6, z0 - 6, x0 + TILE + 6, z0 + TILE + 6, this.box.max.y)) { this.occluded++; continue } // (behind a hill)
      for (const t of list) {
        if (this.gone.has(t)) continue
        const o = t * TREE_STRIDE
        const dx = d[o] - cx, dz = d[o + 2] - cz, dist = Math.sqrt(dx * dx + dz * dz)
        if (dist > reach) continue
        // (a spruce / larch past the near ring: its IMPOSTOR, not the mid LOD — 2026-11-06, the user: "the far image is far
        //  better than the LOD, a fuller tree" — the impostor is the near LOD's own picture; the mid LOD's one ring of
        //  fronds read thin. 2 triangles, not ~480. ?treemid=geo: the mid LOD as before. A snag keeps its mesh.)
        const sp = d[o + 5], lod = dist < R[0] ? 0 : dist < R[1] && (sp >= 2 || this.midGeo) ? 1 : 2
        let grow = 1
        const slot = lod === 2 ? 4 : family(d[o + 5]) * 2 + lod
        if (lod === 2) {
          if (d[o + 5] === 2) continue // (no snag impostors: a bare trunk is a pixel there)
          // beyond treeFar the forest thins with distance (rank cull) and the survivors grow a little to keep its cover
          if (dist > R[2]) {
            const share = Math.pow(R[2] / dist, 0.85)
            if (d[o + 7] > share) continue
            grow = Math.min(1.45, Math.pow(1 / share, 0.35))
          }
        }
        pick[slot].push(dist, o, grow)
      }
    }
    // NEAR → FAR (2026-11-03, every GPU): each LOD's trees written nearest first — a leaf card drawn first fills the
    // depth buffer, and the leaves of every tree behind it fail the early depth test unshaded (a leaf card's discard /
    // alpha-to-coverage keeps a tiled GPU from sorting that out itself; a desktop GPU never does). Over the budget the
    // farthest go, not whichever tile came last.
    const ord = this.ord
    for (let l = 0; l < 5; l++) {
      const L = this.lods[l], P = pick[l], n = P.length / 3
      ord.length = n
      for (let k = 0; k < n; k++) ord[k] = k * 3
      ord.sort((u, v) => P[u] - P[v])
      L.n = Math.min(n, L.max)
      const a = L.a0.array as Float32Array, b = L.a1.array as Float32Array
      for (let k = 0; k < L.n; k++) {
        const q = ord[k], o = P[q + 1], w = k * 4
        a[w] = d[o]; a[w + 1] = d[o + 1]; a[w + 2] = d[o + 2]; a[w + 3] = d[o + 3]
        b[w] = d[o + 4]; b[w + 1] = d[o + 5]; b[w + 2] = d[o + 6]; b[w + 3] = P[q + 2]
      }
      L.geo.instanceCount = L.n
      L.a0.addUpdateRange(0, L.n * 4); L.a1.addUpdateRange(0, L.n * 4)
      L.a0.needsUpdate = L.a1.needsUpdate = true
      this.drawn[l] = L.n
    }
  }

  /**
   * Bake the IMPOSTOR atlas (once, at load): each species' near LOD from IMP.cols azimuths × IMP.elev heights, one
   * frame each, into two images at once (multiple render targets): albedo × AO (sqrt-encoded: dark greens keep their
   * steps in 8 bits) and the tree-space normal. Orthographic frames IMP.FW × IMP.FH tree heights, centred IMP.CY up.
   */
  bakeImpostors(renderer: GFX.WebGLRenderer): void {
    const W = IMP.cols * IMP.fw, Hh = IMP.rows * IMP.fh
    const rt = new GFX.WebGLRenderTarget(W, Hh, { count: 2, type: GFX.UnsignedByteType, depthBuffer: true, generateMipmaps: true, minFilter: GFX.LinearMipmapLinearFilter, magFilter: GFX.LinearFilter })
    for (const t of rt.textures) { t.generateMipmaps = true; t.minFilter = GFX.LinearMipmapLinearFilter; t.magFilter = GFX.LinearFilter; t.colorSpace = GFX.NoColorSpace }
    const bake = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: { uSpecies: { value: 0 }, uNoise: this.noiseU, uLeafTex: this.leafU, uFrondTex: this.frondU }, vertexColors: true, defines: { ...this.map.biomeDefines }, vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: GFX.DoubleSide })
    const scene = new GFX.Scene(), geos = [spruceGeometry(0), this.map.desert ? palmGeometry(0) : broadleafGeometry(0)], mesh = new GFX.Mesh(geos[0], bake)
    scene.add(mesh)
    const cam = new GFX.OrthographicCamera(-IMP.FW / 2, IMP.FW / 2, IMP.FH / 2, -IMP.FH / 2, 0.01, 10)
    const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new GFX.Color()), prevAlpha = renderer.getClearAlpha()
    const prevAuto = renderer.autoClear, prevTM = renderer.toneMapping
    renderer.autoClear = true
    renderer.toneMapping = GFX.NoToneMapping
    const center = new GFX.Vector3(0, IMP.CY, 0)
    // (the background: transparent BLACK — the atlas is premultiplied by coverage (a drawn texel's alpha is 1), so its
    //  mips average only the tree and IMP_FRAG divides by the coverage: an edge is the tree's own colour, never the
    //  background's. 2026-11-02: a mid colour per species was meant here, but three premultiplies a clear colour by its
    //  alpha — it was always black, and with no division every far tree had a dark rim)
    // ONE CLEAR of the whole atlas, then the tiles drawn without clearing (they never overlap): WebGPU can't clear a
    // two-output target tile by tile (PlayCanvas clears a scissored rect with a one-output quad)
    renderer.setClearColor(0x000000, 0)
    rt.scissorTest = false
    rt.viewport.set(0, 0, W, Hh)
    renderer.setRenderTarget(rt)
    mesh.visible = false
    renderer.render(scene, cam)
    mesh.visible = true
    renderer.autoClear = false
    for (let ri = 0; ri < IMP_SPECIES.length; ri++) {
      const sp = IMP_SPECIES[ri]
      bake.uniforms.uSpecies.value = sp
      mesh.geometry = geos[family(sp)]
      for (let e = 0; e < IMP.elev.length; e++) {
        for (let a = 0; a < IMP.cols; a++) {
          const az = (a / IMP.cols) * Math.PI * 2, el = IMP.elev[e]
          cam.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(3).add(center)
          cam.up.set(0, 1, 0)
          cam.lookAt(center)
          cam.updateMatrixWorld()
          const row = ri * IMP.elev.length + e
          rt.viewport.set(a * IMP.fw, row * IMP.fh, IMP.fw, IMP.fh)
          rt.scissor.set(a * IMP.fw, row * IMP.fh, IMP.fw, IMP.fh)
          rt.scissorTest = true
          renderer.setRenderTarget(rt)
          renderer.render(scene, cam)
        }
      }
    }
    renderer.setRenderTarget(prevRT)
    renderer.setClearColor(prevClear, prevAlpha)
    renderer.autoClear = prevAuto
    renderer.toneMapping = prevTM
    for (const g of geos) g.dispose()
    bake.dispose()
    this.impMat.uniforms.uImpAlb.value = rt.textures[0]
    this.impMat.uniforms.uImpNor.value = rt.textures[1]
    this.group.children[4].visible = true
    this.atlas = rt
  }
  /** The impostor atlas (two textures: albedo, normal) — kept for the harness / a debug view. */
  atlas: GFX.WebGLRenderTarget | null = null
  /** Every tree's x, z, height, species — the terrain shadow's worker stamps their shade (World.adopt). */
  readonly shade: Float32Array
  /** Their shade to the terrain shadow again (it was another world's). */
  reshade(shadow: TerrainShadow): void { shadow.setTrees(this.shade, CROWN) }


}

/** The impostor atlas layout: `cols` azimuths × 3 elevations (rad) × 2 species (rows), frames fw × fh px framing
 *  FW × FH tree heights centred CY up (the crown with its plumes, from the side to 55° above). */
const IMP = { cols: 12, elev: [0.05, 0.45, 0.95], rows: 15, fw: 80, fh: 160, FW: 0.56, FH: 1.08, CY: 0.52 }

/** A unit quad (x −0.5…0.5, y 0…1): the impostor's billboard. */
function impostorQuad(): GFX.BufferGeometry {
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

/** The species' colours (spruce, larch, snag trunk), a little different per tree (j = −0.5…0.5). */
const SPECIES_GLSL = /* glsl */ `
${PLANT_VALUE_GLSL}
// a LEAF MASS's surface: small round leaves (the paint texture's cell channel, in the tree's own space: every tree of a
// species alike, its impostor too), each its own tone, dark gaps between them; p = object position, n = normal
vec3 leafMass(vec3 albedo, vec3 p, vec3 n) {
  // triplanar (no stretched stripes on the sides), 16 cells per 0.26 → a leaf ≈ 0.016 of the height
  vec3 w = pow(abs(n), vec3(4.0)); w /= w.x + w.y + w.z;
  vec3 q = p / 0.26;
  float f1 = texture(uNoise, q.zy).a * w.x + texture(uNoise, q.xz + 0.37).a * w.y + texture(uNoise, q.xy + 0.71).a * w.z;
  float tone = texture(uNoise, q.xz * 0.5 + q.y * 0.3).g;
  return albedo * mix(0.68, 1.08, smoothstep(0.6, 0.3, f1)) * (0.88 + 0.24 * tone);
}
// a conifer BRANCH PLATE (the frond texture: ft = tone, depth, coverage; s 0 its base … 1 its end): one smooth
// colour, dark by the trunk, lighter out to its spiky end, the end a touch yellower in the sun (a larch's paler gold)
// (tint 0…1 per plate: each its own shade — the references' layered plates catch the light differently)
vec3 frondTone(vec3 albedo, vec4 ft, float s, float tint, float species) {
  albedo *= (0.4 + 0.8 * ft.r) * (0.55 + 0.45 * ft.g) * (0.82 + 0.36 * tint);
  return albedo * mix(vec3(1.0), species < 0.5 ? vec3(1.15, 1.12, 0.92) : vec3(1.1, 1.06, 0.95), smoothstep(0.5, 1.0, s));
}
// a leaf CARD's tint (0…1 per card): a little lighter / darker, one card in eight of a birch still yellow-green
vec3 leafTone(vec3 albedo, float tint, float species) {
  if (species < 2.5) return albedo;
  albedo *= 0.9 + 0.18 * fract(tint * 7.13);
  return tint > 0.88 && species < 3.5 ? mix(albedo, vec3(0.42, 0.5, 0.08) * PLANT_VALUE, 0.6) : albedo;
}
// a broadleaf LEAF's light (lt: the leaf texture — each leaf's tone, its depth in the cluster; N: the crown's normal)
// (2026-11-06, the user: the broadleaf "doesn't match our valley" — every leaf its own random brightness, 0.34 … 1.15,
//  drowned the crown's light and shade: the leaves keep their own tones, the dots, but over a third of the range, and
//  the crown's underside darker — a lit top, a shaded underside, the spruce's volume)
vec3 leafLight(vec3 albedo, vec4 lt, vec3 N) {
  return albedo * (0.8 + 0.28 * lt.r) * (0.8 + 0.2 * lt.g) * mix(0.84, 1.04, smoothstep(-0.5, 0.8, N.y));
}
// a birch / aspen TRUNK (h01: up the tree; n: the bark's normal): grey and dark at its foot, white above, the birch's
// dark marks across it in short dashes (2026-11-06: one flat bright white glowed — a stick, not a trunk)
vec3 barkLight(vec3 albedo, float h01, vec3 n) {
  float row = floor(h01 * 46.0), side = floor((atan(n.z, n.x) + 3.1416) * 0.95);
  float k = fract(sin(row * 12.9898 + side * 78.233) * 43758.547), band = fract(h01 * 46.0);
  float mark = step(0.66, k) * smoothstep(0.05, 0.2, band) * smoothstep(0.6, 0.45, band);
  return albedo * mix(0.42, 1.0, smoothstep(0.0, 0.2, h01)) * (1.0 - 0.62 * mark);
}
// the darkest a tree gets inside (its AO's floor): a spruce's dense needles darkest; a larch's thin needles and a
// broadleaf's leaves let the light in
float aoFloor(float species) { return species > 2.5 ? 0.4 : species > 0.5 ? 0.36 : 0.22; }
vec3 treeAlbedo(float species, float fol, float j) {
#ifdef OTH_DESERT
  // (the desert's palms: a warm grey-brown trunk, deep green fronds lighter at their tips)
  // (2026-11-04, the stylised look: darker, deeper green fronds — they read bright yellow-green — a warmer trunk)
  if (fol < 0.5) return vec3(0.32, 0.2, 0.13);
  return mix(vec3(0.03, 0.1, 0.03), vec3(0.09, 0.2, 0.05), 0.5 + j * 0.6) * PLANT_VALUE * 1.25;
#endif
  if (fol < 0.5) {
    if (species > 2.5) return vec3(0.62, 0.61, 0.57);         // birch / aspen: white bark (a little grey: barkLight)
    return species > 1.5 ? vec3(0.36, 0.33, 0.29) : vec3(0.1, 0.055, 0.03); // (a snag's weathered silver-grey · the spruce's dark brown)
  }
  // (the spruce: the user's OTH reference — a clear deep green; a gold larch; ss2's aspens: gold, orange, red, a few
  //  still green)
  //  (× PLANT_VALUE, paint.ts: the leaves and needles a touch darker; the bark above keeps its own)
  // (2026-11-07, the user: "a darker green to the trees, not the grass" — the spruce ~28 % deeper, the same hue)
  if (species < 0.5) return mix(vec3(0.022, 0.062, 0.03), vec3(0.078, 0.215, 0.088), 0.5 + j * 0.35) * PLANT_VALUE;
  if (species < 1.5) return mix(vec3(0.6, 0.33, 0.04), vec3(0.95, 0.66, 0.12), 0.55 + j * 0.4) * PLANT_VALUE;
  // (2026-11-06, in the valley's colours: the aspen ORANGE to gold, a deep red-orange only at one end of its range —
  //  the near-pure red was the strongest colour in the valley; the birch a clean gold, not a mustard)
  if (species < 3.5) return mix(vec3(0.7, 0.42, 0.05), vec3(0.92, 0.67, 0.11), 0.5 + j * 0.8) * PLANT_VALUE;
  if (species < 4.5) return mix(vec3(0.62, 0.15, 0.03), vec3(0.9, 0.5, 0.08), 0.5 + j * 0.9) * PLANT_VALUE;
  return mix(vec3(0.06, 0.15, 0.03), vec3(0.15, 0.26, 0.045), 0.5 + j * 0.8) * PLANT_VALUE; // (the green broadleaf deeper too)
}
`

const VERT = /* glsl */ `
${ATMOS_GLSL}
${SPECIES_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
in vec4 aT0; // x, y, z, height
in vec4 aT1; // rotation, species, seed, grow
in vec3 leaf; // a broadleaf leaf's disc coordinates + its tint (0 0 0 elsewhere)
uniform vec4 uSee;
uniform vec4 uSeeD;
uniform vec4 uSeeK;
#ifdef TREE_FALL
uniform vec4 uFall; // the fall's direction (x, z), its angle, the tree's scale
#endif
out vec3 vLeaf;
out float vFol;
out vec3 vWorld;
out vec3 vN;
out vec3 vAlb;
out float vAo;
out float vSun;
out float vSpecies;
out float vH;

void main() {
  float H = aT0.w * aT1.w;
  float species = aT1.y;
  vec3 p = position;
  float fol = color.g;
  // a snag: the trunk alone, thick and BROKEN OFF under half the height (not a needle up to the sky), the foliage
  // collapsed away
  if (species > 1.5 && species < 2.5) { p = fol > 0.5 ? vec3(0.0) : vec3(p.x * 2.2, min(p.y, 0.42) * 0.9, p.z * 2.2); }
  // a broadleaf's own crown, from the tree's seed (one geometry, every tree a different outline): its base raised a
  // little (the top kept), its width ×0.8–1.2 — each way its own, an oval from above, not a ball — and its depth
  // ×0.88–1.12 about its middle; and the whole tree LEANS a little (up to ~4°, the foot kept) — 2026-11-06: the one
  // upright egg on a stick, every tree alike, read as a toy beside the spruce
#ifndef OTH_DESERT
  if (species > 2.5) {
    if (leaf.z > 0.5) {
      float lift = 0.05 * fract(aT1.z * 5.31), tall = 0.88 + 0.24 * fract(aT1.z * 9.13);
      p.y = 0.97 - (0.97 - p.y) * (0.66 - lift) / 0.66;
      p.y = 0.64 + (p.y - 0.64) * tall;
      p.xz *= vec2(0.8 + 0.4 * fract(aT1.z * 13.7), 0.8 + 0.4 * fract(aT1.z * 3.97));
    }
    float la = fract(aT1.z * 21.7) * 6.2832;
    p.xz += vec2(cos(la), sin(la)) * (0.07 * fract(aT1.z * 17.3)) * smoothstep(0.1, 1.0, p.y);
  }
#endif
  float c = cos(aT1.x), s = sin(aT1.x);
  vec3 q = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c) * H;
  vec3 n = normal;
  n = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  // wind: the crown sways, more toward the top
  float h01 = color.b;
  float sw = sin(uTime * 1.1 + aT1.z * 31.0) * 0.6 + sin(uTime * 2.3 + aT1.z * 17.0) * 0.25;
  q.xz += vec2(0.8, 0.35) * sw * 0.012 * H * h01 * h01;
#ifdef TREE_FALL
  {
    // turned about its foot, its top toward the fall (the axis: up × the direction)
    vec3 k = normalize(vec3(uFall.y, 0.0, -uFall.x));
    float ca = cos(uFall.z), sa = sin(uFall.z);
    q = (q * ca + cross(k, q) * sa + k * dot(k, q) * (1.0 - ca)) * uFall.w;
    n = n * ca + cross(k, n) * sa + k * dot(k, n) * (1.0 - ca);
  }
#endif
  vWorld = aT0.xyz + q;
  vN = n;
  vLeaf = leaf;
  vFol = fol;
  // THE SEE-THROUGH, per tree: a crown that reaches into the cone (Trees.seeThrough) marks its foliage 2 — only its
  // leaves run the cut, per pixel; every other tree's skip it
  if (fol > 0.5 && uSee.w > 0.0) {
    vec3 qc = aT0.xyz + vec3(0.0, 0.62 * H, 0.0) - uCamPos;
    float rho = 0.5 * H, tc = dot(qc, uSeeD.xyz), pc = sqrt(max(dot(qc, qc) - tc * tc, 0.0));
    if (tc > -rho && tc < uSeeK.y + rho && pc < uSeeK.x * max(tc + rho, 0.0) + rho) vFol = 2.0;
  }
  vAo = color.r;
  vH = h01;
  vSpecies = species;
  // the species' colour, a little different per tree
  vAlb = treeAlbedo(species, fol, fract(aT1.z * 7.31) - 0.5);
  // the light where it stands: terrain + tree shadow at the root for the lower crown, open sky toward the top
  float rootSun = sunVisibility(aT0.xz);
  // (a broadleaf's crown starts low — a third of the way up: the shade at the root only for its lowest leaves, or the
  //  whole lower half of every crown sat in its own shadow, a hard dark band under a bright top)
  vSun = mix(rootSun, sunVisibilityTerrain(aT0.xz), species > 2.5 ? smoothstep(0.2, 0.5, h01) : smoothstep(0.25, 0.85, h01));
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
${SPECIES_GLSL}
${LEAF_GLSL}
${FROND_GLSL}
in vec3 vLeaf;
in float vFol;
in vec3 vWorld;
in vec3 vN;
in vec3 vAlb;
in float vAo;
in float vSun;
in float vSpecies;
in float vH;
uniform vec4 uSeeD;
uniform vec4 uSeeK;

// THE SEE-THROUGH (Trees.seeThrough): 1 kept … 0 cut — p inside the cone from the camera to what it follows, in front of
// it (fading out over its last metre or so: the leaves beside the car stay)
float seeKeep(vec3 p) {
  vec3 q = p - uCamPos;
  float t = dot(q, uSeeD.xyz);
  if (t <= 0.0 || t > uSeeK.y) return 1.0;
  float R = uSeeK.x * t;
  float r = sqrt(max(dot(q, q) - t * t, 0.0) / (R * R));
  return clamp(max(r, smoothstep(uSeeK.z, uSeeK.y, t)) * 4.0 - 3.0, 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vN);
  // a frond's underside (a broadleaf's LEAF CARD has none: lit as the crown's volume, whichever way the card faces —
  // its back half darkened at random was most of the crown's speckle)
  bool card = vLeaf.z > 0.5;
  float under = gl_FrontFacing || card ? 1.0 : 0.62;
  if (!gl_FrontFacing && !card) N.y = -abs(N.y) * 0.4;
  vec3 V = normalize(uCamPos - vWorld);
  // tips light, the inside of the crown dark; the top of the tree a touch lighter
  vec3 albedo = vAlb * mix(aoFloor(vSpecies), 1.15, vAo) * under * (0.9 + 0.18 * vH);
  // broadleaf: each LEAF a round disc, its own tone, one in ten still yellow-green
  // a broadleaf LEAF CARD: tiny separate leaves, the gaps between them cut out (the sky shows through); a conifer
  // BRANCH FROND: needle-covered sprigs, the gaps between them cut out (feathery edges, fingered ends)
  // (the cut-out: by the depth pre-pass, or here when there's one pass; the shading pass after the pre-pass never
  //  discards — its EQUAL depth test already keeps only what the pre-pass kept)
  float alpha = 1.0;
  vec4 lt = vec4(1.0), ft = vec4(1.0);
  if (card) lt = leafCard(vLeaf.xy, vLeaf.z);
  if (vLeaf.z < -0.5) ft = frondCard(vLeaf.x, vLeaf.y, -vLeaf.z);
#ifndef TREE_SHADE
  float cut = card ? lt.a : vLeaf.z < -0.5 ? ft.a : 1.0;
  float keep = vFol > 1.5 ? seeKeep(vWorld) : 1.0; // (the see-through: the foliage of the trees in its cone)
#ifdef A2C
  alpha = clamp((cut - 0.35) / 0.3, 0.0, 1.0) * keep;
  if (alpha < 0.02) discard;
#else
  // (the rim dithered: interleaved gradient noise)
  if (cut < 0.5 || keep < fract(52.9829 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
#endif
#endif
#ifdef TREE_DEPTH
  // (the depth pre-pass: the cut-out alone — no early return before the shading below: WebGPU's first shader
  //  compiler rejected the unreachable code and fell back to the slow one)
  gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
#else
  if (card) albedo = leafLight(leafTone(albedo, fract(vLeaf.z) / 0.9, vSpecies), lt, N);
  if (vLeaf.z < -0.5) albedo = frondTone(albedo, ft, vLeaf.x, fract(-vLeaf.z) / 0.9, vSpecies);
#ifndef OTH_DESERT
  if (vFol < 0.5 && vSpecies > 2.5) albedo = barkLight(albedo, vH, N);
#endif
#ifdef TREE_SHADE
  alpha = 1.0;
#endif
  vec3 c = shade(albedo, N, V, 0.85, 0.03, mix(0.55, 1.0, vAo), vSun, 0.3);
  c += headlight(albedo, N, vWorld);
  // RAIN DROPLETS on the needles and leaves (2026-11-07, the user: "trees all get white — put some water droplets
  // instead"): small bright beads, sparse, on what faces up, near the camera only (far they'd shimmer)
  if (uWet > 0.02) {
    float dc = length(uCamPos - vWorld);
    if (dc < 32.0) {
      vec4 nz = texture(uNoise, vWorld.xz * 2.7 + vWorld.y * vec2(1.9, -1.3));
      float drop = smoothstep(0.83, 0.9, nz.r * 0.65 + nz.b * 0.35) * uWet * (1.0 - smoothstep(14.0, 32.0, dc)) * smoothstep(-0.2, 0.5, N.y);
      c += (uSunColor * 0.45 * vSun + uAmbSky * 1.1) * drop * 0.4;
    }
  }
  // back-lit by a low sun the needles glow (the larch most)
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  c += albedo * uSunColor * back * (vSpecies > 0.5 ? 0.55 : 0.25) * vAo * vSun;
  gl_FragColor = vec4(applyAtmos(c, vWorld), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`

// IMPOSTOR BAKE: the near LOD, unlit — albedo × AO (sqrt-encoded) and the tree-space normal, two targets at once.
const BAKE_VERT = /* glsl */ `
uniform sampler2D uNoise;
${SPECIES_GLSL}
uniform float uSpecies;
in vec3 leaf;
out vec3 vLeaf;
out float vFol;
out vec3 vP;
out vec3 vN;
out vec3 vAlb;
out float vAo;
out float vH;
void main() {
  vN = normal;
  vP = position;
  vLeaf = leaf;
  vFol = color.g;
  vAo = color.r;
  vH = color.b;
  vAlb = treeAlbedo(uSpecies, color.g, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BAKE_FRAG = /* glsl */ `
uniform sampler2D uNoise;
${SPECIES_GLSL}
${LEAF_GLSL}
${FROND_GLSL}
uniform float uSpecies;
layout(location = 0) out highp vec4 gAlbedo;
layout(location = 1) out highp vec4 gNormal;
in vec3 vLeaf;
in float vFol;
in vec3 vP;
in vec3 vN;
in vec3 vAlb;
in float vAo;
in float vH;
void main() {
  vec3 N = normalize(vN);
  // (as the tree's own shader: a leaf card has no underside)
  bool card = vLeaf.z > 0.5;
  float under = gl_FrontFacing || card ? 1.0 : 0.62;
  if (!gl_FrontFacing && !card) N.y = -abs(N.y) * 0.4;
#ifdef OTH_DESERT
  vec3 albedo = vAlb * mix(uSpecies > 0.5 ? 0.42 : 0.22, 1.15, vAo) * under * (0.9 + 0.18 * vH); // (the palms' bake, as it was)
#else
  vec3 albedo = vAlb * mix(aoFloor(uSpecies), 1.15, vAo) * under * (0.9 + 0.18 * vH);
#endif
  if (card) {
    vec4 lt = leafCard(vLeaf.xy, vLeaf.z);
    if (lt.a < 0.5) discard;
    albedo = leafLight(leafTone(albedo, fract(vLeaf.z) / 0.9, uSpecies), lt, N);
  }
#ifndef OTH_DESERT
  if (vFol < 0.5 && uSpecies > 2.5) albedo = barkLight(albedo, vH, N);
#endif
  if (vLeaf.z < -0.5) {
    vec4 ft = frondCard(vLeaf.x, vLeaf.y, -vLeaf.z);
    if (ft.a < 0.5) discard;
    albedo = frondTone(albedo, ft, vLeaf.x, fract(-vLeaf.z) / 0.9, uSpecies);
  }
  gAlbedo = vec4(sqrt(clamp(albedo, 0.0, 1.0)), 1.0);
  gNormal = vec4(normalize(N) * 0.5 + 0.5, vAo);
}
`

// IMPOSTOR: a camera-facing quad showing the baked view nearest this tree's own (its rotation and the camera's
// direction from it), relit with the sun from the baked normal.
const IMP_VERT = /* glsl */ `
${ATMOS_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
in vec4 aT0; // x, y, z, height
in vec4 aT1; // rotation, species, seed, grow
out vec2 vUv;
out vec2 vCell; // (0…1 across and up the tree's own view in the atlas)
out vec3 vWorld;
out float vSun;
out float vRot;
out float vSpecies;
out float vTint;
void main() {
  float H = aT0.w * aT1.w;
  vec3 center = aT0.xyz + vec3(0.0, IMP_CY * H, 0.0);
  vec3 toCam = normalize(uCamPos - center);
  float c = cos(aT1.x), s = sin(aT1.x);
  vec3 dl = vec3(toCam.x * c + toCam.z * s, toCam.y, -toCam.x * s + toCam.z * c); // into the tree's own frame
  float az = atan(dl.x, dl.z);
  if (az < 0.0) az += 6.2831853;
  float ia = mod(floor(az / 6.2831853 * IMP_NA + 0.5), IMP_NA);
  float el = asin(clamp(dl.y, -1.0, 1.0));
  float ie = el < IMP_E1 ? 0.0 : el < IMP_E2 ? 1.0 : 2.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 upv = cross(toCam, right);
  vec3 p = center + right * (position.x * IMP_FW * H) + upv * ((position.y - 0.5) * IMP_FH * H);
  float row = (aT1.y < 1.5 ? aT1.y : aT1.y - 1.0) * 3.0 + ie; // (IMP_SPECIES order: 0 1 3 4 5)
  vCell = vec2(position.x + 0.5, position.y);
  vUv = vec2((ia + position.x + 0.5) / IMP_NA, (row + position.y) / IMP_ROWS);
  vWorld = p;
  vRot = aT1.x;
  vSpecies = aT1.y;
  vTint = 0.92 + 0.16 * fract(aT1.z * 7.31);
  vSun = mix(sunVisibility(aT0.xz), sunVisibilityTerrain(aT0.xz), position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`
const IMP_FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
uniform sampler2D uImpAlb;
uniform sampler2D uImpNor;
uniform vec2 uImpSize;
in vec2 vUv;
in vec2 vCell;
in vec3 vWorld;
in float vSun;
in float vRot;
in float vSpecies;
in float vTint;
void main() {
  vec4 a = texture(uImpAlb, vUv);
  // alpha test, corrected by the mip level (mips average the alpha down: far trees would thin out and shimmer)
  vec2 px = vUv * uImpSize;
  float lod = max(0.0, 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px)))));
  float alpha = clamp((a.a * (1.0 + 0.45 * lod) - 0.35) / 0.3, 0.0, 1.0);
  // (the view above this one in the atlas starts with its trunk's foot: blurred down a mip, it showed as a dark dash
  //  over the tree's top — the top texels, as many as the mip blurs across, are left out; the tip stands lower)
  if (vCell.y > 1.0 - (exp2(lod) + 0.5) / (uImpSize.y / IMP_ROWS)) discard;
  if (alpha < 0.02) discard;
  // (premultiplied by coverage, both targets — see bakeImpostors: divided back, a mip's edge is the tree's own average)
  float cov = max(a.a, 0.004);
  vec4 nn = texture(uImpNor, vUv) / cov;
  nn.a = min(nn.a, 1.0);
  vec3 n = normalize(nn.rgb * 2.0 - 1.0);
  float c = cos(vRot), s = sin(vRot);
  vec3 N = normalize(vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c));
  vec3 V = normalize(uCamPos - vWorld);
  // (the edge texels mix in the background's meaningless normal: lean them to the crown's silhouette normal —
  //  toward the camera and up — so the outline never darkens)
  N = normalize(mix(normalize(V + vec3(0.0, 1.0, 0.0)), N, smoothstep(0.5, 0.95, a.a)));
  vec3 alb = min(a.rgb / cov, vec3(1.0));
  vec3 albedo = alb * alb * vTint;
  vec3 col = shade(albedo, N, V, 0.85, 0.03, mix(0.55, 1.0, nn.a), vSun, 0.3);
  col += headlight(albedo, N, vWorld);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += albedo * uSunColor * back * (vSpecies > 0.5 ? 0.55 : 0.25) * nn.a * vSun;
  gl_FragColor = vec4(applyAtmos(col, vWorld), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Deterministic placement from the forest mask, into `out` (TREE_STRIDE numbers a tree): a row of the grid at a
 *  time — it YIELDS after each, so a world built behind another one spreads the work over frames (World.build; ~80 ms
 *  in one go was the longest frame of a crossing's build). */
export function* placeTrees(map: MapData, rocks: Rocks, out: number[]): Generator<void, void, void> {
  if (map.desert) {
    // THE DESERT'S PALMS: the oasis (mask A, its growth) — groves along the water, a few strays; 9–17 m tall,
    // green (species 5: the broadleaf family, drawn as palms)
    let s2 = 0x2c1b3c6d
    const r2 = () => ((s2 = (Math.imul(s2 ^ (s2 >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const mk: [number, number, number, number] = [0, 0, 0, 0], G2 = 7.5, h2 = map.half - 50
    // (never in the lagoon: its ellipse with a margin — a palm or two stood in the water at its edge)
    const L = map.meta.water.lake, lc = Math.cos(L.rot), ls = Math.sin(L.rot)
    const inLagoon = (x: number, z: number) => ((((x - L.cx) * lc + (z - L.cz) * ls) / (L.rx * 1.12 + 3)) ** 2 + ((-(x - L.cx) * ls + (z - L.cz) * lc) / (L.rz * 1.12 + 3)) ** 2) < 1
    for (let z = -h2; z < h2; z += G2, yield) for (let x = -h2; x < h2; x += G2) {
      // (each cell its own seed: a mask change elsewhere moves no palm here — DESERT_MATCH round 6)
      s2 = cellSeed(Math.round(x * 2), Math.round(z * 2), 7)
      const px = x + (r2() - 0.5) * G2 * 1.2, pz = z + (r2() - 0.5) * G2 * 1.2
      map.maskAt(px, pz, mk)
      if (mk[3] < 0.08 || mk[2] > 0.86 || mk[0] > 0.3 || map.trailDist(px, pz) < map.meta.trails.hw + 2.5 || map.waterLevel(px, pz) !== null || inLagoon(px, pz)) continue
      // (2026-11-04: half as thick — single palms and small clumps along the water, not rows of a plantation)
      // (round 2 — the user's reference frames: palms in loose CLUMPS of a few with open sand between — a slow noise
      //  of its own, ~50 m cells, gathers them; a few strays)
      const cx = px / 52, cz = pz / 52, ix = Math.floor(cx), iz = Math.floor(cz), u = cx - ix, w = cz - iz
      const hh = (a: number, b: number) => cellSeed(a, b, 41) / 4294967296
      const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w)
      const vnz = (hh(ix, iz) * (1 - su) + hh(ix + 1, iz) * su) * (1 - sw) + (hh(ix, iz + 1) * (1 - su) + hh(ix + 1, iz + 1) * su) * sw
      const clump = 0.08 + 2.2 * Math.max(0, Math.min(1, (vnz - 0.52) / 0.2))
      if (r2() > (0.07 + 0.38 * Math.min(1, (mk[3] - 0.08) / 0.5)) * clump) continue
      if (rocks.biggestNear(px, pz, 3)) continue
      const y = map.height(px, pz), H = 9 + 8 * Math.pow(r2(), 0.8)
      out.push(px, y - 0.3, pz, H, r2() * Math.PI * 2, 5, r2(), r2())
    }
    return
  }
  const G = 6.5, half = map.half - 50
  const woods = gameParams().get('woods') !== '0'
  const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }
  let s = 0x7f4a7c15
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const mk: [number, number, number, number] = [0, 0, 0, 0]
  const hw = map.meta.trails.hw
  const fp = rocks.footprint.image.data as Uint8Array, g = map.inner
  const sp = map.meta.spawn
  // a slow noise: golden larch stands among the spruce
  const vn = (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi
    const h = (a: number, b: number) => (((Math.imul(a, 374761393) + Math.imul(b, 668265263)) ^ 0x5bd1e995) >>> 0) % 1000 / 1000
    const u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz)
    return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - w) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * w
  }
  // a per-spot hash 0..1 (no rnd() draw: picking a species must not move the trees after it)
  const hash01 = (x: number, z: number) => (((Math.imul(Math.floor(x * 8), 73856093) ^ Math.imul(Math.floor(z * 8), 19349663)) >>> 0) % 1000) / 1000
  // the HIDDEN PLACES' floors stay open (meta.hidden): a flower hollow's meadow clear to its banks, a falls basin's
  // view of its fall clear — no tree on the pool's shore or between the way in and the fall
  const hid = map.meta.hidden ?? []
  const hiddenClear = (x: number, z: number) => hid.some((h) => {
    const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz)
    if (d > h.r) return false
    if (h.kind === 'meadow') return d < h.r - 6
    const ox = Math.sin(h.open), oz = Math.cos(h.open), along = dx * ox + dz * oz, across = Math.abs(dx * oz - dz * ox)
    return across < 22 || along < -h.r * 0.45
  })
  for (let gz = -half; gz < half; gz += G, yield) {
    for (let gx = -half; gx < half; gx += G) {
      // (jittered past the cell's edges: no rows — a dense grove's cells all hold a tree, and an even grid shows)
      const x = gx + (rnd() * 1.7 - 0.35) * G, z = gz + (rnd() * 1.7 - 0.35) * G
      map.maskAt(x, z, mk)
      const forest = Math.min(1, Math.max(0, (mk[3] - 0.22) / 0.45))
      // (OTH woods are open: clumps and gaps, the ground showing between; lone trees on the meadows — fewer pines:
      //  the user, "no need of that many pine trees")
      const clump = vn(x / 45 + 17, z / 45 - 9)
      // (broadleaf GROVES are dense — OTH ss2: crowns side by side — conifer stands open)
      const groveN = vn(x / 260 + 5, z / 260 - 3)
      // TIGHTNESS (the user: "no need of that many trees — put them near him, at the sides, near the river; I need to
      // feel the tightness like OTH"): the big stands thinner, and clumps where the player IS — round the spawn,
      // lining the tracks (5–26 m off them), along the river banks (14–45 m)
      const td = map.trackDist(x, z), rd = map.riverDist(x, z), sd = Math.hypot(x - sp.x, z - sp.z)
      const clumpS = vn(x / 28 - 3, z / 28 + 21)
      const bands = (td > hw + 3 && td < 26 ? 0.33 * (1 - (td - 5) / 21) : 0) + (rd > 14 && rd < 45 ? 0.34 : 0)
        + (sd < 300 ? 0.52 * (1 - sd / 300) : 0)
      // (a little denser everywhere — the user: "feel a bit denser, but not a lot")
      // WOODS, NOT A SCATTER (2026-11-05, the user: "make it feel full, remove emptiness, without increasing cost"):
      // the trees gathered into STANDS — a stand's core crown to crown, a dark mass with an edge, the ground between
      // open; the even half-filled scatter read as empty — and COPSES of a few on the open meadows (~20 m, where the
      // small noise peaks). ~86 % more trees than the scatter (42.9k, was 23.1k): the farther ones are impostors, which
      // the mid LOD now hands over to sooner and the far rank cull thins sooner (quality.ts) — the same mean frame time,
      // measured (docs/ARCHITECTURE.md "Woods"). `?woods=0`: the old scatter and ranges (A/B).
      const stand = woods ? smooth(0.42, 0.58, clump) : 0
      const copse = woods ? (1 - forest) * smooth(0.62, 0.72, clumpS) * smooth(0.35, 0.6, clump) : 0
      const p = woods
        ? forest * (0.012 + 0.78 * stand) * (groveN > 0.55 ? 1.4 : 1) + bands * Math.max(0, clumpS * 1.6 - 0.42) * 0.85
          + 0.003 + 0.018 * Math.max(0, mk[3] - 0.08) + 0.45 * copse
        : forest * (0.058 + 0.25 * clump) * (groveN > 0.55 ? 2 : 1) + bands * Math.max(0, clumpS * 1.6 - 0.42)
          + 0.005 + 0.034 * Math.max(0, mk[3] - 0.08)
      const r = rnd()
      if (r > p) continue
      if (mk[2] > 0.75 || mk[0] > 0.45) continue // water / its banks, rock
      if (map.trailDist(x, z) < hw + 3) continue
      if ((x - sp.x) ** 2 + (z - sp.z) ** 2 < 16 * 16) continue
      if (hiddenClear(x, z)) continue
      const gi = Math.round((x - g.origin) / g.step), gj = Math.round((z - g.origin) / g.step)
      if (fp[gj * g.n + gi] > 40) continue // a boulder
      const y = map.height(x, z)
      const sl = Math.hypot(map.height(x + 3, z) - map.height(x - 3, z), map.height(x, z + 3) - map.height(x, z - 3)) / 6
      if (sl > 0.85) continue
      // conifer stands and broadleaf groves by a slow noise (about half each); in a grove birch / aspen / green
      // (by the river and round the spawn mostly broadleaf: birch and aspen line the water in OTH)
      // (and round the spawn a few PINE clumps among them — the user: "add some pines near")
      const pines = sd < 320 && vn(x / 55 + 31, z / 55 - 13) > 0.6
      const broad = !pines && groveN + (rnd() - 0.5) * 0.3 + (forest < 0.2 ? 0.25 : 0) + (rd < 45 ? 0.3 : 0) + (sd < 260 ? 0.15 : 0) > 0.55
      let species: number
      if (broad) {
        const k = vn(x / 120 - 7, z / 120 + 11) + (rnd() - 0.5) * 0.5
        species = k < 0.4 ? 3 : k < 0.86 ? 4 : 5 // (gold 40 %, red / orange 45 %, a few still green)
      } else {
        const larch = vn(x / 230, z / 230) + (rnd() - 0.5) * 0.45 > 0.6 ? 1 : 0
        species = rnd() < 0.05 ? 2 : pines && rnd() < 0.8 ? 0 : larch
      }
      // 80 % PINES (the user: "reduce other trees count and increase our pine tree — 80 % pine, 20 % other"): a green
      // spruce everywhere but in small groves (~60 m) of the rest, a fifth of the trees (0.7: measured on the placed
      // trees); there a tree keeps the species picked above (a spruce turns golden larch).
      // (the picks above still run: the same rnd() draws, so every tree stands where it did)
      const other = vn(x / 60 - 23, z / 60 + 41) + (hash01(x + 0.37, z + 0.11) - 0.5) * 0.3 > 0.7
      if (!other) species = 0
      else if (species === 0) species = 1
      // (a broadleaf 8–16.5 m — 2026-11-06: at 7–15 m beside the spruce, up to 36 m, the groves read as toys)
      let H = family(species) === 1 ? (8 + 8.5 * Math.pow(rnd(), 0.8)) * (0.85 + 0.15 * forest) : (6 + 15 * Math.pow(rnd(), 0.8)) * (0.75 + 0.25 * forest)
      // BIG PINES (a size, not a tree more — the vertices are the same): a stand's spruce a little taller toward its
      // core (no more: the cost is fill — a dense stand's near crowns), and one spruce in ~9 an old giant of 26–36 m — the
      // scale the hills are read by
      if (woods && species === 0) {
        H *= 1 + 0.12 * stand
        if (hash01(x + 0.71, z - 0.29) < 0.11) H = Math.max(H, 26 + 10 * hash01(x - 0.53, z + 0.17))
      }
      out.push(x, y - 0.3, z, H, rnd() * Math.PI * 2, species, rnd(), rnd())
    }
  }
  // THE GROVES (Groves.ts — 2026-11-07, the user: "some places with a group of trees, 5–10 together, and bushes, like a
  //  natural place"): after the rest, each on its own seed — no tree above moves
  for (const gv of grovesOf(map, rocks)) {
    for (const [x, z, h, species] of gv.trees) {
      const k = hash01(x + 0.13, z - 0.41)
      out.push(x, map.height(x, z) - 0.3, z, h, k * Math.PI * 2, species, hash01(x - 0.27, z + 0.61), hash01(x + 0.83, z + 0.07))
    }
  }
}
