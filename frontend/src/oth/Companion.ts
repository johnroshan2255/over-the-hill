import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { Character, type FightClip } from './Character'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import type { Target, Zone } from './Weapons'
import { carSolid, RemoteCar } from './Vehicle'
import { group, Groups } from '../physics/PhysicsWorld'
import type RAPIER from '@dimforge/rapier3d-compat'
import DAMAGE from '../../../proto/damage.json'
import { DAMAGE_ON } from './Damage'

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
  /** YOUR vehicle's own box in plan: its middle (the world's x, z), its half width and length, the way it points —
   *  what his bumper has to reach to ram it. */
  box(): { x: number; z: number; hx: number; hz: number; yaw: number }
  /** Your vehicle SHOVED (his car rams it, pushes it): along (dx, dz) by `dv` m/s, spun by `spin` rad/s; `at`: where
   *  his car met it (the world's), `by`: his car's body — a ram's (the damage is put there: Vehicle.hitHint). */
  shove(dx: number, dz: number, dv: number, spin: number, at?: GFX.Vector3, by?: RAPIER.RigidBody | null): void
  /** A BODY THAT IS NOT YOUR VEHICLE struck by his car (you on foot: your parked car — made live for it —, a crate…):
   *  along (dx, dz) by `dv` m/s, at `at` (the world's), by his car's body. */
  knock?(b: RAPIER.RigidBody, dx: number, dz: number, dv: number, at: GFX.Vector3, by: RAPIER.RigidBody | null): void
  /** How your vehicle moves (the world's, m/s; nothing on foot) and its body in the physics (null on foot). */
  vel(): { x: number; y: number; z: number }
  body(): RAPIER.RigidBody | null
  /** A JOLT felt (a ram, a blow that lands on you or that you land): the view shaken by k (0 … 1), the dust knocked
   *  up at (x, y, z). */
  jolt?(k: number, x: number, y: number, z: number): void
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
const DMG: Record<string, number> = { jab: 8, cross: 14, hook: 14, uppercut: 18, body_hook: 15, knee: 20, kick_front: 16, kick_round: 24, kick_low: 10 }
/** WHAT A BLOW DOES to whoever takes it (2026-11-21, the user: "the action must feel real"): how it is taken — the
 *  clip: the head back, whipped to one side, folded over the belly, the leg knocked from under him —, how hard he's
 *  thrown back (m/s, dying away), how long the two of them hold on the frame it lands (s — the hit-stop), how the
 *  view jolts (0 … 1); a `heavy` one may stagger him. */
const BLOW: Record<string, { react: FightClip; push: number; stop: number; jolt: number; heavy?: boolean; head?: boolean; kick?: boolean }> = {
  jab: { react: 'hit_head', push: 1.0, stop: 0.045, jolt: 0.3, head: true },
  cross: { react: 'hit_head', push: 2.1, stop: 0.07, jolt: 0.5, heavy: true, head: true },
  hook: { react: 'hit_head_r', push: 1.6, stop: 0.07, jolt: 0.5, heavy: true, head: true },
  uppercut: { react: 'hit_head', push: 1.4, stop: 0.085, jolt: 0.6, heavy: true, head: true },
  body_hook: { react: 'hit_body', push: 1.2, stop: 0.07, jolt: 0.45 },
  knee: { react: 'hit_body', push: 1.6, stop: 0.085, jolt: 0.6, heavy: true, kick: true },
  kick_front: { react: 'hit_body', push: 3.4, stop: 0.075, jolt: 0.55, heavy: true, kick: true },
  kick_round: { react: 'hit_head_l', push: 2.8, stop: 0.09, jolt: 0.7, heavy: true, kick: true },
  kick_low: { react: 'hit_leg', push: 0.6, stop: 0.05, jolt: 0.3, kick: true },
}
/** YOUR runs (J pressed again as each lands; U the same): the punches, the kicks. */
const PUNCHES: FightClip[] = ['jab', 'cross', 'hook', 'uppercut', 'body_hook'], KICKS: FightClip[] = ['kick_low', 'kick_front', 'kick_round']
/** HIS runs: what he throws one into the next. */
const RUNS: FightClip[][] = [['jab'], ['jab', 'cross'], ['jab', 'jab', 'cross'], ['jab', 'cross', 'hook'], ['cross', 'body_hook'], ['hook', 'cross'], ['kick_low'], ['kick_front'],
  ['jab', 'kick_round'], ['uppercut'], ['jab', 'cross', 'kick_low'], ['body_hook', 'hook'], ['kick_low', 'cross']]
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const RANGE = 100
const UP = new GFX.Vector3(0, 1, 0)
/** How near his car's nose comes to your car's body before it is stopped (m): touching, to the eye. */
const SKIN = 0.012
/** How far inside your car's panels its inner solid pieces stand (m, about): what his nose is stopped short of them by. */
const INSET = 0.03
const TAG_FAR = 900

