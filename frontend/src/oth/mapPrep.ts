/**
 * A MAP'S DERIVED DATA, computed from its files — pure functions on arrays (no three, no DOM), run in the map loader's
 * WORKER (mapLoad.worker.ts) so a world loads without stalling the frames (2026-11-02, the user: "use workers and then
 * load the other world"; profiled: ~200 ms of this on the main thread froze the game at a crossing). MapData takes
 * the results as they come.
 */
import type { Grid, MapMeta } from './MapData'

/** Everything MapData and Terrain need, the arrays transferable. */
export interface PreparedMap {
  meta: MapMeta
  innerRaw: Uint16Array
  farRaw: Uint16Array
  innerH: Float32Array
  farH: Float32Array
  innerNormals: Uint8Array
  farNormals: Uint8Array
  mask: Uint8Array
  trail: Uint8Array
  mud: Uint8Array
  /** The tracks' and the shores' distance fields (4 m cells over the box). */
  fields: { n: number; track: Float32Array; river: Float32Array }
  /** The terrain quadtree's min / max heights per node (Terrain.ts; for its leaf size). */
  pyramid: { leaf: number; levels: number; minH: Float32Array[]; maxH: Float32Array[] }
}

/** Heights (m) from the 16-bit samples. */
export function heightsOf(raw: Uint16Array, g: Grid): Float32Array {
  const h = new Float32Array(raw.length), k = g.range / 65535
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] * k + g.min
  return h
}

/** Normals: central differences, x / z components in 0..255 (y rebuilt in the shader). */
export function normalsOf(h: Float32Array, g: Grid): Uint8Array {
  const n = g.n, nb = new Uint8Array(n * n * 2), s2 = 2 * g.step
  for (let j = 0; j < n; j++) {
    const j0 = Math.max(0, j - 1) * n, j1 = Math.min(n - 1, j + 1) * n, r = j * n
    for (let i = 0; i < n; i++) {
      const dx = (h[r + Math.min(n - 1, i + 1)] - h[r + Math.max(0, i - 1)]) / s2
      const dz = (h[j1 + i] - h[j0 + i]) / s2
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz)
      nb[(r + i) * 2] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      nb[(r + i) * 2 + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255)
    }
  }
  return nb
}

/** Bilinear height on one grid (clamped). */
function sampleGrid(h: Float32Array, g: Grid, x: number, z: number): number {
  const n = g.n
  let fx = (x - g.origin) / g.step, fz = (z - g.origin) / g.step
  fx = fx < 0 ? 0 : fx > n - 1.0001 ? n - 1.0001 : fx
  fz = fz < 0 ? 0 : fz > n - 1.0001 ? n - 1.0001 : fz
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * n + i
  const a = h[k] + (h[k + 1] - h[k]) * tx, b = h[k + n] + (h[k + n + 1] - h[k + n]) * tx
  return a + (b - a) * tz
}

/** Coarse distance fields (4 m cells over the box, m, capped): to the nearest TRACK centre line (≤ 48 m) and to the
 *  RIVER / lake / pond shores (≤ 80 m) — the woods, bushes and boulders line the tracks and the banks with them. */
