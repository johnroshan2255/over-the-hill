import type { Atmosphere } from './Atmosphere'
import { Builder, SURF, woodMaterial } from './Bridges'
import * as GFX from './gfx'
import { beam, crate, rbox, rock, V, wheel } from './Kit'
import type { Landmark, MapData } from './MapData'
import type { Tier } from './quality'
import { gameParams } from '../settings'
import type { Terrain } from './Terrain'
import type { TerrainShadow } from './TerrainShadow'
const { DRACOLoader, GLTFLoader } = GFX

/**
 * THE CAVE WORLD (2026-11-07, the user: "use Blender to make / sculpt a cave — a proper one"; "a single mesh, a big
 * one, like a small world which can be explored, like in Genshin"; "on top of it normal grass and some rock texture
 * with the shaders, and some trees; inside, grass and some pine trees where the light gets"; "naturally blended").
 * Modelled by scripts/oth/caves.py (Blender: a signed distance field → surface nets → remesh / smooth / decimate) and
 * exported as public/oth/valley/cave.glb (Draco: TURF the hill, ROCK the cave, GARDEN the turf in the skylight's
 * light, a lighter COLLIDER) and cave.json (the hill's TOP as a 2 m height grid, the garden's pines and tufts, the
 * stones, the skylight, the dark's reach). Its local frame: the mouth at the origin looking +z, y up, the ground y = 0.
 *
 * Placed by Sites.planSites (one, the valley's: "Sky Hollow"); here every vertex is LAID ON THE LAND — its height is
 * the land's under it plus its own (y = ly + H(x, z)), so the hill rises out of the ground wherever it stands and the
 * cave's floors (≥ 0.4 m up in the model) stay above the terrain, which runs on hidden in the rock. Painted by the
 * landmarks' material (Bridges.ts): the hill in the field's own grass (SURF.turf: the land's dryness where it stands,
 * bare rock in patches where it's steep), the cave in the terrain's rock (SURF.cliff: caveRockPaint + rockRelief), the
 * garden lush. Grass TUFTS over the hill and the garden; rounded STONES round the mouth and on the way to it. The
 * terrain's own grass is kept off where the hill stands (the rocks' footprint), not off its foot — they blend there.
 * Sites.dressHills puts trees on it (the TOP) and young pines in the garden. The physics: one triangle mesh.
 * The cave's inside (rock, garden) is drawn only from on or near the hill — from anywhere else it's all behind turf.
 */
export interface CaveMeta {
  top: { x0: number; z0: number; step: number; nx: number; nz: number; h: (number | null)[] }
  foot: { cx: number; cz: number; rx: number; rz: number }
  sky: [number, number, number]
  dark: { z1: number; r: number; top: number }
  pines: [number, number, number][]
  tufts: [number, number, number][]
  stones: [number, number, number, number, number][]
  /** the cave's floor: spots for grass tufts, and for bushes / its broken things (off the lane and the lake) */
  floorTufts?: [number, number, number][]
  floorBushes?: [number, number, number][]
  /** THE LAKE: local x, its level over the ground, local z, its half widths */
  lake?: [number, number, number, number, number]
  /** THE HAVEN's flat pad (the player's safe house / garage, later): local x, its floor, local z, half widths */
  haven?: [number, number, number, number, number]
  /** every pond (x, level, z, half widths), the second skylight (x, z, r), the trees inside (x, y, z, height) */
  lakes?: [number, number, number, number, number][]
  sky2?: [number, number, number]
  innerTrees?: [number, number, number, number][]
}
/** How many of the floor's bush spots hold the cave's BROKEN THINGS and BONES (the rest grow bushes — Sites.dressHills) */
export const CAVE_PROPS = 14

/** cave.json beside cave.glb (null: none — the desert, or the files missing). */
export async function loadCaveMeta(path: string): Promise<CaveMeta | null> {
  try { const r = await fetch(`${path}/cave.json`); return r.ok ? ((await r.json()) as CaveMeta) : null } catch { return null }
}

