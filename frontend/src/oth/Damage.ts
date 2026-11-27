import * as GFX from './gfx'
import DATA from '../../../proto/damage.json'
import debrisUrl from '../assets/models/damage/debris.glb?url'
import crackUrl from '../assets/models/damage/crack.png?url'
import type { TruckModel } from '../assets/loadModels'
import type { SimDamage } from '../gameplay/vehicle/VehicleSim'
import { gameParams } from '../settings'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { Dust } from './Dust'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'

/**
 * CAR DAMAGE (2026-11-21 — docs/DAMAGE.md; its numbers out of that spec: proto/damage.json), GTA IV's way: no dented
 * parts made beforehand — a blow of so many m/s at a point, in a direction, and the car's own shell gives there.
 *
 *   CarDamage   one car's state: the SHELL crumpled (its body's and its windows' own vertices pushed in along the blow,
 *               their normals made again — the dent in the car's own colour, the light on it changed and nothing
 *               else: the user, 2026-11-21, of the first cut's paint scraped to steel), each PANE cracked (`dmg` per
 *               vertex: the cracks drawn in the shader), then gone, the LAMPS broken, each WHEEL's axle bent (camber, toe), jammed, its tyre burst,
 *               the wheel torn off, the ENGINE's health — steam, smoke, misfires, dead — FIRE, and the explosion that
 *               leaves a burnt shell. What the physics takes of it: `sim` (VehicleSim.SimDamage).
 *   DamageFx    what is seen of it in the world: the debris thrown off (Blender's pieces — scripts/oth/damage.py), a
 *               torn-off wheel rolling away, the engine's steam and smoke (the dust's ring), flames, the blast.
 *
 * Cost: nothing each frame while nothing is damaged (one float per vertex more in the car's buffers, a branch in its
 * shader). A blow: one pass over the car's vertices and triangles (the frame it lands in), the buffers sent again.
 * Debris and flames: an instanced draw per kind, only while some are alive.
 */
const C = DATA
const TICK = 1 / C.tickHz
/** SETTINGS › PLAY › Car damage (on unless switched off; `?damage=0`). */
export const DAMAGE_ON = typeof location !== 'undefined' && gameParams().get('damage') !== '0'

/** The cracks drawn over a cracked pane (crack.png — one texture for every car; black till it is loaded). */
export const crackU: { value: GFX.Texture } = { value: new GFX.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }
let crackAsked = false
function loadCrack(): void {
  if (crackAsked) return
  crackAsked = true
  void (async () => {
    const bmp = await createImageBitmap(await (await fetch(crackUrl)).blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as ImageBitmapOptions)
    const t = new GFX.Texture(bmp)
    t.wrapS = t.wrapT = GFX.RepeatWrapping
    t.flipY = false
    t.needsUpdate = true
    crackU.value = t
  })()
}

export type DamageKind = 'dent' | 'glass' | 'lamp' | 'tyre' | 'axle' | 'wheel' | 'engine' | 'dead' | 'fire' | 'explode'
/** Something that just happened to a car: where (car space), how big (k: a dent's ΔV, a pane's size, a wheel's
 *  number, the engine's stage), the blow's direction (car space). */
export interface DamageEvent { kind: DamageKind; x: number; y: number; z: number; k: number; dx: number; dy: number; dz: number }

interface DMesh {
  geo: GFX.BufferGeometry
  pos: Float32Array
  nor: Float32Array
  dmg: Float32Array
  idx: ArrayLike<number> | null
  /** where the mesh stands in the car (a door: its hinge) */
  ox: number; oy: number; oz: number
  glass: boolean
  door: boolean
  // (made at the first blow: the shell as it left the works, the scratch of a blow)
  rest: Float32Array | null
  nor0: Float32Array | null
  acc: Float32Array | null
  moved: Uint8Array | null
  /** vertices no longer there (a pane fallen out) */
  gone: Uint8Array | null
  /** vertices of RUBBER (the spare wheel on the tail): they give and come back — next to no dent */
  soft: Uint8Array | null
  /** (made at the first blow) the CREASES' part of each vertex's move (xyz), and how far its panel has been squashed
   *  (0 … maxSquash) — the push's part is what is left: pos − rest − buck */
  buck: Float32Array | null
  squash: Float32Array | null
  dirty: boolean
}
interface Pane { m: DMesh; verts: Uint32Array; x: number; y: number; z: number; r: number; dmg: number; shots: number; state: 0 | 1 | 2 }
export interface WheelDamage { bend: number; flat: boolean; off: boolean; jam: boolean }

export class CarDamage {
  /** The engine's health (proto: 1000 whole … 0 dead). */
  engine = C.engine.health
  /** Burning: seconds till it goes up (0: not burning). */
  burn = 0
  /** Blown up: a burnt shell. */
  wrecked = false
  /** After the blast: seconds of smouldering left. */
  smoulder = 0
  readonly wheels: WheelDamage[] = [0, 1, 2, 3].map(() => ({ bend: 0, flat: false, off: false, jam: false }))
  /** Lamps out: head left, head right, tail left, tail right. */
  readonly lamps = [false, false, false, false]
  /** What the physics takes (VehicleSim.setDamage reads it when `rev` moves). */
  readonly sim: SimDamage = { rev: 0, power: 1, radius: [1, 1, 1, 1], grip: [1, 1, 1, 1], toe: [0, 0, 0, 0], drag: [0, 0, 0, 0] }
  /** What has happened since they were last read (DamageFx.car drains them). */
  readonly events: DamageEvent[] = []
  /** The driver's door is shut (its mesh is where the car's space says it is). */
  doorShut = true
  /** How much has been crushed in all (the repair's price). */
  private crush = 0
  private readonly meshes: DMesh[] = []
  private readonly panes: Pane[] = []
  private readonly lampAt: [number, number, number][]
  private readonly hub: [number, number, number][]
  private readonly bay: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
  private readonly cell: { hx: number; y1: number; z0: number; z1: number }
  /** Where the engine's steam, smoke and flames come out (car space): the bonnet's middle. */
  readonly vent = new GFX.Vector3()
  /** The body's middle (car space) and its reach — the blast's place. */
  readonly mid = new GFX.Vector3()
  /** (DamageFx: this car's emission carried over — smoke, flames) */
  readonly fxAcc = [0, 0]
  private sent = 0

  /** `charU`: the body's soot (0 … 1) — its shader's uChar. */
  constructor(private readonly model: TruckModel, readonly charU: { value: number } = { value: 0 }) {
    loadCrack()
    charU.value = 0
    const m = model, hx = m.half.x, len = m.rear - m.front, H = m.half.y * 2
    // (each lamp where its lens is — loadModels `lampsOf`: the left's, the right's; a model with none: the corners)
    const head = m.lamps.head, tail = m.lamps.tail
    this.lampAt = [head ? [...head[0].c] : [-hx * 0.7, 0.9, m.front], head ? [...head[1].c] : [hx * 0.7, 0.9, m.front], tail ? [...tail[0].c] : [-hx * 0.75, 0.9, m.rear], tail ? [...tail[1].c] : [hx * 0.75, 0.9, m.rear]]
    this.hub = m.wheelPos.map((p) => [p[0], p[1], p[2]])
    // THE ENGINE BAY: the front three tenths of the body, under the bonnet
    this.bay = { x0: -hx * 0.75, x1: hx * 0.75, y0: m.bottom, y1: m.bottom + H * 0.7, z0: m.front, z1: m.front + len * 0.3 }
    this.vent.set(0, m.bottom + H * 0.56, m.front + len * 0.17)
    this.mid.set(0, m.bottom + H * 0.5, (m.front + m.rear) / 2)
    // THE CABIN'S CELL: what never gives — the people's room. The middle half of the length, cabinCell of the width,
    // up to four fifths of the height (the roof may come down a hand)
    const zc = (m.front + m.rear) / 2
    this.cell = { hx: hx * C.deform.cabinCell, y1: m.bottom + H * 0.82, z0: zc - len * 0.25, z1: zc + len * 0.25 }
  }

  /** A mesh of this car's (its OWN copy of the geometry): the body or the glass — a door's with `at` its hinge. Gives
   *  it the per-vertex `dmg` its shader reads (DAMAGE). */
  attach(geo: GFX.BufferGeometry, glass: boolean, at: readonly [number, number, number] | null = null): void {
    const P = geo.attributes.position as GFX.BufferAttribute, N = geo.attributes.normal as GFX.BufferAttribute
    const dmg = new Float32Array(P.count)
    geo.setAttribute('dmg', new GFX.BufferAttribute(dmg, 1))
    const m: DMesh = { geo, pos: P.array as Float32Array, nor: N.array as Float32Array, dmg, idx: geo.index ? (geo.index.array as ArrayLike<number>) : null,
      ox: at ? at[0] : 0, oy: at ? at[1] : 0, oz: at ? at[2] : 0, glass, door: !!at, rest: null, nor0: null, acc: null, moved: null, gone: null, soft: null, buck: null, squash: null, dirty: false }
    this.meshes.push(m)
    if (glass) this.findPanes(m)
    else if (!at && !this.spare) this.findSpare(m)
  }

