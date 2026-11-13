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
  /** The outland's roads as a field (roadField). */
  road: { n: number; half: number; hw: number; tex: Uint8Array }
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
  /** The Wardens' SUNKEN COURTS (sinkCourts): where the outland's ground was lowered for one. */
  courts: Court[]
  /** The HIDDEN VALES (carveVales): a hollow cut into a hill, the ravine into it. */
  vales: Vale[]
}

/** A HIDDEN VALE: its hollow's middle, floor (m) and floor radius; the ravine's mouth (ex, ez) and its bend (mx, mz). */
export interface Vale { x: number; z: number; floor: number; r: number; ex: number; ez: number; mx: number; mz: number
  /** The ravine's line, mouth → the hollow's edge (a point every ~12 m: a curve, not a corner). */
  path: [number, number][] }

/** The outland roads' points in 128 m cells: the nearest within r of (x, z), or null. */
function roadFinder(meta: MapMeta): (x: number, z: number, r: number) => [number, number] | null {
  const rh = new Map<number, [number, number][]>()
  for (const L of meta.outland?.trails?.lines ?? []) for (const q of L) { const k = Math.floor(q[0] / 128) * 4096 + Math.floor(q[1] / 128); const l = rh.get(k); if (l) l.push(q); else rh.set(k, [q]) }
  return (x, z, r) => {
    const ci = Math.floor(x / 128), cj = Math.floor(z / 128), m = Math.ceil(r / 128)
    let best: [number, number] | null = null, bd = r * r
    for (let i = ci - m; i <= ci + m; i++) for (let j = cj - m; j <= cj + m; j++) for (const q of rh.get(i * 4096 + j) ?? []) { const d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; best = q } }
    return best
  }
}
/** What stands in the outland already (x, z, radius to keep clear of): bridges, places, lakes, landmarks, zones. */
function outlandKeep(meta: MapMeta, pad: number): [number, number, number][] {
  const O = meta.outland!
  return [
    ...(meta.bridges ?? []).flatMap((b) => [[b.x0, b.z0, 90 + pad], [b.x1, b.z1, 90 + pad]] as [number, number, number][]),
    ...(O.places ?? []).map((q) => [q.x, q.z, (q.kind === 'worldtree' ? 1.5 * (q.h ?? 150) + 80 : Math.max(140, q.r * 1.2 + 60)) + pad] as [number, number, number]),
    ...(O.lakes ?? []).flatMap((L) => [[L.x, L.z, L.r + 90 + pad], ...(L.x1 !== undefined && L.z1 !== undefined ? [[L.x1, L.z1, L.r + 90 + pad], [(L.x + L.x1) / 2, (L.z + L.z1) / 2, L.r + 90 + pad]] : [])] as [number, number, number][]),
    ...(meta.landmarks ?? []).map((l) => [l.x, l.z, l.r + 90 + pad] as [number, number, number]),
    ...(O.zones ?? []).map((Z) => [Z.x, Z.z, Z.r + 70 + pad] as [number, number, number]),
  ]
}

/**
 * THE HIDDEN VALES (2026-11-12, the third secret place — "a hidden valley through a crack"): a round hollow cut INTO a
 * hill — a level floor 116 m across, walled all round by the hill itself (16 m+ of it everywhere but the way in) — and
 * a RAVINE into it from the low ground beside the hill: 12 m wide at its floor, curving (from its mouth you can't see
 * in), climbing a metre or two. Cut in the samples as the map loads, as the courts are (everything derived after reads
 * one shape; `far.bin` untouched) — only ever LOWERING the ground, the cut's lip rounded into the hill (a smooth
 * minimum over 6 m), its walls a parabola to 56° and straight after: no cell bends more than ~9 m (walls.mjs's rule —
 * no teeth along the rim). The walls come out steep, so the ground paints them rock and Rocks.ts hangs crags on them;
 * the floor is meadow, and the trees find it.
 * Where: the hill tops of a 64 m grid, each with twelve ways out — the best two, 3 km+ apart: a hill 30–75 m over the
 * ground 240 m away, the hollow's ring whole, 150 m+ from any road (the mouth 40 m+), clear of everything placed.
 */
