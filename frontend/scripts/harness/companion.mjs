// THE COMPANION (oth/Companion.ts): solo play, the game started in the car — he's in the passenger seat; out (F) — he
// gets out on his side; back in (F) — he gets in with you; out again, he's put 25 m away and you get in and drive off —
// he gets into his own car and follows along your way; you stop and get out — he pulls up and gets out; you walk and
// run — he keeps up beside you. Screenshots of each: <outdir>/comp_*.png
//   node scripts/harness/companion.mjs <outdir>    env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'compshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const W = 1280, H = 720
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message) })
page.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text().slice(0, 200)); console.log('[console]', m.text().slice(0, 300)) } })
await page.goto(`${BASE}/?tier=${process.env.TIER || 'high'}&hour=11&time=0&save=0&dpr=fixed&companion=friend`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__oth?.ready, { timeout: 120_000, polling: 250 })
await sleep(3000)

const look = () => page.evaluate(() => {
  const o = window.__oth, c = o.companion, p = c.hero.pos
  return { mode: c.mode, at: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), onFoot: o.onFoot }
})
const dist = () => page.evaluate(() => {
  const o = window.__oth, l = o.companion.list[0], y = o.youPos()
  return l ? Math.hypot(l.x - y.x, l.z - y.z) : -1
})
// (out: on foot and free to move again — the climb out and the turn along the car done; in: seated)
const footIs = async (v, s = 25) => { for (let i = 0; i < s * 4 && !(await page.evaluate((v) => { const o = window.__oth; return o.onFoot === v && (!v || o.hero.state === 'move') }, v)); i++) await sleep(250); await sleep(v ? 1500 : 600) }
const until = async (mode, s = 15) => { for (let i = 0; i < s * 2 && (await look()).mode !== mode; i++) await sleep(500); return look() }
const key = async (code, ms = 120) => { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code) }
const hold = async (codes, ms) => { for (const c of codes) await page.keyboard.down(c); await sleep(ms); for (const c of codes) await page.keyboard.up(c) }
const shot = (n) => page.screenshot({ path: `${out}/comp_${n}.png` })
/** A still from beside (side m to your right, back m behind, up m), then back to play. */
const aside = async (n, side, back, up, yawOff = 0) => {
  await page.evaluate((side, back, up, yawOff) => {
    const o = window.__oth, y = o.youPos(), h = o.youHeading()
    const x = y.x + Math.sin(h) * back + Math.cos(h) * side, z = y.z + Math.cos(h) * back - Math.sin(h) * side
    const yaw = Math.atan2(-(y.x - x), -(y.z - z)) + yawOff
    o.view(x, z, up, yaw, -0.25)
  }, side, back, up, yawOff)
  await sleep(1200)
  await shot(n)
  await page.evaluate(() => window.__oth.drive(true))
  await sleep(300)
}

let s = await look()
console.log('start', JSON.stringify(s))
check(s.mode === 'passenger', 'starts in your passenger seat')
await aside('1_passenger_side', 6, 0, 2.2)

await key('KeyF'); await footIs(true); await sleep(1500)
s = await look(); console.log('out', JSON.stringify(s))
check(s.onFoot && s.mode === 'foot', 'gets out with you')
await shot('2_out')

await key('KeyF'); await footIs(false)
s = await until('passenger')
console.log('back in', JSON.stringify(s))
check(!s.onFoot && s.mode === 'passenger', 'he gets back in with you')

// out, he's put 25 m away; in again at once and drive off: he takes his own car
await key('KeyF'); await footIs(true); await sleep(1500)
await page.evaluate(() => { const o = window.__oth, y = o.youPos(); o.companion.standAt(y.x + 20, y.z + 15) })
await key('KeyF'); await footIs(false)
s = await look(); console.log('drive off', JSON.stringify(s))
check(!s.onFoot, 'you are in the car')
await hold(['KeyW'], 2000)
s = await until('car', 20)
check(s.mode === 'car', `he takes his own car (${s.mode})`)
await hold(['KeyW'], 14000)
const dDrive = await dist()
console.log('after driving 14 s: his car', dDrive.toFixed(1), 'm behind')
check(dDrive > 5 && dDrive < 80, 'his car follows')
const carUp = await page.evaluate(() => { const o = window.__oth, c = o.companion; return { over: c.carP.y - o.height(c.carP.x, c.carP.z), seen: c.car.root.visible } })
check(carUp.over > -0.5 && carUp.over < 2.5, `his car is on the ground (${carUp.over.toFixed(2)} m over it)`)
await shot('3_driving')
await aside('4_follow_above', 0, 30, 14)
await hold(['KeyS'], 2500); await sleep(3500)
await aside('5_stopped_above', 0, 24, 10)
await key('KeyF'); await footIs(true)
s = await until('foot', 15)
console.log('stopped', JSON.stringify(s))
check(s.mode === 'foot', 'he pulls up and gets out of his car')
await sleep(4000)

// walk 5 s, run 6 s: he keeps up beside you
await hold(['KeyW', 'ControlLeft'], 5000)
await aside('6_walk_side', 4, -4, 1.8, 0.4)
await hold(['KeyW'], 6000)
const dRun = await dist()
console.log('after running: he is', dRun.toFixed(1), 'm from you')
check(dRun > 0 && dRun < 12, 'keeps up on foot (within 12 m)')
await sleep(2500)
const dStop = await dist()
check(dStop < 5, `stops beside you (${dStop.toFixed(1)} m)`)
await shot('7_beside')

check(errs.length === 0, `no page errors (${errs.length})`)
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
