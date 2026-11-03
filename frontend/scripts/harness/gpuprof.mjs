// gpuprof.mjs [tier] [view] [extra] — THE GPU'S OWN CLOCK (WebGPU timestamp queries, PlayCanvas's gpuProfiler): the
// frame's GPU time and each render pass's, then each part of the world hidden in turn → what each part costs the GPU.
// Far steadier than wall-clock A/B (no compositor, no rAF scheduling). WebGPU only. docs/MIGRATION.md.
//   node scripts/harness/gpuprof.mjs ultra spawn            node scripts/harness/gpuprof.mjs ultra forest "aa=0"
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra'
const view = process.argv[3] || 'spawn'
const extra = process.argv[4] ? `&${process.argv[4]}` : ''
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04], cliff: ['valley', false, 1102, -1700, 2.2, 0, -0.02], oasis: ['desert', false, -330, 420, 3, -1.2, -0.02], plain: ['desert', false, -300, 1100, 2, 0.3, 0.02] }[view]
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-dawn-features=allow_unsafe_apis', '--disable-dawn-features=timestamp_quantization', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=${V[0]}&sound=0&save=0&api=webgpu&bench=offscreen${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, V)
await p.evaluate(() => { window.__pc.AppBase.getApplication().graphicsDevice.gpuProfiler.enabled = true })
await new Promise((r) => setTimeout(r, 2500))
// the GPU time of `n` frames (each frame's own timestamps, read a frame or two late): median, and the passes' means
const gpu = (n = 90) => p.evaluate((n) => new Promise((res) => {
  const pr = window.__pc.AppBase.getApplication().graphicsDevice.gpuProfiler, f = [], passes = {}
  let k = 0
  const tick = () => {
    if (++k > 4) { const t = pr.frameTime; if (t) { f.push(t); for (const [a, v] of pr.passTimings) passes[a] = (passes[a] ?? 0) + v } }
    if (f.length < n) requestAnimationFrame(tick)
    else { f.sort((a, b) => a - b); for (const a in passes) passes[a] /= f.length; res({ ms: f[f.length >> 1], passes }) }
  }
  requestAnimationFrame(tick)
}), n)
const all = await gpu(150)
console.log(`${tier} ${view}${extra}: GPU ${all.ms.toFixed(3)} ms (${(1000 / all.ms).toFixed(0)} fps of GPU)   passes: ${Object.entries(all.passes).map(([a, v]) => `${a} ${v.toFixed(3)}`).join(', ')}`)
if (process.env.PARTS !== '0') {
  const names = await p.evaluate(() => Object.keys(window.__oth.parts()))
  const rows = []
  for (const n of names) {
    let on = 0, off = 0
    for (let i = 0; i < 2; i++) {
      await p.evaluate((n) => (window.__oth.parts()[n].visible = true), n); on += (await gpu()).ms
      await p.evaluate((n) => (window.__oth.parts()[n].visible = false), n); off += (await gpu()).ms
    }
    await p.evaluate((n) => (window.__oth.parts()[n].visible = true), n)
    rows.push([n, (on - off) / 2])
  }
  for (const [n, c] of rows.sort((a, b) => b[1] - a[1])) console.log(`${c.toFixed(3).padStart(8)} ms  ${n}`)
  await p.evaluate(() => { for (const v of Object.values(window.__oth.parts())) v.visible = false })
  console.log(`  (nothing drawn: ${(await gpu()).ms.toFixed(3)} ms)`)
}
await b.close()
