// BUILDING (docs/MULTIPLAYER.md step 4 — oth/Builder.ts, Pieces.ts): two players in a CREATIVE co-op world (building
// costs nothing — the rule for trying the kit). A plants a flag, opens build mode (B — its pieces mode), and builds a log
// cabin with the builder's own snapping: two stone foundations, log walls round them (a door and windows, their outsides
// facing out), shingle roofs on the walls, a stone chimney, a porch and its roof (snapped to the door wall), a fence along the yard, a fire ring
// and a lamp. B sees every piece; a wall is solid (A walks into it and stops), the doorway isn't (A walks in).
// Screenshots: the homestead from the yard, from the side, the door close, B's view.
//   node scripts/harness/buildtest.mjs <outdir>    env: PORT (5200), TIER (high), HOUR (11)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'buildshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const W = 1280, H = 720
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`)
  return r.json()
}
const A = await api('POST', '/v1/players', { name: 'Asha' }), B = await api('POST', '/v1/players', { name: 'Ravi' })
const world = await api('POST', '/v1/worlds', { name: 'Build valley', map: 'valley', rules: { creative: true } }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const errs = []
const open = async (who) => {
  const page = await (await browser.createBrowserContext()).newPage()
  page.on('pageerror', (e) => { errs.push(e.message); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  await page.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'high'}&hour=${process.env.HOUR || 11}&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop?.pieces?.ready, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A), pb = await open(B)
await pa.bringToFront()
await pa.evaluate(() => window.__oth.foot())
await pa.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 })
// a flat spot near: the flattest of a few round him (its cells' corners within a few cm), clear of the track
const spot = await pa.evaluate(() => {
  const o = window.__oth, p = o.hero.pos, m = o.world.map
  let best = null
  for (let k = 0; k < 160; k++) {
    const a = k * 2.399, r = 25 + (k % 10) * 6, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r
    let lo = 1e9, hi = -1e9
    for (let i = -3; i <= 3; i++) for (let j = -2; j <= 3; j++) { const y = m.height(x + i * 2, z + j * 2); lo = Math.min(lo, y); hi = Math.max(hi, y) }
    if (m.waterAt(x, z) !== null || m.trackDist(x, z) < 14 || o.world.trees.nearest(x, z, 9)) continue
    if (!best || hi - lo < best.s) best = { x, z, s: hi - lo }
  }
  return best
})
console.log('spot:', JSON.stringify(spot))
await pa.evaluate((s) => window.__oth.hero.appear(s.x - 2, s.z + 14, Math.PI), spot)
await sleep(800)
const claim = await pa.evaluate(async (s) => { const S = window.__oth.coop.session; await S.ask({ t: 'claim', x: s.x, z: s.z, r: 20 }); return [...S.claims.values()].find((c) => c.owner === S.me.id) }, spot)
check(!!claim, 'A has land')
await pa.keyboard.press('KeyB')
await sleep(1200)
check(await pa.evaluate(() => window.__oth.coop.build.on && window.__oth.coop.build.mode === 'pieces'), 'B on your land: build mode, the pieces')
// the cabin, by the builder: each piece chosen, the cursor's ground point given, its place (snapped) taken
const build = (list) => pa.evaluate(async (list) => {
  const o = window.__oth, b = o.coop.build.builder, S = o.coop.session, m = o.world.map
  const c = [...S.claims.values()].find((x) => x.owner === S.me.id)
  const V = o.camera.position.constructor
  const res = []
  for (const [kind, dx, dz, turn] of list) {
    b.idx = b.list.findIndex((p) => p.kind === kind); b.turn = turn ?? 0
    const x = c.x + dx, z = c.z + dz
    b.update(0, new V(x, m.height(x, z), z))
    const pl = b.plan
    if (!pl || pl.why) { res.push(`${kind}: ${pl?.why ?? 'no plan'}`); continue }
    try { await S.ask({ t: 'place', kind: pl.kind, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot, variant: 0 }) } catch (e) { res.push(`${kind}: ${e.message}`) }
  }
  return res
}, list)
const C = 3
let r = await build([['foundation_stone', 0, 0], ['foundation_stone', C, 0]])
r = r.concat(await build([
  ['wall_log_door', 0, 1.2], ['wall_log_window', C, 1.2], ['wall_log_window', 0, -1.2], ['wall_log', C, -1.2],
  ['wall_log', -1.2, 0], ['wall_log_window', C + 1.2, 0],
]))
r = r.concat(await build([['roof_shingle', 0, 0], ['roof_shingle', C, 0]]))
r = r.concat(await build([['chimney_stone', C + 1.95, -0.6], ['porch_deck', 0.4, 3.1], ['porch_roof', -0.3, 2.6]]))
r = r.concat(await build([['fence_rail', -C, 2 * C + 1.2], ['fence_rail', 0, 2 * C + 1.2], ['fence_gate', C, 2 * C + 1.2], ['fence_rail', 2 * C, 2 * C + 1.2], ['campfire', 4.5, 5], ['lamp_post', -2.6, 4.2]]))
console.log('build notes:', r.length ? r : 'none')
const n = await pa.evaluate(() => window.__oth.coop.session.pieces.size)
check(n >= 19, `${n} pieces up`)
await pb.waitForFunction((n) => window.__oth.coop.session.pieces.size >= n, { timeout: 8000 }, n).catch(() => {})
check(await pb.evaluate(() => window.__oth.coop.session.pieces.size) === n, 'B sees them all')
await pa.keyboard.press('KeyB')
await sleep(1500)
// the shots
const shot = async (p, name, f, arg) => { await p.evaluate(f, arg); await sleep(1800); await p.screenshot({ path: `${out}/${name}.png` }) }
await shot(pa, '1_homestead', (c) => window.__oth.view(c.x + 13, c.z + 17, 6.5, Math.atan2(13, 17), -0.2), claim)
await shot(pa, '2_side', (c) => window.__oth.view(c.x + 15, c.z - 4, 3.2, Math.atan2(15, -4), -0.08), claim)
await shot(pa, '3_door', (c) => window.__oth.view(c.x + 2.8, c.z + 6.5, 1.9, Math.atan2(2.8, 5.5), -0.05), claim)
await shot(pb, '4_seen_by_B', (c) => window.__oth.view(c.x - 12, c.z + 14, 4.5, Math.atan2(-12, 14), -0.12), claim)
// solid: A walks at the north wall from outside; through the door from the porch
await pa.evaluate(() => window.__oth.drive(true))
const walk = async (from, heading, ms) => {
  await pa.evaluate(([x, z, h]) => window.__oth.hero.appear(x, z, h), [...from, heading])
  await sleep(700)
  await pa.evaluate(() => window.__oth.footCam())
  await sleep(300)
  await pa.keyboard.down('KeyW'); await pa.keyboard.down('ControlLeft')
  const trace = []
  for (let t = 0; t < ms; t += 250) { await sleep(250); trace.push(await pa.evaluate((c) => { const p = window.__oth.hero.pos; return `${(p.z - c.z).toFixed(2)}/${(p.y - window.__oth.world.map.height(p.x, p.z)).toFixed(2)}` }, claim)) }
  if (process.env.DBG) console.log('hits:', JSON.stringify(await pa.evaluate((c) => { const h = window.__oth.hero, cc = h.cc, out = []; for (let i = 0; i < cc.numComputedCollisions(); i++) { const k = cc.computedCollision(i); const col = k.collider; const t = col.translation(), r = col.rotation(), he = col.halfExtents?.(); out.push({ n: [k.normal1.x, k.normal1.y, k.normal1.z].map((v) => +v.toFixed(2)), w: [k.witness1.x - c.x, k.witness1.y, k.witness1.z - c.z].map((v) => +v.toFixed(2)), at: [t.x - c.x, t.y, t.z - c.z].map((v) => +v.toFixed(2)), he: he && [he.x, he.y, he.z].map((v) => +v.toFixed(2)), r: [r.x, r.y, r.z, r.w].map((v) => +v.toFixed(2)) }) } return { pos: [h.pos.x - c.x, h.pos.y, h.pos.z - c.z].map((v) => +v.toFixed(2)), ground: window.__oth.world.map.height(h.pos.x, h.pos.z).toFixed(2), out } }, claim)))
  await pa.keyboard.up('KeyW'); await pa.keyboard.up('ControlLeft')
  console.log('walk trace (z from the middle / y over the ground):', trace.join(' '))
  await sleep(400)
  return pa.evaluate(() => { const p = window.__oth.hero.pos; return [p.x, p.z] })
}
const north = await walk([claim.x, claim.z - 3.6], Math.PI, 2500)
check(north[1] < claim.z - 1.5 - 0.1, `the wall stops him (he's at z ${(north[1] - claim.z).toFixed(2)} from the middle; the wall at −1.5)`)
const inside = await walk([claim.x, claim.z + 4.6], 0, 4500)
check(inside[1] < claim.z + 1.2, `through the door he walks in (z ${(inside[1] - claim.z).toFixed(2)})`)
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none')
check(!errs.length, 'no page errors')
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