export function distanceFields(meta: MapMeta): PreparedMap['fields'] {
  const half = -meta.inner.origin, C = 4, n = Math.ceil((2 * half) / C) + 1
  const stamp = (out: Float32Array, pts: [number, number][], cap: number) => {
    out.fill(cap)
    const r = Math.ceil(cap / C)
    for (const [x, z] of pts) {
      const ci = Math.round((x + half) / C), cj = Math.round((z + half) / C)
      for (let j = Math.max(0, cj - r); j <= Math.min(n - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(n - 1, ci + r); i++) {
        const d = Math.hypot(i * C - half - x, j * C - half - z)
        if (d < out[j * n + i]) out[j * n + i] = d
      }
    }
  }
  // the polylines resampled every 4 m
  const dense = (xs: number[], zs: number[]) => {
    const out: [number, number][] = []
    for (let k = 0; k < xs.length - 1; k++) {
      const L = Math.hypot(xs[k + 1] - xs[k], zs[k + 1] - zs[k]), m = Math.max(1, Math.ceil(L / 4))
      for (let s = 0; s < m; s++) out.push([xs[k] + ((xs[k + 1] - xs[k]) * s) / m, zs[k] + ((zs[k + 1] - zs[k]) * s) / m])
    }
    return out
  }
  const track = new Float32Array(n * n)
  stamp(track, meta.trails.lines.flatMap((l) => dense(l.map((p) => p[0]), l.map((p) => p[1]))), 48)
  const river = new Float32Array(n * n)
  const r = meta.water.river, L = meta.water.lake
  const shore: [number, number][] = dense(r.x, r.z)
  for (let a = 0; a < 200; a++) { // the lake's ellipse
    const t = (a / 200) * Math.PI * 2, c = Math.cos(L.rot), s = Math.sin(L.rot), ex = Math.cos(t) * L.rx, ez = Math.sin(t) * L.rz
    shore.push([L.cx + ex * c - ez * s, L.cz + ex * s + ez * c])
  }
  for (const P of meta.water.ponds ?? []) { // (and every pond's and small lake's shore)
    const c = Math.cos(P.rot), s = Math.sin(P.rot), rx = P.rx / 1.16, rz = P.rz / 1.16
    const m = Math.max(24, Math.ceil((2 * Math.PI * Math.max(rx, rz)) / 6))
    for (let a = 0; a < m; a++) {
      const t = (a / m) * Math.PI * 2, ex = Math.cos(t) * rx, ez = Math.sin(t) * rz
      shore.push([P.cx + ex * c - ez * s, P.cz + ex * s + ez * c])
    }
  }
  stamp(river, shore, 80)
  return { n, track, river }
}

/** The terrain quadtree's min / max heights: per leaf cell (from both grids), then reduced 2 × 2 up the levels. */
export function pyramidOf(meta: MapMeta, innerH: Float32Array, farH: Float32Array, leaf: number): PreparedMap['pyramid'] {
  const farHalf = -meta.far.origin, half = -meta.inner.origin, origin = -farHalf
  const levels = Math.ceil(Math.log2((2 * farHalf) / leaf)), cells = 2 ** levels
  const mn = new Float32Array(cells * cells).fill(1e9), mx = new Float32Array(cells * cells).fill(-1e9)
  const put = (x: number, z: number, h: number) => {
    const i = Math.floor((x - origin) / leaf), j = Math.floor((z - origin) / leaf)
    // a sample on a cell edge belongs to both cells
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const ii = di === 0 ? i : Math.floor((x - origin - 0.01) / leaf), jj = dj === 0 ? j : Math.floor((z - origin - 0.01) / leaf)
      if (ii < 0 || jj < 0 || ii >= cells || jj >= cells) continue
      const k = jj * cells + ii
      if (h < mn[k]) mn[k] = h
      if (h > mx[k]) mx[k] = h
    }
  }
  for (const [h, g] of [[farH, meta.far], [innerH, meta.inner]] as const) {
    const n = g.n
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(g.origin + i * g.step, g.origin + j * g.step, h[j * n + i])
  }
  // cells with no sample (smaller than the far grid's 16 m, outside the box): their surroundings
  const e = half - meta.inner.step
  const height = (x: number, z: number) => (x > -e && x < e && z > -e && z < e ? sampleGrid(innerH, meta.inner, x, z) : sampleGrid(farH, meta.far, x, z))
  for (let k = 0; k < mn.length; k++) if (mn[k] > mx[k]) { const x = origin + ((k % cells) + 0.5) * leaf, z = origin + (Math.floor(k / cells) + 0.5) * leaf; mn[k] = mx[k] = height(x, z) }
  const minH = [mn], maxH = [mx]
  for (let l = 1; l <= levels; l++) {
    const c = cells >> l, pmn = minH[l - 1], pmx = maxH[l - 1], pc = c * 2
    const a = new Float32Array(c * c), b = new Float32Array(c * c)
    for (let j = 0; j < c; j++) for (let i = 0; i < c; i++) {
      const k0 = 2 * j * pc + 2 * i
      a[j * c + i] = Math.min(pmn[k0], pmn[k0 + 1], pmn[k0 + pc], pmn[k0 + pc + 1])
      b[j * c + i] = Math.max(pmx[k0], pmx[k0 + 1], pmx[k0 + pc], pmx[k0 + pc + 1])
    }
    minH.push(a); maxH.push(b)
  }
  return { leaf, levels, minH, maxH }
}

/** Fetch a map's files and compute all of the above (the worker's job; also usable in place). */
export async function prepareMap(base: string, leaf: number, onProgress?: (f: number) => void): Promise<PreparedMap> {
  const meta = (await (await fetch(`${base}/meta.json`)).json()) as MapMeta
  let done = 0
  const get = async (f: string) => {
    const b = await (await fetch(`${base}/${f}`)).arrayBuffer()
    onProgress?.((++done / 5) * 0.7)
    return b
  }
  const [h, f, m, t, u] = await Promise.all([get('height.bin'), get('far.bin'), get('mask.bin'), get('trail.bin'), meta.mud ? get('mud.bin') : Promise.resolve(new ArrayBuffer(0))])
  const innerRaw = new Uint16Array(h), farRaw = new Uint16Array(f)
  const innerH = heightsOf(innerRaw, meta.inner), farH = heightsOf(farRaw, meta.far)
  const innerNormals = normalsOf(innerH, meta.inner), farNormals = normalsOf(farH, meta.far)
  onProgress?.(0.8)
  const fields = distanceFields(meta)
  onProgress?.(0.9)
  const pyramid = pyramidOf(meta, innerH, farH, leaf)
  onProgress?.(1)
  return { meta, innerRaw, farRaw, innerH, farH, innerNormals, farNormals, mask: new Uint8Array(m), trail: new Uint8Array(t), mud: new Uint8Array(u), fields, pyramid }
}

/** Every array buffer in a prepared map (posted from the worker without a copy). */
export function transferables(p: PreparedMap): ArrayBuffer[] {
  const a = [p.innerRaw, p.farRaw, p.innerH, p.farH, p.innerNormals, p.farNormals, p.mask, p.trail, p.mud, p.fields.track, p.fields.river, ...p.pyramid.minH, ...p.pyramid.maxH]
  return [...new Set(a.map((x) => x.buffer as ArrayBuffer))]
}
