// THE GROUND (docs/MULTIPLAYER.md step 5 — oth/GroundEdits.ts, Build.ts's GROUND tools, the kit's plants): two players
// in a CREATIVE co-op world. A plants a flag, opens build mode's GROUND (G), and works the land the way a player does:
// FLATTENS a yard (to the height where the press began), RAISES a mound and SMOOTHS it, PAVES a stone yard and a
// gravel path to it, DIGS A POND (the water fills it), sets a JETTY on it, and PLANTS a garden (a hedge along the
// yard, a flower bed, a vegetable patch, a pine and a birch). B sees all of it: the same heights under the same
// points, the paving, the pond, the plants. The ground is solid where it was raised (A stands on the mound's top).
// Screenshots: the yard, the pond, the garden close, B's view, a piece dropping in (three frames).
//   node scripts/harness/groundtest.mjs <outdir>    env: PORT (5200), TIER (high), HOUR (11)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'groundshots'
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
const world = await api('POST', '/v1/worlds', { name: 'Garden valley', map: 'valley', rules: { creative: true } }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const errs = []
const open = async (who) => {
  const page = await (await browser.createBrowserContext()).newPage()
  page.on('pageerror', (e) => { errs.push(e.message); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text().slice(0, 200)); console.log(`[${who.name} console]`, m.text().slice(0, 300)) } })
  await page.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'high'}&hour=${process.env.HOUR || 11}&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop?.pieces?.ready && window.__oth.coop?.ground, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A), pb = await open(B)
await pa.bringToFront()
await pa.evaluate(() => window.__oth.foot())
await pa.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 })
// a gentle slope near (a yard to flatten), clear of the track, the water and the trees
const spot = await pa.evaluate(() => {
  const o = window.__oth, p = o.hero.pos, m = o.world.map
  let best = null
  for (let k = 0; k < 400; k++) {
    const a = k * 2.399, r = 30 + (k % 20) * 9, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r
    let lo = 1e9, hi = -1e9, trees = 0, wet = false
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { const y = m.height(x + i * 3, z + j * 3); lo = Math.min(lo, y); hi = Math.max(hi, y); if (m.waterAt(x + i * 3, z + j * 3) !== null) wet = true }
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (o.world.trees.nearest(x + i * 9, z + j * 9, 4.5)) trees++
    if (trees > 1 || wet || m.trackDist(x, z) < 20) continue
    const s = hi - lo + trees * 2
    if (s > 0.4 && s < 6 && (!best || Math.abs(s - 1.6) < Math.abs(best.s - 1.6))) best = { x, z, s }
  }
  return best
})
console.log('spot:', JSON.stringify(spot))
check(!!spot, 'a gently sloping spot to work')
await pa.evaluate((s) => window.__oth.hero.appear(s.x - 4, s.z + 16, Math.PI), spot)
await sleep(800)
const claim = await pa.evaluate(async (s) => { const S = window.__oth.coop.session; await S.ask({ t: 'claim', x: s.x, z: s.z, r: 24 }); return [...S.claims.values()].find((c) => c.owner === S.me.id) }, spot)
check(!!claim, 'A has land')
// THE TOOLS as a player opens them: B, G (the ground), 3 (flatten) — the panel says what the brush does
await pa.keyboard.press('KeyB'); await sleep(600)
await pa.keyboard.press('KeyG'); await sleep(300)
await pa.keyboard.press('Digit3'); await sleep(500)
const panel = await pa.evaluate(() => ({ mode: window.__oth.coop.build.mode, line: document.querySelector('.oth-build-head span')?.textContent ?? '' }))
console.log('panel:', JSON.stringify(panel))
check(panel.mode === 'ground' && /Flatten/.test(panel.line), 'G opens the ground tools; 3 is FLATTEN')
await pa.keyboard.press('KeyB'); await sleep(400)

