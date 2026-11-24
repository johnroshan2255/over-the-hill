// CO-OP WEAPONS (docs/NEXT_companion.md §1, docs/WEAPONS.md "Co-op"): two players for real (two Chrome profiles, one
// world on the server). Both on foot, B 14 m in front of A. A takes the AK-47 out → B sees it in A's hands; A aims →
// B sees it raised; A fires at B → B sees the shots (their tracer), the server takes B's health (B's bar), B goes
// down (lying, for A too), and 5 s later B is up, whole, back at the start. A shot at nobody takes nothing.
//   node scripts/harness/coopfight.mjs <outdir>     env: PORT (5200), TIER (low)
// Needs: `npm run dev` and the server (`cd backend && cargo run --release`).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'coopfightshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }

const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`)
  return j
}
const A = await api('POST', '/v1/players', { name: 'Asha' }), B = await api('POST', '/v1/players', { name: 'Ravi' })
const world = await api('POST', '/v1/worlds', { name: 'Fight valley', map: 'valley' }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
console.log(`world ${world.name} · code ${world.code}`)

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
})
const errs = []
const open = async (who) => {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errs.push(e.message); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text().slice(0, 200)); console.log(`[${who.name}]`, m.text().slice(0, 300)) } })
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'low'}&hour=12&time=0&save=0&dpr=fixed&weapons=all&weaponsites=0`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A)
const pb = await open(B)
await sleep(2000)

