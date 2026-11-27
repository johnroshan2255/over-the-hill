import * as GFX from './gfx'
import type { Character, ClipName } from './Character'
import type { MapData } from './MapData'
import type { Vehicle } from './Vehicle'
import type { Session } from '../net/Session'
import type { RopeState } from '../net/wire'
import type { TowPoints } from '../assets/loadModels'

/**
 * THE WINCH AND ITS TOW ROPE, BY HAND (2026-11-25, the user: "connect the grappling hook to other users' vehicles so
 * when any user is stuck we can pull them … no more connect to a tree — connect to a car, manually: click the button,
 * the rope comes, the human takes it in his hand and goes and connects it to the other player's car").
 *
 * Every car has a winch behind its front bumper (its FAIRLEAD — where the line comes out) and three RECOVERY POINTS a
 * hook can go on, one hook each, as a real 4×4: two shackles at the front (left, right) and the hitch at the back. So a
 * stuck car can have three lines on it at once, from three helpers' winches.
 *
 *   TAKE THE HOOK   WINCH (the wheel) / E — in the car you get out; you walk to your bumper and take the hook off it
 *                   (`hook_take`, made in Blender: scripts/oth/fight.py SET=rope). It's in your right hand.
 *   CARRY IT        walk anywhere: the line pays off the drum behind you, lying on the ground — 25 m of it (ROPE_MAX, the user: 2026-11-25);
 *                   at its end you're held.
 *   HOOK ON         by another player's car (or a vault's keystone), E at a recovery point: you go down on a knee and
 *                   clip it on (`hook_attach`). Taken: the server says so (`That hook point is taken`).
 *   WINCH IN        WINCH / E — in your car, or on foot anywhere (a winch's remote): the drum pulls in at 0.9 m/s. The
 *                   line is a stiff spring once taut: it pulls BOTH cars, at their two ends — each in its own player's
 *                   game (yours pulls yours toward theirs; theirs, told the rope, pulls theirs toward yours) — up to
 *                   TMAX (a 9 500 lb winch); harder than that it stalls. A parked car being pulled is let off its brakes
 *                   (Vehicle.tow). Drive away from them instead and you tow them.
 *   UNHOOK          E at the hook (`hook_detach`): it's back in your hand. HANG IT BACK: E at your own bumper
 *                   (`hook_stow`). Get in your car with it in your hand: it's let go and wound back in.
 *
 * On the wire: `rope` (net/wire.ts) — its state, whose car and which point, the line's length, the winch running. The
 * others draw every rope (from its owner's fairlead to the hook — in a hand, or on a car), play the moves on their
 * walkers, and pull their own car when it's on the end of one.
 */
export const ROPE_MAX = 25
const REEL = 0.9, MIN_LEN = 1.5
/** The line as a spring (N/m), its damping (N·s/m), the most the winch pulls (N). */
const K = 60000, C = 8000, TMAX = 42000

/** Something else a hook goes on (a Warden vault's keystone — Wardens.ts): where its ring is, its name, what happens
 *  when it has been PULLED — the line held taut for long enough. */
export interface WinchAnchor { x: number; y: number; z: number; what: string; onPulled: () => void }
/** The load on the line (in the car's weights × seconds) that pulls such a thing out. */
const PULL = 1.5

/** What a car's points are worked out from: its own model — where its bumpers' faces are (`tow`: loadModels `towOf`),
 *  and its sizes (a model with no bumper found: by its box, as every car was till 2026-11-27 — in the air on most). */
interface Dims { half: { x: number; y: number; z: number }; front: number; rear: number; wheelRadius: number; tow?: TowPoints | null }
/** How far before the bumper's face a hook's bowl sits in its eye, and the line leaves the fairlead (m). */
const OUT = 0.035, LEAD_OUT = 0.022
/** A car in the world: where it is (its root) and its sizes. */
export interface TowCar { root: GFX.Object3D; dims: Dims; name: string }
const POINT_NAMES = ['front left', 'front right', 'rear']

/** A car's FAIRLEAD (where its winch line comes out) in its own space. */
function fairlead(d: Dims, out: GFX.Vector3): GFX.Vector3 {
  const t = d.tow
  return t ? out.set(t.fairlead[0], t.fairlead[1], t.fairlead[2] - LEAD_OUT) : out.set(0, d.wheelRadius + 0.32, d.front - 0.02)
}
/** A car's recovery point k where its tow eye stands ON the bumper (its own space). */
function eyeBase(d: Dims, k: number, out: GFX.Vector3): GFX.Vector3 {
  const t = d.tow
  if (t) return out.set(t.points[k][0], t.points[k][1], t.points[k][2])
  return k === 2 ? out.set(0, d.wheelRadius + 0.1, d.rear) : out.set((k === 0 ? -1 : 1) * d.half.x * 0.55, d.wheelRadius + 0.1, d.front)
}
/** A car's recovery point k (0 front left, 1 front right, 2 the rear hitch) in its own space. */
function pointOf(d: Dims, k: number, out: GFX.Vector3): GFX.Vector3 {
  // (where a hook's bowl sits: in the tow eye, out before the bumper's face)
  eyeBase(d, k, out)
  out.z += k === 2 ? OUT : -OUT
  return out
}
const toWorld = (c: TowCar, v: GFX.Vector3) => v.applyMatrix4(c.root.matrixWorld)

/** HOW THE HOOK IS CARRIED (made again 2026-11-25 — the user: "the hook carried in the hand looks really bad, it must
 *  be like real life"): as a man walks a winch line out — the hook's eye in his right fist, the arm hanging at his side
 *  a little bent with its weight, the hook hanging straight down from the fist by his thigh, the line leaving the back
 *  of his fist for the ground behind him. It swings with the stride, less than a free arm (the line drags at it).
 *  In his own space (x to his right, y up, z behind): the wrist, the elbow back. Inside his `handIK`; yours and every
 *  co-op player's (Remotes). */