const ask = (m) => pa.evaluate(async (m) => { try { await window.__oth.coop.session.ask(m); return '' } catch (e) { return e.message } }, m)
const settle = async (p = pa) => { await sleep(300); await p.waitForFunction(() => !window.__oth.coop.ground.busy, { timeout: 15000, polling: 100 }); await sleep(200) }
const H0 = await pa.evaluate((c) => window.__oth.world.map.height(c.x, c.z), claim)
// THE YARD: flattened to the middle's height (the brush 24 m across: full inside 6 m, easing out to its rim; four passes)
const before = await pa.evaluate((c) => { const m = window.__oth.world.map; return [[-6, -4], [5, 3], [0, 7], [-7, 5]].map(([dx, dz]) => m.height(c.x + dx, c.z + dz)) }, claim)
for (let k = 0; k < 4; k++) { const e = await ask({ t: 'shape', op: 'flatten', x: claim.x, z: claim.z, r: 12, strength: 1, y: H0 }); if (e) console.log('flatten:', e) }
await settle()
const after = await pa.evaluate((c) => { const m = window.__oth.world.map; return [[-6, -4], [5, 3], [0, 7], [-7, 5]].map(([dx, dz]) => m.height(c.x + dx, c.z + dz)) }, claim)
console.log('yard heights before', before.map((v) => (v - H0).toFixed(2)).join(' '), 'after', after.map((v) => (v - H0).toFixed(2)).join(' '))
check(after.every((v) => Math.abs(v - H0) < 0.12) && before.some((v) => Math.abs(v - H0) > 0.3), 'the yard flattened (to within 12 cm of the middle\'s height)')
// A MOUND, raised then smoothed (to one side)
const mound = { x: claim.x - 12, z: claim.z - 10 }
const m0 = await pa.evaluate((p) => window.__oth.world.map.height(p.x, p.z), mound)
for (let k = 0; k < 3; k++) await ask({ t: 'shape', op: 'raise', x: mound.x, z: mound.z, r: 5, strength: 0.8, y: null })
await ask({ t: 'shape', op: 'smooth', x: mound.x, z: mound.z, r: 6, strength: 1, y: null })
await settle()
const m1 = await pa.evaluate((p) => window.__oth.world.map.height(p.x, p.z), mound)
console.log(`mound: ${(m1 - m0).toFixed(2)} m up`)
check(m1 - m0 > 1.2, 'a mound raised')
// PAVING: a stone yard by the house's place, a gravel path out to the edge, a bare-earth bed
for (const [dx, dz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [2.5, 2.5], [-2.5, 2.5]]) await ask({ t: 'pave', mat: 'stone', x: claim.x + dx, z: claim.z + dz, r: 2.2 }).then((e) => e && console.log('pave:', e))
for (let k = 0; k < 6; k++) await ask({ t: 'pave', mat: 'gravel', x: claim.x + 4 + k * 2.2, z: claim.z + 5 + k * 1.4, r: 1.3 })
await ask({ t: 'pave', mat: 'dirt', x: claim.x - 6, z: claim.z + 6, r: 2 })
await sleep(600)
// THE POND: dug, the water fills it; a jetty out onto it
const pond = { x: claim.x + 10, z: claim.z - 9 }
const pe = await ask({ t: 'pond', x: pond.x, z: pond.z, r: 6, depth: 1.6 })
check(!pe, `a pond dug${pe ? ': ' + pe : ''}`)
await settle()
await sleep(3300)
const pondA = await pa.evaluate((p) => { const m = window.__oth.world.map; return { water: m.waterAt(p.x, p.z), ground: m.height(p.x, p.z), dug: m.dug.size } }, pond)
console.log('pond:', JSON.stringify(pondA))
check(pondA.water !== null && pondA.water - pondA.ground > 0.5, 'the pond holds water (over half a metre deep at its middle)')
// THE GARDEN, by the builder (the snapping as a player gets it) — and a jetty
await pa.keyboard.press('KeyB'); await sleep(600)
const build = (list) => pa.evaluate(async (list) => {
  const o = window.__oth, b = o.coop.build.builder, S = o.coop.session, m = o.world.map
  const c = [...S.claims.values()].find((x) => x.owner === S.me.id)
  const V = o.camera.position.constructor
  const res = []
  for (const [kind, dx, dz, turn] of list) {
    b.idx = b.list.findIndex((p) => p.kind === kind); b.turn = turn ?? 0
    if (b.idx < 0) { res.push(`${kind}: not in the list`); continue }
    const x = c.x + dx, z = c.z + dz
    b.update(0, new V(x, m.height(x, z), z))
    const pl = b.plan
    if (!pl || pl.why) { res.push(`${kind}: ${pl?.why ?? 'no plan'}`); continue }
    try { await S.ask({ t: 'place', kind: pl.kind, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot, variant: 0 }) } catch (e) { res.push(`${kind}: ${e.message}`) }
  }
  return res
}, list)
let notes = await build([
  ['plant_hedge', -3, 8.6], ['plant_hedge', 0, 8.6], ['plant_hedge', -6, 8.6],
  ['plant_flowers', -6, 5.5, 0], ['plant_veg', -6.5, 1, 6], ['plant_pine', 7, 9], ['plant_birch', -9, -3], ['plant_pine', 8.5, -1.5], ['plant_birch', -10.5, 9],
  ['jetty', 10, -4.6, 0],
])
console.log('garden notes:', notes.length ? notes : 'none')
const nA = await pa.evaluate(() => window.__oth.coop.session.pieces.size)
check(nA >= 9, `${nA} pieces: the hedge, the beds, the trees, the jetty`)
// A PIECE DROPPING IN: three frames of a fire ring set down in the yard
const view = (p, c, dx, dz, h, dyaw = 0, pitch = -0.18) => p.evaluate(([c, dx, dz, h, dyaw, pitch]) => window.__oth.view(c.x + dx, c.z + dz, h, Math.atan2(dx, dz) + dyaw, pitch), [c, dx, dz, h, dyaw, pitch])
await pa.keyboard.press('KeyB'); await sleep(400)
await view(pa, { x: claim.x + 2.5, z: claim.z + 1 }, 4.5, 6, 2.2, 0, -0.2); await sleep(1500)
await pa.evaluate((c) => { const o = window.__oth; o.coop.session.ask({ t: 'place', kind: 'campfire', x: c.x + 2.5, y: o.world.map.height(c.x + 2.5, c.z + 1), z: c.z + 1, rot: 0, variant: 0 }) }, claim)
for (const [k, ms] of [['a', 160], ['b', 200], ['c', 260]]) { await sleep(ms); await pa.screenshot({ path: `${out}/5_drop_${k}.png` }) }
await sleep(1200)
// B sees it all
await pb.waitForFunction((n) => window.__oth.coop.session.pieces.size >= n, { timeout: 8000 }, nA + 1).catch(() => {})
await settle(pb).catch(() => {})
await sleep(3500)
const seen = await pb.evaluate(([c, mound, pond]) => {
  const o = window.__oth, m = o.world.map, S = o.coop.session
  return { y: [[-6, -4], [5, 3], [0, 7], [-7, 5]].map(([dx, dz]) => m.height(c.x + dx, c.z + dz)), mound: m.height(mound.x, mound.z), pond: m.waterAt(pond.x, pond.z), pieces: S.pieces.size, strokes: [...S.paint.values()].reduce((a, l) => a + l.length, 0) }
}, [claim, mound, pond])
console.log('B sees:', JSON.stringify(seen))
check(seen.y.every((v, i) => Math.abs(v - after[i]) < 0.02) && Math.abs(seen.mound - m1) < 0.02, 'B: the same ground under the same points')
check(seen.pond !== null, 'B: the pond')
check(seen.strokes >= 13 && seen.pieces >= nA + 1, `B: the paving (${seen.strokes} strokes) and every piece`)
// SOLID: A stands on the mound's top
await pa.evaluate((p) => window.__oth.hero.appear(p.x, p.z, 0), mound)
await sleep(1500)
const stand = await pa.evaluate(() => { const p = window.__oth.hero.pos; return { y: p.y, g: window.__oth.world.map.height(p.x, p.z) } })
console.log('on the mound:', JSON.stringify(stand))
check(Math.abs(stand.y - stand.g) < 0.35 && stand.g > m0 + 1, 'A stands on the raised ground (its physics rebuilt)')
// the shots
const shot = async (p, name, f) => { await f(); await sleep(2200); await p.screenshot({ path: `${out}/${name}.png` }) }
await shot(pa, '1_yard', () => view(pa, claim, 14, 19, 7.5, 0, -0.3))
await shot(pa, '2_pond', () => view(pa, pond, -4, 12, 3.2, 0, -0.17))
await shot(pa, '3_garden', () => view(pa, { x: claim.x - 5, z: claim.z + 5 }, 3, 7.5, 2.0, 0, -0.18))
await shot(pa, '3b_trees', () => view(pa, { x: claim.x - 9, z: claim.z + 3 }, 6, 9, 2.0, 0, -0.06))
await shot(pb, '4_seen_by_B', () => view(pb, claim, -18, 16, 8, 0, -0.3))
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none')
check(!errs.length, 'no page errors')
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
