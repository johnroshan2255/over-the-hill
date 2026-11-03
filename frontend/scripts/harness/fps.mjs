// fps.mjs [tier] [extra URL params] — THE MIGRATION'S YARDSTICK (docs/MIGRATION.md: 500 fps ULTRA on a PC):
// uncapped 1920×1080, fixed views, the frame time (trimmed mean of 2.5 s of frames) and how much of it is the page's
// own JavaScript (each requestAnimationFrame callback timed) — the rest is the GPU / compositor. Works on any build that
// keeps `window.__oth` (ready, view, drive, stats, world).
//   node scripts/harness/fps.mjs ultra            node scripts/harness/fps.mjs ultra "api=webgpu"
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra'
const extra = process.argv[3] ? `&${process.argv[3]}` : ''
// (PORT=5201: the same views on main — the three.js build — for a like-for-like A/B)
const PORT = process.env.PORT || 5200
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 300)) })
// (every rAF callback timed: the page's JavaScript per frame)
await p.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__js = 0
  window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); cb(t); window.__js += performance.now() - s })
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const measure = () => p.evaluate(() => new Promise((r) => {
  const d = []; const t = performance.now(); let l = t; const j0 = window.__js
  const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t < 2500) requestAnimationFrame(tick); else { const js = (window.__js - j0) / d.length; d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); r({ ms: m.reduce((a, b) => a + b, 0) / m.length, js }) } }
  requestAnimationFrame(tick)
}))
// THE GPU'S REAL PACE: 300 frames submitted, then wait until the GPU has finished them (WebGPU's rAF runs ahead of the
// GPU in headless Chrome — rAF timing alone lies there; on WebGL2 the two agree)
const drained = () => p.evaluate(async () => {
  const o = window.__oth
  if (!o.gpuDone) return NaN // (a build without it — main: WebGL2, where rAF timing is honest)
  await o.gpuDone()
  const t0 = performance.now()
  await new Promise((r) => { let n = 0; const f = () => { if (++n < 300) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  await o.gpuDone()
  return (performance.now() - t0) / 300
})
const VIEWS = [
  // [world, name, drive?, x, z, h, yaw, pitch]
  ['valley', 'spawn (car)', true],
  ['valley', 'forest', false, 260, 640, 2.2, 0.6, -0.05],
  ['valley', 'lake', false, -160, -1320, 3, -1.2, -0.04],
  ['valley', 'cliff', false, 1102, -1700, 2.2, 0, -0.02],
  ['desert', 'oasis', false, -330, 420, 3, -1.2, -0.02],
  ['desert', 'plain', false, -300, 1100, 2, 0.3, 0.02],
]
let loaded = '', total = 0
for (const [world, name, drive, x, z, h, yaw, pitch] of VIEWS) {
  const url = `http://localhost:${PORT}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=${world}&sound=0&save=0${extra}`
  if (url !== loaded) {
    await p.goto(url, { waitUntil: 'load' })
    await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
    loaded = url
  }
  await p.evaluate((a) => { const o = window.__oth; if (a.drive) o.drive(true); else o.view(a.x, a.z, a.h, a.yaw, a.pitch) }, { drive, x, z, h, yaw, pitch })
  await sleep(2500)
  const r = await measure()
  const d = await drained()
  const s = await p.evaluate(() => { const t = window.__oth.stats(); return { draws: t.draws, tris: t.tris, backend: window.__oth.backend ?? 'three' } })
  const ms = Number.isNaN(d) ? r.ms : Math.max(r.ms, d)
  total += ms
  console.log(`${tier.padEnd(6)} ${s.backend.padEnd(6)} ${world.padEnd(7)} ${name.padEnd(12)} ${ms.toFixed(3)} ms  ${(1000 / ms).toFixed(0).padStart(4)} fps   (rAF ${r.ms.toFixed(3)}, GPU-drained ${d.toFixed(3)})   js ${r.js.toFixed(3)} ms   draws ${s.draws}  tris ${(s.tris / 1000).toFixed(0)}k`)
}
console.log(`mean ${(total / VIEWS.length).toFixed(3)} ms  (${(1000 / (total / VIEWS.length)).toFixed(0)} fps)`)
console.log('errors:', errs.length ? errs : 'none')
await b.close()