export function carryHold(h: Character): void {
  // (walking: the arm hangs and swings a little; running: the elbow bends and it swings as a runner's does, the hook
  //  with it — `run` 0 at a walk's pace … 1 at a run's)
  const G = h.grip, k = Math.min(1, h.speed / 1.7), run = Math.max(0, Math.min(1, (h.speed - 2.2) / 2.4))
  const sw = Math.sin(h.stridePhase * Math.PI * 2) * k, amp = 0.07 + run * 0.12
  G.r[0] = 0.215 + run * 0.01; G.r[1] = 0.915 + run * 0.1 + Math.max(0, -sw) * run * 0.08 + Math.abs(sw) * 0.012; G.r[2] = -0.045 - run * 0.06 + sw * amp
  G.rp[0] = 0.25; G.rp[1] = -0.1 - run * 0.3; G.rp[2] = 1
  G.rOn = true
}

/** THE HOOK (a forged winch hook, red, its latch steel): made here — its eye, the shank, the bowl, the latch. Its own
 *  space: the eye up (+y), the bowl's middle at the origin, the opening to +x. */
function hookGeometry(): GFX.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
  const tube = (path: GFX.Vector3[], r: number, c: [number, number, number], sides = 7) => {
    const base = pos.length / 3, t = new GFX.Vector3(), n = new GFX.Vector3(), b = new GFX.Vector3(), up = new GFX.Vector3(0, 0, 1)
    for (let i = 0; i < path.length; i++) {
      t.subVectors(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]).normalize()
      n.crossVectors(up, t).normalize(); b.crossVectors(t, n)
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a)
        const nx = n.x * cx + b.x * cy, ny = n.y * cx + b.y * cy, nz = n.z * cx + b.z * cy
        pos.push(path[i].x + nx * r, path[i].y + ny * r, path[i].z + nz * r); nor.push(nx, ny, nz); uv.push(s / sides, i / path.length); col.push(...c)
      }
    }
    for (let i = 0; i < path.length - 1; i++) for (let s = 0; s < sides; s++) {
      const a = base + i * (sides + 1) + s, d = a + sides + 1
      idx.push(a, d, a + 1, a + 1, d, d + 1)
    }
  }
  // (forged and painted: a deep red, not a toy's; the latch's spring steel dull)
  const red: [number, number, number] = [0.21, 0.022, 0.018], steel: [number, number, number] = [0.13, 0.135, 0.13]
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return new GFX.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0) })
  // (the bowl: round under its middle from the shank to the tip, up on the far side)
  const R = 0.034
  tube([new GFX.Vector3(-R, 0.115, 0), new GFX.Vector3(-R, 0.06, 0), ...arc(0, 0, R, Math.PI, Math.PI * 2 + 0.75, 12)], 0.011, red)
  // the eye at the top, the line's thimble through it
  tube(arc(-R, 0.135, 0.019, -Math.PI / 2, Math.PI * 1.5, 12), 0.006, red)
  // the latch: from the shank to the tip
  tube([new GFX.Vector3(-R + 0.006, 0.05, 0), new GFX.Vector3(R * Math.cos(0.75) - 0.004, R * Math.sin(0.75) + 0.004, 0)], 0.0035, steel, 5)
  return built(pos, nor, uv, col, idx)
}
function built(pos: number[], nor: number[], uv: number[], col: number[], idx: number[]): GFX.BufferGeometry {
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new GFX.BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('uv', new GFX.BufferAttribute(new Float32Array(uv), 2))
  g.setAttribute('color', new GFX.BufferAttribute(new Float32Array(col), 3))
  g.setIndex(idx)
  return g
}
/** A car's TOW EYE (a recovery point — the cars' models have none): a forged steel loop out of the bumper on a plate.
 *  Its own space: the loop's middle at the origin, standing up in the y-z plane, out toward −z. */
function eyeGeometry(): GFX.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
  const c: [number, number, number] = [0.09, 0.092, 0.095], R = 0.032, r = 0.0085, n = 16, sides = 7
  const base = pos.length / 3
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a)
    for (let s = 0; s <= sides; s++) {
      const b = (s / sides) * Math.PI * 2, rr = R + r * Math.cos(b)
      // (the ring in the y-z plane; its tube's round in the ring's own radial-x plane)
      pos.push(r * Math.sin(b), cy * rr, cx * rr - R * 0.6); nor.push(Math.sin(b), cy * Math.cos(b), cx * Math.cos(b)); uv.push(i / n, s / sides); col.push(...c)
    }
  }
  for (let i = 0; i < n; i++) for (let s = 0; s < sides; s++) { const a = base + i * (sides + 1) + s, d = a + sides + 1; idx.push(a, d, a + 1, a + 1, d, d + 1) }
  return built(pos, nor, uv, col, idx)
}
/** The hook's eye in its own space (where the line ends). */
const EYE = new GFX.Vector3(-0.034, 0.155, 0)

/** One rope drawn: a ROUND line (a 3/8" synthetic winch rope, 12 mm, dark grey; lit as the world is) from a to b. Hung by
 *  its slack, then LAID ON THE GROUND AS IT IS DRAWN (`ground`): it never goes into the earth (2026-11-25, the user: "why
 *  does the rope go under the terrain" — it lay on the map's height, and the terrain is drawn as flat triangles over a
 *  2 m grid: in a hollow the drawn ground is above the true one). Carried, the line paid out lies on the ground — off
 *  the fist it drops to it in a metre, and rises to the fairlead the same way. `centre`: its middle line (the harness). */
