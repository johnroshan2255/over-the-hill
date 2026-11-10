import { type Account, socketUrl } from './api'
import { type Ent, FLAG_TELEPORT, Kind, poseFrame, readPoses } from './pose'
import { type Claim, decodeEv, encodeIntent, type Ev, type Intent, type Inv, type Loose, type Piece, type PlayerView, type Pond, type Stroke, type WorldInfo } from './wire'

/**
 * A CO-OP SESSION — one world's WebSocket (backend/README.md): the world as the server says it is (players, claims and
 * their guards, pieces, loose piles, ponds, our hands and trailer), the other players' poses smoothed for drawing, and
 * our intents with their answers. Everything binary (wire.ts, pose.ts).
 *
 * THE SMOOTHING: each remote entity keeps its last poses by the server's tick (50 ms); it's drawn INTERP ticks behind
 * the server's clock — between two poses it has, so a late frame or a far player's 5 Hz never shows as a jump; past
 * its last pose it carries on a little (≤ 3 ticks), then holds. The server's clock is ours less the smallest delay seen.
 */
export const TICK_MS = 50
const INTERP = 2
const KEEP = 16

export interface Sample { tick: number; p: [number, number, number]; q: [number, number, number, number]; kind: Kind; flags: number }

/** One remote entity's poses. */
export class Track {
  readonly s: Sample[] = []
  add(x: Sample): void {
    if (x.flags & FLAG_TELEPORT) this.s.length = 0
    const last = this.s[this.s.length - 1]
    if (last && x.tick <= last.tick) { this.s[this.s.length - 1] = x; return }
    this.s.push(x)
    if (this.s.length > KEEP) this.s.shift()
  }
  get last(): Sample | undefined { return this.s[this.s.length - 1] }
  /** Where it is at server tick `t` (fractional): out.p, out.q; the speed (m/s) along the way. */
  at(t: number, out: { p: [number, number, number]; q: [number, number, number, number]; speed: number; kind: Kind }): void {
    const s = this.s
    const n = s.length
    if (!n) return
    let i = n - 1
    while (i > 0 && s[i].tick > t) i--
    const a = s[i], b = s[Math.min(i + 1, n - 1)]
    out.kind = a.kind
    if (b === a || b.tick === a.tick) {
      // (past the last pose: carried on along the last step for up to 3 ticks, then held)
      const prev = n > 1 ? s[n - 2] : null
      const dt = prev ? a.tick - prev.tick : 0
      const k = prev && dt > 0 && dt <= 8 ? Math.min(3, Math.max(0, t - a.tick)) / dt : 0
      for (let j = 0; j < 3; j++) out.p[j] = a.p[j] + (prev ? (a.p[j] - prev.p[j]) * k : 0)
      for (let j = 0; j < 4; j++) out.q[j] = a.q[j]
      out.speed = prev && dt > 0 ? Math.hypot(a.p[0] - prev.p[0], a.p[2] - prev.p[2]) / (dt * TICK_MS / 1000) : 0
      return
    }
    const f = Math.min(1, Math.max(0, (t - a.tick) / (b.tick - a.tick)))
    for (let j = 0; j < 3; j++) out.p[j] = a.p[j] + (b.p[j] - a.p[j]) * f
    slerp(a.q, b.q, f, out.q)
    out.speed = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / ((b.tick - a.tick) * TICK_MS / 1000)
  }
}

function slerp(a: number[], b: number[], t: number, out: number[]): void {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const s = d < 0 ? -1 : 1
  d = Math.abs(d)
  let ka = 1 - t, kb = t * s
  if (d < 0.9995) {
    const th = Math.acos(d), sn = Math.sin(th)
    ka = Math.sin((1 - t) * th) / sn
    kb = (Math.sin(t * th) / sn) * s
  }
  let len = 0
  for (let j = 0; j < 4; j++) { out[j] = a[j] * ka + b[j] * kb; len += out[j] * out[j] }
  len = Math.sqrt(len) || 1
  for (let j = 0; j < 4; j++) out[j] /= len
}

/** (`car`: the garage car they drive — the `ride` event; '' until they've said: the main car is drawn) */
export interface Remote { sid: number; id: string; name: string; colour: string; car: string; tracks: Map<number, Track> }

/** A player's colour (their car's paint, their name tag, their flag) — from their id, the same on every screen. */
export const COLOURS = ['#c8462d', '#2f7fb8', '#d9a227', '#3f9a5b', '#8e4fb0', '#d26f9a', '#2aa6a1', '#e07b2f', '#6b7fd1', '#9fb83a', '#b84a4a', '#4f6f8f']
export function colourOf(id: string): string {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return COLOURS[(h >>> 0) % COLOURS.length]
}

