// apcoop.mjs — THE AUTOPILOT IN CO-OP: two players in one world (as coop.mjs: two Chrome profiles, the server's API);
// A sets a waypoint 350 m along a track and turns the autopilot on (O); B watches A's car for 14 s — it must move with
// A (B's view of A within 3 m of where A is, A 80 m+ gone), the autopilot still on, B's own car untouched.
// Needs `npm run dev` and the server (`cd backend && cargo run --release`).
import puppeteer from 'puppeteer-core'
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`); return j }
const A = await api('POST', '/v1/players', { name: 'Asha' }), B = await api('POST', '/v1/players', { name: 'Ravi' })
const world = await api('POST', '/v1/worlds', { name: 'Autopilot valley', map: 'valley' }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
const browser = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
const open = async (who) => {
  const ctx = await browser.createBrowserContext(), page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${who.name} pageerror]`, e.message))
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=low&hour=12&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 180_000, polling: 250 })
  return page
}
const pa = await open(A), pb = await open(B)
await sleep(2500)
const pos = (p) => p.evaluate(() => { const c = window.__oth.car.root.position; return [c.x, c.z] })
const a0 = await pos(pa), b0 = await pos(pb)
// A: a waypoint 350 m along the nearest track, the autopilot on
const wp = await pa.evaluate(() => { const o = window.__oth, P = o.car.root.position, L = o.world.map.meta.trails.lines; let best = null, bd = 1e9; for (const l of L) for (let k = 0; k < l.length; k++) { const d = Math.hypot(l[k][0] - P.x, l[k][1] - P.z); if (d < bd) { bd = d; best = [l, k] } } const [l, k] = best, t = l[Math.min(l.length - 1, k + 175)] ?? l[Math.max(0, k - 175)]; o.drive(true); o.guide.set({ world: o.world.id, x: t[0], z: t[1], name: 'Waypoint' }, { x: P.x, z: P.z }); return t })
await sleep(1200)
await pa.bringToFront(); await pa.keyboard.press('KeyO'); await sleep(400)
console.log('A: autopilot on =', await pa.evaluate(() => window.__oth.autopilot.on), '· waypoint', wp.map((v) => Math.round(v)).join(','))
await sleep(14000)
const a1 = await pos(pa), b1 = await pos(pb)
const seen = await pb.evaluate(() => { const r = window.__oth.coop.remotes.list.find((o) => o.name === 'Asha'); return r ? [r.x, r.z] : null })
const on = await pa.evaluate(() => window.__oth.autopilot.on)
const gone = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), err = seen ? Math.hypot(seen[0] - a1[0], seen[1] - a1[1]) : NaN, bMoved = Math.hypot(b1[0] - b0[0], b1[1] - b0[1])
const check = (c, what) => console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`)
check(gone > 80, `A drove ${gone.toFixed(0)} m under the autopilot in 14 s`)
check(on || gone > 300, `the autopilot is still on (${on})`)
check(err < 3, `B sees A's car within ${err.toFixed(2)} m of where A is`)
check(bMoved < 1, `B's own car stood still (${bMoved.toFixed(2)} m)`)
await browser.close()