const SEG = 72, SIDES = 6, ROPE_R = 0.006
class Line {
  readonly mesh: GFX.Mesh
  readonly centre = new Float32Array((SEG + 1) * 3)
  private readonly pos = new Float32Array((SEG + 1) * (SIDES + 1) * 3)
  private readonly nor = new Float32Array((SEG + 1) * (SIDES + 1) * 3)
  private readonly geo = new GFX.BufferGeometry()
  constructor(mat: GFX.Material) {
    const n = (SEG + 1) * (SIDES + 1), col = new Float32Array(n * 3), uv = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { col[i * 3] = 0.045; col[i * 3 + 1] = 0.046; col[i * 3 + 2] = 0.05 }
    this.geo.setAttribute('position', new GFX.BufferAttribute(this.pos, 3).setUsage(GFX.DynamicDrawUsage))
    this.geo.setAttribute('normal', new GFX.BufferAttribute(this.nor, 3).setUsage(GFX.DynamicDrawUsage))
    this.geo.setAttribute('uv', new GFX.BufferAttribute(uv, 2))
    this.geo.setAttribute('color', new GFX.BufferAttribute(col, 3))
    const idx: number[] = []
    for (let i = 0; i < SEG; i++) for (let k = 0; k < SIDES; k++) {
      const a = i * (SIDES + 1) + k, d = a + SIDES + 1
      idx.push(a, d, a + 1, a + 1, d, d + 1)
    }
    this.geo.setIndex(idx)
    this.mesh = new GFX.Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }
  set(a: GFX.Vector3, b: GFX.Vector3, len: number, ground: (x: number, z: number) => number, carried: boolean): void {
    const d = a.distanceTo(b), C = this.centre
    // (the slack's sag; carried, the line paid out lies down — as much sag as drops it to the ground in a metre)
    let sag = Math.sqrt(Math.max(0, len * len - d * d)) * 0.5
    if (carried) sag = Math.max(sag, 0.24 * d + 0.2)
    const lift = ROPE_R + 0.012
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t
      const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)
      C[i * 3] = x; C[i * 3 + 1] = Math.max(y, ground(x, z) + lift); C[i * 3 + 2] = z
    }
    // the tube round it
    const P = this.pos, N = this.nor
    for (let i = 0; i <= SEG; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(SEG, i + 1)
      let tx = C[i1 * 3] - C[i0 * 3], ty = C[i1 * 3 + 1] - C[i0 * 3 + 1], tz = C[i1 * 3 + 2] - C[i0 * 3 + 2]
      const tl = Math.hypot(tx, ty, tz) || 1
      tx /= tl; ty /= tl; tz /= tl
      // (n: across it, level; m: the third way)
      let nx = tz, nz = -tx
      const nl = Math.hypot(nx, nz)
      if (nl < 1e-4) { nx = 1; nz = 0 } else { nx /= nl; nz /= nl }
      const mx = ty * nz, my = tz * nx - tx * nz, mz = -ty * nx
      for (let k = 0; k <= SIDES; k++) {
        const th = (k / SIDES) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th)
        const ox = nx * c + mx * s, oy = my * s, oz = nz * c + mz * s, o = (i * (SIDES + 1) + k) * 3
        P[o] = C[i * 3] + ox * ROPE_R; P[o + 1] = C[i * 3 + 1] + oy * ROPE_R; P[o + 2] = C[i * 3 + 2] + oz * ROPE_R
        N[o] = ox; N[o + 1] = oy; N[o + 2] = oz
      }
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.normal.needsUpdate = true
    this.geo.computeBoundingSphere()
    this.mesh.visible = true
  }
}

/** What the winch needs of the game (main.ts). */
export interface WinchHost {
  hero: Character
  car: Vehicle
  map: () => MapData
  /** On foot and free (not seated, not riding, no cut playing). */
  onFoot(): boolean
  /** At the wheel of the car. */
  inCar(): boolean
  /** Out of the car (then: once he stands outside). */
  getOut(then: () => void): void
  /** Co-op: the session, the others' cars (driven or parked, drawn) and their walkers. */
  session(): Session | null
  carOf(sid: number): TowCar | null
  walkerOf(sid: number): Character | null
  /** A vault's keystone near (Wardens.ts). */
  extra(): WinchAnchor[]
  toast(m: string): void
}

type Target = { sid: number; point: number } | { anchor: WinchAnchor }

export class Winch {
  /** E toggles the winch in the car (main.ts sets it as you get in and out). */
  keysOn = true
  readonly group = new GFX.Group()
  state: 'stowed' | 'hand' | 'hooked' = 'stowed'
  /** The line paid out (m); the drum pulling in. */
  len = 0
  reel = false
  private target: Target | null = null
  /** (a hook being taken off: where it was — drawn there till the hands have it) */
  private pending: Target | null = null
  private pulled = 0
  /** A move playing (the hook taken, put on…): what to do at its moment, and after. */
  private busy = false
  private walk: { x: number; z: number; face: number; t: number; then: () => void } | null = null
  /** The hook in the hand (false: on the car / on the drum) — through a move it changes at the move's moment. */
  private inHand = false
  private moveAt: { p: number; f: () => void } | null = null
  /** The move playing, and its end — had by its clip's own end, or (cut short: a blow, a reset, down) when he no
   *  longer plays it: never left waiting on it. */
  private moving: ClipName | null = null
  private moveEnd: (() => void) | null = null
  private readonly lines: Line[] = []
  private readonly hooks: GFX.Mesh[] = []
  private readonly lineMat: GFX.Material
  private hookMat: GFX.Material | null = null
  private hookGeo: GFX.BufferGeometry | null = null
  private sent = { state: 'none' as RopeState, len: -1, reel: false, at: 0 }
  private ropeClips = false
  private readonly va = new GFX.Vector3()
  private readonly vb = new GFX.Vector3()
  private readonly vc = new GFX.Vector3()
  private readonly vd = new GFX.Vector3()
  private readonly m4 = new GFX.Matrix4()
  // (the drawing's scratch — no new objects a frame: docs/PERF.md "the garbage")
  private readonly dEye = new GFX.Vector3()
  private readonly dLead = new GFX.Vector3()
  private readonly dFrom = new GFX.Vector3()
  private readonly dAt = new GFX.Vector3()
  private readonly bUp = new GFX.Vector3()
  private readonly bSide = new GFX.Vector3()
  private readonly bZ = new GFX.Vector3()
  private readonly carryFn: () => void
  private unlisten: (() => void) | null = null

