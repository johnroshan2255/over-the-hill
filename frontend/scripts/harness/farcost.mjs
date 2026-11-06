// farcost.mjs [views] — what the FAR distance costs (docs/PERF.md): the GPU-drained frame (ULTRA 1080p uncapped) with the camera's far plane
// cut to 3000 / 1500 / 800 m (everything past it not drawn — the upper bound of "hide the far things"), interleaved ×2.
import puppeteer from 'puppeteer-core'
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04], oasis: ['desert', false, -330, 420, 3, -1.2, -0.02] }
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const drained = () => p.evaluate(async () => {
  const o = window.__oth, runs = []
  for (let k = 0; k < 3; k++) {
    await o.gpuDone(); const t0 = performance.now()
    await new Promise((r) => { let n = 0; const f = () => { if (++n < 250) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
    await o.gpuDone(); runs.push((performance.now() - t0) / 250)
  }
  runs.sort((a, b) => a - b); return runs[1]
})
let loaded = ''
for (const name of (process.argv[2] || 'spawn,forest,lake,oasis').split(',')) {
  const v = V[name]
  const url = `http://localhost:5200/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=${v[0]}&sound=0&save=0`
  if (url !== loaded) { await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 }); loaded = url }
  await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, v)
  await new Promise((r) => setTimeout(r, 3000))
  const base = await p.evaluate(() => window.__oth.camera.far)
  const res = {}
  for (let rep = 0; rep < 2; rep++) for (const f of [base, 3000, 1500, 800]) {
    await p.evaluate((f) => { const c = window.__oth.camera; c.far = f; c.updateProjectionMatrix() }, f)
    await new Promise((r) => setTimeout(r, 400))
    ;(res[f] ??= []).push(await drained())
  }
  await p.evaluate((f) => { const c = window.__oth.camera; c.far = f; c.updateProjectionMatrix() }, base)
  const m = (a) => a.reduce((x, y) => x + y, 0) / a.length
  const b0 = m(res[base])
  console.log(`${name.padEnd(7)} far ${base} m: ${b0.toFixed(3)} ms   ` + [3000, 1500, 800].map((f) => `${f} m: ${m(res[f]).toFixed(3)} (${(m(res[f]) - b0 >= 0 ? '+' : '')}${(m(res[f]) - b0).toFixed(3)})`).join('   '))
}
await b.close()
