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
  /** Which ground the STILL water owns, how deep it is, how near, and the river's own water (RGBA8 on the mask's 4 m
   *  grid — waterOwner). */
  water: Uint8Array
  /** … and which body owns it (the same grid: 0 none, 1 the lake, 2 + i pond i). */
  waterBody: Uint8Array
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

/** How far each water mesh reaches past its line / ellipse (Water.ts draws them so; the banks clip them): the river's
 *  ribbon and the streams' (× their half width), the lake's disc (× its radii); a pond's disc is its ellipse. */
export const RIVER_WIDEN = 1.75, STREAM_WIDEN = 1.6, LAKE_DISC = 1.75

type Flow = { x: number[]; z: number[]; y: number[]; hw: number[]; wk?: number[] }

/** A ribbon's reach (× its half width) where its water was raised to meet a lake over its banks (reconcileWater): the
 *  raised water spreads to the shore the ground gives it, and the ribbon has to reach that shore. */
export const RAMP_WIDEN = 3

/**
 * THE WATER RECONCILED WITH THE GROUND (2026-11-04, the user: "two types of water … not connected, one goes above the
 * other — I want a proper transition, on the ground, not in the air"): where a river or a stream runs into or out of a
 * lake or a pond, the two surfaces must be ONE height at the shore. The valley's river left its 58 m lake at 56.8 m — a
 * 1.2 m step of water at the outlet; the desert's river came into the lagoon 0.2 m over it and left it 0.5 m under.
 * The still water keeps its level (its beach, its dock, the rowboat were all made for it — lowered to its outlet's
 * banks it left a bare ring of lake bed and the boat in the ground); the line comes to it: from where it crosses the
 * body's ellipse (its ground ends there in the channel — waterOwner's corridors) it is eased to the body's level over
 * ≤ 40 m (≤ 5 %: the lake pours out down a short rapid, a river runs down into it), at that level inside, downstream
 * never rising. Where that raises it over its banks the ribbon reaches further (`wk`): the water meets the ground, it
 * never hangs off an edge. A stream that joins the river follows the river there. In place on meta.water, in the
 * loader's worker, before anything reads it. (Each line keeps its points' order — the camps and river stones walk it.)
 */
