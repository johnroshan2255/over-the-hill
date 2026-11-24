// CO-OP'S FIGHT (docs/WEAPONS.md — "The rules they share"; the server's weapons.rs): two players for real, on foot.
// A holds the pistol — B sees it in A's hands; A shoots B (the keys, the chase camera's cross on B's chest) — the
// server takes B's health, both games show it; on down B lies on both screens, A's further shots claim nothing; 5 s
// on the server brings B back whole by B's car (B has no camp); a claim A can't make (a gun not in the hands) takes nothing;
// A's AK-47: B sees it, up as A fires, A's rounds in the air on B's screen; one takes B's health. Stills in <outdir>.
//   node scripts/harness/coopfight.mjs <outdir>     env: PORT (the dev server, 5200), TIER (low)
// Needs: `npm run dev -- --port 5200` and the server (`cd backend && cargo run --release`).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'coopfight'
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

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
const errs = []
const open = async (who, extra) => {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errs.push(`${who.name}: ${e.message}`); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') { errs.push(`${who.name}: ${m.text().slice(0, 200)}`); console.log(`[${who.name}]`, m.text().slice(0, 300)) } })
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'low'}&hour=12&time=0&save=0&dpr=fixed${extra}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A, '&weapons=all'), pb = await open(B, '')
await sleep(2500)
const key = async (p, c, ms = 70) => { await p.keyboard.down(c); await sleep(ms); await p.keyboard.up(c) }
// out of the car (F) and clear of it, each
for (const p of [pa, pb]) {
  await p.bringToFront()
  await key(p, 'KeyF')
  for (let i = 0; i < 60; i++) { await sleep(500); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
  await p.keyboard.down('KeyA'); await sleep(5000); await p.keyboard.up('KeyA')
}
/** B put `d` m in front of A, facing A. */
const bBefore = async (d) => {
  const a = await pa.evaluate(() => { const h = window.__oth.hero; return { x: h.pos.x, z: h.pos.z, h: h.heading } })
  await pb.evaluate((a, d) => window.__oth.hero.appear(a.x - Math.sin(a.h) * d, a.z - Math.cos(a.h) * d, a.h + Math.PI), a, d)
  await sleep(1200)
}
const sidOf = (p, name) => p.evaluate((n) => [...window.__oth.coop.session.remotes.values()].find((r) => r.name === n)?.sid, name)
const bSid = await sidOf(pa, 'Ravi'), aSid = await sidOf(pb, 'Asha')
/** A's chase camera and its cross on B's chest (as B is drawn on A's screen). */
const aimAtB = () => pa.evaluate((sid) => {
  const o = window.__oth, h = o.hero.pos, r = o.coop.remotes.list.find((x) => x.name === 'Ravi')
  if (!r) return
  const y = o.coop.session.remotes.get(sid).tracks.get(0)?.last?.p[1] ?? h.y
  const dx = r.x - h.x, dz = r.z - h.z, dy = y + 1.25 - (h.y + 1.66)
  o.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
}, bSid)
const hp = async () => ({
  b: await pb.evaluate(() => ({ hp: window.__oth.coop.session.hp, down: window.__oth.coop.session.down, lying: window.__oth.hero.isDown, x: window.__oth.hero.pos.x, z: window.__oth.hero.pos.z })),
  aSees: await pa.evaluate((sid) => { const r = window.__oth.coop.session.remotes.get(sid); const av = window.__oth.coop.remotes.avatars.get(sid); return { hp: r.hp, down: r.down, lying: !!av?.hero?.isDown } }, bSid),
})
/** A still from `p`'s side of the other: a camera 5 m off them, square on. */
const still = async (p, name, file, d = 4.5, up = 1.9, pitch = -0.1) => {
  await p.evaluate((name, d, up, pitch) => {
    const o = window.__oth, r = o.coop.remotes.list.find((x) => x.name === name)
    // (from the side away from the cars — ours and theirs — a little round)
    let ax = 0, az = 0
    for (const c of [o.car.pos, ...o.coop.remotes.list.filter((x) => x !== r)]) { const dx = r.x - c.x, dz = r.z - c.z, d = Math.hypot(dx, dz) || 1; ax += dx / d; az += dz / d }
    const a = Math.atan2(ax, az) + 0.5, x = r.x + Math.sin(a) * d, z = r.z + Math.cos(a) * d
    o.view(x, z, up, Math.atan2(-(r.x - x), -(r.z - z)), pitch)
  }, name, d, up, pitch)
  await sleep(250)
  await p.screenshot({ path: `${out}/${file}.png` })
  await p.evaluate(() => window.__oth.drive(true))
}

// THE PISTOL in A's hands, as B sees it
await bBefore(12)
await pa.bringToFront()
await pa.evaluate(() => window.__oth.arsenal.equip('pistol'))
await sleep(1200)
// (B's page in front: a tab behind another draws no frames on the Mac — what B sees isn't posed till it does)
await pb.bringToFront()
// (B's camera on A — a walker out of view isn't posed or drawn, nor what's in his hands)
await pb.evaluate(() => {
  const o = window.__oth, r = o.coop.remotes.list.find((x) => x.name === 'Asha'), h = o.hero.pos
  const dx = r.x - h.x, dz = r.z - h.z, d = Math.hypot(dx, dz) || 1, x = r.x - (dx / d) * 4.5, z = r.z - (dz / d) * 4.5
  o.view(x, z, 1.9, Math.atan2(-(r.x - x), -(r.z - z)), -0.1)
})
// (the model is fetched the first time B's game sees it in A's hands: up to 4 s for it)
for (let i = 0; i < 20; i++) { await sleep(200); if (await pb.evaluate((sid) => !!window.__oth.coop.remotes.avatars.get(sid)?.arms.models.get('pistol')?.mesh.visible, aSid)) break }
const seesGun = await pb.evaluate((sid) => { const av = window.__oth.coop.remotes.avatars.get(sid); return { weapon: window.__oth.coop.session.remotes.get(sid).weapon, shown: [...(av?.arms.models.entries() ?? [])].filter(([, m]) => m.mesh.visible).map(([k]) => k) } }, aSid)
console.log('B sees A holding', JSON.stringify(seesGun))
if (!seesGun.shown.includes('pistol')) console.log('… why:', JSON.stringify(await pb.evaluate((sid) => { const av = window.__oth.coop.remotes.avatars.get(sid); return { kind: av?.kind, shown: av?.shown, inView: av?.inView, hero: !!av?.hero, heroVis: av?.hero?.visible, rootVis: av?.hero?.root.visible, w: av?.arms.w, posed: av?.arms.posed, models: [...(av?.arms.models.keys() ?? [])], hasGeo: !!av?.arms.models.get('pistol')?.mesh.geometry.attributes.position } }, aSid)))
check(seesGun.weapon === 'pistol' && seesGun.shown.includes('pistol'), 'B sees the pistol in A\'s hands')
await still(pb, 'Asha', 'b_sees_a_pistol')

// A shoots B: the server takes B's health, both screens agree
await pa.bringToFront()
await aimAtB(); await sleep(300)
for (let i = 0; i < 2; i++) { await key(pa, 'KeyJ'); await sleep(300); await aimAtB() }
await sleep(600)
let s = await hp()
console.log('after 2 shots', JSON.stringify(s))
check(s.b.hp < 100 && s.b.hp > 0, `B is hit: ${s.b.hp.toFixed(1)} left`)
check(Math.abs(s.aSees.hp - s.b.hp) < 0.01, `A sees the same health (${s.aSees.hp.toFixed(1)})`)
await pb.bringToFront(); await sleep(200)
check(await pb.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.style.bottom === '72px' && d.style.display === 'block')), "B's health bar is up")
await pb.screenshot({ path: `${out}/b_hit_view.png` })