/** The hill's top over the ground at local (lx, lz) — bilinear on the 2 m grid; null off the hill, in its holes. */
export function caveTop(m: CaveMeta, lx: number, lz: number): number | null {
  const t = m.top, fx = (lx - t.x0) / t.step, fz = (lz - t.z0) / t.step
  const i = Math.floor(fx), j = Math.floor(fz)
  if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return null
  const a = t.h[j * t.nx + i], b = t.h[j * t.nx + i + 1], c = t.h[(j + 1) * t.nx + i], d = t.h[(j + 1) * t.nx + i + 1]
  if (a === null || b === null || c === null || d === null) return null
  const u = fx - i, v = fz - j
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Within the hill's apron (an ellipse a little past its foot), grown by `grow` m. */
export function inCaveFoot(m: CaveMeta, lx: number, lz: number, grow = 0): boolean {
  const f = m.foot
  return ((lx - f.cx) / (f.rx + grow)) ** 2 + ((lz - f.cz) / (f.rz + grow)) ** 2 < 1
}

/** A place's local frame (rot about +y, the mouth at its x, z) — world (x, z) of local (lx, lz), and back. */
export function caveFrame(l: Landmark) {
  const cr = Math.cos(l.rot), sr = Math.sin(l.rot)
  return {
    wx: (lx: number, lz: number) => l.x + lx * cr + lz * sr,
    wz: (lx: number, lz: number) => l.z - lx * sr + lz * cr,
    local: (x: number, z: number): [number, number] => { const dx = x - l.x, dz = z - l.z; return [dx * cr - dz * sr, dx * sr + dz * cr] },
  }
}

/** THE HILL'S GRASS, golden and green (2026-11-07, the user: "on the cave some green grass too — golden and green"):
 *  the land's dryness there, swung by a slow noise (~40 m) to green swales and golden rises. */
const grassDry = (dry: number, x: number, z: number) => Math.min(1, Math.max(0, 0.22 + 0.62 * dry + 0.34 * (Math.sin(x * 0.05 + Math.sin(z * 0.04) * 1.8) * Math.sin(z * 0.047 + 0.9) * 0.7 + Math.sin(x * 0.11 - z * 0.09 + 2.1) * 0.3)))
/** A soft value noise ≈ 0…1 (the hill's bare patches). */
const patch = (x: number, z: number) => 0.5 + 0.25 * Math.sin(x * 0.083 + Math.sin(z * 0.061) * 2.1) * Math.sin(z * 0.071 + 1.7) + 0.25 * Math.sin(x * 0.19 - z * 0.13 + 0.6) * Math.sin(z * 0.23 + x * 0.05)

export class CaveWorld {
  readonly group = new GFX.Group()
  /** The physics' triangle mesh (world positions, indices). */
  collider: { verts: Float32Array; idx: Uint32Array } | null = null
  private inside: GFX.Mesh[] = []
  private readonly frame: ReturnType<typeof caveFrame>

  /** THE PONDS (2026-11-07, the user: "the water must be like the outside water"): each a disc at its level in the
   *  valley's still-water shader (Water.poolMaterial) — rings out from its middle, the depth (aUV.x) ~1.6 m there,
   *  0 a little past its rim (the floor's bank takes it, the shore's soft line where it's shallow). */
  addPools(mat: GFX.ShaderMaterial): void {
    const { wx, wz } = this.frame, map = this.map!
    for (const [lx, ly, lz, rx, rz] of this.meta.lakes ?? (this.meta.lake ? [this.meta.lake] : [])) {
      const cx = wx(lx, lz), cz = wz(lx, lz), y = map.height(cx, cz) + ly
      const pos: number[] = [], uv: number[] = [], idx: number[] = [], N = 48, R = 6
      for (let r = 0; r <= R; r++) for (let k = 0; k < N; k++) {
        const t = r / R, a = (k / N) * Math.PI * 2, ex = Math.cos(a) * rx * 1.06 * t, ez = Math.sin(a) * rz * 1.06 * t
        pos.push(wx(lx + ex, lz + ez), y, wz(lx + ex, lz + ez)); uv.push(1.6 * (1 - t * t) - 0.05, 0, 0, 0)
        if (r) { const a0 = (r - 1) * N + k, a1 = (r - 1) * N + ((k + 1) % N), b0 = r * N + k, b1 = r * N + ((k + 1) % N); idx.push(a0, b0, b1, a0, b1, a1) }
      }
      const g = new GFX.BufferGeometry(), n = pos.length / 3
      g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
      g.setAttribute('aFlow', new GFX.BufferAttribute(new Float32Array(n * 2), 2))
      g.setAttribute('aUV', new GFX.Float32BufferAttribute(uv, 4))
      g.setIndex(idx); g.computeBoundingBox()
      const m = new GFX.Mesh(g, mat); m.renderOrder = 20
      this.group.add(m); this.pools.push(m)
    }
  }
  private readonly pools: GFX.Mesh[] = []
  /** the way in's rock and floor (update: seen through the mouth from in front, at any height) */
  private readonly way: GFX.Mesh[] = []
  /** the floor's and the garden's triangles (world) — grassFloor */
  private readonly floorTris: { pos: Float32Array; idx: Uint32Array }[] = []
  /** distance from (x, y, z) to the nearest wall (the cave's rock that doesn't face up), ≤ ~4 m; 1e9 farther */
  private wallAt: (x: number, y: number, z: number) => number = () => 1e9
  /** The inside drawn this frame (update): the floor's grass with it. */
  insideShown = false

  /** THE FIELD'S GRASS ON THE CAVE'S FLOOR (2026-11-07, the user: "why no grass here?"): the floor's height on the land's
   *  2 m grid (its triangles that face up, rasterised; the highest under a point), as the lift over the ground's heights
   *  (the hill's top: GPU) and over the land's (CPU — the tiles' boxes), square; and where it grows: every point whose
   *  four cells are floor — off the walls (a footprint as the rocks' is: 255 none). */
  grassFloor(map: MapData): { lift: GFX.DataTexture; cpu: Float32Array; x0: number; z0: number; n: number; foot: GFX.DataTexture } | null {
    const H = this.hold
    if (!H || !this.floorTris.length) return null
    const g = map.inner, st = g.step, N = Math.max(H.w, H.h) + 1, x0 = H.x0, z0 = H.z0, fy = new Float32Array(N * N).fill(NaN)
    for (const { pos, idx } of this.floorTris) for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
      const ny = uz * vx - ux * vz, nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx)
      if (nl < 1e-6 || Math.abs(ny) / nl < 0.8) continue
      const d = (pos[b + 2] - pos[c + 2]) * (pos[a] - pos[c]) + (pos[c] - pos[b]) * (pos[a + 2] - pos[c + 2])
      if (Math.abs(d) < 1e-9) continue
      const i0 = Math.max(0, Math.ceil((Math.min(pos[a], pos[b], pos[c]) - x0) / st)), i1 = Math.min(N - 1, Math.floor((Math.max(pos[a], pos[b], pos[c]) - x0) / st))
      const j0 = Math.max(0, Math.ceil((Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) - z0) / st)), j1 = Math.min(N - 1, Math.floor((Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) - z0) / st))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + i * st, pz = z0 + j * st
        const w1 = ((pos[b + 2] - pos[c + 2]) * (px - pos[c]) + (pos[c] - pos[b]) * (pz - pos[c + 2])) / d
        const w2 = ((pos[c + 2] - pos[a + 2]) * (px - pos[c]) + (pos[a] - pos[c]) * (pz - pos[c + 2])) / d, w3 = 1 - w1 - w2
        if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue
        const y = w1 * pos[a + 1] + w2 * pos[b + 1] + w3 * pos[c + 1], q = j * N + i
        if (!(fy[q] >= y)) fy[q] = y
      }
    }
    const lift = new Float32Array(N * N), cpu = new Float32Array(N * N), has = new Uint8Array(N * N)
    const fp = new Uint8Array(g.n * g.n).fill(255), gi0 = Math.round((x0 - g.origin) / st), gj0 = Math.round((z0 - g.origin) / st)
    let any = false
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const q = j * N + i
      if (Number.isNaN(fy[q])) continue
      const px = x0 + i * st, pz = z0 + j * st
      lift[q] = fy[q] - H.surf(px, pz); cpu[q] = fy[q] - map.height(px, pz); has[q] = 1
      const ok = i > 0 && j > 0 && i < N - 1 && j < N - 1 && [q - 1, q + 1, q - N, q + N].every((r) => !Number.isNaN(fy[r]))
      const gi = gi0 + i, gj = gj0 + j
      // (none against a wall, then thin and short, then the full carpet ~4 m out)
      if (ok && gi >= 0 && gj >= 0 && gi < g.n && gj < g.n) { const w = this.wallAt(px, fy[q] + 0.3, pz); fp[gj * g.n + gi] = Math.round(255 * (1 - Math.min(1, Math.max(0, (w - 1) / 3)))); any = true }
    }
    if (!any) return null
    // (off the floor: its nearest floor's lift, so a blade by a wall never stands halfway up the hill)
    for (let pass = 0; pass < 3; pass++) for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const q = j * N + i
      if (has[q]) continue
      for (const r of [q - 1, q + 1, q - N, q + N]) if (has[r] === 1 + pass * 0 && has[r]) { lift[q] = lift[r]; cpu[q] = cpu[r]; has[q] = 2; break }
    }
    const tex = new GFX.DataTexture(lift, N, N, GFX.RedFormat, GFX.FloatType)
    tex.minFilter = tex.magFilter = GFX.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true
    const foot = new GFX.DataTexture(fp, g.n, g.n, GFX.RedFormat, GFX.UnsignedByteType)
    foot.minFilter = GFX.LinearMipmapLinearFilter; foot.magFilter = GFX.LinearFilter; foot.generateMipmaps = true; foot.unpackAlignment = 1; foot.needsUpdate = true
    return { lift: tex, cpu, x0, z0, n: N, foot }
  }

  /** The camera is in the cave (under its hill — main / World hide the sun's glare then). */
  cameraInside = false
  private map: MapData | null = null

  private bones: GFX.Object3D | null = null
  /** the arch's points (x, y, z, … world), a third of them — the ground's rock round it (grassOn) */
  private archAll: number[] = []
  /** how much the ground's surface rose over the hill's own top at its foot (intoTerrain), per 2 m point — the collider follows */
  private footRaise: { data: Float32Array; W: number; Hh: number; x0: number; z0: number } | null = null
  private raiseAt(x: number, z: number): number {
    const R = this.footRaise
    if (!R) return 0
    const fx = (x - R.x0) / 2, fz = (z - R.z0) / 2, a = Math.floor(fx), b = Math.floor(fz)
    if (a < 0 || b < 0 || a >= R.W - 1 || b >= R.Hh - 1) return 0
    const u = fx - a, v = fz - b, d = R.data, q = b * R.W + a
    return (d[q] * (1 - u) + d[q + 1] * u) * (1 - v) + (d[q + R.W] * (1 - u) + d[q + R.W + 1] * u) * v
  }
  /** the cut's texture (Terrain.setHoles: rows Hh… the holeK) — build marks the ground under the mouth's floor in it */
  private cutTex: { tex: GFX.DataTexture; data: Float32Array; W: number; Hh: number; x0: number; z0: number } | null = null
  private mouthTurf: { pos: Float32Array; idx: Uint32Array } | null = null
  private archGeo: { pos: Float32Array; idx: Uint32Array } | null = null
  /** the ground's shader as the cave's skin (Terrain.skinMaterial) */
  private skinMat: GFX.ShaderMaterial | null = null

  private constructor(readonly site: Landmark, readonly meta: CaveMeta) { this.frame = caveFrame(site) }

  static async load(path: string, map: MapData, site: Landmark, meta: CaveMeta, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4, footprint?: GFX.DataTexture, terrain?: Terrain): Promise<CaveWorld | null> {
    try {
      const dl = (draco ??= new DRACOLoader().setDecoderPath('/draco/'))
      const [gltf, bones] = await Promise.all([
        new GLTFLoader().setDRACOLoader(dl).loadAsync(`${path}/cave.glb`),
        // (the BONES — scripts/oth/bones.py: low-poly skeletons, skulls, ribs, a femur, a hand, a foot and its toes)
        new GLTFLoader().setDRACOLoader(dl).loadAsync(`${path}/bones.glb`).catch(() => null),
      ])
      const cw = new CaveWorld(site, meta)
      cw.map = map
      cw.bones = bones?.scene ?? null
      const mat = woodMaterial(atmos, shadow, tier, farGrid), mg = map.meta.mask
      mat.uniforms.uMask.value = map.maskTex
      ;(mat.uniforms.uMaskGrid.value as GFX.Vector4).set(mg.n, mg.step, mg.origin, 1)
      // (?caveground=0: the hill its own turf mesh, as before — the A/B)
      if (terrain && gameParams().get('caveground') !== '0') cw.intoTerrain(map, terrain)
      cw.build(gltf.scene, map, mat, tier)
      cw.fireflies(map, atmos, tier)
      cw.clearGrass(map, footprint)
      return cw
    } catch (e) {
      console.warn('cave.glb: not loaded', e)
      return null
    }
  }

  private build(scene: GFX.Object3D, map: MapData, mat: GFX.ShaderMaterial, tier: Tier): void {
    const { wx, wz } = this.frame, cr = Math.cos(this.site.rot), sr = Math.sin(this.site.rot)
    const mk: [number, number, number, number] = [0, 0, 0, 0]
    const meshes: Record<string, GFX.Mesh> = {}
    scene.traverse((o) => { const m = o as GFX.Mesh; if (m.isMesh) meshes[(m.name || '').replace(/[._]\d+$/, '').toLowerCase()] = m })
    /** world positions (laid on the land) and turned normals of a part */
    const place = (m: GFX.Mesh) => {
      const P = m.geometry.getAttribute('position').array as Float32Array, N = m.geometry.getAttribute('normal')?.array as Float32Array | undefined
      const n = P.length / 3, pos = new Float32Array(P.length), nor = new Float32Array(P.length)
      for (let i = 0; i < n; i++) {
        const lx = P[i * 3], ly = P[i * 3 + 1], lz = P[i * 3 + 2], x = wx(lx, lz), z = wz(lx, lz)
        pos[i * 3] = x; pos[i * 3 + 1] = ly + map.height(x, z); pos[i * 3 + 2] = z
        if (N) { const nx = N[i * 3], nz = N[i * 3 + 2]; nor[i * 3] = nx * cr + nz * sr; nor[i * 3 + 1] = N[i * 3 + 1]; nor[i * 3 + 2] = -nx * sr + nz * cr }
      }
      const idx = m.geometry.index ? new Uint32Array(m.geometry.index.array as ArrayLike<number>) : new Uint32Array(Array.from({ length: n }, (_, k) => k))
      return { pos, nor, idx, n }
    }
    const mesh = (pos: Float32Array, nor: Float32Array, col: Float32Array, glow: Float32Array, idx: Uint32Array, welded = true) => {
      const g = new GFX.BufferGeometry()
      g.setAttribute('glow', new GFX.BufferAttribute(glow, 1))
      g.setAttribute('position', new GFX.BufferAttribute(pos, 3))
      g.setAttribute('normal', new GFX.BufferAttribute(nor, 3))
      g.setAttribute('color', new GFX.BufferAttribute(col, 3))
      g.setIndex(new GFX.BufferAttribute(idx, 1))
      g.computeBoundingBox()
      if (welded) weld.push(pos)
      const me = new GFX.Mesh(g, mat); this.group.add(me); return me
    }
    const weld: Float32Array[] = []
    /** a cave surface in THE GROUND'S SKIN (Terrain.skinMaterial): skin = (inside 0…1, the least rock 0…1) per vertex */
    const weldN = new Map<Float32Array, Float32Array>()
    /** every triangle wound to face where its vertices' normals face (the model had one the wrong way round by the mouth:
     *  culled, the sky showed through) */
    const faceOut = (pos: Float32Array, nor: Float32Array, idx: Uint32Array) => {
      const o = new Uint32Array(idx)
      for (let k = 0; k < o.length; k += 3) {
        const a = o[k] * 3, b = o[k + 1] * 3, c = o[k + 2] * 3
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
        const d = fx * (nor[a] + nor[b] + nor[c]) + fy * (nor[a + 1] + nor[b + 1] + nor[c + 1]) + fz * (nor[a + 2] + nor[b + 2] + nor[c + 2])
        if (d < 0) { const t = o[k + 1]; o[k + 1] = o[k + 2]; o[k + 2] = t }
      }
      return o
    }
    const skinIdx = new Map<Float32Array, Uint32Array>()
    const skinMesh = (pos: Float32Array, nor: Float32Array, skin: Float32Array, idx: Uint32Array, welded = true) => {
      weldN.set(pos, nor)
      { const prev = skinIdx.get(pos); if (prev) { const m = new Uint32Array(prev.length + idx.length); m.set(prev); m.set(idx, prev.length); skinIdx.set(pos, m) } else skinIdx.set(pos, idx) }
      const g = new GFX.BufferGeometry()
      g.setAttribute('position', new GFX.BufferAttribute(pos, 3))
      g.setAttribute('normal', new GFX.BufferAttribute(nor, 3))
      g.setAttribute('skin', new GFX.BufferAttribute(skin, 2))
      g.setIndex(new GFX.BufferAttribute(idx, 1))
      g.computeBoundingBox()
      if (welded) weld.push(pos)
      const me = new GFX.Mesh(g, this.skinMat!); this.group.add(me); return me
    }
    // THE ENTRANCE'S ARCH: rock — drawn as the hill's turf all bare (vCol.z > 1: the turf shader's rock fill, the cave's
    //  one rock paint), so where it meets the grass the two blend over ~2 m, broken by the shader's noise, not along
    //  the triangles' edges
    const archPts: number[] = []
    if (meshes.arch) {
      const { pos, nor, idx, n } = place(meshes.arch), col = new Float32Array(n * 3), glow = new Float32Array(n).fill(2 * SURF.turf)
      const P = meshes.arch.geometry.getAttribute('position').array as Float32Array
      for (let i = 0; i < n; i++) {
        // (its top — what faces up — the hill's grass, read from the mask as the ground's round it is; its faces rock)
        // (rock: the ground round it is rock too — grassOn, by the distance from it — and turns to grass over ~7 m)
        col[i * 3] = 0.6; col[i * 3 + 2] = 2.2
        this.archAll.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
        archPts.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
        const ly = P[i * 3 + 1], lz = P[i * 3 + 2]
        if (this.hold) pos[i * 3 + 1] -= 0 * Math.min(1, Math.max(0, (lz + 4) / 5)) * Math.min(1, Math.max(0, (1.8 - ly) / 1.2))
      }
      // (the arch ROCK — its least rock 1 — but for its last ~2.5 m down to the ground, where the ground's own band takes
      //  it over: gold streaks up its inner faces were the grass's mask read on the rock, 2026-11-07)
      if (this.skinMat) {
        this.archGeo = { pos, idx }
        const ak = new Float32Array(n * 2)
        for (let i = 0; i < n; i++) { const over = this.hold ? pos[i * 3 + 1] - this.hold.surf(pos[i * 3], pos[i * 3 + 2]) : 9; ak[i * 2 + 1] = Math.min(1, Math.max(0, (Math.abs(over) - 0.3) / 2.2)) }
        skinMesh(pos, nor, ak, idx)
      }
      else mesh(pos, nor, col, glow, idx)
    }
    const nearArch = (x: number, y: number, z: number) => {
      let best = 1e9
      for (let k = 0; k < archPts.length; k += 3) { const d = (archPts[k] - x) ** 2 + (archPts[k + 1] - y) ** 2 + (archPts[k + 2] - z) ** 2; if (d < best) best = d }
      return Math.sqrt(best)
    }
    // THE HILL: the field's grass (the land's dryness where it stands), bare rock in patches where it's steep
    if (meshes.turf) {
      const pl = place(meshes.turf), { pos, nor, n } = pl, col = new Float32Array(n * 3), glow = new Float32Array(n).fill(2 * SURF.turf)
      // THE GROUND DRAWS THE HILL (intoTerrain): a turf triangle stays only where the ground can't be its surface — round
      //  the mouth and the skylights (the cut's cells), under an overhang; elsewhere it's the terrain's own, gone here.
      //  What stays sinks a little where the ground is drawn too, so the ground covers the overlap (no fight, no crack).
      let idx = pl.idx
      const H = this.hold, toGround = new Float32Array(n)
      if (H) {
        const P = meshes.turf.geometry.getAttribute('position').array as Float32Array, keep = new Uint8Array(n)
        toGround.fill(0)
        for (let i = 0; i < n; i++) {
          const x = pos[i * 3], z = pos[i * 3 + 2], ly = P[i * 3 + 1], c = H.cell(x, z)
          // (on the ground's hill: near it — over a convex face the ground's 2 m spans lie a little under the mesh, under it
          //  where it hollows; by an opening on the land: what's under the land; elsewhere on the land beside: the apron,
          //  under ~1.5 m; an opening's rim: kept)
          const sy = H.surf(x, z), dy = pos[i * 3 + 1] - sy
          // (in a circle the cave's surface IS the hill — the ground draws only the land there; just outside it, under
          //  the ground's by a hand's breadth, so the ground wins and there's no gap; elsewhere the ground's)
          const [tlx, tlz] = this.frame.local(x, z)
          const bySky = [this.meta.sky, this.meta.sky2].some((s) => !!s && Math.hypot(tlx - s[0], tlz - s[1]) < s[2] + 16)
          const covered = bySky || (c === 1 ? dy < 1.8 && dy > -3 : c === 2 || c === 4 ? false : ly < 1.5)
          keep[i] = covered ? 0 : 1
          // (within ~6 m of a circle's edge it eases onto the ground's surface — exactly on it at the edge, a little under
          //  it past — so where one hands over to the other there's no fold; its foot a hand under the land's, so the
          //  ground drawn at the land wins there: no flicker)
          if (c === 2 || c === 4) {
            const d = H.circ(x, z), w = Math.min(1, Math.max(0, (d + 6) / 6))
            toGround[i] = w
            pos[i * 3 + 1] += (sy - 0.15 * Math.min(1, Math.max(0, d / 1.5)) - pos[i * 3 + 1]) * w
            if (ly < 0.3) pos[i * 3 + 1] -= 0.1 * (1 - w)
          }
          // (dipped at the mouth as the arch, the floor and the collider are — they stay welded: no crack of sky)
          const lz0 = P[i * 3 + 2]
          pos[i * 3 + 1] -= 0 * Math.min(1, Math.max(0, (lz0 + 4) / 5)) * Math.min(1, Math.max(0, (1.8 - ly) / 1.2))
        }
        const o: number[] = []
        for (let k = 0; k < idx.length; k += 3) if (keep[idx[k]] || keep[idx[k + 1]] || keep[idx[k + 2]]) o.push(idx[k], idx[k + 1], idx[k + 2])
        idx = new Uint32Array(o)
      }
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], z = pos[i * 3 + 2], m = map.maskAt(x, z, mk), ny = nor[i * 3 + 1]
        col[i * 3] = grassDry(m[1], x, z)
        // (its rock and its grass's colour come from the land's mask, as the terrain's — grassOn writes the hill's into it;
        //  what's left of it is the openings' rims and faces: rock where it's steep, as the ground's is)
        const [lx, lz] = this.frame.local(x, z)
        // (what's left of it — the openings' rims — paints as the ground beside it does: from the mask alone)
        void ny
        // (the arch's foot: bare rock to ~2 m, gravel and thinning grass to ~7 — the shader breaks the line up)
        // (by the arch: rock by the true distance from it, on the ground's own scale — R · 1.6 − 0.45, Bridges — as the
        //  ground round it is painted from the mask: grassOn; one band over both)
        if (!H && archPts.length && Math.hypot(lx, lz) < 24) { const d = nearArch(x, pos[i * 3 + 1], z), t = Math.min(1, d / 5.5); col[i * 3 + 2] = Math.max(col[i * 3 + 2], 1.1 * (1 - t * t * (3 - 2 * t))) }
      }
      // (the ground draws the hill: what's left by its openings in the GROUND'S OWN material — Terrain.meshMaterial)
      // (in the ground's SKIN with its own normals — as the rock beside it: one light across where they meet; the
      //  grid's normals there drew every triangle of the model's turf / rock split as a tooth)
      if (H && this.skinMat) {
        // (its normals eased as the ground's are — Terrain's grid normals, intoTerrain — the same light both sides of the
        //  circle; where it meets the rock the normals are averaged after)
        for (let i = 0; i < n; i++) {
          const [lx, lz] = this.frame.local(pos[i * 3], pos[i * 3 + 2]), t = caveTop(this.meta, lx, lz) ?? 0
          const k = this.ease(1 - Math.min(1, Math.max(0, (Math.hypot(lx, lz) - 14) / 14)), t)
          const nx = nor[i * 3] * k, ny = nor[i * 3 + 1], nz = nor[i * 3 + 2] * k, l = Math.hypot(nx, ny, nz) || 1
          nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l
          // (and at a circle's edge, the ground's own normal: one light where they meet)
          const w = toGround[i]
          if (w > 0) {
            const gn = this.hold!.normal(pos[i * 3], pos[i * 3 + 2]), a = nor[i * 3] + (gn[0] - nor[i * 3]) * w, b = nor[i * 3 + 1] + (gn[1] - nor[i * 3 + 1]) * w, c = nor[i * 3 + 2] + (gn[2] - nor[i * 3 + 2]) * w, m = Math.hypot(a, b, c) || 1
            nor[i * 3] = a / m; nor[i * 3 + 1] = b / m; nor[i * 3 + 2] = c / m
          }
        }
        idx = faceOut(pos, nor, idx)
        skinMesh(pos, nor, new Float32Array(n * 2), idx).renderOrder = 10
        this.mouthTurf = { pos, idx }
      }
      else mesh(pos, nor, col, glow, idx)
    }
    // THE CAVE INSIDE (2026-11-07, the user: "inside, most of it green and golden — only the stones like rocks — and the
    //  ground to rock transition as well"): the walls, the floor and the garden ONE turf (vCol.y −1: inside — the cave's
    //  dark on it), the walls bare rock (vCol.z 1.3), the floor green and gold — the land's dryness swung by the slow
    //  noise, the garden lusher — turning to rock over ~3 m toward the walls (by each floor vertex's distance from the
    //  nearest wall vertex: a 2 m hash), the shader's noise and gravel band breaking the line
    {
      const parts = (['rock', 'floor', 'garden'] as const).filter((k) => meshes[k]).map((k) => ({ k, ...place(meshes[k]) }))
      // (THE OUTSIDE OF THE ROCK — round 7, 2026-11-07: the model's rock where it IS the hill's surface — outcrops on its
      //  back and flanks, nothing over them — took the cave's dark and showed black on the hill: per 2 m cell the model's
      //  highest surface (every part), and a rock vertex within 1.5 m of it is outside: no dark, lit as the ground)
      const hiCell = new Map<number, number>(), cellK = (x: number, z: number) => Math.floor(x / 2) * 100003 + Math.floor(z / 2)
      const turfP = meshes.turf ? place(meshes.turf).pos : new Float32Array(0)
      for (const arr of [turfP, ...parts.map((q) => q.pos)]) for (let i = 0; i < arr.length; i += 3) {
        const k = cellK(arr[i], arr[i + 2]), y = arr[i + 1]
        if (!(hiCell.get(k)! >= y)) hiCell.set(k, y)
      }
      const outside = (x: number, y: number, z: number) => {
        let m = -1e9
        for (const dx of [-2, 0, 2]) for (const dz of [-2, 0, 2]) { const v = hiCell.get(cellK(x + dx, z + dz)); if (v !== undefined && v > m) m = v }
        return y > m - 1.5
      }
      // (2026-11-07, round 2 — the user: "the transition to rock is so sudden … inside, the same": the floor turns to
      //  rock over ~4 m toward the walls — by each floor point's distance from the nearest wall — the soil and the
      //  gravel band between, as the terrain's)
      const rockQ = parts.find((q) => q.k === 'rock')
      const wallCells = new Map<string, number[]>()
      if (rockQ) for (let i = 0; i < rockQ.n; i++) {
        if (rockQ.nor[i * 3 + 1] > 0.55) continue
        const x = rockQ.pos[i * 3], y = rockQ.pos[i * 3 + 1], z = rockQ.pos[i * 3 + 2], key = `${Math.floor(x / 2)},${Math.floor(y / 2)},${Math.floor(z / 2)}`
        const l = wallCells.get(key); if (l) l.push(x, y, z); else wallCells.set(key, [x, y, z])
      }
      this.wallAt = (x, y, z) => {
        let b = 1e9
        const cx = Math.floor(x / 2), cy = Math.floor(y / 2), cz = Math.floor(z / 2)
        for (let a = -2; a <= 2; a++) for (let c = -1; c <= 2; c++) for (let e = -2; e <= 2; e++) {
          const l = wallCells.get(`${cx + a},${cy + c},${cz + e}`)
          if (l) for (let k = 0; k < l.length; k += 3) { const d = (l[k] - x) ** 2 + (l[k + 1] - y) ** 2 + (l[k + 2] - z) ** 2; if (d < b) b = d }
        }
        return Math.sqrt(b)
      }
      for (const q of parts) {
        // (round 7: by a skylight the rock never stands above the ground's surface — its rim's shards stuck up through it)
        if (this.hold && q.k === 'rock') for (let i = 0; i < q.n; i++) {
          const x = q.pos[i * 3], z = q.pos[i * 3 + 2], [lx, lz] = this.frame.local(x, z)
          if (![this.meta.sky, this.meta.sky2].some((s) => !!s && Math.hypot(lx - s[0], lz - s[1]) < s[2] + 12)) continue
          q.pos[i * 3 + 1] = Math.min(q.pos[i * 3 + 1], this.hold.surf(x, z) - 0.08)
        }
        const col = new Float32Array(q.n * 3), glow = new Float32Array(q.n).fill(2 * SURF.turf)
        for (let i = 0; i < q.n; i++) {
          const x = q.pos[i * 3], y = q.pos[i * 3 + 1], z = q.pos[i * 3 + 2], dry = grassDry(map.maskAt(x, z, mk)[1], x, z)
          const lz = meshes[q.k].geometry.getAttribute('position').array[i * 3 + 2] as number
          col[i * 3] = q.k === 'garden' ? 0.2 + dry * 0.4 : 0.15 + dry * 0.75
          col[i * 3 + 1] = q.k === 'garden' ? -1 : -Math.min(1, Math.max(0, (-lz - 1) / 10))
          // (up a skylight's shaft the dark fades out over its top ~9 m — its lip lit as the hill's top beside it: the
          //  dark lip against the bright top drew every triangle of the rim as a tooth, 2026-11-07)
          if (q.k !== 'garden') {
            const LP = meshes[q.k].geometry.getAttribute('position').array as Float32Array, lx = LP[i * 3], ly = LP[i * 3 + 1]
            for (const sk of [this.meta.sky, this.meta.sky2]) {
              if (!sk) continue
              const dx = lx - sk[0], dz = lz - sk[1], d = Math.hypot(dx, dz)
              if (d > sk[2] + 12) continue
              const k = (sk[2] + 3) / Math.max(d, 0.01), rim = caveTop(this.meta, sk[0] + dx * k, sk[1] + dz * k)
              if (rim !== null) col[i * 3 + 1] = -Math.min(-col[i * 3 + 1], Math.min(1, Math.max(0, (rim - ly - 1.5) / 9)))
            }
          }
          if (this.hold && q.k !== 'garden') q.pos[i * 3 + 1] -= 0 * Math.min(1, Math.max(0, (lz + 4) / 5)) * Math.min(1, Math.max(0, (1.8 - (meshes[q.k].geometry.getAttribute('position').array[i * 3 + 1] as number)) / 1.2))
          // (2026-11-07, the user: "inside more green — like 60 % grass — a proper transition to rocks, grass on the side
          //  walls too": what faces up grows grass, the walls rock with grass and moss in patches, the roof rock; the
          //  shader's gravel band between)
          // (the shader decides per pixel from the surface's slope; this is each part's CAP: the garden grass, the floor
          //  mostly grass, the walls free to go bare)
          void y
          // (2026-11-07, the user: "inside, the wall — the real rock texture, no black random lines": the walls, the roof,
          //  the ledges and the boulders all rock — their tops' grass strips drew the lines)
          col[i * 3 + 2] = q.k === 'garden' ? 0 : q.k === 'floor' ? 0.3 + 0.95 * (1 - Math.min(1, this.wallAt(x, y + 0.3, z) / 4.5)) ** 1.5 : 2.0
          // (THE MOUTH'S OUTER ROCK — the walls where they come out of the hill's face, round the arch — 2026-11-07, the
          //  user: "pointy patches, sticker-like, no transition at the bottom": where it meets the ground's surface it
          //  paints from the mask as the ground does, and the ground round it turns to rock by its distance from it
          //  (grassOn: one band over both, never the mesh's edge)
          if (q.k === 'rock' && this.hold && lz > -10) {
            const over = Math.abs(y - this.hold.surf(x, z))
            col[i * 3 + 2] = Math.min(col[i * 3 + 2], 2.0 * Math.min(1, Math.max(0, (over - 0.3) / 2.2)))
            if (lz > -4 && over < 3 && i % 2 === 0) this.archAll.push(x, y, z)
          }
        }
        // (THE WAY IN — the triangles of its first ~30 m — a mesh of its own: it's what shows through the mouth from in
        //  front at any height, the rest only from near; 2026-11-07, abq caveAbove: the whole inside from the air cost)
        const L = meshes[q.k].geometry.getAttribute('position').array as Float32Array, rest: number[] = [], way: number[] = []
        // (and THE SKYLIGHTS' SHAFTS — their walls, the garden under them — with the way in: seen down them from above,
        //  at any distance; hidden with the rest of the inside they left the opening empty — white — 2026-11-07)
        const inShaft = (a: number) => [this.meta.sky, this.meta.sky2].some((sk) => !!sk && Math.hypot(L[a * 3] - sk[0], L[a * 3 + 2] - sk[1]) < sk[2] + 14)
        for (let k = 0; k < q.idx.length; k += 3) {
          const a = q.idx[k], b = q.idx[k + 1], c = q.idx[k + 2]
          ;(Math.max(L[a * 3 + 2], L[b * 3 + 2], L[c * 3 + 2]) > -30 || inShaft(a) || inShaft(b) || inShaft(c) ? way : rest).push(a, b, c)
        }
        if (this.skinMat) {
          // (the skin's per vertex: how far in — the cave's dark — and the least rock: the walls inside all rock, easing
          //  to the mask's by the mouth; the floor's by the walls, ~4 m — wallAt)
          const sk = new Float32Array(q.n * 2)
          for (let i = 0; i < q.n; i++) {
            const inK = q.k === 'rock' && outside(q.pos[i * 3], q.pos[i * 3 + 1], q.pos[i * 3 + 2]) ? 0 : -col[i * 3 + 1]
            sk[i * 2] = inK
            // (the walls rock all the way up a shaft — only the mouth's face takes the mask's; the dark is what fades by a rim)
            const mouthK = Math.min(1, Math.max(0, (-(meshes[q.k].geometry.getAttribute('position').array[i * 3 + 2] as number) - 1) / 10))
            // (the mouth's walls rock too but for their last ~2.5 m down to the ground — a gold outline round the passage was
            //  the grass's mask read on them)
            const overG = this.hold ? q.pos[i * 3 + 1] - this.hold.surf(q.pos[i * 3], q.pos[i * 3 + 2]) : 9
            sk[i * 2 + 1] = q.k === 'rock' ? Math.max(mouthK, Math.min(1, Math.max(0, (Math.abs(overG) - 0.3) / 2.2))) : q.k === 'floor' ? Math.min(1, Math.max(0, (col[i * 3 + 2] - 0.3) / 0.95)) : 0
          }
          // (the floor faces up: a vertex normal there pointing down drew a dark speck — 2026-11-08, the user's marks)
          if (q.k === 'floor') for (let i = 0; i < q.n; i++) if (q.nor[i * 3 + 1] < 0.3) { const nx = q.nor[i * 3] * 0.3, nz = q.nor[i * 3 + 2] * 0.3, l = Math.hypot(nx, 1, nz); q.nor[i * 3] = nx / l; q.nor[i * 3 + 1] = 1 / l; q.nor[i * 3 + 2] = nz / l }
          const fo = (a: number[]) => q.k === 'floor' ? faceOut(q.pos, q.nor, new Uint32Array(a)) : new Uint32Array(a)
          this.inside.push(skinMesh(q.pos, q.nor, sk, fo(rest)))
          if (way.length) this.way.push(skinMesh(q.pos, q.nor, sk, fo(way), false))
        } else {
          this.inside.push(mesh(q.pos, q.nor, col, glow, new Uint32Array(rest)))
          if (way.length) this.way.push(mesh(q.pos, q.nor, col, glow, new Uint32Array(way), false))
        }
        if (q.k !== 'rock') this.floorTris.push({ pos: q.pos, idx: q.idx })
        // THE GROUND MEETS THE CAVE'S FLOOR AT THE MOUTH (2026-11-07, round 3 — the user: "why is this terrain sheet showing
        //  here"; "the cut is more visible"; "two patches as cuts"): the floor stands ≥ 0.3 m over the land, and every way
        //  of cutting or dipping left a slab, a lip or a hole. Now the GROUND is raised to it: under the floor (and the
        //  cave's low turf) in the mouth's circle the ground lies just under that surface — hidden by it — and in front it
        //  ramps up to the floor's edge over ~10 m (the heights the GPU draws AND the land's own: the physics' ground, the
        //  things placed after, map.height). One surface the car drives from the field into the cave.
        const C = this.cutTex, Hd = this.hold
        if (C && Hd && q.k === 'floor') {
          const g = map.inner, n = g.n, raw = g.tex.image.data as Uint16Array, nb = g.normalTex.image.data as Uint8Array
          const gi0 = Math.round((C.x0 - g.origin) / 2), gj0 = Math.round((C.z0 - g.origin) / 2), W = C.W, Hh = C.Hh
          const fy = new Float32Array(W * Hh).fill(NaN), LPf = meshes.floor.geometry.getAttribute('position').array as Float32Array
          const surfs: [Float32Array, Uint32Array, Float32Array | null][] = [[q.pos, q.idx, LPf]]
          if (this.mouthTurf) surfs.push([this.mouthTurf.pos, this.mouthTurf.idx, null])
          for (const [P, I, LP] of surfs) for (let k = 0; k < I.length; k += 3) {
            const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3
            if (LP && Math.max(LP[a + 2], LP[b + 2], LP[c + 2]) < -40) continue
            const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
            const ny = uz * vx - ux * vz, nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx)
            if (nl < 1e-9 || Math.abs(ny) / nl < 0.55) continue
            if (!LP && (Hd.circ(P[a], P[a + 2]) > 0 || P[a + 1] - map.height(P[a], P[a + 2]) > 3)) continue
            const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2])
            if (Math.abs(d) < 1e-9) continue
            const i0 = Math.ceil((Math.min(P[a], P[b], P[c]) - C.x0) / 2), i1 = Math.floor((Math.max(P[a], P[b], P[c]) - C.x0) / 2)
            const j0 = Math.ceil((Math.min(P[a + 2], P[b + 2], P[c + 2]) - C.z0) / 2), j1 = Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - C.z0) / 2)
            for (let j = Math.max(0, j0); j <= Math.min(Hh - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) {
              const px = C.x0 + i * 2, pz = C.z0 + j * 2
              const w1 = ((P[b + 2] - P[c + 2]) * (px - P[c]) + (P[c] - P[b]) * (pz - P[c + 2])) / d, w2 = ((P[c + 2] - P[a + 2]) * (px - P[c]) + (P[a] - P[c]) * (pz - P[c + 2])) / d, w3 = 1 - w1 - w2
              if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue
              const y = w1 * P[a + 1] + w2 * P[b + 1] + w3 * P[c + 1], qq = j * W + i
              if (!(fy[qq] <= y)) fy[qq] = Number.isNaN(fy[qq]) ? y : Math.max(fy[qq], y)
            }
          }
          const tgt = new Float32Array(W * Hh).fill(NaN), sc = 65535 / g.g.range, done: number[] = []
          const set = (i: number, j: number, h: number, under: boolean) => {
            const k = (gj0 + j) * n + gi0 + i
            g.h[k] = h; raw[k] = Math.min(65535, Math.max(0, Math.round((h - g.g.min) * sc)))
            // (the cut keeps the ground to 0.3 m over this: under the floor, nothing over the floor itself — no sliver of a
            //  ground triangle climbing to the hill's top by the walls)
            C.data[j * W + i] = under ? h - 0.33 : h
            if (under) Hd.bare.push(k)
            done.push(i, j)
          }
          // under the surface (well inside the circle: a ground triangle reaching its edge is still cut there)
          for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
            const qq = j * W + i, px = C.x0 + i * 2, pz = C.z0 + j * 2, land = g.h[(gj0 + j) * n + gi0 + i]
            if (Number.isNaN(fy[qq]) || Hd.circ(px, pz) > -3 || fy[qq] < land - 0.6) continue
            tgt[qq] = fy[qq]
          }
          // in front: up to the surface's edge — level for 3 m, then down to the land over 8
          for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
            const qq = j * W + i
            if (!Number.isNaN(tgt[qq])) continue
            const px = C.x0 + i * 2, pz = C.z0 + j * 2, [lx, lz] = this.frame.local(px, pz), land = g.h[(gj0 + j) * n + gi0 + i]
            if (lz < -2 || Math.abs(lx) > 30 || Hd.surf(px, pz) - land > 0.05) continue
            let bd = 1e9, by = 0
            for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
              const r = (j + dj) * W + i + di
              if (j + dj < 0 || i + di < 0 || j + dj >= Hh || i + di >= W || Number.isNaN(tgt[r])) continue
              const dd = Math.hypot(di, dj) * 2
              if (dd < bd) { bd = dd; by = tgt[r] }
            }
            if (bd > 11) continue
            const t = Math.min(1, Math.max(0, (bd - 3) / 8)), s2 = 1 - t * t * (3 - 2 * t), h = land + Math.max(0, by - 0.06 - land) * s2
            if (h > land + 0.01) set(i, j, h, false)
          }
          for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) { const v = tgt[j * W + i]; if (!Number.isNaN(v)) set(i, j, v - 0.12, true) }
          // the normals round what moved, from the heights drawn
          const gh = (k: number) => raw[k] / sc + g.g.min
          for (let p = 0; p < done.length; p += 2) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const k = (gj0 + done[p + 1] + dj) * n + gi0 + done[p] + di
            const dx = (gh(k + 1) - gh(k - 1)) / 4, dz = (gh(k + n) - gh(k - n)) / 4, inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz)
            nb[k * 2] = Math.round((-dx * inv * 0.5 + 0.5) * 255); nb[k * 2 + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255)
          }
          g.tex.needsUpdate = true; g.normalTex.needsUpdate = true
          C.tex.needsUpdate = true
        }
      }
    }
    // THE SKYLIGHTS' SKIRTS (round 7): the ground ends at a smooth contour round each hole (holeK 0.3 — Terrain's cut);
    //  the shaft's rock below doesn't always reach up to it, so a ring of rock goes from the ground's edge down ~12 m
    //  into the shaft along that very contour — the ground and the shaft always meet: no slit of sky, no lid
    if (this.hold && this.skinMat) {
      const H = this.hold
      for (const sk of [this.meta.sky, this.meta.sky2]) {
        if (!sk) continue
        const A = 128, R = 7, sp: number[] = [], sn: number[] = [], ss: number[] = [], si: number[] = []
        const cx = wx(sk[0], sk[1]), cz = wz(sk[0], sk[1])
        for (let a = 0; a < A; a++) {
          const t = (a / A) * Math.PI * 2, dx = Math.cos(t), dz = Math.sin(t)
          // (out from the middle to the cut's contour)
          let r = 0.5
          while (r < sk[2] + 12 && H.holeK(cx + dx * r, cz + dz * r) < 0.3) r += 0.1
          const ex = cx + dx * r, ez = cz + dz * r, top = H.surf(ex, ez) + 0.05
          for (let k = 0; k < R; k++) {
            const f = k / (R - 1), y = top - 12 * f * f, rr = r - 0.6 * f // (leaning a little in as it goes down)
            sp.push(cx + dx * rr, y, cz + dz * rr); sn.push(-dx, 0.15, -dz); ss.push(Math.min(1, f * 1.5), 1)
            if (a > 0 && k > 0) { const p = a * R + k, q = (a - 1) * R + k; si.push(q - 1, p - 1, p, q - 1, p, q) }
          }
        }
        for (let k = 1; k < R; k++) { const p = k, q = (A - 1) * R + k; si.push(q - 1, p - 1, p, q - 1, p, q) }
        const P = new Float32Array(sp), N = new Float32Array(sn)
        const sm = skinMesh(P, N, new Float32Array(ss), faceOut(P, N, new Uint32Array(si)), false)
        const two = this.skinMat.clone() as GFX.ShaderMaterial; two.side = GFX.DoubleSide; sm.material = two // (seen from below the lip too)
        this.way.push(sm)
      }
    }
    // (THE PONDS — the user: "a small lake": the valley's own water, addPools)
    // ROCKS OVER THE MOUTH'S SEAMS (2026-11-08, the user: "add rocks so the issues won't show; use rock to fix the hollow
    //  space"): along every open edge by the mouth — the floor meeting the walls, the cave's turf meeting the ground — and
    //  round the arch's foot, half-sunk boulders in THE GROUND'S OWN SKIN (the terrain's rock, its relief, its light: they
    //  read as the rock round them), one every ~1.7 m, never on the car's lane; in the collider too
    const seamRocks: { pos: Float32Array; idx: Uint32Array } | null = (() => {
      if (!this.hold || !this.skinMat) return null
      let rs = 0x5eed1
      const rnd = () => ((rs = (Math.imul(rs ^ (rs >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
      const H = this.hold
      // (ONLY at the marked spots — 2026-11-08, the user: "not a single one on the correct spot": the places picked off
      //  the screen with a ray onto the drawn ground (local lx, lz, size): the flap at the mouth's left foot, the flat
      //  patch to its right, the right-hand run of the line before the mouth; the car's way through left clear)
      // (2026-11-08, the user: "bigger, lying FLAT rocks of different shapes — not many small round ones; make sure it's
      //  covered"): a few broad slabs, each long and wide enough to cover its whole marked patch — local lx, lz of the
      //  middle, length, width, turn (°)
      const SLABS: [number, number, number, number, number, number?][] = [
        // the left wall's jagged foot jutting out before the arch (up to ~2.4 m over the ground): ONE big boulder round it,
        //  tall enough to swallow it whole (the user: "make sure no part is pushed outside")
        [-5.0, 6.0, 7.4, 5.2, 90, 2.9],
        [11.8, 5.6, 6.0, 3.8, -15], [13.8, 7.8, 3.6, 2.4, 40], // the flat patch to its right
        [7.4, 8.5, 4.6, 2.3, 6], // the line's right-hand run before the mouth (the car's way left clear)
        // the line across the front (2026-11-08, the user's mark): on the car's way LOW — 10 cm, it rolls over them
        // (taller — the user: "a bit more height so it covers the step between the terrain and the cave"; on the lane 22 cm)
        // (round 2 — "more height, and a bit toward the mouth": 2 m closer, ~0.9 m tall beside the lane, 0.3 on it)
        [-6.5, 8.8, 4.8, 3.0, 10, 0.9], [-1.6, 9.0, 4.6, 3.0, -4, 0.45], [2.6, 9.2, 4.4, 3.0, 8, 0.45], [6.6, 9.0, 4.8, 3.0, -6, 0.9], [11.6, 8.8, 4.8, 3.0, 12, 0.9], [16.6, 8.6, 5.2, 3.2, -10, 0.8], [16.4, 11.0, 4.6, 2.8, 20, 0.7], // (and the sliver of sky under the right end)
      ]
      // A RING OF FLAT STONES ROUND EACH SKYLIGHT (2026-11-08, the user: "on top, flat rock round the whole opening"):
      //  overlapping, along the lip — over its jagged edge, a little over the hole — the hill's rock
      for (const sk of [this.meta.sky, this.meta.sky2]) {
        if (!sk) continue
        const R = sk[2] + 1.6, N = Math.max(7, Math.round((2 * Math.PI * R) / 3.4))
        for (let q = 0; q < N; q++) {
          const t = ((q + 0.3 * rnd()) / N) * Math.PI * 2, rr = R + (rnd() - 0.4) * 1.2
          SLABS.push([sk[0] + Math.cos(t) * rr, sk[1] + Math.sin(t) * rr, ((2 * Math.PI * R) / N) * (1.5 + 0.4 * rnd()), 3.6 + 1.4 * rnd(), (-(t + Math.PI / 2) * 180) / Math.PI + (rnd() - 0.5) * 20, 0.55 + 0.35 * rnd()])
        }
      }
      const tops = [...this.floorTris.map((t) => t.pos), ...(this.mouthTurf ? [this.mouthTurf.pos] : []), new Float32Array(this.archAll)]
      // the template: an icosahedron, each face split in four (42 points, 80 faces), drawn FLAT — an angular slab
      const t = (1 + Math.sqrt(5)) / 2, V0: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return p.map((c) => c / l) })
      let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
      const mid = new Map<string, number>(), m = (a: number, b: number) => { const id = a < b ? a + ',' + b : b + ',' + a; let r = mid.get(id); if (r === undefined) { const p = [0, 1, 2].map((c) => V0[a][c] + V0[b][c]), l = Math.hypot(p[0], p[1], p[2]); r = V0.push(p.map((c) => c / l)) - 1; mid.set(id, r) } return r }
      F = F.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] })
      const pos: number[] = [], nor: number[] = [], skin: number[] = [], idx: number[] = [], placed: number[] = []
      for (const [lx, lz, len, wid, deg, thin] of SLABS) {
        const x = this.frame.wx(lx, lz), z = this.frame.wz(lx, lz)
        placed.push(x, z)
        // ROUNDED, LYING ON THE GROUND (2026-11-08, the user: "rounded, matching the shapes, not pointy"): a flattened
        //  pebble — smooth normals, a soft irregular outline — DRAPED on the surface under it point by point (the ground,
        //  raised by the ramp; the cave's turf / floor where it stands over that), two thirds sunk
        const sx = len / 2, sy = thin ?? 0.3 + 0.1 * rnd(), sz2 = wid / 2, a = this.site.rot + (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), s1 = rnd() * 6.283, s2 = rnd() * 6.283
        const inK = Math.min(1, Math.max(0, (-lz - 1) / 10))
        const ground = (px: number, pz: number) => {
          // (the ground only — draped over the model's own bits it bulged out over them)
          void tops
          return Math.max(map.height(px, pz), H.surf(px, pz))
        }
        const P: number[][] = V0.map((v) => {
          const th = Math.atan2(v[2], v[0]), d = 1 + 0.14 * Math.sin(2 * th + s1) + 0.07 * Math.sin(3 * th + s2)
          const px = v[0] * sx * d, pz = v[2] * sz2 * d, wxp = x + px * ca + pz * sa, wzp = z - px * sa + pz * ca
          return [wxp, ground(wxp, wzp) + v[1] * sy + sy * 0.15, wzp]
        })
        const N = V0.map(() => [0, 0, 0])
        for (const [i, j, l] of F) {
          const u = [0, 1, 2].map((c) => P[j][c] - P[i][c]), w = [0, 1, 2].map((c) => P[l][c] - P[i][c])
          const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
          for (const q of [i, j, l]) for (let c = 0; c < 3; c++) N[q][c] += n[c]
        }
        const base = pos.length / 3
        // (NO DARK RIM — 2026-11-08, the user: "remove the dark border of each rock": the lower half faced down and was
        //  shaded as an underside; its light turned up toward the sky as the ground's beside it, from the waist down)
        P.forEach((p, i) => {
          const n = N[i], l = Math.hypot(n[0], n[1], n[2]) || 1, up = Math.min(1, Math.max(0, (0.45 - V0[i][1]) / 0.6))
          const nx = (n[0] / l) * (1 - up), ny = (n[1] / l) * (1 - up) + up, nz = (n[2] / l) * (1 - up), m2 = Math.hypot(nx, ny, nz) || 1
          pos.push(p[0], p[1], p[2]); nor.push(nx / m2, ny / m2, nz / m2); skin.push(inK, 1)
        })
        for (const [i, j, l] of F) idx.push(base + i, base + j, base + l)
      }
      if (!idx.length) return null
      const Pp = new Float32Array(pos), Nn = new Float32Array(nor), I = faceOut(Pp, Nn, new Uint32Array(idx))
      skinMesh(Pp, Nn, new Float32Array(skin), I, false)
      console.info(`cave: ${placed.length / 2} rocks over the mouth's seams`)
      return { pos: Pp, idx: I }
    })()
    // THE COLLIDER
    if (meshes.collider) {
      const { pos, idx, n } = place(meshes.collider)
      {
        const P = meshes.collider.geometry.getAttribute('position').array as Float32Array
        for (let i = 0; i < n; i++) {
          const r = this.raiseAt(pos[i * 3], pos[i * 3 + 2])
          if (r < 0.02) continue
          const t = caveTop(this.meta, P[i * 3], P[i * 3 + 2])
          if (t !== null && Math.abs(P[i * 3 + 1] - t) < 1.5) pos[i * 3 + 1] += r
        }
      }
      // (dipped at the mouth as the floor is drawn — else the car rode a lip half a metre over what's seen, and jumped)
      if (this.hold) { const P = meshes.collider.geometry.getAttribute('position').array as Float32Array; for (let i = 0; i < n; i++) { const ly = P[i * 3 + 1], lz = P[i * 3 + 2]; pos[i * 3 + 1] -= 0 * Math.min(1, Math.max(0, (lz + 4) / 5)) * Math.min(1, Math.max(0, (1.8 - ly) / 1.2)) } }
      this.collider = { verts: pos, idx }
      // THE HILL'S OUTSIDE IN THE PHYSICS AS DRAWN (2026-11-08, the user: "remove these hidden colliders"): the model's
      //  decimated outer skin stood up to ~half a metre off the ground the terrain draws over it — the car hit bumps it
      //  couldn't see. Where the ground draws the hill (its cells, away from the openings), the model's upward-facing
      //  outer triangles go; the drawn surface itself (the ground's 2 m grid, its heights) goes in instead
      const H = this.hold
      if (H) {
        // (every collider point near the drawn ground, outside the openings, pressed down onto it — the rest of the
        //  model's skin standing over it, at the foot and the rims, was what the car hit)
        {
          const sd = (x: number, z: number) => { const [lx, lz] = this.frame.local(x, z); return Math.min(...[this.meta.sky, this.meta.sky2].filter((s): s is [number, number, number] => !!s).map((s) => Math.hypot(lx - s[0], lz - s[1]) - s[2])) }
          for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i], z = pos[i + 2], sy = Math.max(H.surf(x, z), map.height(x, z)), d = pos[i + 1] - sy
            if (d > 0 && d < 3 && H.circ(x, z) > 1 && sd(x, z) > 0.5) pos[i + 1] = sy - 0.02
          }
        }
        const keep: number[] = [], P = meshes.collider.geometry.getAttribute('position').array as Float32Array
        const skyD = (x: number, z: number) => { const [lx, lz] = this.frame.local(x, z); return Math.min(...[this.meta.sky, this.meta.sky2].filter((s): s is [number, number, number] => !!s).map((s) => Math.hypot(lx - s[0], lz - s[1]) - s[2])) }
        const drawn = (x: number, z: number) => H.cell(x, z) === 1 && H.circ(x, z) > 2 && skyD(x, z) > 5
        for (let k = 0; k < idx.length; k += 3) {
          // (outer: its middle where the ground draws the hill or the land — away from the mouth and the skylights — and
          //  every corner within 3.5 m of that ground: the cave's floors and roofs inside lie far under it)
          const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3, mx = (pos[a] + pos[b] + pos[c]) / 3, mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3
          let outer = H.cell(mx, mz) !== 2 && H.cell(mx, mz) !== 4 && H.circ(mx, mz) > 2 && skyD(mx, mz) > 5
          for (let e = 0; e < 3 && outer; e++) {
            const v = idx[k + e] * 3, x = pos[v], z = pos[v + 2]
            outer = Math.abs(pos[v + 1] - Math.max(H.surf(x, z), map.height(x, z))) < 3.5
          }
          void P
          if (!outer) keep.push(idx[k], idx[k + 1], idx[k + 2])
        }
        const sv: number[] = [], si: number[] = []
        for (let j = 0; j < H.h; j++) for (let i = 0; i < H.w; i++) {
          const x = H.x0 + i * 2, z = H.z0 + j * 2
          if (H.k[j * H.w + i] !== 1 || !drawn(x + 1, z + 1)) continue
          const b = pos.length / 3 + sv.length / 3
          for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) sv.push(x + dx, H.surf(x + dx, z + dz), z + dz)
          si.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
        }
        // THE MOUTH IN THE PHYSICS AS DRAWN: within ~28 m of it the decimated collider bulged up to 2 m out over the
        //  sharp rock at its feet (the car tipped on nothing) — there the drawn way in (rock, floor), the arch and the
        //  turf by the mouth are the collider, triangle for triangle
        const inMouth = (x: number, z: number) => { const [lx, lz] = this.frame.local(x, z); return (lz > -28 && Math.hypot(lx, lz) < 48) || skyD(x, z) < 12 }
        const keep2: number[] = []
        for (let k = 0; k < keep.length; k += 3) {
          const a = keep[k] * 3, b = keep[k + 1] * 3, c = keep[k + 2] * 3
          if (!inMouth((pos[a] + pos[b] + pos[c]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3)) keep2.push(keep[k], keep[k + 1], keep[k + 2])
        }
        const mv: number[] = [], mi: number[] = [], base0 = (pos.length + sv.length) / 3
        const add = (P: ArrayLike<number>, I: ArrayLike<number>) => {
          const o = base0 + mv.length / 3
          for (let k = 0; k < P.length; k++) mv.push(P[k])
          for (let k = 0; k < I.length; k += 3) {
            const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3
            if (inMouth((P[a] + P[b] + P[c]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3)) mi.push(I[k] + o, I[k + 1] + o, I[k + 2] + o)
          }
        }
        for (const m of this.way) { const ix = m.geometry.index; if (ix) add(m.geometry.getAttribute('position').array as Float32Array, ix.array as ArrayLike<number>) }
        if (this.archGeo) add(this.archGeo.pos, this.archGeo.idx)
        if (this.mouthTurf) add(this.mouthTurf.pos, this.mouthTurf.idx)
        const v2 = new Float32Array(pos.length + sv.length + mv.length); v2.set(pos); v2.set(sv, pos.length); v2.set(mv, pos.length + sv.length)
        this.collider = { verts: v2, idx: new Uint32Array([...keep2, ...si, ...mi]) }
        console.info(`cave: collider — ${(idx.length - keep.length) / 3} outer triangles swapped for ${si.length / 3} of the drawn ground`)
      }
      const pos2 = this.collider.verts, idx2 = this.collider.idx
      // (the seams' rocks in it: the car meets them, never drives through)
      if (seamRocks) {
        const v = new Float32Array(pos2.length + seamRocks.pos.length); v.set(pos2); v.set(seamRocks.pos, pos2.length)
        const ii = new Uint32Array(idx2.length + seamRocks.idx.length); ii.set(idx2); const o = pos2.length / 3
        for (let k = 0; k < seamRocks.idx.length; k++) ii[idx2.length + k] = seamRocks.idx[k] + o
        this.collider = { verts: v, idx: ii }
      }
    }
    // GRASS TUFTS on the hill (one per 2 m cell, thinned on the low tiers) and in the garden
    const b = new Builder(0xcafe), tp: number[] = [], tn: number[] = [], tc: number[] = [], ti: number[] = []
    // (what lies OUTSIDE — the stones on the way, the bones before the mouth — its own small mesh, always drawn: the
    //  inside's is hidden away from it)
    const ob = new Builder(0xbeef)
    let s = 0x2545f491
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const tuft = (x: number, y: number, z: number, h: number, dry: number, inside = false) => {
      for (let q = 0; q < 4; q++) {
        const ang = rnd() * 6.283, w = 0.07 + 0.05 * rnd(), hh = h * (0.7 + 0.5 * rnd()), lx = (rnd() - 0.5) * 0.5 * hh, lz = (rnd() - 0.5) * 0.5 * hh
        const ox = (rnd() - 0.5) * 0.4, oz = (rnd() - 0.5) * 0.4, ux = Math.cos(ang) * w, uz = Math.sin(ang) * w, base = tp.length / 3
        tp.push(x + ox - ux, y - 0.05, z + oz - uz, x + ox + ux, y - 0.05, z + oz + uz, x + ox + lx, y + hh, z + oz + lz)
        for (let v = 0; v < 3; v++) { tn.push(0, 1, 0); tc.push(dry, inside ? -1 : 0, v < 2 ? -0.1 : -1) }
        ti.push(base, base + 1, base + 2, base, base + 2, base + 1)
      }
    }
    // (no tufts on the hill any more: the field's own grass grows on it — Grass.setHill)
    void tier
    // (2026-11-07 — the user: "cuts … inside a lot of these": the hand-made tufts stood on the walls' rock band; the
    //  field's own grass grows on the floor and the garden now — Grass, `cave`)
    const oldTufts = gameParams().get('cavegrass') === '0'
    if (oldTufts) for (const [lx, ly, lz] of this.meta.tufts) { const x = wx(lx, lz), z = wz(lx, lz); tuft(x, ly + map.height(x, z), z, 0.35 + 0.4 * rnd(), 0.2 + map.maskAt(x, z, mk)[1] * 0.4, true) }
    // (and over the cave's floor — golden and green, thinner on the low tiers)
    const fk = tier.name === 'low' ? 0.35 : tier.name === 'medium' ? 0.6 : 1
    for (const [lx, ly, lz] of oldTufts ? this.meta.floorTufts ?? [] : []) {
      if (rnd() > fk) continue
      const x = wx(lx, lz), z = wz(lx, lz)
      tuft(x, ly + map.height(x, z), z, 0.3 + 0.45 * rnd(), 0.15 + grassDry(map.maskAt(x, z, mk)[1], x, z) * 0.75, true)
    }
    b.setSurf(SURF.turf); b.raw(tp, tn, tc, ti)
    // STONES on the way to it: rounded, half sunk — the cave's one rock (SURF.cliff), not the props' stone
    ob.setSurf(SURF.cliff)
    this.meta.stones.forEach(([lx, ly, lz, sz, rot], k) => {
      const x = wx(lx, lz), z = wz(lx, lz)
      // (the land's rock grey, not white — 2026-11-07, the user)
      // (Kit.rock paints them SURF.stone — linear albedo: the field's rocks' ~0.17 grey, never 0.5: that read white)
      const k2 = 0.15 + 0.05 * rnd()
      rock(ob, V(x, ly + map.height(x, z) + sz * 0.15, z), V(sz * 1.25, sz * 0.7, sz), rot, [k2, k2 * 1.03, k2 * 1.08], 9100 + k, 1, true)
    })
    // THE BONES (Blender's — bones.glb; the user: "low-poly skeletons, head parts, toes, at some random places"): each piece
    //  laid where it's put, turned, the bone a pale old ivory, its sockets near black
    const pieces: Record<string, { bone?: GFX.Mesh; dark?: GFX.Mesh }> = {}
    this.bones?.traverse((o) => {
      const m = o as GFX.Mesh
      if (!m.isMesh) return
      const nm = (m.name || '').replace(/[._]\d+$/, '').toLowerCase(), dark = nm.endsWith('_dark'), key = dark ? nm.slice(0, -5) : nm
      ;(pieces[key] ??= {})[dark ? 'dark' : 'bone'] = m
    })
    const BONE = [0.6, 0.56, 0.46], DARK = [0.03, 0.025, 0.02]
    const placeBones = (name: string, x: number, y: number, z: number, a: number, sc = 1, into = b) => {
      const pc = pieces[name]
      if (!pc) return
      const ca = Math.cos(a), sa = Math.sin(a)
      for (const [m, col] of [[pc.bone, BONE], [pc.dark, DARK]] as const) {
        if (!m) continue
        const P = m.geometry.getAttribute('position').array as Float32Array, N = m.geometry.getAttribute('normal')?.array as Float32Array | undefined
        const pos: number[] = [], nor: number[] = [], cc: number[] = []
        for (let i = 0; i < P.length; i += 3) {
          const lx = P[i] * sc, ly = P[i + 1] * sc, lz = P[i + 2] * sc
          pos.push(x + lx * ca + lz * sa, y + ly - 0.01, z - lx * sa + lz * ca)
          const nx = N ? N[i] : 0, ny = N ? N[i + 1] : 1, nz = N ? N[i + 2] : 0
          nor.push(nx * ca + nz * sa, ny, -nx * sa + nz * ca); cc.push(col[0], col[1], col[2])
        }
        const idx = m.geometry.index ? Array.from(m.geometry.index.array as ArrayLike<number>) : pos.map((_, k) => k).slice(0, pos.length / 3)
        into.setSurf(SURF.plain); into.raw(pos, nor, cc, idx)
      }
      into.setSurf(SURF.wood)
    }
    // scattered over the floor (off the lane: the floor's grass spots), a few on the way to the mouth
    {
      const spots = this.meta.floorTufts ?? [], kinds = ['skull', 'skull', 'skull', 'femur', 'femur', 'hand', 'foot', 'foot', 'ribs', 'skel_lying']
      for (let k = 0; k < 32 && spots.length; k++) {
        const [lx, ly, lz] = spots[Math.floor(((k * 0.618034) % 1) * spots.length)], x = wx(lx, lz), z = wz(lx, lz)
        placeBones(kinds[Math.floor(rnd() * kinds.length)], x, ly + map.height(x, z), z, rnd() * 6.283, 0.95 + 0.15 * rnd())
      }
      for (const [lx, lz, nm] of [[-6.5, 9, 'skull'], [7, 15, 'femur'], [-8, 21, 'foot']] as [number, number, string][]) {
        const x = wx(lx, lz), z = wz(lx, lz); placeBones(nm, x, map.height(x, z), z, rnd() * 6.283, 1, ob)
      }
    }
    // THE CAVE'S BROKEN THINGS AND BONES (the user: "inside, some broken wooden things and some skeletons"): on the
    //  floor's first CAVE_PROPS spots (off the lane), each its own: a skeleton lying, a smashed crate, fallen timbers and
    //  planks, a broken cart wheel
    ;(this.meta.floorBushes ?? []).slice(0, CAVE_PROPS).forEach(([lx, ly, lz], k) => {
      const x = wx(lx, lz), z = wz(lx, lz), y = ly + map.height(x, z), a = rnd() * 6.283
      const kind = k % 4
      if (kind === 0) placeBones(k % 8 === 0 ? 'skel_sitting' : 'skel_lying', x, y, z, a)
      else if (kind === 1) {
        b.setSurf(SURF.wood)
        crate(b, x, y, z, a, 0.42)
        for (let q = 0; q < 5; q++) rbox(b, x + (rnd() - 0.5) * 2.4, y + 0.03, z + (rnd() - 0.5) * 2.4, rnd() * 3.14, 0.42 + 0.3 * rnd(), 0.025, 0.07, b.wood(0.55 + 0.3 * rnd()))
      } else if (kind === 2) {
        b.setSurf(SURF.wood)
        const L = 2.6 + 2 * rnd(), ca = Math.cos(a), sa = Math.sin(a)
        beam(b, V(x - ca * L / 2, y + 0.12, z - sa * L / 2), V(x + ca * L * 0.15, y + 0.9 + 0.5 * rnd(), z + sa * L * 0.15), 0.16, 0.16, b.wood(0.5))
        beam(b, V(x + ca * L * 0.2, y + 0.1, z + sa * L * 0.2 + 0.3), V(x + ca * L / 2, y + 0.1, z + sa * L / 2 - 0.2), 0.14, 0.14, b.wood(0.45))
        for (let q = 0; q < 4; q++) rbox(b, x + (rnd() - 0.5) * 2.8, y + 0.03, z + (rnd() - 0.5) * 2.8, rnd() * 3.14, 0.5 + 0.4 * rnd(), 0.025, 0.08, b.wood(0.6 + 0.3 * rnd()))
      } else {
        b.setSurf(SURF.wood)
        wheel(b, V(x, y + 0.08, z), V(0, 1, 0), 0.55, 0.09, true)
        rbox(b, x + Math.cos(a) * 1.2, y + 0.06, z + Math.sin(a) * 1.2, a, 0.8, 0.05, 0.1, b.wood(0.5))
        if (k % 2) placeBones('skel_lying', x + Math.cos(a + 1.6) * 1.8, y, z + Math.sin(a + 1.6) * 1.8, a + 2)
      }
    })
    b.setSurf(SURF.wood)
    const g = b.geometry(); g.computeBoundingBox()
    // (the inside's tufts, bones and props: ~120 k triangles — hidden with the rest of the inside, 2026-11-07: drawn
    //  always, 0.37 ms seen from the air)
    const props = new GFX.Mesh(g, mat); this.group.add(props); this.inside.push(props)
    const og = ob.geometry(); og.computeBoundingBox(); this.group.add(new GFX.Mesh(og, mat))
    // THE SEAMS WELDED (2026-11-07, the user: "cracks inside, like lines"): the parts were cut apart in Blender and each
    //  packed on its own grid (Draco), so a shared edge came back a hair apart on each side — the land showed through.
    //  Every vertex within ~2.5 cm of another (any part) moved to their middle: two passes on offset 2 cm grids.
    for (const off of [0, 0.01]) {
      const cells = new Map<string, number[]>()
      weld.forEach((arr, ai) => {
        for (let i = 0; i < arr.length; i += 3) {
          const key = `${Math.round((arr[i] + off) * 50)},${Math.round((arr[i + 1] + off) * 50)},${Math.round((arr[i + 2] + off) * 50)}`
          const l = cells.get(key); if (l) l.push(ai, i); else cells.set(key, [ai, i])
        }
      })
      for (const l of cells.values()) {
        if (l.length < 4) continue
        let sx = 0, sy = 0, sz = 0
        for (let k = 0; k < l.length; k += 2) { const a = weld[l[k]], i = l[k + 1]; sx += a[i]; sy += a[i + 1]; sz += a[i + 2] }
        const n = l.length / 2
        for (let k = 0; k < l.length; k += 2) { const a = weld[l[k]], i = l[k + 1]; a[i] = sx / n; a[i + 1] = sy / n; a[i + 2] = sz / n }
      }
    }
    // (and their NORMALS averaged where the parts meet — the hill's turf, the arch, the walls: one smooth light across
    //  the seams, no crease along the model's split between them)
    {
      const cells = new Map<string, number[]>()
      weld.forEach((arr, ai) => {
        if (!weldN.has(arr)) return
        for (let i = 0; i < arr.length; i += 3) {
          const key = `${Math.round(arr[i] * 100)},${Math.round(arr[i + 1] * 100)},${Math.round(arr[i + 2] * 100)}`
          const l = cells.get(key); if (l) l.push(ai, i); else cells.set(key, [ai, i])
        }
      })
      for (const l of cells.values()) {
        if (l.length < 4) continue
        let sx = 0, sy = 0, sz = 0
        for (let k = 0; k < l.length; k += 2) { const N = weldN.get(weld[l[k]])!, i = l[k + 1]; sx += N[i]; sy += N[i + 1]; sz += N[i + 2] }
        const len = Math.hypot(sx, sy, sz) || 1
        for (let k = 0; k < l.length; k += 2) { const N = weldN.get(weld[l[k]])!, i = l[k + 1]; N[i] = sx / len; N[i + 1] = sy / len; N[i + 2] = sz / len }
      }
    }
    // THE MODEL'S SMALL HOLES FILLED (2026-11-07, the user: "there is a gap here"): an edge only one triangle uses is
    //  open; three open edges round a triangle are a missing face (one by the mouth showed the sky once the ground was
    //  cut there) — each filled, facing as its corners' normals face
    if (this.skinMat) {
      const key = (a: Float32Array, i: number) => `${Math.round(a[i] * 100)},${Math.round(a[i + 1] * 100)},${Math.round(a[i + 2] * 100)}`
      const at = new Map<string, [Float32Array, number]>(), edges = new Map<string, number>()
      for (const [pos, idx] of skinIdx) for (let k = 0; k < idx.length; k += 3) {
        const ks = [0, 1, 2].map((q) => { const kk = key(pos, idx[k + q] * 3); if (!at.has(kk)) at.set(kk, [pos, idx[k + q] * 3]); return kk })
        for (let q = 0; q < 3; q++) { const a = ks[q], b = ks[(q + 1) % 3]; if (a === b) continue; const e = a < b ? a + '|' + b : b + '|' + a; edges.set(e, (edges.get(e) ?? 0) + 1) }
      }
      const open = new Map<string, Set<string>>()
      for (const [e, c] of edges) if (c === 1) { const [a, b] = e.split('|'); (open.get(a) ?? open.set(a, new Set()).get(a)!).add(b); (open.get(b) ?? open.set(b, new Set()).get(b)!).add(a) }
      const fp: number[] = [], fn: number[] = [], seen = new Set<string>()
      for (const [a, nbs] of open) for (const b of nbs) for (const c of open.get(b) ?? []) {
        if (c === a || !nbs.has(c)) continue
        const id = [a, b, c].sort().join('/')
        if (seen.has(id)) continue
        seen.add(id)
        for (const v of [a, b, c]) { const [arr, i] = at.get(v)!, N = weldN.get(arr)!; fp.push(arr[i], arr[i + 1], arr[i + 2]); fn.push(N[i], N[i + 1], N[i + 2]) }
      }
      if (fp.length) {
        const P = new Float32Array(fp), Nn = new Float32Array(fn), I = faceOut(P, Nn, Uint32Array.from({ length: fp.length / 3 }, (_, k) => k))
        skinMesh(P, Nn, new Float32Array(fp.length / 3 * 2), I, false).renderOrder = 10
        console.info(`cave: ${fp.length / 9} holes in the model filled`)
      }
    }
  }

  /** What intoTerrain left, per 2 m cell of the land's grid round the hill: 0 the land's own (or off it), 1 the hill
   *  drawn by the ground, 2 an opening's cut (the cave's mesh is the surface there); `bare`: the land's grid points the
   *  field's blades stay off (the cut's cells — the ground there spans the opening). */
  private hold: { x0: number; z0: number; w: number; h: number; k: Uint8Array; bare: number[]; cell(x: number, z: number): number; surf(x: number, z: number): number; circ(x: number, z: number): number; normal(x: number, z: number): [number, number, number]; holeK(x: number, z: number): number } | null = null

  /** THE HILL IS THE GROUND (2026-11-07, the user: "make sure the same terrain method is used to cover the cave — now
   *  it's separate"; "a gradual transition, not a sticker"): the hill's TOP (cave.json, over the land) written into the
   *  ground's own heights and normals — the GPU's copy only: the land's CPU heights stay as they were (the physics, the
   *  places, this mesh laid on the land) — so the terrain draws the hill with everything it is: its paint from the mask
   *  (grassOn writes the hill's rock and dryness in), its rock and relief, its grass, its light. Where the hill opens
   *  (the mouth, the skylights) the ground would stretch from its top down to the land: those 2 m cells are CUT
   *  (Terrain.setHoles: over the land nothing drawn) and the cave's own turf fills them (build keeps it only there). */
  intoTerrain(map: MapData, terrain: Terrain): void {
    const g = map.inner, n = g.n, st = g.step, raw = g.tex.image.data as Uint16Array, nb = g.normalTex.image.data as Uint8Array
    const t = this.meta.top, { wx, wz, local } = this.frame
    const ex = t.x0 + (t.nx - 1) * t.step, ez = t.z0 + (t.nz - 1) * t.step
    const cs = [[t.x0, t.z0], [ex, t.z0], [t.x0, ez], [ex, ez]].map(([a, b]) => [wx(a, b), wz(a, b)])
    const xs = cs.map((c) => c[0]), zs = cs.map((c) => c[1])
    const [i0, i1, j0, j1] = CaveWorld.span(g, xs, zs)
    const W = i1 - i0 + 1, Hh = j1 - j0 + 1, top = new Float32Array(W * Hh).fill(NaN), hr = new Float32Array(W * Hh)
    let hi = -1e9
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const q = j * W + i, k = (j0 + j) * n + i0 + i, [lx, lz] = local(g.origin + (i0 + i) * st, g.origin + (j0 + j) * st), v = this.topSoft(lx, lz)
      hr[q] = g.h[k]
      if (v !== null && v > 0) { top[q] = v; hr[q] += v; hi = Math.max(hi, hr[q]) }
    }
    // THE SKYLIGHTS, round 7 (2026-11-07, the user: "the top of the cave — the cuts and the triangles"): the ground draws
    //  the hill right up to each skylight's lip — no ring of the model's coarse turf. Its heights are FILLED across the
    //  hole from the lip in (so no 2 m cell hangs from the lip down into the shaft), and the hole is cut along the
    //  hill's own edge — a smooth contour of where its top ends (holeK, bilinear in the shader), a little inside the lip
    //  so the ground overlaps the shaft's rim rather than leaving a slit
    const skl = [this.meta.sky, this.meta.sky2].filter((s): s is [number, number, number] => !!s)
    const holeK = new Float32Array(W * Hh).fill(1), filled = new Uint8Array(W * Hh)
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const q = j * W + i
      if (!Number.isNaN(top[q])) continue
      const [lx, lz] = local(g.origin + (i0 + i) * st, g.origin + (j0 + j) * st)
      // (filled wherever the hill's top is missing near a skylight — its rim's rock outcrops too, where the model's
      //  surface is rock not turf; CUT only over the hole itself)
      const dh = Math.min(...skl.map((s) => Math.hypot(lx - s[0], lz - s[1]) - s[2]))
      // (a round cut doesn't fit the shafts — they're not round: white gaps one side, the ground over the hole the other)
      if (dh < 8) { filled[q] = 1; if (dh < 1.5) holeK[q] = 0 }
    }
    for (let pass = 0; pass < 60; pass++) {
      let left = 0
      const nh = new Float32Array(hr)
      for (let j = 1; j < Hh - 1; j++) for (let i = 1; i < W - 1; i++) {
        const q = j * W + i
        if (filled[q] !== 1) continue
        let s = 0, c = 0
        for (const r of [q - 1, q + 1, q - W, q + W, q - W - 1, q - W + 1, q + W - 1, q + W + 1]) if (!Number.isNaN(top[r]) || filled[r] === 2) { s += hr[r]; c++ }
        if (c) { nh[q] = s / c; filled[q] = 3 } else left++
      }
      for (let q = 0; q < W * Hh; q++) if (filled[q] === 3) { filled[q] = 2; hr[q] = nh[q] }
      if (!left) break
    }
    for (let q = 0; q < W * Hh; q++) if (filled[q] === 2) { top[q] = hr[q] - g.h[(j0 + Math.floor(q / W)) * n + i0 + (q % W)] }
    // THE FOOT STRETCHED (2026-11-08, the user: "the height the same, the terrain more forward and backward, so it won't
    //  look like an egg, and grass will grow"): spreadGrade — long concave flanks; the land beyond the hill was raised
    //  already (spreadFoot, before anything was placed); here the hill's own lower faces follow (GPU, the collider too)
    {
      const before = Float32Array.from(hr)
      if (gameParams().get('caveflanks') === '1') spreadGrade(hr, before, W, Hh, this.gradeMask(local, g.origin + i0 * st, g.origin + j0 * st, W, Hh, (i, j) => g.h[(j0 + j) * n + i0 + i], filled))
      const raise = new Float32Array(W * Hh)
      for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
        const q = j * W + i, r = hr[q] - before[q]
        if (r < 0.02) continue
        raise[q] = r; hi = Math.max(hi, hr[q])
        if (Number.isNaN(top[q])) { const k = (j0 + j) * n + i0 + i; g.h[k] = hr[q]; top[q] = 0.0001; raise[q] = 0 } // (outside: the land itself)
        else top[q] += r
      }
      this.footRaise = { data: raise, W, x0: g.origin + i0 * st, z0: g.origin + j0 * st, Hh }
    }
    // the heights (R16UI: min + raw · range / 65535) and the normals (mapPrep.normalsOf's packing)
    const sc = 65535 / g.g.range
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const q = j * W + i, k = (j0 + j) * n + i0 + i
      if (!Number.isNaN(top[q])) raw[k] = Math.min(65535, Math.max(0, Math.round((hr[q] - g.g.min) * sc)))
      if (i === 0 || j === 0 || i === W - 1 || j === Hh - 1) continue
      // (the hill's own slope EASED in its normals — 2026-11-07: at ~45° the ground paints its flanks scree-grey all over
      //  and lights them as a cliff; the hill is a grassed dome — the old turf bent its light to the sky for the same
      //  reason. Its shape is in the heights still; the foot's eased in, no seam)
      // (eased more on the face over the mouth: the welcome is grass, not scree)
      const [mlx, mlz] = local(g.origin + (i0 + i) * st, g.origin + (j0 + j) * st), byMouth = 1 - Math.min(1, Math.max(0, (Math.hypot(mlx, mlz) - 14) / 14))
      const bl = this.ease(byMouth, Number.isNaN(top[q]) ? 0 : top[q])
      const lx0 = hr[q - 1] - g.h[k - 1], lx1 = hr[q + 1] - g.h[k + 1], lz0 = hr[q - W] - g.h[k - n], lz1 = hr[q + W] - g.h[k + n]
      const dx = ((g.h[k + 1] - g.h[k - 1]) + (lx1 - lx0) * bl) / (2 * st), dz = ((g.h[k + n] - g.h[k - n]) + (lz1 - lz0) * bl) / (2 * st), inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz)
      nb[k * 2] = Math.round((-dx * inv * 0.5 + 0.5) * 255); nb[k * 2 + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255)
    }
    g.tex.needsUpdate = true; g.normalTex.needsUpdate = true
    // THE OPENINGS, ROUND (2026-11-07, round 2 — the user: "why these cuts? a single flow"): the ground was cut in 2 m
    //  cells — a staircase round the mouth. Now a CIRCLE round the mouth and each skylight: inside it the ground draws
    //  only the land (nothing over it — Terrain's OTH_HOLES, per pixel, a smooth edge), the cave's own hill surface (in
    //  the ground's material) draws the rest; outside it the ground draws the hill
    const V = (i: number, j: number) => !Number.isNaN(top[j * W + i])
    const circ: [number, number, number][] = [[wx(0, 2), wz(0, 2), 22]]
    const cd = (x: number, z: number) => Math.min(...circ.map(([cx, cz, r]) => Math.hypot(x - cx, z - cz) - r))
    // the cells: 1 the ground's hill, 2 in a circle (the cave's surface), 4 just outside one (the cave's surface under the
    //  ground's — the overlap), 0 the land
    const cw = W - 1, ch = Hh - 1, K = new Uint8Array(cw * ch), bare = new Set<number>()
    const x0 = g.origin + i0 * st, z0 = g.origin + j0 * st
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const c4 = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]
      const all = c4.every(([a, b]) => V(a, b)), any = c4.some(([a, b]) => V(a, b))
      const d = cd(x0 + (i + 0.5) * st, z0 + (j + 0.5) * st)
      K[j * cw + i] = d < 1.5 && any ? 2 : d < 5 && all ? 4 : all ? 1 : 0
      // (the field's blades off a cell the ground spans from the hill down to the land: they'd hang in the opening)
      if (d < 3 && any && !all) for (const [a, b] of c4) bare.add((j0 + b) * n + i0 + a)
      // (and no blades over a skylight's hole or its lip's first metres)
      if (c4.some(([a, b]) => holeK[b * W + a] < 0.5)) for (const [a, b] of c4) bare.add((j0 + b) * n + i0 + a)
    }
    // the land's heights under the circles (the cut keeps what's at the land: in front of the mouth, the skylights' floor)
    // (rows 0…Hh−1 the land, Hh…2Hh−1 the skylights' holeK — one texture: WebGPU's 16 samplers a stage were all taken)
    const land = new Float32Array(W * Hh * 2)
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) land[j * W + i] = g.h[(j0 + j) * n + i0 + i]
    land.set(holeK, W * Hh)
    const tex = new GFX.DataTexture(land, W, Hh * 2, GFX.RedFormat, GFX.FloatType)
    tex.minFilter = tex.magFilter = GFX.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true
    terrain.setHoles(tex, x0, z0, W, Hh, hi + 1, circ)
    this.cutTex = { tex, data: land, W, Hh, x0, z0 }
    this.skinMat = terrain.skinMaterial()
    this.hold = {
      x0, z0, w: cw, h: ch, k: K, bare: [...bare],
      cell: (x, z) => { const a = Math.floor((x - x0) / st), b = Math.floor((z - z0) / st); return a < 0 || b < 0 || a >= cw || b >= ch ? 0 : K[b * cw + a] },
      circ: cd,
      holeK: (x, z) => {
        const fx = Math.min(W - 1.001, Math.max(0, (x - x0) / st)), fz = Math.min(Hh - 1.001, Math.max(0, (z - z0) / st)), a = fx | 0, b = fz | 0, u = fx - a, v = fz - b, q = b * W + a
        return (holeK[q] * (1 - u) + holeK[q + 1] * u) * (1 - v) + (holeK[q + W] * (1 - u) + holeK[q + W + 1] * u) * v
      },
      normal: (x, z) => {
        const fx = (x - g.origin) / st, fz = (z - g.origin) / st, a = Math.floor(fx), b = Math.floor(fz), u = fx - a, v = fz - b
        let sx = 0, sz = 0
        for (const [di, dj, wt] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]] as const) {
          const k = ((b + dj) * n + a + di) * 2; sx += (nb[k] / 255 * 2 - 1) * wt; sz += (nb[k + 1] / 255 * 2 - 1) * wt
        }
        return [sx, Math.sqrt(Math.max(0, 1 - sx * sx - sz * sz)), sz]
      },
      surf: (x, z) => {
        const fx = Math.min(W - 1.001, Math.max(0, (x - x0) / st)), fz = Math.min(Hh - 1.001, Math.max(0, (z - z0) / st)), a = fx | 0, b = fz | 0, u = fx - a, v = fz - b, q = b * W + a
        return (hr[q] * (1 - u) + hr[q + 1] * u) * (1 - v) + (hr[q + W] * (1 - u) + hr[q + W + 1] * u) * v
      },
    }
  }

  /** The land's grid points round the hill (its top's box + the flanks' reach, ~130 m). */
  static span(g: MapData['inner'], xs: number[], zs: number[]): [number, number, number, number] {
    const n = g.n, st = g.step, E = 66
    return [Math.max(1, Math.floor((Math.min(...xs) - g.origin) / st) - E), Math.min(n - 2, Math.ceil((Math.max(...xs) - g.origin) / st) + E),
      Math.max(1, Math.floor((Math.min(...zs) - g.origin) / st) - E), Math.min(n - 2, Math.ceil((Math.max(...zs) - g.origin) / st) + E)]
  }
  /** spreadGrade's per point: `mul` its grade × (a slow noise: spurs and hollows, never one even sweep; 1e9: never raised
   *  — a skylight's hole), `cap` the most it may rise to — before the mouth a gentle VALLEY leads in (the way in at the
   *  land, its sides rising ~18° beyond ~10 m off its line), so the flanks go all the way round and the mouth stays open */
  private gradeMask(local: (x: number, z: number) => [number, number], x0: number, z0: number, W: number, Hh: number, land: (i: number, j: number) => number, filled?: Uint8Array): { mul: Float32Array; cap: Float32Array } {
    const mul = new Float32Array(W * Hh), cap = new Float32Array(W * Hh).fill(1e9)
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const q = j * W + i, x = x0 + i * 2, z = z0 + j * 2, [lx, lz] = local(x, z)
      mul[q] = filled?.[q] === 2 ? 1e9 : 0.65 + 0.7 * patch(x * 0.6, z * 0.6)
      if (lz > -24) {
        const e = Math.abs(lx) - (10 + Math.max(0, lz) * 0.15), back = Math.max(0, -8 - lz) * 2.5
        cap[q] = land(i, j) + Math.max(0, e) * 0.32 + back
      }
    }
    return { mul, cap }
  }
  /** THE LAND ROUND THE HILL RAISED INTO ITS FLANKS — run before the trees, bushes and things are placed (World.build),
   *  so they stand on it; the land's own heights (CPU: the physics, map.height) and the ground's (GPU). Off the hill only. */
  static spreadFoot(map: MapData, site: Landmark, meta: CaveMeta): void {
    const cw = new CaveWorld(site, meta), g = map.inner, n = g.n, st = g.step, t = meta.top, { wx, wz, local } = cw.frame
    const ex = t.x0 + (t.nx - 1) * t.step, ez = t.z0 + (t.nz - 1) * t.step
    const cs = [[t.x0, t.z0], [ex, t.z0], [t.x0, ez], [ex, ez]].map(([a, b]) => [wx(a, b), wz(a, b)])
    const [i0, i1, j0, j1] = CaveWorld.span(g, cs.map((c) => c[0]), cs.map((c) => c[1]))
    const W = i1 - i0 + 1, Hh = j1 - j0 + 1, hr = new Float32Array(W * Hh), on = new Uint8Array(W * Hh)
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const q = j * W + i, k = (j0 + j) * n + i0 + i, [lx, lz] = local(g.origin + (i0 + i) * st, g.origin + (j0 + j) * st), v = cw.topSoft(lx, lz)
      hr[q] = g.h[k]
      if (v !== null && v > 0) { hr[q] += v; on[q] = 1 }
      else if ([meta.sky, meta.sky2].some((sk) => !!sk && Math.hypot(lx - sk[0], lz - sk[1]) < sk[2] + 8)) on[q] = 1
    }
    const before = Float32Array.from(hr)
    spreadGrade(hr, before, W, Hh, cw.gradeMask(local, g.origin + i0 * st, g.origin + j0 * st, W, Hh, (i, j) => g.h[(j0 + j) * n + i0 + i], on.map((v) => (v ? 2 : 0))))
    const raw = g.tex.image.data as Uint16Array, nb = g.normalTex.image.data as Uint8Array, sc = 65535 / g.g.range
    let moved = 0
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const q = j * W + i
      if (on[q] || hr[q] - before[q] < 0.02) continue
      const k = (j0 + j) * n + i0 + i
      g.h[k] = hr[q]; raw[k] = Math.min(65535, Math.max(0, Math.round((hr[q] - g.g.min) * sc))); moved++
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i, dx = (g.h[k + 1] - g.h[k - 1]) / (2 * st), dz = (g.h[k + n] - g.h[k - n]) / (2 * st), inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz)
      nb[k * 2] = Math.round((-dx * inv * 0.5 + 0.5) * 255); nb[k * 2 + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255)
    }
    g.tex.needsUpdate = true; g.normalTex.needsUpdate = true
    console.info(`cave: the land round the hill raised into its flanks at ${moved} points`)
  }

  /** The hill's top for the ground: as caveTop, but at its outer foot a missing sample counts as the land (0) — the
   *  top fades onto the land there, no step a cell wide (2026-11-07: a sawtooth along the foot) — while by an opening
   *  (the mouth, the skylights) it's still the hole. */
  private topSoft(lx: number, lz: number): number | null {
    const t = this.meta.top, fx = (lx - t.x0) / t.step, fz = (lz - t.z0) / t.step, i = Math.floor(fx), j = Math.floor(fz)
    if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return null
    const opening = Math.hypot(lx, lz - 4) < 18 || [this.meta.sky, this.meta.sky2].some((s) => !!s && Math.hypot(lx - s[0], lz - s[1]) < s[2] + 8)
    const c = [t.h[j * t.nx + i], t.h[j * t.nx + i + 1], t.h[(j + 1) * t.nx + i], t.h[(j + 1) * t.nx + i + 1]]
    if (c.every((v) => v === null)) return null
    if (opening && c.some((v) => v === null)) return null
    const [a, b, d, e] = c.map((v) => v ?? 0), u = fx - i, w = fz - j
    return (a * (1 - u) + b * u) * (1 - w) + (d * (1 - u) + e * u) * w
  }

  /** How much of the hill's own slope its normals keep (the ground's and the cave's hill surface alike — one light
   *  where they meet): at ~45° the ground paints its flanks scree-grey and lights them as a cliff; it's a grassed dome. */
  private ease(byMouth: number, top: number): number { if (gameParams().get('caveease') === '0') return 1; return 1 - (0.42 + 0.3 * byMouth) * Math.min(1, Math.max(0, (top - 0.5) / 4)) }

  /** The hill's top over the land at world (x, z) — 0 off it and in its openings (Glow's horizon: no sun through it). */
  liftAt(x: number, z: number): number {
    const [lx, lz] = this.frame.local(x, z), h = inCaveFoot(this.meta, lx, lz) ? caveTop(this.meta, lx, lz) : null
    return h !== null && h > 0 ? h : 0
  }

  /** The terrain's own grass kept off where the hill is open — its mouth's face, the skylight, its steep — and under the
   *  cave where no top covers it; elsewhere on the hill it GROWS (grassOn). */
  private clearGrass(map: MapData, footprint?: GFX.DataTexture): void {
    const fp = footprint?.image.data as Uint8Array | undefined
    if (!fp) return
    const gi = map.inner, f = this.meta.foot, { local } = this.frame, R = Math.max(f.rx, f.rz) + Math.hypot(f.cx, f.cz) + 4
    const i0 = Math.max(0, Math.floor((this.site.x - R - gi.origin) / gi.step)), i1 = Math.min(gi.n - 1, Math.ceil((this.site.x + R - gi.origin) / gi.step))
    const j0 = Math.max(0, Math.floor((this.site.z - R - gi.origin) / gi.step)), j1 = Math.min(gi.n - 1, Math.ceil((this.site.z + R - gi.origin) / gi.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [lx, lz] = local(gi.origin + i * gi.step, gi.origin + j * gi.step)
      if (!inCaveFoot(this.meta, lx, lz)) continue
      const h = caveTop(this.meta, lx, lz)
      const rim = [this.meta.sky, this.meta.sky2].some((sk) => !!sk && Math.hypot(lx - sk[0], lz - sk[1]) < sk[2] + 2.2)
      // (2026-11-07: the hill is the ground now — its steep gold grows grass as the valley's does, and its rock and scree
      //  keep the blades off by the ground's own rule; only the old separate hill kept them off its steep)
      const steep = (!this.hold && h !== null && this.slope(lx, lz) > 0.85) || rim
      const arch = !this.hold && Math.abs(lx) < 13 && lz > -9 && lz < 5 && h !== null && h > 0.6
      if ((h === null && lz < -1 && inCaveFoot(this.meta, lx, lz, -18)) || steep || arch) fp[j * gi.n + i] = 255
    }
    // (and off the openings' cut cells: the ground under them spans the opening — its blades would hang in the air)
    for (const k of this.hold?.bare ?? []) fp[k] = 255
    footprint!.needsUpdate = true
  }

  /** The hill's top's slope (rise / run) at local (lx, lz); 9 off it. */
  private slope(lx: number, lz: number): number {
    const h = caveTop(this.meta, lx, lz), hx = caveTop(this.meta, lx + 2, lz), hz = caveTop(this.meta, lx, lz + 2)
    return h === null || hx === null || hz === null ? 9 : Math.hypot(hx - h, hz - h) / 2
  }

  /** THE FIELD'S GRASS ON THE HILL (2026-11-07, the user: "why no grass over the cave? there must be grass"; "above the
   *  cave some rocky texture as well, properly like we do in other terrain places"): its top's height over the ground
   *  (a 2 m world-aligned grid) to Grass — the blades stand on it, the field's colours and wind; and its bare rock
   *  patches into the map's mask (R: rock) where it stands, so the field thins there as on any rocky hill. */
  grassOn(map: MapData, grass: { setHill(tex: GFX.DataTexture, x0: number, z0: number, step: number, n: number, gpu?: boolean): void }): void {
    const f = this.meta.foot, { wx, wz, local } = this.frame, R = Math.max(f.rx, f.rz) + 6, cx = wx(f.cx, f.cz), cz = wz(f.cx, f.cz)
    const step = 2, x0 = cx - R, z0 = cz - R, n = Math.ceil((2 * R) / step) + 1, data = new Float32Array(n * n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const [lx, lz] = local(x0 + i * step, z0 + j * step), h = caveTop(this.meta, lx, lz)
      data[j * n + i] = h !== null && h > 0 ? h : 0
    }
    const tex = new GFX.DataTexture(data, n, n, GFX.RedFormat, GFX.FloatType)
    tex.minFilter = tex.magFilter = GFX.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true
    grass.setHill(tex, x0, z0, step, n, !this.hold)
    // the rock patches into the mask (as the turf paints them: CaveWorld.build's vCol.z)
    const mg = map.meta.mask, md = map.maskTex.image.data as Uint8Array
    const mi0 = Math.max(0, Math.floor((x0 - mg.origin) / mg.step)), mi1 = Math.min(mg.n - 1, Math.ceil((x0 + 2 * R - mg.origin) / mg.step))
    const mj0 = Math.max(0, Math.floor((z0 - mg.origin) / mg.step)), mj1 = Math.min(mg.n - 1, Math.ceil((z0 + 2 * R - mg.origin) / mg.step))
    const bw = mi1 - mi0 + 1, bh = mj1 - mj0 + 1, G = new Float32Array(bw * bh), on = new Uint8Array(bw * bh)
    for (let j = mj0; j <= mj1; j++) for (let i = mi0; i <= mi1; i++) {
      const x = mg.origin + i * mg.step, z = mg.origin + j * mg.step, [lx, lz] = local(x, z), h = caveTop(this.meta, lx, lz)
      const b = (j - mj0) * bw + (i - mi0), k0 = (j * mg.n + i) * 4
      G[b] = md[k0 + 1] / 255
      if (h === null || h < 1) continue
      on[b] = 1
      // DRYNESS: the land's, swung a little to green swales and golden rises (faded in up the foot: no seam there)
      const w = Math.min(1, (h - 1) / 6)
      G[b] += (grassDry(G[b], x, z) - G[b]) * w
      const sl = this.slope(lx, lz), ny = 1 / Math.sqrt(1 + sl * sl), welcome = Math.min(1, Math.max(0, (Math.hypot(lx, lz * 0.8) - 24) / 10))
      // ROCK: where it's steep, and in patches (a slow noise) — SMOOTH, so the terrain's threshold turns it to rock over
      // metres (the user: "gradual, not a sticker"); round the skylights' rims; never round the entrance
      let rz = welcome * Math.max(0, 0.45 * Math.min(1, Math.max(0, (0.75 - ny) / 0.35)) + (patch(x, z) - 0.5) * 0.8 - 0.16)
      for (const sk of [this.meta.sky, this.meta.sky2]) { if (sk) { const d = Math.hypot(lx - sk[0], lz - sk[1]), t = Math.min(1, Math.max(0, (d - sk[2] - 0.5) / 9)); rz = Math.max(rz, 1.1 * (1 - t * t * (3 - 2 * t))) } }
      const k = (j * mg.n + i) * 4, t2 = Math.min(1, Math.max(0, (rz - 0.15) / 0.75))
      md[k] = Math.max(md[k], Math.round(t2 * t2 * (3 - 2 * t2) * 235))
    }
    // THE ARCH'S FOOT IN ROCK (2026-11-07, the user: "the entrance ground — a gradual transition, not a sticker"): the
    //  ground round where the arch stands goes to rock as the terrain's does round any outcrop — bare at its foot, the
    //  grass breaking in over ~7 m (the mask's R: the ground's paint and the blades both read it)
    // (2026-11-07, round 2 — the user: "the transition from the normal texture to rock is so sudden": ALL ROUND the arch,
    //  by the true distance from the ground's surface there — the hill's top where it is, the land in front — to the
    //  arch's: rock against it, the grass breaking in over ~7 m; the arch's own skirt reads the same mask, below)
    const H = this.hold
    if (this.archAll.length) for (let j = mj0; j <= mj1; j++) for (let i = mi0; i <= mi1; i++) {
      const x = mg.origin + i * mg.step, z = mg.origin + j * mg.step, [lx, lz] = local(x, z)
      if (Math.hypot(lx, lz - 4) > 34) continue
      const y = H ? H.surf(x, z) : map.height(x, z), A = this.archAll
      let b = 1e9
      for (let q = 0; q < A.length; q += 3) { const d = (A[q] - x) ** 2 + (A[q + 1] - y) ** 2 + (A[q + 2] - z) ** 2; if (d < b) b = d }
      const u = Math.min(1, Math.max(0, (Math.sqrt(b) - 0.5) / 3.5)), k = (j * mg.n + i) * 4
      md[k] = Math.max(md[k], Math.round((1 - u * u * (3 - 2 * u)) * 235))
    }
    // (the dryness SOFTENED over the hill — a 20 m box: green runs into gold over metres, in the ground's paint and in
    //  the blades alike, never along a line — 2026-11-07, the user: "a gradual smooth transition")
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      if (!on[j * bw + i]) continue
      let s = 0, c = 0
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const jj = j + dj, ii = i + di
        if (jj >= 0 && ii >= 0 && jj < bh && ii < bw) { s += G[jj * bw + ii]; c++ }
      }
      md[((j + mj0) * mg.n + i + mi0) * 4 + 1] = Math.round(Math.min(1, Math.max(0, s / c)) * 255)
    }
    // GREEN ROUND THE MOUTH (2026-11-08, the user: "put some green colour … grass, bushes — hide all the patches"): the
    //  ground's dryness (mask G — its paint AND the field's blades read it) eased to a lush green over ~22 m before the
    //  mouth and round its foot, fading out by ~32
    for (let j = mj0; j <= mj1; j++) for (let i = mi0; i <= mi1; i++) {
      const x = mg.origin + i * mg.step, z = mg.origin + j * mg.step, [lx, lz] = local(x, z)
      if (lz < -6) continue
      const d = Math.hypot(lx * 0.8, Math.max(0, lz - 4)), w = 1 - Math.min(1, Math.max(0, (d - 22) / 10))
      if (w <= 0) continue
      const k = (j * mg.n + i) * 4
      md[k + 1] = Math.round(md[k + 1] + (0.4 * 255 - md[k + 1]) * w * 0.5) // (a touch greener, no more — the user: "don't use that much green")
    }
    map.maskTex.needsUpdate = true
  }

  /** FIREFLIES (2026-11-07, the user: "at night some fireflies"): little green-gold lights drifting in the cave's air
   *  — over the garden and the lake, through the chambers and the Haven — each its own slow wander and pulse, out by day
   *  (uLamps). One draw: every fly a camera-facing quad worked out in the vertex shader; added, no depth write. */
  private fireflies(map: MapData, atmos: Atmosphere, tier: Tier): void {
    const spots = [...(this.meta.floorTufts ?? []), ...this.meta.tufts]
    if (!spots.length) return
    const N = tier.name === 'low' ? 120 : tier.name === 'medium' ? 200 : 320, { wx, wz } = this.frame
    let s = 0x51f1
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const pos: number[] = [], seed: number[] = [], idx: number[] = []
    for (let k = 0; k < N; k++) {
      // (a third over the garden and the lake — the light's — the rest anywhere on the floor)
      const [lx, ly, lz] = k % 3 === 0 ? this.meta.tufts[Math.floor(rnd() * this.meta.tufts.length)] : spots[Math.floor(rnd() * spots.length)]
      const x = wx(lx, lz), z = wz(lx, lz), y = ly + map.height(x, z) + 0.4 + rnd() * 2.6, ph = rnd() * 100
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(cx, cy, 0); seed.push(x, y, z, ph) }
      const b = k * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
    }
    const g = new GFX.BufferGeometry()
    g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
    g.setAttribute('seed', new GFX.Float32BufferAttribute(seed, 4))
    g.setIndex(idx)
    g.computeBoundingBox()
    const u = atmos.uniforms
    const mat = new GFX.ShaderMaterial({
      uniforms: { uTime: u.uTime, uLamps: u.uLamps, uCamPos: u.uCamPos },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime;
        uniform vec3 uCamPos;
        varying vec2 vUv;
        varying float vGlow;
        void main() {
          float t = uTime * 0.35 + seed.w;
          // (a slow wander round its spot, a little bob)
          vec3 c = seed.xyz + vec3(sin(t * 0.9) * 1.6 + sin(t * 2.3) * 0.4, sin(t * 1.3) * 0.5 + sin(t * 3.1) * 0.15, cos(t * 0.7) * 1.6 + cos(t * 1.9) * 0.4);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float size = 0.07 + 0.002 * length(c - uCamPos); // (a pixel or two far off, never gone)
          vUv = position.xy;
          // (each its own pulse: on for a while, dim, on again)
          vGlow = 0.25 + 0.75 * smoothstep(0.2, 0.9, sin(uTime * (0.8 + fract(seed.w) * 0.9) + seed.w * 7.0) * 0.5 + 0.5);
          gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * size, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLamps;
        varying vec2 vUv;
        varying float vGlow;
        void main() {
          float r = length(vUv), a = (1.0 - smoothstep(0.15, 1.0, r)) * vGlow * uLamps;
          gl_FragColor = vec4(vec3(0.75, 1.0, 0.3) * 2.4, a); // (added × its alpha)
        }`,
      transparent: true,
      depthWrite: false,
      side: GFX.DoubleSide,
      blending: GFX.AdditiveBlending,
    })
    const m = new GFX.Mesh(g, mat)
    m.frustumCulled = false
    m.renderOrder = 60
    this.group.add(m)
    this.flies = m
    this.lamps = u.uLamps
  }
  private flies: GFX.Mesh | null = null
  private lamps: GFX.IUniform | null = null

  /** The cave's inside drawn only from on or near the hill (once a frame). */
  update(cam: GFX.Vector3): void {
    const [lx, lz] = this.frame.local(cam.x, cam.z), near = inCaveFoot(this.meta, lx, lz, 15)
    const top = near ? caveTop(this.meta, lx, lz) : null
    this.cameraInside = near && lz < -3 && inCaveFoot(this.meta, lx, lz, -12) && cam.y < this.map!.height(cam.x, cam.z) + (top ?? 30) - 1
    // (seen only from inside, from before its mouth, or down its skylight — from on its top it's all behind turf:
    //  2026-11-07, abq caveAbove: +0.5 ms ULTRA drawing 140 k triangles nobody saw)
    const [sx, sz] = this.meta.sky
    // (in front of the mouth — from anywhere it can be seen through — always: else the hill reads see-through)
    const s2 = this.meta.sky2
    // (in front: only low enough to see in — from high over the land before it, the mouth's roof hides all but its lip)
    const agl = cam.y - this.map!.height(cam.x, cam.z), d0 = Math.hypot(lx, lz), ahead = lz > -4 && Math.abs(lx) < lz * 2.5 + 30
    const d1 = Math.hypot(lx - sx, lz - sz), d2 = s2 ? Math.hypot(lx - s2[0], lz - s2[1]) : 1e9
    const on = this.cameraInside || d0 < 45 || d1 < 30 || d2 < 30 || (ahead && agl < 20 + 0.35 * d0)
    // (the WAY IN from in front at any height — 2026-11-07: the ground under the passage is the hill's top now, so
    //  through the mouth there's only the cave's own floor to see)
    const wayOn = on || (ahead && d0 < 320)
    // (drawn AFTER the hill's turf and the land when looked at from outside — the depth test throws away what's behind
    //  them before it's shaded; FIRST from inside, so the turf over the roof is thrown away instead: 2026-11-07, abq
    //  caveAbove / caveHall — the taller cave's rock, ~1.9 ms seen through the mouth from the air)
    const order = this.cameraInside ? -1 : 1
    for (const m of this.inside) { m.visible = on; m.renderOrder = order }
    for (const m of this.way) { m.visible = wayOn || Math.hypot(lx, lz) < 500; m.renderOrder = order }
    for (const m of this.pools) m.visible = on
    // (the floor's grass — its rings go round the camera: only in the cave or by its openings, where they can grow)
    this.insideShown = this.cameraInside || d0 < 30 || d1 < 30 || d2 < 30
    if (this.flies) this.flies.visible = on && (this.lamps!.value as number) > 0.02
  }
}
let draco: InstanceType<typeof DRACOLoader> | null = null

/** THE FLANKS' GRADE (2026-11-08): hr raised wherever it falls away faster than its grade from a neighbour — the grade
 *  gentle low down (~11° within a few metres of the land, `base`), steeper as it climbs (~35° 40 m up): long concave
 *  flanks, the hill's height kept. `extra` per point: added to its grade (1e9: never raised). */
function spreadGrade(hr: Float32Array, base: Float32Array, W: number, Hh: number, m: { mul: Float32Array; cap: Float32Array }): void {
  const nb8 = [[-1, 0, 2], [1, 0, 2], [0, -1, 2], [0, 1, 2], [-1, -1, 2.83], [1, -1, 2.83], [-1, 1, 2.83], [1, 1, 2.83]]
  for (let pass = 0; pass < 200; pass++) {
    let ch = false
    for (let j = 1; j < Hh - 1; j++) for (let i = 1; i < W - 1; i++) {
      const q = j * W + i, e = m.mul[q], c = m.cap[q]
      if (e > 1e8 || hr[q] >= c) continue
      for (const [di, dj, d] of nb8) {
        const h = hr[q + dj * W + di], rel = h - base[q]
        if (rel <= 0.05) continue
        const v = Math.min(c, h - (0.2 + 0.5 * Math.min(1, rel / 40) ** 1.2) * e * d)
        if (v > hr[q] + 0.01) { hr[q] = v; ch = true }
      }
    }
    if (!ch) break
  }
}
