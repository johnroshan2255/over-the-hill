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
import { group, Groups, STATIC_MESH_FILTER } from '../physics/PhysicsWorld'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Remote, Session } from '../net/Session'
import { holdOther, isGun, type Model, standOther, type Target, type WeaponId, type Zone, weaponMaterial, weaponModel } from './Weapons'
import type { WireWeapon } from '../net/wire'

/**
 * THE OTHER PLAYERS (co-op — docs/MULTIPLAYER.md): each drawn as they are — in their car (the same models as ours, in
 * their colour), on the motorbike with the rider on it, or on foot (the same walker, its stride by their speed) with
 * their car parked where they left it. Posed from the session's smoothed poses (net/Session.ts) every frame; a NAME TAG
 * over each (their colour, the distance), fading with distance.
 *
 * Built only when first needed (a walker's and a bike's models load the first time someone is on foot / riding) and
 * dropped when they leave. Each costs what ours does: the car three draws, the walker one (GPU skinning), the bike one.
 *
 * ARMED (docs/WEAPONS.md, co-op): what each holds is drawn in their hands by the same hold as ours in third person
 * (Weapons.ts `holdOther`: carried — GTA's —, up for a second after each shot, at that shot's pitch, kicked by it); a
 * hit staggers them, down they lie till the server's `up`; their health a bar under their name. On foot each is a TARGET
 * of our weapons (`targets`): a hit is sent to the server, which checks it and takes the health.
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
  /** In their hands: each weapon's model (made the first time they hold it), the gun's kick and pitch, the holds. */
  arms: { models: Map<WeaponId, Model>; w: WeaponId | null; recoil: number; pitch: number; shotAt: number; k: number; clips: boolean; posed: boolean; gunL: GFX.Matrix4; ik: () => void }
  target: Target
  hpBar: HTMLElement
  hpShown: number
}

/** WHAT IS SOLID OF A PLAYER'S CAR: ITS OWN SHAPE (NEXT_damage §2.7 — it was the box round everything on it: mirrors,
 *  bars, a spare wheel, an invisible layer a hand or two off its panels; the enemy's car had the same and lost it,
 *  Companion.poseCar). The exact body as a triangle mesh — your car's inner pieces, a walker, a bullet meet it — and its
 *  inner pieces joined into 0.6 m sections, which your car's exact mesh meets (two triangle meshes do not meet each
 *  other; a thin shell slips between small pieces): metal on metal either way, to a couple of centimetres. */
function carPieces(R: typeof RAPIER, shape: { mesh: Float32Array; hulls: Float32Array[]; front: number; rear: number }): { desc: RAPIER.ColliderDesc; groups: number }[] {
  const out: { desc: RAPIER.ColliderDesc; groups: number }[] = []
  const idx = new Uint32Array(shape.mesh.length / 3)
  for (let i = 0; i < idx.length; i++) idx[i] = i
  out.push({ desc: R.ColliderDesc.trimesh(shape.mesh, idx), groups: group(Groups.Static | Groups.StaticMesh, STATIC_MESH_FILTER) })
  const all: number[] = []
  for (const h of shape.hulls) for (let i = 0; i < h.length; i++) all.push(h[i])
  const L = 0.6, nSec = Math.max(1, Math.ceil((shape.rear - shape.front) / L))
  for (let k = 0; k < nSec; k++) {
    const z0 = shape.front + k * L - 0.04, z1 = shape.front + (k + 1) * L + 0.04, pts: number[] = []
    for (let i = 0; i < all.length; i += 3) if (all[i + 2] >= z0 && all[i + 2] <= z1) pts.push(all[i], all[i + 1], all[i + 2])
    const d = pts.length >= 12 ? R.ColliderDesc.convexHull(new Float32Array(pts)) : null
    if (d) out.push({ desc: d, groups: group(Groups.Static, Groups.VehicleMesh) })
  }
  return out
}

const TAG_FAR = 900 // m: no tag beyond

