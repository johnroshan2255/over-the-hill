import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import { ROAD_REACH } from './mapPrep'
import { PAINT_GLSL } from './paint'
import { ROCK_RELIEF_GLSL } from './rockRelief'
import type { Tier } from './quality'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'
import { gameParams } from '../settings'
import { GroundCache } from './GroundCache'
import { createPaveTexture, PAVE_FRAME_GLSL } from './paveTex'

/** ?zones=0: the outland's boulder field, bog and flower meadows unpainted (the A/B). */
const ZONES_ON = () => new URLSearchParams(location.search).get('zones') !== '0'

/** The paving's texture (paveTex.ts): made once, shared by every world. */
let paveTex: GFX.DataTexture | null = null
const paveTexture = () => (paveTex ??= createPaveTexture())

/**
 * THE GROUND — continuous distance-dependent LOD (CDLOD) on the GPU, the whole 16 km world in ONE instanced draw.
 *
 * One patch mesh (G × G quads) is instanced once per selected quadtree node; the vertex shader places it, reads the
 * height from the R16UI grids (the box's 2 m one inside it, the world's 16 m one outside) and GEOMORPHS each vertex
 * by its distance: from 62 % to 100 % of its level's range the odd vertices slide onto the next coarser grid, so a
 * patch meets its coarser neighbour exactly and LOD changes never pop. Up to three levels are morphed per vertex,
 * which lets the selection stay the plain "split while the camera is within the finer level's range" rule.
 *
 * Selection (CPU, per frame, ~0.05 ms): the quadtree from a 16 km root down to `tier.terrainLeaf` patches; a node
 * splits while its nearest point is closer than R(level−1) = near · 2^(level−1); nodes outside the view frustum (boxes
 * from a min/max height pyramid) are skipped. Distance is horizontal + the camera's height above the ground, so
 * flying high coarsens it all.
 *
 * Fragment: the per-pixel normal from the RG8 normal grids (the far ranges keep their ridges with coarse vertices),
 * the box's mask (rock, dryness, wet, forest) or a procedural one outside, painted by PAINT_GLSL, lit by the shared
 * ATMOS_GLSL `shade` and hazed by `applyAtmos`.
 */
export class Terrain {
  readonly mesh: GFX.Mesh
  private readonly geo: GFX.InstancedBufferGeometry
  private readonly nodes: GFX.InstancedBufferAttribute
  private readonly maxNodes = 2048
  private readonly leaf: number
  private readonly levels: number
  private readonly origin: number
  private readonly near: number
  /** min / max height per node, per level (level 0 = leaf cells), row-major. */
  private readonly minH: Float32Array[] = []
  private readonly maxH: Float32Array[] = []
  private readonly frustum = new GFX.Frustum()
  private readonly box = new GFX.Box3()
  private readonly pv = new GFX.Matrix4()
  private count = 0
  private cx = 0
  private cz = 0
  private agl2 = 0
  /** This frame's picks before the near → far sort: x0, z0, size, level, distance (m). */
  private readonly picked = new Float32Array(2048 * 5)
  private readonly order: number[] = []
  /** What the hills hide (main.ts: the trees' and rocks' Horizon) — whole patches behind a ridge are skipped. */
  horizon: { hidden(x0: number, z0: number, x1: number, z1: number, top: number): boolean } | null = null
  /** Patches skipped behind the hills this frame (the HUD). */
  occluded = 0
  readonly uniforms: Record<string, GFX.IUniform>
  /** The ground's surface baked round the camera (GroundCache.ts; `tier.groundCache`, `?gcache=0` off). */
  readonly cache: GroundCache | null = null

