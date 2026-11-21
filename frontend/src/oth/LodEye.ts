import * as GFX from './gfx'

/**
 * THE DETAIL'S EYE (2026-11-21, the user: "when we zoom in and out we need to move the camera, so the culling and the
 * graphics of where the sniper's lens sees will be good — now we just zoom and nothing is clear there").
 *
 * Everything in the world picks its detail by how far it is from the CAMERA: the ground's patches and its painted
 * colour, the grass round you, the trees — their own shapes near, a flat picture of each far off — the rocks, the
 * bushes, the things. Through a lens 11× narrower than the game's, what is 500 m off fills the screen as if it stood
 * 44 m off — and was still drawn as a thing half a kilometre away.
 *
 * So, in a lens narrower than the game's own (the scope), detail is measured from the SIGHT LINE instead. A point
 * pulled out along it until what's R away stands as near to it as the lens makes it look is R (1 − 1 / k) out, for a
 * lens k× the game's:
 *   THE LINE a → l, from the camera out to that point for what the MIDDLE of the lens is on: what picks its detail
 *   one by one — the trees, the rocks, the bushes, the things — measures to the line, so what stands between you and
 *   what you look at, big in the glass too, is as fine as what's at its end (`d2`).
 *   THE EYE `b`, that point for the NEAREST GROUND IN THE GLASS (the line through its lower edge, walked out to the
 *   land): what is laid ROUND one point follows it there — the ground's patches and its painted colour, the grass, the
 *   clutter, and the shaders' own fades with them (`uLodPos`). The nearest ground, not the middle: a ring can be in
 *   one place, and the bank at your feet filling half the glass must not lose its grass to a hillside a kilometre off
 *   (the first cut did that) — while a far hillside that is ALL the glass shows gets it whole.
 *   WHAT'S IN VIEW is chosen again after a turn a fraction of the lens (not the three degrees that were a sliver of
 *   the open view — a third of the scope's), against a view a little wider than the lens (`proj`, `turn`).
 * The picture itself is the true lens from where you stand: nothing here moves the camera that draws.
 *
 * The eye moves when what the lens is on has moved a good part of its own nearness — not with every frame of a sweep
 * (each move bakes ground and grass round the new place): it follows like a car driven along what you look over.
 * Out of the lens (`k` 1) the eye IS the camera and every measure here is the camera's own, to the bit.
 */
export const lodEye = {
  /** A lens narrower than the game's is in use; its magnification over the game's own. */
  on: false,
  k: 1,
  /** The camera; the detail's eye (what's laid round a point); the sight line's far end (what's picked one by one). */
  ax: 0, ay: 0, az: 0,
  bx: 0, by: 0, bz: 0,
  lx: 0, lz: 0,
  /** Counts the eye's moves: who keeps what it picked until the view changes asks this too. */
  rev: 0,
  /** The lens widened by a margin, for choosing what's in view (as the camera's projection: `proj × view`). */
  proj: new GFX.Matrix4(),
  /** The turn (its cosine) after which what's in view must be chosen again: `cos` in the open view. */
  turn(cos: number): number { return this.on ? this.turnCos : cos },
  turnCos: 1,
  /** The square of the distance, in plan, from (x, z) to the sight line's part a → l (out of the lens: to the camera). */
  d2(x: number, z: number): number {
    const px = x - this.ax, pz = z - this.az
    if (!this.on) return px * px + pz * pz
    const vx = this.lx - this.ax, vz = this.lz - this.az, L2 = vx * vx + vz * vz
    const t = L2 > 1e-6 ? Math.max(0, Math.min(1, (px * vx + pz * vz) / L2)) : 0
    const dx = px - vx * t, dz = pz - vz * t
    return dx * dx + dz * dz
  },
  /** The square (x0, z0) … + size lies wholly further than R from the sight line's part. */
  far(x0: number, z0: number, size: number, R: number): boolean {
    const h = size * 0.5, r = R + h * 1.4143
    return this.d2(x0 + h, z0 + h) > r * r
  },
  /** The plan box that holds everything within R of the sight line's part. */
  x0(R: number): number { return Math.min(this.ax, this.lx) - R },
  x1(R: number): number { return Math.max(this.ax, this.lx) + R },
  z0(R: number): number { return Math.min(this.az, this.lz) - R },
  z1(R: number): number { return Math.max(this.az, this.lz) + R },
}