  /** THE SPARE WHEEL on the tail (2026-11-21, the user: "some cars have a tyre on the back, the stepney: hitting it
   *  won't crack it, like in reality"): no model names it — it is found: the rearmost of the body (a bumper there
   *  is wide and low; a spare is as tall as it is wide, the size of a road wheel, above the bumper — six of the 21
   *  cars carry one: the off-roader, the bronc, the guardian, the gelande, the forty, the seventy).
   *  `spare`: its middle, its radius, from the tail's painted skin behind it (z0) to its face (z1) — car space; its
   *  vertices (what is not painted panel, within its round) marked `soft`. */
  spare: { x: number; y: number; r: number; z0: number; z1: number } | null = null
  private findSpare(m: DMesh): void {
    const P = m.pos, n = P.length / 3, paint = m.geo.attributes.paintMask ? (m.geo.attributes.paintMask.array as ArrayLike<number>) : null
    const M = this.model, R = M.wheelRadius
    // (how far it stands proud of the tail differs car by car — 6 cm of it to 37: the thinnest slice of the tail that
    //  is a wheel's round is taken)
    let x = 0, y = 0, r = 0
    for (const deep of [0.06, 0.1, 0.16, 0.22]) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, c = 0
      for (let i = 0; i < n; i++) {
        if (P[i * 3 + 2] < M.rear - deep) continue
        c++
        x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1])
      }
      const w = x1 - x0, h = y1 - y0
      if (c < 24 || w < 1.5 * R || w > 2.8 * R || h < 1.5 * R || h > 2.8 * R || Math.abs(w - h) > 0.35 * Math.max(w, h) || (y0 + y1) / 2 < M.bottom + M.half.y * 0.4) continue
      x = (x0 + x1) / 2; y = (y0 + y1) / 2; r = Math.max(w, h) / 2
      break
    }
    if (!r) return
    // (the tail's skin behind it: the furthest back a painted panel is, within its round)
    let skin = -Infinity
    const panel = (i: number) => !!paint && paint[i] > 0.5 && paint[i] < 1.5
    for (let i = 0; i < n; i++) if (panel(i) && P[i * 3 + 2] > skin && Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y) < r) skin = P[i * 3 + 2]
    if (!Number.isFinite(skin) || skin > M.rear - 0.08) skin = M.rear - 0.3
    this.spare = { x, y, r, z0: skin, z1: M.rear }
    const soft = (m.soft = new Uint8Array(n))
    for (let i = 0; i < n; i++) if (!panel(i) && P[i * 3 + 2] > skin - 0.02 && Math.hypot(P[i * 3] - x, P[i * 3 + 1] - y) < r * 1.05) soft[i] = 1
  }

  /** The glass's PANES: its pieces that hang together (a windscreen, a side window) — by its triangles, and by the
   *  vertices that share a place (a model's seams are split). */
  private findPanes(m: DMesh): void {
    const n = m.pos.length / 3, par = new Int32Array(n)
    for (let i = 0; i < n; i++) par[i] = i
    const find = (i: number): number => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i] } return i }
    const uni = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) par[b] = a }
    const at = new Map<number, number>()
    for (let i = 0; i < n; i++) {
      const k = (Math.round(m.pos[i * 3] * 400) * 73856093) ^ (Math.round(m.pos[i * 3 + 1] * 400) * 19349663) ^ (Math.round(m.pos[i * 3 + 2] * 400) * 83492791)
      const j = at.get(k)
      if (j === undefined) at.set(k, i); else uni(j, i)
    }
    if (m.idx) for (let t = 0; t + 2 < m.idx.length; t += 3) { uni(m.idx[t], m.idx[t + 1]); uni(m.idx[t], m.idx[t + 2]) }
    else for (let i = 0; i + 2 < n; i += 3) { uni(i, i + 1); uni(i, i + 2) }
    const by = new Map<number, number[]>()
    for (let i = 0; i < n; i++) { const r = find(i); let l = by.get(r); if (!l) by.set(r, (l = [])); l.push(i) }
    for (const l of by.values()) {
      if (l.length < 3) continue
      let x = 0, y = 0, z = 0
      for (const i of l) { x += m.pos[i * 3]; y += m.pos[i * 3 + 1]; z += m.pos[i * 3 + 2] }
      x /= l.length; y /= l.length; z /= l.length
      let r = 0
      for (const i of l) r = Math.max(r, Math.hypot(m.pos[i * 3] - x, m.pos[i * 3 + 1] - y, m.pos[i * 3 + 2] - z))
      if (r < 0.06) continue
      this.panes.push({ m, verts: Uint32Array.from(l), x: x + m.ox, y: y + m.oy, z: z + m.oz, r, dmg: 0, shots: 0, state: 0 })
    }
  }

  private ev(kind: DamageKind, x: number, y: number, z: number, k: number, dx = 0, dy = 0, dz = 0): void {
    if (this.events.length < 24) this.events.push({ kind, x, y, z, k, dx, dy, dz })
  }

  /** Dead: the engine will not run (worn out, or the car is a burnt shell). */
  get dead(): boolean { return this.wrecked || this.engine <= 0 }
  get burning(): boolean { return this.burn > 0 }
  /** What comes out of the bonnet: 0 nothing, 1 steam, 2 grey smoke, 3 black smoke. */
  get smoke(): number { const e = this.engine, E = C.engine; return e < E.misfireAt ? 3 : e < E.smokeAt ? 2 : e < E.steamAt ? 1 : 0 }
  /** The engine misfires (it cuts out for a moment, now and again). */
  get misfires(): boolean { return this.engine < C.engine.misfireAt && this.engine > 0 }
  /** Nothing wrong with it. */
  get whole(): boolean { return this.engine >= C.engine.health && this.crush === 0 && !this.wrecked && !this.lamps.some(Boolean) && !this.panes.some((p) => p.state) && !this.wheels.some((w) => w.bend > 0 || w.flat || w.off) }
  /** How well it still drives (0 … 1) — for a driver who isn't simulated (Companion.ts): the engine's power, less for
   *  every wheel that is bent, flat, jammed or gone. */
  get drive(): number {
    if (this.dead) return 0
    let k = this.sim.power
    for (const w of this.wheels) k *= w.off ? 0.55 : w.jam ? 0.7 : w.flat ? 0.8 : 1 - 0.6 * w.bend
    return k
  }
  /** What mending it costs (◆). */
  get cost(): number {
    if (this.whole) return 0
    let pts = (C.engine.health - this.engine) + this.crush * 400 + (this.wrecked ? 1500 : 0)
    for (const w of this.wheels) pts += (w.bend / C.wheel.maxCamber) * 150 + (w.flat ? 80 : 0) + (w.off ? 250 : 0)
    for (const p of this.panes) pts += p.state === 2 ? 60 : p.state === 1 ? 30 : 0
    for (const l of this.lamps) if (l) pts += 40
    return Math.max(C.repair.minCoins, Math.round(pts * C.repair.coinsPerPoint))
  }

  /**
   * A BLOW: at (px, py, pz), along (dx, dy, dz) — the way it pushes the metal, a unit vector — of `dv` m/s (the change
   * of the car's velocity there); all in the car's space. 'shot': a bullet's — a small dent, its own table.
   */
  hit(px: number, py: number, pz: number, dx: number, dy: number, dz: number, dv: number, kind: 'crash' | 'shot' = 'crash'): void {
    this.onHit?.(px, py, pz, dx, dy, dz, dv, kind)
    const shot = kind === 'shot'
    // (ON THE SPARE WHEEL — the tail's, a blow that drives it forward: the tyre takes it. A round stops in the
    //  rubber; a crash reaches what is behind it with less than half its force — the window over it does not crack
    //  from a knock)
    const sp = this.spare
    const onSpare = !!sp && pz > sp.z0 - 0.05 && dz < -0.4 && Math.hypot(px - sp.x, py - sp.y) < sp.r * 1.1
    if (onSpare && shot) return
    const eff = shot ? C.shot.dentDv : Math.min(C.crash.maxDv, dv) * (onSpare ? C.spare.cushion : 1), over = Math.max(0, eff - C.crash.minDv)
    if (!shot && over <= 0) return
    const D = C.deform
    const R = shot ? 0.14 : Math.min(D.radius.max, D.radius.base + D.radius.perDv * eff)
    const depth = shot ? 0.012 : Math.min(D.maxPerHit, D.depthPerDv * over)
    // 1. the shell
    if (!this.wrecked || !shot) {
      for (const m of this.meshes) if (!m.door || this.doorShut) this.dent(m, px, py, pz, dx, dy, dz, R, depth)
      this.crush += depth
      this.ev('dent', px, py, pz, eff, dx, dy, dz)
      // (GLASS DOESN'T BEND: a pane whose frame has been pushed out of shape bursts — drawn out with it, a windscreen of
      //  two triangles became a long shard)
      for (const p of this.panes) {
        if (p.state === 2 || !p.m.rest) continue
        const P = p.m.pos, Rs = p.m.rest
        let worst = 0
        for (const i of p.verts) { const j = i * 3; worst = Math.max(worst, Math.abs(P[j] - Rs[j]) + Math.abs(P[j + 1] - Rs[j + 1]) + Math.abs(P[j + 2] - Rs[j + 2])) }
        if (worst > C.deform.glassBends) this.shatter(p)
      }
    }
    // 2. the glass: a pane takes what reaches it; cracked, then out
    for (const p of this.panes) {
      if (p.state === 2 || (p.m.door && !this.doorShut)) continue
      const d = Math.max(0, Math.hypot(p.x - px, p.y - py, p.z - pz) - p.r * 0.6)
      if (shot) {
        if (d > 0.08) continue
        p.shots++
        if (p.shots >= C.shot.glassShatters) this.shatter(p)
        else if (p.shots >= C.shot.glassCracks) this.crack(p)
        continue
      }
      const reach = R * 0.6 + C.glass.radius
      if (d >= reach) continue
      // (… on the spare wheel, the glass over it gets half again of what is left: a knock on the tyre cracks no window)
      p.dmg += eff * (1 - d / reach) * (onSpare ? C.spare.glass : 1)
      if (p.dmg >= C.glass.shatterDv) this.shatter(p)
      else if (p.dmg >= C.glass.crackDv) this.crack(p)
    }
    // 3. the lamps
    for (let k = 0; k < 4; k++) {
      if (this.lamps[k]) continue
      const L = this.lampAt[k], d = Math.hypot(L[0] - px, L[1] - py, L[2] - pz)
      const reach = shot ? C.lamp.radius * 0.45 : R * 0.7 + C.lamp.radius
      if (d >= reach || (!shot && eff * (1 - d / reach) < C.lamp.breakDv)) continue
      this.lamps[k] = true
      this.ev('lamp', L[0], L[1], L[2], k)
      this.sim.rev++
    }
    // 4. the wheels: the axle bent at the wheel the blow is near — most by a blow from the side
    const W = C.wheel
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k], h = this.hub[k]
      if (w.off) continue
      const d = Math.hypot(h[0] - px, h[1] - py, h[2] - pz)
      if (shot) {
        // (a round through the tyre: within its radius of the hub, at the wheel's side of the car)
        if (!w.flat && d < this.model.wheelRadius * 1.05 && Math.abs(px - h[0]) < 0.35) { w.flat = true; this.ev('tyre', h[0], h[1], h[2], k); this.wheelsChanged() }
        continue
      }
      // (its share of the blow: by how near the blow landed — and a blow from the SIDE goes into both wheels of the
      //  side it struck, they stand out past the body; one on the nose or the tail pushes that end's axle back)
      const reach = W.radius + R * 0.5
      const struck = Math.abs(px) > 0.2 ? Math.sign(px) : -Math.sign(dx)
      const near = Math.max(d < reach ? 1 - d / reach : 0, Math.abs(dx) > 0.5 && struck === Math.sign(h[0]) ? 0.6 * Math.abs(dx) : 0, Math.abs(dz) > 0.5 && Math.sign(dz) === -Math.sign(h[2] - this.mid.z) ? 0.3 * Math.abs(dz) : 0)
      if (near <= 0) continue
      const got = eff * near
      const was = w.bend
      w.bend = Math.min(W.maxCamber * 1.25, w.bend + W.bendPerDv * over * near * (0.5 + 0.5 * Math.abs(dx)))
      if (!w.flat && got >= W.burstDv) { w.flat = true; this.ev('tyre', h[0], h[1], h[2], k) }
      if (w.bend >= W.tearOff && got >= W.tearOffDv) { w.off = true; this.ev('wheel', h[0], h[1], h[2], k, dx, dy, dz) }
      else if (!w.jam && w.bend >= W.jam) { w.jam = true; this.ev('axle', h[0], h[1], h[2], k) }
      else if (was < 0.03 && w.bend >= 0.03) this.ev('axle', h[0], h[1], h[2], k)
      this.wheelsChanged()
    }
    // 5. the engine: by how much of the blow is in its bay
    if (!this.wrecked) {
      const B = this.bay
      const bx = Math.max(B.x0 - px, 0, px - B.x1), by = Math.max(B.y0 - py, 0, py - B.y1), bz = Math.max(B.z0 - pz, 0, pz - B.z1)
      const bd = Math.hypot(bx, by, bz)
      const E = C.engine
      if (shot) {
        if (bd < 0.12) { this.engineTakes(C.shot.engine); if (this.engine < E.fireAt) this.ignite() }
      } else {
        const inBay = Math.max(0, 1 - bd / R)
        this.engineTakes((E.bayDamagePerDv * inBay + E.elsewherePerDv * (1 - inBay)) * over)
        if (this.engine < E.fireAt && eff * inBay >= E.fireDv) this.ignite()
      }
    }
  }

  /** A hard LANDING on wheel k: its shock on its stops at `sv` m/s — the axle bends, the tyre may burst. */
  landing(k: number, sv: number): void {
    const w = this.wheels[k], L = C.landing, W = C.wheel
    if (w.off || sv < L.bendFrom) return
    this.onLand?.(k, sv)
    const h = this.hub[k], was = w.bend
    w.bend = Math.min(W.maxCamber * 1.25, w.bend + L.bendPerMs * (sv - L.bendFrom))
    if (!w.flat && sv >= L.burstFrom) { w.flat = true; this.ev('tyre', h[0], h[1], h[2], k) }
    if (!w.jam && w.bend >= W.jam) { w.jam = true; this.ev('axle', h[0], h[1], h[2], k) }
    else if (was < 0.03 && w.bend >= 0.03) this.ev('axle', h[0], h[1], h[2], k)
    this.wheelsChanged()
  }

  private engineTakes(d: number): void {
    if (d <= 0 || this.engine <= 0) return
    const E = C.engine, was = this.engine, v = this.vent
    this.engine = Math.max(0, was - d)
    const stage = (e: number) => (e < E.misfireAt ? 3 : e < E.smokeAt ? 2 : e < E.steamAt ? 1 : 0)
    if (this.engine <= 0) this.ev('dead', v.x, v.y, v.z, 0)
    else if (stage(this.engine) > stage(was)) this.ev('engine', v.x, v.y, v.z, stage(this.engine))
    this.setPower()
  }
  private setPower(): void {
    const P = C.engine.power, e = this.engine
    let p = 0
    if (!this.wrecked && e > 0) {
      p = P[0][1]
      for (let i = 1; i < P.length; i++) if (e <= P[i - 1][0] && e >= P[i][0]) { p = P[i][1] + (P[i - 1][1] - P[i][1]) * ((e - P[i][0]) / (P[i - 1][0] - P[i][0])); break }
    }
    if (p !== this.sim.power) { this.sim.power = p; this.sim.rev++ }
  }
  private ignite(): void {
    if (this.burn > 0 || this.wrecked) return
    this.burn = C.engine.burnTicks * TICK
    this.ev('fire', this.vent.x, this.vent.y, this.vent.z, 0)
  }

  /** The wheels' state → what the physics takes of it. */
  private wheelsChanged(): void {
    const W = C.wheel, s = this.sim
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k], b = Math.min(1, w.bend / W.maxCamber), side = k & 1 ? 1 : -1
      s.radius[k] = w.off ? W.hub.radius : w.flat ? W.flat.radius : 1
      s.grip[k] = (w.off ? W.hub.grip : w.flat ? W.flat.grip : 1) * (1 - W.gripLoss * b)
      // (bent, the wheel points out of line — toe-out, on its own side: the car pulls that way)
      s.toe[k] = w.off ? 0 : side * W.toePerCamber * w.bend
      s.drag[k] = w.off || w.jam ? 1e5 : W.dragNm * b + (w.flat ? W.flat.dragNm : 0)
    }
    s.rev++
  }

  /** Each frame: the fire's clock, the soot, the buffers of a mesh that changed sent (at most 12 times a second). */
  update(dt: number): void {
    if (this.burn > 0) {
      this.burn -= dt
      this.engine = Math.max(0, this.engine - (C.engine.fireAt / (C.engine.burnTicks * TICK)) * dt)
      this.setPower()
      if (this.burn <= 0) this.explode()
    }
    if (this.smoulder > 0) this.smoulder -= dt
    const ch = this.wrecked ? 1 : 0
    if (this.charU.value !== ch) this.charU.value = Math.abs(ch - this.charU.value) < 0.01 ? ch : this.charU.value + (ch - this.charU.value) * Math.min(1, dt * 2.2)
    if ((this.sent -= dt) <= 0) {
      for (const m of this.meshes) {
        if (!m.dirty) continue
        m.dirty = false
        this.sent = 0.08
        ;(m.geo.attributes.position as GFX.BufferAttribute).needsUpdate = true
        ;(m.geo.attributes.normal as GFX.BufferAttribute).needsUpdate = true
        ;(m.geo.attributes.dmg as GFX.BufferAttribute).needsUpdate = true
      }
    }
  }

  /** IT GOES UP: a burnt shell — every pane out, every lamp, every tyre; the engine gone. */
  explode(): void {
    if (this.wrecked) return
    this.onBlast?.()
    this.wrecked = true
    this.burn = 0
    this.engine = 0
    this.smoulder = 40
    for (const p of this.panes) if (p.state !== 2) this.shatter(p, true)
    for (let k = 0; k < 4; k++) { this.lamps[k] = true; this.wheels[k].flat = true }
    this.setPower()
    this.wheelsChanged()
    this.ev('explode', this.mid.x, this.mid.y, this.mid.z, 0)
  }

  private crack(p: Pane): void {
    if (p.state) return
    p.state = 1
    for (const i of p.verts) p.m.dmg[i] = 1
    p.m.dirty = true
  }
  private shatter(p: Pane, quiet = false): void {
    if (p.state === 2) return
    p.state = 2
    const m = p.m
    this.lazy(m)
    // (gone: its corners drawn together — triangles of no size)
    const x = p.x - m.ox, y = p.y - m.oy, z = p.z - m.oz
    for (const i of p.verts) { m.pos[i * 3] = x; m.pos[i * 3 + 1] = y; m.pos[i * 3 + 2] = z; m.dmg[i] = 0; m.gone![i] = 1 }
    m.dirty = true
    if (!quiet) this.ev('glass', p.x, p.y, p.z, p.r)
  }

  /** (the first blow: the mesh as it left the works kept, the scratch made) */
  /** THE PANELS' FACING, a field over the car (made at the first blow): which way the shell faces, outer side out, on
   *  a 10 cm grid — every face's normal (by its area) laid into the cells round it — and sampled between the cells:
   *  smooth by its making, so a crease out along it moves what lies together as one (a flat-shaded corner's copies,
   *  a small bevel, the door's skin and the body, a panel's two layers). Its length (0 … 1): how much the faces
   *  there agree — none where they don't (a panel's edge, a tangle of trim): no crease there. */
  private face: { x0: number; y0: number; z0: number; nx: number; ny: number; nz: number; v: Float32Array } | null = null
  private static readonly CELL = 0.1
  private facing(): NonNullable<CarDamage['face']> {
    if (this.face) return this.face
    const M = this.model, S = CarDamage.CELL, pad = 0.3
    const x0 = -M.half.x - pad, y0 = M.bottom - pad, z0 = M.front - pad
    const nx = Math.ceil((2 * M.half.x + 2 * pad) / S) + 1, ny = Math.ceil((M.half.y * 2 + 2 * pad + 0.6) / S) + 1, nz = Math.ceil((M.rear - M.front + 2 * pad) / S) + 1
    const v = new Float32Array(nx * ny * nz * 4), mid = this.mid
    for (const m of this.meshes) {
      const P = m.rest ?? m.pos, idx = m.idx, n = idx ? idx.length : P.length / 3
      for (let t = 0; t + 2 < n; t += 3) {
        const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2]
        const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az
        let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
        const area = Math.sqrt(fx * fx + fy * fy + fz * fz)
        if (area < 1e-9) continue
        const cx = (ax + P[b * 3] + P[c * 3]) / 3 + m.ox, cy = (ay + P[b * 3 + 1] + P[c * 3 + 1]) / 3 + m.oy, cz = (az + P[b * 3 + 2] + P[c * 3 + 2]) / 3 + m.oz
        // (the outer side out)
        if (fx * (cx - mid.x) + fy * (cy - mid.y) + fz * (cz - mid.z) < 0) { fx = -fx; fy = -fy; fz = -fz }
        // (into the 8 cells round its middle, by how near)
        const gx = (cx - x0) / S, gy = (cy - y0) / S, gz = (cz - z0) / S
        const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz), tx = gx - ix, ty = gy - iy, tz = gz - iz
        for (let k = 0; k < 8; k++) {
          const X = ix + (k & 1), Y = iy + ((k >> 1) & 1), Z = iz + (k >> 2)
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue
          const w = (k & 1 ? tx : 1 - tx) * ((k >> 1) & 1 ? ty : 1 - ty) * (k >> 2 ? tz : 1 - tz)
          const o = ((Z * ny + Y) * nx + X) * 4
          v[o] += fx * w; v[o + 1] += fy * w; v[o + 2] += fz * w; v[o + 3] += area * w
        }
      }
    }
    return (this.face = { x0, y0, z0, nx, ny, nz, v })
  }
  /** The facing at a point of the car (into `out`: the way, its length how much the faces there agree). */
  private faceAt(x: number, y: number, z: number, out: Float32Array): void {
    const F = this.facing(), S = CarDamage.CELL
    const gx = (x - F.x0) / S, gy = (y - F.y0) / S, gz = (z - F.z0) / S
    const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz), tx = gx - ix, ty = gy - iy, tz = gz - iz
    let ax = 0, ay = 0, az = 0, aw = 0
    for (let k = 0; k < 8; k++) {
      const X = ix + (k & 1), Y = iy + ((k >> 1) & 1), Z = iz + (k >> 2)
      if (X < 0 || Y < 0 || Z < 0 || X >= F.nx || Y >= F.ny || Z >= F.nz) continue
      const w = (k & 1 ? tx : 1 - tx) * ((k >> 1) & 1 ? ty : 1 - ty) * (k >> 2 ? tz : 1 - tz), o = ((Z * F.ny + Y) * F.nx + X) * 4
      ax += F.v[o] * w; ay += F.v[o + 1] * w; az += F.v[o + 2] * w; aw += F.v[o + 3] * w
    }
    const l = Math.sqrt(ax * ax + ay * ay + az * az)
    if (l < 1e-9 || aw < 1e-9) { out[0] = out[1] = out[2] = 0; return }
    const k = Math.min(1, l / aw) / l
    out[0] = ax * k; out[1] = ay * k; out[2] = az * k
  }
  private readonly fa = new Float32Array(3)

  private lazy(m: DMesh): void {
    if (m.rest) return
    const n = m.pos.length / 3
    m.rest = m.pos.slice(); m.nor0 = m.nor.slice()
    m.acc = new Float32Array(n * 3); m.moved = new Uint8Array(n); m.gone = new Uint8Array(n)
    m.buck = new Float32Array(n * 3); m.squash = new Float32Array(n)
  }

  /** THE SHELL PUSHED IN — as metal goes, not rubber (2026-11-25, docs/DAMAGE.md §3.1): every vertex within R of the
   *  blow moved by one SMOOTH field of where it is (what lies together moves together — a door's skin and the body
   *  round it, a panel's two layers, a seam's two vertices): the PUSH along the blow, deepest at its middle; and where
   *  that push shortens a panel lying along the blow, the CREASES the metal folds into rather than shrink — their
   *  height what keeps the panel's length. Then the moved vertices' normals. */
  private dent(m: DMesh, px: number, py: number, pz: number, dx: number, dy: number, dz: number, R: number, depth: number): void {
    const pos = m.pos, n = pos.length / 3, R2 = R * R, D = C.deform, B = D.buckle, cell = this.cell
    this.lazy(m)
    const rest = m.rest!, moved = m.moved!, gone = m.gone!, buck = m.buck!, squash = m.squash!
    const give = C.spare.give, sp = this.spare, ox = m.ox, oy = m.oy, oz = m.oz, maxD = D.maxDepth, lam = B.wavelength, K = (2 * Math.PI) / lam
    // (THE CABIN'S CELL, the safety cage: what is in it never moves; what is outside it closes at most CLOSE of its own
    //  gap to it — so a door's skin, further out, always stays outside the trim behind it: pushed flat against the
    //  cell's face, the skin and the black trim lay in one place and the trim showed through in holes)
    const CLOSE = 0.65
    const outside = (x: number, y: number, z: number) => Math.max(Math.abs(x) - cell.hx, y - cell.y1, cell.z0 - z, z - cell.z1)
    const amp = (e: number) => (lam / Math.PI) * Math.sqrt(e) * B.amp
    let any = false
    for (let i = 0; i < n; i++) {
      const j = i * 3
      if (gone[i]) continue
      const x = pos[j] + ox, y = pos[j + 1] + oy, z = pos[j + 2] + oz
      const ex = x - px, ey = y - py, ez = z - pz, r2 = ex * ex + ey * ey + ez * ez
      if (r2 >= R2) continue
      const rx = rest[j] + ox, ry = rest[j + 1] + oy, rz = rest[j + 2] + oz
      const gap = outside(rx, ry, rz)
      if (gap <= 0) continue
      const cellK = 1
      // (rubber — the spare wheel: it gives and comes back, a little of the dent stays. Its round and what is just
      //  behind it, eased in over its rim — not vertex by vertex: the tyre went 12 cm and the metal 1 cm from it 2 cm)
      let rub = 1
      if (sp) {
        const a = Math.min(1, Math.max(0, (sp.r * 1.3 - Math.hypot(rx - sp.x, ry - sp.y)) / (sp.r * 0.8)))
        const b = Math.min(1, Math.max(0, (rz - (sp.z0 - 0.4)) / 0.35))
        rub = 1 - (1 - give) * a * b
      }
      const q = 1 - r2 / R2, k = cellK * rub, push = depth * q * q * k
      // THE PUSH: added to what earlier blows pushed, never further than maxDepth from where it began
      const u0x = pos[j] - rest[j] - buck[j], u0y = pos[j + 1] - rest[j + 1] - buck[j + 1], u0z = pos[j + 2] - rest[j + 2] - buck[j + 2]
      let ux = u0x + dx * push, uy = u0y + dy * push, uz = u0z + dz * push
      // (… and no more than CLOSE of its own gap to the cell: smooth in where it is — a back-out to the cell's face
      //  along the blow chose one face or another near the cell's corners, and two points 7 cm apart went 17 cm)
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz), um = Math.min(maxD, CLOSE * gap)
      if (ul > um) { const f = um / ul; ux *= f; uy *= f; uz *= f }
      // THE CREASES: how much this blow squashed the panel here — the push falls off behind the point of the blow, so
      // what lies behind it along the blow comes closer to what lies ahead (−∂push/∂s, s along the blow)
      const sAlong = ex * dx + ey * dy + ez * dz
      // (by the push it really got: held at maxDepth or at the cell, a point goes no further — nor is it squashed)
      const got = push > 1e-6 ? Math.max(0, Math.min(1, ((ux - u0x) * dx + (uy - u0y) * dy + (uz - u0z) * dz) / push)) : 0
      const e0 = squash[i], e1 = sAlong > 0 ? Math.min(B.maxSquash, e0 + (depth * 4 * q * sAlong * k * got) / R2) : e0
      if (e1 > e0) {
        squash[i] = e1
        // OUT OF THE PANEL — along the panels' facing here (`facing`: smooth over the car, the outer side out, so what
        // lies together folds as one), less what of it lies along the blow: a face square to the blow (a bumper's front)
        // isn't squashed along itself — no crease. (Each vertex's own normal split a flat-shaded corner's copies; out
        // from the car's middle slid a bonnet's creases sideways in its own plane)
        this.faceAt(rx, ry, rz, this.fa)
        let mx = this.fa[0], my = this.fa[1], mz = this.fa[2]
        const nd = mx * dx + my * dy + mz * dz
        mx -= nd * dx; my -= nd * dy; mz -= nd * dz
        const ml = Math.sqrt(mx * mx + my * my + mz * mz)
        if (ml > 0.05) {
          mx /= ml; my /= ml; mz /= ml
          // (the folds run across the blow, a little wandering — by where the metal began, so every game folds it alike)
          const along = rx * dx + ry * dy + rz * dz
          const wave = Math.sin(K * along + 1.7 * Math.sin(rx * 4.1 + ry * 2.3) + 1.3 * Math.sin(rz * 3.7 - ry * 2.9)) * (0.8 + 0.2 * Math.sin(rx * 7.3 + rz * 5.1))
          const da = (amp(e1) - amp(e0)) * ml * wave * Math.min(1, gap / 0.1) // (eased out at the cell, as the push is)
          buck[j] += mx * da; buck[j + 1] += my * da; buck[j + 2] += mz * da
        }
      }
      const nx = rest[j] + ux + buck[j] + ox, ny = rest[j + 1] + uy + buck[j + 1] + oy, nz = rest[j + 2] + uz + buck[j + 2] + oz
      pos[j] = nx - ox; pos[j + 1] = ny - oy; pos[j + 2] = nz - oz
      moved[i] = 1
      any = true
    }
    if (!any) return
    // the normals of what moved: from the faces round each
    const acc = m.acc!, nor = m.nor, idx = m.idx
    const tri = (a: number, b: number, c: number) => {
      if (!(moved[a] | moved[b] | moved[c])) return
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
      const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az, vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
      if (moved[a]) { acc[a * 3] += fx; acc[a * 3 + 1] += fy; acc[a * 3 + 2] += fz }
      if (moved[b]) { acc[b * 3] += fx; acc[b * 3 + 1] += fy; acc[b * 3 + 2] += fz }
      if (moved[c]) { acc[c * 3] += fx; acc[c * 3 + 1] += fy; acc[c * 3 + 2] += fz }
    }
    if (idx) for (let t = 0; t + 2 < idx.length; t += 3) tri(idx[t], idx[t + 1], idx[t + 2])
    else for (let i = 0; i + 2 < n; i += 3) tri(i, i + 1, i + 2)
    for (let i = 0; i < n; i++) {
      if (!moved[i]) continue
      moved[i] = 0
      const j = i * 3, l = Math.sqrt(acc[j] * acc[j] + acc[j + 1] * acc[j + 1] + acc[j + 2] * acc[j + 2])
      if (l > 1e-12) { nor[j] = acc[j] / l; nor[j + 1] = acc[j + 1] / l; nor[j + 2] = acc[j + 2] / l }
      acc[j] = acc[j + 1] = acc[j + 2] = 0
    }
    m.dirty = true
  }

  /** (co-op) each blow as it's taken, and the repair — told to the others (main.ts: Session.dent), who dent the car they
   *  draw of ours the same way. */
  onHit: ((px: number, py: number, pz: number, dx: number, dy: number, dz: number, dv: number, kind: 'crash' | 'shot') => void) | null = null
  onRepair: (() => void) | null = null
  /** (co-op) a hard landing that bent or burst something (`landing`), and the car going up (`explode`) — told too: the
   *  others' copy lands the same blow, and a newcomer sees the shell, not the fire that led to it. */
  onLand: ((k: number, sv: number) => void) | null = null
  onBlast: (() => void) | null = null
  /** MENDED: as it left the works. */
  repair(): void {
    this.onRepair?.()
    for (const m of this.meshes) {
      if (m.rest) { m.pos.set(m.rest); m.nor.set(m.nor0!); m.gone!.fill(0); m.buck!.fill(0); m.squash!.fill(0) }
      m.dmg.fill(0)
      m.dirty = true
    }
    for (const p of this.panes) { p.state = 0; p.dmg = 0; p.shots = 0 }
    for (const w of this.wheels) { w.bend = 0; w.flat = w.off = w.jam = false }
    this.lamps.fill(false)
    this.engine = C.engine.health
    this.burn = this.smoulder = this.crush = 0
    this.wrecked = false
    this.charU.value = 0
    this.events.length = 0
    this.sent = 0
    this.setPower()
    this.wheelsChanged()
  }
}

