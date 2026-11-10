import WIRE from '../../../proto/wire.json'

/**
 * THE WIRE (proto/wire.json — the server's backend/src/wire.rs reads the same file): every event the server sends and
 * every intent the game sends, as compact binary by one schema. A frame: [tag u8] then the fields in order; an intent
 * has its `req` (varn) after the tag. Poses (tags 1, 2) are packed by hand (pose.ts). Tested against the server's
 * golden file (tests/wire.test.ts ← backend/tests/golden.json).
 */

// ---- the shapes (the JSON shape of each message — as the server's serde makes them)
export interface Bag { wood: number; stone: number; metal: number }
export interface PlayerView { sid: number; id: string; name: string }
export interface Rules { offline_guard: boolean; regrow_min: number; refill_min: number; max_players: number; claim_min_r: number; claim_max_r: number; claims_per_player: number; creative: boolean }
export interface WorldInfo { id: string; code: string; name: string; map: string; owner: string; rules: Rules }
export interface Claim { id: string; owner: string; owner_name: string; x: number; z: number; r: number; y: number; stock: Bag; created: number }
export interface Piece { id: string; kind: string; owner: string; claim: string; x: number; y: number; z: number; rot: number; variant: number }
export type Mat = 'wood' | 'stone' | 'metal'
export interface Loose { id: string; mat: Mat; qty: number; x: number; y: number; z: number; claim: string | null }
export type PaveMat = 'stone' | 'gravel' | 'planks' | 'dirt' | 'erase'
export interface Stroke { mat: PaveMat; x: number; z: number; r: number }
export interface Pond { id: string; claim: string; x: number; z: number; r: number; level: number }
export interface Inv { carry: Bag; trailer: Bag }
export type Cell = [number, number, number]
export interface State {
  players: PlayerView[]; claims: Claim[]; guards: [string, boolean][]; cells: [string, Cell[]][]; paint: [string, Stroke[]][]
  pieces: Piece[]; drops: Loose[]; stumps: { tree: number; x: number; z: number }[]; nodes: { key: string; left: number }[]; ponds: Pond[]
}

export type Ev =
  | { t: 'welcome'; you: PlayerView; world: WorldInfo; state: State; inv: Inv }
  | { t: 'joined'; sid: number; id: string; name: string }
  | { t: 'left'; sid: number }
  | { t: 'chat'; sid: number; name: string; text: string }
  | { t: 'tree_cut'; tree: number; x: number; z: number; by: number }
  | { t: 'tree_back'; tree: number }
  | { t: 'drop'; drop: Loose }
  | { t: 'drop_gone'; id: string }
  | { t: 'node'; key: string; left: number }
  | { t: 'node_back'; key: string }
  | { t: 'inv'; inv: Inv }
  | { t: 'claim'; claim: Claim }
  | { t: 'claim_gone'; id: string }
  | { t: 'stock'; claim: string; stock: Bag }
  | { t: 'guard'; claim: string; on: boolean }
  | { t: 'raid'; claim: string; owner: string; by: number; by_name: string; bag: Bag }
  | { t: 'piece'; piece: Piece }
  | { t: 'piece_gone'; id: string }
  | { t: 'cells'; claim: string; cells: Cell[] }
  | { t: 'pave'; claim: string; stroke: Stroke }
  | { t: 'pond'; pond: Pond }
  | { t: 'pond_gone'; id: string }
  | { t: 'ok'; req: number }
  | { t: 'err'; req: number | null; msg: string }
  | { t: 'pong'; n: number }
  | { t: 'ride'; sid: number; car: string }

export type Store = 'carry' | 'trailer'
export type Intent =
  | { t: 'chat'; text: string }
  | { t: 'ride'; car: string }
  | { t: 'cut_tree'; tree: number; x: number; z: number; h: number }
  | { t: 'mine'; node: string; x: number; z: number; size: number }
  | { t: 'pick'; drop: string; to: Store }
  | { t: 'drop'; mat: Mat; qty: number; from: Store; x: number; y: number; z: number }
  | { t: 'deposit'; claim: string; from: Store; bag: Bag }
  | { t: 'take'; claim: string; to: Store; bag: Bag }
  | { t: 'claim'; x: number; z: number; r: number }
  | { t: 'unclaim'; claim: string }
  | { t: 'place'; kind: string; x: number; y: number; z: number; rot: number; variant: number }
  | { t: 'remove'; piece: string }
  | { t: 'shape'; op: 'raise' | 'lower' | 'flatten' | 'smooth'; x: number; z: number; r: number; strength: number; y: number | null }
  | { t: 'pave'; mat: PaveMat; x: number; z: number; r: number }
  | { t: 'pond'; x: number; z: number; r: number; depth: number }
  | { t: 'ping'; n: number }
  | { t: 'stow'; from: Store; to: Store; bag: Bag }