export function carveVales(meta: MapMeta, raw: Uint16Array): Vale[] {
  const O = meta.outland, g = meta.far, n = g.n
  if (!O || meta.id !== 'valley') return []
  const half = -meta.inner.origin, play = Math.max(half, -g.origin - 2048)
  if (play <= half + 100) return []
  const kq = g.range / 65535
  const Hs = (x: number, z: number) => {
    const fx = Math.min(n - 1.001, Math.max(0, (x - g.origin) / g.step)), fz = Math.min(n - 1.001, Math.max(0, (z - g.origin) / g.step)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = j * n + i
    return ((raw[a] * (1 - u) + raw[a + 1] * u) * (1 - v) + (raw[a + n] * (1 - u) + raw[a + n + 1] * u) * v) * kq + g.min
  }
  const roadNear = roadFinder(meta), keep = outlandKeep(meta, 120)
  const R = 58, D = 240
  type Cand = { x: number; z: number; ex: number; ez: number; floor: number; sc: number }
  const cands: Cand[] = []
  for (let z = -play + 400; z < play - 400; z += 64) for (let x = -play + 400; x < play - 400; x += 64) {
    if (Math.abs(x) < half + 400 && Math.abs(z) < half + 400) continue
    const hc = Hs(x, z)
    if (hc > 560) continue
    if (keep.some(([kx, kz, kr]) => (x - kx) ** 2 + (z - kz) ** 2 < kr * kr) || roadNear(x, z, 170)) continue
    for (let k = 0; k < 12; k++) {
      const dx = Math.cos(k * 0.5236), dz = Math.sin(k * 0.5236), ex = x + dx * D, ez = z + dz * D, he = Hs(ex, ez), drop = hc - he
      if (drop < 30 || drop > 75) continue
      const floor = he + 1.5
      // the ring 105 m out: whole (16 m+ over the floor) everywhere but ±40° of the way out
      let ring = Infinity
      for (let q = 0; q < 24; q++) { const a = q * 0.2618, cx = Math.cos(a), cz = Math.sin(a); if (cx * dx + cz * dz > 0.766) continue; ring = Math.min(ring, Hs(x + cx * 105, z + cz * 105)) }
      if (ring < floor + 16) continue
      // the way out: over ground that's never below the ravine's floor (it is CUT, not built), and falling to the mouth
      let ok = true
      for (let sd = 40; sd <= D - 10 && ok; sd += 20) if (Hs(x + dx * sd, z + dz * sd) < floor - 0.5) ok = false
      if (!ok || Hs(x + dx * (D + 40), z + dz * (D + 40)) > he + 8) continue
      if (roadNear(ex, ez, 40) || keep.some(([kx, kz, kr]) => (ex - kx) ** 2 + (ez - kz) ** 2 < (kr - 60) ** 2)) continue
      const rd = roadNear(ex, ez, 600)
      cands.push({ x, z, ex, ez, floor, sc: Math.min(40, ring - floor) + drop * 0.2 - (rd ? Math.hypot(rd[0] - ex, rd[1] - ez) * 0.03 : 25) })
    }
  }
  cands.sort((a, b) => b.sc - a.sc)
  const out: Vale[] = []
  const wall = (u: number) => (u <= 0 ? 0 : u < 12 ? (u * u) / 16 : 9 + (u - 12) * 1.5)
  for (const c of cands) {
    if (out.length >= 2) break
    if (out.some((v) => (v.x - c.x) ** 2 + (v.z - c.z) ** 2 < 3000 * 3000)) continue
    const dl = Math.hypot(c.ex - c.x, c.ez - c.z), dx = (c.ex - c.x) / dl, dz = (c.ez - c.z) / dl
    // the ravine: mouth → a bend 34 m to one side at its middle → the hollow's edge
    const side = ((Math.round(c.x) * 31 + Math.round(c.z) * 17) & 1) ? 1 : -1
    const bx = c.x + dx * (R - 6), bz = c.z + dz * (R - 6), mx = (c.ex + bx) / 2 - dz * 34 * side, mz = (c.ez + bz) / 2 + dx * 34 * side
    // (a CURVE through that bend — a quadratic from the mouth to the hollow, its control point twice as far out: a
    //  corner 10 m wide between two walls hung the autopilot's car on the wall's foot; 16 pieces, 12 m of floor)
    const he = c.floor - 1.5, P: [number, number, number][] = []
    const qx = 2 * mx - (c.ex + bx) / 2, qz = 2 * mz - (c.ez + bz) / 2
    for (let k = 0; k <= 16; k++) { const t = k / 16, u = 1 - t; P.push([u * u * c.ex + 2 * u * t * qx + t * t * bx, u * u * c.ez + 2 * u * t * qz + t * t * bz, he + 0.3 + (c.floor - he - 0.3) * t]) }
    const i0 = Math.max(1, Math.floor((Math.min(c.x - 200, c.ex - 60) - g.origin) / g.step)), i1 = Math.min(n - 2, Math.ceil((Math.max(c.x + 200, c.ex + 60) - g.origin) / g.step))
    const j0 = Math.max(1, Math.floor((Math.min(c.z - 200, c.ez - 60) - g.origin) / g.step)), j1 = Math.min(n - 2, Math.ceil((Math.max(c.z + 200, c.ez + 60) - g.origin) / g.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.origin + i * g.step, z = g.origin + j * g.step, old = raw[j * n + i] * kq + g.min
      let shape = c.floor + wall(Math.hypot(x - c.x, z - c.z) - R)
      for (let q = 0; q + 1 < P.length; q++) {
        const [ax, az, ah] = P[q], [qx, qz, qh] = P[q + 1], sx = qx - ax, sz = qz - az, t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz)))
        shape = Math.min(shape, ah + (qh - ah) * t + wall(Math.hypot(x - ax - sx * t, z - az - sz * t) - 6))
      }
      if (shape > old + 8) continue
      // (a smooth minimum over 6 m: the cut's lip rounds into the hill — and never above the ground that was)
      const hk = Math.max(0, Math.min(1, 0.5 + (old - shape) / 12)), sm = old + (shape - old) * hk - 6 * hk * (1 - hk)
      const nh = Math.min(old, sm)
      if (nh < old - 0.01) raw[j * n + i] = Math.max(0, Math.round((nh - g.min) / kq))
    }
    out.push({ x: c.x, z: c.z, floor: c.floor, r: R, ex: c.ex, ez: c.ez, mx, mz, path: P.map(([x, z]) => [x, z] as [number, number]) })
  }
  return out
}

/** A SUNKEN COURT: its middle, its floor's and its rim's heights (m), the side its stair comes down (0 +z, 1 +x, 2 −z, 3 −x). */
export interface Court { x: number; z: number; floor: number; rim: number; side: number }
/** Half its floor (m: the 3 × 3 vertices lowered), and how deep under the lowest ground round it. */
export const COURT_HALF = 8, COURT_DEEP = 5

/**
 * THE SUNKEN COURTS (2026-11-12, docs/NEXT_outland.md §1 "secret places" — Wardens.ts dresses them): a handful of
 * square pits in the outland's open ground — a 16 m floor 5 m down, its walls a ring of stone, a stair down one side.
 * The ground is CUT HERE, in the samples themselves as the map loads (the 8 m grid: 3 × 3 vertices set to the floor),
 * so the drawn ground, its normals, the quadtree's bounds, the physics' tiles, the grass and the chart all read one
 * shape — as the lakes' bowls do, only made at load, not by wilds.py (no file changes: `far.bin` is as it was; the
 * walls' anti-aliasing has nothing to do — a 5 m step over a cell bends 5 m). The one cell of slope round the floor is
 * under the ring's stone (Wardens.ts), the stair's side is the stair's own ramp.
 * Where: one a ~3 km cell of the playable land outside the box, seeded — the flattest spot of 40 tried (2.2 m of fall over 64 m, at most) that is 70 m+
 * off any road, clear of the lakes, the places, the bridges, the off-road zones and the box.
 */
