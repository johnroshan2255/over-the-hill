import * as GFX from './gfx'
import { LOOK, type Atmosphere } from './Atmosphere'
import { Builder, SURF, woodMaterial } from './Bridges'
import type { MapData } from './MapData'
import type { Tier } from './quality'
import type { TerrainShadow } from './TerrainShadow'
import { detailKeep } from './Wardens'
import { gameParams } from '../settings'

/**
 * THE GROUND'S CLUTTER (2026-11-13 — the user's painted frames: "plain, nothing is there, too empty — something needs to
 * be there, in the entire map"): the small things a real valley floor is strewn with, near the camera only —
 *   in the WOODS   stumps, fallen mossy logs, ferns (autumn-touched), dead branches;
 *   in the OPEN    stones half sunk in the grass, the odd fern or stump;
 *   by the TRACKS  stones; and along the roads and tracks, runs of broken fence (buildFences).
 * Placed per 16 m cell from the cell's own seed (the same things in the same places every visit), only where the land
 * is free (no track or road, water, steep bank, place or ruin — World's `open`), streamed in a ring round the camera
 * (ULTRA 150 m … a phone 80 m — past it the haze has the land) and re-picked when the camera has moved 8 m. Where the
 * woods are comes from the trees themselves (a 32 m density grid, once) — the box's mask stops at its edge, the trees
 * don't. One draw per kind (an InstancedMesh, the props' wood material: its light, haze, headlights), no colliders.
 * Thinned on the weaker tiers (Wardens.detailKeep). ?clutter=0: none (the A/B).
 */
type RGB = [number, number, number]
const V = (x: number, y: number, z: number) => new GFX.Vector3(x, y, z)
const KINDS = ['stump', 'log', 'stones', 'fern', 'branch', 'fence', 'fence2', 'boulder'] as const
type Kind = (typeof KINDS)[number]
const CELL = 16
const FGRID = 32
/** `?cl2=0`: the open country's clutter as it was before round 5 (half the tries — the A/B). */
const CL2 = gameParams().get('cl2') !== '0'

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]
const STONE: RGB = [0.3, 0.29, 0.27]
const MOSS: RGB = [0.07, 0.09, 0.025]

/** A chunk of stone: a squashed, skewed hexahedron (centre, half sizes, turned yaw). */
function chunk(b: Builder, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, col: RGB): void {
  const cs = Math.cos(yaw), sn = Math.sin(yaw), j = () => 0.75 + b.rnd() * 0.5
  const P = (x: number, y: number, z: number) => V(cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs)
  const bot = [P(-hx * j(), -hy, -hz * j()), P(hx * j(), -hy, -hz * j()), P(hx * j(), -hy, hz * j()), P(-hx * j(), -hy, hz * j())]
  const top = [P(-hx * 0.6 * j(), hy * j(), -hz * 0.6 * j()), P(hx * 0.6 * j(), hy * j(), -hz * 0.6 * j()), P(hx * 0.6 * j(), hy * j(), hz * 0.6 * j()), P(-hx * 0.6 * j(), hy * j(), hz * 0.6 * j())]
  const c = V(cx, cy, cz)
  const face = (p: GFX.Vector3[], k: number) => {
    const n = new GFX.Vector3().subVectors(p[1], p[0]).cross(new GFX.Vector3().subVectors(p[3], p[0]))
    const cc = shade(col, k)
    if (n.dot(new GFX.Vector3().subVectors(p[0], c)) >= 0) b.quad(p[0], p[1], p[2], p[3], cc); else b.quad(p[0], p[3], p[2], p[1], cc)
  }
  face(top, 1.08)
  for (let s = 0; s < 4; s++) { const t = (s + 1) % 4; face([bot[s], bot[t], top[t], top[s]], 0.8 + 0.12 * (s % 2)) }
}

