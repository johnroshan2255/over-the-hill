import { Builder } from './Builder'
import { Pieces } from './Pieces'
import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import { Remotes } from './Remotes'
import { Build } from './Build'
import { Claims } from './Claims'
import type { Tier } from './quality'
import type { Bag } from '../net/wire'
import type { TerrainShadow } from './TerrainShadow'
import { type Ent, FLAG_HITCHED, FLAG_TELEPORT, Kind, Slot } from '../net/pose'
import type { Session } from '../net/Session'

/**
 * CO-OP IN THE GAME (docs/MULTIPLAYER.md, step 1): the session's world brought into ours — our pose sent (20 a second
 * while it changes, once a second when still: the server sends a still player to nobody), everyone else drawn
 * (Remotes.ts), who comes and goes told, and the HUD's chip: the world, its code to share, who's in, the ping.
 *
 * What we send (pose.ts): the player entity — what we control (on foot, the car, the motorbike) — and, while we're out
 * of it, where our car stands; a jump of more than 40 m since the last pose (a reset, a rest at camp) is a teleport.
 */
export interface Local {
  kind: Kind
  p: GFX.Vector3
  q: GFX.Quaternion
  /** Our car, while we're not in it. */
  parked: { kind: Kind; p: GFX.Vector3; q: GFX.Quaternion } | null
  /** Our trailer (Trailer.ts), hitched or standing. */
  trailer: { p: GFX.Vector3; q: GFX.Quaternion; hitched: boolean } | null
}

const SEND_EVERY = 0.05
const STILL_EVERY = 1

export class Coop {
  readonly remotes: Remotes
  /** The land claimed in this world (flags, bounds) and BUILD mode (B: the brush). */
  readonly claims: Claims
  readonly build: Build
  /** What's built (Pieces.ts) and the piece builder (Builder.ts: Build's second mode). */
  readonly pieces: Pieces
  /** The claims' ground (GroundEdits.ts: shaped, paved, ponds — main.ts makes it with the world). */
  ground: import('./GroundEdits').GroundEdits | null = null
  /** The world's rocks and grass (main.ts): what's built treads the ground. */
  worldParts: (() => { rocks: { mark(id: string, x: number, z: number, r: number): void }; grass: { refresh(): void } }) | null = null
  private readonly chip: HTMLDivElement
  private readonly last = { p: new GFX.Vector3(Infinity, 0, 0), q: new GFX.Quaternion(), kind: -1, parked: -1, t: 0, tp: new GFX.Vector3(Infinity, 0, 0), th: false }
  private sinceSend = 0
  private hudT = 0
  private readonly names = new Map<number, string>()
  private readonly off: () => void

  constructor(
    readonly session: Session,
    scene: GFX.Scene,
    map: () => MapData,
    physics: OthPhysics,
    atmos: Atmosphere,
    shadow: TerrainShadow,
    farGrid: GFX.Vector4,
    urls: { char: string; moto: string; rider: string },
    private readonly toast: (m: string, ms?: number) => void,
    tier: Tier,
    private readonly camera: GFX.PerspectiveCamera,
    canvas: HTMLElement,
    private readonly player: () => GFX.Vector3,
  ) {
    this.remotes = new Remotes(session, scene, map, physics, atmos, shadow, farGrid, urls)
    this.claims = new Claims(session, map, physics, atmos, shadow, tier, farGrid, toast)
    scene.add(this.claims.group)
    this.build = new Build(session, this.claims, map, camera, scene, canvas, player, toast, () => this.blockers())
    this.pieces = new Pieces(session, () => ({ id: map().meta.id, map: map(), ...(this.worldParts?.() ?? {}) }), physics, atmos, shadow, farGrid)
    scene.add(this.pieces.group)
    this.build.builder = new Builder(session, map, this.pieces, atmos, shadow, farGrid, toast)
    scene.add(this.build.builder.ghost)
    for (const r of session.remotes.values()) this.names.set(r.sid, r.name)
    this.chip = document.createElement('div')
    this.chip.className = 'oth-coop'
    document.body.appendChild(this.chip)
    this.off = session.on((e) => {
      if (e.t === 'joined') { this.names.set(e.sid, e.name); this.toast(`${e.name} joined`, 3000) }
      else if (e.t === 'left') { this.toast(`${this.names.get(e.sid) ?? 'Someone'} left`, 3000); this.names.delete(e.sid) }
      else if (e.t === 'chat') this.toast(`${e.name}: ${e.text}`, 5000)
      // (someone took from OUR land while we were away)
      else if (e.t === 'raid' && e.owner === session.me.id) this.toast(`${e.by_name} took ${bagText(e.bag)} from your land!`, 6000)
      else if (e.t === 'claim' && e.claim.owner !== session.me.id) this.toast(`${e.claim.owner_name} planted a flag`, 3000)
    })
    session.onClose = (why) => { this.toast(`Co-op: ${why}`, 6000); this.writeChip() }
    const n = session.remotes.size
    this.toast(`Co-op · ${session.world.name} · code ${session.world.code}${n ? ` · ${n} here` : ''}`, 4500)
    this.writeChip()
  }