export function sinkCourts(meta: MapMeta, raw: Uint16Array, vales: Vale[] = []): Court[] {
  const O = meta.outland, g = meta.far, n = g.n
  if (!O || meta.id !== 'valley') return []
  const half = -meta.inner.origin, play = Math.max(half, -g.origin - 2048)
  if (play <= half + 100) return []
  const H = (i: number, j: number) => raw[j * n + i] * (g.range / 65535) + g.min
  const roadNear = roadFinder(meta)
  const keep: [number, number, number][] = [...outlandKeep(meta, 0), ...(O.meadows ?? []).map((M) => [M.x, M.z, M.r * 0.6] as [number, number, number]), ...vales.flatMap((v) => [[v.x, v.z, 260], [v.ex, v.ez, 160]] as [number, number, number][])]
  const out: Court[] = []
  const CELL = 3000
  for (let gz = -play; gz < play; gz += CELL) for (let gx = -play; gx < play; gx += CELL) {
    let s = (Math.imul(Math.round(gx) + 0x9e37, 73856093) ^ Math.imul(Math.round(gz) + 0x79b9, 19349663) ^ 0x51ed) >>> 0
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    let best: { i: number; j: number; sp: number } | null = null
    for (let t = 0; t < 40; t++) {
      const x = gx + 200 + rnd() * (CELL - 400), z = gz + 200 + rnd() * (CELL - 400)
      const i = Math.round((x - g.origin) / g.step), j = Math.round((z - g.origin) / g.step), wx = g.origin + i * g.step, wz = g.origin + j * g.step
      if (Math.max(Math.abs(wx), Math.abs(wz)) > play - 260 || (Math.abs(wx) < half + 260 && Math.abs(wz) < half + 260)) continue
      let lo = Infinity, hi = -Infinity
      for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) { const h = H(i + a, j + b); lo = Math.min(lo, h); hi = Math.max(hi, h) }
      const sp = hi - lo
      if (sp > 2.2 || (best && sp >= best.sp)) continue
      if (keep.some(([kx, kz, kr]) => (wx - kx) ** 2 + (wz - kz) ** 2 < kr * kr) || roadNear(wx, wz, 70)) continue
      if (out.some((c) => (c.x - wx) ** 2 + (c.z - wz) ** 2 < 1200 * 1200)) continue
      best = { i, j, sp }
    }
    if (!best) continue
    const { i, j } = best, x = g.origin + i * g.step, z = g.origin + j * g.step
    let lo = Infinity, rim = -Infinity
    for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const h = H(i + a, j + b); lo = Math.min(lo, h); if (Math.max(Math.abs(a), Math.abs(b)) === 2) rim = Math.max(rim, h) }
    const floorRaw = Math.max(0, Math.round(((lo - COURT_DEEP - g.min) / g.range) * 65535))
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) raw[(j + b) * n + i + a] = floorRaw
    // (its stair: down the side that faces the nearest road within 600 m — else the seed's)
    const q = roadNear(x, z, 600)
    const side = q ? (Math.abs(q[0] - x) > Math.abs(q[1] - z) ? (q[0] > x ? 1 : 3) : q[1] > z ? 0 : 2) : Math.floor(rnd() * 4)
    out.push({ x, z, floor: floorRaw * (g.range / 65535) + g.min, rim, side })
  }
  return out
}

/** Heights (m) from the 16-bit samples. */
export function heightsOf(raw: Uint16Array, g: Grid): Float32Array {
  const h = new Float32Array(raw.length), k = g.range / 65535
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] * k + g.min
  return h
}

/** THE OUTLAND'S ROADS as a field the ground paints from and the game asks (meta.outland.trails — scripts/oth/wilds.py,
 *  2026-11-11): the SIGNED distance to the nearest road's EDGE (−ROAD_REACH … +ROAD_REACH m ↔ 0 … 255; negative on the
 *  road), ROAD_STEP m texels over the playable land. Signed to the edge, not the distance to the centre line: read
 *  bilinear, a straight edge between texels comes out exact — a 6.6 m road keeps its width from 4 m texels (the centre
 *  line's V would not). 3072² bytes for the valley's 12 km (9.4 MB); 2 × 2 where a world has no roads. */
export const ROAD_STEP = 4, ROAD_REACH = 8
/** A world without roads: 2 × 2 texels of "far from any" (half 1: the shader and `roadEdge` read nothing; a 1 × 1
 *  texture the WebGPU backend would not bind — every frame an error, the desert black). */
export const NO_ROADS = (): PreparedMap['road'] => ({ n: 2, half: 1, hw: 3, tex: new Uint8Array(4).fill(255) })
export function roadField(meta: MapMeta): PreparedMap['road'] {
  const tr = meta.outland?.trails
  if (!tr?.lines?.length) return NO_ROADS()
  const half = meta.outland!.play, n = Math.round((2 * half) / ROAD_STEP), hw = tr.hw, R = hw + ROAD_REACH
  const tex = new Uint8Array(n * n).fill(255)
  // (… and under an overlook's DECK — Wonders.lookout: out from its road's end over the brink — the same bare earth: no
  //  grass up through its planks)
  const decks = (meta.outland!.places ?? []).filter((p) => p.deck).map((p) => [[p.x, p.z], [p.x + Math.cos(p.rot ?? 0) * 24, p.z + Math.sin(p.rot ?? 0) * 24]])
  for (const L of [...tr.lines, ...decks]) for (let k = 0; k + 1 < L.length; k++) {
    const ax = L[k][0], az = L[k][1], dx = L[k + 1][0] - ax, dz = L[k + 1][1] - az, l2 = dx * dx + dz * dz || 1e-9
    const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - R + half) / ROAD_STEP)), i1 = Math.min(n - 1, Math.floor((Math.max(ax, ax + dx) + R + half) / ROAD_STEP))
    const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - R + half) / ROAD_STEP)), j1 = Math.min(n - 1, Math.floor((Math.max(az, az + dz) + R + half) / ROAD_STEP))
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * ROAD_STEP
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * ROAD_STEP
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), ex = x - ax - t * dx, ez = z - az - t * dz
        const v = Math.round(Math.max(0, Math.min(1, (Math.sqrt(ex * ex + ez * ez) - hw + ROAD_REACH) / (2 * ROAD_REACH))) * 255)
        if (v < tex[j * n + i]) tex[j * n + i] = v
      }
    }
  }
  return { n, half, hw, tex }
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

