/**
 * THE WIRE against the server's golden file (backend/tests/golden.json — written by its `golden` test): the game must
 * read every event the server writes to the same JSON, write every intent to the same bytes, and read / write the pose
 * frames. A change to proto/wire.json that one side doesn't follow fails here or in `cargo test`.
 */
import fs from 'node:fs'
import { decodeEv, decodeIntent, encodeIntent, type Intent } from '../src/net/wire'
import { type Ent, poseFrame, readPose, readPoses } from '../src/net/pose'

// (run from frontend/ — npm test; the bundle itself sits in node_modules/.cache)
const gold = JSON.parse(fs.readFileSync('../backend/tests/golden.json', 'utf8'))
const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

let failures = 0, passes = 0
const check = (ok: boolean, what: string, detail = '') => {
  if (ok) passes++
  else { failures++; console.log(`FAIL  ${what}${detail ? `\n      ${detail}` : ''}`) }
}
/** Deep equality as JSON sees it (key order free). */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object), kb = Object.keys(b as object)
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

for (const e of gold.events) {
  const got = decodeEv(bytes(e.hex))
  check(same(got, e.json), `event ${e.json.t} reads`, `got ${JSON.stringify(got)}\n      want ${JSON.stringify(e.json)}`)
}
for (const i of gold.intents) {
  const { req, ...m } = i.json
  const b = encodeIntent(m as Intent, req)
  check(hex(b) === i.hex, `intent ${i.json.t} writes`, `got ${hex(b)}\n      want ${i.hex}`)
  check(same(decodeIntent(bytes(i.hex)), i.json), `intent ${i.json.t} reads back`)
}
// a frame cut short is no event
const w = gold.events[0].hex
check(decodeEv(bytes(w.slice(0, -2))) === null, 'a short frame is refused')
check(decodeEv(bytes(w + '00')) === null, 'a long frame is refused')

// the poses: ours written byte for byte as the server's bots write them; the server's read
const close = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6)
const c = gold.poses.client
const ents: Ent[] = c.ents.map((e: Ent, k: number) => ({ ...e, q: c.q_in[k] }))
check(hex(new Uint8Array(poseFrame(ents))) === c.hex, 'our pose frame writes', `got ${hex(new Uint8Array(poseFrame(ents)))}\n      want ${c.hex}`)
const back = readPose(bytes(c.hex))
check(!!back && back.every((e, k) => e.slot === c.ents[k].slot && e.kind === c.ents[k].kind && e.flags === c.ents[k].flags && close(e.p, c.ents[k].p) && close(e.q, c.ents[k].q)), 'our pose frame reads back')
const s = gold.poses.server, got = readPoses(bytes(s.hex))
check(!!got && got.tick === s.tick && got.players.length === s.players.length, 'the poses frame: tick and players')
got?.players.forEach((p, i) => {
  const want = s.players[i]
  check(p.sid === want.sid && p.ents.length === want.ents.length, `poses: player ${want.sid}`)
  p.ents.forEach((e, k) => {
    const we = want.ents[k]
    check(e.slot === we.slot && e.kind === we.kind && e.flags === we.flags && close(e.p, we.p) && close(e.q, we.q), `poses: player ${want.sid} entity ${k}`, `got ${JSON.stringify(e)}\n      want ${JSON.stringify(we)}`)
  })
})
check(readPoses(bytes(s.hex.slice(0, -2))) === null, 'a short poses frame is refused')

console.log(`wire: ${passes} passed, ${failures} failed`)
if (failures) process.exit(1)
