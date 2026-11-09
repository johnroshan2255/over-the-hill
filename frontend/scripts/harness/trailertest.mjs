// THE TRAILER (docs/MULTIPLAYER.md step 2b — oth/Trailer.ts): two players in a co-op world. A starts with the trailer
// hitched behind the jeep, drives off (it follows, swings on the turn), B sees it behind A's car; A stops, gets out,
// unhitches it at the coupler (E — the jockey wheel comes down); A fells a tree, the car brought beside the logs, and
// loads them straight into the trailer (E — the load on its bed); A plants a flag there and unloads the trailer into
// the stockpile (E) — B sees the stockpile. Screenshots of each.
//   node scripts/harness/trailertest.mjs <outdir>    env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'trailershots'
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
const world = await api('POST', '/v1/worlds', { name: 'Haul valley', map: 'valley' }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const errs = []
const open = async (who) => {
  const page = await (await browser.createBrowserContext()).newPage()
  page.on('pageerror', (e) => { errs.push(e.message); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  await page.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'high'}&hour=10&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop && window.__oth.gather, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A), pb = await open(B)
await pa.bringToFront()
await pa.waitForFunction(() => window.__oth.trailer?.hitched, { timeout: 20000, polling: 200 }).catch(() => {})
check(await pa.evaluate(() => !!window.__oth.trailer?.hitched), 'A starts with the trailer hitched behind the jeep')
const gap = () => pa.evaluate(() => { const o = window.__oth, c = o.car.pos, t = o.trailer.model.root.position; return Math.hypot(c.x - t.x, c.z - t.z) })
const tpos = () => pa.evaluate(() => { const t = window.__oth.trailer.model.root.position; return [t.x, t.y, t.z] })
await sleep(1500)
const g0 = await gap(), t0 = await tpos()
console.log('gap at rest:', g0.toFixed(2))
// drive: ahead, then a turn
await pa.keyboard.down('KeyW'); await sleep(3500)
await pa.screenshot({ path: `${out}/1_towing.png` })
await pa.keyboard.down('KeyA'); await sleep(1600)
await pa.screenshot({ path: `${out}/2_turning.png` })
await pa.keyboard.up('KeyA'); await sleep(800); await pa.keyboard.up('KeyW')
await sleep(2500)
const t1 = await tpos(), g1 = await gap()
console.log('trailer moved', Math.hypot(t1[0] - t0[0], t1[2] - t0[2]).toFixed(1), 'm; gap', g1.toFixed(2))
check(Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) > 8, 'the trailer came along')
check(Math.abs(g1 - g0) < 1.2, `still at the drawbar's length from the car (${g0.toFixed(2)} → ${g1.toFixed(2)} m)`)
check(await pa.evaluate(() => { const o = window.__oth, t = o.trailer.model.root; const up = new t.up.constructor(0, 1, 0).applyQuaternion(t.quaternion); return up.y > 0.8 }), 'on its wheels')
await pb.waitForFunction(() => { const r = window.__oth.coop.session.remotes; return [...r.values()].some((x) => x.tracks.get(2)?.last) }, { timeout: 8000 }).catch(() => {})
check(await pb.evaluate(() => [...window.__oth.coop.session.remotes.values()].some((x) => x.tracks.get(2)?.last)), 'B hears of A\'s trailer (pose slot 2)')
// B's view of it
await pb.evaluate((t) => { window.__oth.view(t[0] + 6, t[2] + 5, 2.6, Math.atan2(6, 5), -0.15) }, t1)
await sleep(2500)
await pb.screenshot({ path: `${out}/3_seen_by_B.png` })
// out, to the coupler, unhitch
await pa.evaluate(() => window.__oth.foot())
await pa.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 })
await pa.evaluate(() => { const o = window.__oth, C = o.trailer.couplerWorld(new o.camera.position.constructor()); const h = o.trailer.model.root.quaternion; o.hero.appear(C.x + 1.0, C.z + 0.6, Math.atan2(1.0, 0.6)) })
await sleep(1200)
const prompt = (p) => p.evaluate(() => window.__oth.gather.prompt?.join(' ') ?? '')
check(/Unhitch/.test(await prompt(pa)), `at the coupler: "${await prompt(pa)}"`)
await pa.keyboard.press('KeyE')
await sleep(1800)
check(await pa.evaluate(() => !window.__oth.trailer.hitched), 'unhitched')
await pa.evaluate(() => { const o = window.__oth, t = o.trailer.model.root.position; o.view(t.x + 3.5, t.z - 3.2, 1.6, Math.atan2(3.5, -3.2), -0.12) })
await sleep(1200)
await pa.screenshot({ path: `${out}/4_unhitched.png` })
await pa.evaluate(() => window.__oth.drive(true))
// fell a tree, bring the car (and the trailer, re-hitched) beside the logs, load them into the trailer
const tree = await pa.evaluate(() => {
  const o = window.__oth, p = o.hero.pos, t = o.world.trees
  const i = t.nearestIndex(p.x, p.z, 200, 6), T = t.treeAt(i), dx = p.x - T.x, dz = p.z - T.z, L = Math.hypot(dx, dz) || 1
  o.hero.appear(T.x + (dx / L) * 1.5, T.z + (dz / L) * 1.5, Math.atan2(dx / L, dz / L))
  return { i, ...T }
})
await sleep(1200)
for (let k = 0; k < 3; k++) {
  await pa.keyboard.press('KeyE')
  await sleep(300)
  await pa.waitForFunction(() => window.__oth.hero.state === 'move' && !window.__oth.gather.busy, { timeout: 8000, polling: 100 }).catch(() => {})
  await sleep(150)
}
await pa.waitForFunction((i) => window.__oth.coop.session.stumps.has(i), { timeout: 8000 }, tree.i).catch(() => {})
await sleep(4200) // (it falls, its logs land)
// the car and trailer brought round: beside the logs (the trailer rehitched where the car lands)
await pa.evaluate((T) => {
  const o = window.__oth, p = o.hero.pos, ax = p.x - T.x, az = p.z - T.z, L = Math.hypot(ax, az) || 1
  // (the car ahead of the trailer: the trailer's bed 4 m from the logs, beside the player)
  const sx = -az / L, sz = ax / L
  const bx = T.x + sx * 4, bz = T.z + sz * 4
  o.car.placeAt(bx - ax / L * 4, bz - az / L * 4, Math.atan2(ax / L, az / L))
  o.trailer.hitch(true)
}, tree)
await sleep(600)
await pa.evaluate(() => { const o = window.__oth; o.trailer.spawnBehind() })
await sleep(1800)
const p1 = await prompt(pa)
check(/Load \d+ wood into the trailer/.test(p1), `by the logs, the trailer close: "${p1}"`)
await pa.keyboard.press('KeyE')
await pa.waitForFunction(() => window.__oth.coop.session.inv.trailer.wood > 0, { timeout: 8000, polling: 100 }).catch(() => {})
const tw = await pa.evaluate(() => window.__oth.coop.session.inv.trailer.wood)
check(tw > 0, `the trailer holds ${tw} wood`)
await sleep(1200)
await pa.evaluate(() => { const o = window.__oth, t = o.trailer.model.root.position; o.view(t.x + 3, t.z + 3.4, 2.4, Math.atan2(3, 3.4), -0.3) })
await sleep(1200)
await pa.screenshot({ path: `${out}/5_loaded.png` })
await pa.evaluate(() => window.__oth.drive(true))
// a flag here; unload the trailer into its stockpile
const claim = await pa.evaluate(async () => {
  const o = window.__oth, t = o.trailer.model.root.position, S = o.coop.session
  for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8], [12, 12], [-12, -12]]) {
    try { await S.ask({ t: 'claim', x: t.x + dx, z: t.z + dz, r: 14 }); break } catch (e) { /* (try another) */ }
  }
  return [...S.claims.values()].find((c) => c.owner === S.me.id) ?? null
})
check(!!claim, 'A has land by the trailer')
await pa.evaluate(() => { const o = window.__oth, b = o.trailer.bedWorld(new o.camera.position.constructor()); o.hero.appear(b.x + 2.2, b.z + 0.8, 0) })
await sleep(1200)
console.log('dbg:', JSON.stringify(await pa.evaluate(() => { const o = window.__oth, S = o.coop.session, b = o.trailer.bedWorld(new o.camera.position.constructor()), h = o.hero.pos; return { bed: [b.x, b.z], hero: [h.x, h.z], inv: S.inv.trailer, onFoot: o.onFoot, state: o.hero.state, claims: [...S.claims.values()].map((c) => ({ x: c.x, z: c.z, r: c.r, own: c.owner === S.me.id })), busy: !!o.gather.busy } })))
const p2 = await prompt(pa)
check(/Unload the trailer/.test(p2), `by the trailer, on A's land: "${p2}"`)
await pa.keyboard.press('KeyE')
await pb.waitForFunction(() => [...window.__oth.coop.session.claims.values()].some((c) => c.stock.wood > 0), { timeout: 8000, polling: 100 }).catch(() => {})
check(await pb.evaluate(() => [...window.__oth.coop.session.claims.values()].some((c) => c.stock.wood > 0)), 'unloaded: B sees the wood in A\'s stockpile')
await pa.waitForFunction(() => window.__oth.coop.session.inv.trailer.wood === 0, { timeout: 5000, polling: 100 }).catch(() => {})
check(await pa.evaluate(() => window.__oth.coop.session.inv.trailer.wood === 0), 'the trailer empty again')
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none')
check(!errs.length, 'no page errors')
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
