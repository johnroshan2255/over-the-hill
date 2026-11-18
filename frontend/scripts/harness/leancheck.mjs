// leancheck.mjs [outDir] — THE LEAN BUFFERS and RELEASED GEOMETRIES (gfx/scene.ts, 2026-11-18), played:
//  1. a drive (track 0, 20 s), the cave walked into, night and rain: no array of a released geometry may be read
//     (window.__othReleasedReads), no errors;
//  2. a LOST DEVICE (renderer.loseDevice): the page must RELOAD and continue where the car was saved (main.ts);
//  3. lost again and again: after the third in two minutes no more reloads — the message stays.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || '/tmp/leancheck'
fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
const p = await b.newPage(), errs = []
p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)))
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ready = () => p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&sound=0`, { waitUntil: 'load' })
await ready()
await p.evaluate(() => window.__oth.drive(true))
// 1. the drive, the cave, night and rain
await p.evaluate(async () => {
  const o = window.__oth, L = o.world.map.meta.trails.lines[0], pts = []
  for (let i = 1; i < L.length; i++) { const [ax, az] = L[i - 1], [bx, bz] = L[i], d = Math.hypot(bx - ax, bz - az); for (let s = 0; s < d; s += 1) pts.push([ax + (bx - ax) * (s / d), az + (bz - az) * (s / d)]) }
  const t0 = performance.now()
  await new Promise((r) => { const f = () => { const d = Math.min(pts.length - 9, Math.floor((performance.now() - t0) / 1000 * 28)), a = pts[d], q = pts[d + 8]; o.car.placeAt(a[0], a[1], Math.atan2(-(q[0] - a[0]), -(q[1] - a[1]))); if (performance.now() - t0 < 20000) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
})
for (const v of [[-1190, 1900, 3.5, 0, 0.02], [-1191.4, 1799.6, 4.5, 0.33, 0], [3025, -3161, 3, 0.785, -0.02], [4160, -1155, 3, 0.09, -0.12], [361, 1682, 5, 0.785, -0.15]]) { await p.evaluate((v) => window.__oth.view(...v), v); await sleep(2000) }
await p.evaluate(() => { window.__oth.atmos.hour = 23; window.__oth.atmos.weather = 'rain'; window.__oth.atmos.settleWeather() }); await sleep(2500)
await p.evaluate(() => { window.__oth.atmos.hour = 12; window.__oth.atmos.weather = 'clear'; window.__oth.atmos.settleWeather(); window.__oth.drive(true) }); await sleep(3000)
console.log(`1. played: released arrays read ${await p.evaluate(() => window.__othReleasedReads ?? 0)} times; errors: ${errs.length ? errs.join(' | ') : 'none'}`)
await p.screenshot({ path: `${out}/before.png` })
// 2. the device lost: a reload, the journey continued
const at = () => p.evaluate(() => { const c = window.__oth.car.pos; return [Math.round(c.x), Math.round(c.z)] })
const before = await at()
for (let k = 1; k <= 3; k++) {
  const nav = p.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).then(() => true, () => false)
  await p.evaluate(() => { void window.__oth.renderer.loseDevice() }).catch(() => {})
  const reloaded = await nav
  if (!reloaded) { console.log(`${k + 1}. lost #${k}: NO reload — the page says: "${await p.evaluate(() => [...document.querySelectorAll('.oth-toast, .toast, [class*=toast]')].map((e) => e.textContent).join(' / '))}"`); break }
  await ready(); await sleep(3000)
  const now = await at()
  console.log(`${k + 1}. lost #${k}: reloaded; the car at ${now} (was ${before}: ${Math.round(Math.hypot(now[0] - before[0], now[1] - before[1]))} m away); errors since: ${errs.length ? errs.join(' | ') : 'none'}`)
  if (k === 1) await p.screenshot({ path: `${out}/after_reload.png` })
}
await b.close()