// ---- the schema, compiled once
type Ty =
  | { k: 'u8' | 'bool' | 'var' | 'varn' | 'zz' | 'f32' | 'f32n' | 'u64' | 'str' | 'strn' }
  | { k: 'enum'; names: string[] }
  | { k: 'obj'; f: [string, Ty][] }
  | { k: 'list'; of: Ty }
  | { k: 'tuple'; of: Ty[] }
interface Msg { name: string; tag: number; fields: Ty; event: boolean }
type Spec = string | { obj?: [string, Spec][]; list?: Spec; tuple?: Spec[] }
const PRIM = new Set(['u8', 'bool', 'var', 'varn', 'zz', 'f32', 'f32n', 'u64', 'str', 'strn'])

const W = WIRE as unknown as { enums: Record<string, string[]>; types: Record<string, Spec>; events: Record<string, [number, [string, Spec][]]>; intents: Record<string, [number, [string, Spec][]]> }
function ty(s: Spec, depth = 0): Ty {
  if (depth > 32) throw new Error('wire.json: a type refers to itself')
  if (typeof s === 'string') {
    if (PRIM.has(s)) return { k: s } as Ty
    if (W.enums[s]) return { k: 'enum', names: W.enums[s] }
    const t = W.types[s]
    if (!t) throw new Error(`wire.json: no type ${s}`)
    return ty(t, depth + 1)
  }
  if (s.obj) return { k: 'obj', f: s.obj.map(([n, t]) => [n, ty(t, depth + 1)]) }
  if (s.list !== undefined) return { k: 'list', of: ty(s.list, depth + 1) }
  if (s.tuple) return { k: 'tuple', of: s.tuple.map((t) => ty(t, depth + 1)) }
  throw new Error(`wire.json: a type ${JSON.stringify(s)}`)
}
const byTag = new Map<number, Msg>(), intentByName = new Map<string, Msg>()
for (const [kind, event] of [['events', true], ['intents', false]] as const) {
  for (const [name, [tag, f]] of Object.entries(W[kind])) {
    const m: Msg = { name, tag, fields: ty({ obj: f }), event }
    byTag.set(tag, m)
    if (!event) intentByName.set(name, m)
  }
}

// ---- writing
const te = new TextEncoder(), td = new TextDecoder()
class Writer {
  b: Uint8Array<ArrayBuffer> = new Uint8Array(64)
  v = new DataView(this.b.buffer)
  n = 0
  room(k: number): void {
    if (this.n + k <= this.b.length) return
    const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k))
    nb.set(this.b)
    this.b = nb
    this.v = new DataView(nb.buffer)
  }
  u8(x: number): void { this.room(1); this.b[this.n++] = x & 255 }
  var(x: number): void { x >>>= 0; do { let c = x & 0x7f; x >>>= 7; if (x) c |= 0x80; this.u8(c) } while (x) }
  f32(x: number): void { this.room(4); this.v.setFloat32(this.n, x, true); this.n += 4 }
  bytes(a: Uint8Array): void { this.room(a.length); this.b.set(a, this.n); this.n += a.length }
  out(): Uint8Array<ArrayBuffer> { return this.b.slice(0, this.n) }
}