/** Smooth value noise, 0 … 1 (a hash on the integer lattice, eased between). */
function vn2(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const hsh = (i: number, j: number) => { let q = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296 }
  return (hsh(xi, zi) * (1 - u) + hsh(xi + 1, zi) * u) * (1 - v) + (hsh(xi, zi + 1) * (1 - u) + hsh(xi + 1, zi + 1) * u) * v
}
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/**
 * THE LOWLANDS RE-SCULPTED (2026-11-12, the user after playing it: "the outer map's valley must be re-sculpted to
 * look beautiful like Genshin — the outer hills are okay though"): between its hills the outland was one smooth
 * plain. Now, as the map loads (the samples themselves, before anything is derived — as the courts and the vales):
 *   ROLLING GROUND   hillocks and dips ~110 m across, ±10 m, stronger in some country than other — no dead-flat mile.
 *   MESAS            flat-topped, 28–80 m high and 120–360 m across, over half with a second tier of 22–58 m, their outline ragged, their sides a
 *                    cliff 26 m deep in plan (to ~56°: the ground paints them rock, the crags hang on them, the top
 *                    is meadow): the plain becomes ROOMS, each with a wall to look at and a top to climb to.
 *   TERRACES         in some country the slopes go in STEPS of 9 m — flat treads, short risers — the hillsides of
 *                    the references.
 * Only where it's VALLEY: below ~380 m (gone by 480: the hills stay), where the broad slope is gentle; never within
 * 14 m of a road's centre (the bed and what it reads), eased in over the next 30; clear of the box (300 m), the
 * lakes, the places, the bridges and the land's edge. A spike-limiter after (as the banks'): nothing bends over
 * ~10 m. ?sculpt=0: the file's own lowlands (the A/B).
 */
export function sculptLowlands(meta: MapMeta, raw: Uint16Array): number {
  const O = meta.outland, g = meta.far, n = g.n, lines = O?.trails?.lines
  if (!O || meta.id !== 'valley') return 0
  const half = -meta.inner.origin, play = Math.max(half, -g.origin - 2048), kq = g.range / 65535, st = g.step
  if (play <= half + 100) return 0
  const src = raw.slice(), Hs = (i: number, j: number) => src[j * n + i] * kq + g.min
  // the roads' distance, to 46 m
  const rd = new Map<number, number>(), RR = 46
  for (const L of lines ?? []) for (let k = 0; k + 1 < L.length; k++) {
    const ax = L[k][0], az = L[k][1], dx = L[k + 1][0] - ax, dz = L[k + 1][1] - az, l2 = dx * dx + dz * dz || 1e-9
    const i0 = Math.max(1, Math.floor((Math.min(ax, ax + dx) - RR - g.origin) / st)), i1 = Math.min(n - 2, Math.ceil((Math.max(ax, ax + dx) + RR - g.origin) / st))
    const j0 = Math.max(1, Math.floor((Math.min(az, az + dz) - RR - g.origin) / st)), j1 = Math.min(n - 2, Math.ceil((Math.max(az, az + dz) + RR - g.origin) / st))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.origin + i * st, z = g.origin + j * st, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - t * dx, z - az - t * dz)
      if (d > RR) continue
      const q = j * n + i, o = rd.get(q)
      if (o === undefined || d < o) rd.set(q, d)
    }
  }
  const roadNear = roadFinder(meta), keep = outlandKeep(meta, 30)
  // (what's kept, in 256 m cells — a vertex asks its own cell's few)
  const kh = new Map<number, [number, number, number][]>()
  for (const k of keep) { const m = Math.ceil((k[2] + 60) / 256); for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) { const q = (Math.floor(k[0] / 256) + i) * 4096 + Math.floor(k[1] / 256) + j; const l = kh.get(q); if (l) l.push(k); else kh.set(q, [k]) } }
  // THE PLATEAUS: a jittered 480 m grid, six in ten cells
  // (2026-11-12, the same night — "not just roads: Genshin-like LANDSCAPES, not a plain place": the plateaus are MESAS
  //  now — 28–80 m of cliff, 120–360 m across — and over half carry a SECOND tier, 22–58 m more, set back on the first:
  //  a hill of stacked cliffs and ledges. A cliff's depth in plan grows with its height, so no cell bends past ~65°.)
  type Plat = { x: number; z: number; R: number; top: number; side: number; ca: number; sa: number; el: number; x2: number; z2: number; R2: number; top2: number; side2: number }
  const plats = new Map<number, Plat[]>()
  for (let gz = -play; gz < play; gz += 400) for (let gx = -play; gx < play; gx += 400) {
    let s = (Math.imul(Math.round(gx) + 0x51f1, 73856093) ^ Math.imul(Math.round(gz) + 0x2e35, 19349663) ^ 0x7a11) >>> 0
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    if (rnd() > 0.82) continue
    for (let t = 0; t < 8; t++) {
      const x = gx + 50 + rnd() * 300, z = gz + 50 + rnd() * 300, R = 60 + rnd() * 120, Hp = 28 + rnd() * 52, an = rnd() * 3.1416, el = 0.72 + rnd() * 0.56, side = Math.max(26, Hp / 1.6)
      const m = Math.max(Math.abs(x), Math.abs(z))
      if (m > play - 320 || (Math.abs(x) < half + 330 && Math.abs(z) < half + 330)) continue
      const i = Math.round((x - g.origin) / st), j = Math.round((z - g.origin) / st), hc = Hs(i, j)
      if (hc > 420 || Math.hypot(Hs(i + 6, j) - Hs(i - 6, j), Hs(i, j + 6) - Hs(i, j - 6)) / (12 * st) > 0.22) continue
      if (roadNear(x, z, R * 1.4 + side + 55) || keep.some(([kx, kz, kr]) => (x - kx) ** 2 + (z - kz) ** 2 < (kr + R * 1.4 + side + 30) ** 2)) continue
      const two = rnd() < 0.56, H2 = 22 + rnd() * 36, oa = rnd() * 6.2832, od = rnd() * R * 0.25
      const p: Plat = { x, z, R, top: hc + Hp, side, ca: Math.cos(an), sa: Math.sin(an), el, x2: x + Math.cos(oa) * od, z2: z + Math.sin(oa) * od, R2: two ? R * (0.4 + rnd() * 0.2) : 0, top2: hc + Hp + H2, side2: Math.max(24, H2 / 1.6) }
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const q = (Math.floor(x / 256) + a) * 4096 + Math.floor(z / 256) + b; const l = plats.get(q); if (l) l.push(p); else plats.set(q, [p]) }
      break
    }
  }
  const moved: number[] = []
  const lo = Math.max(8, Math.floor((-play + 130 - g.origin) / st)), hi = Math.min(n - 9, Math.ceil((play - 130 - g.origin) / st))
  for (let j = lo; j <= hi; j++) for (let i = lo; i <= hi; i++) {
    const x = g.origin + i * st, z = g.origin + j * st, m = Math.max(Math.abs(x), Math.abs(z))
    if (m < half + 150) { if (Math.abs(x) < half + 150 && Math.abs(z) < half + 150 && x < half) { i = Math.max(i, Math.floor((half + 150 - g.origin) / st) - 1) } continue }
    const q = j * n + i, h = Hs(i, j)
    let w = 1 - sm(380, 480, h)
    if (w <= 0) continue
    w *= 1 - sm(0.26, 0.44, Math.hypot(Hs(i + 5, j) - Hs(i - 5, j), Hs(i, j + 5) - Hs(i, j - 5)) / (10 * st))
    if (w <= 0.01) continue
    const d = rd.get(q)
    if (d !== undefined) { if (d < 14) continue; w *= sm(14, 44, d) }
    w *= sm(half + 150, half + 320, m) * (1 - sm(play - 280, play - 140, m))
    for (const [kx, kz, kr] of kh.get(Math.floor(x / 256) * 4096 + Math.floor(z / 256)) ?? []) { w *= sm(kr, kr + 55, Math.hypot(x - kx, z - kz)); if (w <= 0.01) break }
    if (w <= 0.01) continue
    // the rolling ground
    const country = sm(0.3, 0.62, vn2(x / 900 + 3.1, z / 900 - 7.7))
    let nh = h + ((vn2(x / 110 + 1.7, z / 110 + 4.2) * 0.62 + vn2(x / 47 - 8.1, z / 47 + 2.9) * 0.38) - 0.5) * 2 * 10 * (0.4 + 0.6 * country)
    // the plateaus
    let onPlat = 0
    for (const p of plats.get(Math.floor(x / 256) * 4096 + Math.floor(z / 256)) ?? []) {
      const lx = (x - p.x) * p.ca + (z - p.z) * p.sa, lz = -(x - p.x) * p.sa + (z - p.z) * p.ca
      const dd = Math.hypot(lx / p.el, lz * p.el) + (vn2(x / 38 + p.x, z / 38 - p.z) - 0.5) * 26
      const k = 1 - sm(p.R, p.R + p.side, dd)
      if (k <= 0) continue
      const top = p.top + (vn2(x / 60 + 9, z / 60 - 3) - 0.5) * 2.4
      if (top > nh) nh += (top - nh) * k
      onPlat = Math.max(onPlat, k)
      if (p.R2 > 0) {
        const k2 = 1 - sm(p.R2, p.R2 + p.side2, Math.hypot(x - p.x2, z - p.z2) + (vn2(x / 31 - p.z, z / 31 + p.x) - 0.5) * 18)
        if (k2 > 0 && p.top2 > nh) nh += (p.top2 + (vn2(x / 50 - 2, z / 50 + 6) - 0.5) * 2 - nh) * k2
      }
    }
    // the terraces
    const tk = sm(0.5, 0.62, vn2(x / 700 - 4.4, z / 700 + 9.2)) * (1 - onPlat)
    if (tk > 0) { const S = 9, t = nh / S, f = t - Math.floor(t); nh += ((Math.floor(t) + sm(0.7, 1, f)) * S + S * 0.3 - nh) * tk }
    const out = h + (nh - h) * w
    if (Math.abs(out - h) < 0.02) continue
    raw[q] = Math.max(0, Math.min(65535, Math.round((out - g.min) / kq)))
    moved.push(q)
  }
  // (no spikes: a sample over 5 m off its four neighbours' mean brought to 5 m of it — two passes)
  for (let pass = 0; pass < 3; pass++) for (const q of moved) {
    const h = raw[q] * kq, m4 = (raw[q - 1] + raw[q + 1] + raw[q - n] + raw[q + n]) * 0.25 * kq, ex = h - m4
    if (Math.abs(ex) > 5) raw[q] = Math.max(0, Math.round((h - (ex - Math.sign(ex) * 5)) / kq))
  }
  return moved.length
}