/** Each kind's model at real size, on the ground (y 0), facing +z. */
const BUILD: Record<Kind, (b: Builder) => void> = {
  // a sawn STUMP (⌀ ~0.55, 0.45 m): bark round it, its cut face paler with the rings, roots running out into the ground
  stump(b) {
    b.setSurf(SURF.wood)
    const bark = b.wood(0.7), n = 9
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 6.283, a1 = ((i + 1) / n) * 6.283, h0 = 0.42 + 0.06 * Math.sin(i * 2.3), h1 = 0.42 + 0.06 * Math.sin((i + 1) * 2.3)
      b.quad(V(Math.cos(a0) * 0.3, -0.1, Math.sin(a0) * 0.3), V(Math.cos(a0) * 0.26, h0, Math.sin(a0) * 0.26), V(Math.cos(a1) * 0.26, h1, Math.sin(a1) * 0.26), V(Math.cos(a1) * 0.3, -0.1, Math.sin(a1) * 0.3), shade(bark, i % 2 ? 0.9 : 1.05))
      b.tri(V(Math.cos(a1) * 0.26, h1, Math.sin(a1) * 0.26), V(Math.cos(a0) * 0.26, h0, Math.sin(a0) * 0.26), V(0, 0.45, 0), [0.3, 0.2, 0.11])
    }
    for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.4; b.log(V(Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2), V(Math.cos(a) * 0.7, -0.05, Math.sin(a) * 0.7), 0.07, bark) }
    b.setSurf(SURF.plain)
    for (let k = 0; k < 3; k++) { const a = k * 2.1, A = V(Math.cos(a) * 0.31, 0.05, Math.sin(a) * 0.31), B = V(Math.cos(a + 0.5) * 0.3, 0.32, Math.sin(a + 0.5) * 0.3), C = V(Math.cos(a + 0.9) * 0.31, 0.06, Math.sin(a + 0.9) * 0.31); b.tri(A, B, C, MOSS); b.tri(A, C, B, MOSS) }
  },
  // a FALLEN LOG (~3.6 m): lying along x, half in the grass, its broken end jagged, a branch's stub, moss along its top
  log(b) {
    b.setSurf(SURF.wood)
    const bark = b.wood(0.6)
    b.log(V(-1.8, 0.16, 0), V(0.4, 0.2, 0.05), 0.22, bark)
    b.log(V(0.4, 0.2, 0.05), V(1.8, 0.15, -0.08), 0.19, shade(bark, 0.92))
    b.log(V(-0.6, 0.3, 0.1), V(-0.9, 0.62, 0.45), 0.05, bark)
    b.log(V(0.9, 0.24, -0.1), V(1.3, 0.2, -0.6), 0.045, bark)
    b.setSurf(SURF.plain)
    for (let k = 0; k < 6; k++) { const x = -1.6 + k * 0.6; b.quad(V(x, 0.41, -0.1), V(x, 0.41, 0.1), V(x + 0.45, 0.4, 0.09), V(x + 0.45, 0.4, -0.08), shade(MOSS, 0.8 + 0.4 * b.rnd())) }
  },
  // a MOSSY BOULDER (round 5 — the user's Moth Stones frame: its foreground's low rounded rocks, green on top): ~1.3 m
  // across, knee-high — a wheel rolls over it — two stones leaning together, a cushion of moss over each, a few small
  boulder(b) {
    b.setSurf(SURF.stone)
    chunk(b, 0, 0.16, 0, 0.66, 0.34, 0.5, 0.4, shade(STONE, 0.9))
    chunk(b, 0.62, 0.1, 0.3, 0.36, 0.22, 0.3, 1.3, shade(STONE, 0.8))
    for (let k = 0; k < 3; k++) { const a = b.rnd() * 6.28, r = 0.85 + b.rnd() * 0.5, s = 0.08 + b.rnd() * 0.1; chunk(b, Math.cos(a) * r, s * 0.4, Math.sin(a) * r, s * 1.3, s, s, b.rnd() * 6, shade(STONE, 0.8 + b.rnd() * 0.3)) }
    b.setSurf(SURF.plain)
    chunk(b, -0.02, 0.5, 0.0, 0.5, 0.045, 0.38, 0.4, shade(MOSS, 1.25))
    chunk(b, 0.6, 0.32, 0.3, 0.25, 0.035, 0.2, 1.3, shade(MOSS, 1.0))
  },
  // STONES half sunk in the grass: a big one and a few small round it
  stones(b) {
    b.setSurf(SURF.stone)
    chunk(b, 0, 0.12, 0, 0.42, 0.26, 0.34, 0.3, STONE)
    for (let k = 0; k < 4; k++) { const a = b.rnd() * 6.28, r = 0.6 + b.rnd() * 0.6, s = 0.1 + b.rnd() * 0.12; chunk(b, Math.cos(a) * r, s * 0.4, Math.sin(a) * r, s * 1.3, s, s, b.rnd() * 6, shade(STONE, 0.85 + b.rnd() * 0.3)) }
  },
  // a FERN: a dozen fronds arching out and down from its crown, each a tapering strip, both faces; a few gone gold
  fern(b) {
    b.setSurf(SURF.plain)
    const n = 12
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + b.rnd() * 0.3, L = 0.55 + b.rnd() * 0.35, gold = b.rnd() < 0.3
      const col: RGB = gold ? [0.2, 0.13, 0.03] : shade([0.05, 0.085, 0.022], 0.85 + b.rnd() * 0.35)
      const d = V(Math.cos(a), 0, Math.sin(a)), s = V(-Math.sin(a), 0, Math.cos(a))
      const pt = (t: number) => d.clone().multiplyScalar(t * L).add(V(0, 0.05 + Math.sin(t * 2.6) * 0.32 * L, 0))
      for (let k = 0; k < 3; k++) {
        const t0 = k / 3, t1 = (k + 1) / 3, w0 = 0.11 * (1 - t0 * 0.8), w1 = 0.11 * (1 - t1 * 0.8)
        const p0 = pt(t0), p1 = pt(t1)
        const A = p0.clone().addScaledVector(s, -w0), B = p0.clone().addScaledVector(s, w0), C = p1.clone().addScaledVector(s, w1), D = p1.clone().addScaledVector(s, -w1)
        b.quad(A, B, C, D, shade(col, 1 + 0.1 * k)); b.quad(A, D, C, B, shade(col, 0.8))
      }
    }
  },
  // DEAD BRANCHES lying crossed: grey-brown, thin, a fork or two
  branch(b) {
    b.setSurf(SURF.wood)
    const c: RGB = [0.13, 0.1, 0.075]
    b.log(V(-1.1, 0.05, -0.2), V(1.0, 0.06, 0.25), 0.05, c)
    b.log(V(0.1, 0.06, 0.05), V(0.6, 0.05, -0.55), 0.03, shade(c, 1.1))
    b.log(V(-0.5, 0.05, 0.6), V(0.4, 0.07, -0.7), 0.04, shade(c, 0.9))
    b.log(V(-0.1, 0.07, -0.25), V(-0.4, 0.05, -0.75), 0.025, c)
  },
  // a FENCE BAY (round 4 — the user: "not fences all over the ground: some broken fence along the sides of the roads"):
  // one weathered post (at x −1.25) and two split rails to the next bay's post, a little sagging — whole runs of them
  // along a road (Clutter.fences)
  fence(b) {
    b.setSurf(SURF.wood)
    const w = b.wood(0.7)
    b.log(V(-1.25, -0.35, 0), V(-1.27, 1.15, 0.02), 0.07, w)
    b.log(V(-1.25, 0.95, 0.06), V(1.25, 0.9, 0.06), 0.045, shade(w, 1.1))
    b.log(V(-1.25, 0.5, 0.06), V(1.25, 0.47, 0.06), 0.045, shade(w, 0.95))
  },
  // … a BROKEN bay: its post leaning, the top rail gone, the lower one snapped and hanging to the ground
  fence2(b) {
    b.setSurf(SURF.wood)
    const w = b.wood(0.65)
    b.log(V(-1.25, -0.35, 0), V(-1.1, 1.05, 0.12), 0.07, w)
    b.log(V(-1.2, 0.5, 0.06), V(0.4, 0.06, 0.12), 0.045, shade(w, 1.05))
    b.log(V(0.6, 0.05, 0.3), V(1.3, 0.04, 0.5), 0.04, shade(w, 0.9))
  },
}

