import { TRAILER, TrailerModel } from './Trailer'
import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { Character } from './Character'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import { MotoBike } from './Bike'
import type { TerrainShadow } from './TerrainShadow'
import { carSolid, RemoteCar } from './Vehicle'
import { DAMAGE_ON } from './Damage'
import type { DentKind } from '../net/wire'
import { FLAG_AIM, FLAG_HITCHED, Kind, Slot } from '../net/pose'
import { RemoteHold, type Target, weaponMaterial } from './Weapons'
import { group, Groups } from '../physics/PhysicsWorld'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Remote, Session } from '../net/Session'

/**
 * THE OTHER PLAYERS (co-op — docs/MULTIPLAYER.md): each drawn as they are — in their car (the same models as ours, in
 * their colour), on the motorbike with the rider on it, or on foot (the same walker, its stride by their speed) with
 * their car parked where they left it. Posed from the session's smoothed poses (net/Session.ts) every frame; a NAME TAG
 * over each (their colour, the distance), fading with distance.
 *
 * Built only when first needed (a walker's and a bike's models load the first time someone is on foot / riding) and
 * dropped when they leave. Each costs what ours does: the car three draws, the walker one (GPU skinning), the bike one.
 *
 * ARMED (co-op weapons — docs/WEAPONS.md): what they hold in their hands (the `armed` event), raised when their pose
 * says they aim, posed by the same code as yours (Weapons.ts RemoteHold); their shots' flash; down (the server's
 * `down`), the fall held till they're `up`. On foot each is a TARGET for our bullets: a hit is sent to the server, which
 * checks it and takes the health (backend/src/weapons.rs) — nothing is taken here.
 *
 * SOLID: each is a kinematic body in our physics (Rapier) where it's drawn — their car its own shape (Vehicle.carSolid),
 * their walker a capsule, their bike a narrow box — in the Static group: our car hits it and is pushed by it, our
 * walker can't walk through it (and can stand on its roof).
 */
interface Solid { body: RAPIER.RigidBody; key: string }
interface Avatar {
  r: Remote
  car: RemoteCar
  hero: Character | null
  moto: InstanceType<typeof MotoBike> | null
  loading: boolean
  tag: HTMLDivElement
  name: HTMLSpanElement
  dist: HTMLElement
  /** What they're on now (the player entity's kind), -1 none. */
  kind: number
  /** Where they are (for the map, the radar, the tags). */
  pos: GFX.Vector3
  heading: number
  shown: boolean
  /** From the last cull: the camera's distance; the walker or the bike in view (the animation LOD). */
  camDist: number
  inView: boolean
  animDt: number
  animN: number
  /** Its kinematic bodies: the car, and the player (on foot / the bike). */
  solidCar: Solid | null
  solidMe: Solid | null
  /** Their trailer (Trailer.ts' model alone), its body solid; made the first time they have one. */
  trailer: TrailerModel | null
  trailerLoading: boolean
  solidTr: Solid | null
  trailerAt: GFX.Vector3
  /** What they hold (made with their walker); our bullets' target while they're on foot. */
  hold: RemoteHold | null
  target: Target
}

const TAG_FAR = 900 // m: no tag beyond
/** Another's solids made within SOLID_NEAR m of us, let go past SOLID_FAR (Remotes.ourDist). */
const SOLID_NEAR = 120, SOLID_FAR = 160