/**
 * THE ROADS' BANKS EASED (2026-11-12, docs/NEXT_outland.md §4 — "the roads' deep cut banks keep their teeth inside
 * the 15 m walls.mjs keeps round each road"): walls.mjs left every sample within 15 m of a road as it was and came
 * to full strength only 31 m out, so a ledge road's cut bank — a cliff over the road — kept its spikes right where
 * it's looked at. Here, as the map loads: each sample 11.5–31 m from a road's centre line (never nearer: the bed
 * ±3.3 m reads samples up to 8 m off it — those are untouched, the road is the road the bot drove) that stands more
 * than 5 m off the mean of its four neighbours — a spike or a pit; a plane, however steep, stands 0 off — is brought
 * to 5 m of it; three passes, at full strength from 16 m. ~1 100 samples move. The box, the lakes' reach and the
 * bridges' ends (40 m) are left alone. ?banks=0: as the file has them.
 */
export function easeBanks(meta: MapMeta, raw: Uint16Array): number {
  const O = meta.outland, g = meta.far, n = g.n, lines = O?.trails?.lines
  if (!O || !lines?.length || meta.id !== 'valley') return 0
  const half = -meta.inner.origin, kq = g.range / 65535, st = g.step, R = 31
  const dist = new Map<number, number>()
  for (const L of lines) for (let k = 0; k + 1 < L.length; k++) {
    const ax = L[k][0], az = L[k][1], dx = L[k + 1][0] - ax, dz = L[k + 1][1] - az, l2 = dx * dx + dz * dz || 1e-9
    const i0 = Math.max(1, Math.floor((Math.min(ax, ax + dx) - R - g.origin) / st)), i1 = Math.min(n - 2, Math.ceil((Math.max(ax, ax + dx) + R - g.origin) / st))
    const j0 = Math.max(1, Math.floor((Math.min(az, az + dz) - R - g.origin) / st)), j1 = Math.min(n - 2, Math.ceil((Math.max(az, az + dz) + R - g.origin) / st))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.origin + i * st, z = g.origin + j * st, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - t * dx, z - az - t * dz)
      if (d > R) continue
      const q = j * n + i, o = dist.get(q)
      if (o === undefined || d < o) dist.set(q, d)
    }
  }
  const off: [number, number, number][] = [
    ...(meta.bridges ?? []).flatMap((b) => [[b.x0, b.z0, 40], [b.x1, b.z1, 40]] as [number, number, number][]),
    ...(O.lakes ?? []).map((L) => [L.x, L.z, L.r + 20] as [number, number, number]),
  ]
  const cells: [number, number][] = []
  for (const [q, d] of dist) {
    if (d < 11.5) continue
    const x = g.origin + (q % n) * st, z = g.origin + Math.floor(q / n) * st
    if ((Math.abs(x) < half + 24 && Math.abs(z) < half + 24) || off.some(([ox, oz, r]) => (x - ox) ** 2 + (z - oz) ** 2 < r * r)) continue
    cells.push([q, Math.min(1, (d - 11.5) / 4.5)])
  }
  let moved = 0
  for (let pass = 0; pass < 3; pass++) for (const [q, w] of cells) {
    const h = raw[q] * kq, m4 = (raw[q - 1] + raw[q + 1] + raw[q - n] + raw[q + n]) * 0.25 * kq, ex = h - m4
    if (Math.abs(ex) <= 5) continue
    raw[q] = Math.max(0, Math.round((h - (ex - Math.sign(ex) * 5) * w) / kq))
    if (pass === 0) moved++
  }
  return moved
}