const NONE: readonly { x: number; z: number; heading: number; colour: string; name: string }[] = []
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
  /** The blows in the air: whose, the time till each lands (s), which; `seen`: he has made up his mind about it. */
  private readonly blows: { by: 'him' | 'you'; t: number; clip: FightClip; seen: boolean }[] = []
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
  private readonly st: { x: number; z: number; pace: number; face: number | null } = { x: 0, z: 0, pace: 0, face: null }
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
  private go(x: number, z: number, pace: number, face: number | null = null): void { const s = this.st; s.x = x; s.z = z; s.pace = pace; s.face = face; this.hero.steer = s }

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
    // (his car takes blows as yours does — Damage.ts)
    this.car.damageOn = DAMAGE_ON
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
  get list(): readonly { x: number; z: number; heading: number; colour: string; name: string }[] {
    if (!this.placed) return NONE
    // (one entry, kept: the minimap asks every frame)
    const p = this.where(), o = this.listOut[0]
    o.x = p.x; o.z = p.z; o.heading = this.mode === 'car' ? this.carYaw : this.hero.heading; o.colour = this.look.colour; o.name = this.name
    return this.listOut
  }
  private readonly listOut = [{ x: 0, z: 0, heading: 0, colour: '', name: '' }]
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
    // (another one: whole)
    this.car.damage?.repair()
    this.wreckT = 0
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
        // (HIS CAR IS DEAD — its engine gone, or burnt out: he comes after you on foot; once you are well away from
        //  the wreck, or 12 s on, another is brought him)
        if (this.carOn && this.car.damage?.dead) {
          this.wreckT += dt
          if (you.distanceTo(this.carP) < 55 && this.wreckT < 12) { this.steerTo(you.x, you.z, 4.6, dt, 2.5); break }
          this.bringCar()
        }
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
        // (his car's way is made in the physics' own steps — `fixed`)
        // (his engine has died under him: out he gets)
        if (this.car.damage?.dead && this.carSpeed < 0.5) { this.leaveCar(); break }
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
    if (hostile && H.onFoot()) { this.runDown(dt); this.offWay = true; return }
    // (back onto your way from wherever that took him: from where his car IS — eased across to the way's nearest
    //  point, as when he first got in. He was put back where he had left the way: a jump of as far as he had strayed)
    if (this.offWay) {
      this.offWay = false
      let best = Infinity, bi = 0
      for (let i = 0; i < n; i++) { const d = Math.hypot(this.xs[i] - this.carP.x, this.zs[i] - this.carP.z); if (d < best) { best = d; bi = i } }
      this.arc = this.ss[bi]
      this.joinFrom.copy(this.carP); this.joinYaw = this.carYaw; this.joinK = 0
    }
    // (your way's end: its last point and on to where you are now — up to a metre past it)
    const end = this.ss[n - 1] + Math.hypot(you.x - this.xs[n - 1], you.z - this.zs[n - 1])
    // (HIS PLACE ALONG YOUR WAY IS WHERE HIS CAR IS: held at your car, the place ran on without the car — up to 1.8 m
    //  ahead of it, measured — and the step anything gave, the car was put there: 100 m/s of it, into you. Each step
    //  the place is taken again from the car: the point of your way abreast of it)
    if (this.joinK >= 1) {
      const q0 = this.along(this.arc, this.vp), ta = this.along(this.arc - 1, this.va), tb = this.along(this.arc + 1, this.vb)
      const tl = Math.hypot(tb.x - ta.x, tb.z - ta.z)
      if (tl > 0.2) this.arc -= ((q0.x - this.carP.x) * (tb.x - ta.x) + (q0.z - this.carP.z) * (tb.z - ta.z)) / tl
    }
    this.ramCool = Math.max(0, this.ramCool - dt)
    // (how near his car's root comes to yours along your way, bumper on bumper: his front, your half length. Only to
    //  know how far off he is — what STOPS him is his car's own nose meeting your car's own body: `reach`)
    const yb = H.box(), hb = this.car.box
    const front = hb ? hb.h.z - hb.c.z : this.car.half.z
    const contact = front + yb.hz + 0.05
    const off = end - contact - this.arc
    const gap = hostile ? contact : Math.max(12, Math.min(40, 10 + yours * 0.9))
    const target = end - gap
    // (far behind — he lost you: back on your way out of sight, near the gap)
    if (target - this.arc > 400) { this.arc = target - 30; this.joinK = 1; this.prevP.set(NaN, 0, 0) }
    const near = !hostile && Math.hypot(you.x - this.carP.x, you.z - this.carP.z) < 10
    // (the way his car points, and how fast YOU go along it)
    const fx = -Math.sin(this.carYaw), fz = -Math.cos(this.carYaw), yv = H.vel(), alongYou = yv.x * fx + yv.z * fz
    // THE ENEMY'S RUN AT YOU (2026-11-21, the user: "when it hits me it goes back like it bounced off a balloon" — he
    // was sent back to a 16 m gap the instant he had hit). Three parts now: the CHARGE — flat out, your speed and
    // 9 m/s more, till his nose is on you —; the blow, and for a second and a half he keeps his weight ON you,
    // pushing; then he lets you go — easing off behind you if you drive on; only if you stand does he back away, on
    // his own wheels, to take another run.
    let want0: number
    if (!hostile) want0 = near ? 0 : Math.max(0, Math.min(Math.min(60, yours + 10), (target - this.arc) * 0.8))
    // (your car OFF ITS WHEELS — tipped, on its side, in the air: he does not drive into that; he waits a few metres
    //  off till it stands)
    else if (this.yourTilt() < 0.75) { want0 = off < 6 ? (off < 3 ? -2.5 : 0) : Math.min(45, yours); this.pushT = 0; this.ramCool = Math.max(this.ramCool, 1.2) }
    else if (this.pushT > 0) { this.pushT -= dt; want0 = Math.max(0, alongYou + 1.6) }
    else if (this.ramCool > 0) want0 = off < 7 ? (yours < 2.5 ? -3.2 : Math.max(0, yours - 3)) : Math.min(45, yours)
    else want0 = Math.min(45, yours + 9)
    // (DAMAGE: a hurt car is slower — its engine's power left, every wheel bent, flat or gone; a dead one rolls to a stop)
    const fit = this.car.damage ? this.car.damage.drive : 1
    const want = fit <= 0 ? 0 : want0 < 0 ? want0 : Math.min(want0, (hostile ? 45 : 60) * fit)
    // (his car's pace eased: up at 6 m/s² — the enemy's 8 — down at 9)
    this.carSpeed += Math.max(-9 * dt, Math.min((hostile ? 8 : 6) * dt, want - this.carSpeed))
    // (a backstop only — his nose never past your middle; where he stops at your car is `reach`'s to say)
    const arc0 = this.arc
    this.arc = Math.min(hostile ? end - front - 0.5 : target + 2, this.arc + this.carSpeed * dt)
    // his heading: along your way, 2 m either side of him
    const a = this.along(this.arc - 2, this.va), b = this.along(this.arc + 2, this.vb), p = this.along(this.arc, this.vp)
    let yaw = Math.hypot(b.x - a.x, b.z - a.z) > 0.5 ? Math.atan2(-(b.x - a.x), -(b.z - a.z)) : this.carYaw
    // (joining your way from where he got in: eased across over its first metres)
    if (this.joinK < 1) {
      const dj = Math.hypot(p.x - this.joinFrom.x, p.z - this.joinFrom.z)
      this.joinK = Math.min(1, this.joinK + (Math.max(0, this.carSpeed) * dt) / Math.max(4, dj))
      const k = this.joinK * this.joinK * (3 - 2 * this.joinK)
      p.set(this.joinFrom.x + (p.x - this.joinFrom.x) * k, 0, this.joinFrom.z + (p.z - this.joinFrom.z) * k)
      yaw = this.joinYaw + Math.atan2(Math.sin(yaw - this.joinYaw), Math.cos(yaw - this.joinYaw)) * k
    }
    // (his turn this step — none while his nose is on your car: turning there swung it INTO yours, a hand's breadth
    //  at a time, and no step along his way was tried against that)
    const dy = this.onYou ? 0 : Math.atan2(Math.sin(yaw - this.carYaw), Math.cos(yaw - this.carYaw)) * Math.min(1, dt * 8)
    this.carYaw += dy
    // (… and the step is tried as he will stand after it: turned)
    this.castQ.setFromAxisAngle(UP, dy).multiply(this.carQ)
    // HIS CAR MEETS YOURS (2026-11-21, the user: "hit on the side, it does not touch my car's side … it must hit the
    // car, not an invisible outer layer"): he was stopped by a distance between the two cars' MIDDLES — your car
    // across his way, that left him a metre off its side — and what was solid of him was a box round his mirrors, his
    // bars and his spare wheel. Now this step's way is tried with his car's own NOSE (its tail, backing) against your
    // vehicle's own body: he goes as far as touching it, wherever on it that is, and no further.
    // (what is cut is the CLOSING part of the step — his way less yours: of two cars going on together, nothing)
    let mx = p.x - this.carP.x, mz = p.z - this.carP.z
    // (a step is never longer than his speed makes it — and a little: easing across to your way)
    { const ml = Math.hypot(mx, mz), most = Math.abs(this.carSpeed) * dt * 1.6 + 0.04; if (ml > most) { mx *= most / ml; mz *= most / ml; p.x = this.carP.x + mx; p.z = this.carP.z + mz } }
    const k = this.reach(mx, mz, dt), touch = k < 1, rel = this.rel
    this.onYou = touch
    if (touch) {
      const cut = 1 - k
      p.x -= rel.x * cut; p.z -= rel.z * cut
      // (STOPPED by your car, never moved by it: he does not give way before a car driven at him — the cut is of his
      //  own step, to nothing at the most. Then it is your car that runs into his, and that is a crash: both take it)
      if ((p.x - this.carP.x) * mx + (p.z - this.carP.z) * mz < 0) { p.x = this.carP.x; p.z = this.carP.z }
      this.arc = arc0 + (p.x - this.carP.x) * fx + (p.z - this.carP.z) * fz
    }
    this.carP.x = p.x
    this.carP.z = p.z
    this.tilt(dt)
    if (!touch) { this.leanT = 0; return }
    // (how fast he came onto you: his pace till this step, less yours along it)
    const closing = this.carSpeed - alongYou
    if (hostile && this.joinK >= 1 && this.ramCool <= 0 && closing > 1) {
      // THE RAM: two cars of a weight and a DEAD blow — nothing springs back: both go on at the speed between the
      // two. Yours is given its half of what he closed at (there, where he met it — its damage is put there, and his
      // car takes the same: main.ts), his loses his half; and he stays on you. (His car is not moved on with yours
      // in this step: yours takes a step or two to get going — its tyres, its brakes — and moved on ahead of that he
      // was 7 cm and more INTO it, measured, and the physics threw it. A hand's breadth opens between them for a
      // tenth of a second instead; then he is on it again, pushing.)
      this.ramAt.copy(this.hitAt)
      H.shove(fx, fz, Math.min(8, closing / 2), 0, this.hitAt, this.solid ? this.solid.body : null)
      H.jolt?.(Math.min(1, 0.25 + closing * 0.07), you.x, you.y + 0.6, you.z)
      this.carSpeed -= closing / 2
      this.pushT = 1.4
      this.ramCool = 3.4 + Math.random() * 1.5
      this.leanT = 0
      this.rams++
      this.rammedAt = performance.now() / 1000
      return // (the two now go at one speed: nothing more to take off his)
    }
    if (hostile && this.pushT > 0) H.shove(fx, fz, 2.2 * dt, 0) // (his weight on you: pushed along, 2.2 m/s²)
    // (on you with no blow in it — he came up as you slowed, or still easing across to your way: a third of a second
    //  of that and he lets go, to take a run at you)
    if (hostile && this.pushT <= 0 && this.ramCool <= 0) { if ((this.leanT += dt) > 0.35) { this.leanT = 0; this.ramCool = 2.2 + Math.random() * 1.2 } } else this.leanT = 0
    // (against your car he goes no faster than it does)
    if (this.carSpeed > alongYou + 0.8) this.carSpeed = Math.max(0, alongYou + 0.8)
  }
  /** Where his car met yours at his last ram (the world's). */
  readonly ramAt = new GFX.Vector3()
  /** How upright your car stands (1: on its wheels … 0: on its side; under 0: on its roof); the bike: 1. */
  private yourTilt(): number {
    const c = this.host.riding() ? null : this.host.car()
    if (!c) return 1
    const q = c.root.quaternion
    return 1 - 2 * (q.x * q.x + q.z * q.z)
  }
  private pushT = 0
  private leanT = 0
  private onYou = false
  private readonly castQ = new GFX.Quaternion()
  private readonly hitAt = new GFX.Vector3()
  private readonly rel = { x: 0, y: 0, z: 0 }
  private meshOf = -1
  private hasHulls = false
  /** His car's nose and tail (its own shape's front and back 0.6 m, wrapped — car space): what is tried against
   *  your vehicle. */
  private nose: RAPIER.Shape | null = null
  private tail: RAPIER.Shape | null = null
  /** How much of this step's way (mx, mz) his car can go before its NOSE — its tail, backing — meets your vehicle's
   *  own body, both as they stand in the physics now (1: all of it; `hitAt`: where they meet). One cast of a convex
   *  shape of 96 points against your car's inner solid pieces, and only in the steps the two could meet in. */
  private reach(mx: number, mz: number, dt: number): number {
    const yb = this.host.body(), sh = this.carSpeed >= 0 ? this.nose : this.tail
    if (!yb || !sh) return 1
    const you = this.host.pos()
    const v = yb.linvel(), rel = this.rel
    // (nothing to try while the two are too far apart to meet in this step: his reach to his nose or tail, your car's
    //  round, what the two close in the step, and half a metre)
    { const box = this.car.box, hb = this.host.box(), far = (box ? Math.max(box.h.z - box.c.z, box.h.z + box.c.z) : 2.5) + Math.hypot(hb.hx, hb.hz) + Math.hypot(mx - v.x * dt, mz - v.z * dt) + 0.5
      if (Math.hypot(you.x - this.carP.x, you.z - this.carP.z) > far) return 1 }
    rel.x = mx - v.x * dt; rel.z = mz - v.z * dt
    // (only a step that brings the two NEARER is tried: going apart, nothing holds him — and a cast that begins a
    //  hair off a hollow mesh is not asked which way out is)
    if (rel.x * rel.x + rel.z * rel.z < 1e-10 || rel.x * (you.x - this.carP.x) + rel.z * (you.z - this.carP.z) <= 0) return 1
    // (your vehicle's BODY: its exact mesh and its inner pieces — not its tyre guards: capsules a hand and more
    //  wider than the wheels, which only the desert's slabs ever met; his nose stopped on those, 0.4 m off your side)
    // (… its INNER SOLID PIECES where it has them — a few dozen convex ones, 2–4 cm inside its panels: he is stopped
    //  that much short of them, at the panel. Against its exact mesh — a hundred thousand triangles — one try took
    //  2.7 ms, every step he was near: measured.)
    const yh = yb.handle, ST = this.physics.pw.R.ShapeType
    if (this.meshOf !== yh) { this.meshOf = yh; this.hasHulls = false; for (let i = 0, n = yb.numColliders(); i < n; i++) if (yb.collider(i).shapeType() === ST.ConvexPolyhedron) this.hasHulls = true }
    const only = this.hasHulls
    const hit = this.physics.pw.world.castShape(this.carP, this.castQ, rel, sh, only ? SKIN + INSET : SKIN, 1, true, undefined, undefined, undefined, this.solid ? this.solid.body : undefined, (c) => c.parent()?.handle === yh && (only ? c.shapeType() === ST.ConvexPolyhedron : c.shapeType() !== ST.Capsule))
    if (!hit) return 1
    this.hitAt.set(hit.witness1.x, hit.witness1.y, hit.witness1.z)
    return Math.max(0, Math.min(1, hit.time_of_impact))
  }
  /** (the harness) how many times he has rammed you. */
  rams = 0
  /** His car has left your way (he drove at you on foot): it joins it again from where it is. */
  private offWay = false

  /** THE ENEMY IN HIS CAR, YOU ON FOOT: he drives at you (within 45 m, for 9 s at most); hits you — you go down — and
   *  pulls up (then gets out and fights). */
  private runDown(dt: number): void {
    const H = this.host, you = H.pos(), yh = H.you()
    const dx = you.x - this.carP.x, dz = you.z - this.carP.z, d = Math.hypot(dx, dz)
    this.joinK = 1
    this.downT += dt
    const fx = -Math.sin(this.carYaw), fz = -Math.cos(this.carYaw)
    const free = yh.state === 'move' || yh.state === 'land'
    let turn = 0
    if (d > 45 || yh.isDown || this.downT > 9 || this.ranDown || !free) this.carSpeed += Math.max(-12 * dt, Math.min(0, -this.carSpeed))
    else {
      const dy = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - this.carYaw), Math.cos(Math.atan2(-dx, -dz) - this.carYaw))
      turn = clamp(dy, -1.6 * dt, 1.6 * dt)
      this.carYaw += turn
      const fit = this.car.damage ? this.car.damage.drive : 1
      const want = (Math.abs(dy) > 1 ? 4 : Math.min(13, 4 + d * 0.6)) * Math.min(1, fit * 1.5)
      this.carSpeed += clamp(want - this.carSpeed, -9 * dt, 6 * dt)
      // (his bumper ON you — your body 0.3 m round — not a stride off it)
      const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx), hb = this.car.box, nose = hb ? hb.h.z - hb.c.z : this.car.half.z
      if (this.carSpeed > 3 && ahead > 0 && ahead < nose + 0.35 && side < this.car.half.x + 0.25) {
        this.yours = Math.max(0, this.yours - 45)
        this.sinceHit = 0
        yh.shift(fx * 0.8, 0, fz * 0.8)
        H.jolt?.(1, you.x, you.y + 0.8, you.z)
        if (yh.knockdown(1.6, () => { if (this.yours <= 0) this.yours = 100 })) H.toast('Run down')
        this.ranDown = true
      }
    }
    // HIS WAY TRIED AGAINST WHAT STANDS IN IT (NEXT_damage §2.4: he drove through your parked car — a held car is a
    // kinematic thing, as his is, and two of those pass through each other — and through trees, rocks and walls): his
    // nose (his tail, backing) cast along the step, turned as he will stand after it. Met: there he stops — a blow
    // to his car and to what he met, by how fast he came —, and the run is over: he gets out and comes on foot.
    let mx = -Math.sin(this.carYaw) * this.carSpeed * dt, mz = -Math.cos(this.carYaw) * this.carSpeed * dt
    this.castQ.setFromAxisAngle(UP, turn).multiply(this.carQ)
    let k = this.blocked(mx, mz)
    // (the turn alone swung his nose into it: not turned)
    if (k === 0 && turn !== 0) { this.carYaw -= turn; this.castQ.copy(this.carQ); k = this.blocked(mx = -Math.sin(this.carYaw) * this.carSpeed * dt, mz = -Math.cos(this.carYaw) * this.carSpeed * dt) }
    if (k < 1) {
      mx *= k; mz *= k
      const v = Math.abs(this.carSpeed), sg = this.carSpeed >= 0 ? 1 : -1, other = this.blockedBy
      if (v > 2) {
        // (a body that can move — your parked car — takes half of it, a dead blow, and his car its half through your
        //  car's own crash: main.ts; what can't move takes all of it, his car the lot)
        if (other && (other.isDynamic() || other.isKinematic()) && this.host.knock) { this.rammedAt = performance.now() / 1000; this.host.knock(other, fx * sg, fz * sg, v / 2, this.hitAt, this.solid ? this.solid.body : null) }
        else this.carBlow(this.hitAt.x, this.hitAt.y, this.hitAt.z, -fx * sg, 0, -fz * sg, v)
        this.ranDown = true
      }
      this.carSpeed = 0
      // (held up there, pressing on, a second: he gives up the run)
      if ((this.blockT += dt) > 1.2) this.ranDown = true
    } else this.blockT = 0
    this.carP.x += mx
    this.carP.z += mz
    this.tilt(dt)
  }
  private blockT = 0
  private blockedBy: RAPIER.RigidBody | null = null
  /** How much of this step's way (mx, mz) his car can go before its nose (its tail, backing) — turned as `castQ` — meets
   *  anything solid: your parked car's inner pieces, a tree, a rock, a wall, a prop (not the land, not you — the run is
   *  for that —, nothing that is only ground: the roads' ribbons, the bridges' decks; not a wheel's guard). 1: all of
   *  it; `hitAt` / `blockedBy`: where, what. */
  private blocked(mx: number, mz: number): number {
    const sh = this.carSpeed >= 0 ? this.nose : this.tail
    this.blockedBy = null
    if (!sh || mx * mx + mz * mz < 1e-10) return 1
    const pw = this.physics.pw, ST = pw.R.ShapeType, me = this.host.you().rigid as RAPIER.RigidBody | null | undefined
    const hit = pw.world.castShape(this.carP, this.castQ, { x: mx, y: 0, z: mz }, sh, SKIN + INSET, 1, true, pw.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, this.solid ? this.solid.body : undefined, (c) => {
      const t = c.shapeType(), p = c.parent()
      if (t === ST.HeightField || t === ST.Capsule || (me && p?.handle === me.handle)) return false
      // (ground: a static trimesh or a ground box — the StaticMesh group — but a rock's hull; a car's exact mesh: its
      //  inner pieces are what's met, as `reach` has it)
      if (((c.collisionGroups() >>> 16) & Groups.StaticMesh) && t !== ST.ConvexPolyhedron) return false
      if (t === ST.TriMesh && p && !p.isFixed()) return false
      return true
    })
    if (!hit) return 1
    this.hitAt.set(hit.witness1.x, hit.witness1.y, hit.witness1.z)
    this.blockedBy = hit.collider.parent()
    return Math.max(0, Math.min(1, hit.time_of_impact))
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
      const h = this.hero, H = this.host
      this.sinceHit = 0
      this.hp = Math.max(0, this.hp - damage)
      this.shotBy[weapon] = (this.shotBy[weapon] ?? 0) + 1
      this.plan.length = 0
      // (thrown the way it came: a bullet a little, the sniper's more)
      const along = dir.lengthSq() > 0.01
      if (along) { const k = weapon === 'sniper' ? 2.6 : 0.9; h.push(dir.x * k, dir.z * k) }
      if (this.hp <= 0) {
        // KILLED: he drops where he stands — back, shot from the front; onto his face, from behind — and lies
        // there; after a while he is back, from behind you (the fists only knock him down: he gets up from those)
        const front = !along || dir.x * -Math.sin(h.heading) + dir.z * -Math.cos(h.heading) < 0.2
        if (h.knockdown(4.5, () => { this.hp = 100; this.cool = 1; this.join() }, front ? 'die_back' : 'die_fwd', false)) H.toast('Enemy down')
        return
      }
      // (how he takes it: the head back, the leg from under him, folded over it — a heavy round staggers him)
      const clip: FightClip = zone === 'head' ? 'hit_head' : zone === 'limb' ? 'hit_leg' : damage > 40 ? 'stagger' : 'hit_body'
      h.strike(clip, { force: true })
      this.cool = Math.max(this.cool, 0.5)
    },
  }
  /** (the harness) what has hit him, by weapon. */
  readonly shotBy: Record<string, number> = {}
  targets(): Target[] {
    if (this.kind !== 'enemy' || !this.ready) return []
    this.me.pos.copy(this.hero.pos)
    return [this.me]
  }

  /** YOUR blow (J: a punch; U: a kick), on foot in the enemy's game: thrown his way if he's close. A RUN of them:
   *  pressed again once one has landed, the next is thrown straight out of it — jab, cross, hook, uppercut, a hook to
   *  the body; a low kick, a front kick, a roundhouse (a knee when he's right on you). Left a moment, the run starts again. */
  attack(what: 'punch' | 'kick'): void {
    if (this.kind !== 'enemy' || !this.fightReady || !this.host.onFoot()) return
    const yh = this.host.you(), now = performance.now()
    const last = this.yoursLast
    // (mid-blow: only once it has landed — the rest of it is cut short for the next)
    const chain = yh.striking && !!last && yh.playing === last && yh.clipTime >= yh.hitTime(last) + 0.03
    if (yh.striking && !chain) return
    if (now - this.yoursAt > 1100) this.punches = this.kicks = 0
    const dx = this.hero.pos.x - yh.pos.x, dz = this.hero.pos.z - yh.pos.z, d = Math.hypot(dx, dz)
    const clip: FightClip = what === 'kick' ? (d < 0.95 && this.kicks % 2 === 1 ? 'knee' : KICKS[this.kicks % KICKS.length]) : PUNCHES[this.punches % PUNCHES.length]
    if (!yh.strike(clip, { force: chain })) return
    if (what === 'kick') this.kicks++; else this.punches++
    this.yoursLast = clip
    this.yoursAt = now
    if (this.mode === 'foot' && d < 3) yh.heading = Math.atan2(-dx, -dz)
    // (a step into it: carried toward him as it's thrown — not if he's already on you)
    if (d > 1.0 && d < 2.6) yh.push((dx / d) * 1.6, (dz / d) * 1.6)
    this.blows.push({ by: 'you', t: yh.hitTime(clip), clip, seen: false })
  }
  private yoursLast: FightClip | null = null
  private yoursAt = 0
  /** The run he is throwing (what's still to come of it), and which way he circles (+1 / −1). */
  private readonly plan: FightClip[] = []
  private planLast: FightClip | null = null
  private circle = 1
  private circleT = 0

  /** He closes in on you; in reach he fights as a man does: CIRCLES you with his guard up and his eyes on you, throws
   *  a RUN of blows — each out of the last as it lands — and steps off; he SEES yours coming and now and then covers
   *  up, slips back or ducks under it. You down, he waits (and taunts). */
  private fight(dt: number): void {
    const H = this.host, you = H.pos(), me = this.hero.pos, yh = H.you(), h = this.hero
    const dx = you.x - me.x, dz = you.z - me.z, d = Math.hypot(dx, dz)
    // (he lost you: back in from behind you)
    if (d > 140 || Math.abs(you.y - me.y) > 30) { const at = this.behind(35, 8); this.standAt(at.x, at.z); return }
    const near = d < 7 && this.fightReady
    h.stance = yh.stance = near ? 'guard' : null
    // (never in each other: closer than 0.8 m he's eased back to it)
    if (d < 0.8 && !h.isDown && !yh.isDown) {
      const ux = d > 0.05 ? -dx / d : Math.sin(h.heading), uz = d > 0.05 ? -dz / d : Math.cos(h.heading), k = (0.8 - d) * Math.min(1, dt * 8)
      h.shift(ux * k, 0, uz * k)
    }
    const toYou = Math.atan2(-dx, -dz)
    const face = () => { this.go(dx, dz, 0); this.stuckT = 0 }
    if (h.isDown || (this.grace -= dt) > 0) { this.plan.length = 0; face(); return }
    if (h.striking) {
      face()
      // THE RUN: the next blow out of this one, once it has landed
      const last = this.planLast, next = this.plan[0]
      if (next && last && h.playing === last && h.clipTime >= h.hitTime(last) + 0.04 && d < REACH + 0.5 && !yh.isDown) {
        this.plan.shift()
        if (h.strike(next, { force: true })) { this.planLast = next; this.blows.push({ by: 'him', t: h.hitTime(next), clip: next, seen: true }) }
      }
      return
    }
    if (d > REACH + 0.25) { this.plan.length = 0; this.steerTo(you.x, you.z, d > 14 ? 7.4 : d > 3.5 ? 5.4 : 2.4, dt, 2); return }
    if (!this.fightReady) { face(); return }
    // (you're down: he stands over you — a taunt now and then)
    if (yh.isDown) { face(); if ((this.cool -= dt) <= 0) { h.strike('taunt'); this.cool = 2.5 + Math.random() * 2 } return }
    // YOUR BLOW COMING (seen a fifth of a second out): one in three he does something about — covers up (the most),
    // slips back, ducks under one at his head
    for (const b of this.blows) {
      if (b.by !== 'you' || b.seen || b.t > 0.24) continue
      b.seen = true
      const r = Math.random(), B = BLOW[b.clip]
      if (r < 0.2) h.strike('block')
      else if (r < 0.29 && !B?.kick) h.strike('dodge')
      else if (r < 0.36 && B?.head) h.strike('duck')
      if (h.striking) { this.cool = Math.max(this.cool, 0.25); return }
    }
    if ((this.cool -= dt) > 0) {
      // BETWEEN RUNS he circles: sideways round you at a walk, facing you, kept at arm's length (the way changed now and then)
      if ((this.circleT -= dt) <= 0) { this.circleT = 1.2 + Math.random() * 2.2; if (Math.random() < 0.45) this.circle = -this.circle }
      const ux = dx / Math.max(d, 1e-3), uz = dz / Math.max(d, 1e-3), out = (d - REACH) * 1.6
      this.go(-uz * this.circle + ux * out, ux * this.circle + uz * out, 1.25, toYou)
      this.stuckT = 0
      return
    }
    face()
    // A RUN: one of his, by the reach (right on you: the knee)
    const run = d < 0.9 && Math.random() < 0.35 ? ['knee' as FightClip] : RUNS[Math.floor(Math.random() * RUNS.length)]
    if (h.strike(run[0])) {
      this.plan.length = 0
      for (let i = 1; i < run.length; i++) this.plan.push(run[i])
      this.planLast = run[0]
      this.blows.push({ by: 'him', t: h.hitTime(run[0]), clip: run[0], seen: true })
      this.cool = 0.55 + Math.random() * 1.1
    }
  }

  /** The blows in the air: each lands at its moment — if it's still being thrown (he wasn't hit first), the other is in
   *  reach and in front, and didn't cover up, slip back or duck in time. A hit is TAKEN as that blow is (BLOW): the
   *  two held on it for a moment, he's thrown back, the view jolts; strength gone: down. */
  private blowsStep(dt: number): void {
    const H = this.host, yh = H.you()
    for (let i = this.blows.length - 1; i >= 0; i--) {
      const b = this.blows[i]
      if ((b.t -= dt) > 0) continue
      this.blows.splice(i, 1)
      const A = b.by === 'him' ? this.hero : yh, V = b.by === 'him' ? yh : this.hero
      if (A.playing !== b.clip || !A.striking || V.isDown || this.mode !== 'foot' || !H.onFoot() || (V.state !== 'move' && V.state !== 'land')) continue
      const dx = V.pos.x - A.pos.x, dz = V.pos.z - A.pos.z, d = Math.hypot(dx, dz), B = BLOW[b.clip] ?? BLOW.jab
      if (d > (B.kick ? 1.85 : 1.55) || Math.abs(V.pos.y - A.pos.y) > 1.2) continue
      // (in front of him: within 65° of the way he faces)
      if ((dx * -Math.sin(A.heading) + dz * -Math.cos(A.heading)) / Math.max(d, 1e-3) < 0.42) continue
      const ux = dx / Math.max(d, 0.2), uz = dz / Math.max(d, 0.2), hy = V.pos.y + (B.react === 'hit_leg' ? 0.6 : B.head ? 1.6 : 1.15)
      // (out of its way: slipped back from a punch, under one at the head)
      const def = V.playing
      if ((def === 'dodge' && !B.kick) || (def === 'duck' && B.head)) continue
      this.sinceHit = 0
      // COVERED UP: taken on the arms — a fifth of it, knocked back into his guard
      if (def === 'block' || def === 'block_hit') {
        V.strike('block_hit', { force: true })
        V.push(ux * B.push * 0.5, uz * B.push * 0.5)
        A.hitStop(B.stop * 0.6); V.hitStop(B.stop * 0.6)
        H.jolt?.(B.jolt * 0.35, V.pos.x - ux * 0.3, hy, V.pos.z - uz * 0.3)
        if (b.by === 'you') { this.hp = Math.max(1, this.hp - (DMG[b.clip] ?? 10) * 0.2); this.cool = Math.max(this.cool, 0.35) }
        else this.yours = Math.max(1, this.yours - (DMG[b.clip] ?? 10) * 0.2)
        continue
      }
      this.landed[b.by]++
      A.hitStop(B.stop); V.hitStop(B.stop * 1.25)
      V.push(ux * B.push, uz * B.push)
      // (the view: yours taken shakes it hard, yours landed a little; the dust knocked out of him where it lands)
      H.jolt?.(b.by === 'him' ? Math.min(1, B.jolt * 1.5) : B.jolt * 0.75, V.pos.x - ux * 0.3, hy, V.pos.z - uz * 0.3)
      const left = b.by === 'you' ? (this.hp = Math.max(0, this.hp - (DMG[b.clip] ?? 10))) : (this.yours = Math.max(0, this.yours - (DMG[b.clip] ?? 10)))
      if (left <= 0) {
        if (b.by === 'you') { this.plan.length = 0; if (this.hero.knockdown(1.8, () => { this.hp = 100; this.cool = 0.8 })) H.toast('Enemy down') }
        else if (yh.knockdown(1.2, () => { this.yours = 100 })) H.toast('You went down')
        continue
      }
      // (a heavy one on a man already hurt: staggered)
      V.strike(B.heavy && left < 55 && Math.random() < 0.45 ? 'stagger' : B.react, { force: true })
      if (b.by === 'you') { this.plan.length = 0; this.cool = Math.max(this.cool, 0.45) }
    }
  }
  /** (the harness) the blows that landed. */
  readonly landed = { him: 0, you: 0 }

  /** His car drawn where it is — between the physics' last two steps, as yours is — and solid there. */
  private poseCar(dt: number): void {
    const on = this.carOn
    this.car.root.userData.on = on
    if (!on) { this.unsolid(); return }
    let P = this.carP, Q = this.carQ
    if (this.mode === 'car' && !Number.isNaN(this.prevP.x) && this.prevP.distanceToSquared(P) < 25) {
      const al = this.physics.pw.alpha
      P = this.drawP.lerpVectors(this.prevP, this.carP, al); Q = this.drawQ.slerpQuaternions(this.prevQ, this.carQ, al)
    }
    this.car.pose([P.x, P.y, P.z], [Q.x, Q.y, Q.z, Q.w], this.mode === 'car' ? this.carSpeed : 0, dt)
    { const sp = this.mode === 'car' ? this.carSpeed : 0; this.carVel.set(-Math.sin(this.carYaw) * sp, 0, -Math.cos(this.carYaw) * sp) }
    // (the driver: he's seen in it)
    const s = this.car.driverSeat
    if (this.mode === 'car' && s && !this.hero.seated) this.hero.sitIn(this.car.root, s.hips, () => null)
    const shape = this.car.shape
    if (!shape) return
    const pw = this.physics.pw, R = pw.R, key = `car:${this.car.id}`
    if (this.solid && this.solid.key !== key) this.unsolid()
    if (!this.solid) {
      // WHAT IS SOLID OF HIS CAR: ITS OWN SHAPE (it was the box round everything on it — its mirrors, its bars, its
      // spare wheel: an invisible layer a hand or two off its panels). The exact body as a triangle mesh — your car's
      // inner hulls, a walker, a bullet meet it — and its own inner solid, which your car's exact mesh meets (two
      // triangle meshes do not meet each other): metal on metal either way, to a couple of centimetres.
      const C = this.carP, Cq = this.carQ
      const body = pw.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(C.x, C.y, C.z).setRotation({ x: Cq.x, y: Cq.y, z: Cq.z, w: Cq.w }))
      for (const d of carSolid(R, shape)) pw.world.createCollider(d, body)
      // (its nose and its tail — the front and the back 0.6 m of it, wrapped: what `reach` tries against your car)
      // (… of 96 points each: the furthest of that end of the mesh along 96 ways round — its wrap to a centimetre or
      //  two, and never outside it. Wrapped whole — thousands of points — one try of it against your car's mesh took
      //  3.5 ms, every physics step he was near: measured.)
      const wrap = (keep: (z: number) => boolean): RAPIER.Shape | null => {
        const m = shape.mesh, N = 96, best = new Float64Array(N).fill(-Infinity), at = new Int32Array(N).fill(-1), dir = new Float64Array(N * 3)
        for (let k = 0; k < N; k++) { const y = 1 - (2 * (k + 0.5)) / N, r = Math.sqrt(1 - y * y), a = k * 2.399963; dir[k * 3] = Math.cos(a) * r; dir[k * 3 + 1] = y; dir[k * 3 + 2] = Math.sin(a) * r }
        for (let i = 0; i < m.length; i += 3) {
          if (!keep(m[i + 2])) continue
          for (let k = 0; k < N; k++) { const d = m[i] * dir[k * 3] + m[i + 1] * dir[k * 3 + 1] + m[i + 2] * dir[k * 3 + 2]; if (d > best[k]) { best[k] = d; at[k] = i } }
        }
        const pts: number[] = []
        for (const i of new Set(at)) if (i >= 0) pts.push(m[i], m[i + 1], m[i + 2])
        return pts.length >= 12 ? (R.ColliderDesc.convexHull(new Float32Array(pts))?.shape ?? null) : null
      }
      this.nose = wrap((z) => z < shape.front + 0.6)
      this.tail = wrap((z) => z > shape.rear - 0.6)
      this.solid = { body, key }
    }
  }
  /** YOUR CAR'S CCD OFF WHILE HIS IS NEAR (within 10 m; on again past 14). Rapier's CCD holds a fast body where it is
   *  for the rest of a step in which it would meet something — and his car, a hair off yours and coming on, was that
   *  something every step: your car was held (4.5 cm moved in a step its speed made 18, measured), his went on, into
   *  it — a quarter of a metre and more — and the contacts then threw both. Without it your car goes where its speed
   *  says; its inner solid pieces still keep it out of the ground. */
  private ccdOff: RAPIER.RigidBody | null = null
  private ccd(): void {
    const b = this.host.body(), you = this.host.pos()
    const near = !!b && this.carOn && Math.hypot(you.x - this.carP.x, you.z - this.carP.z) < (this.ccdOff ? 14 : 10)
    const want = near ? b : null
    if (want === this.ccdOff) return
    if (this.ccdOff) { try { this.ccdOff.enableCcd(true) } catch { /* (that body is gone: another car taken) */ } }
    if (want) want.enableCcd(false)
    this.ccdOff = want
  }
  private readonly prevP = new GFX.Vector3(NaN, 0, 0)
  private readonly prevQ = new GFX.Quaternion()
  private readonly drawP = new GFX.Vector3()
  private readonly drawQ = new GFX.Quaternion()
  private unsolid(): void {
    if (this.solid) { this.physics.pw.world.removeRigidBody(this.solid.body); this.solid = null; this.nose = this.tail = null }
  }

  // ------------------------------------------------------------------------------------------- his car's damage
  /** His car's solid body (null: none stands) — what your car's crash may have been against. */
  get carBody(): RAPIER.RigidBody | null { return this.solid ? this.solid.body : null }
  /** His car is there to be seen (its damage's effects — main.ts). */
  get carShown(): boolean { return this.carOn }
  /** How his car moves (the world's, m/s). */
  readonly carVel = new GFX.Vector3()
  private wreckT = 0
  /** HIS CAR TAKES A BLOW (Damage.ts): at (x, y, z), pushing its metal along (dx, dy, dz) — the world's —, of dv m/s.
   *  Your crash into him, his ram on you: the same blow, the other way. */
  carBlow(x: number, y: number, z: number, dx: number, dy: number, dz: number, dv: number, shot = false): void {
    const dm = this.car.damage
    if (!dm || !this.carOn) return
    const q = this.qt.copy(this.carQ).invert()
    const P = this.va.set(x, y, z).sub(this.carP).applyQuaternion(q), D = this.vb.set(dx, dy, dz).applyQuaternion(q)
    dm.hit(P.x, P.y, P.z, D.x, D.y, D.z, dv, shot ? 'shot' : 'crash')
    // (YOUR crash into him checks him: by how hard, his pace gone — his own ram has already taken its half of it)
    if (!shot && this.mode === 'car' && performance.now() / 1000 - this.rammedAt > 0.3) this.carSpeed *= Math.max(0, 1 - dv / 12)
  }
  /** His car has BLOWN UP: in it, he is thrown out and takes the blast (the enemy: most of his strength — down). */
  carBlown(): void {
    if (this.mode !== 'car') return
    this.leaveCar()
    if (this.kind !== 'enemy') return
    this.me.hit(DAMAGE.explosion.hurt, 'body', 'blast', this.va.set(-Math.cos(this.carYaw), 0, Math.sin(this.carYaw)))
  }
  /** A BLAST at (x, z), reaching r m: on foot within it, the enemy takes up to `hurt` of his strength. */
  blast(x: number, z: number, r: number, hurt: number): void {
    if (this.kind !== 'enemy' || !this.me.alive()) return
    const p = this.hero.pos, d = Math.hypot(p.x - x, p.z - z)
    if (d < r) this.me.hit(hurt * (1 - d / r), 'body', 'blast', this.va.set((p.x - x) / (d || 1), 0, (p.z - z) / (d || 1)))
  }
  /** The moment of his last ram (s on the page's clock; 0: none yet) — your car's crash just after it is his doing. */
  rammedAt = 0

  /** The physics step (60 Hz): his walk — and HIS CAR'S WAY, made here, in the same steps as your car's: the two
   *  are compared as they stand at the same instant (frame by frame, his was up to a step ahead of yours — a hand's
   *  breadth at speed), and his solid body moves a step's worth each step, whatever the frame rate. */
  fixed(dt: number): void {
    if (!this.ready) return
    this.hero.fixed(dt)
    this.prevP.copy(this.carP); this.prevQ.copy(this.carQ)
    this.ccd()
    if (this.mode === 'car' && this.placed && this.host.playing()) this.drive(dt)
    if (this.solid) {
      const P = this.carP, Q = this.carQ, b = this.solid.body, at = b.translation()
      // (brought somewhere — beside him, back onto your way: PUT there. Swept there in one step it had the speed of
      //  the whole move, and whatever it touched took that)
      if ((P.x - at.x) ** 2 + (P.y - at.y) ** 2 + (P.z - at.z) ** 2 > 1.5 * 1.5) { b.setTranslation({ x: P.x, y: P.y, z: P.z }, true); b.setRotation({ x: Q.x, y: Q.y, z: Q.z, w: Q.w }, true) }
      b.setNextKinematicTranslation({ x: P.x, y: P.y, z: P.z })
      b.setNextKinematicRotation({ x: Q.x, y: Q.y, z: Q.z, w: Q.w })
    }
  }

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
    if (this.ccdOff) { try { this.ccdOff.enableCcd(true) } catch { /* (gone) */ } this.ccdOff = null }
    this.unsolid()
    this.hero.hide()
    this.hero.root.removeFromParent(); this.hero.shadowMesh.removeFromParent()
    this.car.dispose()
    this.host.you().stance = null
    this.bar.remove()
    this.layer.remove()
  }
}