// ------------------------------------------------------------------------------------------------- the effects
/** Floats a piece of debris: x y z  vx vy vz  qx qy qz qw  wx wy wz  age life size */
const DK = 16
/** Floats a flame: x y z  vx vy vz  age life  size seed */
const FK = 10
const SHAPES = ['shard_a', 'shard_b', 'scrap_a', 'scrap_b', 'trim'] as const
type Shape = (typeof SHAPES)[number]
/** How many of each can be about at once (the spec's `debris.max` in all). */
const ROOM: Record<Shape, number> = { shard_a: 14, shard_b: 14, scrap_a: 8, scrap_b: 8, trim: 4 }
const FLAMES = 64

interface Pile { shape: Shape; mesh: GFX.Mesh; aP: GFX.InstancedBufferAttribute; aQ: GFX.InstancedBufferAttribute; aC: GFX.InstancedBufferAttribute; st: Float32Array; n: number; next: number; live: number; half: number; fresh: boolean }
interface LooseWheel { mesh: GFX.InstancedMesh; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; spin: number; tilt: number; r: number; age: number; side: number }

export class DamageFx {
  private readonly piles: Pile[] = []
  private readonly flames: GFX.Mesh
  private readonly fP: GFX.InstancedBufferAttribute
  private readonly fS: GFX.InstancedBufferAttribute
  private readonly fst = new Float32Array(FLAMES * FK)
  private fNext = 0
  private fLive = 0
  private readonly wheelsLoose: LooseWheel[] = []
  private readonly box = new GFX.Box3()
  private readonly v = new GFX.Vector3()
  private readonly w = new GFX.Vector3()
  private readonly m4 = new GFX.Matrix4()
  private readonly q = new GFX.Quaternion()
  private readonly e = new GFX.Euler()
  private readonly one = new GFX.Vector3(1, 1, 1)
  private seed = 0x9e3779b9
  private readonly life = C.debris.lifeTicks * TICK
  /** Something happened to a car (after its effects are made): the toasts, the sound (main.ts). */
  onEvent: ((dm: CarDamage, e: DamageEvent, x: number, y: number, z: number) => void) | null = null

