/**
 * TERRAIN SUN SHADOW (worker): for every texel of the shadow grids, march toward the sun over the height grids and
 * keep the highest angle the ground rises above the sun's ray — a soft visibility (the sun is a disc: the further the
 * blocker, the wider the penumbra). The box at 4 m (its 2 m heights near, the world's beyond) and the world at 16 m.
 * ~1–2 s per sun position on a desktop core; the main thread swaps the textures in when it's done.
 * And the FORESTS' shade (moved here from Trees.ts — on the main thread its 100–180 ms at a low sun froze the game every
 * time the sun or the moon moved): every tree stamps a soft ellipse, offset away from the sun by its height, into the
 * box's 2 m tree grid.
 */
interface Grid { h: Float32Array; n: number; step: number; origin: number }
let inner: Grid, far: Grid
let trees: Float32Array | null = null, crown = 0.2, treeGrid = { n: 0, step: 2, origin: 0 }

function bakeTrees(sx: number, sy: number, sz: number): Uint8Array {
  const { n, step, origin } = treeGrid, d = trees!
  const lit = new Float32Array(n * n).fill(1)
  const hl = Math.hypot(sx, sz) || 1, ax = -sx / hl, az = -sz / hl // away from the sun
  const tanE = Math.max(0.12, sy / hl)
  for (let o = 0; o < d.length; o += 4) {
    if (d[o + 3] === 2) continue // (a snag: no crown)
    const H = d[o + 2], cr = crown * H
    const len = Math.min(34, (0.45 * H) / tanE)
    const cx = d[o] + ax * len * 0.75, cz = d[o + 1] + az * len * 0.75
    const la = len * 0.7 + cr, lc = cr * 0.95
    const ext = la + 2
    const i0 = Math.max(0, Math.floor((cx - ext - origin) / step)), i1 = Math.min(n - 1, Math.ceil((cx + ext - origin) / step))
    const j0 = Math.max(0, Math.floor((cz - ext - origin) / step)), j1 = Math.min(n - 1, Math.ceil((cz + ext - origin) / step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const rx = origin + i * step - cx, rz = origin + j * step - cz
      const u = (rx * ax + rz * az) / la, v = (-rx * az + rz * ax) / lc
      const q = u * u + v * v
      if (q >= 1) continue
      lit[j * n + i] *= 1 - 0.6 * (1 - q) * (1 - q * 0.5)
    }
  }
  const out = new Uint8Array(n * n)
  for (let k = 0; k < n * n; k++) out[k] = Math.round(lit[k] * 255)
  return out
}

function sample(g: Grid, x: number, z: number): number {
  const n = g.n
  let fx = (x - g.origin) / g.step, fz = (z - g.origin) / g.step
  fx = fx < 0 ? 0 : fx > n - 1.0001 ? n - 1.0001 : fx
  fz = fz < 0 ? 0 : fz > n - 1.0001 ? n - 1.0001 : fz
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * n + i, h = g.h
  const a = h[k] + (h[k + 1] - h[k]) * tx
  const b = h[k + n] + (h[k + n + 1] - h[k + n]) * tx
  return a + (b - a) * tz
}

function heightAt(x: number, z: number): number {
  const e = -inner.origin - inner.step
  return x > -e && x < e && z > -e && z < e ? sample(inner, x, z) : sample(far, x, z)
}

/** Visibility of the sun from (x, z) — 0 shadow … 1 lit. */
function visibility(x: number, z: number, dx: number, dz: number, tanE: number, s0: number, reach: number): number {
  const y0 = heightAt(x, z) + 0.6
  let worst = -1
  for (let s = s0; s < reach; s *= 1.075) {
    const h = heightAt(x + dx * s, z + dz * s)
    const a = (h - y0) / s - tanE // how far above the ray the ground stands (as a slope)
    if (a > worst) worst = a
    if (worst > 0.06) break
  }
  // a sun disc ~1.1°, softened a little more for the painterly look
  const t = Math.min(1, Math.max(0, (0.035 - worst) / 0.07))
  return t * t * (3 - 2 * t)
}

function bake(g: { n: number; step: number; origin: number }, dx: number, dz: number, tanE: number, s0: number): Uint8Array {
  const out = new Uint8Array(g.n * g.n)
  for (let j = 0; j < g.n; j++) {
    const z = g.origin + j * g.step
    for (let i = 0; i < g.n; i++) out[j * g.n + i] = Math.round(visibility(g.origin + i * g.step, z, dx, dz, tanE, s0, 9000) * 255)
  }
  return out
}

/** Raise the grid's heights to each slab's top inside its outline (the convex hull of its corners). data: per slab
 *  [n, top, x0, z0, x1, z1 …]. */
function stampOccluders(g: Grid, data: Float32Array): void {
  const { n, step, origin, h } = g
  for (let o = 0; o < data.length;) {
    const k = data[o], top = data[o + 1], P: [number, number][] = []
    for (let i = 0; i < k; i++) P.push([data[o + 2 + 2 * i], data[o + 3 + 2 * i]])
    o += 2 + 2 * k
    // its convex hull (monotone chain), counter-clockwise
    P.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cr = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const lo: number[][] = [], hi: number[][] = []
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
    const Hh = lo.slice(0, -1).concat(hi.slice(0, -1))
    if (Hh.length < 3) continue
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const [x, z] of Hh) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    const i0 = Math.max(0, Math.ceil((x0 - origin) / step)), i1 = Math.min(n - 1, Math.floor((x1 - origin) / step))
    const j0 = Math.max(0, Math.ceil((z0 - origin) / step)), j1 = Math.min(n - 1, Math.floor((z1 - origin) / step))
    for (let j = j0; j <= j1; j++) {
      const z = origin + j * step
      for (let i = i0; i <= i1; i++) {
        const x = origin + i * step
        let inside = true
        for (let a = 0, b = Hh.length - 1; a < Hh.length; b = a++) if (cr(Hh[b], Hh[a], [x, z]) < 0) { inside = false; break }
        if (inside && h[j * n + i] < top) h[j * n + i] = top
      }
    }
  }
}