export class Remotes {
  private readonly avatars = new Map<number, Avatar>()
  private readonly layer: HTMLDivElement
  private readonly s = { p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], speed: 0, kind: 0 as Kind }
  /** (scratch: a parked car's, a trailer's pose — one a frame each, not a new object per player per frame) */
  private readonly ps = { p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], speed: 0, kind: 0 as Kind }
  private readonly v = new GFX.Vector3()
  private readonly qq = new GFX.Quaternion()
  private readonly v2 = new GFX.Vector3()
  private readonly weaponMat: GFX.ShaderMaterial
  private readonly arms = new GFX.Group()

  constructor(
    private readonly session: Session,
    private readonly scene: GFX.Scene,
    private readonly map: () => MapData,
    private readonly physics: OthPhysics,
    private readonly atmos: Atmosphere,
    private readonly shadow: TerrainShadow,
    private readonly farGrid: GFX.Vector4,
    private readonly urls: { char: string; moto: string; rider: string; fight?: string },
  ) {
    this.weaponMat = weaponMaterial(atmos, shadow, farGrid)
    scene.add(this.arms)
    this.layer = document.createElement('div')
    this.layer.className = 'oth-tags'
    document.body.appendChild(this.layer)
  }

  /** Everyone else, for the map and the radar. */
  get list(): { x: number; z: number; heading: number; colour: string; name: string }[] {
    const out = []
    for (const a of this.avatars.values()) if (a.shown) out.push({ x: a.pos.x, z: a.pos.z, heading: a.heading, colour: a.r.colour, name: a.r.name })
    return out
  }

  private make(r: Remote): Avatar {
    const car = new RemoteCar(this.map(), this.atmos, this.shadow, this.farGrid)
    // (their car's damage: the blows their game tells of — dent)
    car.damageOn = DAMAGE_ON
    this.scene.add(car.root, car.shadow)
    const tag = document.createElement('div')
    tag.className = 'oth-tag'
    tag.style.setProperty('--c', r.colour)
    const name = document.createElement('span'), dist = document.createElement('small')
    name.textContent = r.name
    tag.append(name, dist)
    this.layer.appendChild(tag)
    const pos = new GFX.Vector3()
    const a: Avatar = { r, car, hero: null, moto: null, loading: false, tag, name, dist, kind: -1, pos, heading: 0, shown: false, solidCar: null, solidMe: null, trailer: null, trailerLoading: false, solidTr: null, trailerAt: new GFX.Vector3(NaN, 0, 0), camDist: 0, inView: true, animDt: 0, animN: 0, hold: null,
      target: {
        id: `player:${r.sid}`,
        pos,
        alive: () => a.shown && a.kind === Kind.Foot && !a.r.down && !!a.hero?.visible,
        // (the server takes the health, from the spec, if it agrees — and tells everyone)
        hit: (_damage, zone, weapon, _dir, dist) => this.session.hit(r.sid, weapon, zone, dist ?? 0),
      } }
    return a
  }

  /** Who our bullets can hit: everyone on foot and up. */
  targets(): Target[] {
    const out: Target[] = []
    for (const a of this.avatars.values()) if (a.target.alive()) out.push(a.target)
    return out
  }

  /** Dents told before their car was in (a newcomer hears them all at once). */
  private readonly pendingDents = new Map<number, [number, number, number, number, number, number, number, DentKind][]>()
  /** A BLOW TO THEIR CAR (the `dent` event — in its own space, as their game took it), or its repair. */
  dent(sid: number, px: number, py: number, pz: number, dx: number, dy: number, dz: number, dv: number, kind: DentKind): void {
    const dm = this.avatars.get(sid)?.car.damage
    // (their car not loaded yet — a newcomer is told every dent at once: kept till it is)
    if (!dm) { const q = this.pendingDents.get(sid) ?? []; if (kind === 'repair') q.length = 0; else if (q.length < 64) q.push([px, py, pz, dx, dy, dz, dv, kind]); this.pendingDents.set(sid, q); return }
    if (kind === 'repair') dm.repair()
    else dm.hit(px, py, pz, dx, dy, dz, dv, kind)
  }
  /** Their cars with damage on them, as drawn (main.ts: the smoke, the fire, the pieces — DamageFx). */
  *damaged(): Generator<{ car: RemoteCar; vx: number; vz: number }> {
    for (const a of this.avatars.values()) if (a.car.damage && a.car.root.userData.on && a.shown) yield { car: a.car, vx: 0, vz: 0 }
  }
  /** Their shot left (the `shot` event): the kick, the flash at their muzzle. */
  fired(sid: number): void {
    this.avatars.get(sid)?.hold?.fire()
  }

  /** The walker and the bike, loaded the first time this player needs them. */
  private async people(a: Avatar): Promise<void> {
    if (a.loading || a.hero) return
    a.loading = true
    const hero = new Character(this.map(), this.physics, this.atmos, this.shadow, this.farGrid)
    const moto = new MotoBike(this.map(), this.physics, this.atmos, this.shadow, this.farGrid)
    await Promise.all([hero.load(this.urls.char), moto.load(this.urls.moto, this.urls.rider)])
    // (the fight's clips: the fall when they're down)
    if (this.urls.fight) await hero.loadClips(this.urls.fight).catch(() => {})
    if (!this.avatars.has(a.r.sid)) return
    a.hold = new RemoteHold(hero, this.arms, this.weaponMat)
    moto.skinned = true // (the skinned walker rides it — the bike's own segment rider not drawn)
    hero.root.visible = hero.shadowMesh.visible = false
    moto.root.visible = moto.shadowMesh.visible = false
    this.scene.add(hero.root, hero.shadowMesh, moto.root, moto.shadowMesh)
    a.hero = hero
    a.moto = moto
  }

  /** OURS (main.ts): our car's body in plan (its middle, heading, half width and length) and our walker — another
   *  player's solid is made only once it's clear of them. Everyone in a world starts on the same track: the last to
   *  come spawned INSIDE the others' cars, solid in its physics, and the solver threw its car 850 m (measured,
   *  scripts/harness/syncplay.mjs, 2026-11-24). Claims' flag pole keeps the same rule. */
  ours: (() => { car: { x: number; z: number; h: number; hx: number; hz: number } | null; me: GFX.Vector3 | null }) | null = null
  /** The plan's box at (x, z), heading h (−z forward turned by h), half sizes hx × hz: clear of our car (and 0.3 m) and
   *  of our walker? */
  private clear(x: number, z: number, h: number, hx: number, hz: number): boolean {
    const o = this.ours?.()
    if (!o) return true
    if (o.me) {
      // (the walker: a circle of 0.6 m against the box)
      const dx = o.me.x - x, dz = o.me.z - z, c = Math.cos(h), sn = Math.sin(h)
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c
      const qx = Math.max(Math.abs(lx) - hx, 0), qz = Math.max(Math.abs(lz) - hz, 0)
      if (qx * qx + qz * qz < 0.6 * 0.6) return false
    }
    const b = o.car
    if (!b) return true
    // (two boxes in plan, by their four axes: apart along any one — clear)
    const ax = [[Math.cos(h), -Math.sin(h)], [Math.sin(h), Math.cos(h)], [Math.cos(b.h), -Math.sin(b.h)], [Math.sin(b.h), Math.cos(b.h)]]
    const dx = b.x - x, dz = b.z - z, M = 0.3
    for (const [ux, uz] of ax) {
      const ra = hx * Math.abs(ux * Math.cos(h) - uz * Math.sin(h)) + hz * Math.abs(ux * Math.sin(h) + uz * Math.cos(h))
      const rb = b.hx * Math.abs(ux * Math.cos(b.h) - uz * Math.sin(b.h)) + b.hz * Math.abs(ux * Math.sin(b.h) + uz * Math.cos(b.h))
      if (Math.abs(dx * ux + dz * uz) > ra + rb + M) return true
    }
    return false
  }
  /** NEAR US (m to our car or us — the nearer): another's solids are made within SOLID_NEAR, let go past SOLID_FAR.
   *  A car's exact solid took 6.8 ms to make on the Mac (several times that on a phone): made for everyone the moment
   *  they came, however far — a stall for each player joining, 2 km off where nothing could touch it. */
  private ourDist(x: number, z: number): number {
    const o = this.ours?.()
    if (!o) return 0
    let d = Infinity
    if (o.car) d = Math.hypot(o.car.x - x, o.car.z - z)
    if (o.me) d = Math.min(d, Math.hypot(o.me.x - x, o.me.z - z))
    return d
  }
  /** Where their cars (driven or parked) and walkers stand — a newcomer's car is set down clear of them (main.ts). */
  occupied(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = []
    for (const a of this.avatars.values()) {
      if (a.car.root.userData.on) { const b = a.car.box; out.push({ x: a.car.root.position.x, z: a.car.root.position.z, r: b ? Math.hypot(b.h.x, b.h.z) : 2.6 }) }
      if (a.shown && a.kind === Kind.Foot) out.push({ x: a.pos.x, z: a.pos.z, r: 0.6 })
    }
    return out
  }

  /** A kinematic body of shape `key` (made by `make`: one shape in the Static group, or its own list, groups set) moved
   *  to p, q this step — made again when the shape changes. Not made while `free` says it would stand in something of
   *  ours (null then: tried again next frame). */
  private solid(cur: Solid | null, key: string, make: () => RAPIER.ColliderDesc | RAPIER.ColliderDesc[], p: readonly number[], q: readonly number[], free?: () => boolean): Solid | null {
    const pw = this.physics.pw
    if (cur && cur.key !== key) { pw.world.removeRigidBody(cur.body); cur = null }
    if (!cur && free && !free()) return null
    if (!cur) {
      const body = pw.world.createRigidBody(pw.R.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1], p[2]).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }))
      const m = make()
      for (const d of Array.isArray(m) ? m : [m.setCollisionGroups(group(Groups.Static, 0xffff)).setFriction(0.8)]) pw.world.createCollider(d, body)
      cur = { body, key }
    }
    cur.body.setNextKinematicTranslation({ x: p[0], y: p[1], z: p[2] })
    cur.body.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
    return cur
  }

  private unsolid(b: Solid | null): null {
    if (b) this.physics.pw.world.removeRigidBody(b.body)
    return null
  }

  private drop(a: Avatar): void {
    a.solidCar = this.unsolid(a.solidCar)
    a.solidMe = this.unsolid(a.solidMe)
    a.solidTr = this.unsolid(a.solidTr)
    a.trailer?.root.removeFromParent()
    a.car.dispose()
    a.hold?.dispose()
    if (a.hero) { a.hero.hide(); a.hero.root.removeFromParent(); a.hero.shadowMesh.removeFromParent() }
    if (a.moto) { a.moto.root.removeFromParent(); a.moto.shadowMesh.removeFromParent() }
    a.tag.remove()
  }

  /** Every frame (after our own update): everyone posed where the session says they are. */
  /** (the cost A/B — scripts/harness/coopcost.mjs) nobody drawn or posed */
  off = false

  update(dt: number): void {
    if (this.off) return
    const S = this.session
    for (const [sid, a] of this.avatars) if (!S.remotes.has(sid)) { this.drop(a); this.avatars.delete(sid) }
    const s = this.s, now = performance.now()
    for (const r of S.remotes.values()) {
      const t = S.drawTickOf(r, now)
      let a = this.avatars.get(r.sid)
      if (!a) this.avatars.set(r.sid, (a = this.make(r)))
      const me = r.tracks.get(Slot.Player), parked = r.tracks.get(Slot.ParkedCar)
      a.shown = !!me?.last
      if (!me?.last) { a.kind = -1; continue }
      me.at(t, s)
      const kind: number = s.kind
      a.kind = kind
      a.pos.set(s.p[0], s.p[1], s.p[2])
      this.qq.set(s.q[0], s.q[1], s.q[2], s.q[3])
      this.v.set(0, 0, -1).applyQuaternion(this.qq)
      a.heading = Math.atan2(-this.v.x, -this.v.z)
      // (on foot, aimed: the rotation carries the aim's pitch too)
      const pitch = Math.asin(Math.max(-1, Math.min(1, this.v.y)))
      if (kind === Kind.Foot || kind === Kind.Moto) void this.people(a)
      // the car: driven (the player entity), or parked (their second entity)
      if (kind === Kind.Jeep || kind === Kind.E30) {
        void a.car.setCar(kind === Kind.Jeep ? r.car || 'offroader' : 'e30', r.colour)
        a.car.pose(s.p, s.q, s.speed, dt)
      } else if (parked?.last) {
        const ps = this.ps
        parked.at(t, ps)
        void a.car.setCar(ps.kind === Kind.E30 ? 'e30' : r.car || 'offroader', r.colour)
        a.car.pose(ps.p, ps.q, 0, dt)
      }
      a.car.root.userData.on = kind === Kind.Jeep || kind === Kind.E30 || !!parked?.last
      { const q = this.pendingDents.get(r.sid), dm = a.car.damage
        if (q && dm) { for (const d of q) dm.hit(d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7] === 'shot' ? 'shot' : 'crash'); this.pendingDents.delete(r.sid) } }
      // (their car's own shape — its panels, not the box round its mirrors and bars: Vehicle.carSolid, as the enemy's)
      const shape = a.car.shape, box = a.car.box, R = this.physics.pw.R
      const cd = this.ourDist(a.car.root.position.x, a.car.root.position.z)
      if (a.car.root.userData.on && (shape || box) && cd < (a.solidCar ? SOLID_FAR : SOLID_NEAR)) {
        const cp = a.car.root.position, cq = a.car.root.quaternion
        a.solidCar = this.solid(a.solidCar, `car:${a.car.id}:${shape ? 'shape' : 'box'}`, () => (shape ? carSolid(R, shape, 0.8) : R.ColliderDesc.cuboid(box!.h.x, box!.h.y, box!.h.z).setTranslation(box!.c.x, box!.c.y, box!.c.z)), [cp.x, cp.y, cp.z], [cq.x, cq.y, cq.z, cq.w], () => {
          const bb = box ?? { c: { x: 0, z: 0 }, h: { x: 1, z: 2.3 } }, fw = this.v2.set(0, 0, -1).applyQuaternion(cq), h = Math.atan2(-fw.x, -fw.z)
          const c = Math.cos(h), sn = Math.sin(h)
          return this.clear(cp.x + bb.c.x * c + bb.c.z * sn, cp.z - bb.c.x * sn + bb.c.z * c, h, bb.h.x, bb.h.z)
        })
      } else a.solidCar = this.unsolid(a.solidCar)
      const md = this.ourDist(s.p[0], s.p[2])
      if (md > (a.solidMe ? SOLID_FAR : SOLID_NEAR)) a.solidMe = this.unsolid(a.solidMe)
      else if (kind === Kind.Foot) a.solidMe = this.solid(a.solidMe, 'foot', () => R.ColliderDesc.capsule(0.55, 0.3).setTranslation(0, 0.85, 0), s.p, [0, 0, 0, 1], () => this.clear(s.p[0], s.p[2], 0, 0.3, 0.3))
      else if (kind === Kind.Moto) a.solidMe = this.solid(a.solidMe, 'moto', () => R.ColliderDesc.cuboid(0.3, 0.55, 1.0).setTranslation(0, 0.6, 0), s.p, s.q, () => this.clear(s.p[0], s.p[2], a.heading, 0.3, 1.0))
      else a.solidMe = this.unsolid(a.solidMe)
      // their TRAILER: where they say, its wheels turning by how far it went, its jockey wheel up when it's hitched
      const tt = r.tracks.get(Slot.Trailer)
      if (tt?.last) {
        if (!a.trailer && !a.trailerLoading) {
          a.trailerLoading = true
          const m = new TrailerModel()
          void m.load(this.atmos, this.shadow, this.farGrid).then(() => { a.trailer = m; this.scene.add(m.root) })
        }
        const ps = this.ps
        tt.at(t, ps)
        if (a.trailer) {
          const m = a.trailer
          m.root.visible = true
          m.root.position.set(ps.p[0], ps.p[1], ps.p[2]); m.root.quaternion.set(ps.q[0], ps.q[1], ps.q[2], ps.q[3]); m.root.updateMatrixWorld(true)
          const d = Number.isNaN(a.trailerAt.x) ? 0 : this.v.set(0, 0, -1).applyQuaternion(m.root.quaternion).dot(this.v2.copy(m.root.position).sub(a.trailerAt))
          a.trailerAt.copy(m.root.position)
          m.animate(d, !!(tt.last.flags & FLAG_HITCHED), dt)
        }
        const R = this.physics.pw.R
        if (this.ourDist(ps.p[0], ps.p[2]) > (a.solidTr ? SOLID_FAR : SOLID_NEAR)) a.solidTr = this.unsolid(a.solidTr)
        else a.solidTr = this.solid(a.solidTr, 'trailer', () => R.ColliderDesc.cuboid(TRAILER.bedW / 2, 0.25, TRAILER.bedL / 2).setTranslation(0, TRAILER.floor + 0.05, 0), ps.p, ps.q, () => { const fw = this.v2.set(0, 0, -1).applyQuaternion(this.qq.set(ps.q[0], ps.q[1], ps.q[2], ps.q[3])); return this.clear(ps.p[0], ps.p[2], Math.atan2(-fw.x, -fw.z), TRAILER.bedW / 2, TRAILER.bedL / 2) })
      } else {
        if (a.trailer) a.trailer.root.visible = false
        a.solidTr = this.unsolid(a.solidTr)
      }
      const hero = a.hero, moto = a.moto
      if (moto) {
        if (kind === Kind.Moto) {
          moto.puppet(s.p[0], s.p[1], s.p[2], s.q[0], s.q[1], s.q[2], s.q[3], a.heading)
          if (hero && !hero.ridingOn(moto.root)) hero.rideOn(moto)
        } else if (moto.root.visible) { moto.root.visible = moto.shadowMesh.visible = false }
      }
      if (hero) {
        if (kind === Kind.Foot) {
          hero.puppetDown(a.r.down)
          hero.puppet(s.p[0], s.p[1], s.p[2], a.heading, s.speed, dt)
        } else {
          hero.puppetDown(false)
          if (kind !== Kind.Moto && hero.visible) hero.hide()
        }
        // (what they hold: raised when they aim, at the pitch their pose carries — set before they're posed)
        const aimed = kind === Kind.Foot && !!((me.last.flags ?? 0) & FLAG_AIM)
        a.hold?.set(a.r.weapon)
        a.hold?.update(dt, aimed, aimed ? pitch : 0, kind === Kind.Foot && !a.r.down)
        // (ANIMATION LOD: the skeleton posed every frame near, every 2nd beyond 30 m, every 4th beyond 80 m, never out of
        //  view — a frame's skipped time carried to the next; its place kept up every frame)
        a.animDt += dt
        const every = !a.inView ? 0 : a.camDist < 30 ? 1 : a.camDist < 80 ? 2 : 4
        if (hero.visible && every && ++a.animN >= every) { hero.update(a.animDt); a.animDt = 0; a.animN = 0 }
        else if (hero.visible) { hero.root.position.copy(hero.pos); hero.root.updateMatrixWorld(true) }
        a.hold?.place()
      }
    }
  }

  /** Drawn only what's in view and not behind the hills; the name tags placed. */
  cull(view: GFX.Frustum, horizon: Horizon, camera: GFX.PerspectiveCamera, w: number, h: number): void {
    if (this.off) {
      for (const a of this.avatars.values()) {
        a.car.root.visible = a.car.shadow.visible = false
        if (a.hero) a.hero.root.visible = a.hero.shadowMesh.visible = false
        if (a.moto) a.moto.root.visible = a.moto.shadowMesh.visible = false
        a.tag.style.display = "none"
      }
      return
    }
    for (const a of this.avatars.values()) {
      a.car.cull(view, horizon, !!a.car.root.userData.on && a.shown)
      if (a.hero?.visible) a.hero.cull(view, horizon)
      if (a.moto && a.kind === Kind.Moto) a.moto.cull(view, horizon)
      // the tag: over the head / the roof, its size and fade by the distance
      const d = a.shown ? camera.position.distanceTo(a.pos) : Infinity
      a.camDist = d
      a.inView = !!(a.hero?.root.visible || a.moto?.root.visible)
      if (d > TAG_FAR) { if (a.tag.style.display !== 'none') a.tag.style.display = 'none'; continue }
      this.v.copy(a.pos)
      this.v.y += a.kind === Kind.Foot ? 2.3 : a.kind === Kind.Moto ? 2.2 : 2.9
      this.v.project(camera)
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) { if (a.tag.style.display !== 'none') a.tag.style.display = 'none'; continue }
      if (a.tag.style.display === 'none') a.tag.style.display = ''
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h
      const k = Math.max(0.55, Math.min(1, 60 / Math.max(d, 1)))
      a.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(3)})`
      a.tag.style.opacity = (1 - Math.max(0, (d - TAG_FAR * 0.6) / (TAG_FAR * 0.4))).toFixed(2)
      const label = d < 40 ? '' : `${Math.round(d)} m`
      if (a.dist.textContent !== label) a.dist.textContent = label
    }
  }

  dispose(): void {
    for (const a of this.avatars.values()) this.drop(a)
    this.avatars.clear()
    this.layer.remove()
    this.arms.removeFromParent()
  }
}
