// ablate.mjs [tier] [view] [extra] — the GPU's frame, system by system: each part of the world hidden in turn (the rest
// drawn), the frame time with vs without it, interleaved ×4, uncapped 1080p. What each costs = what hiding it saves.
// Needs `window.__oth.parts()` → { name: { visible } } (every build keeps it).
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra'
const view = process.argv[3] || 'spawn'
const extra = process.argv[4] ? `&${process.argv[4]}` : ''
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04], oasis: ['desert', false, -330, 420, 3, -1.2, -0.02] }[view]
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-dawn-features=allow_unsafe_apis', '--disable-dawn-features=timestamp_quantization', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=${V[0]}&sound=0&save=0${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, V)
await new Promise((r) => setTimeout(r, 3000))
// THE GPU'S REAL PACE (gpubase.mjs's way): 3 runs of 200 frames each waited out on the GPU, the median
const ft = () => p.evaluate(async () => {
  const o = window.__oth, runs = []
  for (let k = 0; k < 3; k++) {
    await o.gpuDone()
    const t0 = performance.now()
    await new Promise((r) => { let n = 0; const f = () => { if (++n < 200) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
    await o.gpuDone()
    runs.push((performance.now() - t0) / 200)
  }
  runs.sort((a, b) => a - b)
  return runs[1]
})
const names = await p.evaluate(() => Object.keys(window.__oth.parts()))
const all = await (async () => { let s = 0; for (let i = 0; i < 3; i++) s += await ft(); return s / 3 })()
console.log(`${tier} ${await p.evaluate(() => window.__oth.backend)} ${view}: GPU frame ${all.toFixed(3)} ms (${(1000 / all).toFixed(0)} fps of GPU)`)
const rows = []
for (const n of names) {
  let on = 0, off = 0
  for (let i = 0; i < 2; i++) {
    await p.evaluate((n) => (window.__oth.parts()[n].visible = true), n); on += await ft()
    await p.evaluate((n) => (window.__oth.parts()[n].visible = false), n); off += await ft()
  }
  await p.evaluate((n) => (window.__oth.parts()[n].visible = true), n)
  rows.push([n, (on - off) / 2])
}
for (const [n, c] of rows.sort((a, b) => b[1] - a[1])) console.log(`${c.toFixed(3).padStart(8)} ms  ${n}`)
await b.close()