// on till B is down
await pa.bringToFront()
for (let i = 0; i < 12 && !(await hp()).b.down; i++) { await aimAtB(); await key(pa, 'KeyJ'); await sleep(320) }
await sleep(500)
s = await hp()
const fell = { x: s.b.x, z: s.b.z }
console.log('down', JSON.stringify(s))
check(s.b.down && s.b.hp === 0, 'B is down (the server says)')
check(s.b.lying, 'B lies on B\'s screen')
check(s.aSees.down && s.aSees.lying, 'and on A\'s screen')
await still(pa, 'Ravi', 'a_sees_b_down', 3, 3.2, -0.75)
// (down: A's shots claim nothing)
const sent0 = await pa.evaluate(() => window.__oth.coop.remotes.sent.pistol ?? 0)
await pa.bringToFront(); await aimAtB(); await key(pa, 'KeyJ'); await sleep(500)
check((await pa.evaluate(() => window.__oth.coop.remotes.sent.pistol ?? 0)) === sent0, 'a man down is not a target')

// 5 s on the server: B back, whole, at the start
for (let i = 0; i < 30 && (await hp()).b.down; i++) await sleep(250)
await sleep(800)
s = await hp()
console.log('up', JSON.stringify(s))
check(!s.b.down && s.b.hp === 100 && !s.b.lying, 'B is back, whole')
const byCar = await pb.evaluate(() => { const o = window.__oth; return Math.hypot(o.hero.pos.x - o.car.pos.x, o.hero.pos.z - o.car.pos.z) })
check(byCar < 4, `B is back by B's car (${byCar.toFixed(1)} m from it, ${Math.hypot(s.b.x - fell.x, s.b.z - fell.z).toFixed(0)} m from where B fell)`)
check(!s.aSees.down && !s.aSees.lying && s.aSees.hp === 100, 'A sees B up')

