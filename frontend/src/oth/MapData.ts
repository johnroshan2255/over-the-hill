import * as GFX from './gfx'
import type { PreparedMap } from './mapPrep'

/** The map loader's worker (one for every load) and its request count. */
let loader: Worker | null = null
let loads = 0

/**
 * The map's baked data (scripts/oth/terrain.py → public/oth/<id>/): two height grids — the 4 km playable box at 2 m
 * and the 16 km world at 16 m (the box's own heights inside it) — and the box's 4 m mask (rock, dryness, wet, forest).
 * Kept on the CPU (Float32 metres: physics, grass, spawn, camera) and uploaded once as GPU textures:
 *   heights  R16UI (the terrain's vertex shader filters them itself, 4 texelFetch — exact, no half-float steps)
 *   normals  RG8, linear + mipmaps (the ground's per-pixel normal: detail the vertex grid can't hold far away)
 *   mask     RGBA8, linear + mipmaps
 */
export interface Grid { n: number; step: number; origin: number; min: number; range: number }
export interface Pond { cx: number; cz: number; rx: number; rz: number; rot: number; level: number }
/** A LANDMARK (scripts/oth/scenery.mjs, Landmarks.ts): a place to find — its kind, name, pad centre / height, the way
 *  its front faces (rad: local +z turned by rot about +y) and its pad's radius (m). */
export interface Landmark { id: number; kind: 'tower' | 'view' | 'cabin' | 'shack' | 'sawmill' | 'mine' | 'meteorite' | 'falls' | 'meadow' | 'camp' | 'oasis' | 'aqueduct' | 'arch' | 'spires' | 'gorge' | 'ksar' | 'dunes'; name: string; x: number; z: number; y: number; rot: number; r: number }
/** A bridge: deck ends (x0, z0) → (x1, z1), the deck's top there y0 → y1, width w; a ROPE bridge (the desert's gorge)
 *  hangs `sag` m below that line at its middle (a parabola). */
export interface Bridge { x0: number; z0: number; x1: number; z1: number; y: number; y0: number; y1: number; w: number; kind?: 'rope'; sag?: number }
/** The deck's top at t (0 … 1 along it). */
export function deckY(b: Bridge, t: number): number {
  const s = Math.min(1, Math.max(0, t))
  return b.y0 + (b.y1 - b.y0) * s - (b.sag ?? 0) * 4 * s * (1 - s)
}
export interface MapMeta {
  id: string
  name: string
  /** 'desert' (the second world: its own palette, plants and weather — every world material's OTH_DESERT) */
  biome?: 'desert'
  /** The CROSSING's pass road (World / Crossing.ts): where the cloud is thickest, the way out of this world `heading`
   *  (0 = −z); its MIST thickens from height y0 to y1 within r m of it. */
  gate?: { x: number; z: number; y: number; heading: number; mist?: { y0: number; y1: number; r: number } }
  inner: Grid
  far: Grid
  mask: { n: number; step: number; origin: number }
  water: {
    lake: Pond
    /** The ponds and small lakes (scripts/oth/terrain.py): each a flat disc of water at its level in its bowl. */
    ponds?: Pond[]
    river: { x: number[]; z: number[]; y: number[]; hw: number[] }
    /** Mountain STREAMS (scripts/oth/terrain.py): centre line from the mouth (index 0) up to the source, the surface
     *  height and half width along it — rapids, falling over WATERFALLS where they drop off a step. */
    streams?: { x: number[]; z: number[]; y: number[]; hw: number[] }[]
    /** WATERFALLS: the lip (x, z, y top), the foot (bx, bz, by bottom), the sheet's half width. */
    falls?: { x: number; z: number; y: number; bx: number; bz: number; by: number; hw: number }[]
  }
  /** The SCENERY pass (scripts/oth/scenery.mjs): the boulder walls along the stream roads ([x, z, size]). */
  scenery?: { boulders: [number, number, number][] }
  spawn: { x: number; z: number; yaw: number }
  /** Plank bridges over the river and the streams: deck ends (x0, z0) → (x1, z1) on the banks, the deck's top there
   *  y0 → y1 (on the road at each end: a stream's deck slopes with its road; y = the higher), width w (m). */
  bridges?: Bridge[]
  /** The dirt tracks: half width (m) and their centre lines ([x, z] every ~8 m). */
  /** The dirt tracks: centre lines; `rough` = the indices of the rock-crawling routes (trekking hills, formations). */
  trails: { hw: number; lines: [number, number][][]; rough?: number[] }
  landmarks?: Landmark[]
  /** MUD + WILDFLOWERS (mud.bin: RG8 on the mask's grid — R mud, G blossoms, 0 … 1) and the marsh's centre / radius. */
  mud?: { n: number; step: number; origin: number; marsh: { x: number; z: number; r: number } | null }
  /** HIDDEN PLACES (terrain.py): basins seen only from inside — a falls basin (cliff ring, gorge, its fall into a pool)
   *  or a flower hollow; the floor's radius r, the outer foot's ro, the gap facing `open` (rad), its half width gw. */
  hidden?: { kind: 'falls' | 'meadow'; name: string; x: number; z: number; r: number; ro: number; open: number; gw: number; F: number; pool?: { cx: number; cz: number; rx: number; rz: number; rot: number; level: number } }[]
  /** The valley's spurs ([nose x, z, root x, z]). */
  spurs?: [number, number, number, number][]
}

