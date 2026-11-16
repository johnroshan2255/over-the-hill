/**
 * THE NARROW WAYS (2026-11-14, the user: "we now have the main road to go to places … but we have lot of place like
 * lake and some vallies and all. we want some narrow paths, alleyways, shortcuts, or secret passages to some places, and
 * all must be connected to main road in some ways"). Found as the map loads, in the loader's worker (mapPrep.ts), after
 * the ground is shaped and before anything is derived from it:
 *  - PATHS — one car wide: from each lake's and pond's shore no road comes near, each valley floor no road crosses, the
 *    outland's places a road passes too far from — on to the nearest road or path;
 *  - SHORTCUTS — between two roads close by as the crow flies but far apart by road (a loop round a hill, the far side
 *    of a long dead end);
 *  - SECRET PASSAGES — where a ridge stands between two such roads: a narrow GORGE cut through it (only ever lowering the
 *    ground — the vales' rule: a parabola into a 56° wall, the lip rounded), a bend in it so you can't see through from
 *    its mouth; drawn on no map, no route takes it;
 *  - ALLEYS — the Wardens' towns' back lanes, out to their streets (Wardens.ts → MapData.addPaths: not here).
 * Each is routed over the 8 m grid by cost — length × (1 + grade² + side slope²) × a slow wander, the water, the steep and
 * what stands there walls, a ford dear, the ways already found cheap (they merge) — then smoothed and resampled every
 * 4 m. The ground paints them from the road texture's G (pathField; MapData.pathCentre / Terrain.ts pathCentre).
 * Pure functions on arrays: no three, no DOM.
 */
import type { MapMeta } from './MapData'

/** Half a path's width (m) — one car wide, its edge ragged with the grass's clumps (paint.ts trackEdge) — and how far the
 *  field reaches (m: 0 … 255 ↔ 0 … PATH_REACH from the centre line). */
export const PATH_HW = 1.7, PATH_REACH = 10
export type PathKind = 'path' | 'short' | 'secret' | 'alley'
export interface Paths { hw: number; lines: [number, number][][]; kind: PathKind[]; to: string[] }

const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const hash2 = (i: number, j: number) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
/** Value noise, 0 … 1, a cell 1 wide. */
function vnoise(x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v)
  return (hash2(i, j) * (1 - a) + hash2(i + 1, j) * a) * (1 - b) + (hash2(i, j + 1) * (1 - a) + hash2(i + 1, j + 1) * a) * b
}

/** A min-heap of (cost, cell). */
class Heap {
  k = new Float64Array(1 << 14); v = new Int32Array(1 << 14); n = 0
  push(key: number, val: number): void {
    if (this.n === this.k.length) { const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2); k.set(this.k); v.set(this.v); this.k = k; this.v = v }
    let i = this.n++
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p }
    this.k[i] = key; this.v[i] = val
  }
  /** the cell of the least cost (its cost in `top`) */
  top = 0
  pop(): number {
    const out = this.v[0]; this.top = this.k[0]
    const key = this.k[--this.n], val = this.v[this.n]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= this.n) break
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++
      if (this.k[c] >= key) break
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c
    }
    this.k[i] = key; this.v[i] = val
    return out
  }
}

/** Points [x, z] within r of (x, z) — a hash of 64 m cells. */
class PointHash {
  private readonly m = new Map<number, [number, number][]>()
  add(p: [number, number]): void { const k = Math.floor(p[0] / 64) * 8192 + Math.floor(p[1] / 64); const l = this.m.get(k); if (l) l.push(p); else this.m.set(k, [p]) }
  nearest(x: number, z: number, r: number): [number, number] | null {
    const ci = Math.floor(x / 64), cj = Math.floor(z / 64), q = Math.ceil(r / 64)
    let best: [number, number] | null = null, bd = r * r
    for (let i = ci - q; i <= ci + q; i++) for (let j = cj - q; j <= cj + q; j++) for (const p of this.m.get(i * 8192 + j) ?? []) { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = p } }
    return best
  }
}

// the cells' flags
const BLOCK = 1, ROAD = 2, USED = 4, FORD = 8, BROOK = 16

/** Chaikin's corners cut `it` times (the ends kept), then a point every `step` m, then RELAXED `relax` times (each
 *  point toward its neighbours, ¼ ½ ¼ — the ends kept): no bend tighter than ~20 m. A way bends as a walker's does —
 *  and the field's four-texel read (pathCentreAt) is exact only where a way is near straight over a texel or two. */
export function smoothLine(P: [number, number][], it: number, step: number, relax = 8): [number, number][] {
  let L = P
  for (let k = 0; k < it && L.length > 2; k++) {
    const o: [number, number][] = [L[0]]
    for (let i = 0; i + 1 < L.length; i++) {
      const [ax, az] = L[i], [bx, bz] = L[i + 1]
      if (i > 0) o.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25])
      if (i + 2 < L.length) o.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75])
    }
    o.push(L[L.length - 1])
    L = o
  }
  const out: [number, number][] = [L[0]]
  let carry = 0
  for (let i = 0; i + 1 < L.length; i++) {
    const [ax, az] = L[i], [bx, bz] = L[i + 1], d = Math.hypot(bx - ax, bz - az)
    let t = step - carry
    while (t < d) { out.push([ax + ((bx - ax) * t) / d, az + ((bz - az) * t) / d]); t += step }
    carry = d - (t - step)
  }
  const e = L[L.length - 1], q = out[out.length - 1]
  if (Math.hypot(e[0] - q[0], e[1] - q[1]) > step * 0.3) out.push([e[0], e[1]]); else out[out.length - 1] = [e[0], e[1]]
  for (let r = 0; r < relax && out.length > 2; r++) {
    let px = out[0][0], pz = out[0][1]
    for (let i = 1; i + 1 < out.length; i++) {
      const cx = out[i][0], cz = out[i][1]
      out[i] = [(px + 2 * cx + out[i + 1][0]) / 4, (pz + 2 * cz + out[i + 1][1]) / 4]
      px = cx; pz = cz
    }
  }
  return out
}