export class Clutter {
  readonly group = new GFX.Group()
  private readonly meshes = new Map<Kind, GFX.InstancedMesh>()
  /** Per cell: its things (kind index, then the matrix: 17 floats each). */
  private readonly cells = new Map<number, Float32Array>()
  private readonly last = new GFX.Vector3(1e9, 0, 1e9)
  private readonly R: number
  private readonly keep: number
  private readonly forest: Float32Array
  private readonly fn: number
  private readonly fo: number

  constructor(private readonly map: MapData, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4, trees: { data: Float32Array; count: number; stride: number },
    private readonly open: (x: number, z: number) => boolean) {
    this.keep = detailKeep(tier)
    this.R = tier.weakGpu ? 80 : tier.name === 'low' ? 90 : tier.name === 'medium' ? 115 : tier.name === 'high' ? 135 : 150
    // where the woods are: the trees in 32 m cells, over the whole world
    const half = map.play + 64
    this.fo = -half; this.fn = Math.ceil((2 * half) / FGRID)
    this.forest = new Float32Array(this.fn * this.fn)
    for (let i = 0; i < trees.count; i++) {
      const o = i * trees.stride, gi = Math.floor((trees.data[o] - this.fo) / FGRID), gj = Math.floor((trees.data[o + 2] - this.fo) / FGRID)
      if (gi >= 0 && gj >= 0 && gi < this.fn && gj < this.fn) this.forest[gj * this.fn + gi] += 1
    }
    const mat = woodMaterial(atmos, shadow, tier, farGrid)
    // (the most of a kind that can be in the ring at once: generous — the cells' share of the ring's area × the densest)
    const cap = Math.ceil(Math.PI * ((this.R + CELL) / CELL) ** 2 * 3)
    KINDS.forEach((k, ki) => {
      const b = new Builder(0xc1a7 + ki * 313)
      BUILD[k](b)
      const m = new GFX.InstancedMesh(b.geometry(), mat, cap)
      m.count = 0; m.frustumCulled = false
      m.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
      this.meshes.set(k, m)
      this.group.add(m)
    })
    if (gameParams().get('fences') !== '0') this.buildFences()
  }

