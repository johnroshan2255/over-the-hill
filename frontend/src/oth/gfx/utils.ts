import { BufferAttribute, BufferGeometry, Float32BufferAttribute, type TypedArray } from './geometry'
import { Vector3 } from './math'

/**
 * GEOMETRY UTILITIES (docs/MIGRATION.md): what the game took from three's addons — merging geometries, welding
 * vertices, creased normals, the convex hull (the boulders' shapes, the cars' collision pieces) — written here.
 */

/** Concatenate geometries with the same attributes (indexed all or none); null if they don't match (three's rule). */
export function mergeGeometries(geos: BufferGeometry[], _useGroups = false): BufferGeometry | null {
  if (!geos.length) return null
  const indexed = geos[0].index !== null, names = Object.keys(geos[0].attributes)
  for (const g of geos) {
    if ((g.index !== null) !== indexed) return null
    const k = Object.keys(g.attributes)
    if (k.length !== names.length || names.some((n) => !(n in g.attributes))) return null
  }
  const out = new BufferGeometry()
  for (const n of names) {
    const first = geos[0].attributes[n], total = geos.reduce((s, g) => s + g.attributes[n].array.length, 0)
    const arr = new (first.array.constructor as new (n: number) => TypedArray)(total)
    let o = 0
    for (const g of geos) { arr.set(g.attributes[n].array as never, o); o += g.attributes[n].array.length }
    out.setAttribute(n, new BufferAttribute(arr, first.itemSize, first.normalized))
  }
  if (indexed) {
    const total = geos.reduce((s, g) => s + g.index!.count, 0), verts = geos.reduce((s, g) => s + g.attributes[names[0]].count, 0)
    const idx = verts > 65535 ? new Uint32Array(total) : new Uint16Array(total)
    let o = 0, base = 0
    for (const g of geos) {
      const I = g.index!.array
      for (let i = 0; i < I.length; i++) idx[o + i] = I[i] + base
      o += I.length
      base += g.attributes[names[0]].count
    }
    out.setIndex(new BufferAttribute(idx, 1))
  }
  return out
}

/** Weld vertices whose every attribute agrees within `tolerance` (three's mergeVertices: an indexed result). */
export function mergeVertices(g: BufferGeometry, tolerance = 1e-4): BufferGeometry {
  const names = Object.keys(g.attributes), count = g.attributes[names[0]].count
  const decimals = Math.log10(1 / tolerance), mult = Math.pow(10, decimals)
  const map = new Map<string, number>(), newIdx: number[] = []
  const out: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]))
  const src = g.index ? Array.from(g.index.array) : Array.from({ length: count }, (_, i) => i)
  let next = 0
  for (const i of src) {
    let key = ''
    for (const n of names) { const a = g.attributes[n]; for (let k = 0; k < a.itemSize; k++) key += `${~~(a.array[i * a.itemSize + k] * mult)},` }
    let j = map.get(key)
    if (j === undefined) {
      j = next++
      map.set(key, j)
      for (const n of names) { const a = g.attributes[n]; for (let k = 0; k < a.itemSize; k++) out[n].push(a.array[i * a.itemSize + k]) }
    }
    newIdx.push(j)
  }
  const r = new BufferGeometry()
  for (const n of names) { const a = g.attributes[n]; r.setAttribute(n, new BufferAttribute(new (a.array.constructor as new (x: number[]) => TypedArray)(out[n]), a.itemSize, a.normalized)) }
  r.setIndex(newIdx)
  return r
}

