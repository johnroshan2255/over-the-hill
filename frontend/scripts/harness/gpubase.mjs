// gpubase.mjs [view] — the GPU-drained frame (median of 3 runs × 300 frames) on each backend, MSAA on / off, with
// the whole world and with nothing of it drawn (the frame's fixed cost); env ONLY=terrain+sky: those parts alone. docs/MIGRATION.md.
import puppeteer from 'puppeteer-core'
const view = process.argv[2] || 'spawn'
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], plain: ['desert', false, -300, 1100, 2, 0.3, 0.02] }[view]
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', ...(process.env.DAWN ? [`--enable-dawn-features=${process.env.DAWN}`] : []), '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const drained = () => p.evaluate(async () => {
  const o = window.__oth, runs = []
  for (let k = 0; k < 3; k++) {
    await o.gpuDone()
    const t0 = performance.now()
    await new Promise((r) => { let n = 0; const f = () => { if (++n < 300) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
    await o.gpuDone()
    runs.push((performance.now() - t0) / 300)
  }
  runs.sort((a, b) => a - b)
  return runs[1]
})
for (const q of (process.argv[3] || 'api=webgl2,api=webgpu,api=webgl2&aa=0,api=webgpu&aa=0').split(',')) {
  await p.goto(`http://localhost:5200/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=${V[0]}&sound=0&save=0&${q}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, V)
  await new Promise((r) => setTimeout(r, 4000))
  const full = await drained()
  const only = process.env.ONLY ? process.env.ONLY.split('+') : null
  let solo = NaN
  if (only) { await p.evaluate((o) => { for (const [k, v] of Object.entries(window.__oth.parts())) v.visible = o.includes(k) }, only); solo = await drained() }
  await p.evaluate(() => { for (const v of Object.values(window.__oth.parts())) v.visible = false })
  const none = await drained()
  const be = await p.evaluate(() => window.__oth.backend)
  console.log(`${view} ${q.padEnd(22)} ${be.padEnd(6)} full ${full.toFixed(3)} ms (${(1000 / full).toFixed(0)} fps)   nothing drawn ${none.toFixed(3)} ms   → the world ${(full - none).toFixed(3)} ms${only ? `   only ${only.join('+')}: ${(solo - none).toFixed(3)} ms` : ''}`)
}
await b.close()