  constructor(private readonly scene: GFX.Scene, private readonly map: MapData, atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4, private readonly dust: Dust) {
    // THE FLAMES: quads that stand up and face the camera, added to the picture above white (the bloom takes them)
    const quad = new GFX.PlaneGeometry(1, 1)
    const g = new GFX.InstancedBufferGeometry()
    g.index = quad.index
    g.setAttribute('position', quad.attributes.position)
    this.fP = new GFX.InstancedBufferAttribute(new Float32Array(FLAMES * 4), 4).setUsage(GFX.DynamicDrawUsage)
    this.fS = new GFX.InstancedBufferAttribute(new Float32Array(FLAMES * 4), 4).setUsage(GFX.DynamicDrawUsage)
    g.setAttribute('aP', this.fP)
    g.setAttribute('aS', this.fS)
    g.instanceCount = FLAMES
    this.flames = new GFX.Mesh(g, new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: { uNoise: atmos.uniforms.uNoise, uTime: atmos.uniforms.uTime }, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, depthWrite: false, blending: GFX.AdditiveBlending, toneMapped: false }))
    this.flames.frustumCulled = false
    this.flames.renderOrder = 7
    this.flames.visible = false
    scene.add(this.flames)
    void this.load(atmos, shadow, farGrid)
  }

  /** The debris's shapes (debris.glb): each its own instanced draw, shown only while some of it is about. */
  private async load(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4): Promise<void> {
    const buf = await fetch(debrisUrl).then((r) => r.arrayBuffer()).then(GFX.unpacked)
    const gltf = await new GFX.GLTFLoader().parse(buf, debrisUrl)
    const mat = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid } }, defines: { OTH_SPEC: '' }, vertexShader: DEBRIS_VERT, fragmentShader: DEBRIS_FRAG, vertexColors: true })
    gltf.scene.traverse((o: GFX.Object3D) => {
      const src = o as GFX.Mesh
      const shape = SHAPES.find((s) => o.name === s || o.name.startsWith(s))
      if (!src.isMesh || !shape || this.piles.some((p) => p.shape === shape)) return
      const sg = src.geometry, P = sg.attributes.position, N = sg.attributes.normal, Cc = sg.attributes.color
      const pos = new Float32Array(P.count * 3), nor = new Float32Array(P.count * 3), col = new Float32Array(P.count * 3)
      let half = 0
      for (let i = 0; i < P.count; i++) {
        pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i)
        nor[i * 3] = N.getX(i); nor[i * 3 + 1] = N.getY(i); nor[i * 3 + 2] = N.getZ(i)
        col[i * 3] = Cc ? Cc.getX(i) : 1; col[i * 3 + 1] = Cc ? Cc.getY(i) : 1; col[i * 3 + 2] = Cc ? Cc.getZ(i) : 1
        half = Math.max(half, Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
      }
      const n = ROOM[shape]
      const g = new GFX.InstancedBufferGeometry()
      g.setAttribute('position', new GFX.BufferAttribute(pos, 3))
      g.setAttribute('normal', new GFX.BufferAttribute(nor, 3))
      g.setAttribute('color', new GFX.BufferAttribute(col, 3))
      const ix: number[] = []
      if (sg.index) for (const k of sg.index.array) ix.push(k); else for (let i = 0; i < P.count; i++) ix.push(i)
      g.setIndex(ix)
      const aP = new GFX.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(GFX.DynamicDrawUsage)
      const aQ = new GFX.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(GFX.DynamicDrawUsage)
      const aC = new GFX.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(GFX.DynamicDrawUsage)
      g.setAttribute('aP', aP); g.setAttribute('aQ', aQ); g.setAttribute('aC', aC)
      g.instanceCount = n
      const mesh = new GFX.Mesh(g, mat)
      mesh.frustumCulled = false
      mesh.visible = false
      this.scene.add(mesh)
      this.piles.push({ shape, mesh, aP, aQ, aC, st: new Float32Array(n * DK), n, next: 0, live: 0, half, fresh: false })
    })
  }

  private rnd(): number {
    let s = this.seed
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0
    this.seed = s
    return s / 4294967296
  }

  /** PIECES thrown off at (x, y, z): n of them — glass, torn metal (in the car's colour) or a strip of trim — going
   *  with (vx, vy, vz) and each its own way by up to `spread` m/s. */
  burst(kind: 'glass' | 'metal' | 'trim', x: number, y: number, z: number, vx: number, vy: number, vz: number, n: number, spread: number, tint: GFX.Color | null = null): void {
    for (let k = 0; k < n; k++) {
      const shape: Shape = kind === 'trim' ? 'trim' : kind === 'glass' ? (this.rnd() < 0.5 ? 'shard_a' : 'shard_b') : this.rnd() < 0.5 ? 'scrap_a' : 'scrap_b'
      const p = this.piles.find((q) => q.shape === shape)
      if (!p) return
      const i = p.next
      p.next = (p.next + 1) % p.n
      const o = i * DK, st = p.st
      st[o] = x + (this.rnd() - 0.5) * 0.3; st[o + 1] = y + (this.rnd() - 0.5) * 0.25; st[o + 2] = z + (this.rnd() - 0.5) * 0.3
      st[o + 3] = vx + (this.rnd() - 0.5) * 2 * spread; st[o + 4] = vy + this.rnd() * spread * 0.9 + 0.6; st[o + 5] = vz + (this.rnd() - 0.5) * 2 * spread
      this.q.setFromEuler(this.e.set(this.rnd() * 6.28, this.rnd() * 6.28, this.rnd() * 6.28))
      st[o + 6] = this.q.x; st[o + 7] = this.q.y; st[o + 8] = this.q.z; st[o + 9] = this.q.w
      st[o + 10] = (this.rnd() - 0.5) * 18; st[o + 11] = (this.rnd() - 0.5) * 18; st[o + 12] = (this.rnd() - 0.5) * 18
      st[o + 13] = 0; st[o + 14] = this.life * (0.7 + 0.3 * this.rnd()); st[o + 15] = kind === 'glass' ? 0.7 + this.rnd() * 0.7 : 0.8 + this.rnd() * 0.5
      const c = p.aC.array as Float32Array
      // (what is torn off the car is the car's colour — the metal, the trim; the glass is glass)
      const t = kind !== 'glass' && tint ? tint : null
      c[i * 4] = t ? t.r : 1; c[i * 4 + 1] = t ? t.g : 1; c[i * 4 + 2] = t ? t.b : 1; c[i * 4 + 3] = kind === 'glass' ? 1 : 0
      p.aC.needsUpdate = true
      p.fresh = true
    }
  }

  /** A WHEEL torn off: it leaves the car at m (its world matrix), going (vx, vy, vz), and rolls till it falls over. */
  wheel(geo: GFX.BufferGeometry, mat: GFX.Material, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, side: number): void {
    if (this.wheelsLoose.length >= 6) { const old = this.wheelsLoose.shift()!; old.mesh.removeFromParent() }
    const mesh = new GFX.InstancedMesh(geo, mat, 1)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    this.wheelsLoose.push({ mesh, x, y, z, vx, vy, vz, yaw: Math.atan2(-vx, -vz), spin: 0, tilt: 0, r, age: 0, side })
  }

  private flame(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    const o = this.fNext * FK, st = this.fst
    this.fNext = (this.fNext + 1) % FLAMES
    st[o] = x; st[o + 1] = y; st[o + 2] = z; st[o + 3] = vx; st[o + 4] = vy; st[o + 5] = vz
    st[o + 6] = 0; st[o + 7] = life; st[o + 8] = size; st[o + 9] = this.rnd()
  }

  /** THE BLAST at (x, y, z): the fireball, the smoke that stands over it, what is thrown out. */
  explode(x: number, y: number, z: number, tint: GFX.Color | null): void {
    for (let k = 0; k < 26; k++) {
      const a = this.rnd() * 6.283, up = this.rnd(), sp = 2 + this.rnd() * 7
      this.flame(x + Math.cos(a) * 0.6, y + up * 0.6, z + Math.sin(a) * 0.6, Math.cos(a) * sp * (1 - up * 0.6), 2 + up * 7, Math.sin(a) * sp * (1 - up * 0.6), 0.55 + this.rnd() * 0.6, 1.8 + this.rnd() * 2.2)
    }
    for (let k = 0; k < 16; k++) {
      const a = this.rnd() * 6.283, sp = 1 + this.rnd() * 3, sh = 0.05 + this.rnd() * 0.07
      this.dust.smoke(x + Math.cos(a) * 0.8, y + this.rnd() * 1.2, z + Math.sin(a) * 0.8, Math.cos(a) * sp, 2.5 + this.rnd() * 3.5, Math.sin(a) * sp, 2.6 + this.rnd() * 2.2, 1.6, 4.5 + this.rnd() * 2.5, sh, sh, sh, 0.62)
    }
    this.burst('metal', x, y + 0.5, z, 0, 5, 0, 12, 7, tint)
    this.burst('glass', x, y + 0.8, z, 0, 4, 0, 14, 8)
    this.burst('trim', x, y + 0.4, z, 0, 5, 0, 3, 6, tint)
  }

  /**
   * ONE CAR, each frame: what has just happened to it made seen (its events: the dust of a dent, the pieces, a pane's
   * shards, a wheel away), and what its engine gives off now — steam, smoke, flames. `root`: the car in the world;
   * (vx, vy, vz): how it moves; `tint`: its paint; `wheelPart`: its wheel's mesh, for one torn off.
   */
  car(dt: number, dm: CarDamage, root: GFX.Object3D, vx: number, vy: number, vz: number, tint: GFX.Color | null, wheelPart: (() => { geo: GFX.BufferGeometry; mat: GFX.Material; r: number } | null) | null): void {
    const q = root.quaternion, P = root.position, v = this.v, w = this.w
    for (const e of dm.events) {
      v.set(e.x, e.y, e.z).applyQuaternion(q).add(P)
      w.set(e.dx, e.dy, e.dz).applyQuaternion(q)
      if (e.kind === 'dent') {
        const k = Math.min(1, e.k / 14)
        if (e.k > C.shot.dentDv + 0.1) {
          this.dust.puff(v.x, v.y, v.z, 0.3 + k * 0.9, Math.round(2 + k * 7), [0.42, 0.4, 0.38])
          // (torn metal from 6 m/s, a strip of trim from 9)
          if (e.k >= 6) this.burst('metal', v.x, v.y, v.z, vx * 0.6 - w.x * 2, vy * 0.6 + 1.5, vz * 0.6 - w.z * 2, Math.min(5, 1 + Math.floor((e.k - 6) / 3)), 2 + k * 3, tint)
          if (e.k >= 9 && this.rnd() < 0.6) this.burst('trim', v.x, v.y, v.z, vx * 0.6 - w.x * 2, vy * 0.6 + 2, vz * 0.6 - w.z * 2, 1, 2.5, tint)
        }
      } else if (e.kind === 'glass') this.burst('glass', v.x, v.y, v.z, vx * 0.7, vy * 0.7 + 0.5, vz * 0.7, Math.min(12, Math.round(5 + e.k * 9)), 2.6)
      else if (e.kind === 'lamp') this.burst('glass', v.x, v.y, v.z, vx * 0.7, vy * 0.7 + 0.8, vz * 0.7, 3, 1.8)
      else if (e.kind === 'tyre') this.dust.puff(v.x, v.y, v.z, 0.5, 5, [0.2, 0.2, 0.21])
      else if (e.kind === 'wheel') {
        const part = wheelPart?.()
        if (part) this.wheel(part.geo, part.mat, v.x, v.y, v.z, vx * 0.85 - w.x * 3 + (this.rnd() - 0.5) * 2, Math.max(1.5, vy + 2.5), vz * 0.85 - w.z * 3 + (this.rnd() - 0.5) * 2, part.r, e.k & 1 ? 1 : -1)
      } else if (e.kind === 'explode') this.explode(v.x, v.y, v.z, tint)
      this.onEvent?.(dm, e, v.x, v.y, v.z)
    }
    dm.events.length = 0
    // THE ENGINE: what comes off it now
    const smoke = dm.smoke, burning = dm.burning, sm = dm.smoulder > 0
    if (!smoke && !burning && !sm) return
    v.copy(dm.vent).applyQuaternion(q).add(P)
    const acc = dm.fxAcc
    if (burning || sm) {
      // (black smoke off the fire; after the blast it smoulders — less and less)
      const k = burning ? 1 : Math.min(1, dm.smoulder / 25)
      acc[0] += dt * (4 + 12 * k)
      while (acc[0] >= 1) {
        acc[0] -= 1
        const sh = 0.04 + this.rnd() * 0.06
        this.dust.smoke(v.x + (this.rnd() - 0.5) * 0.7, v.y + 0.2, v.z + (this.rnd() - 0.5) * 0.7, vx * 0.5 + (this.rnd() - 0.5) * 0.6, 1.6 + this.rnd() * 1.4, vz * 0.5 + (this.rnd() - 0.5) * 0.6, 2.2 + this.rnd() * 1.6, 0.5, 2.6 + this.rnd() * 1.6, sh, sh, sh, 0.55)
      }
      acc[1] += dt * (burning ? 34 : 14 * k)
      while (acc[1] >= 1) {
        acc[1] -= 1
        // (the fire: at the bonnet while it burns; all along the shell after the blast)
        const along = sm && !burning ? (this.rnd() - 0.5) * 2.6 : (this.rnd() - 0.5) * 0.9
        w.set((this.rnd() - 0.5) * 1.1, 0, along).applyQuaternion(q)
        this.flame(v.x + w.x, v.y + w.y - 0.1, v.z + w.z, vx * 0.8 + (this.rnd() - 0.5) * 0.5, 1.5 + this.rnd() * 1.6, vz * 0.8 + (this.rnd() - 0.5) * 0.5, 0.4 + this.rnd() * 0.45, (0.42 + this.rnd() * 0.45) * (burning ? 1 : 0.6 + 0.4 * k))
      }
      return
    }
    // (steam: thin and white, gone in a second; then grey; black by the time it misfires)
    acc[0] += dt * (smoke === 1 ? 7 : smoke === 2 ? 11 : 15)
    while (acc[0] >= 1) {
      acc[0] -= 1
      const sh = smoke === 1 ? 0.86 : smoke === 2 ? 0.46 : 0.13 + this.rnd() * 0.05
      this.dust.smoke(v.x + (this.rnd() - 0.5) * 0.5, v.y, v.z + (this.rnd() - 0.5) * 0.5, vx * 0.55 + (this.rnd() - 0.5) * 0.4, 0.9 + this.rnd() * 0.9, vz * 0.55 + (this.rnd() - 0.5) * 0.4,
        smoke === 1 ? 0.8 + this.rnd() * 0.6 : 1.5 + this.rnd() * 1.2, 0.25, smoke === 1 ? 0.9 : 1.5 + this.rnd() * (smoke === 3 ? 1.4 : 0.8), sh, sh, sh + (smoke === 1 ? 0.02 : 0), smoke === 1 ? 0.2 : smoke === 2 ? 0.32 : 0.46)
    }
  }

  /** Each frame: the pieces fall, bounce and lie; the loose wheels roll; the flames rise. */
  update(dt: number): void {
    if (dt <= 0) return
    const box = this.box.makeEmpty()
    for (const p of this.piles) {
      if (!p.live && !p.fresh) continue
      p.fresh = false
      const st = p.st, A = p.aP.array as Float32Array, Q = p.aQ.array as Float32Array
      let live = 0
      for (let i = 0; i < p.n; i++) {
        const o = i * DK, life = st[o + 14]
        if (life <= 0) { A[i * 4 + 3] = 0; continue }
        const age = (st[o + 13] += dt)
        if (age >= life) { st[o + 14] = 0; A[i * 4 + 3] = 0; continue }
        live++
        const moving = st[o + 3] !== 0 || st[o + 4] !== 0 || st[o + 5] !== 0
        if (moving) {
          st[o + 4] -= 9.81 * dt
          st[o] += st[o + 3] * dt; st[o + 1] += st[o + 4] * dt; st[o + 2] += st[o + 5] * dt
          const deck = this.map.bridgeAt(st[o], st[o + 2])
          const floor = Math.max(this.map.height(st[o], st[o + 2]), deck !== null && st[o + 1] > deck - 0.5 ? deck : -1e9) + 0.02
          if (st[o + 1] < floor) {
            st[o + 1] = floor
            if (Math.abs(st[o + 4]) < 1.2 && Math.hypot(st[o + 3], st[o + 5]) < 0.6) { st[o + 3] = st[o + 4] = st[o + 5] = 0; st[o + 10] = st[o + 11] = st[o + 12] = 0 }
            else { st[o + 4] = -st[o + 4] * 0.32; st[o + 3] *= 0.55; st[o + 5] *= 0.55; st[o + 10] *= 0.5; st[o + 11] *= 0.5; st[o + 12] *= 0.5 }
          }
          // (its tumble: the turn of this frame put on its quaternion)
          const wx = st[o + 10] * dt * 0.5, wy = st[o + 11] * dt * 0.5, wz = st[o + 12] * dt * 0.5
          const qx = st[o + 6], qy = st[o + 7], qz = st[o + 8], qw = st[o + 9]
          let nx = qx + wx * qw + wy * qz - wz * qy, ny = qy - wx * qz + wy * qw + wz * qx, nz = qz + wx * qy - wy * qx + wz * qw, nw = qw - wx * qx - wy * qy - wz * qz
          const l = 1 / Math.hypot(nx, ny, nz, nw)
          nx *= l; ny *= l; nz *= l; nw *= l
          st[o + 6] = nx; st[o + 7] = ny; st[o + 8] = nz; st[o + 9] = nw
        }
        // (the last second: it shrinks away)
        const size = st[o + 15] * Math.min(1, (life - age) / 1)
        A[i * 4] = st[o]; A[i * 4 + 1] = st[o + 1]; A[i * 4 + 2] = st[o + 2]; A[i * 4 + 3] = size
        Q[i * 4] = st[o + 6]; Q[i * 4 + 1] = st[o + 7]; Q[i * 4 + 2] = st[o + 8]; Q[i * 4 + 3] = st[o + 9]
        box.expandByPoint(this.v.set(st[o] - p.half, st[o + 1] - p.half, st[o + 2] - p.half)); box.expandByPoint(this.v.set(st[o] + p.half, st[o + 1] + p.half, st[o + 2] + p.half))
      }
      p.live = live
    }
    // the flames
    const fst = this.fst, FP = this.fP.array as Float32Array, FS = this.fS.array as Float32Array
    let fl = 0
    for (let i = 0; i < FLAMES; i++) {
      const o = i * FK, life = fst[o + 7]
      if (life <= 0) { FP[i * 4 + 3] = 0; continue }
      const age = (fst[o + 6] += dt)
      if (age >= life) { fst[o + 7] = 0; FP[i * 4 + 3] = 0; continue }
      fl++
      const drag = Math.exp(-dt * 2.2)
      fst[o + 3] *= drag; fst[o + 5] *= drag; fst[o + 4] = fst[o + 4] * drag + dt * 2.4
      fst[o] += fst[o + 3] * dt; fst[o + 1] += fst[o + 4] * dt; fst[o + 2] += fst[o + 5] * dt
      const t = age / life, size = fst[o + 8] * (0.55 + 0.75 * t)
      FP[i * 4] = fst[o]; FP[i * 4 + 1] = fst[o + 1]; FP[i * 4 + 2] = fst[o + 2]; FP[i * 4 + 3] = size
      FS[i * 4] = fst[o + 9]; FS[i * 4 + 1] = t; FS[i * 4 + 2] = 0; FS[i * 4 + 3] = 0
      box.expandByPoint(this.v.set(fst[o] - size, fst[o + 1] - size, fst[o + 2] - size)); box.expandByPoint(this.v.set(fst[o] + size, fst[o + 1] + size * 1.6, fst[o + 2] + size))
    }
    this.fLive = fl
    // the loose wheels: rolling the way they go, slowing; then over onto their side
    for (let i = this.wheelsLoose.length - 1; i >= 0; i--) {
      const lw = this.wheelsLoose[i]
      lw.age += dt
      if (lw.age > this.life) { lw.mesh.removeFromParent(); this.wheelsLoose.splice(i, 1); continue }
      lw.vy -= 9.81 * dt
      lw.x += lw.vx * dt; lw.y += lw.vy * dt; lw.z += lw.vz * dt
      const sp = Math.hypot(lw.vx, lw.vz)
      const lying = 0.14 + (lw.r - 0.14) * Math.cos(lw.tilt)
      const floor = this.map.height(lw.x, lw.z) + lying
      if (lw.y < floor) {
        lw.y = floor
        lw.vy = lw.vy < -2.5 ? -lw.vy * 0.35 : 0
        const slow = Math.max(0, sp - (1.3 + 3 * lw.tilt) * dt) / Math.max(sp, 1e-6)
        lw.vx *= slow; lw.vz *= slow
      }
      if (sp > 0.3) { lw.yaw = Math.atan2(-lw.vx, -lw.vz); lw.spin += (sp / lw.r) * dt }
      if (sp < 1.2) lw.tilt = Math.min(Math.PI / 2, lw.tilt + dt * 2.2)
      // (yaw to its way, over onto its side, spun on its axle)
      this.q.setFromEuler(this.e.set(-lw.spin, lw.yaw, lw.tilt * lw.side, 'YZX'))
      lw.mesh.setMatrixAt(0, this.m4.compose(this.v.set(lw.x, lw.y, lw.z), this.q, this.one))
      lw.mesh.instanceMatrix.needsUpdate = true
      box.expandByPoint(this.v.set(lw.x - lw.r, lw.y - lw.r, lw.z - lw.r)); box.expandByPoint(this.v.set(lw.x + lw.r, lw.y + lw.r, lw.z + lw.r))
    }
  }

  /** Every piece moved by (dx, dy, dz) — the crossing moves the car into another world. */
  shift(dx: number, dy: number, dz: number): void {
    for (const p of this.piles) for (let i = 0; i < p.n; i++) { p.st[i * DK] += dx; p.st[i * DK + 1] += dy; p.st[i * DK + 2] += dz }
    for (let i = 0; i < FLAMES; i++) { this.fst[i * FK] += dx; this.fst[i * FK + 1] += dy; this.fst[i * FK + 2] += dz }
    for (const lw of this.wheelsLoose) { lw.x += dx; lw.y += dy; lw.z += dz }
  }

  /** Drawn (and sent) only while something of it is alive, in view and not behind the hills. */
  cull(view: GFX.Frustum, horizon: Horizon): void {
    const seen = !this.box.isEmpty() && view.intersectsBox(this.box) && !horizon.hiddenBox(this.box)
    for (const p of this.piles) {
      p.mesh.visible = seen && p.live > 0
      if (p.mesh.visible) { p.aP.needsUpdate = true; p.aQ.needsUpdate = true }
    }
    this.flames.visible = seen && this.fLive > 0
    if (this.flames.visible) { this.fP.needsUpdate = true; this.fS.needsUpdate = true }
    for (const lw of this.wheelsLoose) lw.mesh.visible = seen
  }

  /** (the harness) what is about: pieces, flames, loose wheels. */
  get counts(): { debris: number; flames: number; wheels: number } { return { debris: this.piles.reduce((s, p) => s + p.live, 0), flames: this.fLive, wheels: this.wheelsLoose.length } }
}