// a claim the server must refuse: a sniper's hit with the pistol in the hands
await bBefore(10)
await pa.evaluate((sid) => window.__oth.coop.session.hit(sid, 'sniper', 'head', 10), bSid)
await sleep(500)
check((await hp()).b.hp === 100, 'a hit with a gun not in the hands takes nothing')

// THE AK-47: B sees it in A's hands, up as A fires, A's rounds in the air on B's screen; a round takes B's health
await pa.bringToFront()
await pa.evaluate(() => window.__oth.arsenal.equip('ak47'))
await sleep(1500)
await bBefore(10)
await pa.bringToFront()
const watch = pb.evaluate((sid) => new Promise((res) => {
  let n = 0, k = 0, shown = false
  const t0 = performance.now(), f = () => {
    const av = window.__oth.coop.remotes.avatars.get(sid)
    n = Math.max(n, window.__oth.arsenal.bullets.length); k = Math.max(k, av?.arms.k ?? 0); shown ||= !!av?.arms.models.get('ak47')?.mesh.visible
    if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res({ n, k, shown })
  }
  requestAnimationFrame(f)
}), aSid)
await aimAtB(); await sleep(300)
await key(pa, 'KeyJ', 40)
await sleep(200)
await still(pb, 'Asha', 'b_sees_a_ak47')
await sleep(1000)
const seen = await watch
s = await hp()
console.log('ak47', JSON.stringify(s), 'B saw', JSON.stringify(seen))
check(seen.shown, 'B sees the AK-47 in A\'s hands')
check(seen.k > 0.5, `B sees A's rifle up as A fires (${seen.k.toFixed(2)})`)
check(seen.n > 0, `B sees A's rounds in the air (${seen.n})`)
check(s.b.hp < 100, `the AK-47's round takes B's health (${s.b.hp.toFixed(1)} left)`)

// B's CAR ON A'S SCREEN: solid as its own shape (NEXT_damage §2.7 — it was a box round its mirrors and bars): a ray at
// its door stops at the door (A's page in front: its physics stepped — a query sees a body once a step has run)
await pa.bringToFront(); await sleep(400)
const side = await pa.evaluate((sid) => {
  const o = window.__oth, av = o.coop.remotes.avatars.get(sid), s = av?.solidCar
  if (!s) return null
  const pw = o.physics.pw, b = s.body, t = b.translation(), q = b.rotation(), box = av.car.box
  // (its right, the world's: the car's +x turned by its rotation)
  const x = 1 - 2 * (q.y * q.y + q.z * q.z), z = 2 * (q.x * q.z - q.w * q.y), n = Math.hypot(x, z)
  const r = new pw.R.Ray({ x: t.x + (x / n) * 5, y: t.y + 0.9, z: t.z + (z / n) * 5 }, { x: -x / n, y: 0, z: -z / n })
  const h = pw.world.castRay(r, 10, true, undefined, undefined, undefined, undefined, (c) => c.parent()?.handle === b.handle)
  // (each of its pieces asked itself too — the world's query sees a body as of its last step)
  let own = Infinity
  for (let i = 0; i < b.numColliders(); i++) { const c = b.collider(i), t2 = c.castRay(r, 10, true); if (t2 !== null && t2 >= 0) own = Math.min(own, t2) }
  return { key: s.key, colliders: b.numColliders(), hit: h ? +(5 - h.timeOfImpact).toFixed(3) : null, own: Number.isFinite(own) ? +(5 - own).toFixed(3) : null, q: [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(3)), up: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(3), box: box ? +(box.h.x + Math.abs(box.c.x)).toFixed(3) : null }
}, bSid)
console.log("B's car on A's screen:", JSON.stringify(side))
// (and as B's own game has it: the same tilt — what A draws is what B's physics says)
const own = await pb.evaluate(() => { const c = window.__oth.car, q = c.root.quaternion, p = c.root.position; return { up: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(3), p: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), parked: !!c.parked } })
const drawnAt = await pa.evaluate((sid) => { const p = window.__oth.coop.remotes.avatars.get(sid).car.root.position; return [p.x, p.y, p.z].map((v) => +v.toFixed(2)) }, bSid)
console.log("B's car on B's own screen:", JSON.stringify(own), 'A draws it at', JSON.stringify(drawnAt))
check(Math.abs(own.up - side.up) < 0.05, `A draws B's car tilted as B's game has it (up ${side.up} / ${own.up})`)
check(!!side && side.key.endsWith(':shape') && side.colliders > 1, `B's car is solid as its own shape (${side?.key}, ${side?.colliders} pieces)`)
check(!!side && side.hit !== null && side.box !== null && side.hit < side.box - 0.05, `a ray at its door stops at the door (${side?.hit} m from its middle; the box stood at ${side?.box})`)

check(errs.length === 0, `no page errors (${errs.length})`)
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