  /** THE ROADSIDE FENCES, by 16 m cell: per bay its kind and matrix (17 floats), joined into the cell's things. */
  private readonly fences = new Map<number, number[]>()
  /**
   * BROKEN FENCES ALONG THE ROADS (round 4 — the user: "why is this on the ground a lot — just add some broken fence on
   * the side of the roads"): along every box track and outland road, in RUNS of 25–70 m on one side (its own seed per
   * line), 2.2 m off the way's edge, with long gaps (60–200 m) between: bays of post and two rails, every so often a
   * broken bay or a bay gone. A bay is skipped where it would stand on another way, in water, a place, or a slope.
   */
  private buildFences(): void {
    const map = this.map
    const lines: [[number, number][], number][] = [
      ...map.meta.trails.lines.map((l) => [l, map.meta.trails.hw] as [[number, number][], number]),
      ...(map.meta.outland?.trails?.lines ?? []).map((l) => [l, map.roadHW] as [[number, number][], number]),
    ]
    const m4 = new GFX.Matrix4(), q = new GFX.Quaternion(), e = new GFX.Euler(), BAY = 2.5
    lines.forEach(([L, hw], li) => {
      let s = (Math.imul(li + 1, 2654435761) ^ 0x9e3779b9) >>> 0
      const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
      let on = false, left = 40 + rnd() * 120, side = 1, carry = 0
      for (let k = 0; k + 1 < L.length; k++) {
        const ax = L[k][0], az = L[k][1], dx = L[k + 1][0] - ax, dz = L[k + 1][1] - az, len = Math.hypot(dx, dz)
        if (len < 1e-3) continue
        const ux = dx / len, uz = dz / len
        let t = carry
        for (; t < len; t += BAY) {
          left -= BAY
          if (left <= 0) { on = !on; left = on ? 25 + rnd() * 45 : 60 + rnd() * 140; side = rnd() < 0.5 ? 1 : -1 }
          if (!on || rnd() < 0.08) continue // (a bay gone)
          const off = hw + 2.2, x = ax + ux * t - uz * off * side, z = az + uz * t + ux * off * side
          if (map.wayEdge(x, z) < 1.2 || !this.open(x, z)) continue
          const y = map.height(x, z)
          // (not on a lake's shore, a slope along it, nor where the ground falls away ACROSS it — a bay hung off a cliff's edge)
          if (map.lakeShore(x, z, y, 0.6) || Math.abs(map.height(x + ux * 1.3, z + uz * 1.3) - map.height(x - ux * 1.3, z - uz * 1.3)) > 1.6 || Math.abs(map.height(x - uz * 1.2, z + ux * 1.2) - map.height(x + uz * 1.2, z - ux * 1.2)) > 1.0) continue
          map.maskAt(x, z, this.mk)
          if (this.mk[2] > 0.5) continue
          // (along the way: local +x = (ux, uz); a hair out of true, a broken bay now and then)
          q.setFromEuler(e.set((rnd() - 0.5) * 0.06, Math.atan2(-uz, ux) + (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08, 'YXZ'))
          m4.compose(new GFX.Vector3(x + ux * 1.25, y - 0.03, z + uz * 1.25), q, new GFX.Vector3(1, 1, 1))
          const key = (Math.floor((x + ux * 1.25) / CELL) + 4096) * 8192 + (Math.floor((z + uz * 1.25) / CELL) + 4096)
          let l = this.fences.get(key)
          if (!l) this.fences.set(key, (l = []))
          l.push(KINDS.indexOf(rnd() < 0.18 ? 'fence2' : 'fence'), ...m4.elements)
        }
        carry = t - len
      }
    })
  }

  /** Trees in the 32 m cell round (x, z) and its neighbours' share: 0 open … 1 woods. */
  private woods(x: number, z: number): number {
    const gi = Math.floor((x - this.fo) / FGRID), gj = Math.floor((z - this.fo) / FGRID)
    let n = 0
    for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) if (i >= 0 && j >= 0 && i < this.fn && j < this.fn) n += this.forest[j * this.fn + i] * (i === gi && j === gj ? 1 : 0.35)
    return Math.min(1, n / 9)
  }