/**
 * THE ROADS MEET THE TRACKS (2026-11-12, docs/NEXT_outland.md §4 — "the box's own tracks end where its texture ends:
 * one stops ~20 m short of an outland road"): an outland road that BEGINS on the box's edge (wilds.py starts it there)
 * and finds no track of the box under its end — the track it was meant to carry on runs by a few tens of metres inside
 * — is carried on INTO the box until it meets one: along its own line, or up to 90° either side of it, whichever
 * reaches a track soonest (120 m at most; the track's distance from trail.bin, 0–8 m in 0–255). The points go on the
 * road's line itself, so the ground paints it, the grass keeps off it and the route finder joins the two.
 */
function joinRoads(meta: MapMeta, trail: Uint8Array, farRaw: Uint16Array): void {
  const fg = meta.far, fh = (x: number, z: number) => farRaw[Math.max(0, Math.min(fg.n - 1, Math.round((z - fg.origin) / fg.step))) * fg.n + Math.max(0, Math.min(fg.n - 1, Math.round((x - fg.origin) / fg.step)))] * (fg.range / 65535) + fg.min
  const lines = meta.outland?.trails?.lines, g = meta.inner, n = g.n, half = -g.origin
  if (!lines || trail.length !== n * n) return
  const dist = (x: number, z: number) => { const i = Math.round((x - g.origin) / g.step), j = Math.round((z - g.origin) / g.step); return i < 0 || j < 0 || i >= n || j >= n ? 8 : (trail[j * n + i] / 255) * 8 }
  for (const L of lines) for (const end of [0, 1]) {
    if (L.length < 4) continue
    const e = end ? L[L.length - 1] : L[0], q = end ? L[L.length - 3] : L[2]
    if (Math.abs(Math.max(Math.abs(e[0]), Math.abs(e[1])) - half) > 4) continue
    const dl = Math.hypot(e[0] - q[0], e[1] - q[1]) || 1, a0 = Math.atan2(e[1] - q[1], e[0] - q[0])
    let best: { a: number; s: number; c: number } | null = null
    // (out to a right angle: a road that runs ALONG the box's edge at its end — the one at (2048, −256) — turns in to the
    //  track beside it; a turn costs: the nearest reach, each radian of turn counted as 12 m)
    for (const da of [0, 0.26, -0.26, 0.52, -0.52, 0.79, -0.79, 1.05, -1.05, 1.31, -1.31, 1.57, -1.57]) {
      const dx = Math.cos(a0 + da), dz = Math.sin(a0 + da)
      for (let sd = 2; sd <= 120; sd += 2) {
        const x = e[0] + dx * sd, z = e[1] + dz * sd
        if (Math.max(Math.abs(x), Math.abs(z)) > half) break
        if (dist(x, z) < 1.2) { if (!best || sd + Math.abs(da) * 12 < best.c) best = { a: a0 + da, s: sd, c: sd + Math.abs(da) * 12 }; break }
      }
    }
    if (!best || dl < 0.1 || best.s < 7) continue   // (none within reach — or it's on one already)
    const add: [number, number][] = []
    for (let sd = 8; sd < best.s + 4; sd += 8) add.push([e[0] + Math.cos(best.a) * Math.min(sd, best.s + 2), e[1] + Math.sin(best.a) * Math.min(sd, best.s + 2)])
    if (end) L.push(...add); else L.unshift(...add.reverse())
  }
  // … AND EACH OTHER: a road of the outland that ends 7–30 m short of another (a T-junction wilds.py left open: the
  // one at (2048, −256) stopped 14 m from the road it meets — about twenty of them) is carried on to that road's
  // nearest point. Not at a gorge bridge's end (the two roads there are joined by its deck).
  const br = (meta.bridges ?? []).flatMap((b) => [[b.x0, b.z0], [b.x1, b.z1]])
  const adds: [number, number, [number, number][]][] = []
  lines.forEach((L, li) => {
    for (const end of [0, 1]) {
      if (L.length < 3) continue
      const e = end ? L[L.length - 1] : L[0]
      if (br.some(([bx, bz]) => (bx - e[0]) ** 2 + (bz - e[1]) ** 2 < 40 * 40)) continue
      let best: [number, number] | null = null, bd = 30 * 30
      lines.forEach((o, oi) => { if (oi !== li) for (const q of o) { const d = (q[0] - e[0]) ** 2 + (q[1] - e[1]) ** 2; if (d < bd) { bd = d; best = q } } })
      if (!best || bd < 7 * 7) continue
      const d = Math.sqrt(bd), b2 = best as [number, number], pts: [number, number][] = []
      // (not down a bank: two roads a few metres apart at different heights — one ran 23 m from another across a 74 % drop)
      if (Math.abs(fh(e[0], e[1]) - fh(b2[0], b2[1])) / d > 0.22) continue
      for (let sd = 8; sd < d - 2; sd += 8) pts.push([e[0] + ((b2[0] - e[0]) * sd) / d, e[1] + ((b2[1] - e[1]) * sd) / d])
      pts.push([b2[0], b2[1]])
      adds.push([li, end, pts])
    }
  })
  for (const [li, end, pts] of adds) { if (end) lines[li].push(...pts); else lines[li].unshift(...pts.reverse()) }
}