class HeightGrid {
  readonly h: Float32Array
  readonly n: number
  readonly step: number
  readonly origin: number
  readonly tex: GFX.DataTexture
  readonly normalTex: GFX.DataTexture

  constructor(readonly g: Grid, raw: Uint16Array, h: Float32Array, nb: Uint8Array) {
    this.n = g.n
    this.step = g.step
    this.origin = g.origin
    this.h = h
    this.tex = new GFX.DataTexture(raw, g.n, g.n, GFX.RedIntegerFormat, GFX.UnsignedShortType)
    this.tex.internalFormat = 'R16UI'
    this.tex.minFilter = this.tex.magFilter = GFX.NearestFilter
    this.tex.generateMipmaps = false
    this.tex.unpackAlignment = 1
    this.tex.needsUpdate = true
    // normals (mapPrep.ts): x / z components in 0..255 (y rebuilt in the shader)
    const n = g.n
    this.normalTex = new GFX.DataTexture(nb, n, n, GFX.RGFormat, GFX.UnsignedByteType)
    this.normalTex.minFilter = GFX.LinearMipmapLinearFilter
    this.normalTex.magFilter = GFX.LinearFilter
    this.normalTex.generateMipmaps = true
    this.normalTex.unpackAlignment = 1
    this.normalTex.wrapS = this.normalTex.wrapT = GFX.ClampToEdgeWrapping
    this.normalTex.needsUpdate = true
  }

  /** Bilinear height (m) at world x, z (clamped to the grid). */
  sample(x: number, z: number): number {
    const n = this.n
    let fx = (x - this.origin) / this.step, fz = (z - this.origin) / this.step
    fx = fx < 0 ? 0 : fx > n - 1.0001 ? n - 1.0001 : fx
    fz = fz < 0 ? 0 : fz > n - 1.0001 ? n - 1.0001 : fz
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * n + i, h = this.h
    const a = h[k] + (h[k + 1] - h[k]) * tx
    const b = h[k + n] + (h[k + n + 1] - h[k + n]) * tx
    return a + (b - a) * tz
  }
}

export class MapData {
  readonly inner: HeightGrid
  readonly far: HeightGrid
  readonly mask: Uint8Array
  readonly maskTex: GFX.DataTexture
  /** Distance to the nearest track's centre line (R8 on the box's 2 m grid, 0..8 m) — the ground paints the dirt, the
   *  grass keeps off it. */
  readonly trailTex: GFX.DataTexture
  /** MUD over the box (the mask's 4 m grid, RG: R mud 0 … 1 — the ground paints it, the grass keeps off, the tyres
   *  sink — G wildflowers: the grass blossoms). */
  readonly mud: Uint8Array
  readonly mudTex: GFX.DataTexture
  /** The desert's world (meta.biome): the materials' OTH_DESERT. */
  get desert(): boolean { return this.meta.biome === 'desert' }
  /** Its shader define (none for the valley). */
  get biomeDefines(): Record<string, string> { return this.desert ? { OTH_DESERT: '' } : {} }
  /** The playable box's half size (m) and the world's. */
  readonly half: number
  readonly farHalf: number