/** Normals smoothed only across edges flatter than `creaseAngle` (three's toCreasedNormals: a non-indexed result). */
export function toCreasedNormals(geometry: BufferGeometry, creaseAngle = Math.PI / 3): BufferGeometry {
  const creaseDot = Math.cos(creaseAngle), hm = (1 + 1e-10) * 1e2
  const hash = (v: Vector3) => `${~~(v.x * hm)},${~~(v.y * hm)},${~~(v.z * hm)}`
  const res = geometry.index ? geometry.toNonIndexed() : geometry
  const P = res.attributes.position, map = new Map<string, Vector3[]>()
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), t1 = new Vector3(), t2 = new Vector3(), n2 = new Vector3()
  const verts = [a, b, c]
  const faceNormal = (i3: number) => { a.fromArray(P.array, i3 * 3); b.fromArray(P.array, (i3 + 1) * 3); c.fromArray(P.array, (i3 + 2) * 3); t1.subVectors(c, b); t2.subVectors(a, b); return new Vector3().crossVectors(t1, t2).normalize() }
  for (let i = 0; i < P.count / 3; i++) {
    const n = faceNormal(3 * i)
    for (const v of verts) { const h = hash(v); let l = map.get(h); if (!l) map.set(h, (l = [])); l.push(n) }
  }
  const N = new Float32Array(P.count * 3)
  for (let i = 0; i < P.count / 3; i++) {
    const n = faceNormal(3 * i)
    verts.forEach((v, k) => {
      n2.set(0, 0, 0)
      for (const o of map.get(hash(v))!) if (n.dot(o) > creaseDot) n2.add(o)
      n2.normalize()
      N.set([n2.x, n2.y, n2.z], (3 * i + k) * 3)
    })
  }
  res.setAttribute('normal', new BufferAttribute(N, 3))
  return res
}

// ------------------------------------------------------------------------------------------------- the convex hull
interface HalfEdge { head(): { point: Vector3 }; next: HalfEdge }
export interface HullFace { normal: Vector3; area: number; edge: HalfEdge }

/** The convex hull of a point set (incremental): triangles, outward, each with three's half-edge view of its corners
 *  (`face.edge … .next`, `head().point` — the input points themselves). */
