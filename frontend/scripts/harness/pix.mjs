// pix.mjs — the frame vs PIXELS (docs/PERF.md): ULTRA at render scale 100 / 75 / 50 %, MSAA on / off, WebGPU vs WebGL2; GPU-drained, 1080p uncapped.
import puppeteer from 'puppeteer-core'
const V = { spawn: ['valley', true], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04] }
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const drained = () => p.evaluate(async () => {
  const o = window.__oth, runs = []
  for (let k = 0; k < 3; k++) { await o.gpuDone(); const t0 = performance.now()
    await new Promise((r) => { let n = 0; const f = () => { if (++n < 250) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
    await o.gpuDone(); runs.push((performance.now() - t0) / 250) }
  runs.sort((a, b) => a - b); return runs[1]
})
for (const name of ['spawn', 'lake']) for (const q of ['api=webgpu', 'api=webgpu&aa=0', 'api=webgpu&scale=75', 'api=webgpu&scale=75&aa=0', 'api=webgpu&scale=50&aa=0', 'api=webgl2', 'api=webgl2&aa=0']) {
  const v = V[name]
  await p.goto(`http://localhost:5200/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=${v[0]}&sound=0&save=0&${q}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, v)
  await new Promise((r) => setTimeout(r, 3000))
  const ms = await drained()
  console.log(`${name.padEnd(6)} ${q.padEnd(26)} ${ms.toFixed(3)} ms  ${(1000 / ms).toFixed(0)} fps`)
}
await b.close()