  /** Every frame, after our own vehicles and walker have moved. */
  /** What we were last frame (our car, our walker): the flag's spot is kept clear of them. */
  private me: Local | null = null
  private ours(): GFX.Vector3[] {
    const m = this.me
    return m ? (m.parked ? [m.p, m.parked.p] : [m.p]) : []
  }
  /** Every car and person here: ours and the others'. */
  private blockers(): GFX.Vector3[] {
    const out = this.ours()
    for (const o of this.remotes.list) out.push(new GFX.Vector3(o.x, 0, o.z))
    return out
  }

  /** (the harness) the others' CPU each frame, smoothed (ms): posing them, culling them + their tags */
  updateMs = 0
  cullMs = 0

  frame(dt: number, me: Local): void {
    const S = this.session
    if (!S.closed) {
      S.update(dt)
      this.sinceSend += dt
      const moved = me.p.distanceToSquared(this.last.p) > 0.0004 || Math.abs(me.q.dot(this.last.q)) < 0.99999 || me.kind !== this.last.kind || (me.parked?.kind ?? -1) !== this.last.parked
        || (!!me.trailer && (me.trailer.p.distanceToSquared(this.last.tp) > 0.0004 || me.trailer.hitched !== this.last.th))
      if ((moved && this.sinceSend >= SEND_EVERY) || this.sinceSend >= STILL_EVERY) {
        const jump = me.p.distanceTo(this.last.p) > 40
        const ents: Ent[] = [{ slot: Slot.Player, kind: me.kind, flags: jump ? FLAG_TELEPORT : 0, p: [me.p.x, me.p.y, me.p.z], q: [me.q.x, me.q.y, me.q.z, me.q.w] }]
        if (me.parked) ents.push({ slot: Slot.ParkedCar, kind: me.parked.kind, flags: 0, p: [me.parked.p.x, me.parked.p.y, me.parked.p.z], q: [me.parked.q.x, me.parked.q.y, me.parked.q.z, me.parked.q.w] })
        const tr = me.trailer
        if (tr) ents.push({ slot: Slot.Trailer, kind: Kind.Trailer, flags: (tr.hitched ? FLAG_HITCHED : 0) | (jump ? FLAG_TELEPORT : 0), p: [tr.p.x, tr.p.y, tr.p.z], q: [tr.q.x, tr.q.y, tr.q.z, tr.q.w] })
        S.sendPose(ents)
        this.last.p.copy(me.p); this.last.q.copy(me.q); this.last.kind = me.kind; this.last.parked = me.parked?.kind ?? -1
        if (tr) { this.last.tp.copy(tr.p); this.last.th = tr.hitched }
        this.sinceSend = 0
      }
    }
    this.me = me
    this.claims.update(dt, this.player(), this.camera, this.ours())
    this.build.update(dt)
    this.pieces.update(dt)
    this.pieces.lod(this.camera.position)
    const t0 = performance.now()
    this.remotes.update(dt)
    this.updateMs += (performance.now() - t0 - this.updateMs) * 0.05
    if ((this.hudT -= dt) <= 0) { this.hudT = 0.5; this.writeChip() }
  }

  cull(view: GFX.Frustum, horizon: Horizon, camera: GFX.PerspectiveCamera): void {
    this.claims.cull(view, horizon)
    const t0 = performance.now()
    this.remotes.cull(view, horizon, camera, innerWidth, innerHeight)
    this.cullMs += (performance.now() - t0 - this.cullMs) * 0.05
  }

  private chipKey = ''
  private writeChip(): void {
    const S = this.session, n = S.remotes.size + 1
    const land = this.claims.here, landText = land ? (land.owner === S.me.id ? 'On your land' : `On ${land.owner_name}'s land · ${S.guards.get(land.id) ? 'guarded' : 'open'}`) : ''
    const key = S.closed ? 'off' : `${S.world.name}|${S.world.code}|${n}|${Math.round(S.rtt / 5) * 5}|${landText}`
    if (key === this.chipKey) return
    this.chipKey = key
    this.chip.classList.toggle('off', S.closed)
    this.chip.replaceChildren(
      el('b', S.closed ? 'Offline' : 'Co-op'),
      el('span', S.world.name),
      el('span', `Code ${S.world.code}`),
      ...(S.closed ? [] : [el('span', `${n} ${n === 1 ? 'player' : 'players'}`), el('small', `${Math.round(S.rtt)} ms`)]),
      ...(landText ? [el('i', landText)] : []),
    )
  }

  dispose(): void {
    this.build.dispose()
    this.claims.dispose()
    this.off()
    this.remotes.dispose()
    this.chip.remove()
    this.session.close()
  }
}

function el(tag: string, text: string): HTMLElement {
  const e = document.createElement(tag)
  e.textContent = text
  return e
}

/** "2 wood, 1 stone" */
function bagText(b: Bag): string {
  const parts = (['wood', 'stone', 'metal'] as const).filter((k) => b[k] > 0).map((k) => `${b[k]} ${k}`)
  return parts.length ? parts.join(', ') : 'things'
}

/** Our player entity's kind for the car `id`. */
export const carKind = (id: string): Kind => (id === 'e30' ? Kind.E30 : Kind.Jeep)
