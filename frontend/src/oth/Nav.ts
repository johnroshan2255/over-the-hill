import type { MapData, MapMeta } from './MapData'
import { WORLDS, type WorldId } from './World'

/**
 * THE GPS (2026-11-03, the user: "an option like in GTA 5 — in the map we can mark a destination, and the map shows the
 * fastest route like Google Maps"; "I don't know how to get to the other map").
 *
 * - The ROAD GRAPH (`RoadGraph.of(meta)`): every point of every track (`meta.trails.lines`, ~8 m apart) is a node, each
 *   joined to the next along its track; a track's END to the nearest point of another track within 20 m (the A* grid
 *   left gaps of 6–16 m at the junctions), and each point to the nearest point of every other track within 7 m
 *   (crossings, the stretches where routes merged). Edge cost = TIME: 40 km/h on a track, 9 km/h on a rock-crawling
 *   route (`trails.rough`: taken only where nothing else goes — the radar's plate warns of one ahead).
 * - A ROUTE (`graph.route`): the car → the tracks → the destination — Dijkstra from every track point within 320 m of
 *   the car, each reached OFF-ROAD at 22 km/h with that leg's own toll sampled every 8 m over the real ground (steeper
 *   is slower, > 70 % a wall; forest, rock, a ford slower; deep water and the box's edge walls; a TREE TRUNK or a big
 *   BOULDER within 1.6 m of the line rules it out — `Obstacles`), to the track point
 *   that leaves the least off-road time to the destination; or straight there off-road when that's quicker.
 * - The GUIDE (one for the whole game: main.ts): the WAYPOINT (in either world), the route to it in this world — or to
 *   this world's GATE when it lies in the other world, plus that world's leg from its gate (drawn on its map) — the
 *   progress along it, the next turn, re-routing when the car leaves it (> 40 m off a track for 1.5 s), the arrival.
 * Costs: a valley graph ~4.7k nodes, built in ~3 ms once per world; a route ~2–4 ms (the off-road legs' ground
 * samples are most of it), made only when a waypoint is set, on a re-route or at a crossing.
 */
const V_TRACK = 11 // m/s (40 km/h)
const V_ROUGH = 2.5 // (9 km/h: a rock crawl is taken only where nothing else goes — a bot at track speed rolled off one)
const V_OFF = 6 // (22 km/h, before the ground's toll)
const NEAR = 320 // m: track points reached off-road from the ends

export interface Waypoint { world: WorldId; x: number; z: number; name: string }

/** A turn to make: at route point `i`, `turn` rad (+ right), 'leave' / 'join' a track or a 'turn' at a junction. */
export interface Maneuver { i: number; turn: number; kind: 'turn' | 'leave' | 'join' }

export class Route {
  /** x, z pairs */
  readonly pts: Float32Array
  /** per segment: 1 = off-road (dashed) */
  readonly off: Uint8Array
  /** per segment: 1 = a rock-crawling route (go slow) */
  readonly rough: Uint8Array
  /** metres / seconds from the start to each point */
  readonly cum: Float32Array
  readonly tcum: Float32Array
  readonly maneuvers: Maneuver[]
  /** progress: the segment the car is on, the metres along the route, the metres off it */
  seg = 0
  along = 0
  lateral = 0