  private readonly mk: [number, number, number, number] = [0, 0, 0, 0]
  private readonly m4 = new GFX.Matrix4()
  private readonly q4 = new GFX.Quaternion()
  private readonly e4 = new GFX.Euler()
  /** A cell's things, made once (its own seed: the same every time). */
  private cell(ci: number, cj: number): Float32Array {
    const key = (ci + 4096) * 8192 + (cj + 4096)
    let c = this.cells.get(key)
    if (c) return c
    let s = (Math.imul(ci, 73856093) ^ Math.imul(cj, 19349663) ^ 0x5bd1e995) >>> 0
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const out: number[] = [], map = this.map
    const x0 = ci * CELL, z0 = cj * CELL, wd = this.woods(x0 + CELL / 2, z0 + CELL / 2)
    // (round 5 — the user's frames: the ground by the camera is BUSY — ferns, mossy boulders, logs — in the open too:
    //  twice the tries in the open country, and fewer of them thrown away)
    const tries = Math.round(((LOOK && CL2 ? 2.6 : 1.2) + 3.2 * wd) * 1.15)
    for (let t = 0; t < tries; t++) {
      const x = x0 + rnd() * CELL, z = z0 + rnd() * CELL, pick = rnd(), thin = rnd(), rot = rnd() * 6.283, sc = 0.75 + rnd() * 0.6
      if (thin >= this.keep) continue
      const way = map.wayEdge(x, z)
      if (way < 1.6 || !this.open(x, z)) continue
      const y = map.height(x, z)
      if (map.lakeShore(x, z, y, 0.8)) continue
      const sl = Math.hypot(map.height(x + 1.5, z) - map.height(x - 1.5, z), map.height(x, z + 1.5) - map.height(x, z - 1.5)) / 3
      if (sl > 0.75) continue
      map.maskAt(x, z, this.mk)
      if (this.mk[2] > 0.5) continue // (water, its gravel)
      let k: Kind
      if (this.mk[0] > 0.45 || sl > 0.45) { if (rnd() > 0.3) continue; k = 'stones' } // (thin on bare rock: evenly sprinkled, they read as dice)
      else if (way < 6 && pick < 0.4) k = LOOK && pick < 0.16 ? 'boulder' : 'stones'
      else if (wd > 0.3) k = pick < 0.24 ? 'stump' : pick < 0.42 ? 'log' : pick < 0.74 ? 'fern' : LOOK && pick > 0.92 ? 'boulder' : 'branch'
      else if (LOOK) { if (rnd() > 0.8) continue; k = pick < 0.24 ? 'stones' : pick < 0.44 ? 'boulder' : pick < 0.72 ? 'fern' : pick < 0.82 ? 'branch' : pick < 0.92 ? 'stump' : 'log' }
      else { if (rnd() > 0.55) continue; k = pick < 0.5 ? 'stones' : pick < 0.66 ? 'fern' : pick < 0.8 ? 'branch' : pick < 0.93 ? 'stump' : 'log' }
      // (2026-11-13, the user, on a frame of the meadow: "see those small small rocks — remove those, all the game has
      //  that with the same shape": no loose stones or boulders in the clutter any more — one instanced shape, pale in
      //  the grass, it read as a stamp. The woods' stumps, logs, ferns and branches stay; the tries are as they were, so
      //  nothing else moves.)
      if (k === 'stones' || k === 'boulder') continue
      // (tilted with the slope a little; sunk a touch)
      const tx = (map.height(x, z + 1) - map.height(x, z - 1)) * 0.4, tz = -(map.height(x + 1, z) - map.height(x - 1, z)) * 0.4
      this.q4.setFromEuler(this.e4.set(Math.atan(tx), rot, Math.atan(tz), 'XYZ'))
      this.m4.compose(V(x, y - 0.04, z), this.q4, V(sc, sc, sc))
      out.push(KINDS.indexOf(k), ...this.m4.elements)
    }
    { const fz = this.fences.get(key); if (fz) for (const v of fz) out.push(v) }   // (the roadside fences in this cell)
    c = new Float32Array(out)
    this.cells.set(key, c)
    // (the cache: dropped when it grows past a few rings' worth — the far cells made again if ever back)
    if (this.cells.size > 4000) { const it = this.cells.keys(); for (let i = 0; i < 1500; i++) this.cells.delete(it.next().value as number) }
    return c
  }

