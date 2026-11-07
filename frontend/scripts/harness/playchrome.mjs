// playchrome.mjs [seconds] [outDir] — PLAY IT IN CHROME (2026-11-07, the user: "use any benchmarking tools u want and
// play it in chrome"): a VISIBLE Chrome window (not headless — the page composited by the desktop as a player's is),
// 1920 × 1080, ULTRA, the frame-rate cap off (--disable-frame-rate-limit: what the uncapped fps numbers mean; a normal
// Chrome waits for the screen's refresh), the FPS overlay on. The car is DRIVEN with the keys — W held, steered toward
// the nearest track ahead (A / D) — for `seconds`; every frame's interval and the page's JavaScript in it recorded.
// Reports mean / p50 / p99 / max frame time, frames over 2× / 4× the median and where, and a screenshot of the overlay.
//   node scripts/harness/playchrome.mjs 60 vg/play          env PORT (5200), QS (extra URL params)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const SECONDS = Number(process.argv[2] || 60), out = process.argv[3]
if (out) fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: false,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--window-position=0,0', '--mute-audio', '--disable-infobars', '--no-first-run'],
  defaultViewport: null })
const [p] = await b.pages()
await p.setViewport({ width: 1920, height: 1080 })
p.on('pageerror', (e) => console.log(`page error: ${e.message.slice(0, 200)}`))
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log(`console error: ${m.text().slice(0, 200)}`) })
await p.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__js = 0
  window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); cb(t); window.__js += performance.now() - s })
})
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0&stats=1${process.env.QS ? `&${process.env.QS}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
await new Promise((r) => setTimeout(r, 3000))
await p.bringToFront()
// the driver: W held; every 150 ms steer toward the track point ~25 m ahead of the car (A / D held while off by > 4°)
const res = await p.evaluate(async (S) => {
  const o = window.__oth, car = o.car, lines = o.world.map.meta.trails.lines
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }))
  const steer = () => {
    const pos = car.sim.body.translation(), h = car.sim.heading
    const fx = -Math.sin(h), fz = -Math.cos(h)
    let best = null, bd = 1e9
    for (const L of lines) for (const [x, z] of L) {
      const dx = x - pos.x, dz = z - pos.z, ahead = dx * fx + dz * fz, d = Math.hypot(dx, dz)
      if (ahead > 12 && d < 45 && Math.abs(d - 25) < bd) { bd = Math.abs(d - 25); best = [x, z] }
    }
    key('KeyA', false); key('KeyD', false)
    if (!best) return
    const want = Math.atan2(-(best[0] - pos.x), -(best[1] - pos.z))
    let e = want - h; e = Math.atan2(Math.sin(e), Math.cos(e))
    if (e > 0.07) key('KeyA', true); else if (e < -0.07) key('KeyD', true)
  }
  key('KeyW', true)
  const rec = [], t0 = performance.now()
  let last = t0, j0 = window.__js, st = 0
  await new Promise((r) => {
    const f = () => {
      const n = performance.now()
      const q = car.sim.body.translation()
      rec.push([+(n - last).toFixed(2), +(window.__js - j0).toFixed(2), Math.round(q.x), Math.round(q.z)])
      last = n; j0 = window.__js
      if (n - st > 150) { st = n; steer() }
      if (n - t0 < S * 1000) requestAnimationFrame(f); else r()
    }
    requestAnimationFrame(f)
  })
  key('KeyW', false); key('KeyA', false); key('KeyD', false)
  return { rec, km: car.sim ? null : null }
}, SECONDS)
const d = res.rec.slice(1).map((q) => q[0]).sort((a, b) => a - b)
const mean = d.reduce((a, c) => a + c, 0) / d.length, med = d[d.length >> 1]
const hitches = res.rec.filter((q, i) => i > 0 && q[0] > 2 * med)
console.log(`${res.rec.length} frames in ${SECONDS} s: mean ${mean.toFixed(3)} ms (${(1000 / mean).toFixed(0)} fps)  median ${med.toFixed(2)}  p99 ${d[Math.floor(d.length * 0.99)].toFixed(2)}  max ${d[d.length - 1].toFixed(1)} ms`)
console.log(`frames over 2× the median: ${hitches.length} (${(100 * hitches.length / d.length).toFixed(2)} %), over 4×: ${res.rec.filter((q, i) => i > 0 && q[0] > 4 * med).length}`)
for (const h of hitches.sort((a, b) => b[0] - a[0]).slice(0, 10)) console.log(`   ${h[0]} ms  js ${h[1]}  at ${h[2]},${h[3]}`)
const pos = res.rec[res.rec.length - 1]
console.log(`the car ended at ${pos[2]},${pos[3]}`)
if (out) { await p.screenshot({ path: `${out}/play_overlay.png` }); console.log(`screenshot: ${out}/play_overlay.png`) }
await b.close()