export class Session {
  readonly world: WorldInfo
  readonly me: PlayerView
  inv: Inv
  readonly remotes = new Map<number, Remote>()
  readonly claims = new Map<string, Claim>()
  readonly guards = new Map<string, boolean>()
  readonly pieces = new Map<string, Piece>()
  readonly drops = new Map<string, Loose>()
  readonly ponds = new Map<string, Pond>()
  /** Each claim's GROUND EDITS (the server's cells on the box's 2 m grid): `i * 4096 + j` → the height's change (cm). */
  readonly cells = new Map<string, Map<number, number>>()
  /** Each claim's PAVING, its strokes in order. */
  readonly paint = new Map<string, Stroke[]>()
  /** The trees felled (by their index in the map's tree list) — where each stood. */
  readonly stumps = new Map<number, { x: number; z: number }>()
  /** The rocks and scrap worked (by key, "rock:<i>" / "scrap:<place>"): what's left in each. */
  readonly nodes = new Map<string, number>()
  /** The round trip (ms), from the pings. */
  rtt = 0
  /** Bytes in / out (the HUD's debug line). */
  bytesIn = 0
  bytesOut = 0
  private readonly listeners = new Set<(e: Ev) => void>()
  private readonly pending = new Map<number, { ok: () => void; fail: (msg: string) => void }>()
  private req = 1
  private tickOff = NaN
  private pingT = 0
  closed = false
  /** Why the connection ended (shown to the player). */
  onClose: ((why: string) => void) | null = null

  private setCells(claim: string, list: [number, number, number][]): void {
    const m = this.cells.get(claim) ?? new Map<number, number>()
    for (const [i, j, d] of list) { if (d) m.set(i * 4096 + j, d); else m.delete(i * 4096 + j) }
    this.cells.set(claim, m)
  }

  private constructor(private readonly ws: WebSocket, w: Extract<Ev, { t: 'welcome' }>) {
    this.world = w.world
    this.me = w.you
    this.inv = w.inv
    for (const p of w.state.players) if (p.sid !== w.you.sid) this.addPlayer(p.sid, p.id, p.name)
    for (const c of w.state.claims) this.claims.set(c.id, c)
    for (const [id, on] of w.state.guards) this.guards.set(id, on)
    for (const p of w.state.pieces) this.pieces.set(p.id, p)
    for (const d of w.state.drops) this.drops.set(d.id, d)
    for (const p of w.state.ponds) this.ponds.set(p.id, p)
    for (const [id, list] of w.state.cells) this.setCells(id, list)
    for (const [id, list] of w.state.paint) this.paint.set(id, [...list])
    for (const t of w.state.stumps) this.stumps.set(t.tree, { x: t.x, z: t.z })
    for (const n of w.state.nodes) this.nodes.set(n.key, n.left)
    ws.onmessage = (m) => this.message(new Uint8Array(m.data as ArrayBuffer))
    ws.onclose = (e) => this.ended(e.reason || 'The connection to the server was lost')
  }