/** Fetch a map's files and compute all of the above (the worker's job; also usable in place). */
/** Each grid sample within R m of an outland road's centre line → that distance (m). */
function roadDistances(meta: MapMeta, g: Grid, R: number): Map<number, number> {
  const rd = new Map<number, number>(), n = g.n, st = g.step
  for (const L of meta.outland?.trails?.lines ?? []) for (let k = 0; k + 1 < L.length; k++) {
    const ax = L[k][0], az = L[k][1], dx = L[k + 1][0] - ax, dz = L[k + 1][1] - az, l2 = dx * dx + dz * dz || 1e-9
    const i0 = Math.max(1, Math.floor((Math.min(ax, ax + dx) - R - g.origin) / st)), i1 = Math.min(n - 2, Math.ceil((Math.max(ax, ax + dx) + R - g.origin) / st))
    const j0 = Math.max(1, Math.floor((Math.min(az, az + dz) - R - g.origin) / st)), j1 = Math.min(n - 2, Math.ceil((Math.max(az, az + dz) + R - g.origin) / st))
    if (i0 > i1 || j0 > j1) continue
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.origin + i * st, z = g.origin + j * st, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - t * dx, z - az - t * dz)
      if (d > R) continue
      const q = j * n + i, o = rd.get(q)
      if (o === undefined || d < o) rd.set(q, d)
    }
  }
  return rd
}

/**
 * THE HILLS' ROCK SCULPTED (2026-11-13, the look, round 3 — the user: "on the hills we have box-like rocks — remove
 * them; instead the actual terrain sculpted, with the rock texture"): wherever the ground is steep (from ~27°, whole by
 * ~40°) its samples are stepped into STRATA — level-ish ledges and steep risers following the contours, the steps'
 * height and their line wandering with slow noise (no two bands alike), a rough knobbly break on top — so a hillside
 * reads as cliffs in bands with shelves between, in the ground itself: the drawn land, its normals, the shadows, the
 * physics and the grass all read one shape (Rocks.ts no longer hangs crag blocks or outcrops there). The box's 2 m grid
 * takes ~7 m steps, the world's 8 m grid ~20 m ones. Kept off (and eased in from): the box's tracks (24 m … 44 m), the
 * roads (18 … 40 m), the water (30 … 60 m), the places, the bridges, the lakes, the land's edge; faded to nothing at the
 * seam between the two grids (each its own sampling of one function there). A spike limiter after. ?cliffs=0: off.
 */
export function sculptCliffs(meta: MapMeta, raw: Uint16Array, g: Grid, inner: boolean, fields: PreparedMap['fields']): number {
  if (meta.biome === 'desert') return 0
  const n = g.n, st = g.step, kq = g.range / 65535, half = -meta.inner.origin
  const play = meta.id === 'valley' ? Math.max(half, -meta.far.origin - 2048) : half
  const src = raw.slice(), Hs = (i: number, j: number) => src[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))] * kq + g.min
  const rd = roadDistances(meta, g, 40)
  const keep = [
    ...(meta.outland ? outlandKeep(meta, 0) : []),
    ...(meta.landmarks ?? []).map((l) => [l.x, l.z, l.r + 40] as [number, number, number]),
  ]
  const kh = new Map<number, [number, number, number][]>()
  for (const k of keep) { const m = Math.ceil((k[2] + 60) / 256); for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) { const q = (Math.floor(k[0] / 256) + i) * 4096 + Math.floor(k[1] / 256) + j; const l = kh.get(q); if (l) l.push(k); else kh.set(q, [k]) } }
  const d = inner ? 3 : 2                                          // (the slope over ±6 m / ±16 m)
  // (the world's 8 m grid can't carry a sharp step: its risers came out a regular sawtooth — there the bands are bigger,
  //  softer, wander more, and stand at half strength; the box's 2 m grid takes the crisper ones)
  const S0 = inner ? 8 : 34, SV = inner ? 4 : 16, WAV = inner ? 60 : 110, KN = inner ? 1.4 : 5, KS = inner ? 17 : 60, R0 = inner ? 0.42 : 0.15, AMP = inner ? 0.8 : 0.5
  const moved: number[] = []
  for (let j = d; j < n - d; j++) for (let i = d; i < n - d; i++) {
    const x = g.origin + i * st, z = g.origin + j * st, m = Math.max(Math.abs(x), Math.abs(z))
    if (!inner && m < half - 200) continue   // (the world's grid under the box: never drawn there)
    const s = Math.hypot(Hs(i + d, j) - Hs(i - d, j), Hs(i, j + d) - Hs(i, j - d)) / (2 * d * st)
    let w = sm(0.5, 0.85, s)
    if (w <= 0.01) continue
    // (the seam between the grids: nothing within ±60 m of the box's edge, eased in over 120 m more on each side)
    w *= inner ? 1 - sm(half - 180, half - 60, m) : sm(half + 60, half + 180, m) * (1 - sm(play - 200, play - 80, m))
    if (w <= 0.01) continue
    const q = j * n + i
    const r = rd.get(q)
    if (r !== undefined) { if (r < 18) continue; w *= sm(18, 40, r) }
    if (inner) {
      const fi = Math.round((x + half) / 4), fj = Math.round((z + half) / 4), fn = fields.n
      if (fi >= 0 && fj >= 0 && fi < fn && fj < fn) { const k = fj * fn + fi; w *= sm(24, 44, fields.track[k]) * sm(30, 60, fields.river[k]) }
    }
    for (const [kx, kz, kr] of kh.get(Math.floor(x / 256) * 4096 + Math.floor(z / 256)) ?? []) { w *= sm(kr, kr + 40, Math.hypot(x - kx, z - kz)); if (w <= 0.01) break }
    if (w <= 0.01) continue
    const h = Hs(i, j)
    // the strata: a ledge then a riser in every step of S m, the line of the bands wandering
    const S = S0 + SV * vn2(x / 260 + 4.1, z / 260 - 2.3), o = (vn2(x / WAV - 1.7, z / WAV + 6.2) - 0.5) * S * 0.9
    const t = (h + o) / S, f = t - Math.floor(t)
    const terr = (Math.floor(t) + sm(R0, 0.97, f) + 0.47 - (0.97 - R0) * 0.5) * S - o   // (+ the step's mean offset: the ground keeps its height on average)
    // (and a rough, knobbly break over it: the rock's own lumps)
    const knob = (vn2(x / KS + 9.3, z / KS - 3.7) - 0.5) * 2 * KN
    const out = h + (terr - h) * w * AMP + knob * w
    if (Math.abs(out - h) < 0.02) continue
    raw[q] = Math.max(0, Math.min(65535, Math.round((out - g.min) / kq)))
    moved.push(q)
  }
  // (no spikes: a sample over L m off its four neighbours' mean brought to L m of it — three passes)
  const lim = inner ? 3 : 7
  for (let pass = 0; pass < 3; pass++) for (const q of moved) {
    const h = raw[q] * kq, m4 = (raw[q - 1] + raw[q + 1] + raw[q - n] + raw[q + n]) * 0.25 * kq, ex = h - m4
    if (Math.abs(ex) > lim) raw[q] = Math.max(0, Math.round((h - (ex - Math.sign(ex) * lim)) / kq))
  }
  return moved.length
}