export class ConvexHull {
  faces: HullFace[] = []
  /** Inside (or on, within `tol`) every face's plane. */
  containsPoint(p: Vector3, tol = 1e-6): boolean {
    for (const f of this.faces) if (f.normal.dot(p) - f.normal.dot(f.edge.head().point) > tol) return false
    return true
  }
  vertices: { point: Vector3 }[] = []
  setFromPoints(points: Vector3[]): this {
    this.vertices = points.map((point) => ({ point }))
    const n = points.length
    if (n < 4) throw new Error('ConvexHull: fewer than 4 points')
    let scale = 0
    for (const p of points) scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
    const eps = 3 * Number.EPSILON * Math.max(1, scale) * 64
    // the first tetrahedron: two far-apart points, the farthest from their line, the farthest from their plane
    let i0 = 0, i1 = 0
    for (let i = 1; i < n; i++) { if (points[i].x < points[i0].x) i0 = i; if (points[i].x > points[i1].x) i1 = i }
    if (i0 === i1) { let best = -1; for (let i = 0; i < n; i++) { const d = points[i].distanceToSquared(points[i0]); if (d > best) { best = d; i1 = i } } }
    const line = new Vector3().subVectors(points[i1], points[i0])
    let i2 = -1, bd = eps
    for (let i = 0; i < n; i++) { const d = new Vector3().subVectors(points[i], points[i0]).cross(line).lengthSq(); if (d > bd) { bd = d; i2 = i } }
    if (i2 < 0) throw new Error('ConvexHull: points on a line')
    const pn = new Vector3().subVectors(points[i1], points[i0]).cross(new Vector3().subVectors(points[i2], points[i0])).normalize()
    let i3 = -1
    bd = eps
    for (let i = 0; i < n; i++) { const d = Math.abs(pn.dot(new Vector3().subVectors(points[i], points[i0]))); if (d > bd) { bd = d; i3 = i } }
    if (i3 < 0) throw new Error('ConvexHull: points on a plane')
    // QUICKHULL (2026-11-03 — the first port rebuilt a string-keyed edge map for every point: the car's hull
    // decomposition took 24 s at the game's start). Each face keeps the points outside it (its conflict list); the
    // farthest of a face's points is added — the faces it sees found by walking the neighbours (directed-edge map,
    // kept up to date), the horizon closed with new faces to it, the orphaned points handed to the new faces.
    type F = { v: [number, number, number]; n: Vector3; d: number; live: boolean; out: number[] }
    const faces: F[] = []
    const edges = new Map<number, F>() // directed edge a → b (key a·n + b) → its face
    const key = (a: number, b: number) => a * n + b
    const make = (a: number, b: number, c: number): F => {
      const nn = new Vector3().subVectors(points[b], points[a]).cross(new Vector3().subVectors(points[c], points[a])).normalize()
      return { v: [a, b, c], n: nn, d: nn.dot(points[a]), live: true, out: [] }
    }
    const add = (f: F) => { faces.push(f); for (let k = 0; k < 3; k++) edges.set(key(f.v[k], f.v[(k + 1) % 3]), f) }
    const dist = (f: F, i: number) => f.n.dot(points[i]) - f.d
    const centroid = new Vector3().add(points[i0]).add(points[i1]).add(points[i2]).add(points[i3]).multiplyScalar(0.25)
    for (const [a, b, c] of [[i0, i1, i2], [i0, i1, i3], [i0, i2, i3], [i1, i2, i3]]) {
      let f = make(a, b, c)
      if (f.n.dot(centroid) - f.d > 0) f = make(a, c, b)
      add(f)
    }
    // every other point to the first face it's outside (inside them all: never on the hull)
    const assign = (i: number, among: F[]) => { for (const f of among) if (dist(f, i) > eps) { f.out.push(i); return } }
    const first = faces.slice()
    for (let i = 0; i < n; i++) if (i !== i0 && i !== i1 && i !== i2 && i !== i3) assign(i, first)
    const work = faces.slice()
    while (work.length) {
      const f0 = work.pop()!
      if (!f0.live || !f0.out.length) continue
      // the eye: the farthest point outside this face
      let eye = f0.out[0], best = -Infinity
      for (const i of f0.out) { const d = dist(f0, i); if (d > best) { best = d; eye = i } }
      // the faces it sees (a walk from f0 over the neighbours) and the horizon round them (edges in visible order)
      const visible: F[] = [f0], seen = new Set<F>([f0]), horizon: [number, number][] = []
      f0.live = false
      for (let q = 0; q < visible.length; q++) {
        const f = visible[q]
        for (let k = 0; k < 3; k++) {
          const a = f.v[k], b = f.v[(k + 1) % 3], g = edges.get(key(b, a))
          if (g && !seen.has(g)) {
            seen.add(g)
            if (g.live && dist(g, eye) > eps) { g.live = false; visible.push(g); continue }
          }
          if (!g || g.live) horizon.push([a, b])
        }
      }
      const orphans: number[] = []
      for (const f of visible) {
        for (let k = 0; k < 3; k++) { const e = key(f.v[k], f.v[(k + 1) % 3]); if (edges.get(e) === f) edges.delete(e) }
        for (const i of f.out) if (i !== eye) orphans.push(i)
        f.out.length = 0
      }
      const made: F[] = []
      for (const [a, b] of horizon) { const f = make(a, b, eye); add(f); made.push(f) }
      for (const i of orphans) assign(i, made)
      for (const f of made) if (f.out.length) work.push(f)
    }
    for (let i = faces.length - 1; i >= 0; i--) if (!faces[i].live) faces.splice(i, 1)
    this.faces = faces.map((f) => {
      const [a, b, c] = f.v.map((i) => points[i])
      const area = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2
      // three's half-edge: the edge into vertex k (its head) is the edge from the previous vertex
      const e: HalfEdge[] = f.v.map((i) => ({ head: () => ({ point: points[i] }), next: null as unknown as HalfEdge }))
      e[0].next = e[1]; e[1].next = e[2]; e[2].next = e[0]
      return { normal: f.n, area, edge: e[0] }
    })
    return this
  }
}

/** The hull of the points as flat triangles (three's ConvexGeometry: position + the faces' normals). */
export class ConvexGeometry extends BufferGeometry {
  constructor(points: Vector3[]) {
    super()
    const h = new ConvexHull().setFromPoints(points), pos: number[] = [], nor: number[] = []
    for (const f of h.faces) {
      let e = f.edge
      do { const p = e.head().point; pos.push(p.x, p.y, p.z); nor.push(f.normal.x, f.normal.y, f.normal.z); e = e.next } while (e !== f.edge)
    }
    this.setAttribute('position', new Float32BufferAttribute(pos, 3))
    this.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  }
}