export function reconcileWater(meta: MapMeta, innerH: Float32Array): void {
  const W = meta.water, e = -meta.inner.origin - meta.inner.step
  const ground = (x: number, z: number) => sampleGrid(innerH, meta.inner, x, z)
  const inBox = (x: number, z: number) => Math.abs(x) < e && Math.abs(z) < e
  const flows: Flow[] = [W.river, ...(W.streams ?? [])]
  const widen = (f: number) => (f === 0 ? RIVER_WIDEN : STREAM_WIDEN)
  // per line: downstream toward index 0 (ds −1) or toward its end (+1), the arc length, its banks' tops (the lower
  // side, 1.5 half widths out)
  const info = flows.map((L) => {
    const n = L.x.length, ds = L.y[0] <= L.y[n - 1] ? -1 : 1
    const s = new Float64Array(n), bank = new Float64Array(n)
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(L.x[i] - L.x[i - 1], L.z[i] - L.z[i - 1])
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
      let tx = L.x[b] - L.x[a], tz = L.z[b] - L.z[a]
      const l = Math.hypot(tx, tz) || 1
      tx /= l; tz /= l
      const w = L.hw[i] * 1.5
      bank[i] = inBox(L.x[i], L.z[i]) ? Math.min(ground(L.x[i] - tz * w, L.z[i] + tx * w), ground(L.x[i] + tz * w, L.z[i] - tx * w)) : Infinity
    }
    return { n, ds, s, bank }
  })
  const downhill = (f: number) => {
    const y = flows[f].y, { n, ds } = info[f]
    if (ds < 0) for (let i = n - 2; i >= 0; i--) y[i] = Math.min(y[i], y[i + 1])
    else for (let i = 1; i < n; i++) y[i] = Math.min(y[i], y[i - 1])
  }
  // ease line f by `delta` at arc length sJ — held for `hold` m, then fading over D m — on the side `dir` (−1 lower
  // indices, +1 higher)
  const ease = (f: number, sJ: number, from: number, dir: number, delta: number, hold = 0) => {
    const L = flows[f], I = info[f], D = Math.min(40, Math.max(8, Math.abs(delta) / 0.05))
    for (let k = from; k >= 0 && k < I.n; k += dir) {
      const d = Math.max(0, Math.abs(I.s[k] - sJ) - hold)
      if (d >= D) break
      const u = 1 - d / D
      L.y[k] += delta * u * u * (3 - 2 * u)
      if (delta > 0 && L.y[k] > I.bank[k]) (L.wk ??= L.hw.map(() => widen(f)))[k] = RAMP_WIDEN // (raised over its banks only)
    }
  }
  const bodies = [W.lake, ...(W.ponds ?? [])]
  for (const P of bodies) {
    const c = Math.cos(P.rot), sn = Math.sin(P.rot)
    const q = (x: number, z: number) => { const dx = x - P.cx, dz = z - P.cz; return Math.hypot((dx * c + dz * sn) / P.rx, (-dx * sn + dz * c) / P.rz) }
    flows.forEach((L, f) => {
      const I = info[f]
      for (let i = 0; i < I.n - 1; i++) {
        const qa = q(L.x[i], L.z[i]), qb = q(L.x[i + 1], L.z[i + 1])
        if (qa < 1 === qb < 1) continue
        const t = (1 - qa) / (qb - qa), y = L.y[i] + (L.y[i + 1] - L.y[i]) * t
        const outside = qa >= 1 ? i : i + 1, dir = outside === i ? -1 : 1
        // (held at the level for 8 m: the still water's ground reaches a cell or so past its ellipse in the channel —
        //  the two surfaces meet at one height where one hands over to the other)
        if (Math.abs(P.level - y) > 0.01) ease(f, I.s[i] + (I.s[i + 1] - I.s[i]) * t, outside, dir, P.level - y, 8)
        for (let k = outside - dir; k >= 0 && k < I.n && q(L.x[k], L.z[k]) < 1; k -= dir) L.y[k] = P.level
      }
    })
  }
  flows.forEach((_, f) => downhill(f))
  // a stream that joins the river: its mouth at the river's surface there (the river may have been eased)
  const R = W.river
  ;(W.streams ?? []).forEach((S, j) => {
    const f = j + 1, I = info[f], m = I.ds < 0 ? 0 : I.n - 1
    let best = Infinity, ry = 0, rhw = 0
    for (let i = 0; i < R.x.length; i++) {
      const d = Math.hypot(R.x[i] - S.x[m], R.z[i] - S.z[m])
      if (d < best) { best = d; ry = R.y[i]; rhw = R.hw[i] }
    }
    if (best > rhw * 1.5 + 4 || Math.abs(ry - S.y[m]) < 0.02) return
    ease(f, I.s[m], m, I.ds < 0 ? 1 : -1, ry - S.y[m])
    downhill(f)
  })
}

/**
 * THE STILL WATER'S OWN GROUND (2026-11-04, the user's screenshots: the valley's lake laid a sheet over the grass and
 * the trees beside its outlet; the desert's river drew its own angular band across the lagoon): a lake's or a pond's
 * disc is flat at its level, so it covered ANY ground below that level within the disc — the low meadow along the
 * river leaving the valley's lake (56–57.9 m by a 58 m lake, reached only down the river's channel), and the river's
 * ribbon lay on the lagoon it runs through. Each still body owns what a flood from its middle reaches over ground below
 * its level, inside its disc — never on along a river's or a stream's channel past its own ellipse where that runs
 * at another level (the ribbon owns that). RG8 on the mask's 4 m grid: R 255 where owned (and a cell round it, so the bilinear edge falls outside the
 * real shore), 0 elsewhere — the lake and the ponds draw only on it, the ribbons only off it; G the depth under that
 * water, 128 + 64 / m (±2 m; 0 off it) — no grass grows on the lagoon's floor (the desert's oasis ran into its shallows).
 */
