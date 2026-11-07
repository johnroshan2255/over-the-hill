import type * as GFX from './gfx'
import type { MapData } from './MapData'

/**
 * TERRAIN OCCLUSION CULLING — what the hills hide. From the camera, AZ rays march out over the height grid (from 6 m
 * to the reach, each sample 5.5 % farther than the last), each keeping the highest elevation (as a slope, rise / run)
 * met so far: the HORIZON along that ray at every distance. A box (a tree tile, a rock cell, a bush tile) whose
 * highest point is under the horizon in every azimuth it spans — the horizon taken nearer than the box — stands
 * behind the ground and is skipped. Conservative: the box's own highest slope is taken at its nearest corner, the
 * azimuths it spans ± one ray are all checked, and a small margin is kept (no popping at a ridge's edge).
 * The eye is taken 1.2 m above the camera (a higher eye sees more: safe while the camera bobs). 320 × ~104 height
 * samples ≈ 1.3 ms here (5 ms on a phone) — so the next horizon is BUILT A SLICE A FRAME (2026-11-07, docs/PERF.md
 * "the hitches": it was one 1.3–5.5 ms frame every 4 m driven): begun once the camera is 2.5 m from the eye in use
 * (or 0.5 m under it / 5 m below), AZ / SLICES rays a frame into a second buffer, swapped in when whole. The queries
 * read only the whole one. The old limits stand: moved 4 m, risen past the eye or sunk 6 m, the rest of the build is
 * done at once — a horizon is never staler than before; at 100+ fps it never comes to that.
 * A query is ~10–40 array reads.
 */
const AZ = 320
const D0 = 6
const RATIO = 1.06
const LOG_RATIO = Math.log(RATIO)
const MARGIN = 0.004 // (slope units: ~0.2°)
const EYE = 1.2
const SLICES = 8

export class Horizon {
  private readonly dist: Float32Array
  private max: Float32Array // AZ × NR: the highest slope met along the ray up to (and including) sample k
  private next: Float32Array // (the one being built)
  private readonly nr: number
  private cx = Number.NaN
  private cy = 0
  private cz = 0
  /** the build under way: its eye, the rays done so far (−1: none under way) */
  private bx = 0
  private by = 0
  private bz = 0
  private done = -1
  /** Off (?occlusion=0): nothing is ever hidden. */
  enabled = true
  /** Rebuilds so far (the HUD). */
  builds = 0

  constructor(private readonly map: MapData, reach: number) {
    let n = 0
    for (let d = D0; d < reach * 1.02; d *= RATIO) n++
    this.nr = n
    this.dist = new Float32Array(n)
    for (let k = 0, d = D0; k < n; k++, d *= RATIO) this.dist[k] = d
    this.max = new Float32Array(AZ * n)
    this.next = new Float32Array(AZ * n)
  }

  /** Call once a frame (a slice of the next horizon while one is being built). */
  update(cam: GFX.Vector3): void {
    if (!this.enabled) return
    const dx = cam.x - this.cx, dz = cam.z - this.cz, d2 = dx * dx + dz * dz
    // past the old limits (or none yet): built whole, here, now — as it always was (a slice under way is dropped)
    if (Number.isNaN(this.cx) || !(d2 < 16 && cam.y < this.cy - 0.1 && cam.y > this.cy - 6)) {
      this.begin(cam)
      this.rays(0, AZ)
      this.swap()
      return
    }
    if (this.done < 0) {
      if (d2 < 6.25 && cam.y < this.cy - 0.5 && cam.y > this.cy - 5) return
      this.begin(cam)
    }
    const to = Math.min(AZ, this.done + AZ / SLICES)
    this.rays(this.done, to)
    this.done = to
    if (to === AZ) this.swap()
  }

  private begin(cam: GFX.Vector3): void { this.bx = cam.x; this.by = cam.y + EYE; this.bz = cam.z; this.done = 0 }
  /** The built horizon in use from now. */
  private swap(): void {
    const t = this.max; this.max = this.next; this.next = t
    this.cx = this.bx; this.cy = this.by; this.cz = this.bz
    this.done = -1
    this.builds++
  }

  /** Rays a0 … a1 − 1 of the horizon being built (its eye bx, by, bz) into `next`. */
  private rays(a0: number, a1: number): void {
    const n = this.nr, D = this.dist, M = this.next, map = this.map, eye = this.by, x = this.bx, z = this.bz
    for (let a = a0; a < a1; a++) {
      const t = (a / AZ) * Math.PI * 2, ux = Math.cos(t), uz = Math.sin(t)
      let m = -1e9
      const o = a * n
      for (let k = 0; k < n; k++) {
        const d = D[k]
        const s = (map.height(x + ux * d, z + uz * d) - eye) / d
        if (s > m) m = s
        M[o + k] = m
      }
    }
  }

  /** Is the box b (its top the highest point) hidden behind the ground? */
  hiddenBox(b: GFX.Box3): boolean { return this.hidden(b.min.x, b.min.z, b.max.x, b.max.z, b.max.y) }

  /** Is the box [x0, x1] × [z0, z1] up to height `top` hidden behind the ground? */
  hidden(x0: number, z0: number, x1: number, z1: number, top: number): boolean {
    if (!this.enabled || Number.isNaN(this.cx)) return false
    const cx = this.cx, cz = this.cz
    // nearest / farthest distance of the box
    const nx = Math.max(x0 - cx, 0, cx - x1), nz = Math.max(z0 - cz, 0, cz - z1)
    const dn = Math.sqrt(nx * nx + nz * nz) // (not Math.hypot: its arguments boxed — garbage on every query)
    if (dn < D0 * 2) return false
    const fx = Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), fz = Math.max(Math.abs(z0 - cz), Math.abs(z1 - cz))
    const df = Math.sqrt(fx * fx + fz * fz)
    // its highest slope as seen from the eye: at its nearest point if it rises above the eye, else at its farthest
    const rise = top - this.cy
    const sBox = rise > 0 ? rise / dn : rise / df
    // the horizon sample just nearer than the box
    const k = Math.floor(Math.log(dn / D0) / LOG_RATIO) - 1
    if (k < 0) return false
    const kk = Math.min(k, this.nr - 1)
    // the azimuths the box spans (its four corners, relative to the first: no wrap at ±π; it never contains the
    // camera here) — the corners unrolled: no arrays made per query
    const a0 = Math.atan2(z0 - cz, x0 - cx)
    const r1 = rel(Math.atan2(z0 - cz, x1 - cx) - a0), r2 = rel(Math.atan2(z1 - cz, x0 - cx) - a0), r3 = rel(Math.atan2(z1 - cz, x1 - cx) - a0)
    const r0 = rel(0)
    const amin = Math.min(r0, r1, r2, r3), amax = Math.max(r0, r1, r2, r3)
    const step = (Math.PI * 2) / AZ
    const b0 = Math.floor((a0 + amin) / step) - 1, b1 = Math.ceil((a0 + amax) / step) + 1
    const n = this.nr, M = this.max
    for (let b = b0; b <= b1; b++) {
      const a = ((b % AZ) + AZ) % AZ
      if (M[a * n + kk] < sBox + MARGIN) return false // (seen along this ray)
    }
    return true
  }
}

/** An angle difference into (−π, π] (as atan2(sin, cos) gives it). */
const rel = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