function write(t: Ty, v: unknown, w: Writer, at: string): void {
  const num = (): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${at}: a number, not ${String(v)}`); return v }
  switch (t.k) {
    case 'u8': w.u8(num()); return
    case 'bool': w.u8(v ? 1 : 0); return
    case 'var': w.var(num()); return
    case 'varn': if (v === null || v === undefined) w.u8(0); else w.var(num() + 1); return
    case 'zz': { const i = num() | 0; w.var((i << 1) ^ (i >> 31)); return }
    case 'f32': w.f32(num()); return
    case 'f32n': w.f32(v === null || v === undefined ? NaN : num()); return
    case 'u64': { const x = num(); w.room(8); w.v.setBigUint64(w.n, BigInt(Math.round(x)), true); w.n += 8; return }
    case 'str': { if (typeof v !== 'string') throw new Error(`${at}: a string`); const e = te.encode(v); w.var(e.length); w.bytes(e); return }
    case 'strn': if (v === null || v === undefined) w.u8(0); else { w.u8(1); write({ k: 'str' }, v, w, at) } return
    case 'enum': { const i = t.names.indexOf(v as string); if (i < 0) throw new Error(`${at}: ${String(v)} isn't one of ${t.names}`); w.u8(i); return }
    case 'obj': { const o = v as Record<string, unknown>; for (const [n, ft] of t.f) write(ft, o?.[n], w, `${at}.${n}`); return }
    case 'list': { const a = v as unknown[]; if (!Array.isArray(a)) throw new Error(`${at}: a list`); w.var(a.length); for (const x of a) write(t.of, x, w, at); return }
    case 'tuple': { const a = v as unknown[]; t.of.forEach((ft, i) => write(ft, a[i], w, `${at}[${i}]`)); return }
  }
}

/** An intent as bytes (`req`: the answer's id — ok / err come back with it). */
export function encodeIntent(m: Intent, req: number | null = null): Uint8Array<ArrayBuffer> {
  const s = intentByName.get(m.t)
  if (!s) throw new Error(`no intent ${m.t}`)
  const w = new Writer()
  w.u8(s.tag)
  write({ k: 'varn' }, req, w, 'req')
  write(s.fields, m, w, m.t)
  return w.out()
}

// ---- reading
class Reader {
  o = 1
  readonly v: DataView
  constructor(readonly b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength) }
  u8(): number { if (this.o >= this.b.length) throw RangeError('short'); return this.b[this.o++] }
  var(): number { let x = 0, s = 0; for (;;) { const c = this.u8(); x += (c & 0x7f) * 2 ** s; if (!(c & 0x80)) return x; s += 7; if (s > 28) throw RangeError('var') } }
  f32(): number { const x = this.v.getFloat32(this.o, true); this.o += 4; return x }
}

function read(t: Ty, r: Reader): unknown {
  switch (t.k) {
    case 'u8': return r.u8()
    case 'bool': return r.u8() !== 0
    case 'var': return r.var()
    case 'varn': { const x = r.var(); return x === 0 ? null : x - 1 }
    case 'zz': { const u = r.var(); return (u >>> 1) ^ -(u & 1) }
    case 'f32': return r.f32()
    case 'f32n': { const x = r.f32(); return Number.isNaN(x) ? null : x }
    case 'u64': { const x = r.v.getBigUint64(r.o, true); r.o += 8; return Number(x) }
    case 'str': { const n = r.var(); if (r.o + n > r.b.length) throw RangeError('str'); const s = td.decode(r.b.subarray(r.o, r.o + n)); r.o += n; return s }
    case 'strn': return r.u8() ? read({ k: 'str' }, r) : null
    case 'enum': { const s = t.names[r.u8()]; if (s === undefined) throw RangeError('enum'); return s }
    case 'obj': { const o: Record<string, unknown> = {}; for (const [n, ft] of t.f) o[n] = read(ft, r); return o }
    case 'list': { const n = r.var(); if (n > r.b.length - r.o) throw RangeError('list'); const a: unknown[] = []; for (let i = 0; i < n; i++) a.push(read(t.of, r)); return a }
    case 'tuple': return t.of.map((ft) => read(ft, r))
  }
}

/** A server event from its bytes (null: not an event this game knows, or malformed). */
export function decodeEv(b: Uint8Array): Ev | null {
  const m = byTag.get(b[0])
  if (!m || !m.event) return null
  try {
    const r = new Reader(b)
    const o = read(m.fields, r) as Record<string, unknown>
    if (r.o !== b.length) return null
    return { t: m.name, ...o } as Ev
  } catch {
    return null
  }
}

/** (tests) an intent's bytes back to its JSON shape `{t, req, …}`. */
export function decodeIntent(b: Uint8Array): Record<string, unknown> | null {
  const m = byTag.get(b[0])
  if (!m || m.event) return null
  try {
    const r = new Reader(b)
    const req = read({ k: 'varn' }, r)
    const o = read(m.fields, r) as Record<string, unknown>
    return r.o === b.length ? { t: m.name, req, ...o } : null
  } catch {
    return null
  }
}