const dir = new GFX.Vector3(), low = new GFX.Vector3(), up = new GFX.Vector3()
/** What the lens's middle is on (m), and the nearest ground in it; where the eye would go, last frame. */
let range = 400, rangeLow = 400, tx = 0, ty = 0, tz = 0
const PAD = 1.7

/** A line from p along d walked out — steps that grow with the distance — to the land, the place then halved in on;
 *  −1: nothing met in `far` m (the sky). */
function reach(p: GFX.Vector3, d: GFX.Vector3, height: (x: number, z: number) => number, far: number): number {
  let hit = -1, t0 = 0
  for (let t = 4; t < far; t += Math.max(3, t * 0.045)) {
    if (p.y + d.y * t < height(p.x + d.x * t, p.z + d.z * t)) { hit = t; break }
    t0 = t
  }
  if (hit < 0) return -1
  for (let i = 0; i < 5; i++) { const m = (t0 + hit) / 2; if (p.y + d.y * m < height(p.x + d.x * m, p.z + d.z * m)) hit = m; else t0 = m }
  return hit
}

/**
 * Once a frame, before the world picks what it draws: the camera, the lens's magnification (1: the game's own view)
 * and the land's height (the sight lines are walked out to where they meet the ground: no physics that far off).
 */
export function aimLodEye(camera: GFX.PerspectiveCamera, k: number, dt: number, height: (x: number, z: number) => number): void {
  const E = lodEye, p = camera.position
  E.ax = p.x; E.ay = p.y; E.az = p.z
  if (k < 1.05) {
    if (E.on) E.rev++
    E.on = false; E.k = 1
    E.bx = p.x; E.by = p.y; E.bz = p.z
    E.lx = p.x; E.lz = p.z
    return
  }
  camera.getWorldDirection(dir)
  const half = (camera.fov * Math.PI) / 360
  // WHAT THE LENS IS ON: its middle (nothing met — the sky: as far as it was last) …
  const r = reach(p, dir, height, 3000)
  if (r > 0) range = r
  // … and the NEAREST GROUND in it: the line through its lower edge (the camera's own up, turned down half the lens)
  up.set(0, 1, 0).applyQuaternion(camera.quaternion)
  low.copy(dir).multiplyScalar(Math.cos(half * 0.9)).addScaledVector(up, -Math.sin(half * 0.9))
  const rl = reach(p, low, height, range)
  rangeLow = rl > 0 ? Math.min(rl, range) : range
  const was = E.on
  E.on = true
  if (E.k !== k) { E.k = k; E.rev++ }
  // THE LINE's far end: followed at once — it bakes nothing, it only chooses again (told so when it has moved a part
  // of its own nearness)
  const m = range * (1 - 1 / k), lx = p.x + dir.x * m, lz = p.z + dir.z * m
  if (!was || Math.hypot(lx - E.lx, lz - E.lz) > Math.max(2, (range / k) * 0.1)) { E.lx = lx; E.lz = lz; E.rev++ }
  // THE EYE: moved when where it should be has gone a good part of its nearness — and isn't flying across the land
  // (a flick of the glass isn't followed: where it comes to rest is)
  const mb = rangeLow * (1 - 1 / k), near = rangeLow / k
  const nx = p.x + dir.x * mb, ny = p.y + dir.y * mb, nz = p.z + dir.z * mb
  const sp = Math.hypot(nx - tx, ny - ty, nz - tz) / Math.max(dt, 1e-3)
  tx = nx; ty = ny; tz = nz
  if (!was || (Math.hypot(nx - E.bx, ny - E.by, nz - E.bz) > Math.max(5, near * 0.35) && sp < Math.max(40, near * 4))) { E.bx = nx; E.by = ny; E.bz = nz; E.rev++ }
  // the lens widened, for choosing what's in view: what's chosen holds for a turn of a third of the lens
  const s = Math.tan(half) / Math.tan(Math.min(1.2, half * PAD))
  E.proj.copy(camera.projectionMatrix)
  E.proj.elements[0] *= s; E.proj.elements[5] *= s
  E.turnCos = Math.cos(half * 2 * (PAD - 1) * 0.45)
}