/** A line's length (m). */
const lineLen = (L: [number, number][]) => { let s = 0; for (let i = 0; i + 1 < L.length; i++) s += Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); return s }

/**
 * THE WAYS FOUND (see the top of the file): the lines, their kinds, where each goes. Cuts the secret passages into the
 * heights (`farRaw` everywhere, `innerRaw` inside the box — both before any normal or bound is derived), levels the
 * box's paths across (a gentle bench: a car doesn't lean off one), and paints the passages' walls rock in the box's mask
 * (`mask`, mask.bin's RGBA: R rock). The valley only (the desert keeps its tracks).
 */
export function planPaths(meta: MapMeta, innerRaw: Uint16Array, farRaw: Uint16Array, mask: Uint8Array | null, keepOff: { x: number; z: number; r: number }[]): Paths {
  const out: Paths = { hw: PATH_HW, lines: [], kind: [], to: [] }
  const O = meta.outland
  if (meta.id !== 'valley' || !O) return out
  const ig = meta.inner, fg = meta.far, half = -ig.origin, P = O.play, S = 8
  const N = Math.round((2 * P) / S) + 1
  const ikq = ig.range / 65535, fkq = fg.range / 65535
  // the grid's nodes sit on the world's 8 m grid (and the box's 2 m one): their heights read straight from the samples
  const fo = Math.round((-P - fg.origin) / fg.step), io = (-P - ig.origin) / ig.step
  const Hc = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -P + i * S, z = -P + j * S
    if (Math.abs(x) <= half && Math.abs(z) <= half) { const ii = io + i * 4, jj = io + j * 4; Hc[j * N + i] = innerRaw[jj * ig.n + ii] * ikq + ig.min }
    else Hc[j * N + i] = farRaw[(fo + j) * fg.n + fo + i] * fkq + fg.min
  }
  // (the drawn ground's height anywhere — bilinear, the box's finer grid inside it)
  const H = (x: number, z: number): number => {
    const box = Math.abs(x) < half - 2 && Math.abs(z) < half - 2, g = box ? ig : fg, raw = box ? innerRaw : farRaw, kq = box ? ikq : fkq, n = g.n
    const fx = Math.min(n - 1.001, Math.max(0, (x - g.origin) / g.step)), fz = Math.min(n - 1.001, Math.max(0, (z - g.origin) / g.step)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = j * n + i
    return ((raw[a] * (1 - u) + raw[a + 1] * u) * (1 - v) + (raw[a + n] * (1 - u) + raw[a + n + 1] * u) * v) * kq + g.min
  }
  const cellOf = (x: number, z: number) => { const i = Math.round((x + P) / S), j = Math.round((z + P) / S); return i < 1 || j < 1 || i >= N - 1 || j >= N - 1 ? -1 : j * N + i }
  const cx = (c: number) => -P + (c % N) * S, cz = (c: number) => -P + Math.floor(c / N) * S
  const F = new Uint8Array(N * N)
  /** each cell within r of the segment a → b: fn(cell, distance) */
  const stamp = (ax: number, az: number, bx: number, bz: number, r: number, fn: (c: number, d: number) => void) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r + P) / S)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + r + P) / S))
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r + P) / S)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + r + P) / S))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -P + i * S, z = -P + j * S, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t)
      if (d <= r) fn(j * N + i, d)
    }
  }
  // THE ROADS: the box's tracks and the outland's — what every way ends on
  const roads: [number, number][][] = [...meta.trails.lines, ...(O.trails?.lines ?? [])]
  const roadPts = new PointHash()
  for (const L of roads) for (const q of L) roadPts.add(q)
  meta.trails.lines.forEach((L) => { for (let k = 0; k + 1 < L.length; k++) stamp(L[k][0], L[k][1], L[k + 1][0], L[k + 1][1], meta.trails.hw - 0.5, (c) => { F[c] |= ROAD }) })
  for (const L of O.trails?.lines ?? []) for (let k = 0; k + 1 < L.length; k++) stamp(L[k][0], L[k][1], L[k + 1][0], L[k + 1][1], (O.trails?.hw ?? 3.3) - 0.5, (c) => { F[c] |= ROAD })
  // THE WALLS: the water (the lake, the ponds, the outland's lakes — under their level + 0.5 m), the land's rim, what stands
  const ponds = [meta.water.lake, ...(meta.water.ponds ?? [])]
  for (const W of ponds) {
    const R = Math.max(W.rx, W.rz) * 1.5 + 8
    for (let z = W.cz - R; z <= W.cz + R; z += S) for (let x = W.cx - R; x <= W.cx + R; x += S) { const c = cellOf(x, z); if (c >= 0 && Hc[c] < W.level + 0.5) F[c] |= BLOCK }
  }
  const lakeOff = (L: NonNullable<typeof O.lakes>[number], x: number, z: number) => {
    if (L.cut && (x - L.x) * L.cut[0] + (z - L.z) * L.cut[1] > L.cut[2]) return Infinity
    if (L.x1 === undefined || L.z1 === undefined) return Math.hypot(x - L.x, z - L.z)
    const bx = L.x1 - L.x, bz = L.z1 - L.z, t = Math.max(0, Math.min(1, ((x - L.x) * bx + (z - L.z) * bz) / Math.max(1e-6, bx * bx + bz * bz)))
    return Math.hypot(x - L.x - bx * t, z - L.z - bz * t)
  }
  for (const L of O.lakes ?? []) {
    const R = L.r * 1.25 + 16
    stamp(L.x, L.z, L.x1 ?? L.x, L.z1 ?? L.z, R, (c) => { if (Hc[c] < L.level + 0.5 && lakeOff(L, cx(c), cz(c)) < R) F[c] |= BLOCK })
  }
  // (the river a ford — dear; a stream a smaller one)
  const brook = (s: { x: number[]; z: number[]; hw: number[] }, flag: number) => { for (let k = 0; k + 1 < s.x.length; k++) stamp(s.x[k], s.z[k], s.x[k + 1], s.z[k + 1], s.hw[k] + 3, (c) => { F[c] |= flag }) }
  brook(meta.water.river, FORD)
  for (const s of meta.water.streams ?? []) brook(s, BROOK)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (i < 8 || j < 8 || i >= N - 8 || j >= N - 8) F[j * N + i] |= BLOCK
  for (const k of keepOff) stamp(k.x, k.z, k.x, k.z, k.r, (c) => { F[c] |= BLOCK; F[c] &= ~ROAD })
  for (const b of meta.bridges ?? []) stamp(b.x0, b.z0, b.x1, b.z1, b.w / 2 + 10, (c) => { F[c] |= BLOCK; F[c] &= ~ROAD })
  for (const l of meta.landmarks ?? []) stamp(l.x, l.z, l.x, l.z, l.r + 5, (c) => { if (!(F[c] & ROAD)) F[c] |= BLOCK })

  // THE SEARCH: least cost from `src` to a cell `goal` accepts — A* toward `to` if given, else outward (Dijkstra)
  const dist = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), touched: number[] = []
  const heap = new Heap()
  const NB = [1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1], NL = [S, S, S, S, S * Math.SQRT2, S * Math.SQRT2, S * Math.SQRT2, S * Math.SQRT2]
  const slopeAt = (c: number) => Math.hypot(Hc[c + 1] - Hc[c - 1], Hc[c + N] - Hc[c - N]) / (2 * S)
  // (the slow WANDER — each cell's cost × 0.72 … 1.32 by a noise ~260 m across: the ways bend as a walker's do — worked
  //  out as the search first comes to a cell, kept: 1 … 255)
  const wand = new Uint8Array(N * N)
  const wander = (c: number) => { let w = wand[c]; if (!w) w = wand[c] = 1 + Math.round(254 * vnoise(cx(c) / 260 + 17.3, cz(c) / 260 - 4.1)); return 0.72 + 0.6 * (w - 1) / 254 }
  const search = (src: number, goal: (c: number) => boolean, budget: number, to?: [number, number], onRoad = 1): number[] | null => {
    for (const c of touched) { dist[c] = Infinity; from[c] = -1 }
    touched.length = 0
    heap.n = 0
    dist[src] = 0; touched.push(src); heap.push(0, src)
    const hk = 0.72   // (the least a metre can cost: the wander's floor — the estimate never overshoots)
    const est = (c: number) => (to ? Math.hypot(cx(c) - to[0], cz(c) - to[1]) * hk : 0)
    while (heap.n) {
      const c = heap.pop(), g = dist[c]
      if (heap.top > g + est(c) + 1e-3) continue
      if (c !== src && goal(c)) {
        const cells: number[] = []
        for (let q = c; q >= 0; q = from[q]) cells.push(q)
        return cells.reverse()
      }
      if (g > budget) return null
      for (let k = 0; k < 8; k++) {
        const b = c + NB[k], fb = F[b]
        if (fb & BLOCK) continue
        const i = b % N
        if (i < 1 || i >= N - 1 || b < N || b >= N * (N - 1)) continue
        const len = NL[k], gr = Math.abs(Hc[b] - Hc[c]) / len
        if (gr > 0.3) continue
        const s = slopeAt(b)
        if (s > 0.5) continue
        let w = len * (1 + 28 * gr * gr + 9 * s * s) * wander(b)
        if (fb & FORD) w *= 6
        else if (fb & BROOK) w *= 2.5
        if (fb & USED) w *= 0.45
        else if (fb & ROAD) w *= onRoad
        const nd = g + w
        if (nd < dist[b]) { if (dist[b] === Infinity) touched.push(b); dist[b] = nd; from[b] = c; heap.push(nd + est(b), b) }
      }
    }
    return null
  }
  const pathPts = new PointHash()
  /** the way from a cell list: its points, the far end carried on to the nearest road / path point (a clean join) */
  const keep = (pts: [number, number][], kind: PathKind, to: string, joinEnd = true): [number, number][] => {
    if (joinEnd) { const e = pts[pts.length - 1], q = roadPts.nearest(e[0], e[1], 14) ?? pathPts.nearest(e[0], e[1], 14); if (q) pts.push([q[0], q[1]]) }
    const L = smoothLine(pts, 3, 4)
    out.lines.push(L); out.kind.push(kind); out.to.push(to)
    if (kind !== 'secret') {
      for (let k = 0; k + 1 < L.length; k++) stamp(L[k][0], L[k][1], L[k + 1][0], L[k + 1][1], 6, (c) => { F[c] |= USED })
      for (const q of L) pathPts.add(q)
    }
    return L
  }
  const nearWay = (x: number, z: number, r: number) => !!(roadPts.nearest(x, z, r) ?? pathPts.nearest(x, z, r))
  /** a path from (x, z) to the nearest road or path — false if none within reach */
  const toRoad = (x: number, z: number, to: string, budget = 2600): boolean => {
    const c = cellOf(x, z)
    if (c < 0) return false
    const cells = search(c, (q) => !!(F[q] & (ROAD | USED)), budget)
    if (!cells || cells.length < 4) return false
    const pts: [number, number][] = cells.map((q) => [cx(q), cz(q)])
    pts[0] = [x, z]
    keep(pts, 'path', to)
    return true
  }

  // 1 · THE LAKES' AND PONDS' SHORES: the shore nearest a road — a path from it if that's 45 m+ away; a big lake's far
  //     shore too (a way round to it)
  type Body = { name: string; level: number; centres: [number, number][]; reach: number; big: boolean }
  const bodies: Body[] = [
    ...(O.lakes ?? []).filter((L) => L.r > 40).map((L) => ({ name: L.name, level: L.level, centres: (L.x1 !== undefined && L.z1 !== undefined ? [[L.x, L.z], [(L.x + L.x1) / 2, (L.z + L.z1) / 2], [L.x1, L.z1]] : [[L.x, L.z]]) as [number, number][], reach: L.r * 1.7 + 40, big: L.r > 140 })),
    ...ponds.map((W, i) => ({ name: i ? 'a pond' : 'the lake', level: W.level, centres: [[W.cx, W.cz]] as [number, number][], reach: Math.max(W.rx, W.rz) * 1.8 + 30, big: i === 0 })),
  ]
  for (const B of bodies) {
    const shore: { x: number; z: number; d: number }[] = []
    for (const [ox, oz] of B.centres) for (let k = 0; k < 40; k++) {
      const dx = Math.cos(k * 0.157), dz = Math.sin(k * 0.157)
      for (let r = 6; r < B.reach; r += 4) {
        const x = ox + dx * r, z = oz + dz * r
        if (H(x, z) > B.level + 0.9 && H(x + dx * 6, z + dz * 6) > B.level + 1.2) {
          const sx = x + dx * 7, sz = z + dz * 7, c = cellOf(sx, sz)
          if (c >= 0 && !(F[c] & BLOCK)) { const q = roadPts.nearest(sx, sz, 900); shore.push({ x: sx, z: sz, d: q ? Math.hypot(q[0] - sx, q[1] - sz) : 900 }) }
          break
        }
      }
    }
    if (!shore.length) continue
    shore.sort((a, b) => a.d - b.d)
    if (shore[0].d > 45 && !pathPts.nearest(shore[0].x, shore[0].z, 45)) toRoad(shore[0].x, shore[0].z, B.name)
    if (B.big) {
      // (the shore farthest round from where the roads come — a second way down to the water)
      const far = shore.filter((s) => s.d < 700 && s.d > 120 && !nearWay(s.x, s.z, 160)).sort((a, b) => b.d - a.d)[0]
      if (far) toRoad(far.x, far.z, B.name)
    }
  }

  // 2 · THE OUTLAND'S PLACES a road passes far from: the World Tree's foot, the crater's meadow, the boulder field, the
  //     bog's edge — and the box's fallen star
  for (const q of O.places ?? []) {
    if (!['worldtree', 'crater', 'rocks', 'bog', 'canyon'].includes(q.kind)) continue
    const rp = roadPts.nearest(q.x, q.z, 1200)
    if (!rp) continue
    const d = Math.hypot(rp[0] - q.x, rp[1] - q.z), ux = (rp[0] - q.x) / (d || 1), uz = (rp[1] - q.z) / (d || 1)
    const r0 = q.kind === 'worldtree' ? 110 : q.kind === 'bog' ? q.r * 0.75 : q.kind === 'canyon' ? q.r * 0.3 : 0
    if (d - r0 < 60) continue
    const x = q.x + ux * r0, z = q.z + uz * r0
    if (!nearWay(x, z, 50)) toRoad(x, z, q.name)
  }
  for (const l of meta.landmarks ?? []) {
    if (l.kind !== 'meteorite') continue
    const rp = roadPts.nearest(l.x, l.z, 900)
    if (!rp) continue
    const d = Math.hypot(rp[0] - l.x, rp[1] - l.z)
    if (d > 60) toRoad(l.x + ((rp[0] - l.x) / d) * (l.r + 7), l.z + ((rp[1] - l.z) / d) * (l.r + 7), l.name)
  }

  // 3 · THE VALLEYS: the floors of the land's hollows — 25 m+ under the ground 260 m round, enclosed on most sides,
  //     gentle, dry — no road within 250 m but one within 650 m: the deepest, 1 km apart (24 tried at most)
  {
    const cands: { x: number; z: number; sc: number }[] = []
    for (let z = -P + 400; z < P - 400; z += 64) for (let x = -P + 400; x < P - 400; x += 64) {
      const c = cellOf(x, z)
      if (c < 0 || F[c] & (BLOCK | FORD | BROOK) || slopeAt(c) > 0.12) continue
      const h = Hc[c]
      let sum = 0, hi = 0
      for (let k = 0; k < 12; k++) { const q = cellOf(x + Math.cos(k * 0.5236) * 260, z + Math.sin(k * 0.5236) * 260), hh = q < 0 ? h : Hc[q]; sum += hh; if (hh > h + 15) hi++ }
      const dep = sum / 12 - h
      if (dep < 25 || hi < 8 || nearWay(x, z, 250) || !roadPts.nearest(x, z, 650)) continue
      if (keepOff.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 150) ** 2)) continue
      cands.push({ x, z, sc: dep })
    }
    cands.sort((a, b) => b.sc - a.sc)
    const got: { x: number; z: number }[] = [], failed: { x: number; z: number }[] = []
    let tried = 0
    for (const v of cands) {
      if (got.length >= 12 || tried >= 30) break
      if (got.some((g) => (g.x - v.x) ** 2 + (g.z - v.z) ** 2 < 1000 * 1000) || nearWay(v.x, v.z, 200)) continue
      // (a hollow no way gets out of in budget: its neighbours on the lattice don't either — not tried again)
      if (failed.some((g) => (g.x - v.x) ** 2 + (g.z - v.z) ** 2 < 700 * 700)) continue
      tried++
      if (toRoad(v.x, v.z, 'a valley', 1700)) got.push(v); else failed.push(v)
    }
  }

  // 4 · SHORTCUTS and SECRET PASSAGES: the roads as a graph (a node every ~40 m, junctions where two lines come within
  //     30 m); from every other node, how far by road to the nodes 140–500 m away as the crow flies — where it's 3.5 ×
  //     that and 700 m+ more, a way across is worth finding
  {
    const nx: number[] = [], nz: number[] = [], nl: number[] = []
    const adj: number[][] = []
    roads.forEach((L, li) => {
      let acc = 40, prev = -1
      for (let k = 0; k < L.length; k++) {
        if (k) acc += Math.hypot(L[k][0] - L[k - 1][0], L[k][1] - L[k - 1][1])
        if (acc < 40 && k !== L.length - 1) continue
        const id = nx.length
        nx.push(L[k][0]); nz.push(L[k][1]); nl.push(li); adj.push([])
        if (prev >= 0) { const d = Math.hypot(nx[id] - nx[prev], nz[id] - nz[prev]); adj[id].push(prev, d); adj[prev].push(id, d) }
        prev = id; acc = 0
      }
    })
    const NH = new Map<number, number[]>()
    const hk = (x: number, z: number) => Math.floor(x / 128) * 8192 + Math.floor(z / 128)
    for (let a = 0; a < nx.length; a++) { const k = hk(nx[a], nz[a]); const l = NH.get(k); if (l) l.push(a); else NH.set(k, [a]) }
    const around = (x: number, z: number, r: number, fn: (b: number) => void) => {
      const ci = Math.floor(x / 128), cj = Math.floor(z / 128), q = Math.ceil(r / 128)
      for (let i = ci - q; i <= ci + q; i++) for (let j = cj - q; j <= cj + q; j++) for (const b of NH.get(i * 8192 + j) ?? []) fn(b)
    }
    for (let a = 0; a < nx.length; a++) around(nx[a], nz[a], 30, (b) => { if (b > a && nl[b] !== nl[a]) { const d = Math.hypot(nx[a] - nx[b], nz[a] - nz[b]); if (d < 30) { adj[a].push(b, d); adj[b].push(a, d) } } })
    const nd = new Float64Array(nx.length).fill(Infinity), seen: number[] = [], h = new Heap()
    type Cand = { a: number; b: number; d: number; gain: number }
    const cands: Cand[] = [], secrets: Cand[] = []
    /** how high the ground stands over the straight line a → b at most (m), and how far it dips under it */
    const ridge = (a: number, b: number): [number, number] => {
      const ha = H(nx[a], nz[a]), hb = H(nx[b], nz[b])
      let up = 0, dn = 0
      for (let k = 1; k < 16; k++) { const t = k / 16, y = H(nx[a] + (nx[b] - nx[a]) * t, nz[a] + (nz[b] - nz[a]) * t) - (ha + (hb - ha) * t); up = Math.max(up, y); dn = Math.min(dn, y) }
      return [up, dn]
    }
    // (only whether it's more than 3.5 × a crow's 500 m and 700 m more matters: the search stops at 1800 m)
    for (let a = 0; a < nx.length; a += 3) {
      for (const s of seen) nd[s] = Infinity
      seen.length = 0; h.n = 0
      nd[a] = 0; seen.push(a); h.push(0, a)
      while (h.n) {
        const u = h.pop(), du = h.top
        if (du > nd[u] || du > 1800) continue
        const e = adj[u]
        for (let k = 0; k < e.length; k += 2) { const v = e[k], dv = du + e[k + 1]; if (dv < nd[v]) { if (nd[v] === Infinity) seen.push(v); nd[v] = dv; h.push(dv, v) } }
      }
      let best: Cand | null = null, sec: Cand | null = null
      around(nx[a], nz[a], 500, (b) => {
        const d = Math.hypot(nx[a] - nx[b], nz[a] - nz[b])
        if (d < 140 || d > 500) return
        const net = Math.min(nd[b], 4000)
        if (net < 3 * d || net - d < 600) return
        const gain = net - 1.6 * d
        if (net >= 3.5 * d && net - d >= 700 && (!best || gain > best.gain)) best = { a, b, d, gain }
        // (a SECRET PASSAGE's: the ends near level — ≤ 12 % — and a ridge 12–40 m over the line between, no deep dip)
        if (d > 160 && d < 420 && Math.abs(H(nx[b], nz[b]) - H(nx[a], nz[a])) < 0.12 * d && (!sec || gain > sec.gain)) {
          const [up, dn] = ridge(a, b)
          if (up > 12 && up < 40 && dn > -5) sec = { a, b, d, gain: gain + up * 10 }
        }
      })
      if (best) cands.push(best)
      if (sec) secrets.push(sec)
    }
    cands.sort((p, q) => q.gain - p.gain)
    secrets.sort((p, q) => q.gain - p.gain)
    const ends: [number, number][] = []
    let nShort = 0, nSecret = 0, tries = 0
    const wall = (u: number) => (u <= 0 ? 0 : u < 12 ? (u * u) / 16 : 9 + (u - 12) * 1.5)
    /** a GORGE along L (its floor from ha to hb, `fhw` m half wide) cut into one grid's samples: only ever lowering */
    const cut = (L: [number, number][], ha: number, hb: number, raw: Uint16Array, g: typeof ig, fhw: number, box: boolean) => {
      const kq = g.range / 65535, n = g.n, acc = [0]
      for (let k = 0; k + 1 < L.length; k++) acc.push(acc[k] + Math.hypot(L[k + 1][0] - L[k][0], L[k + 1][1] - L[k][1]))
      const tot = acc[acc.length - 1], R = fhw + 60
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
      for (const [x, z] of L) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
      const i0 = Math.max(1, Math.floor((x0 - R - g.origin) / g.step)), i1 = Math.min(n - 2, Math.ceil((x1 + R - g.origin) / g.step))
      const j0 = Math.max(1, Math.floor((z0 - R - g.origin) / g.step)), j1 = Math.min(n - 2, Math.ceil((z1 + R - g.origin) / g.step))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = g.origin + i * g.step, z = g.origin + j * g.step
        if (box && (Math.abs(x) > half || Math.abs(z) > half)) continue
        let bd = Infinity, bt = 0
        for (let k = 0; k + 1 < L.length; k++) {
          const [ax, az] = L[k], sx = L[k + 1][0] - ax, sz = L[k + 1][1] - az, t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz || 1e-9)))
          const d = Math.hypot(x - ax - sx * t, z - az - sz * t)
          if (d < bd) { bd = d; bt = (acc[k] + (acc[k + 1] - acc[k]) * t) / tot }
        }
        if (bd > R) continue
        // (the floor eased in from each end's road: whole 30 m in)
        const old = raw[j * n + i] * kq + g.min, fl = ha + (hb - ha) * bt + 0.2
        const shape = fl + wall(bd - fhw)
        if (shape > old + 8) continue
        const hkk = Math.max(0, Math.min(1, 0.5 + (old - shape) / 12)), smv = old + (shape - old) * hkk - 6 * hkk * (1 - hkk)
        const nh = Math.min(old, smv)
        if (nh < old - 0.01) {
          raw[j * n + i] = Math.max(0, Math.round((nh - g.min) / kq))
          // (the box's mask: the cut's walls rock)
          if (box && mask && old - nh > 2.5 && bd > fhw + 1) {
            const mn = meta.mask.n, mi = Math.round((x - meta.mask.origin) / meta.mask.step), mj = Math.round((z - meta.mask.origin) / meta.mask.step)
            if (mi >= 0 && mj >= 0 && mi < mn && mj < mn) { const q = (mj * mn + mi) * 4; mask[q] = Math.max(mask[q], Math.round(255 * sm(2.5, 7, old - nh))) }
          }
        }
      }
    }
    const far = (ax: number, az: number, bx: number, bz: number, r: number) => !ends.some(([x, z]) => (x - ax) ** 2 + (z - az) ** 2 < r * r || (x - bx) ** 2 + (z - bz) ** 2 < r * r)
    // a SHORTCUT over the ground as it is: no longer than 1.8 × the straight line, 700 m from another's ends
    for (const c of cands) {
      if (nShort >= 16 || tries > 80) break
      const ax = nx[c.a], az = nz[c.a], bx = nx[c.b], bz = nz[c.b], sa = cellOf(ax, az)
      if (sa < 0 || !far(ax, az, bx, bz, 700)) continue
      tries++
      const cells = search(sa, (q) => Math.abs(cx(q) - bx) <= S && Math.abs(cz(q) - bz) <= S, c.d * 2.1, [bx, bz], 3)
      if (!cells) continue
      const pts = cells.map((q) => [cx(q), cz(q)] as [number, number])
      pts[0] = [ax, az]; pts[pts.length - 1] = [bx, bz]
      if (lineLen(pts) < 1.8 * c.d) { keep(pts, 'short', 'a shortcut', false); ends.push([ax, az], [bx, bz]); nShort++ }
    }
    // a SECRET PASSAGE where a ridge stands between: a curve (a bend a sixth of its length out to one side — from its
    // mouth you can't see through), the cut 10–42 m deep at most, no water, no other road or way near it; 1.5 km apart
    for (const c of secrets) {
      if (nSecret >= 5) break
      const ax = nx[c.a], az = nz[c.a], bx = nx[c.b], bz = nz[c.b]
      if (!far(ax, az, bx, bz, 400) || out.lines.some((L, i) => out.kind[i] === 'secret' && Math.hypot(L[0][0] - ax, L[0][1] - az) < 1500)) continue
      const ha = H(ax, az), hb = H(bx, bz)
      const side = (Math.round(ax) + Math.round(bz)) & 1 ? 1 : -1, ux = (bx - ax) / c.d, uz = (bz - az) / c.d
      const qx = (ax + bx) / 2 - uz * c.d * 0.16 * side, qz = (az + bz) / 2 + ux * c.d * 0.16 * side
      const curve: [number, number][] = []
      for (let k = 0; k <= 24; k++) { const t = k / 24, u = 1 - t; curve.push([u * u * ax + 2 * u * t * qx + t * t * bx, u * u * az + 2 * u * t * qz + t * t * bz]) }
      let deep = 0, ok = true
      for (let k = 0; k <= 48 && ok; k++) {
        const t = k / 48, u = 1 - t, x = u * u * ax + 2 * u * t * qx + t * t * bx, z = u * u * az + 2 * u * t * qz + t * t * bz, cc = cellOf(x, z)
        if (cc < 0 || (F[cc] & (BLOCK | FORD)) || H(x, z) < ha + (hb - ha) * t - 6) ok = false
        // (no other road under the cut or along its walls — only the two it joins, at its ends)
        const along = Math.min(t, 1 - t) * c.d
        if (along > 60 && (roadPts.nearest(x, z, 48) || pathPts.nearest(x, z, 30))) ok = false
        deep = Math.max(deep, H(x, z) - (ha + (hb - ha) * t))
      }
      if (!ok || deep < 10 || deep > 42) continue
      const L = smoothLine(curve, 0, 4)
      cut(L, ha, hb, farRaw, fg, 5, false)
      cut(L, ha, hb, innerRaw, ig, 3.5, true)
      out.lines.push(L); out.kind.push('secret'); out.to.push('a secret passage')
      ends.push([ax, az], [bx, bz]); nSecret++
    }
  }

  // THE BENCH (the box's paths): the ground across a path levelled toward its middle's height — gently, never more than
  // 1.2 m, fading out 3 m past its edge — and a RAMP where it meets a road: over its first 16 m from the road's middle
  // the ground eased from the road's height to the path's (≤ 3 m) — a track's cut bank is a 2 m step the 8 m search
  // never saw (a shortcut met one at 100 %)
  {
    const n = ig.n, orig = new Map<number, number>()
    out.lines.forEach((L, li) => {
      if (out.kind[li] === 'secret') return
      const R = PATH_HW + 3
      const best = new Map<number, [number, number, number]>()   // node → [distance, the middle's height, its way along]
      const acc = [0]
      for (let k = 0; k + 1 < L.length; k++) acc.push(acc[k] + Math.hypot(L[k + 1][0] - L[k][0], L[k + 1][1] - L[k][1]))
      const tot = acc[acc.length - 1], RAMP = 16
      // (the ends on a road: its height there, the path's 16 m in)
      const at = (s: number): [number, number] => { let k = 0; while (k + 2 < acc.length && acc[k + 1] < s) k++; const t = Math.max(0, Math.min(1, (s - acc[k]) / (acc[k + 1] - acc[k] || 1))); return [L[k][0] + (L[k + 1][0] - L[k][0]) * t, L[k][1] + (L[k + 1][1] - L[k][1]) * t] }
      const ends = ([0, tot] as number[]).filter((s) => tot > 2 * RAMP && roadPts.nearest(...at(s), 6)).map((s) => ({ s, h0: H(...at(s)), h1: H(...at(s === 0 ? RAMP : tot - RAMP)) }))
      for (let k = 0; k + 1 < L.length; k++) {
        const [ax, az] = L[k], sx = L[k + 1][0] - ax, sz = L[k + 1][1] - az, l2 = sx * sx + sz * sz || 1e-9
        if (Math.max(Math.abs(ax), Math.abs(az)) > half - 8) continue
        const i0 = Math.max(1, Math.floor((Math.min(ax, ax + sx) - R - ig.origin) / ig.step)), i1 = Math.min(n - 2, Math.ceil((Math.max(ax, ax + sx) + R - ig.origin) / ig.step))
        const j0 = Math.max(1, Math.floor((Math.min(az, az + sz) - R - ig.origin) / ig.step)), j1 = Math.min(n - 2, Math.ceil((Math.max(az, az + sz) + R - ig.origin) / ig.step))
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = ig.origin + i * ig.step, z = ig.origin + j * ig.step, t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / l2)), d = Math.hypot(x - ax - sx * t, z - az - sz * t)
          if (d > R) continue
          const q = j * n + i, b = best.get(q)
          if (!b || d < b[0]) best.set(q, [d, H(ax + sx * t, az + sz * t), acc[k] + (acc[k + 1] - acc[k]) * t])
        }
      }
      for (const [q, [d, hm, s]] of best) {
        const x = ig.origin + (q % n) * ig.step, z = ig.origin + Math.floor(q / n) * ig.step
        const across = 1 - sm(PATH_HW + 0.5, R, d)
        let w = 0.6 * across, target = hm, lim = 1.2
        const e = ends.find((E) => Math.abs(s - E.s) < RAMP + 4)
        if (e) {
          // (the ramp: the road's height at its middle, the path's 16 m in — and the plain bench beyond, eased in over 4 m)
          const u = Math.abs(s - e.s) / RAMP, r = sm(1, 1.25, u)
          target = (e.h0 + (e.h1 - e.h0) * Math.min(1, u)) * (1 - r) + hm * r; w = across * (1 - 0.4 * r); lim = 3 - 1.8 * r
        } else {
          const rp = roadPts.nearest(x, z, 20)
          if (rp) w *= sm(6, 20, Math.hypot(rp[0] - x, rp[1] - z))
        }
        if (w <= 0.01) continue
        if (!orig.has(q)) orig.set(q, innerRaw[q])
        const old = orig.get(q)! * ikq + ig.min, nh = old + Math.max(-lim, Math.min(lim, target - old)) * w
        innerRaw[q] = Math.max(0, Math.min(65535, Math.round((nh - ig.min) / ikq)))
      }
    })
  }
  return out
}

