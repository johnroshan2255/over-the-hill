// abradar.mjs <tier> — the cost of THE GPS's always-on parts: the RADAR (Radar.ts) with a route on it, and the chart's
// slices (Chart.ts) — frame time with the radar on vs off, interleaved ×5, uncapped 1920×1080, the slowest and fastest
// tenth dropped (abweather.mjs's way); the car driving (W held: the radar redraws as it slides) or parked.
// Also: a radar REDRAW (ms, forced ×200), the whole chart painted at once (ms), a route planned (ms).
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ft = () => p.evaluate(() => new Promise((r) => { const d = []; const t = performance.now(); let l = t; const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t < 1500) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); r(m.reduce((a, b) => a + b, 0) / m.length) } }; requestAnimationFrame(tick) }))
await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&radar=1`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
await sleep(3000)
const once = await p.evaluate(async () => {
  const o = window.__oth, r = o.radar
  // a route across the valley (from the car)
  const l = o.world.places.find((q) => q.name === 'Lookout Peak')
  let t = performance.now()
  o.guide.set({ world: 'valley', x: l.x, z: l.z, name: l.name }, o.car.pos)
  const route = performance.now() - t
  // off = the radar's update skipped and the radar hidden (nothing to composite)
  const u = r.update.bind(r)
  r.update = (...a) => { if (window.__off) { r.root.style.display = 'none'; r.visible = false; return } u(...a) }
  // a redraw, forced
  const c = o.car.pos
  t = performance.now()
  for (let i = 0; i < 200; i++) r.redraw(c.x + (i % 7), c.z, i * 0.01)
  const redraw = (performance.now() - t) / 200
  // the whole chart at once (a new one: the map opened before the slices are done)
  const { Chart } = await import('/src/oth/Chart.ts')
  t = performance.now()
  new Chart(o.world.map, 1024).finish()
  const chart1024 = performance.now() - t
  t = performance.now()
  new Chart(o.world.map, 768).finish()
  const chart768 = performance.now() - t
  return { routeMs: +route.toFixed(2), redrawMs: +redraw.toFixed(3), chart1024Ms: +chart1024.toFixed(0), chart768Ms: +chart768.toFixed(0) }
})
console.log(tier, JSON.stringify(once))
for (const mode of ['parked', 'driving']) {
  if (mode === 'driving') { await p.keyboard.down('KeyW'); await sleep(2500) }
  let on = 0, off = 0
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => (window.__off = false)); await sleep(300); on += await ft()
    await p.evaluate(() => (window.__off = true)); await sleep(300); off += await ft()
  }
  await p.evaluate(() => (window.__off = false))
  console.log(`${tier.padEnd(6)} ${mode.padEnd(8)} radar on ${(on / 5).toFixed(3)} ms (${(5000 / on).toFixed(0)} fps)  off ${(off / 5).toFixed(3)} ms (${(5000 / off).toFixed(0)} fps)  cost ${((on - off) / 5).toFixed(3)} ms`)
}
await p.keyboard.up('KeyW')
console.log('errors:', errs.length ? errs : 'none')
await b.close()