  constructor(pts: number[], off: number[], segTime: number[], turnsAt: Set<number>, rough: number[] = []) {
    const n = pts.length / 2
    this.pts = Float32Array.from(pts)
    this.off = Uint8Array.from(off)
    this.rough = new Uint8Array(n - 1)
    this.rough.set(rough.slice(0, n - 1))
    this.cum = new Float32Array(n)
    this.tcum = new Float32Array(n)
    for (let i = 1; i < n; i++) {
      this.cum[i] = this.cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1])
      this.tcum[i] = this.tcum[i - 1] + segTime[i - 1]
    }
    // the turns: where the route changes track (a junction) or leaves / joins the tracks, if it bends there (> 26°)
    this.maneuvers = []
    for (let i = 1; i < n - 1; i++) {
      const kind = off[i - 1] !== off[i] ? (off[i] ? 'leave' : 'join') : turnsAt.has(i) ? 'turn' : null
      if (!kind) continue
      const a = this.bearingAt(i, -30), b = this.bearingAt(i, 30) // (±30 m: the whole of a rounded corner)
      const turn = wrap(b - a)
      if (kind === 'turn' && Math.abs(turn) < 0.45) continue
      // (two turns 20 m apart read as one)
      const last = this.maneuvers[this.maneuvers.length - 1]
      if (last && this.cum[i] - this.cum[last.i] < 20) { last.turn = wrap(last.turn + turn); continue }
      this.maneuvers.push({ i, turn, kind })
    }
  }

  get length(): number { return this.cum[this.cum.length - 1] }
  get time(): number { return this.tcum[this.tcum.length - 1] }
  get remaining(): number { return Math.max(0, this.length - this.along) }
  /** Seconds left (each segment's own pace). */
  get remainingTime(): number {
    const s = this.seg, L = this.cum[s + 1] - this.cum[s]
    const f = L > 0 ? (this.along - this.cum[s]) / L : 0
    return Math.max(0, this.time - (this.tcum[s] + (this.tcum[s + 1] - this.tcum[s]) * f))
  }
  /** The car's spot on the route. */
  pos(): [number, number] {
    const s = this.seg, L = this.cum[s + 1] - this.cum[s], f = L > 0 ? (this.along - this.cum[s]) / L : 0, P = this.pts
    return [P[2 * s] + (P[2 * s + 2] - P[2 * s]) * f, P[2 * s + 1] + (P[2 * s + 3] - P[2 * s + 1]) * f]
  }
  /** The point at the end. */
  get end(): [number, number] { const k = this.pts.length - 2; return [this.pts[k], this.pts[k + 1]] }

  /** A rock crawl on the route within `ahead` m of the car (or under it). */
  roughAhead(ahead: number): boolean {
    for (let s = this.seg; s < this.rough.length && this.cum[s] < this.along + ahead; s++) if (this.rough[s]) return true
    return false
  }

  /** The next turn ahead of the car (and how far), or null. */
  next(): { m: Maneuver; dist: number } | null {
    for (const m of this.maneuvers) if (this.cum[m.i] > this.along + 2) return { m, dist: this.cum[m.i] - this.along }
    return null
  }

  /** Follow the car: the nearest point on the route near where it was (all of it when it's lost). */
  track(x: number, z: number): void {
    const n = this.pts.length / 2
    const scan = (a: number, b: number) => {
      let best = 1e18, bs = 0, bt = 0
      for (let s = a; s < b; s++) {
        const ax = this.pts[2 * s], az = this.pts[2 * s + 1], dx = this.pts[2 * s + 2] - ax, dz = this.pts[2 * s + 3] - az
        const L2 = dx * dx + dz * dz
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2)) : 0
        const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2
        if (d < best) { best = d; bs = s; bt = t }
      }
      return { d: Math.sqrt(best), s: bs, t: bt }
    }
    let r = scan(Math.max(0, this.seg - 3), Math.min(n - 1, this.seg + 60))
    if (r.d > 30) { const all = scan(0, n - 1); if (all.d < r.d - 5) r = all }
    this.seg = r.s
    this.along = this.cum[r.s] + (this.cum[r.s + 1] - this.cum[r.s]) * r.t
    this.lateral = r.d
  }

  /** The route's bearing (rad, clockwise from north) through point i, looking `d` m back (−) or ahead (+). */
  private bearingAt(i: number, d: number): number {
    const n = this.pts.length / 2, step = d < 0 ? -1 : 1
    let k = i
    while (k + step >= 0 && k + step < n && Math.abs(this.cum[k] - this.cum[i]) < Math.abs(d)) k += step
    const [ax, az, bx, bz] = d < 0 ? [this.pts[2 * k], this.pts[2 * k + 1], this.pts[2 * i], this.pts[2 * i + 1]] : [this.pts[2 * i], this.pts[2 * i + 1], this.pts[2 * k], this.pts[2 * k + 1]]
    return Math.atan2(bx - ax, -(bz - az))
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

const graphs = new WeakMap<MapMeta, RoadGraph>()

export class RoadGraph {
  readonly x: Float32Array
  readonly z: Float32Array
  readonly line: Uint16Array
  /** per track: a rock-crawling route? */
  private readonly roughLine: Uint8Array
  /** CSR adjacency: node i's edges are off[i] … off[i + 1] (to, seconds, junction?) */
  private readonly off: Int32Array
  private readonly to: Int32Array
  private readonly cost: Float32Array
  private readonly junction: Uint8Array
  private readonly cells = new Map<number, number[]>()
  private static readonly CELL = 32

  /** The graph of a map's tracks (built once per meta). */
  static of(meta: MapMeta): RoadGraph {
    let g = graphs.get(meta)
    if (!g) graphs.set(meta, (g = new RoadGraph(meta)))
    return g
  }

  private constructor(meta: MapMeta) {
    // (the box's tracks, then the outland's roads — scripts/oth/wilds.py: `rough` indexes the first)
    const lines = [...meta.trails.lines, ...(meta.outland?.trails?.lines ?? [])], rough = new Set(meta.trails.rough ?? [])
    this.roughLine = Uint8Array.from(lines, (_, i) => (rough.has(i) ? 1 : 0))
    let n = 0
    for (const L of lines) n += L.length
    this.x = new Float32Array(n)
    this.z = new Float32Array(n)
    this.line = new Uint16Array(n)
    const first: number[] = []
    let k = 0
    lines.forEach((L, li) => {
      first.push(k)
      for (const [x, z] of L) { this.x[k] = x; this.z[k] = z; this.line[k] = li; this.cell(x, z).push(k); k++ }
    })
    const edges: [number, number, number, number][] = []
    const add = (a: number, b: number, t: number, j: number) => { edges.push([a, b, t, j], [b, a, t, j]) }
    lines.forEach((L, li) => {
      const v = rough.has(li) ? V_ROUGH : V_TRACK
      for (let i = 0; i + 1 < L.length; i++) add(first[li] + i, first[li] + i + 1, Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]) / v, 0)
    })
    // junctions: a track's ends to the nearest point of another track (≤ 20 m); two tracks' points within 4 m
    const seen = new Set<string>()
    const link = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`
      if (seen.has(key)) return
      seen.add(key)
      add(a, b, Math.hypot(this.x[a] - this.x[b], this.z[a] - this.z[b]) / V_TRACK + 0.3, 1)
    }
    lines.forEach((L, li) => {
      for (const e of [first[li], first[li] + L.length - 1]) {
        let best = -1, bd = 20 * 20
        for (const o of this.near(this.x[e], this.z[e], 20)) {
          if (this.line[o] === li) continue
          const d = (this.x[o] - this.x[e]) ** 2 + (this.z[o] - this.z[e]) ** 2
          if (d < bd) { bd = d; best = o }
        }
        if (best >= 0) link(e, best)
      }
    })
    // (crossings: each point to the nearest point of every other track within 7 m — two tracks crossing between their
    //  8 m points have a pair within ~5.7 m; a route mustn't run on to a track's end and double back)
    for (let a = 0; a < n; a++) {
      const best = new Map<number, [number, number]>()
      for (const b of this.near(this.x[a], this.z[a], 7)) {
        if (this.line[b] === this.line[a]) continue
        const d = (this.x[a] - this.x[b]) ** 2 + (this.z[a] - this.z[b]) ** 2, o = best.get(this.line[b])
        if (!o || d < o[1]) best.set(this.line[b], [b, d])
      }
      for (const [b] of best.values()) link(a, b)
    }
    // (a GORGE BRIDGE of the outland: a road ends at each of its ends, 60 m apart — joined across the deck)
    for (const B of meta.bridges ?? []) {
      if (!(B as { outland?: boolean }).outland) continue
      const end = (x: number, z: number) => { let best = -1, bd = 14 * 14; for (const o of this.near(x, z, 14)) { const d = (this.x[o] - x) ** 2 + (this.z[o] - z) ** 2; if (d < bd) { bd = d; best = o } } return best }
      const a = end(B.x0, B.z0), b2 = end(B.x1, B.z1)
      if (a >= 0 && b2 >= 0) add(a, b2, Math.hypot(B.x1 - B.x0, B.z1 - B.z0) / V_TRACK, 0)
    }
    // (CSR)
    this.off = new Int32Array(n + 1)
    for (const [a] of edges) this.off[a + 1]++
    for (let i = 0; i < n; i++) this.off[i + 1] += this.off[i]
    const fill = this.off.slice(0, n)
    this.to = new Int32Array(edges.length)
    this.cost = new Float32Array(edges.length)
    this.junction = new Uint8Array(edges.length)
    for (const [a, b, t, j] of edges) { const s = fill[a]++; this.to[s] = b; this.cost[s] = t; this.junction[s] = j }
  }

  get size(): number { return this.x.length }

  private cell(x: number, z: number): number[] {
    const key = Math.floor(x / RoadGraph.CELL) * 65536 + Math.floor(z / RoadGraph.CELL)
    let c = this.cells.get(key)
    if (!c) this.cells.set(key, (c = []))
    return c
  }

  /** The nodes within r of (x, z). */
  near(x: number, z: number, r: number): number[] {
    const C = RoadGraph.CELL, out: number[] = []
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) {
      const c = this.cells.get(i * 65536 + j)
      if (c) for (const k of c) if ((this.x[k] - x) ** 2 + (this.z[k] - z) ** 2 <= r * r) out.push(k)
    }
    return out
  }

  /** The track points an end can be joined from: within NEAR m (every other point along a track, the nearest 160),
   *  or — far from every track — the 8 nearest wherever they are. */
  private ends(x: number, z: number): number[] {
    let c = this.near(x, z, NEAR)
    const d = (k: number) => (this.x[k] - x) ** 2 + (this.z[k] - z) ** 2
    if (!c.length) {
      c = Array.from(this.x.keys())
      c.sort((a, b) => d(a) - d(b))
      return c.slice(0, 8)
    }
    c.sort((a, b) => d(a) - d(b))
    const near = c.slice(0, 4)
    return [...near, ...c.filter((k, i) => i >= 4 && k % 2 === 0)].slice(0, 160)
  }

  /** The fastest way from (sx, sz) to (tx, tz); `map` (this world's ground) prices the off-road legs, without it they're
   *  straight lines at the off-road pace (the other world's leg, drawn on its map). */
  route(sx: number, sz: number, tx: number, tz: number, map?: MapData, obstacles?: Obstacles): Route {
    const n = this.size
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), via = new Uint8Array(n)
    const heap = new Heap(n)
    const leg = (ax: number, az: number, bx: number, bz: number) => offRoad(ax, az, bx, bz, map, obstacles)
    const S = this.ends(sx, sz)
    let any = false
    for (const k of S) { const t = leg(sx, sz, this.x[k], this.z[k]); if (t < dist[k]) { dist[k] = t; heap.push(k, t); any = true } }
    if (!any) for (const k of S.slice(0, 6)) { dist[k] = (Math.hypot(this.x[k] - sx, this.z[k] - sz) / V_OFF) * 3; heap.push(k, dist[k]) }
    while (heap.size) {
      const a = heap.pop()
      const da = dist[a]
      if (heap.key > da) continue
      for (let e = this.off[a]; e < this.off[a + 1]; e++) {
        const b = this.to[e], nd = da + this.cost[e]
        if (nd < dist[b]) { dist[b] = nd; prev[b] = a; via[b] = this.junction[e]; heap.push(b, nd) }
      }
    }
    // the way off the tracks to the destination
    let best = -1, bt = Infinity, bEnd = 0
    const T = this.ends(tx, tz)
    for (const k of T) {
      if (!Number.isFinite(dist[k])) continue
      const e = leg(this.x[k], this.z[k], tx, tz), t = dist[k] + e
      if (t < bt) { bt = t; best = k; bEnd = e }
    }
    if (best < 0) for (const k of T) if (Number.isFinite(dist[k])) {
      const e = (Math.hypot(this.x[k] - tx, this.z[k] - tz) / V_OFF) * 3
      if (dist[k] + e < bt) { bt = dist[k] + e; best = k; bEnd = e }
    }
    const direct = Math.hypot(tx - sx, tz - sz) < 900 ? leg(sx, sz, tx, tz) : Infinity
    if (best < 0 || direct <= bt) {
      return new Route([sx, sz, tx, tz], [1], [Number.isFinite(direct) ? direct : Math.hypot(tx - sx, tz - sz) / V_OFF], new Set())
    }
    const path: number[] = []
    for (let k = best; k >= 0; k = prev[k]) path.push(k)
    path.reverse()
    // the line drawn: [x, z] per point, per segment off-road? / seconds, per point a junction?
    const xz: [number, number][] = [[sx, sz]], off: number[] = [], time: number[] = [], jn: boolean[] = [false], rgh: number[] = [0]
    // (an off-road leg shorter than 12 m isn't drawn dashed: the car is on the track already)
    const first = path[0], d0 = Math.hypot(this.x[first] - sx, this.z[first] - sz)
    off.push(d0 > 12 ? 1 : 0); time.push(dist[first])
    for (let i = 0; i < path.length; i++) {
      const k = path[i]
      xz.push([this.x[k], this.z[k]])
      jn.push(false)
      if (i > 0) {
        off.push(0); time.push(dist[k] - dist[path[i - 1]])
        rgh.push(!via[k] && this.roughLine[this.line[k]] ? 1 : 0)
        if (via[k]) jn[jn.length - 2] = true
      }
    }
    const dl = Math.hypot(this.x[best] - tx, this.z[best] - tz)
    xz.push([tx, tz]); jn.push(false); off.push(dl > 12 ? 1 : 0); time.push(bEnd); rgh.push(0)
    // KINKS: a few tracks' centre lines fold back on themselves for a few metres (desert tracks 6 and 10, valley 38 —
    // the ground's paint just reads wider there); a point where the line turns back > 120° between short on-track
    // segments is dropped (a hairpin turns ~36° a point: it stays)
    for (let again = true; again;) {
      again = false
      for (let i = 1; i < xz.length - 1; i++) {
        if (off[i - 1] || off[i]) continue
        const ux = xz[i][0] - xz[i - 1][0], uz = xz[i][1] - xz[i - 1][1], vx = xz[i + 1][0] - xz[i][0], vz = xz[i + 1][1] - xz[i][1]
        const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz)
        if (lu > 15 || lv > 15 || lu * lv < 1e-6 || (ux * vx + uz * vz) / (lu * lv) > -0.5) continue
        xz.splice(i, 1); time.splice(i - 1, 2, time[i - 1] + time[i]); off.splice(i, 1); rgh.splice(i - 1, 2, rgh[i - 1] | rgh[i])
        jn[i - 1] ||= jn[i]; jn.splice(i, 1)
        again = true
        break
      }
    }
    const turns = new Set<number>()
    jn.forEach((j, i) => { if (j) turns.add(i) })
    return new Route(xz.flat(), off, time, turns, rgh)
  }
}

/** Seconds to drive straight from a to b off the tracks: the ground sampled every 8 m — steeper is slower (> 70 % a
 *  wall), forest / rock slower, a ford slower, deep water and the box's edge a wall. No ground: the pace on the flat. */
const mk: [number, number, number, number] = [0, 0, 0, 0]
function offRoad(ax: number, az: number, bx: number, bz: number, map?: MapData, obstacles?: Obstacles): number {
  const d = Math.hypot(bx - ax, bz - az)
  if (!map || d < 1) return d / V_OFF
  // (a trunk or a boulder in the way: every 2.5 m, the car's half width and a margin clear)
  if (obstacles) {
    const m = Math.max(1, Math.ceil(d / 2.5))
    for (let i = 0; i <= m; i++) if (obstacles.hit(ax + ((bx - ax) * i) / m, az + ((bz - az) * i) / m, 1.6)) return Infinity
  }
  const n = Math.max(1, Math.ceil(d / 8)), seg = d / n
  let t = 0, h0 = map.height(ax, az)
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n
    if (Math.max(Math.abs(x), Math.abs(z)) > map.play - 60) return Infinity     // (the playable land's edge — the outland is ground too, 2026-11-11)
    if (map.lakeAt(x, z) !== null) return Infinity
    const h = map.height(x, z), grade = Math.abs(h - h0) / seg
    if (grade > 0.7) return Infinity
    map.maskAt(x, z, mk)
    let f = 1 + 4 * grade * grade + 1.6 * mk[3] + 0.8 * mk[0]
    if (mk[2] > 0.86 && !map.bridgeAt(x, z)) {
      const lv = map.waterLevel(x, z)
      if (lv !== null && lv - h > 1.1) return Infinity
      f += 2
    }
    t += (seg / V_OFF) * f
    h0 = h
  }
  return t
}

/** What an off-road leg must go round: tree TRUNKS (a 0.6 m disc each) and BOULDERS over 1.3 m (0.55 × their size) —
 *  discs in a grid of 8 m cells, built once per world the first time a route is planned there (Guide). */
export class Obstacles {
  private readonly cells = new Map<number, number[]>()
  private maxR = 0
  add(x: number, z: number, r: number): void {
    const key = Math.floor(x / 8) * 65536 + Math.floor(z / 8)
    let c = this.cells.get(key)
    if (!c) this.cells.set(key, (c = []))
    c.push(x, z, r)
    this.maxR = Math.max(this.maxR, r)
  }
  /** Where the route ends (the waypoint, the gate): a disc that holds it is no obstacle — a place you drive TO
   *  stands on its own disc (the autopilot: the places and the buildings are obstacles too, 2026-11-11). */
  except: { x: number; z: number } | null = null
  /** A disc within `pad` m of (x, z)? */
  hit(x: number, z: number, pad: number): boolean {
    const R = this.maxR + pad, ex = this.except
    for (let i = Math.floor((x - R) / 8); i <= Math.floor((x + R) / 8); i++) for (let j = Math.floor((z - R) / 8); j <= Math.floor((z + R) / 8); j++) {
      const c = this.cells.get(i * 65536 + j)
      if (c) for (let k = 0; k < c.length; k += 3) if ((c[k] - x) ** 2 + (c[k + 1] - z) ** 2 < (c[k + 2] + pad) ** 2 && !(ex && (c[k] - ex.x) ** 2 + (c[k + 1] - ex.z) ** 2 < (c[k + 2] + 6) ** 2)) return true
    }
    return false
  }
}

/** A binary min-heap of node ids by cost (a node pushed again when its cost drops; stale entries skipped). */
class Heap {
  private ids: Int32Array
  private keys: Float64Array
  size = 0
  /** The popped entry's cost. */
  key = 0
  constructor(cap: number) { this.ids = new Int32Array(cap * 4); this.keys = new Float64Array(cap * 4) }
  push(id: number, key: number): void {
    if (this.size === this.ids.length) { const i = new Int32Array(this.size * 2), k = new Float64Array(this.size * 2); i.set(this.ids); k.set(this.keys); this.ids = i; this.keys = k }
    let c = this.size++
    while (c > 0) {
      const p = (c - 1) >> 1
      if (this.keys[p] <= key) break
      this.ids[c] = this.ids[p]; this.keys[c] = this.keys[p]; c = p
    }
    this.ids[c] = id; this.keys[c] = key
  }
  pop(): number {
    const top = this.ids[0], id = this.ids[--this.size], key = this.keys[this.size]
    this.key = this.keys[0]
    let c = 0
    for (;;) {
      let m = 2 * c + 1
      if (m >= this.size) break
      if (m + 1 < this.size && this.keys[m + 1] < this.keys[m]) m++
      if (this.keys[m] >= key) break
      this.ids[c] = this.ids[m]; this.keys[c] = this.keys[m]; c = m
    }
    this.ids[c] = id; this.keys[c] = key
    return top
  }
}

/** A world's meta.json (the other world's: its tracks, places and gate for the map, before it's ever built). */
const metas = new Map<WorldId, Promise<MapMeta | null>>()
export function worldMeta(id: WorldId): Promise<MapMeta | null> {
  let p = metas.get(id)
  if (!p) metas.set(id, (p = fetch(`${WORLDS[id].path}/meta.json`).then((r) => (r.ok ? (r.json() as Promise<MapMeta>) : null)).catch(() => null)))
  return p
}

/**
 * THE GUIDE: the waypoint and the way there. Lasts across worlds (main.ts): `setWorld` at a crossing re-routes from
 * the car in the new world.
 */
export class Guide {
  waypoint: Waypoint | null = null
  /** This world's leg: the car → the waypoint, or → the gate (the waypoint in the other world). */
  route: Route | null = null
  /** The other world's leg (its gate → the waypoint) — drawn on that world's map; its length counts in the total. */
  otherLeg: Route | null = null
  /** The waypoint reached (main.ts: the toast, the chime). */
  onArrive?: (w: Waypoint) => void
  /** Re-routed (a toast). */
  onReroute?: () => void
  private world: WorldId = 'valley'
  private map: MapData | null = null
  private obstacles: (() => Obstacles) | null = null
  private built: Obstacles | null = null
  private offT = 0
  private cool = 0
  private car = { x: 0, z: 0 }
  /** Re-plan at the next update (a crossing: the car is moved after the world is entered). */
  private stale = false

  /** The world the car is in (its ground prices the off-road legs); the route re-planned from the car next frame. */
  setWorld(id: WorldId, map: MapData, obstacles?: () => Obstacles): void {
    this.world = id
    this.map = map
    this.obstacles = obstacles ?? null
    this.built = null
    this.route = this.otherLeg = null
    this.stale = true
  }

  get here(): WorldId { return this.world }
  /** The waypoint lies in the other world: this world's route ends at its gate. */
  get viaGate(): boolean { return !!this.waypoint && this.waypoint.world !== this.world }
  /** Metres / seconds still to go (both legs). */
  get remaining(): number { return (this.route?.remaining ?? 0) + (this.viaGate ? (this.otherLeg?.length ?? 0) : 0) }
  get remainingTime(): number { return (this.route?.remainingTime ?? 0) + (this.viaGate ? (this.otherLeg?.time ?? 0) : 0) }

  set(w: Waypoint | null, car?: { x: number; z: number }): void {
    this.waypoint = w
    if (car) this.car = { x: car.x, z: car.z }
    this.otherLeg = null
    this.plan()
  }

  /** Per frame: the progress, a re-route when the car's left the route, the arrival. */
  update(dt: number, x: number, z: number): void {
    this.car.x = x
    this.car.z = z
    if (this.stale) { this.stale = false; this.plan() }
    const r = this.route, w = this.waypoint
    if (!r || !w) return
    r.track(x, z)
    if (!this.viaGate && (Math.hypot(w.x - x, w.z - z) < 25 || r.remaining < 12)) {
      this.waypoint = null
      this.route = this.otherLeg = null
      this.onArrive?.(w)
      return
    }
    this.cool -= dt
    const lim = r.off[r.seg] ? 70 : 40
    this.offT = r.lateral > lim ? this.offT + dt : 0
    if (this.offT > 1.5 && this.cool <= 0) {
      this.offT = 0
      this.cool = 3
      this.plan()
      this.onReroute?.()
    }
  }

  /** Plan again from where the car is now (the autopilot, after it's been stuck: maybe another way round) — with
   *  what blocked it (x, z, r) kept off from now on, if it says. */
  replan(block?: { x: number; z: number; r: number }): void {
    if (block && this.obstacles) (this.built ??= this.obstacles()).add(block.x, block.z, block.r)
    this.plan()
  }

  private plan(): void {
    const w = this.waypoint, map = this.map
    if (!w || !map) { this.route = null; return }
    const G = map.meta.gate, graph = RoadGraph.of(map.meta)
    const { x, z } = this.car
    const ob = this.obstacles ? (this.built ??= this.obstacles()) : undefined
    if (ob) ob.except = w.world === this.world ? { x: w.x, z: w.z } : G ? { x: G.x, z: G.z } : null
    if (w.world === this.world) this.route = graph.route(x, z, w.x, w.z, map, ob)
    else if (G) {
      this.route = graph.route(x, z, G.x, G.z, map, ob)
      // (the other world's leg: from its gate, priced on the flat — its ground isn't here)
      const want = w
      void worldMeta(w.world).then((m) => {
        if (this.waypoint !== want || !m?.gate) return
        this.otherLeg = RoadGraph.of(m).route(m.gate.x, m.gate.z, want.x, want.z)
      })
    } else this.route = null
    this.route?.track(x, z)
  }
}

/** "1.2 km" / "340 m" */
export function fmtDist(m: number): string {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`
}
/** "6 min" / "1 h 12 min" */
export function fmtTime(s: number): string {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
/** The arrow for a turn (rad, + right): ↑ ↗ → ↘ ↓ ↙ ← ↖ */
export function turnArrow(turn: number): string {
  const A = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
  return A[((Math.round(turn / (Math.PI / 4)) % 8) + 8) % 8]
}
