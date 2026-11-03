// glcount.mjs [port] [extra] — WebGL calls per frame by function (60 frames averaged), at the spawn (driving), ULTRA.
// The call budget of a build: on Chrome / ANGLE each call has a real cost (docs/MIGRATION.md).
import puppeteer from 'puppeteer-core'
const port = process.argv[2] || 5200
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.evaluateOnNewDocument(() => {
  window.__gl = {}
  const P = WebGL2RenderingContext.prototype
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k)
    if (typeof d.value !== 'function') continue
    const f = d.value
    P[k] = function (...a) { if (window.__glOn) window.__gl[k] = (window.__gl[k] ?? 0) + 1; return f.apply(this, a) }
  }
})
await p.goto(`http://localhost:${port}/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0${process.argv[3] ? '&' + process.argv[3] : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true)); await new Promise((r) => setTimeout(r, 2500))
const r = await p.evaluate(() => new Promise((res) => { let n = 0; window.__gl = {}; window.__glOn = true; const t = () => { if (++n < 60) requestAnimationFrame(t); else { window.__glOn = false; res(window.__gl) } }; requestAnimationFrame(t) }))
let total = 0
for (const v of Object.values(r)) total += v
console.log(`port ${port}: ${(total / 60).toFixed(0)} WebGL calls / frame`)
for (const [k, v] of Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(v / 60).toFixed(1).padStart(7)}  ${k}`)
await b.close()