  constructor(private readonly host: WinchHost, private readonly ropeUrl: string) {
    this.lineMat = new GFX.MeshBasicMaterial({ color: new GFX.Color(0.07, 0.065, 0.06), side: GFX.DoubleSide })
    this.carryFn = () => carryHold(host.hero)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      // (a key pressed while the game is still being built: what it asks of may not be there yet)
      try { if ((this.keysOn && host.inCar()) || (host.onFoot() && this.wantsE())) this.press() } catch { /* not yet */ }
    })
  }

  /** The hook's material: the weapons' (lit as the world is) — main.ts gives it. */
  setLook(mat: GFX.Material): void { this.hookMat = mat }

  /** (co-op) joined: the server's word on our own rope — their car gone, or another: the hook's back in our hand. */
  joined(s: Session): void {
    this.unlisten?.()
    this.unlisten = s.on((e) => {
      if (e.t !== 'rope' || e.sid !== s.me.sid || e.state !== 'hand' || this.state !== 'hooked') return
      const name = this.target && 'sid' in this.target ? this.host.carOf(this.target.sid)?.name ?? 'their' : 'their'
      this.target = null; this.reel = false
      if (this.host.onFoot()) { this.state = 'hand'; this.inHand = true; this.host.toast(`${name} car is gone — the hook is back in your hand`) }
      else { this.state = 'stowed'; this.inHand = false; this.host.toast(`${name} car is gone — the line winds back in`) }
    })
  }

  get attached(): boolean { return this.state === 'hooked' }
  get carrying(): boolean { return this.state === 'hand' }

  // ---------------------------------------------------------------------------------------------------- the points
  private dims(): Dims | null { return this.host.car.model }
  private myCar(): TowCar | null { const d = this.dims(); return d ? { root: this.host.car.root, dims: d, name: 'your' } : null }
  /** Our fairlead in the world. */
  private lead(out: GFX.Vector3): GFX.Vector3 | null { const c = this.myCar(); return c ? toWorld(c, fairlead(c.dims, out)) : null }
  /** Where the hook is hooked (world), or null. */
  private hookedAt(out: GFX.Vector3): GFX.Vector3 | null {
    const t = this.target
    if (!t) return null
    if ('anchor' in t) return out.set(t.anchor.x, t.anchor.y, t.anchor.z)
    const c = this.host.carOf(t.sid)
    return c ? toWorld(c, pointOf(c.dims, t.point, out)) : null
  }
  /** The points free to hook within `r` m of the hero: the others' cars' (not taken), the keystones. */
  private nearPoint(r: number): { target: Target; at: GFX.Vector3; out: GFX.Vector3; what: string; d: number } | null {
    const S = this.host.session(), h = this.host.hero.pos
    let best: { target: Target; at: GFX.Vector3; out: GFX.Vector3; what: string; d: number } | null = null, bd = r
    if (S) {
      const taken = new Set<string>()
      for (const o of S.remotes.values()) if (o.rope?.state === 'hooked') taken.add(`${o.rope.to}:${o.rope.point}`)
      for (const o of S.remotes.values()) {
        const c = this.host.carOf(o.sid)
        if (!c) continue
        for (let k = 0; k < 3; k++) {
          if (taken.has(`${o.sid}:${k}`)) continue
          const at = toWorld(c, pointOf(c.dims, k, new GFX.Vector3()))
          const d = Math.hypot(at.x - h.x, at.z - h.z)
          if (d >= bd) continue
          // (the way out of the car from the point — forward for the front, back for the hitch)
          const out = toWorld(c, pointOf(c.dims, k, new GFX.Vector3()).setZ(k === 2 ? c.dims.rear + 1 : c.dims.front - 1)).sub(at).setY(0).normalize()
          bd = d; best = { target: { sid: o.sid, point: k }, at, out, what: `${o.name}'s car — ${POINT_NAMES[k]}`, d }
        }
      }
    }
    for (const a of this.host.extra()) {
      const d = Math.hypot(a.x - h.x, a.z - h.z)
      if (d >= bd) continue
      const out = new GFX.Vector3(h.x - a.x, 0, h.z - a.z).normalize()
      bd = d; best = { target: { anchor: a }, at: new GFX.Vector3(a.x, a.y, a.z), out, what: a.what, d }
    }
    return best
  }
  /** The spot before our own bumper (where the hook is taken from and hung back) and the way to face there. */
  private bumperSpot(): { x: number; z: number; face: number; d: number } | null {
    const c = this.myCar()
    if (!c) return null
    const p = toWorld(c, this.va.set(0, 0, c.dims.front - 0.55)), h = this.host.hero.pos
    const fw = this.vb.set(0, 0, -1).applyQuaternion(c.root.quaternion)
    return { x: p.x, z: p.z, face: Math.atan2(fw.x, fw.z), d: Math.hypot(p.x - h.x, p.z - h.z) }
  }

  // ---------------------------------------------------------------------------------------------------- the button
  /** What WINCH / E does now (the wheel's label). */
  label(): string {
    if (this.state === 'hooked') return this.atHook() ? 'Unhook' : this.reel ? 'Stop winch' : 'Winch in'
    if (this.state === 'hand') return this.host.onFoot() && (this.bumperSpot()?.d ?? 99) < 2.5 ? 'Hang the hook back' : 'Drop the hook'
    return 'Winch hook'
  }
  /** On foot: E is ours (not the gathering's) — by our bumper with the hook on it, carrying it, hooked. */
  wantsE(): boolean {
    if (this.busy) return true
    if (this.state !== 'stowed') return true
    return (this.bumperSpot()?.d ?? 99) < 2.5
  }
  /** The prompt on foot (E …), or null. */
  prompt(): [string, string] | null {
    if (!this.host.onFoot() || this.busy) return null
    if (this.state === 'stowed') return (this.bumperSpot()?.d ?? 99) < 2.5 ? ['E', 'Take the winch hook'] : null
    if (this.state === 'hand') {
      const p = this.nearPoint(2.4), bd = this.bumperSpot()?.d ?? 99
      // (both in reach — a car pulled up to your bumper: the nearer)
      if (p && !(bd < 2.5 && bd < p.d)) return ['E', `Hook onto ${p.what}`]
      if (bd < 2.5) return ['E', 'Hang the hook back']
      return null
    }
    const at = this.hookedAt(this.va)
    if (at && Math.hypot(at.x - this.host.hero.pos.x, at.z - this.host.hero.pos.z) < 2.4) return ['E', 'Unhook']
    return ['E', this.reel ? 'Stop the winch' : 'Winch in']
  }
  /** THE WHEEL'S WINCH button (and the phone's only way): as its label says — hooked, by the hook it unhooks, anywhere
   *  else it runs the winch (or stops it). */
  button(): void {
    if (this.state === 'hooked' && !this.busy && !this.atHook()) { this.winchIn(); return }
    this.press()
  }
  /** On foot, within reach of our hook on its point. */
  private atHook(): boolean {
    if (this.state !== 'hooked' || !this.host.onFoot()) return false
    const at = this.hookedAt(this.vd)
    return !!at && Math.hypot(at.x - this.host.hero.pos.x, at.z - this.host.hero.pos.z) < 2.4
  }
  private winchIn(): void {
    this.reel = !this.reel
    this.host.toast(this.reel ? 'Winching in' : 'Winch stopped')
    this.tell(true)
  }
  /** E (and the wheel's button when not hooked). */
  press(): void {
    const H = this.host
    if (this.busy) return
    if (this.state === 'hooked') {
      const at = this.hookedAt(this.va)
      if (H.onFoot() && at && Math.hypot(at.x - H.hero.pos.x, at.z - H.hero.pos.z) < 2.4) { this.unhook(); return }
      this.reel = !this.reel
      H.toast(this.reel ? 'Winching in' : 'Winch stopped')
      this.tell(true)
      return
    }
    if (this.state === 'hand') {
      const p = this.nearPoint(2.4), b = this.bumperSpot()
      if (p && H.onFoot() && !(b && b.d < 2.5 && b.d < p.d)) { this.hookOn(p); return }
      if (b && b.d < 2.5 && H.onFoot()) { this.stow(); return }
      this.drop()
      return
    }
    // stowed: out of the car if in it, to the bumper, take it
    if (H.inCar()) { if (H.car.speedKmh > 5) { H.toast('Stop the car to take the winch hook'); return } H.getOut(() => this.take()); return }
    if (H.onFoot()) this.take()
  }

  // ---------------------------------------------------------------------------------------------------- the moves
  private clips(): Promise<void> {
    if (this.ropeClips) return Promise.resolve()
    return this.host.hero.loadClips(this.ropeUrl).then(() => { this.ropeClips = true })
  }
  /** Walk to (x, z), turn to `face`, then. */
  private walkTo(x: number, z: number, face: number, then: () => void): void {
    this.busy = true
    this.walk = { x, z, face, t: 0, then }
  }
  /** A move in place: its moment at progress p (the hook changes hands there), then the end. */
  private move(name: ClipName, p: number, at: () => void, end: () => void): void {
    const h = this.host.hero
    this.busy = true
    void this.clips().then(() => {
      this.moveAt = { p, f: at }
      const done = () => { if (this.moving !== name) return; this.moving = null; if (this.moveAt) { this.moveAt.f(); this.moveAt = null } this.busy = false; end() }
      this.moving = name
      this.moveEnd = done
      if (!h.strike(name, { force: true, then: done })) done()
    })
  }
  // (EACH MOVE IS TOLD AS IT STARTS — the rope's new state — so the others' walker of you starts it with you: told at
  //  its moment, they saw the hook on the car before the knee went down. The hook itself goes from where it was to
  //  where it goes with the hands through the move — `draw`; `inHand` changes at the move's moment)
  private take(): void {
    const b = this.bumperSpot()
    if (!b) return
    if (b.d > 15) { this.host.toast('Go to the front of your car for the winch hook'); return }
    this.walkTo(b.x, b.z, b.face, () => {
      this.state = 'hand'; this.inHand = false; this.len = Math.max(1, this.len); this.tell(true)
      this.move('hook_take', 0.3, () => { this.inHand = true }, () => this.host.toast('The hook is in your hand — take it to a car and hook it on (front or back)'))
    })
  }
  private stow(): void {
    const b = this.bumperSpot()
    if (!b) return
    this.walkTo(b.x, b.z, b.face, () => {
      this.state = 'stowed'; this.len = 0; this.tell(true)
      this.move('hook_stow', 0.57, () => { this.inHand = false }, () => {})
    })
  }
  private drop(): void {
    this.inHand = false; this.state = 'stowed'; this.len = 0; this.reel = false; this.target = null
    this.host.toast('The hook is let go — the line winds back in')
    this.tell(true)
  }
  private hookOn(p: { target: Target; at: GFX.Vector3; out: GFX.Vector3; what: string }): void {
    const sx = p.at.x + p.out.x * 0.6, sz = p.at.z + p.out.z * 0.6
    this.walkTo(sx, sz, Math.atan2(-p.out.x, -p.out.z) + Math.PI, () => {
      this.state = 'hooked'; this.target = p.target; this.pulled = 0; this.reel = false
      const l = this.lead(this.va)
      this.len = l ? Math.min(ROPE_MAX, l.distanceTo(p.at) + 0.2) : 5
      this.tell(true)
      this.move('hook_attach', 0.43, () => {
        if (this.state !== 'hooked') return // (refused meanwhile: it's still in the hand)
        this.inHand = false
        this.host.toast('anchor' in p.target ? `Hooked onto ${p.what} — step back and WINCH to pull it out` : `Hooked onto ${p.what} — step back (or get in your car) and WINCH to pull them out`)
      }, () => {})
    })
  }
  private unhook(): void {
    const at = this.hookedAt(this.vc)
    if (!at) return
    const h = this.host.hero.pos, out = this.vd.set(h.x - at.x, 0, h.z - at.z).normalize()
    const sx = at.x + out.x * 0.6, sz = at.z + out.z * 0.6
    this.walkTo(sx, sz, Math.atan2(out.x, out.z), () => {
      this.pending = this.target
      this.state = 'hand'; this.target = null; this.reel = false; this.tell(true)
      this.move('hook_detach', 0.55, () => { this.inHand = true; this.pending = null }, () => { this.pending = null })
    })
  }
  /** Into the car with the hook in your hand: it's let go (main.ts, getting in). */
  letGo(): void { if (this.state === 'hand') this.drop() }
  /** Another world (the crossing): the line goes back on its drum. */
  setWorld(): void { if (this.state !== 'stowed') { this.state = 'stowed'; this.inHand = false; this.target = null; this.reel = false; this.len = 0; this.tell(true) } }

  /** Told to the server: on every change, and as the line runs in (5 a second) or out (2 a second). */
  private tell(now = false): void {
    const S = this.host.session()
    if (!S) return
    const st: RopeState = this.state === 'stowed' ? 'none' : this.state
    const t = performance.now(), s = this.sent
    const changed = st !== s.state || this.reel !== s.reel
    if (!now && !changed) {
      if (Math.abs(this.len - s.len) < (this.reel ? 0.15 : 0.6) || t - s.at < (this.reel ? 200 : 500)) return
    }
    const tg = this.target, to = tg && 'sid' in tg ? tg.sid : 0, point = tg && 'sid' in tg ? tg.point : 0
    const a = tg && 'anchor' in tg ? tg.anchor : null
    if (st === 'hooked' && s.state !== 'hooked' && to) {
      // (hooked onto a car: asked — another may have put theirs on that point a moment before: then it's back in hand)
      S.ask({ t: 'rope', state: st, to, point, len: this.len, reel: this.reel, x: 0, y: 0, z: 0 }).catch((e: Error) => {
        if (this.state !== 'hooked' || !this.target || !('sid' in this.target) || this.target.sid !== to) return
        this.state = 'hand'; this.inHand = true; this.target = null; this.reel = false
        this.host.toast(e.message)
        this.tell(true)
      })
    } else S.rope(st, st === 'hooked' ? to : 0, point, this.len, this.reel, a?.x ?? 0, a?.y ?? 0, a?.z ?? 0)
    s.state = st; s.len = this.len; s.reel = this.reel; s.at = t
  }

  // ---------------------------------------------------------------------------------------------------- the physics
  /** One end of a taut line: the body pulled at `at` toward `to` — a spring past the line's length, damped by its own
   *  speed along it, at most TMAX. The tension (N). */
  private pull(body: NonNullable<Vehicle['sim']>['body'], at: GFX.Vector3, to: GFX.Vector3, len: number, dt: number): number {
    const dx = to.x - at.x, dy = to.y - at.y, dz = to.z - at.z, d = Math.hypot(dx, dy, dz)
    if (d <= len || d < 1e-3) return 0
    const ux = dx / d, uy = dy / d, uz = dz / d, v = body.linvel()
    const T = Math.min(TMAX, K * (d - len) - C * (v.x * ux + v.y * uy + v.z * uz))
    if (T <= 0) return 0
    body.applyImpulseAtPoint({ x: ux * T * dt, y: uy * T * dt, z: uz * T * dt }, { x: at.x, y: at.y, z: at.z }, true)
    return T
  }
  /** Physics step: our line wound in and pulling our car; every line hooked to OUR car pulling it. */
  fixed(dt: number): void {
    const car = this.host.car, sim = car.sim, me = this.myCar()
    if (!sim || !me) return
    const lead = this.lead(this.va)!
    if (this.state === 'hooked') {
      const at = this.hookedAt(this.vb)
      if (!at) return
      const d = lead.distanceTo(at)
      if (this.reel) {
        // (the drum pulls in — stalled where the line would have to pull harder than it can)
        this.len = Math.max(MIN_LEN, Math.min(this.len, Math.max(this.len - REEL * dt, d - TMAX / K)))
        if (this.len <= MIN_LEN + 1e-3) { this.reel = false; this.host.toast('Winched in — the line is all in'); this.tell(true) }
      }
      const T = car.parked ? 0 : this.pull(sim.body, lead, at, this.len, dt)
      const tg = this.target
      if (tg && 'anchor' in tg && d > this.len) {
        const load = car.parked ? 1.3 : T / (sim.body.mass() * 9.81)
        this.pulled += load * dt
        if (this.pulled >= PULL) { const a = tg.anchor; this.state = 'stowed'; this.target = null; this.reel = false; this.len = 0; this.tell(true); a.onPulled() }
      }
    }
    // THE OTHERS' LINES ON OUR CAR: each pulls it toward its owner's fairlead (their car, as drawn here)
    const S = this.host.session()
    if (!S) return
    const now = performance.now()
    for (const o of S.remotes.values()) {
      const r = o.rope
      if (!r || r.state !== 'hooked' || r.to !== S.me.sid) continue
      const them = this.host.carOf(o.sid)
      if (!them) continue
      const from = toWorld(them, fairlead(them.dims, this.vc)), at = toWorld(me, pointOf(me.dims, r.point, this.vd))
      // (their length run on by their drum since they told it)
      const len = r.reel ? Math.max(MIN_LEN, r.len - (REEL * (now - r.at)) / 1000) : r.len
      if (at.distanceTo(from) > len - 0.05) car.tow()
      this.pull(sim.body, at, from, len, dt)
    }
  }

  // ---------------------------------------------------------------------------------------------------- per frame
  update(dt: number, camera: GFX.Camera): void {
    const H = this.host, h = H.hero
    // walking to a spot (to take, hang back, hook on, unhook)
    const w = this.walk
    if (w) {
      w.t += dt
      const dx = w.x - h.pos.x, dz = w.z - h.pos.z, d = Math.hypot(dx, dz)
      const df = Math.atan2(Math.sin(w.face - h.heading), Math.cos(w.face - h.heading))
      if ((d < 0.14 && Math.abs(df) < 0.12) || w.t > 5 || !H.onFoot()) {
        h.steer = null
        this.walk = null
        if (H.onFoot()) { h.heading = w.face; w.then() } else this.busy = false
      } else if (d >= 0.14) h.steer = { x: dx, z: dz, pace: d > 1.2 ? 1.7 : Math.max(0.6, d * 1.4) }
      else h.steer = { x: -Math.sin(w.face), z: -Math.cos(w.face), pace: 0 }
    }
    // a move's moment (the hook changes hands); a move cut short: ended now
    if (this.moveAt && h.progress >= this.moveAt.p && h.playing === this.moving) { const f = this.moveAt.f; this.moveAt = null; f() }
    if (this.moving && h.playing !== this.moving) this.moveEnd?.()
    // carrying: the line pays off the drum; at its end you're held
    const lead = this.lead(this.va)
    if (this.state === 'hand' && lead) {
      const hd = Math.hypot(h.pos.x - lead.x, h.pos.z - lead.z)
      if (hd > ROPE_MAX) {
        const k = (hd - ROPE_MAX) / hd
        h.shift((lead.x - h.pos.x) * k, 0, (lead.z - h.pos.z) * k)
        if (!this.heldWarned) { this.heldWarned = true; H.toast(`The line is all out — ${ROPE_MAX} m`) }
      } else if (hd < ROPE_MAX - 2) this.heldWarned = false
      this.len = Math.max(this.len, Math.min(ROPE_MAX, hd + 0.4))
    }
    this.tell()
    this.draw(camera)
  }
  private heldWarned = false
  /** HIS HANDS for the next pose — the hook carried (main.ts: right after the arsenal has set them, before he's posed). */
  hands(): void {
    const H = this.host, h = H.hero
    if (this.state === 'hand' && this.inHand && !this.busy && H.onFoot()) { h.handIK = this.carryFn; h.holdPose = 'grip'; return }
    // (not carrying — a move playing, the hook put down: our hold let go of, or it would hold his wrist where a man
    //  standing carries it: kneeling, that's up by his head)
    if (h.handIK === this.carryFn) { h.handIK = null; h.grip.rOn = false }
    if (this.busy && this.inHand) h.holdPose = 'grip'
  }

  /** THE GROUND AS IT IS DRAWN at (x, z): the terrain is flat triangles over a 2 m grid (Terrain.ts: its finest level on
   *  every tier — the leaf over its grid) from the map's edge, the map's height at their corners — which way each square
   *  is cut, the higher of the two, and never under the map's own height: what a rope lies on is never under what's seen. */
  private readonly drawnGround = (x: number, z: number): number => {
    const map = this.host.map(), S = 2, o = -map.farHalf
    const gx = (x - o) / S, gz = (z - o) / S, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const x0 = o + i * S, z0 = o + j * S
    const h00 = map.height(x0, z0), h10 = map.height(x0 + S, z0), h01 = map.height(x0, z0 + S), h11 = map.height(x0 + S, z0 + S)
    const a = fx > fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h01 - h00) * fz + (h11 - h01) * fx
    const b = fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
    return Math.max(map.height(x, z), a, b)
  }
  /** Every rope and hook drawn: ours and everyone's — and every car's hook on its winch while it's there. Through a
   *  move the hook goes WITH THE HANDS from where it was to where it goes (its place and its turn blended over the
   *  stretch of the clip the hands carry it): off the fairlead into the fist, from the fist onto the point, back. */
  private draw(_camera: GFX.Camera): void {
    let nl = 0, nh = 0
    const line = (a: GFX.Vector3, b: GFX.Vector3, len: number, carried = false) => {
      if (a.distanceTo(b) < 0.12) return
      let L = this.lines[nl]
      if (!L) { L = new Line(this.hookMat ?? this.lineMat); this.lines.push(L); this.group.add(L.mesh) }
      L.set(a, b, len, this.drawnGround, carried)
      nl++
    }
    const hook = (m: GFX.Matrix4) => {
      if (!this.hookMat) return
      let mesh = this.hooks[nh]
      if (!mesh) {
        this.hookGeo ??= hookGeometry()
        mesh = new GFX.Mesh(this.hookGeo, this.hookMat)
        mesh.frustumCulled = false; mesh.matrixAutoUpdate = false
        this.hooks.push(mesh); this.group.add(mesh)
      }
      mesh.matrix.copy(m); mesh.matrixWorld.copy(m); mesh.visible = true
      nh++
    }
    const S = this.host.session(), now = performance.now(), me = this.myCar()
    /** One player's hook and line: their car, their walker, the state, where it's hooked (world, or null), the move
     *  their walker plays and how far into it, the line's length. */
    const one = (car: TowCar, walker: Character | null, state: RopeState, at: GFX.Vector3 | null, was: GFX.Vector3 | null, len: number) => {
      const lead = toWorld(car, fairlead(car.dims, this.dLead))
      // (a walker out of view isn't posed — its clip stands still till it's seen: its rope as it stands, not mid-move)
      const posed = !!walker && (walker === this.host.hero || walker.root.visible)
      const mv = posed ? walker!.playing : null, pr = posed ? walker!.progress : 0
      const sm = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k) }
      // (from — to, and how far between)
      let A: 'stowed' | 'hand' | 'point' = state === 'none' ? 'stowed' : state === 'hand' ? 'hand' : 'point', B = A, w = 0
      if (mv === 'hook_take') { A = 'stowed'; B = 'hand'; w = sm((pr - 0.17) / 0.15) }
      else if (mv === 'hook_stow') { A = 'hand'; B = 'stowed'; w = sm((pr - 0.42) / 0.17) }
      else if (mv === 'hook_attach' && at) { A = 'hand'; B = 'point'; w = sm((pr - 0.2) / 0.23) }
      else if (mv === 'hook_detach' && was) { A = 'point'; B = 'hand'; w = sm((pr - 0.5) / 0.18) }
      const mat = (k: typeof A, out: GFX.Matrix4): boolean => {
        if (k === 'stowed') { this.stowed(car, out); return true }
        if (k === 'hand') return !!walker?.visible && this.handHook(walker, out)
        const p = mv === 'hook_detach' ? was : at
        if (!p) return false
        this.onPoint(p, lead, out)
        return true
      }
      if (!mat(A, this.m4)) return
      if (w > 0 && B !== A && mat(B, this.m4b)) this.blend(this.m4, this.m4b, w, this.m4)
      hook(this.m4)
      const eye = this.dEye.copy(EYE).applyMatrix4(this.m4)
      const inHand = (w < 0.5 ? A : B) === 'hand'
      line(lead, eye, Math.max(len, lead.distanceTo(eye) + (inHand ? 0.3 : 0.05)), inHand)
    }
    // ours
    if (me) {
      const st: RopeState = this.state === 'stowed' ? 'none' : this.state
      const h = this.host.hero, mine = this.moving && h.playing === this.moving ? h : null
      const at = this.state === 'hooked' ? this.hookedAt(this.dAt) : null
      const was = this.pending ? this.pointOfTarget(this.pending, this.dFrom) : null
      // (no move: carried — in the fist; a move playing — the move says where)
      one(me, mine ?? (st === 'hand' ? h : null), st, at, was, this.len)
    }
    // everyone else's (and their hooks on their winches)
    if (S) {
      for (const o of S.remotes.values()) {
        const c = this.host.carOf(o.sid)
        if (!c) continue
        const r = o.rope, st: RopeState = r?.state ?? 'none', walker = this.host.walkerOf(o.sid)
        let at: GFX.Vector3 | null = null
        if (r && st === 'hooked') {
          this.lastHook.set(o.sid, { to: r.to, point: r.point, x: r.x, y: r.y, z: r.z })
          at = this.remotePoint(r.to, r.point, r.x, r.y, r.z, this.dAt)
        }
        const lh = this.lastHook.get(o.sid)
        const was = lh && walker?.playing === 'hook_detach' ? this.remotePoint(lh.to, lh.point, lh.x, lh.y, lh.z, this.dFrom) : null
        const len = r ? (r.reel ? Math.max(MIN_LEN, r.len - (REEL * (now - r.at)) / 1000) : r.len) : 0
        one(c, walker, st, at, was, len)
      }
    }
    for (let i = nl; i < this.lines.length; i++) this.lines[i].mesh.visible = false
    for (let i = nh; i < this.hooks.length; i++) this.hooks[i].visible = false
    // THE TOW EYES: every car's three, as part of it (one draw for all)
    if (this.eyes && this.noEyes) this.eyes.visible = false
    else if (this.hookMat) {
      if (!this.eyes) {
        this.eyes = new GFX.InstancedMesh(eyeGeometry(), this.hookMat, 3 * 16)
        this.eyes.frustumCulled = false
        this.eyes.instanceMatrix.setUsage(GFX.DynamicDrawUsage)
        this.group.add(this.eyes)
      }
      let ne = 0
      const put = (c: TowCar) => {
        for (let k = 0; k < 3 && ne < 48; k++) {
          // (standing ON the bumper's own face — `eyeBase`)
          this.eyeL.makeRotationY(k === 2 ? Math.PI : 0).setPosition(eyeBase(c.dims, k, this.dTmp))
          this.eyeW.multiplyMatrices(c.root.matrixWorld, this.eyeL)
          this.eyes!.setMatrixAt(ne++, this.eyeW)
        }
      }
      if (me) put(me)
      if (S) for (const o of S.remotes.values()) { const c = this.host.carOf(o.sid); if (c) put(c) }
      this.eyes.count = ne
      this.eyes.visible = ne > 0
      this.eyes.instanceMatrix.needsUpdate = true
    }
  }
  private eyes: GFX.InstancedMesh | null = null
  /** (the harness) the tow eyes not drawn */
  noEyes = false
  private readonly eyeL = new GFX.Matrix4()
  private readonly eyeW = new GFX.Matrix4()
  private readonly lastHook = new Map<number, { to: number; point: number; x: number; y: number; z: number }>()
  private readonly m4b = new GFX.Matrix4()
  private readonly bp = [new GFX.Vector3(), new GFX.Vector3()]
  private readonly bq = [new GFX.Quaternion(), new GFX.Quaternion()]
  private readonly bs = new GFX.Vector3()
  /** Between two of the hook's places (its place lerped, its turn slerped). */
  private blend(a: GFX.Matrix4, b: GFX.Matrix4, w: number, out: GFX.Matrix4): void {
    a.decompose(this.bp[0], this.bq[0], this.bs); b.decompose(this.bp[1], this.bq[1], this.bs)
    this.bp[0].lerp(this.bp[1], w); this.bq[0].slerp(this.bq[1], w)
    out.compose(this.bp[0], this.bq[0], this.bs.set(1, 1, 1))
  }
  /** A remote player's hook point (world): on a car — ours or another's — or a fixed thing. */
  private remotePoint(to: number, point: number, x: number, y: number, z: number, out: GFX.Vector3): GFX.Vector3 | null {
    const S = this.host.session()
    if (to && S && to === S.me.sid) { const me = this.myCar(); return me ? toWorld(me, pointOf(me.dims, point, out)) : null }
    if (to) { const t = this.host.carOf(to); return t ? toWorld(t, pointOf(t.dims, point, out)) : null }
    return out.set(x, y, z)
  }
  private pointOfTarget(t: Target, out: GFX.Vector3): GFX.Vector3 | null {
    if ('anchor' in t) return out.set(t.anchor.x, t.anchor.y, t.anchor.z)
    return this.remotePoint(t.sid, t.point, 0, 0, 0, out)
  }
  /** A car's hook ON ITS WINCH: hanging from the fairlead by its eye, before the bumper, its bowl opening forward. */
  private stowed(c: TowCar, out: GFX.Matrix4): void {
    const q = c.root.quaternion
    const up = this.bUp.set(0, 1, 0).applyQuaternion(q), fw = this.bSide.set(0, 0, -1).applyQuaternion(q)
    const z = this.bZ.crossVectors(fw, up).normalize()
    out.makeBasis(fw, up, z)
    // (its eye at the fairlead, a finger before the bumper's face: it hangs down the face)
    const p = toWorld(c, fairlead(c.dims, this.dTmp))
    const ex = fw.x * EYE.x + up.x * EYE.y, ey = fw.y * EYE.x + up.y * EYE.y, ez = fw.z * EYE.x + up.z * EYE.y
    out.setPosition(p.x - ex, p.y - ey, p.z - ez)
  }
  private readonly dTmp = new GFX.Vector3()
  /** The hook in a walker's right hand: its EYE in his fist (a hand's length past the wrist, along the hand), the hook
   *  hanging from it — straight down, tipped a little with the hand — its bowl opening forward, a little out from his
   *  thigh. */
  private handHook(w: Character, out: GFX.Matrix4): boolean {
    if (!w.jointAt('RightHand', this.vc) || !w.jointAt('RightForeArm', this.vd)) return false
    const M = w.root.matrixWorld
    this.vc.applyMatrix4(M); this.vd.applyMatrix4(M)
    const along = this.vb.subVectors(this.vc, this.vd).normalize()
    const fist = this.vc.addScaledVector(along, 0.075)
    // (up: mostly the world's — it hangs — a quarter the hand's own way)
    const up = this.bUp.set(-along.x * 0.25, 1 * 0.75 - along.y * 0.25, -along.z * 0.25).normalize()
    // (its opening: the way he faces, square to up)
    const fw = this.bSide.set(-Math.sin(w.heading), 0, -Math.cos(w.heading))
    fw.addScaledVector(up, -fw.dot(up)).normalize()
    const z = this.bZ.crossVectors(fw, up).normalize()
    out.makeBasis(fw, up, z)
    // (the eye in the fist: the hook's origin put so; a couple of cm out to his right, off his leg)
    const rx = Math.cos(w.heading), rz = -Math.sin(w.heading)
    const ex = fw.x * EYE.x + up.x * EYE.y, ey = fw.y * EYE.x + up.y * EYE.y, ez = fw.z * EYE.x + up.z * EYE.y
    out.setPosition(fist.x - ex + rx * 0.015, fist.y - ey, fist.z - ez + rz * 0.015)
    return true
  }
  /** The hook on a point: its bowl over it, its eye up the line toward `from`. */
  private onPoint(at: GFX.Vector3, from: GFX.Vector3, out: GFX.Matrix4): void {
    const up = this.bUp.subVectors(from, at).normalize()
    const side = this.bSide.set(0, 1, 0).cross(up)
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
    side.normalize()
    const z = this.bZ.crossVectors(side, up).normalize()
    out.makeBasis(side, up, z)
    out.setPosition(at.x, at.y + 0.034, at.z)
  }
}