export function waterOwner(meta: MapMeta, innerH: Float32Array): { tex: Uint8Array; body: Uint8Array } {
  const g = meta.mask, n = g.n, C = g.step, o = g.origin
  const own = new Uint8Array(n * n), level = new Float32Array(n * n).fill(NaN), owner = new Uint8Array(n * n)
  const W = meta.water
  // the ground at a cell: the 2 m grid's node under it (the grids share their origin — every 4 m cell is a node)
  const r2 = Math.round(C / meta.inner.step), n2 = meta.inner.n
  const ground = r2 * (n - 1) === n2 - 1 && meta.inner.origin === o
    ? (i: number, j: number) => innerH[j * r2 * n2 + i * r2]
    : (i: number, j: number) => sampleGrid(innerH, meta.inner, o + i * C, o + j * C)
  // the flowing water's corridors: within its ribbon's reach of every river / stream centre line — and the lowest
  // surface over each cell (a lake goes on into a channel past its ellipse only while the flow there is at its own level
  // — reconcileWater eased it to that at the shore — and stops where it runs lower (an outlet) or higher (a river coming
  // in): the ribbon owns those)
  const corridor = new Uint8Array(n * n), corridorY = new Float32Array(n * n).fill(Infinity)
  const lines: { L: Flow; k: number }[] = [{ L: W.river, k: RIVER_WIDEN }, ...(W.streams ?? []).map((L) => ({ L, k: STREAM_WIDEN }))]
  for (const { L, k } of lines) {
    for (let s = 0; s < L.x.length - 1; s++) {
      const m = Math.max(1, Math.ceil(Math.hypot(L.x[s + 1] - L.x[s], L.z[s + 1] - L.z[s]) / 2))
      const ka = L.wk?.[s] ?? k, kb = L.wk?.[s + 1] ?? k
      for (let t = 0; t <= m; t++) {
        const px = L.x[s] + ((L.x[s + 1] - L.x[s]) * t) / m, pz = L.z[s] + ((L.z[s + 1] - L.z[s]) * t) / m
        const w = L.hw[s] * ka + ((L.hw[s + 1] * kb - L.hw[s] * ka) * t) / m + 2, py = L.y[s] + ((L.y[s + 1] - L.y[s]) * t) / m
        const ci = Math.round((px - o) / C), cj = Math.round((pz - o) / C), r = Math.ceil(w / C)
        for (let j = Math.max(0, cj - r); j <= Math.min(n - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(n - 1, ci + r); i++) {
          if ((o + i * C - px) ** 2 + (o + j * C - pz) ** 2 < w * w) { const kk = j * n + i; corridor[kk] = 1; corridorY[kk] = Math.min(corridorY[kk], py) }
        }
      }
    }
  }
  const bodies = [{ P: W.lake, k: LAKE_DISC }, ...(W.ponds ?? []).map((P) => ({ P, k: 1 }))]
  const stack: number[] = []
  for (const [b, { P, k }] of bodies.entries()) {
    const c = Math.cos(P.rot), s = Math.sin(P.rot), R = Math.max(P.rx, P.rz) * k
    const i0 = Math.max(0, Math.floor((P.cx - R - o) / C)), i1 = Math.min(n - 1, Math.ceil((P.cx + R - o) / C))
    const j0 = Math.max(0, Math.floor((P.cz - R - o) / C)), j1 = Math.min(n - 1, Math.ceil((P.cz + R - o) / C))
    const q = (i: number, j: number) => {
      const dx = o + i * C - P.cx, dz = o + j * C - P.cz
      return Math.hypot((dx * c + dz * s) / P.rx, (-dx * s + dz * c) / P.rz)
    }
    if (i1 < i0 || j1 < j0) continue // (a pond off the grid on an axis: nothing to fill)
    const seen = new Uint8Array((i1 - i0 + 1) * (j1 - j0 + 1)), wn = i1 - i0 + 1
    const ok = (i: number, j: number) => {
      const qq = q(i, j)
      return qq < k && ground(i, j) < P.level && !(corridor[j * n + i] && qq > 1 && Math.abs(corridorY[j * n + i] - P.level) > 0.05)
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (q(i, j) < 0.9 && ground(i, j) < P.level) { seen[(j - j0) * wn + (i - i0)] = 1; stack.push(j * n + i) }
    }
    while (stack.length) {
      const kk = stack.pop()!, i = kk % n, j = (kk / n) | 0
      own[kk] = 255
      level[kk] = P.level
      owner[kk] = b + 1
      for (let d = 0; d < 4; d++) {
        const ii = d === 0 ? i + 1 : d === 1 ? i - 1 : i, jj = d === 2 ? j + 1 : d === 3 ? j - 1 : j
        if (ii < i0 || ii > i1 || jj < j0 || jj > j1) continue
        const sk = (jj - j0) * wn + (ii - i0)
        if (seen[sk]) continue
        seen[sk] = 1
        if (ok(ii, jj)) stack.push(jj * n + ii)
      }
    }
  }
  // B: how near the still water is (1 on it → 0 NEAR m off; a two-pass chamfer distance) — a ribbon takes the still
  // water's look as it comes to it, so the two meet as one water (past it, the outflow's own rapid shows)
  const NEAR = 32, dist = new Float32Array(n * n)
  for (let k = 0; k < n * n; k++) dist[k] = own[k] ? 0 : 1e9
  const D1 = C, D2 = C * Math.SQRT2
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const kk = j * n + i
    dist[kk] = Math.min(dist[kk], dist[kk - 1] + D1, dist[kk - n] + D1, dist[kk - n - 1] + D2, dist[kk - n + 1] + D2)
  }
  for (let j = n - 2; j > 0; j--) for (let i = n - 2; i > 0; i--) {
    const kk = j * n + i
    dist[kk] = Math.min(dist[kk], dist[kk + 1] + D1, dist[kk + n] + D1, dist[kk + n + 1] + D2, dist[kk + n - 1] + D2)
  }
  // A: the river's own water (its half width × 1.2) — a stream that joins it fades out there, never a second layer
  // (alongside its segments only — never past its ends: a creek running on into the river's head faded out over a
  //  disc round the river's first point, before the river was drawn — a pale bar of bed across the water)
  const core = new Uint8Array(n * n), R = W.river
  for (let s = 0; s < R.x.length - 1; s++) {
    const ax = R.x[s], az = R.z[s], vx = R.x[s + 1] - ax, vz = R.z[s + 1] - az, L2 = vx * vx + vz * vz || 1
    const wmax = Math.max(R.hw[s], R.hw[s + 1]) * 1.2
    const i0 = Math.max(0, Math.floor((Math.min(ax, ax + vx) - wmax - o) / C)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, ax + vx) + wmax - o) / C))
    const j0 = Math.max(0, Math.floor((Math.min(az, az + vz) - wmax - o) / C)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, az + vz) + wmax - o) / C))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ex = o + i * C - ax, ez = o + j * C - az, t = (ex * vx + ez * vz) / L2
      // (and from 10 m in at its ends — past where its own ribbon has faded in, Water.ts: a stream running on into its
      //  head stays whole over it until it's there, then fades, never leaving a gap or a clear band)
      const lo = s === 0 ? 10 / Math.sqrt(L2) : 0, hi = s === R.x.length - 2 ? 1 - 10 / Math.sqrt(L2) : 1
      if (t < lo || t > hi) continue
      const w = (R.hw[s] + (R.hw[s + 1] - R.hw[s]) * t) * 1.2
      if ((ex - vx * t) ** 2 + (ez - vz * t) ** 2 < w * w) core[j * n + i] = 255
    }
  }
  // R and G — a cell round what's owned: the filtered edge lands on dry ground (drawn nowhere) at a shore, a cell into
  // the channel where the river takes over
  const out = new Uint8Array(n * n * 4), body = new Uint8Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const kk = j * n + i
    out[kk * 4 + 2] = Math.round(255 * Math.max(0, 1 - dist[kk] / NEAR))
    out[kk * 4 + 3] = core[kk]
    let lv = level[kk], ob = owner[kk]
    if (!own[kk] && i > 0 && j > 0 && i < n - 1 && j < n - 1) {
      for (const d of [-1, 1, -n, n, -n - 1, -n + 1, n - 1, n + 1]) if (own[kk + d]) { lv = level[kk + d]; ob = owner[kk + d]; break }
    }
    if (Number.isNaN(lv)) continue
    out[kk * 4] = 255
    out[kk * 4 + 1] = Math.max(0, Math.min(255, Math.round(128 + (lv - ground(i, j)) * 64)))
    body[kk] = ob
  }
  return { tex: out, body }
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
  reconcileWater(meta, innerH)
  const { tex: water, body: waterBody } = waterOwner(meta, innerH)
  onProgress?.(0.9)
  const pyramid = pyramidOf(meta, innerH, farH, leaf)
  onProgress?.(1)
  return { meta, innerRaw, farRaw, innerH, farH, innerNormals, farNormals, mask: new Uint8Array(m), trail: new Uint8Array(t), mud: new Uint8Array(u), fields, water, waterBody, pyramid }
}

/** Every array buffer in a prepared map (posted from the worker without a copy). */
export function transferables(p: PreparedMap): ArrayBuffer[] {
  const a = [p.innerRaw, p.farRaw, p.innerH, p.farH, p.innerNormals, p.farNormals, p.mask, p.trail, p.mud, p.fields.track, p.fields.river, p.water, p.waterBody, ...p.pyramid.minH, ...p.pyramid.maxH]
  return [...new Set(a.map((x) => x.buffer as ArrayBuffer))]
}