// both out of their cars, on foot
for (const p of [pa, pb]) {
  await p.bringToFront()
  await p.evaluate(() => window.__oth.foot())
  for (let i = 0; i < 40; i++) { await sleep(250); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
}
// B 14 m before A, facing A; A faces B
const posA = await pa.evaluate(() => { const h = window.__oth.hero; return { x: h.pos.x, y: h.pos.y, z: h.pos.z, h: h.heading } })
const bx = posA.x - Math.sin(posA.h) * 14, bz = posA.z - Math.cos(posA.h) * 14
await pb.bringToFront()
await pb.evaluate((x, z, h) => { const o = window.__oth; o.hero.appear(x, z, h); o.footCam() }, bx, bz, posA.h + Math.PI)
await sleep(1500)
await pa.bringToFront()
await sleep(1500)
const sidOf = (p, name) => p.evaluate((name) => { for (const r of window.__oth.coop.session.remotes.values()) if (r.name === name) return r.sid; return -1 }, name)
const bSid = await sidOf(pa, 'Ravi')
const remote = (p, name) => p.evaluate((name) => {
  const c = window.__oth.coop
  for (const r of c.session.remotes.values()) if (r.name === name) {
    const a = c.remotes['avatars'].get(r.sid)
    return { weapon: r.weapon, hp: r.hp, down: r.down, held: a?.hold?.weapon ?? null, lying: !!a?.hero?.lying, aimFlag: ((r.tracks.get(0)?.last?.flags ?? 0) & 4) !== 0, x: a?.pos.x, z: a?.pos.z }
  }
  return null
}, name)
check(bSid > 0, `A knows B (sid ${bSid})`)

// A takes the AK-47 out: B sees it in A's hands
await pa.evaluate(() => window.__oth.arsenal.equip('ak47'))
await sleep(1200)
let rA = await remote(pb, 'Asha')
check(rA?.weapon === 'ak47' && rA.held === 'ak47', `B sees the AK-47 in A's hands (${JSON.stringify(rA)})`)

// A aims (first person, the cross on B's chest) and holds the trigger
const aimAtB = () => pa.evaluate(() => {
  const o = window.__oth, h = o.hero.pos, c = o.coop
  let t = null
  for (const r of c.session.remotes.values()) if (r.name === 'Ravi') t = c.remotes['avatars'].get(r.sid)?.pos
  if (!t) return false
  const dx = t.x - h.x, dz = t.z - h.z, dy = t.y + 1.2 - (h.y + 1.66)
  o.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
  return true
})
check(await aimAtB(), 'A aims at B')
await sleep(600)
rA = await remote(pb, 'Asha')
check(rA?.aimFlag, `B sees A's gun raised (the pose's aim flag: ${rA?.aimFlag})`)
// (B: a view of A, aiming — a still)
await pb.bringToFront()
await pb.evaluate(() => {
  const o = window.__oth, c = o.coop
  for (const r of c.session.remotes.values()) if (r.name === 'Asha') {
    const a = c.remotes['avatars'].get(r.sid), p = a.pos, h = a.heading + 2.3, d = 4.5
    const x = p.x - Math.sin(h) * d, z = p.z - Math.cos(h) * d
    o.view(x, z, 1.8, Math.atan2(-(p.x - x), -(p.z - z)), -0.12)
  }
})
await sleep(500)
await pb.screenshot({ path: `${out}/1_b_sees_a_aiming.png` })
await pb.evaluate(() => window.__oth.drive(true))
// (B counts the shots it's told of)
await pb.evaluate(() => { window.__shots = 0; window.__oth.coop.session.on((e) => { if (e.t === 'shot') window.__shots++ }) })

// A fires: a burst, re-aimed as it goes
await pa.bringToFront()
await pa.evaluate(() => { const a = window.__oth.arsenal; a.ammo.ak47 = [30, 90] })
const s0 = await pa.evaluate(() => ({ ...window.__oth.arsenal.stats }))
await pa.keyboard.down('KeyJ')
for (let i = 0; i < 12; i++) { await aimAtB(); await sleep(100) }
await pa.keyboard.up('KeyJ')
await sleep(600)
const s1 = await pa.evaluate(() => ({ ...window.__oth.arsenal.stats }))
console.log(`A: ${s1.shots - s0.shots} shots, ${s1.hits - s0.hits} hits`)
check(s1.shots - s0.shots >= 5, `A fired (${s1.shots - s0.shots} shots)`)
check(s1.hits - s0.hits >= 3, `A's bullets hit B (${s1.hits - s0.hits})`)
let bState = await pb.evaluate(() => ({ hp: window.__oth.coop.session.hp, down: window.__oth.coop.session.down, isDown: window.__oth.hero.isDown, shots: window.__shots }))
let rB = await remote(pa, 'Ravi')
console.log('B', JSON.stringify(bState), '· A sees B', JSON.stringify(rB))
check(bState.shots >= 5, `B is told of A's shots (${bState.shots})`)
check(bState.down && bState.hp === 0, `the server took B's health: B is down (hp ${bState.hp})`)
check(bState.isDown, "B's own walker lies down")
check(rB?.down && rB.lying, 'A sees B down, lying')
await pa.screenshot({ path: `${out}/2_a_sees_b_down.png` })
// more shots at B while down take nothing (the server refuses them)
await pa.keyboard.down('KeyJ'); for (let i = 0; i < 4; i++) { await aimAtB(); await sleep(100) } await pa.keyboard.up('KeyJ')
await sleep(500)
check(!(await pa.evaluate(() => window.__oth.coop.session.closed)), 'still connected')

// up, 5 s on: back at the start, whole
await pb.bringToFront()
for (let i = 0; i < 40; i++) { await sleep(250); if (!(await pb.evaluate(() => window.__oth.coop.session.down))) break }
await sleep(800)
bState = await pb.evaluate(() => { const o = window.__oth; return { hp: o.coop.session.hp, down: o.coop.session.down, isDown: o.hero.isDown, x: o.hero.pos.x, z: o.hero.pos.z } })
console.log('B after', JSON.stringify(bState))
check(!bState.down && bState.hp === 100 && !bState.isDown, 'B is up again, whole')
check(Math.hypot(bState.x - bx, bState.z - bz) > 3, `B came back somewhere else than where they fell (${Math.hypot(bState.x - bx, bState.z - bz).toFixed(1)} m off)`)
await pa.bringToFront()
await sleep(1500)
rB = await remote(pa, 'Ravi')
check(rB && !rB.down && !rB.lying && rB.hp === 100, `A sees B up (${JSON.stringify(rB)})`)
await pb.screenshot({ path: `${out}/3_b_back.png` })

// A puts it away: B sees empty hands
await pa.evaluate(() => window.__oth.arsenal.equip(null))
await sleep(800)
rA = await remote(pb, 'Asha')
check(rA?.weapon === '' && rA.held === '', `B sees A's hands empty (${JSON.stringify(rA)})`)
// A's car takes a blow (parked where A left it): B's drawing of it is dented the same; mended, mended for B too
const dmgOf = (p) => p.evaluate(() => {
  const c = window.__oth.coop
  for (const r of c.session.remotes.values()) if (r.name === 'Asha') {
    const dm = c.remotes['avatars'].get(r.sid)?.car.damage
    if (!dm) return null
    let sum = 0
    for (const m of dm.meshes) for (let i = 0; i < m.dmg.length; i++) sum += m.dmg[i]
    return +sum.toFixed(2)
  }
  return null
})
const mine = () => pa.evaluate(() => { const dm = window.__oth.car.damage; let sum = 0; for (const m of dm.meshes) for (let i = 0; i < m.dmg.length; i++) sum += m.dmg[i]; return +sum.toFixed(2) })
const d0 = await dmgOf(pb)
await pa.evaluate(() => { const c = window.__oth.car, b = c.damage; b.hit(0.3, 0.7, -2.0, 0, 0, 1, 14, 'crash') })
await sleep(1200)
const dA = await mine(), dB = await dmgOf(pb)
console.log(`damage: A's own ${dA}, B's drawing of it ${dB} (before ${d0})`)
check(d0 === 0 && dA > 0 && Math.abs(dB - dA) < 0.01 * Math.max(1, dA), "B's drawing of A's car takes the same dent")
await pb.bringToFront()
await pb.evaluate(() => {
  const o = window.__oth, c = o.coop
  for (const r of c.session.remotes.values()) if (r.name === 'Asha') { const car = c.remotes['avatars'].get(r.sid).car, p = car.root.position, h = car.root.rotation.y; const x = p.x - Math.sin(h) * 6 + Math.cos(h) * 2, z = p.z - Math.cos(h) * 6 - Math.sin(h) * 2; o.view(x, z, 1.6, Math.atan2(-(p.x - x), -(p.z - z)), -0.1) }
})
await sleep(600)
await pb.screenshot({ path: `${out}/4_b_sees_a_car_dented.png` })
await pb.evaluate(() => window.__oth.drive(true))
await pa.bringToFront()
await pa.evaluate(() => window.__oth.car.damage.repair())
await sleep(1000)
check((await dmgOf(pb)) === 0, "A's car mended: mended for B too")
check(errs.length === 0, `no page errors (${errs.length})`)
await browser.close()
console.log(ok ? 'co-op fight: all good' : 'co-op fight: FAILED')
process.exit(ok ? 0 : 1)