  constructor(private readonly map: MapData, atmos: Atmosphere, tier: Tier, shadow: TerrainShadow, renderer: GFX.WebGLRenderer) {
    const G = tier.terrainGrid
    this.leaf = tier.terrainLeaf
    this.near = tier.terrainNear
    this.origin = -map.farHalf
    this.levels = Math.ceil(Math.log2((2 * map.farHalf) / this.leaf))
    this.buildPyramid()

    // the patch: (G+1)² vertices, quads split along alternating diagonals (no directional grain)
    const pos = new Float32Array((G + 1) * (G + 1) * 3)
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
      const k = (j * (G + 1) + i) * 3
      pos[k] = i; pos[k + 2] = j
    }
    const idx = new Uint16Array(G * G * 6)
    let n = 0
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1
      if ((i + j) & 1) { idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d }
      else { idx[n++] = a; idx[n++] = c; idx[n++] = d; idx[n++] = a; idx[n++] = d; idx[n++] = b }
    }
    this.geo = new GFX.InstancedBufferGeometry()
    this.geo.setAttribute('position', new GFX.BufferAttribute(pos, 3))
    this.geo.setIndex(new GFX.BufferAttribute(idx, 1))
    this.nodes = new GFX.InstancedBufferAttribute(new Float32Array(this.maxNodes * 4), 4)
    this.nodes.setUsage(GFX.DynamicDrawUsage)
    this.geo.setAttribute('aNode', this.nodes)
    this.geo.instanceCount = 0

    const g = (h: MapData['inner']) => new GFX.Vector4(h.n, h.step, h.origin, 0)
    const sc = (h: MapData['inner']) => new GFX.Vector2(h.g.min, h.g.range / 65535)
    const mg = map.meta.mask
    this.uniforms = {
      ...atmos.uniforms,
      ...shadow.uniforms,
      uHIn: { value: map.inner.tex },
      uHFar: { value: map.far.tex },
      uNIn: { value: map.inner.normalTex },
      uNFar: { value: map.far.normalTex },
      uMask: { value: map.maskTex },
      uInGrid: { value: g(map.inner) },
      uFarGrid: { value: g(map.far) },
      uInScale: { value: sc(map.inner) },
      uFarScale: { value: sc(map.far) },
      uMaskGrid: { value: new GFX.Vector4(mg.n, mg.step, mg.origin, 0) },
      uBoxHalf: { value: map.half },
      uGridN: { value: G },
      uNear: { value: this.near },
      uWorldOrigin: { value: this.origin },
      uAgl2: { value: 0 },
      uWater: { value: map.meta.water.lake.level },
      uTrail: { value: map.trailTex },
      uTrailHW: { value: map.meta.trails.hw },
      // (the outland's roads: the field, then its half side, 1 / its side, the roads' half width, the field's reach —
      //  and the early snow: x, z, its radius, the snow line there; radius 0: none)
      uRoad: { value: map.roadTex },
      uRoadG: { value: new GFX.Vector4(map.roadHalf, 1 / (2 * map.roadHalf), map.roadHW, ROAD_REACH) },
      uSnowAt: { value: new GFX.Vector4(map.meta.outland?.snow?.x ?? 0, map.meta.outland?.snow?.z ?? 0, gameParams().get('snow') === '0' ? 0 : map.meta.outland?.snow?.r ?? 0, map.meta.outland?.snow?.line ?? 900) },   // (?snow=0: no early snow — the A/B)
      // (the outland's lakes, up to six: x, z, reach, level — reach 0: none)
      ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => { const L = map.meta.outland?.lakes?.[k]; return [[`uLake${k}`, { value: L ? new GFX.Vector4(L.x, L.z, L.r, L.level) : new GFX.Vector4(0, 0, 0, 0) }], [`uLakeB${k}`, { value: L ? new GFX.Vector4(L.x1 ?? L.x, L.z1 ?? L.z, L.cut ? L.cut[0] / L.cut[2] : 0, L.cut ? L.cut[1] / L.cut[2] : 0) : new GFX.Vector4(0, 0, 0, 0) }]] })),
      // (the outland's bog — x, z, reach — and its flower meadows, up to three)
      // (?zones=0: no boulder field's bed, bog or flower meadows painted — the A/B)
      uStony: { value: (() => { const Z = ZONES_ON() ? map.meta.outland?.zones?.find((q) => q.kind === 'rocks') : undefined; return Z ? new GFX.Vector4(Z.x, Z.z, Z.r * 1.12, 0) : new GFX.Vector4(0, 0, 0, 0) })() },
      uBog: { value: (() => { const Z = ZONES_ON() ? map.meta.outland?.zones?.find((q) => q.kind === 'bog') : undefined; return Z ? new GFX.Vector4(Z.x, Z.z, Z.r, 0) : new GFX.Vector4(0, 0, 0, 0) })() },
      ...Object.fromEntries([0, 1, 2].map((k) => { const M = ZONES_ON() ? map.meta.outland?.meadows?.[k] : undefined; return [`uMeadow${k}`, { value: M ? new GFX.Vector4(M.x, M.z, M.r, 0) : new GFX.Vector4(0, 0, 0, 0) }] })),
      uGrassR: { value: tier.grassRadius },
      uBushR: { value: tier.bushReach },
      uPave: { value: paveTexture() },
      // (the four paved places nearest the camera: x, z, rot, the paving's reach — Terrain.update; r 0: none)
      uPave0: { value: new GFX.Vector4(0, 0, 0, 0) }, uPave1: { value: new GFX.Vector4(0, 0, 0, 0) },
      uPave2: { value: new GFX.Vector4(0, 0, 0, 0) }, uPave3: { value: new GFX.Vector4(0, 0, 0, 0) },
      // (the four still waters nearest the camera: x, z, reach, level — the wet bank, Terrain.update; reach 0: none)
      uShore0: { value: new GFX.Vector4(0, 0, 0, 0) }, uShore1: { value: new GFX.Vector4(0, 0, 0, 0) },
      uShore2: { value: new GFX.Vector4(0, 0, 0, 0) }, uShore3: { value: new GFX.Vector4(0, 0, 0, 0) },
    }
    const defines: Record<string, string> = { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.rockRelief ? { OTH_ROCK_RELIEF: '' } : {}), ...map.biomeDefines, ...shapeDefines(), ...rimDefines() }
    if (tier.groundCache > 0 && gameParams().get('gcache') !== '0') {
      this.cache = new GroundCache(renderer, tier.groundCache, 2 * map.farHalf, this.uniforms, defines, HEIGHT_GLSL, SURF_GLSL)
      Object.assign(this.uniforms, this.cache.uniforms)
    }
    // (the places' paving — PAVE_GLSL: the valley's only; the full look on PCs, the texture alone on phones)
    const pave: Record<string, string> = map.desert || gameParams().get('pave') === '0' ? {} : { OTH_PAVE: '', ...(tier.paveHi ? { OTH_PAVE_HI: '' } : {}) }
    const mat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: this.uniforms,
      defines: { ...defines, ...(this.cache?.defines ?? {}), ...tcut(), ...pave },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    this.mesh = new GFX.Mesh(this.geo, mat)
    this.mesh.frustumCulled = false // the selection culls per node
    this.mesh.matrixAutoUpdate = false
    // LAST of the opaque things (2026-10-27, 400 fps at 1080p): the grass, rocks, trees, bushes and the car draw first
    // and the depth test then skips the ground's paint under them — drawn first, every pixel under the carpet was
    // painted and then covered
    this.mesh.renderOrder = 10
    // (the patches round the cave's openings: the same ground, drawn with the cut — CaveWorld.intoTerrain; empty
    //  until then, and the rest of the ground never pays for a discard)
    this.uniforms.uHole = { value: new GFX.DataTexture(new Float32Array(1), 1, 1, GFX.RedFormat, GFX.FloatType) }
    this.uniforms.uHoleGrid = { value: new GFX.Vector4(0, 0, 0, 0) }
    for (let k = 0; k < 3; k++) this.uniforms[`uHoleC${k}`] = { value: new GFX.Vector4(0, 0, 0, 0) }
    this.holeGeo = new GFX.InstancedBufferGeometry()
    this.holeGeo.setAttribute('position', this.geo.getAttribute('position'))
    this.holeGeo.setIndex(this.geo.index)
    this.holeNodes = new GFX.InstancedBufferAttribute(new Float32Array(256 * 4), 4)
    this.holeNodes.setUsage(GFX.DynamicDrawUsage)
    this.holeGeo.setAttribute('aNode', this.holeNodes)
    this.holeGeo.instanceCount = 0
    // (the paving here too: the mud's map went into the trail texture to make room — WebGPU's 16 textures a stage, uHole)
    const hm = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: this.uniforms, defines: { ...defines, ...(this.cache?.defines ?? {}), ...tcut(), ...pave, OTH_HOLES: '' }, vertexShader: VERT, fragmentShader: FRAG })
    this.holeMesh = new GFX.Mesh(this.holeGeo, hm)
    this.holeMesh.frustumCulled = false
    this.holeMesh.matrixAutoUpdate = false
    this.holeMesh.renderOrder = 10
    this.holeMesh.visible = false
    this.mesh.add(this.holeMesh)
  }
  private readonly holeGeo: GFX.InstancedBufferGeometry
  private readonly holeNodes: GFX.InstancedBufferAttribute
  private readonly holeMesh: GFX.Mesh
  /** the cut's box (x0, z0, x1, z1) — a patch touching it is drawn by the hole mesh */
  private holeBox: [number, number, number, number] | null = null

  /** THE GROUND'S OWN MATERIAL for a mesh of world positions (CaveWorld: its hill's turf left by the openings, where
   *  the ground is cut) — the same fragment shader, uniforms and defines as the ground: the same paint and light, so
   *  it can't read as a patch of its own (2026-11-07, the user: "the terrain colour here is different — no patches"). */
  meshMaterial(): GFX.ShaderMaterial {
    return new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: this.uniforms, defines: { ...(this.mesh.material as GFX.ShaderMaterial).defines }, vertexShader: MESH_VERT, fragmentShader: FRAG })
  }

  /** THE GROUND AS A SKIN (2026-11-07, the user: "use the cave as just a skeleton and cover it with our terrain
   *  textures — the terrain the skin"): the ground's own shader on any mesh — its normal the mesh's (attributes normal,
   *  skin = (how far inside a cave 0…1, the least rock 0…1)), its rock from the mask and, inside, from its slope as the
   *  ground's steep is painted; painted live (the ground cache is baked from above: a wall under the hill would take its
   *  top's paint); the cave's dark and its openings' light on it (Atmosphere caveK / caveLit). */
  skinMaterial(): GFX.ShaderMaterial {
    const d = { ...(this.mesh.material as GFX.ShaderMaterial).defines, OTH_SKIN: '' } as Record<string, string>
    for (const k of Object.keys(this.cache?.defines ?? {})) delete d[k]
    return new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: this.uniforms, defines: d, vertexShader: SKIN_VERT, fragmentShader: FRAG.replace('in vec3 vWorld;\n', 'varying vec3 vWorld;\nvarying vec3 vSkinN;\nvarying vec2 vSkin;\n') })
  }

  /** THE CAVE'S HILL IN THE GROUND (CaveWorld.intoTerrain): its openings' clip heights — a 2 m cell each (R32F), from
   *  (x0, z0) — and the patches' max heights raised to its top where it stands (the selection's culling boxes). */
  setHoles(land: GFX.DataTexture, x0: number, z0: number, w: number, h: number, top: number, circles: [number, number, number][]): void {
    this.uniforms.uHole.value = land
    ;(this.uniforms.uHoleGrid.value as GFX.Vector4).set(x0, z0, w, h)
    circles.slice(0, 3).forEach(([cx, cz, r], k) => (this.uniforms[`uHoleC${k}`].value as GFX.Vector4).set(cx, cz, r, 1))
    const s = this.map.inner.step, x1 = x0 + w * s, z1 = z0 + h * s
    // (the patches the cut's draw takes: those touching a circle)
    // (the patches the cut's draw takes: all of the cave's — the skylights' holes are cut by holeK anywhere on it)
    this.holeBox = [x0, z0, x1, z1]
    this.holeMesh.visible = true
    for (let L = 0; L <= this.levels; L++) {
      const size = this.leaf * 2 ** L, c = 2 ** (this.levels - L), mx = this.maxH[L]
      const a0 = Math.floor((x0 - this.origin) / size), a1 = Math.floor((x1 - this.origin) / size)
      const b0 = Math.floor((z0 - this.origin) / size), b1 = Math.floor((z1 - this.origin) / size)
      for (let j = Math.max(0, b0); j <= Math.min(c - 1, b1); j++) for (let i = Math.max(0, a0); i <= Math.min(c - 1, a1); i++) mx[j * c + i] = Math.max(mx[j * c + i], top)
    }
  }

  /** THE CLAIMS' GROUND EDITS (GroundEdits.ts): the patches over (x0, z0) … (x1, z1) widened to hold heights lo … hi
   *  (their bounds only grow — a patch's box a little loose after a dig back, never too tight). */
  widen(x0: number, z0: number, x1: number, z1: number, lo: number, hi: number): void {
    for (let L = 0; L <= this.levels; L++) {
      const size = this.leaf * 2 ** L, c = 2 ** (this.levels - L), mn = this.minH[L], mx = this.maxH[L]
      const a0 = Math.floor((x0 - this.origin) / size), a1 = Math.floor((x1 - this.origin) / size)
      const b0 = Math.floor((z0 - this.origin) / size), b1 = Math.floor((z1 - this.origin) / size)
      for (let j = Math.max(0, b0); j <= Math.min(c - 1, b1); j++) for (let i = Math.max(0, a0); i <= Math.min(c - 1, a1); i++) {
        const k = j * c + i
        if (lo < mn[k]) mn[k] = lo
        if (hi > mx[k]) mx[k] = hi
      }
    }
  }

  /** Min / max heights per node, per level: the map's (computed with it in the loader's worker, mapPrep.ts). */
  private buildPyramid(): void {
    const P = this.map.pyramid
    if (P.leaf !== this.leaf || P.levels !== this.levels) throw new Error('Terrain: the map was prepared for another leaf size')
    this.minH.push(...P.minH)
    this.maxH.push(...P.maxH)
  }

  /** Pick this frame's patches. */
  update(camera: GFX.PerspectiveCamera): void {
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    this.cx = camera.position.x
    this.cz = camera.position.z
    const agl = Math.max(0, camera.position.y - this.map.height(this.cx, this.cz))
    this.agl2 = agl * agl
    this.uniforms.uAgl2.value = this.agl2
    // (the wet banks: the four still waters nearest the camera — by their shore's distance)
    // (both picked with nothing allocated — no arrays, no closures, no sorts each frame: garbage is a stall later,
    //  docs/PERF.md "the garbage"; the PERF MARKS drive, 2026-11-08)
    {
      const W = this.map.meta.water, n = 1 + (W.ponds?.length ?? 0), sh = this.shoreSlot
      sh.fill(-1); this.shoreD.fill(Infinity)
      for (let i = 0; i < n; i++) {
        const p = i === 0 ? W.lake : W.ponds![i - 1]
        const d = Math.max(0, Math.hypot(p.cx - this.cx, p.cz - this.cz) - (Math.max(p.rx, p.rz) * 1.15 + 12))
        nearest4(sh, this.shoreD, i, d)
      }
      for (let k = 0; k < 4; k++) {
        const v = this.uniforms[`uShore${k}`].value as GFX.Vector4, i = sh[k]
        const p = i < 0 ? null : i === 0 ? W.lake : W.ponds![i - 1]
        if (p) v.set(p.cx, p.cz, Math.max(p.rx, p.rz) * 1.15 + 12, p.level); else v.set(0, 0, 0, 0)
      }
    }
    // (the paving's frames: the four paved places nearest the camera — ~15 places, once a frame; past them, a few
    //  hundred metres off, a place's paving is a few pixels: the ground's own colour there)
    if (this.paved.length) {
      const sl = this.paveSlot, P = this.paved
      sl.fill(-1); this.paveD.fill(Infinity)
      for (let i = 0; i < P.length; i += 4) nearest4(sl, this.paveD, i, (P[i] - this.cx) ** 2 + (P[i + 1] - this.cz) ** 2)
      for (let k = 0; k < 4; k++) {
        const v = this.uniforms[`uPave${k}`].value as GFX.Vector4, i = sl[k]
        if (i < 0) v.set(0, 0, 0, 0); else v.set(P[i], P[i + 1], P[i + 2], P[i + 3])
      }
    }
    this.count = 0
    this.occluded = 0
    this.select(0, 0, this.levels)
    // NEAR → FAR (2026-10-27, the hidden valleys): the patches draw in one instanced call in the order written, so the
    // nearest ground fills the depth buffer first and everything it hides fails the early depth test — the ground
    // behind a ridge costs no shading (it was quadtree order: a far patch could be shaded, then painted over)
    const P = this.picked, ord = this.order
    ord.length = this.count
    for (let n = 0; n < this.count; n++) ord[n] = n
    // (an insertion sort — stable, as Array.sort is: the same order — on the ~60 patches, nothing allocated: the
    //  comparator closure and TimSort's scratch were garbage every frame — 2026-11-07, docs/PERF.md "the garbage")
    for (let n = 1; n < this.count; n++) {
      const u = ord[n], key = P[u * 5 + 4]
      let m = n - 1
      while (m >= 0 && P[ord[m] * 5 + 4] > key) { ord[m + 1] = ord[m]; m-- }
      ord[m + 1] = u
    }
    const a = this.nodes.array as Float32Array, ha = this.holeNodes.array as Float32Array, hb = this.holeBox
    let m = 0, hn = 0
    for (let n = 0; n < this.count; n++) {
      const o = ord[n] * 5, x0 = P[o], z0 = P[o + 1], sz = P[o + 2]
      // (round the cave's openings: the cut's draw)
      if (hb && hn < 256 && x0 < hb[2] && x0 + sz > hb[0] && z0 < hb[3] && z0 + sz > hb[1]) { ha[hn * 4] = x0; ha[hn * 4 + 1] = z0; ha[hn * 4 + 2] = sz; ha[hn * 4 + 3] = P[o + 3]; hn++; continue }
      a[m * 4] = x0; a[m * 4 + 1] = z0; a[m * 4 + 2] = sz; a[m * 4 + 3] = P[o + 3]; m++
    }
    this.geo.instanceCount = m
    this.nodes.addUpdateRange(0, m * 4)
    this.nodes.needsUpdate = true
    if (hb) {
      this.holeGeo.instanceCount = hn
      if (hn) { this.holeNodes.addUpdateRange(0, hn * 4); this.holeNodes.needsUpdate = true }
    }
    this.cache?.update(this.cx, this.cz)
  }

  /** (the world goes: the cache's atlas with it) */
  /** The paved places (x, z, rot, the paving's reach each — Landmarks.paved): each one's flagstones laid square to it. */
  setPaved(list: number[]): void { this.paved = list }
  private paved: number[] = []
  private readonly paveSlot = new Int32Array(4)
  private readonly paveD = new Float64Array(4)
  private readonly shoreSlot = new Int32Array(4)
  private readonly shoreD = new Float64Array(4)

  dispose(): void { this.cache?.dispose() }

  private select(i: number, j: number, level: number): void {
    const size = this.leaf * 2 ** level
    const x0 = this.origin + i * size, z0 = this.origin + j * size
    if (x0 >= -this.origin || z0 >= -this.origin) return // past the world's edge
    const c = 2 ** (this.levels - level), k = j * c + i
    this.box.min.set(x0, this.minH[level][k] - 1, z0)
    this.box.max.set(x0 + size, this.maxH[level][k] + 1, z0 + size)
    if (!this.frustum.intersectsBox(this.box)) return
    const dx = Math.max(x0 - this.cx, 0, this.cx - x0 - size), dz = Math.max(z0 - this.cz, 0, this.cz - z0 - size)
    const dh = Math.sqrt(dx * dx + dz * dz)
    // BEHIND THE HILLS: a node whose highest point stays under the horizon (Horizon.ts) is skipped with all it holds —
    // judged with its top raised 3 m + 1.5 % of its distance (the horizon is rebuilt every 4 m the camera moves: a
    // ridge's far side must never open as a hole between two rebuilds)
    if (this.horizon && dh > 60 && this.horizon.hidden(x0, z0, x0 + size, z0 + size, this.maxH[level][k] + 3 + dh * 0.015)) { this.occluded++; return }
    if (level > 0) {
      const d = Math.sqrt(dh * dh + this.agl2)
      if (d < this.near * 2 ** (level - 1)) {
        this.select(2 * i, 2 * j, level - 1); this.select(2 * i + 1, 2 * j, level - 1)
        this.select(2 * i, 2 * j + 1, level - 1); this.select(2 * i + 1, 2 * j + 1, level - 1)
        return
      }
    }
    if (this.count >= this.maxNodes) return
    const o = this.count++ * 5, P = this.picked
    P[o] = x0; P[o + 1] = z0; P[o + 2] = size; P[o + 3] = level; P[o + 4] = Math.sqrt(dh * dh + this.agl2)
  }

  get patches(): number { return this.count }
}

