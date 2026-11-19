import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { Character, type FightClip } from './Character'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import type { Target, Zone } from './Weapons'
import { RemoteCar } from './Vehicle'
import { group, Groups } from '../physics/PhysicsWorld'
import type RAPIER from '@dimforge/rapier3d-compat'

/**
 * THE COMPANION (2026-11-19, the user: "a companion in no-coop mode … a human body, cars, all like us … when I walk he
 * walks with me, about a 100 m range; when I drive he follows me around; and I can take him in my car — the same way a
 * co-op player does"): an NPC run here, in solo play only — no server. He is drawn and moved with the co-op player's
 * own pieces (Remotes.ts): the same walker (Character.ts — through the physics, steered by `steer` instead of the
 * keys), the same posed car (RemoteCar, solid in our physics), the same name tag, on the map and the radar.
 *
 *   ON FOOT     he keeps a spot beside you, on your right: walks, runs or sprints by how far he is; more than
 *               100 m off (or stuck 2.5 s) he catches up behind you.
 *   YOUR CAR    you get in with him within 15 m: he walks to the PASSENGER door and sits beside you (the seated clip,
 *               his hands on his knees). You get out: he gets out on his side.
 *   HIS CAR     you drive off without him (or ride the bike): he gets into his own car (the model you drive, in his
 *               colour — beside him, brought if it's far) and FOLLOWS ALONG YOUR WAY (the road you drove, replayed
 *               a gap behind, the gap growing with the speed; his car's tilt from the ground under its wheels). You
 *               stop and get out: he pulls up behind and gets out.
 *   H           call him: on foot he comes to you; stopped in the car with his close behind, he leaves his and gets in
 *               with you.
 *
 * Costs what one co-op player does: the walker one draw (skinned), the car three + its shadow.
 */
export interface CompanionHost {
  /** You: on foot, on the bike, else in the car. */
  onFoot(): boolean
  riding(): boolean
  /** Play (false: the free camera — he waits). */
  playing(): boolean
  /** Where you are (feet / the vehicle), your heading (rad, 0 = facing −z), your ground speed (m/s). */
  pos(): GFX.Vector3
  heading(): number
  speed(): number
  /** Your car (its model id — his is the same — its root). */
  car(): { id: string; root: GFX.Object3D } | null
  /** Your car's passenger seat (car space: the hips; world: the spot outside its door); null on the bike. */
  passenger(): { root: GFX.Object3D; hips: GFX.Vector3; door: GFX.Vector3; key: string; heading: number } | null
  toast(m: string): void
  /** Your own walker (the fight: your blows, your falls). */
  you(): Character
  /** Your vehicle's half width / half length (m). */
  size(): { x: number; z: number }
  /** Your vehicle SHOVED (his car rams it): along (dx, dz) by `dv` m/s, spun by `spin` rad/s. */
  shove(dx: number, dz: number, dv: number, spin: number): void
}

type Mode = 'foot' | 'boarding' | 'passenger' | 'toCar' | 'car'

/** A FRIEND who walks and rides with you, or an ENEMY who comes after you (the setting — SETTINGS › PLAY). */
export type CompanionKind = 'friend' | 'enemy'
const LOOK: Record<CompanionKind, { name: string; colour: string; paint: string; jacket: string }> = {
  friend: { name: 'Companion', colour: '#e0a040', paint: '#3d5a73', jacket: '#3a5878' },
  enemy: { name: 'Enemy', colour: '#e0483a', paint: '#232326', jacket: '#7c211b' },
}
/** THE FIGHT: how close he stands to strike (m), what each blow takes (of 100). */
const REACH = 1.05
const DMG: Record<string, number> = { jab: 8, cross: 14, hook: 14, uppercut: 18, kick_front: 16, kick_round: 24 }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const RANGE = 100
const TAG_FAR = 900

export class Companion {
  readonly hero: Character
  readonly car: RemoteCar
  mode: Mode = 'foot'
  kind: CompanionKind = 'friend'
  private ready = false
  private get look() { return LOOK[this.kind] }
  private get name(): string { return this.look.name }
  // THE FIGHT (the enemy): his strength and yours (0 … 100: at 0, down), the blows in the air, his next one
  hp = 100
  yours = 100
  private fightReady = false
  private fightLoading = false
  private readonly blows: { by: 'him' | 'you'; t: number; clip: FightClip }[] = []
  private cool = 1
  private grace = 0
  private sinceHit = 9
  private punches = 0
  private kicks = 0
  private ramCool = 0
  private ranDown = false
  private downT = 0
  private readonly nameEl: HTMLSpanElement
  private readonly bar: HTMLDivElement
  private readonly barFill: HTMLDivElement
  private readonly layer: HTMLDivElement
  private readonly tag: HTMLDivElement
  private readonly dist: HTMLElement
  private placed = false
  // on foot
  private moving = false
  private stuckT = 0
  /** How fast he really goes (m/s, smoothed — the controller's own speed is what he wants, not what he gets). */
  private real = 0
  private readonly lastMe = new GFX.Vector3(NaN, 0, 0)
  private boardT = 0
  private seatKey = ''
  // his car: where it stands / goes, its body
  private carOn = false
  private readonly carP = new GFX.Vector3()
  private carYaw = 0
  private carSpeed = 0
  private readonly carQ = new GFX.Quaternion()
  private solid: { body: RAPIER.RigidBody; key: string } | null = null
  /** YOUR WAY (while you're on wheels): points 1 m apart (x, z), their distance along it. */
  private xs: number[] = []
  private zs: number[] = []
  private ss: number[] = []
  private arc = 0
  private joinK = 1
  private readonly joinFrom = new GFX.Vector3()
  private joinYaw = 0
  /** Your car's root over the ground under it (m) — his rides as high. */
  private rideH = 0
  private readonly lastYou = new GFX.Vector3(NaN, 0, 0)
  private readonly v = new GFX.Vector3()
  private readonly e = new GFX.Euler()
  // (nothing made each frame — a phone's collector stalls on it: the steer, the spots, the car's working vectors)
  private readonly st = { x: 0, z: 0, pace: 0 }
  private readonly spot = { x: 0, z: 0 }
  private readonly qt = new GFX.Quaternion()
  private readonly va = new GFX.Vector3()
  private readonly vb = new GFX.Vector3()
  private readonly vp = new GFX.Vector3()
  /** His skeleton posed by how far he is (as the co-op players': every frame near, every 2nd beyond 30 m, every 4th
   *  beyond 80 m, never out of view) — from the last cull. */
  private camDist = 0
  private inView = true
  private animDt = 0
  private animN = 0
  private go(x: number, z: number, pace: number): void { const s = this.st; s.x = x; s.z = z; s.pace = pace; this.hero.steer = s }