/**
 * THE WAYS AS A FIELD (the road texture's G — MapData.roadTex, RG8 on roadField's 4 m texels): the distance to the
 * nearest way's CENTRE LINE, 0 … PATH_REACH m ↔ 0 … 255. A centre line's distance is a V — read bilinear between 4 m
 * texels its bottom fills in (a 3.4 m way would vanish where it runs between two): the reader takes the four texels
 * round it and finds the line they lie on (pathCentre — exact for a straight way, near it on a bend). `tex` holds RG
 * pairs, n × n, texel (i, j)'s middle at (−half + (i + ½)·step, −half + (j + ½)·step). Only where lines run: the rest is
 * left as it was (255: far).
 */
export function pathField(tex: Uint8Array, n: number, half: number, step: number, lines: [number, number][][]): void {
  const R = PATH_REACH
  for (const L of lines) for (let k = 0; k + 1 < L.length; k++) {
    const ax = L[k][0], az = L[k][1], dx = L[k + 1][0] - ax, dz = L[k + 1][1] - az, l2 = dx * dx + dz * dz || 1e-9
    const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - R + half) / step)), i1 = Math.min(n - 1, Math.floor((Math.max(ax, ax + dx) + R + half) / step))
    const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - R + half) / step)), j1 = Math.min(n - 1, Math.floor((Math.max(az, az + dz) + R + half) / step))
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * step
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * step
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), ex = x - ax - t * dx, ez = z - az - t * dz
        const v = Math.round(Math.min(1, Math.sqrt(ex * ex + ez * ez) / R) * 255), q = (j * n + i) * 2 + 1
        if (v < tex[q]) tex[q] = v
      }
    }
  }
}

