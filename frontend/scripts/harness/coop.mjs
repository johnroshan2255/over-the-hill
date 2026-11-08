// CO-OP, two players for real (docs/MULTIPLAYER.md step 1): two separate Chrome profiles sign up on the server, one
// hosts a world, the other joins with its code; both drive in. A drives off; B must see A's car — where A is, moving
// smoothly — and the name tag over it. Screenshots from B's view, the remote's pose against A's own, the jitter.
//   node scripts/harness/coop.mjs <outdir>     env: PORT (the dev server, 5200), TIER (low), W / H (1280×720)
// Needs: `npm run dev` and the server (`cd backend && cargo run --release`).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'coopshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const W = Number(process.env.W || 1280), H = Number(process.env.H || 720)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`)
  return j
}

// the two players and their world (as the CO-OP screen does it)
const A = await api('POST', '/v1/players', { name: 'Asha' }), B = await api('POST', '/v1/players', { name: 'Ravi' })
const world = await api('POST', '/v1/worlds', { name: 'Harness valley', map: 'valley' }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
console.log(`world ${world.name} · code ${world.code}`)

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'],
  defaultViewport: { width: W, height: H },
})
const open = async (who) => {
  const ctx = await browser.createBrowserContext() // (its own storage: its own account)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${who.name} pageerror]`, e.message))
  page.on('console', (m) => { const t = m.text(); if (/error|co-op/i.test(t)) console.log(`[${who.name}]`, t.slice(0, 400)) })
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'low'}&hour=12&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A)
const pb = await open(B)
await sleep(2500) // (the walkers' and the bikes' models, the first poses)

const state = (p) => p.evaluate(() => {
  const o = window.__oth, c = o.car
  return { me: [c.pos.x, c.pos.y, c.pos.z].map((v) => +v.toFixed(2)), others: o.coop.remotes.list.map((r) => ({ name: r.name, x: +r.x.toFixed(2), z: +r.z.toFixed(2) })), rtt: Math.round(o.coop.session.rtt), sid: o.coop.session.me.sid }
})
let sa = await state(pa), sb = await state(pb)
console.log('A', JSON.stringify(sa))
console.log('B', JSON.stringify(sb))
const seen = (s, who) => s.others.find((o) => o.name === who)
const near = (a, b, tol) => Math.hypot(a.x - b[0], a.z - b[2]) < tol
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
check(!!seen(sb, 'Asha') && near(seen(sb, 'Asha'), sa.me, 1.5), 'B sees A where A is (standing)')
check(!!seen(sa, 'Ravi') && near(seen(sa, 'Ravi'), sb.me, 1.5), 'A sees B where B is (standing)')
await pb.screenshot({ path: `${out}/b_sees_a_still.png` })

// A drives off for 4 s (W held); B watches: its view of A sampled every frame — the path must be smooth
await pa.bringToFront()
await pa.keyboard.down('KeyW')
const track = pb.evaluate(() => new Promise((res) => {
  const pts = [], t0 = performance.now()
  const f = () => {
    const r = window.__oth.coop.remotes.list.find((o) => o.name === 'Asha')
    if (r) pts.push([performance.now() - t0, r.x, r.z])
    if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(pts)
  }
  requestAnimationFrame(f)
}))
// (and A's own view: how close A's car comes to B's — B's is solid: A can't drive through it)
const gap = pa.evaluate(() => new Promise((res) => {
  let min = Infinity
  const t0 = performance.now()
  const f = () => {
    const o = window.__oth, r = o.coop.remotes.list.find((x) => x.name === 'Ravi')
    if (r) min = Math.min(min, Math.hypot(o.car.pos.x - r.x, o.car.pos.z - r.z))
    if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(min)
  }
  requestAnimationFrame(f)
}))
await sleep(2000)
await pb.screenshot({ path: `${out}/b_sees_a_driving.png` })
const pts = await track
await pa.keyboard.up('KeyW')
await pa.keyboard.down('Space') // (the handbrake: stopped, so 'where A stopped' means it)
await sleep(3500)
await pa.keyboard.up('Space')
sa = await state(pa); sb = await state(pb)
const drove = Math.hypot(pts.at(-1)[1] - pts[0][1], pts.at(-1)[2] - pts[0][2])
// (the smoothness: a frame's step against its neighbours' — a hitch or a jump stands out)
let worst = 0
for (let i = 2; i < pts.length; i++) {
  const d1 = Math.hypot(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][2] - pts[i - 2][2]), d2 = Math.hypot(pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
  worst = Math.max(worst, Math.abs(d2 - d1))
}
console.log(`B's view of A: ${pts.length} frames, ${drove.toFixed(1)} m driven, the worst change in a frame's step ${worst.toFixed(3)} m`)
check(drove > 5, 'B saw A drive off')
const minGap = await gap
console.log(`the closest A's car came to B's: ${minGap.toFixed(2)} m (centre to centre)`)
check(minGap > 1.9, "solid: A's car didn't go through B's")
check(!!seen(sb, 'Asha') && near(seen(sb, 'Asha'), sa.me, 0.3), 'after the drive B sees A where A stopped (within 30 cm)')
check(worst < 0.35, 'smooth: no jump in what B sees')
console.log('A', JSON.stringify(sa))
console.log('B', JSON.stringify(sb))
await pb.screenshot({ path: `${out}/b_after.png` })

// ON FOOT, then ON THE MOTORBIKE: A gets out and walks; B (its free camera on A) sees the walker, then the rider
const look = (page, name) => page.evaluate((name) => {
  const o = window.__oth, r = o.coop.remotes.list.find((x) => x.name === name)
  if (!r) return null
  const d = 7, a = r.heading + 2.4, x = r.x - Math.sin(a) * d, z = r.z - Math.cos(a) * d
  o.view(x, z, 2.2, Math.atan2(-(r.x - x), -(r.z - z)), -0.12)
  return r
}, name)
const kindOf = (page, name) => page.evaluate((name) => { const c = window.__oth.coop; for (const r of c.session.remotes.values()) if (r.name === name) return r.tracks.get(0)?.last?.kind; return null }, name)
await pa.evaluate(() => window.__oth.foot())
await sleep(3500) // (out of the door)
await pa.keyboard.down('KeyW'); await sleep(1500); await pa.keyboard.up('KeyW'); await sleep(600)
check((await kindOf(pb, 'Asha')) === 0, 'B: A is on foot')
await look(pb, 'Asha'); await sleep(400)
await pb.screenshot({ path: out + "/b_sees_a_walking.png" })
await pa.evaluate(() => window.__oth.ride()) // (onto the motorbike)
await sleep(2500)
await pa.keyboard.down('KeyW'); await sleep(1500); await pa.keyboard.up('KeyW'); await sleep(800)
check((await kindOf(pb, 'Asha')) === 3, 'B: A is on the motorbike')
await look(pb, 'Asha'); await sleep(400)
await pb.screenshot({ path: out + "/b_sees_a_riding.png" })
sa = await state(pa); sb = await state(pb)
check(!!seen(sb, 'Asha') && near(seen(sb, 'Asha'), [sa.me[0], 0, sa.me[2]], 50), 'B still has A (riding)')

await pa.screenshot({ path: `${out}/a_after.png` })
await browser.close()
console.log(ok ? 'co-op: all good' : 'co-op: FAILED')
process.exit(ok ? 0 : 1)