/**
 * THE HIGH PEAKS MADE JAGGED (2026-11-13, the look, round 6 — the user's frames: the far mountains are ROCK — arêtes,
 * teeth, gullies — where ours were smooth pale cones): the world's grid above ~560 m (whole by ~840 m) takes a
 * RIDGED noise at three scales (~420, ~150 and ~60 m: the ridge lines, their teeth, the break) — up to +85 m on a
 * ridge, −45 m in a gully between; the cliffs' strata are cut into it after. Kept off the roads (18 … 60 m), the
 * outland's places, the landmarks and the box. The land, its normals, its shadows and its physics are one shape.
 * ?peaks=0: off.
 */
export function sculptPeaks(meta: MapMeta, raw: Uint16Array, g: Grid): number {
  if (meta.biome === 'desert') return 0
  const n = g.n, st = g.step, kq = g.range / 65535, half = -meta.inner.origin
  const rd = roadDistances(meta, g, 60)
  // (a bare summit — a `peak` with no deck — is sculpted to within 25 m of its top: the keep-off's 140 m left every
  //  named mountain its smooth cone, the very thing this is for)
  const bare = (meta.outland?.places ?? []).filter((q) => q.kind === 'peak' && !q.deck)
  const keep = [...(meta.outland ? outlandKeep(meta, 0) : []).filter(([kx, kz]) => !bare.some((q) => q.x === kx && q.z === kz)), ...bare.map((q) => [q.x, q.z, 25] as [number, number, number]),
    ...(meta.landmarks ?? []).map((l) => [l.x, l.z, l.r + 60] as [number, number, number])]
  const ridge = (x: number, z: number) => { const v = 1 - Math.abs(2 * vn2(x, z) - 1); return v * v }
  let moved = 0
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const q = j * n + i, h = raw[q] * kq + g.min
    if (h < 560) continue
    const x = g.origin + i * st, z = g.origin + j * st
    if (Math.max(Math.abs(x), Math.abs(z)) < half + 200) continue
    let w = sm(560, 840, h)   // (a trace from the tree line's top, whole on the high rock)
    const r = rd.get(q)
    if (r !== undefined) { if (r < 18) continue; w *= sm(18, 60, r) }
    for (const [kx, kz, kr] of keep) { const d = Math.hypot(x - kx, z - kz); if (d < kr + 80) { w *= sm(kr, kr + 80, d); if (w <= 0.01) break } }
    if (w <= 0.01) continue
    const jag = 0.6 * ridge(x / 420 + 3.7, z / 420 - 8.1) + 0.3 * ridge(x / 150 - 5.2, z / 150 + 1.9) + 0.1 * ridge(x / 60 + 0.4, z / 60 + 7.3)
    const out = h + (jag - 0.35) * (130 + 60 * sm(840, 1100, h)) * w
    raw[q] = Math.max(0, Math.min(65535, Math.round((out - g.min) / kq)))
    moved++
  }
  return moved
}

export async function prepareMap(base: string, leaf: number, onProgress?: (f: number) => void, o: { courts?: boolean; vales?: boolean; banks?: boolean; sculpt?: boolean; cliffs?: boolean; peaks?: boolean } = {}): Promise<PreparedMap> {
  const meta = (await (await fetch(`${base}/meta.json`)).json()) as MapMeta
  let done = 0
  const get = async (f: string) => {
    const b = await (await fetch(`${base}/${f}`)).arrayBuffer()
    onProgress?.((++done / 5) * 0.7)
    return b
  }
  const [h, f, m, t, u] = await Promise.all([get('height.bin'), get('far.bin'), get('mask.bin'), get('trail.bin'), meta.mud ? get('mud.bin') : Promise.resolve(new ArrayBuffer(0))])
  const innerRaw = new Uint16Array(h), farRaw = new Uint16Array(f)
  joinRoads(meta, new Uint8Array(t), farRaw)   // (first: the joined ends are ROAD to everything after — the sculpt keeps off them)
  if (o.sculpt !== false) sculptLowlands(meta, farRaw)               // (before anything is derived from the heights)
  if (o.banks !== false) easeBanks(meta, farRaw)
  // (the look, round 3: the steep ground stepped into strata — both grids, before anything is derived from them)
  if (o.peaks === true) sculptPeaks(meta, farRaw, meta.far)          // (the look, round 6: the high peaks jagged — before their strata)
  if (o.cliffs !== false) { const fl = distanceFields(meta); sculptCliffs(meta, innerRaw, meta.inner, true, fl); sculptCliffs(meta, farRaw, meta.far, false, fl) }
  const vales = o.vales === false ? [] : carveVales(meta, farRaw)
  const courts = o.courts === false ? [] : sinkCourts(meta, farRaw, vales)
  const innerH = heightsOf(innerRaw, meta.inner), farH = heightsOf(farRaw, meta.far)
  const innerNormals = normalsOf(innerH, meta.inner), farNormals = normalsOf(farH, meta.far)
  onProgress?.(0.8)
  const fields = distanceFields(meta)
  const road = roadField(meta)
  reconcileWater(meta, innerH)
  const { tex: water, body: waterBody } = waterOwner(meta, innerH)
  onProgress?.(0.9)
  const pyramid = pyramidOf(meta, innerH, farH, leaf)
  onProgress?.(1)
  return { meta, innerRaw, farRaw, innerH, farH, innerNormals, farNormals, road, mask: new Uint8Array(m), trail: new Uint8Array(t), mud: new Uint8Array(u), fields, water, waterBody, pyramid, courts, vales }
}

/** Every array buffer in a prepared map (posted from the worker without a copy). */
export function transferables(p: PreparedMap): ArrayBuffer[] {
  const a = [p.innerRaw, p.farRaw, p.innerH, p.farH, p.innerNormals, p.farNormals, p.road.tex, p.mask, p.trail, p.mud, p.fields.track, p.fields.river, p.water, p.waterBody, ...p.pyramid.minH, ...p.pyramid.maxH]
  return [...new Set(a.map((x) => x.buffer as ArrayBuffer))]
}