  /** Re-pick what's drawn when the camera has moved 8 m. */
  update(camera: GFX.Camera): void {
    const p = camera.position
    if (p.distanceToSquared(this.last) < 64) return
    this.last.copy(p)
    const counts = new Array<number>(KINDS.length).fill(0)
    const arrays = KINDS.map((k) => this.meshes.get(k)!.instanceMatrix.array as Float32Array)
    const R = this.R, i0 = Math.floor((p.x - R) / CELL), i1 = Math.floor((p.x + R) / CELL), j0 = Math.floor((p.z - R) / CELL), j1 = Math.floor((p.z + R) / CELL)
    const cap = arrays[0].length / 16
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = Math.max(i * CELL - p.x, 0, p.x - (i + 1) * CELL), dz = Math.max(j * CELL - p.z, 0, p.z - (j + 1) * CELL)
      if (dx * dx + dz * dz > R * R) continue
      const c = this.cell(i, j)
      for (let o = 0; o < c.length; o += 17) {
        const k = c[o], n = counts[k]
        if (n >= cap) continue
        arrays[k].set(c.subarray(o + 1, o + 17), n * 16)
        counts[k] = n + 1
      }
    }
    KINDS.forEach((k, ki) => {
      const m = this.meshes.get(k)!
      m.count = counts[ki]
      m.visible = counts[ki] > 0
      const im = m.instanceMatrix
      im.clearUpdateRanges()
      if (m.count) im.addUpdateRange(0, m.count * 16)
      im.needsUpdate = m.count > 0
    })
  }
}
