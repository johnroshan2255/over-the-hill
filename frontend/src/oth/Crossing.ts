import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import type { World, WorldId } from './World'

/**
 * THE CROSSING (2026-11-02, the user: "do the cliff and path, not a bridge — it will walk you through a fog, then
 * gradually the old world will disappear, we will entirely remove it … use workers and then load the other world").
 *
 * Each world has a GATE on its pass road (meta.gate: where, how high, `heading` = the way OUT of that world, 0 = −z),
 * at the top of a long climb: the valley's Great Cliff and its ledge road, the desert's escarpment and its pass. The
 * two gates face opposite ways, so going out of one is coming into the other on the same road: a pure translation.
 *
 * Per frame, from the car (and the camera):
 *   - the MIST (Atmosphere uMist): the cloud on the pass — it thickens as you climb toward the gate (`gate.mist`: the
 *     heights y0 → y1 it builds over, within r m of it) and is at its thickest (~10 m to see) at the gate itself;
 *   - the OTHER WORLD is built in the background (World.build: a step a frame, its files in the map worker, Draco in
 *     the loader's workers, shaders compiled ahead) once the car is within BUILD_AT of the gate — and let go (disposed
 *     whole) once it's farther than DROP_AT;
 *   - the SWAP: the car crosses the gate line outward (within 30 m of the gate, having come from inside) and the other
 *     world is ready → it's entered (everything that lasts pointed at it), the car, its dust and the free camera moved
 *     by the gates' offset — the same speed, the same road, in the cloud. The world left behind is kept (not drawn)
 *     until the car is DROP_AT away, so turning back in the mist is instant; then it's gone entirely.
 *   If the other world isn't ready yet, the car meets the box's wall 18 m on, in the cloud, until it is.
 */
const BUILD_AT = 1100
const DROP_AT = 1600

export class Crossing {
  /** The other world: built and waiting (not drawn), or none. */
  private spare: World | null = null
  private building = false
  /** Inside the gate line since the last swap (a swap needs the car to come from inside). */
  private armed = false
  /** The mist now (eased toward its target). */
  mist = 0
  /** After a swap (main.ts: the region's title). */
  onSwap?: (from: World, to: World) => void

  constructor(private readonly o: {
    world: () => World
    build: (id: WorldId) => Promise<World>
    /** Everything that lasts pointed at `next`; the world left stays built (it's not disposed here). */
    enter: (next: World) => void
    /** Move the car (and what goes with it) by (dx, dy, dz). */
    move: (dx: number, dy: number, dz: number) => void
    dispose: (w: World) => void
    atmos: Atmosphere
  }) {}

  /** The harness / dev stats. */
  get state(): string {
    return this.building ? 'building' : this.spare ? `ready (${this.spare.id})` : 'idle'
  }

  /** Let go of the spare world (a swap made some other way — the harness). */
  forget(): void {
    if (this.spare) this.o.dispose(this.spare)
    this.spare = null
  }

  /** car: where the car is (null until it's on the map). */
  update(dt: number, car: GFX.Vector3 | null, cam: GFX.Vector3): void {
    const w = this.o.world(), G = w.map.meta.gate
    const u = this.o.atmos.uniforms
    if (!G) {
      this.mist = Math.max(0, this.mist - dt)
      u.uMist.value = this.mist
      return
    }
    const other: WorldId = w.id === 'valley' ? 'desert' : 'valley'
    if (this.spare && this.spare.id !== other) this.forget()
    const dCar = car ? Math.hypot(car.x - G.x, car.z - G.z) : 1e9
    // the other world, built ahead / let go
    if (dCar < BUILD_AT && !this.spare && !this.building) {
      this.building = true
      this.o.build(other).then((nw) => {
        this.building = false
        const cur = this.o.world(), g = cur.map.meta.gate
        const far = !g || !car || Math.hypot(car.x - g.x, car.z - g.z) > DROP_AT
        if (nw.id === cur.id || far || this.spare) this.o.dispose(nw)
        else this.spare = nw
      }, (e) => { this.building = false; console.error('crossing: building', other, e) })
    }
    if (dCar > DROP_AT && this.spare) this.forget()
    // the MIST: thickening with the climb near the gate, thickest at it
    const S = GFX.MathUtils.smoothstep
    const m = G.mist ?? { y0: G.y - 150, y1: G.y - 10, r: 500 }
    const dCam = Math.hypot(cam.x - G.x, cam.z - G.z)
    const target = (1 - S(dCam, m.r, m.r + 300)) * S(cam.y, m.y0, m.y1) * (0.6 + 0.4 * (1 - S(dCam, 40, 300)))
    this.mist += (target - this.mist) * Math.min(1, dt * 1.2)
    u.uMist.value = this.mist < 0.002 ? 0 : this.mist
    // the SWAP: out over the gate line (heading: out = (−sin h, −cos h)), having come from inside on its road
    if (!car) return
    const ox = -Math.sin(G.heading), oz = -Math.cos(G.heading)
    const rx = car.x - G.x, rz = car.z - G.z
    const side = rx * ox + rz * oz, lateral = Math.abs(rx * oz - rz * ox)
    if (side < -8 && side > -300 && lateral < 30) this.armed = true
    const next = this.spare, D = next?.map.meta.gate
    if (!this.armed || side <= 0 || lateral > 30 || !next || !D) return
    // (the gates' offset; the height from the ground under the car in each world, so it lands on its wheels)
    const dx = D.x - G.x, dz = D.z - G.z
    const dy = next.map.height(car.x + dx, car.z + dz) - w.map.height(car.x, car.z)
    this.spare = w
    this.armed = false
    this.o.enter(next)
    this.o.move(dx, dy, dz)
    this.onSwap?.(w, next)
  }
}
