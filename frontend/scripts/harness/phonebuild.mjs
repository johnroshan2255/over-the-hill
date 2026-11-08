// BUILD MODE ON A PHONE (412 × 915, touch): the action wheel's BUILD, a tap on the ground puts the brush there, the
// PLANT YOUR FLAG button plants it. Screenshots of the brush and the flag on the phone's screen.
//   node scripts/harness/phonebuild.mjs <outdir>    env: PORT (5200)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'phonebuild'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const api = async (m, p, b, t) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json() }
const A = await api('POST', '/v1/players', { name: 'Meera' })
const w = await api('POST', '/v1/worlds', { name: 'Phone valley', map: 'valley' }, A.token)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=412,915', '--mute-audio'], defaultViewport: { width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true } })
const p = await browser.newPage()
await p.setUserAgent('Mozilla/5.0 (Linux; Android 14; SM-A156E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')
p.on('pageerror', (e) => console.log('[pageerror]', e.message))
await p.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: A.id, name: A.name, token: A.token })
await p.goto(`${BASE}/?coop=${w.id}&hour=10&time=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 180_000, polling: 250 })
await sleep(1500)
console.log('tier', await p.evaluate(() => window.__oth.tier))
// BUILD from the action wheel (its item runs what the wheel's button does)
await p.evaluate(() => window.__oth.coop.build.toggle(true))
await sleep(1400)
// tap the ground: the brush goes there (look for clear ground as a thumb would)
let placed = false
for (const [fx, fy] of [[0.3, 0.42], [0.7, 0.42], [0.5, 0.36], [0.25, 0.5], [0.75, 0.5]]) {
  await p.touchscreen.tap(412 * fx, 915 * fy)
  await sleep(350)
  const why = await p.evaluate(() => document.querySelector('.oth-build-head em')?.textContent ?? '')
  if (!why) { placed = true; break }
}
check(placed, 'a tap puts the brush on clear ground')
await p.screenshot({ path: `${out}/1_phone_brush.png` })
// the PLANT button
await p.evaluate(() => [...document.querySelectorAll('.oth-build-keys button')].find((b) => /plant/i.test(b.textContent))?.click())

await p.waitForFunction(() => window.__oth.coop.session.claims.size === 1, { timeout: 8000 }).catch(() => {})
check(await p.evaluate(() => window.__oth.coop.session.claims.size === 1), 'PLANT YOUR FLAG: the land is yours')
await sleep(2000)
await p.screenshot({ path: `${out}/2_phone_after.png` })
// a reload: back in the world, the land still ours (the server kept it)
await p.reload({ waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 180_000, polling: 250 })
await sleep(1500)
check(await p.evaluate(() => window.__oth.coop.claims.list.length === 1 && window.__oth.coop.claims.list[0].mine), 'after a reload the land is still yours')
await browser.close()
console.log(ok ? 'phone build: all good' : 'phone build: FAILED')
process.exit(ok ? 0 : 1)