const DEBRIS_VERT = /* glsl */ `
in vec4 aP;
in vec4 aQ;
in vec4 aC;
out vec3 vWorld;
out vec3 vN;
out vec3 vCol;
out float vGlass;
vec3 turn(vec3 v, vec4 q) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 w = aP.xyz + turn(position * aP.w, aQ);
  vWorld = w;
  vN = turn(normal, aQ);
#ifdef USE_COLOR
  vCol = color * aC.rgb;
#else
  vCol = aC.rgb;
#endif
  vGlass = aC.a;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  if (aP.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // (not there: off screen)
}
`
const DEBRIS_FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
in vec3 vWorld;
in vec3 vN;
in vec3 vCol;
in float vGlass;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorld);
  float sun = sunVisibility(vWorld.xz);
  vec3 c = shade(vCol, N, V, mix(0.8, 0.3, vGlass), 0.04, 1.0, sun, 0.3);
  // (glass: its faces flash as it turns)
  c += vGlass * uSunColor * sun * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 48.0) * 1.6;
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// THE FLAMES (the user, 2026-11-21, of the weapons' effects: "like real fire", not a tinted glow): each a tongue — wide
// at its foot, drawn to a point, its edge eaten by noise that climbs through it — white-yellow at the core, orange,
// red at the edge and as it dies; standing up in the world, turned to the camera; added above white.
const FLAME_VERT = /* glsl */ `
in vec4 aP;
in vec4 aS;
out vec2 vQ;
out vec2 vS;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec2 q = position.xy * 2.0;
  vec3 w = aP.xyz + right * (q.x * aP.w * 0.5) + vec3(0.0, 1.0, 0.0) * ((q.y + 0.6) * aP.w * 0.8);
  vQ = q;
  vS = aS.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  if (aP.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`
