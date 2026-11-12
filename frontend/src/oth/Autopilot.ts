import type RAPIER from '@dimforge/rapier3d-compat'
import type { Controls } from '../gameplay/vehicle/VehicleSim'
import { group, Groups, PhysicsWorld } from '../physics/PhysicsWorld'
import type { Guide, Route } from './Nav'

/**
 * THE AUTOPILOT (2026-11-11, the user: "we can mark where to go in the map — when I go I need an option to turn on
 * autopilot and off, so it will safely go there"; then: "make sure it will go all the path, no hills or anything stop
 * it — like the way a human actual user drives it").
 *
 * It drives the GPS's own route (Nav.ts `Guide.route`: the tracks, the outland's roads, the off-road legs it priced) as
 * a careful driver would:
 *  - THE LINE: pure pursuit (the steering of the harness's road bot, scripts/harness/trackdrive.mjs) — a point down the
 *    route, nearer in a hairpin; the wheel wound on at a driver's pace, never more lock than the speed allows.
 *  - ROUND THINGS: a fan of nine rays ahead at bumper height (±50°, along the car's own facing: a slope is no wall; the
 *    ground is never hit — another group; a face that looks up — a ramp, a bridge's rise — isn't a wall) sees trunks,
 *    boulders, walls, props, other cars; where the line is blocked it steers for the clearest way nearest the line —
 *    round a tree, past a cabin — and slows to stop short of what it can't get round.
 *  - SPEED: 45 km/h on a straight road, 25 off it, 9 on a rock crawl; less into a bend (read 36 m ahead, and 66 m for
 *    the braking), down a steep grade, with the wheel well over, back onto the line, on a side-slope; it stops at the end.
 *  - HILLS: leaning on a side-slope (over ~17°) it creeps and turns its nose down the slope until the lean's gone, then
 *    takes the line again; climbing, it keeps on the throttle.
 *  - STUCK (wanting to go, < 1.5 m in 4 s): it backs off at a walking pace with the wheel over — the other side each
 *    time, so it comes at it from a new angle (a driver's zig-zag up a bank); what it can't get round (a wall right in
 *    front) is handed to the GPS to keep off, and the GPS plans a way round from where it is now.
 *  - ROLLED, or still stuck after six tries: what a player does — the RESET (R): the car set back on its wheels
 *    where it is, facing along the route — and on it goes. Only if that keeps happening with no ground gained (5
 *    resets inside 150 m) does it give the wheel back.
 *  - OFF: the player's own hands (W A S D, the arrows, Space, the touch pedals), arrived (it brakes to a stop), on foot
 *    or the bike.
 * Runs in the car's fixed step (Vehicle.fixed → `drive`), nothing allocated per step.
 */
const V_ROAD = 45 / 3.6
const V_OFF = 25 / 3.6
const V_ROUGH = 9 / 3.6
const DECEL = 2.6 // m/s² it plans its braking with (well under what the tyres hold)
/** the fan's angles (rad, + = the way a + error lies: Autopilot.drive's err) */
const FAN = [-0.87, -0.61, -0.35, -0.17, 0, 0.17, 0.35, 0.61, 0.87]

type Sim = { controls: Controls; speed: number; heading: number; body: RAPIER.RigidBody }

export class Autopilot {
  on = false
  /** Told what happened (main.ts: a toast). */
  onMessage?: (m: string) => void
  /** Set the car back on its wheels where it is, facing `heading` (main.ts: the game's reset). */
  resetCar?: (heading: number) => void
  /** What it's doing (the HUD's chip). */
  state: 'drive' | 'back' | 'stop' | 'round' | 'slope' = 'drive'
  /** The target speed this step (km/h). */
  target = 0
  /** (the harness: the last steps — x, z, v, steer, throttle, brake, target, the way's clearance, up, lean) */
  log: number[][] | null = null
  private wheel = 0
  private backT = 0
  private backSteer = 0
  private backLean = 0
  private side = 1
  private tries = 0
  private resets = 0
  private resetAt = 0
  private best = 0
  /** progress watch: where it was at the last look (every 4 s) */
  private watchT = 0
  private watchX = NaN
  /** (BEACHED: where it first stuck — a back-off that leaves it within 0.8 m of there moved nothing: the reset at once) */
  private stuckX = NaN
  private stuckZ = 0
  private watchZ = 0
  private rolledT = 0
  private lastRoute: Route | null = null
  private ray: RAPIER.Ray | null = null
  private readonly clear = new Float32Array(FAN.length)