  constructor(
    private readonly host: CompanionHost,
    scene: GFX.Scene,
    private readonly map: MapData,
    private readonly physics: OthPhysics,
    atmos: Atmosphere,
    shadow: TerrainShadow,
    farGrid: GFX.Vector4,
    charUrl: string,
    private readonly fightUrl: string,
    kind: CompanionKind,
  ) {
    this.hero = new Character(map, physics, atmos, shadow, farGrid)
    this.hero.leads = false
    this.hero.control = false
    this.hero.ground = (x, z, y0) => physics.surface(x, z, map.height(x, z), y0)
    this.car = new RemoteCar(map, atmos, shadow, farGrid)
    scene.add(this.car.root, this.car.shadow)
    this.layer = document.createElement('div')
    this.layer.className = 'oth-tags'
    document.body.appendChild(this.layer)
    this.tag = document.createElement('div')
    this.tag.className = 'oth-tag'
    this.nameEl = document.createElement('span')
    this.dist = document.createElement('small')
    this.tag.append(this.nameEl, this.dist)
    this.layer.appendChild(this.tag)
    // (YOUR strength, shown while you fight: a square bar over the hints)
    this.bar = document.createElement('div')
    this.bar.style.cssText = 'position:fixed;left:24px;bottom:72px;width:200px;height:10px;background:rgba(8,8,8,0.72);border:1px solid rgba(255,255,255,0.18);z-index:4;display:none;pointer-events:none'
    this.barFill = document.createElement('div')
    this.barFill.style.cssText = 'height:100%;width:100%;background:#e0a040'
    this.bar.appendChild(this.barFill)
    document.body.appendChild(this.bar)
    this.kind = kind
    void this.hero.load(charUrl).then(() => { scene.add(this.hero.root, this.hero.shadowMesh); this.ready = true; this.setKind(this.kind) })
  }

  /** Where he is (the map, the radar). */
  get list(): { x: number; z: number; heading: number; colour: string; name: string }[] {
    if (!this.placed) return []
    const p = this.where()
    return [{ x: p.x, z: p.z, heading: this.mode === 'car' ? this.carYaw : this.hero.heading, colour: this.look.colour, name: this.name }]
  }
  private where(): GFX.Vector3 {
    if (this.mode === 'car') return this.carP
    if (this.mode === 'passenger') return this.host.pos()
    return this.hero.pos
  }

