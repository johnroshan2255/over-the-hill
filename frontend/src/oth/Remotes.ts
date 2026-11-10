import { TRAILER, TrailerModel } from './Trailer'
import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { Character } from './Character'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import { MotoBike } from './Bike'
import type { TerrainShadow } from './TerrainShadow'
import { RemoteCar } from './Vehicle'
import { FLAG_HITCHED, Kind, Slot } from '../net/pose'
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
 * SOLID: each is a kinematic body in our physics (Rapier) where it's drawn — their car a box the size of its body,
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
}

const TAG_FAR = 900 // m: no tag beyond

export class Remotes {
  private readonly avatars = new Map<number, Avatar>()
  private readonly layer: HTMLDivElement
  private readonly s = { p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], speed: 0, kind: 0 as Kind }
  private readonly v = new GFX.Vector3()
  private readonly qq = new GFX.Quaternion()
  private readonly v2 = new GFX.Vector3()

  constructor(
    private readonly session: Session,
    private readonly scene: GFX.Scene,
    private readonly map: () => MapData,
    private readonly physics: OthPhysics,
    private readonly atmos: Atmosphere,
    private readonly shadow: TerrainShadow,
    private readonly farGrid: GFX.Vector4,
    private readonly urls: { char: string; moto: string; rider: string },
  ) {
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
    this.scene.add(car.root, car.shadow)
    const tag = document.createElement('div')
    tag.className = 'oth-tag'
    tag.style.setProperty('--c', r.colour)
    const name = document.createElement('span'), dist = document.createElement('small')
    name.textContent = r.name
    tag.append(name, dist)
    this.layer.appendChild(tag)
    return { r, car, hero: null, moto: null, loading: false, tag, name, dist, kind: -1, pos: new GFX.Vector3(), heading: 0, shown: false, solidCar: null, solidMe: null, trailer: null, trailerLoading: false, solidTr: null, trailerAt: new GFX.Vector3(NaN, 0, 0), camDist: 0, inView: true, animDt: 0, animN: 0 }
  }

  /** The walker and the bike, loaded the first time this player needs them. */
  private async people(a: Avatar): Promise<void> {
    if (a.loading || a.hero) return
    a.loading = true
    const hero = new Character(this.map(), this.physics, this.atmos, this.shadow, this.farGrid)
    const moto = new MotoBike(this.map(), this.physics, this.atmos, this.shadow, this.farGrid)
    await Promise.all([hero.load(this.urls.char), moto.load(this.urls.moto, this.urls.rider)])
    if (!this.avatars.has(a.r.sid)) return
    moto.skinned = true // (the skinned walker rides it — the bike's own segment rider not drawn)
    hero.root.visible = hero.shadowMesh.visible = false
    moto.root.visible = moto.shadowMesh.visible = false
    this.scene.add(hero.root, hero.shadowMesh, moto.root, moto.shadowMesh)
    a.hero = hero
    a.moto = moto
  }

  /** A kinematic body of shape `key` (made by `make`) moved to p, q this step — made again when the shape changes. */
  private solid(cur: Solid | null, key: string, make: () => RAPIER.ColliderDesc, p: readonly number[], q: readonly number[]): Solid {
    const pw = this.physics.pw
    if (cur && cur.key !== key) { pw.world.removeRigidBody(cur.body); cur = null }
    if (!cur) {
      const body = pw.world.createRigidBody(pw.R.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1], p[2]).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }))
      pw.world.createCollider(make().setCollisionGroups(group(Groups.Static, 0xffff)).setFriction(0.8), body)
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
    const t = S.drawTick(), s = this.s
    for (const r of S.remotes.values()) {
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
      if (kind === Kind.Foot || kind === Kind.Moto) void this.people(a)
      // the car: driven (the player entity), or parked (their second entity)
      if (kind === Kind.Jeep || kind === Kind.E30) {
        void a.car.setCar(kind === Kind.Jeep ? r.car || 'offroader' : 'e30', r.colour)
        a.car.pose(s.p, s.q, s.speed, dt)
      } else if (parked?.last) {
        const ps = { p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], speed: 0, kind: 0 as Kind }
        parked.at(t, ps)
        void a.car.setCar(ps.kind === Kind.E30 ? 'e30' : r.car || 'offroader', r.colour)
        a.car.pose(ps.p, ps.q, 0, dt)
      }
      a.car.root.userData.on = kind === Kind.Jeep || kind === Kind.E30 || !!parked?.last
      const box = a.car.box, R = this.physics.pw.R
      if (a.car.root.userData.on && box) {
        const cp = a.car.root.position, cq = a.car.root.quaternion
        a.solidCar = this.solid(a.solidCar, `car:${a.car.id}`, () => R.ColliderDesc.cuboid(box.h.x, box.h.y, box.h.z).setTranslation(box.c.x, box.c.y, box.c.z), [cp.x, cp.y, cp.z], [cq.x, cq.y, cq.z, cq.w])
      } else a.solidCar = this.unsolid(a.solidCar)
      if (kind === Kind.Foot) a.solidMe = this.solid(a.solidMe, 'foot', () => R.ColliderDesc.capsule(0.55, 0.3).setTranslation(0, 0.85, 0), s.p, [0, 0, 0, 1])
      else if (kind === Kind.Moto) a.solidMe = this.solid(a.solidMe, 'moto', () => R.ColliderDesc.cuboid(0.3, 0.55, 1.0).setTranslation(0, 0.6, 0), s.p, s.q)
      else a.solidMe = this.unsolid(a.solidMe)
      // their TRAILER: where they say, its wheels turning by how far it went, its jockey wheel up when it's hitched
      const tt = r.tracks.get(Slot.Trailer)
      if (tt?.last) {
        if (!a.trailer && !a.trailerLoading) {
          a.trailerLoading = true
          const m = new TrailerModel()
          void m.load(this.atmos, this.shadow, this.farGrid).then(() => { a.trailer = m; this.scene.add(m.root) })
        }
        const ps = { p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], speed: 0, kind: 0 as Kind }
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
        a.solidTr = this.solid(a.solidTr, 'trailer', () => R.ColliderDesc.cuboid(TRAILER.bedW / 2, 0.25, TRAILER.bedL / 2).setTranslation(0, TRAILER.floor + 0.05, 0), ps.p, ps.q)
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
        if (kind === Kind.Foot) hero.puppet(s.p[0], s.p[1], s.p[2], a.heading, s.speed, dt)
        else if (kind !== Kind.Moto && hero.visible) hero.hide()
        // (ANIMATION LOD: the skeleton posed every frame near, every 2nd beyond 30 m, every 4th beyond 80 m, never out of
        //  view — a frame's skipped time carried to the next; its place kept up every frame)
        a.animDt += dt
        const every = !a.inView ? 0 : a.camDist < 30 ? 1 : a.camDist < 80 ? 2 : 4
        if (hero.visible && every && ++a.animN >= every) { hero.update(a.animDt); a.animDt = 0; a.animN = 0 }
        else if (hero.visible) { hero.root.position.copy(hero.pos); hero.root.updateMatrixWorld(true) }
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
  }
}