  constructor(private readonly guide: Guide, private readonly pw: PhysicsWorld, private readonly height: (x: number, z: number) => number) {}

  /** Turn it on (it needs a route) or off. */
  toggle(): void { if (this.on) this.stop('Autopilot off'); else this.start() }

  start(): void {
    if (!this.guide.waypoint || !this.guide.route) { this.onMessage?.('Autopilot · set a destination on the map first (Tab)'); return }
    this.on = true
    this.state = 'drive'
    this.backT = this.tries = this.resets = this.wheel = this.watchT = this.rolledT = 0
    this.best = this.resetAt = this.guide.route.along
    this.watchX = NaN
    this.onMessage?.(`Autopilot on · to ${this.guide.waypoint.name}`)
  }

  stop(msg?: string): void {
    if (!this.on) return
    this.on = false
    if (msg) this.onMessage?.(msg)
  }

  /** The car's fixed step: set its controls (true), or leave them to the player (false). `manual`: the player's hands
   *  are on the controls this step; `up`: the car's roof's up (1 upright … −1 on its roof). */
  drive(dt: number, sim: Sim, manual: boolean, up: number): boolean {
    if (!this.on) return false
    if (manual) { this.stop('Autopilot off · you have the wheel'); return false }
    const c = sim.controls, t = sim.body.translation(), v = Math.abs(sim.speed)
    c.boost = false; c.footBrake = 0; c.lift = 0; c.parked = false; c.handbrake = false
    const r = this.guide.route
    // arrived (the guide let the route go) — or none: brake to a stop, then hand back
    if (!r) {
      this.state = 'stop'; this.target = 0
      c.throttle = 0; c.steer = 0; c.brake = true
      if (v < 0.4) { c.handbrake = true; this.stop('Autopilot · arrived') }
      return true
    }
    r.track(t.x, t.z)
    const along = r.along
    // (a new route — re-planned round something, or after a crossing: its own progress)
    if (r !== this.lastRoute) { this.lastRoute = r; this.best = this.resetAt = along }

    // ROLLED (on its side or roof for a second): the reset, facing along the route
    this.rolledT = up < 0.35 ? this.rolledT + dt : 0
    if (this.rolledT > 1) { this.rolledT = 0; this.reset(r); c.throttle = 0; c.brake = true; c.steer = 0; return true }

    // THE LEAN (+: the right side up)
    const q = sim.body.rotation()
    const lean = 2 * (q.x * q.y + q.w * q.z)

    // BACKING OFF (stuck, a three-point turn): at a walking pace, the wheel over — never further into a growing lean
    if (this.backT > 0) {
      this.backT -= dt
      if (this.backLean < 0) this.backLean = Math.abs(lean)
      if (Math.abs(lean) > Math.max(0.45, this.backLean + 0.08)) this.backT = 0
      this.state = 'back'; this.target = 0
      c.steer = this.backSteer
      const vs = sim.speed // (signed: − backing)
      if (vs > 0.3) { c.throttle = -0.6; c.brake = true }         // (still rolling forward: stop first)
      else if (vs > -1.4) { c.throttle = -0.5; c.brake = true }   // (reverse gently)
      else { c.throttle = 0; c.brake = false }                    // (fast enough backwards: let it roll)
      if (this.backT <= 0) { c.throttle = 0; c.brake = true; this.wheel = 0; this.watchX = NaN }
      return true
    }

    // ---- where the line goes
    const tight = Math.max(turnOver(r, along, along + 8, along + 16), turnOver(r, along + 4, along + 12, along + 20))
    const bend = turnOver(r, along, along + 18, along + 36)
    const far = turnOver(r, along + 30, along + 48, along + 66)
    const look = tight > 0.9 ? 4 : 5.5 + 0.5 * v
    pointAt(r, along + look + Math.min(10, r.lateral * 0.5), P)
    let err = Math.atan2(-(P[0] - t.x), -(P[1] - t.z)) - sim.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))

    // A THREE-POINT TURN: the way on is behind it (> 110° off) and it's slow — back up with the wheel the other way
    // (the nose swings round the same way), then forward again — not a full-lock circle up the hillside
    if (Math.abs(err) > 1.9 && v < 3 && Math.abs(lean) < 0.3 && r.lateral < 25) {
      this.beginBack(Math.sign(err), 2.6)
      c.throttle = 0; c.brake = true; c.steer = 0
      return true
    }

    // ---- what's ahead: the fan — rays along the car's own facing (its pitch kept), each turned by its angle
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fy = -(2 * (q.y * q.z - q.w * q.x)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
    const fh = Math.max(1e-3, Math.hypot(fx, fz)), Hd = sim.heading
    const reach = 6 + (v * v) / (2 * DECEL) + v * 0.8
    const ox = t.x + (fx / fh) * 2.2, oy = t.y + 0.7 + fy * 2.2, oz = t.z + (fz / fh) * 2.2
    for (let k = 0; k < FAN.length; k++) {
      // (heading h faces (−sin h, −cos h); an error a lies at heading h + a)
      const a = Hd + FAN[k]
      this.clear[k] = Math.min(reach, this.cast(ox, oy, oz, -Math.sin(a) * fh, fy, -Math.cos(a) * fh, reach, sim.body))
    }
    // the line's own way, and — if that's blocked — the clearest way nearest it
    const aim = Math.max(FAN[0], Math.min(FAN[FAN.length - 1], err))
    const direct = this.clearAt(aim)
    let go = err, room = direct
    this.state = 'drive'
    if (direct < reach - 0.5) {
      let bestS = -1e9, bk = 4
      for (let k = 0; k < FAN.length; k++) {
        const sc = (this.clear[k] / reach) * 2 - Math.abs(FAN[k] - aim) / 1.1
        if (sc > bestS) { bestS = sc; bk = k }
      }
      if (this.clear[bk] > direct + 1) { go = FAN[bk]; room = this.clear[bk]; this.state = 'round' }
    }

    // ---- the wheel, as a careful driver turns it
    const tilt = Math.max(0, Math.min(1, (Math.abs(lean) - 0.3) / 0.15))
    let want = Math.max(-1, Math.min(1, -go * 2.2))
    // (on a side-slope: the nose turned DOWN it — the low side — until the lean's gone)
    if (tilt > 0) { want = want * (1 - tilt) - Math.sign(lean) * tilt * 0.8; this.state = 'slope' }
    const lock = Math.max(0.25, Math.min(1, 1.2 - v / 14))
    const goal = Math.max(-lock, Math.min(lock, want)), rate = dt / 0.4
    this.wheel += Math.max(-rate, Math.min(rate, goal - this.wheel))
    const steer = this.wheel

    // ---- how fast
    const s = Math.min(r.seg, r.pts.length / 2 - 2)
    let target = r.rough[s] || r.roughAhead(25) ? V_ROUGH : r.off[s] ? V_OFF : V_ROAD
    if (tight > 0.9) target = Math.min(target, 9 / 3.6)
    else if (bend > 0.6) target = Math.min(target, 16 / 3.6)
    else if (bend > 0.3) target = Math.min(target, 25 / 3.6)
    else if (bend > 0.15) target = Math.min(target, 36 / 3.6)
    if (far > 0.6) target = Math.min(target, 28 / 3.6)
    if (Math.abs(steer) > 0.6) target = Math.min(target, 12 / 3.6)
    if (Math.abs(want) > lock * 0.95) target = Math.min(target, Math.max(8 / 3.6, v - 1.5))
    if (r.lateral > 6) target = Math.min(target, 10 / 3.6)
    else if (r.lateral > 3) target = Math.min(target, 18 / 3.6)
    if (tilt > 0) target = Math.min(target, 6 / 3.6)
    pointAt(r, along + 20, P)
    const down = (this.height(t.x, t.z) - this.height(P[0], P[1])) / 20
    if (down > 0.2) target = Math.min(target, 15 / 3.6)
    else if (down > 0.12) target = Math.min(target, 22 / 3.6)
    // (the end: down to a crawl by ~14 m out — the GPS calls it arrived inside 12 m, and it stops there; at 39 km/h it
    //  had run 15 m past the Stag Ridge Lookout)
    if (!this.guide.viaGate) target = Math.min(target, Math.max(2.5, Math.sqrt(2 * DECEL * Math.max(0, r.remaining - 14))))
    // (what it can't get round: stop short of it — a crawl while there's room, so it noses round)
    if (room < reach) target = Math.min(target, Math.max(room > 4 ? 4 / 3.6 : 0, Math.sqrt(2 * DECEL * Math.max(0, room - 3))))
    this.target = target * 3.6

    // ---- STUCK: wanting to go, < 1.5 m in 4 s — back off, the other side each time; every third, another way;
    //      the fifth: the reset
    if (along > this.best + 30) { this.best = along; this.tries = 0 }
    if (along > this.resetAt + 150) { this.resetAt = along; this.resets = 0 }
    if (Number.isNaN(this.watchX)) { this.watchX = t.x; this.watchZ = t.z; this.watchT = 0 }
    this.watchT += dt
    if (this.watchT > 4) {
      const moved = Math.hypot(t.x - this.watchX, t.z - this.watchZ)
      this.watchX = t.x; this.watchZ = t.z; this.watchT = 0
      if (moved < 1.5) {
        this.tries++
        // BEACHED (2026-11-12 — up on a boulder on a 40° face, its wheels in the air: six back-offs, 38 s, before the
        // reset): stuck again within 0.8 m of where it first stuck — the back-off moved nothing, nor will the next
        // five. The reset now (~11 s in, not 38).
        const beached = this.tries >= 2 && Math.hypot(t.x - this.stuckX, t.z - this.stuckZ) < 0.8
        if (this.tries === 1 || !beached) { this.stuckX = t.x; this.stuckZ = t.z }
        if (this.tries >= 6 || beached) { this.tries = 0; this.stuckX = NaN; this.reset(r); c.throttle = 0; c.brake = true; c.steer = 0; return true }
        // (something it can't get round right in front — a wall, a stack of rock: the GPS told to keep off it from now
        //  on, and a way round planned from here; else, every third time, another way anyway)
        if (room < 5) this.guide.replan({ x: t.x + (fx / fh) * (room + 4), z: t.z + (fz / fh) * (room + 4), r: 5 })
        else if (this.tries % 3 === 0) this.guide.replan()
        this.side = -this.side
        this.beginBack(Math.abs(steer) > 0.2 ? Math.sign(steer) : this.side, 2.6)
        c.throttle = 0; c.brake = true; c.steer = 0
        return true
      }
    }

    c.steer = steer
    const over = v - target
    if (target < 0.3 && v < 0.8) { c.throttle = 0; c.brake = true; c.handbrake = true }
    else {
      c.throttle = over < 0 ? Math.min(1, -over * 0.5 + 0.35) : over > 0.8 ? -Math.min(1, over * 0.6) : 0
      c.brake = over > 0.8
      // (no hard brake with the wheel over at speed — a brake tap while steering is the arcade handling's DRIFT: it
      //  lifts off instead; the bends are read early enough for that)
      if (c.brake && v > 9 && Math.abs(steer) > 0.25 && room > 12) { c.brake = false; c.throttle = 0 }
    }
    if (this.log) { this.log.push([t.x, t.z, v, steer, c.throttle, +!!c.brake, target, room, up, lean]); if (this.log.length > 900) this.log.shift() }
    return true
  }

  /** Back off for `secs`, the wheel at `steer` (reversing with the wheel toward a thing swings the nose away from it). */
  private beginBack(steer: number, secs: number): void {
    this.backT = secs
    this.backSteer = steer
    this.backLean = -1
    this.wheel = 0
  }

  /** THE RESET (R): back on its wheels where it is, facing along the route — or, five resets with no ground gained,
   *  the wheel given back. */
  private reset(r: Route): void {
    if (++this.resets > 5) { this.stop('Autopilot off · it can\'t get through here — take the wheel'); return }
    pointAt(r, r.along, Q)
    pointAt(r, r.along + 8, P)
    this.resetCar?.(Math.atan2(-(P[0] - Q[0]), -(P[1] - Q[1])))
    this.backT = 0; this.wheel = 0; this.watchX = NaN
    this.onMessage?.('Autopilot · reset the car')
  }

  /** The fan's clearance toward angle a (rad): the nearer of the two rays round it. */
  private clearAt(a: number): number {
    let k = 0
    while (k < FAN.length - 2 && FAN[k + 1] < a) k++
    return Math.min(this.clear[k], this.clear[k + 1])
  }

  /** Metres to the first thing that faces the car along (dx, dy, dz) from (x, y, z), within `max` — Infinity if none. */
  private cast(x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number, self: RAPIER.RigidBody): number {
    const ray = (this.ray ??= new (PhysicsWorld.rapier as typeof RAPIER).Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }))
    ray.origin.x = x; ray.origin.y = y; ray.origin.z = z
    ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz
    const hit = this.pw.world.castRayAndGetNormal(ray, max, true, undefined, group(0xffff, Groups.Static | Groups.Vehicle), undefined, self)
    if (!hit) return Infinity
    // (a slope's face, a ramp, a bridge's rise: its normal points up — not a wall)
    if (hit.normal.y > 0.55) return Infinity
    return hit.timeOfImpact
  }
}