/** Every world's ground the main thread has sent (the next one arrives while this one plays: the crossing), by key. */
const grounds = new Map<number, { inner: Grid; far: Grid }>()

self.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'init') {
    grounds.set(m.key, { inner: m.inner, far: m.far })
    return
  }
  if (m.type === 'use') {
    ;({ inner, far } = grounds.get(m.key)!)
    return
  }
  if (m.type === 'occl') {
    // (the desert's slab stacks: each slab's convex outline raised to its top in this world's 2 m heights)
    const g = grounds.get(m.key)
    if (g) stampOccluders(g.inner, m.data as Float32Array)
    return
  }
  if (m.type === 'drop') {
    grounds.delete(m.key)
    return
  }
  if (m.type === 'trees') {
    trees = m.trees
    crown = m.crown
    treeGrid = m.grid
    return
  }
  // sun: unit vector; march along its horizontal direction
  const [sx, sy, sz] = m.sun as number[]
  const hl = Math.hypot(sx, sz) || 1
  const tanE = Math.max(sy, 0.005) / hl
  const box = { n: m.boxN, step: m.boxStep, origin: inner.origin }
  const world = { n: far.n, step: far.step, origin: far.origin }
  const a = bake(box, sx / hl, sz / hl, tanE, 3)
  const b = bake(world, sx / hl, sz / hl, tanE, 12)
  const t = trees ? bakeTrees(sx, sy, sz) : null
  ;(self as unknown as Worker).postMessage({ id: m.id, box: a, world: b, trees: t }, t ? [a.buffer, b.buffer, t.buffer] : [a.buffer, b.buffer])
}