  private ground(x: number, z: number, from?: number): number {
    return this.physics.surface(x, z, this.map.height(x, z), from)
  }
  /** The ground under HIS CAR: the terrain, or the first solid thing under `from` (a bridge's deck, a slab) — never
   *  his car's own box (Physics.surface's ray met it: the car climbed onto itself, up into the sky). */
  private ray: RAPIER.Ray | null = null
  private groundCar(x: number, z: number, from: number): number {
    const s = this.map.height(x, z)
    if (from <= s) return s
    const pw = this.physics.pw, r = (this.ray ??= new pw.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }))
    r.origin.x = x; r.origin.y = from; r.origin.z = z
    const hit = pw.world.castRay(r, from - s + 0.5, false, undefined, group(0xffff, Groups.Static), undefined, this.solid?.body)
    return hit ? Math.max(s, from - hit.timeOfImpact) : s
  }

  /** A spot behind you (back m, side m: + to your right). */
  private behind(back: number, side: number): { x: number; z: number } {
    const p = this.host.pos(), h = this.host.heading()
    // (forward is (−sin h, −cos h); right is (cos h, −sin h))
    const s = this.spot
    s.x = p.x + Math.sin(h) * back + Math.cos(h) * side; s.z = p.z + Math.cos(h) * back - Math.sin(h) * side
    return s
  }

  /** On foot at (x, z) — beside you when no place is given. */
  private standAt(x?: number, z?: number, heading?: number): void {
    const p = this.host.pos()
    const at = x === undefined || z === undefined ? (this.host.onFoot() ? this.behind(3, 1.6) : this.behind(6, 3)) : { x, z }
    this.go(0, 0, 0)
    this.hero.appear(at.x, at.z, heading ?? this.host.heading(), undefined, p.y + 2)
    this.hero.control = false   // (appear frees him to the keys: never his)
    this.moving = false
    this.stuckT = 0
    this.real = 1
    this.lastMe.copy(this.hero.pos)
    this.placed = true
  }

  /** H: come here / get in with me. */
  call(): void {
    if (!this.ready) return
    const H = this.host
    if (this.kind === 'enemy') { H.toast('He is not here to help'); return }
    if (H.onFoot()) {
      if (this.mode === 'car') this.leaveCar()
      if (this.mode === 'foot' && this.hero.pos.distanceTo(H.pos()) > 30) this.standAt()
      H.toast(`${this.name}: coming`)
      return
    }
    const seat = H.passenger()
    if (!seat) { H.toast(`${this.name}: no seat on the bike`); return }
    if (this.mode === 'passenger') return
    if (H.speed() > 1.5) { H.toast(`Stop for ${this.name} to get in`); return }
    if (this.mode === 'car') {
      if (this.carP.distanceTo(H.pos()) > 45) { H.toast(`${this.name} is too far behind`); return }
      this.leaveCar()
    } else if (this.hero.pos.distanceTo(seat.door) > 45) this.standAt()
    this.board()
  }

  /** Brought to you (the start, a jump): beside you on foot, in your passenger seat in the car, by you on the bike. */
  private join(): void {
    const H = this.host, seat = H.onFoot() ? null : H.passenger()
    // (the enemy: never beside you — he turns up 30 m behind and comes for you)
    if (this.kind === 'enemy') {
      const at = this.behind(30, 8)
      this.standAt(at.x, at.z)
      this.mode = H.onFoot() ? 'foot' : 'toCar'
      this.grace = 2
      return
    }
    if (seat) { this.standAt(seat.door.x, seat.door.z, seat.heading); this.sitWithYou(); return }
    this.standAt()
    this.mode = H.onFoot() ? 'foot' : 'toCar'
  }

  private board(): void {
    this.mode = 'boarding'
    this.boardT = 0
  }

  /** Into your passenger seat. */
  private sitWithYou(): void {
    const seat = this.host.passenger()
    if (!seat) { this.mode = 'foot'; return }
    this.hero.steer = null
    // (his hands on his knees: car space, either side in front of his hips)
    const hips = seat.hips, knees: [GFX.Vector3, GFX.Vector3] = [new GFX.Vector3(hips.x - 0.17, hips.y + 0.1, hips.z - 0.36), new GFX.Vector3(hips.x + 0.17, hips.y + 0.1, hips.z - 0.36)]
    this.hero.sitIn(seat.root, hips, () => knees)
    this.seatKey = seat.key
    this.mode = 'passenger'
  }

  /** Out of your car on his side. */
  private outOfYours(): void {
    const seat = this.host.passenger()
    if (seat) this.standAt(seat.door.x, seat.door.z, seat.heading)
    else this.standAt()
    this.mode = 'foot'
  }

  /** Out of his car by its door (it stays parked). */
  private leaveCar(): void {
    const s = this.car.driverSeat
    if (s) {
      this.v.copy(s.door).applyQuaternion(this.carQ).add(this.carP)
      this.standAt(this.v.x, this.v.z, this.carYaw)
    } else this.standAt(this.carP.x - Math.cos(this.carYaw) * 2, this.carP.z + Math.sin(this.carYaw) * 2, this.carYaw)
    this.carSpeed = 0
    this.mode = 'foot'
  }

  /** His car brought beside him, facing you (it's far, or there's none yet). */
  private bringCar(): void {
    const c = this.host.car()
    void this.car.setCar(c?.id || 'offroader', this.look.paint)
    const p = this.hero.pos, you = this.host.pos()
    const yaw = Math.atan2(-(you.x - p.x), -(you.z - p.z))
    // (3.5 m to his right, facing the way he faces: its driver's door — its left — toward him)
    const x = p.x + Math.cos(yaw) * 3.5, z = p.z - Math.sin(yaw) * 3.5
    this.carP.set(x, this.groundCar(x, z, p.y + 3) + this.rideH, z)
    this.carYaw = yaw
    this.tilt(0)
    this.carOn = true
  }

  /** His car's turn: its heading, and its tilt from the ground under its wheels; its place on the ground (+ dt eased). */
  private tilt(dt: number): void {
    const h = this.car.half, yaw = this.carYaw, cs = Math.cos(yaw), sn = Math.sin(yaw), P = this.carP
    const at = (mx: number, mz: number) => { const x = P.x + mx * cs + mz * sn, z = P.z - mx * sn + mz * cs; return this.groundCar(x, z, P.y + 2) }
    const f = at(0, -h.z * 0.7), b = at(0, h.z * 0.7), r = at(h.x * 0.8, 0), l = at(-h.x * 0.8, 0)
    const y = (f + b + r + l) / 4 + this.rideH
    P.y = dt > 0 ? P.y + (y - P.y) * Math.min(1, dt * 12) : y
    this.e.set(Math.atan2(f - b, h.z * 1.4), yaw, Math.atan2(r - l, h.x * 1.6), 'YXZ')
    const q = this.qt.setFromEuler(this.e)
    if (dt > 0) this.carQ.slerp(q, Math.min(1, dt * 10)); else this.carQ.copy(q)
  }

  /** YOUR WAY: a point a metre on (a jump of more than 150 m — a reset, a rest at camp — starts it again). */
  private record(): void {
    const p = this.host.pos(), n = this.xs.length
    if (n) {
      const d = Math.hypot(p.x - this.xs[n - 1], p.z - this.zs[n - 1])
      if (d < 1) return
      if (d > 150) { this.xs = []; this.zs = []; this.ss = []; this.arc = 0; return this.record() }
      this.xs.push(p.x); this.zs.push(p.z); this.ss.push(this.ss[n - 1] + d)
    } else { this.xs.push(p.x); this.zs.push(p.z); this.ss.push(0) }
    // (only the last 3 km kept — and nothing far behind him)
    let cut = 0
    while (cut < this.ss.length - 2 && (this.ss.length - cut > 3000 || this.ss[cut + 1] < this.arc - 20)) cut++
    if (cut > 64) { this.xs.splice(0, cut); this.zs.splice(0, cut); this.ss.splice(0, cut) }
  }
  /** The point of your way s metres along it. */
  private along(s: number, out: GFX.Vector3): GFX.Vector3 {
    const S = this.ss, n = S.length
    if (!n) return out.copy(this.host.pos())
    if (s <= S[0]) return out.set(this.xs[0], 0, this.zs[0])
    if (s >= S[n - 1]) return out.set(this.xs[n - 1], 0, this.zs[n - 1])
    let lo = 0, hi = n - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m }
    const k = (s - S[lo]) / Math.max(1e-6, S[hi] - S[lo])
    return out.set(this.xs[lo] + (this.xs[hi] - this.xs[lo]) * k, 0, this.zs[lo] + (this.zs[hi] - this.zs[lo]) * k)
  }

  /** Into his car (he's at its door): onto your way at its nearest point. */
  private intoCar(): void {
    this.hero.steer = null
    this.hero.hide()
    this.mode = 'car'
    this.carSpeed = 0
    let best = Infinity, bi = 0
    for (let i = 0; i < this.xs.length; i++) { const d = Math.hypot(this.xs[i] - this.carP.x, this.zs[i] - this.carP.z); if (d < best) { best = d; bi = i } }
    this.arc = this.ss.length ? this.ss[bi] : 0
    this.joinFrom.copy(this.carP)
    this.joinYaw = this.carYaw
    this.joinK = 0
    this.ranDown = false
    this.downT = 0
  }

  /** Each frame, before the physics step: what he does, where he steers. */
  update(dt: number): void {
    if (!this.ready) return
    const H = this.host
    if (!this.placed) this.join()
    if (!H.playing()) { if (this.hero.steer) this.hero.steer.pace = 0; return }
    const you = H.pos()
    {
      const me = this.hero.pos, moved = Number.isNaN(this.lastMe.x) ? 0 : Math.hypot(me.x - this.lastMe.x, me.z - this.lastMe.z)
      this.real += (Math.min(20, moved / Math.max(dt, 1e-3)) - this.real) * Math.min(1, dt * 4)
      this.lastMe.copy(me)
    }
    // (you jumped far — a reset, a rest at camp, the crossing: he comes along)
    if (!Number.isNaN(this.lastYou.x) && this.lastYou.distanceTo(you) > 150 && this.mode !== 'passenger') {
      if (this.mode === 'car') this.carOn = false
      this.join()
    }
    this.lastYou.copy(you)
    const onWheels = !H.onFoot(), hostile = this.kind === 'enemy'
    if (onWheels) { this.record(); this.ranDown = false; this.downT = 0 }
    if (hostile) {
      this.blowsStep(dt)
      // (five seconds without a blow: both get their breath back)
      if ((this.sinceHit += dt) > 5) {
        if (!this.hero.isDown) this.hp = Math.min(100, this.hp + 6 * dt)
        if (!H.you().isDown) this.yours = Math.min(100, this.yours + 6 * dt)
      }
      if (onWheels || this.mode !== 'foot') { this.hero.stance = null; H.you().stance = null }
    }
    const c = H.car()
    if (onWheels && !H.riding() && c) {
      const g = this.ground(c.root.position.x, c.root.position.z, c.root.position.y + 2)
      this.rideH += (Math.max(0, Math.min(1.5, c.root.position.y - g)) - this.rideH) * Math.min(1, dt * 2)
    }
    switch (this.mode) {
      case 'foot': {
        if (onWheels) {
          const seat = H.passenger()
          // (down: he gets up first)
          if (this.hero.isDown) break
          if (!hostile && seat && H.speed() < 2 && this.hero.pos.distanceTo(seat.door) < 15) this.board()
          else this.mode = 'toCar'
          break
        }
        if (hostile) this.fight(dt); else this.follow(dt)
        break
      }
      case 'boarding': {
        const seat = H.passenger()
        if (H.onFoot()) { this.mode = 'foot'; break }
        if (!seat || H.speed() > 2.5) { this.mode = 'toCar'; break }
        this.boardT += dt
        const d = Math.hypot(seat.door.x - this.hero.pos.x, seat.door.z - this.hero.pos.z)
        if (d < 0.9 || this.boardT > 14) { this.sitWithYou(); break }
        this.steerTo(seat.door.x, seat.door.z, d > 3 ? 4.6 : 1.7, dt)
        break
      }
      case 'passenger': {
        if (H.onFoot()) { this.outOfYours(); break }
        const seat = H.passenger()
        if (!seat) { this.outOfYours(); this.mode = 'toCar'; break }
        // (your car swapped in the garage: sat again in the new one)
        if (seat.key !== this.seatKey) this.sitWithYou()
        break
      }
      case 'toCar': {
        if (H.onFoot()) { this.mode = 'foot'; break }
        const seat = H.car() && !H.riding() ? H.passenger() : null
        if (!hostile && seat && H.speed() < 1 && this.hero.pos.distanceTo(seat.door) < 12) { this.board(); break }
        if (!this.carOn || this.carP.distanceTo(this.hero.pos) > 30) this.bringCar()
        const s = this.car.driverSeat
        if (!s) break
        this.v.copy(s.door).applyQuaternion(this.carQ).add(this.carP)
        const d = Math.hypot(this.v.x - this.hero.pos.x, this.v.z - this.hero.pos.z)
        if (d < 0.9) { this.intoCar(); break }
        this.steerTo(this.v.x, this.v.z, d > 3 ? 4.6 : 1.7, dt)
        break
      }
      case 'car': {
        this.drive(dt)
        // (you got out and he's pulled up: he gets out)
        if (H.onFoot() && this.carSpeed < 0.5 && this.joinK >= 1) this.leaveCar()
        break
      }
    }
    this.poseCar(dt)
  }

  /** On foot beside you: his spot on your right, walked to at the pace the gap asks. */
  private follow(dt: number): void {
    const H = this.host, you = H.pos(), me = this.hero.pos
    const dYou = Math.hypot(you.x - me.x, you.z - me.z)
    if (dYou > RANGE || Math.abs(you.y - me.y) > 25) { this.standAt(); return }
    // (beside you on your right, half a step back — in the chase camera's view, as a friend walks)
    const spot = this.behind(0.8, 1.9)
    const d = Math.hypot(spot.x - me.x, spot.z - me.z)
    // (hysteresis: off when he's 2.5 m from his spot, still within 1 m)
    if (!this.moving && d > 2.5) this.moving = true
    else if (this.moving && d < 1) this.moving = false
    if (!this.moving) { this.go(you.x - me.x, you.z - me.z, 0); this.stuckT = 0; return }
    const yours = H.speed()
    const pace = dYou > 14 ? 7.6 : dYou > 6 ? Math.max(4.6, yours) : Math.max(1.7, Math.min(4.6, yours + 0.3))
    this.steerTo(spot.x, spot.z, pace, dt)
  }

  /** Walk toward (x, z) at `pace`; not getting anywhere for 2.5 s: put there. */
  private steerTo(x: number, z: number, pace: number, dt: number, short = 0): void {
    const me = this.hero.pos
    this.go(x - me.x, z - me.z, pace)
    if (this.hero.state === 'move' && this.real < 0.4 && pace > 1) this.stuckT += dt
    else this.stuckT = Math.max(0, this.stuckT - dt)
    if (this.stuckT > 2.5) {
      this.stuckT = 0
      // (put there — `short` m short of it, on his side: never onto you)
      const d = Math.hypot(x - me.x, z - me.z) || 1, k = Math.max(0, 1 - short / d)
      this.standAt(me.x + (x - me.x) * k, me.z + (z - me.z) * k, Math.atan2(-(x - me.x), -(z - me.z)))
    }
  }

  /** His car along your way: a gap behind you (more the faster you go), never closer than 10 m to you. */
  private drive(dt: number): void {
    const H = this.host, n = this.ss.length
    if (!n) return
    const you = H.pos(), yours = H.speed(), hostile = this.kind === 'enemy'
    // (the enemy, you on foot: he drives AT you)
    if (hostile && H.onFoot()) { this.runDown(dt); return }
    // (your way's end: its last point and on to where you are now — up to a metre past it)
    const end = this.ss[n - 1] + Math.hypot(you.x - this.xs[n - 1], you.z - this.zs[n - 1])
    // (the enemy RAMS: right up your way to your bumper, then drops back 16 m for the next run)
    this.ramCool = Math.max(0, this.ramCool - dt)
    const contact = this.car.half.z + H.size().z + 0.15
    const gap = hostile ? (this.ramCool > 0 ? 16 : contact) : Math.max(12, Math.min(40, 10 + yours * 0.9))
    const target = end - gap
    // (far behind — he lost you: back on your way out of sight, near the gap)
    if (target - this.arc > 400) { this.arc = target - 30; this.joinK = 1 }
    const near = !hostile && Math.hypot(you.x - this.carP.x, you.z - this.carP.z) < 10
    // (the enemy's CHARGE: flat out — your speed and 9 m/s more — till his bumper is on yours: eased up to you he
    //  docked behind you and never hit; dropping back for the next run he does ease to his gap)
    const want = hostile ? (this.ramCool > 0 ? clamp((target - this.arc) * 1.2, -6, Math.min(45, yours + 9)) : target - this.arc > 0.05 ? Math.min(45, yours + 9) : yours + 2) : near ? 0 : Math.max(0, Math.min(Math.min(60, yours + 10), (target - this.arc) * 0.8))
    // (his car's pace eased: up at 6 m/s² — the enemy's 8 — down at 9)
    this.carSpeed += Math.max(-9 * dt, Math.min((hostile ? 8 : 6) * dt, want - this.carSpeed))
    this.arc = Math.min(target + (hostile ? 0.3 : 2), this.arc + this.carSpeed * dt)
    // his heading: along your way, 2 m either side of him
    const a = this.along(this.arc - 2, this.va), b = this.along(this.arc + 2, this.vb), p = this.along(this.arc, this.vp)
    let yaw = Math.hypot(b.x - a.x, b.z - a.z) > 0.5 ? Math.atan2(-(b.x - a.x), -(b.z - a.z)) : this.carYaw
    // (joining your way from where he got in: eased across over its first metres)
    if (this.joinK < 1) {
      const dj = Math.hypot(p.x - this.joinFrom.x, p.z - this.joinFrom.z)
      this.joinK = Math.min(1, this.joinK + (this.carSpeed * dt) / Math.max(4, dj))
      const k = this.joinK * this.joinK * (3 - 2 * this.joinK)
      p.set(this.joinFrom.x + (p.x - this.joinFrom.x) * k, 0, this.joinFrom.z + (p.z - this.joinFrom.z) * k)
      yaw = this.joinYaw + Math.atan2(Math.sin(yaw - this.joinYaw), Math.cos(yaw - this.joinYaw)) * k
    }
    const dy = Math.atan2(Math.sin(yaw - this.carYaw), Math.cos(yaw - this.carYaw))
    this.carYaw += dy * Math.min(1, dt * 8)
    this.carP.x = p.x
    this.carP.z = p.z
    this.tilt(dt)
    // THE RAM: his bumper on yours and still closing — your car shoved on (and round a little), his drops back
    if (hostile && this.ramCool <= 0 && this.joinK >= 1) {
      const d = Math.hypot(you.x - this.carP.x, you.z - this.carP.z), closing = this.carSpeed - yours
      if (d < contact + 0.6 && closing > 1) {
        // (what your car takes: 1.5 m/s and 0.6 of the speed he closes at — 6 m/s at the most, a parked car knocked on ~20 km/h)
        H.shove(-Math.sin(this.carYaw), -Math.cos(this.carYaw), Math.min(6, 1.5 + closing * 0.6), (Math.random() - 0.5) * 2)
        this.carSpeed = Math.max(0, yours - 2)
        this.ramCool = 2.2 + Math.random() * 1.5
        this.rams++
      }
    }
  }
  /** (the harness) how many times he has rammed you. */
  rams = 0

  /** THE ENEMY IN HIS CAR, YOU ON FOOT: he drives at you (within 45 m, for 9 s at most); hits you — you go down — and
   *  pulls up (then gets out and fights). */
  private runDown(dt: number): void {
    const H = this.host, you = H.pos(), yh = H.you()
    const dx = you.x - this.carP.x, dz = you.z - this.carP.z, d = Math.hypot(dx, dz)
    this.joinK = 1
    this.downT += dt
    const fx = -Math.sin(this.carYaw), fz = -Math.cos(this.carYaw)
    const free = yh.state === 'move' || yh.state === 'land'
    if (d > 45 || yh.isDown || this.downT > 9 || this.ranDown || !free) this.carSpeed += Math.max(-12 * dt, Math.min(0, -this.carSpeed))
    else {
      const dy = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - this.carYaw), Math.cos(Math.atan2(-dx, -dz) - this.carYaw))
      this.carYaw += clamp(dy, -1.6 * dt, 1.6 * dt)
      const want = Math.abs(dy) > 1 ? 4 : Math.min(13, 4 + d * 0.6)
      this.carSpeed += clamp(want - this.carSpeed, -9 * dt, 6 * dt)
      const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx)
      if (this.carSpeed > 3 && ahead > 0 && ahead < this.car.half.z + 0.7 && side < this.car.half.x + 0.3) {
        this.yours = Math.max(0, this.yours - 45)
        this.sinceHit = 0
        yh.shift(fx * 0.8, 0, fz * 0.8)
        if (yh.knockdown(1.6, () => { if (this.yours <= 0) this.yours = 100 })) H.toast('Run down')
        this.ranDown = true
      }
    }
    this.carP.x += -Math.sin(this.carYaw) * this.carSpeed * dt
    this.carP.z += -Math.cos(this.carYaw) * this.carSpeed * dt
    this.tilt(dt)
  }

  // ------------------------------------------------------------------------------------------------ the enemy on foot
  /** FRIEND or ENEMY (the setting, taken at once): his name and colours; the enemy's fight clips loaded (his and
   *  yours — fight.glb, the first time), out of your car if he rode in it. */
  setKind(kind: CompanionKind): void {
    this.kind = kind
    const L = this.look, you = this.host.you()
    this.tag.style.setProperty('--c', L.colour)
    this.nameEl.textContent = L.name
    this.hero.tint(L.jacket)
    if (this.car.id) void this.car.setCar(this.car.id, L.paint)
    this.blows.length = 0
    this.hp = this.yours = 100
    this.hero.stance = you.stance = null
    this.bar.style.display = 'none'
    if (kind !== 'enemy' || !this.ready) return
    if (this.mode === 'passenger') this.outOfYours()
    if (this.mode === 'boarding' || (this.mode === 'foot' && !this.host.onFoot())) this.mode = 'toCar'
    this.grace = 3
    if (!this.fightReady && !this.fightLoading) {
      this.fightLoading = true
      void Promise.all([this.hero.loadClips(this.fightUrl), you.loadClips(this.fightUrl)]).then(() => { this.fightReady = true })
    }
  }

  /** THE ENEMY as something your weapons can hit (Weapons.ts): on foot — a bullet or a cut takes his strength, staggers
   *  him (the head, the body); none left: down, then up again with it back. */
  private readonly me: Target = {
    id: 'enemy',
    pos: new GFX.Vector3(),
    alive: () => this.kind === 'enemy' && this.mode !== 'car' && this.mode !== 'passenger' && this.hero.visible && !this.hero.isDown,
    hit: (damage: number, zone: Zone, weapon: string, dir: GFX.Vector3) => {
      this.sinceHit = 0
      this.hp = Math.max(0, this.hp - damage)
      this.shotBy[weapon] = (this.shotBy[weapon] ?? 0) + 1
      if (dir.lengthSq() > 0.01) this.hero.shift(dir.x * 0.18, 0, dir.z * 0.18)
      if (this.hp <= 0) { if (this.hero.knockdown(2.4, () => { this.hp = 100; this.cool = 1 })) this.host.toast('Enemy down') }
      else { this.hero.strike(zone === 'head' ? 'hit_head' : 'hit_body', { force: true }); this.cool = Math.max(this.cool, 0.5) }
    },
    stun: (seconds: number) => { this.hero.stunUntil = performance.now() / 1000 + seconds; this.cool = Math.max(this.cool, seconds) },
  }
  /** (the harness) what has hit him, by weapon. */
  readonly shotBy: Record<string, number> = {}
  targets(): Target[] {
    if (this.kind !== 'enemy' || !this.ready) return []
    this.me.pos.copy(this.hero.pos)
    return [this.me]
  }

  /** YOUR blow (J: a punch — jab, cross, hook … ; U: a kick), on foot in the enemy's game: thrown his way if he's close. */
  attack(what: 'punch' | 'kick'): void {
    if (this.kind !== 'enemy' || !this.fightReady || !this.host.onFoot()) return
    const yh = this.host.you()
    const clip: FightClip = what === 'kick' ? (this.kicks % 3 === 2 ? 'kick_round' : 'kick_front') : (['jab', 'cross', 'hook', 'jab', 'cross', 'uppercut'] as const)[this.punches % 6]
    if (!yh.strike(clip)) return
    if (what === 'kick') this.kicks++; else this.punches++
    const dx = this.hero.pos.x - yh.pos.x, dz = this.hero.pos.z - yh.pos.z
    if (this.mode === 'foot' && Math.hypot(dx, dz) < 3) yh.heading = Math.atan2(-dx, -dz)
    this.blows.push({ by: 'you', t: yh.hitTime(clip), clip })
  }

  /** He closes in on you, stands in his guard at arm's length, and throws punches and kicks; you down, he waits. */
  private fight(dt: number): void {
    const H = this.host, you = H.pos(), me = this.hero.pos, yh = H.you()
    const dx = you.x - me.x, dz = you.z - me.z, d = Math.hypot(dx, dz)
    // (he lost you: back in from behind you)
    if (d > 140 || Math.abs(you.y - me.y) > 30) { const at = this.behind(35, 8); this.standAt(at.x, at.z); return }
    const near = d < 7 && this.fightReady
    this.hero.stance = yh.stance = near ? 'guard' : null
    // (never in each other: closer than 0.8 m he's eased back to it)
    if (d < 0.8 && !this.hero.isDown && !yh.isDown) {
      const ux = d > 0.05 ? -dx / d : Math.sin(this.hero.heading), uz = d > 0.05 ? -dz / d : Math.cos(this.hero.heading), k = (0.8 - d) * Math.min(1, dt * 8)
      this.hero.shift(ux * k, 0, uz * k)
    }
    const face = () => { this.go(dx, dz, 0); this.stuckT = 0 }
    if (this.hero.isDown || this.hero.striking || (this.grace -= dt) > 0) { face(); return }
    if (d > REACH) { this.steerTo(you.x, you.z, d > 14 ? 7.4 : d > 3.5 ? 5.4 : 2.4, dt, 2); return }
    face()
    if (!this.fightReady) return
    // (you're down: he stands over you — a taunt now and then)
    if (yh.isDown) { if ((this.cool -= dt) <= 0) { this.hero.strike('taunt'); this.cool = 2.5 + Math.random() * 2 } return }
    if ((this.cool -= dt) > 0) return
    const r = Math.random()
    const clip: FightClip = r < 0.26 ? 'jab' : r < 0.5 ? 'cross' : r < 0.66 ? 'hook' : r < 0.76 ? 'uppercut' : r < 0.9 ? 'kick_front' : 'kick_round'
    if (this.hero.strike(clip)) {
      this.blows.push({ by: 'him', t: this.hero.hitTime(clip), clip })
      this.cool = this.hero.clipLength(clip) + 0.35 + Math.random() * 0.9
    }
  }

  /** The blows in the air: each lands at its moment — if it's still being thrown (he wasn't hit first), the other is in
   *  reach and in front. A hit staggers (the head for a punch, the body for a kick), pushes back; strength gone: down. */
  private blowsStep(dt: number): void {
    const H = this.host, yh = H.you()
    for (let i = this.blows.length - 1; i >= 0; i--) {
      const b = this.blows[i]
      if ((b.t -= dt) > 0) continue
      this.blows.splice(i, 1)
      const A = b.by === 'him' ? this.hero : yh, V = b.by === 'him' ? yh : this.hero
      if (A.playing !== b.clip || !A.striking || V.isDown || this.mode !== 'foot' || !H.onFoot() || (V.state !== 'move' && V.state !== 'land')) continue
      const dx = V.pos.x - A.pos.x, dz = V.pos.z - A.pos.z, d = Math.hypot(dx, dz), kick = b.clip.startsWith('kick')
      if (d > (kick ? 1.8 : 1.5) || Math.abs(V.pos.y - A.pos.y) > 1.2) continue
      // (in front of him: within 65° of the way he faces)
      if ((dx * -Math.sin(A.heading) + dz * -Math.cos(A.heading)) / Math.max(d, 1e-3) < 0.42) continue
      const push = (kick ? 0.45 : 0.22) / Math.max(d, 0.2)
      this.sinceHit = 0
      this.landed[b.by]++
      if (b.by === 'you') {
        // (he blocks one in four he sees coming)
        if (!this.hero.striking && Math.random() < 0.25 && this.hero.strike('block')) { this.cool = Math.max(this.cool, 0.4); continue }
        this.hp = Math.max(0, this.hp - (DMG[b.clip] ?? 10))
        this.hero.shift(dx * push, 0, dz * push)
        if (this.hp <= 0) { if (this.hero.knockdown(1.8, () => { this.hp = 100; this.cool = 0.8 })) H.toast('Enemy down') }
        else { this.hero.strike(kick ? 'hit_body' : 'hit_head', { force: true }); this.cool = Math.max(this.cool, 0.45) }
      } else {
        this.yours = Math.max(0, this.yours - (DMG[b.clip] ?? 10))
        yh.shift(dx * push, 0, dz * push)
        if (this.yours <= 0) { if (yh.knockdown(1.2, () => { this.yours = 100 })) H.toast('You went down') }
        else yh.strike(kick ? 'hit_body' : 'hit_head', { force: true })
      }
    }
  }
  /** (the harness) the blows that landed. */
  readonly landed = { him: 0, you: 0 }

  /** His car drawn where it is, and solid there. */
  private poseCar(dt: number): void {
    const on = this.carOn
    this.car.root.userData.on = on
    if (!on) { this.unsolid(); return }
    const P = this.carP, Q = this.carQ
    this.car.pose([P.x, P.y, P.z], [Q.x, Q.y, Q.z, Q.w], this.mode === 'car' ? this.carSpeed : 0, dt)
    // (the driver: he's seen in it)
    const s = this.car.driverSeat
    if (this.mode === 'car' && s && !this.hero.seated) this.hero.sitIn(this.car.root, s.hips, () => null)
    const box = this.car.box
    if (!box) return
    const pw = this.physics.pw, R = pw.R, key = `car:${this.car.id}`
    if (this.solid && this.solid.key !== key) this.unsolid()
    if (!this.solid) {
      const body = pw.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(P.x, P.y, P.z).setRotation({ x: Q.x, y: Q.y, z: Q.z, w: Q.w }))
      pw.world.createCollider(R.ColliderDesc.cuboid(box.h.x, box.h.y, box.h.z).setTranslation(box.c.x, box.c.y, box.c.z).setCollisionGroups(group(Groups.Static, 0xffff)).setFriction(0.8), body)
      this.solid = { body, key }
    }
    this.solid.body.setNextKinematicTranslation({ x: P.x, y: P.y, z: P.z })
    this.solid.body.setNextKinematicRotation({ x: Q.x, y: Q.y, z: Q.z, w: Q.w })
  }
  private unsolid(): void {
    if (this.solid) { this.physics.pw.world.removeRigidBody(this.solid.body); this.solid = null }
  }

  /** The physics step (60 Hz): his walk. */
  fixed(dt: number): void { if (this.ready) this.hero.fixed(dt) }

  /** After the physics: his skeleton posed. */
  animate(dt: number): void {
    if (!this.ready) return
    // (his skeleton by the distance — in a fight, every frame; a frame's skipped time carried to the next, his place kept up)
    const hero = this.hero
    if (!hero.visible) return
    this.animDt += dt
    const every = this.kind === 'enemy' && this.camDist < 40 ? 1 : !this.inView ? 0 : this.camDist < 30 ? 1 : this.camDist < 80 ? 2 : 4
    if ((every && ++this.animN >= every) || hero.isDown) { hero.update(this.animDt); this.animDt = 0; this.animN = 0 }
    else if (!hero.seated) { hero.root.position.copy(hero.pos); hero.root.updateMatrixWorld(true) }
  }

  /** Drawn only when in view; the name tag placed. */
  cull(view: GFX.Frustum, horizon: Horizon, camera: GFX.PerspectiveCamera, w: number, h: number): void {
    this.yourBar()
    this.car.cull(view, horizon, this.carOn)
    if (this.ready && this.hero.visible) this.hero.cull(view, horizon)
    const p = this.where()
    const d = this.placed && this.mode !== 'passenger' ? camera.position.distanceTo(p) : Infinity
    this.camDist = this.placed ? camera.position.distanceTo(p) : 0
    this.inView = this.hero.root.visible
    if (d > TAG_FAR) { if (this.tag.style.display !== 'none') this.tag.style.display = 'none'; return }
    this.v.copy(p)
    this.v.y += this.mode === 'car' ? 2.9 : 2.3
    this.v.project(camera)
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) { if (this.tag.style.display !== 'none') this.tag.style.display = 'none'; return }
    if (this.tag.style.display === 'none') this.tag.style.display = ''
    const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h
    const k = Math.max(0.55, Math.min(1, 60 / Math.max(d, 1)))
    this.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(3)})`
    const label = d < 40 ? (this.kind === 'enemy' ? `${Math.round(this.hp)}` : '') : `${Math.round(d)} m`
    if (this.dist.textContent !== label) this.dist.textContent = label
  }
  /** Your strength's bar: shown in the enemy's game while it isn't whole, or he's within 12 m on foot. */
  private yourBar(): void {
    const show = this.kind === 'enemy' && (this.yours < 99.5 || (this.mode === 'foot' && this.host.onFoot() && this.hero.pos.distanceTo(this.host.pos()) < 12))
    const disp = show ? 'block' : 'none'
    if (this.bar.style.display !== disp) this.bar.style.display = disp
    if (show) this.barFill.style.width = `${Math.round(this.yours)}%`
  }

  dispose(): void {
    this.unsolid()
    this.hero.hide()
    this.hero.root.removeFromParent(); this.hero.shadowMesh.removeFromParent()
    this.car.dispose()
    this.host.you().stance = null
    this.bar.remove()
    this.layer.remove()
  }
}