const P: [number, number] = [0, 0]
const Q: [number, number] = [0, 0]

/** The point `d` m along the route (clamped to its ends) into `out`. */
function pointAt(r: Route, d: number, out: [number, number]): void {
  const cum = r.cum, n = cum.length
  if (d <= 0) { out[0] = r.pts[0]; out[1] = r.pts[1]; return }
  if (d >= cum[n - 1]) { out[0] = r.pts[2 * n - 2]; out[1] = r.pts[2 * n - 1]; return }
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m }
  const L = cum[hi] - cum[lo], f = L > 0 ? (d - cum[lo]) / L : 0
  out[0] = r.pts[2 * lo] + (r.pts[2 * hi] - r.pts[2 * lo]) * f
  out[1] = r.pts[2 * lo + 1] + (r.pts[2 * hi + 1] - r.pts[2 * lo + 1]) * f
}

const A: [number, number] = [0, 0], M: [number, number] = [0, 0], E: [number, number] = [0, 0]
/** How much the route turns (rad, 0 … π) from a to m to e (metres along it). */
function turnOver(r: Route, a: number, m: number, e: number): number {
  pointAt(r, a, A); pointAt(r, m, M); pointAt(r, e, E)
  const h1 = Math.atan2(M[0] - A[0], M[1] - A[1]), h2 = Math.atan2(E[0] - M[0], E[1] - M[1])
  return Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)))
}
