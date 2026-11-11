import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import { Builder, type CullPart, cullHidden, splitMeshes, SURF, woodMaterial } from './Bridges'
import type { Horizon } from './Horizon'
import type { LandmarkCollider } from './Landmarks'
import { lakeOff, type MapData, type OutPlace } from './MapData'
import type { Tier } from './quality'
import type { TerrainShadow } from './TerrainShadow'
import { gameParams } from '../settings'

/**
 * THE WILDS' WONDERS (2026-11-11, the user: "a world tree … natural beautiful places … adventure and natural beauty
 * mixed" — meta.outland.places, scripts/oth/wilds.py, which shaped the ground under each and brought a road to it):
 *
 *   THE WORLD TREE   on its knoll in the quiet basin: a trunk 150 m tall, seven buttresses running down into seven
 *                    ROOTS that lie along the ridges the land was given for them (a car can climb over them: they are
 *                    ground to its wheels), a ring of great boughs and a leader, a crown of leaf masses 190 m across
 *                    — green, gold where the light takes it — and small pale lights in it that never go out.
 *   THE GIANT'S GATE a stone arch standing over a road (the road runs through it), a few needles of the same rock
 *                    beside it.
 *
 *   THE LAKES        (meta.outland.lakes) the valley's own still water — Water.poolMaterial — over each bowl wilds.py
 *                    dug: a sheet at the lake's level, its depth at every corner the ground's (so the shore is where
 *                    the land comes up through it).
 *   THE STAGES       (meta.outland.stages — "Dirt Rally like places") each a road of the net: a START gate (an amber
 *                    banner between two posts) 30 m in, a FINISH gate (black and white checks) 30 m from its end,
 *                    a red-topped marker post every 100 m on alternate sides, red-and-white boards round the outside
 *                    of every sharp bend. Drive through a start gate and the clock runs to that stage's finish (`onStage`:
 *                    the game's toast; the best time kept in localStorage).
 *
 * (The crater, the mesa, the peaks and the views are the land's own shape: nothing to draw.) Built here, once, with the
 * landmarks' Builder — flat facets, a colour each, the landmarks' material (this world's light, shadow and haze): a
 * mesh a wonder, ~7 k triangles for the tree and ~1.5 k for the gate, drawn when in view and not behind the hills.
 */
type V3 = GFX.Vector3
const v3 = (x: number, y: number, z: number) => new GFX.Vector3(x, y, z)
type RGB = [number, number, number]
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k]

/** A quad whose front faces away from `centre`. */
function quadOut(b: Builder, p0: V3, p1: V3, p2: V3, p3: V3, centre: V3, col: RGB): void {
  const n = new GFX.Vector3().subVectors(p1, p0).cross(new GFX.Vector3().subVectors(p3, p0))
  if (n.dot(new GFX.Vector3().subVectors(p0, centre)) >= 0) { b.tri(p0, p1, p2, col); b.tri(p0, p2, p3, col) } else { b.tri(p0, p2, p1, col); b.tri(p0, p3, p2, col) }
}

/** A LIMB: a tube along `path`, `sides` round, its radius at each point `radii` (× `shape(k, angle)` — a buttress, a
 *  rock's bulge), each facet its own colour `colour(k / (n − 1), angle)`; capped at its far end. */
function limb(b: Builder, path: V3[], radii: number[], sides: number, colour: (t: number, a: number) => RGB, shape?: (k: number, a: number) => number): void {
  const n = path.length, rings: V3[][] = []
  let ref = v3(0, 1, 0)
  for (let k = 0; k < n; k++) {
    const t = new GFX.Vector3().subVectors(path[Math.min(n - 1, k + 1)], path[Math.max(0, k - 1)]).normalize()
    if (Math.abs(t.dot(ref)) > 0.95) ref = v3(1, 0, 0)
    const u = new GFX.Vector3().crossVectors(ref, t).normalize(), w = new GFX.Vector3().crossVectors(t, u).normalize()
    ref = w.clone()                                   // (the frame carried along: no twist where the limb turns)
    const ring: V3[] = []
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2, r = radii[k] * (shape ? shape(k, a) : 1)
      ring.push(v3(path[k].x + (u.x * Math.cos(a) + w.x * Math.sin(a)) * r, path[k].y + (u.y * Math.cos(a) + w.y * Math.sin(a)) * r, path[k].z + (u.z * Math.cos(a) + w.z * Math.sin(a)) * r))
    }
    rings.push(ring)
  }
  for (let k = 0; k + 1 < n; k++) for (let s = 0; s < sides; s++) {
    const s1 = (s + 1) % sides, c = new GFX.Vector3().addVectors(path[k], path[k + 1]).multiplyScalar(0.5)
    quadOut(b, rings[k][s], rings[k][s1], rings[k + 1][s1], rings[k + 1][s], c, colour((k + 0.5) / (n - 1), ((s + 0.5) / sides) * Math.PI * 2))
  }
  const end = rings[n - 1], tip = path[n - 1], back = path[n - 2]
  for (let s = 0; s < sides; s++) { const p0 = end[s], p1 = end[(s + 1) % sides]; quadOut(b, p0, p1, tip, tip, back, colour(1, 0)) }
}

/** An icosphere's faces, subdivided once (80 triangles): the leaf masses' and the boulders' base shape. */
const ICO: [V3, V3, V3][] = (() => {
  const t = (1 + Math.sqrt(5)) / 2
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(([x, y, z]) => v3(x, y, z).normalize())
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
  const out: [V3, V3, V3][] = []
  for (const [a, c, d] of F) {
    const A = V[a], B = V[c], C = V[d], ab = A.clone().add(B).normalize(), bc = B.clone().add(C).normalize(), ca = C.clone().add(A).normalize()
    out.push([A, ab, ca], [B, bc, ab], [C, ca, bc], [ab, bc, ca])
  }
  return out
})()
/** A LUMP: a faceted, uneven ball at c — radii rx (across) and ry (up), each corner pushed in or out by its own
 *  amount (the same for a corner shared by faces: no cracks), each facet coloured by `colour(its normal's up, rnd)`. */
