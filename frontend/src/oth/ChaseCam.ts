import * as GFX from './gfx'
import type { MapData } from './MapData'

/** What the camera follows (main.ts: the car, or the bike while riding): its place, and its heading and speed when there. */
export interface ChaseTarget {
  readonly pos: GFX.Vector3
  readonly sim: { readonly heading: number; readonly speed: number } | null | undefined
}

/**
 * The CHASE CAMERA: behind and above the car, swinging round after its heading with a little lag (so a slide shows),
 * pulled back a touch with speed. Drag (mouse / finger) orbits it; it eases back behind the car 1.5 s after you let
 * go. ZOOM (3.5–40 m, eased): the mouse wheel, a two-finger pinch, the + / − keys and the on-screen + / − buttons
 * (`zoom`). Never under the ground.
 */
export class ChaseCam {
  private yaw = 0
  private orbit = 0
  private pitch = 0.22
  private dist = 9
  private distTo = 9
  private idle = 0
  private drag = false
  private lx = 0
  private ly = 0
  private readonly touches = new Map<number, { x: number; y: number }>()
  private pinch = 0
  enabled = true
  private readonly look = new GFX.Vector3()
  /** The first solid thing (a slab stack, a formation) on the line from the look point out to the camera: its distance
   *  (m), or null — main.ts gives it the physics. The camera stops in front of it (2026-11-04: in among the desert's
   *  slab walls it went into the rock and showed its inside). */
  obstruct: ((ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) => number | null) | null = null
  /** The distance the rock last allowed (eased back out, never in: the camera snaps in front of a wall). */
  private room = 1e4
  /** 0 … 1: how far the camera has risen over the car (rock close behind it). */
  private lift = 0
  /** How high over the vehicle it looks (m): the car's 1.6, the bike's lower. */
  private lookH = 1.6

  constructor(readonly camera: GFX.PerspectiveCamera, private readonly map: MapData, private readonly car: ChaseTarget, dom: HTMLElement) {
    dom.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest?.('.oth-touch')) return
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this.drag = this.touches.size === 1; this.lx = e.clientX; this.ly = e.clientY
      if (this.touches.size === 2) this.pinch = this.spread()
    })
    const up = (e: PointerEvent) => {
      this.touches.delete(e.pointerId)
      this.drag = false
      this.pinch = 0
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId)
      if (t) { t.x = e.clientX; t.y = e.clientY }
      if (!this.enabled) return
      // two fingers: PINCH to zoom (apart = closer)
      if (this.touches.size === 2 && this.pinch > 0) {
        const d = this.spread()
        if (d > 0) { this.zoom(this.pinch / d); this.pinch = d }
        return
      }
      if (!this.drag) return
      this.orbit -= (e.clientX - this.lx) * 0.006
      this.pitch = GFX.MathUtils.clamp(this.pitch + (e.clientY - this.ly) * 0.004, -0.1, 1.2)
      this.lx = e.clientX; this.ly = e.clientY
      this.idle = 0
    })
    dom.addEventListener('wheel', (e) => { if (this.enabled) this.zoom(e.deltaY > 0 ? 1.12 : 0.89) }, { passive: true })
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoom(0.85)
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoom(1.18)
    })
  }

  /** Zoom: the distance × k (< 1 closer), 3.5–40 m; the camera eases there. */
  zoom(k: number): void {
    this.distTo = GFX.MathUtils.clamp(this.distTo * k, 3.5, 40)
  }

  /** Framed for another vehicle: its distance (m) and look height — eased there. */
  frame(dist: number, lookH: number): void {
    this.distTo = dist
    this.lookH = lookH
  }

  private spread(): number {
    const [a, b] = [...this.touches.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  snap(): void {
    if (this.car.sim) this.yaw = this.car.sim.heading
  }

  update(dt: number): void {
    if (!this.car.sim) return
    const h = this.car.sim.heading
    let d = h - this.yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    this.yaw += d * Math.min(1, dt * 3.2)
    if (!this.drag) {
      this.idle += dt
      if (this.idle > 1.5) this.orbit *= Math.max(0, 1 - dt * 1.8)
    }
    this.dist += (this.distTo - this.dist) * Math.min(1, dt * 8)
    const a = this.yaw + this.orbit
    const speed = Math.abs(this.car.sim.speed)
    const dist = this.dist * (1 + Math.min(speed, 30) / 90)
    const p = this.car.pos
    this.look.set(p.x, p.y + this.lookH, p.z)
    // (rock close behind — the car backed against a wall: the camera rises over the car instead of coming in to it)
    const pe = this.pitch + Math.max(0, 1.15 - this.pitch) * this.lift
    const ux = Math.sin(a) * Math.cos(pe), uy = Math.sin(pe), uz = Math.cos(a) * Math.cos(pe)
    let dd = dist
    if (this.obstruct) {
      // (from the car's own middle, not the look point 1.6 m up: pressed under an overhang, the look point is in the
      //  rock and the camera stayed in it — a grey screen)
      const oy = p.y + this.lookH * 0.56, hitLow = this.obstruct(p.x, oy, p.z, ux, uy, uz, dist + 0.6 + 0.7)
      // (and along the camera's OWN line, from the look point — 2026-11-07, the cave world: under a low roof the camera,
      //  0.44 × lookH over the low ray, went up into the rock and looked out through the hill)
      const hitTop = this.obstruct(p.x, p.y + this.lookH, p.z, ux, uy, uz, dist + 0.6 + 0.7)
      const hit0 = hitLow === null ? hitTop : hitTop === null ? hitLow : Math.min(hitLow, hitTop)
      const hit = hit0 === null ? null : Math.max(0, hit0 - 0.7)
      const free = hit === null ? 1e4 : Math.max(1.2, hit - 0.6) // (finite: Infinity − Infinity in the ease was NaN — a black screen)
      this.room = free < this.room ? free : this.room + (free - this.room) * Math.min(1, dt * 2.5)
      dd = Math.min(dist, this.room)
      const blocked = free < Math.min(dist, 4.5) ? 1 : 0
      this.lift += (blocked - this.lift) * Math.min(1, dt * (blocked ? 4 : 1.2))
    }
    const cx = p.x + ux * dd
    const cz = p.z + uz * dd
    let cy = p.y + this.lookH + uy * dd
    cy = Math.max(cy, this.map.height(cx, cz) + 0.75 * this.lookH)
    this.camera.position.set(cx, cy, cz)
    this.camera.lookAt(this.look)
    this.camera.updateMatrixWorld()
  }
}