/**
 * A way's centre line's distance at (x, z) from the field (pathField) — what the shader does (Terrain.ts pathCentre),
 * on the CPU: the texels' bilinear read first (never UNDER the truth on a lone line: if it's far, it is far); near one,
 * the four texels round (x, z) and the signs that make them one plane (a line's signed distance is a plane: f00 + f11 =
 * f10 + f01 on the square), that plane read at (x, z). PATH_REACH and beyond: far.
 */
export function pathCentreAt(tex: Uint8Array, n: number, half: number, step: number, x: number, z: number): number {
  const fx = (x + half) / step - 0.5, fz = (z + half) / step - 0.5
  if (fx < 0 || fz < 0 || fx > n - 1.001 || fz > n - 1.001) return PATH_REACH
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = (j * n + i) * 2 + 1, b = a + n * 2
  const d00 = tex[a] / 255, d10 = tex[a + 2] / 255, d01 = tex[b] / 255, d11 = tex[b + 2] / 255
  const lin = ((d00 * (1 - u) + d10 * u) * (1 - v) + (d01 * (1 - u) + d11 * u) * v) * PATH_REACH
  if (lin > PATH_HW + 4.2) return lin
  return pathSolve(d00, d10, d01, d11, u, v, step) * PATH_REACH
}
/** The four corners' distances (unsigned), the point's place in the square → its distance, the corners' signs chosen to
 *  lie on one plane whose slope is a line's (a metre a metre: STEP / PATH_REACH of the field a texel — four distances
 *  alone can't tell a way between two rows of texels from none: (2, 2, 2, 2) is both, but only one is sloped) — the
 *  least misfit of the eight ways, the first corner +. */
export function pathSolve(d00: number, d10: number, d01: number, d11: number, u: number, v: number, step = 4): number {
  let best = Infinity, s1 = 1, s2 = 1, s3 = 1
  for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) {
    const gx = (a * d10 - d00 + c * d11 - b * d01) / 2, gz = (b * d01 - d00 + c * d11 - a * d10) / 2
    const r = Math.abs(d00 + c * d11 - a * d10 - b * d01) + Math.abs(Math.hypot(gx, gz) - step / PATH_REACH)
    if (r < best - 1e-6) { best = r; s1 = a; s2 = b; s3 = c }
  }
  return Math.abs((d00 * (1 - u) + s1 * d10 * u) * (1 - v) + (s2 * d01 * (1 - u) + s3 * d11 * u) * v)
}