function lump(b: Builder, c: V3, rx: number, ry: number, rough: number, seed: number, colour: (up: number, r: number) => RGB): void {
  const h = (p: V3) => { const s = Math.sin(p.x * 127.1 + p.y * 311.7 + p.z * 74.7 + seed * 13.37) * 43758.5453; return s - Math.floor(s) }
  const at = (p: V3) => { const k = 1 + (h(p) - 0.5) * 2 * rough; return v3(c.x + p.x * rx * k, c.y + p.y * ry * k, c.z + p.z * rx * k) }
  for (const [A, B, C] of ICO) {
    const p0 = at(A), p1 = at(B), p2 = at(C)
    const n = new GFX.Vector3().subVectors(p1, p0).cross(new GFX.Vector3().subVectors(p2, p0)).normalize()
    const out = n.dot(new GFX.Vector3().subVectors(p0, c)) >= 0
    b.tri(p0, out ? p1 : p2, out ? p2 : p1, colour(out ? n.y : -n.y, h(A.clone().add(B).add(C))))
  }
}

export class Wonders {
  readonly group = new GFX.Group()
  /** What a car runs into / over (boxes; `ground`: the wheels climb it) — joined to the landmarks' (World.ts). */
  readonly colliders: LandmarkCollider[] = []
  horizon: Horizon | null = null
  /** A stage begun, finished or left (the game shows it). */
  onStage: ((msg: string) => void) | null = null
  private readonly parts: CullPart[] = []
  /** The stages' own meshes: drawn only from within 900 m of them. */
  private readonly dressed: CullPart[] = []
  private readonly gates: { name: string; km: number; sx: number; sz: number; fx: number; fz: number }[] = []
  private run: { k: number; t0: number } | null = null
  private atStart = -1
  private now = 0
  private readonly mat: GFX.ShaderMaterial | null = null
  /** The World Tree's falling leaves (one draw, moved in the vertex shader): shown from within `r` of it. */
  private leaves: { mesh: GFX.Mesh; c: V3; r: number } | null = null

  constructor(private readonly map: MapData, private readonly atmos: Atmosphere, shadow: TerrainShadow, private readonly tier: Tier, farGrid: GFX.Vector4) {
    const places = gameParams().get('wonders') === '0' ? [] : map.meta.outland?.places ?? []   // (?wonders=0: none — the A/B)
    const stages = gameParams().get('wonders') === '0' || gameParams().get('stages') === '0' ? [] : map.meta.outland?.stages ?? []   // (?stages=0: no gates, posts or boards)
    if (!places.some((p) => p.kind === 'worldtree' || p.kind === 'arch' || p.kind === 'view' || p.kind === 'pass') && !stages.length) return
    const b = new Builder(20261111), ranges: [number, number][] = []
    for (const p of places) {
      const from = b.count
      if (p.kind === 'worldtree') this.worldTree(b, p)
      else if (p.kind === 'arch') this.gate(b, p)
      else if (p.kind === 'view' || p.kind === 'pass') this.lookout(b, p)
      if (b.count > from) ranges.push([from, b.count])
    }
    this.mat = woodMaterial(atmos, shadow, tier, farGrid)
    this.parts = splitMeshes(b, ranges, this.mat, this.group)
    const sb = new Builder(20261112), sr: [number, number][] = []
    for (const s of stages) { const from = sb.count; this.stage(sb, s); if (sb.count > from) sr.push([from, sb.count]) }
    this.dressed = splitMeshes(sb, sr, this.mat, this.group)
  }