  /** Into world `world` (resolves on the server's welcome). */
  static connect(a: Account, world: string): Promise<Session> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(socketUrl(world, a))
      ws.binaryType = 'arraybuffer'
      const t = setTimeout(() => { ws.close(); reject(new Error("The server didn't answer")) }, 10000)
      ws.onmessage = (m) => {
        const e = decodeEv(new Uint8Array(m.data as ArrayBuffer))
        if (e?.t !== 'welcome') return
        clearTimeout(t)
        resolve(new Session(ws, e))
      }
      ws.onclose = (e) => { clearTimeout(t); reject(new Error(e.reason || "Can't reach the server")) }
    })
  }

  on(f: (e: Ev) => void): () => void {
    this.listeners.add(f)
    return () => this.listeners.delete(f)
  }

  /** An intent; resolves when the server takes it, rejects with its reason (for the player's screen). */
  ask(m: Intent): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Not connected'))
    const req = this.req++
    return new Promise((ok, fail) => {
      this.pending.set(req, { ok, fail: (msg) => fail(new Error(msg)) })
      this.send(encodeIntent(m, req))
    })
  }

  /** Our pose (pose.ts) — main.ts's co-op step, 20 a second while moving. */
  sendPose(ents: Ent[]): void {
    this.send(new Uint8Array(poseFrame(ents)))
  }

  private send(b: Uint8Array<ArrayBuffer>): void {
    if (this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(b)
    this.bytesOut += b.length
  }

  /** The server's tick now (fractional), as best we know it. */
  serverTick(now = performance.now()): number {
    return Number.isNaN(this.tickOff) ? 0 : now / TICK_MS - this.tickOff
  }

  /** The tick to draw the others at. */
  drawTick(now = performance.now()): number {
    return this.serverTick(now) - INTERP
  }

  /** Once a frame: the pings. */
  update(dt: number): void {
    if ((this.pingT -= dt) <= 0) {
      this.pingT = 2
      this.send(encodeIntent({ t: 'ping', n: Math.floor(performance.now() * 10) % 2 ** 32 }))
    }
  }

  close(): void {
    this.closed = true
    this.ws.onclose = null
    this.ws.close()
  }

  /** OUR CAR, told to the others (the garage's id): on a change, and to each player who joins after. */
  private car = ''
  ride(car: string): void {
    if (car === this.car || this.closed) return
    this.car = car
    this.send(encodeIntent({ t: 'ride', car }))
  }

  private ended(why: string): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) p.fail('Disconnected')
    this.pending.clear()
    this.onClose?.(why)
  }

  private addPlayer(sid: number, id: string, name: string): void {
    this.remotes.set(sid, { sid, id, name, colour: colourOf(id), car: '', tracks: new Map() })
  }

  private message(b: Uint8Array): void {
    this.bytesIn += b.length
    if (b[0] === 2) {
      const f = readPoses(b)
      if (!f) return
      const now = performance.now()
      // (the server's clock: our time less the smallest delay seen — creeping back up slowly, so one lucky frame or a
      //  drifting clock doesn't hold it wrong)
      const off = now / TICK_MS - f.tick
      this.tickOff = Number.isNaN(this.tickOff) ? off : Math.min(this.tickOff + 0.002, off)
      for (const p of f.players) {
        const r = this.remotes.get(p.sid)
        if (!r) continue
        const slots = new Set<number>()
        for (const e of p.ents) {
          slots.add(e.slot)
          let t = r.tracks.get(e.slot)
          if (!t) r.tracks.set(e.slot, (t = new Track()))
          t.add({ tick: f.tick, p: e.p, q: e.q, kind: e.kind, flags: e.flags })
        }
        for (const s of [...r.tracks.keys()]) if (!slots.has(s)) r.tracks.delete(s)
      }
      return
    }
    const e = decodeEv(b)
    if (!e) return
    switch (e.t) {
      // (someone new: they don't know our car yet — said again)
      case 'joined': this.addPlayer(e.sid, e.id, e.name); if (this.car) this.send(encodeIntent({ t: 'ride', car: this.car })); break
      case 'ride': { const r = this.remotes.get(e.sid); if (r) r.car = e.car; break }
      case 'left': this.remotes.delete(e.sid); break
      case 'ok': { const p = this.pending.get(e.req); this.pending.delete(e.req); p?.ok(); break }
      case 'err': { if (e.req !== null) { const p = this.pending.get(e.req); this.pending.delete(e.req); p?.fail(e.msg) } break }
      case 'pong': this.rtt = Math.max(0, (performance.now() * 10 - e.n) / 10); break
      case 'inv': this.inv = e.inv; break
      case 'claim': this.claims.set(e.claim.id, e.claim); break
      case 'claim_gone': this.claims.delete(e.id); this.guards.delete(e.id); this.cells.delete(e.id); this.paint.delete(e.id); for (const [k, p] of this.ponds) if (p.claim === e.id) this.ponds.delete(k); break
      case 'cells': this.setCells(e.claim, e.cells); break
      case 'pave': { const l = this.paint.get(e.claim) ?? []; l.push(e.stroke); this.paint.set(e.claim, l); break }
      case 'stock': { const c = this.claims.get(e.claim); if (c) c.stock = e.stock; break }
      case 'guard': this.guards.set(e.claim, e.on); break
      case 'piece': this.pieces.set(e.piece.id, e.piece); break
      case 'piece_gone': this.pieces.delete(e.id); break
      case 'drop': this.drops.set(e.drop.id, e.drop); break
      case 'drop_gone': this.drops.delete(e.id); break
      case 'pond': this.ponds.set(e.pond.id, e.pond); break
      case 'pond_gone': this.ponds.delete(e.id); break
      case 'tree_cut': this.stumps.set(e.tree, { x: e.x, z: e.z }); break
      case 'tree_back': this.stumps.delete(e.tree); break
      case 'node': this.nodes.set(e.key, e.left); break
      case 'node_back': this.nodes.delete(e.key); break
    }
    for (const f of this.listeners) f(e)
  }
}