export class Remotes {
  private readonly avatars = new Map<number, Avatar>()
  private readonly layer: HTMLDivElement
  private readonly s = { p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], speed: 0, kind: 0 as Kind }
  private readonly v = new GFX.Vector3()
  private readonly qq = new GFX.Quaternion()
  private readonly v2 = new GFX.Vector3()
  private wmat: GFX.ShaderMaterial | null = null
  private readonly armsGroup = new GFX.Group()
  private readonly unlisten: () => void
  /** (the harness) what we've claimed to hit, by weapon. */
  readonly sent: Record<string, number> = {}

  constructor(
    private readonly session: Session,
    private readonly scene: GFX.Scene,
    private readonly map: () => MapData,
    private readonly physics: OthPhysics,
    private readonly atmos: Atmosphere,
    private readonly shadow: TerrainShadow,
    private readonly farGrid: GFX.Vector4,
    private readonly urls: { char: string; moto: string; rider: string; fight: string },
  ) {
    this.layer = document.createElement('div')
    this.layer.className = 'oth-tags'
    document.body.appendChild(this.layer)
    scene.add(this.armsGroup)
    // THE FIGHT as the server tells it: a shot's kick, a hit's stagger, down and up
    this.unlisten = session.on((e) => {
      if (e.t !== 'shot' && e.t !== 'health' && e.t !== 'down' && e.t !== 'up' && e.t !== 'armed') return
      const a = this.avatars.get(e.sid)
      if (!a) return
      if (e.t === 'armed') { if (e.weapon !== 'fists') this.fightClips(a); return }
      const h = a.hero
      if (e.t === 'shot') { a.arms.recoil = 1; a.arms.shotAt = performance.now(); a.arms.pitch = Math.asin(Math.max(-0.9, Math.min(0.9, e.dy))) }
      else if (e.t === 'health') {
        this.fightClips(a)
        if (e.hp > 0 && e.by && !h?.striking) h?.puppetStrike(e.zone === 'head' ? 'hit_head' : 'hit_body')
      } else if (e.t === 'down') { this.fightClips(a); h?.knockdown(600) }
      else if (e.t === 'up') h?.standUp()
    })
  }

  /** Their fight's clips (the staggers, the fall): loaded the first time they're armed or hit. */
  private fightClips(a: Avatar): void {
    if (a.arms.clips || !a.hero) return
    a.arms.clips = true
    void a.hero.loadClips(this.urls.fight).then(() => { if (a.r.down && a.hero && !a.hero.isDown) a.hero.knockdown(600) })
  }

  /** EVERYONE ELSE ON FOOT, as our weapons see them (Weapons.ts `Target`): a hit is told to the server with how far
   *  they were from `me` — it checks it against their poses and takes the health; we take nothing ourselves. */
  targets(me: GFX.Vector3): Target[] {
    const out: Target[] = []
    for (const a of this.avatars.values()) {
      if (!a.shown || a.kind !== Kind.Foot || a.r.down || !a.hero) continue
      a.target.pos.copy(a.pos)
      ;(a.target as { me?: GFX.Vector3 }).me = me
      out.push(a.target)
    }
    return out
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
    // (their health: a thin bar under the name, shown while it isn't whole)
    const hpBar = document.createElement('i')
    hpBar.style.cssText = 'display:none;height:3px;margin:2px auto 0;background:var(--c, #e0a040);width:60px;box-shadow:0 0 0 1px rgba(0,0,0,.6)'
    tag.append(name, dist, hpBar)
    this.layer.appendChild(tag)
    const S = this.session
    const target: Target & { me?: GFX.Vector3 } = {
      id: `p:${r.sid}`,
      pos: new GFX.Vector3(),
      alive: () => !r.down && !S.closed,
      hit: (_damage: number, zone: Zone, weapon: string) => {
        const d = target.me ? target.me.distanceTo(target.pos) : 0
        S.hit(r.sid, weapon as WireWeapon, zone, d)
        this.sent[weapon] = (this.sent[weapon] ?? 0) + 1
      },
    }
    const arms: Avatar['arms'] = { models: new Map(), w: null, recoil: 0, pitch: 0, shotAt: -1e9, k: 0, clips: false, posed: false, gunL: new GFX.Matrix4(), ik: () => {} }
    // (asked as their walker is posed: the gun's place in his space, his hands on it)
    arms.ik = () => { const h = this.avatars.get(r.sid)?.hero; if (h && arms.w) { holdOther(h, arms.w, arms.pitch, arms.k, arms.recoil, arms.gunL); arms.posed = true } }
    return { hpBar, hpShown: 100, target, arms, r, car, hero: null, moto: null, loading: false, tag, name, dist, kind: -1, pos: new GFX.Vector3(), heading: 0, shown: false, solidCar: null, solidMe: null, trailer: null, trailerLoading: false, solidTr: null, trailerAt: new GFX.Vector3(NaN, 0, 0), camDist: 0, inView: true, animDt: 0, animN: 0 }
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
  private solid(cur: Solid | null, key: string, make: () => RAPIER.ColliderDesc | { desc: RAPIER.ColliderDesc; groups: number }[], p: readonly number[], q: readonly number[]): Solid {
    const pw = this.physics.pw
    if (cur && cur.key !== key) { pw.world.removeRigidBody(cur.body); cur = null }
    if (!cur) {
      const body = pw.world.createRigidBody(pw.R.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1], p[2]).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }))
      const m = make()
      if (Array.isArray(m)) for (const c of m) pw.world.createCollider(c.desc.setCollisionGroups(c.groups).setFriction(0.6), body)
      else pw.world.createCollider(m.setCollisionGroups(group(Groups.Static, 0xffff)).setFriction(0.8), body)
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
    for (const m of a.arms.models.values()) m.mesh.removeFromParent()
    a.tag.remove()
  }

  /** WHAT THEY HOLD (before their walker is posed): the gun's model made the first time they hold it; up for a second
   *  after each shot (GTA's), carried otherwise; their hands bent to it as they are posed (`arms.ik`). */
  private armBefore(a: Avatar, dt: number): void {
    const r = a.r, h = a.hero, A = a.arms
    A.recoil = Math.max(0, A.recoil - dt * 9)
    // (between shots the aim's pitch eases level — the pose carries no aim)
    A.pitch *= Math.max(0, 1 - dt * 0.8)
    const up = performance.now() - A.shotAt < 1100
    A.k += ((up ? 1 : 0) - A.k) * Math.min(1, dt * (up ? 16 : 7))
    const w = isGun(r.weapon) ? r.weapon : null
    A.w = w && a.kind === Kind.Foot && h?.visible && !h.isDown ? w : null
    if (A.w && !A.models.has(A.w)) {
      const id = A.w
      A.models.set(id, { mesh: new GFX.Mesh() })
      this.wmat ??= weaponMaterial(this.atmos, this.shadow, this.farGrid)
      void weaponModel(id, this.wmat).then((m) => { if (!this.avatars.has(r.sid)) return; A.models.set(id, m); this.armsGroup.add(m.mesh) })
    }
    if (!A.w || !A.models.get(A.w)?.mesh.geometry.attributes.position) A.w = null
    if (!h) return
    standOther(h, A.w, A.pitch, A.k)
    h.handIK = A.w ? A.ik : null
    if (!A.w) A.posed = false
  }
  /** (after) the gun where his hands hold it: his matrix × its place in his space, as he was last posed. */
  private armAfter(a: Avatar): void {
    const A = a.arms, h = a.hero
    for (const [id, m] of A.models) {
      const on = id === A.w && A.posed && !!h && a.inView
      m.mesh.visible = on
      if (on && h) { m.mesh.matrix.multiplyMatrices(h.root.matrixWorld, A.gunL); m.mesh.matrixWorld.copy(m.mesh.matrix) }
    }
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
        // (its own shape once its model is in — the box till then)
        const shape = a.car.shape
        a.solidCar = shape ? this.solid(a.solidCar, `car:${a.car.id}:shape`, () => carPieces(R, shape), [cp.x, cp.y, cp.z], [cq.x, cq.y, cq.z, cq.w])
          : this.solid(a.solidCar, `car:${a.car.id}`, () => R.ColliderDesc.cuboid(box.h.x, box.h.y, box.h.z).setTranslation(box.c.x, box.c.y, box.c.z), [cp.x, cp.y, cp.z], [cq.x, cq.y, cq.z, cq.w])
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
        this.armBefore(a, dt)
        if (hero.visible && every && ++a.animN >= every) { hero.update(a.animDt); a.animDt = 0; a.animN = 0 }
        else if (hero.visible) { hero.root.position.copy(hero.pos); hero.root.updateMatrixWorld(true) }
      }
      this.armAfter(a)
      if (Math.round(r.hp) !== a.hpShown) {
        a.hpShown = Math.round(r.hp)
        a.hpBar.style.display = r.hp < 100 ? 'block' : 'none'
        a.hpBar.style.width = `${Math.max(0, r.hp) * 0.6}px`
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
    this.unlisten()
    this.armsGroup.removeFromParent()
    for (const a of this.avatars.values()) this.drop(a)
    this.avatars.clear()
    this.layer.remove()
  }
}