  /** The lakes' water (World.ts hands the valley's still-water material: Water.poolMaterial). */
  addLakes(mat: GFX.ShaderMaterial): void {
    const map = this.map
    if (gameParams().get('wonders') === '0' || gameParams().get('lakes') === '0') return   // (?lakes=0: dry bowls)
    for (const L of map.meta.outland?.lakes ?? []) {
      // (a long lake — the canyon's: the box round its line; a coarser sheet: its shore is a cliff's foot)
      const xa = Math.min(L.x, L.x1 ?? L.x) - L.r, za = Math.min(L.z, L.z1 ?? L.z) - L.r, xb = Math.max(L.x, L.x1 ?? L.x) + L.r, zb = Math.max(L.z, L.z1 ?? L.z) + L.r
      const S = L.x1 === undefined ? 6 : 8, nx = Math.ceil((xb - xa) / S) + 1, nz = Math.ceil((zb - za) / S) + 1, n = nx, x0 = xa, z0 = za
      const dep = new Float32Array(nx * nz), id = new Int32Array(nx * nz).fill(-1)
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = x0 + i * S, z = z0 + j * S; dep[j * n + i] = lakeOff(L, x, z) < L.r ? L.level - map.height(x, z) : -3 }
      const pos: number[] = [], uv: number[] = [], idx: number[] = []
      const vert = (i: number, j: number) => { const k = j * n + i; if (id[k] < 0) { id[k] = pos.length / 3; pos.push(x0 + i * S, L.level, z0 + j * S); uv.push(dep[k], 0, 0, 0) } return id[k] }
      for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
        // (a cell with any corner near the water: the shore runs through it — the shader fades it out where there's none)
        if (Math.max(dep[j * n + i], dep[j * n + i + 1], dep[(j + 1) * n + i], dep[(j + 1) * n + i + 1]) < -0.25) continue
        const a = vert(i, j), c = vert(i + 1, j), d = vert(i + 1, j + 1), e = vert(i, j + 1)
        idx.push(a, e, d, a, d, c)
      }
      if (!idx.length) continue
      const g = new GFX.BufferGeometry(), nv = pos.length / 3
      g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
      g.setAttribute('aFlow', new GFX.BufferAttribute(new Float32Array(nv * 2), 2))
      g.setAttribute('aUV', new GFX.Float32BufferAttribute(uv, 4))
      g.setIndex(idx); g.computeBoundingBox(); g.computeBoundingSphere()
      const m = new GFX.Mesh(g, mat); m.renderOrder = 20
      this.group.add(m); this.parts.push({ obj: m, box: g.boundingBox! })
    }
  }

  cull(cam?: GFX.Vector3): void {
    cullHidden(this.parts, this.horizon)
    cullHidden(this.dressed, this.horizon)
    if (cam) for (const p of this.dressed) if (p.obj.visible && p.box.distanceToPoint(cam) > 900) p.obj.visible = false
    if (this.leaves && cam) this.leaves.mesh.visible = cam.distanceTo(this.leaves.c) < this.leaves.r
  }

  /** The stage being run now: its name, the seconds on its clock, its best (0: none yet) — or null. */
  get clock(): { name: string; t: number; best: number } | null {
    if (!this.run) return null
    const g = this.gates[this.run.k]
    return { name: g.name, t: this.now - this.run.t0, best: Number(localStorage.getItem(`oth.stage.${g.name}`)) || 0 }
  }

  /** The stages' clock: through a START gate it runs; at that stage's FINISH it stops and is told (the best kept). */
  update(carX: number, carZ: number, t: number): void {
    this.now = t
    if (!this.gates.length) return
    const R2 = 8 * 8
    if (this.run) {
      const g = this.gates[this.run.k], dt = t - this.run.t0
      if ((carX - g.fx) ** 2 + (carZ - g.fz) ** 2 < R2) {
        const key = `oth.stage.${g.name}`, best = Number(localStorage.getItem(key)) || 0, fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
        if (!best || dt < best) localStorage.setItem(key, dt.toFixed(2))
        this.onStage?.(`FINISH · ${g.name}   ${fmt(dt)}` + (best ? (dt < best ? `   new best (was ${fmt(best)})` : `   best ${fmt(best)}`) : '   first time set'))
        this.run = null
      } else if (dt > 1800) this.run = null
    }
    // (a start gate counts when the car comes INTO it: standing on the line starts nothing again)
    let inside = -1
    for (let k = 0; k < this.gates.length; k++) { const g = this.gates[k]; if ((carX - g.sx) ** 2 + (carZ - g.sz) ** 2 < R2) { inside = k; break } }
    if (inside >= 0 && inside !== this.atStart) {
      const g = this.gates[inside]
      this.run = { k: inside, t0: t }
      const best = Number(localStorage.getItem(`oth.stage.${g.name}`)) || 0
      this.onStage?.(`START · ${g.name}   ${g.km.toFixed(1)} km` + (best ? `   best ${Math.floor(best / 60)}:${(best % 60).toFixed(1).padStart(4, '0')}` : ''))
    }
    this.atStart = inside
  }

  // ------------------------------------------------------------------------------------------------ THE LOOKOUTS
  /** A VIEW's mark: a CAIRN and a pole with a pennant where a road ends on a mountain's shoulder or a pass — and, where
   *  the view is over a cliff's edge (`deck`: the canyon's overlook), a timber DECK out over the brink with a rail
   *  round it (the wheels and the feet stand on it). */
  private lookout(b: Builder, p: OutPlace): void {
    const map = this.map, R = () => b.rnd(), y0 = map.height(p.x, p.z), UP = v3(0, 1, 0)
    const STONE: RGB = [0.4, 0.4, 0.4], STONE_D: RGB = [0.24, 0.25, 0.27]
    if (p.deck) {
      const f = v3(Math.cos(p.rot ?? 0), 0, Math.sin(p.rot ?? 0)), ax = v3(-f.z, 0, f.x), HW = 3.6
      // (out from the road's end to 2.5 m past the brink: the ground's last metre within 3 m of the deck's height)
      let reach = 6
      while (reach < 26 && map.height(p.x + f.x * reach, p.z + f.z * reach) > y0 - 3) reach += 0.5
      const L = reach + 2.5, top = y0 + 0.35, c = v3(p.x + f.x * (L / 2 + 1), top - 0.12, p.z + f.z * (L / 2 + 1))
      b.setSurf(SURF.wood)
      const N = Math.round(L / 0.42)
      for (let i = 0; i < N; i++) { const o = -L / 2 + (i + 0.5) * (L / N); b.box(v3(c.x + f.x * o, c.y, c.z + f.z * o), ax, UP, f, HW, 0.06, L / N / 2 - 0.02, b.wood(0.9 + 0.3 * R())) }
      for (const sd of [-1, 1]) {
        b.box(v3(c.x + ax.x * HW * sd, c.y - 0.22, c.z + ax.z * HW * sd), f, UP, ax, L / 2, 0.16, 0.12, b.wood(0.7))                          // the joists
        b.box(v3(c.x + ax.x * HW * sd, top + 0.95, c.z + ax.z * HW * sd), f, UP, ax, L / 2, 0.06, 0.06, b.wood(0.8))                          // the side rails
        b.box(v3(c.x + ax.x * HW * sd, top + 0.5, c.z + ax.z * HW * sd), f, UP, ax, L / 2, 0.04, 0.04, b.wood(0.8))
        for (let o = -L / 2; o <= L / 2 + 0.01; o += L / 6) b.box(v3(c.x + f.x * o + ax.x * HW * sd, top + 0.5, c.z + f.z * o + ax.z * HW * sd), ax, UP, f, 0.07, 0.55, 0.07, b.wood(0.75))
        this.box(c.x + ax.x * HW * sd, top + 0.6, c.z + ax.z * HW * sd, L / 2, 0.7, 0.12, -(p.rot ?? 0), false)
      }
      const e = v3(c.x + f.x * (L / 2), top, c.z + f.z * (L / 2))                                                                              // the front rail, over the drop
      b.box(v3(e.x, top + 0.95, e.z), ax, UP, f, HW, 0.06, 0.06, b.wood(0.8)); b.box(v3(e.x, top + 0.5, e.z), ax, UP, f, HW, 0.04, 0.04, b.wood(0.8))
      for (let o = -HW; o <= HW + 0.01; o += HW / 2) b.box(v3(e.x + ax.x * o, top + 0.5, e.z + ax.z * o), ax, UP, f, 0.07, 0.55, 0.07, b.wood(0.75))
      this.box(e.x, top + 0.6, e.z, 0.12, 0.7, HW, -(p.rot ?? 0), false)
      // (its legs: down to the ground under it, the outer pair braced back to the cliff)
      for (const sd of [-1, 1]) for (const o of [-L / 2 + 0.6, 0, L / 2 - 0.5]) {
        const x = c.x + f.x * o + ax.x * (HW - 0.3) * sd, z = c.z + f.z * o + ax.z * (HW - 0.3) * sd, g = Math.max(map.height(x, z), top - 9)
        b.box(v3(x, (top + g) / 2 - 0.2, z), ax, UP, f, 0.13, (top - g) / 2 + 0.2, 0.13, b.wood(0.6))
      }
      this.box(c.x, top - 0.25, c.z, L / 2, 0.25, HW, -(p.rot ?? 0), true)
      b.setSurf(SURF.wood)
      return
    }
    // the cairn (five stones, the largest at its foot) and the pole 4 m off it
    b.setSurf(SURF.stone)
    const cx = p.x + 5, cz = p.z + 3, cy = map.height(cx, cz)
    let yy = cy - 0.1
    for (let k = 0; k < 5; k++) { const r = 0.75 - 0.12 * k; lump(b, v3(cx + (R() - 0.5) * 0.2, yy + r * 0.55, cz + (R() - 0.5) * 0.2), r, r * 0.62, 0.22, k + 31, (up, q) => mul(mix(STONE_D, STONE, 0.5 + 0.5 * up), 0.8 + 0.4 * q)); yy += r * 0.95 }
    this.box(cx, cy + 1, cz, 0.7, 1.2, 0.7, 0, false)
    b.setSurf(SURF.plain)
    const px = p.x + 5, pz = p.z - 3, py = map.height(px, pz)
    b.box(v3(px, py + 2.6, pz), v3(1, 0, 0), UP, v3(0, 0, 1), 0.05, 2.7, 0.05, [0.3, 0.31, 0.33])
    b.box(v3(px + 0.55, py + 4.85, pz), v3(1, 0, 0), UP, v3(0, 0, 1), 0.5, 0.3, 0.015, [0.9, 0.55, 0.08])
    b.setSurf(SURF.wood)
  }

  // ------------------------------------------------------------------------------------------------ THE STAGES
  private stage(b: Builder, s: { name: string; line: number; km: number; crests?: [number, number][] }): void {
    const map = this.map, L = map.meta.outland?.trails?.lines[s.line], hw = map.meta.outland?.trails?.hw ?? 3.3
    if (!L || L.length < 12) return
    const cum = [0]
    for (let k = 1; k < L.length; k++) cum.push(cum[k - 1] + Math.hypot(L[k][0] - L[k - 1][0], L[k][1] - L[k - 1][1]))
    const len = cum[cum.length - 1]
    /** the road at d metres along it: where, and which way it runs */
    const at = (d: number) => {
      let k = 1
      while (k < L.length - 1 && cum[k] < d) k++
      const f = Math.max(0, Math.min(1, (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1])))
      const dx = L[k][0] - L[k - 1][0], dz = L[k][1] - L[k - 1][1], l = Math.hypot(dx, dz) || 1
      return { x: L[k - 1][0] + dx * f, z: L[k - 1][1] + dz * f, ux: dx / l, uz: dz / l }
    }
    const UP = v3(0, 1, 0), WHITE: RGB = [0.86, 0.86, 0.84], BLACK: RGB = [0.05, 0.05, 0.055], AMBER: RGB = [0.9, 0.55, 0.08], RED: RGB = [0.72, 0.07, 0.05], STEEL: RGB = [0.3, 0.31, 0.33]
    b.setSurf(SURF.plain)
    // a GATE: two posts 5.4 m to each side of the middle, a banner between their heads — amber for the start, black
    // and white checks for the finish
    const gateAt = (d: number, finish: boolean) => {
      const p = at(d), ax = v3(-p.uz, 0, p.ux), fw = v3(p.ux, 0, p.uz), W = 5.4, Hh = 5.2
      for (const sd of [-1, 1]) {
        const x = p.x + ax.x * W * sd, z = p.z + ax.z * W * sd, y = map.height(x, z)
        b.box(v3(x, y + Hh / 2 - 0.3, z), ax, UP, fw, 0.16, Hh / 2 + 0.3, 0.16, STEEL)
        this.box(x, y + 1.2, z, 0.22, 1.6, 0.22, 0, false)
      }
      const y0 = Math.max(map.height(p.x + ax.x * W, p.z + ax.z * W), map.height(p.x - ax.x * W, p.z - ax.z * W)) + Hh - 1.0, N = 12, tw = (2 * W) / N
      for (let i = 0; i < N; i++) for (let r = 0; r < 2; r++) {
        const o = -W + (i + 0.5) * tw, c = v3(p.x + ax.x * o, y0 + (r + 0.5) * 0.5, p.z + ax.z * o)
        const col: RGB = finish ? ((i + r) % 2 ? BLACK : WHITE) : i === 0 || i === N - 1 ? BLACK : AMBER
        b.box(c, ax, UP, fw, tw / 2, 0.25, 0.05, col)
      }
      return p
    }
    const S0 = gateAt(Math.min(30, len * 0.1), false), F0 = gateAt(len - Math.min(30, len * 0.1), true)
    this.gates.push({ name: s.name, km: s.km, sx: S0.x, sz: S0.z, fx: F0.x, fz: F0.z })
    // MARKER POSTS: every 100 m, on alternate sides, white with a red head
    for (let d = 100, k = 0; d < len - 60; d += 100, k++) {
      const p = at(d), sd = k % 2 ? 1 : -1, x = p.x - p.uz * (hw + 1.3) * sd, z = p.z + p.ux * (hw + 1.3) * sd, y = map.height(x, z)
      b.box(v3(x, y + 0.45, z), v3(1, 0, 0), UP, v3(0, 0, 1), 0.06, 0.55, 0.06, WHITE)
      b.box(v3(x, y + 1.1, z), v3(1, 0, 0), UP, v3(0, 0, 1), 0.075, 0.11, 0.075, RED)
    }
    // BOARDS on the bends: where the road turns more than ~35° in 40 m, three red-and-white boards round the outside,
    // facing the car that comes to it (either way: both faces are painted)
    let last = -1e9
    for (let d = 60; d < len - 60; d += 10) {
      const a = at(d - 20), c = at(d + 20), turn = Math.atan2(a.ux * c.uz - a.uz * c.ux, a.ux * c.ux + a.uz * c.uz)
      if (Math.abs(turn) < 0.6 || d - last < 70) continue
      last = d
      const out = turn > 0 ? -1 : 1                       // (the outside of the bend: away from the way it turns)
      for (const o of [-9, 0, 9]) {
        const p = at(d + o), x = p.x - p.uz * (hw + 2.2) * out, z = p.z + p.ux * (hw + 2.2) * out, y = map.height(x, z)
        const fw = v3(p.ux, 0, p.uz), ax = v3(-p.uz, 0, p.ux)
        for (let i = 0; i < 4; i++) b.box(v3(x + ax.x * (i - 1.5) * 0.3, y + 1.0, z + ax.z * (i - 1.5) * 0.3), ax, UP, fw, 0.15, 0.3, 0.03, i % 2 ? WHITE : RED)
        for (const e of [-0.5, 0.5]) b.box(v3(x + ax.x * e, y + 0.35, z + ax.z * e), ax, UP, fw, 0.04, 0.38, 0.04, STEEL)
      }
    }
    // a CREST ahead (the road's own humps — wilds.py: the car goes light over them): 70 m before it from each side, an
    // amber diamond on a post with a black bar and dot — "!" — on the driver's side of the road
    for (const [cx, cz] of s.crests ?? []) {
      let kb = 0, db = 1e9
      for (let k = 0; k < L.length; k++) { const d = Math.hypot(L[k][0] - cx, L[k][1] - cz); if (d < db) { db = d; kb = k } }
      for (const sd of [-1, 1]) {
        const d = cum[kb] - 70 * sd
        if (d < 20 || d > len - 20) continue
        const q = at(d), x = q.x - q.uz * (hw + 1.6) * sd, z = q.z + q.ux * (hw + 1.6) * sd, y = map.height(x, z)
        const fw = v3(q.ux, 0, q.uz), ax = v3(-q.uz, 0, q.ux), D1 = v3(ax.x * 0.7071, 0.7071, ax.z * 0.7071), D2 = v3(-ax.x * 0.7071, 0.7071, -ax.z * 0.7071)
        b.box(v3(x, y + 0.75, z), ax, UP, fw, 0.045, 0.85, 0.045, STEEL)
        b.box(v3(x, y + 1.75, z), D1, D2, fw, 0.42, 0.42, 0.03, AMBER)
        b.box(v3(x, y + 1.82, z), ax, UP, fw, 0.05, 0.19, 0.04, BLACK)
        b.box(v3(x, y + 1.52, z), ax, UP, fw, 0.05, 0.05, 0.04, BLACK)
      }
    }
    b.setSurf(SURF.wood)
  }

  private box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, ground: boolean): void {
    this.colliders.push({ c: v3(cx, cy, cz), h: v3(hx, hy, hz), q: new GFX.Quaternion().setFromAxisAngle(v3(0, 1, 0), yaw), ground })
  }

  // ------------------------------------------------------------------------------------------------ THE WORLD TREE
  private worldTree(b: Builder, p: OutPlace): void {
    const map = this.map, K = (p.h ?? 150) / 150, ox = p.x, oz = p.z, oy = map.height(p.x, p.z) - 1.5
    const P = (x: number, y: number, z: number) => v3(ox + x * K, oy + y * K, oz + z * K)
    const R = () => b.rnd()
    const BARK: RGB = [0.2, 0.15, 0.11], BARK_D: RGB = [0.11, 0.08, 0.06], BARK_L: RGB = [0.3, 0.24, 0.17], MOSS: RGB = [0.17, 0.24, 0.09]
    const bark = (t: number, a: number): RGB => {
      const k = 0.5 + 0.5 * Math.sin(a * 9 + t * 7) * Math.sin(a * 4 - t * 3)
      return mul(mix(mix(BARK_D, BARK, k), BARK_L, Math.max(0, Math.sin(a * 2 + 1)) * 0.5), 0.85 + 0.3 * R())
    }
    // (the buttresses stand where the land's seven root ridges leave the trunk — wilds.py: cos(7a + 2 sin(d / 70) + 0.6))
    const rootAngle = (k: number, d: number) => (2 * Math.PI * k - 0.6 - 2 * Math.sin(d / (70 * K))) / 7
    b.setSurf(SURF.wood)
    // the TRUNK: 62 m of it, leaning a little, flaring into seven buttresses at its foot
    const TY = [0, 3, 7, 13, 21, 31, 42, 52, 62], TR = [15.5, 13.6, 11.8, 10.3, 9.3, 8.7, 8.3, 8.1, 8.4]
    const lean = (y: number) => [1.6 * Math.sin(y / 34), 1.2 * Math.sin(y / 27 + 1)]
    limb(b, TY.map((y) => P(lean(y)[0], y, lean(y)[1])), TR.map((r) => r * K), 28,
      (t, a) => (t < 0.16 ? mix(bark(t, a), MOSS, 0.45 * (1 - t / 0.16) * R()) : bark(t, a)),
      (k, a) => 1 + 0.42 * Math.max(0, 1 - TY[k] / 20) ** 1.5 * Math.max(0, Math.cos(7 * (a - rootAngle(0, 14 * K)))) ** 2 + 0.05 * Math.sin(a * 13 + k * 2.1))
    // … its ROOTS: one down each buttress and out along its ridge, sinking into the ground 56 m out
    for (let k = 0; k < 7; k++) {
      const D = [12, 20, 30, 42, 56], RR = [4.6, 3.6, 2.6, 1.7, 0.6], path: V3[] = []
      for (let i = 0; i < D.length; i++) {
        const a = rootAngle(k, D[i] * K), x = ox + Math.cos(a) * D[i] * K, z = oz + Math.sin(a) * D[i] * K
        path.push(v3(x, map.height(x, z) + (i === 0 ? 3.2 : 0.55 - i * 0.28) * RR[i] * K, z))
      }
      limb(b, path, RR.map((r) => r * K), 7, (t, a) => mix(bark(t, a), MOSS, 0.3 * R()))
      // (what the wheels feel of it: two boxes along it, ground)
      for (let i = 1; i + 1 < D.length; i += 2) {
        const A = path[i], C = path[i + 1], L = Math.hypot(C.x - A.x, C.z - A.z), yaw = Math.atan2(-(C.z - A.z), C.x - A.x), r = 0.5 * (RR[i] + RR[i + 1]) * K
        this.box((A.x + C.x) / 2, (A.y + C.y) / 2 - 0.25 * r, (A.z + C.z) / 2, L / 2, r * 0.8, r * 0.8, yaw, true)
      }
    }
    // (the trunk itself: an eight-sided post — two boxes — out to its buttresses' waists)
    for (const yaw of [0, Math.PI / 4]) this.box(ox, oy + 30 * K, oz, 11.2 * K, 32 * K, 11.2 * K, yaw, false)
    // the BOUGHS: six great ones leaving the trunk's head, out and up, and a leader straight on
    const ends: { at: V3; r: number }[] = []
    const top = P(lean(60)[0], 60, lean(60)[1])
    const bough = (a0: number, reach: number, rise: number, r0: number) => {
      const path: V3[] = [], rad: number[] = [], N = 6
      const bend = (R() - 0.5) * 0.5, sag = 0.6 + 0.4 * R()
      for (let i = 0; i <= N; i++) {
        const t = i / N, a = a0 + bend * t * t, d = (4 + reach * (t ** 0.9)) * K, y = 58 * K + (rise * (1 - (1 - t) ** 1.7) * sag + 4 * Math.sin(t * 6 + a0)) * K
        path.push(v3(top.x + Math.cos(a) * d, oy + y, top.z + Math.sin(a) * d)); rad.push(r0 * K * (1 - 0.8 * t) + 0.5 * K)
      }
      limb(b, path, rad, 9, bark)
      ends.push({ at: path[N], r: 1 }, { at: path[N - 2], r: 0.85 }, { at: path[N - 3], r: 0.7 })
      // two branches off it, up into the crown
      for (const f of [0.45, 0.75]) {
        const i = Math.round(f * N), s = path[i], a = a0 + (R() - 0.5) * 1.6, L = (16 + 14 * R()) * K
        const q = [s, v3(s.x + Math.cos(a) * L * 0.45, s.y + L * 0.5, s.z + Math.sin(a) * L * 0.45), v3(s.x + Math.cos(a) * L * 0.8, s.y + L * 0.95, s.z + Math.sin(a) * L * 0.8)]
        limb(b, q, [rad[i] * 0.55, rad[i] * 0.36, 0.3 * K], 6, bark)
        ends.push({ at: q[2], r: 0.75 })
      }
    }
    for (let k = 0; k < 6; k++) bough((k / 6) * Math.PI * 2 + 0.3 + (R() - 0.5) * 0.4, 62 + 18 * R(), 36 + 16 * R(), 5.4)
    for (let k = 0; k < 3; k++) bough((k / 3) * Math.PI * 2 + 1.2 + (R() - 0.5) * 0.5, 30 + 10 * R(), 58 + 10 * R(), 4.4)   // (the inner ones, steeper)
    const lead = [top, P(lean(80)[0] + 2, 80, lean(80)[1] - 1), P(-3, 100, 2), P(1, 118, -2)]
    limb(b, lead, [6.6 * K, 4.6 * K, 2.8 * K, 0.8 * K], 9, bark)
    ends.push({ at: lead[3], r: 1.1 }, { at: lead[2], r: 0.9 })
    // the CROWN: a leaf mass on every bough's and branch's end, more between and above them — wide and a little flat,
    // dark green underneath, a clear green on their sides, gold-green where they face the sky
    b.setSurf(SURF.plain)
    const LEAF_D: RGB = [0.05, 0.14, 0.06], LEAF: RGB = [0.13, 0.33, 0.1], LEAF_L: RGB = [0.33, 0.5, 0.14], GOLD: RGB = [0.62, 0.56, 0.16]
    const leaf = (gold: number) => (up: number, r: number): RGB => {
      const c = up < 0 ? mix(LEAF, LEAF_D, Math.min(1, -up * 1.6)) : mix(LEAF, LEAF_L, up)
      return mul(mix(c, GOLD, gold * Math.max(0, up) * (0.4 + 0.6 * r)), 0.86 + 0.28 * r)
    }
    const masses: { c: V3; r: number }[] = []
    for (const e of ends) masses.push({ c: v3(e.at.x + (R() - 0.5) * 8 * K, e.at.y + (5 + 7 * R()) * K, e.at.z + (R() - 0.5) * 8 * K), r: (17 + 9 * R()) * e.r * K })
    for (let k = 0; k < 14; k++) {                    // (the crown's top and the gaps between the boughs)
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 58 * K, y = (112 + 30 * (1 - d / (58 * K)) + 8 * R()) * K
      masses.push({ c: v3(top.x + Math.cos(a) * d, oy + y, top.z + Math.sin(a) * d), r: (16 + 10 * R()) * K })
    }
    // (… and at night the crown holds a little of the day: its gold masses glow, the green ones faintly)
    for (const [i, m] of masses.entries()) { const gold = R() < 0.3; b.setGlow(gold ? 0.16 : 0.04); lump(b, m.c, m.r, m.r * (0.58 + 0.16 * R()), 0.16, i + 1, leaf(gold ? 0.9 : 0.25)) }
    b.setGlow(0)
    // … and the LIGHTS in it: small pale lamps under the leaf masses, a few down among the boughs (they glow by day
    // too: the landmarks' lamp surface)
    b.setSurf(SURF.lamp)
    const LIGHT: RGB = [0.5, 0.46, 0.26]
    for (let k = 0; k < 170; k++) {
      const m = masses[Math.floor(R() * masses.length)], a = R() * Math.PI * 2, d = Math.sqrt(R()) * m.r * 0.85, s = (0.35 + 0.5 * R()) * K
      const c = v3(m.c.x + Math.cos(a) * d, m.c.y - m.r * (0.55 + 0.35 * R()), m.c.z + Math.sin(a) * d)
      b.tri(v3(c.x - s, c.y, c.z), v3(c.x + s, c.y, c.z), v3(c.x, c.y + 1.7 * s, c.z), LIGHT); b.tri(v3(c.x + s, c.y, c.z), v3(c.x - s, c.y, c.z), v3(c.x, c.y - 1.7 * s, c.z), LIGHT)
      b.tri(v3(c.x, c.y, c.z - s), v3(c.x, c.y, c.z + s), v3(c.x, c.y + 1.7 * s, c.z), LIGHT); b.tri(v3(c.x, c.y, c.z + s), v3(c.x, c.y, c.z - s), v3(c.x, c.y - 1.7 * s, c.z), LIGHT)
    }
    b.setSurf(SURF.wood)
    this.fallingLeaves(masses, v3(top.x, oy + 90 * K, top.z), 110 * K)
  }

  /** THE LEAVES that fall from it, always: each from under a leaf mass down to the ground below, swaying wider as it
   *  comes, turning — gold or green, a faint ember at night. One instanced draw (a quad a leaf), nothing on the CPU per
   *  frame; not drawn from further than the crown's reach + 700 m (they're a metre across: a thing seen from under it). */
  private fallingLeaves(masses: { c: V3; r: number }[], c: V3, reach: number): void {
    if (gameParams().get('leaves') === '0') return                                  // (?leaves=0: none — the A/B)
    const n = this.tier.name === 'low' ? 260 : this.tier.name === 'medium' ? 520 : 900
    let s = 0x1eaf
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const at: number[] = [], seed: number[] = []
    for (let k = 0; k < n; k++) {
      const m = masses[Math.floor(rnd() * masses.length)], a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * m.r * 0.95
      const x = m.c.x + Math.cos(a) * d, z = m.c.z + Math.sin(a) * d, g = this.map.height(x, z) + 0.4
      at.push(x, g, z, Math.max(10, m.c.y - m.r * 0.45 - g))
      seed.push(rnd(), 0.7 + 0.9 * rnd(), 2.2 + 1.8 * rnd(), rnd() < 0.45 ? 1 : 0)
    }
    const g = new GFX.InstancedBufferGeometry()
    g.setAttribute('position', new GFX.Float32BufferAttribute([0, 0.5, 0, 0.34, 0, 0, 0, -0.5, 0, -0.34, 0, 0], 3))
    g.setIndex([0, 3, 1, 1, 3, 2])
    g.setAttribute('aAt', new GFX.InstancedBufferAttribute(new Float32Array(at), 4))
    g.setAttribute('aSeed', new GFX.InstancedBufferAttribute(new Float32Array(seed), 4))
    g.instanceCount = n
    const mat = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: { ...this.atmos.uniforms }, side: GFX.DoubleSide, vertexShader: LEAF_VERT, fragmentShader: LEAF_FRAG })
    const mesh = new GFX.Mesh(g, mat)
    mesh.frustumCulled = false
    mesh.visible = false
    this.group.add(mesh)
    this.leaves = { mesh, c, r: reach + 700 }
  }

  // ------------------------------------------------------------------------------------------------ THE GIANT'S GATE
  private gate(b: Builder, p: OutPlace): void {
    const map = this.map, R = () => b.rnd(), a = p.rot ?? 0
    // (the road runs along (cos a, sin a); the arch spans across it)
    const ax = -Math.sin(a), az = Math.cos(a), SPAN = 17, TOP = 25
    const ROCK: RGB = [0.36, 0.35, 0.34], ROCK_D: RGB = [0.2, 0.2, 0.21], ROCK_W: RGB = [0.47, 0.43, 0.37], LICHEN: RGB = [0.33, 0.36, 0.2]
    const rock = (seed: number) => (t: number, an: number): RGB => {
      const bed = 0.5 + 0.5 * Math.sin(t * 23 + seed), k = 0.5 + 0.5 * Math.sin(an * 3 + seed * 1.7)
      return mul(mix(mix(mix(ROCK_D, ROCK, bed), ROCK_W, k * 0.6), LICHEN, R() < 0.12 ? 0.6 : 0), 0.82 + 0.34 * R())
    }
    b.setSurf(SURF.stone)
    const N = 12, path: V3[] = [], rad: number[] = []
    for (let i = 0; i <= N; i++) {
      const t = i / N, th = Math.PI * t, s = -Math.cos(th) * SPAN * (1 + 0.06 * Math.sin(th * 2)), x = p.x + ax * s, z = p.z + az * s
      const foot = Math.min(t, 1 - t) < 0.01 ? map.height(x, z) - 4 : p.y
      path.push(v3(x + Math.cos(a) * 1.5 * Math.sin(th * 3), foot + Math.sin(th) ** 0.8 * TOP, z + Math.sin(a) * 1.5 * Math.sin(th * 3)))
      rad.push(4.2 + 3.6 * Math.abs(Math.cos(th)) ** 1.4 + 0.9 * Math.sin(i * 2.3))
    }
    limb(b, path, rad, 9, rock(1), (k, an) => 1 + 0.2 * Math.sin(an * 2 + k * 1.3) + 0.12 * Math.sin(an * 5 - k * 0.7))
    for (const s of [-SPAN, SPAN]) { const x = p.x + ax * s, z = p.z + az * s; this.box(x, map.height(x, z) + 6, z, 6.2, 8, 6.2, -a, false) }
    // its footing: fallen blocks at each leg
    for (const s of [-SPAN, SPAN]) for (let k = 0; k < 4; k++) {
      const d = s + Math.sign(s) * (5 + 7 * R()), o = (R() - 0.5) * 22, x = p.x + ax * d + Math.cos(a) * o, z = p.z + az * d + Math.sin(a) * o, r = 1.6 + 2.6 * R()
      if (map.roadEdge(x, z) < r + 1.5) continue
      lump(b, v3(x, map.height(x, z) + r * 0.35, z), r, r * 0.75, 0.3, k + 7, (up, q) => mul(mix(ROCK_D, ROCK, 0.5 + 0.5 * up), 0.8 + 0.4 * q))
      this.box(x, map.height(x, z) + r * 0.3, z, r * 0.75, r * 0.7, r * 0.75, 0, false)
    }
    // the NEEDLES: spires of the same rock standing off the road
    for (let k = 0; k < 7; k++) {
      const d = (k % 2 ? 1 : -1) * (34 + 70 * R()), o = (R() - 0.5) * 170, x = p.x + ax * d + Math.cos(a) * o, z = p.z + az * d + Math.sin(a) * o
      const h = 14 + 30 * R(), r0 = 3.2 + h * 0.11
      if (map.roadEdge(x, z) < r0 + 3) continue
      const y0 = map.height(x, z) - 3, lx = (R() - 0.5) * 0.16, lz = (R() - 0.5) * 0.16
      const sp: V3[] = [], sr: number[] = []
      for (let i = 0; i <= 5; i++) { const t = i / 5; sp.push(v3(x + lx * h * t * t, y0 + (h + 3) * t, z + lz * h * t * t)); sr.push(r0 * (1 - 0.82 * t ** 1.3) + 0.3) }
      limb(b, sp, sr, 7, rock(k + 2), (i, an) => 1 + 0.22 * Math.sin(an * 2 + i * 1.9 + k))
      this.box(x, y0 + h * 0.4, z, r0 * 0.75, h * 0.45, r0 * 0.75, 0, false)
    }
    b.setSurf(SURF.wood)
  }
}

