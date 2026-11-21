// parktest.mjs — THE CAR LEFT BEFORE IT STOOD (oth/Vehicle.ts park; 2026-11-21, the user: "I get out of the car and it
// got stuck in the air"): reset (R — set down from 0.8 m up) and left at once; lifted 3 m and left at once — each time
// it must come down onto its wheels and stand where a car stands, held there; got back into, it drives.
//   node scripts/harness/parktest.mjs     env: PORT (5200), TIER (low)
import puppeteer from 'puppeteer-core'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message.slice(0, 300)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'low'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
await sleep(3500)
// (the body's own height — the physics', this instant: the drawn car is a frame behind it)
const st = () => p.evaluate(() => { const o = window.__oth, c = o.car, q = c.root.quaternion, t = c.sim.body.translation(); return { onFoot: o.onFoot, over: +(t.y - o.height(t.x, t.z)).toFixed(3), up: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(3), parked: c.parked, landing: c.landing, kmh: Math.round(c.speedKmh) } })
const out = async () => { for (let i = 0; i < 30 && !(await st()).onFoot; i++) { if (i % 6 === 0) await p.evaluate(() => window.__oth.foot()); await sleep(500) } }
// (in, the door shut behind him, the car live again and standing)
const inn = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (!s.onFoot && !s.parked) break; if (s.onFoot && i % 8 === 0) await p.evaluate(() => window.__oth.foot()); await sleep(500) } await sleep(2500) }
const rest = await st()
console.log('standing', JSON.stringify(rest))
// 1. reset, and out at once
await p.keyboard.press('KeyR')
await p.evaluate(() => window.__oth.foot())
let a = await st()
await sleep(5000)
let s = await st()
console.log('reset, left at once:', JSON.stringify(a), '→', JSON.stringify(s))
check(a.parked && a.over > rest.over + 0.3, `left while it was still ${(a.over - rest.over).toFixed(2)} m up`)
check(Math.abs(s.over - rest.over) < 0.12 && s.up > 0.97 && !s.landing, `it came down and stands (${s.over} m over the ground — ${rest.over} at rest; held: ${!s.landing})`)
await out()
await inn()
// 2. lifted 3 m, and out at once
await p.evaluate(() => { const o = window.__oth, c = o.car, t = c.sim.body.translation(); c.sim.place(t.x, t.y + 3, t.z, c.sim.heading); o.foot() })
a = await st()
await sleep(5500)
s = await st()
console.log('lifted 3 m, left at once:', JSON.stringify(a), '→', JSON.stringify(s))
check(a.parked && a.over > rest.over + 2, `left while it was ${(a.over - rest.over).toFixed(2)} m up`)
check(Math.abs(s.over - rest.over) < 0.15 && s.up > 0.95 && !s.landing, `it came down and stands (${s.over} m over the ground; held: ${!s.landing})`)
// 3. left standing: held within a moment
await out(); await inn()
await p.evaluate(() => window.__oth.foot())
await sleep(900)
s = await st()
check(s.parked && !s.landing && Math.abs(s.over - rest.over) < 0.05, `left standing, it is held within a second (landing: ${s.landing}, ${s.over} m over the ground)`)
// 4. back in: it drives
await out(); await inn()
await p.keyboard.down('KeyW'); await sleep(3000); await p.keyboard.up('KeyW')
s = await st()
check(!s.parked && s.kmh > 8, `got back into, it drives (${s.kmh} km/h)`)
check(errs.length === 0, `no page errors (${errs.length})`)
await b.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