  /** The terrain quadtree's min / max heights (mapPrep.ts: computed with the map, for Terrain's leaf size). */
  readonly pyramid: PreparedMap['pyramid']

  private constructor(p: PreparedMap) {
    const meta = (this.meta = p.meta), mask = p.mask, trail = p.trail, mud = p.mud
    this.inner = new HeightGrid(meta.inner, p.innerRaw, p.innerH, p.innerNormals)
    this.far = new HeightGrid(meta.far, p.farRaw, p.farH, p.farNormals)
    this.pyramid = p.pyramid
    this.trackFar = p.fields.track
    this.riverFar = p.fields.river
    this.farN = p.fields.n
    this.half = -meta.inner.origin
    this.farHalf = -meta.far.origin
    this.mask = mask
    const mn = meta.mask.n
    this.maskTex = new GFX.DataTexture(mask, mn, mn, GFX.RGBAFormat, GFX.UnsignedByteType)
    this.maskTex.minFilter = GFX.LinearMipmapLinearFilter
    this.maskTex.magFilter = GFX.LinearFilter
    this.maskTex.generateMipmaps = true
    this.maskTex.needsUpdate = true
    const tn = meta.inner.n
    this.trailTex = new GFX.DataTexture(trail, tn, tn, GFX.RedFormat, GFX.UnsignedByteType)
    this.trailTex.minFilter = GFX.LinearMipmapLinearFilter
    this.trailTex.magFilter = GFX.LinearFilter
    this.trailTex.generateMipmaps = true
    this.trailTex.unpackAlignment = 1
    this.trailTex.needsUpdate = true
    this.mud = mud.length === mn * mn * 2 ? mud : new Uint8Array(mn * mn * 2)
    this.mudTex = new GFX.DataTexture(this.mud, mn, mn, GFX.RGFormat, GFX.UnsignedByteType)
    this.mudTex.minFilter = GFX.LinearMipmapLinearFilter
    this.mudTex.magFilter = GFX.LinearFilter
    this.mudTex.generateMipmaps = true
    this.mudTex.unpackAlignment = 1
    this.mudTex.needsUpdate = true
  }

  /** The WATER's surface at (x, z) (m), or null on dry ground: the lake, a pond, else the nearest river / stream point
   *  where the mask says open water (the splashes, the drag on a car fording it). */
  waterLevel(x: number, z: number): number | null {
    const mk = this.maskAt(x, z, this._wk)
    if (mk[2] < 0.86) return null
    const W = this.meta.water, L = W.lake
    const inEllipse = (cx: number, cz: number, rx: number, rz: number, rot: number) => {
      const c = Math.cos(rot), s = Math.sin(rot), dx = x - cx, dz = z - cz
      return ((dx * c + dz * s) / rx) ** 2 + ((-dx * s + dz * c) / rz) ** 2 < 1
    }
    if (inEllipse(L.cx, L.cz, L.rx * 1.08, L.rz * 1.08, L.rot)) return L.level
    for (const P of W.ponds ?? []) if (inEllipse(P.cx, P.cz, P.rx * 1.1, P.rz * 1.1, P.rot)) return P.level
    let best = 1e9, y: number | null = null
    for (const R of [W.river, ...(W.streams ?? [])]) for (let i = 0; i < R.x.length; i++) {
      const d = (R.x[i] - x) ** 2 + (R.z[i] - z) ** 2
      if (d < best && d < (R.hw[i] * 1.6 + 6) ** 2) { best = d; y = R.y[i] }
    }
    return y
  }
  private readonly _wk: [number, number, number, number] = [0, 0, 0, 0]

  /** Mud at (x, z), 0 … 1 (bilinear on the 4 m grid). */
  mudAt(x: number, z: number): number {
    const g = this.meta.mask, n = g.n
    const fx = (x - g.origin) / g.step, fz = (z - g.origin) / g.step
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return 0
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = (j * n + i) * 2, M = this.mud, r = n * 2
    return ((M[k] * (1 - u) + M[k + 2] * u) * (1 - v) + (M[k + r] * (1 - u) + M[k + r + 2] * u) * v) / 255
  }

  readonly meta: MapMeta