const LEAF_VERT = /* glsl */ `
${ATMOS_GLSL}
in vec4 aAt;      // where it lands (x, the ground's y, z) and how far it falls
in vec4 aSeed;    // its seed, its size m, its fall m/s, gold (1) or green
out vec3 vWorld;
out vec3 vN;
out vec3 vAlb;
out float vGold;
void main() {
  float s = aSeed.x, ph = fract(uTime * aSeed.z / aAt.w + s);
  vec3 c = vec3(aAt.x, aAt.y + aAt.w * (1.0 - ph), aAt.z);
  float w = 2.0 + 7.0 * ph;
  c.x += sin(uTime * 0.31 + s * 40.0) * w + sin(uTime * 1.3 + s * 91.0) * 0.8;
  c.z += cos(uTime * 0.27 + s * 71.0) * w + cos(uTime * 1.1 + s * 53.0) * 0.8;
  float k = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.96, 1.0, ph)) * (1.0 - smoothstep(520.0, 700.0, distance(c, uCamPos)));
  if (k < 0.01) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float a = uTime * (1.2 + 2.0 * fract(s * 3.3)) + s * 50.0, b = s * 17.0 + uTime * 0.4;
  vec3 U = vec3(cos(b), 0.0, sin(b)), W = vec3(-sin(b), 0.0, cos(b)), V = vec3(0.0, cos(a), 0.0) + W * sin(a);
  vec3 wpos = c + (U * position.x + V * position.y) * aSeed.y * k;
  vN = cross(U, V);
  vGold = aSeed.w;
  vAlb = mix(vec3(0.16, 0.36, 0.1), vec3(0.74, 0.6, 0.14), aSeed.w) * (0.8 + 0.4 * fract(s * 23.0));
  vWorld = wpos;
  gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
}`

const LEAF_FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec3 vWorld;
in vec3 vN;
in vec3 vAlb;
in float vGold;
void main() {
  vec3 N = normalize(vN);
  // (a leaf is thin: the sun through it as on it)
  vec3 col = vAlb * (ambient(N) + uSunColor * (0.3 + 0.7 * abs(dot(N, uSunDir))) * 0.7);
  col += vec3(1.0, 0.66, 0.3) * (0.1 + 0.35 * vGold) * uLamps;
  gl_FragColor = vec4(applyAtmos(col, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