const FLAME_FRAG = /* glsl */ `
layout(location = 0) out highp vec4 outColor;
uniform sampler2D uNoise;
uniform float uTime;
in vec2 vQ;
in vec2 vS;
void main() {
  float seed = vS.x, t = vS.y;
  // the tongue: narrower the higher, leaning as the noise pushes it
  float n1 = texture(uNoise, vec2(vQ.x * 0.21 + seed * 7.0, vQ.y * 0.19 - uTime * 0.9 + seed * 3.0)).r;
  float n2 = texture(uNoise, vec2(vQ.x * 0.55 + seed * 13.0, vQ.y * 0.5 - uTime * 2.1 + seed)).g;
  float up = vQ.y * 0.5 + 0.5;
  float x = vQ.x + (n1 - 0.5) * 0.7 * up;
  float body = 1.0 - length(vec2(x * (1.25 + 1.5 * up * up), (vQ.y + 0.25) * 0.8));
  float f = body + (n1 - 0.5) * 0.75 + (n2 - 0.5) * 0.45;
  // (it dies from its edge in: the older, the more of it eaten)
  float heat = smoothstep(0.02 + t * 0.55, 0.55 + t * 0.4, f) * min(1.0, t * 14.0);
  if (heat < 0.004) discard;
  vec3 col = mix(vec3(0.85, 0.09, 0.01), vec3(1.0, 0.45, 0.06), smoothstep(0.1, 0.45, heat));
  col = mix(col, vec3(1.0, 0.86, 0.42), smoothstep(0.5, 0.95, heat));
  outColor = vec4(col * heat * (2.6 - 1.2 * t), 1.0);
}
`