  /** Load a world's map (`leaf`: the terrain's finest patch, m — its height pyramid comes with it): fetched and
   *  prepared in the map loader's worker (mapLoad.worker.ts), the arrays handed over without a copy. */
  static async load(base: string, leaf: number, onProgress?: (f: number) => void): Promise<MapData> {
    const w = (loader ??= new Worker(new URL('./mapLoad.worker.ts', import.meta.url), { type: 'module' }))
    const id = ++loads
    const p = await new Promise<PreparedMap>((resolve, reject) => {
      const on = (e: MessageEvent) => {
        if (e.data.id !== id) return
        if (e.data.progress !== undefined) { onProgress?.(e.data.progress); return }
        w.removeEventListener('message', on)
        if (e.data.error) reject(new Error(e.data.error))
        else resolve(e.data.map as PreparedMap)
      }
      w.addEventListener('message', on)
      w.postMessage({ id, base, leaf })
    })
    return new MapData(p)
  }

  /** Inside the playable box's 2 m grid (with a cell of margin). */
  inBox(x: number, z: number): boolean {
    const e = this.half - this.inner.step
    return x > -e && x < e && z > -e && z < e
  }

  /** Ground height (m) — the box's 2 m grid inside it, the world's 16 m grid outside (they agree at the rim). */
  height(x: number, z: number): number {
    return this.inBox(x, z) ? this.inner.sample(x, z) : this.far.sample(x, z)
  }

  /** Coarse distance fields (4 m cells over the box, m, capped — mapPrep.ts): to the nearest TRACK centre line
   *  (≤ 48 m) and to the RIVER / lake shore (≤ 80 m) — the woods, bushes and boulders line the tracks and the banks. */
  private readonly trackFar: Float32Array
  private readonly riverFar: Float32Array
  private readonly farN: number

  /** The bridge deck under (x, z): its top (m), or null off every bridge (the tyres, the dust). */
  bridgeAt(x: number, z: number): number | null {
    for (const b of this.meta.bridges ?? []) {
      const dx = b.x1 - b.x0, dz = b.z1 - b.z0, L2 = dx * dx + dz * dz
      const t = ((x - b.x0) * dx + (z - b.z0) * dz) / L2
      if (t < -0.02 || t > 1.02) continue
      const ox = x - b.x0 - t * dx, oz = z - b.z0 - t * dz
      if (ox * ox + oz * oz <= (b.w * 0.5 + 0.3) ** 2) return deckY(b, t)
    }
    return null
  }
  /** Distance (m, ≤ 48) to the nearest track centre line. */
  trackDist(x: number, z: number): number {
    const i = Math.round((x + this.half) / 4), j = Math.round((z + this.half) / 4)
    return i < 0 || j < 0 || i >= this.farN || j >= this.farN ? 48 : this.trackFar![j * this.farN + i]
  }
  /** Distance (m, ≤ 80) to the river's centre line / the lake's and the ponds' shores. */
  riverDist(x: number, z: number): number {
    const i = Math.round((x + this.half) / 4), j = Math.round((z + this.half) / 4)
    return i < 0 || j < 0 || i >= this.farN || j >= this.farN ? 80 : this.riverFar![j * this.farN + i]
  }

  /** Distance (m, ≤ 8) from x, z to the nearest dirt track's centre line (8 outside the box). */
  trailDist(x: number, z: number): number {
    const g = this.inner
    const i = Math.round((x - g.origin) / g.step), j = Math.round((z - g.origin) / g.step)
    if (i < 0 || j < 0 || i >= g.n || j >= g.n) return 8
    return ((this.trailTex.image.data as Uint8Array)[j * g.n + i] / 255) * 8
  }

  /** The box's mask at x, z (0..1 each: rock, dryness, wet, forest), nearest 4 m cell; zeros outside the box. */
  maskAt(x: number, z: number, out: [number, number, number, number]): [number, number, number, number] {
    const g = this.meta.mask
    const i = Math.round((x - g.origin) / g.step), j = Math.round((z - g.origin) / g.step)
    if (i < 0 || j < 0 || i >= g.n || j >= g.n) { out[0] = out[1] = out[2] = out[3] = 0; return out }
    const k = (j * g.n + i) * 4
    out[0] = this.mask[k] / 255; out[1] = this.mask[k + 1] / 255; out[2] = this.mask[k + 2] / 255; out[3] = this.mask[k + 3] / 255
    return out
  }
}