/** COST TESTS (docs/PERF.md, scripts/harness/abq.mjs): ?tcut=flat,relief,atmos — a part of the ground's fragment
 *  shader cut (TC_FLAT: a plain colour, hazed — the floor any paint can reach); nothing is cut without it. */
function tcut(): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of (gameParams().get('tcut') ?? '').split(',')) if (k) o[`TC_${k.toUpperCase()}`] = ''
  return o
}

/** Height lookup shared by the terrain and the grass vertex shaders (needs uHIn/uHFar, uInGrid/uFarGrid, scales). */
export const HEIGHT_GLSL = /* glsl */ `
uniform highp usampler2D uHIn;
uniform highp usampler2D uHFar;
uniform vec4 uInGrid;   // n, step, origin
uniform vec4 uFarGrid;
uniform vec2 uInScale;  // min, range / 65535
uniform vec2 uFarScale;
uniform float uBoxHalf;

float gridHeight(highp usampler2D t, vec4 g, vec2 sc, vec2 xz) {
  vec2 f = clamp((xz - g.z) / g.y, vec2(0.0), vec2(g.x - 1.001));
  vec2 i = floor(f);
  vec2 w = f - i;
  ivec2 p = ivec2(i);
  float a = float(texelFetch(t, p, 0).r);
  float b = float(texelFetch(t, p + ivec2(1, 0), 0).r);
  float c = float(texelFetch(t, p + ivec2(0, 1), 0).r);
  float d = float(texelFetch(t, p + ivec2(1, 1), 0).r);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * sc.y + sc.x;
}
bool inBox(vec2 xz) {
  float e = uBoxHalf - uInGrid.y;
  return abs(xz.x) < e && abs(xz.y) < e;
}
float terrainHeight(vec2 xz) {
  return inBox(xz) ? gridHeight(uHIn, uInGrid, uInScale, xz) : gridHeight(uHFar, uFarGrid, uFarScale, xz);
}
// THE GROUND'S SMALL SHAPES (2026-11-06, the user: "in the grass fields it all looks a plane, but there are bumps and
// dips and shallow hollows we can't tell"): how far xz lies above (+) or below (−) the ground round it (m) — rings at
// 6 m and 12 m; a plane, however steep, is 0 — only the bumps, dips, hollows and crests. Baked (GroundCache, the
// grass field), never per pixel: 9 height reads
float groundRelief(vec2 xz) {
  float a = terrainHeight(xz + vec2(6.0, 0.0)) + terrainHeight(xz - vec2(6.0, 0.0)) + terrainHeight(xz + vec2(0.0, 6.0)) + terrainHeight(xz - vec2(0.0, 6.0));
  float b = terrainHeight(xz + vec2(8.5, 8.5)) + terrainHeight(xz - vec2(8.5, 8.5)) + terrainHeight(xz + vec2(8.5, -8.5)) + terrainHeight(xz + vec2(-8.5, 8.5));
  return terrainHeight(xz) - (a + b) * 0.125;
}
`

/** THE SHAPES' LIGHT (2026-11-06 — the fields read flat: their light is wrapped and S-curved for the soft look, so a
 *  10° bump at noon moved its brightness ~1 %): OTH_SHAPE — on the ground and the grass, the hollows a little darker and
 *  the crests lighter (groundRelief, baked), and the SMALL slopes' light against the hill's broad one (the light the
 *  local normal gets minus what the hill's normal ~30 m across gets) — the hills keep their soft light, the bumps on
 *  them come back. `?shape=0` off; `?shapeao=` (per m of hollow), `?shapesun=` the strengths. */
/** ?rim=0: the box's rim handed over to the outland at a line, as before 2026-11-11 (the A/B — ROAD_GLSL boxRim). */
export function rimDefines(): Record<string, string> { return gameParams().get('rim') === '0' ? { OTH_NO_RIM: '' } : {} }
export function shapeDefines(): Record<string, string> {
  const q = gameParams()
  if (q.get('shape') === '0') return {}
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.get(k) !== null && Number.isFinite(v) ? v : d }
  return { OTH_SHAPE: '', SHAPE_AO: num('shapeao', 0.09).toFixed(3), SHAPE_SUN: num('shapesun', 1.1).toFixed(3) }
}
/** The same light in GLSL (needs ATMOS_GLSL): the hollow's darkening (rel = groundRelief, m) and the small slope's
 *  light (N the local normal, Nb the hill's), × the albedo. */
export const SHAPE_GLSL = /* glsl */ `
#ifdef OTH_SHAPE
float shapeLight(float rel, vec3 N, vec3 Nb, float sun) {
  float hollow = clamp(1.0 + SHAPE_AO * rel, 0.8, 1.08);
  float slope = clamp(1.0 + SHAPE_SUN * (dot(N, uSunDir) - dot(Nb, uSunDir)) * sun, 0.72, 1.22);
  return hollow * slope;
}
#endif
`

/** (skinMaterial: the mesh's normal and its skin values too — plain declarations, no #ifdef round them: WebGPU's
 *  varyings are given their locations before the defines are applied, 2026-11-07) */
const SKIN_VERT = /* glsl */ `
in vec2 skin;
out vec3 vWorld;
out vec3 vSkinN;
out vec2 vSkin;
void main() {
  vWorld = position;
  vSkinN = normal;
  vSkin = skin;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`

/** (meshMaterial: a mesh already in world positions) */
const MESH_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`

const VERT = /* glsl */ `
${ATMOS_GLSL}
${HEIGHT_GLSL}
uniform float uGridN;
uniform float uNear;
uniform float uWorldOrigin;
uniform float uAgl2;
in vec4 aNode; // x0, z0, size, level
out vec3 vWorld;

// one geomorph step: level L's vertices that its coarser parent lacks slide onto the parent's edge as dist nears L's rim
vec2 morphStep(vec2 xz, float dist, float L, float c) {
  float R = uNear * exp2(L);
  float m = clamp((dist - R * 0.62) / (R * 0.38), 0.0, 1.0);
  vec2 odd = step(vec2(0.25), fract((xz - uWorldOrigin) / (2.0 * c)));
  return xz - odd * c * m;
}

