import * as GFX from './gfx'
import { type Builder, SURF } from './Bridges'

/**
 * THE ENVIRONMENT KIT (2026-11-06, the user: "every important location should look like a place that belongs in a
 * finished game — not a primitive asset collection"): the parts the valley's places are built from, on the bridges'
 * Builder (one geometry per place, one material, flat-shaded, vertex colours + a SURFACE each — wood grain, stone,
 * rusting paint, fabric: Bridges.ts). Every part is in its place's own frame (+z its front, y up, the ground near 0);
 * what stands on the land takes a `Ground` — the ground's height (local y) under a local (x, z) — so foundations,
 * posts, steps and piles reach the real ground, never float, never hang in the air.
 *
 * Built once at load, never per frame. Each part adds a few hundred vertices at most; a whole place is 2–12 k.
 */
export type RGB = [number, number, number]
/** The ground's height (local y) under local (x, z). */
export type Ground = (x: number, z: number) => number
export const V = (x: number, y: number, z: number): GFX.Vector3 => new GFX.Vector3(x, y, z)
export const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1)
export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
export const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const flat: Ground = () => 0

// ---- the palette (linear albedo, before the light): weathered, never saturated
export const C = {
  stone: [0.25, 0.248, 0.245] as RGB, stoneDark: [0.17, 0.165, 0.16] as RGB, mortar: [0.22, 0.21, 0.19] as RGB,
  shingle: [0.12, 0.095, 0.08] as RGB, shingleGrey: [0.2, 0.19, 0.18] as RGB, tin: [0.38, 0.26, 0.18] as RGB, tinGrey: [0.3, 0.31, 0.32] as RGB,
  redRoof: [0.42, 0.12, 0.07] as RGB, greenRoof: [0.11, 0.17, 0.1] as RGB,
  trim: [0.6, 0.56, 0.48] as RGB, trimRed: [0.36, 0.08, 0.05] as RGB, trimGreen: [0.1, 0.18, 0.12] as RGB,
  glass: [0.05, 0.06, 0.07] as RGB, dark: [0.03, 0.028, 0.026] as RGB, rubber: [0.04, 0.04, 0.045] as RGB,
  steel: [0.2, 0.2, 0.21] as RGB, rust: [0.25, 0.1, 0.05] as RGB, rope: [0.42, 0.35, 0.24] as RGB,
  canvasOrange: [0.6, 0.22, 0.05] as RGB, canvasGreen: [0.17, 0.25, 0.12] as RGB, canvasBlue: [0.08, 0.17, 0.3] as RGB,
  canvasYellow: [0.62, 0.45, 0.08] as RGB, canvasRed: [0.45, 0.07, 0.05] as RGB, canvasKhaki: [0.4, 0.36, 0.24] as RGB,
  ore: [0.3, 0.22, 0.17] as RGB, oreGreen: [0.16, 0.24, 0.2] as RGB, soil: [0.28, 0.2, 0.13] as RGB,
}

