/**
 * THE POSES on the wire (the server's backend/src/proto.rs — the same layout, little-endian):
 *   ours, 20 a second:  [1u8] [n u8] n × ENTITY
 *   the server's:       [2u8] [tick u32] [p u8] p × ([sid u16] [n u8] n × ENTITY)  — the players who moved since we last
 *                       heard of them (near ones every tick, far ones every 4th); n entities replace what we knew
 *   ENTITY (17 B): [meta u8] [x y z f32] [rotation u32]
 *     meta: slot (bits 0–1) | kind (bits 2–4) | bit 5 teleported | bit 6 trailer hitched
 *     rotation: the quaternion's smallest three, 10 bits each over ±1/√2, bits 30–31 the dropped (largest) one.
 */
export const Slot = { Player: 0, ParkedCar: 1, Trailer: 2 } as const
export type Slot = (typeof Slot)[keyof typeof Slot]
export const Kind = { Foot: 0, Jeep: 1, E30: 2, Moto: 3, Trailer: 4 } as const
export type Kind = (typeof Kind)[keyof typeof Kind]
export const FLAG_TELEPORT = 1, FLAG_HITCHED = 2
export const ENTITY_BYTES = 17

export interface Ent { slot: Slot; kind: Kind; flags: number; p: [number, number, number]; q: [number, number, number, number] }

const QK = 1023, S2 = Math.SQRT2

export function packQuat(x: number, y: number, z: number, w: number): number {
  const n = Math.hypot(x, y, z, w) || 1
  const q = [x / n, y / n, z / n, w / n]
  let big = 0
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[big])) big = i
  const s = q[big] < 0 ? -1 : 1
  let out = big * 2 ** 30, shift = 20
  for (let i = 0; i < 4; i++) {
    if (i === big) continue
    const u = Math.min(QK, Math.max(0, Math.round((q[i] * s * S2 + 1) * 0.5 * QK)))
    out += u * 2 ** shift
    shift -= 10
  }
  return out >>> 0
}

export function unpackQuat(w: number, out: [number, number, number, number]): [number, number, number, number] {
  const big = w >>> 30
  let shift = 20, sum = 0
  for (let i = 0; i < 4; i++) {
    if (i === big) continue
    const c = (((w >>> shift) & 1023) / QK * 2 - 1) / S2
    out[i] = c
    sum += c * c
    shift -= 10
  }
  out[big] = Math.sqrt(Math.max(0, 1 - sum))
  return out
}

/** Our pose frame. */
export function poseFrame(ents: Ent[]): ArrayBuffer {
  const buf = new ArrayBuffer(2 + ents.length * ENTITY_BYTES), v = new DataView(buf)
  v.setUint8(0, 1)
  v.setUint8(1, ents.length)
  ents.forEach((e, k) => {
    const o = 2 + k * ENTITY_BYTES
    v.setUint8(o, (e.slot & 3) | ((e.kind & 7) << 2) | ((e.flags & FLAG_TELEPORT) << 5) | (((e.flags & FLAG_HITCHED) >> 1) << 6))
    v.setFloat32(o + 1, e.p[0], true); v.setFloat32(o + 5, e.p[1], true); v.setFloat32(o + 9, e.p[2], true)
    v.setUint32(o + 13, packQuat(e.q[0], e.q[1], e.q[2], e.q[3]), true)
  })
  return buf
}

function readEnt(v: DataView, o: number): Ent {
  const m = v.getUint8(o)
  return {
    slot: (m & 3) as Slot, kind: ((m >> 2) & 7) as Kind, flags: ((m >> 5) & 1) | (((m >> 6) & 1) << 1),
    p: [v.getFloat32(o + 1, true), v.getFloat32(o + 5, true), v.getFloat32(o + 9, true)],
    q: unpackQuat(v.getUint32(o + 13, true), [0, 0, 0, 1]),
  }
}

/** The server's poses frame (null: not one). */
export function readPoses(b: Uint8Array): { tick: number; players: { sid: number; ents: Ent[] }[] } | null {
  if (b.length < 6 || b[0] !== 2) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tick = v.getUint32(1, true), p = b[5]
  let o = 6
  const players: { sid: number; ents: Ent[] }[] = []
  for (let i = 0; i < p; i++) {
    if (o + 3 > b.length) return null
    const sid = v.getUint16(o, true), n = b[o + 2]
    o += 3
    if (o + n * ENTITY_BYTES > b.length) return null
    const ents: Ent[] = []
    for (let k = 0; k < n; k++) { ents.push(readEnt(v, o)); o += ENTITY_BYTES }
    players.push({ sid, ents })
  }
  return o === b.length ? { tick, players } : null
}

/** (tests) a client's pose frame back. */
export function readPose(b: Uint8Array): Ent[] | null {
  if (b.length < 2 || b[0] !== 1 || b.length !== 2 + b[1] * ENTITY_BYTES) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Ent[] = []
  for (let k = 0; k < b[1]; k++) out.push(readEnt(v, 2 + k * ENTITY_BYTES))
  return out
}