void main() {
  float cell = aNode.z / uGridN;
  vec2 xz = aNode.xy + position.xz * cell;
  vec2 d2 = xz - uCamPos.xz;
  float dist = sqrt(dot(d2, d2) + uAgl2);
  // geomorph through up to three coarser levels (written out, no loop — rockRelief.ts says why; a level whose blend
  // is 0 moves nothing, and every coarser one's is 0 too)
  xz = morphStep(xz, dist, aNode.w, cell);
  xz = morphStep(xz, dist, aNode.w + 1.0, cell * 2.0);
  xz = morphStep(xz, dist, aNode.w + 2.0, cell * 4.0);
  float h = terrainHeight(xz);
  vWorld = vec3(xz.x, h, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`

/**
 * THE GROUND'S SURFACE at a point — everything about it that doesn't depend on the light, the weather or where the
 * camera is: its colour (the paint, the cliffs' beds and streaks, mud), rock, roughness, the forest / bed shade, the
 * grass's shade under it and the sheen's share, the rock relief's strength, the track, the puddles' inputs, the shrub
 * dots' and wildflowers' amounts (their distance fades applied by the caller), the desert's ripples (a normal offset).
 * Run per pixel (the live path: the walls, the far ground, `?gcache=0`) and per texel by GroundCache's bake — ONE
 * code path, so the cached ground and the live ground are the same paint. The includer declares uInGrid, uFarGrid,
 * uBoxHalf (and, for the far ground, the noise: ATMOS_GLSL), then PAINT_GLSL, then this.
 */
/**
 * THE OUTLAND'S ROADS and its EARLY SNOW (2026-11-11 — scripts/oth/wilds.py), for the ground and for the grass's bake.
 * roadCentre: metres to the nearest outland road's centre line (its field holds the signed distance to the road's
 * EDGE, uRoadG: the field's half side, 1 / its side, the roads' half width, the field's reach) — 99 where there is none.
 * earlySnow: 0 … 1 — within uSnowAt's radius the snow line comes down from the far ranges' 900 m to uSnowAt.w: above
 * it a DUSTING first (in patches, by the paint's noises: the hollows hold it, the grass shows through between), solid
 * 110–230 m higher; on a steep face only in streaks, none where it's too steep to hold any. Needs the paint's noises (big.r, mid.g, fine.g, mid.b).
 */
export const ROAD_GLSL = /* glsl */ `
uniform vec4 uRoadG;
uniform vec4 uSnowAt;
// THE BOX'S RIM (2026-11-11, the user: "the lines … and sudden colour changes" — a hard line across the field and the
// road where the 4 km box ends: inside it the ground's mask is mask.bin's, beyond it the outland's own, each its own
// gold; the 2 m normals beside the 8 m): 0 inside the box … 1 at its edge and beyond — the box's mask hands over to the
// outland's across its last ~220 m, the hand-over's line pushed in and out by jit (m, ±70 at most: the edge itself is
// always 1); boxRimN: the normals' — narrower, the same for every reader (no noise to hand)
#ifdef OTH_NO_RIM
float boxRim(vec2 xz, float jit) { return 0.0; }
float boxRimN(vec2 xz) { return 0.0; }
#else
float boxRim(vec2 xz, float jit) { return smoothstep(uBoxHalf - 300.0, uBoxHalf - 80.0, max(abs(xz.x), abs(xz.y)) + jit); }
float boxRimN(vec2 xz) { return smoothstep(uBoxHalf - 100.0, uBoxHalf - 6.0, max(abs(xz.x), abs(xz.y))); }
#endif
// THE OUTLAND'S MASK (rock, dryness, wet, forest — what mask.bin holds inside the box), from the slope, the height and
// the paint's two broad noises: the ground paints with it — and the grass's bake asks the SAME (2026-11-11, the user:
// "it does not grow grass based on terrain colour": the bake had taken a mask of zeros out there — lush green blades
// over golden ground, grass on the grey rock)
vec4 outlandMask(float steep, float h, vec4 big, vec4 mid) {
  float rock = smoothstep(0.1, 0.24, steep + (big.b - 0.5) * 0.12) + smoothstep(700.0, 1100.0, h) * smoothstep(0.04, 0.14, steep);
  float forest = smoothstep(0.52, 0.62, big.r + mid.g * 0.25) * (1.0 - smoothstep(560.0, 820.0, h + (mid.r - 0.5) * 160.0));
  return vec4(clamp(rock, 0.0, 1.0), 0.6 + (big.g - 0.5) * 0.6, 0.0, forest);
}
// THE OUTLAND'S LAKES (meta.outland.lakes — x, z, reach, level each; six uniforms: the gfx layer has no uniform arrays):
// the water's depth over ground at height h (metres; negative: that far above it, −9 away from every lake)
uniform vec4 uLake0; uniform vec4 uLake1; uniform vec4 uLake2; uniform vec4 uLake3; uniform vec4 uLake4; uniform vec4 uLake5; uniform vec4 uLake6; uniform vec4 uLake7;
// (each lake's other end — uLakeB.xy: a long lake lies within its reach of the LINE between the two, the canyon's; a
//  round one's is its own middle)
uniform vec4 uLakeB0; uniform vec4 uLakeB1; uniform vec4 uLakeB2; uniform vec4 uLakeB3; uniform vec4 uLakeB4; uniform vec4 uLakeB5; uniform vec4 uLakeB6; uniform vec4 uLakeB7;
float lakeOne(vec4 L, vec4 B, vec2 xz, float h) {
  if (L.z <= 0.0) return -9.0;
  vec2 pa = xz - L.xy, ba = B.xy - L.xy;
  vec2 d = pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  // (past its cut — MapData.cutLakes, uLakeB.zw = its line's normal / its distance: the low ground over the rim — none)
  if (dot(pa, B.zw) > 1.0) return -9.0;
  return dot(d, d) < L.z * L.z ? L.w - h : -9.0;
}
float lakeDepth(vec2 xz, float h) {
  return max(max(max(lakeOne(uLake0, uLakeB0, xz, h), lakeOne(uLake1, uLakeB1, xz, h)), max(lakeOne(uLake2, uLakeB2, xz, h), lakeOne(uLake3, uLakeB3, xz, h))),
             max(max(lakeOne(uLake4, uLakeB4, xz, h), lakeOne(uLake5, uLakeB5, xz, h)), max(lakeOne(uLake6, uLakeB6, xz, h), lakeOne(uLake7, uLakeB7, xz, h))));
}
// THE OUTLAND'S BOG and its FLOWER MEADOWS (meta.outland.zones / meadows — what mud.bin's two channels hold inside the
// box): the mud thick at the bog's middle, broken by the paint's noise; the flowers in patches inside each meadow
uniform vec4 uBog; uniform vec4 uStony; uniform vec4 uMeadow0; uniform vec4 uMeadow1; uniform vec4 uMeadow2;
float bogMud(vec2 xz, float n) { if (uBog.z <= 0.0) return 0.0; float d = distance(xz, uBog.xy) / uBog.z; return d < 1.0 ? clamp((1.0 - d * d) * (0.45 + 1.1 * n), 0.0, 1.0) : 0.0; }
// (the BOULDER FIELD's bed — the zone 'rocks': bare grey stone under its boulders, whole at its middle, broken into
//  islands of grass toward its rim)
float stonyAt(vec2 xz, float n) { if (uStony.z <= 0.0) return 0.0; float d = distance(xz, uStony.xy) / uStony.z; return d < 1.0 ? smoothstep(0.44, 0.6, n * 0.62 + 0.78 * (1.0 - d * d)) : 0.0; }
float meadowOne(vec4 M, vec2 xz) { return M.z > 0.0 ? 1.0 - smoothstep(0.6, 1.0, distance(xz, M.xy) / M.z) : 0.0; }
float meadowAt(vec2 xz, float n) { return max(max(meadowOne(uMeadow0, xz), meadowOne(uMeadow1, xz)), meadowOne(uMeadow2, xz)) * smoothstep(0.32, 0.62, n); }
#ifndef OTH_NO_ROAD
#ifndef ROAD_TEX
#define ROAD_TEX(uv) texture(uRoad, uv)
#endif
uniform sampler2D uRoad;
float roadCentre(vec2 xz) {
  if (max(abs(xz.x), abs(xz.y)) >= uRoadG.x) return 99.0;
  float sd = ROAD_TEX(xz * uRoadG.y + 0.5).r * 2.0 * uRoadG.w - uRoadG.w;
  return sd > uRoadG.w - 0.2 ? 99.0 : sd + uRoadG.z;
}
#else
// (a draw already at WebGPU's 16 textures a stage — the cave's skin, the patches round its openings: no road is read)
float roadCentre(vec2 xz) { return 99.0; }
#endif
// (how much snow has FALLEN here, 0 … 1 — before the slope sheds any: the grass's bake asks this: no blade in the snow's
//  country, on a face too steep to stay white either)
float snowFall(vec2 xz, float h, float nBig, float nMid, float nFine, float nMid2, out float line) {
  line = 900.0;
  if (uSnowAt.z <= 0.0) return 0.0;
  float k = 1.0 - smoothstep(0.45 * uSnowAt.z, uSnowAt.z, distance(xz, uSnowAt.xy));
  if (k <= 0.0) return 0.0;
  line = mix(900.0, uSnowAt.w, k) + (nBig - 0.5) * 150.0 + (nMid - 0.5) * 60.0;
  if (h < line) return 0.0;
  float full = smoothstep(line + 110.0, line + 230.0, h);
  float dust = smoothstep(line, line + 110.0, h) * smoothstep(0.4, 0.58, nFine * 0.55 + nMid2 * 0.45 + 0.28 * smoothstep(line, line + 200.0, h));
  return max(full, dust * 0.88);
}
float earlySnow(vec2 xz, float h, float steep, float nBig, float nMid, float nFine, float nMid2) {
  float line;
  float fall = snowFall(xz, h, nBig, nMid, nFine, nMid2, line);
  if (fall <= 0.0) return 0.0;
  // (it lies whole to ~45°; steeper, in the gullies and on the ledges only — streaks down a face — and none past ~65° but near the summits)
  float hold = 1.0 - smoothstep(0.3, 0.62, steep + (nMid2 - 0.5) * 0.34 + (nFine - 0.5) * 0.1);
  // (… but high on the massif the wind plasters it on anything: the summits stand white)
  hold = max(hold, smoothstep(line + 200.0, line + 420.0, h) * (0.8 + 0.2 * nMid2));
  return fall * hold;
}
`

export const SURF_GLSL = /* glsl */ `
#ifdef OTH_SKIN
// (the skin's — Terrain.skinMaterial: set by the fragment shader before surfaceAt: the least rock, how far inside)
float gSkinRock = 0.0;
float gSkinIn = 0.0;
#endif
uniform sampler2D uNIn;
uniform sampler2D uNFar;
uniform sampler2D uMask;
uniform sampler2D uTrail;
uniform vec4 uMaskGrid;
uniform float uTrailHW;
#if defined(OTH_SKIN) || defined(OTH_HOLES)
#define OTH_NO_ROAD
#endif
${ROAD_GLSL}
// where the grass stands (the grass shader's rule: not on rock, not in water, thinner in the forest)
float grassy0(vec4 m, float rk, float fo) { return (1.0 - smoothstep(0.02, 0.1, rk)) * (1.0 - smoothstep(0.9, 0.97, m.b)) * (1.0 - 0.55 * fo); }
vec2 gridUv(vec4 g, vec2 xz) { return ((xz - g.z) / g.y + 0.5) / g.x; }
// a smooth 1D value noise (0..1): the cliffs' beds by height, of uneven thickness
float strataH(float i) { return fract(sin(i * 12.9898 + 4.1) * 43758.5453); }
float strataN(float x) { float i = floor(x), f = x - i; return mix(strataH(i), strataH(i + 1.0), f * f * (3.0 - 2.0 * f)); }
vec3 unpackN(vec2 e) { vec2 n = e * 2.0 - 1.0; return vec3(n.x, sqrt(max(1.0 - dot(n, n), 0.0)), n.y); }
bool inTheBox(vec2 xz) { float e = uBoxHalf - uInGrid.y; return abs(xz.x) < e && abs(xz.y) < e; }
// the smooth normal: the box's 2 m grid a few mips up (rolling shapes), the world's 16 m one outside
// (… handed over to the world's across the box's last ~100 m — boxRimN: a seam of light at its edge otherwise)
vec3 groundNormal(vec2 xz, bool box) {
  if (!box) return unpackN(texture(uNFar, gridUv(uFarGrid, xz), 0.0).rg);
  vec3 n = unpackN(texture(uNIn, gridUv(uInGrid, xz), 0.8).rg);
  float k = boxRimN(xz);
  return k > 0.0 ? normalize(mix(n, unpackN(texture(uNFar, gridUv(uFarGrid, xz), 0.0).rg), k)) : n;
}

// (shape: the ground's small relief, groundRelief — from the cache; 0 painted live: the walls)
struct Surf { vec3 col; float rock; float rough; float aoB; float grassy; float under; float relief; float trail; float bog; float pudN; float dots; float flower; vec2 rip; float shape; };

// xz, h: the point; Ns: its smooth normal; nfY: the flat facet's up (the ledges' moss); foot: the pixel's (or texel's)
// footprint on the ground (m); farG: the far ground's cheap paint; farDots / beyond: the shrub dots' / the flowers'
// distance fades (1 in the bake: applied when it's read); pud: the puddles' noise wanted (rain, or the bake)
Surf surfaceAt(vec2 xz, float h, vec3 Ns, float nfY, float foot, bool farG, bool box, float farDots, float beyond, bool pud) {
  Surf s;
  // THE FAR GROUND, CHEAP (2026-10-27, phones at full resolution): past 2 km the haze has taken half and the fine marks
  // are under a pixel — only the paint's two broad octaves are read there (2 fetches, not 5) and no shrub dots
  Paint p;
  if (farG) {
    p.mid = texture(uNoise, xz * (1.0 / 71.0));
    p.big = texture(uNoise, xz * (1.0 / 389.0) + vec2(0.37, 0.59));
    p.fine = p.grain = p.micro = vec4(0.5);
  } else if (foot > 1.6) {
    // (2026-10-27, the cost of the new look: an octave whose marks are under ~2 pixels reads its mip's average —
    //  ≈ 0.5, and every use of the grain / micro already fades by near there: skip the fetch, keep the look)
    p.mid = texture(uNoise, xz * (1.0 / 71.0));
    p.big = texture(uNoise, xz * (1.0 / 389.0) + vec2(0.37, 0.59));
    p.fine = foot > 8.0 ? vec4(0.5) : texture(uNoise, xz * (1.0 / 13.0) + vec2(0.71, 0.13));
    p.grain = p.micro = vec4(0.5);
  } else p = paintNoise(xz);
  float steep = 1.0 - Ns.y; // 0 flat … 0.3 ≈ 45°

  // the mask: baked inside the box; outside it, painted from slope, height and noise (the far ranges)
  // (the box's rim: its mask handed over to the outland's — boxRim; 1 beyond the box)
  float rim = box ? boxRim(xz, (p.big.g - 0.5) * 100.0 + (p.mid.r - 0.5) * 40.0) : 1.0;
  vec4 m = vec4(0.0);
  if (box) m = texture(uMask, gridUv(uMaskGrid, xz));
  if (rim > 0.0) {
    vec4 mo;
#ifdef OTH_DESERT
    // (the far desert: sandstone where it's steep, sand everywhere else — loose in broad drifts; nothing grows)
    float rock = smoothstep(0.12, 0.26, steep + (p.big.b - 0.5) * 0.12);
    mo = vec4(rock, 0.55 + (p.big.g - 0.5) * 0.7, 0.0, 0.0);
#else
    mo = outlandMask(steep, h, p.big, p.mid);
    { float st = stonyAt(xz, p.mid.g); mo.r = max(mo.r, st); mo.a *= 1.0 - st; }
#endif
    m = mix(m, mo, rim);
  }
#ifdef OTH_SKIN
  if (box) {
    // (inside a cave: its own rock; no water, earth or forest floor from the hill's top over it)
    m.r = max(m.r, gSkinRock);
    m.ba *= 1.0 - gSkinIn;
  }
#endif
  vec4 trailT = box ? texture(uTrail, gridUv(uInGrid, xz)) : vec4(1.0, 0.0, 0.0, 0.0); // (R the track, B A the mud, flowers)
  if (rim > 0.0) trailT.ba = mix(trailT.ba, vec2(bogMud(xz, p.mid.r), meadowAt(xz, p.mid.b)), rim); // (the outland's bog and flower meadows)
  float trail = trailT.r * 8.0;
  float thw = uTrailHW;
  // (an outland road, where it's nearer than a track of the box: the same earth, its own width)
  float rd = roadCentre(xz), outRoad = 0.0;
  if (rd - uRoadG.z < trail - thw) { trail = rd; thw = uRoadG.z; outRoad = 1.0; }
  Ground g = groundPaint(xz, m, h, steep, p, foot, trail, thw, farG ? 0.0 : farDots); // (painted shrub dots only beyond the real bushes)
  vec3 col = g.col;
  // (a road of the outland is not one earth from end to end: grey GRAVEL as it climbs — whole by ~560 m — and darker,
  //  damp, under the forest's patches; the valley runs keep the tracks' tan)
  if (outRoad > 0.5 && g.trail > 0.01) col = mix(col, col * mix(vec3(1.0), vec3(0.7, 0.73, 0.78), smoothstep(360.0, 560.0, h + (p.mid.r - 0.5) * 60.0)) * (1.0 - 0.2 * g.forest), g.trail);
  // THE EARLY SNOW (uSnowAt — the outland's high massif): the first fall of the year (the outland's paint from the box's rim on)
  if (rim > 0.0) {
    float sn = earlySnow(xz, h, steep, p.big.r, p.mid.g, p.fine.g, p.mid.b) * (1.0 - 0.8 * g.trail);
    col = mix(col, SNOW, sn);
    g.snow = max(g.snow, sn);
    // THE CLIFFS' TONE: out here a cliff would be one flat grey — its faces take broad PATCHES of tone instead, slate to
    // warm buff to pale grey, by the paint's 2D noises (a few hundred metres and ~70 m across). NO BEDS BY HEIGHT
    // (2026-11-11, night — the user, of the striped peaks: "fix all repeated line like this"): the strata painted every
    // 46 / 15 / 5 m with a dark ledge line under each read as stripes over every peak and through the snow — gone.
    float face = g.rock * smoothstep(0.22, 0.42, steep) * (1.0 - g.trail) * rim;
    if (face > 0.01) {
      float tone = clamp(p.big.g * 0.6 + p.mid.b * 0.4, 0.0, 1.0);
      vec3 bed = mix(vec3(0.33, 0.35, 0.38), mix(vec3(0.47, 0.41, 0.33), vec3(0.5, 0.49, 0.46), smoothstep(0.5, 0.75, p.mid.g)), smoothstep(0.3, 0.7, tone));
      col = mix(col, bed * (0.92 + 0.16 * p.mid.r), face * 0.6 * (1.0 - g.snow));
    }
    // a LAKE's shore and bed: wet gravel from half a metre over the water down
    float lw = lakeDepth(xz, h);
    if (lw > -0.55) {
      float shore = smoothstep(-0.55, 0.05, lw + (p.fine.r - 0.5) * 0.3);
      col = mix(col, BED * (0.8 + 0.2 * p.fine.g + 0.14 * p.mid.r) * mix(1.0, 0.7, smoothstep(0.0, 2.5, lw)), shore * (1.0 - 0.7 * g.rock));
      g.bed = max(g.bed, shore); g.snow *= 1.0 - shore; g.trail *= 1.0 - shore;
    }
  }
  // (2026-11-04 — the user: "I can see lots of triangles instead of a smooth surface": no low-poly facets — the smooth
  //  normal everywhere, no per-triangle tone; the light rolls over the land in soft gradients)
  // HIGH / ULTRA on PCs: the rock's (and the scree's) crumpled 3D relief — the light only (the terrain applies it)
#ifdef OTH_DESERT
  // (round 2: the desert's walls clean planes like its slabs — the relief crumpled them into melted wax)
  s.relief = g.rock * (1.0 - g.trail) * (1.0 - 0.75 * smoothstep(0.25, 0.55, steep));
#else
  s.relief = max(g.rock, g.scree * 0.6) * (1.0 - g.trail); // (never on a track)
#endif
  s.rip = vec2(0.0);
#ifdef OTH_DESERT
  // WIND RIPPLES in the loose sand: fine ridges across the wind (~0.35 m), the light only — on the LOOSE sand only
  // (2026-11-04: not the gravel, rock, tracks or the damp), in PATCHES (a slow no-repeat noise: some sand lies smooth),
  // at two angles of the wind crossfading (one direction everywhere read as a repeated pattern), gone wherever a
  // ripple would be smaller than a pixel or two
  // (2026-11-04, the clean look: only on the dunes and the deep sheets, and gentler)
  float loose = g.loose * smoothstep(0.75, 0.95, m.g) * (1.0 - smoothstep(0.3, 0.7, m.b)) * (1.0 - smoothstep(0.05, 0.12, foot));
  if (loose > 0.01) {
    float patchK = smoothstep(0.38, 0.62, g.ripK);
    loose *= 0.25 + 0.75 * patchK;
    vec2 wd1 = vec2(0.83, 0.56), wd2 = vec2(0.47, 0.88);
    float warp = (p.mid.g - 0.5) * 9.0 + (p.fine.b - 0.5) * 2.2 + (p.grain.r - 0.5) * 1.2;
    float wk = smoothstep(0.38, 0.62, p.big.r);
#ifdef OTH_SPEC
    float ph1 = dot(xz, wd1) * 17.0 + warp, ph2 = dot(xz, wd2) * 13.5 + warp * 0.8;
    float rip = mix(cos(ph1) * 0.5 + 0.5 * cos(ph1 * 2.03 + 1.1) * 0.35, cos(ph2) * 0.5 + 0.5 * cos(ph2 * 2.03 + 0.4) * 0.35, wk);
    vec2 wd = normalize(mix(wd1, wd2, wk));
#else
    // (LOW: one angle or the other, never both)
    vec2 wd = wk > 0.5 ? wd2 : wd1;
    float ph = dot(xz, wd) * (wk > 0.5 ? 13.5 : 17.0) + warp;
    float rip = cos(ph) * 0.5 + 0.5 * cos(ph * 2.03 + 1.1) * 0.35;
#endif
    s.rip = wd * rip * 0.1 * loose;
  }
#endif
  // CLIFF FACES (2026-10-27, "cliffs … the colour is the key"): a steep rock face reads as LAYERED stone — beds of
  // UNEVEN thickness (two smooth 1D noises sharing no period), soft tones, no seams; darker streaks running down from
  // the ledges at two scales with no common period; moss and grass on the ledges (the facets that face up). The small
  // beds and the streaks fade into the plain colour as they shrink toward a pixel. Rock only.
#ifdef OTH_DESERT
  float cliffK = 0.0; // (the desert's beds are its own paint: groundPaint)
#else
  float cliffK = g.rock * smoothstep(0.22, 0.5, steep) * (1.0 - g.trail);
#endif
  if (cliffK > 0.01) {
    float nearK = 1.0 - smoothstep(0.8, 3.5, foot);
    // (no beds by height — 2026-11-11, night, the user: "fix all repeated line like this": the 13 m / 4 m bands were
    //  horizontal stripes up every steep face; the face's tone is the paint's, the streaks and the ledges' moss stay)
    vec3 band = vec3(1.0);
    float wx = smoothstep(0.3, 0.7, abs(Ns.x) / (abs(Ns.x) + abs(Ns.z) + 1e-4));
    float streak = 0.0;
    if (nearK > 0.01) {
#ifdef OTH_SPEC
      streak = smoothstep(0.5, 0.82, mix(texture(uNoise, vec2(xz.x / 29.0, h / 230.0 + 0.6)).g, texture(uNoise, vec2(xz.y / 25.1 + 0.2, h / 210.0)).g, wx)) * nearK;
#else
      streak = smoothstep(0.5, 0.82, texture(uNoise, vec2((wx > 0.5 ? xz.y : xz.x) / 29.0, h / 230.0 + 0.6)).g) * nearK; // (LOW: one read)
#endif
    }
    col *= mix(vec3(1.0), band * (1.0 - 0.16 * streak), cliffK);
    col = mix(col, mix(GREEN, GREEN_DEEP, p.fine.g) * 1.1, cliffK * smoothstep(0.8, 0.95, nfY) * 0.75);
  }

  float rough = mix(0.92, 0.62, g.rock);
  rough = mix(rough, 0.45, g.snow);
  // MUD (the marsh, the tracks' mud holes, the slow banks — mud.bin): dark wet earth in soft painted patches, glossy,
  // dragged into streaks; the thickest of it holds standing water (the terrain, with the rain's puddles)
  vec2 mudB = trailT.ba;
  float mud = mudB.r;
  // WILDFLOWERS seen from beyond the grass (the blades draw them near): the field speckled with its drift's colour,
  // the speckle melting into a tint where it would shimmer — its amount here, the drift's colour mixed by the terrain
  // (LOW's grass ends at 38 m, ULTRA's at 72: past that the paint carries the same band — a sprinkle over the field's
  //  own colour, as the blades show it: only a flower's top is in bloom)
  s.flower = 0.0;
  if (mudB.g > 0.02) {
    float spk = mix(dotsAt(xz, 1.6, 0.42, 0.42, max(0.12, foot * 0.45)), 0.62, smoothstep(0.4, 1.6, foot));
    s.flower = min(1.0, mudB.g * 1.15) * beyond * (1.0 - g.trail) * (1.0 - g.rock) * min(1.0, spk * 1.6) * 0.3;
  }
  float mudA = 0.0;
  if (mud > 0.01) {
    mudA = smoothstep(0.1, 0.45, mud + (p.mid.r - 0.5) * 0.3);
    vec3 MUDC = mix(vec3(0.075, 0.056, 0.038), vec3(0.135, 0.1, 0.066), texture(uNoise, xz * vec2(0.31, 0.11)).b);
    col = mix(col, MUDC, mudA);
    rough = mix(rough, 0.3, mudA);
    s.flower *= 1.0 - mudA;
  }
  s.col = col;
  s.rock = g.rock;
  s.rough = rough;
  s.aoB = mix(1.0, 0.7, g.forest) * mix(1.0, 0.85, g.bed);
  // under the grass the ground lies in the blades' shade (the terrain fades it toward the grass's edge)
  s.under = grassy0(m, g.rock, g.forest) * (1.0 - smoothstep(0.02, 0.1, g.scree)) * (1.0 - g.trail);
  // the fields' sheen's share: open grass (a low back-lit sun glows on it)
  s.grassy = (1.0 - g.rock) * (1.0 - g.forest) * (1.0 - g.snow) * (1.0 - g.bed);
  s.trail = g.trail;
  // the puddles' inputs: the bog (thick mud: water at any weather) and the ruts' pools' noise (filled by the rain)
  s.bog = smoothstep(0.8, 0.92, mud + (texture(uNoise, xz * 0.05).g - 0.5) * 0.3);
  s.pudN = pud && (g.trail > 0.2 || g.rock > 0.3) ? texture(uNoise, xz * 0.085).g + texture(uNoise, xz * 0.31).r * 0.16 : 0.0;
  s.dots = g.dots;
  s.shape = 0.0;
  return s;
}
`

/**
 * The CACHE's read side (GroundCache.ts): the surface from the baked levels round the camera — the level by the pixel's
 * footprint (a texel ≈ a pixel) or, farther than the finer levels reach, by the distance; two levels blended; past
 * the coarsest, the FAR level (the whole world). uGC = (texels a level's side N, the finest texel (m), 1 / the atlas's
 * side, the far level's texel (m)).
 */
export const GC_READ_GLSL = /* glsl */ `
#ifdef GC_ON
uniform sampler2D uGC0;
uniform sampler2D uGC1;
uniform sampler2D uGC2;
uniform sampler2D uGC3;
uniform vec4 uGC;
// the level for a pixel at xz with footprint foot, as L + w (w: the blend toward L + 1): L the level whose texel
// matches the pixel — or, nearer the edge of the finer levels' reach, the FINEST whose window holds xz (centred on the
// camera within 16 texels, 2 more for the filter), blended into the next over the last quarter of its reach (a
// hillside facing the camera across a valley is reach-bound: the texel no coarser than it must be)
float gcLevel(vec2 xz, float foot) {
  vec2 d = abs(xz - uCamPos.xz);
  float r = max(max(d.x, d.y), 1e-3) / ((uGC.x * 0.5 - 20.0) * uGC.y); // (the distance in level-0 reaches)
  float lf = max(log2(foot * GC_BIAS / uGC.y), 0.0);
  float L = max(floor(lf), ceil(log2(r)));
  float w = max(floor(lf) >= L ? fract(lf) : 0.0, smoothstep(0.75, 1.0, r * exp2(-L)));
  return L + min(w, 0.999);
}
// level L (GC_LEVELS: the far one) at xz — its tile in the 3 × 3 atlas, the texel wrapped into its window
void gcTap(vec2 xz, float L, out vec4 a, out vec4 b, out vec4 c, out vec4 d) {
  float t = L >= GC_LEVELS ? uGC.w : uGC.y * exp2(L), S = uGC.x + 4.0;
  vec2 cf = mod(xz / t - 0.5, uGC.x);
  vec2 uv = (vec2(mod(L, 3.0), floor(L / 3.0)) * S + 2.5 + cf) * uGC.z;
  a = textureLod(uGC0, uv, 0.0); b = textureLod(uGC1, uv, 0.0); c = textureLod(uGC2, uv, 0.0); d = textureLod(uGC3, uv, 0.0);
}
Surf gcSurface(vec2 xz, float Lf) {
  float L = min(floor(Lf), GC_LEVELS), w = L >= GC_LEVELS ? 0.0 : Lf - L;
  vec4 a, b, c, d;
  gcTap(xz, L, a, b, c, d);
#ifdef GC_NOBLEND
  if (w > 0.5) {
#else
  if (w > 0.004) {
#endif
    vec4 a2, b2, c2, d2;
    gcTap(xz, L + 1.0, a2, b2, c2, d2);
    a = mix(a, a2, w); b = mix(b, b2, w); c = mix(c, c2, w); d = mix(d, d2, w);
  }
  Surf s;
  s.col = a.rgb * a.rgb; s.rock = a.a;
  s.rough = b.r; s.aoB = b.g; s.grassy = b.b; s.under = b.a;
  s.shape = (c.r - 0.5) * 4.0; s.trail = c.g; s.bog = c.b; s.pudN = c.a * 1.2;
  s.dots = d.b; s.flower = d.a * 0.3;
#ifdef OTH_DESERT
  s.relief = 0.0; s.rip = (d.rg - 0.5) * 2.0; // (the ripples' bend; the relief's strength: the terrain, from the slope)
#else
  s.relief = d.r; s.rip = vec2(0.0); // (the relief's strength — drawn live: GroundCache's bake)
#endif
  return s;
}
#endif
`

/**
 * THE PAVING (2026-11-08, the user: "places like houses, broken houses — no grass there: change the terrain's shader
 * there; on mobile just a texture, on PC something like [weathered flagstones]; the colour from the terrain's"; "don't
 * change it so sudden — I need the transition"). Where a place cleared its ground (Landmarks PAVED: its floors and
 * yards, MapData.trailTex G — 1 up to 0.6 m past the cleared box, 0 at 4 m) the ground is laid with the flagstones of
 * `paveTex.ts`, drawn live over the surface (cached or not), never baked:
 *  - THE EDGE, gradual: the stamped cover pushed in and out by the paint noise (blobs ~6 m, a finer fringe — no line,
 *    no box), and as it falls the stones DROP OUT one by one (a stone is laid while the cover is over its id), the
 *    ones left SINK (the dirt creeps over their rims, each shows smaller) and the joints' dark dirt fades to the
 *    ground's own colour — paving, then broken paving, then a few stones in the dirt, then the field (the grass comes
 *    back over the last of it, shorter: Landmarks' footprint);
 *  - THE COLOUR from the ground under it: a stone grey with a third of the ground's hue (gold field → warm sandstone
 *    grey, green → cool green-grey), each stone its own tone; the joints the ground's colour darkened (gold → amber
 *    grit, green → moss);
 *  - PHONES / weak GPUs (no OTH_PAVE_HI): the texture alone — one fetch (+ one for the edge's noise), its height, its
 *    baked normal, its id; PCs (OTH_PAVE_HI) add the joints warped off the ruler, the ground's grime and dust in patches
 *    on the stones, the moss creeping over their rims, fine pitting, the stone's lower roughness.
 * k = the stone's share (0 … 1), returned: the grass's shade, its sheen, the rock relief and the shrub dots kept off.
 */
const PAVE_GLSL = /* glsl */ `
#if defined(OTH_PAVE) && !defined(OTH_SKIN)
${PAVE_FRAME_GLSL}
float paveAt(vec2 xz, float mk, float foot, vec4 F, inout vec3 col, inout vec3 N, inout float rough) {
  vec4 nb = texture(uNoise, xz * (1.0 / 6.1) + vec2(0.13, 0.71));
  float cover = clamp(mk * 1.3 - 0.14 + (nb.r - 0.5) * 0.6 + (nb.b - 0.5) * 0.25, 0.0, 1.0);
  if (cover < 0.005) return 0.0;
  // laid square to its place (the nearer of the two): its own frame, from its centre
  vec2 uv = paveUv(xz, F);
#ifdef OTH_PAVE_HI
  vec4 nw = texture(uNoise, xz * (1.0 / 2.3) + vec2(0.57, 0.29));
  uv += (nw.rg - 0.5) * (0.1 / PAVE_TILE); // (the joints off the ruler: ±5 cm)
#endif
  vec4 t = texture(uPave, uv);
  float h = t.r, id = t.a;
  // (far off a texel averages several stones: no single stone to drop or sink — the cover alone)
  float farK = smoothstep(0.05, 0.2, foot);
  float laid = mix(smoothstep(-0.04, 0.04, cover - id), cover, farK);
  float sink = (1.0 - cover) * 0.5 * (1.0 - farK);
  float k = laid * smoothstep(sink + 0.03, sink + 0.14, h);
  // the colour from the ground's: its hue (over a quarter of it) in a stone grey, each stone its own tone
  float lum = max(dot(col, vec3(0.3, 0.55, 0.15)), 1e-4);
  vec3 tint = clamp(col / lum, vec3(0.0), vec3(3.0));
  float tone = fract(id * 37.7);
  vec3 stone = vec3(0.128, 0.128, 0.13) * mix(vec3(1.0), tint, 0.28) * (0.76 + 0.42 * tone);
  stone *= mix(0.78, 1.0, smoothstep(0.25, 0.7, h)); // (the worn rims a little darker)
  // the joints: the ground's colour, dulled and darkened into grit (its own colour again toward the paving's edge)
  vec3 joint = mix(col, mix(col, vec3(lum), 0.35) * 0.4 + vec3(0.008, 0.006, 0.004), cover);
#ifdef OTH_PAVE_HI
  float nearK = 1.0 - smoothstep(0.02, 0.09, foot);
  // the ground's grime and dust in patches, the moss / straw creeping over the rims, fine pitting
  stone = mix(stone, col * 0.85, smoothstep(0.55, 0.85, nb.g) * 0.3);
  stone = mix(stone, joint, (1.0 - smoothstep(0.25, 0.5, h)) * smoothstep(0.4, 0.7, nw.b) * 0.6);
  stone *= mix(1.0, 0.9 + 0.2 * texture(uNoise, xz * (1.0 / 0.37) + vec2(0.31, 0.83)).r, nearK);
  rough = mix(rough, 0.68, k);
#endif
  col = mix(joint, stone, k);
  // the stones' bevels and tilts in the light (the texture's normal: none far off, none where the dirt covers a rim)
  vec2 nt = (t.gb - 0.5) * 2.0;
  nt = vec2(nt.x * F.z + nt.y * F.w, -nt.x * F.w + nt.y * F.z); // (back from its place's frame)
  N = normalize(N + vec3(nt.x, 0.0, nt.y) * laid * (1.0 - farK) * smoothstep(sink, sink + 0.1, h));
  return k;
}
#endif
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
${ROCK_RELIEF_GLSL}
${PAINT_GLSL}
uniform vec4 uInGrid;
uniform vec4 uFarGrid;
uniform float uBoxHalf;
uniform float uWater;
${SURF_GLSL}
${GC_READ_GLSL}
${SHADOW_GLSL}
${SHAPE_GLSL}
${PAVE_GLSL}
in vec3 vWorld;

uniform float uGrassR;
uniform float uBushR;
uniform vec4 uShore0; // (the wet bank: the four still waters nearest the camera — x, z, reach, level)
uniform vec4 uShore1;
uniform vec4 uShore2;
uniform vec4 uShore3;
#ifdef OTH_HOLES
// THE CAVE'S OPENINGS (CaveWorld.intoTerrain — only in the draw of the patches round it): its hill is the ground's own
// heights, so across its mouth and skylights the ground would span from the hill's top to the land below — cut there:
// in such a 2 m cell nothing over the land (the cell's clip height, + a margin that grows with the distance for the
// coarser levels) is drawn; the cave's own surface fills the opening
uniform highp sampler2D uHole;  // the land's heights round the cave (its 2 m grid points)
uniform vec4 uHoleGrid;         // x0, z0, points across, points down
// (uHole's rows h…2h−1: holeK — 0 over a skylight's hole, 1 on the hill; read bilinear: a smooth edge)
uniform vec4 uHoleC0;           // the circles: x, z, r, on
uniform vec4 uHoleC1;
uniform vec4 uHoleC2;
bool inHoleC(vec2 p, vec4 c) { vec2 d = p - c.xy; return c.w > 0.5 && dot(d, d) < c.z * c.z; }
#endif

void main() {
#ifdef OTH_HOLES
  {
    {
      vec2 kc = (vWorld.xz - uHoleGrid.xy) / uInGrid.y;
      if (kc.x >= 0.0 && kc.y >= 0.0 && kc.x < uHoleGrid.z - 1.001 && kc.y < uHoleGrid.w - 1.001) {
        ivec2 ki = ivec2(floor(kc)) + ivec2(0, int(uHoleGrid.w + 0.5));
        vec2 kw = kc - vec2(ki);
        float k = mix(mix(texelFetch(uHole, ki, 0).r, texelFetch(uHole, ki + ivec2(1, 0), 0).r, kw.x), mix(texelFetch(uHole, ki + ivec2(0, 1), 0).r, texelFetch(uHole, ki + ivec2(1, 1), 0).r, kw.x), kw.y);
        if (k < 0.3) discard;
      }
    }
    if (inHoleC(vWorld.xz, uHoleC0) || inHoleC(vWorld.xz, uHoleC1) || inHoleC(vWorld.xz, uHoleC2)) {
      vec2 hc = clamp((vWorld.xz - uHoleGrid.xy) / uInGrid.y, vec2(0.0), uHoleGrid.zw - 1.001);
      ivec2 hi = ivec2(floor(hc));
      vec2 hw = hc - vec2(hi);
      float land = mix(mix(texelFetch(uHole, hi, 0).r, texelFetch(uHole, hi + ivec2(1, 0), 0).r, hw.x), mix(texelFetch(uHole, hi + ivec2(0, 1), 0).r, texelFetch(uHole, hi + ivec2(1, 1), 0).r, hw.x), hw.y);
      if (vWorld.y > land + 0.3 + 0.003 * length(vWorld - uCamPos)) discard;
    }
  }
#endif
#ifdef TC_FLAT
  gl_FragColor = vec4(applyAtmos(vec3(0.12, 0.13, 0.06), vWorld), 1.0);
#else
  vec2 xz = vWorld.xz;
  bool box = inTheBox(xz);
#ifdef OTH_SKIN
  // (the skin: the mesh's own normal; inside, what's steep is rock as the ground's steep would be — gradual, the
  //  paint's noise breaking it)
  vec3 Ns = normalize(vSkinN);
  gSkinIn = vSkin.x;
  gSkinRock = max(vSkin.y, smoothstep(0.2, 0.5, 1.0 - Ns.y) * vSkin.x);
  float ckS = caveK(vWorld) * vSkin.x;
#else
  vec3 Ns = groundNormal(xz, box);
#endif
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  float dcam = length(vWorld.xz - uCamPos.xz);
  bool farG = dcam > 2000.0;
  // the pixel's footprint on the ground (m): the paint's small marks fade before they'd shimmer
  float foot = max(length(fwidth(xz)), 0.001);
  float steep = 1.0 - Ns.y;
  float farDots = farG ? 0.0 : smoothstep(uBushR * 0.7, uBushR, dcam);
  float beyond = smoothstep(uGrassR * 0.55, uGrassR * 0.9, dcam);
  // THE GROUND CACHE (GroundCache.ts, docs/PERF.md): the surface baked round the camera, read in 4–8 fetches instead of
  // painting it again on every pixel every frame — not on the steep walls (a top-down texel stretches down a wall: the
  // live paint there), nor past the cache's reach (the far ground's cheap live paint)
  // (the STEEP walls within its reach are painted live: a top-down texel stretches down a wall — its beds smeared, its
  //  creases lost; past the reach, the far level holds them too: there a texel is under a pixel's worth of haze)
  Surf s;
  bool cached = false;
#ifdef GC_ON
  float Lf = farG ? GC_LEVELS : gcLevel(xz, foot);
  if (steep < GC_STEEP || Lf >= GC_LEVELS) { s = gcSurface(xz, Lf); cached = true; s.dots *= farDots; s.flower *= beyond; }
  else
#endif
  {
    vec3 Nf = normalize(cross(dpx, dpy));
    s = surfaceAt(xz, vWorld.y, Ns, abs(Nf.y), foot, farG, box, farDots, beyond, uWet > 0.05);
  }
  vec3 col = s.col;
  vec3 N = Ns;
#if defined(OTH_PAVE) && !defined(OTH_SKIN)
  // THE PAVING (PAVE_GLSL): the places' flagstones, live over the ground — where the paving's mask reaches
  // (only within a near paved place's reach — an ALU test first, no texture read elsewhere)
  vec4 PF;
  if (box && paveFrame(xz, PF)) {
    float pmk = texture(uTrail, gridUv(uInGrid, xz)).g;
    if (pmk > 0.004) {
      float pk = paveAt(xz, pmk, foot, PF, col, N, s.rough);
      s.dots *= 1.0 - pk; s.flower *= 1.0 - pk; s.under *= 1.0 - pk; s.grassy *= 1.0 - pk; s.relief *= 1.0 - pk;
    }
  }
#endif
#ifndef OTH_SKIN
  // THE WET BANK (2026-11-08, the user: "the sides of the water — properly shaded, real good"): round a lake or a pond
  // (the four nearest — uShore: x, z, reach, level) the ground from its waterline to ~30 cm above it darkened and a
  // little glossy, its top edge ragged — the bed under the water as wet (the water's own sheet can't draw it: the bank
  // stands over its plane)
  if (box) {
    vec4 S0 = uShore0, S1 = uShore1, S2 = uShore2, S3 = uShore3;
    float lv = -1e6;
    if (dot(xz - S0.xy, xz - S0.xy) < S0.z * S0.z) lv = S0.w;
    else if (dot(xz - S1.xy, xz - S1.xy) < S1.z * S1.z) lv = S1.w;
    else if (dot(xz - S2.xy, xz - S2.xy) < S2.z * S2.z) lv = S2.w;
    else if (dot(xz - S3.xy, xz - S3.xy) < S3.z * S3.z) lv = S3.w;
    float up = vWorld.y - lv;
    if (up < 0.5) {
      float rag = texture(uNoise, xz * (1.0 / 3.3)).g;
      float wet = 1.0 - smoothstep(0.1 + 0.12 * rag, 0.3 + 0.14 * rag, up);
      col *= 1.0 - 0.36 * wet * (1.0 - s.rock * 0.4);
      s.rough = mix(s.rough, 0.5, wet * 0.7);
      s.grassy *= 1.0 - wet;
    }
  }
#endif
  col = mix(col, SHRUB, s.dots);
  if (s.flower > 0.002) col = mix(col, flowerColor(xz, 0.5), s.flower);
  float cav = 1.0;
#ifdef OTH_DESERT
  if (cached) {
    // (the cache's normal map: the ripples, baked — their bend added to this pixel's smooth normal)
    vec2 nxz = Ns.xz + s.rip;
    N = vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y);
    s.relief = s.rock * (1.0 - s.trail) * (1.0 - 0.75 * smoothstep(0.25, 0.55, steep)); // (surfaceAt's, desert)
  } else N = normalize(N + vec3(s.rip.x, 0.0, s.rip.y));
#endif
  // THE ROCK'S RELIEF, LIVE on every rock pixel — cached ground or not, as before the ground cache (2026-11-06, the
  // user: "all should have the same … the same as 2 days before"; GroundCache's bake says why)
#if defined(OTH_ROCK_RELIEF) && !defined(TC_RELIEF)
  N = rockRelief(vWorld, N, s.relief, dpx, dpy, cav);
#endif
#ifdef TC_RDBG
  // (?tcut=rdbg: R the relief's strength, G how much survives the pixel's size, B cached)
  gl_FragColor = vec4(s.relief, reliefShow(max(length(dpx), length(dpy))), cached ? 1.0 : 0.0, 1.0); return;
#endif

  float wrap = mix(0.62, 0.45, s.rock); // (rock's light softer at its edge too)
  float ao = s.aoB * cav;
  vec3 V = normalize(uCamPos - vWorld);
  // (the 4 m shadow bake on a near-vertical face: a stripe at every texel row. A steep face reads its shade a few
  //  metres out in front of it instead — the open ground there, in the wall's shadow or not; its facing does the rest)
  float wallK = smoothstep(0.3, 0.6, steep);
  vec2 outward = Ns.xz / max(length(Ns.xz), 1e-3);
#ifdef TC_SUN
  float sun = 1.0;
#elif defined(OTH_SKIN)
  float sun = sunVisibility(xz) * (1.0 - ckS);
#else
  float sun = sunVisibility(xz + outward * 6.0 * wallK);
#endif
#ifdef OTH_DESERT
  // (2026-11-04, round 2: the desert's bare walls — a road's cut, a cliff no slab covers — went to a stair of dark
  //  4 m texels where the bake's outward read flipped cell by cell: a steep face lit by its facing alone)
  sun = mix(sun, 1.0, wallK * 0.85);
#endif
  // under the grass the ground lies in the blades' shade (it shows between them); the shade lifts toward the
  // grass's edge, where the ground alone must look like the field from afar
  float under = s.under * (1.0 - smoothstep(uGrassR * 0.3, uGrassR * 0.95, length(vWorld - uCamPos)));
  vec3 lit = col * (1.0 - 0.14 * under);
#ifdef OTH_SHAPE
  // the small shapes' light: the hollows, and the bumps' slopes against the hill's (its normal ~30 m across)
  vec3 Nb = box ? normalize(mix(unpackN(texture(uNIn, gridUv(uInGrid, xz), 4.0).rg), Ns, boxRimN(xz))) : Ns;
#ifdef OTH_SKIN
  lit *= mix(shapeLight(s.shape, Ns, Nb, sun), 1.0, vSkin.x); // (outside as the ground; none in the cave)
#else
  lit *= shapeLight(s.shape, Ns, Nb, sun);
#endif
#endif
#ifdef TC_SHADE
  vec3 c = lit * (0.4 + 0.6 * max(dot(N, uSunDir), 0.0));
#else
  // (no cave's dark on the ground — 2026-11-07: the cave world has its own floors, the terrain runs hidden under it)
  vec3 c = shade(lit, N, V, s.rough, 0.04, ao, sun, wrap);
#endif
  c += rockFill(lit, N) * s.rock * ao;
#ifdef OTH_SKIN
  // IN THE CAVE (as Bridges' cave surfaces were lit): dim, never black, lit FROM its openings, the skylight's daylight
  if (ckS > 0.001) {
    c -= rockFill(lit, N) * s.rock * ao * 0.6 * ckS;
    c *= 1.0 - 0.75 * ckS;
    float dl = caveLit(vWorld, N);
    c += lit * uAmbSky * ckS * (0.42 + 0.7 * dl);
    c += lit * (uSunColor * 0.3 + uAmbSky * 0.3) * caveBounce(vWorld) * ckS * smoothstep(-0.05, 0.25, uSunDir.y) * (0.3 + 0.95 * dl);
  }
#endif
  c += headlight(lit, N, vWorld);
  // PUDDLES (the rain): pools in the tracks' ruts and dips, a still dark mirror of the sky, spreading as it gets wetter
  // (and on bare FLAT rock — 2026-11-07, the user: "just some water on the ground": where the rain lies and shows; the
  //  grass hides its own)
  float pudOn = max(s.trail, s.rock * smoothstep(0.955, 0.985, Ns.y));
#ifdef TC_PUD
  if (false) {   // (?tcut=pud — pudOn declared above it: in the other arm the cut did not compile, 2026-11-11)
#else
  if ((uWet > 0.05 && pudOn > 0.2) || s.bog > 0.0) {
#endif
    float pud = smoothstep(0.71, 0.76, s.pudN + (uWet - 1.0) * 0.35) * pudOn * step(0.05, uWet);
#ifdef OTH_SKIN
    pud *= 1.0 - smoothstep(0.1, 0.4, ckS); // (no rain in a cave)
#endif
    pud = max(pud, s.bog * 0.85);
    float fr = 0.12 + 0.6 * pow(1.0 - max(V.y, 0.0), 4.0);
    // (dark muddy water: the bed shows through, the sky in it at a glance; the bed LIT — at night the water dark too)
    vec3 mirror = c * 0.14 + skyColor(reflect(-V, vec3(0.0, 1.0, 0.0))) * fr * 0.55 + headlight(vec3(0.5), vec3(0.0, 1.0, 0.0), vWorld) * 0.6;
    c = mix(c, mirror, pud * 0.9);
  }
  // the fields' sheen: grass back-lit by a low sun glows warm
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  c += col * uSunColor * back * 0.11 * s.grassy * smoothstep(-0.1, 0.4, dot(N, uSunDir)) * sun;
#ifdef TC_ATMOS
  gl_FragColor = vec4(c, 1.0);
#else
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
#endif
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Keep the 4 nearest: `slot` (ids, −1 empty) and `dist` sorted near → far; `id` at `d` goes in its place (if nearer). */
function nearest4(slot: Int32Array, dist: Float64Array, id: number, d: number): void {
  if (d >= dist[3]) return
  let k = 3
  while (k > 0 && dist[k - 1] > d) { dist[k] = dist[k - 1]; slot[k] = slot[k - 1]; k-- }
  dist[k] = d; slot[k] = id
}