// ------------------------------------------------------------------------------------------------- primitives
/** An axis-aligned box. */
export function box(b: Builder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: RGB): void {
  b.box(V(cx, cy, cz), X, Y, Z, hx, hy, hz, c)
}
/** A box turned `rot` about y. */
export function rbox(b: Builder, cx: number, cy: number, cz: number, rot: number, hx: number, hy: number, hz: number, c: RGB): void {
  const u = V(Math.cos(rot), 0, -Math.sin(rot)), w = V(Math.sin(rot), 0, Math.cos(rot))
  b.box(V(cx, cy, cz), u, Y, w, hx, hy, hz, c)
}
/** A BEAM / board from p0 to p1: w across (horizontal, square to it and to `up`), h deep along up. */
export function beam(b: Builder, p0: GFX.Vector3, p1: GFX.Vector3, w: number, h: number, c: RGB, up: GFX.Vector3 = Y): void {
  const d = new GFX.Vector3().subVectors(p1, p0), L = d.length()
  if (L < 1e-4) return
  d.divideScalar(L)
  let side = new GFX.Vector3().crossVectors(d, up)
  if (side.lengthSq() < 1e-6) side = new GFX.Vector3().crossVectors(d, X)
  side.normalize()
  const u = new GFX.Vector3().crossVectors(side, d).normalize()
  b.box(p0.clone().add(p1).multiplyScalar(0.5), d, u, side, L / 2, h / 2, w / 2, c)
}
/** A thin panel, both faces (a flap, a cloth, a sign): the outer colour on its front (p0 → p1 → p2 counter-clockwise). */
export function panel(b: Builder, p0: GFX.Vector3, p1: GFX.Vector3, p2: GFX.Vector3, p3: GFX.Vector3, front: RGB, back: RGB = front): void {
  b.quad(p0, p1, p2, p3, front); b.quad(p3, p2, p1, p0, back)
}
export function panelTri(b: Builder, p0: GFX.Vector3, p1: GFX.Vector3, p2: GFX.Vector3, front: RGB, back: RGB = front): void {
  b.tri(p0, p1, p2, front); b.tri(p2, p1, p0, back)
}
/** A ROCK CHUNK: an icosahedron pushed about (seeded), squashed to `size` (half sizes), turned rot, flat-shaded stone. */
const ICO: GFX.BufferAttribute[] = []
export function rock(b: Builder, c: GFX.Vector3, size: GFX.Vector3, rot: number, col: RGB, seed: number, detail = 0, smooth = false): void {
  // (the icosahedron once per detail: built per rock it was half the landmarks' load time)
  const pos = (ICO[detail] ??= new GFX.IcosahedronGeometry(1, detail).toNonIndexed().getAttribute('position') as GFX.BufferAttribute)
  let s = (seed * 2654435761) >>> 0
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const key = (p: GFX.Vector3) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`
  const jit = new Map<string, number>()
  const cs = Math.cos(rot), sn = Math.sin(rot), cs_ = cs
  const P = (i: number) => {
    const p = V(pos.getX(i), pos.getY(i), pos.getZ(i)), k = key(p)
    if (!jit.has(k)) jit.set(k, 0.78 + 0.4 * rnd())
    p.multiplyScalar(jit.get(k)!)
    // (flatter underneath: it sits on, and in, the ground)
    if (p.y < -0.3) p.y = -0.3 - (p.y + 0.3) * 0.4
    const x = p.x * size.x, z = p.z * size.z
    return V(c.x + x * cs + z * sn, c.y + p.y * size.y, c.z - x * sn + z * cs)
  }
  b.setSurf(SURF.stone)
  if (!smooth) {
    for (let i = 0; i < pos.count; i += 3) b.tri(P(i), P(i + 1), P(i + 2), shade(col, 0.82 + 0.3 * rnd()))
  } else {
    // ROUNDED (2026-11-06, the user's cave reference: big soft boulders): the normals of the squashed sphere it was
    // pushed out of, the hollows (pushed in) a shade darker — the same triangles, no facets
    const ps: number[] = [], ns: number[] = [], cs: number[] = [], ix: number[] = []
    for (let i = 0; i < pos.count; i++) {
      const p = P(i), u = V(pos.getX(i), pos.getY(i), pos.getZ(i)), j = jit.get(key(u))!
      const nx = u.x / size.x, ny = u.y / size.y, nz = u.z / size.z, L = Math.hypot(nx, ny, nz) || 1
      ps.push(p.x, p.y, p.z); ns.push((nx * cs_ + nz * sn) / L, ny / L, (-nx * sn + nz * cs_) / L)
      const k = 0.8 + 0.45 * (j - 0.78) / 0.4
      cs.push(col[0] * k, col[1] * k, col[2] * k); ix.push(i)
    }
    b.raw(ps, ns, cs, ix)
  }
  b.setSurf(SURF.wood)
}
/** A CYLINDER (the log's 6 sides — `b.log`) in another surface. */
export function pipe(b: Builder, p0: GFX.Vector3, p1: GFX.Vector3, r: number, c: RGB, surf: number = SURF.metal): void {
  b.setSurf(surf); b.log(p0, p1, r, c); b.setSurf(SURF.wood)
}

// ---------------------------------------------------------------------------------------------- architecture
/** A STONE FOUNDATION round a w × d footprint (centre 0, 0), its top at floorY: courses of field stones down to the
 *  real ground at every point (and a little into it) — never a building floating over a slope. */
export function foundation(b: Builder, w: number, d: number, floorY: number, g: Ground, col: RGB = C.stone): void {
  b.setSurf(SURF.stone)
  const seg = 0.7
  const side = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / seg))
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t
      const gy = Math.min(g(x, z), floorY - 0.15) - 0.25, h = floorY - gy
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L
      const tone = 0.8 + 0.35 * b.rnd()
      b.box(V(x, gy + h / 2, z), V(ux, 0, uz), Y, V(-uz, 0, ux), (L / n) / 2 + 0.02, h / 2, 0.16 + 0.04 * b.rnd(), shade(col, tone))
      // a mortar line every course
      if (h > 0.5) b.box(V(x, gy + h * 0.55, z), V(ux, 0, uz), Y, V(-uz, 0, ux), (L / n) / 2 + 0.025, 0.025, 0.17, shade(C.mortar, 0.9))
    }
  }
  side(-w / 2, -d / 2, w / 2, -d / 2); side(w / 2, -d / 2, w / 2, d / 2); side(w / 2, d / 2, -w / 2, d / 2); side(-w / 2, d / 2, -w / 2, -d / 2)
  b.setSurf(SURF.wood)
}
/** POST FOOTINGS: a stone block under a post at (x, z), the post up to y. */
export function post(b: Builder, x: number, z: number, y: number, g: Ground, r = 0.09, col?: RGB): void {
  const gy = g(x, z)
  b.setSurf(SURF.stone); box(b, x, gy + 0.08, z, r * 2.2, 0.16, r * 2.2, shade(C.stone, 0.85 + 0.2 * b.rnd())); b.setSurf(SURF.wood)
  b.log(V(x, gy + 0.1, z), V(x, y, z), r, col ?? b.wood(0.8))
}
/** CLAPBOARD walls round w × d from y0 up h: overlapping boards (their shadow lines read), corner boards, a sill
 *  board; or VERTICAL board-and-batten. Walls only — openings are framed over them (windows, doors). */
export function boardWalls(b: Builder, w: number, d: number, y0: number, h: number, col: RGB, vertical = false, trim: RGB = shade(col, 0.7)): void {
  const walls: [number, number, number, number][] = [[-w / 2, d / 2, w / 2, d / 2], [w / 2, d / 2, w / 2, -d / 2], [w / 2, -d / 2, -w / 2, -d / 2], [-w / 2, -d / 2, -w / 2, d / 2]]
  for (const [x0, z0, x1, z1] of walls) {
    const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz, nz = ux // (out: the walls run clockwise seen from above)
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    box(b, cx - nx * 0.06, y0 + h / 2, cz - nz * 0.06, Math.abs(ux) * L / 2 + Math.abs(nx) * 0.06, h / 2, Math.abs(uz) * L / 2 + Math.abs(nz) * 0.06, shade(col, 0.8)) // (the wall's core)
    if (vertical) {
      const n = Math.round(L / 0.3)
      for (let i = 0; i < n; i++) {
        const t = -L / 2 + (i + 0.5) * (L / n), x = cx + ux * t, z = cz + uz * t, k = 0.85 + 0.3 * b.rnd()
        b.box(V(x + nx * 0.01, y0 + h / 2, z + nz * 0.01), V(ux, 0, uz), Y, V(nx, 0, nz), L / n / 2 - 0.012, h / 2, 0.02, shade(col, k))
        if (i % 2) b.box(V(x + nx * 0.04, y0 + h / 2, z + nz * 0.04), V(ux, 0, uz), Y, V(nx, 0, nz), 0.035, h / 2, 0.02, shade(col, k * 0.85))
      }
    } else {
      const n = Math.round(h / 0.21)
      for (let i = 0; i < n; i++) {
        const y = y0 + (i + 0.5) * (h / n), k = 0.82 + 0.3 * b.rnd()
        // (each board tilted out at its foot: the overlap's shadow line)
        const out = V(nx, 0, nz), up = V(-nx * 0.18, 1, -nz * 0.18).normalize(), along = V(ux, 0, uz)
        b.box(V(cx + nx * 0.02, y, cz + nz * 0.02), along, up, out, L / 2 + 0.02, h / n / 2 + 0.012, 0.016, shade(col, k))
      }
    }
    for (const t of [-L / 2, L / 2]) b.box(V(cx + ux * t + nx * 0.04, y0 + h / 2, cz + uz * t + nz * 0.04), V(ux, 0, uz), Y, V(nx, 0, nz), 0.08, h / 2 + 0.02, 0.03, trim)
    b.box(V(cx + nx * 0.05, y0 + 0.06, cz + nz * 0.05), V(ux, 0, uz), Y, V(nx, 0, nz), L / 2 + 0.06, 0.07, 0.035, shade(trim, 0.85))
  }
}
/** NOTCHED LOG walls (a trapper's cabin): logs crossing past the corners, each its own tone, the chinking between. */
export function logWalls(b: Builder, w: number, d: number, y0: number, h: number, r = 0.16): void {
  const n = Math.round(h / (r * 2))
  for (let i = 0; i < n; i++) {
    const y = y0 + r + i * r * 2
    for (const sz of [-1, 1]) b.log(V(-w / 2 - 0.35 - 0.1 * b.rnd(), y, (sz * d) / 2), V(w / 2 + 0.35 + 0.1 * b.rnd(), y, (sz * d) / 2), r, b.wood(0.88 + 0.12 * b.rnd()))
    for (const sx of [-1, 1]) b.log(V((sx * w) / 2, y + r, -d / 2 - 0.35 - 0.1 * b.rnd()), V((sx * w) / 2, y + r, d / 2 + 0.35 + 0.1 * b.rnd()), r, b.wood(0.85 + 0.12 * b.rnd()))
  }
  // the chinking: a pale band inside the logs
  box(b, 0, y0 + h / 2, 0, w / 2 - r * 0.4, h / 2, d / 2 - r * 0.4, [0.42, 0.38, 0.32])
}
/** A GABLE ROOF over w × d (ridge along z), eaves at y0, the ridge `rise` higher, `over` overhang: real thickness, rows
 *  of SHINGLES (or tin's ribs) whose stepped edges catch the light, fascia along the eaves, barge boards up the gables,
 *  a ridge cap, the gables' triangles boarded; `sag` bows the ridge (an old roof), `holes` drops rows (a ruin's). */
export interface RoofOpts { col: RGB; gable: RGB; tin?: boolean; sag?: number; holes?: number; thick?: number }
export function gableRoof(b: Builder, w: number, d: number, y0: number, rise: number, over: number, o: RoofOpts): void {
  const W = w / 2 + over, D = d / 2 + over, slope = rise / (w / 2), yE = y0 - over * slope, t = o.thick ?? 0.1
  const sagAt = (z: number) => (o.sag ?? 0) * Math.cos((z / D) * Math.PI * 0.5)
  for (const sx of [-1, 1]) {
    const E = V(sx * W, yE, 0), R = V(0, y0 + rise, 0), up = V(sx * rise, w / 2, 0).normalize()
    // the deck under the shingles (its underside the eaves' soffit)
    const mid = E.clone().add(R).multiplyScalar(0.5), dir = new GFX.Vector3().subVectors(R, E), L = dir.length(); dir.normalize()
    b.box(mid.clone().addScaledVector(up, -t / 2).setY(mid.y - t / 2 - sagAt(0) * 0.5), dir, up, Z, L / 2, t / 2, D, shade(o.col, 0.6))
    const rows = Math.max(4, Math.round(L / (o.tin ? 0.9 : 0.42)))
    for (let k = 0; k < rows; k++) {
      if (o.holes && b.rnd() < o.holes && k > 0 && k < rows - 1) continue
      const t0 = k / rows, t1 = Math.min(1, (k + 1.25) / rows)
      const a = E.clone().lerp(R, t0), c2 = E.clone().lerp(R, t1)
      // a row in pieces along z (a sag bows it; each piece its own tone — the shingles' patchwork)
      const pieces = o.tin ? 3 : 5
      for (let p = 0; p < pieces; p++) {
        const z0 = -D + (p * 2 * D) / pieces, z1 = -D + ((p + 1) * 2 * D) / pieces, zc = (z0 + z1) / 2
        const lift = up.clone().multiplyScalar(0.03 + k * 0.004)
        const p0 = a.clone().add(lift).setZ(zc), p1 = c2.clone().add(lift).setZ(zc)
        p0.y -= sagAt(zc) * (1 - t0) * 0.3 + sagAt(zc) * t0; p1.y -= sagAt(zc) * (1 - t1) * 0.3 + sagAt(zc) * t1
        const rdir = new GFX.Vector3().subVectors(p1, p0), rl = rdir.length(); rdir.normalize()
        const n = new GFX.Vector3().crossVectors(Z, rdir).multiplyScalar(-sx).normalize()
        const k2 = (o.tin ? 0.9 + 0.2 * b.rnd() : 0.78 + 0.42 * b.rnd())
        if (o.tin) b.setSurf(SURF.metal)
        b.box(p0.clone().add(p1).multiplyScalar(0.5), rdir, n.y < 0 ? n.negate() : n, Z, rl / 2, 0.025, (z1 - z0) / 2 + 0.01, shade(o.col, k2))
        if (o.tin) b.setSurf(SURF.wood)
      }
    }
    // the FASCIA along the eave, the BARGE boards up both gables
    beam(b, V(sx * (W + 0.02), yE - 0.06, -D - 0.04), V(sx * (W + 0.02), yE - 0.06, D + 0.04), 0.05, 0.2, shade(o.gable, 0.8))
    for (const sz of [-1, 1]) beam(b, V(sx * (W + 0.02), yE - 0.02, sz * (D + 0.03)), V(0, y0 + rise + 0.05 - sagAt(sz * D), sz * (D + 0.03)), 0.05, 0.22, shade(o.gable, 0.85))
    // RAFTER TAILS under the eave
    for (let z = -D + 0.4; z < D - 0.2; z += 0.8) beam(b, V(sx * (w / 2), y0 - 0.12, z), V(sx * (W - 0.05), yE - 0.12, z), 0.07, 0.12, shade(o.gable, 0.7))
  }
  // the RIDGE CAP
  if (!o.tin) for (let p = 0; p < 6; p++) {
    const z0 = -D + (p * 2 * D) / 6, z1 = z0 + (2 * D) / 6, zc = (z0 + z1) / 2
    box(b, 0, y0 + rise + 0.07 - sagAt(zc), zc, 0.13, 0.05, D / 6 + 0.01, shade(o.col, 0.7))
  }
  else { b.setSurf(SURF.metal); for (let p = 0; p < 3; p++) { const zc = -D + (p + 0.5) * (2 * D) / 3; box(b, 0, y0 + rise + 0.06, zc, 0.16, 0.04, D / 3, shade(o.col, 0.85)) } b.setSurf(SURF.wood) }
  // the GABLES: vertical boards up to the roof's line
  for (const sz of [-1, 1]) {
    const z = (sz * d) / 2, n = Math.round(w / 0.24)
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n), top = y0 + rise * (1 - Math.abs(x) / (w / 2)) - 0.04
      if (top - y0 < 0.05) continue
      box(b, x, (y0 + top) / 2, z + sz * 0.02, w / n / 2 - 0.01, (top - y0) / 2, 0.025, shade(o.gable, 0.8 + 0.3 * b.rnd()))
    }
  }
}
/** A LEAN-TO roof from (y0 at z0) down to (y1 at z1), w across: thick, rows, fascia. */
export function leanRoof(b: Builder, w: number, z0: number, y0: number, z1: number, y1: number, col: RGB, tin = false): void {
  const p0 = V(0, y0, z0), p1 = V(0, y1, z1), dir = new GFX.Vector3().subVectors(p1, p0), L = dir.length(); dir.normalize()
  const n = new GFX.Vector3().crossVectors(X, dir).normalize(); if (n.y < 0) n.negate()
  if (tin) b.setSurf(SURF.metal)
  b.box(p0.clone().add(p1).multiplyScalar(0.5), dir, n, X, L / 2, 0.05, w / 2, shade(col, 0.65))
  const rows = Math.max(3, Math.round(L / (tin ? 0.9 : 0.42)))
  for (let k = 0; k < rows; k++) {
    const a = p0.clone().lerp(p1, k / rows).addScaledVector(n, 0.06), c2 = p0.clone().lerp(p1, Math.min(1, (k + 1.25) / rows)).addScaledVector(n, 0.06)
    for (let p = 0; p < 3; p++) {
      const x = -w / 2 + (p + 0.5) * (w / 3)
      beam(b, a.clone().setX(x), c2.clone().setX(x), w / 3 + 0.01, 0.04, shade(col, 0.8 + 0.35 * b.rnd()), n)
    }
  }
  if (tin) b.setSurf(SURF.wood)
  beam(b, V(-w / 2 - 0.02, y1 - 0.05, z1), V(w / 2 + 0.02, y1 - 0.05, z1), 0.05, 0.16, shade(col, 0.6))
}
/** A WINDOW in a wall at c (its glass's centre), facing `out`: a frame proud of the wall, a sill, mullions; glass that
 *  glows at night (`lit`), BROKEN (shards, dark), or BOARDED; SHUTTERS swung open either side. */
export type WinState = 'lit' | 'dark' | 'broken' | 'boarded' | 'eerie'
export function windowAt(b: Builder, c: GFX.Vector3, out: GFX.Vector3, along: GFX.Vector3, hw: number, hh: number, state: WinState = 'lit', frame: RGB = C.trim, shutters?: RGB): void {
  const o = (k: number) => c.clone().addScaledVector(out, k)
  b.setSurf(state === 'eerie' ? SURF.eerie : SURF.plain)
  if (state === 'lit') b.setGlow(1)
  b.box(o(0.01), along, Y, out, hw, hh, 0.02, state === 'broken' ? C.dark : C.glass)
  b.setSurf(SURF.plain)
  b.setGlow(0)
  if (state === 'broken') for (const [x, y, s] of [[-0.6, 0.5, 0.3], [0.55, -0.4, 0.25], [0.2, 0.7, 0.2]]) {
    const p = o(0.03).addScaledVector(along, x * hw).addScaledVector(Y, y * hh)
    b.tri(p, p.clone().addScaledVector(along, s * hw).addScaledVector(Y, -s * hh * 1.5), p.clone().addScaledVector(along, -s * hw * 0.6).addScaledVector(Y, -s * hh * 0.9), shade(C.glass, 1.6))
  }
  b.setSurf(SURF.wood)
  // the frame, the mullions, the sill
  const fw = 0.07
  b.box(o(0.05).addScaledVector(Y, hh + fw / 2), along, Y, out, hw + fw, fw / 2, 0.05, frame)
  b.box(o(0.05).addScaledVector(Y, -hh - fw / 2), along, Y, out, hw + fw, fw / 2, 0.05, frame)
  for (const s of [-1, 1]) b.box(o(0.05).addScaledVector(along, s * (hw + fw / 2)), along, Y, out, fw / 2, hh, 0.05, frame)
  if (state !== 'boarded') {
    b.box(o(0.04), along, Y, out, 0.025, hh, 0.03, frame)
    b.box(o(0.04), along, Y, out, hw, 0.025, 0.03, frame)
  }
  b.box(o(0.1).addScaledVector(Y, -hh - fw - 0.03), along, Y, out, hw + fw + 0.08, 0.035, 0.1, shade(frame, 0.85))
  if (state === 'boarded') for (const [y, a] of [[0.55, 0.08], [0, -0.05], [-0.5, 0.12]]) {
    const up = Y.clone().applyAxisAngle(out, a), al = along.clone().applyAxisAngle(out, a)
    b.box(o(0.09).addScaledVector(Y, y * hh), al, up, out, hw + 0.15, 0.09, 0.02, b.wood(0.85 + 0.2 * b.rnd()))
  }
  if (shutters) for (const s of [-1, 1]) {
    // swung out ~70° on hinges at the frame's sides
    const hinge = o(0.06).addScaledVector(along, s * (hw + fw)), a = s * 1.2
    const dir = along.clone().multiplyScalar(s).applyAxisAngle(Y, -a * 0.5 * Math.sign(s) * (out.x * along.z - out.z * along.x >= 0 ? 1 : -1))
    const cc = hinge.clone().addScaledVector(dir, hw * 0.5).addScaledVector(out, 0.12)
    const nn = new GFX.Vector3().crossVectors(dir, Y).normalize()
    b.box(cc, dir, Y, nn, hw * 0.5, hh + 0.02, 0.025, shutters)
    for (const y of [-0.5, 0, 0.5]) b.box(cc.clone().addScaledVector(Y, y * hh).addScaledVector(nn, 0.02), dir, Y, nn, hw * 0.45, 0.04, 0.012, shade(shutters, 0.8))
  }
}
/** A DOOR: its frame, a plank door (Z-braced) on the wall at `c` (its foot's centre), hinged on the −along side and
 *  `open` radians ajar, a handle; steps down to the ground below `c` if it stands high. */
export function door(b: Builder, c: GFX.Vector3, out: GFX.Vector3, along: GFX.Vector3, hw: number, h: number, col: RGB, open = 0, frame: RGB = C.trim): void {
  const o = (k: number) => c.clone().addScaledVector(out, k)
  b.setSurf(SURF.plain); b.box(o(0.005).addScaledVector(Y, h / 2), along, Y, out, hw, h / 2, 0.01, C.dark); b.setSurf(SURF.wood)
  for (const s of [-1, 1]) b.box(o(0.05).addScaledVector(along, s * (hw + 0.05)).addScaledVector(Y, h / 2), along, Y, out, 0.05, h / 2 + 0.05, 0.05, frame)
  b.box(o(0.05).addScaledVector(Y, h + 0.07), along, Y, out, hw + 0.12, 0.07, 0.06, frame)
  const hinge = o(0.04).addScaledVector(along, -hw)
  const dir = along.clone().applyAxisAngle(Y, open * Math.sign(out.x * along.z - out.z * along.x || 1)), nn = new GFX.Vector3().crossVectors(dir, Y).normalize()
  const n = 4
  for (let i = 0; i < n; i++) {
    const cc = hinge.clone().addScaledVector(dir, (i + 0.5) * (2 * hw) / n).addScaledVector(Y, h / 2)
    b.box(cc, dir, Y, nn, hw / n - 0.008, h / 2 - 0.02, 0.025, shade(col, 0.88 + 0.22 * b.rnd()))
  }
  const mid = hinge.clone().addScaledVector(dir, hw)
  for (const y of [0.18, 0.82]) b.box(mid.clone().addScaledVector(Y, y * h).addScaledVector(nn, -0.035), dir, Y, nn, hw - 0.05, 0.06, 0.02, shade(col, 0.8))
  const ud = Y.clone().multiplyScalar(0.64 * h).addScaledVector(dir, 2 * hw - 0.2)
  beam(b, hinge.clone().addScaledVector(dir, 0.1).addScaledVector(Y, 0.18 * h).addScaledVector(nn, -0.04), hinge.clone().addScaledVector(Y, 0.18 * h).add(ud).addScaledVector(nn, -0.04), 0.03, 0.1, shade(col, 0.78), nn)
  b.setSurf(SURF.metal); b.box(hinge.clone().addScaledVector(dir, 2 * hw - 0.12).addScaledVector(Y, h * 0.48).addScaledVector(nn, -0.05), dir, Y, nn, 0.03, 0.06, 0.03, C.steel); b.setSurf(SURF.wood)
}
/** STEPS from the floor (top at y, its edge at c going out) down to the ground. */
export function steps(b: Builder, c: GFX.Vector3, out: GFX.Vector3, along: GFX.Vector3, hw: number, g: Ground, col?: RGB): void {
  const gy = g(c.x + out.x * 0.6, c.z + out.z * 0.6), n = Math.max(1, Math.round((c.y - gy) / 0.2))
  for (let i = 0; i < n; i++) {
    const y = c.y - ((i + 1) * (c.y - gy)) / (n + 0.4), p = c.clone().addScaledVector(out, 0.15 + i * 0.3).setY(y)
    b.box(p, along, Y, out, hw, Math.max(0.05, (y - gy) / 2 + 0.05) , 0.16, col ?? b.wood(0.95))
    b.box(p.clone().setY(y - (y - gy) / 2), along, Y, out, hw, (y - gy) / 2 + 0.05, 0.15, col ?? b.wood(0.95))
  }
}
/** A STONE CHIMNEY at (x, z) from y0 to y1: courses of stones (a little tapered), a mortar cap, a flue. */
export function chimney(b: Builder, x: number, z: number, y0: number, y1: number, hw = 0.42): void {
  b.setSurf(SURF.stone)
  const n = Math.round((y1 - y0) / 0.32)
  for (let i = 0; i < n; i++) {
    const y = y0 + (i + 0.5) * ((y1 - y0) / n), k = hw * (1 - 0.18 * (i / n))
    const ox = (b.rnd() - 0.5) * 0.03, oz = (b.rnd() - 0.5) * 0.03
    box(b, x + ox, y, z + oz, k, (y1 - y0) / n / 2 + 0.005, k, shade(C.stone, 0.72 + 0.38 * b.rnd()))
  }
  box(b, x, y1 + 0.06, z, hw * 0.95, 0.07, hw * 0.95, shade(C.mortar, 0.9))
  b.setSurf(SURF.plain); box(b, x, y1 + 0.1, z, hw * 0.5, 0.06, hw * 0.5, C.dark); b.setSurf(SURF.wood)
}
/** A STOVEPIPE through a roof: a metal flue with a cap. */
export function stovepipe(b: Builder, x: number, z: number, y0: number, y1: number): void {
  pipe(b, V(x, y0, z), V(x, y1, z), 0.09, C.steel)
  pipe(b, V(x, y1, z), V(x, y1 + 0.08, z), 0.2, shade(C.steel, 0.8))
}
/** A PORCH along the front (z = d/2) of a w-wide building: a deck at floorY on posts to the ground, a rail with
 *  balusters, STEPS down at sx, a lean-to roof from the wall (at yw) out over it. */
export function porch(b: Builder, w: number, z0: number, depth: number, floorY: number, yw: number, g: Ground, roofCol: RGB, stepX = 0, rail = true): void {
  // the deck: planks across, joists under
  const n = Math.round(w / 0.17)
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n)
    box(b, x, floorY - 0.03, z0 + depth / 2, w / n / 2 - 0.012, 0.035, depth / 2, b.wood(1.0 + 0.2 * b.rnd()))
  }
  for (const z of [z0 + 0.2, z0 + depth - 0.12]) box(b, 0, floorY - 0.15, z, w / 2, 0.08, 0.07, b.wood(0.7))
  // posts to the ground (each on its footing), the roof
  const posts = Math.max(2, Math.round(w / 2.4) + 1)
  for (let i = 0; i < posts; i++) {
    const x = -w / 2 + 0.12 + (i * (w - 0.24)) / (posts - 1)
    post(b, x, z0 + depth - 0.12, yw - 0.45, g, 0.08)
    // (under the deck too)
  }
  beam(b, V(-w / 2, yw - 0.45, z0 + depth - 0.12), V(w / 2, yw - 0.45, z0 + depth - 0.12), 0.14, 0.16, b.wood(0.75))
  leanRoof(b, w + 0.4, z0 - 0.05, yw, z0 + depth + 0.45, yw - 0.65, roofCol)
  if (rail) {
    for (const s of [-1, 1]) {
      // along the front, either side of the steps
      const xa = s < 0 ? -w / 2 + 0.12 : stepX + 0.65, xb = s < 0 ? stepX - 0.65 : w / 2 - 0.12
      if (xb - xa < 0.4) continue
      beam(b, V(xa, floorY + 0.85, z0 + depth - 0.12), V(xb, floorY + 0.85, z0 + depth - 0.12), 0.08, 0.06, b.wood(0.9))
      for (let x = xa + 0.25; x < xb - 0.1; x += 0.32) beam(b, V(x, floorY, z0 + depth - 0.12), V(x, floorY + 0.83, z0 + depth - 0.12), 0.045, 0.045, b.wood(0.95), Z)
    }
  }
  steps(b, V(stepX, floorY, z0 + depth), Z, X, 0.55, g)
}

// ------------------------------------------------------------------------------------------------ outdoor things
/** A WOODPILE: split logs stacked along `along` between two posts, against a wall or freestanding. */
export function woodpile(b: Builder, c: GFX.Vector3, rot: number, len: number, rows: number, g: Ground): void {
  if (b.sink?.('woodpile', c.x, g(c.x, c.z), c.z, rot, { scale: [len / 2.8, rows / 6, 1] })) return
  const u = V(Math.cos(rot), 0, -Math.sin(rot)), w = V(Math.sin(rot), 0, Math.cos(rot))
  const gy = g(c.x, c.z)
  for (let r = 0; r < rows; r++) {
    const n = Math.round(len / 0.19)
    for (let i = 0; i < n; i++) {
      const p = c.clone().addScaledVector(u, -len / 2 + (i + 0.5) * (len / n) + (r % 2) * 0.05).setY(gy + 0.1 + r * 0.17)
      b.log(p.clone().addScaledVector(w, -0.3 - 0.04 * b.rnd()), p.clone().addScaledVector(w, 0.3 + 0.04 * b.rnd()), 0.085, b.wood(1.0 + 0.25 * b.rnd()))
    }
  }
  for (const s of [-1, 1]) b.log(c.clone().addScaledVector(u, s * (len / 2 + 0.1)).setY(gy), c.clone().addScaledVector(u, s * (len / 2 + 0.1)).setY(gy + rows * 0.17 + 0.1), 0.05, b.wood(0.7))
}
/** A CHOPPING BLOCK, an axe in it, a few split pieces about. */
export function chopBlock(b: Builder, x: number, z: number, g: Ground): void {
  const y = g(x, z)
  b.log(V(x, y - 0.1, z), V(x, y + 0.45, z), 0.26, b.wood(0.9))
  b.log(V(x + 0.05, y + 0.45, z), V(x + 0.35, y + 1.0, z + 0.12), 0.022, b.wood(1.3))
  b.setSurf(SURF.metal); b.box(V(x + 0.06, y + 0.48, z + 0.01), X, Y, Z, 0.1, 0.05, 0.015, C.steel); b.setSurf(SURF.wood)
  for (let i = 0; i < 4; i++) { const a = b.rnd() * 6.28, r = 0.5 + b.rnd() * 0.6; b.log(V(x + Math.cos(a) * r, y + 0.05, z + Math.sin(a) * r), V(x + Math.cos(a + 0.3) * (r + 0.35), y + 0.07, z + Math.sin(a + 0.3) * (r + 0.35)), 0.06, b.wood(1.2)) }
}
/** A MAILBOX on a post: a rounded box, its little red flag. */
export function mailbox(b: Builder, x: number, z: number, rot: number, g: Ground, col: RGB = [0.18, 0.2, 0.22]): void {
  const y = g(x, z)
  b.log(V(x, y - 0.2, z), V(x, y + 1.05, z), 0.05, b.wood(0.8))
  const u = V(Math.cos(rot), 0, -Math.sin(rot))
  b.setSurf(SURF.metal)
  pipe(b, V(x, y + 1.18, z).addScaledVector(u, -0.25), V(x, y + 1.18, z).addScaledVector(u, 0.25), 0.13, col)
  b.setSurf(SURF.plain); rbox(b, x + u.x * 0.05, y + 1.3, z + u.z * 0.05, rot + Math.PI / 2, 0.015, 0.1, 0.05, [0.5, 0.06, 0.04]); b.setSurf(SURF.wood)
}
/** A BARREL (standing, or lying along rot): staves and two hoops; `metal` an oil drum. */
export function barrel(b: Builder, x: number, y: number, z: number, col: RGB, lying = false, rot = 0, metal = false): void {
  // (modelled — places.py: staves and hoops, or a ribbed steel drum in its paint; lying: on its side along rot)
  if (b.sink && (lying
    ? b.sink(metal ? 'drum' : 'barrel', x - Math.cos(rot) * 0.45, y + 0.3, z + Math.sin(rot) * 0.45, rot, { tint: col, tiltZ: -Math.PI / 2 })
    : b.sink(metal ? 'drum' : 'barrel', x, y, z, rot, { tint: col }))) return
  const a = lying ? V(x - Math.cos(rot) * 0.45, y + 0.3, z + Math.sin(rot) * 0.45) : V(x, y, z)
  const c2 = lying ? V(x + Math.cos(rot) * 0.45, y + 0.3, z - Math.sin(rot) * 0.45) : V(x, y + 0.9, z)
  b.setSurf(metal ? SURF.metal : SURF.wood)
  b.log(a, c2, 0.3, col)
  for (const t of [0.18, 0.82]) b.log(a.clone().lerp(c2, t - 0.02), a.clone().lerp(c2, t + 0.02), 0.31, metal ? shade(col, 0.8) : C.steel)
  b.setSurf(SURF.wood)
}
/** A wooden CRATE (planked, edged), s its half size. */
export function crate(b: Builder, x: number, y: number, z: number, rot: number, s: number): void {
  rbox(b, x, y + s, z, rot, s, s, s, b.wood(1.15))
  for (const k of [-1, 1]) rbox(b, x, y + s + k * s * 0.85, z, rot, s + 0.012, s * 0.12, s + 0.012, b.wood(0.85))
}
/** A folding CAMP CHAIR: a fabric seat and back on a steel frame, turned rot. */
export function campChair(b: Builder, x: number, y: number, z: number, rot: number, col: RGB): void {
  const u = V(Math.cos(rot), 0, -Math.sin(rot)), w = V(Math.sin(rot), 0, Math.cos(rot))
  const P = (a: number, h: number, c: number) => V(x, y, z).addScaledVector(u, a).addScaledVector(w, c).setY(y + h)
  b.setSurf(SURF.fabric)
  panel(b, P(-0.25, 0.42, 0.22), P(0.25, 0.42, 0.22), P(0.25, 0.38, -0.2), P(-0.25, 0.38, -0.2), col, shade(col, 0.7))
  panel(b, P(-0.25, 0.42, -0.2), P(0.25, 0.42, -0.2), P(0.25, 0.85, -0.32), P(-0.25, 0.85, -0.32), col, shade(col, 0.7))
  b.setSurf(SURF.metal)
  for (const s of [-1, 1]) {
    b.log(P(s * 0.27, 0, 0.25), P(s * 0.27, 0.88, -0.34), 0.012, C.steel)
    b.log(P(s * 0.27, 0, -0.25), P(s * 0.27, 0.44, 0.24), 0.012, C.steel)
  }
  b.setSurf(SURF.wood)
}
/** A folding TABLE (a slatted top on X legs). */
export function campTable(b: Builder, x: number, y: number, z: number, rot: number): void {
  for (let i = 0; i < 5; i++) rbox(b, x + Math.cos(rot) * 0, y + 0.72, z, rot, 0.55, 0.018, 0.07, b.wood(1.2 + 0.1 * b.rnd()))
  const u = V(Math.cos(rot), 0, -Math.sin(rot)), w = V(Math.sin(rot), 0, Math.cos(rot))
  for (let i = 0; i < 5; i++) { const p = V(x, y + 0.72, z).addScaledVector(w, -0.32 + i * 0.16); rbox(b, p.x, p.y, p.z, rot, 0.55, 0.02, 0.065, b.wood(1.1 + 0.15 * b.rnd())) }
  b.setSurf(SURF.metal)
  for (const s of [-1, 1]) for (const k of [-1, 1]) b.log(V(x, y, z).addScaledVector(u, s * 0.45).addScaledVector(w, k * 0.3), V(x, y + 0.7, z).addScaledVector(u, s * 0.45).addScaledVector(w, -k * 0.3), 0.012, C.steel)
  b.setSurf(SURF.wood)
}
/** A LANTERN (glows from dusk): a cage, a glass, a handle — hung at (x, y, z). */
export function lantern(b: Builder, x: number, y: number, z: number): void {
  b.setSurf(SURF.metal)
  box(b, x, y - 0.12, z, 0.08, 0.02, 0.08, C.steel); box(b, x, y + 0.12, z, 0.07, 0.03, 0.07, C.steel)
  b.log(V(x, y + 0.15, z), V(x, y + 0.24, z), 0.012, C.steel)
  b.setSurf(SURF.plain); b.setGlow(1); box(b, x, y, z, 0.055, 0.1, 0.055, [0.55, 0.42, 0.2]); b.setGlow(0); b.setSurf(SURF.wood)
}
/** A BACKPACK leaning (rot: its back's facing): the pack, its rolled mat on top, a side pocket. */
export function backpack(b: Builder, x: number, y: number, z: number, rot: number, col: RGB): void {
  const u = V(Math.cos(rot), 0, -Math.sin(rot)), w = V(Math.sin(rot), 0, Math.cos(rot)), up = V(0, 1, 0).addScaledVector(w, -0.25).normalize()
  b.setSurf(SURF.fabric)
  b.box(V(x, y + 0.32, z), u, up, w, 0.2, 0.3, 0.13, col)
  b.box(V(x, y + 0.2, z).addScaledVector(w, 0.15), u, up, w, 0.15, 0.12, 0.05, shade(col, 0.8))
  b.log(V(x, y + 0.66, z).addScaledVector(u, -0.27).addScaledVector(w, -0.12), V(x, y + 0.66, z).addScaledVector(u, 0.27).addScaledVector(w, -0.12), 0.08, [0.15, 0.28, 0.32])
  b.setSurf(SURF.wood)
}
/** A CLOTHESLINE between two posts (or poles) with things hung on it. */
export function clothesline(b: Builder, p0: GFX.Vector3, p1: GFX.Vector3, g: Ground, cols: RGB[]): void {
  for (const p of [p0, p1]) b.log(V(p.x, g(p.x, p.z) - 0.1, p.z), V(p.x, p.y + 0.1, p.z), 0.04, b.wood(0.8))
  const n = 10, pts: GFX.Vector3[] = []
  for (let k = 0; k <= n; k++) { const t = k / n, q = p0.clone().lerp(p1, t); q.y -= Math.sin(Math.PI * t) * 0.18; pts.push(q) }
  for (let k = 0; k < n; k++) b.log(pts[k], pts[k + 1], 0.006, C.rope)
  const dir = new GFX.Vector3().subVectors(p1, p0).normalize()
  b.setSurf(SURF.fabric)
  cols.forEach((c, i) => {
    const t = (i + 1) / (cols.length + 1), q = pts[Math.round(t * n)], hw = 0.22 + 0.1 * b.rnd(), h = 0.4 + 0.3 * b.rnd()
    const a = q.clone().addScaledVector(dir, -hw), c2 = q.clone().addScaledVector(dir, hw)
    const sway = V(0.04, 0, 0.06)
    panel(b, a, c2, c2.clone().add(sway).setY(c2.y - h), a.clone().add(sway).setY(a.y - h * 0.95), c, shade(c, 0.75))
  })
  b.setSurf(SURF.wood)
}
/** A wheel: a tyre and its hub, its axle along `ax`, centre c. */
export function wheel(b: Builder, c: GFX.Vector3, ax: GFX.Vector3, r: number, w: number, flat = false): void {
  b.setSurf(SURF.plain)
  const k = flat ? 0.82 : 1
  b.log(c.clone().addScaledVector(ax, -w / 2).setY(c.y - (1 - k) * r), c.clone().addScaledVector(ax, w / 2).setY(c.y - (1 - k) * r), r * k, C.rubber)
  b.setSurf(SURF.metal)
  b.log(c.clone().addScaledVector(ax, -w / 2 - 0.01), c.clone().addScaledVector(ax, w / 2 + 0.01), r * 0.55, [0.3, 0.3, 0.32])
  b.setSurf(SURF.wood)
}

// -------------------------------------------------------------------------------------------------- vehicles
/** An old PICKUP TRUCK (5.3 m, real size), facing +x in its frame, placed at (x, z) turned rot on the ground: rounded
 *  fenders, a cab with a raked windscreen, the bed, bumpers, lamps. `rust` 0..1 how far gone; `flat` tyres; `open`
 *  the driver's door swung; `sunk` its wheels in the mud. */
export function pickup(b: Builder, x: number, z: number, rot: number, g: Ground, col: RGB, o: { rust?: number; flat?: boolean; open?: boolean; sunk?: number; noWheel?: boolean } = {}): void {
  const cs = Math.cos(rot), sn = Math.sin(rot)
  const T = (lx: number, ly: number, lz: number) => V(x + lx * cs + lz * sn, ly, z - lx * sn + lz * cs)
  const fx = T(1.6, 0, 0), bx = T(-1.6, 0, 0)
  const y0 = (g(fx.x, fx.z) + g(bx.x, bx.z)) / 2 - (o.sunk ?? 0)
  const pitch = Math.atan2(g(fx.x, fx.z) - g(bx.x, bx.z), 3.2)
  const P = (lx: number, ly: number, lz: number) => T(lx, y0 + ly + lx * Math.tan(pitch), lz)
  // (modelled — places.py: a '50s farm pickup in its paint, or the wreck: rust, flat tyres, the hood up)
  if (b.sink?.((o.rust ?? 0) > 0.5 || o.flat || o.noWheel ? 'pickup_wreck' : 'pickup', x, y0, z, rot, { tint: col, tiltZ: pitch })) return
  const U = T(1, 0, 0).sub(T(0, 0, 0)), W = T(0, 0, 1).sub(T(0, 0, 0))
  const body = mixc(col, C.rust, o.rust ?? 0)
  const bx2 = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, c: RGB) => b.box(P(lx, ly, lz), U, Y, W, hx, hy, hz, c)
  b.setSurf(SURF.metal)
  // the frame and the bed
  bx2(0, 0.62, 0, 2.55, 0.08, 0.7, C.steel)
  bx2(-1.45, 0.98, 0, 1.15, 0.05, 0.86, shade(body, 0.7))                // the bed's floor
  for (const s of [-1, 1]) bx2(-1.45, 1.2, s * 0.86, 1.15, 0.24, 0.035, body) // its sides
  bx2(-2.58, 1.2, 0, 0.035, 0.24, 0.86, shade(body, 0.9))                 // the tailgate
  // the cab and the bonnet
  bx2(0.35, 1.25, 0, 0.55, 0.32, 0.88, body)
  bx2(1.6, 1.05, 0, 0.75, 0.24, 0.86, body)
  // the cab's glasshouse: the roof, the raked windscreen, the side windows
  bx2(0.2, 2.02, 0, 0.42, 0.04, 0.84, body)
  b.setSurf(SURF.plain)
  b.quad(P(0.62, 1.58, -0.82), P(0.62, 1.58, 0.82), P(0.85, 1.58, 0.82), P(0.85, 1.58, -0.82), C.glass)
  const ws = [P(0.62, 1.98, -0.8), P(0.62, 1.98, 0.8), P(0.86, 1.56, 0.84), P(0.86, 1.56, -0.84)]
  b.quad(ws[3], ws[2], ws[1], ws[0], C.glass)
  for (const s of [-1, 1]) {
    const wa = P(-0.18, 1.58, s * 0.885), wb = P(0.6, 1.58, s * 0.885), wc = P(0.6, 1.97, s * 0.86), wd = P(-0.18, 1.97, s * 0.86)
    if (s > 0) b.quad(wa, wb, wc, wd, C.glass); else b.quad(wd, wc, wb, wa, C.glass)
  }
  b.quad(P(-0.2, 1.58, 0.84), P(-0.2, 1.58, -0.84), P(-0.2, 1.97, -0.82), P(-0.2, 1.97, 0.82), C.glass)
  b.setSurf(SURF.metal)
  for (const s of [-1, 1]) { bx2(0.21, 1.78, s * 0.86, 0.42, 0.2, 0.02, shade(body, 0.95)); bx2(-0.19, 1.78, s * 0.85, 0.03, 0.2, 0.02, body); bx2(0.62, 1.78, s * 0.85, 0.03, 0.2, 0.02, body) }
  // the FENDERS over each wheel (a fat half-log), bumpers, the grille, lamps
  for (const lx of [1.55, -1.55]) for (const s of [-1, 1]) b.log(P(lx - 0.5, 0.95, s * 0.92), P(lx + 0.5, 0.95, s * 0.92), 0.22, shade(body, 0.92))
  bx2(2.42, 0.78, 0, 0.1, 0.12, 0.92, C.steel); bx2(-2.66, 0.75, 0, 0.08, 0.1, 0.92, C.steel)
  bx2(2.36, 1.08, 0, 0.03, 0.18, 0.6, shade(C.steel, 1.4))
  b.setSurf(SURF.plain)
  for (const s of [-1, 1]) { bx2(2.37, 1.1, s * 0.7, 0.03, 0.09, 0.09, [0.55, 0.52, 0.42]); bx2(-2.62, 1.12, s * 0.75, 0.03, 0.06, 0.08, [0.4, 0.05, 0.03]) }
  // the WHEELS (one gone from a wreck: the axle on a block)
  for (const lx of [1.55, -1.55]) for (const s of [-1, 1]) {
    if (o.noWheel && lx < 0 && s > 0) { b.setSurf(SURF.stone); bx2(lx, 0.2, s * 0.7, 0.25, 0.2, 0.2, C.stone); b.setSurf(SURF.wood); continue }
    wheel(b, P(lx, 0.4, s * 0.82), W.clone().normalize(), 0.4, 0.26, !!o.flat && (lx > 0) === (s > 0))
  }
  // the driver's door ajar
  if (o.open) { b.setSurf(SURF.metal); const h = P(0.75, 1.3, -0.9), dd = U.clone().multiplyScalar(-1).applyAxisAngle(Y, -0.9); b.box(h.clone().addScaledVector(dd, 0.45), dd, Y, new GFX.Vector3().crossVectors(dd, Y).normalize(), 0.45, 0.35, 0.03, body) }
  b.setSurf(SURF.wood)
}

// ---------------------------------------------------------------------------------------------------- tents
/** An A-FRAME TENT (ridge along z, its door at +z) at (x, z) turned rot: the ridge sags between its poles, each side
 *  drawn in a few panels that sag in a little (the fabric's tension), the door's flaps tied back, guy lines to stakes,
 *  a groundsheet's edge. L, W, H: half length, half width, height. `collapsed`: the ridge down at one end. */
export function tentA(b: Builder, x: number, z: number, rot: number, g: Ground, col: RGB, L = 1.3, W = 1.1, H = 1.45, collapsed = false): void {
  const cs = Math.cos(rot), sn = Math.sin(rot), y0 = g(x, z)
  const P = (lx: number, ly: number, lz: number) => V(x + lx * cs + lz * sn, y0 + ly, z - lx * sn + lz * cs)
  const N = 4, inner = shade(col, 0.55)
  const ridge = (t: number) => (collapsed ? H * (0.35 + 0.65 * t) : H) - 0.07 * Math.sin(Math.PI * t) // (t 0 back … 1 front)
  b.setSurf(SURF.fabric)
  for (const sx of [-1, 1]) for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) {
    const t0 = i / N, t1 = (i + 1) / N, s0 = j / 2, s1 = (j + 1) / 2
    const pt = (t: number, s: number) => {
      const z2 = -L + 2 * L * t, ry = ridge(t)
      // a panel's middle sags in (s = 0.5) and its bottom stands a touch out (pegged)
      const sag = Math.sin(Math.PI * s) * 0.07 * (0.6 + 0.4 * Math.sin(Math.PI * t))
      return P(sx * (W * s + 0.04 * s * s) - sx * sag, ry * (1 - s), z2)
    }
    const a = pt(t0, s0), c2 = pt(t1, s0), d = pt(t1, s1), e = pt(t0, s1)
    const k = sx > 0 ? 1 : 0.86
    if (sx > 0) panel(b, a, e, d, c2, shade(col, k), inner); else panel(b, a, c2, d, e, shade(col, k), inner)
  }
  // the BACK wall, the FRONT: its flaps tied back, the dark inside, a groundsheet lip
  panelTri(b, P(-W, 0, -L), P(0, ridge(0), -L), P(W, 0, -L), shade(col, 0.8), inner)
  b.setSurf(SURF.plain)
  b.tri(P(W * 0.7, 0, L - 0.25), P(-W * 0.7, 0, L - 0.25), P(0, ridge(1) * 0.92, L - 0.25), C.dark)
  b.setSurf(SURF.fabric)
  for (const s of [-1, 1]) panelTri(b, P(s * W, 0, L), P(s * W * 0.45, 0, L + 0.25), P(0, ridge(1), L), shade(col, 0.95), inner)
  box(b, x, y0 + 0.012, z, 0.01, 0.01, 0.01, col) // (nothing — keeps the surf switch tidy)
  b.setSurf(SURF.plain)
  b.box(P(0, 0.015, L + 0.12), V(cs, 0, -sn), Y, V(sn, 0, cs), W * 0.75, 0.015, 0.15, [0.08, 0.12, 0.1])
  // the POLES at both ends, guy lines to stakes, the side pegs
  b.setSurf(SURF.metal)
  for (const e of [-1, 1]) {
    const top = P(0, ridge(e > 0 ? 1 : 0) + 0.12, e * L)
    b.log(P(0, 0, e * L), top, 0.018, C.steel)
    const stake = P(0, 0, e * (L + 1.1))
    b.log(top, stake, 0.005, C.rope)
    b.log(stake.clone().setY(stake.y - 0.1), stake.clone().setY(stake.y + 0.12), 0.012, C.steel)
  }
  for (const sx of [-1, 1]) for (const t of [0.15, 0.85]) { const p = P(sx * (W + 0.15), 0, -L + 2 * L * t); b.log(p.clone().setY(p.y - 0.05), p.clone().setY(p.y + 0.1), 0.01, C.steel) }
  b.setSurf(SURF.wood)
}
/** A DOME TENT at (x, z) turned rot, r its radius, h its height: crossed poles (the fabric sags in between them), a
 *  rain fly's skirt a shade darker, the door's zip arc, guy lines. */
export function tentDome(b: Builder, x: number, z: number, rot: number, g: Ground, col: RGB, fly: RGB, r = 1.25, h = 1.25): void {
  const y0 = g(x, z), M = 8, R = 4
  const pt = (i: number, j: number) => {
    const a = (i / M) * Math.PI * 2 + rot + Math.PI / 8, t = j / R
    // between the poles (they run along the diagonals: i even) the fabric sags in
    const sag = i % 2 ? 0.92 : 1
    const rr = r * Math.cos(t * Math.PI * 0.5) * (j === 0 ? 1 : sag), yy = h * Math.sin(t * Math.PI * 0.5) * (i % 2 && j > 0 && j < R ? 0.95 : 1)
    return V(x + Math.cos(a) * rr, y0 + yy, z + Math.sin(a) * rr)
  }
  b.setSurf(SURF.fabric)
  for (let i = 0; i < M; i++) for (let j = 0; j < R; j++) {
    const a = pt(i, j), c2 = pt(i + 1, j), d = pt(i + 1, j + 1), e = pt(i, j + 1)
    const isDoor = i === 2 && j < 2
    const c = isDoor ? shade(col, 0.6) : j === 0 ? fly : shade(col, 0.88 + 0.12 * ((i + j) % 2))
    if (j === R - 1) panelTri(b, a, c2, d, c, shade(col, 0.5)); else panel(b, a, c2, d, e, c, shade(col, 0.5))
  }
  b.setSurf(SURF.metal)
  for (const i of [0, 2, 4, 6]) for (let j = 0; j < R; j++) b.log(pt(i, j).multiplyScalar(1).addScaledVector(V(0, 1, 0), 0.01), pt(i, j + 1), 0.012, C.steel)
  for (const i of [1, 3, 5, 7]) { const p = pt(i, 1), a = (i / M) * Math.PI * 2 + rot + Math.PI / 8, s = V(x + Math.cos(a) * (r + 0.9), y0, z + Math.sin(a) * (r + 0.9)); b.log(p, s, 0.005, C.rope) }
  b.setSurf(SURF.wood)
}
/** A TARP SHELTER: a sheet strung between two trees / poles on a ridge line, pegged down one side. */
export function tarpShelter(b: Builder, x: number, z: number, rot: number, g: Ground, col: RGB, w = 3.2, d = 2.6): void {
  const cs = Math.cos(rot), sn = Math.sin(rot), y0 = g(x, z)
  const P = (lx: number, ly: number, lz: number) => V(x + lx * cs + lz * sn, y0 + ly, z - lx * sn + lz * cs)
  b.setSurf(SURF.fabric)
  const n = 3
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i * w) / n, x1 = x0 + w / n, s0 = 0.05 * Math.sin((Math.PI * i) / n), s1 = 0.05 * Math.sin((Math.PI * (i + 1)) / n)
    panel(b, P(x0, 1.9 - s0, 0), P(x1, 1.9 - s1, 0), P(x1, 0.25, d), P(x0, 0.25, d), col, shade(col, 0.6))
  }
  b.setSurf(SURF.wood)
  for (const s of [-1, 1]) b.log(P(s * (w / 2 + 0.1), 0, 0), P(s * (w / 2 + 0.1), 2.0, 0), 0.04, b.wood(0.75))
  b.log(P(-w / 2 - 0.3, 1.95, 0), P(w / 2 + 0.3, 1.95, 0), 0.008, C.rope)
}
/** A FIRE RING: stones round a fire — `lit` (glowing embers, crossed logs) or cold (ash, charred stubs). */
export function fireRing(b: Builder, x: number, z: number, g: Ground, lit: boolean): void {
  const y = g(x, z)
  b.setSurf(SURF.stone)
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + b.rnd() * 0.2
    rock(b, V(x + Math.cos(a) * 0.62, y + 0.06, z + Math.sin(a) * 0.62), V(0.15, 0.12, 0.13), a, shade(C.stone, 0.7 + 0.2 * b.rnd()), 7 + k)
  }
  b.setSurf(SURF.plain)
  box(b, x, y + 0.02, z, 0.42, 0.025, 0.42, lit ? [0.06, 0.05, 0.045] : [0.25, 0.24, 0.23])
  if (lit) { b.setGlow(1); box(b, x, y + 0.05, z, 0.26, 0.04, 0.26, [0.35, 0.12, 0.04]); b.setGlow(0) }
  b.setSurf(SURF.wood)
  b.log(V(x - 0.42, y + 0.1, z - 0.2), V(x + 0.42, y + 0.2, z + 0.18), 0.07, lit ? b.wood(0.55) : [0.04, 0.035, 0.03])
  b.log(V(x - 0.3, y + 0.2, z + 0.36), V(x + 0.32, y + 0.1, z - 0.36), 0.07, lit ? b.wood(0.5) : [0.05, 0.04, 0.035])
}

// ---------------------------------------------------------------------------------------------------- water
/** A DOCK from (x0, z0) out along `dir` (rad, local) for len m: planks across with gaps (a few missing, a few askew),
 *  two stringers, PILES every ~2 m down to the bed (Ground) and into it, cross-bracing, cleats, a ladder at the end. */
export function dock(b: Builder, x0: number, z0: number, dir: number, len: number, w: number, deckY: number, g: Ground, missing = 0.04): void {
  const u = V(Math.sin(dir), 0, Math.cos(dir)), s = V(Math.cos(dir), 0, -Math.sin(dir))
  const at = (t: number, k: number) => V(x0, deckY, z0).addScaledVector(u, t).addScaledVector(s, k)
  const n = Math.round(len / 0.24)
  for (let i = 0; i < n; i++) {
    if (i > 2 && b.rnd() < missing) continue
    const c = at((i + 0.5) * (len / n), (b.rnd() - 0.5) * 0.06)
    const skew = (b.rnd() - 0.5) * 0.06
    b.box(c, s.clone().applyAxisAngle(Y, skew), Y, u.clone().applyAxisAngle(Y, skew), w / 2 + (b.rnd() - 0.5) * 0.08, 0.035, len / n / 2 - 0.02, b.wood(0.95 + 0.3 * b.rnd()))
  }
  for (const k of [-w / 2 + 0.12, w / 2 - 0.12]) beam(b, at(0, k).setY(deckY - 0.12), at(len, k).setY(deckY - 0.12), 0.1, 0.16, b.wood(0.6))
  const piles = Math.max(2, Math.round(len / 2.1) + 1)
  for (let i = 0; i < piles; i++) {
    const t = 0.15 + (i * (len - 0.3)) / (piles - 1)
    for (const k of [-w / 2 + 0.05, w / 2 - 0.05]) {
      const p = at(t, k), gy = g(p.x, p.z)
      b.log(p.clone().setY(Math.min(gy, deckY - 0.5) - 0.6), p.clone().setY(deckY + (i === piles - 1 ? 0.45 : 0.04)), 0.11, b.wood(0.6))
    }
    if (i > 0) {
      const a = at(t, -w / 2 + 0.05), c2 = at(t, w / 2 - 0.05), gy = Math.min(g(a.x, a.z), g(c2.x, c2.z))
      if (deckY - gy > 0.7) beam(b, a.clone().setY(deckY - 0.25), c2.clone().setY(Math.max(gy + 0.1, deckY - 1.3)), 0.06, 0.1, b.wood(0.55), u)
    }
  }
  b.setSurf(SURF.metal)
  for (const t of [len * 0.45, len - 0.4]) for (const k of [-w / 2 + 0.1, w / 2 - 0.1]) b.box(at(t, k).setY(deckY + 0.06), u, Y, s, 0.12, 0.03, 0.03, C.steel)
  // the ladder down into the water at the end, on the right
  const lt = at(len - 0.6, w / 2 + 0.02)
  for (const o of [-0.22, 0.22]) b.log(lt.clone().addScaledVector(u, o).setY(deckY + 0.5), lt.clone().addScaledVector(u, o).setY(deckY - 1.4), 0.02, C.steel)
  for (let k = 0; k < 5; k++) b.log(lt.clone().addScaledVector(u, -0.22).setY(deckY - 1.2 + k * 0.32), lt.clone().addScaledVector(u, 0.22).setY(deckY - 1.2 + k * 0.32), 0.015, C.steel)
  b.setSurf(SURF.wood)
}
/** A ROWBOAT (3.4 m): a lofted plank hull — sections from a pointed bow to a square transom — its inside a shade
 *  darker, three thwarts, a pair of oars. On the water at (x, y, z) turned rot (bow along +x); `beached` heels it over. */
export function rowboat(b: Builder, x: number, y: number, z: number, rot: number, col: RGB, beached = false, canoe = false): void {
  const cs = Math.cos(rot), sn = Math.sin(rot), heel = beached ? 0.22 : 0
  const T = (lx: number, ly: number, lz: number) => {
    const ry = ly * Math.cos(heel) - lz * Math.sin(heel), rz = ly * Math.sin(heel) + lz * Math.cos(heel)
    return V(x + lx * cs + rz * sn, y + ry, z - lx * sn + rz * cs)
  }
  const Lh = canoe ? 2.4 : 1.7, Bh = canoe ? 0.42 : 0.68, D = canoe ? 0.38 : 0.45
  const secs = 8, sec = (i: number) => {
    const t = i / secs, xx = -Lh + 2 * Lh * t
    // beam: full amidships, to a point at the bow (and the canoe's stern); the rowboat's transom square
    const k = canoe ? Math.sin(Math.PI * t) ** 0.7 : t < 0.15 ? 0.75 + t : Math.sin(Math.PI * (0.15 + 0.85 * t)) ** 0.6
    const sheer = D + (canoe ? 0.18 : 0.1) * (2 * t - 1) ** 2 * (canoe || t > 0.5 ? 1 : 0.4)
    return [V(xx, sheer, -Bh * k), V(xx, D * 0.35, -Bh * k * 0.85), V(xx, 0, 0), V(xx, D * 0.35, Bh * k * 0.85), V(xx, sheer, Bh * k)]
  }
  const inner = shade(col, 0.6)
  b.setSurf(canoe ? SURF.metal : SURF.wood)
  for (let i = 0; i < secs; i++) {
    const A = sec(i), B = sec(i + 1)
    for (let j = 0; j < 4; j++) {
      const a = T(A[j].x, A[j].y, A[j].z), c2 = T(B[j].x, B[j].y, B[j].z), d = T(B[j + 1].x, B[j + 1].y, B[j + 1].z), e = T(A[j + 1].x, A[j + 1].y, A[j + 1].z)
      panel(b, a, e, d, c2, shade(col, j < 2 ? 0.9 : 1), inner)
    }
  }
  if (!canoe) { const A = sec(0); for (let j = 1; j < 4; j++) panelTri(b, T(A[0].x, A[0].y, A[0].z), T(A[j].x, A[j].y, A[j].z), T(A[j + 1].x, A[j + 1].y, A[j + 1].z), shade(col, 0.85), inner) }
  b.setSurf(SURF.wood)
  for (const t of canoe ? [-0.8, 0.8] : [-0.9, 0.1, 0.95]) b.box(T(t, D * 0.75, 0), V(cs, 0, -sn), Y, V(sn, 0, cs), 0.1, 0.025, Bh * 0.8, b.wood(1.1))
  for (const s of [-1, 1]) b.log(T(-0.6, D + 0.05, s * 0.3), T(1.5, D + 0.02, s * 0.15), 0.025, b.wood(1.2))
}
/** A FISHING ROD on a forked stick at (x, z), cast out along rot; a bucket and a tackle box beside it. */
export function fishingSpot(b: Builder, x: number, z: number, rot: number, g: Ground): void {
  const y = g(x, z), u = V(Math.sin(rot), 0, Math.cos(rot))
  b.log(V(x, y - 0.1, z), V(x, y + 0.55, z), 0.02, b.wood(0.8))
  b.log(V(x, y + 0.1, z).addScaledVector(u, -0.6), V(x, y + 0.55, z).addScaledVector(u, 0.2).setY(y + 1.6), 0.012, [0.12, 0.12, 0.13])
  b.setSurf(SURF.metal)
  barrelLike(b, x + u.z * 0.5, y, z - u.x * 0.5, 0.15, 0.3, [0.25, 0.32, 0.36])
  rbox(b, x - u.z * 0.5, y + 0.1, z + u.x * 0.5, rot, 0.2, 0.1, 0.12, [0.45, 0.1, 0.06])
  b.setSurf(SURF.wood)
}
function barrelLike(b: Builder, x: number, y: number, z: number, r: number, h: number, col: RGB): void { b.log(V(x, y, z), V(x, y + h, z), r, col) }

// ---------------------------------------------------------------------------------------------------- mining
/** RAILS along a polyline (local x, z): sleepers on the ground (Ground), two steel rails over them. */
export function rails(b: Builder, pts: [number, number][], g: Ground): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L
    const n = Math.max(1, Math.round(L / 0.65))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t
      b.box(V(x, g(x, z) + 0.05, z), V(-uz, 0, ux), Y, V(ux, 0, uz), 0.72 + (b.rnd() - 0.5) * 0.1, 0.06, 0.1, b.wood(0.55 + 0.2 * b.rnd()))
    }
    b.setSurf(SURF.metal)
    for (const s of [-0.45, 0.45]) beam(b, V(x0 - uz * s, g(x0, z0) + 0.15, z0 + ux * s), V(x1 - uz * s, g(x1, z1) + 0.15, z1 + ux * s), 0.06, 0.08, C.steel)
    b.setSurf(SURF.wood)
  }
}
/** An ORE CART on the rails at (x, z), along rot: a tapered steel hopper, its load of ore, four wheels. */
export function oreCart(b: Builder, x: number, z: number, rot: number, g: Ground, tipped = false): void {
  const y = g(x, z) + 0.2, cs = Math.cos(rot), sn = Math.sin(rot), tilt = tipped ? 0.5 : 0
  const P = (lx: number, ly: number, lz: number) => { const ly2 = ly * Math.cos(tilt) - lz * Math.sin(tilt), lz2 = ly * Math.sin(tilt) + lz * Math.cos(tilt); return V(x + lx * cs + lz2 * sn, y + ly2, z - lx * sn + lz2 * cs) }
  b.setSurf(SURF.metal)
  const bot = [P(-0.55, 0.3, -0.4), P(0.55, 0.3, -0.4), P(0.55, 0.3, 0.4), P(-0.55, 0.3, 0.4)]
  const top = [P(-0.75, 1.05, -0.55), P(0.75, 1.05, -0.55), P(0.75, 1.05, 0.55), P(-0.75, 1.05, 0.55)]
  const col: RGB = [0.24, 0.13, 0.08]
  for (let i = 0; i < 4; i++) panel(b, bot[i], bot[(i + 1) % 4], top[(i + 1) % 4], top[i], shade(col, 0.85 + 0.1 * (i % 2)), shade(col, 0.5))
  b.quad(bot[3], bot[2], bot[1], bot[0], shade(col, 0.6))
  for (const lx of [-0.5, 0.5]) for (const s of [-1, 1]) wheel(b, P(lx, 0.2, s * 0.45), V(sn, 0, cs), 0.2, 0.08)
  b.setSurf(SURF.stone)
  if (!tipped) for (let k = 0; k < 5; k++) rock(b, P((b.rnd() - 0.5) * 0.9, 1.0, (b.rnd() - 0.5) * 0.6), V(0.22, 0.15, 0.2), b.rnd() * 6, k % 2 ? C.ore : C.oreGreen, 50 + k)
  b.setSurf(SURF.wood)
}
/** An ORE / SPOIL HEAP: a ragged cone of broken rock at (x, z), r across, h high, sunk into the ground. */
export function orePile(b: Builder, x: number, z: number, r: number, h: number, col: RGB, g: Ground, seed: number): void {
  // a ragged heap: three rings, each point pushed in and out (its own hash), the top off-centre and broken; the foot
  // follows the ground; loose blocks rolled down round it
  const M = 12
  const hsh = (k: number, j: number) => ((Math.sin(seed * 12.9898 + k * 78.233 + j * 37.719) * 43758.5453) % 1 + 1) % 1
  const ring = (k: number, j: number, f: number, yy: number) => {
    const a = ((k % M) / M) * Math.PI * 2 + seed, rr = r * f * (0.72 + 0.56 * hsh(k % M, j))
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr
    return V(px, (j === 0 ? g(px, pz) - 0.2 : g(x, z) - 0.15 + yy) + (j > 0 ? (hsh(k % M, j + 5) - 0.5) * h * 0.25 : 0), pz)
  }
  const top = V(x + (hsh(1, 9) - 0.5) * r * 0.4, g(x, z) + h, z + (hsh(2, 9) - 0.5) * r * 0.4)
  b.setSurf(SURF.stone)
  for (let k = 0; k < M; k++) {
    const r0 = [ring(k, 0, 1, 0), ring(k + 1, 0, 1, 0)], r1 = [ring(k, 1, 0.68, h * 0.38), ring(k + 1, 1, 0.68, h * 0.38)], r2 = [ring(k, 2, 0.34, h * 0.78), ring(k + 1, 2, 0.34, h * 0.78)]
    const t = (i: number) => shade(col, 0.72 + 0.4 * hsh(k, i))
    b.quad(r0[0], r1[0], r1[1], r0[1], t(1)); b.quad(r1[0], r2[0], r2[1], r1[1], t(2)); b.tri(r2[0], top, r2[1], t(3))
  }
  for (let k = 0; k < 9; k++) { const a = b.rnd() * 6.28, rr = r * (0.85 + 0.45 * b.rnd()), px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr; rock(b, V(px, g(px, pz) + 0.1, pz), V(0.35, 0.25, 0.3).multiplyScalar(0.6 + 0.9 * b.rnd()), a, shade(col, 0.85 + 0.2 * b.rnd()), seed * 13 + k) }
  b.setSurf(SURF.wood)
}
/** A WARNING SIGN on two posts: a yellow board with black chevrons, a red band. */
export function warningSign(b: Builder, x: number, z: number, rot: number, g: Ground): void {
  const y = g(x, z), u = V(Math.cos(rot), 0, -Math.sin(rot)), w = V(Math.sin(rot), 0, Math.cos(rot))
  for (const s of [-0.45, 0.45]) b.log(V(x, y - 0.2, z).addScaledVector(u, s), V(x, y + 1.6, z).addScaledVector(u, s), 0.04, b.wood(0.75))
  b.setSurf(SURF.metal)
  const c = V(x, y + 1.25, z).addScaledVector(w, 0.05)
  b.box(c, u, Y, w, 0.6, 0.32, 0.015, [0.62, 0.45, 0.04])
  b.box(c.clone().addScaledVector(Y, 0.24).addScaledVector(w, 0.012), u, Y, w, 0.58, 0.06, 0.008, [0.42, 0.05, 0.03])
  b.setSurf(SURF.plain)
  for (let k = -2; k <= 2; k++) {
    const p = c.clone().addScaledVector(u, k * 0.2).addScaledVector(Y, -0.08).addScaledVector(w, 0.018)
    b.tri(p.clone().addScaledVector(u, -0.07).addScaledVector(Y, 0.1), p.clone().addScaledVector(u, 0.05), p.clone().addScaledVector(u, -0.07).addScaledVector(Y, -0.1), C.dark)
  }
  b.setSurf(SURF.wood)
}
/** A MINE'S HEADFRAME: a timber A-tower over the shaft, its sheave wheel at the top, the cable down. */
export function headframe(b: Builder, x: number, z: number, rot: number, g: Ground, H = 9): void {
  const cs = Math.cos(rot), sn = Math.sin(rot)
  const P = (lx: number, ly: number, lz: number) => V(x + lx * cs + lz * sn, ly, z - lx * sn + lz * cs)
  const y0 = g(x, z)
  const feet: [number, number][] = [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]]
  for (const [fx, fz] of feet) { const f = P(fx, 0, fz); b.log(f.clone().setY(g(f.x, f.z) - 0.3), P(fx * 0.4, y0 + H, fz * 0.4), 0.13, b.wood(0.7)) }
  for (let lv = 1; lv < 4; lv++) {
    const yy = y0 + (lv * H) / 4, k = 1.6 - 1.2 * (lv / 4)
    for (let i = 0; i < 4; i++) { const [ax, az] = feet[i], [bx, bz] = feet[(i + 1) % 4]; beam(b, P((ax * k) / 1.6, yy, (az * k) / 1.6), P((bx * k) / 1.6, yy, (bz * k) / 1.6), 0.1, 0.14, b.wood(0.75)) }
  }
  // the back strut, the deck, the sheave wheel (a ring of short logs), the cable
  b.log(P(-4.5, y0, 0).setY(g(P(-4.5, 0, 0).x, P(-4.5, 0, 0).z) - 0.2), P(-0.6, y0 + H * 0.92, 0), 0.12, b.wood(0.7))
  box(b, P(0, 0, 0).x, y0 + H + 0.05, P(0, 0, 0).z, 0.8, 0.06, 0.8, b.wood(0.85))
  b.setSurf(SURF.metal)
  const wc = P(0, y0 + H + 1.0, 0), ax = V(sn, 0, cs), up = V(0, 1, 0), fw = V(cs, 0, -sn)
  const S = 10
  for (let k = 0; k < S; k++) {
    const a0 = (k / S) * Math.PI * 2, a1 = ((k + 1) / S) * Math.PI * 2
    b.log(wc.clone().addScaledVector(fw, Math.cos(a0) * 0.85).addScaledVector(up, Math.sin(a0) * 0.85), wc.clone().addScaledVector(fw, Math.cos(a1) * 0.85).addScaledVector(up, Math.sin(a1) * 0.85), 0.05, C.rust)
    if (k % 2 === 0) b.log(wc, wc.clone().addScaledVector(fw, Math.cos(a0) * 0.85).addScaledVector(up, Math.sin(a0) * 0.85), 0.025, C.rust)
  }
  b.log(wc.clone().addScaledVector(ax, -0.15), wc.clone().addScaledVector(ax, 0.15), 0.1, C.steel)
  b.log(wc.clone().addScaledVector(fw, 0.85), P(0.85, y0 + 0.3, 0), 0.02, C.steel)
  b.log(wc.clone().addScaledVector(fw, -0.85), P(-6, y0 + 1.2, 0), 0.02, C.steel)
  b.setSurf(SURF.wood)
}
/** A lattice RADIO MAST (three legs, braced), guy wires to anchors, a red light at the top (glows at night). */
export function radioMast(b: Builder, x: number, z: number, g: Ground, H = 14): void {
  const y0 = g(x, z), r = 0.32
  const leg = (k: number, y: number) => V(x + Math.cos((k * 2 * Math.PI) / 3) * r, y, z + Math.sin((k * 2 * Math.PI) / 3) * r)
  b.setSurf(SURF.metal)
  for (let k = 0; k < 3; k++) b.log(leg(k, y0 - 0.2), leg(k, y0 + H), 0.03, [0.55, 0.55, 0.56])
  for (let y = y0 + 0.5; y < y0 + H; y += 0.9) for (let k = 0; k < 3; k++) b.log(leg(k, y), leg((k + 1) % 3, y + 0.9), 0.012, [0.5, 0.5, 0.52])
  for (let k = 0; k < 3; k++) { const a = (k * 2 * Math.PI) / 3 + 0.5, ax = x + Math.cos(a) * H * 0.55, az = z + Math.sin(a) * H * 0.55; b.log(leg(k, y0 + H * 0.8), V(ax, g(ax, az) + 0.1, az), 0.006, C.steel); box(b, ax, g(ax, az) + 0.1, az, 0.15, 0.12, 0.15, C.stone) }
  b.log(V(x, y0 + H, z), V(x, y0 + H + 2.2, z), 0.02, C.steel)
  b.setSurf(SURF.plain); b.setGlow(1); box(b, x, y0 + H + 2.25, z, 0.07, 0.07, 0.07, [0.6, 0.06, 0.03]); b.setGlow(0)
  b.setSurf(SURF.wood)
}
/** A split-rail FENCE along a polyline (local x, z), posts to the ground; `broken` drops rails here and there. */
export function fence(b: Builder, pts: [number, number][], g: Ground, broken = 0): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 2.4))
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = g(x, z), lean = (b.rnd() - 0.5) * 0.1
      if (k < n || i === pts.length - 2) b.log(V(x, y - 0.2, z), V(x + lean, y + 1.2, z + lean), 0.07, b.wood(0.75))
      if (k === n) continue
      const t2 = (k + 1) / n, x2 = x0 + (x1 - x0) * t2, z2 = z0 + (z1 - z0) * t2, y2 = g(x2, z2)
      for (const h of [0.5, 0.95]) {
        if (b.rnd() < broken) { b.log(V(x, y + h, z), V((x + x2) / 2, y + 0.08, (z + z2) / 2), 0.05, b.wood(0.9)); continue }
        b.log(V(x, y + h, z), V(x2, y2 + h, z2), 0.05, b.wood(0.9 + 0.15 * b.rnd()))
      }
    }
  }
}
